import type { RuntimeEvent } from '../events'
import { codexTurnOutcome, isCodexToolItem, subAgentBirth } from './normalize'

/**
 * The life of a Codex sub-agent AFTER its birth (033), folded onto the same `sub_agent` card the
 * birth opened.
 *
 * **Why this is a class and `normalize.ts` is a pure function.** Codex announces a sub-agent once,
 * on the parent's item stream, and then says nothing more about it there. Everything that happens
 * next arrives as `thread/status/changed` keyed by the CHILD's thread id — a notification that, read
 * on its own, is indistinguishable from the parent's own status or from any other thread's. Deciding
 * whether one of those is a sub-agent's progress requires remembering which threads were announced,
 * and that memory must not live in `normalizeNotification`, whose purity is what makes it testable
 * one message at a time. One instance per session, driven from the runtime's notification loop.
 *
 * **And remembering the announcements is not enough, because one agent can reach us unannounced.**
 * 135 measured a depth-2 agent that arrived as three status frames and no birth, and concluded the
 * announcement happens "on a connection this app does not hold". ⛔ **226 measured the wire and that
 * conclusion is wrong** — see {@link CodexSubAgents.report}. The grandchild's birth DOES arrive
 * here; it is stamped with the CHILD's `threadId`, and this session's own thread gate refused it
 * before anything could read it. 135 described its own instrument. {@link CodexSubAgents.observe}
 * stays as the floor for a thread that really was never announced.
 *
 * **It learns from the neutral event, not from the provider payload.** {@link CodexSubAgents.note}
 * takes the `sub_agent` events `normalize.ts` just produced, so the shape of a `subAgentActivity`
 * item is read in exactly ONE place and these two cannot drift about which threads are children.
 * `agentId` is the correlation key by design, and it is a thread id, so it is also the key the
 * status notifications arrive under — no second identity, no second parser.
 *
 * **What Codex does not send, this file does not invent — and 226 measured what it DOES send.**
 * This paragraph used to read *"There is no usage, no `lastTool`, and no final answer… An ending
 * therefore carries NO outcome"*, verified across four sessions. ⛔ **Every clause of that is false
 * on the wire.** Against the pinned 0.146.0 binary, a capture of five real children — two at
 * depth 1, one coordinator and its two of its own — carries, per child, on THIS connection:
 * `turn/started`, its own `item/started`/`item/completed` lifecycle, 17–22 `agentMessage` deltas,
 * two or more `thread/tokenUsage/updated`, and a **`turn/completed` whose `turn.status` is the
 * generated `TurnStatus` union** — `completed` there, with `durationMs: 7610` and the child's final
 * answer in `turn.items`.
 *
 * ⚠️ **The four sessions were not misread; they were read downstream of a filter.** Every one of
 * those frames names the CHILD's thread, and this session drops a frame naming another thread
 * before anything normalizes it (200). A claim that a provider "never sends X", justified by a
 * capture taken after the thing that would carry X was discarded, is the shape this project has
 * now hit twice. What is still true, and is why {@link status} stays: `thread/status/changed` is
 * the only signal that arrives for a child whose turn we never see completed.
 */

/** What we know about one child. */
interface Child {
  /**
   * Whether its thread is currently ACTIVE — the guard that makes the ending mean something.
   *
   * ⛔ **Written ONLY by {@link CodexSubAgents.status}, and that is load-bearing.** It is the memory
   * that makes the status stream transition-based, so it has to mirror the last status frame and
   * nothing else. 226 briefly had {@link CodexSubAgents.finished} clear it, and the consequence was
   * exact: after a `turn/completed`, a REPEATED `active` — which the provider sends freely — read as
   * a fresh transition, emitting a spurious `progress` and re-arming everything behind it.
   */
  working: boolean
  /** Whether an ending has been reported, so a repeated `idle` does not report a second one. */
  ended: boolean
  /**
   * ⛔ **Whether anything ANNOUNCED this thread, or we merely saw it working** (226).
   *
   * ⚠️ **This is the membership test {@link CodexSubAgents.report} rests on, and it exists because
   * the sentence there was false without it.** {@link observe} fails OPEN by design — any thread
   * that goes `active` and is not ours gets an entry — which cost one nameless card before 226 and
   * would now hand that thread's token totals, tool counts, outcome and its own announcements a
   * place in this conversation. A card opened on nothing but "it went active" is not a thread we
   * were told about, and only a thread we were told about is READ.
   */
  announced: boolean
  /**
   * ⛔ **The parent's turn ended and closed this card, so nothing more may be said about it** (075).
   *
   * ⚠️ **Distinct from {@link ended}, and the difference is the whole reason this field exists.**
   * `ended` is also set by the child's own `idle`, which lands one frame BEFORE its `turn/completed`
   * in every capture — so refusing on `ended` would refuse the outcome in the ordinary case. This is
   * set only by {@link seal}, from the one place that closes cards at a turn boundary.
   *
   * ⚑ **What it costs, said plainly:** a child cut off by an interrupt keeps its honest *"ended, no
   * outcome"* even though the provider went on to say how it went. That is 075's ruling, not an
   * oversight — an ending emitted after the terminal `turn` makes the ledger read *"the turn ended,
   * and then a sub-agent stopped"*, which is a different sentence and the one that mechanism exists
   * to prevent.
   */
  sealed: boolean
  /** The child's own turn we are currently hearing about, from its `turn/started`. */
  turnId: string | null
  /**
   * The child's turn whose outcome has already been reported (226).
   *
   * ⛔ **An id rather than a flag, because a flag answers the wrong question.** A boolean stops a
   * repeat and also stops a SEQUEL; clearing it on `active` restores the sequel and lets a DELAYED
   * turn-1 frame land on turn 2, reporting the wrong turn's outcome and duration. Correlating on the
   * turn id is the same answer `isCurrentProviderTurn` gives for the parent's own turn, and it
   * refuses all three: a repeat matches, a stale frame does not match {@link turnId}, and a sequel
   * matches neither.
   */
  outcomeFor: string | null
  /** Tool items this child has completed — the count the card renders as `N tools`. */
  toolCalls: number
  /**
   * Milliseconds across EVERY turn of this child's life.
   *
   * ⚠️ **Accumulated rather than reported per turn**, because the card's other two usage fields are
   * whole-life totals and `mergeUsage` keeps the larger of what it holds. A per-turn duration beside
   * cumulative tokens would make the card read "everything it ever spent, in the time of whichever
   * single turn happened to be longest" — a number that describes no turn that ever ran.
   */
  ms: number
}

export class CodexSubAgents {
  private readonly children = new Map<string, Child>()

  /**
   * @param ownThreadId THIS session's own thread, read fresh because the handshake sets it after
   * construction. It is the one thread whose status must never open a card — see {@link observe},
   * where not knowing it yet is a refusal rather than a guess.
   */
  constructor(private readonly ownThreadId: () => string | undefined) {}

  /**
   * Learn which threads are sub-agents, from the events the NORMALIZER just produced.
   *
   * Only those: this tracker's own output is never fed back, so there is no loop to reason about.
   * An `interrupted` birth arrives here already ended, and must leave the entry ended so the
   * child's trailing `idle` cannot report a second ending for the same card.
   */
  note(event: RuntimeEvent): void {
    if (event.type !== 'sub_agent') return
    const child = this.children.get(event.agentId) ?? blankChild()
    if (event.phase === 'ended') child.ended = true
    // ⛔ **Announced is a one-way door, and it is set from the EVENT rather than assumed** (226).
    // Everything that reaches here is a `sub_agent` event, but only some of them are announcements:
    // `observe` marks its own with `origin: 'observed'` precisely so this can tell them apart, and a
    // later phase for an observed card carries no origin at all — so the test is the explicit
    // `observed`, never the absence of one.
    if (event.origin !== 'observed') child.announced = true
    this.children.set(event.agentId, child)
  }

  /**
   * ⛔ **The parent's turn ended, and this card went with it** (075, wired in 226).
   *
   * `deliver` closes every open sub-agent card on the terminal `turn` so that the ledger cannot read
   * *"the turn ended, and then a sub-agent stopped"*. It used to tell this tracker with {@link note},
   * which stops the child's trailing `idle` reporting a second ending — and that was enough while
   * `thread/status/changed` was the only thing read. It is not enough now: the child's own
   * `turn/completed`, its trailing token readings and its late tool completions all arrive AFTER
   * that boundary and would each speak about a card the app has already closed, one of them putting
   * it back in `open` to be closed a second time on the next turn.
   */
  seal(event: RuntimeEvent): void {
    this.note(event)
    if (event.type !== 'sub_agent') return
    const child = this.children.get(event.agentId)
    if (child) child.sealed = true
  }

  /**
   * ⛔ **A frame whose `threadId` is a thread we already know is ours** — a report ABOUT a child,
   * not a piece of somebody else's conversation (226).
   *
   * ⚠️ **This is the same distinction 200 drew, applied to a case it did not have.** That dispatch
   * split `threadId` into two meanings — *whose stream this belongs to* everywhere, and *which
   * thread this report is about* on `thread/status/changed` — and named exactly one method in the
   * second set because that was the only one anybody had measured. 226 measured the rest: a child's
   * `turn/completed`, its `thread/tokenUsage/updated`, and the `subAgentActivity` announcing a
   * child of its OWN all arrive here under the child's id, and every one of them is a report about
   * a card this session already shows.
   *
   * ⛔ **The membership test is ANNOUNCEMENT, and the first version of this sentence was wrong.** It
   * read *"a thread we were TOLD about — or one {@link observe} already opened a card for"*, and
   * those are not the same set: `observe` fails open, so the second half is "any thread that ever
   * went active on this connection". That was one nameless card's worth of exposure before 226 and
   * would have been this thread's tokens, tool counts, outcome and its own announcements after it.
   * {@link Child.announced} is the fix — an observed card still gets its status and nothing else.
   *
   * ⚠️ **The bound underneath it, restated rather than leaned on silently.** `createSpawnTransportFactory`
   * gives every session its own `app-server` process with one thread on it, so a foreign thread here
   * is in practice a descendant rather than another user's conversation. That is an argument about
   * the transport, not about this class — a shared or multiplexed one would break it, and this is
   * the second place that has to be re-measured if one is ever introduced.
   *
   * ⛔ **And it forwards nothing the child SAID.** The same frames carry the child's prose, its
   * reasoning and its final answer, and those belong in a body this card does not have — 128's
   * ruling is that a child's words must be owned by the card that says who is speaking, and there
   * is no such surface for a Codex child yet. What crosses is what the head already has a field
   * for: a name, a count, an outcome.
   */
  report(method: string, params: unknown): RuntimeEvent[] {
    const agentId = readString(params, 'threadId')
    const child = this.children.get(agentId)
    // Three refusals, in the order they stop being about this frame at all: a thread with no card;
    // a card nothing announced; and a card the parent's turn has already closed (075).
    if (!child || !child.announced || child.sealed) return []
    switch (method) {
      // Not read for a card, but the correlation every outcome below is checked against.
      case 'turn/started':
        child.turnId = readString(readField(params, 'turn'), 'id')
        return []
      case 'item/started':
        return child.ended ? [] : this.descendant(agentId, params)
      case 'item/completed':
        return child.ended ? [] : tools(agentId, child, params)
      case 'thread/tokenUsage/updated':
        // ⛔ **Nothing PROGRESSES after it has ended.** `status` has refused this since 033 and the
        // two new progress paths must refuse it for the same reason: an event about a closed card
        // puts it back in `openSubAgents`, to be closed a second time at the next turn boundary.
        return child.ended ? [] : tokens(agentId, params)
      case 'turn/completed':
        // ⚠️ **NOT gated on `ended`** — alone among the four. The child's own `idle` sets that flag
        // one frame before this arrives in every capture, so the gate that is right everywhere else
        // would refuse the one frame that says how it went. `sealed` above is the guard that
        // belongs here, and it is about the PARENT's turn rather than the child's.
        return this.finished(agentId, child, params)
      default:
        return []
    }
  }

  /**
   * A child of one of our children, announced on ITS parent's thread (226).
   *
   * ⚑ **This is the case `origin: 'observed'` was built for, and it is no longer blind.** The birth
   * carries the same `agentThreadId` and `agentPath` a depth-1 child's does — measured as
   * `/root/coordinator/gamma`, which `agentName` already renders as `coordinator/gamma`, so the
   * lineage the card shows is the provider's own word for it rather than a tree this app built.
   *
   * ⚠️ **`item/started` only**, never `item/completed`: the two carry a byte-identical item and 033
   * is the dispatch that paid for reading both.
   *
   * ⛔ **The two identity refusals {@link observe} makes, made here too — and this is the one door
   * that needed them most.** Every other path keys on the `threadId` the gate has already checked;
   * this one takes an id out of the frame's PAYLOAD (`agentThreadId`), which nothing has looked at.
   * An item naming OUR OWN thread would put this session into {@link children} — after which its
   * own `thread/status/changed`, exempt from the foreign gate by design, would stop reaching
   * {@link observe}'s refusal and start driving a sub-agent card of the conversation itself, going
   * `progress` whenever it worked and `ended` whenever it went idle. An item naming its own
   * ANNOUNCER is the same shape one step in. Neither has been observed; both are one comparison.
   */
  private descendant(announcer: string, params: unknown): RuntimeEvent[] {
    const item = readField(params, 'item')
    if (!isRecord(item) || item['type'] !== 'subAgentActivity') return []
    const born = subAgentBirth(item)
    if (!born || born.type !== 'sub_agent') return []
    const own = this.ownThreadId()
    if (!own || born.agentId === own || born.agentId === announcer) return []
    // Registered here as well as emitted: a grandchild's own status frames and its own
    // `turn/completed` arrive under ITS id, and none of them would be read if the only way into
    // `children` were the normalizer's output for our own thread.
    this.note(born)
    return [born]
  }

  /**
   * How a child's turn ended, in the provider's own word (226).
   *
   * ⛔ **`codexTurnOutcome` rather than a second mapping**, so a child's ending fails closed for the
   * same reasons the parent's does (055): `inProgress` on a `turn/completed` is a contradiction and
   * reports `failed`, and a status outside the generated union is never read as success.
   *
   * ⛔ **Correlated on the turn id, which is what the parent's own path does** — see
   * {@link Child.outcomeFor} for the three frames this refuses and why a boolean refused the wrong
   * two of them.
   *
   * ⚠️ **It does not touch {@link Child.working}.** That field mirrors the status stream and nothing
   * else; writing it from here made a repeated `active` — which the provider sends freely — read as
   * a fresh transition.
   */
  private finished(agentId: string, child: Child, params: unknown): RuntimeEvent[] {
    const turn = readField(params, 'turn')
    const turnId = readString(turn, 'id')
    // A frame for a turn we have already answered, or for one that is not the turn this child is on
    // — a delayed turn-1 completion landing during turn 2 would otherwise report turn 1's outcome
    // and turn 1's duration as turn 2's.
    if (child.outcomeFor === turnId) return []
    if (child.turnId !== null && turnId !== child.turnId) return []
    child.outcomeFor = turnId
    child.ended = true
    const ms = readCount(turn, 'durationMs')
    if (ms !== undefined) child.ms += ms
    return [
      {
        type: 'sub_agent',
        agentId,
        phase: 'ended',
        outcome: codexTurnOutcome(params).outcome,
        ...(child.ms > 0 ? { usage: { ms: child.ms } } : {}),
      },
    ]
  }

  /**
   * One `thread/status/changed` → the card's progress or its ending, or nothing at all.
   *
   * ⚠️ **This used to open "the only completion signal Codex sends", and 226 measured a second
   * one**: the child's own `turn/completed`, which arrives one frame LATER and is the only frame
   * that says HOW it ended (see {@link report}). This one stays first and stays load-bearing —
   * it is what ends a card whose turn we never see complete — but it is no longer the only one, and
   * the sentence it justified (*"an ending carries no outcome"*) is gone with it.
   *
   * It must stay out of `TURN_SCOPED_METHODS` all the same: it carries the CHILD's thread id and no
   * turn id, so gating it on the parent's turn would drop the event that ends the card.
   *
   * `active` before `idle` is required, and is not defensive dressing. Every child's FIRST status is
   * an `idle` announcing the empty thread — it arrives BEFORE the birth in all four captures — so
   * "idle ends the card" alone would end every sub-agent at the instant it was born.
   *
   * A child that goes active again after ending (`sendInput`, `resumeAgent` — neither yet observed)
   * is reported as working again. 029's fold cannot currently un-end a card, so today that shows as
   * nothing changing; emitting the truth and leaving the renderer behind is the right way round.
   */
  status(method: string, params: unknown): RuntimeEvent[] {
    if (method !== 'thread/status/changed') return []
    const agentId = readString(params, 'threadId')
    const state = readString(readField(params, 'status'), 'type')
    const child = this.children.get(agentId)
    // Not a thread we were told about. This used to end here, and the comment that ended it named
    // two cases — "the parent's own status" and "some thread that is none of our business". A
    // GRANDCHILD is neither, and it was the case with no name (135).
    //
    // ⚠️ **226 moved the grandchild OUT of this branch**: its birth does reach us, on its parent's
    // thread, so `report` registers it and this lookup hits. What is left here is the honest floor —
    // a working thread nothing announced, whatever the reason.
    if (!child) return this.observe(agentId, state)
    // TRANSITIONS, not states. The provider repeats a status freely, and a card that re-reported
    // "still working" on every repeat would fill the ledger with events that say nothing.
    if (state === 'active') {
      if (child.working) return []
      child.working = true
      child.ended = false
      // ⚠️ **Nothing about the OUTCOME is cleared here, and the first version of 226 did clear it.**
      // A child that goes active again is running a second turn, and that turn's ending has to be
      // reportable — but a flag cleared on `active` also re-opens the door to a DELAYED frame from
      // the first turn, which then lands as the second turn's outcome. {@link Child.outcomeFor}
      // correlates on the turn id instead, which permits the sequel and refuses the stale frame.
      return [{ type: 'sub_agent', phase: 'progress', agentId }]
    }
    if (state !== 'idle' || !child.working || child.ended) return []
    child.working = false
    child.ended = true
    // No `outcome`: "it stopped" is all an idle thread says, and the card must not read that as
    // "it succeeded". ⚑ **The outcome follows on the child's own `turn/completed`** (226), one
    // frame later in every capture — so this stays the honest partial answer rather than the whole
    // one, and a child whose turn never completes still ends here with the silence it earned.
    return [{ type: 'sub_agent', phase: 'ended', agentId }]
  }

  /**
   * A thread NOBODY announced, working on our connection.
   *
   * ⛔ **This was written as the grandchild's case, and 226 measured that it is not** (135). The
   * reasoning there — the depth-2 spawn is announced to the CHILD, so the parent never hears it —
   * is true of the ROLLOUT FILES it was read from and false of this socket: the announcement
   * arrives here stamped with the child's `threadId`, and 200's thread gate discarded it before
   * anything could look. {@link report} adopts it now, so a grandchild reaches {@link status} as an
   * announced child with the name the model gave it.
   *
   * ⚑ **So what is this for?** A thread that goes active having been announced nowhere at all — a
   * descendant deeper than one whose intermediate birth we missed, a spawn on a frame shape this
   * adapter does not read, a provider change. It is the floor, not the grandchild's home, and it
   * must stay: a working thread on our connection that we cannot name is a thing the user should
   * see, and 035's rule is that we say what we know rather than guess a parent for it.
   *
   * **`active`, never the leading `idle`.** Every Codex thread announces itself idle before it does
   * anything, so opening on that would put a card on screen for a thread that may never run — and
   * would open one for every thread the server ever mentions. Waiting for `active` costs nothing:
   * an agent that never worked has nothing to show.
   *
   * **Two refusals, both fail-closed.** An unidentifiable thread is nothing. And a session whose
   * own thread id we do not yet know CANNOT tell its own status from a descendant's — so it opens
   * nothing at all, because a card for ourselves is a worse answer than a missing one.
   */
  private observe(agentId: string, state: string): RuntimeEvent[] {
    const own = this.ownThreadId()
    if (!agentId || !own || agentId === own) return []
    if (state !== 'active') return []
    // ⛔ **`announced` stays FALSE, and that is what makes `report`'s sentence true** (226). This
    // door fails open by design — any working thread that is not ours gets an entry — so an entry it
    // made must not be read for tokens, tool counts, outcomes or announcements of its own. It gets
    // exactly what it always got: a card, and its own status.
    this.children.set(agentId, { ...blankChild(), working: true })
    // From here it is an ordinary child: its `idle` ends it through the same transitions above, and
    // an announcement that somehow did arrive would MERGE onto this card rather than open a second,
    // because `note` keeps the entry it finds and the fold correlates on `agentId`.
    return [{ type: 'sub_agent', agentId, idKind: 'thread', phase: 'started', origin: 'observed' }]
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

/**
 * A COUNT off the wire: finite, and not negative.
 *
 * ⛔ **`Number.isFinite` alone was not enough.** `null` is what the protocol sends for "not known"
 * and `NaN` is what a malformed payload produces — both refused — but `-1` passed, and
 * `subAgentEventSchema.usage` has no lower bound, so it would validate, survive `mergeUsage`'s
 * `Math.max` as the only value present, and render as a negative duration. A number that cannot be
 * a measurement is refused here rather than shown: an honest blank is the fallback (111).
 */
function readCount(value: unknown, key: string): number | undefined {
  const field = readField(value, key)
  return typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : undefined
}

/** A child we have just heard of: nothing has happened to it yet, and every field says so. */
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

/**
 * The tokens a child has spent, from its own `thread/tokenUsage/updated` (226).
 *
 * ⚠️ **`total`, not `last`.** The provider sends both on every reading and `last` is the most recent
 * request alone; the card's field is the child's whole spend, and `mergeUsage` keeps the larger of
 * what it has — so feeding it a per-request number would make the card report whichever single
 * request happened to be biggest.
 */
function tokens(agentId: string, params: unknown): RuntimeEvent[] {
  const total = readCount(readField(readField(params, 'tokenUsage'), 'total'), 'totalTokens')
  if (total === undefined) return []
  return [{ type: 'sub_agent', agentId, phase: 'progress', usage: { tokens: total } }]
}

/**
 * One more tool call finished inside a child (226).
 *
 * ⚑ **Counted on `item/completed` rather than `item/started`**, so the number says what the child
 * HAS done rather than what it has begun — the same reading `074` enforced on the parent's own rows
 * when it swept out the tool that said `running…` forever.
 */
function tools(agentId: string, child: Child, params: unknown): RuntimeEvent[] {
  const type = readString(readField(params, 'item'), 'type')
  if (!isCodexToolItem(type)) return []
  child.toolCalls += 1
  return [{ type: 'sub_agent', agentId, phase: 'progress', usage: { toolCalls: child.toolCalls } }]
}
