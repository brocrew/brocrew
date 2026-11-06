import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  utimesSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import * as format from '../src/main/plugins/state/format'
import * as machine from '../src/main/plugins/state/machine'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
const diskOf = (state: GlobalPluginState) => (state as unknown as { disk: PluginStateDisk }).disk
async function installed() {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const disk = diskOf(f.state)
  disk.load()
  return { ...f, disk }
}
it('verifies unchanged journal bytes without decoding or folding its already verified history again', async () => {
  const f = await installed()
  const decode = vi.spyOn(format, 'decodeState'),
    fold = vi.spyOn(machine, 'foldRecord')
  const before = f.disk.load(),
    after = f.disk.load()
  expect(after).toEqual(before)
  expect(decode).not.toHaveBeenCalled()
  expect(fold).not.toHaveBeenCalled()
})
it('folds only a freshly verified appended suffix, including changes from another disk owner', async () => {
  const f = await installed(),
    workspace = randomUUID()
  const receipt = f.state.emptyProjection(workspace, 'chrome')!
  f.state.recordProjection(workspace, 'chrome', receipt)
  const fold = vi.spyOn(machine, 'foldRecord')
  const after = f.disk.load()
  expect(after.projections.get(`${workspace}/chrome`)).toEqual(receipt)
  expect(fold).toHaveBeenCalledTimes(1)
  fold.mockClear()
  const other = GlobalPluginState.open({
    root: join(f.root, 'state'),
    workspaceRoots: [f.workspace],
  })
  try {
    other.recordProjection(workspace, 'chrome', null)
  } finally {
    other.close()
  }
  fold.mockClear()
  expect(f.disk.load().projections.has(`${workspace}/chrome`)).toBe(false)
  expect(fold).toHaveBeenCalledTimes(1)
})
it('does not let a caller mutate any nested cached state through returned maps or sets', async () => {
  const f = await installed(),
    original = f.disk.load()
  const detached = f.disk.load()
  detached.guards.get('chrome')!.release.version = 'fictional-mutation'
  detached.operations.values().next().value!.operation.request.consent.at = 99
  detached.usedIds.clear()
  detached.projections.clear()
  expect(f.disk.load()).toEqual(original)
})
it('does not treat same-size restored-mtime record bytes as an unchanged authority', async () => {
  const f = await installed(),
    guard = join(f.root, 'state/lifecycle-guard')
  const file = join(
    guard,
    readdirSync(guard)
      .filter((n) => /^\d{8}\.json$/.test(n))
      .sort()[0]!,
  )
  const original = readFileSync(file),
    stamp = statSync(file)
  const changed = Buffer.from(original)
  changed[changed.length - 2] = changed[changed.length - 2]! ^ 1
  writeFileSync(file, changed)
  utimesSync(file, stamp.atime, stamp.mtime)
  try {
    expect(() => f.disk.load()).toThrow()
  } finally {
    writeFileSync(file, original)
  }
  expect(f.disk.load().rootId).toBeTruthy()
})
it('revalidates a replaced historical file instead of serving a prior folded snapshot', async () => {
  const f = await installed(),
    guard = join(f.root, 'state/lifecycle-guard')
  const file = join(
    guard,
    readdirSync(guard)
      .filter((n) => /^\d{8}\.json$/.test(n))
      .sort()[0]!,
  )
  const original = readFileSync(file),
    state = f.disk.load()
  renameSync(file, file + '.saved')
  writeFileSync(file, original, { mode: 0o600 })
  unlinkSync(file + '.saved')
  const decode = vi.spyOn(format, 'decodeState')
  expect(f.disk.load()).toEqual(state)
  expect(decode).toHaveBeenCalled()
})
it('does not hide missing, populated or orphaned seals behind a warm cache', async () => {
  const f = await installed(),
    guard = join(f.root, 'state/lifecycle-guard')
  const name = readdirSync(guard).find((n) => /^\d{8}-[a-f0-9]{64}\.seal$/.test(n))!,
    file = join(guard, name)
  writeFileSync(file, 'fictional-bad-seal')
  try {
    expect(() => f.disk.load()).toThrow()
  } finally {
    writeFileSync(file, '')
  }
  expect(f.disk.load().rootId).toBeTruthy()
  const orphan = join(guard, '00004000-' + 'a'.repeat(64) + '.seal')
  writeFileSync(orphan, '', { mode: 0o600 })
  try {
    expect(() => f.disk.load()).toThrow()
  } finally {
    unlinkSync(orphan)
  }
  expect(f.disk.load().rootId).toBeTruthy()
})

it('retains every historical completed activation during reclaim after cache reuse', async () => {
  const f = await installed()
  await f.controller.uninstall(f.handle, 'chrome')
  f.disk.load()
  const folder = join(f.root, 'state/activations')
  const names = readdirSync(folder).sort()
  expect(names.length).toBeGreaterThan(1)
  f.disk.reclaim()
  expect(readdirSync(folder).sort()).toEqual(names)
})
