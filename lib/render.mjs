import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} saiu com código ${code}\n${stderr.slice(-8000)}`))
    })
  })
}

export async function detectEncoder(preference = 'auto') {
  if (preference && preference !== 'auto') return preference
  try {
    await access('/dev/nvidia0')
    const { stdout, stderr } = await run('ffmpeg', ['-hide_banner', '-encoders'])
    if (`${stdout}\n${stderr}`.includes('h264_nvenc')) return 'h264_nvenc'
  } catch {}
  return 'libx264'
}

export function buildFfmpegArgs({ source, template, output, settings, encoder = 'libx264' }) {
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

  const filter = fitMode === 'cover'
    ? `[0:v]scale=${aw}:${ah}:force_original_aspect_ratio=increase,crop=${aw}:${ah}:(in_w-out_w)*${cx.toFixed(3)}:(in_h-out_h)*${cy.toFixed(3)}[v];[1:v][v]overlay=${ax}:${ay}:shortest=1[outv]`
    : `[0:v]scale=${aw}:${ah}:force_original_aspect_ratio=decrease,pad=${aw}:${ah}:(ow-iw)/2:(oh-ih)/2:black[v];[1:v][v]overlay=${ax}:${ay}:shortest=1[outv]`

  const args = []
  if (start > 0) args.push('-ss', String(start))
  args.push('-i', source, '-loop', '1', '-i', template, '-filter_complex', filter, '-map', '[outv]')
  if (keepAudio) args.push('-map', '0:a?')
  if (end && end > start) args.push('-t', String(end - start))

  if (encoder === 'h264_nvenc') {
    const cq = quality === 'fast' ? '29' : quality === 'quality' ? '22' : '25'
    args.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-rc', 'vbr', '-cq', cq, '-b:v', '0')
  } else {
    const crf = quality === 'fast' ? '29' : quality === 'quality' ? '21' : '24'
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', crf, '-threads', '0')
  }

  args.push('-r', '30')
  if (keepAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-af', `volume=${(volume / 100).toFixed(2)}`)
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', '-y', output)
  return args
}

export async function renderNative(options) {
  const encoder = options.encoder || await detectEncoder(process.env.FFMPEG_ENCODER || 'auto')
  const args = buildFfmpegArgs({ ...options, encoder })
  const started = Date.now()
  const result = await run('ffmpeg', ['-hide_banner', '-loglevel', 'warning', ...args])
  return { encoder, elapsedMs: Date.now() - started, ...result }
}
