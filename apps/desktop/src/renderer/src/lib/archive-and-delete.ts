import type {
  ArchiveOutcome,
  DeleteOutcome,
  DeletePart,
  DeleteVerdict,
} from '../../../shared/conversation-archive'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import { draftKey, type DraftBook } from './drafts'
import { readableError } from './session-record'

/**
 * Archiving, restoring and deleting a conversation, as the window asks main for them.
 *
 * Archive is the everyday action. Delete is a person's alone: main lists the parts first, the
 * person ticks them, and only the ticked ones are sent. The rules live here so a test can reach
 * them without mounting the screen.
 */

/** The four calls this file makes. */
export type ArchiveBridge = Pick<
  RuntimeBridge,
  'archiveConversation' | 'restoreConversation' | 'checkDeleteConversation' | 'deleteConversation'
>

/** Archive one conversation and the helpers below it. A call that threw reads as a refusal. */
export async function archiveConversation(
  bridge: ArchiveBridge,
  sessionId: string,
): Promise<ArchiveOutcome> {
  try {
    return await bridge.archiveConversation({ sessionId })
  } catch (cause) {
    return { done: false, refusal: readableError(cause) }
  }
}

/** Bring an archived conversation and its archived tree back. */
export async function restoreConversation(
  bridge: ArchiveBridge,
  sessionId: string,
): Promise<ArchiveOutcome> {
  try {
    return await bridge.restoreConversation({ sessionId })
  } catch (cause) {
    return { done: false, refusal: readableError(cause) }
  }
}

/** Read what a delete would remove. A call that threw reads as a refusal. */
export async function checkDelete(
  bridge: ArchiveBridge,
  sessionId: string,
): Promise<DeleteVerdict> {
  try {
    return await bridge.checkDeleteConversation({ sessionId })
  } catch (cause) {
    return { ok: false, refusal: readableError(cause) }
  }
}

/** Delete the ticked parts, and nothing else. */
export async function deleteTicked(
  bridge: ArchiveBridge,
  sessionId: string,
  parts: readonly DeletePart[],
  ticked: ReadonlySet<string>,
): Promise<DeleteOutcome> {
  try {
    return await bridge.deleteConversation({ sessionId, parts: partsToSend(parts, ticked) })
  } catch (cause) {
    return { done: false, refusal: readableError(cause) }
  }
}

/**
 * The parts ticked when the list opens: the records and each conversation's files. A memory note
 * may hold something the person still wants, so it waits for their own tick.
 */
export function tickedAtFirst(parts: readonly DeletePart[]): string[] {
  return parts.filter((part) => part.kind !== 'memory-note').map((part) => part.id)
}

/**
 * The ids a delete sends: each part main listed that is ticked, in main's order. A fresh array of
 * strings, so nothing unticked and nothing main did not list can ride along.
 */
export function partsToSend(parts: readonly DeletePart[], ticked: ReadonlySet<string>): string[] {
  return parts.filter((part) => ticked.has(part.id)).map((part) => part.id)
}

/** Whether a refusal names Archive as the way out, so the dialog can offer it. */
export function pointsToArchive(refusal: string): boolean {
  return /\barchive\b/i.test(refusal)
}

/** Said when main's own list does not mention the recovery copies. */
export const RECOVERY_COPIES_STAY =
  'Recovery copies of this workspace keep it until they are replaced.'

const ABOUT_RECOVERY_COPIES = /recovery cop/i

/**
 * What a delete cannot remove, with the recovery copies first and on their own: main's sentence
 * where it has one, and one true line where it has none.
 */
export function whatItCannotRemove(cannot: readonly string[]): {
  recoveryCopies: readonly string[]
  rest: readonly string[]
} {
  const recoveryCopies = cannot.filter((line) => ABOUT_RECOVERY_COPIES.test(line))
  return {
    recoveryCopies: recoveryCopies.length > 0 ? recoveryCopies : [RECOVERY_COPIES_STAY],
    rest: cannot.filter((line) => !ABOUT_RECOVERY_COPIES.test(line)),
  }
}

/** The conversation a check was about, then the helpers below it. */
export function theTreeOf(verdict: Extract<DeleteVerdict, { ok: true }>): string[] {
  return [verdict.conversation, ...verdict.helpers.map((helper) => helper.conversation)]
}

/** Whether a delete took the records: only then are the conversations gone from the window. */
export function recordsWent(outcome: DeleteOutcome): boolean {
  return outcome.done && outcome.removed.includes('records')
}

/** What a part is called in the list of what went. */
export function partsSaid(
  parts: readonly DeletePart[],
  removed: readonly string[],
): readonly string[] {
  return removed.map((id) => parts.find((part) => part.id === id)?.says ?? id)
}

/** What the window is looking at: a named place, or the conversation picked when it is null. */
export interface Looking {
  readonly place: string | null
  readonly activeId: string | null
}

/**
 * Where the window looks once conversations left it (archived, or deleted). A view of one of them
 * closes as a view closes when its conversation stops existing: onto the newest conversation this
 * window still holds, or the launcher when there is none. Any other view stays as it is.
 */
export function lookingAfterTheyLeft(
  looking: Looking,
  gone: readonly string[],
  held: readonly string[],
  launcher: string,
): Looking {
  if (looking.activeId === null || !gone.includes(looking.activeId)) return looking
  const next = held.filter((sessionId) => !gone.includes(sessionId)).at(-1) ?? null
  return {
    activeId: next,
    place: looking.place === null && next === null ? launcher : looking.place,
  }
}

/**
 * The conversation on screen, when the host's list stopped naming it between two of its answers and
 * this window does not run it: it was archived or deleted from somewhere else, and the view reacts as
 * it does to its own press. `null` when it is still listed, never was, or runs here. Both lists are
 * the host's own, read after it said the conversations moved.
 */
export function leftTheListsFromElsewhere(
  onScreen: string | null,
  listedBefore: ReadonlySet<string> | null,
  listedNow: readonly string[] | null,
  runningHere: readonly string[],
): string | null {
  if (onScreen === null || listedBefore === null || listedNow === null) return null
  if (!listedBefore.has(onScreen) || listedNow.includes(onScreen)) return null
  return runningHere.includes(onScreen) ? null : onScreen
}

/** Drop the window's unsent words and attached paths for conversations that no longer exist. */
export function dropTheirDrafts(drafts: DraftBook, gone: readonly string[]): void {
  for (const sessionId of gone) {
    const slot = draftKey(sessionId)
    drafts.write(slot, '')
    drafts.paths.write(slot, [])
  }
}
