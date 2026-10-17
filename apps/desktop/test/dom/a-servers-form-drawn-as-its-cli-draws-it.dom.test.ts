import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
// ⚠️ **The modules, not the package barrel.** `@brobot2/runtime`'s index pulls in the adapters and
// with them `node:fs`, which Vite externalises for the browser — so importing from the barrel takes
// this whole file down at load. These import nothing but zod and each other.
import {
  codexElicitation,
  externalMcpElicitationPrompt,
} from '../../../../packages/runtime/src/codex/external-mcp'
import { boundPermissionDetail } from '../../../../packages/runtime/src/events'
import { persistenceOf, publishedOffer } from '../../../../packages/runtime/src/permission'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import * as since737 from '../../src/renderer/src/lib/permission-offer'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { CANCEL_STOPS_NOTHING } from '../../src/renderer/src/lib/user-input-offer'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady, lineCount } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 737 · Draw 5, DRAWN — an MCP server’s zero-field form, in a real engine
 *
 * ⚑ **The draw** (`737` §2 item 5): *"a server's form, including a zero-field one, is now shown to the
 * person as the CLI shows it (Allow / Deny / Cancel)."* ⚑ **The finding** (`730` F-9): *"A server's
 * own turnless card (R81's) still carries the chip *command*"*.
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a Codex conversation at 972 px, frozen on a server's zero-field form | the chip reads *MCP server* on one line and the Allow reads *Allow* — both drawn whole, in the row *Allow* · *Deny* · *Cancel request*, each over the server's line | the same card without `mcpServerAsks` (a row before `728`) draws *command* and *Approve* |
 * | 2 | Home at 972 px | — | the same request's row draws *Allow* · *Deny* · *Cancel* with the server's lines, whole, as it did before `737` |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the one
 * door — so the card travels the hops the app uses (`record.transcript` → `TranscriptView` →
 * `PermissionCard`) and is never handed to the card by the test. ⚑ At the width a conversation is
 * drawn at beside the rail (1180 − 208 = 972 px), in a window that wide.
 *
 * ⚑ **The card is built by the adapter's own exported composers** — `handleExternalMcpElicitation`'s
 * assembly for a server's form, which is private. ⚠️ A browser cannot run the host, so
 * `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts` §0 pins exactly this assembly to the card
 * main's REAL host sends for the same frame: a double that drifted from the adapter goes red there.
 *
 * ⚠️ **What `main` (92209678) draws instead, measured**: the chip *command* and the word *Approve*.
 * ⚠️ **The new exports** (`MCP_SERVER_KIND`, `ALLOW`) are read through the module's namespace
 * (`since737`): the browser runner links native modules, and a named import of an export `main` does
 * not have would fail the whole file there — controls included. ⚑ So they are read only in subjects.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ Asked forty seconds ago — so the frozen header reads as a live card does. */
const ASKED_AT = Date.now() - 40_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/* ------------------------------------------------------------------ the frame, and the card */

const SERVER = 'kibana'
const SAYS = 'May I read the logs index before I answer?'

/** ⚑ The render suite's frame: a server's own form with no fields, from a frame that named no turn. */
const A_ZERO_FIELD_FORM = {
  serverName: SERVER,
  mode: 'form',
  _meta: null,
  message: SAYS,
  requestedSchema: { type: 'object', properties: {} },
  turnId: null,
}

type PermissionRequest = Extract<TranscriptEvent, { type: 'permission_request' }>

/** ⚑ The adapter's assembly for that frame — pinned to main's host by the render suite's §0. */
function zeroFieldCard(): PermissionRequest {
  const elicitation = codexElicitation(A_ZERO_FIELD_FORM)
  if (elicitation === null) throw new Error('not an elicitation')
  const offer = publishedOffer(['allow'])
  return {
    type: 'permission_request',
    id: 'number:70',
    kind: 'command',
    action: elicitation.serverName,
    ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
    cancelStopsNothing: true,
    mcpServerAsks: { server: elicitation.serverName },
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

/** ⚑ The same card with no `mcpServerAsks` — a row written before `728`, one fact over. */
function unmarkedCard(): PermissionRequest {
  const { mcpServerAsks: _dropped, ...rest } = zeroFieldCard()
  void _dropped
  return rest
}

/* ------------------------------------------------------------------ mounting */

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** ⚑ One row through the one door, at the next ordinal — as the store feeds a live record. */
function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: ASKED_AT, event })
}

/** ⚑ A Codex conversation that asked something, ran, and is now frozen on the server's card. */
function frozenOn(card: PermissionRequest, sessionId = 'sess_1'): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = { ...CODEX_META, sessionId }
  record.phase = 'open'
  for (const event of [
    { type: 'session', state: 'started', ref: CODEX_META.ref },
    { type: 'user_turn', text: 'why is the search on the logs index failing?' },
    { type: 'status', state: 'working' },
    card,
    { type: 'status', state: 'waiting_permission' },
  ] as TranscriptEvent[])
    feed(record, event)
  return record
}

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(card: PermissionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record: frozenOn(card), cwd: '/work' }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ Home's row for the request, through the real projection over a record folded by `acceptEvent`. */
function homeRow(card: PermissionRequest): AttentionRequest {
  const rows = attentionQueue([frozenOn(card, 'sess_home')], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's queue, as wide as the page beside the rail — left mounted to the end. */
async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(AttentionQueue, { requests: [row], now: ASKED_AT + 40_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The kind chip in the card's frozen header — asserted to exist, never read off a `null`. */
function chipOf(m: Mounted): HTMLElement {
  const chips = [...m.q('permission-card').querySelectorAll<HTMLElement>('.permission-top .kind')]
  expect(chips, 'the card draws one kind chip').toHaveLength(1)
  return chips[0]!
}

/** ⚑ The word on a card's button — its `<strong>`. */
const wordOf = (button: HTMLElement): HTMLElement => {
  const strong = button.querySelector<HTMLElement>('strong')
  expect(strong, 'the button has no word').not.toBeNull()
  return strong!
}

/** ⚑ `a` is read before `b`: on an earlier line, or on the same line and to its left. */
const readBefore = (a: Element, b: Element): boolean => {
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  return ra.bottom <= rb.top + 0.5 || (ra.top < rb.bottom && ra.right <= rb.left + 0.5)
}

/* ------------------------------------------------------------------ §1 · the conversation */

describe('§1 · a Codex conversation at 972 px, frozen on a server’s zero-field form', () => {
  it('🔴 the chip reads *MCP server* and the Allow reads *Allow* — each drawn whole, in the row *Allow* · *Deny* · *Cancel request* over the server’s lines', async () => {
    const m = await pane(zeroFieldCard())
    // ⚑ The premise, off the pane: the card is up, and it is the server's (its own words on it).
    expect(visible(m.q('permission-card'))).toBe(true)
    expect(text(m.q('permission-detail'))).toContain(`${SERVER} says: ${SAYS}`)

    const chip = chipOf(m)
    const row = (['allow', 'deny', 'cancel'] as const).map((outcome) =>
      m.q(`permission-${outcome}`),
    )
    // ⛔ What `main` draws: the chip *command*, and *Approve*.
    expect(text(chip)).not.toBe('command')
    expect(text(wordOf(row[0]!))).not.toBe('Approve')
    // ⚑ Once verbatim, then by the constants the card reads.
    expect(text(chip)).toBe('MCP server')
    expect(text(chip)).toBe(since737.MCP_SERVER_KIND)
    expect(row.map((button) => text(wordOf(button)))).toEqual(['Allow', 'Deny', 'Cancel request'])
    expect(text(wordOf(row[0]!))).toBe(since737.ALLOW)

    // ⚑ Drawn whole — the chip on one line in the frozen header, each word on its button.
    expect(visible(chip)).toBe(true)
    assertDrawn(chip, 'the chip that says the server asks', m.host)
    expect(lineCount(chip)).toBe(1)
    for (const button of row) {
      expect(visible(button), text(button)).toBe(true)
      assertDrawn(wordOf(button), `the word on ${text(wordOf(button))}`, m.host)
    }
    expect(readBefore(row[0]!, row[1]!)).toBe(true)
    expect(readBefore(row[1]!, row[2]!)).toBe(true)

    // ⚑ Under each, what the SERVER is told (`728`) — and R81's Cancel, as `730` drew it.
    const lines = (['allow', 'deny', 'cancel'] as const).map((outcome) =>
      m.q(`permission-does-${outcome}`),
    )
    expect(lines.map(text)).toEqual([
      `${SERVER} is told yes`,
      `${SERVER} is told no`,
      CANCEL_STOPS_NOTHING,
    ])
    for (const line of lines) {
      expect(visible(line), text(line)).toBe(true)
      assertDrawn(line, `the line “${text(line)}”`, m.host)
    }
  })

  it('⚑ THE CONTROL — the same card without `mcpServerAsks` (a row before `728`) draws *command* and *Approve*', async () => {
    const m = await pane(unmarkedCard())
    expect(visible(m.q('permission-card'))).toBe(true)
    const chip = chipOf(m)
    expect(text(chip)).toBe('command')
    expect(visible(chip)).toBe(true)
    const allow = m.q('permission-allow')
    expect(text(wordOf(allow))).toBe('Approve')
    expect(visible(allow)).toBe(true)
    expect(text(wordOf(m.q('permission-cancel')))).toBe('Cancel request')
  })
})

/* ------------------------------------------------------------------ §2 · Home */

describe('§2 · Home at 972 px — the same request’s row', () => {
  it('⚑ draws *Allow* · *Deny* · *Cancel*, each over the server’s line, whole — as it did before `737`', async () => {
    const row = homeRow(zeroFieldCard())
    const m = await home(row)
    const buttons = m.all('attention-decide-sess_home')
    expect(buttons.map((button) => text(wordOf(button)))).toEqual(['Allow', 'Deny', 'Cancel'])
    const lines = buttons.map((button) => {
      const line = button.querySelector<HTMLElement>('[data-cy="attention-effect"]')
      expect(line, `no line under ${text(wordOf(button))}`).not.toBeNull()
      return line!
    })
    expect(lines.map(text)).toEqual([
      `${SERVER} is told yes`,
      `${SERVER} is told no`,
      CANCEL_STOPS_NOTHING,
    ])
    for (const [index, button] of buttons.entries()) {
      expect(visible(button), text(button)).toBe(true)
      assertDrawn(wordOf(button), `Home’s ${text(wordOf(button))}`, m.host)
      assertDrawn(lines[index]!, `Home’s line “${text(lines[index]!)}”`, m.host)
    }
    // ⚑ …on the row that carries the server's own words.
    expect(text(m.q('attention-request-sess_home'))).toContain(`${SERVER} says: ${SAYS}`)
  })
})
