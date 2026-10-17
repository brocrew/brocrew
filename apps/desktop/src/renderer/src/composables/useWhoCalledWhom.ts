import { ref, type Ref } from 'vue'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import type { RailSays } from '../lib/agent-state'
import type { FilesRead } from '../lib/files-kept'
import type { CastReading } from '../lib/working-together'
import type { ResumableSessionInfo } from '../../../shared/runtime-ipc'
import type { ListedConversation } from '../lib/conversation-list'

export type RunningConversation = Pick<ResumableSessionInfo, 'sessionId' | 'provider' | 'state'>

/**
 * 🔴 **The window's one answer to *who called whom*, and the one prop channel that could not be a
 * prop** (547).
 *
 * ## ⛔ Why this file exists, stated rather than discovered
 *
 * ⚠️ **Every other reading a drawer tab draws arrives as a PROP** — `RuntimeScreen` owns the poll,
 * `ConversationPane` forwards it, `SessionDrawer` hands it to the body that draws it. ⛔ **`547`
 * may not touch `ConversationPane.vue`** (its brief §1.1: `545` is in flight on the rows inside it),
 * and that file is the only hop between the screen that owns polls and the drawer that mounts this
 * band. ⚑ **So the poll stayed exactly where the convention puts it** — `RuntimeScreen`, beside the
 * queue's, the digest's, the roster's and the Work tab's — and only the TRANSPORT moved.
 *
 * 🔴 **What it would be instead:** three lines in `ConversationPane.vue` — a prop, its docblock, and
 * one binding on `<SessionDrawer>`. ⚠️ **547 F5**, and the PM can close it in the merge that lands
 * `545`.
 *
 * ⛔ **551 · it did not close, and the pane reads it too.** `ConversationPane.vue` reads the same
 * value itself — the Graph's door, the work a give's card finds, the Files tab — and is no longer
 * out of bounds. ⚠️ **The prop hop still is**: it needs one binding in `RuntimeScreen.vue`, and
 * `550` is in that file (551 §5). 🔴 **So F5 stays open, and the pane moves with the drawer** —
 * the pane would take the prop and hand it on, and neither reader would change a line of its own.
 *
 * ## ⚑ Why a ref and not a store
 *
 * ⛔ **It holds no bridge and asks nobody anything.** `agent-store.ts` and `session-store.ts` are
 * stores because they OWN a conversation with the main process; this owns the values a band draws
 * and what a press should do. ⚠️ A
 * `createX(bridge)` here would move the cadence out of
 * `RuntimeScreen`, which is the thing this file exists to avoid doing.
 *
 * ⚠️ **A singleton for `useSessionStore`'s reason, one axis over**: two of these would be two
 * answers to *who did this conversation spawn* on one screen, and the drawer and the screen would
 * disagree the moment either wrote. ⛔ Nothing is read at import time, so a module graph that
 * touches this pays nothing.
 */
export interface TheCast {
  /** Existing rail listing, including stopped conversations and their recorded worker bindings. */
  readonly listedConversations: Ref<readonly ListedConversation[] | null>
  /** The rail's running conversations and current host states, on every page; null until read. */
  readonly runningConversations: Ref<readonly RunningConversation[] | null>
  /**
   * ⚑ **`null` is *nothing has been read for this conversation yet*** and is not an empty band —
   * `434`'s distinction, and the state every real drawer is in on its first frame.
   */
  readonly reading: Ref<CastReading | null>
  /** The conversation whose relationship read is in flight, independent of refinements. */
  readonly loadingFor: Ref<string | null>
  /**
   * 🔴 **Take a person to one of these conversations** — `RuntimeScreen.goToTheWork`, the door
   * `506` built and the transcript's work report already presses.
   *
   * ⛔ **`null` until a screen supplies one, and a band draws NO press while it is null.** `118`'s
   * rule: a control is absent where nothing would make it work — and a drawer mounted by a render
   * test has no screen above it, so the absence is the ordinary case rather than a guard.
   *
   * ⚑ **UI-006 · every press on an agent selects through it** (F045) — a Graph card, a chip, the way
   * up. ⚠️ **One press** (D-017b): it claims only a running conversation no window holds, opens one
   * another window holds as a recorded view, and the refusal comes back in the host's own
   * sentences. ⛔ Nothing is reported as done here; the screen selects only once the door answered,
   * which is rule 18.
   */
  readonly goTo: Ref<((conversation: string) => void) | null>
  /**
   * ⚑ **The whole forest, for the Graph tab** — the band's own reading names only this
   * conversation's children; this names who spawned whom everywhere, so the Graph can draw everyone
   * from the top down. ⛔ `null` until the first read lands, and kept last-good when a read fails.
   */
  readonly forest: Ref<TheWholeForest | null>
  /**
   * ⚑ **UI-001 · what the rail's row says of each conversation** — its plate and its word, keyed by
   * conversation. A card under the strip draws its agent from here, so the right panel and the rail
   * say one thing; a row the window is not fed is the host's one state, `get_agent_status`'s own.
   * ⛔ `null` where no rail is on screen, and the band then draws its own reading.
   */
  readonly railSays: Ref<ReadonlyMap<string, RailSays> | null>
  /**
   * ⚑ **D-018 · the memory each running conversation's process holds**, in bytes by conversation,
   * as the last read said — a card draws its own conversation's figure, and nothing where this has
   * none. ⛔ A person's alone: no agent reads it (`05` rule 5).
   */
  readonly processMemory: Ref<ReadonlyMap<string, number>>
  /**
   * Main's sentence where the last read could measure no process at all, else null. With it set, a
   * conversation with no figure is not said to be stopped.
   */
  readonly memoryUnmeasured: Ref<string | null>
  /**
   * ⚑ **UI-002 · every file kept in the tree of the conversation on screen** — D-026's `filesKept`
   * `tree` scope: the pieces it holds or gave and everything under them. Read with the band's
   * triggers and again the moment the states channel says a file was kept. ⛔ `null`: nothing has
   * been read for this conversation yet, which is not an empty list.
   */
  readonly treeFiles: Ref<FilesRead | null>
  /**
   * ⚑ **UI-002 · the files the card's agent added** — what it made and the inputs it handed over
   * (`filesKept`'s `conversation` scope), for the conversation on screen: the selected agent, whose
   * card the right panel draws. ⛔ `null`: not read yet.
   */
  readonly cardFiles: Ref<FilesRead | null>
}

/** ⚑ One rail row's plate and word — {@link TheCast.railSays}; declared beside the plate's type. */
export type { RailSays } from '../lib/agent-state'

let shared: TheCast | null = null

export function useWhoCalledWhom(): TheCast {
  shared ??= {
    listedConversations: ref<readonly ListedConversation[] | null>(null),
    runningConversations: ref<readonly RunningConversation[] | null>(null),
    reading: ref<CastReading | null>(null),
    loadingFor: ref<string | null>(null),
    goTo: ref<((conversation: string) => void) | null>(null),
    forest: ref<TheWholeForest | null>(null),
    railSays: ref<ReadonlyMap<string, RailSays> | null>(null),
    processMemory: ref<ReadonlyMap<string, number>>(new Map()),
    memoryUnmeasured: ref<string | null>(null),
    treeFiles: ref<FilesRead | null>(null),
    cardFiles: ref<FilesRead | null>(null),
  }
  return shared
}

// Hot reload re-evaluates this module and forgets the value. Explicit, so the next caller gets *nothing has been read* rather than a band belonging to a
// conversation a new screen has never heard of.
import.meta.hot?.dispose(() => {
  shared = null
})
