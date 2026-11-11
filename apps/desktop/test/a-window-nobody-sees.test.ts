import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transformWithEsbuild } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as launchModule from '../src/main/launch-presentation'
import {
  HIDDEN_LAUNCH_SWITCH,
  HIDDEN_TITLE,
  PERSONS_TITLE,
  keepOutOfSight,
  launchPresentation,
  type HideableWindow,
} from '../src/main/launch-presentation'
import {
  HIDDEN_LAUNCH_ARG,
  HIDDEN_TITLE as SCRIPTS_HIDDEN_TITLE,
} from '../../../scripts/lib/hidden-launch.mjs'

const INDEX = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')

function bodyAfter(anchor: string): string {
  const at = INDEX.indexOf(anchor)
  if (at < 0) throw new Error(`index.ts no longer says ${anchor}`)
  const open = INDEX.indexOf('{', at + anchor.length - 1)
  let depth = 0
  for (let index = open; index < INDEX.length; index += 1) {
    if (INDEX[index] === '{') depth += 1
    else if (INDEX[index] === '}') {
      depth -= 1
      if (depth === 0) return INDEX.slice(open + 1, index)
    }
  }
  throw new Error(`the body after ${anchor} never closes`)
}

class FakeWindow implements HideableWindow {
  title = 'unset'
  throttled: boolean | null = null
  readonly listeners = new Map<string, (event: { preventDefault(): void }) => void>()
  setTitle(title: string): void {
    this.title = title
  }
  on(event: 'page-title-updated', listener: (event: { preventDefault(): void }) => void) {
    this.listeners.set(event, listener)
    return this
  }
  readonly webContents = {
    setBackgroundThrottling: (allowed: boolean): void => {
      this.throttled = allowed
    },
  }
}

describe('695 §1 · the switch, and what it does to a window', () => {
  it('only the switch hides a launch — its absence is a person’s launch', () => {
    expect(launchPresentation((name) => name === HIDDEN_LAUNCH_SWITCH).hidden).toBe(true)
    expect(launchPresentation(() => false).hidden).toBe(false)
    expect(launchPresentation((name) => name === 'remote-debugging-port').hidden).toBe(false)
  })

  it('a hidden window is titled for a test, keeps that title, and runs at a shown window’s pace', () => {
    const window = new FakeWindow()
    keepOutOfSight(window)
    expect(window.title).toBe(HIDDEN_TITLE)
    expect(window.throttled).toBe(false)
    let prevented = false
    window.listeners.get('page-title-updated')?.({ preventDefault: () => (prevented = true) })
    expect(prevented, 'the page’s <title> would retitle it BroBot').toBe(true)
  })

  it('the launchers and the app spell it the same, and name the test window the same', () => {
    expect(HIDDEN_LAUNCH_ARG).toBe(`--${HIDDEN_LAUNCH_SWITCH}`)
    expect(SCRIPTS_HIDDEN_TITLE).toBe(HIDDEN_TITLE)
    expect(HIDDEN_TITLE).not.toBe(PERSONS_TITLE)
  })
})

describe('695 §1 · main/index.ts — every door a hidden launch could show itself through', () => {
  it('the presentation is read once, from the command line, and never from the environment', () => {
    expect(INDEX).toContain(
      'const presentation = launchPresentation((name) => app.commandLine.hasSwitch(name))',
    )
    expect(INDEX).not.toMatch(/process\.env\[?['"]?BROBOT_HIDDEN/)
  })

  it('the window: kept out of sight when hidden, and shown on ready only when it is a person’s', () => {
    const create = bodyAfter('function createWindow(): void')
    expect(create).toContain('if (presentation.hidden) keepOutOfSight(window)')
    const ready = bodyAfter("window.on('ready-to-show', () =>")
    expect(ready.trim()).toBe(
      'if (!presentation.hidden) window.show()\n    finishCapturedRecoveryCopies()',
    )
    expect(create).toMatch(/(^|\s)show:\s*false/)
    expect(create).toMatch(/(^|\s)title:\s*'BroCrew'/)
  })

  it('shows the ordinary window and returns from ready while captured-copy hashing is still pending', async () => {
    let release!: () => void
    const pendingHash = new Promise<void>((resolve) => {
      release = resolve
    })
    let hashing = false,
      published = false,
      pruned = false,
      shown = false
    const recoveryWork = new Set<Promise<unknown>>()
    const source = `function withRecoveryWork(work) {${bodyAfter('function withRecoveryWork<T>')}}
      function finishCapturedRecoveryCopies() {${bodyAfter('function finishCapturedRecoveryCopies(): void')}}
      function ready() {${bodyAfter("window.on('ready-to-show', () =>")}}
      ready()`
    const { code } = await transformWithEsbuild(source, 'window-copy-order.ts', { loader: 'ts' })
    const returned = runInNewContext(code, {
      presentation: { hidden: false },
      window: {
        show: () => {
          shown = true
        },
      },
      recoveryWork,
      stoppingRecoveryWork: null,
      console,
      capturedRecoveryCopies: [
        {
          finish: async () => {
            hashing = true
            await pendingHash
            published = true
          },
        },
      ],
      letGoOfOldCopies: async () => {
        pruned = true
      },
    })
    try {
      expect(shown).toBe(true)
      expect(returned).toBeUndefined()
      await Promise.resolve()
      expect(hashing).toBe(true)
      expect(published).toBe(false)
      expect(pruned).toBe(false)
      expect(recoveryWork.size).toBe(1)
    } finally {
      release()
      await Promise.all([...recoveryWork])
    }
    expect(published).toBe(true)
    expect(pruned).toBe(true)
    expect(recoveryWork.size).toBe(0)
  })

  it('a second launch neither raises a hidden app nor puts a dialog on screen', () => {
    const focus = bodyAfter('focusExisting: () =>')
    expect(focus.indexOf('if (presentation.hidden)')).toBeGreaterThan(-1)
    expect(focus.indexOf('if (presentation.hidden)')).toBeLessThan(focus.indexOf('existing.show()'))
    expect(focus.indexOf('if (presentation.hidden)')).toBeLessThan(focus.indexOf('app.focus('))
    const announce = bodyAfter('announce: (message) =>')
    expect(announce.indexOf('if (presentation.hidden)')).toBeGreaterThan(-1)
    expect(announce.indexOf('if (presentation.hidden)')).toBeLessThan(
      announce.indexOf('dialog.showMessageBox'),
    )
  })

  it('every picker goes through the one door, and that door answers a hidden launch itself', () => {
    const pick = bodyAfter('Promise<{ canceled: boolean; filePaths: string[] }> {')
    const guard = pick.indexOf('if (presentation.hidden)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(pick.indexOf('dialog.showOpenDialog'))
    const everywhere = INDEX.split('dialog.showOpenDialog(').length - 1
    const inPick = pick.split('dialog.showOpenDialog(').length - 1
    expect(inPick).toBe(2)
    expect(everywhere).toBe(inPick)
  })

  it('a hidden launch keeps Electron’s own error box off the screen — only a hidden one', () => {
    expect(INDEX).toMatch(/if \(presentation\.hidden\) \{\n\s*process\.on\('uncaughtException'/)
    expect(INDEX.split("process.on('uncaughtException'").length - 1).toBe(1)
  })

  it('a hidden launch is not an app in the Dock or the app switcher either', () => {
    expect(bodyAfter('function start(ownership: HostGateVerdict): void')).toContain(
      'if (presentation.hidden) app.dock?.hide()',
    )
  })

  it('the bar is told which name to draw — and, on a person’s launch, which data folder', () => {
    const read = bodyAfter('function readAppInfo(): AppInfo')
    expect(read).toContain('windowTitle: windowTitleFor(presentation, dataFolder)')
    expect(read).toContain("app.getPath('userData')")
    expect(read).toContain("defaultDataFolder(app.getPath('appData'))")
  })
})

describe('724 · a window names its data folder when it is not the default', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'b2-724-'))
    mkdirSync(join(root, 'default'))
    mkdirSync(join(root, 'fe685'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const exported = launchModule as unknown as Record<string, unknown>
  const titleFor = (hidden: boolean, folder: string | null): string =>
    (exported.windowTitleFor as (p: { hidden: boolean }, f: string | null) => string)(
      { hidden },
      folder,
    )
  const folderOf = (userData: string, theDefault: string): string | null =>
    (exported.otherDataFolder as (u: string, d: string) => string | null)(userData, theDefault)

  it('🔴 a person’s launch on another folder is titled with that folder', () => {
    expect(typeof exported.windowTitleFor, 'no title that names a data folder').toBe('function')
    expect(typeof exported.otherDataFolder, 'no answer for which folder').toBe('function')
    expect(titleFor(false, folderOf(join(root, 'fe685'), join(root, 'default')))).toBe(
      'BroCrew — fe685',
    )
    expect(folderOf(join(root, 'fe685'), join(root, 'nothing-here'))).toBe('fe685')
  })

  it('⚑ the default folder is the default — by identity, whatever its spelling', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    expect(folderOf(join(root, 'default'), join(root, 'default'))).toBeNull()
    expect(titleFor(false, null)).toBe(PERSONS_TITLE)
    expect(realpathSync(root)).not.toBe(root)
    expect(folderOf(join(realpathSync(root), 'default'), join(root, 'default'))).toBeNull()
    symlinkSync(join(root, 'default'), join(root, 'alias'))
    expect(folderOf(join(root, 'alias'), join(root, 'default'))).toBeNull()
  })

  const volumeFoldsCase = existsSync(tmpdir().toUpperCase())
  it.skipIf(!volumeFoldsCase)(
    '⚑ on a case-insensitive volume, two spellings of one folder are one',
    () => {
      expect(existsSync(join(root, 'DEFAULT'))).toBe(true)
      expect(folderOf(join(root, 'DEFAULT'), join(root, 'default'))).toBeNull()
    },
  )

  it('⚑ a hidden launch keeps the test name, on any folder', () => {
    expect(titleFor(true, 'fe685')).toBe(HIDDEN_TITLE)
    expect(titleFor(true, null)).toBe(HIDDEN_TITLE)
  })

  it('⚑ a folder name cannot hide or reorder the title, and nothing throws', () => {
    mkdirSync(join(root, 'a\u202Eb'))
    expect(folderOf(join(root, 'a\u202Eb'), join(root, 'default'))).toBe('ab')
    expect(() => folderOf('\0bad', join(root, 'default'))).not.toThrow()
    mkdirSync(join(root, '\u202E'))
    expect(folderOf(join(root, '\u202E'), join(root, 'default'))).toBe('another data folder')
  })
})
