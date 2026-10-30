import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginWorkspaceLease,
  pluginSupervisorRoot,
  supervisorRequest,
} from '../src/main/plugins/supervisor/client'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { keepPluginRootPrivate, realPath, isWithinOrSame } from '../src/main/plugins/private-files'
import { keepToThisUser } from '../src/main/recovery/windows-privacy'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { manifestFor, packageFixture, fictionalPublicKey } from './plugin-package-fixtures'
import { projection, deferred } from './plugin-lifecycle-fixtures'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'

const folders: string[] = [],
  owners: PluginSupervisor[] = [],
  leases: PluginWorkspaceLease[] = [],
  stores: GlobalPluginState[] = [],
  storage: SupervisorStorage[] = [],
  closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  try {
    for (const close of closers.splice(0).reverse()) await close()
    for (const lease of leases.splice(0)) await lease.close()
    for (const owner of owners.splice(0)) await owner.shutdown()
  } finally {
    for (const disk of storage.splice(0)) disk.close()
    for (const state of stores.splice(0)) state.close()
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
  }
})
async function fixture() {
  const parent = realPath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-root-')),
  )
  folders.push(parent)
  await keepToThisUser(parent)
  const appData = join(parent, 'a'),
    workspace = join(parent, 'fern'),
    otherWorkspace = join(parent, 'cedar')
  await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
  for (const root of [workspace, otherWorkspace]) await mkdir(root, { mode: 0o700 })
  return { parent, appData, workspace, otherWorkspace }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const marker = (workspace: string) => join(workspace, 'plugin-root.json')
const pins = (f: Fixture) => join(f.appData, '@brobot2', 'plugin-root-pins.json')
async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 })
}
async function optIn(f: Fixture, workspace: string, slot: string) {
  const previous = existsSync(pins(f)) ? JSON.parse(await readFile(pins(f), 'utf8')).selections : []
  await json(marker(workspace), { format: 1, slot })
  await json(pins(f), {
    format: 1,
    selections: [...previous, { workspace: realPath(workspace), slot }],
  })
}
function root(f: Fixture, workspace = f.workspace, extra: Record<string, unknown> = {}) {
  // Reflect keeps this TEST runnable against the older selector that has no workspace option yet.
  const selected = Reflect.apply(pluginSupervisorRoot, undefined, [
    {
      appData: f.appData,
      hidden: false,
      workspaceRoot: workspace,
      ...extra,
    },
  ]) as string | null
  if (!selected) throw new Error('fictional normal root is missing')
  return selected
}
async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(path: string, relative: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(path, entry.name),
        name = `${relative}/${entry.name}`
      expect(entry.isSymbolicLink()).toBe(false)
      const info = await stat(child)
      hash.update(name).update(String(info.mode))
      if (entry.isDirectory()) await visit(child, name)
      else if (entry.isFile()) hash.update(await readFile(child))
      else {
        expect(entry.isSocket()).toBe(true)
        hash.update(`socket:${info.dev}:${info.ino}`)
      }
    }
  }
  await visit(root, '')
  return hash.digest('hex')
}
async function attach(global: string, workspace: string, generation = randomUUID()) {
  const lease = await PluginWorkspaceLease.attach({
    root: global,
    workspaceRoot: workspace,
    generation,
    build: 'fictional-fern',
  })
  leases.push(lease)
  return lease
}
async function owner(global: string, workspace: string) {
  await keepPluginRootPrivate(global)
  const childStopped = vi.fn(),
    revoked = vi.fn()
  const supervisor = await PluginSupervisor.start({
    root: global,
    workspaceRoots: [workspace],
    revoke: revoked,
  })
  owners.push(supervisor)
  let stopped!: () => void
  const exited = new Promise<void>((resolve) => {
    stopped = resolve
  })
  const adopt = () =>
    supervisor.adopt({
      stop() {
        childStopped()
        stopped()
      },
      exited,
      async descendantsGone() {
        return true
      },
    })
  const disk = new SupervisorStorage(global, [workspace], false)
  storage.push(disk)
  const record = disk.read()
  if (!record) throw new Error('fictional owner record is missing')
  return { supervisor, disk, record, childStopped, revoked, adopt }
}

describe('workspace opt-in keeps every other plugin setup unchanged', () => {
  it.each([false, true])(
    'keeps default and custom workspaces shared without explicit records, packaged=%s',
    async (packaged) => {
      const f = await fixture()
      for (const workspace of [f.workspace, f.otherWorkspace]) {
        expect(root(f, workspace, { packaged, scratchRoot: '/fictional/unused' })).toBe(
          join(f.appData, '@brobot2', 'plugins'),
        )
      }
      expect(existsSync(join(f.appData, '@brobot2', 'plugins'))).toBe(false)
      expect(existsSync(pins(f))).toBe(false)
      expect(existsSync(marker(f.workspace))).toBe(false)
    },
  )
  it('uses distinct fresh roots only for the selected effective folders and persists on reopening', async () => {
    const f = await fixture()
    const dev = root(f)
    await mkdir(join(dev, 'data'), { recursive: true, mode: 0o700 })
    await writeFile(join(dev, 'data', 'fictional-fern'), 'fictional retained setup', {
      mode: 0o600,
    })
    const original = await treeHash(dev)
    await optIn(f, f.workspace, 'p1')
    await optIn(f, f.otherWorkspace, 'p2')
    expect(root(f)).toBe(join(f.appData, '@brobot2', 'plugins-p1'))
    expect(root(f, f.otherWorkspace)).toBe(join(f.appData, '@brobot2', 'plugins-p2'))
    for (const packaged of [false, true]) expect(root(f, f.workspace, { packaged })).toBe(root(f))
    expect(existsSync(root(f))).toBe(false)
    expect(existsSync(root(f, f.otherWorkspace))).toBe(false)
    expect(await treeHash(dev)).toBe(original)
  })
  it('keeps an unselected custom workspace on the old root while another opts in', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    expect(root(f, f.otherWorkspace)).toBe(join(f.appData, '@brobot2', 'plugins'))
    expect(root(f)).not.toBe(root(f, f.otherWorkspace))
  })
  it.each(['marker', 'pin'])(
    'refuses a missing %s instead of opening the shared root',
    async (missing) => {
      const f = await fixture()
      await optIn(f, f.workspace, 'p1')
      await rm(missing === 'marker' ? marker(f.workspace) : pins(f))
      expect(() => root(f)).toThrow(PluginSupervisorError)
      expect(existsSync(join(f.appData, '@brobot2', 'plugins'))).toBe(false)
    },
  )
  it.each(['marker', 'pin'])(
    'refuses malformed, linked, non-file or oversized %s',
    async (kind) => {
      const f = await fixture()
      await optIn(f, f.workspace, 'p1')
      const path = kind === 'marker' ? marker(f.workspace) : pins(f)
      for (const text of [
        '{',
        'null',
        '{}',
        JSON.stringify({ format: 2, slot: 'p1' }),
        ' '.repeat(70_000),
      ]) {
        await writeFile(path, text)
        expect(() => root(f)).toThrow()
      }
      await rm(path)
      await mkdir(path)
      expect(() => root(f)).toThrow()
      await rm(path, { recursive: true })
      const other = join(f.parent, 'fictional-record.json')
      await json(
        other,
        kind === 'marker'
          ? { format: 1, slot: 'p1' }
          : { format: 1, selections: [{ workspace: f.workspace, slot: 'p1' }] },
      )
      await symlink(other, path)
      expect(() => root(f)).toThrow()
    },
  )
  it('refuses a malformed global pin even for an unselected workspace', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    await writeFile(pins(f), '{')
    expect(existsSync(marker(f.otherWorkspace))).toBe(false)
    expect(() => root(f, f.otherWorkspace)).toThrow(PluginSupervisorError)
  })
  it('refuses a missing effective workspace instead of using the default', async () => {
    const f = await fixture()
    expect(() =>
      Reflect.apply(pluginSupervisorRoot, undefined, [{ appData: f.appData, hidden: false }]),
    ).toThrow(PluginSupervisorError)
    expect(() =>
      Reflect.apply(pluginSupervisorRoot, undefined, [
        { appData: f.appData, hidden: false, workspaceRoot: undefined },
      ]),
    ).toThrow(PluginSupervisorError)
    expect(existsSync(join(f.appData, '@brobot2', 'plugins'))).toBe(false)
  })
  it('refuses a writable pin on POSIX while preserving the Windows ACL policy', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    await chmod(pins(f), 0o666)
    if (process.platform === 'win32')
      expect(root(f)).toBe(join(f.appData, '@brobot2', 'plugins-p1'))
    else expect(() => root(f)).toThrow(PluginSupervisorError)
  })
  it('writes neither record on success or refusal', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    for (const mismatch of [false, true]) {
      if (mismatch) await json(marker(f.workspace), { format: 1, slot: 'p2' })
      const before = await Promise.all([readFile(marker(f.workspace)), readFile(pins(f))])
      if (mismatch) expect(() => root(f)).toThrow(PluginSupervisorError)
      else expect(root(f)).toBe(join(f.appData, '@brobot2', 'plugins-p1'))
      const after = await Promise.all([readFile(marker(f.workspace)), readFile(pins(f))])
      expect(after.map((bytes, i) => bytes.equals(before[i]!))).toEqual([true, true])
    }
  })
  it('never falls back through a case alias when the selected marker is missing', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    const alias = join(f.parent, 'FERN')
    if (existsSync(alias)) expect(root(f, alias)).toBe(root(f))
    else expect(() => root(f, alias)).toThrow(PluginSupervisorError)
    await rm(marker(f.workspace))
    expect(() => root(f, alias)).toThrow(PluginSupervisorError)
  })
  it.each(['../plugins', '/absolute', 'personal', 'P1', '', 'a/b'])(
    'refuses unsafe or overlong slot %s',
    async (slot) => {
      const f = await fixture()
      await optIn(f, f.workspace, slot)
      expect(() => root(f)).toThrow()
    },
  )
  it('refuses a mismatch, extra fields and duplicate folder or slot assignments', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    const entry = { workspace: f.workspace, slot: 'p1' }
    for (const selections of [
      [{ ...entry, slot: 'p2' }],
      [entry, entry],
      [entry, { workspace: f.otherWorkspace, slot: 'p1' }],
      [{ ...entry, extra: true }],
    ]) {
      await json(pins(f), { format: 1, selections })
      expect(() => root(f)).toThrow()
    }
    await json(pins(f), { format: 1, selections: [entry] })
    await json(marker(f.workspace), { format: 1, slot: 'p1', extra: true })
    expect(() => root(f)).toThrow()
  })
  it('uses one canonical folder through an alias and refuses copied or moved selection without rebinding', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    const alias = join(f.parent, 'alias')
    await symlink(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(root(f, alias)).toBe(join(f.appData, '@brobot2', 'plugins-p1'))
    await copyFile(marker(f.workspace), marker(f.otherWorkspace))
    expect(() => root(f, f.otherWorkspace)).toThrow()
    await rm(alias)
    const moved = join(f.parent, 'moved')
    await rename(f.workspace, moved)
    expect(() => root(f, moved)).toThrow()
  })
  it('refuses a non-canonical pin or a nonexistent effective folder', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    await json(pins(f), {
      format: 1,
      selections: [{ workspace: `${f.workspace}/../fern`, slot: 'p1' }],
    })
    expect(() => root(f)).toThrow()
    expect(() => root(f, join(f.parent, 'missing'))).toThrow()
    expect(() => root(f, '', {})).toThrow()
  })
  it('refuses an opted-in root inside the selected workspace', async () => {
    const f = await fixture()
    const workspace = f.parent
    await optIn(f, workspace, 'p1')
    expect(() => root(f, workspace)).toThrow()
  })
  it('refuses a selected root whose person socket would exceed the path limit', async () => {
    const f = await fixture()
    const long = { ...f, appData: join(f.appData, 'a'.repeat(65)) }
    await mkdir(join(long.appData, '@brobot2'), { recursive: true, mode: 0o700 })
    await optIn(long, long.workspace, 'p1')
    if (process.platform === 'win32')
      expect(root(long)).toBe(join(long.appData, '@brobot2', 'plugins-p1'))
    else expect(() => root(long)).toThrow()
  })
  it('leaves hidden scratch rules first, without reading an invalid visible-workspace selection', async () => {
    const f = await fixture()
    await json(marker(f.workspace), null)
    expect(
      Reflect.apply(pluginSupervisorRoot, undefined, [
        { appData: f.appData, hidden: true, workspaceRoot: f.workspace },
      ]),
    ).toBeNull()
    expect(
      Reflect.apply(pluginSupervisorRoot, undefined, [
        {
          appData: f.appData,
          hidden: true,
          workspaceRoot: f.workspace,
          scratchRoot: f.otherWorkspace,
        },
      ]),
    ).toBe(f.otherWorkspace)
    for (const scratchRoot of ['relative', join(f.appData, '@brobot2', 'plugins')])
      expect(() =>
        pluginSupervisorRoot({ appData: f.appData, hidden: true, scratchRoot }),
      ).toThrow()
  })
  it('passes the effective userData to the sole startup root, without a second legacy join', async () => {
    const code = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const block = code.match(/const root = pluginSupervisorRoot\(\{([\s\S]*?)\}\)/)?.[1]
    expect(block).toMatch(/workspaceRoot:\s*app\.getPath\('userData'\)/)
    expect(code).toMatch(
      /if \(root && ownership === 'sole'\) \{\s*pluginController\.start\(\{[\s\S]*?\n\s*root,/,
    )
    expect(code.match(/pluginController\.start\(/g)).toHaveLength(1)
    const base = new URL('../src/', import.meta.url)
    const matches: string[] = []
    async function inspect(directory: URL) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
        if (entry.isDirectory()) await inspect(file)
        else if (
          entry.name.endsWith('.ts') &&
          /join\([^\n]*['"]@brobot2['"],\s*['"]plugins['"]/.test(await readFile(file, 'utf8'))
        )
          matches.push(file.pathname)
      }
    }
    await inspect(base)
    expect(matches).toHaveLength(1)
  })
  it.each(['posix', 'win32'] as const)(
    'does not confuse sibling root prefixes on %s',
    (platform) => {
      const base = platform === 'win32' ? 'C:\\fictional\\plugins' : '/fictional/plugins'
      expect(isWithinOrSame(base, `${base}-p1`, platform === 'win32' ? 'win32' : 'linux')).toBe(
        false,
      )
    },
  )
})

async function connectAt(path: string, key: string): Promise<PersonChannel> {
  // Use this exact endpoint, even on Windows: the normal helper derives a new pipe from the key.
  const socket = createConnection(path)
  const challenge = await new Promise<string>((resolve, reject) => {
    let input = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('fictional challenge timed out'))
    }, 2000)
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    const read = (bytes: Buffer) => {
      input += bytes.toString('utf8')
      if (!input.endsWith('\n') && input.length <= 65) return
      clearTimeout(timer)
      socket.off('data', read)
      if (!/^[a-f0-9]{64}\n$/.test(input)) {
        socket.destroy()
        reject(new Error('fictional challenge is invalid'))
      } else resolve(input.trimEnd())
    }
    socket.on('data', read)
  })
  return new PersonChannel(socket, key, challenge, 'client', async () => ({}))
}

it('person capabilities and sockets refuse the other root key in both directions', async () => {
  const f = await fixture()
  await optIn(f, f.workspace, 'p1')
  const roots = [root(f, f.otherWorkspace), root(f)]
  for (const path of roots) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    await keepPluginRootPrivate(path)
  }
  const keys = await Promise.all(roots.map(pluginPersonCapability))
  expect(keys[0]).not.toBe(keys[1])
  const attach = vi.fn(async () => ({ workspaceId: randomUUID() }))
  const controller = {
    attach,
    detach: vi.fn(async () => {}),
  } as unknown as PluginLifecycleController
  const bridges = []
  for (let i = 0; i < roots.length; i++) {
    const bridge = await servePersonPluginControl({
      root: roots[i]!,
      key: keys[i]!,
      controller,
      read: async () => ({}),
    })
    closers.push(() => bridge.close({ endConsumers: true }))
    bridges.push(bridge)
  }
  expect(bridges[0]!.path).not.toBe(bridges[1]!.path)
  for (let i = 0; i < bridges.length; i++) {
    const foreign = await connectAt(bridges[i]!.path, keys[1 - i]!)
    await expect(foreign.call({ kind: 'attach', workspaceId: randomUUID() })).rejects.toThrow()
    foreign.close()
    await foreign.settled()
    expect(attach).toHaveBeenCalledTimes(i)
    const valid = await connectPersonPluginControl({
      path: bridges[i]!.path,
      key: keys[i]!,
      handle: async () => ({}),
    })
    await expect(valid.call({ kind: 'attach', workspaceId: randomUUID() })).resolves.toEqual({
      personProtocol: 2,
    })
    expect(attach).toHaveBeenCalledTimes(i + 1)
    valid.close()
    await valid.settled()
  }
  expect(attach).toHaveBeenCalledTimes(2)
})

describe('simultaneous unselected and opted-in owners', () => {
  it('changes only closed workspaces while a default owner refresh remains in flight', async () => {
    const f = await fixture(),
      devWorkspace = join(f.appData, '@brobot2', 'desktop')
    const third = join(f.parent, 'oak')
    for (const folder of [devWorkspace, third]) await mkdir(folder, { mode: 0o700 })
    const dev = root(f, devWorkspace)
    await mkdir(dev, { mode: 0o700 })
    await keepPluginRootPrivate(dev)
    const state = GlobalPluginState.create({
      root: join(dev, 'state'),
      workspaceRoots: [devWorkspace],
    })
    stores.push(state)
    const live = await owner(dev, devWorkspace),
      lease = await attach(dev, devWorkspace)
    live.adopt()
    const manifest = manifestFor()
    manifest.id = 'chrome'
    manifest.skills = []
    manifest.platforms = [
      {
        os: process.platform as 'darwin' | 'linux' | 'win32',
        cpu: process.arch as 'arm64' | 'x64',
      },
    ]
    const pkg = packageFixture({ manifest }),
      events: string[] = []
    const entered = deferred<void>(),
      release = deferred<void>(),
      exited = deferred<void>()
    const checkpoints = Array.from({ length: 6 }, () => ({
      request: deferred<void>(),
      done: deferred<void>(),
    }))
    const snapshots: unknown[] = []
    const source = join(dev, 'fictional-catalogue.json'),
      reads: string[] = []
    await writeFile(source, pkg.bytes, { mode: 0o600 })
    const controller = await PluginLifecycleController.open({
      root: dev,
      state,
      pinnedPublicKey: fictionalPublicKey,
      target: manifest.platforms[0]!,
      catalogue: { bytes: pkg.bytes, signature: pkg.signature },
      names: { chrome: 'Fictional Fern' },
      deny: () => {
        events.push('deny')
      },
      download: async () => {
        events.push('download')
        return pkg.archive
      },
      refreshCatalogue: async () => {
        reads.push(source)
        const bytes = await readFile(source)
        entered.resolve()
        for (const point of checkpoints) {
          await point.request.promise
          try {
            snapshots.push(state.inspect())
          } catch (error) {
            snapshots.push(error)
          }
          point.done.resolve()
        }
        await release.promise
        return {
          catalogue: { bytes, signature: pkg.signature },
          names: { chrome: 'Fictional Fern' },
        }
      },
      runtime: {
        previousOwnerClean: async () => true,
        removeCode: async () => {
          throw new Error('No package removal in this proof')
        },
        removeData: async () => {
          throw new Error('No data removal in this proof')
        },
        start: async () => {
          events.push('start')
          return {
            runId: randomUUID(),
            exited: exited.promise,
            ready: async () => ({
              serverPid: 404941,
              origin: 'http://127.0.0.1:1',
              mcp: () => ({ url: '', headers: { Authorization: '' } }),
              admin: () => ({ url: '', headers: { Authorization: '' } }),
            }),
            stop: async () => {
              events.push('stop')
              exited.resolve()
            },
          }
        },
      },
    })
    closers.push(() => controller.drain())
    const handle = await controller.attach(projection(events).sink)
    await controller.install(handle, 'chrome')
    await mkdir(join(dev, 'data'), { recursive: true, mode: 0o700 })
    await writeFile(join(dev, 'data', 'fictional-retained'), 'retained default setup', {
      mode: 0o600,
    })
    const key = await pluginPersonCapability(dev)
    const bridge = await servePersonPluginControl({
      root: dev,
      key,
      controller,
      read: async () => {
        throw new Error('No private plugin read in this proof')
      },
    })
    closers.push(() => bridge.close({ endConsumers: true }))
    const client = await connectPersonPluginControl({
      path: bridge.path,
      key,
      handle: async () => true,
    })
    closers.push(async () => {
      client.close()
      await client.settled()
    })
    await client.call({ kind: 'attach', workspaceId: randomUUID() })
    const cards = await client.call({ kind: 'list-v2' })
    expect(cards).toMatchObject([{ id: 'chrome', installed: true, state: 'Running' }])
    const original = state.inspect(),
      identity = controller.catalogueIdentity(),
      beforeEvents = [...events]
    expect(original.pending).toBeNull()
    expect(original.guards).toHaveLength(1)
    const refreshing = controller.refreshCatalogue(identity)
    closers.push(async () => {
      for (const point of checkpoints) point.request.resolve()
      release.resolve()
      await refreshing
    })
    await entered.promise
    let refreshFinished = false
    void refreshing.then(
      () => {
        refreshFinished = true
      },
      () => {},
    )
    const beforeTree = await treeHash(dev),
      run = promisify(execFile)
    const creatorLock = join(f.appData, '@brobot2', 'plugin-root-pins.lock')
    expect(isWithinOrSame(dev, creatorLock)).toBe(false)
    for (const path of [
      live.disk.lock,
      live.disk.record,
      live.disk.socket,
      join(dev, 'state', 'writer-lock.sqlite'),
    ])
      expect(path).not.toBe(creatorLock)
    const command = resolve('scripts/plugin-root-opt-in.mjs')
    const targets = [
      [f.workspace, 'p1'],
      [f.otherWorkspace, 'p2'],
      [third, 'p3'],
    ] as const
    let checkpoint = 0
    try {
      for (const mode of ['own', 'shared'] as const) {
        for (const [workspace, slot] of targets) {
          const args = [
            command,
            '--app-data',
            f.appData,
            '--workspace',
            workspace,
            '--mode',
            mode,
            '--slot',
            slot,
            '--apply',
          ]
          expect(JSON.parse((await run(process.execPath, args)).stdout).status).toBe(
            mode === 'own' ? 'created' : 'shared',
          )
          expect(root(f, workspace)).toBe(
            mode === 'own' ? join(f.appData, '@brobot2', `plugins-${slot}`) : dev,
          )
          expect(root(f, devWorkspace)).toBe(dev)
          expect(refreshFinished).toBe(false)
          expect(controller.catalogueIdentity()).toBe(identity)
          expect(live.disk.read()).toEqual(live.record)
          expect(live.childStopped).not.toHaveBeenCalled()
          expect(live.revoked).not.toHaveBeenCalled()
          await expect(lease.renew()).resolves.toBeUndefined()
          await expect(client.call({ kind: 'features' })).resolves.toHaveProperty('features')
          const point = checkpoints[checkpoint]!
          point.request.resolve()
          await point.done.promise
          expect(snapshots[checkpoint++]).toEqual(original)
          expect(events).toEqual(beforeEvents)
          expect(await treeHash(dev)).toBe(beforeTree)
          expect(existsSync(creatorLock)).toBe(false)
        }
      }
    } finally {
      for (const point of checkpoints) point.request.resolve()
      release.resolve()
      await refreshing
    }
    expect(reads).toEqual([source])
    expect(state.inspect()).toEqual(original)
    expect(controller.catalogueIdentity()).toBe(identity)
    expect(await client.call({ kind: 'list-v2' })).toEqual(cards)
    expect(events).toEqual(beforeEvents)
    await expect(lease.renew()).resolves.toBeUndefined()
  })
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'draining selected=%s leaves the other root unchanged, both selected=%s',
    async (drainingSelected, bothSelected) => {
      const f = await fixture()
      const { workspace } = f
      await optIn(f, workspace, 'p1')
      if (bothSelected) await optIn(f, f.otherWorkspace, 'p2')
      const dev = root(f, f.otherWorkspace),
        installed = root(f, workspace)
      expect(installed).not.toBe(dev)
      await mkdir(dev, { mode: 0o700 })
      await keepPluginRootPrivate(dev)
      const devState = GlobalPluginState.create({
        root: join(dev, 'state'),
        workspaceRoots: [workspace],
      })
      stores.push(devState)
      const operationId = randomUUID()
      devState.prepare({
        operationId,
        consent: {
          action: 'install',
          pluginId: 'fictional-fern',
          at: 1000,
          expectedSequence: devState.inspect().sequence,
          expectedInstallId: null,
          release: {
            version: '1.0.0',
            archiveSha256: 'a'.repeat(64),
            manifestSha256: 'b'.repeat(64),
            dataSchema: 1,
          },
        },
        snapshot: null,
      })
      devState.complete(operationId)
      expect(devState.exportActivation().entries).toMatchObject([
        { pluginId: 'fictional-fern', phase: 'active' },
      ])
      await mkdir(join(dev, 'data'), { mode: 0o700 })
      await writeFile(join(dev, 'data', 'fictional-fern'), 'fictional retained setup', {
        mode: 0o600,
      })
      const original = devState.inspect()
      const devOwner = await owner(dev, workspace)
      const retained = await treeHash(dev)
      const installedOwner = await owner(installed, workspace)
      const generation = randomUUID()
      const devLease = await attach(dev, workspace, generation),
        installedLease = await attach(installed, workspace, generation)
      devOwner.adopt()
      installedOwner.adopt()
      expect(devLease.epoch).not.toBe(installedLease.epoch)
      expect(devOwner.record.key).not.toBe(installedOwner.record.key)
      const installedState = GlobalPluginState.create({
        root: join(installed, 'state'),
        workspaceRoots: [workspace],
      })
      stores.push(installedState)
      expect(installedState.inspect().rootId).not.toBe(original.rootId)
      expect(installedState.exportActivation().entries).toEqual([])
      expect(existsSync(join(installed, 'data'))).toBe(false)
      expect(await treeHash(dev)).toBe(retained)
      installedState.requireUpdateReader()
      expect(devState.inspect()).toEqual(original)
      const installedBefore = installedState.inspect()
      devState.requireUpdateReader()
      expect(installedState.inspect()).toEqual(installedBefore)
      const devBeforeDrain = devState.inspect()

      const workspaceId = createHash('sha256').update(workspace).digest('hex')
      // Even with the target owner's transport key, a lease from the other root is no authority.
      for (const [target, foreign] of [
        [devOwner, installedLease],
        [installedOwner, devLease],
      ] as const) {
        await expect(
          supervisorRequest(target.disk, target.record, {
            kind: 'release',
            workspace: workspaceId,
            generation,
            lease: foreign.lease,
          }),
        ).rejects.toMatchObject({ code: 'unavailable' })
      }
      await expect(devLease.renew()).resolves.toBeUndefined()
      await expect(installedLease.renew()).resolves.toBeUndefined()
      const [closing, survivor, survivorLease, closedLease] = drainingSelected
        ? ([installedOwner, devOwner, devLease, installedLease] as const)
        : ([devOwner, installedOwner, installedLease, devLease] as const)
      expect(await closedLease.close()).toBe(true)
      expect(closing.childStopped).toHaveBeenCalledOnce()
      expect(closing.revoked).toHaveBeenCalledOnce()
      expect(survivor.childStopped).not.toHaveBeenCalled()
      expect(survivor.revoked).not.toHaveBeenCalled()
      expect(survivor.disk.read()).toEqual(survivor.record)
      await expect(survivorLease.renew()).resolves.toBeUndefined()
      expect(installedState.inspect()).toEqual(installedBefore)
      expect(devState.inspect()).toEqual(devBeforeDrain)
      expect(await readFile(join(dev, 'data', 'fictional-fern'), 'utf8')).toBe(
        'fictional retained setup',
      )
    },
  )
  it.each(['file', 'link'])(
    'an unusable installed root (%s) never attaches to the dev owner',
    async (kind) => {
      const f = await fixture()
      const { appData, workspace, otherWorkspace } = f
      await optIn(f, otherWorkspace, 'p1')
      const dev = root(f, workspace),
        installed = join(appData, '@brobot2', 'plugins-p1')
      const devOwner = await owner(dev, workspace)
      const devLease = await attach(dev, workspace)
      devOwner.adopt()
      if (kind === 'file') await writeFile(installed, 'fictional unavailable root', { mode: 0o600 })
      else await symlink(dev, installed, process.platform === 'win32' ? 'junction' : 'dir')
      expect(() => root(f, otherWorkspace)).toThrow()
      const selected = installed
      const launch = vi.fn(async () => {
        throw new Error('fictional launch must not run')
      })
      const attempted = PluginWorkspaceLease.attach({
        root: selected,
        workspaceRoot: otherWorkspace,
        generation: randomUUID(),
        build: 'fictional-cedar',
        launch,
      }).then((lease) => {
        leases.push(lease)
        return lease
      })
      await expect(attempted).rejects.toMatchObject({ code: 'unavailable' })
      expect(launch).not.toHaveBeenCalled()
      expect(devOwner.disk.read()).toEqual(devOwner.record)
      expect(devOwner.childStopped).not.toHaveBeenCalled()
      expect(devOwner.revoked).not.toHaveBeenCalled()
      await expect(devLease.renew()).resolves.toBeUndefined()
    },
  )
})
