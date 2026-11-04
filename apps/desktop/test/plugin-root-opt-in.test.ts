import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspacePluginRoot } from '../src/main/plugins/root-selection'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const parent = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-root-choice-'),
  )
  folders.push(parent)
  const appData = join(parent, 'app'),
    workspace = join(parent, 'fern'),
    other = join(parent, 'reed')
  for (const path of [appData, workspace, other, join(appData, '@brobot2')]) mkdirSync(path)
  const pin = join(appData, '@brobot2', 'plugin-root-pins.json'),
    marker = join(workspace, 'plugin-root.json'),
    defaultRoot = join(appData, '@brobot2', 'plugins')
  const choose = (root = workspace) =>
    workspacePluginRoot({ appData, workspaceRoot: root, defaultRoot })
  return { parent, appData, workspace, other, pin, marker, defaultRoot, choose }
}
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value))
describe('saved plugin data locations', () => {
  it('passes the effective userData path to the production root selector', () => {
    const code = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const selection = code.match(/const root = pluginSupervisorRoot\(\{([\s\S]*?)\}\)/)?.[1]
    expect(selection).toMatch(/workspaceRoot:\s*app\.getPath\('userData'\)/)
    expect(code.match(/pluginController\.start\(/g)).toHaveLength(1)
  })
  it('retains the default root without writing records or creating data', () => {
    const f = fixture(),
      before = readdirSync(join(f.appData, '@brobot2'))
    expect(f.choose()).toBe(f.defaultRoot)
    expect(readdirSync(join(f.appData, '@brobot2'))).toEqual(before)
  })
  it.each(['pin', 'marker'] as const)('retains a custom root from a surviving %s alone', (kind) => {
    const f = fixture()
    if (kind === 'pin')
      json(f.pin, { format: 1, selections: [{ workspace: f.workspace, slot: 'fern' }] })
    else json(f.marker, { format: 1, slot: 'fern' })
    const bytes = readFileSync(f[kind])
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    expect(readFileSync(f[kind])).toEqual(bytes)
    expect(f.choose(f.other)).toBe(f.defaultRoot)
  })
  it('keeps app preference when a stale workspace marker disagrees, including explicit shared selection', () => {
    const f = fixture()
    json(f.marker, { format: 1, slot: 'stale' })
    json(f.pin, { format: 1, selections: [{ workspace: f.workspace, slot: 'fern' }] })
    expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    json(f.pin, { format: 1, selections: [{ workspace: f.workspace, slot: null }] })
    expect(f.choose()).toBe(f.defaultRoot)
    expect(JSON.parse(readFileSync(f.marker, 'utf8')).slot).toBe('stale')
  })
  it('allows shared slot choices and additional metadata without enrolling each workspace', () => {
    const f = fixture()
    json(f.pin, {
      format: 1,
      note: 'fictional saved preference',
      selections: [f.workspace, f.other].map((workspace) => ({ workspace, slot: 'shared-fern' })),
    })
    expect(f.choose()).toBe(f.choose(f.other))
  })
  it('retains a selected location when its workspace is temporarily unavailable', () => {
    const f = fixture(),
      offline = join(f.parent, 'offline')
    json(f.pin, { format: 1, selections: [{ workspace: offline, slot: 'fern' }] })
    expect(f.choose(offline)).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
  })
  it.skipIf(process.platform === 'win32')(
    'accepts selected aliases, writable metadata and custom roots inside workspace paths',
    () => {
      const f = fixture(),
        alias = join(f.parent, 'alias')
      symlinkSync(f.workspace, alias, 'dir')
      json(f.pin, { format: 1, selections: [{ workspace: alias, slot: 'fern' }] })
      chmodSync(f.pin, 0o666)
      expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
      const aliasPin = join(f.parent, 'saved-pins.json')
      writeFileSync(aliasPin, readFileSync(f.pin))
      rmSync(f.pin)
      symlinkSync(aliasPin, f.pin)
      expect(f.choose()).toBe(join(f.appData, '@brobot2', 'plugins-fern'))
    },
  )
  it('reports malformed location data rather than silently selecting another root', () => {
    const f = fixture()
    writeFileSync(f.pin, '{')
    expect(() => f.choose()).toThrow()
  })
})
