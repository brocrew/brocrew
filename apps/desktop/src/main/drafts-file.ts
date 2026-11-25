import type { WebContents, WebFrameMain } from 'electron'
import { lutimesSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { isPastedImage } from '../shared/runtime-ipc'
import { conversationOfSlot, type SavedDrafts } from '../shared/saved-drafts'
import type { DraftStorage } from './database/drafts'
import { pastedImagesRoot } from './runtime/pasted-image'
import { savedDraftsFrom } from './saved-drafts'

export interface DraftWriter {
  /**
   * Keep the slots a save names, and remove the ones it clears. A slot it does not name is left as
   * it is. A book marked `last` answers the quit's request.
   */
  write(raw: unknown, frame?: string): Promise<void>
  expectQuitSaves(frames: readonly string[]): void
  forgetQuitSave(frame: string): void
  /**
   * Resolve once every requested last book has arrived and its write has finished.
   */
  quitSaves(): Promise<'saved' | 'failed'>
}

export function createDraftWriter(storage: DraftStorage): DraftWriter {
  let quitting = false
  let pending = new Set<string>()
  let writing: Promise<void> | undefined
  let accepted = 0
  let saved = 0
  let lastSavedAt: number | null = null
  let lastFailed = false
  let failed: SavedDrafts | null = null
  const listeners = new Set<() => void>()

  return {
    write(raw, frame) {
      if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as SavedDrafts).drafts))
        return Promise.resolve()
      accepted += 1
      const packet = raw as SavedDrafts
      const drafts = savedDraftsFrom(raw).drafts
      const removals = !quitting && Array.isArray(packet.cleared) ? packet.cleared : []
      // The reply belongs to the request in effect when it was received.
      const expected = packet.last === true ? pending : undefined
      const owed = frame !== undefined && expected?.has(frame) === true

      const save = async (): Promise<void> => {
        const slots = new Map(failed?.drafts.map((draft) => [draft.slot, draft]))
        const cleared = new Set(failed?.cleared)
        for (const slot of removals) {
          if (typeof slot !== 'string' || conversationOfSlot(slot) === undefined) continue
          slots.delete(slot)
          cleared.add(slot)
        }
        for (const draft of drafts) {
          slots.set(draft.slot, draft)
          cleared.delete(draft.slot)
        }
        const next = { drafts: [...slots.values()], cleared: [...cleared] }
        try {
          const outcome = await storage.persist(next)
          failed = null
          if (outcome === 'saved') {
            lastFailed = false
            saved += 1
            lastSavedAt = Date.now()
          } else if (owed) {
            lastFailed = true
          }
        } catch (error) {
          console.warn(`the unsent drafts could not be saved: ${String(error)}`)
          failed = next
          lastFailed = true
        }
        if (frame !== undefined) expected?.delete(frame)
      }
      // A later book must see the preceding save's outcome before merging its carried slots.
      const written = Promise.resolve(writing)
        .then(save)
        .finally(() => {
          if (writing === written) writing = undefined
          for (const listener of listeners) listener()
        })
      writing = written
      return written
    },

    expectQuitSaves(frames) {
      const book = storage.open ? savedDraftsFrom(storage.read()).drafts : []
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
      pending = new Set(frames)
    },

    forgetQuitSave(frame) {
      if (pending.delete(frame)) for (const listener of listeners) listener()
    },

    quitSaves() {
      const ready = (): boolean => pending.size === 0 && writing === undefined
      if (ready()) return Promise.resolve(lastFailed ? 'failed' : 'saved')
      return new Promise((resolve) => {
        const check = (): void => {
          if (ready()) finish(lastFailed ? 'failed' : 'saved')
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

type DraftReaderEvent = 'render-process-gone' | 'destroyed' | 'did-navigate'

type DraftReader = Pick<WebContents, 'isDestroyed'> & {
  mainFrame: Pick<WebFrameMain, 'frameToken' | 'isDestroyed' | 'detached' | 'send'> | null
  once(event: DraftReaderEvent, listener: () => void): void
  removeListener(event: DraftReaderEvent, listener: () => void): void
}

export async function requestLastDraftSaves(
  writer: DraftWriter,
  readers: readonly { contents: DraftReader; token: string }[],
  channel: string,
): Promise<'saved' | 'failed'> {
  writer.expectQuitSaves(readers.map(({ token }) => token))
  const release: Array<() => void> = []
  try {
    for (const { contents, token } of readers) {
      const frame = contents.isDestroyed() ? null : contents.mainFrame
      const gone = (): boolean =>
        contents.isDestroyed() ||
        !frame ||
        frame.isDestroyed() ||
        frame.detached ||
        frame.frameToken !== token
      const forget = (): void => writer.forgetQuitSave(token)
      if (!frame || gone()) {
        forget()
        continue
      }
      contents.once('render-process-gone', forget)
      contents.once('destroyed', forget)
      contents.once('did-navigate', forget)
      release.push(() => {
        contents.removeListener('render-process-gone', forget)
        contents.removeListener('destroyed', forget)
        contents.removeListener('did-navigate', forget)
      })
      try {
        frame.send(channel)
      } catch (error) {
        if (!gone()) throw error
      }
      // Electron can log a disposed-frame send without throwing it back to this caller.
      if (gone()) forget()
    }
    return await writer.quitSaves()
  } finally {
    for (const stop of release) stop()
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
export function keepDraftedPastes(
  storage: Pick<DraftStorage, 'read'>,
  userData: string,
  now: number,
): number {
  let root: string
  let book: unknown
  try {
    root = realpathSync(pastedImagesRoot(userData))
    book = storage.read()
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
