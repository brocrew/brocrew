import { readonly, ref } from 'vue'

/**
 * 🔴 **The renderer's copy of "main is closing"** (273 §2, from `272` finding 1).
 *
 * ## ⛔ Why this is not just `App.vue`'s shade flag
 *
 * 271 gave the app a closing announcement and one reader: the shade that covers the window. `272`
 * then found that the window is not the only thing that should hear it. Its finding 1 reproduced
 * twice on clean quits — *"After `close its database`, the old process logged one failed
 * `runtime:command` query for resumable sessions and one for unresumable sessions"* — and the pair
 * is not a coincidence: `closeAll()` ends every conversation, each emits its terminal event,
 * `RuntimeScreen` watches the open list's length, and both closed-conversation lists re-read
 * themselves. ⚑ **The quit is what asks the question the quit is about to be unable to answer.**
 *
 * ⚠️ **Main refuses those asks now too**, and that is the boundary's own guarantee rather than a
 * duplicate of this one — see `DURING_A_QUIT` in `main/runtime/ipc.ts`. ⛔ **But a refusal is not
 * silence.** Electron `console.error`s every rejected `ipcMain.handle` with a full stack — measured
 * on the shipped entry, not assumed — so a door alone would trade `The database connection is not
 * open` for a stack trace on every quit with a conversation open, and `273` §0's standard is *"a
 * clean quit emits a handler exception, and that is a thing this project does not ship."* The
 * explorer's own sentence offers both halves: renderer polls *"should either stop or receive the
 * deliberate shutting-down result"*. This is the stopping half.
 *
 * ## ⚑ Module state, on purpose
 *
 * One `ref` at module scope rather than a provide/inject or a prop threaded through four components.
 * The fact is about the PROCESS, not about any component's subtree: every surface in this window has
 * the same answer, it is set once, and there is no second window in this renderer to confuse it with.
 * ⛔ **Set once and never cleared** — a quit that has begun cannot be cancelled, which is why the
 * exported ref is `readonly` and the only way in is {@link beginClosing}.
 */
const closing = ref(false)

/**
 * Whether main has said the app is closing. `false` until it does, forever after it has.
 *
 * ⚠️ **Readonly deliberately.** The only writer is {@link beginClosing}, called from the one place
 * subscribed to `app:closing`; a component that could set this could put the app into a state main
 * is not in, and the shade would be telling the truth about nothing.
 */
export const appClosing = readonly(closing)

/**
 * Main said so. Idempotent, because the `app:closing` announcement may reach a window more than once
 * and there is no way back from the first one.
 */
export function beginClosing(): void {
  closing.value = true
}
