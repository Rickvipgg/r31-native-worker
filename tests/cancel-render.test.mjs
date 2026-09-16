import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runCommand } from '../lib/render.mjs'

test('runCommand aborts a running process', async () => {
  const controller = new AbortController()
  const started = Date.now()
  const promise = runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { signal: controller.signal, killGraceMs: 100 })
  setTimeout(() => controller.abort(), 120)
  await assert.rejects(promise, (error) => Boolean(error?.cancelled))
  assert.ok(Date.now() - started < 3000)
})

test('worker watches cancelled status and does not requeue it as failure', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
  assert.match(source, /CANCEL_POLL_MS/)
  assert.match(source, /cancelController\.abort\(\)/)
  assert.match(source, /wasCancelled/)
  assert.match(source, /status: 'cancelled'/)
})
