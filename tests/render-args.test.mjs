import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFfmpegArgs } from '../lib/render.mjs'

const settings = { width:720,height:1280,videoY:400,videoHeight:760,cropX:50,cropY:50,fitMode:'cover',keepAudio:true,volume:100,start:0,end:null,quality:'recommended' }

test('CPU native uses libx264 ultrafast and 720x1280 composition', () => {
  const args = buildFfmpegArgs({ source:'in.mp4', template:'template.png', output:'out.mp4', settings, encoder:'libx264' })
  const joined = args.join(' ')
  assert.match(joined, /-c:v libx264/)
  assert.match(joined, /-preset ultrafast/)
  assert.match(joined, /scale=652:760/)
  assert.match(joined, /overlay=34:400/)
  assert.match(joined, /-c:a aac/)
})

test('GPU mode switches to NVENC p1', () => {
  const args = buildFfmpegArgs({ source:'in.mp4', template:'template.png', output:'out.mp4', settings, encoder:'h264_nvenc' })
  const joined = args.join(' ')
  assert.match(joined, /-c:v h264_nvenc/)
  assert.match(joined, /-preset p1/)
})
