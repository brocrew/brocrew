/**
 * 🔴 **The three window controls, now that the window has no frame to draw them** (385 §1).
 *
 * ## ⛔ What was there before this file
 *
 * `384` photographed the shipped window and found **two title bars**: macOS's own, and ours 32px
 * below it — measured, on the pre-385 build: `outerHeight` 840, `innerHeight` 808, so the OS frame
 * took exactly 32 of the window's declared height. Ours drew **three `<span>`s inside an
 * `aria-hidden` div, with no handler and no `-webkit-app-region` of their own**, coloured like
 * traffic lights. Clicking all three, over CDP, on that build: `visibilityState` unchanged,
 * `outerWidth`/`outerHeight` unchanged, the process still running. ⚑ **They were a picture of
 * controls.**
 *
 * A frameless window needs working minimize, maximize and close controls in the app's own bar.
 *
 * ## ⚑ Why the verbs are Electron's spelling and the labels are not
 *
 * {@link WINDOW_CONTROLS} is `close · minimize · zoom`, which is `BrowserWindow.close()`,
 * `.minimize()` and macOS's Zoom — and it is the same triple, in the same order, as the **Window
 * menu this app already ships** (`app-menu.ts`: `role: 'minimize'`, `role: 'zoom'`, `role: 'close'`).
 * ⚠️ That menu is not decoration: it works today, with its keyboard shortcuts, and it is the
 * INCUMBENT this contract has to agree with. Two spellings of one gesture are free to disagree, so
 * the wire says what Electron says.
 *
 * ⚑ **What a person READS is British** — *"Minimise"* — because that is this product's voice
 * everywhere else. A label and a verb are different things and only one of them is a wire.
 *
 * ## ⛔ Zoom is not full screen, and the difference is a real one on macOS
 *
 * macOS's green button has meant *enter full screen* since 10.10, with **⌥-click** for the older
 * zoom. ⚠️ **This one zooms**, like the Window menu's `role: 'zoom'` beside it, and
 * `applyWindowControl` additionally treats it as *leave full screen* when the window is in one —
 * because with no frame there is no OS control to leave with, and `View → Enter Full Screen`
 * (⌃⌘F) is a way in that a person must have a way out of. **Full screen is entered from the menu
 * and left from either.**
 *
 * ## ⚑ Why the contract is here and the behaviour is in `main/window-controls.ts`
 *
 * Split for the same reason `shared/runtime-ipc.ts` is split from `main/runtime/ipc.ts`: the
 * preload is sandboxed and imports only `../shared`, so the channel name and the vocabulary have to
 * be reachable from there — and `BrowserWindow` must never be.
 *
 * 🔒 Nothing here is privileged: closing, minimising and zooming a window are things the person
 * sitting in front of it can already do from the menu bar. What the main side is careful about is
 * WHICH window — it answers from the sender's own `WebContents` and never from a captured
 * reference, so a second window could never be moved by the first.
 */
export const WINDOW_CONTROL_CHANNEL = 'app:window-control'

/**
 * The closed vocabulary of this channel.
 *
 * ⚠️ **A closed vocabulary guards what its members say.** Anything else that arrives on the channel
 * is refused by {@link isWindowControl} rather than defaulted to something plausible — a control
 * that did the nearest thing to what it was asked is worse than one that did nothing, because the
 * nearest thing to `minimize` is a window that vanished.
 *
 * ⛔ **The ORDER is load-bearing**: it is the order the buttons are drawn in, left to right, because
 * `WindowControls.vue` iterates this list and keeps no second one. Close · minimise · zoom is
 * macOS's own order and v2.3's, and a person reaches for the position rather than for the word.
 */
export const WINDOW_CONTROLS = ['close', 'minimize', 'zoom'] as const

export type WindowControl = (typeof WINDOW_CONTROLS)[number]

export function isWindowControl(value: unknown): value is WindowControl {
  return typeof value === 'string' && (WINDOW_CONTROLS as readonly string[]).includes(value)
}

/**
 * What the main side did — the branch, not the verb.
 *
 * ⚑ **`zoom` has three of them and that is the whole reason the handler returns anything.** A test
 * that only saw `zoom` go in could not tell a window that maximised from one that left full screen
 * from one that did nothing at all, and those are three different screens.
 */
export type WindowControlEffect =
  | 'closed'
  | 'minimized'
  | 'maximized'
  | 'unmaximized'
  | 'left-full-screen'
  /** The window went away between the click and the handler — see `applyWindowControl`. */
  | 'gone'
