import { spawn } from 'node:child_process'
import { access, stat, rename, rm } from 'node:fs/promises'

export function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal, killGraceMs = 1200, ...spawnOptions } = options
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions })
    let stdout = ''
    let stderr = ''
    let settled = false
    let aborted = Boolean(signal?.aborted)
    let forceTimer = null

    const cleanup = () => {
      if (forceTimer) clearTimeout(forceTimer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (settled) return
      aborted = true
      try { child.kill('SIGTERM') } catch {}
      forceTimer = setTimeout(() => {
        if (!settled) {
          try { child.kill('SIGKILL') } catch {}
        }
      }, Math.max(100, Number(killGraceMs || 1200)))
      forceTimer.unref?.()
    }

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (spawnError) => {
      const error = new Error(`${cmd} não iniciou: ${spawnError.message}`)
      error.cause = spawnError
      error.ffmpegCode = null
      error.ffmpegSignal = null
      error.ffmpegInterrupted = true
      error.cancelled = aborted
      error.stderr = stderr
      fail(error)
    })
    child.on('close', (code, closeSignal) => {
      if (settled) return
      if (aborted || signal?.aborted) {
        const error = new Error(`${cmd} cancelado pelo usuário`)
        error.ffmpegCode = code
        error.ffmpegSignal = closeSignal
        error.ffmpegInterrupted = true
        error.cancelled = true
        error.stderr = stderr
        return fail(error)
      }
      if (code === 0) {
        settled = true
        cleanup()
        return resolve({ stdout, stderr, code, signal: closeSignal })
      }

      const tail = stderr.slice(-16000)
      const interrupted = code === null || Boolean(closeSignal)
      const why = closeSignal
        ? `${cmd} foi interrompido por sinal ${closeSignal} (código ${code ?? 'null'})`
        : code === null
          ? `${cmd} foi interrompido antes de retornar código de saída (código null)`
          : `${cmd} saiu com código ${code}`
      const hint = interrupted
        ? '\nProcesso interrompido pelo container/sistema. O worker reduzirá o uso de recursos e tentará novamente.'
        : ''
      const error = new Error(`${why}${hint}${tail ? `\n${tail}` : ''}`)
      error.ffmpegCode = code
      error.ffmpegSignal = closeSignal
      error.ffmpegInterrupted = interrupted
      error.cancelled = false
      error.stderr = stderr
      fail(error)
    })
  })
}

export async function detectEncoder(preference = 'auto') {
  if (preference && preference !== 'auto') return preference
  try {
    await access('/dev/nvidia0')
    const { stdout, stderr } = await runCommand('ffmpeg', ['-hide_banner', '-encoders'])
    if (`${stdout}\n${stderr}`.includes('h264_nvenc')) return 'h264_nvenc'
  } catch {}
  return 'libx264'
}

export async function probeVideo(source, options = {}) {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,duration',
      '-show_entries', 'format=duration,size,format_name',
      '-of', 'json',
      source,
    ], { signal: options.signal })
    const parsed = JSON.parse(stdout || '{}')
    const stream = parsed.streams?.[0] || {}
    const format = parsed.format || {}
    return {
      ok: true,
      codec: stream.codec_name || null,
      width: Number(stream.width || 0),
      height: Number(stream.height || 0),
      avgFrameRate: stream.avg_frame_rate || null,
      realFrameRate: stream.r_frame_rate || null,
      pixFmt: stream.pix_fmt || null,
      duration: Number(stream.duration || format.duration || 0),
      size: Number(format.size || 0),
      format: format.format_name || null,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}


export function computeStorageTargetKbps({ durationSeconds, maxBytes, audioKbps = 96, safety = 0.82 }) {
  const duration = Math.max(1, Number(durationSeconds || 0))
  const budgetBits = Math.max(1, Number(maxBytes || 0)) * 8 * Math.max(0.5, Math.min(0.95, Number(safety || 0.82)))
  const totalKbps = budgetBits / duration / 1000
  return Math.max(450, Math.floor(totalKbps - audioKbps))
}

export async function ensureStorageSafeMp4({ input, maxBytes = 44 * 1024 * 1024, threads = 1, signal }) {
  const original = await stat(input)
  if (original.size <= maxBytes) {
    return { path: input, originalBytes: original.size, finalBytes: original.size, recompressed: false, attempts: 0 }
  }

  const probe = await probeVideo(input, { signal })
  const duration = probe.ok && probe.duration > 0 ? probe.duration : 60
  const dir = input.replace(/[^/\\]+$/, '')
  const base = input.slice(dir.length).replace(/\.mp4$/i, '')
  let currentInput = input
  let currentSize = original.size
  let targetKbps = computeStorageTargetKbps({ durationSeconds: duration, maxBytes })
  let lastOutput = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const output = `${dir}${base}.storage-${attempt}.mp4`
    const scale = attempt >= 3
      ? 'scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:black'
      : 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black'

    const maxrate = Math.max(500, Math.floor(targetKbps * 1.03))
    const bufsize = Math.max(1000, Math.floor(targetKbps * 2))
    await runCommand('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'warning',
      '-i', currentInput,
      '-vf', `${scale},fps=30`,
      '-c:v', 'libx264',
      '-preset', attempt >= 2 ? 'veryfast' : 'superfast',
      '-b:v', `${targetKbps}k`,
      '-maxrate', `${maxrate}k`,
      '-bufsize', `${bufsize}k`,
      '-threads', String(Math.max(1, Number(threads || 1))),
      '-c:a', 'aac',
      '-b:a', attempt >= 3 ? '64k' : '96k',
      '-ar', '48000',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', output,
    ], { signal })

    const st = await stat(output)
    lastOutput = output
    currentSize = st.size
    if (st.size <= maxBytes) {
      if (currentInput !== input) await rm(currentInput, { force: true }).catch(() => {})
      await rm(input, { force: true })
      await rename(output, input)
      return { path: input, originalBytes: original.size, finalBytes: st.size, recompressed: true, attempts: attempt, targetKbps }
    }

    if (currentInput !== input) await rm(currentInput, { force: true }).catch(() => {})
    currentInput = output
    const ratio = Math.max(0.35, Math.min(0.9, (maxBytes / st.size) * 0.82))
    targetKbps = Math.max(350, Math.floor(targetKbps * ratio))
  }

  if (lastOutput && lastOutput !== input) await rm(lastOutput, { force: true }).catch(() => {})
  throw new Error(`Saída final ainda excede o limite do Storage após 3 compactações (${(currentSize / 1024 / 1024).toFixed(1)} MB).`)
}

export function buildFfmpegArgs({ source, template, output, settings, encoder = 'libx264', threads = 1, safeMode = false }) {
  const {
    width, height, videoY, videoHeight, cropX, cropY, fitMode,
    keepAudio, volume, start, end, quality,
  } = settings
  const sx = width / 720
  const sy = height / 1280
  const ax = Math.round(34 * sx)
  const ay = Math.round(videoY * sy)
  const aw = Math.round(652 * sx)
  const ah = Math.round(videoHeight * sy)
  const cx = Math.max(0, Math.min(100, cropX)) / 100
  const cy = Math.max(0, Math.min(100, cropY)) / 100

  // Reduz para 30 fps ANTES de scale/crop/overlay. A versão anterior só fazia -r 30
  // no final e podia processar 60/120 fps desnecessariamente, elevando CPU/RAM.
  const sourcePrefix = '[0:v]fps=30'
  const filter = fitMode === 'cover'
    ? `${sourcePrefix},scale=${aw}:${ah}:force_original_aspect_ratio=increase,crop=${aw}:${ah}:(in_w-out_w)*${cx.toFixed(3)}:(in_h-out_h)*${cy.toFixed(3)}[v];[1:v][v]overlay=${ax}:${ay}:shortest=1[outv]`
    : `${sourcePrefix},scale=${aw}:${ah}:force_original_aspect_ratio=decrease,pad=${aw}:${ah}:(ow-iw)/2:(oh-ih)/2:black[v];[1:v][v]overlay=${ax}:${ay}:shortest=1[outv]`

  const args = []
  if (start > 0) args.push('-ss', String(start))
  args.push('-i', source, '-loop', '1', '-i', template)

  const filterThreads = safeMode ? 1 : Math.max(1, Math.min(2, threads))
  args.push('-filter_threads', String(filterThreads), '-filter_complex_threads', String(filterThreads))
  args.push('-filter_complex', filter, '-map', '[outv]')
  if (keepAudio) args.push('-map', '0:a?')
  if (end && end > start) args.push('-t', String(end - start))

  if (encoder === 'h264_nvenc') {
    const cq = quality === 'fast' ? '29' : quality === 'quality' ? '22' : '25'
    args.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-rc', 'vbr', '-cq', cq, '-b:v', '0')
  } else {
    const crf = quality === 'fast' ? '29' : quality === 'quality' ? '21' : '24'
    const encodeThreads = safeMode ? 1 : Math.max(1, threads)
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', crf, '-threads', String(encodeThreads))
  }

  args.push('-r', '30')
  if (keepAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-af', `volume=${(volume / 100).toFixed(2)}`)
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-max_muxing_queue_size', '1024', '-shortest', '-y', output)
  return args
}

export async function renderNative(options) {
  const encoder = options.encoder || await detectEncoder(process.env.FFMPEG_ENCODER || 'auto')
  const threads = Math.max(1, Number(options.threads || process.env.FFMPEG_THREADS || 1))
  const safeMode = Boolean(options.safeMode)
  const args = buildFfmpegArgs({ ...options, encoder, threads, safeMode })
  const started = Date.now()
  const result = await runCommand('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'warning', ...args], { signal: options.signal })
  return { encoder, threads: safeMode ? 1 : threads, safeMode, elapsedMs: Date.now() - started, ...result }
}
