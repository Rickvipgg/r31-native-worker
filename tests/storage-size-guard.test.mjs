import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { runCommand, computeStorageTargetKbps, ensureStorageSafeMp4 } from '../lib/render.mjs'

test('calcula bitrate com margem para caber no limite', () => {
  const kbps = computeStorageTargetKbps({ durationSeconds: 60, maxBytes: 40 * 1024 * 1024 })
  assert.ok(kbps > 4000 && kbps < 5000, `kbps=${kbps}`)
})

test('size guard recomprime MP4 grande e mantém abaixo do limite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'r31-size-guard-'))
  const input = path.join(dir, 'big.mp4')
  try {
    await runCommand('ffmpeg', [
      '-hide_banner','-loglevel','error',
      '-f','lavfi','-i','testsrc2=size=1280x720:rate=30',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
      '-t','6',
      '-c:v','libx264','-preset','ultrafast','-crf','8',
      '-c:a','aac','-b:a','128k',
      '-y',input
    ])
    const before = await stat(input)
    assert.ok(before.size > 700 * 1024, `arquivo de teste pequeno demais: ${before.size}`)

    const maxBytes = 700 * 1024
    const result = await ensureStorageSafeMp4({ input, maxBytes, threads: 1 })
    const after = await stat(input)
    assert.equal(result.recompressed, true)
    assert.ok(after.size <= maxBytes, `final=${after.size} limite=${maxBytes}`)
    assert.ok(after.size < before.size)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
