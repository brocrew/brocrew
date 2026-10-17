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

/**
 * Seats and smokes launch hidden; a person’s launch shows the conversation window without an
 * additional test window.
 *
 * ## ⚑ What was measured before this was pinned (695, the built app, its own port and userData)
 *
 * | | `--brobot-hidden` | no switch (the control) |
 * |---|---|---|
 * | on-screen windows of the launch's pid tree | **0**, sixteen looks over four seconds | **1**, at 1 362 ms, `BroBot` |
 * | the window server's title | `BroBot — test` | `BroBot` |
 * | the bar the page draws | `BroBot — test` | `BroBot` |
 * | `document.visibilityState` · `setTimeout(100)` · rAF in 1 s | `visible` · 100–103 ms · 121 | — |
 * | a CDP screenshot | 595 KB, the whole app | — |
 * | `Page.bringToFront`, `Browser.setWindowBounds` | still 0 on screen | — |
 * | the frontmost app, before and after | the same pid, not ours | — |
 *
 * ⚠️ **724 · the control column is a person's launch on the DEFAULT folder's title**: a person's launch
 * on its own folder, as the control above was run, reads `BroBot — <folder>` since `724`.
 *
 * ⚠️ **One thing a hidden window does NOT do: resize.** `setWindowBounds` to 1000 wide left
 * `innerWidth` at 1200 — which is why `probe:lane-geometry` stays visible and says so.
 *
 * These tests pin the product half (the drawn bar is `the-bar-says-test.render.test.ts`, a renderer
 * file because it imports the component); `smoke:ui` step `1w` and its run-long watch (`zw`) measure the
 * live half on every run, and `scripts/test/hidden-launch.test.mjs` pins the launchers.
 */

const INDEX = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')

/**
 * The body of the first `{…}` that begins at or after the END of `anchor`, by brace depth — the
 * census reads one function. ⚠️ From the anchor's END, so a return type written `Promise<{ … }>`
 * inside the anchor is not mistaken for the body.
 */
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
    // ⚑ Another switch is not this one.
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
    expect(ready.trim()).toBe('if (!presentation.hidden) window.show()')
    // ⚑ The control: the OPTIONS are the person's, unchanged — the switch acts after creation.
    expect(create).toMatch(/(^|\s)show:\s*false/)
    expect(create).toMatch(/(^|\s)title:\s*'BroCrew'/)
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
    // ⛔ And nowhere else: a picker that called the dialog directly would bypass the door.
    const everywhere = INDEX.split('dialog.showOpenDialog(').length - 1
    const inPick = pick.split('dialog.showOpenDialog(').length - 1
    expect(inPick).toBe(2)
    expect(everywhere).toBe(inPick)
  })

  it('a hidden launch keeps Electron’s own error box off the screen — only a hidden one', () => {
    // ⚑ Electron shows *"A JavaScript error occurred in the main process"* only while its handler is
    // the SOLE `uncaughtException` listener; a hidden launch adds one, a person's does not.
    expect(INDEX).toMatch(/if \(presentation\.hidden\) \{\n\s*process\.on\('uncaughtException'/)
    expect(INDEX.split("process.on('uncaughtException'").length - 1).toBe(1)
  })

  it('a hidden launch is not an app in the Dock or the app switcher either', () => {
    // ⚑ Measured on 695's live batch: a never-shown window still made its Electron a `Foreground`
    // app, a second `Electron` icon beside a person's own.
    expect(bodyAfter('function start(ownership: HostGateVerdict): void')).toContain(
      'if (presentation.hidden) app.dock?.hide()',
    )
  })

  /**
   * ⚑ **Re-aimed by `724`** (`718` F-1): this pinned the two-armed ternary, and the title now has a
   * third arm — the data folder, asked of Electron's own default. ⛔ RED on `main`, which never asked.
   * ⚑ **W4.90** — the default is the one the app pins at launch (`data-folder.ts`), no longer
   * Electron's derivation from the app's name.
   */
  it('the bar is told which name to draw — and, on a person’s launch, which data folder', () => {
    const read = bodyAfter('function readAppInfo(): AppInfo')
    expect(read).toContain('windowTitle: windowTitleFor(presentation, dataFolder)')
    expect(read).toContain("app.getPath('userData')")
    expect(read).toContain("defaultDataFolder(app.getPath('appData'))")
  })
})

/**
 * 🔴 **724 · `718` F-1 — a window says which data folder it runs on, when it is not the default.**
 *
 * ⚑ `718` wired the bar and the OS title to `AppInfo.windowTitle` and left the fact to main: every
 * person's launch said `BroBot`, on whatever folder. ⛔ **Measured on no live window**: a person's
 * launch on another folder is a SHOWN window, and every Electron this dispatch may start is hidden
 * (§6) — where the hidden name wins — so the functions main composes it with are measured here.
 *
 * ⛔ RED on `main` by assertion: neither function exists there (asserted first, so the red is a
 * finding rather than a `TypeError`).
 */
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
    // ⚑ The default need not exist yet — Electron makes it on first use.
    expect(folderOf(join(root, 'fe685'), join(root, 'nothing-here'))).toBe('fe685')
  })

  it('⚑ the default folder is the default — by identity, whatever its spelling', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is that `/tmp` resolves to `/private/tmp`.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    expect(folderOf(join(root, 'default'), join(root, 'default'))).toBeNull()
    expect(titleFor(false, null)).toBe(PERSONS_TITLE)
    // ⚑ Chromium hands the switch back RESOLVED (`/tmp` → `/private/tmp`): the premise, then the case.
    expect(realpathSync(root)).not.toBe(root)
    expect(folderOf(join(realpathSync(root), 'default'), join(root, 'default'))).toBeNull()
    symlinkSync(join(root, 'default'), join(root, 'alias'))
    expect(folderOf(join(root, 'alias'), join(root, 'default'))).toBeNull()
  })

  // ⚠️ **Read off the volume, never assumed**: APFS as a Mac formats it folds case; a volume that does
  // not is SKIPPED, and says so in the report, rather than passing.
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
    // ⚑ A name made of nothing a person can read is not replaced by the path (review of `724`).
    mkdirSync(join(root, '\u202E'))
    expect(folderOf(join(root, '\u202E'), join(root, 'default'))).toBe('another data folder')
  })
})
