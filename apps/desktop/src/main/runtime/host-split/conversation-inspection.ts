import type { RuntimeHostDeps } from '../host-dependencies'
import { WorkAncestryRead } from '../work-ancestry'
import type { ResumableSession, SessionStore, ThreadLeadRow } from '../../db/session-store'
import type { RowsUnread } from '../../db/rows-unread'
import {
  WindowReadUnavailable,
  type WindowReadQuery,
  type WindowReadResult,
} from '../../db/window-read-protocol'
import { providerDefinitions } from '../../providers/index'
import { transcriptMessageForDisplay } from '../../providers/error-presentation'
import { isTheProvidersRecord, readLines } from '../../archive/native-file'
import { readingATurn } from '../../archive/turn-as-sent'
import type { TurnAsked, TurnAsSent } from '../../../shared/turn-as-sent'
import {
  HISTORY_WINDOW_MAX_EVENTS,
  HISTORY_WINDOW_TURNS,
  type ChildWorkInput,
  type ChildWorkResult,
  type HistoryWindow,
} from '../../../shared/runtime-ipc'
import { takesAContextMessage } from '../../../shared/provider-snapshots'
import { HISTORICAL_LEADS_OPEN_WITH, LEADS_OPEN_WITH } from '../codex-lead'

/**
 * ⚑ **W4.203 · how far back a conversation's ledger is looked through for its newest context
 * reading, the first time a read names it** (`RuntimeHost.lastContextOf`). A conversation this app
 * runs records one with every reply its provider makes, so its newest sits within the last few
 * dozen rows; the bound is what keeps a ledger that holds none from being walked whole.
 */
const CONTEXT_LOOKBACK_ROWS = 2_000

/** The page a start nobody hands on carries: nothing, and everything before `next` still to read. */
function noPageBefore(next: number): HistoryWindow {
  return { entries: [], from: next, hasOlder: next > 0, turnAligned: true }
}

/** How many lines, ledger rows or archived frames one page of a turn's reading takes (W4.164). */
const TURN_AS_SENT_PAGE = 2_000

export interface LiveHistoryState {
  readonly workAncestry: WorkAncestryRead
  workAncestryAfter: number
  ancestrySeed?: {
    from: number
    through: number
    context: ReturnType<SessionStore['ancestryContext']>
  }
}

type InspectionStore = Pick<
  SessionStore,
  | 'find'
  | 'eventsFrom'
  | 'recordedOne'
  | 'turnWindow'
  | 'ancestryContext'
  | 'humanFinalsInWindow'
  | 'latestHumanAnswers'
  | 'workflowAgentTask'
  | 'reportedSubAgent'
  | 'workflowAgentIds'
  | 'threadLeadRows'
>

type InspectionDeps = Pick<
  RuntimeHostDeps,
  'nativeTranscriptPath' | 'providerSnapshot' | 'windowReader'
> & { store: InspectionStore }

interface InspectionOperations {
  providerHomeFor(row: Pick<ResumableSession, 'adoptedAt' | 'profileId' | 'provider'>): string
  liveSessionForHistory(sessionId: string): LiveHistoryState | null | undefined
  freshWindowQuery<T>(
    query: WindowReadQuery,
    compose: (result: WindowReadResult) => T,
    signal?: AbortSignal,
  ): Promise<T>
}

export class ConversationInspection {
  constructor(
    private readonly deps: InspectionDeps,
    private readonly ops: InspectionOperations,
  ) {}

  async readTurnAsSent(sessionId: string, ordinal: number): Promise<TurnAsSent> {
    const row = this.deps.store.find(sessionId)
    if (row === null) {
      return {
        found: false,
        why: 'This conversation has no record with its provider yet, or is not in this app.',
      }
    }
    const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

    // ⚑ Which provider conversation each turn was in. ⚠️ Claude names the conversation AFTER the
    // first turn of it is handed over (its `system/init` raises the `session` or `conversation_reset`
    // event), so a turn is settled into a conversation by the first of: the conversation named
    // before its turn ended, or the one in force when it ended.
    interface Turn {
      readonly ordinal: number
      /**
       * What finds it in the provider's record: the text handed over, exactly — or, for a turn this
       * app read from that record, the text its importer took from it; `null` when there is neither.
       */
      readonly key: { readonly by: TurnAsked['by']; readonly text: string } | null
      /** Its words, as the ledger keeps them. */
      readonly words: string
      life: string | null
      settled: boolean
    }
    const turns: Turn[] = []
    let life: string | null = null
    /** Whether the ledger named any provider conversation at all. */
    let named = false
    let target: Turn | null = null
    /**
     * ⚑ Settle every turn not yet in a conversation into `into`. ⚑ **W4.204 · a turn read from the
     * provider's own record waits for the first conversation the ledger names** (`untilNamed`): a
     * ledger derived from that record names none, and a reopen's `reopened` and `launched` rows come
     * before the provider names the one it resumed — which, a resume being checked against it, is
     * the one the record came from.
     */
    const settle = (into: string | null, untilNamed = false): void => {
      for (const turn of turns) {
        if (turn.settled) continue
        if (untilNamed && !named && turn.key?.by === 'its-own-record') continue
        turn.life = into
        turn.settled = true
      }
    }
    walk: for (let from = 0; ;) {
      const page = this.deps.store.eventsFrom(sessionId, from, TURN_AS_SENT_PAGE)
      if (page.length === 0) break
      for (const entry of page) {
        const event = entry.event
        if (
          (event.type === 'session' && event.state !== 'ended') ||
          event.type === 'conversation_reset'
        ) {
          life = event.ref.sessionId
          named = true
          settle(life)
        } else if (event.type === 'turn' || event.type === 'launched') {
          // ⚑ A turn's end — or a new launch, after a quit that left a turn without one.
          settle(life, true)
        } else if (event.type === 'user_turn' && target === null) {
          const stored: unknown = event.sent
          const turn: Turn = {
            ordinal: entry.ordinal,
            key:
              typeof stored === 'string'
                ? { by: 'handed-over', text: stored }
                : event.attribution === 'provider_transcript'
                  ? { by: 'its-own-record', text: event.text }
                  : null,
            words: event.text,
            life,
            settled: false,
          }
          turns.push(turn)
          if (entry.ordinal === ordinal) target = turn
        }
        // ⚑ Settled — and, for a turn in no conversation, read on until the ledger names one, if it does.
        if (target?.settled === true && (target.life !== null || named)) break walk
        // ⚑ Past the place with no message there: nothing to settle.
        if (target === null && entry.ordinal >= ordinal) break walk
      }
      from = (page.at(-1)?.ordinal ?? from) + 1
      await yieldNow()
    }
    if (target === null) return { found: false, why: 'There is no message at that place.' }
    // ⚑ A turn whose conversation was never named after it: the one in force.
    settle(life)
    // ⛔ A turn that reached no provider conversation (a send that failed before one began) is in
    // no provider's file: never matched in some other conversation's.
    if (target.life === null && named) {
      return { found: false, why: 'This message reached no provider conversation.' }
    }
    const { key } = target
    if (key === null) {
      return {
        found: false,
        why:
          providerDefinitions[row.provider].transcripts.noModelMessageReason?.(target.words) ??
          'This app kept no copy of the text it handed over for this message — it was sent before this app kept one, or keeping it failed — so it cannot be matched exactly in the provider’s own record.',
      }
    }
    const of = target
    const before = turns.filter((turn) => turn.ordinal < of.ordinal && turn.life === of.life)
    // ⛔ An earlier message with the same words and nothing to match it by may be the one the file
    // holds first: which of the two this is cannot be told.
    if (before.some((turn) => turn.key === null && turn.words === of.words)) {
      return {
        found: false,
        why: 'An earlier message of this conversation had the same words and no copy of what was handed over with it, so which of the two this one is cannot be told.',
      }
    }
    const asked: TurnAsked = {
      ...key,
      life: of.life,
      // ⚑ **W4.204 · every earlier message with the same text, whichever way each is found** — a
      // record read from the provider's own file and one this app handed over can carry the same
      // text, so each takes its own record first ({@link TurnAsked.before}).
      before: before.flatMap((turn) =>
        turn.key !== null && turn.key.text === key.text ? [turn.key.by] : [],
      ),
    }

    const home = this.ops.providerHomeFor(row)
    // ⚑ The file of the provider conversation the turn was in: an earlier one keeps its own.
    const ref = of.life === null ? row.ref : { ...row.ref, sessionId: of.life }
    let path: string | null
    try {
      const found = this.deps.nativeTranscriptPath(row.provider, home, ref)
      path = found !== null && isTheProvidersRecord(row.provider, home, found) ? found : null
    } catch {
      path = null
    }
    const gone: TurnAsSent = {
      found: false,
      why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
    }
    if (path === null) return gone
    try {
      const reading = readingATurn(row.provider, asked, {
        hasAContextMessage: (model) =>
          takesAContextMessage(this.deps.providerSnapshot?.(row.provider, model)),
      })
      for (let offset = 0; ;) {
        const chunk = readLines(path, offset, TURN_AS_SENT_PAGE)
        const done = chunk.lines.some((line) => reading.line(line) === 'done')
        if (done || chunk.done) break
        offset = chunk.offset
        await yieldNow()
      }
      return reading.answer()
    } catch {
      // ⚑ A file that went between finding it and reading it.
      return gone
    }
  }

  childCandidates(
    sessionId: string,
    input: ChildWorkInput,
    unread?: RowsUnread,
  ): { agents: string[]; taskId: string | null } | null {
    if (input.part === 'transcript') {
      const taskId = this.deps.store.workflowAgentTask(sessionId, input.agentId, unread)
      if (taskId !== null) return { agents: [input.agentId], taskId }
      // ⚑ **The other children (115).** A plain `Task` child and a Codex child thread are in no
      // run, so no roster names either of them — their whole announcement is a `sub_agent` event.
      // The boundary does not move: it is still "an agent THIS session's own ledger recorded",
      // asked of the same table. `taskId` is null because there genuinely is no run, and inventing
      // one would be a name for an absence (086/104).
      return this.deps.store.reportedSubAgent(sessionId, input.agentId, unread)
        ? { agents: [input.agentId], taskId: null }
        : null
    }
    const agents = this.deps.store.workflowAgentIds(sessionId, input.taskId, unread)
    return agents.length === 0 ? null : { agents, taskId: input.taskId }
  }

  childWorkRead(sessionId: string, input: ChildWorkInput, unread: RowsUnread): ChildWorkResult {
    const session = this.deps.store.find(sessionId)
    if (session === null || session.ref === null) return { ok: false, reason: 'unknown-agent' }
    // THE LEDGER FIRST, and nothing about a filesystem — or about what exists — until it has
    // answered.
    //
    // ⚠️ **The shape check used to sit ABOVE this, and review was right that it read wrong**: it
    // answered "a thread has no journal" for a task id this session had never heard of, which is a
    // confident statement about a run we do not know. `unknown-agent` is the true sentence there,
    // and it is the one the allowlist gives.
    const found = this.childCandidates(sessionId, input, unread)
    if (found === null) return { ok: false, reason: 'unknown-agent' }

    return providerDefinitions[session.provider].transcripts.readChild({
      ref: session.ref,
      updatedAt: session.updatedAt,
      part: input.part,
      agents: found.agents,
      taskId: found.taskId,
      home: () => this.ops.providerHomeFor(session),
      pathForChild: (home, ref) => this.deps.nativeTranscriptPath(session.provider, home, ref),
    })
  }

  historyWindow(sessionId: string, options: { before?: number; turns?: number }): HistoryWindow {
    const provider = this.deps.store.recordedOne(sessionId)?.provider
    const window = this.deps.store.turnWindow(sessionId, {
      turns: options.turns ?? HISTORY_WINDOW_TURNS,
      maxEvents: HISTORY_WINDOW_MAX_EVENTS,
      ...(options.before === undefined ? {} : { before: options.before }),
    })
    const first = window.entries[0]
    const last = window.entries.at(-1)
    const live =
      options.before === undefined ? this.ops.liveSessionForHistory(sessionId) : undefined
    const cached = live?.ancestrySeed
    const ancestryContext =
      cached?.from === window.from && cached.through === (last?.ordinal ?? -1)
        ? cached.context
        : this.deps.store.ancestryContext(
            sessionId,
            window.entries,
            last?.ordinal ?? -1,
            HISTORY_WINDOW_MAX_EVENTS,
          )
    const pageOrdinals = new Set(window.entries.map((row) => row.ordinal))
    let ancestryPosition = 0
    const projected = ancestryContext.epochs.map((epoch, index) => {
      const rows: (typeof window.entries)[number][] = []
      while (
        ancestryPosition < window.entries.length &&
        window.entries[ancestryPosition]!.ordinal <= epoch.through
      ) {
        rows.push(window.entries[ancestryPosition++]!)
      }
      const contextRows = epoch.entries.filter((row) => !pageOrdinals.has(row.ordinal))
      const ancestryRows = [
        ...new Map([...epoch.entries, ...rows].map((row) => [row.ordinal, row])).values(),
      ].sort((a, b) => a.ordinal - b.ordinal)
      const ancestry = new WorkAncestryRead()
      ancestry.seed(
        ancestryRows.map((row) => row.event),
        epoch,
      )
      return {
        first: rows[0]?.ordinal,
        reading: {
          ...ancestry.read(),
          after: epoch.after,
          ...(index > 0 || rows[0]?.event.type === 'conversation_reset'
            ? { reset: true as const }
            : {}),
        },
        contextRows,
        ancestryRows,
        epoch,
      }
    })
    const final = projected.at(-1)
    if (live !== null && live !== undefined && final !== undefined) {
      if (live.workAncestryAfter !== final.epoch.after) live.workAncestry.clear()
      live.workAncestry.seedRows(final.ancestryRows, final.epoch)
      live.workAncestry.beginDelivery()
      live.workAncestryAfter = final.epoch.after
      live.ancestrySeed = {
        from: window.from,
        through: last?.ordinal ?? -1,
        context: ancestryContext,
      }
    }
    const firstReadings = new Map(projected.map((one) => [one.first, one]))
    const workAncestry = projected[0]?.reading ?? new WorkAncestryRead().read()
    const humanFinals =
      first === undefined || last === undefined
        ? new Map()
        : this.deps.store.humanFinalsInWindow(sessionId, first.ordinal, last.ordinal)
    return {
      workAncestry,
      entries: window.entries.map((entry) => ({
        ...transcriptMessageForDisplay(entry, provider),
        ...(firstReadings.has(entry.ordinal)
          ? {
              workAncestry: firstReadings.get(entry.ordinal)!.reading,
              ancestryContext: firstReadings.get(entry.ordinal)!.contextRows,
            }
          : {}),
        ...(entry.event.type === 'assistant_message'
          ? { humanFinal: humanFinals.get(entry.ordinal) ?? null }
          : {}),
      })),
      from: window.from,
      hasOlder: window.hasOlder,
      turnAligned: window.turnAligned,
      ...(options.before === undefined
        ? { humanAnswers: this.deps.store.latestHumanAnswers(sessionId) }
        : {}),
      // ⚑ **D-035** — on every page, so a hand-over, a page back and a jump to the latest all begin
      // with the tools the conversation had there.
      ...(window.toolsInForce === undefined
        ? {}
        : {
            toolsInForce: {
              ordinal: window.toolsInForce.ordinal,
              at: window.toolsInForce.at,
              event:
                window.toolsInForce.event.type === 'tool_inventory'
                  ? transcriptMessageForDisplay(window.toolsInForce, provider).event
                  : window.toolsInForce.event,
            },
          }),
    }
  }

  async readThreadLeads(
    sessionId: string,
    before: number,
    signal?: AbortSignal,
  ): Promise<readonly ThreadLeadRow[] | null> {
    if (this.deps.windowReader === undefined) {
      return (
        this.deps.store.threadLeadRows?.(
          sessionId,
          LEADS_OPEN_WITH,
          before,
          HISTORICAL_LEADS_OPEN_WITH,
        ) ?? null
      )
    }
    return this.ops.freshWindowQuery(
      {
        kind: 'leads',
        sessionId,
        before,
        opening: LEADS_OPEN_WITH,
        historicalOpening: HISTORICAL_LEADS_OPEN_WITH,
      },
      (result) => {
        if (result.kind !== 'leads') throw new WindowReadUnavailable()
        return result.rows
      },
      signal,
    )
  }
}

export { CONTEXT_LOOKBACK_ROWS, noPageBefore }
