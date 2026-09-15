import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('worker não chama .catch diretamente em sb.rpc()', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /sb\.rpc\([^\n]*\)\.catch\s*\(/)
})

test('Docker usa Node 22 e instala FFmpeg', async () => {
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
  assert.match(docker, /FROM node:22-/)
  assert.match(docker, /ffmpeg/)
})

test('worker trata SIGTERM com fechamento do servidor', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
  assert.match(source, /async function shutdown\(/)
  assert.match(source, /server\.close\(/)
  assert.match(source, /process\.on\('SIGTERM'/)
})
