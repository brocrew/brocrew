import './plugin-startup-fixtures'
import fs from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import {
  appendProjectionHistory,
  cleanupLifecycleFixtures,
  fixture,
  journalHead,
  reopenLifecycleFixture,
  stateFile,
} from './plugin-lifecycle-fixtures'
import {
  observeInstalledPackage,
  observeInstallations,
} from '../src/main/plugins/state/observe-committed'
import {
  observeInstalledPackage as journalInstalledPackage,
  observeInstallations as journalInstallations,
} from './fixtures/plugin-journal-parent/observe-committed'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

async function timed<T>(read: () => Promise<T> | T) {
  const began = performance.now()
  let last = began,
    maxGapMs = 0
  const timer = setInterval(() => {
    const now = performance.now()
    maxGapMs = Math.max(maxGapMs, now - last)
    last = now
  }, 1)
  try {
    const result = await read()
    maxGapMs = Math.max(maxGapMs, performance.now() - last)
    return { result, elapsedMs: performance.now() - began, maxGapMs }
  } finally {
    clearInterval(timer)
  }
}

// A fictional journal about as long as the longest one seen in use: 1,843 records, 3,686 files.
it('migrates a long journal once, after which display reads one small file without sync calls', async () => {
  const f = await fixture({}, 'chrome', {}, { journal: true })
  await f.controller.install(f.handle, 'chrome')
  const head = journalHead(f),
    records = 1843
  f.state.close()
  appendProjectionHistory(f.root, head, randomUUID(), records - head.sequence - 1, null)
  const root = join(f.root, 'state'),
    guard = join(root, 'lifecycle-guard')
  expect(fs.readdirSync(guard)).toHaveLength(records * 2)
  const installed = {
    version: f.pkg.release.version,
    archiveSha256: f.pkg.release.archive.sha256,
    manifestSha256: f.pkg.release.manifestSha256,
  }
  const before = {
    installations: await timed(() => journalInstallations({ root, workspaceRoots: [f.workspace] })),
    package: await timed(() => journalInstalledPackage({ root, workspaceRoots: [] }, 'chrome')),
  }
  expect(before.installations.result).toEqual({ installed: ['chrome'], pending: null })
  expect(before.package.result).toEqual(installed)
  const migration = await timed(() => reopenLifecycleFixture(f))
  expect(migration.result.inspect().guards.map((one) => [one.pluginId, one.phase])).toEqual([
    ['chrome', 'active'],
  ])
  expect(fs.readdirSync(guard)).toHaveLength(records * 2)
  const sync = [
    fs.openSync,
    fs.lstatSync,
    fs.fstatSync,
    fs.readSync,
    fs.closeSync,
    fs.readdirSync,
    fs.readFileSync,
  ].map((fn) => vi.mocked(fn))
  for (const fn of sync) fn.mockClear()
  const after = {
    installations: await timed(() => observeInstallations({ root, workspaceRoots: [f.workspace] })),
    package: await timed(() => observeInstalledPackage({ root, workspaceRoots: [] }, 'chrome')),
  }
  expect(after.installations.result).toEqual({ installed: ['chrome'], pending: null })
  expect(after.package.result).toEqual(installed)
  for (const fn of sync) expect(fn).not.toHaveBeenCalled()
  const ms = (one: { elapsedMs: number; maxGapMs: number }) => ({
    elapsedMs: Math.round(one.elapsedMs * 10) / 10,
    maxGapMs: Math.round(one.maxGapMs * 10) / 10,
  })
  console.info(
    'JOURNAL_READ_SCALE ' +
      JSON.stringify({
        platform: process.platform,
        node: process.version,
        records,
        stateBytes: fs.statSync(stateFile(root)!).size,
        before: { installations: ms(before.installations), package: ms(before.package) },
        migration: ms(migration),
        after: { installations: ms(after.installations), package: ms(after.package) },
      }),
  )
}, 120_000)
