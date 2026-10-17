import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
// ⚠️ **The modules, not the package barrel** — `@brobot2/runtime`'s index pulls in `node:fs`, which
// Vite externalises for the browser (`when-codex-asks-to-run-an-mcp-tool.dom.test.ts`).
import {
  codexToolApproval,
  codexToolApprovalDetail,
} from '../../../../packages/runtime/src/codex/external-mcp'
import { boundPermissionDetail } from '../../../../packages/runtime/src/events'
import { persistenceOf, publishedOffer } from '../../../../packages/runtime/src/permission'
import { wordsForACard } from '../../../../packages/runtime/src/words-on-a-card'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import * as since739 from '../../src/renderer/src/lib/permission-offer'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { markAnswerRefused } from '../../src/renderer/src/lib/transcript'
import type {
  CreatedSession,
  PermissionDecision,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from '../lib/the-wire'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 739 · Draw 1 (the button) and `737` F-5, DRAWN — *Always allow* where a person reads it
 *
 * ⚑ **The finding, verbatim** (`736` §12 F-1): *"⚠️ **F-1 · *Always allow* is offered by the
 * runtime and drawn by no surface.** … give it words from `scope.grants.allow_always` +
 * `alwaysFile`"*; **F-6**: *"A failed keep is refused `not-usable`, and the host words every
 * `not-usable` as the empty-answer sentence."*; ⚑ **`737` F-5**: *"Codex's own MCP card reads back
 * *Approved* after *Allow once*."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | Codex's MCP card, pending, in a conversation at 972 px | *Allow once* · *Always allow* · *Deny* · *Cancel request* in reading order; the line under *Always allow* (the rule and the whole file path) and the `kept grant` row drawn whole | the card Codex offered no `always`: no *Always allow*, no `kept grant` row |
 * | 2 | the press, through the pane | *Always allow* emits the plain `{outcome:'allow_always'}` and the wire carries it | *Allow once* emits `{outcome:'allow'}` |
 * | 3 | Home's row, at 972 px | *Always allow* with the card's own line, and the kept line, drawn whole; a failed keep's reason drawn whole on the row | the row for the card with no `always`; a row nobody refused draws no reason |
 * | 4 | the settled card, in the conversation | Codex's MCP card answered *Allow once* reads *Allowed once* | the same request without `mcpToolCall` reads *Approved* |
 * | 5 | the paint (review, findings 14 and 19) | *Always allow* is drawn OUTLINED — `approve-quiet`, an empty fill inside a drawn border — on the MCP card and on the always-only command card | the plain answer on the same card (*Allow once*) is the FILLED `approve` |
 *
 * ⚑ **The card is built by the adapter's exported composers** — `aToolApprovalCard`'s assembly,
 * with the rule each standing button installs and the file *Always allow* is kept in, exactly as
 * `when-codex-asks-to-run-an-mcp-tool.render.test.ts`' `composedToolCard`, which §0 there pins to
 * the card main's REAL host sends. ⚠️ The file is a realistic app path (a provider home under the
 * app's own folder, a space in it), so the line is drawn at the length a person meets it.
 * ⚑ Mounted through `ConversationPane` over a record every row reached by `acceptEvent`, at the
 * width a conversation is drawn at beside the rail (1180 − 208 = 972 px), and left mounted until
 * the test ends (the lead photographs these mounts).
 *
 * ⚠️ **What `main` (5f406f2f) draws instead, measured**: *Allow once* · *Deny* · *Cancel request*
 * and no `kept grant` row; on Home *Allow once* · *Deny* · *Cancel* and no refusal line; the settled
 * card *Approved*; and no *Always allow* to paint. ⚠️ **The new exports** (`ALWAYS_ALLOW`, `ALLOWED_ONCE`, `keptGrantOf`,
 * `keptGrantSaid`) are read through the module's namespace ({@link since739}), only inside
 * subjects: a namespace import of a module `main` has resolves there, and a missing member is
 * `undefined`, so a subject fails on what `main` draws and the controls still run. The SSR half —
 * main's own host, every surface — is `test/always-allow-on-every-surface.render.test.ts`.
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

/* ------------------------------------------------------------------ the frame Codex sends */

const SERVER = 'github'
const TOOL = 'create_issue'
const PARAMS: Record<string, string> = {
  repo: 'demo-org/notes-app',
  title: 'A resumed conversation is drawn as ended',
}

/** ⚑ A provider home as the app makes one — under its own folder, with a space in the path. */
const HOME =
  '/Users/person/Library/Application Support/@brobot2/desktop/provider-homes/default/codex'
/** ⚑ Where Codex's MCP *Always allow* is kept — `keptToolApprovalsFile(home)`, typed (see below). */
const KEPT_FILE = `${HOME}/brobot-kept-tool-approvals.json`

/** ⚑ Codex's own approval of an MCP tool call, in the measured shape (see the render suite). */
const codexAsks = (persist: readonly string[]): Record<string, unknown> => ({
  serverName: SERVER,
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist,
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
})

type PermissionRequest = Extract<TranscriptEvent, { type: 'permission_request' }>

/**
 * ⚑ **`aToolApprovalCard`'s assembly, from the exported composers** — the render twin's
 * `composedToolCard`, which its §0 pins to main's host: R95's *Always allow* where Codex offers
 * `always`, the rule each standing button installs, and the file it is kept in. ⚠️ The file name is
 * typed, not imported: `kept-tool-approvals.ts` reaches `node:fs`, which a browser cannot load.
 */
function codexToolCard(persist: readonly string[] = ['session', 'always']): PermissionRequest {
  const approval = codexToolApproval(codexAsks(persist))
  if (approval === null || approval.tool === null) throw new Error('not Codex’s approval')
  const claimed = { ...approval, tool: approval.tool }
  const offer = publishedOffer([
    'allow',
    ...(approval.offersSession ? (['allow_all_for_session'] as const) : []),
    ...(approval.offersAlways ? (['allow_always'] as const) : []),
  ])
  const summary = wordsForACard(approval.question)
  const tool = wordsForACard(claimed.tool) ?? ''
  const rule = { kind: 'tool' as const, tool, server: approval.serverName }
  const grants = {
    ...(approval.offersSession ? { allow_all_for_session: [rule] } : {}),
    ...(approval.offersAlways ? { allow_always: [rule], alwaysFile: KEPT_FILE } : {}),
  }
  return {
    type: 'permission_request',
    id: 'number:60',
    kind: 'command',
    action: tool,
    ...boundPermissionDetail(codexToolApprovalDetail(claimed)),
    ...(summary === null ? {} : { summary }),
    cancelStopsNothing: true,
    mcpToolCall: {
      server: approval.serverName,
      tool,
      parameters: [...approval.parameters],
      ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),
    },
    scope: {
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(offer),
      ...(Object.keys(grants).length === 0 ? {} : { grants }),
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

/** ⚑ Codex's prefix rule, as it offers it (the render twin's `PREFIX`). */
const PREFIX = ['/usr/bin/touch', 'x']

/**
 * ⚑ **A Codex command whose ONLY accept is its prefix rule** — R95's `allow_always`, in the scope
 * the render twin's §0 reads off main's REAL host (the offer, the rule, `rules/default.rules`, the
 * `exec` amendment); `action` and `detail` are the command, as the adapter names an exec card.
 */
function alwaysOnlyCommandCard(): PermissionRequest {
  const offer = publishedOffer(['allow_always'])
  return {
    type: 'permission_request',
    id: 'number:70',
    kind: 'command',
    action: PREFIX.join(' '),
    detail: PREFIX.join(' '),
    scope: {
      cwd: '/work',
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(offer),
      grants: {
        allow_always: [{ kind: 'command-prefix', prefix: PREFIX }],
        alwaysFile: `${HOME}/rules/default.rules`,
      },
      amendments: [{ kind: 'exec', detail: PREFIX.join(' ') }],
      availableDecisions: offer,
      underDisclosed: true,
      approvalMode: 'ask',
    },
  }
}

/* ------------------------------------------------------------------ the words, verbatim ONCE */

/**
 * ⚑ The line under *Always allow* — the rule and then the whole file, as the wire names them.
 * 🔴 **739 review · re-aimed — rule first** (it read *"…, in <file> — <rule>"*): the path is long,
 * and what is kept is what a person weighs.
 */
const THE_LINE = `the agent may do this, and the provider’s own rule for it is kept beyond this conversation: every ${TOOL} call on ${SERVER}, in ${KEPT_FILE}`
/** ⚑ The `kept grant` row, and Home's scope line. */
const THE_KEPT_ROW = `beyond this conversation, its grant keeps: every ${TOOL} call on ${SERVER} — in ${KEPT_FILE}`
/**
 * ⚑ `740`'s host sentence for a failed keep — on `main` since 5f406f2f, and read off main's own host
 * in the render twin's §0 — data the row must draw verbatim.
 */
const NOT_KEPT_740 =
  '“always” could not be kept, so nothing was sent — this request is still waiting'

/* ------------------------------------------------------------------ mounting */

/** ⚑ A Codex conversation — the host's echo of its provider and its home on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: HOME,
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** ⚑ Each row through the one door, at the next ordinal — as the store feeds a live record. */
function conversation(sessionId: string, ...events: TranscriptEvent[]): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = { ...CODEX_META, sessionId }
  record.phase = 'open'
  for (const event of events) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, {
      sessionId,
      ordinal,
      at: AT + ordinal * 1_000,
      event,
    } as RuntimeEventMessage)
  }
  return record
}

const waiting = { type: 'status', state: 'waiting_permission' } as TranscriptEvent
const answered = (outcome: PermissionDecision['outcome']): TranscriptEvent => ({
  type: 'user_decision',
  requestId: 'number:60',
  outcome,
  by: { who: 'a-person' },
})

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(record: SessionRecord, over: Record<string, unknown> = {}): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work', ...over }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ Home's row for a record, through the real projection. */
function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's queue, as wide as the page beside the rail. */
async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(AttentionQueue, { requests: [row], now: AT + 60_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The word on a card's button — its `<strong>`. */
const wordOf = (button: HTMLElement): string => text(button.querySelector('strong')!)

/** ⚑ `a` is read before `b`: on an earlier line, or on the same line and to its left. */
const readBefore = (a: Element, b: Element): boolean => {
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  return ra.bottom <= rb.top + 0.5 || (ra.top < rb.bottom && ra.right <= rb.left + 0.5)
}

/** ⚑ Brought on screen the way a person does — scrolled to — then measured. */
async function onScreen(el: HTMLElement): Promise<HTMLElement> {
  el.scrollIntoView({ block: 'nearest' })
  await drawnReady()
  return el
}

/* ------------------------------------------------------------------ §1 · the card */

describe('§1 · Codex’s MCP card, pending in a conversation at 972 px', () => {
  it('🔴 *Allow once* · *Always allow* · *Deny* · *Cancel request* in reading order — the line under *Always allow* and the `kept grant` row drawn whole, the file path whole', async () => {
    const m = await pane(conversation('sess_1', codexToolCard(), waiting))
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel request* — no *Always allow*.
    const always = m.q('permission-allow_always')
    const row = [m.q('permission-allow'), always, m.q('permission-deny'), m.q('permission-cancel')]
    expect(row.map(wordOf)).toEqual(['Allow once', 'Always allow', 'Deny', 'Cancel request'])
    expect(wordOf(always)).toBe(since739.ALWAYS_ALLOW)
    for (let i = 1; i < row.length; i++) expect(readBefore(row[i - 1]!, row[i]!)).toBe(true)
    // ⚑ The line under it: the rule AND the file, and every character of both drawn.
    const line = await onScreen(m.q('permission-does-allow_always'))
    expect(always.contains(line)).toBe(true)
    expect(text(line)).toBe(THE_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the line under Always allow', m.host)
    assertDrawn(always.querySelector('strong')!, 'the word Always allow', m.host)
    // ⚑ The disclosure row — what is kept beyond this conversation, and where.
    const kept = await onScreen(m.q('permission-always-keeps'))
    expect(text(kept)).toBe(THE_KEPT_ROW)
    expect(text(kept)).toBe(
      since739.keptGrantSaid(since739.keptGrantOf(codexToolCard().scope)) ?? '',
    )
    expect(visible(kept)).toBe(true)
    assertDrawn(kept, 'the kept grant row', m.host)
    // ⚑ …inside the card the pane really drew, at the transcript's measure.
    const card = m.q('permission-card').getBoundingClientRect()
    expect(kept.getBoundingClientRect().right).toBeLessThanOrEqual(card.right + 0.5)
    expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(card.right + 0.5)
  })

  it('⚑ THE CONTROL — the card Codex offered no `always`: no *Always allow*, no `kept grant` row, the rest of its row drawn', async () => {
    const m = await pane(conversation('sess_1', codexToolCard(['session']), waiting))
    expect(m.all('permission-allow_always')).toEqual([])
    expect(m.all('permission-always-keeps')).toEqual([])
    expect(
      [m.q('permission-allow'), m.q('permission-deny'), m.q('permission-cancel')].map(wordOf),
    ).toEqual(['Allow once', 'Deny', 'Cancel request'])
    expect(visible(m.q('permission-allow'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ §2 · the press */

describe('§2 · the press, through the conversation', () => {
  /** ⚑ The pane with a listener on its `decide` — the hop the app's screen listens on. */
  async function pressIn(outcome: 'allow' | 'allow_always'): Promise<PermissionDecision[]> {
    const decided: PermissionDecision[] = []
    const m = await pane(conversation('sess_1', codexToolCard(), waiting), {
      onDecide: (_requestId: string, decision: PermissionDecision) => decided.push(decision),
    })
    m.q(`permission-${outcome}`).click()
    await nextTick()
    return decided
  }

  it('🔴 *Always allow* emits the plain `{outcome: allow_always}` — and the wire carries it', async () => {
    // ⛔ What `main` draws: no *Always allow* to press.
    const decided = await pressIn('allow_always')
    expect(decided).toEqual([{ outcome: 'allow_always' }])
    expect(asTheWireWouldCarry('739 · Always allow from the card', decided[0])).toEqual({
      outcome: 'allow_always',
    })
  })

  it('⚑ THE CONTROL — *Allow once* emits its own plain outcome', async () => {
    const decided = await pressIn('allow')
    expect(decided).toEqual([{ outcome: 'allow' }])
    expect(asTheWireWouldCarry('739 · Allow once from the card', decided[0])).toEqual({
      outcome: 'allow',
    })
  })
})

/* ------------------------------------------------------------------ §3 · Home */

describe('§3 · Home’s row, at 972 px', () => {
  it('🔴 *Always allow* with the card’s own line, and the kept line in the scope — each drawn whole', async () => {
    const m = await home(homeRow(conversation('sess_home', codexToolCard(), waiting)))
    const buttons = m.all('attention-decide-sess_home')
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel*. 🔴 743 · re-aimed — since `739` F-1 was
    // ruled, the conversation's grant follows the row here too.
    expect(buttons.map(wordOf)).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    const line = buttons[1]!.querySelector<HTMLElement>('[data-cy="attention-effect"]')!
    expect(text(line)).toBe(THE_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the line under Always allow on Home', m.host)
    const kept = [...m.q('attention-scope').querySelectorAll('li')].find(
      (li) => text(li) === THE_KEPT_ROW,
    )
    expect(kept, 'Home says nothing of what is kept').toBeDefined()
    expect(visible(kept!)).toBe(true)
    assertDrawn(kept!, 'the kept line on Home', m.host)
  })

  it('⚑ THE CONTROL — the row for the card Codex offered no `always` keeps its three answers', async () => {
    const m = await home(homeRow(conversation('sess_home', codexToolCard(['session']), waiting)))
    // 🔴 743 · re-aimed — the conversation's grant follows the row (`739` F-1, ruled).
    expect(m.all('attention-decide-sess_home').map(wordOf)).toEqual([
      'Allow once',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(text(m.q('attention-scope'))).not.toContain('beyond this conversation')
  })

  it('🔴 `736` F-6 — a failed keep’s reason is drawn whole on the row it was pressed from, above its buttons', async () => {
    const record = conversation('sess_home', codexToolCard(), waiting)
    // ⚑ Marked as the store marks a refusal the request survived (`noteAnswer`) — the host's words.
    markAnswerRefused(record.transcript, 'number:60', NOT_KEPT_740)
    const m = await home(homeRow(record))
    // ⛔ What `main` draws: the buttons back, and nothing said.
    const refused = m.q('attention-refused')
    expect(text(refused)).toBe(NOT_KEPT_740)
    expect(visible(refused)).toBe(true)
    assertDrawn(refused, 'the refusal on Home', m.host)
    expect(readBefore(refused, m.all('attention-decide-sess_home')[0]!)).toBe(true)
  })

  it('⚑ THE CONTROL — a row nobody refused draws no reason', async () => {
    const m = await home(homeRow(conversation('sess_home', codexToolCard(), waiting)))
    expect(m.all('attention-refused')).toEqual([])
    expect(visible(m.all('attention-decide-sess_home')[0]!)).toBe(true)
  })
})

/* ------------------------------------------------------------------ §4 · the read-back */

describe('§4 · `737` F-5 — the settled card, in the conversation', () => {
  it('🔴 Codex’s MCP card answered *Allow once* reads back *Allowed once*, drawn whole', async () => {
    const m = await pane(conversation('sess_1', codexToolCard(), answered('allow')))
    const verdict = await onScreen(m.q('permission-verdict'))
    // ⛔ What `main` draws: *Approved*, a word no button on this card says.
    expect(text(verdict)).toBe('Allowed once')
    expect(text(verdict)).toBe(since739.ALLOWED_ONCE)
    expect(visible(verdict)).toBe(true)
    assertDrawn(verdict, 'the verdict', m.host)
  })

  it('⚑ THE CONTROL — the same request without `mcpToolCall` (its button *Approve*) reads *Approved*', async () => {
    const m = await pane(conversation('sess_1', plainCommandCard(), answered('allow')))
    expect(text(m.q('permission-verdict'))).toBe('Approved')
    expect(visible(m.q('permission-verdict'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ §5 · the paint */

/** ⚑ What the engine painted a button with: its fill and its border. */
function paintOf(button: HTMLElement): { fill: string; border: string; borderWidth: number } {
  const style = getComputedStyle(button)
  return {
    fill: style.backgroundColor,
    border: style.borderTopColor,
    borderWidth: Number.parseFloat(style.borderTopWidth),
  }
}

const NO_FILL = 'rgba(0, 0, 0, 0)'

/**
 * 🔴 **739 review (findings 14 and 19) — *Always allow* is never the filled default.** 058 kept the
 * wholesale grant out of *"the filled primary style the approve buttons carry, so nothing about it
 * reads as the expected next click"*, and a grant that outlives the conversation is drawn the same
 * way. ⚠️ On the always-only command card it is the ONE allowing button, so filled it would be the
 * default — the case `PermissionCard`'s `keptBeyond` names.
 */
describe('§5 · the paint — *Always allow* is outlined, at 972 px', () => {
  it.each([
    ['Codex’s MCP card', codexToolCard],
    ['the always-only command card', alwaysOnlyCommandCard],
  ] as const)(
    '🔴 on %s, *Always allow* is `approve-quiet` — an empty fill inside a drawn border — never the filled `approve`',
    async (name, build) => {
      const m = await pane(conversation('sess_1', build(), waiting))
      // ⛔ What `main` draws: no *Always allow* to paint.
      const always = m.q('permission-allow_always')
      expect(wordOf(always), name).toBe('Always allow')
      expect(visible(always), name).toBe(true)
      expect([...always.classList], name).toContain('approve-quiet')
      expect([...always.classList], name).not.toContain('approve')
      const paint = paintOf(always)
      expect(paint.fill, `${name}: Always allow is filled`).toBe(NO_FILL)
      expect(paint.border, `${name}: Always allow has no border to read`).not.toBe(NO_FILL)
      expect(paint.borderWidth, name).toBeGreaterThan(0)
    },
  )

  it('⚑ THE CONTROL — the plain answer on the same card, *Allow once*, is the FILLED `approve`', async () => {
    const m = await pane(conversation('sess_1', codexToolCard(), waiting))
    const once = m.q('permission-allow')
    expect(wordOf(once)).toBe('Allow once')
    expect([...once.classList]).toContain('approve')
    expect([...once.classList]).not.toContain('approve-quiet')
    expect(paintOf(once).fill).not.toBe(NO_FILL)
    expect(visible(once)).toBe(true)
  })
})
