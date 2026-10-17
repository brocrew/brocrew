import type { WorkEdge } from '../../../shared/who-called-whom'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import { HOW_A_PIECE_ENDED_SAID } from '../../../shared/piece-called'
import type { WorkerBindingReading } from '../../../shared/worker-reading'
import type {
  AgentIdentity,
  ResumableSessionInfo,
  UnresumableSessionInfo,
  PieceWaitingOnPurpose,
} from '../../../shared/runtime-ipc'
import { WORK_STATE_WORD } from '../../../shared/work-state-words'
import { agentName, DEFAULT_PROFILE_ID, foldProfileName } from '../../../shared/runtime-ipc'
import type { AgentState } from '../../../shared/agent-state'
import { theWorkThatNamesItSaid, type WorkThatNamesIt } from '../../../shared/piece-called'
import { mergeProviderBlock, type ProviderBlockFacts } from './provider-limit-status'
import { basenameOf } from './paths'
import { waitOnSays } from './work-waits'

/**
 * # ⚑ D-017b · the window's ONE list of conversations
 *
 * Open every conversation in the same full view regardless of process status. A new message continues it, so the list need not divide the person's navigation into open and closed populations.
 *
 * ⛔ **There is no open / closed / not-open-here split any more**, and so no heading, no gesture and
 * no word per split: every row is one conversation, and pressing it opens that conversation in its
 * one full view (`RuntimeScreen.openConversation`). ⚑ What a row SAYS is the one state
 * (`shared/agent-state.ts`, D-017 · R11) — the host's word for it, the same `list_agents` states —
 * and, where it is true, that another window has it open. ⛔ Never whether a process runs (`05` rule
 * 5).
 *
 * ⚑ **This file folds the HOST's two lists** into rows; the rail puts the conversations this window
 * holds beside them, drawn from their own records.
 */

/** One conversation the host lists, as the rail and the palette draw it. */
export interface ListedConversation extends ProviderBlockFacts {
  readonly worker?: WorkerBindingReading
  /** The piece it holds waiting on purpose, with its status line — the host's. */
  readonly waitingOnPurpose?: PieceWaitingOnPurpose
  readonly sessionId: string
  readonly provider: string
  /** Who is in it — the agent's name, as every surface names it (`449`). */
  readonly label: string
  /**
   * ⚑ **The identity it runs as — the slug {@link label} was named from**, folded as `agentName`
   * folds it, so a list of one agent's conversations (the Team page's) keys on what the row is
   * called. ⚠️ A row with no profile recorded ran in the default one (`ResumableSessionInfo.profileId`).
   */
  readonly identity: string
  /** Where it works — its folder's name — or `null` when this app holds no path for it. */
  readonly place: string | null
  /**
   * ⚑ The one state, as the host derives it — the list's, or what main said of it after the list
   * was asked ({@link ConversationListInput.said}).
   */
  readonly state: AgentState
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names it**, the host's: what the rail row, the
   * palette and the header show where they showed its name ({@link conversationTitle});
   * {@link label} stays beside it.
   */
  readonly named: WorkThatNamesIt | null
  /**
   * ⚑ **Another window has it open** — the one fact about where it is that a person acts on: a
   * message sent from this window is refused, and the words say to switch windows.
   */
  readonly inAnotherWindow: boolean
  /** When its record last moved — the list is newest first. */
  readonly updatedAt: number
}

export interface ConversationListInput {
  readonly resumable: readonly ResumableSessionInfo[]
  readonly unresumable: readonly UnresumableSessionInfo[]
  /** ⚑ **449** — the roster that names each row; `null` before it lands, and the row says less. */
  readonly identities?: readonly AgentIdentity[] | null
  /**
   * 🔴 **D-019 · what main said a conversation is doing after this list was asked** — pushed on
   * `runtime:states`, and it wins over the row's own `state`, which is as of the read.
   */
  readonly said?: ReadonlyMap<string, AgentState>
  readonly providerSaid?: ReadonlyMap<string, ProviderBlockFacts>
}

/**
 * ⚑ **Every conversation the host lists, newest activity first.**
 *
 * ⛔ **Two kinds of row stay off it, as they always stayed off the rail** (154, 214): a conversation
 * the sweep found in a person's OWN provider folder, and one restored from a bundle this machine
 * never ran — neither was started here, and both are on *All conversations*, which holds everything.
 */
export function conversationList(input: ConversationListInput): ListedConversation[] {
  const identities = input.identities ?? null
  const rows: ListedConversation[] = []
  const add = (row: ResumableSessionInfo | UnresumableSessionInfo): void => {
    rows.push({
      ...mergeProviderBlock(row, input.providerSaid?.get(row.sessionId)),
      ...(row.worker ? { worker: row.worker } : {}),
      ...(row.waitingOnPurpose ? { waitingOnPurpose: row.waitingOnPurpose } : {}),
      sessionId: row.sessionId,
      provider: row.provider,
      label: agentName(row.profileId, identities),
      identity: foldProfileName(row.profileId ?? DEFAULT_PROFILE_ID),
      place: basenameOf(row.cwd) || null,
      state: input.said?.get(row.sessionId) ?? row.state,
      named: row.named,
      inAnotherWindow: row.running === 'in-a-window',
      updatedAt: row.updatedAt,
    })
  }
  for (const row of input.resumable) add(row)
  for (const row of input.unresumable) {
    if (row.foundInUserHome || row.restoredFromBundle) continue
    add(row)
  }
  return rows.sort((one, other) => other.updatedAt - one.updatedAt)
}

/**
 * ⚑ **D-016 · commit 7 · R2 — the one title a row, the palette and the header draw**: the work that
 * names the conversation (`W1 · Bakery website`, or `W1` before it is titled), or the agent's name
 * when it holds no piece. ⚑ F033 · with what is true of it beside that — `(and 2 more)`, or how it
 * ended — in the one spelling every agent sentence uses ({@link theWorkThatNamesItSaid}).
 */
export function conversationTitle(label: string, named: WorkThatNamesIt | null): string {
  return named === null ? label : theWorkThatNamesItSaid(named)
}

export interface WorkerGroup<T> {
  readonly key: string
  readonly worker: WorkerBindingReading | null
  readonly rows: T[]
}

/** Keeps proved worker pools together; unrelated conversations keep their existing order. */
export function groupWorkers<T extends { readonly worker?: WorkerBindingReading }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): WorkerGroup<T>[] {
  const groups = new Map<string, WorkerGroup<T>>()
  for (const row of rows) {
    const worker = row.worker ?? null
    const key = JSON.stringify(
      worker ? ['worker', worker.identity, worker.giver] : ['row', keyOf(row)],
    )
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, worker, rows: [row] })
  }
  for (const group of groups.values()) {
    if (group.worker) group.rows.sort((a, b) => a.worker!.number - b.worker!.number)
  }
  return [...groups.values()]
}

export function workerLabel(
  name: string,
  worker: WorkerBindingReading | undefined,
  named?: WorkThatNamesIt | null,
): string {
  if (worker && named) return `${name} · ${named.label}`
  return worker && worker.number !== 1 ? `${name} (${worker.number})` : name
}

/**
 * The slug of the identity a worker runs as. The host names that identity by its id (`aid:…`),
 * which is no name; an identity this window has not read keeps the id.
 */
function workerSlug(
  worker: WorkerBindingReading,
  identities: readonly AgentIdentity[] | null,
): string {
  return identities?.find((one) => one.id === worker.identity)?.slug ?? worker.identity
}

/** What to call the identity a worker runs as: its name, else its slug. */
export function workerName(
  worker: WorkerBindingReading,
  identities: readonly AgentIdentity[] | null,
): string {
  return agentName(workerSlug(worker, identities), identities)
}

export function workerDescription(
  worker: WorkerBindingReading,
  identities: readonly AgentIdentity[] | null,
): string {
  const slug = workerSlug(worker, identities)
  return worker.number === 1 ? `Worker: ${slug}.` : `Worker: ${slug} (${worker.number}).`
}

/** A wait in words: what it waits on where its holder named it, else that it waits on purpose. */
function waitSaid(mark: PieceWaitingOnPurpose): string {
  if (mark.on === undefined) return WAITING_ON_PURPOSE
  return waitOnSays(mark.on, mark.agentName)
}

/** What a conversation the host reads as idle says while it holds a piece waiting on purpose. */
export const WAITING_ON_PURPOSE = WORK_STATE_WORD['waiting-on-purpose']

/**
 * The word and its detail for a conversation that would read idle but holds a piece waiting on
 * purpose: its wait, and the piece's status line. `null` when it is not idle or holds no such piece,
 * and the row says what it said.
 */
export function onPurposeSaid(
  idle: boolean,
  mark: PieceWaitingOnPurpose | undefined,
): { readonly word: string; readonly detail: string } | null {
  if (!idle || mark === undefined) return null
  const word = waitSaid(mark)
  return { word, detail: `${word}: ${mark.status}` }
}

/** A status line's first sentence: up to its first full stop, question or exclamation mark, or "…". */
function firstSentence(line: string): string {
  return line.trim().split(/(?<=[.!?…])\s/)[0] ?? line
}

/**
 * What a giver's header says while a piece it gave waits on purpose: whom it waits on, that they wait
 * on purpose, and the first sentence of that piece's status line, "+N" for the other holders of its
 * open work. `whole` carries the status line whole. `null` when no piece it gave waits on purpose.
 * ⚑ The status is the holder's listed row's, and only when that row names the same piece.
 */
export function aGiverWaitsOnPurposeSays(
  gave: readonly WorkEdge[],
  listed: readonly ListedConversation[] | null,
): { readonly says: string; readonly whole: string } | null {
  const open = gave.filter(
    (piece) => Object.hasOwn(TASK_IS_OPEN, piece.state) && TASK_IS_OPEN[piece.state],
  )
  const piece = open.find((one) => one.state === 'waiting-on-purpose')
  if (piece === undefined) return null
  const holder = listed?.find((row) => row.sessionId === piece.to)
  const name = holder?.label ?? piece.toIdentity ?? 'another agent'
  const others = new Set(open.map((one) => one.to))
  others.delete(piece.to)
  const mark = holder?.waitingOnPurpose?.label === piece.label ? holder.waitingOnPurpose : undefined
  const lead = `Waiting on ${name}${others.size > 0 ? ` +${String(others.size)}` : ''}, who is ${mark === undefined ? WAITING_ON_PURPOSE : waitSaid(mark)}`
  const status = mark?.status ?? null
  return status === null
    ? { says: lead, whole: lead }
    : { says: `${lead}: ${firstSentence(status)}`, whole: `${lead}: ${status}` }
}

/** The host selects the naming piece; already-read edges only fill in its other open pieces. */
export function workerSubtitles(
  conversation: string,
  named: WorkThatNamesIt | null | undefined,
  pieces: readonly WorkEdge[] = [],
): { key: string; text: string }[] {
  if (!named) return []
  const result = named.title ? [{ key: named.label, text: named.title }] : []
  if (named.ended) return result
  const seen = new Set([named.label])
  const others = [...pieces]
    .filter((piece) => piece.to === conversation && TASK_IS_OPEN[piece.state])
    .sort((a, b) => b.givenAt - a.givenAt || a.piece.localeCompare(b.piece))
  let known = 0
  for (const piece of others) {
    if (seen.has(piece.label) || known >= (named.more ?? 0)) continue
    seen.add(piece.label)
    result.push({ key: piece.piece, text: [piece.label, piece.title].filter(Boolean).join(' · ') })
    known += 1
  }
  const missing = (named.more ?? 0) - known
  if (missing > 0) result.push({ key: 'more', text: `and ${missing} more` })
  return result
}

export function workerState(
  word: string | undefined,
  named: WorkThatNamesIt | null | undefined,
): string | undefined {
  return word === 'idle' && named?.ended ? `${word} · ${HOW_A_PIECE_ENDED_SAID[named.ended]}` : word
}
