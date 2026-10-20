import { watch, type InjectionKey } from 'vue'
import type { HandedPath } from '../../../shared/runtime-ipc'
import { conversationOfSlot, type SavedDrafts } from '../../../shared/saved-drafts'
import type { DraftBook, DraftSweep } from './drafts'

/**
 * # 🔴 744 · R100 — the draft book, kept across a restart
 *
 * Save unsent words and attached paths for every conversation, launcher and kept-open pane shortly after changes and on quit. Restore them to the same slots on launch before the composer draws.
 *
 * ⚠️ **The book is still the one owner of a draft** — this module only copies it out
 * ({@link keepDraftsOnDisk}) and puts the last run's copy back in ({@link restoreDrafts}); the screen
 * reaches both through {@link keepTheDraftBook}. Main holds the file (`main/drafts-file.ts`, which
 * says why it is a file and not `localStorage`).
 */

/**
 * ⚑ **How soon after a change the book is handed to main** — R100's *"a short debounce, well under
 * a second"*. ⚠️ **Counted from the FIRST unsaved change, not the last**, so steady typing is still
 * handed over every {@link DRAFT_SAVE_DELAY_MS}: a debounce that waited for a pause would keep nothing
 * of a paragraph typed without one, which is the draft most worth keeping.
 */
export const DRAFT_SAVE_DELAY_MS = 200

/**
 * ⚠️ **How long the window waits for the last run's drafts before it draws without them.** Main
 * reads one local file, so this is a backstop and not an expected wait — and a window that never
 * drew because a file never answered would be worse than a lost draft.
 */
export const SAVED_DRAFTS_WITHIN_MS = 3_000

/**
 * ⚑ **What the window was handed before it drew — ONCE.**
 *
 * `take()` answers the last run's drafts (or `null` when they could not be read) the first time, and
 * `undefined` every time after. ⚠️ **One-shot, because a component can mount twice in one page** — a
 * hot reload of the screen in a development window runs its setup again — and a second setup that
 * restored the LAUNCH's drafts would put back words sent since and save that stale book over the
 * file. ⚑ A later setup asks main again instead ({@link keepTheDraftBook}).
 */
export interface SavedDraftsHandoff {
  take(): SavedDrafts | null | undefined
  /** The original read may answer after the drawing deadline. */
  ready?: Promise<SavedDrafts | null>
}

export const SAVED_DRAFTS: InjectionKey<SavedDraftsHandoff> = Symbol('saved-drafts')

/** The handoff `main.ts` provides, over what it read before mounting. */
export function handOver(
  saved: SavedDrafts | null,
  ready?: Promise<SavedDrafts | null>,
): SavedDraftsHandoff {
  let taken = false
  return {
    ready,
    take() {
      if (taken) return undefined
      taken = true
      return saved
    },
  }
}

/**
 * ⚑ **Ask main for the last run's drafts, bounded** — `main.ts` calls it before the app mounts, so
 * every composer draws with its draft already in place (R100: *"restored on launch before the
 * composer draws"*).
 *
 * ⛔ **`null` means NOT READ — no bridge, an error, no answer in time, or main's own answer that the
 * file is there and cannot be read. No snapshot is saved until the original read succeeds;
 * drawing past the deadline does not discard its eventual answer.
 */
export async function savedDraftsBeforeDrawing(
  ask: (() => Promise<SavedDrafts | null>) | undefined,
  withinMs: number = SAVED_DRAFTS_WITHIN_MS,
): Promise<SavedDrafts | null> {
  if (ask === undefined) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), withinMs)
  })
  try {
    return await Promise.race([ask(), late])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Drawing may time out; a successful late read still starts draft saving. */
export async function draftHandoffBeforeDrawing(
  ask: (() => Promise<SavedDrafts | null>) | undefined,
  withinMs: number = SAVED_DRAFTS_WITHIN_MS,
): Promise<SavedDraftsHandoff> {
  const ready =
    ask === undefined
      ? Promise.resolve(null)
      : Promise.resolve()
          .then(ask)
          .catch(() => null)
  return handOver(await savedDraftsBeforeDrawing(() => ready, withinMs), ready)
}

/**
 * ⛔ **One attached path as plain data** — every field copied out, because the book holds Vue
 * proxies and a proxy cannot cross the bridge. ⚠️ `missing` is NOT copied: it is a fact about the
 * filesystem at a launch, and main decides it afresh at the next one.
 */
function plainHanded(handed: HandedPath): HandedPath {
  const { path, kind, outsideCwd, pasted } = handed
  return {
    path,
    kind,
    outsideCwd,
    ...(pasted === undefined
      ? {}
      : { pasted: { width: pasted.width, height: pasted.height, bytes: pasted.bytes } }),
  }
}

/**
 * ⚑ **The whole book as it goes to disk** — every slot holding words or paths, and only those: the
 * book already forgets an emptied slot, so a message that was SENT leaves nothing behind.
 */
export function draftsToSave(book: DraftBook): SavedDrafts {
  const slots = new Set([...book.keys(), ...book.paths.keys()])
  return {
    drafts: [...slots].map((slot) => ({
      slot,
      text: book.read(slot),
      attached: book.paths.read(slot).map(plainHanded),
    })),
  }
}

/**
 * ⛔ **The last run's drafts, back into their own slots** — through {@link DraftBook.restore}, the
 * one door that puts a message back, so words typed since are never overwritten.
 *
 * @returns the conversations those drafts belong to — for {@link DraftSweep.holdRestored}, without
 * which the launch's first sweep empties every one of them.
 */
export function restoreDrafts(book: DraftBook, saved: SavedDrafts): string[] {
  const conversations: string[] = []
  for (const draft of saved.drafts) {
    const conversation = conversationOfSlot(draft.slot)
    // ⛔ A slot this build cannot place is dropped rather than guessed at — never the wrong one.
    if (conversation === undefined) continue
    book.restore(draft.slot, draft.text, draft.attached)
    if (conversation !== null) conversations.push(conversation)
  }
  return conversations
}

export interface DraftKeeper {
  /** Hand the book and any explicit removals to main, cancelling the waiting save. */
  flush(cleared?: readonly string[]): void
  stop(): void
}

/**
 * 🔴 **Keep the book on disk** — {@link DRAFT_SAVE_DELAY_MS} after the first unsaved change; at
 * once when a slot EMPTIES, when the page goes away, and on every change once the app is closing;
 * and once more when the quit asks for the last book.
 *
 * ⚑ **A slot that empties is handed over at once** — a message was SENT (or cleared), and a kill
 * inside the delay would otherwise bring the sent words back as a draft, one press from being sent
 * twice. ⚑ **`pagehide`** is the last thing a window closed or reloaded without a quit hears.
 *
 * 🔴 **A quit asks TWICE** (744 review, rounds one and two). The announcement (`app:closing`) is
 * answered at once, and from then on every change goes at once too — a message the quit refuses is
 * put back in the book, and words typed under the closing shade are words. ⚑ Then, AFTER the
 * conversations are closed, main asks for the book once more (`onLastSave`) and waits for that one
 * (`QUIT_SAVE_WITHIN_MS`): every refusal that closing them produced has reached this window by
 * then, so the book it answers with is the one to keep. ⚠️ **Not a send or a start still on its way
 * PAST the close** — one waiting on a path check of a stalled volume, or a launch outliving the
 * close's own bound: its words are in the flight and in no book, and its refusal can come after the
 * app is gone. ⚠️ The sweep empties nothing while the app is closing (`sweepDrafts`), so the quit's
 * own endings never reach the file.
 *
 * ⛔ **A kill is announced by nothing**, which is why the delay is short: what was typed more than
 * {@link DRAFT_SAVE_DELAY_MS} before a kill has been handed to main (measured on the built app: back
 * after a kill half a second later).
 */
export function keepDraftsOnDisk(
  book: DraftBook,
  save: (saved: SavedDrafts) => Promise<void> | void,
  options: {
    closing: () => boolean
    delayMs?: number
    page?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
    /** Subscribe to the quit's request for the last book; answers the unsubscribe. */
    onLastSave?: (answer: () => void) => () => void
  },
): DraftKeeper {
  const delayMs = options.delayMs ?? DRAFT_SAVE_DELAY_MS
  const page = options.page ?? thisPage()
  let timer: ReturnType<typeof setTimeout> | null = null
  let previous = new Set(draftsToSave(book).drafts.map((draft) => draft.slot))
  const cleared = new Set<string>()
  const handOver = (last: boolean, removed: readonly string[] = []): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    try {
      const saved = draftsToSave(book)
      for (const slot of removed) cleared.add(slot)
      const present = new Set(saved.drafts.map((draft) => draft.slot))
      for (const slot of previous) if (!present.has(slot)) cleared.add(slot)
      for (const slot of present) cleared.delete(slot)
      const removals = [...cleared]
      cleared.clear()
      previous = new Set(saved.drafts.map((draft) => draft.slot))
      const packet = removals.length === 0 ? saved : { ...saved, cleared: removals }
      void Promise.resolve(save(last ? { ...packet, last: true } : packet)).catch(() => {
        for (const slot of removals) if (!previous.has(slot)) cleared.add(slot)
      })
    } catch {
      // A bridge that is gone is a window that is gone; there is nobody left to tell.
    }
  }
  const flush = (): void => handOver(false)
  // Remember removals even when a slot appears and empties before the save watcher runs.
  const stopWatchingRemovals = watch(
    () => [...new Set([...book.keys(), ...book.paths.keys()])],
    (now, before) => {
      const present = new Set(now)
      for (const slot of before) if (!present.has(slot)) cleared.add(slot)
      for (const slot of present) cleared.delete(slot)
    },
    { flush: 'sync' },
  )
  const stopWatchingBook = watch(
    () => draftsToSave(book),
    (now, before) => {
      const present = new Set(now.drafts.map((draft) => draft.slot))
      for (const slot of previous) if (!present.has(slot)) cleared.add(slot)
      for (const slot of present) cleared.delete(slot)
      const emptied =
        cleared.size > 0 ||
        before.drafts.some((draft) => !now.drafts.some((each) => each.slot === draft.slot))
      if (emptied || options.closing()) flush()
      else timer ??= setTimeout(flush, delayMs)
    },
  )
  const stopWatchingClosing = watch(options.closing, (closing) => {
    if (closing) flush()
  })
  const stopAnswering = options.onLastSave?.(() => handOver(true))
  page?.addEventListener('pagehide', flush)
  return {
    flush: (removed) => handOver(false, removed),
    stop() {
      stopWatchingRemovals()
      stopWatchingBook()
      stopWatchingClosing()
      stopAnswering?.()
      page?.removeEventListener('pagehide', flush)
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

/** The window's own page, where there is one — `pagehide` is heard there. */
function thisPage(): Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined {
  const global = globalThis as Partial<
    Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  >
  return typeof global.addEventListener === 'function' &&
    typeof global.removeEventListener === 'function'
    ? (global as Pick<EventTarget, 'addEventListener' | 'removeEventListener'>)
    : undefined
}

/** What the screen hands {@link keepTheDraftBook} of the preload's bridge. */
export interface DraftBridge {
  savedDrafts?: () => Promise<SavedDrafts | null>
  saveDrafts?: (saved: SavedDrafts) => Promise<void>
  onLastDraftSave?: (listener: () => void) => () => void
}

/**
 * 🔴 **The whole of R100, for one screen** — what `RuntimeScreen` calls, here where a test can run it
 * (nothing mounts `RuntimeScreen`).
 *
 * ⚑ **The first setup of the page** takes what `main.ts` read before mounting, restores it at once —
 * before anything draws — holds the conversations it restored, and keeps the book on disk from then
 * on. A later setup asks main again. Saving and the final-save listener are installed even if the
 * restore is slow or fails; main merges partial books and refuses to replace an unreadable file.
 */
export function keepTheDraftBook(options: {
  book: DraftBook
  sweep: Pick<DraftSweep, 'holdRestored'>
  handoff: SavedDraftsHandoff | null
  bridge: DraftBridge | undefined
  closing: () => boolean
  page?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}): { stop(): void } {
  const { book, sweep, handoff, bridge } = options
  const save = bridge?.saveDrafts
  let keeper: DraftKeeper | null = null
  let stopped = false
  let stopWaiting: (() => void) | undefined
  const keepFrom = (saved: SavedDrafts): void => {
    sweep.holdRestored(restoreDrafts(book, saved))
  }
  const restoreWhenReady = (ready: Promise<SavedDrafts | null>): void => {
    const touched = new Set(draftsToSave(book).drafts.map((draft) => draft.slot))
    stopWaiting = watch(
      () => draftsToSave(book),
      (now, before) => {
        for (const draft of [...now.drafts, ...before.drafts]) touched.add(draft.slot)
      },
      { flush: 'sync' },
    )
    void ready.then((saved) => {
      stopWaiting?.()
      if (saved !== null && !stopped) {
        keepFrom({ drafts: saved.drafts.filter((draft) => !touched.has(draft.slot)) })
        const latest = draftsToSave(book)
        const present = new Set(latest.drafts.map((draft) => draft.slot))
        const cleared = [...touched].filter((slot) => !present.has(slot))
        keeper?.flush(cleared)
      }
    })
  }
  const launch = handoff?.take()
  if (launch !== undefined && launch !== null) keepFrom(launch)
  else if (launch === null && handoff?.ready !== undefined) restoreWhenReady(handoff.ready)
  else if (launch === undefined && handoff !== null && bridge?.savedDrafts !== undefined) {
    restoreWhenReady(
      Promise.resolve()
        .then(bridge.savedDrafts)
        .catch(() => null),
    )
  }
  // Main merges individual slots and protects an unreadable file, so saving need not wait for restore.
  if (save !== undefined) {
    keeper = keepDraftsOnDisk(book, (latest) => save(latest), {
      closing: options.closing,
      page: options.page,
      onLastSave: bridge?.onLastDraftSave,
    })
  }
  return {
    stop() {
      stopped = true
      stopWaiting?.()
      // ⚑ Handed over as it stops, so a setup that follows reads this book rather than an older one.
      keeper?.flush()
      keeper?.stop()
    },
  }
}
