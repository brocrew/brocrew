import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPluginRootSelection,
  rootOptInCommand,
} from '../src/main/plugins/root-opt-in-creator'
import { workspacePluginRoot } from '../src/main/plugins/root-selection'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const parent = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-root-command-'),
  )
  folders.push(parent)
  const appData = join(parent, 'app'),
    workspace = join(parent, 'fern'),
    other = join(parent, 'reed')
  for (const path of [appData, workspace, other, join(appData, '@brobot2')]) mkdirSync(path)
  const defaultRoot = join(appData, '@brobot2', 'plugins'),
    choose = (root = workspace) =>
      workspacePluginRoot({ appData, workspaceRoot: root, defaultRoot })
  return { parent, appData, workspace, other, defaultRoot, choose, slot: 'fern' }
}
describe('explicit plugin location command', () => {
  it('previews without creating preferences, plugin roots or locks', async () => {
    const f = fixture(),
      before = readdirSync(join(f.appData, '@brobot2'))
    expect(await createPluginRootSelection(f)).toMatchObject({ status: 'preview', state: 'shared' })
    expect(readdirSync(join(f.appData, '@brobot2'))).toEqual(before)
    expect(f.choose()).toBe(f.defaultRoot)
  })
  it('selects an existing location and preserves every data byte and another workspace choice', async () => {
    const f = fixture(),
      target = join(f.appData, '@brobot2', 'plugins-fern')
    mkdirSync(target)
    const data = Buffer.from([255, 0, 1])
    writeFileSync(join(target, 'fictional-pairing'), data)
    await createPluginRootSelection({ ...f, workspace: f.other, slot: 'reed', apply: true })
    await createPluginRootSelection({ ...f, apply: true })
    expect(f.choose()).toBe(target)
    expect(f.choose(f.other)).toBe(join(f.appData, '@brobot2', 'plugins-reed'))
    expect(readFileSync(join(target, 'fictional-pairing'))).toEqual(data)
  })
  it.each(['own', 'shared'] as const)(
    'recovers a %s preference after publication is interrupted before workspace marker completion',
    async (mode) => {
      const f = fixture()
      if (mode === 'shared') await createPluginRootSelection({ ...f, apply: true })
      await expect(
        createPluginRootSelection(
          { ...f, mode, apply: true },
          {
            afterPin() {
              throw new Error('fictional crash')
            },
          },
        ),
      ).rejects.toThrow('fictional crash')
      expect(f.choose()).toBe(
        mode === 'shared' ? f.defaultRoot : join(f.appData, '@brobot2', 'plugins-fern'),
      )
      await createPluginRootSelection({ ...f, mode, apply: true })
      expect(f.choose()).toBe(
        mode === 'shared' ? f.defaultRoot : join(f.appData, '@brobot2', 'plugins-fern'),
      )
    },
  )
  it('keeps the previous location when interrupted before atomic publication', async () => {
    const f = fixture()
    await expect(
      createPluginRootSelection(
        { ...f, apply: true },
        {
          beforePublish() {
            throw new Error('fictional crash')
          },
        },
      ),
    ).rejects.toThrow()
    expect(f.choose()).toBe(f.defaultRoot)
  })
  it('ignores old enrollment locks and keeps existing selected data', async () => {
    const f = fixture()
    const lock = join(f.appData, '@brobot2', 'plugin-root-pins.lock')
    writeFileSync(lock, 'fictional interrupted enrollment')
    await createPluginRootSelection({ ...f, apply: true })
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    expect(readFileSync(lock, 'utf8')).toBe('fictional interrupted enrollment')
  })
  it('replaces and deduplicates the same workspace through canonical and alias paths', async () => {
    const f = fixture(),
      alias = join(f.parent, 'fern-alias')
    symlinkSync(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await createPluginRootSelection({ ...f, apply: true })
    await createPluginRootSelection({ ...f, workspace: alias, slot: 'cedar', apply: true })
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-cedar'))
    const pins = join(f.appData, '@brobot2', 'plugin-root-pins.json')
    expect(JSON.parse(readFileSync(pins, 'utf8')).selections).toHaveLength(1)
    writeFileSync(
      pins,
      JSON.stringify({
        format: 1,
        selections: [
          { workspace: alias, slot: 'cedar' },
          { workspace: f.workspace, slot: 'fern' },
        ],
      }),
    )
    await createPluginRootSelection({ ...f, slot: 'reed', apply: true })
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-reed'))
    expect(JSON.parse(readFileSync(pins, 'utf8')).selections).toHaveLength(1)
  })
  it('allows explicit slot reuse or reassignment without removing either selected data tree', async () => {
    const f = fixture()
    await createPluginRootSelection({ ...f, apply: true })
    await createPluginRootSelection({ ...f, workspace: f.other, apply: true })
    expect(f.choose(f.other)).toBe(f.choose())
    await createPluginRootSelection({ ...f, slot: 'cedar', apply: true })
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-cedar'))
    expect(f.choose(f.other)).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
  })
  it('serializes concurrent preferences so another workspace is not lost', async () => {
    const f = fixture()
    await Promise.all([
      createPluginRootSelection({ ...f, apply: true }),
      createPluginRootSelection({ ...f, workspace: f.other, slot: 'reed', apply: true }),
    ])
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    expect(f.choose(f.other)).toBe(join(f.appData, '@brobot2', 'plugins-reed'))
  })
  it('reports own/shared state without writing and leaves all data in place when selecting shared', async () => {
    const f = fixture(),
      args = ['--app-data', f.appData, '--workspace', f.workspace, '--mode', 'state']
    expect(await rootOptInCommand(args)).toBe('shared')
    await createPluginRootSelection({ ...f, apply: true })
    expect(await rootOptInCommand(args)).toBe('own')
    const old = f.choose()
    mkdirSync(old)
    writeFileSync(join(old, 'fictional-profiles'), 'keep')
    await createPluginRootSelection({ ...f, mode: 'shared', apply: true })
    expect(await rootOptInCommand(args)).toBe('shared')
    expect(readFileSync(join(old, 'fictional-profiles'), 'utf8')).toBe('keep')
    expect(existsSync(f.defaultRoot)).toBe(false)
    await expect(rootOptInCommand([...args, '--apply'])).rejects.toThrow()
  })
  it('does not rewrite an already selected preference', async () => {
    const f = fixture()
    await createPluginRootSelection({ ...f, apply: true })
    const pin = join(f.appData, '@brobot2', 'plugin-root-pins.json'),
      bytes = readFileSync(pin)
    expect(await createPluginRootSelection({ ...f, apply: true })).toMatchObject({
      status: 'already selected',
    })
    expect(readFileSync(pin)).toEqual(bytes)
  })
})
