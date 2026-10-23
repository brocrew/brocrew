import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { workspacePluginRoot } from '../src/main/plugins/root-selection'
import { keepFileToThisUser, keepToThisUser } from '../src/main/recovery/windows-privacy'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function fixture() {
  const base = realpathSync.native(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-enrol-')),
  )
  folders.push(base)
  await keepToThisUser(base)
  const appData = join(base, 'app'),
    workspace = join(base, 'fern'),
    other = join(base, 'reed')
  for (const path of [appData, workspace, other, join(appData, '@brobot2')]) {
    await mkdir(path, { mode: 0o700 })
    await keepToThisUser(path)
  }
  const parent = join(appData, '@brobot2'),
    marker = join(workspace, 'plugin-root.json')
  const pins = join(parent, 'plugin-root-pins.json'),
    legacy = join(parent, 'plugins')
  await mkdir(legacy, { mode: 0o700 })
  await writeFile(join(legacy, 'fictional-state'), 'preserve me', { mode: 0o600 })
  return { base, appData, workspace, other, parent, marker, pins, legacy, slot: 'p1' }
}
type Options = {
  appData: string
  workspace: string
  slot?: string
  mode?: 'own' | 'shared'
  apply?: boolean
}
type Hook = {
  beforePublish?: () => void | Promise<void>
  afterPin?: () => void | Promise<void>
  afterMarker?: () => void | Promise<void>
}
async function creator() {
  // Load inside each test so an absent command produces individual RED cases, not a collection error.
  const modulePath = '../src/main/plugins/root-opt-in-creator.ts'
  return (await import(modulePath)) as {
    createPluginRootSelection(
      options: Options,
      hooks?: Hook,
    ): Promise<{ status: string; root: string }>
    checkCreationPrivacy(path: string, lists: unknown, platform: NodeJS.Platform): Promise<void>
  }
}
function selected(f: Awaited<ReturnType<typeof fixture>>, workspace = f.workspace) {
  return workspacePluginRoot({
    appData: f.appData,
    workspaceRoot: workspace,
    defaultRoot: f.legacy,
  })
}
function tree(path: string): string {
  const hash = createHash('sha256')
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const child = join(folder, name),
        stat = lstatSync(child)
      hash.update(child.slice(path.length) + ':' + stat.mode + ':' + stat.ino)
      if (stat.isDirectory()) walk(child)
      else if (stat.isFile()) hash.update(readFileSync(child))
    }
  }
  walk(path)
  return hash.digest('hex')
}
describe('creating an explicit plugin setup', () => {
  it('previews without creating any file or directory', async () => {
    const f = await fixture(),
      before = tree(f.base),
      api = await creator()
    const plan = await api.createPluginRootSelection(f)
    expect(plan).toMatchObject({ status: 'preview', root: join(f.parent, 'plugins-p1') })
    expect(tree(f.base)).toBe(before)
    expect(selected(f)).toBe(f.legacy)
  })
  it('publishes a native canonical pair without creating plugin data', async () => {
    const f = await fixture(),
      api = await creator(),
      before = tree(f.legacy)
    expect((await api.createPluginRootSelection({ ...f, apply: true })).status).toBe('created')
    expect(selected(f)).toBe(join(f.parent, 'plugins-p1'))
    expect(JSON.parse(readFileSync(f.pins, 'utf8')).selections).toEqual([
      { workspace: realpathSync.native(f.workspace), slot: f.slot },
    ])
    expect(existsSync(join(f.parent, 'plugins-p1'))).toBe(false)
    expect(tree(f.legacy)).toBe(before)
  })
  it('preserves another selected workspace and its marker bytes', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    const marker = readFileSync(f.marker),
      first = JSON.parse(readFileSync(f.pins, 'utf8')).selections[0]
    await api.createPluginRootSelection({ ...f, workspace: f.other, slot: 'p2', apply: true })
    expect(JSON.parse(readFileSync(f.pins, 'utf8')).selections[0]).toEqual(first)
    expect(readFileSync(f.marker)).toEqual(marker)
    expect(selected(f)).toBe(join(f.parent, 'plugins-p1'))
    expect(selected(f, f.other)).toBe(join(f.parent, 'plugins-p2'))
  })
  it('does not write on an exact rerun, even after the selected root exists', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    await mkdir(join(f.parent, 'plugins-p1'), { mode: 0o700 })
    await keepToThisUser(join(f.parent, 'plugins-p1'))
    const before = tree(f.base)
    expect((await api.createPluginRootSelection({ ...f, apply: true })).status).toBe(
      'already selected',
    )
    expect(tree(f.base)).toBe(before)
  })
  it.each(['directory', 'file', 'link'])(
    'refuses a used root (%s) without changing data',
    async (kind) => {
      const f = await fixture(),
        api = await creator(),
        root = join(f.parent, 'plugins-p1')
      if (kind === 'directory') await mkdir(root)
      else if (kind === 'file') await writeFile(root, 'occupied')
      else await symlink(f.legacy, root, process.platform === 'win32' ? 'junction' : 'dir')
      const before = tree(f.base)
      await expect(api.createPluginRootSelection({ ...f, apply: true })).rejects.toThrow()
      expect(tree(f.base)).toBe(before)
    },
  )
  it.each(['marker-json', 'marker-directory', 'marker-link', 'pin-json', 'pin-link'])(
    'refuses %s unchanged',
    async (kind) => {
      const f = await fixture(),
        api = await creator()
      if (kind === 'marker-directory') await mkdir(f.marker)
      else if (kind === 'marker-link' || kind === 'pin-link') {
        const target = join(f.base, 'fictional-record')
        await writeFile(target, '{}', { mode: 0o600 })
        await symlink(target, kind === 'pin-link' ? f.pins : f.marker, 'file')
      } else await writeFile(kind === 'pin-json' ? f.pins : f.marker, '{', { mode: 0o600 })
      const before = tree(f.base)
      await expect(api.createPluginRootSelection({ ...f, apply: true })).rejects.toThrow()
      expect(tree(f.base)).toBe(before)
    },
  )
  it('refuses slot reuse and reassignment', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    const before = tree(f.base)
    await expect(
      api.createPluginRootSelection({ ...f, workspace: f.other, apply: true }),
    ).rejects.toThrow()
    await expect(api.createPluginRootSelection({ ...f, slot: 'p2', apply: true })).rejects.toThrow()
    expect(tree(f.base)).toBe(before)
  })
  it.each(['missing', 'file', 'relative', 'default', 'internal', 'long'])(
    'refuses an unsafe workspace or path (%s)',
    async (kind) => {
      const f = await fixture(),
        api = await creator()
      let workspace = join(f.base, 'absent'),
        appData = f.appData
      if (kind === 'file') await writeFile(workspace, 'not a directory')
      if (kind === 'relative') workspace = 'fern'
      if (kind === 'default') workspace = join(f.parent, 'desktop')
      if (kind === 'internal') workspace = join(f.parent, 'fictional')
      if (kind === 'default' || kind === 'internal') await mkdir(workspace)
      if (kind === 'long') {
        appData = join(f.base, 'a'.repeat(100))
        await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
        workspace = f.workspace
      }
      const before = tree(f.base)
      // Windows uses key-derived pipes; the long path control is a POSIX budget check.
      if (kind === 'long' && process.platform === 'win32') {
        expect((await api.createPluginRootSelection({ ...f, appData })).status).toBe('preview')
      } else
        await expect(
          api.createPluginRootSelection({ ...f, workspace, appData, apply: true }),
        ).rejects.toThrow()
      expect(tree(f.base)).toBe(before)
    },
  )
  it('keeps the old pair unchanged when publication fails before the pin rename', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    const pin = readFileSync(f.pins),
      marker = readFileSync(f.marker)
    await expect(
      api.createPluginRootSelection(
        { ...f, workspace: f.other, slot: 'p2', apply: true },
        {
          beforePublish: () => {
            throw new Error('fictional failure')
          },
        },
      ),
    ).rejects.toThrow('fictional failure')
    expect(readFileSync(f.pins)).toEqual(pin)
    expect(readFileSync(f.marker)).toEqual(marker)
    expect(selected(f)).toBe(join(f.parent, 'plugins-p1'))
    expect(selected(f, f.other)).toBe(f.legacy)
  })
  it('refuses a partial pair after an interruption, preserving the other selection', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    await expect(
      api.createPluginRootSelection(
        { ...f, workspace: f.other, slot: 'p2', apply: true },
        {
          afterPin: () => {
            throw new Error('fictional interruption')
          },
        },
      ),
    ).rejects.toThrow('fictional interruption')
    expect(() => selected(f, f.other)).toThrow()
    expect(selected(f)).toBe(join(f.parent, 'plugins-p1'))
    const before = tree(f.base)
    await expect(
      api.createPluginRootSelection({ ...f, workspace: f.other, slot: 'p2', apply: true }),
    ).rejects.toThrow()
    expect(tree(f.base)).toBe(before)
    const pinBytes = readFileSync(f.pins)
    const recoveredMarker = join(f.other, 'plugin-root.json')
    await writeFile(recoveredMarker, '{"format":1,"slot":"p2"}', { mode: 0o600, flag: 'wx' })
    await keepFileToThisUser(recoveredMarker)
    expect(
      (await api.createPluginRootSelection({ ...f, workspace: f.other, slot: 'p2' })).status,
    ).toBe('already selected')
    expect(selected(f, f.other)).toBe(join(f.parent, 'plugins-p2'))
    expect(readFileSync(f.pins)).toEqual(pinBytes)
  })
  it('does not replace a pin changed during creation', async () => {
    const f = await fixture(),
      api = await creator()
    const external = JSON.stringify({ format: 1, selections: [] })
    await expect(
      api.createPluginRootSelection(
        { ...f, apply: true },
        {
          beforePublish: async () => {
            await writeFile(f.pins, external, { mode: 0o600 })
          },
        },
      ),
    ).rejects.toThrow()
    expect(readFileSync(f.pins, 'utf8')).toBe(external)
    expect(existsSync(f.marker)).toBe(false)
  })
  it('refuses a marker-only half pair without repairing it', async () => {
    const f = await fixture(),
      api = await creator()
    await writeFile(f.marker, JSON.stringify({ format: 1, slot: 'p1' }), { mode: 0o600 })
    const before = tree(f.base)
    await expect(api.createPluginRootSelection({ ...f, apply: true })).rejects.toThrow()
    expect(tree(f.base)).toBe(before)
    expect(() => selected(f)).toThrow()
  })
  it('does not overwrite a marker that appears after publishing the pin', async () => {
    const f = await fixture(),
      api = await creator(),
      foreign = 'fictional conflicting marker'
    await expect(
      api.createPluginRootSelection(
        { ...f, apply: true },
        {
          afterPin: async () => {
            await writeFile(f.marker, foreign, { mode: 0o600 })
          },
        },
      ),
    ).rejects.toThrow()
    expect(readFileSync(f.marker, 'utf8')).toBe(foreign)
    expect(() => selected(f)).toThrow()
  })
  it('refuses a retargeted input alias before publication', async () => {
    const f = await fixture(),
      api = await creator(),
      alias = join(f.base, 'alias')
    await symlink(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(
      api.createPluginRootSelection(
        { ...f, workspace: alias, apply: true },
        {
          beforePublish: async () => {
            await rm(alias)
            await symlink(f.other, alias, process.platform === 'win32' ? 'junction' : 'dir')
          },
        },
      ),
    ).rejects.toThrow('identity changed')
    expect(existsSync(f.pins)).toBe(false)
    expect(existsSync(f.marker)).toBe(false)
    expect(existsSync(join(f.other, 'plugin-root.json'))).toBe(false)
  })
  it.each(['', '../x', 'P1', 'toolong'])(
    'refuses an invalid slot (%s) without preview writes',
    async (slot) => {
      const f = await fixture(),
        api = await creator(),
        before = tree(f.base)
      await expect(api.createPluginRootSelection({ ...f, slot })).rejects.toThrow()
      expect(tree(f.base)).toBe(before)
    },
  )
  it.each([false, true])('serializes concurrent creators (same slot: %s)', async (sameSlot) => {
    const f = await fixture(),
      api = await creator()
    const results = await Promise.allSettled([
      api.createPluginRootSelection({ ...f, apply: true }),
      api.createPluginRootSelection({
        ...f,
        workspace: f.other,
        slot: sameSlot ? 'p1' : 'p2',
        apply: true,
      }),
    ])
    const count = results.filter((r) => r.status === 'fulfilled').length
    expect(count).toBeGreaterThanOrEqual(1)
    if (sameSlot) expect(count).toBe(1)
    const pins = JSON.parse(readFileSync(f.pins, 'utf8')).selections
    expect(pins).toHaveLength(count)
    for (const pin of pins)
      expect(selected(f, pin.workspace)).toBe(join(f.parent, 'plugins-' + pin.slot))
  })
  it('refuses a leftover lock without stealing it', async () => {
    const f = await fixture(),
      api = await creator()
    await writeFile(join(f.parent, 'plugin-root-pins.lock'), 'fictional unfinished creator', {
      mode: 0o600,
    })
    const before = tree(f.base)
    await expect(api.createPluginRootSelection({ ...f, apply: true })).rejects.toThrow('lock')
    expect(tree(f.base)).toBe(before)
  })
  it('checks Windows parent privacy without changing its ACL', async () => {
    const api = await creator(),
      calls: string[] = [],
      user = 'S-1-5-21-123-456-789-1001'
    const lists = {
      userSid: async () => user,
      machineSid: async () => null,
      read: async () => 'D:(A;OICI;FA;;;BU)',
      restrict: async () => {
        calls.push('restrict')
      },
    }
    await expect(api.checkCreationPrivacy('fictional', lists, 'win32')).rejects.toThrow()
    expect(calls).toEqual([])
  })
  it('returns to shared without removing data or another workspace selection', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    await api.createPluginRootSelection({ ...f, workspace: f.other, slot: 'p2', apply: true })
    const ownRoot = join(f.parent, 'plugins-p1')
    await mkdir(ownRoot, { mode: 0o700 })
    await writeFile(join(ownRoot, 'fictional-data'), 'retain me', { mode: 0o600 })
    const ownHash = tree(ownRoot),
      legacyHash = tree(f.legacy)
    const otherMarker = readFileSync(join(f.other, 'plugin-root.json'))
    const result = await api.createPluginRootSelection({ ...f, mode: 'shared', apply: true })
    expect(result.status).toBe('shared')
    expect(selected(f)).toBe(f.legacy)
    expect(existsSync(f.marker)).toBe(false)
    expect(JSON.parse(readFileSync(f.pins, 'utf8')).selections).toEqual([
      { workspace: f.other, slot: 'p2' },
    ])
    expect(selected(f, f.other)).toBe(join(f.parent, 'plugins-p2'))
    expect(readFileSync(join(f.other, 'plugin-root.json'))).toEqual(otherMarker)
    expect(tree(ownRoot)).toBe(ownHash)
    expect(tree(f.legacy)).toBe(legacyHash)
  })
  it('previews shared removal with zero writes and needs no slot', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    const before = tree(f.base)
    expect(
      await api.createPluginRootSelection({
        appData: f.appData,
        workspace: f.workspace,
        mode: 'shared',
      }),
    ).toMatchObject({ status: 'preview', mode: 'shared' })
    expect(tree(f.base)).toBe(before)
  })
  it('shared is idempotent when both records are absent', async () => {
    const f = await fixture(),
      api = await creator(),
      before = tree(f.base)
    for (let i = 0; i < 2; i++)
      expect(
        (await api.createPluginRootSelection({ ...f, mode: 'shared', apply: true })).status,
      ).toBe('already shared')
    expect(tree(f.base)).toBe(before)
  })
  it.each(['marker-only', 'pin-only', 'interrupted-own', 'linked-temp'])(
    'shared clears a partial selection (%s)',
    async (kind) => {
      const f = await fixture(),
        api = await creator()
      if (kind === 'marker-only')
        await writeFile(f.marker, '{"format":1,"slot":"p1"}', { mode: 0o600 })
      if (kind === 'pin-only')
        await writeFile(
          f.pins,
          JSON.stringify({ format: 1, selections: [{ workspace: f.workspace, slot: 'p1' }] }),
          { mode: 0o600 },
        )
      if (kind === 'interrupted-own' || kind === 'linked-temp') {
        await expect(
          api.createPluginRootSelection(
            { ...f, apply: true },
            {
              afterPin: () => {
                throw new Error('fictional interruption')
              },
            },
          ),
        ).rejects.toThrow()
        if (kind === 'linked-temp') {
          const { link } = await import('node:fs/promises')
          const temp = join(f.workspace, '.plugin-root-marker-fictional.tmp')
          await writeFile(temp, '{"format":1,"slot":"p1"}', { mode: 0o600 })
          await link(temp, f.marker)
        }
      }
      expect(() => selected(f)).toThrow()
      expect(
        (await api.createPluginRootSelection({ ...f, mode: 'shared', apply: true })).status,
      ).toBe('shared')
      expect(selected(f)).toBe(f.legacy)
      expect(existsSync(f.marker)).toBe(false)
      const before = tree(f.base)
      expect(
        (await api.createPluginRootSelection({ ...f, mode: 'shared', apply: true })).status,
      ).toBe('already shared')
      expect(tree(f.base)).toBe(before)
    },
  )
  it('shared finishes its own interrupted removal', async () => {
    const f = await fixture(),
      api = await creator()
    await api.createPluginRootSelection({ ...f, apply: true })
    await expect(
      api.createPluginRootSelection(
        { ...f, mode: 'shared', apply: true },
        {
          afterMarker: () => {
            throw new Error('fictional shared interruption')
          },
        },
      ),
    ).rejects.toThrow('fictional shared interruption')
    expect(existsSync(f.marker)).toBe(false)
    expect(() => selected(f)).toThrow()
    await api.createPluginRootSelection({ ...f, mode: 'shared', apply: true })
    expect(selected(f)).toBe(f.legacy)
  })
  it('shared never guesses at a malformed global pin or edits routing files', async () => {
    const f = await fixture(),
      api = await creator()
    await writeFile(f.pins, '{', { mode: 0o600 })
    await writeFile(join(f.parent, 'workspace-policy.json'), 'fictional policy')
    await writeFile(join(f.parent, 'packaged-workspaces.json'), 'fictional routing')
    await mkdir(join(f.parent, 'packaged-workspace-owners'))
    const before = tree(f.base)
    await expect(
      api.createPluginRootSelection({ ...f, mode: 'shared', apply: true }),
    ).rejects.toThrow()
    expect(tree(f.base)).toBe(before)
  })
  it('runs the documented CLI with explicit paths and no default writes', async () => {
    const f = await fixture(),
      before = tree(f.base),
      run = promisify(execFile)
    const command = resolve('scripts/plugin-root-opt-in.mjs')
    const args = [command, '--app-data', f.appData, '--workspace', f.workspace, '--slot', f.slot]
    const preview = await run(process.execPath, args)
    expect(JSON.parse(preview.stdout)).toMatchObject({ status: 'preview', workspace: f.workspace })
    expect(tree(f.base)).toBe(before)
    await run(process.execPath, [...args, '--apply'])
    expect(selected(f)).toBe(join(f.parent, 'plugins-p1'))
    const sharedArgs = [
      command,
      '--app-data',
      f.appData,
      '--workspace',
      f.workspace,
      '--mode',
      'shared',
    ]
    const beforeShared = tree(f.base)
    expect(JSON.parse((await run(process.execPath, sharedArgs)).stdout)).toMatchObject({
      status: 'preview',
      mode: 'shared',
    })
    expect(tree(f.base)).toBe(beforeShared)
    await run(process.execPath, [...sharedArgs, '--apply'])
    await run(process.execPath, [...sharedArgs, '--apply'])
    expect(selected(f)).toBe(f.legacy)
    await expect(run(process.execPath, [command, '--workspace', f.workspace])).rejects.toThrow()
    await expect(run(process.execPath, [...args, '--unknown'])).rejects.toThrow()
  })
})
