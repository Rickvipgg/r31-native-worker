import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'

export function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (spawnError) => {
      const error = new Error(`${cmd} não iniciou: ${spawnError.message}`)
      error.cause = spawnError
      error.ffmpegCode = null
      error.ffmpegSignal = null
      error.ffmpegInterrupted = true
      error.stderr = stderr
      fail(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      if (code === 0) {
        settled = true
        return resolve({ stdout, stderr, code, signal })
      }

      const tail = stderr.slice(-16000)
      const interrupted = code === null || Boolean(signal)
      const why = signal
        ? `${cmd} foi interrompido por sinal ${signal} (código ${code ?? 'null'})`
        : code === null
          ? `${cmd} foi interrompido antes de retornar código de saída (código null)`
          : `${cmd} saiu com código ${code}`
      const hint = interrupted
        ? '\nProcesso interrompido pelo container/sistema. O worker reduzirá o uso de recursos e tentará novamente.'
        : ''
      const error = new Error(`${why}${hint}${tail ? `\n${tail}` : ''}`)
      error.ffmpegCode = code
      error.ffmpegSignal = signal
      error.ffmpegInterrupted = interrupted
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

export async function probeVideo(source) {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,duration',
      '-show_entries', 'format=duration,size,format_name',
      '-of', 'json',
      source,
    ])
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
  const result = await runCommand('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'warning', ...args])
  return { encoder, threads: safeMode ? 1 : threads, safeMode, elapsedMs: Date.now() - started, ...result }
}
