import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { joinsARun } from '../src/renderer/src/lib/tool-runs'
import {
  A_HANDLE_READ_ALOUD,
  AN_UNNAMED_RECIPIENT,
  GIVE_MARK,
  outgoingCard,
  type OutgoingCardReading,
  type OutgoingCardWords,
} from '../src/renderer/src/lib/outgoing-card'
import type { AgentIdentity, TranscriptEvent } from '../src/shared/runtime-ipc'
import type { WorkEdge } from '../src/shared/who-called-whom'

/**
 * # 🔴 A piece this conversation gave, drawn as a card
 *
 * A `give_work` call draws its own card, like a question, rather than a line in the tool run.
 *
 * ⛔ **Where no row of the give's own is on the call** — D-047's `work_sent`, which these events do
 * not hold — the card reads the call's arguments and the tool's own receipt, and §1 pins the
 * receipt's shape to the tool's own template — a sentence reworded in `agent-tools.ts` turns this
 * file red rather than the card silent.
 * ⚑ The receipt names no conversation (D-016 · commit 7 · R1), so the press opens the one the cast
 * read for the receipt's label.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 1 | the receipt this card reads is the tool's own sentence | — |
 * | 2 | the call is recognised and leaves the tool run | a session never told its tools' names |
 * | 3 | the card's words: to whom, the label, the title and the brief, how it went, the press | a refusal, a failure and a cut receipt name nothing they do not say |
 */

const here = dirname(fileURLToPath(import.meta.url))

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const CODEX = { prefix: '', separator: '__' }

const inventory = (naming = CLAUDE): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming,
    declared: {
      server: 'brobot',
      tools: [{ name: 'give_work', description: '', parameters: [] }],
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, args: Record<string, unknown>, name = 'mcp__brobot__give_work') =>
  ({ type: 'tool_call', id, name, summary: JSON.stringify(args) }) as TranscriptEvent

const result = (id: string, summary: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

/* ------------------------------------------------ the tool's own sentences, as §1 finds them */

const WENT_STRAIGHT = '`; it went to ${name} straight away`'
/**
 * ⚑ **D-027 moved the held tail**: a held give no longer *"goes out as its own turn"* — it goes out
 * with whatever else is held for that conversation, oldest first, in one turn. The template now
 * puts in a constant the verbs share, so §1 pins the template AND the constant's own words.
 */
const WENT_HELD =
  '`; it is held until ${name} is free, then goes out ${WITH_WHATEVER_ELSE_IS_HELD}`'
const WITH_THE_REST =
  'with whatever else is held for it, oldest first (a person’s command goes on its own)'
/** ⚑ The constant as the source declares it — its apostrophe written as an escape. */
const WITH_THE_REST_DECLARED = `const WITH_WHATEVER_ELSE_IS_HELD =\n  '${WITH_THE_REST.replace('’', '\\u2019')}'`
const LEAD = '`${given.label} given to ${name} (${given.profile})${went}.'

/** ⚑ The receipt as `give_work` writes it — its own template, with these values put in. */
const receipt = (label: string, name: string, profile: string, held = false) =>
  `${label} given to ${name} (${profile})${
    held
      ? `; it is held until ${name} is free, then goes out ${WITH_THE_REST}`
      : `; it went to ${name} straight away`
  }.`

const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'

/** ⚑ A piece this conversation gave to another agent, in another conversation. */
const ELSEWHERE = 'sess_7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5c'

/**
 * ⚑ The cast's reading of the work this conversation gave out — the two pieces §3 gives, to Ayo.
 * ⛔ **And, FIRST, one it gave somebody else**, so a card that pressed any edge but the one its
 * receipt names would open the wrong conversation.
 */
const edge = (label: string, to = OWNER): WorkEdge => ({
  piece: `work_${label}`,
  label,
  title: 'Make the rail say what the card says',
  from: 'sess_giver',
  fromIdentity: 'brobot',
  to,
  toIdentity: to === OWNER ? 'dev' : 'qa',
  state: 'working',
  givenAt: 0,
  endedAt: null,
})

const GAVE_OUT = [edge('W1.1', ELSEWHERE), edge('W1.2'), edge('W1.2.3')]

const ARGS = {
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'dev',
  title: 'Make the rail say what the card says',
  brief: 'The rail and the card disagree about an agent. Find why and make them agree.',
}

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const tool = (state: TranscriptState, callId: string): ToolItem => {
  const found = state.items.find(
    (item): item is ToolItem & (typeof state.items)[number] =>
      item.kind === 'tool' && item.callId === callId,
  )
  expect(found, `no tool row for ${callId}`).toBeDefined()
  return found as ToolItem
}

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('brobot', 'BroBot'), ident('dev', 'Ayo')]

const cardOf = (
  events: readonly TranscriptEvent[],
  callId = 'c1',
  held: ReadonlySet<string> | null = new Set(),
): OutgoingCardReading => {
  const item = tool(fold(events), callId)
  expect(item.outgoing, 'the call was not recognised').toBeDefined()
  return outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, held, GAVE_OUT)
}

/* ============================================================================================= */

describe('§1 · the receipt this card reads is the tool’s own sentence', () => {
  it('🔴 `give_work` still words its receipt the way the card reads it', () => {
    const source = readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8')
    expect(source).toContain(LEAD)
    expect(source).toContain(WENT_STRAIGHT)
    expect(source).toContain(WENT_HELD)
    expect(source).toContain(WITH_THE_REST_DECLARED)
  })
})

describe('§2 · the call is recognised and leaves the tool run', () => {
  it('🔴 on Claude and on Codex, by the names the session was handed', () => {
    for (const [naming, name] of [
      [CLAUDE, 'mcp__brobot__give_work'],
      [CODEX, 'brobot__give_work'],
    ] as const) {
      const item = tool(fold([inventory(naming), call('c1', ARGS, name)]), 'c1')
      expect(item.outgoing).toEqual({ tool: 'give_work', given: null })
      expect(joinsARun(item)).toBe(false)
    }
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row', () => {
    const item = tool(fold([call('c1', ARGS), result('c1', receipt('W1.2', 'Ayo', 'dev'))]), 'c1')
    expect(item.outgoing).toBeUndefined()
    expect(joinsARun(item)).toBe(true)
  })
})

describe('§3 · the card’s words', () => {
  it('🔴 sent — to Ayo, W1.2, work, the title, the brief, and the press to Ayo’s conversation', () => {
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      result('c1', receipt('W1.2', 'Ayo', 'dev')),
    ])
    expect(card).toMatchObject({
      tool: 'give_work',
      recipient: 'Ayo',
      mark: GIVE_MARK,
      state: 'sent',
      piece: 'W1.2',
      title: ARGS.title,
      body: ARGS.brief,
      bodyIsCut: false,
      receipt: null,
    })
    expect(card.where).toMatchObject({ conversation: OWNER, held: false })
  })

  it('keeps sent and held worker receipts readable without a recorded give row', () => {
    for (const held of [false, true]) {
      const card = cardOf(
        [
          inventory(),
          call('c1', ARGS),
          result('c1', `${receipt('W1.2', 'Ayo', 'dev', held)} Worker: dev (2).`),
        ],
        'c1',
        held ? new Set([OWNER]) : new Set(),
      )
      expect(card).toMatchObject({
        state: held ? 'held' : 'sent',
        piece: 'W1.2',
        receipt: null,
        where: { conversation: OWNER, held },
      })
    }
  })

  it('🔴 held — the receipt says it waits for Ayo to be free', () => {
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      result('c1', receipt('W1.2.3', 'Ayo', 'dev', true)),
    ])
    expect(card.state).toBe('held')
    expect(card.piece).toBe('W1.2.3')
    expect(card.where?.conversation).toBe(OWNER)
  })

  it('🔴 a brief the 200-character bound cut says it was cut', () => {
    const long = JSON.stringify({ ...ARGS, brief: 'x'.repeat(400) })
    const cut = `${long.slice(0, 200)}…`
    const state = fold([
      inventory(),
      {
        type: 'tool_call',
        id: 'c1',
        name: 'mcp__brobot__give_work',
        summary: cut,
      } as TranscriptEvent,
    ])
    const item = tool(state, 'c1')
    const card = outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, new Set())
    expect(card.state).toBe('sending')
    expect(card.title).toBe(ARGS.title)
    expect(card.bodyIsCut).toBe(true)
    expect(card.body).toMatch(/^x+$/)
  })

  it('⛔ a refusal prints its receipt, and names no label and no conversation', () => {
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      result('c1', `refused (no-such-profile): no agent is called dev; ${OWNER} was not asked`),
    ])
    expect(card.state).toBe('answered')
    expect(card.piece).toBeNull()
    expect(card.where).toBeNull()
    expect(card.receipt).toBe(
      `refused (no-such-profile): no agent is called dev; ${A_HANDLE_READ_ALOUD} was not asked`,
    )
  })

  it('⛔ a call that errored is failed, and one the run ended before its answer did not finish', () => {
    expect(cardOf([inventory(), call('c1', ARGS), result('c1', 'denied', false)]).state).toBe(
      'failed',
    )
    const ended = fold([inventory(), call('c1', ARGS)])
    const item = tool(ended, 'c1')
    expect(
      outgoingCard({ ...item, unfinished: true }, item.outgoing as OutgoingCardWords, IDS, null)
        .state,
    ).toBe('did-not-finish')
  })

  it('⛔ a receipt cut before it said how it went is printed, never read as sent', () => {
    const cut = `${receipt('W1.2', 'Ayo', 'dev').slice(0, 30)}…`
    const card = cardOf([inventory(), call('c1', ARGS), result('c1', cut)])
    expect(card.state).toBe('answered')
    expect(card.piece).toBeNull()
    expect(card.receipt).toBe(cut)
  })

  it('⛔ a label the product never spells is not read as one', () => {
    const card = cardOf([inventory(), call('c1', ARGS), result('c1', receipt('W01', 'Ayo', 'dev'))])
    expect(card.state).toBe('answered')
    expect(card.piece).toBeNull()
  })

  it('⛔ a call that names nobody is to another agent — never BroBot', () => {
    const card = cardOf([inventory(), call('c1', { title: 't', brief: 'b' })])
    expect(card.recipient).toBe(AN_UNNAMED_RECIPIENT)
  })
})
