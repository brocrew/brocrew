import type { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WORKSPACES_CHANNELS, type WorkspaceRow } from '../src/shared/workspaces'
import { startWorkspaces } from '../src/main/workspaces-in-the-app'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  launches: [] as { command: string; args: string[] }[],
  failLaunch: false,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => fake.handlers.set(channel, handler) },
  shell: { trashItem: vi.fn(async () => undefined) },
}))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: (command: string, args: string[]) => {
      fake.launches.push({ command, args })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() =>
        child.emit(fake.failLaunch ? 'error' : 'spawn', new Error('fictional launch failed')),
      )
      return child
    },
  }
})
vi.mock('../src/main/one-host-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/one-host-gate')>()),
  whoIsOn: vi.fn(async () => 'open'),
}))

let root: string
let userData: string
let appData: string

const ask = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = fake.handlers.get(channel)
  if (handler === undefined) throw new Error(`No workspace handler on ${channel}`)
  return handler({ sender: null }, ...args) as T
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-workspace-wiring-')))
  userData = join(root, 'current')
  appData = join(root, 'app-data')
  mkdirSync(userData)
  mkdirSync(appData)
  fake.handlers.clear()
  fake.launches.length = 0
  fake.failLaunch = false
  const paths: Record<string, string> = { userData, appData, home: join(root, 'home') }
  const app = {
    isPackaged: false,
    getPath: (name: string) => paths[name],
    getAppPath: () => join(root, 'fictional-app'),
  } as unknown as App
  startWorkspaces({ app, hidden: true, pickFolder: async () => null })
})

afterEach(() => {
  fake.handlers.clear()
  rmSync(root, { recursive: true, force: true })
})

it('lists the hidden launch itself and offers new workspaces beside its temporary data folder', async () => {
  const rows = await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ path: userData, isThisOne: true, state: 'open' })
  expect(await ask(WORKSPACES_CHANNELS.folderFor, 'Notes')).toBe(
    join(root, 'BroBot workspaces', 'Notes'),
  )
  expect(await ask(WORKSPACES_CHANNELS.chooseFolder)).toBeNull()
  expect(existsSync(join(userData, 'workspaces.json'))).toBe(false)
})

it('creates a named sibling, asks for a separate launch, and then lists it as open', async () => {
  const path = join(root, 'new-notes')
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Notes', path })).toMatchObject({
    opened: true,
    path,
  })
  expect(fake.launches).toHaveLength(1)
  expect(fake.launches.at(0)?.args.join(' ')).toContain(path)
  expect(JSON.parse(readFileSync(join(path, 'workspace.json'), 'utf8'))).toMatchObject({
    name: 'Notes',
  })
  const rows = await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)
  expect(rows.find((row) => row.path === path)).toMatchObject({
    name: 'Notes',
    state: 'open',
    isThisOne: false,
  })
})

it('opens a listed sibling using its recorded spelling, then renames and forgets it', async () => {
  const path = join(root, 'archive')
  mkdirSync(path)
  writeFileSync(join(path, 'brobot2.sqlite'), '')
  expect(await ask(WORKSPACES_CHANNELS.open, path)).toMatchObject({ opened: true, path })
  expect(await ask(WORKSPACES_CHANNELS.rename, { path, name: 'Archive' })).toEqual({ done: true })
  expect(
    (await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).find((row) => row.path === path),
  ).toMatchObject({ name: 'Archive' })
  expect(await ask(WORKSPACES_CHANNELS.remove, path)).toEqual({ done: true })
  expect((await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).map((row) => row.path)).toEqual([
    userData,
  ])
  expect(existsSync(join(path, 'brobot2.sqlite'))).toBe(true)
})

it('refuses paths outside the hidden launch and malformed requests without starting anything', async () => {
  const outside = dirname(root)
  expect(await ask(WORKSPACES_CHANNELS.open, outside)).toMatchObject({ opened: false })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'No', path: outside })).toMatchObject({
    opened: false,
  })
  expect(await ask(WORKSPACES_CHANNELS.open, 42)).toEqual({
    opened: false,
    refusal: 'A workspace is a folder’s path.',
  })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: '' })).toEqual({
    opened: false,
    refusal: 'A new workspace needs a name.',
  })
  expect(await ask(WORKSPACES_CHANNELS.remove, userData)).toEqual({
    done: false,
    refusal: 'This is the workspace this window runs on.',
  })
  expect(fake.launches).toHaveLength(0)
})

it('reports a failed launch and leaves the new folder available to retry', async () => {
  fake.failLaunch = true
  const path = join(root, 'try-again')
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Try again', path })).toMatchObject({
    opened: false,
    refusal: expect.stringContaining('fictional launch failed'),
  })
  expect(existsSync(join(path, 'workspace.json'))).toBe(true)
  expect((await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).map((row) => row.path)).toEqual([
    userData,
  ])
  fake.failLaunch = false
  expect(await ask(WORKSPACES_CHANNELS.open, path)).toMatchObject({ opened: true, path })
})
