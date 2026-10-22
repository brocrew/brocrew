import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import {
  attentionToACardNobodyHolds,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  foldProviderLimits,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../../src/shared/provider-limit'
import type { InstructionAskWaiting } from '../../src/shared/own-instructions'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type AskedQuestion,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
  type WorkInHand,
} from '../../src/shared/questions'
import type { McpServerRequestForAPerson } from '../../src/shared/runtime-ipc'
import type { StalledWork } from '../../src/shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../src/shared/stopped-work'
import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'
import type { WorkIncident } from '../../src/shared/work-incidents'
import { mount, type Mounted } from './harness'

/**
 * *Waiting on you* with a card of every kind it lays out in its grid: two providers' usage, a piece
 * that stopped with nobody told, two pieces whose agent stopped, and three permission requests —
 * and, with `every`, a question with choices and one in parts, a to-do, a piece no agent is
 * driving, a recovery, an ask about an agent's rules, an MCP server request and work waiting on the
 * person's reply. Made-up agents, folders and commands.
 */

export const NOW = Date.UTC(2026, 8, 21, 14, 0, 0)

const ASKERS = [
  { session: 'sess_glint', name: 'Glint', kind: 'command', action: 'Bash', detail: 'npm test' },
  {
    session: 'sess_orbit',
    name: 'Orbit',
    kind: 'file',
    action: 'Read',
    detail: '~/projects/notes-app/docs/plan.md',
  },
  { session: 'sess_pebble', name: 'Pebble', kind: 'command', action: 'Bash', detail: 'git status' },
] as const

const nameOf = (id: string): string => ASKERS.find((one) => one.session === id)?.name ?? id

const walked = <Row>(rows: readonly Row[], walk: LedgerWalk<Row>['walk']): LedgerWalk<Row> => ({
  rows,
  walk,
  ledgers: Math.max(rows.length, 1),
  rowsUnread: 0,
})

function decision(askedBy: string, requestId: string, at: number): PersonsDecision {
  const request = {
    requestId,
    askedBy,
    parent: 'sess_lead',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  } as const satisfies RequestOnlyAPersonCanSettle
  const reading = decisionReading(askedBy, nameOf)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says: 'a command or file approval, which is a person’s to give',
    work: [],
  }
}

function cardOf(asker: (typeof ASKERS)[number], requestId: string): AttentionRequest {
  const row = attentionToACardNobodyHolds(
    asker.session,
    {
      asked: {
        type: 'permission_request',
        id: requestId,
        kind: asker.kind,
        action: asker.action,
        detail: asker.detail,
        scope: {
          cwd: '/work/notes-app',
          paths: [],
          networkHosts: [],
          persistence: 'session',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
          grants: {},
        },
      } as never,
      provider: 'claude',
      profileId: asker.name.toLowerCase(),
    },
    { sent: false, refused: null },
    (slug) => slug,
  )
  if (row === undefined) throw new Error('the sample card drew no row')
  return row
}

const wall = (said: string): ProviderLimitSeen => {
  const read = readProviderLimit(said, NOW - 60_000)
  if (read === null) throw new Error(`not recognised: ${said}`)
  return read
}

const STALL = {
  piece: 'work_32',
  label: 'W3.2',
  title: 'Draft the menu page copy in two tones',
  owner: 'sess_loom',
  ownerName: 'Loom',
  giver: 'sess_lead',
  giverName: 'Lead',
  because: 'turn_interrupted',
  askedToStop: null,
  stalledAt: NOW - 600_000,
} as StalledWork

const STOPS: readonly StoppedWorkForAPerson[] = [
  {
    piece: 'work_41',
    label: 'W4.1',
    title: 'Check the contact form on a phone',
    holder: 'sess_quill',
    holderName: 'Quill',
    giver: 'sess_lead',
    giverName: 'Lead',
    at: NOW - 900_000,
  },
  {
    piece: 'work_42',
    label: 'W4.2',
    title: 'Write the opening hours section',
    holder: 'sess_tide',
    holderName: 'Tide',
    giver: 'sess_lead',
    giverName: 'Lead',
    at: NOW - 300_000,
  },
]

/** A question an agent asked the person, as the host lists it: its words, or a to-do's action. */
function question(
  requestId: string,
  askedBy: string,
  name: string,
  at: number,
  asked: AskedQuestion | null,
  action?: PersonsQuestion['action'],
): PersonsQuestion {
  const request: RoutedRequest = {
    requestId,
    askedBy,
    parent: null,
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  const nameIt = (id: string): string => (id === askedBy ? name : id)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, nameIt),
    sentence: chainSentence(chain, nameIt),
    work: [],
    about: action
      ? { is: 'the-asker-named-it', work: { label: 'W5.1' } as WorkInHand }
      : NOTHING_NAMED_THE_WORK,
    raisedBy: 'this-app',
    offered: null,
    asked,
    ...(action ? { action } : {}),
  }
}

const QUESTIONS: readonly PersonsQuestion[] = [
  question('req_q1', 'sess_ada', 'Ada', NOW - 420_000, {
    prompt:
      'The menu page can open on the drinks or on the food. Most visitors on a phone look for opening hours and prices first, so which should a person see before scrolling?',
    context: null,
    passedUp: false,
    parts: [
      {
        id: 'first',
        header: 'Opens on',
        prompt:
          'The menu page can open on the drinks or on the food. Most visitors on a phone look for opening hours and prices first, so which should a person see before scrolling?',
        options: [
          { label: 'Food first', description: 'Mains, then sides and desserts' },
          { label: 'Drinks first', description: 'Coffee and tea at the top' },
          { label: 'Hours and prices', description: 'A short card above both lists' },
        ],
        allowOther: true,
      },
    ],
  }),
  question('req_q2', 'sess_ali', 'Ali', NOW - 180_000, {
    prompt: 'Two choices for the contact form.',
    context: null,
    passedUp: false,
    parts: [
      {
        id: 'fields',
        header: 'Fields',
        prompt: 'Which fields does the form ask for?',
        options: [{ label: 'Name' }, { label: 'Email' }, { label: 'Phone' }],
        multiSelect: true,
      },
      {
        id: 'reply',
        header: 'Reply',
        prompt: 'Who answers the messages it sends?',
        options: [],
      },
    ],
  }),
]

const TODO = question('req_todo', 'sess_ada', 'Ada', NOW - 240_000, null, {
  text: 'Open the menu page on your phone and tell me whether the prices are easy to read.',
  files: [{ resource: 'res_menu', name: 'menu-page.png' }],
})

const INCIDENT: WorkIncident = {
  piece: 'work_51',
  label: 'W5.1',
  title: 'Gather the photos for the gallery',
  holder: 'sess_ada',
  holderName: 'Ada',
  giver: 'sess_lead',
  giverName: 'Lead',
  kind: 'wait-needs-classification',
  since: NOW - 1_200_000,
}

const RECOVERY: WorkIncident = {
  ...INCIDENT,
  piece: 'work_61',
  label: 'W6.1',
  title: 'Proofread the about page',
  holder: 'sess_ali',
  holderName: 'Ali',
  kind: 'recovery-pending',
  recovery: { because: 'usage-limit', resumesAt: NOW + 3_600_000 },
}

const ASK: InstructionAskWaiting = {
  asked: {
    type: 'instruction_proposed',
    askId: 'iprop_1',
    ask: 'propose',
    about: 'writer',
    proposedBy: 'lead',
    text: 'Always show prices with two decimals.',
    why: 'two pages showed prices differently',
  },
  conversation: 'sess_lead',
  at: NOW - 500_000,
} as InstructionAskWaiting

const SERVER: McpServerRequestForAPerson = {
  conversation: 'sess_quill',
  at: NOW - 360_000,
  askerCalled: 'Quill',
  requested: {
    type: 'mcp_server_requested',
    requestId: 'mcp_1',
    name: 'menu-notes',
    url: 'http://127.0.0.1:8765/mcp/menu-notes',
    reaches: 'Read and write the menu notes.',
    whoGetsIt: 'everyone',
    requestedBy: 'quill',
  },
} as McpServerRequestForAPerson

const REPLY: WaitingOnWhoWrote = {
  piece: 'work_71',
  label: 'W7.1',
  title: 'Choose the font for the headings',
  owner: 'sess_tide',
  ownerName: 'Tide',
  answeredAt: NOW - 300_000,
}

/**
 * Fill the queue with a card of every kind (with `every`, every kind the page draws; with `oneWall`,
 * one provider's usage), then mount the page at `width` by `height`.
 */
export async function aWaitingPageWithEveryCard(
  width: number,
  height = 1400,
  every = false,
  oneWall = false,
): Promise<Mounted> {
  const rows = ASKERS.map((asker, at) => cardOf(asker, `req_${String(at)}`))
  const nameIt = (slug: string): string => slug.charAt(0).toUpperCase() + slug.slice(1)
  usePersonsQueue().supply(
    walked(every ? [...QUESTIONS, TODO] : [], 'every-conversation-that-routed'),
    walked(
      ASKERS.map((asker, at) =>
        decision(asker.session, `req_${String(at)}`, NOW - 60_000 * (at + 1)),
      ),
      'every-conversation-that-routed',
    ),
    {
      held: new Set<string>(),
      answerable: new Map(),
      nobodyHolds: new Map(rows.map((row) => [row.key, row])),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
      answer: async () => null,
      handBack: async () => '',
      answerTodo: async () => null,
      openFile: () => {},
      decideInstruction: () => {},
      decideMcpServerRequest: async () => ({ ok: true }) as never,
    },
    {
      walked: walked(
        foldProviderLimits(
          [
            wall(
              'claude is approaching its rate limit (seven_day); resets 2026-09-24T11:00:00.000Z',
            ),
            ...(oneWall
              ? []
              : [
                  wall(
                    'codex is approaching its rate limit — 99% of a 7-day window used; resets 2026-09-25T21:10:56.000Z',
                  ),
                ]),
          ],
          [],
          NOW,
        ),
        'every-provider-wall-recently-recorded',
      ),
      lastLookAnswered: true,
    },
    { walked: walked([STALL], 'every-conversation-that-was-given-work'), lastLookAnswered: true },
    every ? { walked: [ASK], lastLookAnswered: true, nameOf: nameIt } : undefined,
    every
      ? {
          walked: walked([REPLY], 'every-conversation-that-was-given-work'),
          lastLookAnswered: true,
        }
      : undefined,
    every ? { walked: [SERVER], lastLookAnswered: true, nameOf: nameIt } : undefined,
    { walked: walked(STOPS, 'every-conversation-that-was-given-work'), lastLookAnswered: true },
    every ? { incidents: [INCIDENT, RECOVERY], lastLookAnswered: true, rowsUnread: 0 } : undefined,
  )
  const m = mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width, height })
  await nextTick()
  return m
}
