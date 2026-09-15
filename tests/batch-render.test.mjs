import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { renderNative } from '../lib/render.mjs'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out='', err=''
    cp.stdout.on('data', d => out += d)
    cp.stderr.on('data', d => err += d)
    cp.on('error', reject)
    cp.on('close', (code, signal) => code === 0 ? resolve({out,err}) : reject(new Error(`${cmd} code=${code} signal=${signal}: ${err}`)))
  })
}

test('lote de 4 renders nativos concorrentes termina sem código null', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'r31-batch-'))
  try {
    const source=path.join(dir,'source.mp4'), template=path.join(dir,'template.png')
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac','-y',source])
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=720x1280','-frames:v','1','-y',template])
    const settings={width:720,height:1280,videoY:400,videoHeight:760,cropX:50,cropY:50,fitMode:'cover',keepAudio:true,volume:100,start:0,end:null,quality:'fast'}
    const results = await Promise.all(Array.from({length:4}, (_,i) => renderNative({source,template,output:path.join(dir,`out-${i}.mp4`),settings,encoder:'libx264',threads:1})))
    assert.equal(results.length,4)
    for (let i=0;i<4;i++) assert.ok((await stat(path.join(dir,`out-${i}.mp4`))).size > 1000)
  } finally { await rm(dir,{recursive:true,force:true}) }
})
