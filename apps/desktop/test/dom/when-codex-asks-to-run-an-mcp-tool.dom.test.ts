import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
// ⚠️ **The modules, not the package barrel.** `@brobot2/runtime`'s index pulls in the adapters and
// with them `node:fs`, which Vite externalises for the browser — so importing from the barrel takes
// this whole file down at load. These four import nothing but zod and each other.
import {
  codexElicitation,
  codexToolApproval,
  codexToolApprovalDetail,
  externalMcpElicitationPrompt,
} from '../../../../packages/runtime/src/codex/external-mcp'
import { boundPermissionDetail } from '../../../../packages/runtime/src/events'
import { persistenceOf, publishedOffer } from '../../../../packages/runtime/src/permission'
import { wordsForACard } from '../../../../packages/runtime/src/words-on-a-card'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import { permissionDecisionFor, wideGrantLabel } from '../../src/renderer/src/lib/permission-offer'
import * as since730 from '../../src/renderer/src/lib/permission-offer'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type PermissionItem,
  type PermissionOutcome,
} from '../../src/renderer/src/lib/transcript'
import { whatThisAnswerDoes } from '../../src/renderer/src/lib/user-input-offer'
import * as said730 from '../../src/renderer/src/lib/user-input-offer'
import type {
  CreatedSession,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { assertDrawn, clipsOf, describeClip, drawnReady, lineCount } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 730 · Draws 1 and 2, DRAWN — when Codex asks to run an MCP tool, and a Cancel that stops nothing
 *
 * ⚑ **R80** — *"When Codex asks to run an MCP tool, a person sees it. A card naming the server, the
 * tool and the parameters, with Allow once, Allow for this conversation (when Codex offers
 * `session`) and Deny. ⛔ Never *always*."* ⚑ **R81** — *"A card whose press cannot stop the turn
 * does not say it will. Its line says only what the press does: the request is cancelled; the turn
 * is not asked to stop."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | the R80 card, at the transcript's measure (760 px) | who asks, the server, the tool and every parameter drawn whole — a long value WRAPS, never cut; *Allow once* · *Always allow* (R95, drawn since `739`) · *Deny* · *Cancel request* (`736`, R97) in the row, *Allow for this conversation* below it under its warning; *always* said on the card only by R95's own button and the offer's persistence (which summarises it) — never by the conversation's grant | the same card without `mcpToolCall` draws *Approve* and the tool's wholesale grant (`wideGrantLabel` — since `739`'s review *Allow every … call for this conversation*) |
 * | 2 | a Codex conversation | the card names Codex as the one asking — the provider travels `record.meta` → `TranscriptView` → the card | — |
 * | 3 | the R81 card | *Cancel request*, and R81's line drawn under it — since `736` (R97) on the card from a frame that named its turn too | the named-turn card WITHOUT the marker (a row written before `736`): *Cancel turn* and the whole-turn line |
 * | 4 | Home | the MCP row offers *Allow once* · *Always allow* · *Deny* · *Cancel* and — since `743` (`739` F-1, ruled) — *Allow for this conversation* under the card's warning, in R80's words; *always* only on R95's button; the R81 row's Cancel says R81's line | a plain command row: *Allow* where the MCP row says *Allow once*, and the plain sentence |
 *
 * ⚑ **The cards are built by the adapter's own exported composers** — `aToolApprovalCard`'s
 * assembly, which is private. ⚠️ A browser cannot run the host, so
 * `when-codex-asks-to-run-an-mcp-tool.render.test.ts` §0 pins exactly this assembly to the card
 * main's REAL host sends for the same frame: a double that drifted from the adapter goes red there.
 * ⚠️ The adapter folds whitespace in a displayed value (`wordsForACard`), so a multi-line value
 * reaches the card as one long line — that is the value drawn here, with an unbroken link in it.
 *
 * 🔴 **739 re-aimed three pins, in place** (`736` F-1: *"*Always allow* is offered by the runtime
 * and drawn by no surface"*): the card's row and Home's two rows draw R95's *Always allow* now, and
 * R80's *"never always"* is aimed at everything but that button (and the offer's persistence,
 * which summarises it). ⚠️ `codexToolCard()` carries no `scope.grants`, so its *Always allow* line is
 * the one for a card that names no rule — the line WITH the rule and the file is drawn and measured
 * in `always-allow-on-every-surface.dom.test.ts`.
 *
 * ⚠️ **The new exports are read through the modules' namespaces** (`since730`, `said730`): the
 * browser runner links native modules, and a named import of an export `main` does not have would
 * fail the whole file there — controls included. ⚑ So they are called only inside subjects.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const AT = 1_700_000_000_000
/** ⚑ The window: the rail (208) beside a conversation pane (972). */
const WINDOW_W = 1180
const PANE_W = 972
/** ⚑ The transcript's reading measure — `--measure-message`, the width a card is drawn at. */
const MEASURE = 760

/* ------------------------------------------------------------------ the frames Codex sends */

const SERVER = 'github'
const TOOL = 'create_issue'
const TITLE = 'A resumed conversation is drawn as ended'
const BODY =
  'When a conversation is resumed after the app quit, the rail draws it as ended.\n\n' +
  'Steps:\n1. Start a Codex conversation\n2. Quit BroBot while it runs\n3. Launch it again\n\n' +
  `Seen at https://github.com/demo-org/notes-app/issues?q=is%3Aopen+label%3Arail+${'resume-after-quit-'.repeat(12)}`
const PARAMS: Record<string, string> = { repo: 'demo-org/notes-app', title: TITLE, body: BODY }

/** ⚑ Codex's own approval of an MCP tool call, in the measured shape (see the render suite). */
const CODEX_ASKS = {
  serverName: SERVER,
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    tool_description: 'Create a new issue in a GitHub repository',
    tool_params: PARAMS,
    tool_params_display: Object.entries(PARAMS).map(([name, value]) => ({
      name,
      value,
      display_name: name,
    })),
  },
  message: `Allow the ${SERVER} MCP server to run tool "${TOOL}"?`,
  requestedSchema: { type: 'object', properties: {} },
}

/** ⚑ A server's own `url` elicitation — main's own fixture (`a-press-that-stops-nothing-says-so`). */
const A_SERVER_ASKS = {
  serverName: 'kibana',
  mode: 'url',
  _meta: null,
  message: 'Sign in here first.',
  url: 'https://example.invalid/auth',
  elicitationId: 'e1',
}

type PermissionRequest = Extract<TranscriptEvent, { type: 'permission_request' }>

/** ⚑ `aToolApprovalCard`'s assembly, from the exported composers — pinned by the render suite's §0. */
function codexToolCard(): PermissionRequest {
  const approval = codexToolApproval(CODEX_ASKS)
  if (approval === null || approval.tool === null) throw new Error('not Codex’s approval')
  const claimed = { ...approval, tool: approval.tool }
  // ⚑ 736 · R95 — *Always allow* where Codex offers `always`, as `aToolApprovalsPositives` builds it
  // (in the offer; drawn on every surface since `739`). ⚠️ No `scope.grants` here, so its line is
  // the one for a card that names no rule (see the header).
  const offer = publishedOffer([
    'allow',
    ...(approval.offersSession ? (['allow_all_for_session'] as const) : []),
    ...(approval.offersAlways ? (['allow_always'] as const) : []),
  ])
  const summary = wordsForACard(approval.question)
  const tool = wordsForACard(claimed.tool) ?? ''
  return {
    type: 'permission_request',
    id: 'number:60',
    kind: 'command',
    action: tool,
    ...boundPermissionDetail(codexToolApprovalDetail(claimed)),
    ...(summary === null ? {} : { summary }),
    mcpToolCall: {
      server: approval.serverName,
      tool,
      parameters: [...approval.parameters],
      ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),
    },
    // ⚑ 736 · R97 — every elicitation card's Cancel is the provider's cancel and nothing more.
    cancelStopsNothing: true,
    scope: {
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(offer),
      amendments: [],
      availableDecisions: offer,
      underDisclosed: true,
      approvalMode: 'ask',
    },
  }
}

/** ⚑ The same request with no `mcpToolCall` — a plain command card, one fact over. */
function plainCommandCard(): PermissionRequest {
  const { mcpToolCall: _dropped, ...rest } = codexToolCard()
  void _dropped
  return rest
}

/**
 * ⚑ The server's own `url` card. ⚑ 736 · R97 — R81's marker on it whether or not its frame named a
 * turn (until `736` only a turnless frame's); `turnless` still picks the frame and the id.
 */
function serverCard(turnless: boolean): PermissionRequest {
  const elicitation = codexElicitation({ ...A_SERVER_ASKS, turnId: turnless ? null : 'tn_1' })
  if (elicitation === null) throw new Error('not an elicitation')
  const offer = publishedOffer([])
  return {
    type: 'permission_request',
    id: turnless ? 'number:50' : 'number:51',
    kind: 'command',
    action: elicitation.serverName,
    ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
    cancelStopsNothing: true as const,
    scope: {
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(offer),
      amendments: [],
      availableDecisions: offer,
      noPositiveBecause: 'could-not-represent-the-answers',
      underDisclosed: true,
      approvalMode: 'ask',
    },
  }
}

/* ------------------------------------------------------------------ mounting */

/** ⚑ The card the fold makes of one request. */
function folded(event: PermissionRequest): PermissionItem & { at: number } {
  const state = createTranscript()
  applyEvent(state, event, AT)
  const item = state.items.find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return { ...item, at: AT }
}

/**
 * ⚑ **One card at the transcript's measure**, in a window as wide as the app's, laid out as the
 * transcript lays it — a block in a column, so the card takes the whole measure rather than its
 * content's width.
 */
async function aCard(
  event: PermissionRequest,
  provider: 'codex' | null = 'codex',
): Promise<Mounted> {
  await page.viewport(WINDOW_W, 900)
  const m = mount(
    PermissionCard,
    { item: folded(event), provider },
    { width: MEASURE, height: 900 },
  )
  m.host.style.display = 'block'
  await nextTick()
  await drawnReady()
  // ⚑ The whole card in the window — a photograph of this mount shows every button.
  expect(m.q('permission-card').getBoundingClientRect().bottom).toBeLessThanOrEqual(900)
  return m
}

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** ⚑ The pane, frozen on its one card, in a window as wide as the pane plus the rail. */
async function aPane(event: PermissionRequest): Promise<Mounted> {
  await page.viewport(WINDOW_W, 900)
  const record = createSessionRecord(CODEX_META.sessionId)
  record.meta = CODEX_META
  record.phase = 'open'
  applyEvent(record.transcript, event, AT)
  applyEvent(
    record.transcript,
    { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
    AT,
  )
  const m = mount(ConversationPane, paneProps({ record }), { width: PANE_W, height: 900 })
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ Home's row for a request, through the real projection over a record folded by `acceptEvent`. */
function homeRow(event: PermissionRequest): AttentionRequest {
  const record = createSessionRecord('sess_home')
  record.meta = { ...CODEX_META, sessionId: 'sess_home' }
  record.phase = 'open'
  acceptEvent(record, { sessionId: 'sess_home', ordinal: 0, at: AT, event } as RuntimeEventMessage)
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's queue, as wide as the page beside the rail. */
async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(WINDOW_W, 900)
  const m = mount(AttentionQueue, { requests: [row], now: AT + 60_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ `a` ends at or above where `b` begins — read first, top to bottom. */
const above = (a: Element, b: Element): boolean =>
  a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 0.5

/** ⚑ `a` is read before `b`: on an earlier line, or on the same line and to its left. */
const readBefore = (a: Element, b: Element): boolean => {
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  return ra.bottom <= rb.top + 0.5 || (ra.top < rb.bottom && ra.right <= rb.left + 0.5)
}

/**
 * ⚑ **739 · an element's text without the parts that carry R95's *always*** — the *Always allow*
 * button and the offer's `persistence` — read off a CLONE, so what is drawn is untouched.
 */
const textWithoutR95 = (el: Element): string => {
  const copy = el.cloneNode(true) as Element
  for (const r95 of copy.querySelectorAll(
    '[data-cy="permission-allow_always"], [data-cy="permission-persistence"]',
  ))
    r95.remove()
  for (const word of copy.querySelectorAll('[data-cy="attention-decide-word"]'))
    if (text(word) === 'Always allow') word.closest('button')?.remove()
  return text(copy)
}

/** ⚑ The word on a card's button — its `<strong>`. */
const wordOf = (button: HTMLElement): string => text(button.querySelector('strong')!)

/** ⚑ Every clip of any reach — a value a person has to SCROLL sideways to read is not wrapped. */
const everyClip = (el: HTMLElement, m: Mounted): string[] => clipsOf(el, m.host).map(describeClip)

const plainCancel = (outcome: PermissionOutcome = 'cancel'): string =>
  whatThisAnswerDoes({
    kind: 'permission',
    label: outcome,
    decision: permissionDecisionFor(outcome),
  })

/* ------------------------------------------------------------------ §1 · the R80 card */

describe('§1 · R80 — the card Codex raises before an MCP tool runs, at the transcript’s measure', () => {
  it('🔴 who asks, the server, the tool and every parameter are drawn whole — the long value wraps inside the card and is never cut', async () => {
    const m = await aCard(codexToolCard())
    // ⛔ What `main` draws: none of these — no list at all.
    const asker = m.all('permission-mcp-asker')
    expect(asker.map(text), 'no line saying who asks').toEqual(['Codex asks to run an MCP tool'])
    expect(text(asker[0]!)).toBe(since730.mcpToolAsker('codex'))
    const facts = [
      asker[0]!,
      m.q('permission-mcp-server'),
      m.q('permission-mcp-tool'),
      ...m.all('permission-mcp-parameter-name'),
      ...m.all('permission-mcp-parameter-value'),
    ]
    expect(text(m.q('permission-mcp-server'))).toBe(SERVER)
    expect(text(m.q('permission-mcp-tool'))).toBe(TOOL)
    expect(m.all('permission-mcp-parameter-name').map(text)).toEqual(['repo', 'title', 'body'])
    const values = m.all('permission-mcp-parameter-value')
    expect(values.map(text)).toEqual(['demo-org/notes-app', TITLE, wordsForACard(BODY)])
    for (const fact of facts) {
      expect(visible(fact), text(fact)).toBe(true)
      assertDrawn(fact, `the MCP fact “${text(fact).slice(0, 40)}”`, m.host)
    }
    // ⚑ The long one — a paragraph and an unbroken link — WRAPS: several lines, nothing past any
    // edge, not even one a person could scroll to.
    const body = values[2]!
    const card = m.q('permission-card').getBoundingClientRect()
    expect(card.width).toBeGreaterThan(MEASURE - 1)
    // Text wrapping and its resulting edge depend on the Mac font used for this fit measurement.
    if (/mac/i.test(navigator.platform)) {
      expect(lineCount(body)).toBeGreaterThan(1)
      expect(everyClip(body, m)).toEqual([])
      expect(body.getBoundingClientRect().right).toBeLessThanOrEqual(card.right + 0.5)
    }
    // ⚑ Beside the disclosure and read before it — the block is still the whole call.
    expect(above(m.q('permission-mcp-call'), m.q('permission-detail'))).toBe(true)
    expect(text(m.q('permission-detail'))).toBe(
      `${TOOL} ${JSON.stringify(PARAMS)}`.replace(/\s+/g, ' '),
    )
  })

  // ⚑ **736 · the Cancel re-aimed, the persistence flipped**: this card is BUILT here, so R97's marker
  // arrives with the builder and its drawing is `main`'s (that the adapter now SENDS it is RED on
  // `main` in the render twin's §0); the persistence row drawn from the buttons is new, and RED there.
  it('🔴 *Allow once* · *Always allow* (739) · *Deny* · *Cancel request* are drawn in that order, *Allow for this conversation* below them under its warning, and the persistence drawn is the buttons’ (736)', async () => {
    const m = await aCard(codexToolCard())
    // 🔴 739 · re-aimed — R95's *Always allow* was in the card's offer and drawn by no surface
    // (`736` F-1); since `739` it is in the row, after *Allow once* and before the refusals.
    const row = (['allow', 'allow_always', 'deny', 'cancel'] as const).map((outcome) =>
      m.q(`permission-${outcome}`),
    )
    // ⛔ What `main` draws: *Approve*. ⛔ And until `736`: *Cancel turn* (R74's stop, which R97 took
    // away).
    expect(wordOf(row[0]!)).not.toBe('Approve')
    expect(row.map(wordOf)).toEqual(['Allow once', 'Always allow', 'Deny', 'Cancel request'])
    expect(m.all('permission-allow_always')).toHaveLength(1)
    expect(wordOf(row[0]!)).toBe(since730.ALLOW_ONCE)
    for (const button of row) {
      expect(visible(button), wordOf(button)).toBe(true)
      assertDrawn(button.querySelector('strong')!, `the word on ${wordOf(button)}`, m.host)
    }
    expect(readBefore(row[0]!, row[1]!)).toBe(true)
    expect(readBefore(row[1]!, row[2]!)).toBe(true)
    expect(readBefore(row[2]!, row[3]!)).toBe(true)
    // ⚑ The wide grant, apart: its warning below the row, the button below the warning.
    const warning = m.q('permission-wide-warning')
    const wide = m.q('permission-allow_all_for_session')
    expect(wordOf(wide)).toBe('Allow for this conversation')
    expect(wordOf(wide)).toBe(since730.ALLOW_FOR_THIS_CONVERSATION)
    expect(text(warning)).toBe(since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'))
    for (const el of [warning, wide]) {
      expect(visible(el)).toBe(true)
      assertDrawn(el, 'the conversation’s grant', m.host)
    }
    for (const button of row) expect(above(button, warning), wordOf(button)).toBe(true)
    expect(above(warning, wide)).toBe(true)
    // ⚑ **The CONVERSATION's grant never says *always*** — its warning and its button — and nothing
    // on the card does but R95's own button and the offer's persistence (🔴 739 · re-aimed).
    const card = m.q('permission-card')
    expect(text(warning)).not.toMatch(/always/i)
    expect(wordOf(wide)).not.toMatch(/always/i)
    expect(textWithoutR95(card)).not.toMatch(/always/i)
    expect(text(card)).toMatch(/always/i)
    // ⚑ …the persistence it draws being that of the buttons drawn — since `739` the offer's own
    // `always`, beside the *Always allow* that makes it true.
    expect(text(m.q('permission-persistence'))).toBe('always')
    expect(text(card.querySelector('.kind')!)).toBe(since730.MCP_TOOL_KIND)
  })

  // ⚑ 739 review · retitled — it named *"Always allow … this session"*, the wholesale grant's words
  // until the review moved them off *always*; the control reads them by `wideGrantLabel`, as it did.
  it('⚑ THE CONTROL — the same request without `mcpToolCall` is a plain command card: *Approve*, and the tool’s wholesale grant in `wideGrantLabel`’s words', async () => {
    const m = await aCard(plainCommandCard())
    expect(m.all('permission-mcp-call')).toEqual([])
    expect(wordOf(m.q('permission-allow'))).toBe('Approve')
    // ⚑ 736 · R97 — the same elicitation request, so its Cancel is still the request's alone.
    expect(wordOf(m.q('permission-cancel'))).toBe('Cancel request')
    const wide = m.q('permission-allow_all_for_session')
    expect(wordOf(wide)).toBe(wideGrantLabel(TOOL))
    expect(visible(wide)).toBe(true)
    expect(text(m.q('permission-wide-warning'))).toContain(`Covers any ${TOOL} command`)
    expect(text(m.q('permission-card').querySelector('.kind')!)).toBe('command')
  })
})

/* ------------------------------------------------------------------ §2 · the hop */

describe('§2 · in a Codex conversation, the card names Codex as the one asking', () => {
  it('🔴 the provider travels from the conversation to the card: *Codex asks to run an MCP tool*, drawn in the pane', async () => {
    const m = await aPane(codexToolCard())
    const asker = m.all('permission-mcp-asker')
    expect(asker.map(text), 'no line saying who asks').toEqual(['Codex asks to run an MCP tool'])
    expect(visible(asker[0]!)).toBe(true)
    assertDrawn(asker[0]!, 'who asks', m.host)
    // ⚑ …on the card the pane really drew, at the pane's own measure.
    expect(m.q('permission-card').getBoundingClientRect().width).toBeLessThanOrEqual(MEASURE + 0.5)
    expect(text(m.q('permission-mcp-server'))).toBe(SERVER)
  })
})

/* ------------------------------------------------------------------ §3 · the R81 card */

describe('§3 · R81 — the Cancel that cannot stop the turn says so, under its word', () => {
  it('🔴 *Cancel request*, and under it only what the press does — drawn whole; no *whole turn* on the card', async () => {
    const m = await aCard(serverCard(true))
    const cancel = m.q('permission-cancel')
    const line = m.q('permission-does-cancel')
    // ⛔ What `main` draws: *Cancel turn* over the whole-turn line.
    expect(text(m.q('permission-card'))).not.toContain('whole turn')
    expect(wordOf(cancel)).toBe('Cancel request')
    expect(wordOf(cancel)).toBe(since730.CANCEL_REQUEST)
    expect(text(line)).toBe(
      'the request is cancelled and the turn runs on — it is not asked to stop',
    )
    expect(text(line)).toBe(said730.CANCEL_STOPS_NOTHING)
    expect(cancel.contains(line)).toBe(true)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'R81’s line under Cancel request', m.host)
    expect(above(cancel.querySelector('strong')!, line)).toBe(true)
  })

  // ⚑ 736 · re-aimed, not flipped — the builder carries R97's marker (see §1's note).
  it('⚑ 736 · R97 — the same card from a frame that NAMED its turn says the same: *Cancel request*, and R81’s line', async () => {
    // ⛔ On `main` (`720`, R74): *Cancel turn* and the whole-turn line — this app asked that turn to
    // stop. R97: *"BroBot adds no stop of its own to a Cancel."*
    const m = await aCard(serverCard(false))
    const cancel = m.q('permission-cancel')
    expect(wordOf(cancel)).toBe('Cancel request')
    expect(text(m.q('permission-does-cancel'))).toBe(said730.CANCEL_STOPS_NOTHING)
    expect(visible(m.q('permission-does-cancel'))).toBe(true)
  })

  it('⚑ THE CONTROL — the same named-turn card WITHOUT the marker (a row written before `736`) draws *Cancel turn* and the whole-turn line', async () => {
    // ⚑ `736`'s review: every builder here carries the marker now, so without this no DOM test drew
    // the whole-turn line — and the R81 negatives above would pass on a card that could never say it.
    const unmarked = Object.fromEntries(
      Object.entries(serverCard(false)).filter(([key]) => key !== 'cancelStopsNothing'),
    ) as PermissionRequest
    const m = await aCard(unmarked)
    expect(wordOf(m.q('permission-cancel'))).toBe('Cancel turn')
    expect(text(m.q('permission-does-cancel'))).toBe(plainCancel())
    expect(visible(m.q('permission-does-cancel'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ §4 · Home */

describe('§4 · Home — the same requests, in the same words', () => {
  // 🔴 743 · re-aimed — `739` F-1, ruled by the PM: *"Where Always allow is a one-click answer
  // (Home, the person's queue), Allow for this conversation is too."* It pinned the sentence saying
  // the grant was not offered here.
  it('🔴 the MCP row offers *Allow once*, and the grant — the tool, the server — under the card’s warning', async () => {
    const event = codexToolCard()
    const m = await home(homeRow(event))
    const words = m.all('attention-decide-word')
    // ⛔ What `main` draws: *Allow once* · *Always allow* · *Deny* · *Cancel*, and a sentence saying
    // the conversation's grant is not offered here.
    expect(words.map(text)).not.toContain('Allow')
    expect(words.map(text)).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    for (const word of words) expect(visible(word), text(word)).toBe(true)
    const warning = m.q('attention-wide-warning')
    expect(text(warning)).toBe(since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'))
    expect(text(warning)).toContain(`every call to ${TOOL} on ${SERVER}`)
    expect(visible(warning)).toBe(true)
    assertDrawn(warning, 'the conversation’s grant, warned of', m.host)
    // ⚑ Inside the grant's own button, between its word and the line under it.
    const button = warning.closest('button')!
    expect(text(button.querySelector('strong')!)).toBe('Allow for this conversation')
    expect(text(button.querySelector('[data-cy="attention-effect"]')!)).toBe(
      `the agent may call ${TOOL} on ${SERVER}, whatever it is given, for this conversation`,
    )
    // 🔴 739 · re-aimed — R95's own button says *always*; nothing else on the row does (R80).
    expect(textWithoutR95(m.q('attention-request-sess_home'))).not.toMatch(/always/i)
    expect(text(m.q('attention-request-sess_home'))).toMatch(/always/i)
  })

  it('⚑ THE CONTROL — a plain command row keeps *Allow* and the old sentence', async () => {
    const m = await home(homeRow(plainCommandCard()))
    // 🔴 739 · re-aimed — the same offer's *Always allow* is on this row as on the MCP row (§4's
    // subject pins that row exactly); ⚑ one field over, only the Allow's word moves.
    // 🔴 743 · re-aimed — and the conversation's grant, after the row since `739` F-1 was ruled,
    // in the plain card's words (R80's are the MCP card's alone).
    const asPlain = homeRow(codexToolCard()).decisions.map((one) =>
      one.label === 'Allow once'
        ? 'Allow'
        : one.label === 'Allow for this conversation'
          ? wideGrantLabel(TOOL)
          : one.label,
    )
    expect(m.all('attention-decide-word').map(text)).toEqual(asPlain)
    expect(text(m.all('attention-decide-word')[0]!)).toBe('Allow')
    // 🔴 743 · re-aimed — the plain grant's warning, not the MCP one (it pinned the old sentence).
    expect(text(m.q('attention-wide-warning'))).toBe(
      `⚠ Covers any ${TOOL} command for this conversation — not just this one. ` +
        `Nothing will ask again, whatever it runs.`,
    )
  })

  it('🔴 the R81 row’s Cancel says only what the press does — drawn under it, whole', async () => {
    const m = await home(homeRow(serverCard(true)))
    const buttons = m.all('attention-decide-sess_home')
    expect(buttons.map((one) => text(one.querySelector('strong')!))).toEqual(['Deny', 'Cancel'])
    const line = buttons[1]!.querySelector<HTMLElement>('[data-cy="attention-effect"]')!
    // ⛔ What `main` draws: the whole-turn line.
    expect(text(line)).not.toBe(plainCancel())
    expect(text(line)).toBe(said730.CANCEL_STOPS_NOTHING)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'R81’s line on Home', m.host)
    expect(text(m.q('attention-request-sess_home'))).not.toContain('whole turn')
  })

  // ⚑ 736 · re-aimed, not flipped — the builder carries R97's marker (see §1's note).
  it('⚑ 736 · R97 — the row for the card that named its turn says R81’s line too', async () => {
    // ⛔ On `main` (`720`, R74): the whole-turn line.
    const m = await home(homeRow(serverCard(false)))
    const buttons = m.all('attention-decide-sess_home')
    const line = buttons[1]!.querySelector<HTMLElement>('[data-cy="attention-effect"]')!
    expect(text(line)).toBe(said730.CANCEL_STOPS_NOTHING)
    expect(visible(line)).toBe(true)
  })
})
