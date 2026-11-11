import { afterEach, expect, it, vi } from 'vitest'
import type { AdoptionReport, RuntimeBridge } from '../src/shared/runtime-ipc'
import { useHomeScan } from '../src/renderer/src/lib/home-scan'

const report: AdoptionReport = {
  found: 1,
  adopted: 1,
  alreadyKnown: 0,
  imported: 0,
  descentsLearned: 0,
  named: 0,
  skipped: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('captures adoption once, preserves its receiver, and never reads the global bridge', async () => {
  vi.stubGlobal('window', {
    get api() {
      throw new Error('global bridge read')
    },
  })
  const adopt = vi.fn(function (this: typeof client) {
    expect(this).toBe(client)
    return Promise.resolve(report)
  })
  const read = vi.fn(() => adopt)
  const client = {
    get adoptSessions() {
      return read()
    },
  }
  const scan = useHomeScan(client)
  expect(read).toHaveBeenCalledTimes(1)
  expect(adopt).not.toHaveBeenCalled()
  read.mockReturnValue(
    vi.fn(() => {
      throw new Error('replacement must not be read')
    }),
  )
  await expect(scan.scan()).resolves.toEqual({ report })
  await expect(scan.scan()).resolves.toEqual({ report })
  expect(read).toHaveBeenCalledTimes(1)
  expect(adopt).toHaveBeenCalledTimes(2)
})

it('coalesces a shared client while each surface keeps its own busy follow-up and report', async () => {
  const adoption = deferred<AdoptionReport>()
  const followup = deferred<void>()
  const client = { adoptSessions: vi.fn(() => adoption.promise) }
  const first = useHomeScan(client)
  const second = useHomeScan(client)
  const after = vi.fn(() => followup.promise)
  const one = first.scan(after)
  const two = second.scan()
  expect(client.adoptSessions).toHaveBeenCalledTimes(1)
  expect(first.scanning.value).toBe(true)
  expect(second.scanning.value).toBe(true)
  await expect(first.scan(after)).resolves.toBeNull()
  const now = vi.spyOn(Date, 'now').mockReturnValue(1234)
  adoption.resolve(report)
  await expect(two).resolves.toEqual({ report })
  expect(first.lastScan.value).toEqual(report)
  expect(first.scannedAt.value).toBe(1234)
  expect(second.scannedAt.value).toBe(1234)
  expect(first.scanning.value).toBe(true)
  expect(second.scanning.value).toBe(false)
  expect(after).toHaveBeenCalledTimes(1)
  followup.resolve()
  await expect(one).resolves.toEqual({ report })
  expect(first.scanning.value).toBe(false)
  now.mockRestore()
})

it('keeps distinct clients independent even when they share a method', async () => {
  const a = deferred<AdoptionReport>()
  const b = deferred<AdoptionReport>()
  function adoptSessions(this: { pending: Promise<AdoptionReport> }) {
    return this.pending
  }
  const firstClient = { pending: a.promise, adoptSessions }
  const secondClient = { pending: b.promise, adoptSessions }
  const first = useHomeScan(firstClient)
  const second = useHomeScan(secondClient)
  const one = first.scan()
  const two = second.scan()
  const other = { ...report, adopted: 0, alreadyKnown: 1 }
  b.resolve(other)
  await expect(two).resolves.toEqual({ report: other })
  expect(first.lastScan.value).toBeNull()
  expect(first.scanning.value).toBe(true)
  a.resolve(report)
  await expect(one).resolves.toEqual({ report })
})

it('shares rejection, clears busy state, and permits a later attempt', async () => {
  const pending = deferred<AdoptionReport>()
  const client = { adoptSessions: vi.fn(() => pending.promise) }
  const first = useHomeScan(client)
  const second = useHomeScan(client)
  const after = vi.fn()
  const one = first.scan(after)
  const two = second.scan()
  pending.reject(new Error('fictional adoption failed'))
  await expect(one).resolves.toEqual({ error: 'fictional adoption failed' })
  await expect(two).resolves.toEqual({ error: 'fictional adoption failed' })
  expect(after).not.toHaveBeenCalled()
  for (const scan of [first, second]) {
    expect(scan.scanning.value).toBe(false)
    expect(scan.lastScan.value).toBeNull()
    expect(scan.scannedAt.value).toBeNull()
  }
  client.adoptSessions.mockReturnValue(Promise.resolve(report))
  await expect(second.scan()).resolves.toEqual({ report })
  expect(client.adoptSessions).toHaveBeenCalledTimes(2)
  const scannedAt = second.scannedAt.value
  client.adoptSessions.mockRejectedValueOnce(new Error('fictional later failure'))
  await expect(second.scan()).resolves.toEqual({ error: 'fictional later failure' })
  expect(second.lastScan.value).toEqual(report)
  expect(second.scannedAt.value).toBe(scannedAt)
  expect(second.scanning.value).toBe(false)
})

it('reports synchronous and follow-up failures without losing a completed adoption', async () => {
  const client: Pick<RuntimeBridge, 'adoptSessions'> = {
    adoptSessions: vi.fn(() => {
      throw new Error('fictional synchronous failure')
    }),
  }
  const first = useHomeScan(client)
  await expect(first.scan()).resolves.toEqual({ error: 'fictional synchronous failure' })
  expect(first.scanning.value).toBe(false)
  expect(first.lastScan.value).toBeNull()
  const second = useHomeScan({ adoptSessions: () => Promise.resolve(report) })
  await expect(
    second.scan(async () => {
      throw new Error('fictional refresh failure')
    }),
  ).resolves.toEqual({ error: 'fictional refresh failure' })
  expect(second.scanning.value).toBe(false)
  expect(second.lastScan.value).toEqual(report)
  expect(second.scannedAt.value).toEqual(expect.any(Number))
})

it('keeps an absent capability absent without falling back to a global client', async () => {
  const globalAdopt = vi.fn(() => Promise.resolve(report))
  vi.stubGlobal('window', { api: { runtime: { adoptSessions: globalAdopt } } })
  const scan = useHomeScan(undefined)
  expect(await scan.scan()).toEqual({ error: 'Session adoption is unavailable' })
  expect(globalAdopt).not.toHaveBeenCalled()
  expect(scan.scanning.value).toBe(false)
  expect(scan.lastScan.value).toBeNull()
  expect(scan.scannedAt.value).toBeNull()
})

it('does not retire a newer run when an older surface finishes its follow-up', async () => {
  const firstRun = deferred<AdoptionReport>()
  const nextRun = deferred<AdoptionReport>()
  const followup = deferred<void>()
  const client = { adoptSessions: vi.fn(() => firstRun.promise) }
  const first = useHomeScan(client)
  const second = useHomeScan(client)
  const third = useHomeScan(client)
  const one = first.scan(() => followup.promise)
  const two = second.scan()
  firstRun.resolve(report)
  await two
  client.adoptSessions.mockReturnValue(nextRun.promise)
  const newer = second.scan()
  followup.resolve()
  await one
  const join = third.scan()
  expect(client.adoptSessions).toHaveBeenCalledTimes(2)
  nextRun.resolve(report)
  await expect(newer).resolves.toEqual({ report })
  await expect(join).resolves.toEqual({ report })
})
