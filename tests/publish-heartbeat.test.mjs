import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { makePublishSignature, triggerPublishQueue } from '../lib/publish-heartbeat.mjs'

test('heartbeat HMAC usa o mesmo payload esperado pelo backend', () => {
  const secret = 'sb_secret_test_123'
  const ts = '1789560000000'
  const expected = crypto.createHmac('sha256', secret).update(`r31-publish:${ts}`).digest('hex')
  assert.equal(makePublishSignature(secret, ts), expected)
})

test('triggerPublishQueue envia headers assinados e lê processed', async () => {
  let seen
  const fetchFn = async (url, init) => {
    seen = { url, init }
    return new Response(JSON.stringify({ ok: true, processed: 2, instagram: [{}], facebook: [{}] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await triggerPublishQueue({ url: 'https://example.test/api/cron/publish', secret: 'abc', fetchFn, timeoutMs: 1000 })
  assert.equal(result.processed, 2)
  assert.equal(seen.url, 'https://example.test/api/cron/publish')
  assert.ok(seen.init.headers['x-r31-worker-ts'])
  assert.match(seen.init.headers['x-r31-worker-signature'], /^[a-f0-9]{64}$/)
})

test('triggerPublishQueue trata erro HTTP sem derrubar o worker', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ error: 'teste' }), { status: 401 })
  await assert.rejects(() => triggerPublishQueue({ url: 'https://example.test', secret: 'abc', fetchFn, timeoutMs: 1000 }), /401: teste/)
})
