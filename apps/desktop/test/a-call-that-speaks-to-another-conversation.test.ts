import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { joinsARun, transcriptRows } from '../src/renderer/src/lib/tool-runs'
import {
  A_HANDLE_READ_ALOUD,
  AN_UNNAMED_PARENT,
  AN_UNNAMED_RECIPIENT,
  MESSAGE_KIND_WORD,
  OUTGOING_STATE_WORD,
  outgoingCard,
  type OutgoingCardWords,
  type OutgoingState,
} from '../src/renderer/src/lib/outgoing-card'
import { argumentExcerpt } from '../src/renderer/src/lib/argument-excerpt'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import { agentName, type AgentIdentity, type TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 658 · A call that put this conversation's words into ANOTHER one
 *
 * `mcp__brobot__reply_to_parent` and `message_agent` each draw a dedicated card describing
 * communication with another conversation.
 *
 * ⛔ **What is load-bearing, and so what this file pins:**
 *
 * 1. **Recognition by the names THIS session was handed** — the `tool_inventory` row's `naming` and
 *    `declared.server` — never by a provider's spelling, and never by the tool name alone.
 * 2. **The host's row lands on the call that wrote it, whichever arrives first** — the survey for
 *    `658` measured that `message_sent` is written inside the handler, before its own
 *    `tool_result`, and that nothing orders it after its `tool_call`.
 * 3. **The call its own arguments name, or the one call left — never a guess** — a row pairs with
 *    the call whose `agent`/`piece` argument names its id (a piece by its id or its label); a dead
 *    call stops competing once a newer one exists; a sub-agent's call is a candidate that can never
 *    wear the card; and a row held AHEAD waits for its call and dies with a receipt whose call is
 *    not in view, or with the run.
 * 4. **The card is its own row**, never a line in a run.
 * 5. **The reading never prints a `sess_` handle — not in a heading and not in a receipt — and never
 *    names BroBot for a recipient it does not know** — `agentName(null)` answers BroBot.
 * 6. **Replay is a trust boundary**: a row with a missing or wrong-typed field draws less, never
 *    crashes the fold, and never reads as *sent* or *delivered* on a fact it does not carry.
 */

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const CODEX = { prefix: '', separator: '__' }

const OURS = ['give_work', 'message_agent', 'reply_to_parent', 'list_tasks']

const inventory = (
  naming: { prefix: string; separator: string },
  server = 'brobot',
  tools: readonly string[] = OURS,
): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming,
    declared: {
      server,
      tools: tools.map((name) => ({ name, description: '', parameters: [] })),
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, name: string, args: Record<string, unknown> = {}): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary: JSON.stringify(args) }) as TranscriptEvent

const result = (id: string, summary = 'ok', ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

const sent = (to: string, toProfile: string | null, over: object = {}): TranscriptEvent =>
  ({
    type: 'message_sent',
    to,
    toProfile,
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
    ...over,
  }) as TranscriptEvent

const replied = (piece: string, over: object = {}): TranscriptEvent =>
  ({
    type: 'work_replied',
    piece,
    outcome: 'done',
    summary: 'It is done.',
    resources: [],
    ...over,
  }) as TranscriptEvent

/**
 * ⚑ **D-016 · a piece given to this conversation, as its own ledger holds it** — the brief, a turn
 * relayed from the giver (whose identity it names), then the owner's `work_given` row (whose
 * conversation it names): the idle branch's order.
 */
const given = (
  piece: string,
  label: string,
  givenBy: string,
  givenByProfile: string | null,
): TranscriptEvent[] => [
  {
    type: 'user_turn',
    text: 'the brief',
    relayedFrom: givenBy,
    relayedFromProfile: givenByProfile,
    piece,
    label,
  } as TranscriptEvent,
  {
    type: 'work_given',
    piece,
    label,
    parent: 'work_root',
    givenBy,
    title: 'the work',
    brief: 'the brief',
  } as TranscriptEvent,
]

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const tools = (state: TranscriptState): ToolItem[] =>
  state.items.filter(
    (item): item is ToolItem & (typeof state.items)[number] => item.kind === 'tool',
  )

const toolNamed = (state: TranscriptState, callId: string): ToolItem => {
  const found = tools(state).find((item) => item.callId === callId)
  expect(found, `no tool row for ${callId}`).toBeDefined()
  return found as ToolItem
}

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('ada', 'Ada'), ident('brobot', null)]

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · recognition — by the names this session was handed
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · which calls are these two tools', () => {
  it('🔴 Claude’s spelling and Codex’s are both recognised — through the inventory, not a literal', () => {
    const claude = fold([
      inventory(CLAUDE),
      call('c1', 'mcp__brobot__message_agent'),
      call('c2', 'mcp__brobot__reply_to_parent'),
    ])
    expect(toolNamed(claude, 'c1').outgoing?.tool).toBe('message_agent')
    expect(toolNamed(claude, 'c2').outgoing?.tool).toBe('reply_to_parent')
    const codex = fold([
      inventory(CODEX),
      call('c1', 'brobot__message_agent'),
      call('c2', 'brobot__reply_to_parent'),
    ])
    expect(toolNamed(codex, 'c1').outgoing?.tool).toBe('message_agent')
    expect(toolNamed(codex, 'c2').outgoing?.tool).toBe('reply_to_parent')
  })

  it('⛔ and a call the recognition must refuse draws as every other tool — one control per clause', () => {
    const state = fold([
      inventory(CLAUDE, 'brobot', ['message_agent', 'list_tasks']),
      // our server, one of our OTHER tools
      call('other-tool', 'mcp__brobot__list_tasks'),
      // a foreign server that happens to have a tool of the same name
      call('foreign', 'mcp__elsewhere__message_agent'),
      // our server, a tool this session was NOT declared
      call('undeclared', 'mcp__brobot__reply_to_parent'),
      // the other provider's spelling, under this session's convention
      call('wrong-convention', 'brobot__message_agent'),
      // ⚠️ a bare name — Codex without a namespace; measured never to arrive (`a-codex-agent-
      // spawns-an-agent.smoke.ts` asserts the namespaced form), and not guessed at
      call('bare', 'message_agent'),
      // ⚑ the positive, in the same fold
      call('ours', 'mcp__brobot__message_agent'),
    ])
    for (const id of ['other-tool', 'foreign', 'undeclared', 'wrong-convention', 'bare']) {
      expect(toolNamed(state, id).outgoing, id).toBeUndefined()
    }
    expect(toolNamed(state, 'ours').outgoing?.tool).toBe('message_agent')
  })

  it('⛔ a session never told its tools recognises nothing — the name alone is not enough', () => {
    const state = fold([call('c1', 'mcp__brobot__message_agent')])
    expect(toolNamed(state, 'c1').outgoing).toBeUndefined()
    // ⚑ and the SAME call recognised once the session has been told, so the negative is about
    // the inventory and not about the name
    expect(
      toolNamed(fold([inventory(CLAUDE), call('c1', 'mcp__brobot__message_agent')]), 'c1').outgoing,
    ).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the host's row lands on its call
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the host’s row lands on the call that wrote it', () => {
  const MESSAGE = 'mcp__brobot__message_agent'
  const REPLY = 'mcp__brobot__reply_to_parent'

  it('🔴 after its call — the ordinary order', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE, { agent: 'sess_ada', text: 'hello' }),
      sent('sess_ada', 'ada', { delivery: 'queued', kind: 'follow-up' }),
      result('c1', 'held for sess_ada as follow-up'),
    ])
    expect(toolNamed(state, 'c1').outgoing).toEqual({
      tool: 'message_agent',
      sent: {
        toProfile: 'ada',
        toConversation: 'sess_ada',
        kind: 'follow-up',
        delivery: 'queued',
        text: null,
        clipped: false,
      },
    })
  })

  it('🔴 BEFORE its call — nothing orders the handler’s write after the provider’s row', () => {
    const state = fold([
      inventory(CLAUDE),
      sent('sess_ada', 'ada'),
      call('c1', MESSAGE),
      result('c1'),
    ])
    const words = toolNamed(state, 'c1').outgoing
    expect(words?.tool === 'message_agent' && words.sent?.toConversation).toBe('sess_ada')
  })

  it('⚑ a DIFFERENT call’s receipt between them does not take the row away — the slow-reader race', () => {
    // ⚠️ The row is written the moment the handler runs; a receipt the provider stream had already
    // produced for an EARLIER call can still be read after it. Clearing on every receipt would
    // drop the row exactly then.
    const state = fold([
      inventory(CLAUDE),
      call('read', 'Read'),
      sent('sess_ada', 'ada'),
      result('read'),
      call('c1', MESSAGE),
    ])
    const words = toolNamed(state, 'c1').outgoing
    expect(words?.tool === 'message_agent' && words.sent).not.toBeNull()
  })

  it('🔴 a parallel batch pairs by the id each call’s arguments name — whatever order the rows come in', () => {
    const batch = (rows: TranscriptEvent[]): TranscriptState =>
      fold([
        inventory(CLAUDE),
        call('c1', MESSAGE, { agent: 'sess_ada', text: 'to Ada' }),
        call('c2', MESSAGE, { agent: 'sess_bea', text: 'to Bea' }),
        ...rows,
      ])
    for (const order of [
      [sent('sess_ada', 'ada'), sent('sess_bea', 'bea')],
      [sent('sess_bea', 'bea'), sent('sess_ada', 'ada')],
    ]) {
      const state = batch(order)
      const to = (id: string): string | undefined => {
        const words = toolNamed(state, id).outgoing as OutgoingCardWords
        return words.tool === 'message_agent' ? (words.sent?.toProfile ?? undefined) : undefined
      }
      expect([to('c1'), to('c2')]).toEqual(['ada', 'bea'])
    }
    // ⚑ and rows held AHEAD are claimed the same way — each call takes the one it names
    const ahead = fold([
      inventory(CLAUDE),
      sent('sess_ada', 'ada'),
      sent('sess_bea', 'bea'),
      call('c2', MESSAGE, { agent: 'sess_bea', text: 'to Bea' }),
      call('c1', MESSAGE, { agent: 'sess_ada', text: 'to Ada' }),
    ])
    const c1 = toolNamed(ahead, 'c1').outgoing as OutgoingCardWords
    const c2 = toolNamed(ahead, 'c2').outgoing as OutgoingCardWords
    expect(c1.tool === 'message_agent' && c1.sent?.toProfile).toBe('ada')
    expect(c2.tool === 'message_agent' && c2.sent?.toProfile).toBe('bea')
  })

  it('🔴 a call that NAMES the row wins over one whose arguments were cut before they could say', () => {
    // ⚠️ the `mismatch` filter cannot decide this: neither call contradicts the row — one names it,
    // the other says nothing — so only preferring the one that names it lands the row at all
    const cut = `${JSON.stringify({ text: 'x'.repeat(300), agent: 'sess_bea' }).slice(0, 200)}…`
    const state = fold([
      inventory(CLAUDE),
      call('named', MESSAGE, { agent: 'sess_ada', text: 'to Ada' }),
      { type: 'tool_call', id: 'silent', name: MESSAGE, summary: cut } as TranscriptEvent,
      sent('sess_ada', 'ada'),
    ])
    const named = toolNamed(state, 'named').outgoing as OutgoingCardWords
    const silent = toolNamed(state, 'silent').outgoing as OutgoingCardWords
    expect(named.tool === 'message_agent' && named.sent?.toProfile).toBe('ada')
    expect(silent.tool === 'message_agent' && silent.sent).toBeNull()
  })

  it('⛔ a call its arguments contradict never takes the row — even as the only one waiting', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE, { agent: 'sess_ada', text: 'to Ada' }),
      sent('sess_bea', 'bea'),
      call('c2', MESSAGE, { agent: 'sess_bea', text: 'to Bea' }),
    ])
    const c1 = toolNamed(state, 'c1').outgoing as OutgoingCardWords
    const c2 = toolNamed(state, 'c2').outgoing as OutgoingCardWords
    expect(c1.tool === 'message_agent' && c1.sent).toBeNull()
    expect(c2.tool === 'message_agent' && c2.sent?.toProfile).toBe('bea')
  })

  it('🔴 a call whose run died stops waiting once a newer call of its tool exists', () => {
    // ⚠️ the reviewer's repro: without this, turn 1's dead call stands beside every later one and
    // turns each later row into a two-way tie — or, row-first, takes it outright
    const state = fold([
      inventory(CLAUDE),
      call('dead', MESSAGE),
      { type: 'turn', state: 'interrupted' } as TranscriptEvent,
      call('c2', MESSAGE),
      sent('sess_bea', 'bea'),
      result('c2', 'sess_bea was idle'),
    ])
    const dead = toolNamed(state, 'dead').outgoing as OutgoingCardWords
    const c2 = toolNamed(state, 'c2').outgoing as OutgoingCardWords
    expect(dead.tool === 'message_agent' && dead.sent).toBeNull()
    expect(c2.tool === 'message_agent' && c2.sent?.toProfile).toBe('bea')
    // ⚑ the control: with no newer call, the late row still lands on the call it belongs to
    const late = fold([
      inventory(CLAUDE),
      call('dead', MESSAGE),
      { type: 'turn', state: 'interrupted' } as TranscriptEvent,
      sent('sess_ada', 'ada'),
    ])
    const own = toolNamed(late, 'dead').outgoing as OutgoingCardWords
    expect(own.tool === 'message_agent' && own.sent?.toProfile).toBe('ada')
  })

  it('⛔ a sub-agent’s call of ours is a candidate that can never wear the card', () => {
    const withChild = (rows: TranscriptEvent[]): TranscriptState =>
      fold([
        inventory(CLAUDE),
        call('task', 'Agent'),
        {
          type: 'sub_agent',
          agentId: 'agent-1',
          phase: 'started',
          parentToolCallId: 'task',
          title: 'a helper',
        } as TranscriptEvent,
        call('c1', MESSAGE),
        { ...(call('nested', MESSAGE) as object), parentToolCallId: 'task' } as TranscriptEvent,
        ...rows,
      ])
    // ⚠️ neither call's arguments say — the row could be the child's, so the parent's card stays bare
    const state = withChild([sent('sess_bea', 'bea', { delivery: 'queued' })])
    const c1 = toolNamed(state, 'c1').outgoing as OutgoingCardWords
    expect(c1.tool === 'message_agent' && c1.sent).toBeNull()
    expect(state.outgoingAhead).toHaveLength(0)
  })

  it('⛔ two open calls — the row could be either’s, so it lands on NEITHER, and is not held', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      call('c2', MESSAGE),
      sent('sess_ada', 'ada'),
      result('c1'),
      result('c2'),
      // ⚠️ a later call must not claim the row the fold refused to place
      call('c3', MESSAGE),
    ])
    for (const id of ['c1', 'c2', 'c3']) {
      const words = toolNamed(state, id).outgoing as OutgoingCardWords
      expect(words.tool === 'message_agent' && words.sent, id).toBeNull()
    }
    // ⚑ the control: ONE open call, same rows, and it lands
    const one = fold([inventory(CLAUDE), call('c1', MESSAGE), sent('sess_ada', 'ada')])
    const words = toolNamed(one, 'c1').outgoing as OutgoingCardWords
    expect(words.tool === 'message_agent' && words.sent).not.toBeNull()
  })

  it('⛔ two rows held ahead — a call cannot tell which is its own, and claims neither', () => {
    const state = fold([
      inventory(CLAUDE),
      sent('sess_ada', 'ada'),
      sent('sess_bea', 'bea'),
      call('c1', MESSAGE),
    ])
    const words = toolNamed(state, 'c1').outgoing as OutgoingCardWords
    expect(words.tool === 'message_agent' && words.sent).toBeNull()
  })

  it('⛔ a row held ahead dies with its run, and with a receipt whose call is not in view', () => {
    // 🔴 a receipt with no call is the signature of a call BEFORE the retained suffix — the row
    // was that call's, and a later call must not wear it
    const orphaned = fold([
      inventory(CLAUDE),
      sent('sess_ada', 'ada'),
      result('before-the-window', 'sess_ada was idle'),
      call('c1', MESSAGE),
    ])
    const a = toolNamed(orphaned, 'c1').outgoing as OutgoingCardWords
    expect(a.tool === 'message_agent' && a.sent).toBeNull()
    // 🔴 and a turn boundary ends whatever ran in it
    const ended = fold([
      inventory(CLAUDE),
      sent('sess_ada', 'ada'),
      { type: 'turn', state: 'completed' } as TranscriptEvent,
      call('c1', MESSAGE),
    ])
    const b = toolNamed(ended, 'c1').outgoing as OutgoingCardWords
    expect(b.tool === 'message_agent' && b.sent).toBeNull()
  })

  it('⛔ a row lands only on a call of ITS tool', () => {
    const state = fold([inventory(CLAUDE), call('c1', MESSAGE), replied('work_1')])
    const words = toolNamed(state, 'c1').outgoing as OutgoingCardWords
    expect(words.tool === 'message_agent' && words.sent).toBeNull()
    const held = fold([inventory(CLAUDE), replied('work_1'), call('c1', MESSAGE)])
    const also = toolNamed(held, 'c1').outgoing as OutgoingCardWords
    expect(also.tool === 'message_agent' && also.sent).toBeNull()
  })

  it('⚑ a refused call wrote no row — its receipt is the whole story', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      result('c1', 'refused (no-such-agent): there is no agent by that name'),
    ])
    const item = toolNamed(state, 'c1')
    const words = item.outgoing as OutgoingCardWords
    expect(words.tool === 'message_agent' && words.sent).toBeNull()
    expect(item.result?.summary).toContain('refused')
  })

  it('🔴 a reply carries its whole summary, its label, and who GAVE the work', () => {
    // ⛔ past the 200-character bound both adapters put on a call's arguments
    const long = `${'The index is safe. '.repeat(60)}`.trim()
    expect(long.length).toBeGreaterThan(1000)
    const state = fold([
      inventory(CLAUDE),
      ...given('work_1', 'W1.7', 'sess_brobot', 'brobot'),
      call('c1', REPLY, { piece: 'W1.7', outcome: 'done', summary: long }),
      replied('work_1', { summary: long, needsUserAction: true, resources: ['res_1'] }),
      result('c1', 'W1.7 answered · sent'),
    ])
    expect(toolNamed(state, 'c1').outgoing).toEqual({
      tool: 'reply_to_parent',
      reply: {
        piece: 'work_1',
        outcome: 'done',
        summary: long,
        resources: ['res_1'],
        needsUserAction: true,
        label: 'W1.7',
        toProfile: 'brobot',
        toConversation: 'sess_brobot',
      },
    })
  })

  it('🔴 a reply that reached nobody says so on its card — landed first or held ahead', () => {
    const undelivered = {
      type: 'reply_undelivered',
      piece: 'work_1',
      parent: 'sess_brobot',
      because: 'no-conversation',
    } as TranscriptEvent
    const onCard = fold([
      inventory(CLAUDE),
      call('c1', REPLY),
      replied('work_1'),
      undelivered,
      result('c1', 'W1.7 answered · no-conversation'),
    ])
    const a = toolNamed(onCard, 'c1').outgoing as OutgoingCardWords
    expect(a.tool === 'reply_to_parent' && a.reply?.undelivered).toBe('no-conversation')
    // ⚠️ both rows written before the provider's call row — the mark travels with the held row
    const ahead = fold([inventory(CLAUDE), replied('work_1'), undelivered, call('c1', REPLY)])
    const b = toolNamed(ahead, 'c1').outgoing as OutgoingCardWords
    expect(b.tool === 'reply_to_parent' && b.reply?.undelivered).toBe('no-conversation')
    // ⚑ the notice still draws — the card does not replace the signal
    expect(onCard.items.some((item) => item.kind === 'notice')).toBe(true)
    // ⛔ the control: another piece's undelivered reply marks nothing here
    const other = fold([
      inventory(CLAUDE),
      call('c1', REPLY),
      replied('work_1'),
      { ...(undelivered as object), piece: 'work_2' } as TranscriptEvent,
    ])
    const c = toolNamed(other, 'c1').outgoing as OutgoingCardWords
    expect(c.tool === 'reply_to_parent' && c.reply?.undelivered).toBeUndefined()
  })

  it('⚠️ a reply whose give is not in view, or was written with no profile, names nobody', () => {
    const unseen = fold([inventory(CLAUDE), call('c1', REPLY), replied('work_1')])
    const a = toolNamed(unseen, 'c1').outgoing as OutgoingCardWords
    expect(a.tool === 'reply_to_parent' && a.reply).toEqual({
      piece: 'work_1',
      outcome: 'done',
      summary: 'It is done.',
      resources: [],
    })
    const noProfile = fold([
      inventory(CLAUDE),
      ...given('work_1', 'W1.3', 'sess_parent', null),
      call('c1', REPLY),
      replied('work_1'),
    ])
    const b = toolNamed(noProfile, 'c1').outgoing as OutgoingCardWords
    expect(b.tool === 'reply_to_parent' && b.reply?.toProfile).toBeUndefined()
    expect(b.tool === 'reply_to_parent' && b.reply?.toConversation).toBe('sess_parent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · its own row, never a line in a run
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the card is its own row', () => {
  it('⛔ a settled message call splits a run; the same shape with one of our OTHER tools does not', () => {
    const shape = (middle: string): TranscriptEvent[] => [
      inventory(CLAUDE),
      call('a', 'Read'),
      result('a'),
      call('b', middle),
      result('b'),
      call('c', 'Read'),
      result('c'),
    ]
    const split = transcriptRows(fold(shape('mcp__brobot__message_agent')).items)
    expect(split.map((row) => row.kind)).toEqual(['run', 'item', 'run'])
    expect(joinsARun(toolNamed(fold(shape('mcp__brobot__message_agent')), 'b'))).toBe(false)
    // ⚑ the control — the grouping still works around it
    const merged = transcriptRows(fold(shape('mcp__brobot__list_tasks')).items)
    expect(merged.map((row) => row.kind)).toEqual(['run'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · what the card says
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the reading', () => {
  const bare = { summary: '{}', result: null, unfinished: undefined }

  it('⛔ a recipient with no profile is “another agent” — never agentName(null), which is BroBot', () => {
    // premise: the trap is real
    expect(agentName(null, IDS)).toBe('BroBot')
    const card = outgoingCard(
      bare,
      {
        tool: 'message_agent',
        sent: {
          toProfile: null,
          toConversation: 'sess_x',
          kind: 'note',
          delivery: 'sent',
          text: null,
          clipped: false,
        },
      },
      IDS,
      null,
    )
    expect(card.recipient).toBe(AN_UNNAMED_RECIPIENT)
    // ⚑ and a named one is the name a person gave
    const named = outgoingCard(
      bare,
      {
        tool: 'message_agent',
        sent: {
          toProfile: 'ada',
          toConversation: 'sess_ada',
          kind: 'note',
          delivery: 'sent',
          text: null,
          clipped: false,
        },
      },
      IDS,
      null,
    )
    expect(named.recipient).toBe('Ada')
    expect(named.recipient).not.toContain('sess_')
  })

  it('⚑ a reply with no giver in view goes to “its parent”', () => {
    const card = outgoingCard(
      bare,
      {
        tool: 'reply_to_parent',
        reply: { piece: 't', outcome: 'done', summary: 's', resources: [] },
      },
      IDS,
      null,
    )
    expect(card.recipient).toBe(AN_UNNAMED_PARENT)
  })

  it('🔴 every state, each from the fact that decides it', () => {
    const message = (landed: boolean, delivery: 'sent' | 'queued' = 'sent'): OutgoingCardWords => ({
      tool: 'message_agent',
      sent: landed
        ? {
            toProfile: 'ada',
            toConversation: 's',
            kind: 'note',
            delivery,
            text: null,
            clipped: false,
          }
        : null,
    })
    const state = (
      item: Parameters<typeof outgoingCard>[0],
      words: OutgoingCardWords,
    ): OutgoingState => outgoingCard(item, words, IDS, null).state
    const answered = { summary: '{}', result: { summary: 'refused (x): no', ok: true } }
    expect(state(bare, message(false))).toBe('sending')
    expect(state({ ...bare, unfinished: true }, message(false))).toBe('did-not-finish')
    expect(state(answered, message(false))).toBe('answered')
    expect(state(answered, message(true))).toBe('sent')
    expect(state(answered, message(true, 'queued'))).toBe('held')
    // 🔴 a reply is *delivered* only once the call has answered with no `reply_undelivered` —
    // never on the reply row alone, because the host writes the failure row before it answers —
    // ⚑ and only over a give in view that a conversation made (D-016 · commit 6)
    const inView = { toProfile: 'ada', toConversation: 'sess_ada' }
    const reply = (undelivered?: string, giver: object = inView): OutgoingCardWords => ({
      tool: 'reply_to_parent',
      reply: {
        piece: 't',
        outcome: 'done',
        summary: 's',
        resources: [],
        ...giver,
        ...(undelivered === undefined ? {} : { undelivered }),
      },
    })
    expect(state(bare, reply())).toBe('sending')
    expect(state(answered, reply())).toBe('delivered')
    // ⚑ a give out of view may be a piece a person gave, which went to no conversation: the call
    // answered, and the receipt it prints says where the reply went — never a *delivered* the card
    // cannot read off a row
    const outOfView = reply(undefined, {})
    expect(state(answered, outOfView)).toBe('answered')
    expect(outgoingCard(answered, outOfView, IDS, null).receipt).toBe(answered.result.summary)
    expect(state(answered, reply('no-conversation'))).toBe('not-delivered')
    expect(state(bare, reply('no-conversation'))).toBe('not-delivered')
    expect(state({ ...bare, unfinished: true }, reply())).toBe('did-not-finish')
    expect(state(answered, { tool: 'reply_to_parent', reply: null })).toBe('answered')
    // ⚑ the receipt is printed in the one state where nothing else says what happened — and only there
    expect(outgoingCard(answered, message(false), IDS, null).receipt).toBe('refused (x): no')
    expect(outgoingCard(answered, message(true), IDS, null).receipt).toBeNull()
    // ⛔ every state but `answered` has a word, the words differ — and `answered` is the one state
    // whose card prints the receipt instead, so it cannot be silent
    const worded = Object.entries(OUTGOING_STATE_WORD).filter(([state]) => state !== 'answered')
    for (const [state, word] of worded) expect(word, state).not.toBe('')
    expect(new Set(worded.map(([, word]) => word)).size).toBe(worded.length)
    expect(OUTGOING_STATE_WORD.answered).toBe('')
    // ⚑ a call that ERRORED is `failed`, and prints its receipt too
    const failed = { summary: '{}', result: { summary: 'the handler threw', ok: false } }
    expect(state(failed, message(false))).toBe('failed')
    expect(outgoingCard(failed, message(false), IDS, null).receipt).toBe('the handler threw')
    expect(state(failed, reply())).toBe('failed')
  })

  it('⚑ a reply draws the parent’s own facts line, and a piece with no label is “Piece”, never a guess', () => {
    const labelled = outgoingCard(
      bare,
      {
        tool: 'reply_to_parent',
        reply: {
          piece: 't',
          outcome: 'blocked',
          summary: 's',
          resources: [],
          label: 'W1.7',
          needsUserAction: true,
        },
      },
      IDS,
      null,
    )
    expect(labelled.facts?.heading).toBe('W1.7')
    expect(labelled.facts?.outcome).toBe('blocked')
    expect(labelled.facts?.mark).not.toBeNull()
    const unlabelled = outgoingCard(
      bare,
      {
        tool: 'reply_to_parent',
        reply: { piece: 't', outcome: 'done', summary: 's', resources: [] },
      },
      IDS,
      null,
    )
    expect(unlabelled.facts?.heading).toBe('Piece')
    expect(unlabelled.facts?.mark).toBeNull()
  })

  it('⚑ the press opens the other conversation — one press, held by this window or not (D-017b)', () => {
    const words: OutgoingCardWords = {
      tool: 'message_agent',
      sent: {
        toProfile: 'ada',
        toConversation: 'sess_ada',
        kind: 'note',
        delivery: 'sent',
        text: null,
        clipped: false,
      },
    }
    const held = outgoingCard(bare, words, IDS, new Set(['sess_ada'])).where
    expect(held?.action).toBe(OPEN_THE_CONVERSATION)
    expect(held?.held).toBe(true)
    const notHeld = outgoingCard(bare, words, IDS, new Set()).where
    expect(notHeld?.action).toBe(OPEN_THE_CONVERSATION)
    expect(notHeld?.held).toBe(false)
    // ⛔ a surface with no runtime behind it offers no press
    expect(outgoingCard(bare, words, IDS, null).where).toBeNull()
  })

  it('🔴 the body: a landed reply is WHOLE; a message is what survived its call’s bound, and says so', () => {
    const long = 'x'.repeat(400)
    const cut = `${JSON.stringify({ agent: 'sess_ada', text: long }).slice(0, 200)}…`
    const message = outgoingCard(
      { ...bare, summary: cut },
      {
        tool: 'message_agent',
        sent: {
          toProfile: 'ada',
          toConversation: 'sess_ada',
          kind: 'note',
          delivery: 'sent',
          text: null,
          clipped: false,
        },
      },
      IDS,
      null,
    )
    expect(message.bodyIsCut).toBe(true)
    expect(long.startsWith(message.body ?? '')).toBe(true)
    const reply = outgoingCard(
      { ...bare, summary: cut },
      {
        tool: 'reply_to_parent',
        reply: { piece: 't', outcome: 'done', summary: long, resources: [] },
      },
      IDS,
      null,
    )
    expect(reply.body).toBe(long)
    expect(reply.bodyIsCut).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · one argument, read back out of a bounded summary
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · argumentExcerpt', () => {
  it('⚑ a whole summary is parsed, and a missing key is null rather than a guess', () => {
    const whole = JSON.stringify({ agent: 'sess_ada', text: 'hello "there"\nfriend' })
    expect(argumentExcerpt(whole, 'text')).toEqual({ text: 'hello "there"\nfriend', cut: false })
    expect(argumentExcerpt(whole, 'kind')).toBeNull()
    expect(argumentExcerpt('not json and no key', 'text')).toBeNull()
  })

  it('🔴 both adapters’ cuts — Claude’s `…` and Codex’s `… (200 of N characters)`', () => {
    const text = `é ${'word '.repeat(80)}`
    const json = JSON.stringify({ agent: 'sess_ada', text })
    const claude = argumentExcerpt(`${json.slice(0, 200)}…`, 'text')
    const codex = argumentExcerpt(
      `${json.slice(0, 200)}… (200 of ${json.length} characters)`,
      'text',
    )
    for (const read of [claude, codex]) {
      expect(read?.cut).toBe(true)
      expect(text.startsWith(read?.text ?? '∅'), read?.text).toBe(true)
      expect(read?.text).not.toContain('…')
      expect(read?.text).not.toContain('characters)')
    }
  })

  it('⚠️ escapes are decoded, and one the cut split in half is dropped', () => {
    const json = JSON.stringify({ text: 'a\tb\\céd"e' })
    expect(argumentExcerpt(json.replace(/"}$/, ''), 'text')).toEqual({
      text: 'a\tb\\céd"e',
      cut: true,
    })
    expect(argumentExcerpt('{"text":"ab\\', 'text')).toEqual({ text: 'ab', cut: true })
    expect(argumentExcerpt('{"text":"ab\\u00', 'text')).toEqual({ text: 'ab', cut: true })
  })

  it('⛔ the key is found as a KEY — a value that mentions it, escaped, does not match', () => {
    const json = JSON.stringify({ note: 'the "text":"fake" one', text: 'real words' })
    expect(argumentExcerpt(`${json.slice(0, json.length - 3)}…`, 'text')).toEqual({
      text: 'real word',
      cut: true,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · replay is a trust boundary
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · a replayed row that does not say something draws less — never more, never a crash', () => {
  const MESSAGE = 'mcp__brobot__message_agent'

  it('⛔ a call with no string name, after an inventory, folds as the tool row it always was', () => {
    const state = fold([
      inventory(CLAUDE),
      { type: 'tool_call', id: 'c1', name: 42, summary: '{}' } as unknown as TranscriptEvent,
    ])
    expect(toolNamed(state, 'c1').outgoing).toBeUndefined()
  })

  it('⛔ a message row missing its recipient lands nowhere; a wrong-typed profile names nobody', () => {
    const noRecipient = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      { ...(sent('x', 'ada') as object), to: undefined } as unknown as TranscriptEvent,
    ])
    const a = toolNamed(noRecipient, 'c1').outgoing as OutgoingCardWords
    expect(a.tool === 'message_agent' && a.sent).toBeNull()
    const badProfile = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      sent('sess_ada', 7 as unknown as string),
    ])
    const b = toolNamed(badProfile, 'c1').outgoing as OutgoingCardWords
    expect(b.tool === 'message_agent' && b.sent?.toProfile).toBeNull()
    expect(outgoingCard(toolNamed(badProfile, 'c1'), b, IDS, null).recipient).toBe(
      AN_UNNAMED_RECIPIENT,
    )
  })

  it('⛔ a kind this app does not know draws no mark — never a prototype member', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      sent('sess_ada', 'ada', { kind: 'constructor' }),
    ])
    const words = toolNamed(state, 'c1').outgoing as OutgoingCardWords
    expect(words.tool === 'message_agent' && words.sent?.kind).toBeNull()
    expect(outgoingCard(toolNamed(state, 'c1'), words, IDS, null).mark).toBe('')
    // ⚑ the control: a known kind draws its word
    expect(MESSAGE_KIND_WORD.note).toBe('note')
  })

  it('⛔ a row with no delivery does not read as sent; a lost reply with no reason is still lost', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      sent('sess_ada', 'ada', { delivery: undefined }),
      result('c1', 'sess_ada was idle, so it has been sent straight away as work.'),
    ])
    const item = toolNamed(state, 'c1')
    const card = outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, null)
    expect(card.state).not.toBe('sent')
    expect(card.state).toBe('answered')
    const lost = fold([
      inventory(CLAUDE),
      call('r1', 'mcp__brobot__reply_to_parent'),
      replied('work_1'),
      { type: 'reply_undelivered', piece: 'work_1', parent: 'sess_p' } as TranscriptEvent,
      result('r1', 'W1.1 answered'),
    ])
    const reply = toolNamed(lost, 'r1')
    expect(outgoingCard(reply, reply.outgoing as OutgoingCardWords, IDS, null).state).toBe(
      'not-delivered',
    )
  })

  it('🔴 a receipt printed on the card names no handle', () => {
    const state = fold([
      inventory(CLAUDE),
      call('c1', MESSAGE),
      result(
        'c1',
        'held for sess_0f1e2d3c-aaaa-bbbb-cccc-1234567890ab as work; it will be delivered',
      ),
    ])
    const item = toolNamed(state, 'c1')
    const card = outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, null)
    expect(card.receipt).toBe(`held for ${A_HANDLE_READ_ALOUD} as work; it will be delivered`)
    expect(card.receipt).not.toContain('sess_')
  })
})
