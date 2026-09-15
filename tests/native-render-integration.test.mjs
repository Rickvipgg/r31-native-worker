import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { renderNative } from '../lib/render.mjs'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out='', err=''
    cp.stdout.on('data', d => out += d)
    cp.stderr.on('data', d => err += d)
    cp.on('error', reject)
    cp.on('close', code => code === 0 ? resolve({out,err}) : reject(new Error(`${cmd} ${code}: ${err}`)))
  })
}

test('FFmpeg nativo gera MP4 H264 720x1280 + AAC', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'r31-test-'))
  try {
    const source=path.join(dir,'source.mp4'), template=path.join(dir,'template.png'), output=path.join(dir,'out.mp4')
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',source])
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=720x1280','-frames:v','1','-y',template])
    const settings={width:720,height:1280,videoY:400,videoHeight:760,cropX:50,cropY:50,fitMode:'cover',keepAudio:true,volume:100,start:0,end:null,quality:'fast'}
    const result=await renderNative({source,template,output,settings,encoder:'libx264'})
    assert.ok(result.elapsedMs > 0)
    const probe=await run('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height,sample_rate','-of','json',output])
    const parsed=JSON.parse(probe.out)
    const video=parsed.streams.find(s=>s.codec_type==='video')
    const audio=parsed.streams.find(s=>s.codec_type==='audio')
    assert.equal(video.codec_name,'h264')
    assert.equal(video.width,720)
    assert.equal(video.height,1280)
    assert.equal(audio.codec_name,'aac')
    assert.equal(audio.sample_rate,'48000')
  } finally { await rm(dir,{recursive:true,force:true}) }
})
