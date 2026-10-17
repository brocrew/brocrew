import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_ID,
  DATA_FOLDER,
  defaultDataFolder,
  nameTheAppToWindows,
  pinTheDataFolder,
  type PinnableApp,
  workspaceOf,
  WORKSPACE_FILE,
} from '../src/main/data-folder'

/**
 * 🔴 **W4.90 — the product's name in packaging, and nobody's data moves.**
 *
 *  - §1 · the pin: no launch that names no folder of its own can land anywhere but the folder every
 *    build has used, and a launch that names one keeps it.
 *  - §2 · what Electron would derive is that same folder, and the one name it derives from — the
 *    package's — is the one the macOS Keychain entry for saved keys is named after: so neither may
 *    move (Electron 43.2.0: `<appData>/<productName ?? name>`, `"<name> Safe Storage"`).
 *  - §3 · the names the OS shows are *BroCrew*; the app's identity — what makes an install of
 *    *BroCrew* replace one of *BroBot* or *BroBot2* — is not.
 */

const here = dirname(fileURLToPath(import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A stand-in for Electron's `app`, recording what the pin set. */
function anApp(switches: readonly string[] = []) {
  const appData = mkdtempSync(join(tmpdir(), 'brobot-app-data-'))
  roots.push(appData)
  const set: [string, string][] = []
  const app: PinnableApp = {
    getPath: () => appData,
    setPath: (name, path) => {
      set.push([name, path])
    },
    commandLine: { hasSwitch: (name) => switches.includes(name) },
  }
  return { app, appData, set }
}

describe('§1 · the pin', () => {
  it('🔴 a launch that names no folder lands in <appData>/@brobot2/desktop, made if it is new', () => {
    const { app, appData, set } = anApp()
    pinTheDataFolder(app)
    const folder = join(appData, '@brobot2', 'desktop')
    expect(set).toEqual([['userData', folder]])
    expect(existsSync(folder), 'a first launch on a new machine has no folder yet').toBe(true)
  })

  it('⚑ a launch that names its own folder (--user-data-dir) keeps it: every test and smoke', () => {
    const { app, set } = anApp(['user-data-dir'])
    pinTheDataFolder(app)
    expect(set).toEqual([])
  })

  it('🔴 the app pins it at module scope, before the protocol, the lock and everything that reads it', () => {
    const index = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
    const at = (code: string): number => {
      const found = index.indexOf(code)
      expect(found, `index.ts no longer has ${code}`).toBeGreaterThan(-1)
      return found
    }
    const pinned = at('\npinTheDataFolder(app)\n')
    expect(pinned).toBeLessThan(at('\nprotocol.registerSchemesAsPrivileged('))
    expect(pinned).toBeLessThan(at('\nvoid runAsSoleInstance({'))
    expect(at('\nnameTheAppToWindows(app)\n')).toBeLessThan(at('\nvoid runAsSoleInstance({'))
  })
})

describe('§2 · the folder and the Keychain entry are the ones every build has used', () => {
  const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
    name?: string
    productName?: string
  }

  it('🔴 what Electron derives from the package is the pinned folder', () => {
    // ⚑ Measured on a packaged build: electron-builder writes no `productName` into the app's
    // `package.json`, so Electron's name is the package's npm `name`.
    expect(pkg.name).toBe('@brobot2/desktop')
    const appData = '/Users/x/Library/Application Support'
    expect(defaultDataFolder(appData)).toBe(join(appData, ...pkg.name!.split('/')))
    expect(DATA_FOLDER.join('/')).toBe(pkg.name)
  })

  it('⛔ the package names no productName — Electron would prefer it, and it names the Keychain entry saved keys are sealed with', () => {
    // ⚠️ The folder is pinned, but `safeStorage`'s Keychain entry on macOS is `"<app name> Safe
    // Storage"` and is not: a `productName` here would leave every saved key unreadable.
    expect(pkg).not.toHaveProperty('productName')
  })

  it('⛔ nor does anything else rename the app: no extraMetadata in the build, no setName in the app', () => {
    // ⚑ electron-builder merges `extraMetadata` into the packaged `package.json` — a `productName`
    // there renames the app as surely as one in the package.
    const config = readFileSync(join(here, '../electron-builder.yml'), 'utf8')
    expect(config).not.toMatch(/^extraMetadata:/m)
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
      })
    const renamers = sources(join(here, '../src/main')).filter((path) =>
      /\bapp\.setName\(|\bapp\.name\s*=[^=]/.test(readFileSync(path, 'utf8')),
    )
    expect(renamers, 'the app’s name also places its data and names its Keychain entry').toEqual([])
  })
})

describe('§3 · the names the OS shows, and the identity it keeps', () => {
  const config = readFileSync(join(here, '../electron-builder.yml'), 'utf8')
  const topLevel = (key: string): string | null =>
    new RegExp(`^${key}: (.+)$`, 'm').exec(config)?.[1] ?? null

  it('🔴 the bundle, the Dock, Cmd-Tab and the installers say BroCrew', () => {
    expect(topLevel('productName')).toBe('BroCrew')
    expect(config).toMatch(
      /^ {2}artifactName: \$\{productName\}-Setup-\$\{version\}-x64\.\$\{ext\}$/m,
    )
    expect(config).toMatch(
      /^ {2}artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m,
    )
  })

  it('⛔ the app id is unchanged — macOS and Windows treat BroCrew as the app BroBot and BroBot2 were', () => {
    // ⚑ The NSIS installer's registry keys are a UUID of this id (electron-builder's
    // `NsisTarget`), so an installer of BroCrew finds an install of BroBot or BroBot2 and replaces it.
    expect(topLevel('appId')).toBe('com.brobot2.desktop')
    expect(APP_ID).toBe(topLevel('appId'))
    // ⛔ …unless a `guid` names other keys.
    expect(config).not.toMatch(/^\s+guid:/m)
  })

  it('⚑ on Windows the running app carries that id, so its window is the one its shortcuts start', () => {
    const named: string[] = []
    const app = { setAppUserModelId: (id: string) => named.push(id) }
    nameTheAppToWindows(app, 'win32')
    nameTheAppToWindows(app, 'darwin')
    expect(named).toEqual([APP_ID])
  })

  it('⚑ what the installer says of the app — its shortcuts’ tooltip, its Apps entry — says BroCrew', () => {
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
      description?: string
    }
    expect(pkg.description).toBe('BroCrew')
  })
})

describe('§4 · W4.105 · A0 — what the footer calls the workspace', () => {
  const aFolder = (name: string): string => {
    const root = mkdtempSync(join(tmpdir(), 'brobot-workspace-name-'))
    roots.push(root)
    const folder = join(root, name)
    mkdirSync(folder)
    return folder
  }

  it('🔴 the default folder is "Default", any other is called by its own name — never a person', () => {
    const research = aFolder('brobot-research')
    expect(workspaceOf(research, false)).toEqual({
      name: 'brobot-research',
      path: research,
      isDefault: false,
    })
    const pinned = aFolder('desktop')
    expect(workspaceOf(pinned, true)).toEqual({ name: 'Default', path: pinned, isDefault: true })
  })

  it('🔴 a name the folder gives itself wins, the default folder’s too', () => {
    const research = aFolder('brobot-research')
    writeFileSync(join(research, WORKSPACE_FILE), JSON.stringify({ name: '  Research  ' }))
    expect(workspaceOf(research, false).name).toBe('Research')
    const pinned = aFolder('desktop')
    writeFileSync(join(pinned, WORKSPACE_FILE), JSON.stringify({ name: 'Home' }))
    expect(workspaceOf(pinned, true).name).toBe('Home')
  })

  it('⛔ a file that names nothing showable is passed over, not shown', () => {
    for (const written of [
      '{not json',
      '[]',
      'null',
      JSON.stringify({ name: 7 }),
      JSON.stringify({ name: '   ' }),
      JSON.stringify({ name: '\u202e\u0007' }),
      JSON.stringify({}),
    ]) {
      const folder = aFolder('the-folder')
      writeFileSync(join(folder, WORKSPACE_FILE), written)
      expect(workspaceOf(folder, false).name, written).toBe('the-folder')
    }
  })

  it('⚑ a name is a line: no control or format characters, and at most 64 of them', () => {
    const folder = aFolder('the-folder')
    writeFileSync(
      join(folder, WORKSPACE_FILE),
      JSON.stringify({ name: `Re\u202esearch\n${'x'.repeat(100)}` }),
    )
    const name = workspaceOf(folder, false).name
    expect(name.startsWith('Research')).toBe(true)
    expect([...name]).toHaveLength(64)
  })

  it('⛔ a folder whose last segment names nothing is called by its path, never "Default"', () => {
    expect(workspaceOf('/', false)).toEqual({ name: '/', path: '/', isDefault: false })
  })
})
