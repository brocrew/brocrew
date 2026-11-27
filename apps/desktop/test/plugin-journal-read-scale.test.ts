import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import {
  appendProjectionHistory,
  cleanupLifecycleFixtures,
  fixture,
} from './plugin-lifecycle-fixtures'
import {
  observeInstalledPackage,
  observeInstallations,
} from '../src/main/plugins/state/observe-committed'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

// A fictional journal about as long as the longest one seen in use: 1,843 records, 3,686 files.
it('reads a long journal without synchronous file calls while timers keep running', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const disk = (f.state as unknown as { disk: PluginStateDisk }).disk
  const head = disk.load(),
    records = 1843
  appendProjectionHistory(f.root, head, randomUUID(), records - head.sequence - 1, null)
  const root = join(f.root, 'state'),
    guard = join(root, 'lifecycle-guard')
  expect(fs.readdirSync(guard)).toHaveLength(records * 2)
  const sync = [
    fs.openSync,
    fs.lstatSync,
    fs.fstatSync,
    fs.readSync,
    fs.closeSync,
    fs.readdirSync,
  ].map((fn) => vi.mocked(fn))
  const reads = [
    {
      name: 'installations',
      read: () => observeInstallations({ root, workspaceRoots: [f.workspace] }),
      expected: { installed: ['chrome'], pending: null },
    },
    {
      name: 'installed package',
      read: () => observeInstalledPackage({ root, workspaceRoots: [] }, 'chrome'),
      expected: {
        version: f.pkg.release.version,
        archiveSha256: f.pkg.release.archive.sha256,
        manifestSha256: f.pkg.release.manifestSha256,
      },
    },
  ]
  const results = []
  for (const { name, read, expected } of reads) {
    for (const fn of sync) fn.mockClear()
    vi.mocked(asyncFs.open).mockClear()
    const began = performance.now()
    let last = began,
      maxGapMs = 0,
      ticks = 0
    const timer = setInterval(() => {
      const now = performance.now()
      maxGapMs = Math.max(maxGapMs, now - last)
      last = now
      ticks++
    }, 1)
    let result
    try {
      result = await read()
      maxGapMs = Math.max(maxGapMs, performance.now() - last)
    } finally {
      clearInterval(timer)
    }
    expect(result).toEqual(expected)
    const opens = vi
      .mocked(asyncFs.open)
      .mock.calls.filter(([path]) => dirname(String(path)) === guard).length
    expect(opens).toBe(records * 2)
    const elapsedMs = performance.now() - began
    expect(ticks).toBeGreaterThan(0)
    // A synchronous replay holds the thread for the whole read; this one yields throughout.
    expect(maxGapMs).toBeLessThan(elapsedMs / 4)
    for (const fn of sync) expect(fn).not.toHaveBeenCalled()
    results.push({ name, records, elapsedMs, maxGapMs, ticks })
  }
  console.info(
    'JOURNAL_READ_SCALE ' +
      JSON.stringify({ platform: process.platform, node: process.version, results }),
  )
}, 60_000)
