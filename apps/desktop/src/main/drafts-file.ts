import { randomBytes } from 'node:crypto'
import { lutimesSync, readFileSync, realpathSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPastedImage } from '../shared/runtime-ipc'
import { conversationOfSlot, type SavedDraft, type SavedDrafts } from '../shared/saved-drafts'
import { pastedImagesRoot } from './runtime/pasted-image'
import { savedDraftsFrom } from './saved-drafts'

/**
 * # 🔴 744 · R100 — the ONE file the unsent drafts are kept in, and everything that touches it
 *
 * ⚑ **A file of the app's own userData, not the renderer's `localStorage`, and the reason is
 * measured** (`scripts/draft-survives-a-restart-probe.mjs`, its `kill-0.5s` arm): Chromium commits
 * `localStorage` to disk some time after a write, and a key written and then killed half a second
 * later was not there on the next launch — while it was there after a quit and after a kill six
 * seconds later. ⚑ This file is written under a private name and RENAMED into place, so what is on
 * disk is always one whole book, never half of one.
 *
 * ⛔ **Nothing here sends anything anywhere.** It reads and writes `<userData>/drafts.json`, removes
 * its own leftover part files, and keeps the pictures a kept draft names from ageing out (below).
 * ⚠️ **What the file SAYS is decided in `saved-drafts.ts`**, which touches no file: this module hands
 * it the parsed JSON and nothing more.
 */

/** Where the drafts live — beside the database, in the app's own userData. */
export const SAVED_DRAFTS_FILE = 'drafts.json'

/** The private name one save is written to before it is renamed into place. */
export const DRAFTS_PART = /^drafts\.json\.[0-9a-f]{12}\.part$/

/**
 * The version this build writes, which earlier builds still check. This build's read ignores it and
 * keeps whatever drafts it recognises, so switching builds never stops drafts being restored or saved.
 */
export const DRAFTS_FILE_VERSION = 1

/**
 * ⚑ **How long a quit waits for each window's LAST save** — the one it hands over when main asks,
 * after the conversations are closed (`app:last-draft-save`). Bounded: a window too wedged to answer
 * must not hold the quit. A save that comes or finishes later is still written while the app lives.
 */
export const QUIT_SAVE_WITHIN_MS = 1_000

/** The file's own path. */
export function savedDraftsPath(userData: string): string {
  return join(userData, SAVED_DRAFTS_FILE)
}

/** What reading the file found. */
export type DraftsFile =
  | { kind: 'book'; raw: unknown }
  | { kind: 'none' }
  /** ⛔ There, and its bytes could not be read — so nothing is restored AND nothing saved over it. */
  | { kind: 'unreadable'; why: string }

/**
 * ⛔ **The file, as far as this build can read it.**
 *
 * ⚑ **None** when there is no file, or when it is not JSON — which a rename-written file cannot be
 * halfway to, so nothing of this app's is lost by writing over it.
 *
 * ⚑ **A book whichever build wrote it**: `savedDraftsFrom` keeps the drafts it recognises, and every
 * save writes the rest back unchanged ({@link bookToWrite}).
 *
 * ⚠️ **Unreadable when it is there and could not be read (`EACCES`, `EIO`, a directory)**: that is
 * not an empty book, and a window told it was would save its own empty book over drafts it never
 * saw. ⚑ The renderer is then answered *not read*, restores nothing, and saves nothing this run.
 */
export async function readDraftsFile(userData: string): Promise<DraftsFile> {
  let text: string
  try {
    text = await readFile(savedDraftsPath(userData), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
    return { kind: 'unreadable', why: (error as NodeJS.ErrnoException).code ?? 'unreadable' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'none' }
  }
  return { kind: 'book', raw }
}

export interface DraftWriter {
  /**
   * Merge recognised slots and explicit removals once the write in flight is done. A book marked
   * `last` answers the quit's request; an omitted slot never clears a previously saved draft.
   */
  write(raw: unknown): Promise<void>
  /**
   * ⚑ **Resolve once no write is in flight** — the read waits on it, so a window that hands over its
   * book and then asks for the saved one (a reload) reads what it just handed over.
   */
  settled(): Promise<void>
  /** The quit has asked `windows` windows for their last save: count the books marked `last`. */
  expectQuitSaves(windows: number): void
  /**
   * ⚑ **Resolve once that many `last` books have arrived and nothing is being written**, or after
   * `withinMs` — `saved`, `failed` (the last write did not reach the disk) or `unanswered`, so the
   * quit can say which. Saves still on their way after that are written all the same.
   */
  quitSaves(withinMs: number): Promise<'saved' | 'failed' | 'unanswered'>
}

/**
 * ⚑ **The file to write: this build's drafts, and everything else the file held left as it was.**
 * Another build may keep fields and entries this one does not read; a save here never drops them.
 * An entry of a slot this build reads is replaced by this build's draft (keeping that entry's other
 * fields) or, when the slot holds none any more, removed. Every other entry is written back unchanged.
 */
function bookToWrite(
  found: unknown,
  drafts: readonly SavedDraft[],
): Record<string, unknown> {
  const file =
    typeof found === 'object' && found !== null && !Array.isArray(found)
      ? (found as Record<string, unknown>)
      : {}
  const listed: unknown[] = Array.isArray(file.drafts) ? file.drafts : []
  const slotOf = (entry: unknown): unknown =>
    typeof entry === 'object' && entry !== null
      ? (entry as Record<string, unknown>).slot
      : undefined
  const read = new Set(savedDraftsFrom(found).drafts.map((draft) => draft.slot))
  const written = new Set(drafts.map((draft) => draft.slot))
  const entryOf = new Map<unknown, object>()
  for (const entry of listed) {
    if (read.has(slotOf(entry) as string) && !entryOf.has(slotOf(entry))) {
      entryOf.set(slotOf(entry), entry as object)
    }
  }
  const untouched = listed.filter((entry) => {
    const slot = slotOf(entry) as string
    return !read.has(slot) && !written.has(slot)
  })
  return {
    ...file,
    version: DRAFTS_FILE_VERSION,
    drafts: [...drafts.map((draft) => ({ ...entryOf.get(draft.slot), ...draft })), ...untouched],
  }
}

/**
 * ⚑ **The one writer of the file** — each save written whole under a private name and RENAMED into
 * place (`pasted-image.ts`' rule, for its reason), readable by this user only (`0600`: what somebody
 * typed and did not send).
 *
 * Saves arriving during a write are merged by slot, with the newest value winning. Only an
 * explicit removal clears a slot; a missing slot in an incomplete handover loses nothing.
 * Quit snapshots cannot clear slots.
 *
 * ⚑ **A part file an earlier run left — a kill inside a write — is removed before the first write of
 * this one**: it holds somebody's words, and nothing else would ever look at it.
 */
export function createDraftWriter(userData: string): DraftWriter {
  let pending: SavedDrafts | null = null
  let kept: SavedDrafts = { drafts: [] }
  // What the file held at start, so what this build does not read is written back with every save.
  let found: unknown = null
  let quitting = false
  let writing: Promise<void> | null = null
  let expected = 0
  let arrived = 0
  // ⚑ Whether the most recent write reached the disk — what a quit that waited for it reports.
  let loaded = false
  let accepted = 0
  let saved = 0
  let lastSavedAt: number | null = null
  let lastFailed = false
  const listeners = new Set<() => void>()
  const tell = (): void => {
    for (const listener of listeners) listener()
  }

  const leftovers: Promise<void> = (async () => {
    // ⚑ The drafts file's own siblings — the folder it lives in, named from it.
    const folder = dirname(savedDraftsPath(userData))
    try {
      for (const name of await readdir(folder)) {
        if (DRAFTS_PART.test(name)) await rm(join(folder, name), { force: true })
      }
    } catch {
      // A userData this process cannot list is not a reason to lose the next save.
    }
  })()

  const initial = readDraftsFile(userData)

  async function writeOnce(saved: SavedDrafts): Promise<boolean> {
    const path = savedDraftsPath(userData)
    const part = `${path}.${randomBytes(6).toString('hex')}.part`
    try {
      await writeFile(part, JSON.stringify(bookToWrite(found, saved.drafts)), {
        mode: 0o600,
      })
      await rename(part, path)
      return true
    } catch (error) {
      console.warn(`the unsent drafts could not be saved: ${String(error)}`)
      await rm(part, { force: true }).catch(() => undefined)
      return false
    }
  }

  return {
    write(raw) {
      if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as SavedDrafts).drafts))
        return Promise.resolve()
      accepted += 1
      const packet = raw as SavedDrafts
      const slots = new Map(pending?.drafts.map((draft) => [draft.slot, draft]))
      const cleared = new Set(pending?.cleared)
      if (!quitting && Array.isArray(packet.cleared)) {
        for (const slot of packet.cleared) {
          if (typeof slot !== 'string' || conversationOfSlot(slot) === undefined) continue
          slots.delete(slot)
          cleared.add(slot)
        }
      }
      for (const draft of savedDraftsFrom(raw).drafts) {
        slots.set(draft.slot, draft)
        cleared.delete(draft.slot)
      }
      pending = { drafts: [...slots.values()], cleared: [...cleared] }
      if (expected > 0 && packet.last === true) arrived += 1
      if (writing === null) {
        writing = (async () => {
          try {
            await leftovers
            const file = await initial
            if (file.kind === 'unreadable') {
              pending = null
              lastFailed = true
              return
            }
            if (!loaded) {
              found = file.kind === 'book' ? file.raw : null
              kept = savedDraftsFrom(found)
              loaded = true
            }
            while (pending !== null) {
              const slots = new Map(kept.drafts.map((draft) => [draft.slot, draft]))
              const packet = pending
              pending = null
              for (const slot of packet.cleared ?? []) slots.delete(slot)
              for (const draft of packet.drafts) slots.set(draft.slot, draft)
              const next = { drafts: [...slots.values()] }
              lastFailed = !(await writeOnce(next))
              if (lastFailed) {
                // More changes can arrive while the disk write is awaiting an answer.
                const waiting = pending as SavedDrafts | null
                const retained = new Map(packet.drafts.map((draft) => [draft.slot, draft]))
                const cleared = new Set(packet.cleared)
                for (const slot of waiting?.cleared ?? []) {
                  retained.delete(slot)
                  cleared.add(slot)
                }
                for (const draft of waiting?.drafts ?? []) {
                  retained.set(draft.slot, draft)
                  cleared.delete(draft.slot)
                }
                pending = { drafts: [...retained.values()], cleared: [...cleared] }
                break
              }
              kept = next
              saved += 1
              lastSavedAt = Date.now()
            }
          } finally {
            writing = null
            tell()
          }
        })()
      }
      return writing
    },

    settled() {
      return writing ?? Promise.resolve()
    },

    expectQuitSaves(windows) {
      console.info(
        'BroCrew draft save status:',
        JSON.stringify({
          accepted,
          saved,
          lastSavedAt,
          loaded,
          slots: kept.drafts.map((draft) => ({
            slot: draft.slot,
            characters: draft.text.length,
            attachments: draft.attached.length,
          })),
          characters: kept.drafts.reduce((sum, draft) => sum + draft.text.length, 0),
          pending: pending?.drafts.length ?? 0,
          writing: writing !== null,
        }),
      )
      quitting = true
      expected = windows
      arrived = 0
    },

    quitSaves(withinMs) {
      const done = (): boolean => arrived >= expected && writing === null
      if (done()) return Promise.resolve(lastFailed ? 'failed' : 'saved')
      return new Promise((resolve) => {
        const check = (): void => {
          if (!done()) return
          finish(lastFailed ? 'failed' : 'saved')
        }
        const timer = setTimeout(() => finish('unanswered'), withinMs)
        function finish(outcome: 'saved' | 'failed' | 'unanswered'): void {
          clearTimeout(timer)
          listeners.delete(check)
          resolve(outcome)
        }
        listeners.add(check)
      })
    },
  }
}

/**
 * 🔴 **Keep the pictures a kept draft names from ageing out — before the start-up sweep reads their
 * age** (744, from `254` §2's sweep).
 *
 * ⚠️ **The sweep deletes a pasted picture a week after it was last written**, and until `744` a draft
 * could not outlive the run it was typed in, so the start-up sweep could never reach one a draft still
 * named. ⛔ Now a draft comes back after a restart, and its picture with it — so every picture the
 * kept book names is touched here, and the sweep that follows sees it as used today.
 *
 * ⛔ **Only BroBot's OWN pictures**: a path is touched only when it is a pasted picture's name inside
 * the pasted-images folder beside this userData. A file somebody attached from their own disk is
 * never touched.
 *
 * ⚠️ **Synchronous, at start, before any window exists** — it reads one local file of the app's own
 * and stamps a handful of its own pictures, and it must finish before the sweep on the next line
 * starts. Never fatal. ⚠️ **`lutimes`, not `utimes`**: a link named like a picture in that folder is
 * stamped itself and never followed — the sweep removes a link by name for the same reason.
 *
 * @returns how many pictures were kept.
 */
export function keepDraftedPastes(userData: string, now: number): number {
  let root: string
  let parsed: unknown
  try {
    root = realpathSync(pastedImagesRoot(userData))
    parsed = JSON.parse(readFileSync(savedDraftsPath(userData), 'utf8'))
  } catch {
    return 0
  }
  let kept = 0
  const when = new Date(now)
  for (const draft of savedDraftsFrom(parsed).drafts) {
    for (const handed of draft.attached) {
      if (!isPastedImage(handed.path) || dirname(handed.path) !== root) continue
      try {
        lutimesSync(handed.path, when, when)
        kept += 1
      } catch {
        // Gone already — the restore will say so on its chip.
      }
    }
  }
  return kept
}
