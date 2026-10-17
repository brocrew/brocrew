import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import {
  attentionToACardNobodyHolds,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  decisionReading,
  readingSentence,
  type PersonsDecision,
  type RequestOnlyAPersonCanSettle,
} from '../../src/shared/questions'
import type { LookStage } from '../capture'

/**
 * *Waiting on you* with three permissions from three helpers nobody has opened, each answered from
 * its own card. Made-up agents, folders and commands.
 */

const NOW = 1_790_000_000_000

const SAMPLES = [
  {
    session: 'sess_brobot',
    name: 'BroBot',
    kind: 'command',
    action: 'Bash',
    detail: 'npm test -- --runInBand',
    rule: { kind: 'tool', tool: 'Bash', content: 'npm test:*' },
    age: 240_000,
  },
  {
    session: 'sess_glint',
    name: 'Glint',
    kind: 'file',
    action: 'Read',
    detail: '~/projects/notes-app/docs/plan.md',
    rule: { kind: 'tool', tool: 'Read', content: '//projects/notes-app/docs/**' },
    age: 120_000,
  },
  {
    session: 'sess_orbit',
    name: 'Orbit',
    kind: 'command',
    action: 'Bash',
    detail: 'git diff --stat',
    rule: { kind: 'tool', tool: 'Bash', content: 'git diff:*' },
    age: 40_000,
  },
] as const

const nameOf = (id: string): string => SAMPLES.find((one) => one.session === id)?.name ?? id

function decision(askedBy: string, requestId: string, at: number): PersonsDecision {
  const request = {
    requestId,
    askedBy,
    parent: 'sess_pm',
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

function cardOf(sample: (typeof SAMPLES)[number], requestId: string): AttentionRequest {
  const row = attentionToACardNobodyHolds(
    sample.session,
    {
      asked: {
        type: 'permission_request',
        id: requestId,
        kind: sample.kind,
        action: sample.action,
        detail: sample.detail,
        scope: {
          cwd: '/work/notes-app',
          paths: [],
          networkHosts: [],
          persistence: 'session',
          amendments: [],
          availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
          underDisclosed: false,
          grants: { allow_for_session: [sample.rule] },
        },
      } as never,
      provider: 'claude',
      profileId: sample.name.toLowerCase(),
    },
    { sent: false, refused: null },
    (slug) => slug,
  )
  if (row === undefined) throw new Error('the sample card drew no row')
  return row
}

/** Mount the page at the main area's width, beside where the rail would be, and fill its queue. */
export async function waitingPage(stage: LookStage, open: boolean): Promise<void> {
  const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w'))
  const width = Math.round(stage.width - rail)
  await page.viewport(width, stage.height)
  const rows = SAMPLES.map((sample, at) => cardOf(sample, `req_${String(at)}`))
  const decisions = SAMPLES.map((sample, at) =>
    decision(sample.session, `req_${String(at)}`, NOW - sample.age),
  )
  usePersonsQueue().supply(
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 3, rowsUnread: 0 },
    {
      rows: decisions,
      walk: 'every-conversation-that-routed',
      ledgers: 3,
      rowsUnread: 0,
    },
    {
      held: new Set<string>(),
      answerable: new Map(),
      nobodyHolds: new Map(rows.map((row) => [row.key, row])),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
  const m = stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width })
  await nextTick()
  if (open) {
    const first = m.host.querySelector<HTMLDetailsElement>('details.pq-more')
    if (first === null) throw new Error('the first card drew no disclosure')
    first.open = true
  }
}
