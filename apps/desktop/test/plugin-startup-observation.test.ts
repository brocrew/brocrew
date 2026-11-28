import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { prepareFirst } from './plugin-startup-fixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures, stateFile } from './plugin-lifecycle-fixtures'
import { stateFileName } from '../src/main/plugins/state/format'
import { observeInstallations } from '../src/main/plugins/state/observe-committed'

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
    expect(await observeInstallations(opts)).toEqual({
      installed: installed ? ['chrome'] : [],
      pending: null,
    })
    if (!installed) await f.controller.install(f.handle, 'chrome')
    else await f.controller.uninstall(f.handle, 'chrome')
  }
  const pending = await fixture(),
    pendingOptions = options(pending)
  prepareFirst(pending)
  expect(await observeInstallations(pendingOptions)).toEqual({ installed: [], pending: 'chrome' })
})

it.each(['missing', 'truncated', 'another format', 'unexpected field'])(
  'returns unknown for a %s state file',
  async (mode) => {
    const f = await fixture(),
      opts = options(f),
      file = stateFile(opts.root)!
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (mode === 'missing') fs.unlinkSync(file)
    if (mode === 'truncated') fs.writeFileSync(file, '{')
    if (mode === 'another format') fs.writeFileSync(file, JSON.stringify({ ...state, format: 1 }))
    if (mode === 'unexpected field')
      fs.writeFileSync(file, JSON.stringify({ ...state, history: [] }))
    expect(await observeInstallations(opts)).toBeNull()
  },
)

it('returns unknown for an unreadable state file', async () => {
  const f = await fixture(),
    opts = options(f)
  vi.mocked(asyncFs.readFile).mockRejectedValueOnce(
    Object.assign(new Error('fictional unreadable'), { code: 'EACCES' }),
  )
  expect(await observeInstallations(opts)).toBeNull()
  expect(await observeInstallations(opts)).toEqual({ installed: [], pending: null })
})

it('sees the whole state before or after a write that lands during the read, never a mix', async () => {
  const f = await fixture(),
    opts = options(f),
    native = vi.mocked(asyncFs.readFile).getMockImplementation()!
  let published = false
  vi.mocked(asyncFs.readFile).mockImplementation(async (...args) => {
    const bytes = await native(...args)
    if (!published) {
      published = true
      prepareFirst(f)
    }
    return bytes
  })
  try {
    expect(await observeInstallations(opts)).toEqual({ installed: [], pending: null })
  } finally {
    vi.mocked(asyncFs.readFile).mockImplementation(native)
  }
  expect(published).toBe(true)
  expect(await observeInstallations(opts)).toEqual({ installed: [], pending: 'chrome' })
})

it('reads under an idle held SQLite fence, which it never takes', async () => {
  const f = await fixture(),
    opts = options(f)
  const db = new Database(join(opts.root, 'writer-lock.sqlite'), { timeout: 0 })
  db.exec('BEGIN EXCLUSIVE')
  try {
    expect(await observeInstallations(opts)).toEqual({ installed: [], pending: null })
  } finally {
    db.exec('ROLLBACK')
    db.close()
  }
})

it('ignores an interrupted write left beside the state file', async () => {
  const f = await fixture(),
    opts = options(f)
  fs.writeFileSync(join(opts.root, stateFileName(1) + '.0123456789ab.tmp'), '{"format":2')
  expect(await observeInstallations(opts)).toEqual({ installed: [], pending: null })
})

it('reads the newer file when a write removes the listed one before it is read', async () => {
  const f = await fixture(),
    opts = options(f),
    native = vi.mocked(asyncFs.readFile).getMockImplementation()!
  let raced = false
  vi.mocked(asyncFs.readFile).mockImplementation(async (...args) => {
    if (raced) return native(...args)
    raced = true
    // The owner writes the next state and removes this one between the listing and the read.
    prepareFirst(f)
    throw Object.assign(new Error('fictional removed file'), { code: 'ENOENT' })
  })
  try {
    expect(await observeInstallations(opts)).toEqual({ installed: [], pending: 'chrome' })
  } finally {
    vi.mocked(asyncFs.readFile).mockImplementation(native)
  }
  expect(raced).toBe(true)
})
