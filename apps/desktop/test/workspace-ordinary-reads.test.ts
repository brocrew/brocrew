import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pinTheDataFolder, workspaceStartup, type PinnableApp } from '../src/main/data-folder'
import { workspaceLaunchMessage } from '../src/main/workspace-routing'
import { packagedWorkspaceOwners, readRoutingFile } from '../src/main/workspace-routing-store'
import { ExistingWorkspace } from '../src/main/workspace-startup'

const fault = vi.hoisted(() => ({ file: '' }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === fault.file)
        throw Object.assign(new Error(`EACCES: permission denied, open '${fault.file}'`), {
          code: 'EACCES',
        })
      return fs.openSync(...args)
    },
  }
})
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-workspace-reads-'))
})
afterEach(() => {
  fault.file = ''
  rmSync(root, { recursive: true, force: true })
})

it('reads a linked workspace list normally', () => {
  const file = join(root, 'list.json')
  const target = join(root, 'actual-list.json')
  const value = { version: 1, workspaces: [] }
  writeFileSync(target, JSON.stringify(value))
  symlinkSync(target, file)
  expect(readRoutingFile(file)?.value).toEqual(value)
})

it('reads owner rows through a linked directory without requiring hash filenames', () => {
  const config = join(root, '@brobot2')
  const actual = join(root, 'owner-records')
  mkdirSync(config)
  mkdirSync(actual)
  symlinkSync(actual, join(config, 'packaged-workspace-owners'), 'junction')
  const workspace = join(root, 'workspace')
  writeFileSync(join(actual, 'renamed-owner.json'), JSON.stringify({ version: 1, path: workspace }))
  expect(packagedWorkspaceOwners(root)).toEqual([workspace])
})

it('pins and opens a configured workspace through a directory link', () => {
  const actual = join(root, 'actual-workspace')
  const alias = join(root, 'workspace')
  mkdirSync(actual)
  writeFileSync(join(actual, 'brobot2.sqlite'), '')
  symlinkSync(actual, alias, 'junction')
  const config = join(root, '@brobot2')
  mkdirSync(config)
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: alias,
      packagedForbidden: [],
      developmentForbidden: [],
    }),
  )
  let selected = alias
  const app: PinnableApp = {
    isPackaged: true,
    getPath: (name) => (name === 'appData' ? root : selected),
    setPath: (_name, path) => {
      selected = path
    },
    commandLine: { hasSwitch: (name) => name === 'brobot-hidden' },
  }
  pinTheDataFolder(app)
  expect(selected).toBe(alias)
  expect(() => workspaceStartup(app)!.assertDatabase()).not.toThrow()
})

it('opens valid data at a replaced workspace path without an inode pin', () => {
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const existing = new ExistingWorkspace(workspace)
  renameSync(workspace, join(root, 'earlier'))
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'brobot2.sqlite'), '')
  expect(() => existing.assertDatabase()).not.toThrow()
})

it('lets an absent optional list use the normal missing-file result', () => {
  expect(readRoutingFile(join(root, 'absent.json'))).toBeUndefined()
})

it('keeps the parser cause and filename through startup presentation', () => {
  const file = join(root, 'malformed.json')
  writeFileSync(file, '{')
  let error: unknown
  try {
    readRoutingFile(file)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  const failure = error as Error
  expect(failure.cause).toBeInstanceOf(SyntaxError)
  expect(workspaceLaunchMessage(error)).toContain(file)
  expect(workspaceLaunchMessage(error)).toContain((failure.cause as Error).message)
})

it('retains the actual read denial and file through startup presentation', () => {
  fault.file = join(root, 'denied.json')
  writeFileSync(fault.file, '{}')
  let error: unknown
  try {
    readRoutingFile(fault.file)
  } catch (caught) {
    error = caught
  }
  expect(workspaceLaunchMessage(error)).toContain(fault.file)
  expect(workspaceLaunchMessage(error)).toContain('EACCES')
  expect((error as Error).cause).toMatchObject({ code: 'EACCES' })
})

it('still rejects JSON past the normal size bound and names the file', () => {
  const file = join(root, 'oversized.json')
  writeFileSync(file, ' '.repeat(1024 * 1024 + 1))
  expect(() => readRoutingFile(file)).toThrow('file too large')
  expect(() => readRoutingFile(file)).toThrow(file)
})

it('names the genuinely missing database and operating system cause', () => {
  const file = join(root, 'brobot2.sqlite')
  let error: unknown
  try {
    new ExistingWorkspace(root).assertDatabase()
  } catch (caught) {
    error = caught
  }
  expect(workspaceLaunchMessage(error)).toContain(file)
  expect(workspaceLaunchMessage(error)).toContain('ENOENT')
  expect((error as Error).cause).toMatchObject({ code: 'ENOENT' })
})
