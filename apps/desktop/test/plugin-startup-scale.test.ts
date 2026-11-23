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
import { observePluginStartup } from '../src/main/plugins/state/observe-startup'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

it('measures synchronous and asynchronous observation at the saved trace open-count scale using fictional state', async () => {
  const f = await fixture()
  const disk = (f.state as unknown as { disk: PluginStateDisk }).disk
  const head = disk.load(),
    records = 1843
  appendProjectionHistory(f.root, head, randomUUID(), records - head.sequence - 1, null)
  const root = join(f.root, 'state'),
    guard = join(root, 'lifecycle-guard')
  expect(fs.readdirSync(guard).filter((name) => name.endsWith('.json'))).toHaveLength(records)
  const options = { root, workspaceRoots: [f.workspace] }
  const bytes = fs
    .readdirSync(guard)
    .reduce((n, name) => n + fs.statSync(join(guard, name)).size, 0)
  const sync = [
    fs.openSync,
    fs.lstatSync,
    fs.fstatSync,
    fs.readSync,
    fs.closeSync,
    fs.readdirSync,
  ].map((fn) => vi.mocked(fn))
  const results = []
  for (const mode of ['sync', 'async'] as const) {
    for (const fn of sync) fn.mockClear()
    vi.mocked(asyncFs.open).mockClear()
    let last = performance.now(),
      maxGapMs = 0,
      ticks = 0
    const tick = () => {
      const now = performance.now()
      maxGapMs = Math.max(maxGapMs, now - last)
      last = now
      ticks++
    }
    const timer = setInterval(tick, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    last = performance.now()
    maxGapMs = 0
    ticks = 0
    const began = last
    let result
    try {
      result =
        mode === 'sync'
          ? GlobalPluginState.observeInstallations(options)
          : await observePluginStartup(options)
      maxGapMs = Math.max(maxGapMs, performance.now() - last)
    } finally {
      clearInterval(timer)
    }
    const elapsedMs = performance.now() - began
    expect(result).toEqual({ installed: [], pending: null })
    const syncOpens = vi
      .mocked(fs.openSync)
      .mock.calls.filter(([path]) => dirname(String(path)) === guard).length
    const asyncOpens = vi
      .mocked(asyncFs.open)
      .mock.calls.filter(([path]) => dirname(String(path)) === guard).length
    if (mode === 'sync') expect(syncOpens).toBe(records * 2)
    else {
      expect(asyncOpens).toBe(records * 2)
      expect(ticks).toBeGreaterThan(0)
      for (const fn of sync) expect(fn).not.toHaveBeenCalled()
    }
    results.push({ mode, records, bytes, syncOpens, asyncOpens, elapsedMs, maxGapMs, ticks })
  }
  console.info(
    'STARTUP_SCALE ' +
      JSON.stringify({ platform: process.platform, node: process.version, results }),
  )
}, 60_000)
