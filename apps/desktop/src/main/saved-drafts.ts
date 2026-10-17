import { isAbsolute } from 'node:path'
import {
  MAX_HANDED_PATHS,
  MAX_PATH_CHARS,
  hasControlCharacter,
  type HandedPath,
  type PastedImage,
} from '../shared/runtime-ipc'
import { conversationOfSlot, type SavedDraft, type SavedDrafts } from '../shared/saved-drafts'
import { classifyHandedPath } from './runtime/handed-path'

/**
 * # 🔴 744 · R100 — what the kept drafts SAY, as they go back into their slots
 *
 * ⚑ **This module touches no file** — `drafts-file.ts` reads and writes `<userData>/drafts.json` and
 * hands this module the parsed JSON. ⚠️ **And it is on the handed-path route**
 * (`no-byte-authority.test.ts`): it makes the `HandedPath` records a restored chip is drawn from, and
 * a module that makes them is a module somebody could later "improve" by reading the file one names.
 * Its only filesystem question is the one classifier's, `classifyHandedPath`.
 *
 * ⚠️ **The file is BroBot's own, but it is read as untrusted input**: it outlives the build that wrote
 * it, and anything a reader cannot recognise is dropped rather than guessed at — a draft that comes
 * back as something else is worse than one that does not come back.
 */

/**
 * ⚠️ **How long one path's *"is it still there?"* may take before the restore stops waiting for it.**
 * A draft may name a path on a network volume that has stalled, and the window waits for the restore
 * before it draws — so a path that does not answer in time is restored WITHOUT a mark rather than
 * holding every other draft back. ⚑ The send still re-checks it by name (`recheckHandedPaths`).
 *
 * ⛔ **And the questions are asked ONE AT A TIME, and the first that does not answer ends them**
 * (744 review, round two): a stat that stalls is abandoned, not cancelled — it keeps one of the main
 * process's four filesystem workers until the volume answers — so asking every path at once could
 * leave every worker stuck and the drafts' own writes queued behind them. One stuck question at most.
 */
export const STILL_THERE_WITHIN_MS = 1_000

/**
 * ⛔ **…and how long ALL of them may take together** (744 review, round three). Asked one at a time,
 * several slow-but-answering paths would add up past the window's own wait for the restore
 * (`SAVED_DRAFTS_WITHIN_MS`, 3 s) — and a window that stopped waiting draws with nothing restored
 * and keeps nothing that run. ⚑ Well under it: past this, the rest are restored unmarked.
 */
export const RESTORE_WITHIN_MS = 1_500

function pastedFrom(raw: unknown): PastedImage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { width, height, bytes } = raw as Record<string, unknown>
  const measure = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  return measure(width) && measure(height) && measure(bytes) ? { width, height, bytes } : undefined
}

/**
 * ⛔ **One attached path, only if it is what the wire itself would accept** — absolute, bounded and
 * free of control characters (`ipc.ts`' `attachments`, from the same shared constants), a `kind` and
 * an `outsideCwd`. ⚠️ **`missing` is never read from the file**: it is a fact about the filesystem
 * NOW, so {@link restoreSavedDrafts} decides it afresh on every launch.
 */
function handedFrom(raw: unknown): HandedPath | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { path, kind, outsideCwd, pasted } = raw as Record<string, unknown>
  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_CHARS) return null
  if (!isAbsolute(path) || hasControlCharacter(path)) return null
  if (kind !== 'file' && kind !== 'directory') return null
  if (typeof outsideCwd !== 'boolean') return null
  const image = pastedFrom(pasted)
  return { path, kind, outsideCwd, ...(image === undefined ? {} : { pasted: image }) }
}

/**
 * ⚑ **What a reader can recognise of a saved book — from the file, or from the renderer handing one
 * over.** A slot that is neither the launcher's nor a conversation's is dropped; a slot holding
 * nothing is dropped (an empty draft is the absence of one, `drafts.ts`' own rule); a slot met twice
 * keeps its first. ⛔ At most {@link MAX_HANDED_PATHS} paths a slot, the ceiling a message has.
 */
export function savedDraftsFrom(raw: unknown): SavedDrafts {
  const listed =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['drafts'] : undefined
  if (!Array.isArray(listed)) return { drafts: [] }
  const seen = new Set<string>()
  const drafts: SavedDraft[] = []
  for (const each of listed) {
    if (typeof each !== 'object' || each === null) continue
    const { slot, text, attached } = each as Record<string, unknown>
    if (typeof slot !== 'string' || hasControlCharacter(slot)) continue
    if (conversationOfSlot(slot) === undefined || seen.has(slot)) continue
    if (typeof text !== 'string') continue
    const paths = (Array.isArray(attached) ? attached : [])
      .map(handedFrom)
      .filter((one): one is HandedPath => one !== null)
      .slice(0, MAX_HANDED_PATHS)
    if (text === '' && paths.length === 0) continue
    seen.add(slot)
    drafts.push({ slot, text, attached: paths })
  }
  return { drafts }
}

/**
 * ⚑ **Whether a path is GONE — the one classifier's own answer** (`classifyHandedPath`'s `gone`), so
 * *"missing"* on a restored chip means exactly what *"it has been moved or deleted"* means at the
 * send.
 */
async function goneByTheClassifier(path: string): Promise<boolean> {
  const verdict = await classifyHandedPath(path, '')
  return 'refusal' in verdict && verdict.gone
}

/** `isGone`'s answer, or `null` when it did not come within `withinMs`: not known, so not marked. */
async function goneWithin(
  isGone: (path: string) => Promise<boolean>,
  path: string,
  withinMs: number,
): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), withinMs)
  })
  try {
    return await Promise.race([isGone(path), late])
  } finally {
    clearTimeout(timer)
  }
}

export interface RestoreSavedDraftsDeps {
  /** Whether this app has a record of the conversation — a slot for one it has not is DROPPED. */
  exists: (sessionId: string) => boolean
  /** The one classifier's *"is it gone?"*, unless a test says otherwise. */
  isGone?: (path: string) => Promise<boolean>
  /** {@link STILL_THERE_WITHIN_MS}, unless a test says otherwise. */
  stillThereWithinMs?: number
  /** {@link RESTORE_WITHIN_MS}, unless a test says otherwise. */
  restoreWithinMs?: number
  /** The clock the overall bound is read from. */
  now?: () => number
}

/**
 * ⛔ **The drafts the last run left, as they go back into their slots** (R100) — from the file's
 * parsed JSON (`null` for no file).
 *
 * ⚑ **A conversation that no longer exists takes its draft with it, HERE** — never restored under an
 * id nothing answers to (`019`: never the wrong agent). ⚑ **A path that is gone comes back marked
 * `missing`**, not silently dropped.
 */
export async function restoreSavedDrafts(
  raw: unknown,
  deps: RestoreSavedDraftsDeps,
): Promise<SavedDrafts> {
  const isGone = deps.isGone ?? goneByTheClassifier
  const withinMs = deps.stillThereWithinMs ?? STILL_THERE_WITHIN_MS
  const now = deps.now ?? Date.now
  const until = now() + (deps.restoreWithinMs ?? RESTORE_WITHIN_MS)
  const kept = savedDraftsFrom(raw).drafts.filter((draft) => {
    const conversation = conversationOfSlot(draft.slot)
    return conversation === null || (conversation !== undefined && deps.exists(conversation))
  })
  let stalled = false
  const drafts: SavedDraft[] = []
  for (const draft of kept) {
    const attached: HandedPath[] = []
    for (const handed of draft.attached) {
      const left = until - now()
      const gone =
        stalled || left <= 0
          ? null
          : await goneWithin(isGone, handed.path, Math.min(withinMs, left))
      if (gone === null) stalled = true
      attached.push(gone === true ? { ...handed, missing: true as const } : handed)
    }
    drafts.push({ ...draft, attached })
  }
  return { drafts }
}
