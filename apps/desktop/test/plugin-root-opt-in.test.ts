import { createHash, randomUUID } from 'node:crypto'
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
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginSupervisorRoot } from '../src/main/plugins/supervisor/client'
import { realPath, isWithinOrSame } from '../src/main/plugins/private-files'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'

const folders: string[] = [],
  closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  try {
    for (const close of closers.splice(0).reverse()) await close()
  } finally {
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
  }
})
async function fixture() {
  const parent = realPath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-root-')),
  )
  folders.push(parent)

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
  it('uses the selected root with an OS-readable writable pin', async () => {
    const f = await fixture()
    await optIn(f, f.workspace, 'p1')
    await chmod(pins(f), 0o666)
    expect(root(f)).toBe(join(f.appData, '@brobot2', 'plugins-p1'))
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

it('person endpoints route to the chosen plugin root', async () => {
  const f = await fixture()
  await optIn(f, f.workspace, 'p1')
  const roots = [root(f, f.otherWorkspace), root(f)]
  for (const path of roots) {
    await mkdir(path, { recursive: true, mode: 0o700 })
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
