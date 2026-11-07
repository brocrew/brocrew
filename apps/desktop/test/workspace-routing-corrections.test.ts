import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultDataFolder, pinTheDataFolder, type PinnableApp } from '../src/main/data-folder'
import { OTHER_BUILD_REFUSAL, workspaceRouting } from '../src/main/workspace-routing'

const hooks = vi.hoisted(() => ({
  afterStat: undefined as ((file: unknown) => void) | undefined,
  beforeMkdir: undefined as ((file: unknown) => void) | undefined,
}))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    statSync: (...args: Parameters<typeof fs.statSync>) => {
      const seen = fs.statSync(...args)
      hooks.afterStat?.(args[0])
      return seen
    },
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
      hooks.beforeMkdir?.(args[0])
      return fs.mkdirSync(...args)
    },
  }
})

let root: string, appData: string, config: string, first: string, second: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-routing-corrections-'))
  appData = join(root, 'app-data')
  config = join(appData, '@brobot2')
  mkdirSync(config, { recursive: true })
  first = join(root, 'copper')
  second = join(root, 'fern')
})
afterEach(() => {
  hooks.afterStat = hooks.beforeMkdir = undefined
  rmSync(root, { recursive: true, force: true })
})
function list(rows: [string, number][]) {
  writeFileSync(
    join(config, 'packaged-workspaces.json'),
    JSON.stringify({
      version: 1,
      workspaces: rows.map(([path, lastOpenedAt]) => ({ path, lastOpenedAt })),
    }),
  )
}
function configure() {
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: first,
      packagedForbidden: [defaultDataFolder(appData)],
      developmentForbidden: [first, second],
    }),
  )
  list([[first, 1]])
}
function app(packaged: boolean, explicit?: string, hidden = false, required = true) {
  const appPath = join(root, 'app')
  mkdirSync(appPath, { recursive: true })
  writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: required }))
  const selected: string[] = []
  const fake: PinnableApp = {
    isPackaged: packaged,
    getAppPath: () => appPath,
    getPath: (name) => (name === 'appData' ? appData : (explicit ?? '/fictional-unused')),
    setPath: (_name, folder) => selected.push(folder),
    commandLine: {
      hasSwitch: (name) =>
        name === 'brobot-hidden' ? hidden : name === 'user-data-dir' && explicit !== undefined,
    },
  }
  return { fake, selected }
}
function attempt(fake: PinnableApp): string | null {
  try {
    pinTheDataFolder(fake)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

it('correction: hidden entry paths retain the configured routing and dev fence', () => {
  configure()
  mkdirSync(first)
  const packaged = app(true, undefined, true)
  const dev = app(false, second, true)
  const observed = { packaged: attempt(packaged.fake), dev: attempt(dev.fake) }
  expect(observed).toEqual({ packaged: null, dev: OTHER_BUILD_REFUSAL })
  expect(packaged.selected).toEqual([first])
  expect(existsSync(join(config, 'packaged-workspace-owners'))).toBe(false)
  expect(existsSync(defaultDataFolder(appData))).toBe(false)
  expect(existsSync(second)).toBe(false)
})

it('correction: two stale recent-list writers cannot lose either ownership fence', () => {
  list([])
  mkdirSync(first)
  mkdirSync(second)
  // Both writers start from the same list; their independent claims precede publication.
  expect(attempt(app(true, first, false, false).fake)).toBeNull()
  expect(attempt(app(true, second, false, false).fake)).toBeNull()
  list([[first, 2]])
  list([[second, 3]])
  expect(
    JSON.parse(readFileSync(join(config, 'packaged-workspaces.json'), 'utf8')).workspaces,
  ).toHaveLength(1)
  const dev = workspaceRouting(appData, false)
  expect([dev.refusal(first), dev.refusal(second)]).toEqual([
    OTHER_BUILD_REFUSAL,
    OTHER_BUILD_REFUSAL,
  ])
})

it('correction: absent and empty lists use the configured first workspace', () => {
  configure()
  mkdirSync(first)
  const observed: (string | null)[] = []
  const selected: string[] = []
  for (const required of [true, false]) {
    rmSync(join(config, 'packaged-workspaces.json'), { force: true })
    const absent = app(true, undefined, false, required)
    observed.push(attempt(absent.fake))
    list([])
    const empty = app(true, undefined, false, required)
    observed.push(attempt(empty.fake))
    selected.push(...absent.selected, ...empty.selected)
  }
  expect(observed).toEqual(Array(4).fill(null))
  expect(selected).toEqual(Array(4).fill(first))
})

it('correction: missing explicit known folders and post-stat removal never create a workspace', () => {
  configure()
  const explicitResult = attempt(app(true, first).fake)
  rmSync(join(config, 'workspace-policy.json'))
  const ordinaryExplicitResult = attempt(app(true, first, false, false).fake)
  configure()
  mkdirSync(first)
  const finder = app(true)
  let removed = false,
    workspaceMkdirs = 0
  hooks.afterStat = (file) => {
    if (file === first && !removed) {
      removed = true
      rmSync(first, { recursive: true })
    }
  }
  hooks.beforeMkdir = (file) => {
    if (file === first) workspaceMkdirs++
  }
  const finderResult = attempt(finder.fake)
  for (const result of [explicitResult, ordinaryExplicitResult]) {
    expect(result).toContain(first)
    expect(result).toContain('ENOENT')
  }
  expect(finderResult).toBeNull()
  expect(removed).toBe(true)
  expect(workspaceMkdirs).toBe(0)
  expect(existsSync(first)).toBe(false)
})

it('correction: ordinary Finder skips missing entries and defaults when none exist', () => {
  list([
    [first, 3],
    [second, 2],
  ])
  mkdirSync(second)
  const latest = app(true, undefined, false, false)
  const latestResult = attempt(latest.fake)
  rmSync(second, { recursive: true })
  const fallback = app(true, undefined, false, false)
  const fallbackResult = attempt(fallback.fake)
  expect([latestResult, fallbackResult]).toEqual([null, null])
  expect(latest.selected).toEqual([second])
  expect(fallback.selected).toEqual([defaultDataFolder(appData)])
  expect(existsSync(first)).toBe(false)
})

it('two independent Node writers publish durable ownership concurrently', async () => {
  const store = new URL('../src/main/workspace-routing-store.ts', import.meta.url).href
  const script = `
    const { claimPackagedWorkspace } = await import(process.argv[1]);
    process.once('message', () => { claimPackagedWorkspace(process.argv[2], process.argv[3]); process.disconnect(); });
    process.send('ready');
  `
  const children: ChildProcess[] = []
  const exits: Promise<void>[] = []
  const bounded = async <T>(promise: Promise<T>, milliseconds = 5000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('fictional writer deadline')), milliseconds)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    const writers = [first, second].map((folder) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', script, store, appData, folder],
        {
          env: { HOME: root, TMPDIR: root, USERPROFILE: root },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      children.push(child)
      const exited = new Promise<void>((resolve, reject) => {
        child.once('error', () => reject(new Error('fictional ownership writer failed')))
        child.once('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('fictional ownership writer did not exit normally')),
        )
      })
      exits.push(exited)
      void exited.catch(() => undefined)
      const ready = new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve())
        child.once('error', () => reject(new Error('fictional ownership writer failed')))
        child.once('exit', () =>
          reject(new Error('fictional ownership writer exited before readiness')),
        )
      })
      return { child, ready, exited }
    })
    await bounded(Promise.all(writers.map((writer) => writer.ready)))
    for (const writer of writers) writer.child.send('go')
    await bounded(Promise.all(exits))
    list([[second, 3]])
    const dev = workspaceRouting(appData, false)
    expect([dev.refusal(first), dev.refusal(second)]).toEqual([
      OTHER_BUILD_REFUSAL,
      OTHER_BUILD_REFUSAL,
    ])
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill()
    await bounded(Promise.allSettled(exits), 1000)
  }
}, 15000)
