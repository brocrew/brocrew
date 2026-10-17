import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { answerFor, attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  usePersonsQueue,
  type PersonsQueueDoors,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type PermissionItem,
} from '../src/renderer/src/lib/transcript'
import { whatThisAnswerDoes } from '../src/renderer/src/lib/user-input-offer'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
} from '../src/shared/questions'
import { type TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 743 · The last card words — `739` F-1 (ruled), F-7 and F-8
 *
 * ⚑ **The ruling, pasted whole** (the PM, 2026-09-27, on `739` F-1): *"a surface that offers the
 * choices offers ALL of them. Where Always allow is a one-click answer (Home, the person's queue),
 * Allow for this conversation is too. Neither is card-only while the other is not."*
 * ⚑ **F-7**: *"a settled card's `persistence` row shows what WAS granted (Allowed once → once), never
 * the offer's summary (always)."* ⚑ **F-8**: *"the wholesale warning's 'for the rest of this
 * session' says 'for this conversation', matching its button."*
 *
 * | § | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|
 * | 1 | Home's row for a Claude `make build` card (it offers *Always allow* AND the wholesale grant): the grant is a one-click answer, LAST (never the second button, 299 §1), under the card's own warning and with the card's own line; pressed, it sends the wholesale grant | a card that offers no wholesale grant draws none and no warning |
 * | 2 | the person's queue: the same button, warning and line, copied off Home's row | the same control |
 * | 3 | the settled card's `persistence` row: what the answer granted — `once` · `session` · `session` · `always` · `nothing granted` | the pending card still draws the offer's summary, `always` |
 * | 4 | the wholesale warning says *for this conversation*, as its button does | the button's words, unchanged since `739` |
 *
 * ⚑ **The card is `claude-runtime.test.ts`' own `make build` offer** (740 · R99): `allow`,
 * `allow_for_session`, `allow_all_for_session`, `allow_always`, `deny`, `cancel`, `persistence:
 * always`, sent through main's wire (`toWireEvent`) and the window's fold (`acceptEvent`).
 *
 * ⚠️ **Nothing new is imported at collection time**: every expected sentence is a literal, so on
 * `main` (aacc42fe) each subject fails on what `main` draws — Home's four buttons and its *"… is not
 * offered here"* sentence, `always` under *Approved*, *for the rest of this session* — and the
 * controls run.
 */

const AT = 1_700_000_000_000
const FILE_740 = '/tmp/x/.claude/settings.local.json'
const MAKE_BUILD = { kind: 'tool', tool: 'Bash', content: 'make build *' } as const
const MAKE_BUILD_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

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
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [MAKE_BUILD],
        ...(wide ? { allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }] } : {}),
        allow_always: [MAKE_BUILD],
        alwaysFile: FILE_740,
      },
      amendments: [],
      availableDecisions,
      underDisclosed: true,
    },
  }
}

/** ⚑ The make-build offer without the wholesale grant — every control's one fact over. */
const NO_WIDE = MAKE_BUILD_OFFER.filter((one) => one !== 'allow_all_for_session')

/** ⚑ The conversation as the window's store holds it, the card folded through main's wire. */
function recordOf(event: PermissionRequest): SessionRecord {
  const record = createSessionRecord('sess_make')
  record.meta = {
    sessionId: 'sess_make',
    provider: 'claude',
    cwd: '/tmp/x',
    profileId: 'default',
  } as never
  record.phase = 'open'
  acceptEvent(record, {
    sessionId: 'sess_make',
    ordinal: 0,
    at: AT,
    event: toWireEvent('claude', event) satisfies TranscriptEvent,
  })
  return record
}

/** ⚑ The row Home draws, off the real projection. */
function homeRow(event: PermissionRequest): AttentionRequest {
  const rows = attentionQueue([recordOf(event)], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ The card, pending or answered — through main's wire and the fold. */
function cardItem(event: PermissionRequest, outcome?: PermissionOutcome): PermissionItem {
  const state = createTranscript()
  applyEvent(state, toWireEvent('claude', event) satisfies TranscriptEvent, AT)
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

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

/** ⚑ The card, its body open — how a person reads a settled card's record of what they granted. */
const card = (item: PermissionItem): Promise<string> =>
  render(PermissionCard, {
    item,
    provider: 'claude',
    draft: { answers: new Map(), sent: false, answered: false, open: true },
  })

/** ⚑ What a person reads — the templates carry their reasoning inline, as comments. */
const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ⚑ Every text a `data-cy` element holds, decoded, in document order. */
const textsOf = (markup: string, cy: string): string[] =>
  [
    ...shown(markup).matchAll(new RegExp(`data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map((one) => decode(one[1]!.trim()).replace(/\s+/g, ' '))

/** ⚑ The card's warning over the wholesale grant, whole — its reach is set in bold (058). */
const warningOn = (markup: string): string[] =>
  [...shown(markup).matchAll(/data-cy="permission-wide-warning"[^>]*>([\s\S]*?)<\/p>/g)].map(
    (one) =>
      decode(one[1]!.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
  )

/** ⚑ The text a person can read, tags removed and whitespace folded. */
const words = (markup: string): string =>
  decode(shown(markup).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** ⚑ Each button in a markup slice: its word, the warning in it (if any) and the line under it. */
const buttonsIn = (
  markup: string,
  cy: string,
): { word: string; warns: string | null; says: string }[] =>
  [
    ...shown(markup).matchAll(
      new RegExp(`<button[^>]*data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</button>`, 'g'),
    ),
  ].map((one) => {
    const inside = one[1]!
    const tell = (re: RegExp): string | null => {
      const found = re.exec(inside)?.[1]
      return found === undefined ? null : decode(found.trim()).replace(/\s+/g, ' ')
    }
    return {
      word: tell(/<strong[^>]*>([\s\S]*?)<\/strong>/) ?? '',
      warns: tell(/<span[^>]*class="[^"]*warns[^"]*"[^>]*>([\s\S]*?)<\/span>/),
      says: tell(/<small[^>]*>([\s\S]*?)<\/small>/) ?? '',
    }
  })

/** ⚑ The card's own warning over its wholesale grant, and its own line under that button. */
async function theCardsOwn(): Promise<{ warning: string; does: string; label: string }> {
  const html = await card(cardItem(makeBuild()))
  const [warning] = warningOn(html)
  const [does] = textsOf(html, 'permission-does-allow_all_for_session')
  const button = /data-cy="permission-allow_all_for_session"[^>]*>([\s\S]*?)<\/button>/.exec(
    shown(html),
  )?.[1]
  const label = decode(/<strong[^>]*>([\s\S]*?)<\/strong>/.exec(button ?? '')?.[1]?.trim() ?? '')
  if (!warning || !does || !label) throw new Error('the card drew no wholesale grant')
  return { warning, does, label }
}

/** ⚑ F-8's words — the sentence the card, Home and the queue each draw over the wholesale grant. */
const THE_WARNING =
  '⚠ Covers any Bash command for this conversation — not just this one. ' +
  'Nothing will ask again, whatever it runs.'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · Home
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · `739` F-1, ruled — Home offers the conversation’s grant where it offers *Always allow*', () => {
  it('🔴 the wholesale grant is a one-click answer on Home: last, under the card’s warning, with the card’s line — and it sends the wholesale grant', async () => {
    const row = homeRow(makeBuild())
    // ⛔ What `main` draws: *Allow* · *Allow for this conversation* · *Always allow* · *Deny* ·
    // *Cancel*, and *"Allow every Bash call for this conversation is not offered here — …"*.
    expect(row.decisions.map((one) => one.label)).toEqual([
      'Allow',
      'Allow for this conversation',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    // ⚑ 299 §1 still holds: the second button is the conversation's NARROW grant, never this one.
    expect(answerFor(row.decisions[1]!)).toEqual({ permission: { outcome: 'allow_for_session' } })
    const wide = row.decisions.at(-1)!
    expect(answerFor(wide)).toEqual({ permission: { outcome: 'allow_all_for_session' } })
    // ⚑ The card's own words — its button, its warning and the line under it — read off the card.
    const own = await theCardsOwn()
    expect(wide.label).toBe(own.label)
    expect(whatThisAnswerDoes(wide)).toBe(own.does)
    const html = await render(AttentionQueue, { requests: [row], now: AT + 60_000 })
    const buttons = buttonsIn(html, 'attention-decide-sess_make')
    expect(buttons.map((one) => one.word)).toEqual(row.decisions.map((one) => one.label))
    expect(buttons.at(-1)).toEqual({ word: own.label, warns: own.warning, says: own.does })
    expect(own.warning).toBe(THE_WARNING)
    // ⚑ …and the warning is drawn once, inside that button — on no other.
    expect(textsOf(html, 'attention-wide-warning')).toEqual([THE_WARNING])
    expect(buttons.slice(0, -1).map((one) => one.warns)).toEqual([null, null, null, null, null])
    // ⛔ The sentence that said it was not offered here is gone with the reason for it.
    expect(words(html)).not.toContain('is not offered here')
  })

  it('⚑ THE CONTROL — a card that offers no wholesale grant draws none on Home, and no warning', async () => {
    const row = homeRow(makeBuild(NO_WIDE))
    expect(row.decisions.map((one) => one.label)).toEqual([
      'Allow',
      'Allow for this conversation',
      'Always allow',
      'Deny',
      'Cancel',
    ])
    const html = await render(AttentionQueue, { requests: [row], now: AT + 60_000 })
    expect(textsOf(html, 'attention-decide-word')).toEqual(row.decisions.map((one) => one.label))
    expect(html).not.toContain('attention-wide-warning')
    expect(words(html)).not.toContain('Covers any')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · `739` F-1, ruled — the person’s queue offers it too, copied off Home’s row', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  /** ⚑ The decision the host's walk hands the queue — `725`'s shape (`739`'s suite). */
  function decision(request: AttentionRequest): PersonsDecision {
    const reading = decisionReading(request.sessionId, (sessionId) => sessionId)
    return {
      request: {
        requestId: request.requestId,
        askedBy: request.sessionId,
        parent: 'sess_parent',
        went: {
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because: 'a-permission-decision',
        },
        at: AT - 1_000,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
      },
      reading,
      sentence: readingSentence(reading),
      says: 'something only a person can settle',
      work: [],
    }
  }

  const DOORS: PersonsQueueDoors = {
    travel: () => {},
    settle: () => {},
    takeOver: () => {},
    open: () => {},
  }

  function supply(request: AttentionRequest): PersonsQueueRow {
    const walked: LedgerWalk<PersonsDecision> = {
      rows: [decision(request)],
      walk: 'every-conversation-that-routed',
      ledgers: 1,
      rowsUnread: 0,
    }
    const queue = usePersonsQueue()
    queue.supply(
      null,
      walked,
      {
        held: new Set([request.sessionId]),
        answerable: new Map([[request.key, request]]),
        answeredFromHere: new Set<string>(),
        now: AT,
        lastLookAnswered: { questions: true, decisions: true },
      },
      DOORS,
    )
    const row = queue.view.value?.rows.find((one) => one.key === request.key)
    if (row === undefined) throw new Error('the person’s queue drew no row')
    return row
  }

  it('🔴 the queue’s row offers the wholesale grant last, under the card’s warning, with the card’s line', async () => {
    const live = homeRow(makeBuild())
    const row = supply(live)
    const html = await render(PersonsQueue, {})
    const buttons = buttonsIn(html, `persons-queue-answer-${live.key}`)
    // ⛔ What `main` draws: the five answers of the row, and no wholesale grant anywhere. The
    // request's own two come first; the broader choices follow under more options, in the card's
    // order.
    expect(buttons.map((one) => one.word)).toEqual([
      'Allow',
      'Deny',
      'Allow for this conversation',
      'Always allow',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    const own = await theCardsOwn()
    expect(buttons.at(-1)).toEqual({ word: own.label, warns: own.warning, says: own.does })
    expect(textsOf(html, `persons-queue-wide-warning-${live.key}`)).toEqual([THE_WARNING])
    // ⚑ Copied off the live row, never composed here: the same decision, the same payload.
    expect(row.answers.at(-1)).toEqual(live.decisions.at(-1))
    expect(answerFor(row.answers.at(-1)!)).toEqual({
      permission: { outcome: 'allow_all_for_session' },
    })
  })

  it('⚑ THE CONTROL — the queue’s row for a card with no wholesale grant draws none, and no warning', async () => {
    const live = homeRow(makeBuild(NO_WIDE))
    supply(live)
    const html = await render(PersonsQueue, {})
    expect(buttonsIn(html, `persons-queue-answer-${live.key}`).map((one) => one.word)).toEqual([
      'Allow',
      'Deny',
      'Allow for this conversation',
      'Always allow',
      'Cancel',
    ])
    expect(html).not.toContain('persons-queue-wide-warning')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the settled card's persistence
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · `739` F-7 — a settled card’s `persistence` says what the answer granted', () => {
  const persistenceOn = async (outcome?: PermissionOutcome): Promise<string[]> =>
    textsOf(await card(cardItem(makeBuild(), outcome)), 'permission-persistence')

  it('🔴 answered, the row says how long the ANSWER granted for — never the offer’s *always*', async () => {
    // ⛔ What `main` draws: `always` under every one of them — the offer's widest grant.
    expect(await persistenceOn('allow')).toEqual(['once'])
    expect(await persistenceOn('allow_for_session')).toEqual(['session'])
    expect(await persistenceOn('allow_all_for_session')).toEqual(['session'])
    expect(await persistenceOn('deny')).toEqual(['nothing granted'])
    expect(await persistenceOn('cancel')).toEqual(['nothing granted'])
  })

  it('🔴 the verdict and the row agree: *Approved* reads `once`, not `always`', async () => {
    const html = await card(cardItem(makeBuild(), 'allow'))
    expect(textsOf(html, 'permission-verdict')).toEqual(['Approved'])
    expect(textsOf(html, 'permission-persistence')).not.toEqual(['always'])
    expect(textsOf(html, 'permission-persistence')).toEqual(['once'])
  })

  it('🔴 settled by its turn’s end with no answer, it reads `nothing granted`', async () => {
    const state = createTranscript()
    applyEvent(state, toWireEvent('claude', makeBuild()) satisfies TranscriptEvent, AT)
    applyEvent(state, { type: 'turn', state: 'interrupted' } as TranscriptEvent, AT)
    const item = state.items.find((one) => one.kind === 'permission')
    if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
    // ⚑ The premise: the card closed with no answer — a note, and no outcome.
    expect(item.outcome).toBeNull()
    expect(item.note).not.toBeNull()
    // ⛔ What `main` draws: `always`.
    expect(textsOf(await card(item), 'permission-persistence')).toEqual(['nothing granted'])
  })

  it('🔴 F-7’s sibling — answered anything but the conversation’s grant, the card draws no `conversation grant` row', async () => {
    for (const outcome of [
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ] as const) {
      const html = await card(cardItem(makeBuild(), outcome))
      // ⛔ What `main` draws: *for this conversation, its grant covers: …* on every one of them.
      expect(textsOf(html, 'permission-grant-covers'), outcome).toEqual([])
    }
  })

  it('⚑ THE CONTROL — answered with the conversation’s grant, and pending, the row is drawn', async () => {
    for (const outcome of ['allow_for_session', undefined] as const) {
      const html = await card(cardItem(makeBuild(), outcome))
      expect(textsOf(html, 'permission-grant-covers'), String(outcome)).toHaveLength(1)
      expect(textsOf(html, 'permission-grant-covers')[0]).toContain('Bash(make build *)')
    }
  })

  it('⚑ THE CONTROL — pending, the row is the offer’s summary; answered *Always allow*, `always`', async () => {
    expect(await persistenceOn()).toEqual(['always'])
    expect(await persistenceOn('allow_always')).toEqual(['always'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the wholesale warning's span
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · `739` F-8 — the wholesale warning says *for this conversation*, as its button does', () => {
  it('🔴 the card’s warning over the wholesale grant says *for this conversation*', async () => {
    const html = await card(cardItem(makeBuild()))
    // ⛔ What `main` draws: *⚠ Covers any Bash command for the rest of this session — …*.
    expect(warningOn(html)).toEqual([THE_WARNING])
    // ⚑ Its reach in bold, as it was (058).
    expect(shown(html)).toMatch(/<strong[^>]*>any Bash command<\/strong>/)
    expect(words(html)).not.toContain('rest of this session')
  })

  it('🔴 a marked card’s sentence for the grants it withholds says *for the rest of this conversation*', async () => {
    // ⚑ The provider's mark (695 · R36a): no standing grant is offered, and the card says why.
    const marked = {
      ...makeBuild(['allow', 'deny', 'cancel']),
      suppressAlwaysAllowRule: true,
    } as PermissionRequest
    const html = await card(cardItem(marked))
    // ⛔ What `main` draws: *Nothing here allows it for the rest of this session: …*.
    expect(textsOf(html, 'permission-grant-withheld')).toEqual([
      'Nothing here allows it for the rest of this conversation: the provider marked this request ' +
        'as one where a standing permission would allow more than this one action.',
    ])
  })

  it('⚑ THE CONTROL — the same card unmarked says nothing about a withheld grant', async () => {
    const html = await card(cardItem(makeBuild(['allow', 'deny', 'cancel'])))
    expect(html).not.toContain('permission-grant-withheld')
  })

  it('⚑ THE CONTROL — its button already said *for this conversation* (since `739`)', async () => {
    const own = await theCardsOwn()
    expect(own.label).toBe('Allow every Bash call for this conversation')
    expect(own.does).toBe('the agent may do anything of this kind for this conversation')
  })
})
