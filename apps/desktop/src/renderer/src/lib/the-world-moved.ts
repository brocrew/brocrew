import { appClosing } from './app-closing'
import type { RuntimeChangeMessage, RuntimeChangeSubject } from '../../../shared/runtime-ipc'

/**
 * 🔴 **The window learns that something it LISTS has moved** (534) — the renderer half of
 * `RUNTIME_CHANGED_CHANNEL`.
 *
 * ## ⛔ What was wrong, in one sentence
 *
 * ⚠️ **Every list in the rail is a pull, and until this module every one of them was refreshed only
 * by an act the window itself performed.** `SideRail.refreshClosed` runs `onMounted` and on a
 * hand-maintained roster of gestures — a conversation ending in this window, a hand-back, a
 * take-over — and `AgentStore.load` ran at mount, on an approved proposal and on a launch this
 * window made. ⛔ **A conversation an AGENT spawns is none of those.** It is reserved under no
 * owner, its events go to a discard sink, and no gesture happens here at all — so the rail's
 * *Not open in this window* section never learned that a project manager had been working for a
 * minute, which is what `534` reported.
 *
 * ⚑ **HO-013 §3 names the shape**: *"a rule that must be remembered each time is a rule that will
 * eventually be forgotten."* The roster of gestures IS that rule, and a spawn is the one moment
 * nobody could have added to it, because there is no gesture to hang it on.
 *
 * ## ⚑ Why this is a module and not four lines in `RuntimeScreen`
 *
 * ⛔ **Nothing in this repository mounts `RuntimeScreen`** — `attention-open.dom.test.ts` records
 * it — so a rule written there is a rule no test can drive. ⚑ So the screen owns the wiring and the
 * module owns the rule.
 *
 * ## 🔴 The three rules it holds
 *
 *  1. ⛔ **A subject it does not know is DROPPED, and nothing else is affected.** The vocabulary is
 *     a wire contract; a window running against a newer main must not have to decide what a
 *     partially-understood message means. ⚠️ Every message carries exactly one subject for that
 *     reason — see {@link RuntimeChangeMessage}.
 *  2. ⛔ **Nothing is asked while the app is closing.** `272` finding 1 measured this precisely:
 *     `closeAll()` ends every conversation and the lists re-read themselves onto a database the
 *     quit has already shut. ⚠️ **The quit announces every one of those endings**, so without this
 *     guard this module would reproduce `272` with a wider aperture — and main REFUSES the reads
 *     (`agentIdentities`, `listResumable`, `listUnresumable` are all `'refused'` in `DURING_A_QUIT`),
 *     which Electron `console.error`s with a full stack. ⛔ `273` §0's standard is that *"a clean
 *     quit emits a handler exception, and that is a thing this project does not ship."*
 *  3. ⛔ **Every subject has a reader, by TYPE.** `readers` is an exhaustive `Record`, so adding a
 *     member to {@link RuntimeChangeSubject} is a compile error until somebody says what to re-read
 *     — which is the half the sender cannot enforce.
 *
 * ## ⚠️ What it deliberately does NOT do
 *
 * ⛔ **It does not coalesce.** A registration announces twice — a conversation and an identity are
 * written by one call — and an ending announces twice more. ⚑ Collapsing them HERE would need a
 * window of time, and a window of time is a number nobody has measured (standing rule 22).
 * ⚠️ **678 · *"each of those is one small read"* was not true of all of them**, measured (`678` §4,
 * 200 conversations × 2,000 events): the workspace reading is 155 ms, the room's 88 ms and the Team
 * page's forest 130 ms. ⚑ **So those three READERS coalesce themselves** — `oneReadAtATime`, one read
 * in the air and one owed, with no window of time — and the rest, each under 5 ms, do not.
 *
 * ⛔ **It does not fold anything.** The message carries no state and this returns none: the window
 * asks the question it already asks, and the answer is always the whole answer — which is why a
 * missed message costs one stale interval rather than a gap somebody has to reconcile.
 */
export function whenTheWorldMoves(
  subscribe: (listener: (message: RuntimeChangeMessage) => void) => () => void,
  readers: Readonly<Record<RuntimeChangeSubject, () => void>>,
  /**
   * ⚠️ **Injected with a default rather than read straight off the module**, because
   * {@link beginClosing} is one-way: a test that drove the real ref would poison every test after
   * it in the same file. The default is the real answer and the only one the app ever passes.
   */
  isClosing: () => boolean = () => appClosing.value,
): () => void {
  return subscribe((message) => {
    if (isClosing()) return
    // ⛔ **`Object.hasOwn` and not a truthiness check on the lookup.** A subject that is not a key
    // reaches `readers[what]` as `undefined`, and `undefined()` throws INSIDE an IPC listener —
    // which Electron reports against the channel rather than against this line.
    if (!Object.hasOwn(readers, message.what)) return
    readers[message.what]()
  })
}
