import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type {
  CardNobodyHolds,
  LedgerWalk,
  PersonsDecision,
  RequestOnlyAPersonCanSettle,
} from '../../src/shared/question-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import {
  attentionToACardNobodyHolds,
  type AttentionDecision,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import { decisionReading, readingSentence } from '../../src/shared/questions'
import { assertDrawn, clipsOf, cutsOf, drawnReady } from './drawn'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * A request on *Waiting on you* is a compact card: who asked, the action it asks for in full, and
 * since when; the request's own answers side by side in its own words; and every broader choice,
 * with what it covers, under a native disclosure. Sample names and commands are made up.
 */

const NOW = 1_700_000_000_000
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const NAMES: Readonly<Record<string, string>> = {
  sess_brobot: 'BroBot',
  sess_glint: 'Glint',
  sess_orbit: 'Orbit',
}
const nameOf = (id: string): string => NAMES[id] ?? id

const queue = usePersonsQueue()
let settled: { row: PersonsQueueRow; decision: AttentionDecision }[] = []

function walked<Row>(rows: readonly Row[]): LedgerWalk<Row> {
  return {
    rows,
    walk: 'every-conversation-that-routed',
    ledgers: Math.max(rows.length, 1),
    rowsUnread: 0,
  }
}

/** A permission only a person can settle, in a conversation no window has opened. */
function decision(askedBy: string, requestId: string, age: number): PersonsDecision {
  const request = {
    requestId,
    askedBy,
    parent: 'sess_pm',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at: NOW - age,
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

/** The card the host read in that conversation's record: a shell command, with a conversation grant. */
function card(id: string, detail: string, available: readonly string[]): CardNobodyHolds {
  return {
    asked: {
      type: 'permission_request',
      id,
      kind: 'command',
      action: 'Bash',
      detail,
      scope: {
        cwd: '/work/notes-app',
        paths: [],
        networkHosts: [],
        persistence: 'session',
        amendments: [],
        availableDecisions: available,
        underDisclosed: false,
        grants: { allow_for_session: [{ kind: 'tool', tool: 'Bash', content: 'npm test:*' }] },
      },
    } as never,
    provider: 'claude',
    profileId: 'helper',
  }
}

/** The row a card nobody holds offers, built the way the screen builds it. */
function fromTheRecord(sessionId: string, held: CardNobodyHolds): AttentionRequest {
  const row = attentionToACardNobodyHolds(sessionId, held, { sent: false, refused: null }, (s) => s)
  if (row === undefined) throw new Error('the record drew no row')
  return row
}

/** A row with the given answers, for answers no fixture card offers. */
function literal(key: string, over: Partial<AttentionRequest>): AttentionRequest {
  const [sessionId = '', requestId = ''] = key.split(':')
  return {
    key,
    sessionId,
    requestId,
    itemId: `item_${requestId}`,
    kind: 'permission',
    where: 'notes-app',
    hasACommander: false,
    provider: 'claude',
    profileId: null,
    who: null,
    standing: 'waiting: permission',
    asked: 'Read',
    scope: ['~/projects/notes-app/docs/plan.md'],
    actionLines: 1,
    underDisclosed: false,
    detailOmitted: null,
    noPositive: null,
    at: null,
    decisions: [],
    limit: null,
    sent: false,
    refused: null,
    ...over,
  }
}

function supply(
  decisions: readonly PersonsDecision[],
  nobodyHolds: ReadonlyMap<string, AttentionRequest>,
): void {
  queue.supply(
    walked([]),
    walked(decisions),
    {
      held: new Set<string>(),
      answerable: new Map(),
      nobodyHolds,
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: (row, chosen) => settled.push({ row, decision: chosen }),
      takeOver: () => {},
      open: () => {},
    },
  )
}

const BROBOT = 'sess_brobot:req_test'
const COMMAND = 'npm test -- --runInBand'
const ALL_FOUR = ['allow', 'allow_for_session', 'deny', 'cancel']

/** BroBot's request, four minutes old, with all four of its card's answers. */
function brobot(detail = COMMAND): AttentionRequest {
  const row = fromTheRecord('sess_brobot', card('req_test', detail, ALL_FOUR))
  supply([decision('sess_brobot', 'req_test', 240_000)], new Map([[row.key, row]]))
  return row
}

async function thePage(width = 1180, needsYou: AttentionRequest[] = []): Promise<Mounted> {
  await page.viewport(width, 900)
  const m = mount(WaitingOnYou, { needsYou, clock: NOW }, { width, height: 900 })
  await nextTick()
  return m
}

const label = (button: Element): string => button.querySelector('strong')?.textContent?.trim() ?? ''
const follows = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
const request = (m: Mounted, key: string) => m.q(`persons-queue-row-${key}`)
const answersOf = (m: Mounted, key: string): HTMLElement[] => [
  ...request(m, key).querySelectorAll<HTMLElement>('[data-permission-decision]'),
]
const primariesOf = (m: Mounted, key: string): HTMLElement[] =>
  answersOf(m, key).filter((button) =>
    ['allow', 'deny'].includes(button.dataset.permissionDecision ?? ''),
  )
const detailOf = (m: Mounted, key: string): HTMLElement =>
  request(m, key).querySelector<HTMLElement>('[data-cy="permission-detail"]')!

beforeEach(() => {
  settled = []
})

afterEach(async () => {
  unmountAll()
  queue.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

it('uses the conversation permission card for the same request in both queues', async () => {
  const held = card('req_test', COMMAND, ALL_FOUR)
  const pending = fromTheRecord('sess_brobot', held)
  const pane = mount(ConversationPane, paneProps({ record: record([held.asked], 'sess_brobot') }))
  supply([decision('sess_brobot', 'req_test', 240_000)], new Map([[pending.key, pending]]))
  const queues = await thePage(1180, [pending])
  const cards = [pane.q('permission-card'), ...queues.all('permission-card')]
  expect(cards).toHaveLength(3)
  for (const card of cards) {
    expect(card.dataset.requestId).toBe('req_test')
    expect(card.querySelector('[data-cy="permission-detail"]')?.textContent).toContain(COMMAND)
  }
  const routed = queues.q(`persons-queue-row-${pending.key}`)
  routed.querySelector<HTMLButtonElement>('[data-cy="permission-deny"]')!.click()
  expect(settled).toHaveLength(1)
  expect(settled[0]!.decision).toMatchObject({ kind: 'permission', decision: { outcome: 'deny' } })
})

it('uses the conversation question card for the same provider question in both queues', async () => {
  const held: CardNobodyHolds = {
    ...card('q', '', []),
    asked: {
      type: 'user_input_request',
      id: 'q',
      prompt: 'Which draft?',
      questions: [{ id: 'draft', prompt: 'Which draft?', options: [{ label: 'First' }] }],
    },
  }
  const pending = fromTheRecord('sess_brobot', held)
  const pane = mount(ConversationPane, paneProps({ record: record([held.asked], 'sess_brobot') }))
  supply([decision('sess_brobot', 'q', 240_000)], new Map([[pending.key, pending]]))
  const queues = await thePage(1180, [pending])
  const cards = [pane.q('user-input-card'), ...queues.all('user-input-card')]
  expect(cards).toHaveLength(3)
  for (const card of cards) {
    expect(card.dataset.requestId).toBe('q')
    expect(card.hasAttribute('data-question-card')).toBe(true)
    expect(card.textContent).toContain('Which draft?')
  }
  const routed = queues.q(`persons-queue-row-${pending.key}`)
  routed.querySelector<HTMLButtonElement>('[data-cy="user-input-choice-draft"]')!.click()
  expect(settled).toHaveLength(1)
  expect(settled[0]!.decision).toMatchObject({
    kind: 'answer',
    questionId: 'draft',
    option: 'First',
  })
})

describe('§1 · who asked, what, and since when', () => {
  it('reads who, then what, then since when — and the page draws who and when on one top line', async () => {
    brobot()
    const m = await thePage()
    const who = m.q(`persons-queue-chain-${BROBOT}`)
    const what = detailOf(m, BROBOT)
    const when = m.q(`persons-queue-since-${BROBOT}`)
    expect(who.textContent).toContain('BroBot')
    expect(what.textContent).toContain(COMMAND)
    expect(when.textContent?.trim()).toMatch(/^waiting since 4m ago$/)
    expect(follows(who, what)).toBe(true)
    expect(follows(what, when)).toBe(true)

    const a = who.getBoundingClientRect()
    const b = what.getBoundingClientRect()
    const c = when.getBoundingClientRect()
    expect(Math.abs(c.top - a.top), 'since when is not on the top line').toBeLessThan(a.height)
    expect(c.left).toBeGreaterThan(a.right)
    expect(b.top).toBeGreaterThanOrEqual(a.bottom)
    // The answers come after all three.
    const answers = m.q(`persons-queue-actions-${BROBOT}`).getBoundingClientRect()
    expect(answers.top).toBeGreaterThanOrEqual(b.bottom)
  })

  it('keeps the global oldest-first order across conversations, with no grouping', async () => {
    const rows = [
      fromTheRecord('sess_orbit', card('req_o', 'git diff --stat', ALL_FOUR)),
      fromTheRecord('sess_brobot', card('req_b', COMMAND, ALL_FOUR)),
      fromTheRecord('sess_glint', card('req_g', 'cat ~/projects/notes-app/docs/plan.md', ALL_FOUR)),
    ]
    supply(
      [
        decision('sess_orbit', 'req_o', 40_000),
        decision('sess_brobot', 'req_b', 240_000),
        decision('sess_glint', 'req_g', 120_000),
      ],
      new Map(rows.map((row) => [row.key, row])),
    )
    const m = await thePage()
    const order = [...m.host.querySelectorAll<HTMLElement>('.pq-row')].map((row) => row.dataset.cy)
    expect(order).toEqual([
      'persons-queue-row-sess_brobot:req_b',
      'persons-queue-row-sess_glint:req_g',
      'persons-queue-row-sess_orbit:req_o',
    ])
    // One run in one list: each card follows the last, with nothing drawn between them.
    const cards = [...m.host.querySelectorAll<HTMLElement>('.one-card')]
    expect(cards.map((card) => card.querySelector<HTMLElement>('.pq-row')?.dataset.cy)).toEqual(
      order,
    )
    expect(new Set(cards.map((card) => card.parentElement))).toHaveProperty('size', 1)
  })
})

describe('§2 · every choice the card supplies, in its own words', () => {
  it('draws each offered answer once, with the shared permission card’s wording', async () => {
    const row = brobot()
    const m = await thePage()
    const primaries = primariesOf(m, BROBOT)
    expect(primaries.map(label)).toEqual(['Approve', 'Deny'])
    const [first, second] = primaries.map((one) => one.getBoundingClientRect())
    expect(second!.top).toBeGreaterThanOrEqual(first!.top)
    expect(second!.bottom).toBeLessThanOrEqual(
      m.q(`persons-queue-row-${BROBOT}`).getBoundingClientRect().bottom,
    )
    const every = answersOf(m, BROBOT)
    expect(every.map((one) => one.dataset.permissionDecision).sort()).toEqual(
      row.decisions
        .flatMap((one) => (one.kind === 'permission' ? [one.decision.outcome] : []))
        .sort(),
    )
    expect(
      every
        .filter((one) => !primaries.includes(one))
        .map(label)
        .sort(),
    ).toEqual(['Allow for this conversation', 'Cancel turn'])
  })

  it('offers only the two decisions on a request with just approve and deny', async () => {
    const once = fromTheRecord('sess_glint', card('req_once', COMMAND, ['allow', 'deny']))
    supply([decision('sess_glint', 'req_once', 120_000)], new Map([[once.key, once]]))
    const m = await thePage()
    expect(answersOf(m, once.key).map(label)).toEqual(['Approve', 'Deny'])
    expect(
      m.q(`persons-queue-more-${once.key}`).querySelector('summary')?.textContent?.trim(),
    ).toBe('Details')
  })

  it('draws the reason a request cannot be approved and offers only refusals', async () => {
    const cannot = fromTheRecord('sess_orbit', card('req_no', COMMAND, ['deny', 'cancel']))
    supply([decision('sess_orbit', 'req_no', 40_000)], new Map([[cannot.key, cannot]]))
    const m = await thePage()
    expect(answersOf(m, cannot.key).map(label)).toEqual(['Deny', 'Cancel turn'])
    const why = m.q('permission-cannot-allow')
    expect(visible(why)).toBe(true)
    expect(why.textContent?.trim()).toBe(cannot.noPositive)
  })
})

describe('§3 · scope, effects and details', () => {
  it('opens the shared card’s extra details by keyboard', async () => {
    brobot()
    const m = await thePage()
    const card = request(m, BROBOT)
    const after = card.querySelector<HTMLElement>('[data-cy="permission-after"]')!
    const details = after.closest('details')!
    const summary = details.querySelector('summary')!
    expect(details.open).toBe(false)
    expect(visible(after)).toBe(false)
    summary.focus()
    await userEvent.keyboard('{Enter}')
    await nextTick()
    expect(details.open).toBe(true)
    expect(visible(after)).toBe(true)
    const more = m.q(`persons-queue-more-${BROBOT}`) as HTMLDetailsElement
    more.open = true
    await nextTick()
    expect(m.q(`persons-queue-says-${BROBOT}`).innerText).toContain('a person’s to give')
    expect(m.q(`persons-queue-work-${BROBOT}`).innerText.length).toBeGreaterThan(0)
    expect(settled).toEqual([])
  })

  it('keeps the exact grant separate from the command, and visible with the control that grants it', async () => {
    brobot()
    const m = await thePage()
    const detail = detailOf(m, BROBOT)
    expect(detail.textContent?.trim()).toBe(COMMAND)
    const scope = m.q('permission-grant-covers')
    const grant = m.q('permission-allow_for_session')
    expect(visible(scope)).toBe(true)
    expect(visible(grant)).toBe(true)
    expect(scope.innerText).toContain('Bash(npm test:*)')
    expect(grant.querySelector('small')?.textContent).toContain('Bash(npm test:*)')
    expect(scope.compareDocumentPosition(grant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('places the immediate effect on the same answer control', async () => {
    brobot()
    const m = await thePage()
    const allow = m.q('permission-allow')
    const effect = m.q('permission-does-allow')
    expect(effect.closest('button')).toBe(allow)
    expect(effect.textContent?.trim()).toBe('the agent may do this once')
  })
})

describe('§4 · the action in full', () => {
  it('keeps a long command complete and keyboard-scrollable', async () => {
    const long = `${COMMAND} ${'--reporter=verbose '.repeat(38)}`
    brobot(long)
    const m = await thePage(1180)
    await drawnReady()
    const line = detailOf(m, BROBOT)
    expect(line.textContent?.trim()).toBe(long.trim())
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
    expect(cutsOf(line, m.host)).toEqual([])
    expect(line.tabIndex).toBe(0)
    line.focus()
    expect(document.activeElement).toBe(line)
  })

  it('fits a short command without a scrollbar', async () => {
    brobot()
    const m = await thePage(1180)
    await drawnReady()
    const line = detailOf(m, BROBOT)
    expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth)
    expect(clipsOf(line, m.host)).toEqual([])
    assertDrawn(line, 'the short command', m.host)
  })
})

describe('§5 · a helper nobody opened is answered with its own choices', () => {
  it('offers the card’s own answers, and a press settles that row with that answer', async () => {
    const row = brobot()
    const m = await thePage()
    expect(m.all(`persons-queue-take-over-${BROBOT}`)).toEqual([])
    expect(m.all(`persons-queue-no-answer-${BROBOT}`)).toEqual([])
    expect(answersOf(m, BROBOT)).toHaveLength(row.decisions.length)

    primariesOf(m, BROBOT)[0]!.click()
    ;(m.q(`persons-queue-more-${BROBOT}`) as HTMLDetailsElement).open = true
    await nextTick()
    answersOf(m, BROBOT)
      .find((one) => one.dataset.permissionDecision === 'cancel')!
      .click()
    await nextTick()
    expect(settled.map((one) => [one.row.key, one.decision.label])).toEqual([
      [BROBOT, 'Allow'],
      [BROBOT, 'Cancel'],
    ])
  })

  it('…and the control: without the card it offers no answer, and the way to take it over', async () => {
    supply([decision('sess_brobot', 'req_test', 240_000)], new Map())
    const m = await thePage()
    expect(answersOf(m, BROBOT)).toEqual([])
    expect(m.all(`persons-queue-take-over-${BROBOT}`)).toHaveLength(1)
  })
})

describe('§6 · the page’s own words', () => {
  const intro = (m: Mounted): string => m.q('waiting-intro').textContent?.trim() ?? ''

  it('calls a queue of permissions what it is', async () => {
    const rows = [
      fromTheRecord('sess_brobot', card('req_b', COMMAND, ALL_FOUR)),
      fromTheRecord('sess_orbit', card('req_o', 'git diff --stat', ALL_FOUR)),
    ]
    supply(
      [decision('sess_brobot', 'req_b', 240_000), decision('sess_orbit', 'req_o', 40_000)],
      new Map(rows.map((row) => [row.key, row])),
    )
    const m = await thePage()
    expect(intro(m)).toBe('2 requests need your permission.')
  })

  it('…and does not call a mixed queue permissions', async () => {
    brobot()
    const question = literal('sess_glint:req_q', {
      kind: 'question',
      asked: 'Which file should it read first?',
      scope: [],
      actionLines: undefined,
      at: NOW - 60_000,
      decisions: [{ kind: 'reject', label: 'Reject' }],
    })
    const m = await thePage(1180, [question])
    expect(intro(m)).not.toContain('permission')
    expect(intro(m)).toBe('2 things need you.')
  })

  it('…nor a row whose answers this window could not read', async () => {
    supply([decision('sess_brobot', 'req_test', 240_000)], new Map())
    const m = await thePage()
    expect(intro(m)).toBe('1 thing needs you.')
  })

  it('claims nothing in a footer about what cannot run without you', async () => {
    brobot()
    const m = await thePage()
    expect(m.host.textContent).toContain('Waiting on you')
    expect(m.host.textContent).not.toContain('without your explicit action')
    expect(m.host.querySelector('.attention-footer')).toBeNull()
  })
})

describe('§7 · the corner’s copy still fits its 200px band', () => {
  it('stacks the answers in a column inside the band, and cuts none of them', async () => {
    brobot(`${COMMAND} ${'--reporter=verbose '.repeat(14)}`)
    await page.viewport(1180, 808)
    const Layer = defineComponent({
      name: 'OverlayUnderTest',
      setup: () => () =>
        h(
          OverlayHost as Component,
          { label: 'A sheet', onClose: () => {} },
          { default: () => [h('div', 'a sheet')] },
        ),
    })
    const m = mount(Layer, {}, { width: 10, height: 10 })
    await nextTick()
    await drawnReady()
    const card = m.q('persons-queue')
    expect(card.dataset.place).toBe('overlay')
    const band = card.getBoundingClientRect()
    expect(Math.round(band.width)).toBe(200)

    expect(
      getComputedStyle(m.q('permission-allow').closest('.permission-actions')!).flexDirection,
    ).toBe('column')
    const [allow, deny] = primariesOf(m, BROBOT).map((one) => one.getBoundingClientRect())
    expect(deny!.top, 'the corner drew its answers side by side').toBeGreaterThanOrEqual(
      allow!.bottom,
    )
    for (const el of [
      ...primariesOf(m, BROBOT),
      detailOf(m, BROBOT),
      m.q(`persons-queue-go-${BROBOT}`),
      m.q(`persons-queue-more-${BROBOT}`).querySelector<HTMLElement>('summary')!,
    ]) {
      const what = el.textContent ?? ''
      expect(el.getBoundingClientRect().right, what).toBeLessThanOrEqual(band.right + 1)
      expect(cutsOf(el, card), what).toEqual([])
    }
  })
})
