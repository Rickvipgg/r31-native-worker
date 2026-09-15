import test from 'node:test'
import assert from 'node:assert/strict'
import { runCommand } from '../lib/render.mjs'

test('captura sinal do processo em vez de mostrar apenas código null', async () => {
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"]),
    (error) => {
      assert.equal(error.ffmpegCode, null)
      assert.equal(error.ffmpegSignal, 'SIGTERM')
      assert.match(error.message, /SIGTERM/)
      return true
    }
  )
})
