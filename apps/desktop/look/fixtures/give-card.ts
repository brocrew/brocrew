import { nextTick } from 'vue'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { railFacts, screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { META, paneProps, record } from '../../test/dom/harness'
import type { LookStage } from '../capture'

/**
 * The card a conversation keeps when its agent gives work: the reported example, with a brief cut
 * at the size limit after a few words, given to a conversation the rail lists by its title, so the
 * card names it and reads the brief whole there. Made-up agents and words.
 */

const SARAS = 'sess_5a7e0c1d-2b3c-4d5e-8f90-a1b2c3d4e5f6'

const TITLE =
  'Double landing throughput: batch reviewed changes or open a second landing conversation'

/** The call's arguments as the row keeps them, cut at its bound: the brief stops after a few words. */
function summary(): string {
  const whole = JSON.stringify({
    profile: 'release-coordinator',
    title: TITLE,
    brief:
      'Batches are simpler. A second lane is faster on busy days. Compare both and pick one with the reasons.',
  })
  return `${whole.slice(0, 240)}…`
}

const at = Date.UTC(2026, 10, 25, 0, 16)

const EVENTS: TranscriptEvent[] = [
  {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'give_work', description: '', parameters: [] }],
    },
    published: null,
  } as never,
  { type: 'status', state: 'idle' } as never,
  {
    type: 'user_turn',
    text: 'Have the landing either take batches of reviewed changes, or open a second landing lane.',
  } as never,
  { type: 'status', state: 'working' } as never,
  { type: 'tool_call', id: 'g1', name: 'mcp__brobot__give_work', summary: summary(), at } as never,
  {
    type: 'tool_result',
    id: 'g1',
    summary:
      'W4.206 given to Sara (release-coordinator); it went to Sara straight away. Sara has it in a conversation already open.',
    ok: true,
    at,
  } as never,
  { type: 'status', state: 'idle' } as never,
]

const IDENTITIES = [
  { id: 'aid:rc', slug: 'release-coordinator', displayName: 'Sara' },
] as unknown as AgentIdentity[]

const GAVE: WorkEdge = {
  piece: 'work_206',
  label: 'W4.206',
  title: TITLE,
  from: 'sess_1',
  fromIdentity: null,
  to: SARAS,
  toIdentity: 'release-coordinator',
  state: 'working',
  givenAt: at,
  endedAt: null,
}

/** What the rail and the cast have read: Sara's conversation, and the work this one gave it. */
function readTheCast(conversation: string): void {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  railFacts().update({
    listedConversations: [
      {
        sessionId: SARAS,
        label: 'Sara',
        named: { label: 'W4.12', title: 'Releases and gates' },
      },
    ] as never,
  })
  screenFacts().update({
    reading: {
      conversation,
      read: {
        conversation,
        parent: null,
        children: walk([], 'every-conversation-this-one-spawned'),
        workGivenOut: walk([GAVE], 'every-conversation-this-one-gave-work-to'),
        workTakenIn: walk([], 'every-piece-of-work-this-one-was-given'),
        readAt: at,
      },
      answered: true,
      atWork: null,
    },
  })
}

/** The conversation with its give card, folded, or opened by its own toggle. */
export async function giveCard(stage: LookStage, open: boolean): Promise<void> {
  const props = paneProps({
    record: record(EVENTS),
    drawerOpen: false,
    identities: IDENTITIES,
    held: [],
  })
  readTheCast(META.sessionId)
  const m = stage.mount(ConversationPane, props)
  await nextTick()
  if (!open) return
  for (const toggle of m.all('exchange-toggle')) {
    if (toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  }
  await nextTick()
}
