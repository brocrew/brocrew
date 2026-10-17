import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import {
  answerFor,
  attentionQueue,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type PermissionItem,
  type PermissionOutcome,
} from '../../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 743 · The last card words, DRAWN — `739` F-1 (ruled), F-7 and F-8 where a person reads them
 *
 * ⚑ **The ruling** (the PM, 2026-09-27, on `739` F-1): *"a surface that offers the choices offers
 * ALL of them. Where Always allow is a one-click answer (Home, the person's queue), Allow for this
 * conversation is too. Neither is card-only while the other is not."* ⚑ **F-7**: a settled card's
 * `persistence` row shows what WAS granted. ⚑ **F-8**: the wholesale warning says *for this
 * conversation*, matching its button.
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | Home's row, at the pane's width (972 px) | the wholesale grant is the LAST button, its warning drawn whole inside it between its word and its line | a card with no wholesale grant: five buttons, no warning |
 * | 2 | the settled card, its body open | answered *Approve*, `persistence` reads `once`, drawn | the same card pending reads `always` |
 * | 3 | the pending card | the warning over the wholesale grant says *for this conversation*, drawn whole | its button, which already said so |
 *
 * ⚑ **The card is `claude-runtime.test.ts`' `make build` offer** (740 · R99) — the render twin's
 * (`the-last-card-words.render.test.ts`), which carries the queue's half and the payloads.
 * ⚠️ **Nothing new is imported**: every expected sentence is a literal, so on `main` (aacc42fe) the
 * subjects fail on what `main` draws and the controls run.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900
const CARD_W = 760

const MAKE_BUILD = { kind: 'tool', tool: 'Bash', content: 'make build *' } as const
const MAKE_BUILD_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]
const NO_WIDE = MAKE_BUILD_OFFER.filter((one) => one !== 'allow_all_for_session')

type PermissionRequest = Extract<TranscriptEvent, { type: 'permission_request' }>

function makeBuild(availableDecisions: PermissionOutcome[] = MAKE_BUILD_OFFER): PermissionRequest {
  const wide = availableDecisions.includes('allow_all_for_session')
  return {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail: 'make build',
    scope: {
      cwd: '/Users/person/work/brobot',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [MAKE_BUILD],
        ...(wide ? { allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }] } : {}),
        allow_always: [MAKE_BUILD],
        alwaysFile: '/Users/person/work/brobot/.claude/settings.local.json',
      },
      amendments: [],
      availableDecisions,
      underDisclosed: true,
    },
  }
}

/** ⚑ Home's row for the card, off the real projection over a record the fold built. */
function homeRow(event: PermissionRequest): AttentionRequest {
  const record = createSessionRecord('sess_make')
  record.meta = {
    sessionId: 'sess_make',
    provider: 'claude',
    cwd: '/Users/person/work/brobot',
    profileId: 'default',
  } as never
  record.phase = 'open'
  acceptEvent(record, { sessionId: 'sess_make', ordinal: 0, at: AT, event } as RuntimeEventMessage)
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ The card, pending or answered, through the window's fold. */
function cardItem(event: PermissionRequest, outcome?: PermissionOutcome): PermissionItem {
  const state = createTranscript()
  applyEvent(state, event, AT)
  if (outcome !== undefined) {
    applyEvent(
      state,
      { type: 'user_decision', requestId: event.id, outcome, by: { who: 'a-person' } },
      AT,
    )
  }
  const item = state.items.find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(AttentionQueue, { requests: [row], now: AT + 60_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ The card on its own, at the transcript's measure, its body open. */
async function aCard(item: PermissionItem): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(
    PermissionCard,
    {
      item,
      provider: 'claude',
      draft: { answers: new Map(), sent: false, answered: false, open: true },
    },
    { width: CARD_W },
  )
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const THE_WARNING =
  '⚠ Covers any Bash command for this conversation — not just this one. ' +
  'Nothing will ask again, whatever it runs.'

describe('§1 · `739` F-1, ruled — Home offers the conversation’s grant, under its warning', () => {
  it('🔴 the wholesale grant is Home’s last button, its warning drawn whole inside it', async () => {
    const row = homeRow(makeBuild())
    const m = await home(row)
    const buttons = m.all('attention-decide-sess_make')
    const wordsOn = buttons.map((one) => text(one.querySelector('strong')!))
    // ⛔ What `main` draws: five buttons, and a sentence saying the grant is not offered here.
    expect(wordsOn).toEqual([
      'Allow',
      'Allow for this conversation',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    const wide = buttons.at(-1)!
    const warning = m.q('attention-wide-warning')
    expect(warning.closest('button')).toBe(wide)
    expect(text(warning)).toBe(THE_WARNING)
    expect(text(wide.querySelector('[data-cy="attention-effect"]')!)).toBe(
      'the agent may do anything of this kind for this conversation',
    )
    // ⚑ Its word, then its warning, then the line under it — in the order a person reads them.
    const parts = [...wide.children].map((one) => one.getAttribute('data-cy'))
    expect(parts).toEqual(['attention-decide-word', 'attention-wide-warning', 'attention-effect'])
    for (const el of [wide, warning]) {
      expect(visible(el)).toBe(true)
      assertDrawn(el, 'the conversation’s wholesale grant on Home', m.host)
    }
    // ⚑ Drawn as a WARNING — the colour of the row's other warning — never as the quiet line under it.
    const ink = (el: Element): string => getComputedStyle(el).color
    expect(ink(warning)).toBe(ink(m.q('attention-under-disclosed')))
    expect(ink(warning)).not.toBe(ink(wide.querySelector('[data-cy="attention-effect"]')!))
    expect(m.all('attention-wide-warning')).toHaveLength(1)
    expect(text(m.host)).not.toContain('is not offered here')
    expect(answerFor(row.decisions.at(-1)!)).toEqual({
      permission: { outcome: 'allow_all_for_session' },
    })
  })

  it('🔴 pressed, the grant’s warning dims with the rest of its button', async () => {
    const m = await home({ ...homeRow(makeBuild()), sent: true })
    const wide = m.all('attention-decide-sess_make').at(-1)!
    expect((wide as HTMLButtonElement).disabled).toBe(true)
    const ink = (el: Element): string => getComputedStyle(el).color
    // ⚑ The same faint ink as the button's own word — a dead control never paints a live warning.
    expect(ink(m.q('attention-wide-warning'))).toBe(ink(wide.querySelector('strong')!))
  })

  it('⚑ THE CONTROL — a card with no wholesale grant draws five buttons on Home, and no warning', async () => {
    const m = await home(homeRow(makeBuild(NO_WIDE)))
    expect(m.all('attention-decide-word').map(text)).toEqual([
      'Allow',
      'Allow for this conversation',
      'Always allow',
      'Deny',
      'Cancel',
    ])
    expect(m.all('attention-wide-warning')).toEqual([])
  })
})

describe('§2 · `739` F-7 — the settled card’s `persistence` is what the answer granted', () => {
  it('🔴 answered *Approve*, the open card reads `once` under *Approved* — drawn', async () => {
    const m = await aCard(cardItem(makeBuild(), 'allow'))
    expect(text(m.q('permission-verdict'))).toBe('Approved')
    const row = m.q('permission-persistence')
    // ⛔ What `main` draws: `always`, the offer's widest grant, which nobody pressed.
    expect(text(row)).toBe('once')
    expect(visible(row)).toBe(true)
    assertDrawn(row, 'the settled card’s persistence', m.host)
  })

  it('🔴 answered *Deny*, it reads `nothing granted`', async () => {
    const m = await aCard(cardItem(makeBuild(), 'deny'))
    expect(text(m.q('permission-persistence'))).toBe('nothing granted')
  })

  it('⚑ THE CONTROL — the same card pending reads the offer’s `always`', async () => {
    const m = await aCard(cardItem(makeBuild()))
    expect(text(m.q('permission-persistence'))).toBe('always')
  })
})

describe('§3 · `739` F-8 — the wholesale warning says *for this conversation*', () => {
  it('🔴 the pending card’s warning over the wholesale grant — drawn whole', async () => {
    const m = await aCard(cardItem(makeBuild()))
    const warning = m.q('permission-wide-warning')
    // ⛔ What `main` draws: *… for the rest of this session — not just this one. …*.
    expect(text(warning)).toBe(THE_WARNING)
    expect(visible(warning)).toBe(true)
    assertDrawn(warning, 'the wholesale warning', m.host)
  })

  it('⚑ THE CONTROL — its button already said *for this conversation*', async () => {
    const m = await aCard(cardItem(makeBuild()))
    expect(text(m.q('permission-allow_all_for_session').querySelector('strong')!)).toBe(
      'Allow every Bash call for this conversation',
    )
  })
})
