import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { openNotThroughALink } from '@brobot2/runtime/provider-home'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const counted = {
    openSync: vi.fn(actual.openSync),
    closeSync: vi.fn(actual.closeSync),
    lstatSync: vi.fn(actual.lstatSync),
    fstatSync: vi.fn(actual.fstatSync),
    readSync: vi.fn(actual.readSync),
  }
  return { ...actual, ...counted, default: { ...actual, ...counted } }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
async function installed() {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const disk = (f.state as unknown as { disk: PluginStateDisk }).disk
  const guard = join(f.root, 'state/lifecycle-guard')
  const files = fs
    .readdirSync(guard)
    .filter((name) => /^\d{8}(\.json|-[a-f0-9]{64}\.seal)$/.test(name))
  disk.load()
  return { ...f, disk, guard, files }
}
it('freshly opens and closes all journal files while eliminating only duplicate initial observations', async () => {
  const f = await installed()
  const total = f.files.reduce((sum, name) => sum + fs.statSync(join(f.guard, name)).size, 0)
  const opened = vi.mocked(fs.openSync),
    closed = vi.mocked(fs.closeSync)
  const observed = vi.mocked(fs.lstatSync),
    held = vi.mocked(fs.fstatSync),
    read = vi.mocked(fs.readSync)
  for (const spy of [opened, closed, observed, held, read]) spy.mockClear()
  f.disk.load()
  const fileOpens = opened.mock.calls.filter(([path]) =>
    f.files.some((name) => String(path) === join(f.guard, name)),
  )
  expect(fileOpens).toHaveLength(f.files.length)
  expect(closed).toHaveBeenCalledTimes(fileOpens.length)
  expect(
    read.mock.results.reduce(
      (sum, result) => sum + (result.type === 'return' ? Number(result.value) : 0),
      0,
    ),
  ).toBe(total)
  for (const name of f.files) {
    const count = observed.mock.calls.filter(
      ([path]) => String(path) === join(f.guard, name),
    ).length
    expect(count, name).toBe(process.platform === 'win32' ? 2 : 1)
  }
  const metrics = {
    kind: 'journal-read-syscalls',
    files: f.files.length,
    bytes: total,
    opens: fileOpens.length,
    closes: closed.mock.calls.length,
    lstats: observed.mock.calls.length,
    fstats: held.mock.calls.length,
    reads: read.mock.calls.length,
  }
  console.log(JSON.stringify(metrics))
  if (process.env.BROCREW_PLUGIN_DIAGNOSTIC_RECEIPT)
    fs.appendFileSync(process.env.BROCREW_PLUGIN_DIAGNOSTIC_RECEIPT, JSON.stringify(metrics) + '\n')
  for (const result of opened.mock.results)
    if (result.type === 'return') expect(() => fs.fstatSync(result.value)).toThrow()
})
it('closes transient reads after repeated read failures and recovers after fresh-open exhaustion', async () => {
  const f = await installed()
  const opened = vi.mocked(fs.openSync),
    closed = vi.mocked(fs.closeSync),
    read = vi.mocked(fs.readSync)
  for (let attempt = 0; attempt < 3; attempt++) {
    opened.mockClear()
    closed.mockClear()
    read.mockImplementationOnce(() => {
      throw Object.assign(new Error('fictional read failure'), { code: 'EIO' })
    })
    expect(() => f.disk.load()).toThrow()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledTimes(1)
    const result = opened.mock.results[0]!
    expect(result.type).toBe('return')
    expect(() => fs.fstatSync(result.value)).toThrow()
    expect(f.disk.load().rootId).toBeTruthy()
  }
  opened.mockClear()
  closed.mockClear()
  opened.mockImplementationOnce(() => {
    throw Object.assign(new Error('fictional descriptor exhaustion'), { code: 'EMFILE' })
  })
  expect(() => f.disk.load()).toThrow()
  expect(opened).toHaveBeenCalledTimes(1)
  expect(closed).not.toHaveBeenCalled()
  expect(f.disk.load().rootId).toBeTruthy()
})
for (const kind of ['record', 'seal']) {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    `matches the original fresh-open refusal after ${kind} owner-read permission is removed`,
    async () => {
      const f = await installed()
      const name = f.files.find((name) => name.endsWith(kind === 'record' ? '.json' : '.seal'))!
      const path = join(f.guard, name)
      fs.chmodSync(path, 0)
      try {
        expect(fs.lstatSync(path).isFile()).toBe(true)
        expect(() => openNotThroughALink(path, fs.constants.O_RDONLY)).toThrow()
        expect(() => f.disk.load()).toThrow()
      } finally {
        fs.chmodSync(path, 0o600)
      }
      expect(f.disk.load().rootId).toBeTruthy()
    },
  )
  it.runIf(process.platform === 'win32')(
    `matches the original fresh-open refusal after ${kind} data access is denied on Windows`,
    async () => {
      const f = await installed()
      const name = f.files.find((name) => name.endsWith(kind === 'record' ? '.json' : '.seal'))!
      const path = join(f.guard, name)
      const icacls = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe')
      execFileSync(icacls, [path, '/deny', '*S-1-1-0:(RD)', '/Q'], { windowsHide: true })
      try {
        expect(fs.lstatSync(path).isFile()).toBe(true)
        expect(() => openNotThroughALink(path, fs.constants.O_RDONLY)).toThrow()
        expect(() => f.disk.load()).toThrow()
      } finally {
        execFileSync(icacls, [path, '/remove:d', '*S-1-1-0', '/Q'], { windowsHide: true })
      }
      expect(f.disk.load().rootId).toBeTruthy()
    },
  )
}

it.runIf(process.platform === 'win32')(
  'refuses an open-to-read path replacement before reading Windows file bytes and closes the handle',
  async () => {
    const f = await installed()
    const path = join(f.guard, f.files.filter((name) => name.endsWith('.json')).sort()[0]!)
    const saved = path + '.saved',
      bytes = fs.readFileSync(path)
    const nativeOpen = vi.mocked(fs.openSync).getMockImplementation()!
    let opened: number | undefined
    vi.mocked(fs.openSync).mockImplementationOnce((file, flags, mode) => {
      opened = nativeOpen(file, flags, mode)
      fs.renameSync(path, saved)
      fs.writeFileSync(path, bytes, { mode: 0o600 })
      return opened
    })
    const read = vi.mocked(fs.readSync)
    read.mockClear()
    try {
      expect(() => f.disk.load()).toThrow()
      expect(read).not.toHaveBeenCalled()
      expect(() => fs.fstatSync(opened!)).toThrow()
    } finally {
      fs.unlinkSync(path)
      fs.renameSync(saved, path)
    }
    expect(f.disk.load().rootId).toBeTruthy()
  },
)
