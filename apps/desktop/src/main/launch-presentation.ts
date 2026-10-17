import { basename, resolve } from 'node:path'
import { sameFolder } from './same-folder'

/**
 * 🔴 **695 §1 · A launch that is not a person's stays out of sight.**
 *
 * Separate launches can use different data folders while showing otherwise identical windows. A visible auxiliary window can make the person's conversations appear to be missing.
 *
 * ## ⚑ The one switch, and why it is a SWITCH and not an environment variable
 *
 * Use `--brobot-hidden` on Electron's command line so hiding applies only to the chosen launch. An inherited environment variable could also hide the person's app after a shell relaunch. The app does not forward its own argv to children.
 *
 * ## ⛔ What it changes, and — more important — what it does not
 *
 * | | a person's launch (no switch) | a hidden launch |
 * |---|---|---|
 * | the window | created `show: false`, shown on `ready-to-show` | created the same way, **never shown** |
 * | its page | renders, answers CDP | ⚑ the same |
 * | background throttling | Chromium's default | **off** — timers keep a shown window's pace |
 * | its title | `BroBot2` — or, since `724`, `BroBot2 — <folder>` on a userData that is not the default ({@link windowTitleFor}) | **`BroBot2 — test`**, and the page's `<title>` may not overwrite it |
 * | a second launch against it | brings it forward, focuses the app, says so in a sheet | ⚑ does none of those: it logs |
 * | a folder/file picker | a native dialog | ⚑ none — answered *cancelled*, and logged |
 * | the Dock and ⌘Tab | an `Electron`/`BroBot2` icon | ⚑ none — `app.dock.hide()` at ready (`index.ts`) |
 * | an uncaught main-process error | Electron's own error box | ⚑ none — logged (`index.ts`) |
 *
 * ⛔ **The window's OPTIONS are the same object on both paths** — the switch acts on the window
 * after it exists ({@link keepOutOfSight}). So a person's launch is not a branch of this code that
 * could drift: it is the code as it was, with one `if` in front of `show()`.
 *
 * ⚠️ **Why throttling has to go with it** ([[timing-a-window-needs-the-window-visible]]): the
 * smoke measured a hidden window's `setTimeout(100)` taking about a second and, after five minutes,
 * about one wake a minute — so the five-second person's-queue timer, the one-second tickers and every
 * step that waits on them would run at a pace no person ever sees. Electron's own doc for
 * `setBackgroundThrottling`: *"This also affects the Page Visibility API."*
 *
 * ⛔ **Nobody's launch gets this by accident**: nothing in `apps/desktop/src` passes the switch, the
 * packaged app's `Info.plist` does not, and `pnpm dev` does not. It is for seats and smokes, which
 * pass it by name (`scripts/lib/hidden-launch.mjs`).
 */

/** The switch, without its dashes — the spelling `app.commandLine.hasSwitch` takes. */
export const HIDDEN_LAUNCH_SWITCH = 'brobot-hidden'

/**
 * A person's window on the app's DEFAULT userData — and the literal the window's options carry on
 * every launch, which `one-title-bar.test.ts` pins; the page retitles it from `AppInfo.windowTitle`.
 */
export const PERSONS_TITLE = 'BroCrew'

/**
 * ⚑ **A hidden window that somebody does bring forward is never mistaken for his** (695 §1.4) —
 * in the Window menu, Mission Control, an accessibility reader and the bar the page draws
 * (`AppInfo.windowTitle`). ⚠️ Not in ⌘Tab or the Dock, which name APPS and never windows — which is
 * why a hidden launch leaves both (`app.dock.hide()`), rather than wearing a name there.
 */
export const HIDDEN_TITLE = 'BroCrew — test'

/** The line a hidden launch writes where a person's launch would have raised something. */
export const KEPT_OUT_OF_SIGHT = '[695] hidden launch: kept out of sight —'

export interface LaunchPresentation {
  /** ⚑ True only for a launch given `--brobot-hidden`. */
  readonly hidden: boolean
}

/** Read once, from the one command line this process was started with. */
export function launchPresentation(hasSwitch: (name: string) => boolean): LaunchPresentation {
  return { hidden: hasSwitch(HIDDEN_LAUNCH_SWITCH) }
}

/** The three things {@link keepOutOfSight} does to a window — a structural slice of `BrowserWindow`. */
export interface HideableWindow {
  setTitle(title: string): void
  on(event: 'page-title-updated', listener: (event: { preventDefault(): void }) => void): unknown
  readonly webContents: { setBackgroundThrottling(allowed: boolean): void }
}

/**
 * ⛔ **Everything a hidden launch does to its window, in one place** — called once, right after the
 * window is created, and only when the launch is hidden. Not showing it is the caller's `if`, beside
 * the `show()` it withholds.
 */
export function keepOutOfSight(window: HideableWindow): void {
  window.setTitle(HIDDEN_TITLE)
  // ⚠️ Electron retitles a window from its page's `<title>` unless this is prevented — and the page
  // says `BroBot2`, which is exactly the name a test window must not wear.
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.setBackgroundThrottling(false)
}

/**
 * 🔴 **724 · `718` F-1 — which data folder this launch runs on, when it is not the app's default** —
 * its last segment, or `null` when `userData` IS the default.
 *
 * A visible window using another `--user-data-dir` must identify that folder. The bar and OS title use {@link windowTitleFor}; main supplies the folder identity.
 *
 * ⛔ **Compared by IDENTITY, never by spelling.** Chromium hands the switch back resolved (`/tmp/x`
 * reads `/private/tmp/x`), a folder can be reached through a symlink, and on APFS two spellings that
 * differ only in case are one folder — so a string compare would call the default *another folder*
 * on exactly the launches that are the default. ⚑ Device and file id (`sameFolder`); ⚠️ and when
 * either side cannot be read (the default folder is created on first use) or a disk reports no
 * file id, the resolved paths — never a throw, because `readAppInfo` carries the build chip and
 * must not fail.
 *
 * ⚠️ **The last segment and not the path**: it goes into an OS window title (the Window menu,
 * Mission Control, a screen share), and a person needs to tell two windows apart, not read a home
 * directory. ⛔ Control and format characters are dropped, so a folder name cannot reorder or hide
 * the title it is shown in — and a segment with nothing left reads {@link A_FOLDER_WITH_NO_NAME}.
 */
export function otherDataFolder(userData: string, defaultUserData: string): string | null {
  // ⚠️ By a 64-bit file id (`sameFolder`): two folders read as one would have a non-default
  // workspace's update reopen the default (W4.128).
  if (sameFolder(userData, defaultUserData)) return null
  const folder = basename(resolve(userData)).replace(/[\p{Cc}\p{Cf}]/gu, '')
  // ⚠️ A last segment with nothing left in it names nothing — and never the path (review of `724`).
  return folder === '' ? A_FOLDER_WITH_NO_NAME : folder
}

/** ⚑ **724** — what the title says for a data folder whose last segment has no readable name. */
export const A_FOLDER_WITH_NO_NAME = 'another data folder'

/**
 * ⚑ **724 · the name a window wears in its own bar and in the OS** — `AppInfo.windowTitle`.
 *
 * | the launch | its title |
 * |---|---|
 * | a person's, on the default userData | `BroBot2` |
 * | a person's, on another folder | `BroBot2 — <folder>` ({@link otherDataFolder}) |
 * | a hidden one (`--brobot-hidden`), on any folder | `BroBot2 — test` |
 *
 * ⛔ **Hidden wins.** {@link keepOutOfSight} titles that window {@link HIDDEN_TITLE} and forbids the
 * page to retitle it, and every hidden launch runs on its own folder — so a folder here would make
 * the bar disagree with the OS title, and `smoke:ui` step 1w reads the bar as {@link HIDDEN_TITLE}.
 */
export function windowTitleFor(
  presentation: LaunchPresentation,
  dataFolder: string | null,
): string {
  if (presentation.hidden) return HIDDEN_TITLE
  return dataFolder === null ? PERSONS_TITLE : `${PERSONS_TITLE} — ${dataFolder}`
}
