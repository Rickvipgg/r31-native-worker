export async function requeueStaleJobs(sb) {
  const { data, error } = await sb.rpc('requeue_stale_render_jobs')
  if (error) return { ok: false, count: 0, error }
  return { ok: true, count: Number(data || 0), error: null }
}

export async function claimRenderJobs(sb, workerId, limit) {
  const safeLimit = Math.max(1, Math.min(16, Number(limit || 1)))
  const { data, error } = await sb.rpc('claim_render_jobs', {
    p_worker_id: workerId,
    p_limit: safeLimit,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
