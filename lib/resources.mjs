import os from 'node:os'
import { readFileSync } from 'node:fs'

function readNumber(pathname) {
  try {
    const raw = readFileSync(pathname, 'utf8').trim()
    if (!raw || raw === 'max') return null
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

export function detectMemoryLimitMb() {
  const cgroupV2 = readNumber('/sys/fs/cgroup/memory.max')
  if (cgroupV2 !== null && cgroupV2 > 0) return Math.floor(cgroupV2 / 1024 / 1024)

  const cgroupV1 = readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes')
  if (cgroupV1 !== null && cgroupV1 > 0 && cgroupV1 < 9e18) return Math.floor(cgroupV1 / 1024 / 1024)

  return Math.floor(os.totalmem() / 1024 / 1024)
}

export function detectMemoryUsageMb() {
  const cgroupV2 = readNumber('/sys/fs/cgroup/memory.current')
  if (cgroupV2 !== null) return Math.floor(cgroupV2 / 1024 / 1024)

  const cgroupV1 = readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes')
  if (cgroupV1 !== null) return Math.floor(cgroupV1 / 1024 / 1024)

  const rss = process.memoryUsage?.().rss
  return Number.isFinite(rss) ? Math.floor(rss / 1024 / 1024) : 0
}

export function memoryPressure({ usageMb = detectMemoryUsageMb(), limitMb = detectMemoryLimitMb(), reserveMb = 256 } = {}) {
  const usable = Math.max(1, limitMb - reserveMb)
  const ratio = Math.max(0, Math.min(10, (usageMb - reserveMb) / usable))
  return {
    usageMb,
    limitMb,
    ratio,
    high: usageMb >= Math.max(512, limitMb * 0.82),
    critical: usageMb >= Math.max(640, limitMb * 0.90),
  }
}

export function computeWorkerLimits({ requestedConcurrency = 4, cpuCount = os.availableParallelism?.() || os.cpus().length || 1, memoryMb = detectMemoryLimitMb(), requestedThreads = 0 } = {}) {
  const req = Math.max(1, Math.min(16, Number(requestedConcurrency || 4)))
  const cpus = Math.max(1, Number(cpuCount || 1))
  // Reserva Node/Supabase/OS e estima ~360 MB por FFmpeg 720x1280.
  // A proteção dinâmica abaixo evita novos claims quando a RAM real sobe demais.
  const reserve = 256
  const perRenderMb = 360
  const byMemory = Math.max(1, Math.floor(Math.max(perRenderMb, memoryMb - reserve) / perRenderMb))
  const byCpu = Math.max(1, cpus)
  const concurrency = Math.max(1, Math.min(req, byCpu, byMemory))
  const autoThreads = Math.max(1, Math.min(3, Math.floor(cpus / concurrency) || 1))
  const threads = requestedThreads > 0 ? Math.max(1, Math.min(8, Number(requestedThreads))) : autoThreads
  return { requestedConcurrency: req, concurrency, threads, cpuCount: cpus, memoryMb, byMemory, byCpu, reserveMb: reserve, perRenderMb }
}
