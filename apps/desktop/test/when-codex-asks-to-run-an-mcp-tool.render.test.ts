import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome, RuntimeEvent } from '@brobot2/runtime'
import {
  codexElicitation,
  codexToolApproval,
  codexToolApprovalDetail,
  externalMcpElicitationPrompt,
  serverAsks,
} from '../../../packages/runtime/src/codex/external-mcp'
import { boundPermissionDetail } from '../../../packages/runtime/src/events'
import { persistenceOf, publishedOffer } from '../../../packages/runtime/src/permission'
import { wordsForACard } from '../../../packages/runtime/src/words-on-a-card'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import { answerFor, attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { permissionDecisionFor, wideGrantLabel } from '../src/renderer/src/lib/permission-offer'
import * as since730 from '../src/renderer/src/lib/permission-offer'
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
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import {
  whatThisAnswerDoes,
  type AttentionDecision,
} from '../src/renderer/src/lib/user-input-offer'
import * as said730 from '../src/renderer/src/lib/user-input-offer'
import { ASKED_TO_STOP } from '../src/shared/how-work-stopped'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
} from '../src/shared/questions'
import {
  providerName,
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
 * # 🔴 730 · Draws 1 and 2 — when Codex asks to run an MCP tool, and a Cancel that stops nothing
 *
 * ⚑ **The two rulings, verbatim** (`730` §1):
 *
 *  - **R80** (`720` F-A) — *"When Codex asks to run an MCP tool, a person sees it. A card naming the
 *    server, the tool and the parameters, with Allow once, Allow for this conversation (when Codex
 *    offers `session`) and Deny. ⛔ Never *always*."*
 *  - **R81** (`720` F-B) — *"A card whose press cannot stop the turn does not say it will. Its line
 *    says only what the press does: the request is cancelled; the turn is not asked to stop."*
 *
 * | § | surface | 🔴 subject (RED on `main`) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 0 | the wire | — | main's host sends both cards, and the composers the DOM suite builds from agree with it |
 * | 1 | the R80 card | who asks, the server, the tool, every parameter; *Allow once* · *Always allow* (R95, drawn since `739`) · *Deny* · *Cancel request* in the row, *Allow for this conversation* apart under its own warning; *always* said only by R95's own button and the offer's persistence (which summarises it), never by the conversation's grant; the kind is *MCP tool*; the settled verdict; the card Codex offered only `always` draws exactly *Allow once* · *Always allow* · *Deny* · *Cancel request*; the plain card's wholesale grant says *Allow every create_issue call for this conversation* and settles as *Allowed every create_issue call for this conversation* (`739` review) | the same card without `mcpToolCall` draws *Approve* and the tool's wholesale grant over the SAME buttons — only the words the marker gives move; a card Codex offered no `session` has no wide grant; the plain card's settled wholesale grant reads its own verdict, not the MCP card's |
 * | 2 | Home's row | *Allow once* · *Always allow* · *Deny* · *Cancel* · — since `743` (`739` F-1, ruled) — *Allow for this conversation*, under the card's own warning in R80's words, whole; the plain row offers the wholesale grant as *Allow every create_issue call for this conversation* | a plain command row keeps *Allow* and the plain warning (not the MCP one) |
 * | 3 | the R81 card | *Cancel request*, and {@link since730}'s line under it — never *the whole turn* | the same server card from a frame that NAMED its turn keeps *Cancel turn* and the whole-turn line |
 * | 4 | Home + the person's queue | the Cancel's line is R81's, and the marker never leaves the window | the named-turn card's Cancel line is the whole-turn one |
 * | 5 | the hop | `TranscriptView` hands the card its provider, so it says *Codex asks* | — |
 *
 * 🔴 **736 moved two of these rulings, and the rows above that pinned them are flipped in place**:
 * R95 withdrew R80's *"never always"* — the R80 card's OFFER also carries the Codex terminal's
 * *Always allow* (`allow_always`) where Codex offers `always` (drawn since `739`, below), and only
 * the CONVERSATION's grant is still never *always*; R97 put R81's marker on EVERY elicitation card, Codex's own approval and a server's card
 * whose frame named its turn included — so the controls that kept *Cancel turn* now remove the
 * marker from the captured card, the world of a row written before `736`.
 *
 * 🔴 **739 re-aimed six pins, in place** (`736` F-1: *"*Always allow* is offered by the runtime and
 * drawn by no surface"*): every surface draws it now, in the row, so the card, its plain-command
 * control, the no-`session` control and Home's rows offer it too. ⚑ R80's point that survives R95 —
 * **the CONVERSATION's grant is never *always*** — is still pinned element by element, and the
 * whole-card and whole-row *"no always"* are aimed at everything EXCEPT R95's own button (and, on the
 * card, the offer's persistence, which summarises it). The MCP card's read-back after *Allow once*
 * (`737` F-5, *Allowed once*) is pinned in `always-allow-on-every-surface.render.test.ts` §5.
 * ⚑ **And `739`'s review moved the PLAIN card's wholesale grant off *always*** (findings 6, 12, 30):
 * *Always allow create_issue this session* / *Always allowed this session* are now *Allow every
 * create_issue call for this conversation* / *Allowed every create_issue call for this conversation*
 * — so the controls that pinned the old words verbatim keep their point by the function both
 * surfaces read, and the new words are pinned in 🔴 subjects beside them.
 *
 * ⚑ **The premises are main's own host** (`a-press-that-stops-nothing-says-so.test.ts` §1 and §3,
 * `723`): the REAL `CodexRuntime` and `RuntimeHost` over a scripted app-server, so every card below
 * is the `RuntimeEventMessage` the window was SENT — through `toWireEvent`, which strips a field the
 * schema does not declare — folded by `acceptEvent` / `applyEvent`. ⛔ No card here holds a field
 * main could not have handed it. Where a control removes a field, it removes it from that captured
 * card and sends the result through the same wire and the same fold.
 *
 * ⚠️ **What is RED on `main` (`b9b1a4fc`) and why.** Main's host already sends both markers (`723`)
 * and no renderer file reads either: the MCP card is a plain command card — kind *command*,
 * *Approve*, *Always allow create_issue this session* under *Covers any create_issue command…*, and
 * no server, tool or parameter list; the R81 card says *Cancel turn* over *the whole turn is asked to
 * stop, and this request is refused*, on the card, on Home and on the person's queue.
 * ⚠️ **The new exports** (`ALLOW_ONCE`, `ALLOW_FOR_THIS_CONVERSATION`, `CANCEL_REQUEST`,
 * `MCP_TOOL_KIND`, `mcpToolAsker`, `mcpToolGrantCovers`, `CANCEL_STOPS_NOTHING`) are read through
 * the modules' namespaces and only inside subjects, so on `main` a subject fails on what `main`
 * draws and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — each absence is asserted beside a reading the
 * same markup does hold, and markup is read with its comments stripped: the templates carry their
 * reasoning inline, and a comment is not a sentence a person reads. The engine's half — drawn,
 * legible, in order, at the transcript's width — is
 * `test/dom/when-codex-asks-to-run-an-mcp-tool.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/* ------------------------------------------------------------------ the frames Codex sends */

const SERVER = 'github'
const TOOL = 'create_issue'
/** ⚑ Codex's own question, in the template `probe:codex-mcp-tool-approval` measured on 0.146.0. */
const QUESTION = `Allow the ${SERVER} MCP server to run tool "${TOOL}"?`

const TITLE = 'A resumed conversation is drawn as ended'
/** ⚑ A body as a model writes one — several lines, and a long unbroken link at the end. */
const BODY =
  'When a conversation is resumed after the app quit, the rail draws it as ended.\n\n' +
  'Steps:\n1. Start a Codex conversation\n2. Quit BroBot while it runs\n3. Launch it again\n\n' +
  `Seen at https://github.com/demo-org/notes-app/issues?q=is%3Aopen+label%3Arail+${'resume-after-quit-'.repeat(12)}`
const PARAMS: Record<string, string> = { repo: 'demo-org/notes-app', title: TITLE, body: BODY }

/**
 * ⚑ **Codex's own approval of an MCP tool call**, in the measured shape (`external-mcp.ts`'
 * `CodexToolApproval` docblock; `a-press-that-stops-nothing-says-so.test.ts`' `CODEX_ASKS`), with a
 * realistic call: a server a person registered, three parameters.
 */
const codexAsks = (
  params: Record<string, string> = PARAMS,
  persist: readonly string[] = ['session', 'always'],
): Record<string, unknown> => ({
  serverName: SERVER,
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist,
    tool_description: 'Create a new issue in a GitHub repository',
    tool_params: params,
    tool_params_display: Object.entries(params).map(([name, value]) => ({
      name,
      value,
      display_name: name,
    })),
  },
  message: QUESTION,
  requestedSchema: { type: 'object', properties: {} },
})

/** ⚑ The item Codex starts for the call before it asks — what ties the card to Codex (`723`). */
const theCall = (params: Record<string, string>): Record<string, unknown> => ({
  item: {
    type: 'mcpToolCall',
    id: 'call_1',
    server: SERVER,
    tool: TOOL,
    status: 'inProgress',
    arguments: params,
    appContext: null,
    result: null,
    error: null,
    durationMs: null,
  },
})

/** ⚑ A body too long to list — `wordsForACard` drops it, and the parameters after it are counted. */
const TOO_MUCH: Record<string, string> = {
  repo: 'demo-org/notes-app',
  body: 'x'.repeat(70_000),
  title: TITLE,
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

/* ------------------------------------------------------------------ what main's host sends */

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>

interface Captured {
  /** The host's own echo of the conversation — what a record's `meta` holds. */
  readonly meta: CreatedSession
  /** Every message the window was sent for this conversation, in order. */
  readonly messages: RuntimeEventMessage[]
  /** The card among them. */
  readonly card: PermissionRequest
  /** ⚑ 736 · the conversation's provider home, as the host handed it to the app-server — where an *Always allow* is kept. */
  readonly home: string
}

const captured: Record<
  | 'asks'
  | 'asksOnce'
  | 'asksTooMuch'
  | 'asksOneUnlisted'
  | 'pressedWide'
  | 'serverNoTurn'
  | 'serverItsTurn',
  Captured
> = {} as never

/**
 * ⚑ **Every card below, as main's host SENT it** — one conversation per frame, each on its own
 * scripted app-server, run once and torn down before any test reads it.
 */
beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-730-mcp-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-730-mcp-root-'))
  const window = new Window('webContents:1')
  const { host, db, servers } = aHostOverScriptedCodex(userData, { interruptWaitMs: 40 })
  const cardsOf = (sessionId: string): PermissionRequest[] =>
    window.messages
      .filter((message) => message.sessionId === sessionId)
      .map((message) => message.event)
      .filter((event): event is PermissionRequest => event.type === 'permission_request')

  const capture = async (
    raise: (server: ScriptedAppServer) => void,
    press?: (sessionId: string, requestId: string) => Promise<void>,
  ): Promise<Captured> => {
    const meta = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(meta.sessionId, 'file the bug you found', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    raise(server)
    await waitFor(() => cardsOf(meta.sessionId).length === 1, 'the card')
    const card = cardsOf(meta.sessionId)[0]!
    if (press !== undefined) {
      const before = window.messages.length
      await press(meta.sessionId, card.id)
      await waitFor(
        () =>
          window.messages
            .slice(before)
            .some(
              (message) =>
                message.sessionId === meta.sessionId && message.event.type === 'user_decision',
            ),
        'the decision',
      )
    }
    return {
      meta,
      messages: window.messages.filter((message) => message.sessionId === meta.sessionId),
      card,
      home: server.home,
    }
  }

  const codexAsking =
    (params: Record<string, string>, persist?: readonly string[]) =>
    (server: ScriptedAppServer): void => {
      server.announce('item/started', theCall(params))
      server.raise(60, 'mcpServer/elicitation/request', codexAsks(params, persist))
    }

  try {
    captured.asks = await capture(codexAsking(PARAMS))
    captured.asksOnce = await capture(codexAsking(PARAMS, ['always']))
    captured.asksTooMuch = await capture(codexAsking(TOO_MUCH))
    // ⚑ **730 review · one parameter the adapter could not list, in a call short enough to hold
    // whole**: a value that cleans to nothing (`wordsForACard` → `null`) is counted, not listed
    // (`displayedParameters`), and the block — the call's own `tool_params` — still holds it.
    captured.asksOneUnlisted = await capture(codexAsking({ ...PARAMS, note: '   ' }))
    captured.pressedWide = await capture(codexAsking(PARAMS), async (sessionId, requestId) => {
      await host.respondPermission(
        sessionId,
        requestId,
        { outcome: 'allow_all_for_session' },
        window,
      )
    })
    captured.serverNoTurn = await capture((server) =>
      server.raise(50, 'mcpServer/elicitation/request', { ...A_SERVER_ASKS, turnId: null }),
    )
    captured.serverItsTurn = await capture((server) =>
      server.raise(51, 'mcpServer/elicitation/request', A_SERVER_ASKS),
    )
  } finally {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ the composers (the DOM suite's double) */

/**
 * ⚑ **The R80 card from the adapter's exported composers** — `aToolApprovalCard`'s own assembly,
 * which is private. ⚠️ The DOM suite cannot run a host in a browser, so it builds its card this way;
 * §0 pins this assembly to the card the host really sent, so the double cannot drift unnoticed.
 * ⚑ **736** — R95's *Always allow* where Codex offers `always`, the rule each standing button
 * installs (`scope.grants`, kept in `home`), and R97's marker, which every elicitation card carries.
 */
function composedToolCard(
  frame: Record<string, unknown>,
  id: string,
  home: string,
): PermissionRequest {
  const approval = codexToolApproval(frame)
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
    ...(approval.offersAlways
      ? // ⚑ The file's name typed, not imported: a double that imported it would not load on
        // `main`, and §0's flips would be RED by a missing module rather than by what they assert.
        { allow_always: [rule], alwaysFile: join(home, 'brobot-kept-tool-approvals.json') }
      : {}),
  }
  return {
    type: 'permission_request',
    id,
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

/**
 * ⚑ The server's own `url` card from the same composers, with R81's marker as the adapter spreads
 * it — ⚑ 736 · R97: on every such card now, whether or not its frame named a turn.
 */
function composedServerCard(id: string): PermissionRequest {
  const elicitation = codexElicitation(A_SERVER_ASKS)
  if (elicitation === null) throw new Error('not an elicitation')
  // ⚑ W4.28 — a url request whose link the card shows offers *I opened it* (`allow`).
  const offer = publishedOffer(['allow'])
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: elicitation.serverName,
    ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
    cancelStopsNothing: true,
    // ⚑ 728 · R93 — a server's own request says whose it is (and, since provider follow-ups 1, the
    // page its url request asks for).
    mcpServerAsks: serverAsks(elicitation),
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

/** ⚑ A card one fact over — changed on the captured card, then sent through main's wire and the fold. */
function wiredItem(event: PermissionRequest, ...more: TranscriptEvent[]): PermissionItem {
  const state = createTranscript()
  applyEvent(state, toWireEvent('codex', event) satisfies TranscriptEvent, AT)
  for (const next of more) applyEvent(state, next, AT)
  const item = state.items.find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

/** ⚑ The card the conversation holds for its one request. */
function cardItem(one: Captured): PermissionItem {
  const item = recordOf(one).transcript.items.find((each) => each.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

/** ⚑ The captured card without one field — the world before `723`, or a card that is not this one. */
function without<K extends 'mcpToolCall' | 'cancelStopsNothing' | 'mcpServerAsks'>(
  card: PermissionRequest,
  key: K,
): PermissionRequest {
  const copy: Record<string, unknown> = { ...card }
  delete copy[key]
  return copy as PermissionRequest
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const card = (item: PermissionItem, over: Record<string, unknown> = {}): Promise<string> =>
  render(PermissionCard, { item, ...over })

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

/** ⚑ Where an element starts in the markup, or `-1`. */
const at = (markup: string, cy: string): number => shown(markup).indexOf(`data-cy="${cy}"`)

/** ⚑ The word on a card's button for one outcome — its `<strong>` — or `undefined` when there is none. */
function wordOn(markup: string, outcome: PermissionOutcome): string | undefined {
  const button = new RegExp(`data-cy="permission-${outcome}"[^>]*>([\\s\\S]*?)</button>`).exec(
    shown(markup),
  )?.[1]
  const strong =
    button === undefined ? undefined : /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(button)?.[1]
  return strong === undefined ? undefined : decode(strong.trim())
}

/** ⚑ The outcomes a card draws a button for, in document order — ⚑ 736: `allow_always` looked for too. */
const buttonsOf = (markup: string): string[] =>
  [
    ...shown(markup).matchAll(
      /data-cy="permission-(allow|allow_for_session|allow_all_for_session|allow_always|deny|cancel)"/g,
    ),
  ].map((one) => one[1]!)

/**
 * ⚑ **739 · the markup without the elements that carry R95's *always*** — the *Always allow* button
 * (its word and its line) and, on the card, the offer's `persistence` (which summarises it) — so a
 * *"no always"* reading can be aimed at everything else, where R80 still forbids it. ⚠️ Read as
 * WORDS (`words`), never as markup: the `kept grant` row's own hook is `permission-always-keeps`.
 */
const withoutR95 = (markup: string): string =>
  shown(markup)
    .replace(/<button[^>]*data-cy="permission-allow_always"[\s\S]*?<\/button>/g, '')
    .replace(/<dd[^>]*data-cy="permission-persistence"[^>]*>[\s\S]*?<\/dd>/g, '')
    .replace(/<strong[^>]*data-cy="attention-decide-word"[^>]*>Always allow<\/strong>/g, '')

/** ⚑ The kind chip in the card's frozen header. */
const kindOf = (markup: string): string | undefined =>
  /class="kind"[^>]*>([^<]*)</.exec(shown(markup))?.[1]?.trim()

/** ⚑ A decision exactly as the card's own `saysOf` hands it over, for an unmarked outcome. */
const plain = (outcome: PermissionOutcome): Extract<AttentionDecision, { kind: 'permission' }> => ({
  kind: 'permission',
  label: outcome,
  decision: permissionDecisionFor(outcome),
})

/** ⚑ R81's words, pinned once as the ruling fixed them (`the request is cancelled; the turn is not asked to stop`). */
// ⚑ 736 · R97 — *"the request is cancelled and the turn runs on"*, and R81's negation kept.
const R81_WORDS = 'the request is cancelled and the turn runs on — it is not asked to stop'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the wire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · what main’s host sends — the premise every section below stands on', () => {
  it('⚑ Codex’s approval reaches the window as a card that carries the call, and the DOM suite’s composers build that same card', () => {
    const { card: sent } = captured.asks
    expect(sent.mcpToolCall).toEqual({
      server: SERVER,
      tool: TOOL,
      parameters: [
        { name: 'repo', value: 'demo-org/notes-app' },
        { name: 'title', value: TITLE },
        { name: 'body', value: wordsForACard(BODY) },
      ],
    })
    // ⚑ 736 · R95 — Codex offered `always`, so the card's offer carries *Always allow* too.
    expect(sent.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    // 🔴 736 · R97 — every elicitation card's Cancel stops nothing, Codex's own approval's too.
    // ⛔ On `main`: the R80 card carried no marker (its Cancel also sent `turn/interrupt`, R74).
    expect(sent.cancelStopsNothing).toBe(true)
    // ⚑ 736 · R94 — what each standing button installs, and the file an *Always allow* is kept in.
    expect(sent.scope.grants).toEqual({
      allow_all_for_session: [{ kind: 'tool', tool: TOOL, server: SERVER }],
      allow_always: [{ kind: 'tool', tool: TOOL, server: SERVER }],
      alwaysFile: join(captured.asks.home, 'brobot-kept-tool-approvals.json'),
    })
    expect(sent).toEqual(composedToolCard(codexAsks(), sent.id, captured.asks.home))
    // ⚑ The cards Codex offered no `session`, and one whose parameters could not all be listed.
    // ⚑ 736 · R95 — offered only `always`, the offer carries *Always allow* and no conversation grant.
    expect(captured.asksOnce.card.scope.availableDecisions).toEqual([
      'allow',
      'allow_always',
      'deny',
      'cancel',
    ])
    expect(captured.asksOnce.card).toEqual(
      composedToolCard(codexAsks(PARAMS, ['always']), 'number:60', captured.asksOnce.home),
    )
    expect(captured.asksTooMuch.card.mcpToolCall?.parametersOmitted).toBe(2)
    expect(captured.asksTooMuch.card.mcpToolCall?.parameters).toEqual([
      { name: 'repo', value: 'demo-org/notes-app' },
    ])
  })

  it('⚑ a multi-line value reaches the card as ONE line — the adapter’s `wordsForACard` folds it (so no card draws a newline in a value)', () => {
    const body = captured.asks.card.mcpToolCall?.parameters.find((one) => one.name === 'body')
    expect(BODY).toContain('\n')
    expect(body?.value).not.toContain('\n')
    expect(body?.value).toContain('Steps: 1. Start a Codex conversation')
  })

  it('🔴 736 · R97 — a server’s own card carries R81’s marker whether or not its frame named a turn — both as the composers build them', () => {
    // ⛔ On `main`: only the card whose frame named NO turn carried it; the named-turn card's Cancel
    // also asked that turn to stop (R74).
    expect(captured.serverNoTurn.card.cancelStopsNothing).toBe(true)
    expect(captured.serverNoTurn.card).toEqual(composedServerCard('number:50'))
    expect(captured.serverItsTurn.card.cancelStopsNothing).toBe(true)
    expect(captured.serverItsTurn.card).toEqual(composedServerCard('number:51'))
    // ⚑ Neither is Codex asking: no `mcpToolCall` on a server's own card.
    expect(captured.serverNoTurn.card.mcpToolCall).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · R80 — the card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · R80 — the card Codex raises before an MCP tool runs', () => {
  it('🔴 it says who asks, and names the server, the tool and every parameter — beside the disclosure, above it', async () => {
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    // ⛔ What `main` draws: no list at all.
    expect(at(html, 'permission-mcp-call'), 'no server, tool or parameter list').toBeGreaterThan(-1)
    // ⚑ Once verbatim — R80's heading, named from the provider (`providerName`, never typed).
    expect(textsOf(html, 'permission-mcp-asker')).toEqual(['Codex asks to run an MCP tool'])
    expect(textsOf(html, 'permission-mcp-asker')).toEqual([since730.mcpToolAsker('codex')])
    expect(textsOf(html, 'permission-mcp-server')).toEqual([SERVER])
    expect(textsOf(html, 'permission-mcp-tool')).toEqual([TOOL])
    expect(textsOf(html, 'permission-mcp-parameter-name')).toEqual(['repo', 'title', 'body'])
    expect(textsOf(html, 'permission-mcp-parameter-value')).toEqual([
      'demo-org/notes-app',
      TITLE,
      wordsForACard(BODY),
    ])
    expect(at(html, 'permission-mcp-parameters-omitted')).toBe(-1)
    // ⛔ **Beside the disclosure, never instead of it** (`071`): the block is still the whole call.
    expect(textsOf(html, 'permission-detail')).toEqual([
      `${TOOL} ${JSON.stringify(PARAMS)}`.replace(/\s+/g, ' '),
    ])
    expect(at(html, 'permission-mcp-call')).toBeGreaterThan(at(html, 'permission-action'))
    expect(at(html, 'permission-mcp-call')).toBeLessThan(at(html, 'permission-detail'))
  })

  it('🔴 736 · R97 — its answers are *Allow once*, *Always allow* (739), *Deny* and *Cancel request* in the row, *Allow for this conversation* apart under its own warning — and *always* is said only by R95’s own button and the offer’s persistence', async () => {
    // ⛔ On `main`: *Cancel turn* (R97 took the stop off its Cancel), and no word on it said *always*.
    // 🔴 739 · re-aimed — R95's *Always allow* was OFFERED (§0) and drawn by no surface (`736` F-1);
    // `739` draws it in the row, after the conversation's grant and before the refusals.
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    // ⛔ What `main` before `730` drew: *Approve*, and *Always allow create_issue this session*.
    expect(wordOn(html, 'allow')).not.toBe('Approve')
    expect(buttonsOf(html)).toEqual([
      'allow',
      'allow_always',
      'deny',
      'cancel',
      'allow_all_for_session',
    ])
    expect(captured.asks.card.scope.availableDecisions).toContain('allow_always')
    // ⚑ Once verbatim — R80's words.
    expect(wordOn(html, 'allow')).toBe('Allow once')
    expect(wordOn(html, 'allow_all_for_session')).toBe('Allow for this conversation')
    expect(wordOn(html, 'allow')).toBe(since730.ALLOW_ONCE)
    expect(wordOn(html, 'allow_all_for_session')).toBe(since730.ALLOW_FOR_THIS_CONVERSATION)
    // 🔴 739 · R95 — offered, and drawn: its word is R95's (`ALWAYS_ALLOW`).
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    expect(wordOn(html, 'allow_always')).toBe(since730.ALWAYS_ALLOW)
    expect(wordOn(html, 'deny')).toBe('Deny')
    // 🔴 736 · R97 — its Cancel stops nothing, and says so.
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    expect(wordOn(html, 'cancel')).toBe(since730.CANCEL_REQUEST)
    // ⚑ The wide grant is set apart: its warning comes after the row, and the button after that.
    expect(at(html, 'permission-wide-warning')).toBeGreaterThan(at(html, 'permission-cancel'))
    expect(at(html, 'permission-allow_all_for_session')).toBeGreaterThan(
      at(html, 'permission-wide-warning'),
    )
    // ⛔ **The conversation's grant is never *always*** — not its button, not its warning, not the
    // line under it.
    expect(wordOn(html, 'allow_all_for_session')).not.toMatch(/always/i)
    expect(textsOf(html, 'permission-wide-warning')[0]).not.toMatch(/always/i)
    expect(textsOf(html, 'permission-does-allow_all_for_session')[0]).not.toMatch(/always/i)
    expect(kindOf(html)).not.toMatch(/always/i)
    // 🔴 739 · re-aimed — the persistence drawn is still that of the buttons drawn, and since `739`
    // those are the offer's: `always`, beside the *Always allow* that makes it true. ⚑ R80's
    // *"never always"* still holds of everything else on the card — aimed there, not at nothing.
    expect(captured.asks.card.scope.persistence).toBe('always')
    expect(textsOf(html, 'permission-persistence')).toEqual(['always'])
    expect(words(withoutR95(html))).not.toMatch(/always/i)
    expect(words(html)).toMatch(/always/i)
    // ⚑ …on a card that does draw its words.
    expect(words(html)).toContain('Allow for this conversation')
  })

  it('🔴 the grant says what it covers — that tool on that server, whatever it is given, for this conversation — and never *command*', async () => {
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    const [warning] = textsOf(html, 'permission-wide-warning')
    expect(warning).toBeDefined()
    // ⛔ What `main` draws: *Covers any create_issue command for the rest of this session*.
    expect(warning).not.toContain('command')
    expect(warning).toBe(since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'))
    expect(warning).toContain(
      `every call to ${TOOL} on ${SERVER} for the rest of this conversation`,
    )
    expect(warning).toContain('whatever it is given')
    expect(warning).toContain(`${providerName('codex')} will not ask about ${TOOL} again`)
    // ⛔ **730 review — what the grant does NOT cover, never that the rest is asked about**: Codex
    // runs a tool its server marks read-only, or harmless and closed, with no ask (measured).
    expect(warning).toContain(`the grant does not cover ${SERVER}’s other tools`)
    expect(warning).not.toContain('still asked about')
  })

  it('🔴 730 review · the line under the conversation’s grant names the tool and the server — never *anything of this kind*', async () => {
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    const [line] = textsOf(html, 'permission-does-allow_all_for_session')
    // ⛔ What `main` (and the first cut of `730`) drew: `PERMISSION_EFFECTS`' generic sentence.
    expect(line).not.toContain('anything of this kind')
    expect(line).toBe(since730.mcpToolGrantDoes({ server: SERVER, tool: TOOL }))
    expect(line).toBe(
      `the agent may call ${TOOL} on ${SERVER}, whatever it is given, for this conversation`,
    )
    // ⚑ One field over: the plain command card keeps the generic sentence.
    const plainCard = await card(wiredItem(without(captured.asks.card, 'mcpToolCall')), {
      provider: 'codex',
    })
    expect(textsOf(plainCard, 'permission-does-allow_all_for_session')).toEqual([
      whatThisAnswerDoes(plain('allow_all_for_session')),
    ])
  })

  it('🔴 its kind is *MCP tool*, not *command*', async () => {
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    expect(kindOf(html)).toBe('MCP tool')
    expect(kindOf(html)).toBe(since730.MCP_TOOL_KIND)
  })

  // ⚑ **739 review (finding 20) · retitled** — it said *"drawn as `main` draws it"*, but this card
  // draws R95's *Always allow*, which `main` does not: its point is that the MARKER moves only the
  // words it gives (*Approve*, the kind, the wholesale grant's), never which buttons are drawn.
  it('⚑ THE CONTROL — the same card without `mcpToolCall` is a plain command card: the same buttons, and only the words the marker gives move', async () => {
    const plainCard = without(captured.asks.card, 'mcpToolCall')
    const html = await card(wiredItem(plainCard), { provider: 'codex' })
    expect(at(html, 'permission-mcp-call')).toBe(-1)
    expect(kindOf(html)).toBe('command')
    // 🔴 739 · re-aimed — the captured offer carries *Always allow*, drawn on every card since `739`
    // (§1 pins the MCP card's row exactly). ⚑ The marker moves the Allow's WORD, never which buttons
    // are drawn — so this control reads the MCP card's own row rather than a list, and holds as
    // written on both trees.
    const mcp = await card(cardItem(captured.asks), { provider: 'codex' })
    expect(buttonsOf(html)).toEqual(buttonsOf(mcp))
    expect(wordOn(html, 'allow_always')).toBe(wordOn(mcp, 'allow_always'))
    expect(wordOn(html, 'allow')).toBe('Approve')
    // ⚑ 736 · the Cancel's word is not this control's subject: R97 put R81's marker on the captured
    // card, so it moved on both cards alike — pinned, with its unmarked control, in §1's R97 test.
    // ⚑ By the function both surfaces read — and never the MCP card's words for its grant.
    // 🔴 739 review · re-aimed — this pinned *"Always allow create_issue this session"* verbatim; the
    // words moved off *always* (the next test pins them), so the control holds by the function.
    expect(wordOn(html, 'allow_all_for_session')).toBe(wideGrantLabel(TOOL))
    expect(wordOn(html, 'allow_all_for_session')).not.toBe(wordOn(mcp, 'allow_all_for_session'))
    expect(textsOf(html, 'permission-wide-warning')[0]).toContain('Covers')
    // 🔴 743 · re-aimed — `739` F-8: *for this conversation*, the words on its button.
    expect(words(html)).toContain(
      `Covers any ${TOOL} command for this conversation — not just this one.`,
    )
  })

  it('🔴 739 review · the plain card’s wholesale grant says what it does, for this conversation — *Allow every create_issue call for this conversation*, never *always*', async () => {
    const html = await card(wiredItem(without(captured.asks.card, 'mcpToolCall')), {
      provider: 'codex',
    })
    // ⛔ What `main` draws: *Always allow create_issue this session*, beside a card whose offer
    // carries R95's *Always allow* — the grant that is KEPT (findings 6, 12, 30).
    expect(wordOn(html, 'allow_all_for_session')).toBe(
      `Allow every ${TOOL} call for this conversation`,
    )
    expect(wordOn(html, 'allow_all_for_session')).not.toMatch(/always/i)
    // ⚑ …so the one word that says *Always* on the card is R95's.
    expect(
      buttonsOf(html)
        .map((outcome) => wordOn(html, outcome as PermissionOutcome) ?? '')
        .filter((word) => /always/i.test(word)),
    ).toEqual(['Always allow'])
  })

  /**
   * 🔴 **739 review (finding 20) — the card Codex offered only `always`, pinned whole.** This was the
   * control below, reading the row with *Always allow* filtered out — so nothing pinned what this
   * card draws. ⚑ It draws R95's button, and `main` does not, so it is a subject.
   */
  it('🔴 a card Codex offered only `always` draws exactly *Allow once* · *Always allow* · *Deny* · *Cancel request*', async () => {
    const html = await card(cardItem(captured.asksOnce), { provider: 'codex' })
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel request*.
    expect(buttonsOf(html)).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
    expect(
      (['allow', 'allow_always', 'deny', 'cancel'] as const).map((one) => wordOn(html, one)),
    ).toEqual(['Allow once', 'Always allow', 'Deny', 'Cancel request'])
  })

  it('⚑ THE CONTROL — a card Codex offered no `session` (only `always`) has no wide grant and no *Allow for this conversation*', async () => {
    const html = await card(cardItem(captured.asksOnce), { provider: 'codex' })
    // ⚑ 739 review · re-aimed, not filtered — this control's point is the WIDE grant; the row
    // itself is pinned whole by the subject above. Its ends are the same on both trees.
    expect(buttonsOf(html)).not.toContain('allow_all_for_session')
    expect(buttonsOf(html)[0]).toBe('allow')
    expect(buttonsOf(html).slice(-2)).toEqual(['deny', 'cancel'])
    expect(at(html, 'permission-wide-warning')).toBe(-1)
    expect(words(html)).not.toContain('Allow for this conversation')
    // ⚑ …on a card that draws its offer.
    expect(wordOn(html, 'deny')).toBe('Deny')
  })

  it('🔴 736 · R97 — the R80 card carries R81’s marker, so its Cancel says the request is cancelled and the turn is not asked to stop', async () => {
    // ⛔ On `main`: no marker — *Cancel turn* over the whole-turn line, and its Cancel also sent
    // `turn/interrupt` (R74; `723`’s `cancel` arm ended the turn `interrupted`).
    const html = await card(cardItem(captured.asks), { provider: 'codex' })
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    expect(textsOf(html, 'permission-does-cancel')).toEqual([R81_WORDS])
    expect(textsOf(html, 'permission-does-cancel')).toEqual([said730.CANCEL_STOPS_NOTHING])
    expect(words(html)).not.toContain('whole turn')
    // ⚑ THE CONTROL, one field over — the same card without the marker (a row written before `736`)
    // keeps the whole-turn line.
    const unmarked = await card(wiredItem(without(captured.asks.card, 'cancelStopsNothing')), {
      provider: 'codex',
    })
    expect(wordOn(unmarked, 'cancel')).toBe('Cancel turn')
    expect(textsOf(unmarked, 'permission-does-cancel')).toEqual([
      whatThisAnswerDoes(plain('cancel')),
    ])
    expect(textsOf(unmarked, 'permission-does-cancel')[0]).toContain(
      `the whole turn is ${ASKED_TO_STOP}`,
    )
  })

  it('🔴 parameters the adapter could not list are counted on the card', async () => {
    const html = await card(cardItem(captured.asksTooMuch), { provider: 'codex' })
    const omitted = textsOf(html, 'permission-mcp-parameters-omitted')
    expect(omitted, 'no omitted line').toHaveLength(1)
    expect(omitted[0]).toMatch(/^⚠️ 2 more parameters are part of this call/)
    // ⚑ …beside the one parameter that was listed.
    expect(textsOf(html, 'permission-mcp-parameter-name')).toEqual(['repo'])
  })

  it('🔴 730 review · the omitted line never calls a CUT block the whole call — and counts one in the singular', async () => {
    const tooMuch = captured.asksTooMuch.card
    // ⚑ The premise, off the host: the parameter too long to list made the block too long to hold.
    expect(tooMuch.detailOmitted, 'the host did not bound this call').toBeGreaterThan(0)
    const cut = textsOf(
      await card(cardItem(captured.asksTooMuch), { provider: 'codex' }),
      'permission-mcp-parameters-omitted',
    )
    expect(cut).toEqual([
      '⚠️ 2 more parameters are part of this call and not listed here — the block below holds the call, and says where it is cut.',
    ])
    // ⚑ One fact over, off main's own host: a call held WHOLE, with ONE parameter left out.
    const one = captured.asksOneUnlisted.card
    expect(one.detailOmitted, 'the host bounded this call').toBeUndefined()
    expect(one.mcpToolCall?.parametersOmitted).toBe(1)
    const html = await card(cardItem(captured.asksOneUnlisted), { provider: 'codex' })
    expect(textsOf(html, 'permission-mcp-parameters-omitted')).toEqual([
      '⚠️ 1 more parameter is part of this call and not listed here — the block below is the whole call.',
    ])
  })

  it("🔴 a tool name the adapter could not clean (`''`) draws no empty tool row — the server is still named", async () => {
    const call = captured.asks.card.mcpToolCall!
    const html = await card(
      wiredItem({ ...captured.asks.card, mcpToolCall: { ...call, tool: '' } }),
      {
        provider: 'codex',
      },
    )
    expect(textsOf(html, 'permission-mcp-server')).toEqual([SERVER])
    expect(at(html, 'permission-mcp-tool')).toBe(-1)
    expect(textsOf(html, 'permission-mcp-parameter-name')).toEqual(['repo', 'title', 'body'])
    // 🔴 **730 review — and every sentence that names the tool says *this tool*, never a gap**: the
    // grant is still offered on this card, and Home names it too.
    const [warning] = textsOf(html, 'permission-wide-warning')
    expect(warning).toContain(`every call to this tool on ${SERVER}`)
    expect(warning).toContain(`will not ask about this tool again`)
    expect(textsOf(html, 'permission-does-allow_all_for_session')).toEqual([
      `the agent may call this tool on ${SERVER}, whatever it is given, for this conversation`,
    ])
    // 🔴 743 · re-aimed — Home offers the grant under the card's own warning since `739` F-1 was
    // ruled (it drew a sentence saying where the grant was): read off Home's own row.
    const wide = homeRow(
      recordHolding(captured.asks.meta, {
        ...captured.asks.card,
        mcpToolCall: { ...call, tool: '' },
      }),
    ).decisions.at(-1)!
    const home = wide.kind === 'permission' ? (wide.warns ?? '') : ''
    expect(home).toContain(`every call to this tool on ${SERVER}`)
    expect(home).toContain('will not ask about this tool again')
    for (const said of [warning!, home]) expect(said).not.toMatch(/ {2}| on on /)
  })

  it('🔴 a card that does not know its conversation’s provider says *The provider asks*', async () => {
    for (const over of [{}, { provider: null }]) {
      const html = await card(cardItem(captured.asks), over)
      expect(textsOf(html, 'permission-mcp-asker'), JSON.stringify(over)).toEqual([
        'The provider asks to run an MCP tool',
      ])
      // ⚑ …and the grant's warning names no provider either.
      expect(textsOf(html, 'permission-wide-warning')[0], JSON.stringify(over)).toContain(
        `The provider will not ask about ${TOOL} again`,
      )
    }
    expect(since730.mcpToolAsker(null)).toBe('The provider asks to run an MCP tool')
  })

  it('🔴 pressed wide, the settled card reads *Allowed for this conversation* — never *Always allowed this session*', async () => {
    const item = cardItem(captured.pressedWide)
    // ⚑ The premise, off main's own host: the press was recorded as the tool's grant.
    expect(item.outcome).toBe('allow_all_for_session')
    const html = await card(item, { provider: 'codex' })
    // ⛔ What `main` draws.
    expect(textsOf(html, 'permission-verdict')).not.toEqual(['Always allowed this session'])
    expect(textsOf(html, 'permission-verdict')).toEqual(['Allowed for this conversation'])
    expect(decode(shown(html))).not.toMatch(/always/i)
  })

  /** ⚑ The captured card without the marker, settled by the wholesale grant — one field over. */
  const plainPressedWide = (): PermissionItem => {
    const decided: TranscriptEvent = {
      type: 'user_decision',
      requestId: captured.asks.card.id,
      outcome: 'allow_all_for_session',
      by: { who: 'a-person' },
    }
    return wiredItem(without(captured.asks.card, 'mcpToolCall'), decided)
  }

  // ⚑ **739 review · re-aimed** — this pinned the plain card's *"Always allowed this session"*,
  // which the review moved off *always* (the next test). ⚑ Its point — the marker is what moves the
  // verdict — holds on both trees by reading the two verdicts against each other.
  it('⚑ THE CONTROL — the same grant on a plain command card reads its own verdict, not the MCP card’s', async () => {
    const item = plainPressedWide()
    expect(item.outcome).toBe('allow_all_for_session')
    const plainVerdict = textsOf(await card(item, { provider: 'codex' }), 'permission-verdict')
    const mcpVerdict = textsOf(
      await card(cardItem(captured.pressedWide), { provider: 'codex' }),
      'permission-verdict',
    )
    expect(plainVerdict).toHaveLength(1)
    expect(mcpVerdict).toEqual(['Allowed for this conversation'])
    expect(plainVerdict).not.toEqual(mcpVerdict)
  })

  it('🔴 739 review · the plain card’s wholesale grant reads back *Allowed every create_issue call for this conversation* — never *Always allowed this session*', async () => {
    const html = await card(plainPressedWide(), { provider: 'codex' })
    // ⛔ What `main` draws: *Always allowed this session*.
    expect(textsOf(html, 'permission-verdict')).toEqual([
      `Allowed every ${TOOL} call for this conversation`,
    ])
    expect(textsOf(html, 'permission-verdict')[0]).not.toMatch(/always/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · R80 — Home
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ The row Home draws for the conversation, off the real projection. */
function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ A record holding one card, folded by `acceptEvent` from a message the host could send. */
function recordHolding(meta: CreatedSession, event: PermissionRequest): SessionRecord {
  const record = createSessionRecord(meta.sessionId)
  record.meta = meta
  record.phase = 'open'
  acceptEvent(record, {
    sessionId: meta.sessionId,
    ordinal: 0,
    at: AT,
    event: toWireEvent('codex', event) satisfies TranscriptEvent,
  })
  return record
}

const renderHome = (row: AttentionRequest): Promise<string> =>
  render(AttentionQueue, { requests: [row], now: AT + 60_000 })

describe('§2 · R80 — Home’s row for the same request', () => {
  // 🔴 743 · re-aimed — `739` F-1, ruled by the PM: *"Where Always allow is a one-click answer
  // (Home, the person's queue), Allow for this conversation is too."* It pinned the sentence saying
  // the grant was not offered here.
  it('🔴 offers *Allow once*, and the conversation’s grant — the tool, the server — in R80’s words, under the card’s warning', async () => {
    const row = homeRow(recordOf(captured.asks))
    // ⛔ What `main` draws: *Allow once* · *Always allow* · *Deny* · *Cancel*, and a sentence saying
    // *Allow for this conversation is not offered here*.
    expect(row.decisions.map((one) => one.label)).not.toContain('Allow')
    expect(row.decisions.map((one) => one.label)).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(row.decisions[0]?.label).toBe(since730.ALLOW_ONCE)
    const wide = row.decisions.at(-1)!
    expect(wide.label).toBe(since730.ALLOW_FOR_THIS_CONVERSATION)
    expect(answerFor(wide)).toEqual({ permission: { outcome: 'allow_all_for_session' } })
    // ⚑ The card's own warning and the card's own line under the button, word for word.
    expect(wide.kind === 'permission' ? wide.warns : null).toBe(
      since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'),
    )
    expect(said730.whatThisAnswerDoes(wide)).toBe(
      `the agent may call ${TOOL} on ${SERVER}, whatever it is given, for this conversation`,
    )
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-decide-word')).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(textsOf(html, 'attention-wide-warning')).toEqual([
      since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'),
    ])
    expect(textsOf(html, 'attention-wide-warning')[0]).toContain(
      `every call to ${TOOL} on ${SERVER} for the rest of this conversation`,
    )
    // 🔴 739 · re-aimed — R95's own button says *always*; nothing else on the row does (R80).
    expect(words(withoutR95(html))).not.toMatch(/always/i)
    expect(words(html)).toMatch(/always/i)
  })

  it('⚑ THE CONTROL — a plain command row, one field over, keeps *Allow* and the plain sentence', async () => {
    const row = homeRow(
      recordHolding(captured.asks.meta, without(captured.asks.card, 'mcpToolCall')),
    )
    // 🔴 739 · re-aimed — the captured offer's *Always allow* is on this row as on the MCP row (§2's
    // subject pins that row exactly); ⚑ one field over, only the Allow's word moves.
    const mcpWords = homeRow(recordOf(captured.asks)).decisions.map((one) => one.label)
    // 🔴 743 · re-aimed — and the conversation's grant, after the row since `739` F-1 was ruled,
    // in the plain card's words (R80's are the MCP card's alone).
    const asPlain = mcpWords.map((word) =>
      word === 'Allow once'
        ? 'Allow'
        : word === 'Allow for this conversation'
          ? wideGrantLabel(TOOL)
          : word,
    )
    expect(row.decisions.map((one) => one.label)).toEqual(asPlain)
    expect(row.decisions[0]?.label).toBe('Allow')
    // ⚑ By the function every surface reads — and not the MCP row's warning. 🔴 743 · re-aimed —
    // it pinned the sentence saying where the grant was; since `739` F-1 was ruled the grant is here.
    const wide = row.decisions.at(-1)!
    expect(wide.label).toBe(wideGrantLabel(TOOL))
    const warns = wide.kind === 'permission' ? wide.warns : undefined
    expect(warns).toContain(`Covers any ${TOOL} command for this conversation`)
    expect(warns).not.toBe(since730.mcpToolGrantCovers({ server: SERVER, tool: TOOL }, 'codex'))
    expect(said730.whatThisAnswerDoes(wide)).toBe(
      'the agent may do anything of this kind for this conversation',
    )
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-decide-word')).toEqual(asPlain)
  })

  it('🔴 739 review · the plain row names the wholesale grant in the card’s words — *Allow every create_issue call for this conversation*, never *always*', () => {
    const row = homeRow(
      recordHolding(captured.asks.meta, without(captured.asks.card, 'mcpToolCall')),
    )
    // 🔴 743 · re-aimed — the button and its warning, on the row (`739` F-1 and F-8).
    const wide = row.decisions.at(-1)!
    expect(wide.label).toBe(`Allow every ${TOOL} call for this conversation`)
    expect(wide.kind === 'permission' ? wide.warns : null).toBe(
      `⚠ Covers any ${TOOL} command for this conversation — not just this one. ` +
        `Nothing will ask again, whatever it runs.`,
    )
  })

  it('🔴 736 · R97 — the words are Home’s own outside the one it was given — its Deny and its Cancel are unchanged on the MCP row, and only its Cancel carries R81’s marker', () => {
    const row = homeRow(recordOf(captured.asks))
    const byOutcome = new Map(
      row.decisions.map((one) => [
        one.kind === 'permission' ? one.decision.outcome : one.kind,
        one,
      ]),
    )
    expect(byOutcome.get('deny')?.label).toBe('Deny')
    expect(byOutcome.get('cancel')?.label).toBe('Cancel')
    // 🔴 739 · re-aimed — offered, and on the row since `739` under R95's word, carrying no marker.
    expect(byOutcome.get('allow_always')?.label).toBe('Always allow')
    // 🔴 736 · R97 — the R80 card carries R81's marker now, and only its Cancel is handed it.
    // ⛔ On `main`: no decision on it carried the marker (the R80 card never did).
    expect(
      row.decisions
        .filter((one) => 'stopsNothing' in one)
        .map((one) => (one.kind === 'permission' ? one.decision.outcome : one.kind)),
    ).toEqual(['cancel'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · R81 — the card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · R81 — a card whose Cancel cannot stop the turn does not say it will', () => {
  it('🔴 the server’s card from a turnless frame labels its Cancel *Cancel request* and says only what the press does', async () => {
    const html = await card(cardItem(captured.serverNoTurn), { provider: 'codex' })
    // ⛔ What `main` draws: *Cancel turn* over *the whole turn is asked to stop, and this request is refused*.
    expect(words(html)).not.toContain('whole turn')
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    expect(wordOn(html, 'cancel')).toBe(since730.CANCEL_REQUEST)
    // ⚑ Once verbatim — R81's words — and composed from the one ask the app names.
    expect(textsOf(html, 'permission-does-cancel')).toEqual([R81_WORDS])
    expect(textsOf(html, 'permission-does-cancel')).toEqual([said730.CANCEL_STOPS_NOTHING])
    expect(said730.CANCEL_STOPS_NOTHING).toBe(
      `the request is cancelled and the turn runs on — it is not ${ASKED_TO_STOP}`,
    )
    // ⚑ Its Deny is untouched by R81 — the marker is about the Cancel. ⚑ 728 · R93: and it names the
    // SERVER, which a Deny on a server's card tells no — the agent is refused nothing.
    expect(wordOn(html, 'deny')).toBe('Deny')
    expect(textsOf(html, 'permission-does-deny')).toEqual([
      `${A_SERVER_ASKS.serverName} is told no`,
    ])
  })

  it('🔴 736 · R97 — the same server card from a frame that NAMED its turn says the same: *Cancel request* and R81’s line', async () => {
    // ⛔ On `main`: *Cancel turn* over the whole-turn line — its Cancel also sent `turn/interrupt` (R74).
    const html = await card(cardItem(captured.serverItsTurn), { provider: 'codex' })
    expect(wordOn(html, 'cancel')).toBe('Cancel request')
    expect(textsOf(html, 'permission-does-cancel')).toEqual([R81_WORDS])
    expect(words(html)).not.toContain('whole turn')
    // ⚑ …as the turnless card does, so which frame named a turn no longer moves a word.
    expect(textsOf(html, 'permission-does-cancel')).toEqual(
      textsOf(
        await card(cardItem(captured.serverNoTurn), { provider: 'codex' }),
        'permission-does-cancel',
      ),
    )
  })

  it('⚑ THE CONTROL — a double that lags the wire (the turnless card WITHOUT its marker) draws the old words', async () => {
    const html = await card(wiredItem(without(captured.serverNoTurn.card, 'cancelStopsNothing')))
    expect(wordOn(html, 'cancel')).toBe('Cancel turn')
    expect(textsOf(html, 'permission-does-cancel')).toEqual([whatThisAnswerDoes(plain('cancel'))])
  })

  it('⚑ 728 · a turnless card stored BEFORE 728 (R81’s marker, no `mcpServerAsks`) keeps R81’s Cancel and a Deny’s own line', async () => {
    // ⚑ Rows written before `728` carry no server marker, so they take the card's non-server arm —
    // and there R81's Cancel line must stay beside the Cancel alone (`730 M18`).
    const html = await card(wiredItem(without(captured.serverNoTurn.card, 'mcpServerAsks')))
    expect(textsOf(html, 'permission-does-cancel')).toEqual([R81_WORDS])
    expect(textsOf(html, 'permission-does-deny')).toEqual([whatThisAnswerDoes(plain('deny'))])
  })

  it('⚑ the marker is read beside a Cancel only — a Deny handed it still says what a Deny does', () => {
    expect(whatThisAnswerDoes({ ...plain('deny'), stopsNothing: true })).toBe(
      whatThisAnswerDoes(plain('deny')),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · R81 — Home and the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · R81 — Home’s row says the same line under its Cancel, and never sends the marker', () => {
  const cancelOf = (row: AttentionRequest): AttentionDecision => {
    const cancel = row.decisions.find(
      (one) => one.kind === 'permission' && one.decision.outcome === 'cancel',
    )
    if (cancel === undefined) throw new Error('the row offers no Cancel')
    return cancel
  }

  it('🔴 the Cancel on Home says R81’s line, the row reads no *whole turn*, and what it sends is the plain outcome', async () => {
    const row = homeRow(recordOf(captured.serverNoTurn))
    const cancel = cancelOf(row)
    // ⛔ What `main` draws: the whole-turn line.
    expect(whatThisAnswerDoes(cancel)).not.toBe(whatThisAnswerDoes(plain('cancel')))
    expect(whatThisAnswerDoes(cancel)).toBe(said730.CANCEL_STOPS_NOTHING)
    // ⚑ Home keeps its own word for the press.
    expect(cancel.label).toBe('Cancel')
    const html = await renderHome(row)
    // ⚑ 728 · R93 — Home's Deny names the server too, from the same function.
    // ⚑ W4.28 — and *I opened it* first, said as what the server is told.
    expect(textsOf(html, 'attention-effect')).toEqual([
      `${A_SERVER_ASKS.serverName} is told you opened its link`,
      `${A_SERVER_ASKS.serverName} is told no`,
      R81_WORDS,
    ])
    expect(words(html)).not.toContain('whole turn')
    // ⛔ **Renderer-only**: the payload is built from the outcome alone.
    expect(answerFor(cancel)).toEqual({ permission: { outcome: 'cancel' } })
    // ⚑ …and only the Cancel carries it.
    const deny = row.decisions.find(
      (one) => one.kind === 'permission' && one.decision.outcome === 'deny',
    )
    expect(deny === undefined ? undefined : 'stopsNothing' in deny).toBe(false)
  })

  it('🔴 736 · R97 — the card that named its turn says R81’s line on Home too, and sends the plain outcome', async () => {
    // ⛔ On `main`: this card carried no marker, and Home's Cancel said the whole-turn line.
    const row = homeRow(recordOf(captured.serverItsTurn))
    const cancel = cancelOf(row)
    expect('stopsNothing' in cancel).toBe(true)
    expect(whatThisAnswerDoes(cancel)).toBe(said730.CANCEL_STOPS_NOTHING)
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-effect')[2]).toBe(R81_WORDS)
    expect(words(html)).not.toContain('whole turn')
    expect(answerFor(cancel)).toEqual({ permission: { outcome: 'cancel' } })
    // ⚑ THE CONTROL, one field over — the same card without the marker (a row written before `736`)
    // keeps the whole-turn line on Home, and carries none.
    const unmarked = homeRow(
      recordHolding(
        captured.serverItsTurn.meta,
        without(captured.serverItsTurn.card, 'cancelStopsNothing'),
      ),
    )
    expect('stopsNothing' in cancelOf(unmarked)).toBe(false)
    expect(whatThisAnswerDoes(cancelOf(unmarked))).toBe(
      `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,
    )
    expect(textsOf(await renderHome(unmarked), 'attention-effect')[2]).toBe(
      whatThisAnswerDoes(plain('cancel')),
    )
  })
})

describe('§4b · R81 — the person’s queue copies the live row’s line', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  /** ⚑ The decision the host's walk hands the queue — `725`'s shape. */
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

  function supply(requests: readonly AttentionRequest[]): readonly PersonsQueueRow[] {
    const walked: LedgerWalk<PersonsDecision> = {
      rows: requests.map(decision),
      walk: 'every-conversation-that-routed',
      ledgers: requests.length,
      rowsUnread: 0,
    }
    const queue = usePersonsQueue()
    queue.supply(
      null,
      walked,
      {
        held: new Set(requests.map((one) => one.sessionId)),
        answerable: new Map(requests.map((one) => [one.key, one])),
        answeredFromHere: new Set<string>(),
        now: AT,
        lastLookAnswered: { questions: true, decisions: true },
      },
      DOORS,
    )
    return queue.view.value?.rows ?? []
  }

  /**
   * ⚑ Each answer button on the queue's row: its word and what it does — the line inside a broader
   * answer's button, or the line a primary answer's button is described by (*"Deny: …"*).
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

  it('🔴 the person’s queue draws R81’s line under the Cancel of a card that cannot stop the turn', async () => {
    const live = homeRow(recordOf(captured.serverNoTurn))
    const row = supply([live]).find((one) => one.key === live.key)
    if (row === undefined) throw new Error('the person’s queue drew no row')
    const html = await render(PersonsQueue, {})
    const answers = answersOn(html, live.key)
    // ⚑ W4.28 review — no *I opened it* on the queue: its row does not show the link.
    expect(answers.map((one) => one.word)).toEqual(['Deny', 'Cancel'])
    // ⛔ What `main` draws: the whole-turn line.
    expect(answers[1]?.says).not.toContain('whole turn')
    expect(answers[1]?.says).toBe(R81_WORDS)
    expect(answers[1]?.says).toBe(said730.CANCEL_STOPS_NOTHING)
  })

  it('🔴 736 · R97 — the card that named its turn draws R81’s line on the queue too', async () => {
    // ⛔ On `main`: the whole-turn line under this card's Cancel.
    const live = homeRow(recordOf(captured.serverItsTurn))
    supply([live])
    const html = await render(PersonsQueue, {})
    const answers = answersOn(html, live.key)
    // ⚑ W4.28 review — no *I opened it* on the queue: its row does not show the link.
    expect(answers.map((one) => one.word)).toEqual(['Deny', 'Cancel'])
    expect(answers[1]?.says).toBe(R81_WORDS)
  })

  it('⚑ THE CONTROL — the same card without the marker (a row written before `736`) keeps the whole-turn line on the queue', async () => {
    const live = homeRow(
      recordHolding(
        captured.serverItsTurn.meta,
        without(captured.serverItsTurn.card, 'cancelStopsNothing'),
      ),
    )
    supply([live])
    const html = await render(PersonsQueue, {})
    const answers = answersOn(html, live.key)
    // ⚑ W4.28 review — no *I opened it* on the queue: its row does not show the link.
    expect(answers.map((one) => one.word)).toEqual(['Deny', 'Cancel'])
    expect(answers[1]?.says).toBe(whatThisAnswerDoes(plain('cancel')))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the hop — the transcript hands the card its provider
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the transcript hands the R80 card the provider it names', () => {
  const view = (items: TranscriptItem[], over: Record<string, unknown> = {}): Promise<string> =>
    render(TranscriptView, { items, mode: 'normal', ...over })

  it('🔴 in a Codex conversation’s transcript the card says *Codex asks to run an MCP tool*', async () => {
    const html = await view(recordOf(captured.asks).transcript.items, { provider: 'codex' })
    expect(textsOf(html, 'permission-mcp-asker')).toEqual([
      `${providerName('codex')} asks to run an MCP tool`,
    ])
  })

  it('🔴 a view that does not know its provider hands the card none — it says *The provider asks*', async () => {
    const html = await view(recordOf(captured.asks).transcript.items)
    expect(textsOf(html, 'permission-mcp-asker')).toEqual(['The provider asks to run an MCP tool'])
  })
})
