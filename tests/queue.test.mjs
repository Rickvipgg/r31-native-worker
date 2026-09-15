import test from 'node:test'
import assert from 'node:assert/strict'
import { claimRenderJobs, requeueStaleJobs } from '../lib/queue.mjs'

// Imita o PostgREST builder real do Supabase: é thenable, mas NÃO possui .catch().
function thenable(value) {
  return { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } }
}

test('requeueStaleJobs aceita Supabase RPC thenable sem .catch()', async () => {
  const sb = { rpc(name) {
    assert.equal(name, 'requeue_stale_render_jobs')
    const q = thenable({ data: 2, error: null })
    assert.equal(typeof q.catch, 'undefined')
    return q
  }}
  assert.deepEqual(await requeueStaleJobs(sb), { ok: true, count: 2, error: null })
})

test('requeueStaleJobs não derruba worker quando RPC retorna erro', async () => {
  const error = new Error('rpc indisponível')
  const sb = { rpc: () => thenable({ data: null, error }) }
  const result = await requeueStaleJobs(sb)
  assert.equal(result.ok, false)
  assert.equal(result.error, error)
})

test('claimRenderJobs repassa worker e limite e retorna jobs', async () => {
  const jobs = [{ id: '1' }, { id: '2' }]
  const sb = { rpc(name, args) {
    assert.equal(name, 'claim_render_jobs')
    assert.deepEqual(args, { p_worker_id: 'worker-a', p_limit: 4 })
    return thenable({ data: jobs, error: null })
  }}
  assert.deepEqual(await claimRenderJobs(sb, 'worker-a', 4), jobs)
})

test('claimRenderJobs lança erro de RPC', async () => {
  const error = new Error('db error')
  const sb = { rpc: () => thenable({ data: null, error }) }
  await assert.rejects(() => claimRenderJobs(sb, 'w', 4), /db error/)
})
