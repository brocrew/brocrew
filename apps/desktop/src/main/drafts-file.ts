import { lutimesSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isPastedImage } from '../shared/runtime-ipc'
import { conversationOfSlot, type SavedDrafts } from '../shared/saved-drafts'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'
import { pastedImagesRoot } from './runtime/pasted-image'
import { savedDraftsFrom } from './saved-drafts'

/**
 * The unsent drafts, one `draft` row per slot. A row holds the entry as written, so fields another
 * build wrote are kept. Saving never sends a draft anywhere; what a row says is decided in
 * `saved-drafts.ts`.
 */

/** The file older builds kept the drafts in, imported once into `draft`. */
export const SAVED_DRAFTS_FILE = 'drafts.json'

/** The kept drafts as one book (`{ version, drafts }`), for `saved-drafts.ts` to read. */
export function savedDraftsBook(database: AppDatabase): unknown {
  const rows = database.prepare('SELECT entry FROM draft ORDER BY rowid').all() as {
    entry: string
  }[]
  return { version: 1, drafts: rows.map(({ entry }) => JSON.parse(entry) as unknown) }
}

/** Imports `drafts.json` from `userData` once, each entry with a slot kept as it was written. */
export function importDraftsFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, SAVED_DRAFTS_FILE), (said) => {
    const insert = database.prepare('INSERT OR IGNORE INTO draft (slot, entry) VALUES (?, ?)')
    const listed = objectIn(said)['drafts']
    for (const entry of Array.isArray(listed) ? listed : []) {
      const slot = objectIn(entry)['slot']
      if (typeof slot === 'string') insert.run(slot, JSON.stringify(entry))
    }
  })
}

export interface DraftWriter {
  /**
   * Keep the slots a save names, and remove the ones it clears. A slot it does not name is left as
   * it is. A book marked `last` answers the quit's request.
   */
  write(raw: unknown): Promise<void>
  /** The quit has asked `windows` windows for their last save: count the books marked `last`. */
  expectQuitSaves(windows: number): void
  /**
   * Resolve once every requested last book has arrived and its write has finished.
   */
  quitSaves(): Promise<'saved' | 'failed'>
}

/**
 * The one writer of the drafts. Each save is one transaction: the slots it names are upserted over
 * their rows, keeping the fields this build does not read, and only an explicit removal deletes a
 * slot. Quit snapshots cannot clear slots. A save that fails is merged into the next one; a save
 * after the database closed is dropped.
 */
export function createDraftWriter(database: AppDatabase): DraftWriter {
  let quitting = false
  let expected = 0
  let arrived = 0
  let accepted = 0
  let saved = 0
  let lastSavedAt: number | null = null
  let lastFailed = false
  let failed: SavedDrafts | null = null
  const listeners = new Set<() => void>()

  const keep = (packet: SavedDrafts): void => {
    const was = database.prepare('SELECT entry FROM draft WHERE slot = ?')
    const upsert = database.prepare(
      'INSERT INTO draft (slot, entry) VALUES (?, ?) ON CONFLICT(slot) DO UPDATE SET entry = excluded.entry',
    )
    const remove = database.prepare('DELETE FROM draft WHERE slot = ?')
    database.transaction(() => {
      for (const slot of packet.cleared ?? []) remove.run(slot)
      for (const draft of packet.drafts) {
        const row = was.get(draft.slot) as { entry: string } | undefined
        const entry = row === undefined ? {} : objectIn(JSON.parse(row.entry))
        upsert.run(draft.slot, JSON.stringify({ ...entry, ...draft }))
      }
    })()
  }

  return {
    write(raw) {
      if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as SavedDrafts).drafts))
        return Promise.resolve()
      accepted += 1
      const packet = raw as SavedDrafts
      const slots = new Map(failed?.drafts.map((draft) => [draft.slot, draft]))
      const cleared = new Set(failed?.cleared)
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
      const next = { drafts: [...slots.values()], cleared: [...cleared] }
      if (expected > 0 && packet.last === true) arrived += 1
      if (!database.open) {
        failed = null
      } else {
        try {
          keep(next)
          failed = null
          lastFailed = false
          saved += 1
          lastSavedAt = Date.now()
        } catch (error) {
          console.warn(`the unsent drafts could not be saved: ${String(error)}`)
          failed = next
          lastFailed = true
        }
      }
      for (const listener of listeners) listener()
      return Promise.resolve()
    },

    expectQuitSaves(windows) {
      const book = database.open ? savedDraftsFrom(savedDraftsBook(database)).drafts : []
      console.info(
        'BroCrew draft save status:',
        JSON.stringify({
          accepted,
          saved,
          lastSavedAt,
          slots: book.map((draft) => ({
            slot: draft.slot,
            characters: draft.text.length,
            attachments: draft.attached.length,
          })),
          characters: book.reduce((sum, draft) => sum + draft.text.length, 0),
        }),
      )
      quitting = true
      expected = windows
      arrived = 0
    },

    quitSaves() {
      if (arrived >= expected) return Promise.resolve(lastFailed ? 'failed' : 'saved')
      return new Promise((resolve) => {
        const check = (): void => {
          if (arrived >= expected) finish(lastFailed ? 'failed' : 'saved')
        }
        function finish(outcome: 'saved' | 'failed'): void {
          listeners.delete(check)
          resolve(outcome)
        }
        listeners.add(check)
      })
    },
  }
}

/**
 * Keep the pictures a kept draft names from ageing out, before the start-up sweep reads their age:
 * the sweep deletes a pasted picture a week after it was last written, and a draft now outlives
 * its run. Only this app's own pictures are touched — a pasted picture's name inside the
 * pasted-images folder beside this userData — and with `lutimes`, so a link is never followed.
 * Synchronous, before the sweep starts; never fatal.
 *
 * @returns how many pictures were kept.
 */
export function keepDraftedPastes(database: AppDatabase, userData: string, now: number): number {
  let root: string
  let book: unknown
  try {
    root = realpathSync(pastedImagesRoot(userData))
    book = savedDraftsBook(database)
  } catch {
    return 0
  }
  let kept = 0
  const when = new Date(now)
  for (const draft of savedDraftsFrom(book).drafts) {
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
