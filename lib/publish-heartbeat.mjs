import crypto from 'node:crypto'

export function makePublishSignature(secret, timestamp) {
  if (!secret) throw new Error('SUPABASE_SECRET_KEY ausente para assinar heartbeat')
  return crypto.createHmac('sha256', secret).update(`r31-publish:${timestamp}`).digest('hex')
}

export async function triggerPublishQueue({ url, secret, fetchFn = fetch, timeoutMs = 55_000 }) {
  const timestamp = String(Date.now())
  const signature = makePublishSignature(secret, timestamp)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'x-r31-worker-ts': timestamp,
        'x-r31-worker-signature': signature,
        'user-agent': 'r31-native-worker/publisher-heartbeat',
      },
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 1000) } }
    if (!response.ok) {
      const detail = body?.error || body?.raw || `HTTP ${response.status}`
      throw new Error(`Publisher heartbeat ${response.status}: ${detail}`)
    }
    return body || { ok: true }
  } finally {
    clearTimeout(timer)
  }
}
