import type { PersistedEventInfo, TranscriptEvent } from '../../../shared/conversation-events'
import {
  HISTORY_WINDOW_MAX_EVENTS,
  type HistoryWindow,
  type RuntimeEventMessage,
  type SessionRef,
  type SessionStatus,
} from '../../../shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  isAwaitingAnswer,
  markReopened,
  MAX_CARRIED_CHANGE_REPORTS,
  opensTurn,
  restoreSubAgent,
  type ChangeLog,
  type SubAgentCard,
  type TranscriptState,
} from './transcript'
import { copyHumanAnswers } from './human-answers'

export const WINDOW_MAX_EVENTS = HISTORY_WINDOW_MAX_EVENTS * 2

// Release a slab so streaming does not refold the full window on every event.
export const WINDOW_RELEASE_CHUNK = HISTORY_WINDOW_MAX_EVENTS / 2

export interface WindowState {
  /** The loaded slice of the ledger, in order. */
  entries: RuntimeEventMessage[]
  /** The ordinal `entries` begins at. What {@link earlierHistory} pages back from. */
  from: number
  /** Whether the ledger holds anything before {@link from}. */
  hasOlder: boolean
  /** Whether {@link from} is a turn boundary, or the event ceiling cut mid-turn. */
  turnAligned: boolean

  atTail: boolean

  behind: number
}

export function createWindow(): WindowState {
  return { entries: [], from: 0, hasOlder: false, turnAligned: true, atTail: true, behind: 0 }
}

export function tailWindow(entries: RuntimeEventMessage[]): WindowState {
  return {
    entries,
    from: entries[0]?.ordinal ?? 0,
    // It was cut out of a longer window, so there is definitely something before it — and it was
    // cut at whatever event the cap fell on, which is not a turn boundary.
    hasOlder: true,
    turnAligned: false,
    atTail: true,
    behind: 0,
  }
}

export interface FoldCarry {
  workAncestry?: TranscriptState['workAncestry']
  quietSubAgents?: readonly SubAgentCard[]
  humanAnswers: TranscriptState['humanAnswers']
  status: SessionStatus
  ref: SessionRef | null
  ended: boolean
  activity: TranscriptState['activity']

  requests: {
    event: TranscriptEvent
    at?: number

    routed?: TranscriptEvent
  }[]

  meter: TranscriptState['meter']

  background: TranscriptState['background']

  schedule: TranscriptState['schedule']

  commands: TranscriptState['commands']

  tools: TranscriptState['tools']

  changes: TranscriptState['changes']

  subAgents: TranscriptEvent[]

  stopUnanswered: TranscriptState['stopUnanswered']

  heldPastTheirTurn: string[]
}

function subAgentCarry(
  state: TranscriptState,
  retained: readonly RuntimeEventMessage[],
): TranscriptEvent[] {
  const agents = new Set<string>()
  const calls = new Set<string>()
  const born = new Set<string>()
  for (const { event } of retained) {
    if (event.type === 'sub_agent') {
      agents.add(event.agentId)
      if (event.phase === 'started') born.add(event.agentId)
    }
    if (
      (event.type === 'sub_agent' ||
        event.type === 'assistant_message' ||
        event.type === 'tool_call' ||
        event.type === 'tool_result') &&
      event.parentToolCallId !== undefined
    ) {
      calls.add(event.parentToolCallId)
    }
  }
  const wanted = (card: SubAgentCard): boolean =>
    !born.has(card.agentId) &&
    (card.running ||
      agents.has(card.agentId) ||
      (card.parentToolCallId !== undefined && calls.has(card.parentToolCallId)))
  return [...state.subAgentCards.values()].filter(wanted).map(asSubAgentEvent)
}

// Omit summary: restoring it before body prose would discard that prose as an echo.
function asSubAgentEvent(card: SubAgentCard): TranscriptEvent {
  return {
    type: 'sub_agent',
    agentId: card.agentId,
    phase: card.running ? 'progress' : 'ended',
    ...(card.idKind !== undefined ? { idKind: card.idKind } : {}),
    ...(card.parentToolCallId !== undefined ? { parentToolCallId: card.parentToolCallId } : {}),
    ...(card.origin !== undefined ? { origin: card.origin } : {}),
    ...(card.kind !== undefined ? { kind: card.kind } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    ...(card.lastTool !== undefined ? { lastTool: card.lastTool } : {}),
    ...(card.usage !== undefined ? { usage: { ...card.usage } } : {}),
    ...(card.outcome !== undefined ? { outcome: card.outcome } : {}),
  }
}

function quietSubAgents(
  state: TranscriptState,
  entries: readonly RuntimeEventMessage[],
): SubAgentCard[] {
  const touched = new Set<string>()
  for (const { event, ancestryContext, workAncestry } of entries) {
    for (const row of [{ event }, ...(ancestryContext ?? []), ...(workAncestry?.baseline ?? [])]) {
      const event = row.event
      if (event.type === 'conversation_reset') return []
      if (event.type === 'sub_agent') touched.add(event.agentId)
      if ('parentToolCallId' in event && event.parentToolCallId !== undefined) {
        for (const id of state.workAncestry.dispatches.get(event.parentToolCallId)?.agentIds ?? [])
          touched.add(id)
      }
      if (event.type === 'tool_call' || event.type === 'tool_result') {
        const owner = state.workAncestry.tools.get(event.id)?.agentId
        if (owner !== undefined) touched.add(owner)
      }
    }
    if (workAncestry?.after !== undefined && workAncestry.after !== state.workAncestry.after)
      return []
  }
  // A page changing a descendant also changes its containing card body.
  for (const id of touched) {
    const parent = state.workAncestry.agents.get(id)?.parentAgentId
    if (parent !== undefined) touched.add(parent)
  }
  return [...state.subAgentCards.values()].filter((card) => !touched.has(card.agentId))
}

// Carry session facts and unresolved cards; rebuild event/item indexes from retained rows.
export function carryForward(
  state: TranscriptState,
  retained: readonly RuntimeEventMessage[],
  preserveQuietCards = false,
): FoldCarry {
  const restated = new Set<string>()
  for (const { event } of retained) {
    if (event.type === 'permission_request' || event.type === 'user_input_request') {
      restated.add(event.id)
    }
  }
  const requests: FoldCarry['requests'] = []
  for (const item of state.items) {
    if (item.kind !== 'permission' && item.kind !== 'userInput') continue
    if (!isAwaitingAnswer(item)) continue
    if (restated.has(item.request.id)) continue
    requests.push({
      event: item.request,
      ...(item.at !== undefined ? { at: item.at } : {}),
      // ⚑ **D-017 · R19** — the routing, as the row it came from, so the card comes back routed.
      // ⚠️ `the-parent` stands for both conversation arms: the fold reads only whether it went to a
      // person, and which conversation owes it.
      ...(item.routed === true
        ? {
            routed: {
              type: 'request_routed' as const,
              requestId: item.request.id,
              ...(item.routedTo === undefined
                ? { to: 'a-person' as const }
                : { to: 'the-parent' as const, parent: item.routedTo }),
            },
          }
        : {}),
    })
  }
  return {
    workAncestry: state.workAncestry,
    humanAnswers: copyHumanAnswers(state.humanAnswers),
    status: state.status,
    ref: state.ref,
    ended: state.ended,
    // Copied, not aliased: `activity` is replaced wholesale by the fold, but the outgoing state is
    // still reachable for the length of this call and a shared object is a way for two folds to
    // disagree later for no reason.
    activity: state.activity === null ? null : { ...state.activity },
    // Copied for the reason `activity` is copied one line up: the outgoing state stays reachable
    // for the length of this call, and a shared object is a way for two folds to disagree later.
    meter: { ...state.meter, reading: { ...state.meter.reading } },
    // Copied one level deeper for the reason the two above are copied, and the rows with it: the
    // registry is REPLACED wholesale by the next level frame, so a shared array is a way for two
    // folds to disagree later for no reason.
    background: { running: [...state.background.running], dropped: state.background.dropped },
    // Copied one level deep for the reason the three above are copied: the outgoing state stays
    // reachable for the length of this call, and a shared array is a way for two folds to disagree
    // later for no reason. The JOBS themselves are the provider's own frozen rows and are shared.
    schedule: {
      jobs: [...state.schedule.jobs],
      dropped: state.schedule.dropped,
      left: [...state.schedule.left],
    },
    // Copied one level deep for the reason the four above are copied. ⚠️ The SET is copied too, and
    // not only the wrapper: it holds the array the band draws, and a shared array is a way for two
    // folds to disagree later for no reason. `null` stays `null` — *"nobody has told us"* is not a
    // thing to copy, and manufacturing an empty set here would be the very lie the registry's own
    // doc forbids.
    commands: {
      set:
        state.commands.set === null
          ? null
          : { commands: [...state.commands.set.commands], prefix: state.commands.set.prefix },
      dropped: state.commands.dropped,
    },
    // Copied one level deep for the reason the five above are copied, and one level deeper again
    // inside the set — it holds the arrays the sheet draws. ⛔ **`null` stays `null` at BOTH levels**:
    // the outer one is *"nobody has told us"* and the inner one is *"this provider publishes no
    // inventory"*, and manufacturing an empty object for either would be the lie the registry's own
    // doc forbids, told about two different things.
    tools: {
      set:
        state.tools.set === null
          ? null
          : {
              naming: { ...state.tools.set.naming },
              declared:
                state.tools.set.declared === null
                  ? null
                  : {
                      server: state.tools.set.declared.server,
                      ...(state.tools.set.declared.instructions === undefined
                        ? {}
                        : { instructions: state.tools.set.declared.instructions }),
                      tools: state.tools.set.declared.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters.map((parameter) => ({ ...parameter })),
                      })),
                    },
              published:
                state.tools.set.published === null
                  ? null
                  : {
                      tools: [...state.tools.set.published.tools],
                      servers: state.tools.set.published.servers.map((server) => ({ ...server })),
                    },
            },
      dropped: state.tools.dropped,
      // ⛔ **The moment travels with the set** (444 relay 1). ⚑ **This line is a compile error
      // when it is missing, and only because `ToolRegistry.at` was made REQUIRED for that
      // reason** — the docblock above says nothing in the typechecker would have caught a missing
      // field on this hand-built object, and an OPTIONAL moment would have proved it right by
      // dying here at the first window release with nothing red. ⚠️ The conversations long enough
      // to release a window are exactly the ones whose inventory is oldest.
      at: state.tools.at,
    },
    requests,
    changes: carryChanges(state.changes, retained),
    subAgents: subAgentCarry(state, retained),
    ...(preserveQuietCards ? { quietSubAgents: quietSubAgents(state, retained) } : {}),
    stopUnanswered: state.stopUnanswered,
    heldPastTheirTurn: [...state.heldPastTheirTurn],
  }
}

function carryChanges(log: ChangeLog, retained: readonly RuntimeEventMessage[]): ChangeLog {
  const from = retained[0]?.ordinal
  const older =
    from === undefined
      ? log.reports.filter((report) => report.ordinal !== undefined)
      : log.reports.filter((report) => report.ordinal !== undefined && report.ordinal < from)
  // Newest first out of the cap: what a reader is asked about is what just happened, and the oldest
  // reports are also the ones whose bodies were released longest ago. Counted, never silent.
  const kept = older.slice(-MAX_CARRIED_CHANGE_REPORTS)
  let reopened = 0
  for (const { event } of retained) if (opensTurn(event)) reopened += 1
  return {
    // Copied one level deep for the reason `background`, `schedule` and `commands` are copied above:
    // the outgoing state stays reachable for the length of this call, and a shared array is a way
    // for two folds to disagree later. The REPORTS themselves are shared — they are frozen records
    // of an observation, and `releaseOldDiffBodies` only ever removes text from them.
    reports: [...kept],
    turn: Math.max(0, log.turn - reopened),
    // ⚠️ **Carried, and it must be.** Ids are `changes_<seq>` and a fresh fold restarts the counter
    // at zero, so a carried `changes_3` and a newly built `changes_3` would be two different reports
    // with one id — and `ChangeRow.bodyReportId` points at reports by exactly that string.
    seq: log.seq,
    dropped: log.dropped + (older.length - kept.length),
  }
}

export function foldWindow(
  entries: readonly RuntimeEventMessage[],
  liveFrom: number | null = null,
  carry: FoldCarry | null = null,
  toolsInForce: PersistedEventInfo | null = null,
): TranscriptState {
  const state = createTranscript()
  // Nulled once spent, so the crossing happens exactly once however many events are on either
  // side of it — and `null` from the start is a session that was never reopened.
  let epoch = liveFrom
  if (carry !== null) {
    if (carry.workAncestry !== undefined) state.workAncestry = carry.workAncestry
    state.humanAnswers = copyHumanAnswers(carry.humanAnswers)
    state.status = carry.status
    state.ref = carry.ref
    state.ended = carry.ended
    state.activity = carry.activity
    state.meter = carry.meter
    state.background = carry.background
    state.schedule = carry.schedule
    state.commands = carry.commands
    state.tools = carry.tools
    state.changes = carry.changes
    state.stopUnanswered = carry.stopUnanswered
    // ⚠️ **And the epoch may already have been spent, in the events this carry stands for.**
    // `markReopened` is what leaves the previous life behind, and applying it a second time would
    // clear a `working` status or a genuine post-resume ENDING that the prefix established — the
    // mirror of the bug 064 fixed, on a resumed session, which is exactly where this path is hardest
    // to reason about. The crossing is at the first event whose ordinal reaches the epoch, so the
    // prefix crossed it precisely when the epoch falls before the first event still here.
    //
    // **Nothing retained means the carry is the whole answer**, and it is already epoch-correct:
    // every carry comes out of a fold that either crossed the epoch or applied `markReopened` at its
    // end, so there is no third state for an empty run to be in. Found by 073's own review, which
    // reached it through a prepend of an EMPTY page on a session whose window had not been filled
    // yet — reachable, and it clears a live `working` status for nothing.
    const first = entries[0]
    if (epoch !== null && (first === undefined || first.ordinal > epoch)) epoch = null
  }
  // ⚑ **D-035** — see the docblock. Neither side of the epoch: `markReopened` leaves the tools alone.
  if (toolsInForce !== null) {
    applyEvent(state, toolsInForce.event, toolsInForce.at, toolsInForce.ordinal)
  }

  let placed = false
  // Restore cards after crossing liveFrom so markReopened cannot settle current carried work.
  const placeCarried = (): void => {
    if (carry === null || placed) return
    placed = true
    // The cards FIRST, so a retained event that names one finds it — which is the whole point of
    // carrying them. They land at top level, because the row that dispatched them was released with
    // everything else; `rehome` and `adoptOrphans` put them back the moment the suffix supplies it.
    const quiet = new Map(carry.quietSubAgents?.map((card) => [card.agentId, card]))
    for (const event of carry.subAgents) {
      const card = quiet.get(event.type === 'sub_agent' ? event.agentId : '')
      if (card === undefined) applyEvent(state, event)
      else restoreSubAgent(state, card)
    }
    for (const card of quiet.values()) restoreSubAgent(state, card)
    for (const request of carry.requests) {
      applyEvent(state, request.event, request.at)
      if (request.routed !== undefined) applyEvent(state, request.routed, request.at)
    }
    // ⚑ **D-001 · on the current side of the epoch, with the cards it names** — `markReopened`
    // settles every open card, so a set restored before it would name cards it had just settled.
    for (const requestId of carry.heldPastTheirTurn) state.heldPastTheirTurn.add(requestId)
  }
  if (epoch === null) placeCarried()
  for (const message of entries) {
    if (epoch !== null && message.ordinal >= epoch) {
      markReopened(state)
      epoch = null
      placeCarried()
    }
    // ⚑ **The ordinal goes in** (299 §2) — this is the one loop that has it, and everything that
    // has to survive a re-fold is stamped from here. See `transcript.ts`'s `Placed`.
    applyEvent(
      state,
      message.event,
      message.at,
      message.ordinal,
      message.humanFinal,
      message.workAncestry,
      message.ancestryContext,
      message.errorFacts,
    )
  }
  if (epoch !== null) {
    markReopened(state)
    placeCarried()
  }
  return state
}

function historyMessage(entry: PersistedEventInfo, sessionId: string): RuntimeEventMessage {
  return {
    sessionId,
    ordinal: entry.ordinal,
    at: entry.at,
    event: entry.event,
    ...(entry.workAncestry === undefined ? {} : { workAncestry: entry.workAncestry }),
    ...(entry.ancestryContext === undefined ? {} : { ancestryContext: entry.ancestryContext }),
    ...(entry.humanFinal === undefined ? {} : { humanFinal: entry.humanFinal }),
    ...(entry.errorFacts === undefined ? {} : { errorFacts: entry.errorFacts }),
  }
}

export function openAt(window: WindowState, page: HistoryWindow, sessionId: string): void {
  window.entries = page.entries.map((entry) => historyMessage(entry, sessionId))
  window.from = page.from
  window.hasOlder = page.hasOlder
  window.turnAligned = page.turnAligned
  window.atTail = true
  window.behind = 0
}

export function prependPage(
  window: WindowState,
  page: HistoryWindow,
  sessionId: string,
): { released: number; tail: RuntimeEventMessage[] } {
  const older = page.entries.map((entry) => historyMessage(entry, sessionId))
  window.entries = [...older, ...window.entries]
  window.from = page.from
  window.hasOlder = page.hasOlder
  window.turnAligned = page.turnAligned

  let released = 0
  let tail: RuntimeEventMessage[] = []
  if (window.entries.length > WINDOW_MAX_EVENTS) {
    // Down to the cap, then a slab further, so the next page does not immediately release again.
    const keep = Math.max(older.length, WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
    released = window.entries.length - keep
    tail = window.entries.slice(keep)
    window.entries = window.entries.slice(0, keep)
    // Whatever was released included the newest event, so this window no longer holds the end of
    // the ledger. `behind` restarts from zero: it counts events that arrive from NOW, and the ones
    // just released are not new — they are already in the ledger and come back on a jump.
    if (released > 0) {
      window.atTail = false
      window.behind = 0
    }
  }
  return { released, tail }
}

export function liveDisposition(window: WindowState): 'fold' | 'behind' {
  return window.atTail ? 'fold' : 'behind'
}

export const LOAD_OLDER_THRESHOLD_PX = 400

/** A scroll container, reduced to the three numbers this arithmetic needs. */
export interface ScrollView {
  scrollTop: number
  scrollHeight: number
}

/** Whether `view` is near enough to the top that the page before it should be fetched. */
export function shouldLoadOlder(
  view: Pick<ScrollView, 'scrollTop'>,
  thresholdPx = LOAD_OLDER_THRESHOLD_PX,
): boolean {
  return view.scrollTop <= thresholdPx
}

export function anchorAfterPrepend(before: ScrollView, afterScrollHeight: number): number {
  return Math.max(0, before.scrollTop + (afterScrollHeight - before.scrollHeight))
}

export function anchorAfterShift(scrollTop: number, movedBy: number): number {
  return Math.max(0, scrollTop + movedBy)
}

export function appendLive(
  window: WindowState,
  message: RuntimeEventMessage,
): { released: number } {
  window.entries.push(message)
  if (window.entries.length <= WINDOW_MAX_EVENTS) return { released: 0 }

  const released = window.entries.length - (WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
  window.entries = window.entries.slice(released)
  // The window now starts later in the ledger, and there is definitely something before it.
  window.from = window.entries[0]?.ordinal ?? window.from
  window.hasOlder = true
  // A slab cut at an arbitrary event is not a turn boundary, and claiming it was would put a
  // "conversation starts here" reading on what is really a release.
  window.turnAligned = false
  return { released }
}
