import type { WorkflowRunCard, SubAgentToolRow } from '../transcript-tool-contracts'
import { mergeWorkflowAgents, mergeWorkflowPhases } from '../workflow'
import { drawsAsACard } from '../draws-as-a-card'
import { messageCall, messageResult } from '../message-receipts'
import { nextId, itemById } from './items'
import { tellItsRefusal } from './notices'
import { closeStreaming, detachment } from './lifecycle'
import { outgoingToolOf, settleTheGive, claimAhead } from './messages'
import {
  findCard,
  cardFor,
  placeCard,
  mergeUsage,
  dropEchoedProse,
  rehome,
  reclaimChildRows,
  attachWorkflow,
  adoptWorkflows,
  adoptOrphans,
} from './cards'
import type { TranscriptState } from '../transcript-state-contracts'
import type { TranscriptEvent } from '../../../../shared/conversation-events'

type ToolEvent = Extract<
  TranscriptEvent,
  {
    type: 'sub_agent' | 'activity' | 'tool_call' | 'tool_result' | 'workflow_run'
  }
>

export function foldEvent(state: TranscriptState, event: ToolEvent, at?: number): void {
  switch (event.type) {
    case 'sub_agent': {
      const dispatch = state.workAncestry.agents.get(event.agentId)?.dispatch
      const existing = findCard(state, event.agentId)
      const card =
        existing ??
        placeCard(state, {
          agentId: event.agentId,
          ...(dispatch === undefined ? {} : { parentToolCallId: dispatch }),
          // WHOSE kind of id this is (111), straight off the wire. Absent on an event persisted
          // before this existed, and the card then says "child agent" rather than guessing.
          ...(event.idKind ? { idKind: event.idKind } : {}),
          ...(event.origin ? { origin: event.origin } : {}),
          running: true,
          body: [],
        })
      state.subAgentCards.set(event.agentId, card)
      // MERGE, never clobber: the phases carry different subsets of the truth — `task_updated` has
      // no `tool_use_id` or `subagent_type` at all — so an absent field means "not reported by this
      // message", never "cleared". Writing undefined over a title the start already gave us would
      // blank the card's heading the moment it finished.
      if (event.idKind) card.idKind = event.idKind
      // Merged like the rest, and it is the one field a later phase can only ever CORRECT upwards:
      // an `observed` card that turns out to have been announced after all is an announced card.
      if (event.origin) card.origin = event.origin
      if (dispatch !== undefined) card.parentToolCallId = dispatch
      if (event.kind) card.kind = event.kind
      if (event.title) card.title = event.title
      if (event.lastTool) card.lastTool = event.lastTool
      if (event.usage) card.usage = mergeUsage(card.usage, event.usage)
      if (event.summary) {
        card.summary = event.summary
        dropEchoedProse(state, card)
      }
      if (event.outcome) card.outcome = event.outcome
      // Both endings are mapped, so this runs twice in the ordinary case and must be idempotent.
      if (event.phase === 'ended') card.running = false
      // A LATER phase can be the first to name the dispatch (`task_started` may omit it, and
      // `task_updated` always does), so placement is re-evaluated rather than decided once. Without
      // this the card would sit at top level for the rest of the session even though its row is
      // right there on screen.
      rehome(state, card)
      // …and any of the child's calls that landed in the conversation before this card existed are
      // pulled back where they belong.
      reclaimChildRows(state, card)
      return
    }

    case 'activity': {
      // Replaced wholesale, never appended: the pill states one thing about now.
      state.activity = {
        phase: event.phase,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
      }
      return
    }

    case 'tool_call': {
      // A call made BY a sub-agent belongs to that sub-agent's card, not to the conversation (029).
      // Claude forwards the child's tool blocks into the parent stream by default, so before this
      // they rendered as the parent's own work — a misattribution with nothing on screen to betray
      // it. The card is the nested transcript; the parent flow stays the parent's.
      const owner = event.parentToolCallId ? cardFor(state, event.parentToolCallId) : undefined
      if (owner) {
        messageCall(state, event.id, null, false)
        // ⛔ **`memoryPath` is deliberately NOT carried onto a card row** (330, and 327's `durationMs`
        // is the precedent it follows). {@link SubAgentToolRow} declares `{kind, callId, name,
        // summary}` and `SubAgentEntry` draws no badge for any tool — a conditional spread writes
        // past that type with no excess-property error, so carrying it here would store a field
        // nothing declares and nothing renders. ⚠️ A sub-agent CAN write memory and the honest
        // consequence is that its card row does not say so; giving card rows this affordance is a
        // surface change 330 was not asked for, and is named in the response rather than smuggled in.
        owner.body.push({
          kind: 'tool',
          callId: event.id,
          name: event.name,
          ...(event.displayName === undefined ? {} : { displayName: event.displayName }),
          summary: event.summary,
        })
        owner.lastTool = event.name
        // Remembered as a DISPATCH POINT (035). It is deliberately not in `toolItems` — there is no
        // item, the row lives on a card — but it is still an id a grandchild can name as its parent,
        // and without this index that grandchild's card could never find it and stranded at top
        // level. `adoptOrphans` is called for the same reason a row calls it: a card may already be
        // waiting for exactly this id.
        state.cardTools[event.id] = owner.agentId
        adoptOrphans(state, event.id)
        return
      }
      closeStreaming(state)
      // Derive activity from the call instead of emitting a duplicate event per adapter.
      state.activity = { phase: 'tool', detail: event.name }
      const id = nextId(state, 'tool')
      state.items.push({
        kind: 'tool',
        id,
        callId: event.id,
        name: event.name,
        ...(event.displayName === undefined ? {} : { displayName: event.displayName }),
        summary: event.summary,
        result: null,
        // ⚑ **The one thing that makes a memory write legible as one** (330). Spread rather than
        // assigned `undefined` so an ordinary row carries no key at all — the same absent-is-a-fact
        // shape `stopKey` uses one line down.
        ...(event.memoryPath === undefined ? {} : { memoryPath: event.memoryPath }),
        // ⛔ **Kept, and NOT read as a detachment** (300) — see {@link ToolItem.stopKey} for the whole
        // of that distinction, which `detachment` one screen down states from the other side.
        ...(event.backgroundId === undefined ? {} : { stopKey: event.backgroundId }),
      })
      state.toolItems[event.id] = id
      // 🔴 **658 · one of the two calls that speak to another conversation** — marked here, and the
      // host's row lands on it ({@link landOutgoing}), or already has ({@link claimAhead}).
      const outgoing = outgoingToolOf(state, event.name, event.summary)
      if (outgoing !== null) {
        const row = itemById(state, id)
        if (row?.kind === 'tool') row.outgoing = claimAhead(state, outgoing, event.summary)
      }
      // Whose call this was, if the card for it has not arrived yet — so it can be reclaimed.
      if (event.parentToolCallId) {
        const row = itemById(state, id)
        if (row?.kind === 'tool') row.parentToolCallId = event.parentToolCallId
      }
      const registered = itemById(state, id)
      messageCall(
        state,
        event.id,
        registered?.kind === 'tool' ? registered : null,
        outgoing === 'message_agent' && event.parentToolCallId === undefined,
      )
      // This row may be the parent a sub-agent card has been waiting for (029). Adopting here is
      // what makes the nesting a binding on the id rather than on which arrived first.
      adoptOrphans(state, event.id)
      // …and the row a workflow tree has been waiting for (108), by the same rule.
      adoptWorkflows(state, event.id)
      return
    }

    case 'tool_result': {
      messageResult(
        state,
        event.id,
        event.messageAct,
        event.ok,
        event.parentToolCallId !== undefined,
      )
      // ⛔ **This receipt may be a DETACHMENT rather than a completion** (248, from 247's field).
      // `ok` stays exactly as the provider sent it — the detach really did succeed — and the fact
      // goes beside it. See {@link detachment} for why it is read from `backgrounded` alone.
      const detached = detachment(event)
      // The child's results follow the child's calls, wherever those went.
      const owner = event.parentToolCallId ? cardFor(state, event.parentToolCallId) : undefined
      const nested = owner?.body.find(
        (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === event.id,
      )
      if (nested) {
        // ⛔ **`durationMs` is deliberately NOT carried onto a card row** (327, found reviewing this
        // dispatch's own diff). {@link SubAgentToolRow.result} declares `{summary, ok}` and
        // `SubAgentEntry` renders no duration for any tool — a spread writes past that type without
        // an excess-property error, so the first draft of this line stored a field nothing declared
        // and nothing read. Giving card rows a duration is a feature this dispatch was not asked
        // for; writing one nobody can see is worse than not writing it.
        nested.result = { summary: event.summary, ok: event.ok }
        tellItsRefusal(state, nested.name, event.summary, false)
        if (detached) nested.background = { ...nested.background, ...detached }
        // ⛔ **658 · a sub-agent's call is on its card, never a top-level item** — so a messaging row
        // it wrote is ahead of nothing that will come, and a LATER call of ours must not claim it.
        state.outgoingAhead = []
        return
      }
      const item = itemById(state, state.toolItems[event.id])
      if (item?.kind === 'tool') {
        // ⚠️ **`=== undefined`, never a truthiness test** (327): a tool that failed instantly reports
        // `durationMs: 0`, and `...(event.durationMs ? … : {})` would drop the duration of exactly
        // the rows where how fast it failed is the interesting part.
        item.result = {
          summary: event.summary,
          ok: event.ok,
          at,
          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        }
        delete item.refusalRail
        const told = tellItsRefusal(state, item.name, event.summary, drawsAsACard(item), (rail) => {
          if (rail === 'that-agent-is-you') item.refusalRail = rail
        })
        if (told !== null) item.told = told
        // 🔴 **D-047 · a give's answer says which `work_sent` is its own** ({@link settleTheGive}).
        settleTheGive(state, item)
        // ⚠️ **Merged rather than assigned, so a receipt can never erase an ending.** Nothing on the
        // wire orders `background_work.ended` after this frame — they come out of different system
        // messages — and an assignment would put a finished command back to "still running" on the
        // one ordering the provider has not promised against.
        if (detached) item.background = { ...item.background, ...detached }
        // ⛔ **The receipt is where CLAUDE names the key at all** (300): `claude/normalize.ts` sets
        // `backgroundId` only beside `backgrounded`, so a detached Claude task has no key until
        // this frame — where the Codex call already had one from `item/started`. ⚠️ Never cleared
        // by a receipt that carries none, for the reason the line above is merged rather than
        // assigned: a second frame must not be able to take away what a first one stated.
        if (event.backgroundId !== undefined) item.stopKey = event.backgroundId
        return
      }
      // A result with no call is surfaced, not dropped — it still tells the user
      // something ran.
      // ⛔ **658 · and it is the signature of a call before the retained suffix** — a messaging row
      // that landed ahead was that call's, so no later call may claim it.
      state.outgoingAhead = []
      state.items.push({
        kind: 'tool',
        id: nextId(state, 'tool'),
        callId: event.id,
        name: '(result without a call)',
        summary: '',
        result: { summary: event.summary, ok: event.ok },
        ...(detached ? { background: detached } : {}),
      })
      return
    }

    // Merge workflow phases and agents into the retained run, never a second row.
    // The registry and tool row share the same run object; attach when its call is known.
    case 'workflow_run': {
      const known = state.workflows[event.taskId]
      const run: WorkflowRunCard = known ?? {
        taskId: event.taskId,
        phases: [],
        agents: [],
        running: true,
      }
      if (known === undefined) state.workflows[event.taskId] = run
      if (event.toolUseId !== undefined) run.toolUseId = event.toolUseId
      if (event.name !== undefined) run.name = event.name
      if (event.description !== undefined) run.description = event.description
      if (event.outputFile !== undefined) run.outputFile = event.outputFile
      if (event.usage !== undefined) run.usage = event.usage
      if (event.droppedAgents !== undefined && event.droppedAgents > 0)
        run.droppedAgents = event.droppedAgents
      run.phases = [...mergeWorkflowPhases(run.phases, event.phases)]
      run.agents = [...mergeWorkflowAgents(run.agents, event.agents)]
      // ⚠️ **A frame arriving after we stopped watching means we are watching again** (108 review).
      // `stopOpenToolCalls` marks an open run `unfinished` at every boundary that ends the thing
      // running it — including a TURN ending, and a dynamic workflow legitimately outlives the turn
      // that launched it (it is a background task; that is the whole feature). Without this the head
      // froze on "did not finish" while rows underneath it kept updating: two answers to one
      // question, in one card. A non-terminal frame is proof the run is alive.
      // ⚑ **D-003 · a TURN ending no longer marks a run the level still lists**, so this is now for
      // a run the level did not list at that turn end, and for a replay reopened mid-run.
      if (event.outcome === undefined && run.unfinished === true) {
        run.running = true
        delete run.unfinished
      }
      if (event.outcome !== undefined) {
        run.outcome = event.outcome
        run.running = false
        // A run that ENDED is not one we stopped watching — 074's distinction, both directions.
        // Without this a resumed conversation whose run was marked unfinished on reopen would keep
        // saying "did not finish" after the ending arrived and settled it.
        delete run.unfinished
      }
      // Place it on the launching row, if that row is here. The binding is the id, never arrival
      // order — `adoptOrphans`' rule, and the reason this is re-attempted on every frame rather than
      // only on the first: the `Workflow` tool call leads in every measured run, but a rule that
      // holds only for well-ordered events is not a rule.
      attachWorkflow(state, run)
      return
    }
  }
}
