import { randomBytes } from 'node:crypto'
import { lutimesSync, readFileSync, realpathSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPastedImage } from '../shared/runtime-ipc'
import { conversationOfSlot, type SavedDrafts } from '../shared/saved-drafts'
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

/** The shape this build writes, and the only one it reads. */
export const DRAFTS_FILE_VERSION = 1

/**
 * ⚑ **How long a quit waits for each window's LAST save** — the one it hands over when main asks,
 * after the conversations are closed (`app:last-draft-save`). Bounded: a window too wedged to answer
 * must not hold the quit; one that does not answer costs what changed since its last save.
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
  /** ⛔ There, and not readable by this build — so nothing is restored AND nothing saved over it. */
  | { kind: 'unreadable'; why: string }

/**
 * ⛔ **The file, as far as this build can read it.**
 *
 * ⚑ **None** when there is no file, or when it is not JSON — which a rename-written file cannot be
 * halfway to, so nothing of this app's is lost by writing over it.
 *
 * ⚠️ **Unreadable when it is there and could not be read (`EACCES`, `EIO`, a directory), or when a
 * DIFFERENT build wrote it** (another `version`): that is not an empty book, and a window told it
 * was would save its own empty book over drafts it never saw. ⚑ The renderer is then answered
 * *not read*, restores nothing, and saves nothing this run; the file is left for a build that can.
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
  const version =
    typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined
  if (version !== DRAFTS_FILE_VERSION) {
    return {
      kind: 'unreadable',
      why: `written as version ${String(version)}, not ${String(DRAFTS_FILE_VERSION)}`,
    }
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
   * quit can say which.
   */
  quitSaves(withinMs: number): Promise<'saved' | 'failed' | 'unanswered'>
}

/**
 * ⚑ **The one writer of the file** — each save written whole under a private name and RENAMED into
 * place (`pasted-image.ts`' rule, for its reason), readable by this user only (`0600`: what somebody
 * typed and did not send).
 *
 * Saves arriving during a write are merged by slot, with the newest value winning. Only an
 * explicit removal clears a slot; a missing slot in an incomplete handover loses nothing.
 * Quit snapshots cannot clear slots, and snapshots arriving past the quit deadline are ignored.
 *
 * ⚑ **A part file an earlier run left — a kill inside a write — is removed before the first write of
 * this one**: it holds somebody's words, and nothing else would ever look at it.
 */
export function createDraftWriter(userData: string): DraftWriter {
  let pending: SavedDrafts | null = null
  let kept: SavedDrafts = { drafts: [] }
  let expired = false
  let quitting = false
  let quitDeadline = Infinity
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
      await writeFile(
        part,
        JSON.stringify({ version: DRAFTS_FILE_VERSION, drafts: saved.drafts }),
        {
          mode: 0o600,
        },
      )
      if (expired || performance.now() >= quitDeadline) {
        await rm(part, { force: true })
        return false
      }
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
      if (
        expired ||
        performance.now() >= quitDeadline ||
        typeof raw !== 'object' ||
        raw === null ||
        !Array.isArray((raw as SavedDrafts).drafts)
      )
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
              kept = savedDraftsFrom(file.kind === 'book' ? file.raw : null)
              loaded = true
            }
            while (pending !== null && !expired) {
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
            if (expired) pending = null
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
      quitDeadline = performance.now() + withinMs
      const done = (): boolean => arrived >= expected && writing === null
      if (done()) return Promise.resolve(lastFailed ? 'failed' : 'saved')
      return new Promise((resolve) => {
        const check = (): void => {
          if (!done()) return
          finish(lastFailed ? 'failed' : 'saved')
        }
        const timer = setTimeout(() => finish('unanswered'), withinMs)
        function finish(outcome: 'saved' | 'failed' | 'unanswered'): void {
          if (outcome === 'unanswered') {
            expired = true
            pending = null
          }
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
