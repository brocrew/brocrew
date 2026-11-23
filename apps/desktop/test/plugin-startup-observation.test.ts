import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prepareFirst } from './plugin-startup-fixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { observePluginStartup } from '../src/main/plugins/state/observe-startup'
import { GlobalPluginState } from '../src/main/plugins/state/store'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
const options = (f: Awaited<ReturnType<typeof fixture>>) => ({
  root: join(f.root, 'state'),
  workspaceRoots: [f.workspace],
})

it('matches committed installed, pending and empty evidence without touching the writer', async () => {
  const f = await fixture(),
    opts = options(f)
  for (const installed of [false, true, false]) {
    expect(await observePluginStartup(opts)).toEqual(GlobalPluginState.observeInstallations(opts))
    expect(await observePluginStartup(opts)).toEqual({
      installed: installed ? ['chrome'] : [],
      pending: null,
    })
    if (!installed) await f.controller.install(f.handle, 'chrome')
    else await f.controller.uninstall(f.handle, 'chrome')
  }
  const pending = await fixture(),
    pendingOptions = options(pending)
  prepareFirst(pending)
  expect(await observePluginStartup(pendingOptions)).toEqual({ installed: [], pending: 'chrome' })
  expect(await observePluginStartup(pendingOptions)).toEqual(
    GlobalPluginState.observeInstallations(pendingOptions),
  )
})

it.each(['missing seal', 'changed seal', 'truncated record', 'record gap', 'unexpected entry'])(
  'returns unknown for %s',
  async (mode) => {
    const f = await fixture(),
      opts = options(f),
      guard = join(opts.root, 'lifecycle-guard')
    const seal = fs.readdirSync(guard).find((name) => name.endsWith('.seal'))!
    if (mode === 'missing seal') fs.unlinkSync(join(guard, seal))
    if (mode === 'changed seal') fs.writeFileSync(join(guard, seal), 'partial')
    if (mode === 'truncated record') fs.writeFileSync(join(guard, '00000000.json'), '{')
    if (mode === 'record gap')
      fs.renameSync(join(guard, '00000000.json'), join(guard, '00000001.json'))
    if (mode === 'unexpected entry') fs.writeFileSync(join(guard, 'unexpected'), '')
    expect(await observePluginStartup(opts)).toBeNull()
    expect(() => GlobalPluginState.observeInstallations(opts)).toThrow()
  },
)

it('returns unknown for unreadable data and closes every directory already opened', async () => {
  const f = await fixture(),
    opts = options(f),
    native = vi.mocked(asyncFs.open).getMockImplementation()!
  const closes: ReturnType<typeof vi.spyOn>[] = []
  vi.mocked(asyncFs.open).mockImplementation(async (...args) => {
    if (dirname(String(args[0])) === join(opts.root, 'lifecycle-guard'))
      throw Object.assign(new Error('fictional unreadable'), { code: 'EACCES' })
    const handle = await native(...args)
    closes.push(vi.spyOn(handle, 'close'))
    return handle
  })
  try {
    expect(await observePluginStartup(opts)).toBeNull()
    expect(closes.length).toBe(5)
    for (const close of closes) expect(close).toHaveBeenCalledOnce()
  } finally {
    vi.mocked(asyncFs.open).mockImplementation(native)
  }
})

it('returns unknown if the writer publishes during the unlocked observation', async () => {
  const f = await fixture(),
    opts = options(f),
    native = vi.mocked(asyncFs.open).getMockImplementation()!
  let published = false
  vi.mocked(asyncFs.open).mockImplementation(async (...args) => {
    const handle = await native(...args)
    if (!published && dirname(String(args[0])) === join(opts.root, 'lifecycle-guard')) {
      published = true
      f.state.requireUpdateReader()
    }
    return handle
  })
  try {
    expect(await observePluginStartup(opts)).toBeNull()
  } finally {
    vi.mocked(asyncFs.open).mockImplementation(native)
  }
  expect(published).toBe(true)
  expect(await observePluginStartup(opts)).toEqual({ installed: [], pending: null })
})

it('may skip stable complete empty state under an idle held SQLite fence', async () => {
  const f = await fixture(),
    opts = options(f)
  const db = new Database(join(opts.root, 'writer-lock.sqlite'), { timeout: 0 })
  db.exec('BEGIN EXCLUSIVE')
  try {
    expect(() => GlobalPluginState.observeInstallations(opts)).toThrow()
    expect(await observePluginStartup(opts)).toEqual({ installed: [], pending: null })
  } finally {
    db.exec('ROLLBACK')
    db.close()
  }
})

it('retains a complete journal with a private crash-stage hardlink', async () => {
  const f = await fixture(),
    opts = options(f),
    guard = join(opts.root, 'lifecycle-guard')
  fs.linkSync(join(guard, '00000000.json'), join(guard, '.stage-' + randomUUID()))
  expect(await observePluginStartup(opts)).toEqual(GlobalPluginState.observeInstallations(opts))
})

it('returns unknown when first pending state publishes after the final enumeration but before its stats', async () => {
  const f = await fixture(),
    opts = options(f),
    native = vi.mocked(asyncFs.readdir).getMockImplementation()!
  let listings = 0
  vi.mocked(asyncFs.readdir).mockImplementation(async (...args) => {
    const names = await native(...args)
    if (String(args[0]) === join(opts.root, 'lifecycle-guard') && ++listings === 2) prepareFirst(f)
    return names
  })
  try {
    expect(await observePluginStartup(opts)).toBeNull()
  } finally {
    vi.mocked(asyncFs.readdir).mockImplementation(native)
  }
  expect(listings).toBe(2)
  expect(await observePluginStartup(opts)).toEqual({ installed: [], pending: 'chrome' })
})
