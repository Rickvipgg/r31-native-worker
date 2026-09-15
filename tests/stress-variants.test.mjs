import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { probeVideo, renderNative, runCommand } from '../lib/render.mjs'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    cp.stdout.on('data', d => out += d)
    cp.stderr.on('data', d => err += d)
    cp.on('error', reject)
    cp.on('close', (code, signal) => code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} code=${code} signal=${signal}: ${err}`)))
  })
}

const settings = { width:720,height:1280,videoY:400,videoHeight:760,cropX:50,cropY:50,fitMode:'cover',keepAudio:true,volume:100,start:0,end:null,quality:'fast' }

test('fontes 60fps, vertical, horizontal e sem áudio renderizam para MP4 estável', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'r31-variants-'))
  try {
    const template = path.join(dir, 'template.png')
    await run('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=720x1280','-frames:v','1','-y',template])

    const sources = [
      ['v60.mp4', ['-f','lavfi','-i','testsrc2=size=720x1280:rate=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac']],
      ['wide.mp4', ['-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-f','lavfi','-i','sine=frequency=550:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac']],
      ['silent.mp4', ['-f','lavfi','-i','testsrc2=size=1080x1920:rate=30','-t','2','-c:v','libx264','-preset','ultrafast','-threads','1']],
    ]

    for (const [name, args] of sources) await run('ffmpeg', ['-hide_banner','-loglevel','error', ...args, '-y', path.join(dir, name)])

    const outputs = await Promise.all(sources.map(async ([name], i) => {
      const source = path.join(dir, name)
      const probe = await probeVideo(source)
      assert.equal(probe.ok, true)
      const output = path.join(dir, `out-${i}.mp4`)
      await renderNative({ source, template, output, settings, encoder:'libx264', threads:1, safeMode:i === 2 })
      return output
    }))

    for (const output of outputs) assert.ok((await stat(output)).size > 1000)
  } finally {
    await rm(dir, { recursive:true, force:true })
  }
})

test('SIGKILL é classificado como interrupção recuperável', async () => {
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', "process.kill(process.pid, 'SIGKILL')"]),
    (error) => {
      assert.equal(error.ffmpegCode, null)
      assert.equal(error.ffmpegSignal, 'SIGKILL')
      assert.equal(error.ffmpegInterrupted, true)
      return true
    }
  )
})
