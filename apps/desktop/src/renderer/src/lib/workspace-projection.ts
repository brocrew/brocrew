import { computed, shallowRef, type ComputedRef } from 'vue'
import type { AgentState, StoppedPiece } from '../../../shared/agent-state'
import type {
  AgentIdentity,
  AgentStateMoved,
  ProcessMemory,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import type {
  ConversationWait,
  HeldWork,
  WhatEachConversationIsWaitingOn,
} from '../../../shared/tasks'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import type { WorkEdge } from '../../../shared/who-called-whom'
import type { RailSays } from './agent-state'
import type { FilesRead } from './files-kept'
import type { CastReading } from './working-together'
import { listedRow, listedRowsOf, type ListedConversation } from './conversation-list'
import {
  stoppedWorkIn,
  theWaitIn,
  theWorkIn,
  waitReadingFor,
  whenItsWaitsBeganIn,
  whoseAnswerIn,
  whoseWorkIn,
  type WaitReading,
} from './conversation-waits'
import type { ProviderBlockFacts } from './provider-limit-status'

/** A running conversation, as the band and the Team page name it. */
export interface RunningConversation {
  readonly sessionId: string
  readonly provider: ResumableSessionInfo['provider']
  readonly state: ListedConversation['state']
}

/** Everything the host's waits reading says of one conversation, kept as one stable object. */
export interface WaitOf {
  /** The three absences, told apart. */
  readonly reading: WaitReading
  /** The one wait for a facet: `undefined` for both absences and for a read saying none. */
  readonly wait: ConversationWait | undefined
  readonly work: HeldWork | undefined
  readonly answerFrom: string | null
  readonly workWith: readonly string[]
  readonly stoppedWork: readonly StoppedPiece[]
  readonly began: { readonly answer: number | null; readonly work: number | null }
}

/** What the projection reads but never writes: the roster, provider facts and the rail's words. */
export interface WorkspaceInputs {
  readonly identities: () => readonly AgentIdentity[] | null
  readonly providerSaid: () => ReadonlyMap<string, ProviderBlockFacts> | undefined
  /** What the rail's row says of each conversation; `null` where no rail is on screen. */
  readonly railSays: () => ReadonlyMap<string, RailSays> | null
}

/**
 * The window's one owner of workspace metadata. Its ingestion methods are the only writers; every
 * surface reads through its selectors, which return the same object for as long as what it says
 * has not changed.
 */
export interface WorkspaceProjection {
  /** Numbers a list read before either half of it is asked. */
  listAsked(): number
  /** Takes a list read in; `false` when a newer read was asked since, and nothing changes. */
  listAnswered(
    ticket: number,
    resumable: readonly ResumableSessionInfo[],
    unresumable: readonly UnresumableSessionInfo[],
  ): boolean
  /** A list read that did not answer: the last good list stays, with the reason beside it. */
  listRefused(ticket: number, why: string): void
  /** States main pushed since the list was asked. */
  statesMoved(moved: readonly AgentStateMoved[]): void
  /** The waits reading; `null` (a read that did not answer) keeps the last good one. */
  waitsRead(reading: WhatEachConversationIsWaitingOn | null): void
  forestRead(forest: TheWholeForest): void
  /** The process figures; `null` draws none, as a figure is a live process's. */
  memoryRead(held: ProcessMemory | null): void
  /** Back to nobody has looked; a read already in flight is dropped when it lands. */
  reset(): void

  /** The listed conversations, newest first; `null` until the first list read lands. */
  listed(): readonly ListedConversation[] | null
  listError(): string | null
  /** The host's own rows, as the last list read gave them; empty until it lands. */
  hostRows(): readonly ResumableSessionInfo[]
  running(): readonly RunningConversation[] | null
  conversation(id: string): ListedConversation | undefined
  ofIdentity(identity: string): readonly ListedConversation[]
  waits(): WhatEachConversationIsWaitingOn | null
  waitOf(id: string): WaitOf
  forest(): TheWholeForest | null
  /** Every piece a conversation holds, as the forest names them. */
  piecesHeldBy(id: string): readonly WorkEdge[]
  memory(): ReadonlyMap<string, number>
  memoryOf(id: string): number | undefined
  memoryUnmeasured(): string | null
  railSays(): ReadonlyMap<string, RailSays> | null

  /** The band's reading for the conversation on screen; `null` until one answers. */
  cast(): CastReading | null
  /** The conversation whose band read is in flight, or `null`. */
  castLoadingFor(): string | null
  /** Every file kept in the tree of the conversation on screen; `null` until read. */
  treeFiles(): FilesRead | null
  /** The files the on-screen card's agent added; `null` until read. */
  cardFiles(): FilesRead | null
  /** A band read began for `conversation`, or ended (`null`). */
  castAsked(conversation: string | null): void
  /** The band's reading, replacing the last one; `null` drops it. */
  castRead(reading: CastReading | null): void
  filesRead(tree: FilesRead | null, card: FilesRead | null): void
}

/**
 * Whether two values the bridge delivered say the same thing: plain data compared field by field,
 * so a fresh answer equal to the last one is recognised as such.
 */
export function sameValue(one: unknown, other: unknown): boolean {
  if (Object.is(one, other)) return true
  if (typeof one !== 'object' || typeof other !== 'object' || one === null || other === null)
    return false
  if (Array.isArray(one)) {
    if (!Array.isArray(other) || one.length !== other.length) return false
    for (let index = 0; index < one.length; index++)
      if (!sameValue(one[index], other[index])) return false
    return true
  }
  if (Array.isArray(other)) return false
  if (one instanceof Map || other instanceof Map) {
    if (!(one instanceof Map) || !(other instanceof Map) || one.size !== other.size) return false
    for (const [key, value] of one)
      if (!other.has(key) || !sameValue(value, other.get(key))) return false
    return true
  }
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(other).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(other, key)) return false
    if (!sameValue((one as Record<string, unknown>)[key], (other as Record<string, unknown>)[key]))
      return false
  }
  return true
}

/** The same array when every element is the same object in the same place. */
function sameElements<T>(one: readonly T[] | null, other: readonly T[]): boolean {
  if (one === null || one.length !== other.length) return false
  for (let index = 0; index < one.length; index++) if (one[index] !== other[index]) return false
  return true
}

/** The same map when it holds the same keys, each with the same object. */
function sameEntries<K, V>(one: ReadonlyMap<K, V> | null, other: ReadonlyMap<K, V>): boolean {
  if (one === null || one.size !== other.size) return false
  for (const [key, value] of other) if (one.get(key) !== value) return false
  return true
}

/**
 * A computed whose answer keeps the objects of its last answer wherever they say the same thing:
 * `share` receives the fresh answer and the last one, and returns what to hand out.
 */
function shared<T>(fresh: () => T, share: (next: T, last: T | undefined) => T): ComputedRef<T> {
  let last: T | undefined
  return computed(() => {
    const next = share(fresh(), last)
    last = next
    return next
  })
}

/** Keeps each row whose value did not move, and the whole list when no row moved. */
function shareRows<T extends { readonly sessionId: string }>(
  next: readonly T[] | null,
  last: readonly T[] | null | undefined,
): readonly T[] | null {
  if (next === null) return null
  const before = new Map((last ?? []).map((row) => [row.sessionId, row]))
  const kept = next.map((row) => {
    const old = before.get(row.sessionId)
    return old !== undefined && sameValue(old, row) ? old : row
  })
  return sameElements(last ?? null, kept) ? last! : kept
}

const NO_ROWS: readonly ListedConversation[] = Object.freeze([])
const NO_PIECES: readonly WorkEdge[] = Object.freeze([])
const NO_HOLDERS: readonly string[] = Object.freeze([])
const NO_STOPPED_WORK: readonly StoppedPiece[] = Object.freeze([])
const NOT_BEGUN = Object.freeze({ answer: null, work: null })

const absent = (reading: WaitReading): WaitOf =>
  Object.freeze({
    reading,
    wait: undefined,
    work: undefined,
    answerFrom: null,
    workWith: NO_HOLDERS,
    stoppedWork: NO_STOPPED_WORK,
    began: NOT_BEGUN,
  })

const NOBODY_HAS_LOOKED = absent({ known: 'nobody-has-looked' })
const NOT_IN_THE_READING = absent({ known: 'not-in-the-reading' })

/** One conversation's waits, by the rules `conversation-waits.ts` states them in. */
function waitOfIn(reading: WhatEachConversationIsWaitingOn, conversation: string): WaitOf {
  const workWith = whoseWorkIn(reading, conversation)
  const stoppedWork = stoppedWorkIn(reading, conversation)
  const began = whenItsWaitsBeganIn(reading, conversation)
  return {
    reading: waitReadingFor(reading, conversation),
    wait: theWaitIn(reading, conversation),
    work: theWorkIn(reading, conversation),
    answerFrom: whoseAnswerIn(reading, conversation),
    workWith: workWith.length === 0 ? NO_HOLDERS : workWith,
    stoppedWork: stoppedWork.length === 0 ? NO_STOPPED_WORK : stoppedWork,
    began: began.answer === null && began.work === null ? NOT_BEGUN : began,
  }
}

const NO_INPUTS: WorkspaceInputs = {
  identities: () => null,
  providerSaid: () => undefined,
  railSays: () => null,
}

export function createWorkspaceProjection(
  inputs: Partial<WorkspaceInputs> = {},
): WorkspaceProjection {
  const from: WorkspaceInputs = { ...NO_INPUTS, ...inputs }

  // What the bridge said. Nothing outside the ingestion methods below writes these.
  const resumable = shallowRef<readonly ResumableSessionInfo[]>([])
  const unresumable = shallowRef<readonly UnresumableSessionInfo[]>([])
  const looked = shallowRef(false)
  const error = shallowRef<string | null>(null)
  /** Each pushed state, with the list read it arrived after. */
  const said = shallowRef<
    ReadonlyMap<string, { readonly state: AgentState; readonly after: number }>
  >(new Map())
  const waitsReading = shallowRef<WhatEachConversationIsWaitingOn | null>(null)
  const forestReading = shallowRef<TheWholeForest | null>(null)
  const memoryReading = shallowRef<ReadonlyMap<string, number>>(new Map())
  const unmeasured = shallowRef<string | null>(null)
  const castReading = shallowRef<CastReading | null>(null)
  const castLoading = shallowRef<string | null>(null)
  const treeFilesRead = shallowRef<FilesRead | null>(null)
  const cardFilesRead = shallowRef<FilesRead | null>(null)
  /** How many list reads have been asked; a read is current only while its number is the last. */
  let readsAsked = 0

  /** Each row's fold, with the inputs it was folded from, so a row whose inputs did not move is kept. */
  interface Folded {
    readonly host: ResumableSessionInfo | UnresumableSessionInfo
    readonly said: AgentState | undefined
    readonly provider: ProviderBlockFacts | undefined
    readonly identities: readonly AgentIdentity[] | null
    readonly row: ListedConversation
  }
  let folded = new Map<string, Folded>()
  let lastListed: readonly ListedConversation[] | null = null

  const listed = computed((): readonly ListedConversation[] | null => {
    if (!looked.value) {
      folded = new Map()
      lastListed = null
      return null
    }
    const identities = from.identities()
    const providerSaid = from.providerSaid()
    const next = new Map<string, Folded>()
    const rows = listedRowsOf({ resumable: resumable.value, unresumable: unresumable.value }).map(
      (host) => {
        const heard = said.value.get(host.sessionId)?.state
        const provider = providerSaid?.get(host.sessionId)
        const old = folded.get(host.sessionId)
        let row: ListedConversation
        if (
          old !== undefined &&
          old.host === host &&
          old.said === heard &&
          old.provider === provider &&
          old.identities === identities
        ) {
          row = old.row
        } else {
          const fresh = listedRow(host, identities, heard, provider)
          row = old !== undefined && sameValue(old.row, fresh) ? old.row : fresh
        }
        next.set(host.sessionId, { host, said: heard, provider, identities, row })
        return row
      },
    )
    folded = next
    if (sameElements(lastListed, rows)) return lastListed
    lastListed = rows
    return rows
  })

  const byId = shared(
    () => new Map((listed.value ?? []).map((row) => [row.sessionId, row])),
    (next, last) => (last !== undefined && sameEntries(last, next) ? last : next),
  )

  /** The provider of each conversation the last list read said is running. */
  const runningProviders = computed(
    () =>
      new Map(
        [...resumable.value, ...unresumable.value]
          .filter((row) => row.running !== 'not-running')
          .map((row) => [row.sessionId, row.provider]),
      ),
  )

  const running = shared((): readonly RunningConversation[] | null => {
    const rows = listed.value
    if (rows === null) return null
    const live = runningProviders.value
    return rows.flatMap(({ sessionId, state }) => {
      const provider = live.get(sessionId)
      return provider === undefined ? [] : [{ sessionId, provider, state }]
    })
  }, shareRows)

  const byIdentity = shared(
    () => {
      const groups = new Map<string, ListedConversation[]>()
      for (const row of listed.value ?? []) {
        const group = groups.get(row.identity)
        if (group) group.push(row)
        else groups.set(row.identity, [row])
      }
      return groups as ReadonlyMap<string, readonly ListedConversation[]>
    },
    (next, last) => {
      const kept = new Map(
        [...next].map(([identity, group]) => {
          const old = last?.get(identity)
          return [identity, old !== undefined && sameElements(old, group) ? old : group] as const
        }),
      )
      return last !== undefined && sameEntries(last, kept) ? last : kept
    },
  )

  const waitsById = shared(
    () => {
      const index = new Map<string, WaitOf>()
      const reading = waitsReading.value
      for (const row of reading?.conversations ?? [])
        if (!index.has(row.conversation))
          index.set(row.conversation, waitOfIn(reading!, row.conversation))
      return index as ReadonlyMap<string, WaitOf>
    },
    (next, last) => {
      const kept = new Map(
        [...next].map(([id, one]) => {
          const old = last?.get(id)
          return [id, old !== undefined && sameValue(old, one) ? old : one] as const
        }),
      )
      return last !== undefined && sameEntries(last, kept) ? last : kept
    },
  )

  const piecesByHolder = shared(
    () => {
      const holders = new Map<string, WorkEdge[]>()
      for (const node of forestReading.value?.nodes.rows ?? []) {
        if (node.node !== 'a-task') continue
        const pieces = holders.get(node.work.to)
        if (pieces) pieces.push(node.work)
        else holders.set(node.work.to, [node.work])
      }
      return holders as ReadonlyMap<string, readonly WorkEdge[]>
    },
    (next, last) => {
      // A forest read is a fresh answer each time: a piece that says what it said keeps its
      // object, and a holder whose pieces all kept theirs keeps its list.
      const kept = new Map(
        [...next].map(([holder, pieces]) => {
          const old = last?.get(holder)
          const before = new Map((old ?? []).map((piece) => [piece.piece, piece]))
          const shared = pieces.map((piece) => {
            const was = before.get(piece.piece)
            return was !== undefined && sameValue(was, piece) ? was : piece
          })
          return [holder, old !== undefined && sameElements(old, shared) ? old : shared] as const
        }),
      )
      return last !== undefined && sameEntries(last, kept) ? last : kept
    },
  )

  return {
    listAsked() {
      readsAsked += 1
      return readsAsked
    },
    listAnswered(ticket, nextResumable, nextUnresumable) {
      if (ticket !== readsAsked) return false
      resumable.value = nextResumable
      unresumable.value = nextUnresumable
      // Every push that arrived before this read was asked gives way to its answer.
      const kept = new Map([...said.value].filter(([, heard]) => heard.after >= ticket))
      if (kept.size !== said.value.size) said.value = kept
      error.value = null
      looked.value = true
      return true
    },
    listRefused(ticket, why) {
      if (ticket === readsAsked) error.value = why
    },
    statesMoved(moved) {
      if (moved.length === 0) return
      const next = new Map(said.value)
      for (const one of moved) next.set(one.conversation, { state: one.state, after: readsAsked })
      said.value = next
    },
    waitsRead(reading) {
      if (reading !== null) waitsReading.value = reading
    },
    forestRead(forest) {
      if (!sameValue(forestReading.value, forest)) forestReading.value = forest
    },
    memoryRead(held) {
      const next = new Map((held?.conversations ?? []).map((one) => [one.conversation, one.bytes]))
      if (!sameEntries(memoryReading.value, next)) memoryReading.value = next
      unmeasured.value = held?.unmeasured ?? null
    },
    reset() {
      castReading.value = null
      castLoading.value = null
      treeFilesRead.value = null
      cardFilesRead.value = null
      readsAsked += 1
      resumable.value = []
      unresumable.value = []
      looked.value = false
      error.value = null
      said.value = new Map()
      waitsReading.value = null
      forestReading.value = null
      memoryReading.value = new Map()
      unmeasured.value = null
    },

    listed: () => listed.value,
    listError: () => error.value,
    hostRows: () => resumable.value,
    running: () => running.value,
    conversation: (id) => byId.value.get(id),
    ofIdentity: (identity) => byIdentity.value.get(identity) ?? NO_ROWS,
    waits: () => waitsReading.value,
    waitOf: (id) =>
      waitsReading.value === null
        ? NOBODY_HAS_LOOKED
        : (waitsById.value.get(id) ?? NOT_IN_THE_READING),
    forest: () => forestReading.value,
    piecesHeldBy: (id) => piecesByHolder.value.get(id) ?? NO_PIECES,
    memory: () => memoryReading.value,
    memoryOf: (id) => memoryReading.value.get(id),
    memoryUnmeasured: () => unmeasured.value,
    railSays: () => from.railSays(),
    cast: () => castReading.value,
    castLoadingFor: () => castLoading.value,
    treeFiles: () => treeFilesRead.value,
    cardFiles: () => cardFilesRead.value,
    castAsked(conversation) {
      castLoading.value = conversation
    },
    castRead(reading) {
      castReading.value = reading
    },
    filesRead(tree, card) {
      treeFilesRead.value = tree
      cardFilesRead.value = card
    },
  }
}
