import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  askedOfTheChannel,
  CHANNEL_REFUSAL_SENTENCES,
  type PermissionOutcome,
  type RuntimeEvent,
} from '@brobot2/runtime'
import {
  codexElicitation,
  externalMcpElicitationPrompt,
} from '../../../packages/runtime/src/codex/external-mcp'
import { boundPermissionDetail } from '../../../packages/runtime/src/events'
import { persistenceOf, publishedOffer } from '../../../packages/runtime/src/permission'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  ALLOW_ONCE,
  MCP_TOOL_KIND,
  permissionDecisionFor,
} from '../src/renderer/src/lib/permission-offer'
import * as since737 from '../src/renderer/src/lib/permission-offer'
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
import {
  CANCEL_STOPS_NOTHING,
  whatThisAnswerDoes,
  type AttentionDecision,
} from '../src/renderer/src/lib/user-input-offer'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
} from '../src/shared/questions'
import {
  type CreatedSession,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * # 🔴 737 · Draw 5 — an MCP server’s form, drawn as its CLI draws it (`728`, and `730` F-9)
 *
 * ⚑ **The draw, verbatim** (`737` §2 item 5): *"a server's form, including a zero-field one, is now
 * shown to the person as the CLI shows it (Allow / Deny / Cancel). Check it draws on every surface a
 * card reaches (the conversation, Home, the person's queue); draw it where it does not."*
 *
 * ⚑ **The finding it closes, verbatim** (`730` F-9): *"A server's own turnless card (R81's) still
 * carries the chip *command*"* — and **the CLI, measured** (`728` §2, bundled 0.146.0): *"A server's
 * zero-field form: *Allow* (*"Allow this request and continue"*), *Deny*, *Cancel*."*
 *
 * | § | surface | 🔴 subject (RED on `main` 92209678) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 0 | the wire | — | main's host sends a zero-field form as a card marked `mcpServerAsks`, with Allow · Deny · Cancel; the url form marked, with no Allow; Codex's own MCP card never marked — and the DOM suite's composer builds the zero-field card exactly |
 * | 1 | the card | the chip is *MCP server* and the Allow is *Allow* — turnless, named-turn, and in the transcript; the url card's chip too, still with no Allow | the same card without `mcpServerAsks` (a row before `728`) keeps *command* / *Approve*; Codex's own MCP card keeps *MCP tool* / *Allow once*; a plain command card keeps *command* / *Approve*; the marker never moves a Cancel |
 * | 2 | Home | — | the row already offered *Allow* · *Deny* · *Cancel* with the server's lines |
 * | 3 | the person's queue | — | the row copies Home's: *Allow* · *Deny* · *Cancel*, under the vocabulary's own sentence for a server's request |
 * | 4 | all three | ONE word for the one answer the server is told — the card no longer says *Approve* where Home and the queue say *Allow* | — |
 *
 * ⚑ **The premises are main's own host** (`when-codex-asks-to-run-an-mcp-tool.render.test.ts`'
 * `capture()`, `730`): the REAL `CodexRuntime` and `RuntimeHost` over a scripted app-server, so every
 * card below is the `RuntimeEventMessage` the window was SENT — through `toWireEvent`, which strips a
 * field the schema does not declare — folded by `acceptEvent` / `applyEvent`. Where a control removes
 * a field, it removes it from that captured card and sends the result through the same wire and fold.
 * ⚠️ **The person's queue is the one double** — a spawned child's `PersonsDecision`, in the shape
 * main's `decisionsForAPerson` writes today (`728`'s `a-server-asks-the-person` and its sentence,
 * read off the channel's own classifier over the captured card — never `730`'s older double, which
 * lags `728`). Its answers are the live Home row's, which is what the queue really copies.
 *
 * ⚠️ **What `main` (92209678) draws, measured**: the card's chip reads *command* and its Allow reads
 * *Approve*, on every server card; Home and the queue already said *Allow*. ⚠️ **The new exports**
 * (`MCP_SERVER_KIND`, `ALLOW`) are read through the module's namespace ({@link since737}) and only
 * inside subjects, so on `main` a subject fails on what `main` draws and the controls still run.
 * ⛔ **Cancel is `736`'s** (R97): this file pins only that the server's marker leaves a Cancel as it
 * was, never a new Cancel word.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — each absence is asserted beside a reading the
 * same markup does hold, with the templates' comments stripped. The engine's half — drawn whole, in a
 * conversation at 972 px and on Home — is `test/dom/a-servers-form-drawn-as-its-cli-draws-it.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/* ------------------------------------------------------------------ the frames Codex sends */

const SERVER = 'kibana'
const SAYS = 'May I read the logs index before I answer?'

/**
 * ⚑ **A server's own form with NO fields** — `728`'s measured frame (`codex-runtime.test.ts`'
 * `ELICITATION` with `properties: {}`): `mode: 'form'`, the server's message, and a schema that asks
 * nothing. ⚑ `turnId` is left to the scripted app-server (the bound turn) unless a capture says `null`.
 */
const A_ZERO_FIELD_FORM = {
  serverName: SERVER,
  mode: 'form',
  _meta: null,
  message: SAYS,
  requestedSchema: { type: 'object', properties: {} },
}

/** ⚑ A server's own `url` elicitation — main's own fixture (`a-press-that-stops-nothing-says-so`). */
const A_URL_FORM = {
  serverName: SERVER,
  mode: 'url',
  _meta: null,
  message: 'Sign in here first.',
  url: 'https://example.invalid/auth',
  elicitationId: 'e1',
}

/** ⚑ Codex's OWN approval of an MCP tool call, in `730`'s measured shape — the R80 card. */
const CODEX_TOOL = 'create_issue'
const CODEX_PARAMS: Record<string, string> = { repo: 'demo-org/notes-app', title: 'A bug' }
const CODEX_ASKS: Record<string, unknown> = {
  serverName: 'github',
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    tool_description: 'Create a new issue in a GitHub repository',
    tool_params: CODEX_PARAMS,
    tool_params_display: Object.entries(CODEX_PARAMS).map(([name, value]) => ({
      name,
      value,
      display_name: name,
    })),
  },
  message: `Allow the github MCP server to run tool "${CODEX_TOOL}"?`,
  requestedSchema: { type: 'object', properties: {} },
}

/** ⚑ The item Codex starts for the call before it asks — what ties the card to Codex (`723`). */
const THE_CALL: Record<string, unknown> = {
  item: {
    type: 'mcpToolCall',
    id: 'call_1',
    server: 'github',
    tool: CODEX_TOOL,
    status: 'inProgress',
    arguments: CODEX_PARAMS,
    appContext: null,
    result: null,
    error: null,
    durationMs: null,
  },
}

/* ------------------------------------------------------------------ what main's host sends */

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>

interface Captured {
  /** The host's own echo of the conversation — what a record's `meta` holds. */
  readonly meta: CreatedSession
  /** Every message the window was sent for this conversation, in order. */
  readonly messages: RuntimeEventMessage[]
  /** The card among them. */
  readonly card: PermissionRequest
}

const captured: Record<'zeroNoTurn' | 'zeroItsTurn' | 'urlNoTurn' | 'codexAsks', Captured> =
  {} as never

/**
 * ⚑ **Every card below, as main's host SENT it** — one conversation per frame, each on its own
 * scripted app-server, run once and torn down before any test reads it.
 */
beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-737-form-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-737-form-root-'))
  const window = new Window('webContents:1')
  const { host, db, servers } = aHostOverScriptedCodex(userData, { interruptWaitMs: 40 })
  const cardsOf = (sessionId: string): PermissionRequest[] =>
    window.messages
      .filter((message) => message.sessionId === sessionId)
      .map((message) => message.event)
      .filter((event): event is PermissionRequest => event.type === 'permission_request')

  const capture = async (raise: (server: ScriptedAppServer) => void): Promise<Captured> => {
    const meta = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(meta.sessionId, 'look at the failing search', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    raise(server)
    await waitFor(() => cardsOf(meta.sessionId).length === 1, 'the card')
    return {
      meta,
      messages: window.messages.filter((message) => message.sessionId === meta.sessionId),
      card: cardsOf(meta.sessionId)[0]!,
    }
  }

  try {
    captured.zeroNoTurn = await capture((server) =>
      server.raise(70, 'mcpServer/elicitation/request', { ...A_ZERO_FIELD_FORM, turnId: null }),
    )
    captured.zeroItsTurn = await capture((server) =>
      server.raise(71, 'mcpServer/elicitation/request', A_ZERO_FIELD_FORM),
    )
    captured.urlNoTurn = await capture((server) =>
      server.raise(72, 'mcpServer/elicitation/request', { ...A_URL_FORM, turnId: null }),
    )
    captured.codexAsks = await capture((server) => {
      server.announce('item/started', THE_CALL)
      server.raise(60, 'mcpServer/elicitation/request', CODEX_ASKS)
    })
  } finally {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ the composer (the DOM suite's double) */

/**
 * ⚑ **The zero-field card from the adapter's exported composers** — `handleExternalMcpElicitation`'s
 * own assembly for a server's form, which is private. ⚠️ The DOM suite cannot run a host in a
 * browser, so it builds its card this way; §0 pins this assembly to the card the host really sent.
 */
/**
 * ⚑ **Since `736` (R97) every server form's Cancel stops nothing**, turn or no turn: the Codex
 * terminal's own Esc lets the turn run on, and this app adds no stop of its own — so the marker is on
 * both frames, and the card the two frames make is one card.
 */
function composedZeroFieldCard(id: string): PermissionRequest {
  const elicitation = codexElicitation(A_ZERO_FIELD_FORM)
  if (elicitation === null) throw new Error('not an elicitation')
  const offer = publishedOffer(['allow'])
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: elicitation.serverName,
    ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
    cancelStopsNothing: true as const,
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

/* ------------------------------------------------------------------ folding and reading */

/** ⚑ The conversation as the window's store holds it: the host's meta, every message folded. */
function recordOf(one: Captured): SessionRecord {
  const record = createSessionRecord(one.meta.sessionId)
  record.meta = one.meta
  record.phase = 'open'
  for (const message of one.messages) acceptEvent(record, message)
  return record
}

/** ⚑ The card the conversation holds for its one request. */
function cardItem(one: Captured): PermissionItem {
  const item = recordOf(one).transcript.items.find((each) => each.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

/** ⚑ A card one fact over — changed on the captured card, then sent through main's wire and the fold. */
function wiredItem(event: PermissionRequest): PermissionItem {
  const state = createTranscript()
  applyEvent(state, toWireEvent('codex', event) satisfies TranscriptEvent, AT)
  const item = state.items.find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

/** ⚑ The captured card without one field — a row from before `728`, or a card that is not this one. */
function without(card: PermissionRequest, key: 'mcpServerAsks' | 'mcpToolCall'): PermissionRequest {
  const copy: Record<string, unknown> = { ...card }
  delete copy[key]
  return copy as PermissionRequest
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const card = (item: PermissionItem): Promise<string> =>
  render(PermissionCard, { item, provider: 'codex' })

/** ⚑ What a person reads — the templates carry their reasoning inline, as comments. */
const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** ⚑ The text a person can read, tags removed and whitespace folded. */
const words = (markup: string): string =>
  decode(shown(markup).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ⚑ Every text a `data-cy` element holds, decoded, in document order — the element's own text only. */
const textsOf = (markup: string, cy: string): string[] =>
  [
    ...shown(markup).matchAll(new RegExp(`data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map((one) => decode(one[1]!.trim()).replace(/\s+/g, ' '))

/** ⚑ The word on a card's button for one outcome — its `<strong>` — or `undefined` when there is none. */
function wordOn(markup: string, outcome: PermissionOutcome): string | undefined {
  const button = new RegExp(`data-cy="permission-${outcome}"[^>]*>([\\s\\S]*?)</button>`).exec(
    shown(markup),
  )?.[1]
  const strong =
    button === undefined ? undefined : /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(button)?.[1]
  return strong === undefined ? undefined : decode(strong.trim())
}

/** ⚑ The outcomes a card draws a button for, in document order. */
const buttonsOf = (markup: string): string[] =>
  [
    ...shown(markup).matchAll(
      /data-cy="permission-(allow|allow_for_session|allow_all_for_session|deny|cancel)"/g,
    ),
  ].map((one) => one[1]!)

/** ⚑ Every kind chip in the markup — the card's frozen header draws one. */
const chipsOf = (markup: string): string[] =>
  [...shown(markup).matchAll(/class="kind"[^>]*>([^<]*)</g)].map((one) => decode(one[1]!.trim()))

/** ⚑ A decision for one outcome, as a surface hands `whatThisAnswerDoes` one. */
const decisionOn = (
  outcome: PermissionOutcome,
  more: { server?: { name: string }; stopsNothing?: true } = {},
): Extract<AttentionDecision, { kind: 'permission' }> => ({
  kind: 'permission',
  label: outcome,
  decision: permissionDecisionFor(outcome),
  ...more,
})

/** ⚑ The lines under a server's Allow and Deny, verbatim ONCE (`728`'s person-facing words). */
const TOLD_YES = `${SERVER} is told yes`
const TOLD_NO = `${SERVER} is told no`

/* ------------------------------------------------------------------ Home and the person's queue */

/** ⚑ The row Home draws for the conversation, off the real projection. */
function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

const renderHome = (row: AttentionRequest): Promise<string> =>
  render(AttentionQueue, { requests: [row], now: AT + 60_000 })

/**
 * ⚑ **A spawned child's decision, in the shape main's walk writes TODAY** — the refusal read off the
 * channel's own classifier over the card the host sent, and the vocabulary's sentence for it.
 */
function decisionFor(row: AttentionRequest, sent: PermissionRequest): PersonsDecision {
  const verdict = askedOfTheChannel(sent)
  if (verdict === null || verdict.travels) throw new Error('the channel let a server’s card travel')
  const reading = decisionReading(row.sessionId, (sessionId) => sessionId)
  return {
    request: {
      requestId: row.requestId,
      askedBy: row.sessionId,
      parent: 'sess_parent',
      went: { is: 'the-person-the-channel-left-it-with', to: 'a-person', because: verdict.because },
      at: AT - 1_000,
      state: 'open',
      endedAt: null,
      escalatedAt: null,
    },
    reading,
    sentence: readingSentence(reading),
    says: CHANNEL_REFUSAL_SENTENCES[verdict.because],
    work: [],
  }
}

const DOORS: PersonsQueueDoors = {
  travel: () => {},
  settle: () => {},
  takeOver: () => {},
  open: () => {},
}

/** ⚑ The person's queue over one live Home row this window holds — `725`'s supply. */
function queueOver(row: AttentionRequest, sent: PermissionRequest): PersonsQueueRow {
  const walked: LedgerWalk<PersonsDecision> = {
    rows: [decisionFor(row, sent)],
    walk: 'every-conversation-that-routed',
    ledgers: 1,
    rowsUnread: 0,
  }
  const queue = usePersonsQueue()
  queue.supply(
    null,
    walked,
    {
      held: new Set([row.sessionId]),
      answerable: new Map([[row.key, row]]),
      answeredFromHere: new Set<string>(),
      now: AT,
      lastLookAnswered: { questions: true, decisions: true },
    },
    DOORS,
  )
  const drawn = queue.view.value?.rows.find((one) => one.key === row.key)
  if (drawn === undefined) throw new Error('the person’s queue drew no row')
  return drawn
}

/**
 * ⚑ Each answer button on the queue's row: its word and what it does — the line inside a broader
 * answer's button, or the line a primary answer's button is described by (*"Allow: …"*).
 */
const answersOn = (markup: string, key: string): { word: string; says: string }[] => {
  const html = shown(markup)
  return [
    ...html.matchAll(
      new RegExp(
        `<button([^>]*)data-cy="persons-queue-answer-${escapeRegExp(key)}"([^>]*)>([\\s\\S]*?)</button>`,
        'g',
      ),
    ),
  ].map((one) => {
    const word = decode(/<strong[^>]*>([\s\S]*?)<\/strong>/.exec(one[3]!)![1]!.trim())
    const inside = /<small[^>]*>([\s\S]*?)<\/small>/.exec(one[3]!)
    if (inside !== null) return { word, says: decode(inside[1]!.trim()) }
    const id = /aria-describedby="([^"]*)"/.exec(`${one[1]!} ${one[2]!}`)![1]!
    const line = new RegExp(`<p[^>]*id="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)</p>`).exec(html)!
    return { word, says: decode(line[1]!.trim()).slice(`${word}: `.length) }
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the wire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · what main’s host sends — the premise every section below stands on', () => {
  it('⚑ a server’s zero-field form reaches the window as a card the SERVER asks, offering Allow · Deny · Cancel — and the DOM suite’s composer builds that same card', () => {
    const { card: turnless } = captured.zeroNoTurn
    const { card: named } = captured.zeroItsTurn
    for (const sent of [turnless, named]) {
      expect(sent.mcpServerAsks).toEqual({ server: SERVER })
      expect(sent.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
      expect(sent.scope.noPositiveBecause).toBeUndefined()
      expect(sent.mcpToolCall).toBeUndefined()
      // ⚑ The wire's own kind is still `command` (`348`'s vocabulary) — which is why the chip may
      // not read it on this card.
      expect(sent.kind).toBe('command')
      expect(sent.action).toBe(SERVER)
      expect(sent.detail).toContain(`${SERVER} says: ${SAYS}`)
    }
    // ⚑ R81's marker — on every server form since `736` (R97), the frame's turn or none.
    expect(turnless.cancelStopsNothing).toBe(true)
    expect(named.cancelStopsNothing).toBe(true)
    expect(turnless).toEqual(composedZeroFieldCard('number:70'))
    expect(named).toEqual(composedZeroFieldCard('number:71'))
  })

  it('⚑ the url form reaches the window marked as the server’s too — since W4.28 with *I opened it*', () => {
    const { card: sent } = captured.urlNoTurn
    // ⚑ provider follow-ups 1 · …carrying the page the server asks for, as the server sent it.
    expect(sent.mcpServerAsks).toEqual({ server: SERVER, url: 'https://example.invalid/auth' })
    expect(sent.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(sent.scope.noPositiveBecause).toBeUndefined()
    expect(sent.kind).toBe('command')
  })

  it('⚑ Codex’s own approval of an MCP tool carries `mcpToolCall` and never `mcpServerAsks`', () => {
    const { card: sent } = captured.codexAsks
    expect(sent.mcpToolCall?.server).toBe('github')
    expect(sent.mcpToolCall?.tool).toBe(CODEX_TOOL)
    expect(sent.mcpServerAsks).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the conversation’s card — the server asking, in the CLI’s word', () => {
  it('🔴 a zero-field form from a turnless frame: the chip says *MCP server*, and its answers are *Allow* · *Deny* · *Cancel request*, each saying what the server is told', async () => {
    const html = await card(cardItem(captured.zeroNoTurn))
    // ⛔ What `main` draws: the chip *command*, and *Approve*.
    expect(chipsOf(html)).not.toContain('command')
    expect(wordOn(html, 'allow')).not.toBe('Approve')
    // ⚑ Once verbatim — the chip and the CLI's word (`728` §2) — and by the constants the card reads.
    expect(chipsOf(html)).toEqual(['MCP server'])
    expect(chipsOf(html)).toEqual([since737.MCP_SERVER_KIND])
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel'])
    expect(wordOn(html, 'allow')).toBe('Allow')
    expect(wordOn(html, 'allow')).toBe(since737.ALLOW)
    expect(wordOn(html, 'deny')).toBe('Deny')
    // ⚑ R81's Cancel, as `730` drew it — the marker never touches a Cancel (see the control below).
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    // ⚑ The lines under the buttons are the SERVER's (`728`) — from the one function every surface reads.
    expect(textsOf(html, 'permission-does-allow')).toEqual([TOLD_YES])
    expect(textsOf(html, 'permission-does-deny')).toEqual([TOLD_NO])
    expect(textsOf(html, 'permission-does-allow')).toEqual([
      whatThisAnswerDoes(decisionOn('allow', { server: { name: SERVER } })),
    ])
    expect(textsOf(html, 'permission-does-cancel')).toEqual([CANCEL_STOPS_NOTHING])
    // ⚑ The server's own words are on the card it heads.
    expect(words(html)).toContain(`${SERVER} says: ${SAYS}`)
  })

  it('🔴 the same form from a frame that NAMED its turn is the server asking too — *MCP server*, *Allow* — and its Cancel is `736`’s (R97): the request, and the turn runs on', async () => {
    const html = await card(cardItem(captured.zeroItsTurn))
    // ⛔ What `main` draws.
    expect(chipsOf(html)).not.toContain('command')
    expect(chipsOf(html)).toEqual([since737.MCP_SERVER_KIND])
    expect(wordOn(html, 'allow')).toBe(since737.ALLOW)
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel'])
    expect(textsOf(html, 'permission-does-allow')).toEqual([TOLD_YES])
    // ⚑ not this draw's words — `736`'s (R97), read so a change to them is seen here
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    expect(textsOf(html, 'permission-does-cancel')).toEqual([
      whatThisAnswerDoes(decisionOn('cancel', { stopsNothing: true })),
    ])
  })

  it('🔴 the url form is the server’s card too — *MCP server* — and its Allow is *I opened it* (W4.28)', async () => {
    const html = await card(cardItem(captured.urlNoTurn))
    // ⛔ What `main` draws.
    expect(chipsOf(html)).not.toContain('command')
    expect(chipsOf(html)).toEqual([since737.MCP_SERVER_KIND])
    // The person confirms opening the server’s link; that confirmation must not read “Allow”.
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel'])
    expect(wordOn(html, 'allow')).toBe('I opened it')
    expect(textsOf(html, 'permission-does-allow')).toEqual([
      `${SERVER} is told you opened its link`,
    ])
    expect(textsOf(html, 'permission-cannot-allow')).toHaveLength(0)
    expect(textsOf(html, 'permission-does-deny')).toEqual([TOLD_NO])
    // ⚑ The link itself, as the server's, on the card.
    expect(words(html)).toContain(`${SERVER}’s link: https://example.invalid/auth`)
  })

  it('🔴 in the conversation’s transcript the card draws the same chip and word — `TranscriptView` hands it the request the fold made', async () => {
    const html = await render(TranscriptView, {
      items: recordOf(captured.zeroNoTurn).transcript.items,
      mode: 'normal',
      provider: 'codex',
    })
    expect(chipsOf(html)).not.toContain('command')
    expect(chipsOf(html)).toEqual([since737.MCP_SERVER_KIND])
    expect(wordOn(html, 'allow')).toBe(since737.ALLOW)
  })

  it('⚑ THE CONTROL — a double that lags the wire (the zero-field card WITHOUT `mcpServerAsks`, as a row before `728`) keeps *command*, *Approve* and the agent’s lines', async () => {
    const html = await card(wiredItem(without(captured.zeroNoTurn.card, 'mcpServerAsks')))
    expect(chipsOf(html)).toEqual(['command'])
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel'])
    expect(wordOn(html, 'allow')).toBe('Approve')
    expect(textsOf(html, 'permission-does-allow')).toEqual([
      whatThisAnswerDoes(decisionOn('allow')),
    ])
    expect(textsOf(html, 'permission-does-deny')).toEqual([whatThisAnswerDoes(decisionOn('deny'))])
    expect(words(html)).not.toContain(TOLD_YES)
  })

  it('⚑ THE CONTROL — Codex’s own MCP tool card keeps R80’s *MCP tool* and *Allow once*', async () => {
    const html = await card(cardItem(captured.codexAsks))
    expect(chipsOf(html)).toEqual(['MCP tool'])
    expect(chipsOf(html)).toEqual([MCP_TOOL_KIND])
    expect(wordOn(html, 'allow')).toBe('Allow once')
    expect(wordOn(html, 'allow')).toBe(ALLOW_ONCE)
    // ⚠️ Codex's own question says *"the github MCP server"* in prose — the chip is what is read here.
    expect(chipsOf(html)).not.toContain('MCP server')
  })

  it('⚑ THE CONTROL — a plain command card (the same request without `mcpToolCall`) keeps *command* and *Approve*', async () => {
    const html = await card(wiredItem(without(captured.codexAsks.card, 'mcpToolCall')))
    expect(chipsOf(html)).toEqual(['command'])
    expect(wordOn(html, 'allow')).toBe('Approve')
    expect(wordOn(html, 'deny')).toBe('Deny')
  })

  it('🔴 737 review · answered *Allow*, the server’s card reads back *Allowed* — the word its button said; the plain card still reads *Approved*', async () => {
    const verdictOf = (html: string): string | undefined =>
      /data-cy="permission-verdict"[^>]*>([^<]*)</.exec(html)?.[1]?.trim()
    const answered = await card({ ...cardItem(captured.zeroNoTurn), outcome: 'allow' })
    expect(verdictOf(answered)).toBe('Allowed')
    // ⚑ the control, one fact over: the same request without the server's marker
    const plain = await card({
      ...wiredItem(without(captured.zeroNoTurn.card, 'mcpServerAsks')),
      outcome: 'allow',
    })
    expect(verdictOf(plain)).toBe('Approved')
  })

  it('⚑ the server’s marker moves the chip and the Allow, never a Deny or a Cancel — each reads as the same card without the marker reads', async () => {
    for (const one of [captured.zeroNoTurn, captured.zeroItsTurn, captured.urlNoTurn]) {
      const marked = await card(cardItem(one))
      const unmarked = await card(wiredItem(without(one.card, 'mcpServerAsks')))
      const what = one.card.id
      expect(wordOn(marked, 'cancel'), what).toBeDefined()
      expect(wordOn(marked, 'cancel'), what).toBe(wordOn(unmarked, 'cancel'))
      expect(wordOn(marked, 'deny'), what).toBe(wordOn(unmarked, 'deny'))
      expect(textsOf(marked, 'permission-does-cancel'), what).toEqual(
        textsOf(unmarked, 'permission-does-cancel'),
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · Home
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · Home — the row already said the CLI’s answers', () => {
  it('⚑ Home’s row for the zero-field form offers *Allow* · *Deny* · *Cancel*, each with the server’s line', async () => {
    const row = homeRow(recordOf(captured.zeroNoTurn))
    expect(row.decisions.map((one) => one.label)).toEqual(['Allow', 'Deny', 'Cancel'])
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-decide-word')).toEqual(['Allow', 'Deny', 'Cancel'])
    expect(textsOf(html, 'attention-effect')).toEqual([TOLD_YES, TOLD_NO, CANCEL_STOPS_NOTHING])
    // ⚑ The server's own words are on the row a person answers from.
    expect(words(html)).toContain(`${SERVER} says: ${SAYS}`)
  })

  it('⚑ the named-turn row says the same answers — its Cancel `736`’s line (R97); the url row’s Allow is *I opened it*', async () => {
    const named = await renderHome(homeRow(recordOf(captured.zeroItsTurn)))
    expect(textsOf(named, 'attention-decide-word')).toEqual(['Allow', 'Deny', 'Cancel'])
    expect(textsOf(named, 'attention-effect')).toEqual([
      TOLD_YES,
      TOLD_NO,
      whatThisAnswerDoes(decisionOn('cancel', { stopsNothing: true })),
    ])
    const url = await renderHome(homeRow(recordOf(captured.urlNoTurn)))
    expect(textsOf(url, 'attention-decide-word')).toEqual(['I opened it', 'Deny', 'Cancel'])
    expect(textsOf(url, 'attention-cannot-allow')).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the person’s queue — a spawned child’s server form, answered from the list', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  it('⚑ the row copies the live row: *Allow* · *Deny* · *Cancel* with the server’s lines, under the vocabulary’s own sentence for a server’s request', async () => {
    const live = homeRow(recordOf(captured.zeroNoTurn))
    const row = queueOver(live, captured.zeroNoTurn.card)
    expect(row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny', 'Cancel'])
    const html = await render(PersonsQueue, {})
    expect(answersOn(html, live.key)).toEqual([
      { word: 'Allow', says: TOLD_YES },
      { word: 'Deny', says: TOLD_NO },
      { word: 'Cancel', says: CANCEL_STOPS_NOTHING },
    ])
    // ⚑ Verbatim once — `728`'s member of the vocabulary, which the host draws as the row's `says`.
    expect(textsOf(html, `persons-queue-says-${live.key}`)).toEqual([
      'a request an MCP server made of the person, which is theirs to answer',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · all three surfaces
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the conversation, Home and the person’s queue — one set of answers for one form', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  it('🔴 a server’s zero-field form reads *Allow* on all three, with the server’s Allow and Deny lines — the card no longer says *Approve* where the others say *Allow* (Cancel’s word is `736`’s, and the card’s differs by R81)', async () => {
    const one = captured.zeroNoTurn
    const onTheCard = await card(cardItem(one))
    const live = homeRow(recordOf(one))
    const onHome = await renderHome(live)
    queueOver(live, one.card)
    const onTheQueue = answersOn(await render(PersonsQueue, {}), live.key)
    // ⚑ Home and the queue, as they drew before `737` — the positive the card is held to.
    expect(textsOf(onHome, 'attention-decide-word')[0]).toBe('Allow')
    expect(onTheQueue[0]?.word).toBe('Allow')
    // ⛔ What `main` draws on the card: *Approve*.
    expect(wordOn(onTheCard, 'allow')).toBe(textsOf(onHome, 'attention-decide-word')[0])
    expect(wordOn(onTheCard, 'allow')).toBe(onTheQueue[0]?.word)
    expect(wordOn(onTheCard, 'allow')).toBe(since737.ALLOW)
    // ⚑ The lines under Allow and Deny are one sentence each on all three.
    expect(textsOf(onTheCard, 'permission-does-allow')).toEqual([onTheQueue[0]?.says])
    expect(textsOf(onTheCard, 'permission-does-deny')).toEqual([onTheQueue[1]?.says])
    expect(textsOf(onHome, 'attention-effect').slice(0, 2)).toEqual([TOLD_YES, TOLD_NO])
  })
})
