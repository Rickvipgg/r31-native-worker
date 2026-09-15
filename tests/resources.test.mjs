import test from 'node:test'
import assert from 'node:assert/strict'
import { computeWorkerLimits, memoryPressure } from '../lib/resources.mjs'

test('512 MB limita render a 1 job para evitar OOM', () => {
  const x = computeWorkerLimits({ requestedConcurrency: 4, cpuCount: 4, memoryMb: 512 })
  assert.equal(x.concurrency, 1)
  assert.equal(x.threads, 3)
})

test('2 GB e 4 CPUs permitem 4 jobs, 1 thread por job', () => {
  const x = computeWorkerLimits({ requestedConcurrency: 4, cpuCount: 4, memoryMb: 2048 })
  assert.equal(x.concurrency, 4)
  assert.equal(x.threads, 1)
})

test('1 GB e 4 CPUs reduz automaticamente para 2 jobs', () => {
  const x = computeWorkerLimits({ requestedConcurrency: 4, cpuCount: 4, memoryMb: 1024 })
  assert.equal(x.concurrency, 2)
  assert.equal(x.threads, 2)
})


test('memoryPressure marca uso acima de 82% como alto', () => {
  const p = memoryPressure({ usageMb: 900, limitMb: 1024, reserveMb: 256 })
  assert.equal(p.high, true)
  assert.equal(p.critical, false)
})

test('memoryPressure marca uso acima de 90% como crítico', () => {
  const p = memoryPressure({ usageMb: 950, limitMb: 1024, reserveMb: 256 })
  assert.equal(p.critical, true)
})
