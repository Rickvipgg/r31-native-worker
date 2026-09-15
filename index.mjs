import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createClient } from '@supabase/supabase-js'
import { detectEncoder, probeVideo, renderNative } from './lib/render.mjs'
import { claimRenderJobs, requeueStaleJobs } from './lib/queue.mjs'
import { computeWorkerLimits, memoryPressure } from './lib/resources.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'instagram-media'
const LIMITS = computeWorkerLimits({ requestedConcurrency: Number(process.env.RENDER_CONCURRENCY || 4), requestedThreads: Number(process.env.FFMPEG_THREADS || 0) })
const REQUESTED_CONCURRENCY = LIMITS.requestedConcurrency
let concurrency = LIMITS.concurrency
const FFMPEG_THREADS = LIMITS.threads
const POLL_MS = Math.max(500, Number(process.env.RENDER_POLL_MS || 1500))
const DELETE_SOURCES = (process.env.DELETE_RENDER_SOURCES || 'true') === 'true'
const PORT = Number(process.env.PORT || 8080)
const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SECRET_KEY ausentes')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
let stopping = false
let active = 0
let completed = 0
let failed = 0
let lastError = null
let encoder = 'detecting'
let memoryPauses = 0

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function cleanBase(name) { return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90) || 'video' }

async function downloadObject(storagePath, destination) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 600)
  if (error || !data?.signedUrl) throw error || new Error(`Falha ao assinar download: ${storagePath}`)
  const response = await fetch(data.signedUrl)
  if (!response.ok || !response.body) throw new Error(`Download ${storagePath} falhou: ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

async function uploadOutput(storagePath, localPath) {
  const bytes = await readFile(localPath)
  const { error } = await sb.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: 'video/mp4', cacheControl: '3600', upsert: true,
  })
  if (error) throw error
}

async function setJob(id, patch) {
  const { error } = await sb.from('render_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

async function failJob(job, error) {
  failed++
  lastError = error instanceof Error ? error.message : String(error)
  const retry = Number(job.attempts || 0) < 3
  await setJob(job.id, {
    status: retry ? 'queued' : 'failed',
    worker_id: retry ? null : WORKER_ID,
    locked_at: null,
    error: lastError.slice(0, 12000),
  }).catch((e) => console.error('Falha ao marcar erro', e))
}

async function processJob(job) {
  active++
  let tmp = null
  try {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'r31-render-'))
    const sourceExt = path.extname(job.source_path) || '.mp4'
    const source = path.join(tmp, `source${sourceExt}`)
    const template = path.join(tmp, 'template.png')
    const output = path.join(tmp, 'output.mp4')
    const outputPath = `rendered/${new Date().toISOString().slice(0, 10)}/${job.id}-${cleanBase(job.original_name)}.mp4`
    console.log(`[${job.id}] baixando ${job.original_name}`)
    await Promise.all([downloadObject(job.source_path, source), downloadObject(job.template_path, template)])
    const sourceStat = await stat(source)
    const probe = await probeVideo(source)
    const retryNumber = Math.max(0, Number(job.attempts || 0) - 1)
    const safeMode = retryNumber > 0
    const videoInfo = probe.ok
      ? `${probe.codec || '?'} ${probe.width || '?'}x${probe.height || '?'} fps=${probe.avgFrameRate || probe.realFrameRate || '?'} dur=${probe.duration ? probe.duration.toFixed(1) : '?'}s`
      : `ffprobe indisponível: ${probe.error}`
    console.log(`[${job.id}] render native (${(sourceStat.size / 1024 / 1024).toFixed(1)} MB) encoder=${encoder} safe=${safeMode} | ${videoInfo}`)
    let result
    try {
      result = await renderNative({ source, template, output, settings: job.render_settings, encoder, threads: FFMPEG_THREADS, safeMode })
    } catch (renderError) {
      if (encoder === 'h264_nvenc') {
        console.warn(`[${job.id}] NVENC falhou; fallback imediato para libx264 em modo seguro`)
        result = await renderNative({ source, template, output, settings: job.render_settings, encoder: 'libx264', threads: 1, safeMode: true })
      } else throw renderError
    }
    console.log(`[${job.id}] render ok ${(result.elapsedMs / 1000).toFixed(1)}s encoder=${result.encoder} threads=${result.threads} safe=${result.safeMode}; enviando saída`)
    await uploadOutput(outputPath, output)

    const postRow = {
      account_id: job.account_id,
      storage_path: outputPath,
      original_name: job.original_name.replace(/\.[^.]+$/, '.mp4'),
      caption: job.caption || '',
      scheduled_at: job.scheduled_at,
      share_to_feed: Boolean(job.share_to_feed),
      status: 'scheduled',
      render_job_id: job.id,
      updated_at: new Date().toISOString(),
    }
    const { data: igPost, error: postError } = await sb.from('scheduled_posts').upsert(postRow, { onConflict: 'render_job_id' }).select('id').single()
    if (postError) throw postError

    let facebookQueued = false
    try {
      const { data: fbPage, error: fbPageError } = await sb.from('fb_pages').select('id').eq('is_active', true).limit(1).maybeSingle()
      if (fbPageError) {
        if (!String(fbPageError.message || '').includes('fb_pages')) console.warn(`[${job.id}] Facebook:`, fbPageError.message || fbPageError)
      } else if (fbPage?.id) {
        const fbRow = {
          page_id: fbPage.id,
          source_post_id: igPost.id,
          render_job_id: job.id,
          storage_path: outputPath,
          original_name: postRow.original_name,
          caption: postRow.caption,
          scheduled_at: postRow.scheduled_at,
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        }
        const { error: fbPostError } = await sb.from('facebook_posts').upsert(fbRow, { onConflict: 'page_id,render_job_id', ignoreDuplicates: true })
        if (fbPostError) {
          if (!String(fbPostError.message || '').includes('facebook_posts')) console.warn(`[${job.id}] Facebook fila:`, fbPostError.message || fbPostError)
        } else facebookQueued = true
      }
    } catch (fbError) {
      console.warn(`[${job.id}] Facebook opcional não enfileirado:`, fbError?.message || fbError)
    }

    await setJob(job.id, {
      status: 'completed', output_path: outputPath, completed_at: new Date().toISOString(),
      locked_at: null, error: null,
    })
    if (DELETE_SOURCES) {
      try {
        const { error: removeError } = await sb.storage.from(BUCKET).remove([job.source_path, job.template_path])
        if (removeError) console.warn(`[${job.id}] aviso ao apagar fontes:`, removeError.message || removeError)
      } catch (removeError) {
        console.warn(`[${job.id}] aviso ao apagar fontes:`, removeError)
      }
    }
    completed++
    console.log(`[${job.id}] COMPLETO -> fila Instagram${facebookQueued ? ' + Facebook' : ''}`)
  } catch (error) {
    const signal = error?.ffmpegSignal || null
    const interrupted = Boolean(error?.ffmpegInterrupted) || error?.ffmpegCode === null || signal === 'SIGKILL'
    if (interrupted) {
      const before = concurrency
      concurrency = Math.max(1, concurrency - 1)
      console.warn(`[${job.id}] FFmpeg interrompido (${signal || 'código null'}). Paralelismo ${before} -> ${concurrency}; próxima tentativa usará modo seguro (1 thread).`)
    }
    console.error(`[${job.id}] ERRO`, error)
    await failJob(job, error)
  } finally {
    active--
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {})
    if (stopping && active === 0) process.exit(0)
  }
}

async function claimJobs() {
  const free = Math.max(0, concurrency - active)
  if (!free) return []

  // Não inicia novos FFmpegs quando o container já está próximo do limite de RAM.
  // Jobs em andamento continuam; o worker apenas espera a pressão cair.
  const pressure = memoryPressure({ limitMb: LIMITS.memoryMb })
  if (pressure.high && active > 0) {
    memoryPauses++
    if (memoryPauses === 1 || memoryPauses % 20 === 0) {
      console.warn(`RAM alta ${pressure.usageMb}/${pressure.limitMb}MB; pausando novos claims (ativos=${active})`)
    }
    return []
  }
  memoryPauses = 0
  return claimRenderJobs(sb, WORKER_ID, free)
}

async function loop() {
  try {
    encoder = await detectEncoder(process.env.FFMPEG_ENCODER || 'auto')
    console.log(`R31 Native Worker ${WORKER_ID} | requested=${REQUESTED_CONCURRENCY} | concurrency=${concurrency} | ffmpegThreads=${FFMPEG_THREADS} | cpu=${LIMITS.cpuCount} | mem=${LIMITS.memoryMb}MB | encoder=${encoder}`)
    const stale = await requeueStaleJobs(sb)
    if (!stale.ok) console.warn('Aviso ao re-enfileirar jobs antigos:', stale.error?.message || stale.error)
    else if (stale.count > 0) console.log(`Re-enfileirados ${stale.count} job(s) antigo(s)`)
    while (!stopping) {
      try {
        const jobs = await claimJobs()
        if (jobs.length) jobs.forEach((job) => processJob(job))
        else await sleep(POLL_MS)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        console.error('loop:', error)
        await sleep(Math.max(3000, POLL_MS))
      }
    }
  } catch (error) {
    console.error('Falha fatal:', error)
    process.exit(1)
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' })
    const pressure = memoryPressure({ limitMb: LIMITS.memoryMb })
    res.end(JSON.stringify({ ok: true, workerId: WORKER_ID, encoder, requestedConcurrency: REQUESTED_CONCURRENCY, concurrency, ffmpegThreads: FFMPEG_THREADS, cpuCount: LIMITS.cpuCount, memoryMb: LIMITS.memoryMb, memoryUsageMb: pressure.usageMb, memoryHigh: pressure.high, active, completed, failed, lastError }))
    return
  }
  res.writeHead(404).end('not found')
})
server.listen(PORT, '0.0.0.0', () => console.log(`health :${PORT}/health`))

async function shutdown(signal) {
  if (stopping) return
  stopping = true
  console.log(`${signal}: encerrando worker; jobs ativos=${active}`)
  server.close(() => {
    if (active === 0) process.exit(0)
  })
  setTimeout(() => {
    console.warn('Encerramento forçado após 30s')
    process.exit(0)
  }, 30000).unref()
}

process.on('unhandledRejection', (error) => {
  lastError = error instanceof Error ? error.message : String(error)
  console.error('unhandledRejection:', error)
})
process.on('uncaughtException', (error) => {
  lastError = error instanceof Error ? error.message : String(error)
  console.error('uncaughtException:', error)
})
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
void loop()
