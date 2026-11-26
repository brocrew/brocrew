import { nativeRun, agentInput, runLine } from '../native-run'
import type { RuntimeEvent } from '../events'
import { codexTurnOutcome, isCodexToolItem, subAgentBirth } from './normalize'

/**
 * The life of a Codex sub-agent after its birth, folded onto the `sub_agent` card the birth opened.
 * Codex announces a sub-agent once on the parent's item stream; afterwards its progress arrives as
 * frames keyed by the child's thread id (`thread/status/changed`, and on this connection the child's
 * `turn/started`, items, `thread/tokenUsage/updated` and `turn/completed`). This class remembers
 * which threads were announced so those frames can be attributed, keeping `normalizeNotification`
 * pure. One instance per session.
 *
 * It learns from the neutral `sub_agent` events ({@link CodexSubAgents.note}), so the
 * `subAgentActivity` shape is parsed in one place. `agentId` is a thread id, which is also the key
 * the status notifications use. A grandchild's birth arrives stamped with the child's `threadId` and
 * is adopted by {@link CodexSubAgents.report}; {@link CodexSubAgents.observe} remains the floor for a
 * thread that was never announced. `thread/status/changed` stays because it is the only signal for a
 * child whose turn completion is never seen.
 * Raw spawn input supplies the private prompt and model.
 */

/** What is known about one child. */
interface Child {
  prompt?: string
  kind?: string
  model?: string
  outcome?: Extract<RuntimeEvent, { type: 'sub_agent' }>['outcome']
  result?: string
  /**
   * Whether its thread is currently active. Written only by {@link CodexSubAgents.status}, so it
   * mirrors the last status frame; otherwise a repeated `active` would read as a new transition.
   */
  working: boolean
  /** Whether an ending was reported, so a repeated `idle` does not report a second. */
  ended: boolean
  /**
   * Whether the thread was announced, as opposed to merely seen working. {@link observe} fails open,
   * so only announced threads may have their tokens, tool counts, outcome and announcements read
   * ({@link CodexSubAgents.report}).
   */
  announced: boolean
  /**
   * Whether the parent's turn ended and closed this card, so nothing more may be said about it. It
   * is distinct from {@link ended}, which the child's own `idle` also sets one frame before its
   * `turn/completed`. A child cut off by an interrupt keeps "ended, no outcome" so the ledger never
   * reads "the turn ended, and then a sub-agent stopped". Set only by {@link seal}.
   */
  sealed: boolean
  /** The child's current turn, from its `turn/started`. */
  turnId: string | null
  /**
   * The child's turn whose outcome was already reported. An id rather than a flag, so a repeat and a
   * delayed frame from an earlier turn are refused while a later turn's outcome is still reportable.
   */
  outcomeFor: string | null
  /** Tool items this child has completed, rendered as `N tools`. */
  toolCalls: number
  /**
   * Milliseconds across every turn of the child's life. Accumulated because the card's other usage
   * fields are whole-life totals and `mergeUsage` keeps the larger value.
   */
  ms: number
}

export class CodexSubAgents {
  private readonly children = new Map<string, Child>()

  /**
   * @param ownThreadId this session's own thread, read fresh because the handshake sets it after
   * construction. Its status must never open a card; see {@link observe}.
   */
  constructor(private readonly ownThreadId: () => string | undefined) {}

  /**
   * Learn which threads are sub-agents from the events the normalizer just produced. An `interrupted`
   * birth arrives already ended and must leave the entry ended, so a trailing `idle` reports no
   * second ending.
   */
  note(event: RuntimeEvent, params?: unknown): RuntimeEvent {
    if (event.type !== 'sub_agent') return event
    const child = this.children.get(event.agentId) ?? blankChild()
    const item = readField(params, 'item')
    const prompt = readString(item, 'prompt')
    if (prompt && child.ended)
      event = {
        ...event,
        phase: 'ended',
        ...(child.outcome ? { outcome: child.outcome } : {}),
        run: nativeRun('agent', { ...event.run, result: child.result }),
      }
    child.prompt = prompt || child.prompt
    child.kind = event.kind ?? child.kind
    child.model = readString(item, 'model') || child.model
    if (event.phase === 'ended') {
      child.ended = true
      child.outcome = event.outcome ?? child.outcome
      child.result = event.run?.result ?? child.result
    }
    // Announced is a one-way door set from the event: `observe` marks its own events
    // `origin: 'observed'`, and later phases of an observed card carry no origin, so test for `observed`.
    if (event.origin !== 'observed') child.announced = true
    this.children.set(event.agentId, child)
    const noted: RuntimeEvent = {
      ...event,
      run: nativeRun('agent', {
        ...event.run,
        input:
          params === undefined
            ? event.run?.input
            : agentInput(child.prompt, child.kind, child.model),
      }),
    }
    if (event.phase === 'ended') delete child.prompt
    return noted
  }

  /**
   * The parent's turn ended and closed this card. The child's later `turn/completed`, token readings
   * and tool completions would otherwise speak about a closed card and reopen it.
   */
  seal(event: RuntimeEvent): void {
    this.note(event)
    if (event.type !== 'sub_agent') return
    const child = this.children.get(event.agentId)
    if (child) child.sealed = true
  }

  /**
   * Handle a frame whose `threadId` is a thread already known as a child: a report about a child
   * card, not someone else's conversation. A child's `turn/completed`, `thread/tokenUsage/updated`
   * and its own `subAgentActivity` all arrive under the child's id. Only announced children are
   * read ({@link Child.announced}); an observed card gets its status and nothing else.
   *
   * This relies on `createSpawnTransportFactory` giving each session its own `app-server` with one
   * thread, so a foreign thread here is a descendant; a shared transport would need this re-checked.
   *
   * The child's terminal message is retained in summary, with its first line in run.result.
   */
  report(method: string, params: unknown): RuntimeEvent[] {
    const agentId = readString(params, 'threadId')
    const child = this.children.get(agentId)
    // Refuse a thread with no card, a card nothing announced, and a card the parent's turn closed.
    if (!child || !child.announced || child.sealed) return []
    switch (method) {
      // Not shown for a card, but the correlation the outcome below is checked against.
      case 'turn/started':
        child.turnId = readString(readField(params, 'turn'), 'id')
        return []
      case 'item/started':
        return child.ended ? [] : this.descendant(agentId, params)
      case 'item/completed':
        return child.ended ? [] : tools(agentId, child, params)
      case 'thread/tokenUsage/updated':
        // Nothing progresses after ending; an event about a closed card would reopen it.
        return child.ended ? [] : tokens(agentId, params)
      case 'turn/completed':
        // Not gated on `ended`: the child's `idle` sets it one frame before this arrives, and this
        // frame says how it went. `sealed` is the guard that applies.
        return this.finished(agentId, child, params)
      default:
        return []
    }
  }

  /**
   * A child of one of our children, announced on its parent's thread. Only `item/started` is read,
   * since `item/completed` carries an identical item. The birth's `agentPath` (e.g.
   * `/root/coordinator/gamma`) gives the lineage. Because the id comes from the payload, an item
   * naming our own thread or its own announcer is refused; either would let our own status drive a
   * sub-agent card.
   */
  private descendant(announcer: string, params: unknown): RuntimeEvent[] {
    const item = readField(params, 'item')
    if (!isRecord(item) || item['type'] !== 'subAgentActivity') return []
    const born = subAgentBirth(item)
    if (!born || born.type !== 'sub_agent') return []
    const own = this.ownThreadId()
    if (!own || born.agentId === own || born.agentId === announcer) return []
    // Registered as well as emitted, so the grandchild's own frames under its id are read.
    // `children` were the normalizer's output for our own thread.
    return [this.note(born, params)]
  }

  /**
   * How a child's turn ended. Uses `codexTurnOutcome` so a child's ending fails closed like the
   * parent's (`inProgress` reports `failed`; unknown statuses are never success), and correlates on
   * the turn id (see {@link Child.outcomeFor}). It does not touch {@link Child.working}.
   */
  private finished(agentId: string, child: Child, params: unknown): RuntimeEvent[] {
    const turn = readField(params, 'turn')
    const turnId = readString(turn, 'id')
    // Refuse a turn already answered or not the child's current turn, so a delayed frame cannot report another turn's outcome.
    if (child.outcomeFor === turnId) return []
    if (child.turnId !== null && turnId !== child.turnId) return []
    child.outcomeFor = turnId
    child.ended = true
    const summary = finalAnswer(turn)
    child.outcome = codexTurnOutcome(params).outcome
    child.result = runLine(summary) ?? child.outcome
    const ms = readCount(turn, 'durationMs')
    if (ms !== undefined) child.ms += ms
    const ended: RuntimeEvent = {
      type: 'sub_agent',
      agentId,
      phase: 'ended',
      outcome: child.outcome,
      ...(summary ? { summary } : {}),
      run: nativeRun('agent', {
        result: child.result,
      }),
      ...(child.ms > 0 ? { usage: { ms: child.ms } } : {}),
    }
    delete child.prompt
    return [ended]
  }

  /**
   * One `thread/status/changed` as the card's progress or ending, or nothing. It ends a card whose
   * turn completion is never seen; the child's `turn/completed` follows one frame later and carries
   * the outcome ({@link report}). It must stay out of `TURN_SCOPED_METHODS`: it carries the child's
   * thread id and no turn id, so gating it on the parent's turn would drop the ending.
   *
   * `active` before `idle` is required: every child's first status is an `idle` for the empty
   * thread, before the birth. A child that goes active again after ending is reported as working;
   * the fold cannot currently un-end a card.
   */
  status(method: string, params: unknown): RuntimeEvent[] {
    if (method !== 'thread/status/changed') return []
    const agentId = readString(params, 'threadId')
    const state = readString(readField(params, 'status'), 'type')
    const child = this.children.get(agentId)
    // Not a known child: a working thread nothing announced goes to the observe floor.
    if (!child) return this.observe(agentId, state)
    // Transitions only; the provider repeats a status freely.
    if (state === 'active') {
      if (child.working) return []
      child.working = true
      child.ended = false
      delete child.outcome
      delete child.result
      // Turn correlation stays intact while presentation facts are cleared.
      return [
        {
          type: 'sub_agent',
          phase: 'progress',
          agentId,
          run: nativeRun('agent', { progress: 'Running' }),
        },
      ]
    }
    if (state !== 'idle' || !child.working || child.ended) return []
    child.working = false
    child.ended = true
    // No outcome: an idle thread only says it stopped. The child's `turn/completed` supplies it.
    return [{ type: 'sub_agent', phase: 'ended', agentId, run: nativeRun('agent') }]
  }

  /**
   * A working thread nobody announced. It is the floor for a descendant whose birth was missed or a
   * frame shape this adapter does not read; a working thread on our connection should be visible,
   * without guessing a parent. Only `active` opens a card, since every thread announces itself idle.
   * It fails closed for an unidentifiable thread and for a session whose own thread id is unknown.
   */
  private observe(agentId: string, state: string): RuntimeEvent[] {
    const own = this.ownThreadId()
    if (!agentId || !own || agentId === own) return []
    if (state !== 'active') return []
    // `announced` stays false: this door fails open, so its entry must not have tokens, tool counts,
    // outcomes or announcements read; it gets a card and its own status only.
    this.children.set(agentId, { ...blankChild(), working: true })
    // From here it is an ordinary child; a later announcement merges onto this card because `note` keeps the existing entry.
    return [
      {
        type: 'sub_agent',
        agentId,
        idKind: 'thread',
        phase: 'started',
        origin: 'observed',
        run: nativeRun('agent', { progress: 'Running' }),
      },
    ]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  const field = readField(value, key)
  return typeof field === 'string' ? field : ''
}

/** A count off the wire: finite and not negative, since a negative would render as a negative duration. */
function readCount(value: unknown, key: string): number | undefined {
  const field = readField(value, key)
  return typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : undefined
}

/** A child just heard of: nothing has happened to it yet. */
function blankChild(): Child {
  return {
    working: false,
    ended: false,
    announced: false,
    sealed: false,
    turnId: null,
    outcomeFor: null,
    toolCalls: 0,
    ms: 0,
  }
}

/** The tokens a child has spent, from `thread/tokenUsage/updated`. `total`, not `last`: the card shows the whole spend. */
function tokens(agentId: string, params: unknown): RuntimeEvent[] {
  const total = readCount(readField(readField(params, 'tokenUsage'), 'total'), 'totalTokens')
  if (total === undefined) return []
  return [
    {
      type: 'sub_agent',
      agentId,
      phase: 'progress',
      run: nativeRun('agent', { progress: `${total} tokens` }),
      usage: { tokens: total },
    },
  ]
}

/** One more tool call finished inside a child; counted on `item/completed` so the number is what it has done. */
function tools(agentId: string, child: Child, params: unknown): RuntimeEvent[] {
  const type = readString(readField(params, 'item'), 'type')
  if (!isCodexToolItem(type)) return []
  child.toolCalls += 1
  return [
    {
      type: 'sub_agent',
      agentId,
      phase: 'progress',
      run: nativeRun('agent', { progress: `${child.toolCalls} tool calls` }),
      usage: { toolCalls: child.toolCalls },
    },
  ]
}

function finalAnswer(turn: unknown): string | undefined {
  const items = readField(turn, 'items')
  if (!Array.isArray(items)) return undefined
  return items
    .filter((item) => readString(item, 'type') === 'agentMessage')
    .map((item) => readString(item, 'text'))
    .at(-1)
}
