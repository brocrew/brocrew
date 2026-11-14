import type { WorkAncestry } from '../../../../shared/work-ancestry'
import type { TranscriptItem } from '../transcript-message-contracts'
import type {
  ToolItem,
  WorkflowRunCard,
  SubAgentCard,
  SubAgentToolRow,
} from '../transcript-tool-contracts'
import type { TranscriptState } from '../transcript-state-contracts'
import { nextId, itemById } from './items'

/**
 * Every sub-agent card in the transcript, however deep, paired with the transcript item that holds
 * it (037) — which is where a reader has to be taken to see it.
 *
 * The home is worked out STRUCTURALLY, by walking down from each item, rather than by reading
 * {@link TranscriptState.subAgentHomes}. That index answers a different question: it records the
 * immediate holder, and for a card nested inside another card's tool entry the holder is
 * `card:<agentId>` — not an item id at all, and nothing on screen to scroll to. Walking down gets
 * the item a grandchild is ultimately rendered inside, in one pass, with no chain to follow.
 */
export function cardHomes(state: TranscriptState): { card: SubAgentCard; itemId: string }[] {
  const out: { card: SubAgentCard; itemId: string }[] = []
  const walk = (cards: SubAgentCard[], itemId: string): void => {
    for (const card of cards) {
      out.push({ card, itemId })
      for (const row of card.body)
        if (row.kind === 'tool' && row.subAgents) walk(row.subAgents, itemId)
    }
  }
  for (const item of state.items) walk(cardsOf(item), item.id)
  return out
}

export function acceptWorkAncestry(state: TranscriptState, read: WorkAncestry): void {
  const changedEpoch = read.after !== undefined && read.after !== state.workAncestry.after
  if (read.after !== undefined) state.workAncestry.after = read.after
  if (read.reset === true || changedEpoch) {
    state.subAgentHomes = {}
    state.subAgentCards.clear()
    state.toolItems = {}
    state.cardTools = {}
  }
  if (read.reset === true || changedEpoch) {
    state.workAncestry.agents.clear()
    state.workAncestry.tools.clear()
    state.workAncestry.dispatches.clear()
    state.workAncestry.missing = []
    state.workAncestry.truncated = false
  }
  for (const fact of read.agents) state.workAncestry.agents.set(fact.agentId, fact)
  for (const fact of read.tools) state.workAncestry.tools.set(fact.callId, fact)
  for (const fact of read.dispatches) state.workAncestry.dispatches.set(fact.callId, fact)
  if (read.missing !== undefined) state.workAncestry.missing = read.missing
  if (read.truncated !== undefined) state.workAncestry.truncated = read.truncated
}

/**
 * Every tool row on screen, at every depth — the conversation's own and each sub-agent's (029/035).
 *
 * ⚑ **It replaces two loops that were already there**, spelled out one after the other in
 * {@link stopOpenToolCalls} because the conversation's rows and a card's rows live in different
 * places. 248 needed a third pass over the same set; naming the walk is what kept it from becoming a
 * third copy.
 */
export function* everyToolRow(state: TranscriptState): Generator<ToolItem | SubAgentToolRow> {
  for (const item of state.items) if (item.kind === 'tool') yield item
  for (const card of everyCard(state)) {
    for (const row of card.body) if (row.kind === 'tool') yield row
  }
}

/**
 * The tool row a provider call landed on — the conversation's own {@link ToolItem}, or the
 * {@link SubAgentToolRow} on the card of whichever agent made it (035).
 *
 * ⚠️ **Two lookups because there are two homes, and the id index is different in each.** A
 * top-level row is in `toolItems`; a child's call is deliberately not, and is reachable through
 * `cardTools` instead — see {@link cardOwningTool}.
 */
export function toolRowFor(
  state: TranscriptState,
  callId: string,
): ToolItem | SubAgentToolRow | undefined {
  const item = itemById(state, state.toolItems[callId])
  if (item?.kind === 'tool') return item
  const card = cardOwningTool(state, callId)
  return card?.body.find(
    (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === callId,
  )
}

/** The current provider life's card, retained by identity when its home changes. */
export function findCard(state: TranscriptState, agentId: string): SubAgentCard | undefined {
  return state.subAgentCards.get(agentId)
}

/** Every card held by an item, whichever kind of home it is. */
function cardsOf(item: TranscriptItem | undefined): SubAgentCard[] {
  if (item?.kind === 'tool') return item.subAgents ?? []
  if (item?.kind === 'subAgent') return [item.card]
  return []
}

/**
 * Every card in the transcript, however deep (035).
 *
 * Nesting is recursive now — an agent's agent hangs off the call that dispatched it, inside its
 * parent's card — so any lookup that used to walk `state.items` has to walk the tree instead. The
 * depth is the agent's own doing and nothing here bounds it; in practice it is one or two.
 *
 * Exported since 137 for `carryForward`, which has to know which agents a fold is holding before it
 * throws that fold away. It is the only reader outside this file and it reads, never writes.
 */
export function everyCard(state: TranscriptState): SubAgentCard[] {
  const out: SubAgentCard[] = []
  findCardWhere(state, (card) => {
    out.push(card)
    return false // never satisfied, so the walk is exhaustive
  })
  return out
}

/**
 * The first card anywhere in the tree that satisfies `match` (035).
 *
 * Short-circuiting, and deliberately so: the lookups that run on EVERY tool call go through here,
 * and materializing the whole tree to find one card would make a long transcript quadratic. Only the
 * turn-end sweep, which genuinely wants all of them, pays for the array.
 */
function findCardWhere(
  state: TranscriptState,
  match: (card: SubAgentCard) => boolean,
): SubAgentCard | undefined {
  const walk = (cards: SubAgentCard[]): SubAgentCard | undefined => {
    for (const card of cards) {
      if (match(card)) return card
      // Walked in place rather than through a `.filter(…)` of the tool rows: this runs on every tool
      // call, and materializing an array per card is exactly the quadratic cost the comment above
      // says this function exists to avoid.
      for (const row of card.body) {
        if (row.kind !== 'tool' || !row.subAgents) continue
        const hit = walk(row.subAgents)
        if (hit) return hit
      }
    }
    return undefined
  }
  for (const item of state.items) {
    const hit = walk(cardsOf(item))
    if (hit) return hit
  }
  return undefined
}

/**
 * The card holding `callId` among its OWN tool calls, if any (035) — the second half of the parent
 * lookup, for a dispatch that happened inside a sub-agent rather than in the conversation.
 */
function cardOwningTool(state: TranscriptState, callId: string): SubAgentCard | undefined {
  const agentId = state.workAncestry.tools.get(callId)?.agentId
  return agentId === undefined ? undefined : findCard(state, agentId)
}

/**
 * The card a sub-agent's OWN tool call belongs to, addressed by the dispatching tool-use id (029).
 *
 * A sub-agent's tool blocks carry `parent_tool_use_id`, which is that same id — so this is
 * the one lookup that goes the other way round from {@link findCard}: from the parent's id to
 * whichever card hangs off it. `undefined` means the child's call arrived before its
 * `task_started`, in which case it renders in the conversation rather than being swallowed.
 */
export function cardFor(
  state: TranscriptState,
  parentToolCallId: string,
): SubAgentCard | undefined {
  const agentId = state.workAncestry.dispatches.get(parentToolCallId)?.agentIds[0]
  return agentId === undefined ? undefined : findCard(state, agentId)
}

/**
 * Put a new card in its home: inside the dispatching row when it exists, inside the dispatching
 * CALL when that call belongs to another agent (035), else at top level.
 */
export function placeCard(state: TranscriptState, card: SubAgentCard): SubAgentCard {
  const parentCallId = state.workAncestry.agents.get(card.agentId)?.dispatch ?? ''
  const parent = itemById(state, state.toolItems[parentCallId])
  if (parent?.kind === 'tool') {
    parent.subAgents = [...(parent.subAgents ?? []), card]
    state.subAgentHomes[card.agentId] = parent.id
    return card
  }
  if (nestUnderCardTool(state, card, parentCallId)) return card
  const id = nextId(state, 'subAgent')
  state.items.push({ kind: 'subAgent', id, card })
  state.subAgentHomes[card.agentId] = id
  return card
}

/** Reuse a quiet card already held by this record when jumping to the latest page. */
export function restoreSubAgent(state: TranscriptState, card: SubAgentCard): void {
  if (state.subAgentCards.has(card.agentId)) return
  state.subAgentCards.set(card.agentId, card)
  placeCard(state, card)
  const register = (parent: SubAgentCard): void => {
    for (const row of parent.body) {
      if (row.kind !== 'tool') continue
      state.cardTools[row.callId] = parent.agentId
      for (const child of row.subAgents ?? []) {
        const home = state.subAgentHomes[child.agentId]
        const index = state.items.findIndex((item) => item.id === home && item.kind === 'subAgent')
        if (index >= 0) state.items.splice(index, 1)
        state.subAgentCards.set(child.agentId, child)
        state.subAgentHomes[child.agentId] = `card:${parent.agentId}`
        register(child)
      }
    }
  }
  register(card)
}

/**
 * Hang `card` off the call that dispatched it, when that call lives inside another agent's card
 * (035). True if it found a home.
 *
 * The home id is recorded as `card:<agentId>` rather than an item id, because there is no item —
 * the holder is a tool entry on a card. Nothing dereferences it: {@link itemById} returns undefined
 * for it, which is exactly what {@link rehome}'s "already nested, leave it alone" guard wants.
 */
function nestUnderCardTool(
  state: TranscriptState,
  card: SubAgentCard,
  parentCallId: string,
): boolean {
  const owner = cardOwningTool(state, parentCallId)
  const entry = owner?.body.find(
    (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === parentCallId,
  )
  if (!owner || !entry) return false
  entry.subAgents = [...(entry.subAgents ?? []), card]
  state.subAgentHomes[card.agentId] = `card:${owner.agentId}`
  return true
}

/**
 * Merge a usage report into the one the card already has, never letting a counter go BACKWARDS
 * (029).
 *
 * These are cumulative counters reported by different messages, and the last one is not
 * necessarily the largest: the live capture has a `task_notification` carrying `tool_uses: 0` — a
 * summary of the whole run written by a different path from the heartbeats. Taking it verbatim let
 * the header say "0 tools" while the card's own body listed the calls we had watched it make, and
 * two numbers on the same card contradicting each other is worse than either being absent.
 */
export function mergeUsage(
  current: SubAgentCard['usage'],
  next: NonNullable<SubAgentCard['usage']>,
): SubAgentCard['usage'] {
  const keep = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b)
  const tokens = keep(current?.tokens, next.tokens)
  const toolCalls = keep(current?.toolCalls, next.toolCalls)
  const ms = keep(current?.ms, next.ms)
  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(ms !== undefined ? { ms } : {}),
  }
}

/**
 * Drop the prose run that is the card's `summary` said a second time (131, from 130's review).
 *
 * ⚑ **Measured, not hypothetical.** In `sess_6b4380fa` ordinal 1776 is the child's forwarded
 * `assistant_message` and ordinal 1779 is the terminal `sub_agent.summary`: 357 characters each,
 * exactly equal. An older run holds the same collision at **3,970** characters. Before 128 the loose
 * prose and the summary were on different surfaces and the repeat was invisible; with the words
 * owned, both copies land inside one expanded card and the child's answer is drawn twice.
 *
 * ⛔ **The SUMMARY is what survives, and the prose is what goes.** The card already has one place
 * for an answer and it is rendered as one (`SubAgentEntry`'s `.answer`), so keeping the body row
 * instead would move the answer's position depending on whether the provider happened to forward
 * the text — the same sentence in two places on two runs. `hasBody` counts the summary, so a card
 * whose only row was the echo still opens.
 *
 * Called from both directions — the summary arriving after the prose is the ordinary case, the
 * reverse is the late-card one — because a rule that holds in one order is not a rule.
 *
 * ## What the rule is, after 136 measured what text equality alone does (137)
 *
 * The rule this replaced was *"remove the most recent prose row whose trimmed text equals the
 * summary"*, and 136's verdict on it was exact: ⛔ *"no provenance saying that row was the
 * completion echo, no adjacency requirement, and no memory that an echo has already been removed."*
 * Three deterministic failures followed, and each of the three clauses below answers one of them.
 *
 *  - **TERMINAL-ADJACENT.** Only the run of prose at the END of the body can be the echo. The old
 *    backward scan walked past intervening tools and past later, different prose to delete an
 *    EARLIER identical sentence — `says(S) · tool · says(D) · ended(summary=S)` moved the child's
 *    opening sentence from before its work to the terminal summary. A sentence with the child's own
 *    work after it is not the last thing it said, so it is not the echo of the last thing it said.
 *  - **ONE-SHOT.** {@link TranscriptState.echoedAnswers} remembers the answer already taken, so
 *    `ended(summary=S) · says(S) · tool · says(S)` — the late-card order — loses the echo and keeps
 *    the genuine repeat. The old rule removed both, and the card then showed a tool and nothing the
 *    child had said.
 *  - **THE WHOLE TRAILING RUN, not one row.** An answer forwarded as two messages while the summary
 *    is both of them joined matched no single row, so the duplicate this function exists to prevent
 *    survived — the failure in the other direction. Compared with whitespace normalized, which also
 *    settles the split's join: two forwarded blocks are separated by SOME whitespace or none, and
 *    which one is not a fact worth depending on.
 *
 * ⚠️ **A child that genuinely repeats itself mid-run still keeps both copies** — that is the
 * terminal-adjacent clause read the other way, and it is the negative bound the removal is allowed
 * to have. ⛔ **And a summary with no matching prose still renders**, which is what stops the whole
 * rule being satisfiable by discarding every summary.
 */
export function dropEchoedProse(state: TranscriptState, card: SubAgentCard): void {
  const answer = normalizeSpeech(card.summary)
  if (!answer) return
  // Already answered for this exact sentence. A DIFFERENT summary — a restatement that grew — is a
  // different sentence and gets its own single removal.
  if (state.echoedAnswers[card.agentId] === answer) return
  let run = ''
  for (let index = card.body.length - 1; index >= 0; index--) {
    const row = card.body[index]
    // The first thing that is not prose ends the run: the child did something after saying this, so
    // nothing at or before it is the last thing it said.
    if (row?.kind !== 'prose') return
    run = run ? `${row.text} ${run}` : row.text
    if (normalizeSpeech(run) !== answer) continue
    card.body.splice(index, card.body.length - index)
    state.echoedAnswers[card.agentId] = answer
    return
  }
}

/**
 * The comparable form of something that was said — whitespace collapsed, ends trimmed.
 *
 * ⚠️ **Not cosmetic.** It is what makes a summary forwarded as two blocks comparable with the two
 * rows it was split into, whatever the provider put between them, and it is also why a summary that
 * differs from its echo only in trailing newlines is still recognised as the same sentence — 136
 * found both of those surviving the exact-equality version.
 */
function normalizeSpeech(text: string | undefined): string {
  return text === undefined ? '' : text.replace(/\s+/g, ' ').trim()
}

/**
 * Move a top-level card into its dispatch row once that row is known (029).
 *
 * Placement cannot be decided once and for all, because the phases disagree about parentage:
 * `task_updated` never carries the dispatch id, and a card can therefore be created — or merely
 * updated — by a message that does not know where it belongs. Re-evaluating on every phase is what
 * stops a card that arrived parentless from staying stranded at top level for the whole session
 * while its row sits visibly above it.
 *
 * Only ever moves top-level -> nested. A card already inside a row stays there: nothing later
 * should be able to tear it out of the story it is part of.
 */
export function rehome(state: TranscriptState, card: SubAgentCard): void {
  const dispatch = state.workAncestry.agents.get(card.agentId)?.dispatch
  if (dispatch === undefined) return
  const current = itemById(state, state.subAgentHomes[card.agentId])
  if (current?.kind !== 'subAgent') return // already nested, in a row or in another card
  const drop = (): void => {
    const index = state.items.findIndex((item) => item.id === current.id)
    if (index >= 0) state.items.splice(index, 1)
  }
  const parent = itemById(state, state.toolItems[dispatch])
  if (parent?.kind === 'tool') {
    drop()
    parent.subAgents = [...(parent.subAgents ?? []), card]
    state.subAgentHomes[card.agentId] = parent.id
    return
  }
  // The grandchild case (035): the dispatching call is not a row in the conversation, it is one of
  // another agent's own calls. Checked SECOND because a real row is the stronger claim — a call id
  // cannot be both, but if it somehow were, the conversation is where the reader is looking.
  // `nestUnderCardTool` touches nothing when it finds no home, so a miss leaves the card where it is.
  if (nestUnderCardTool(state, card, dispatch)) drop()
}

/**
 * Pull the child's own rows — what it DID and what it SAID — out of the conversation and onto its
 * card (029, extended to speech in 131).
 *
 * A sub-agent's tool blocks and its `task_started` arrive on DIFFERENT messages, so the child can
 * be seen working before it is known to exist. In that window {@link cardFor} finds nothing and the
 * call renders as the parent's own — the precise misattribution this task set out to end, surviving
 * as a race. The rows remember whose they were, so the card takes them back when it appears.
 *
 * ⚑ **ONE backward walk over `state.items`, and that is what recovers the ORDER.** 130 named the
 * cost of doing this — *"two reclaimed sequences have to be interleaved, and neither remembers when
 * it arrived"* — and the premise is false here by construction: `state.items` IS arrival order, so
 * a walk that takes both kinds in one pass and `unshift`s each finds them already interleaved.
 * Nothing has to remember a time, because nothing has to be re-sorted. Two sweeps, one per kind,
 * would have had exactly the problem described; that is the reason this is not two sweeps.
 */
export function reclaimChildRows(state: TranscriptState, card: SubAgentCard): void {
  if (!card.parentToolCallId) return
  const reclaimed: string[] = []
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (!item) continue
    if (
      state.workAncestry.after >= 0 &&
      (item.ordinal === undefined || item.ordinal <= state.workAncestry.after)
    )
      continue
    // Words the child said before its card existed (131). They become an ordinary prose run in the
    // body, indistinguishable from one that arrived after — because that is what they are.
    if (item.kind === 'assistant') {
      if (
        item.parentToolCallId === undefined ||
        cardFor(state, item.parentToolCallId)?.agentId !== card.agentId
      )
        continue
      state.items.splice(index, 1)
      card.body.unshift({ kind: 'prose', id: nextId(state, 'says'), text: item.text })
      continue
    }
    if (
      item.kind !== 'tool' ||
      state.toolItems[item.callId] !== item.id ||
      state.workAncestry.tools.get(item.callId)?.agentId !== card.agentId
    )
      continue
    state.items.splice(index, 1)
    delete state.toolItems[item.callId]
    // It stops being a row and becomes a dispatch point (035): same id, different kind of home.
    state.cardTools[item.callId] = card.agentId
    // A late card reclaims the complete row, including facts acquired after tool_call.
    // In particular, losing unfinished/background would make a stopped child call look live.
    card.body.unshift({
      kind: 'tool',
      callId: item.callId,
      name: item.name,
      ...(item.displayName === undefined ? {} : { displayName: item.displayName }),
      summary: item.summary,
      ...(item.result ? { result: { summary: item.result.summary, ok: item.result.ok } } : {}),
      ...(item.unfinished === true ? { unfinished: true } : {}),
      ...(item.background ? { background: { ...item.background } } : {}),
      ...(item.subAgents ? { subAgents: item.subAgents } : {}),
    })
    for (const child of item.subAgents ?? [])
      state.subAgentHomes[child.agentId] = `card:${card.agentId}`
    card.lastTool = item.name
    reclaimed.push(item.callId)
  }
  // A sentence reclaimed AFTER the ending already set the summary is the same sentence twice — the
  // ordinary shape when the card arrives late, so the echo is dropped here as well as on arrival.
  //
  // ⚑ **Unconditional again, and that is 137 removing a guard rather than adding one.** This used to
  // run only `if (tookWords)`, because the `sub_agent` case above has already de-duplicated for
  // `event.summary` and a second unconditional pass removed a SECOND row — a child that legitimately
  // repeated a sentence lost both copies. The memory in {@link TranscriptState.echoedAnswers} is what
  // that guard was standing in for, and it holds on every path rather than on this one: an echo is
  // one event said twice, so the second call finds the answer already taken and does nothing. One
  // rule, in one place, instead of a rule and a proxy for it.
  dropEchoedProse(state, card)
  // A card that was waiting on one of those calls can now find it — but only the calls that just
  // MOVED (035 review). Sweeping every entry would re-walk the whole tree on each progress
  // heartbeat, once per call the card has ever made, to re-discover nothing.
  for (const callId of reclaimed) adoptOrphans(state, callId)
}

/**
 * Move any top-level card that was waiting for `callId` into the row that just arrived (029).
 *
 * This is what makes the nesting a claim about IDENTITY rather than about ordering. In practice the
 * dispatch row always comes first — the `Task` block is in the assistant message that causes the
 * sub-agent to exist — so this path is the guard, not the norm, and it exists because a rule that
 * only holds when events are well-ordered is not a rule.
 */
/**
 * Put `run` on the tool row that launched it, if that row is on screen (108).
 *
 * ⚠️ **It assigns the SAME object rather than a copy**, so the registry and the row cannot drift.
 * That is what lets the drawer read one fold and the transcript read the other and always agree —
 * `session-panel`'s rule, one level down.
 *
 * Silent when there is no anchor yet (a `task_updated` arriving first) and when the row has not
 * appeared: the run stays in the registry and the next frame tries again.
 */
export function attachWorkflow(state: TranscriptState, run: WorkflowRunCard): void {
  if (run.toolUseId === undefined) return
  const home = itemById(state, state.toolItems[run.toolUseId])
  if (home?.kind !== 'tool') return
  home.workflow = run
}

/**
 * Move any workflow that was waiting for `callId` onto the row that just arrived (108).
 *
 * The mirror of {@link adoptOrphans} for runs, and it exists for the same stated reason: in every
 * measured conversation the `Workflow` tool call leads its first `task_started` by six events, so
 * this is the guard rather than the norm — and a nesting rule that only holds when events are
 * well-ordered is not a rule.
 */
export function adoptWorkflows(state: TranscriptState, callId: string): void {
  for (const run of Object.values(state.workflows)) {
    if (run.toolUseId === callId) attachWorkflow(state, run)
  }
}

export function adoptOrphans(state: TranscriptState, callId: string): void {
  for (const agentId of state.workAncestry.dispatches.get(callId)?.agentIds ?? []) {
    const card = findCard(state, agentId)
    if (card !== undefined) rehome(state, card)
  }
}
