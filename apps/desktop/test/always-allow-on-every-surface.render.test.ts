import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome, RuntimeEvent } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { answerFor, attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { permissionDecisionFor, type KeptGrant } from '../src/renderer/src/lib/permission-offer'
import * as since739 from '../src/renderer/src/lib/permission-offer'
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
  markAnswerRefused,
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
  type ProviderAnswerAck,
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
import { asTheWireWouldCarry } from './lib/the-wire'

/**
 * # 🔴 739 · Draw 1 (the button) and `737` F-5 — *Always allow* on every surface a card reaches
 *
 * ⚑ **The finding, verbatim** (`736` §12 F-1): *"⚠️ **F-1 · *Always allow* is offered by the
 * runtime and drawn by no surface.** … place `allow_always` in `PLACE` and give it words from
 * `scope.grants.allow_always` + `alwaysFile`"* — and **F-6**: *"A failed keep is refused
 * `not-usable`, and the host words every `not-usable` as the empty-answer sentence. This is latent
 * until the button is drawn."* ⚑ **And `737` F-5**: *"Codex's own MCP card reads back *Approved*
 * after *Allow once*."*
 *
 * ⚑ **The rulings it answers** (`739` §1): **R95** — *"every choice the provider's CLI offers on an
 * ask (*Always allow*, …) is offered, with the CLI's persistence"*; **R94** — *"the card's words say
 * what the rule covers"*; **R99** — *"where an *always* is kept"* is the CLI's, and `740` (in flight)
 * moves it: ⛔ so every word below is read off the wire (`scope.grants.allow_always`, `alwaysFile`),
 * never a copy of today's file.
 *
 * | § | surface | 🔴 subject (RED on `main` 8a52dfd8) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 0 | the wire | — | main's host sends the MCP card's rule and file, a Codex command card whose ONLY accept is the prefix rule, one offering a plain accept AND the prefix rule, a card Codex offered no `always`, and a failed keep refused `stillOpen` in `740`'s own words |
 * | 1 | the card | *Always allow* in the row, its line naming the rule AND then the file verbatim, the `kept grant` row; the (composed) Claude `rm` card's line adds what it also covers for this conversation — the edits, never its own folder, and one fact over another folder IS said; `740`'s measured `make build` card prints the project's file as the wire names it; a card with no grants says the fallback and names no empty list; a server's tool with no clean name says *every call to this tool on <server>*, never a gap; the always-only command card draws the button and NO cannot-allow sentence, its proposal saying which answer keeps it; *Always allow* is OUTLINED (`approve-quiet`), never the filled `approve` | a card Codex offered no `always`: no button, no row, the other lines unchanged; a command card with no amendment offered keeps *proposed, not applied here*; `keeps` beside another outcome moves nothing; the plain answer on the same request is the filled `approve` |
 * | 2 | Home | the row offers *Always allow* with the card's own line, and the kept line in its scope; the always-only row offers it and says no cannot-allow; the press sends the plain outcome | the no-always row keeps *Allow once* · *Deny* · *Cancel*; the no-amendment row keeps its proposal line; the Allow once press |
 * | 3 | the person's queue | *Always allow* with the same line | the no-always row |
 * | 4 | Home's refusal (`736` F-6) | the host's reason for a failed keep, drawn on the row it was pressed from; `740`'s sentence flows through as data | the card drew it already; a row with no refusal draws none |
 * | 5 | the read-back (`737` F-5) | Codex's MCP card answered *Allow once* reads *Allowed once* | the plain card reads *Approved*, a server's card *Allowed*, an *Always allow* its own verdict |
 * | 6 | the settled card, expanded (review) | answered *Always allow*: the `kept grant` row is drawn — and on the always-only command card, its proposal's pointer to that row with it | ⚑ PINS (green on `main` by construction — it draws the row and the pointer nowhere): answered *Allow once*, *Deny*, *Cancel* or settled by a turn's end, the expanded body draws NO `kept grant` row; a prefix-rule command card answered *Approve* or *Deny* (round 2 #2), and the always-only card answered *Deny* or *Cancel* (#16), draw *proposed, not applied here* and NO pointer to a `kept grant` row; the settled *Allow once* card's body is drawn open and absent folded |
 * | 7 | the two grants on one card (review) | the card offering the wholesale grant AND *Always allow* draws ONE button whose word says *Always* — the kept one; the wholesale grant reads *Allow every Bash call for this conversation*, and settles as *Allowed every Bash call for this conversation*; Home's row the same | the wholesale grant still names its tool from the request, and never reads back as the conversation grant’s *Allowed for this conversation* (058) |
 *
 * ⚑ **The premises are main's own host** (`when-codex-asks-to-run-an-mcp-tool.render.test.ts`'
 * `capture()`, `730`): the REAL `CodexRuntime` and `RuntimeHost` over a scripted app-server, so every
 * Codex card below is the `RuntimeEventMessage` the window was SENT, folded by `acceptEvent`. The
 * failed keep is the host's own: this rig declares no MCP server, so `keepToolApproval` has no
 * address to keep and the adapter refuses the answer `not-kept` (`740`, R99 — `736` F-6's
 * `not-usable` until then), which the host words as its OWN sentence for a failed keep, never the
 * empty-answer one (§0 reads it off the host). ⚠️ The quotation above is `736`'s, of the adapter then.
 * ⚠️ **The Claude cards are built** (the rig opens Codex only) and sent through main's `toWireEvent`
 * and the same fold: ⚑ `740`'s MEASURED `make build` card ({@link MAKE_BUILD_GRANTS}, pinned to the
 * REAL `ClaudeRuntime` in `claude-runtime.test.ts`' *"740 · R99 (`736` F-4) — `make build`’s rule
 * is offered as *always*…"*), and ⚠️ a COMPOSED `rm` card ({@link RM_GRANTS}) — `736`'s shape, which
 * `740` made unreachable (R99: an `rm` is offered no *always*), kept for the one fact no measured
 * card carries: what an *Always allow* press ALSO installs for this conversation.
 *
 * ⚠️ **What `main` (8a52dfd8; 5f406f2f before it) draws instead, measured**: no *Always allow* on any surface — the row
 * is *Allow once* · *Deny* · *Cancel request*; the always-only command card says *"The only way to
 * allow this that the provider offered keeps the grant beyond this conversation, and BroBot does
 * not offer that choice yet."*; no `kept grant` row; Home draws no refusal at all; the MCP card
 * answered *Allow once* reads *Approved*; and the wholesale grant says *Always allow Bash this
 * session* / *Always allowed this session*. ⚠️ **The new exports** (`ALWAYS_ALLOW`, `ALLOWED_ONCE`,
 * `keptGrantOf`, `keptGrantSaid`) are read through the module's namespace ({@link since739}) and only
 * inside subjects, so on `main` a subject fails on what `main` draws and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — each absence is asserted beside a reading the
 * same markup does hold, with the templates' comments stripped. The engine's half — drawn whole in a
 * conversation at 972 px and on Home, and a real press — is
 * `test/dom/always-allow-on-every-surface.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/* ------------------------------------------------------------------ the frames Codex sends */

const SERVER = 'github'
const TOOL = 'create_issue'
const PARAMS: Record<string, string> = {
  repo: 'demo-org/notes-app',
  title: 'A resumed conversation is drawn as ended',
}

/** ⚑ Codex's own approval of an MCP tool call, in the measured shape (`730`'s `codexAsks`). */
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

/** ⚑ The item Codex starts for the call before it asks — what ties the card to Codex (`723`). */
const THE_CALL = {
  item: {
    type: 'mcpToolCall',
    id: 'call_1',
    server: SERVER,
    tool: TOOL,
    status: 'inProgress',
    arguments: PARAMS,
    appContext: null,
    result: null,
    error: null,
    durationMs: null,
  },
}

/**
 * ⚑ **Codex's prefix-rule amendment, as it offers it** (`codex-runtime.test.ts`' `736` R95 case) —
 * the terminal's *"Yes, and don't ask again for commands that start with …"*.
 */
const PREFIX = ['/usr/bin/touch', 'x']
const THE_AMENDMENT = { acceptWithExecpolicyAmendment: { execpolicy_amendment: PREFIX } }

/** ⚑ A server's own form with NO fields (`728`'s frame) — its Allow is its CLI's word. */
const A_ZERO_FIELD_FORM = {
  serverName: 'kibana',
  mode: 'form',
  _meta: null,
  message: 'May I read the logs index before I answer?',
  requestedSchema: { type: 'object', properties: {} },
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
  /** The conversation's provider home, as the host handed it to the app-server. */
  readonly home: string
  /** The host's answer to the press, where one was made. */
  readonly ack: ProviderAnswerAck | null
}

const captured: Record<
  | 'asks'
  | 'asksNoAlways'
  | 'keepRefused'
  | 'pressedOnce'
  | 'alwaysOnly'
  | 'noAmendment'
  | 'acceptOrKeep'
  | 'acceptOrKeepApproved'
  | 'serverAllowed',
  Captured
> = {} as never

/**
 * ⚑ **Every Codex card below, as main's host SENT it** — one conversation per frame, each on its
 * own scripted app-server, run once and torn down before any test reads it.
 */
beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-739-always-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-739-always-root-'))
  const window = new Window('webContents:1')
  const { host, db, servers } = aHostOverScriptedCodex(userData, { interruptWaitMs: 40 })
  const cardsOf = (sessionId: string): PermissionRequest[] =>
    window.messages
      .filter((message) => message.sessionId === sessionId)
      .map((message) => message.event)
      .filter((event): event is PermissionRequest => event.type === 'permission_request')

  const capture = async (
    raise: (server: ScriptedAppServer) => void,
    press?: PermissionOutcome,
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
    // ⚑ The host's own answer — `taken`, or its refusal — returned before anything is waited on.
    const ack =
      press === undefined
        ? null
        : await host.respondPermission(meta.sessionId, card.id, { outcome: press }, window)
    return {
      meta,
      messages: window.messages.filter((message) => message.sessionId === meta.sessionId),
      card,
      home: server.home,
      ack,
    }
  }

  const codexAsking =
    (persist: readonly string[]) =>
    (server: ScriptedAppServer): void => {
      server.announce('item/started', THE_CALL)
      server.raise(60, 'mcpServer/elicitation/request', codexAsks(persist))
    }
  const aCommand =
    (availableDecisions: unknown[]) =>
    (server: ScriptedAppServer): void => {
      server.raise(70, 'item/commandExecution/requestApproval', {
        itemId: 'item_cmd',
        command: PREFIX.join(' '),
        cwd: root,
        proposedExecpolicyAmendment: PREFIX,
        availableDecisions,
      })
    }

  try {
    captured.asks = await capture(codexAsking(['session', 'always']))
    captured.asksNoAlways = await capture(codexAsking(['session']))
    captured.keepRefused = await capture(codexAsking(['session', 'always']), 'allow_always')
    captured.pressedOnce = await capture(codexAsking(['session', 'always']), 'allow')
    captured.alwaysOnly = await capture(aCommand([THE_AMENDMENT, 'cancel']))
    captured.noAmendment = await capture(aCommand(['accept', 'cancel']))
    // ⚑ `739` round 2 (#2) — the same command offered a plain accept AND its prefix rule, and that
    // card answered *Approve* through the host.
    captured.acceptOrKeep = await capture(aCommand(['accept', THE_AMENDMENT, 'cancel']))
    captured.acceptOrKeepApproved = await capture(
      aCommand(['accept', THE_AMENDMENT, 'cancel']),
      'allow',
    )
    captured.serverAllowed = await capture(
      (server) => server.raise(52, 'mcpServer/elicitation/request', A_ZERO_FIELD_FORM),
      'allow',
    )
  } finally {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  }
})

/** ⚑ Where the card's *Always allow* is kept — the file the wire names, never typed. */
const keptFileOf = (one: Captured): string => {
  const file = one.card.scope.grants?.alwaysFile
  if (file === undefined) throw new Error('the host named no file for this card')
  return file
}

/* ------------------------------------------------------------------ the Claude cards (built) */

type Grants = NonNullable<PermissionRequest['scope']['grants']>

/**
 * ⚠️ **COMPOSED, not measured — `736`'s `rm` shape, which `740` made unreachable.** `736` measured
 * the SDK's suggestions for `rm -f zz736.txt` (the command, its folder, *accept edits*) and offered
 * *Always allow* on it; since `740` (R99, `736` F-9) an `rm` is offered its folder alone and no
 * *always* (`what-a-grant-covers.render.test.ts`' `RM_MEASURED`), and a Claude rule is kept in the
 * project's local settings, not the provider home's `settings.json` below. ⚑ Kept for its POINT —
 * the one fact no measured card carries: an *Always allow* whose press ALSO installs, for this
 * conversation, more than the rule it keeps (the wire's contract, `permissionGrantsSchema
 * .allow_always`) — and because its folder IS the conversation's (`/tmp/x`): 🔴 **`739` round 2
 * (#17)** — a folder rule for the conversation's own folder adds nothing, and beside a kept rule that
 * covers the request `740`'s *"so the same request is still asked"* would be false, so `keptGrantOf`
 * leaves it out of what the press also covers ({@link RM_ALSO}); one fact over, ANOTHER folder is said.
 */
const RM_GRANTS: Grants = {
  allow_for_session: [
    { kind: 'tool', tool: 'Bash', content: 'rm -f zz736.txt' },
    { kind: 'directory', path: '/tmp/x' },
    { kind: 'mode', mode: 'acceptEdits' },
  ],
  allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
  allow_always: [{ kind: 'tool', tool: 'Bash', content: 'rm -f zz736.txt' }],
  alwaysFile: '/tmp/x/home/settings.json',
}

const RM_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

/**
 * ⚑ **`740`'s MEASURED card** (R99, `736` F-4; on `main` since 5f406f2f): the CLI's *"Yes, and don't
 * ask again for: make build \*"* — the rule held for this conversation AND kept in the PROJECT's
 * `.claude/settings.local.json` — as the REAL `ClaudeRuntime` publishes it for `make build` in
 * `/tmp/x` (`claude-runtime.test.ts`' *"740 · R99 (`736` F-4) — `make build`’s rule is offered as
 * *always*, KEPT IN THE PROJECT…"*: the offer, `persistence: always` and these grants, verbatim).
 * ⚑ It offers the wholesale grant too — the card §7 reads.
 */
const FILE_740 = '/tmp/x/.claude/settings.local.json'
const MAKE_BUILD = { kind: 'tool', tool: 'Bash', content: 'make build *' } as const
/** That rule as a person reads it: the command with any further arguments, and the rule itself. */
const MAKE_BUILD_SAID = 'commands starting with make build (Bash(make build *))'
const MAKE_BUILD_GRANTS: Grants = {
  allow_for_session: [MAKE_BUILD],
  allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
  allow_always: [MAKE_BUILD],
  alwaysFile: FILE_740,
}
const MAKE_BUILD_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

function claudeCard(
  detail: string,
  availableDecisions: PermissionOutcome[],
  grants?: Grants,
): PermissionRequest {
  return {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail,
    scope: {
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      ...(grants === undefined ? {} : { grants }),
      amendments: [],
      availableDecisions,
      underDisclosed: true,
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

/** ⚑ A card one fact over — sent through main's wire and the fold. */
function wiredItem(
  provider: 'codex' | 'claude',
  event: PermissionRequest,
  ...more: TranscriptEvent[]
): PermissionItem {
  const state = createTranscript()
  applyEvent(state, toWireEvent(provider, event) satisfies TranscriptEvent, AT)
  for (const next of more) applyEvent(state, next, AT)
  const item = state.items.find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

/** ⚑ The captured card without one field — the world before `723`. */
function without(card: PermissionRequest, key: 'mcpToolCall'): PermissionRequest {
  const copy: Record<string, unknown> = { ...card }
  delete copy[key]
  return copy as PermissionRequest
}

/**
 * ⚑ **The captured MCP card, its tool a name the adapter could not clean** — `''` in the call, in the
 * action and in the rule each standing button installs, as `aToolApprovalCard` builds all three from
 * one `wordsForACard(approval.tool) ?? ''` (the 730 suite's own case, `when-codex-asks-to-run-an-mcp-
 * tool.render.test.ts`, carried to the rule). The server and the file are the host's, unchanged.
 */
function withNoToolName(sent: PermissionRequest): PermissionRequest {
  const rule = { kind: 'tool', tool: '', server: SERVER } as const
  return {
    ...sent,
    action: '',
    mcpToolCall: { ...sent.mcpToolCall!, tool: '' },
    scope: {
      ...sent.scope,
      grants: { ...sent.scope.grants, allow_all_for_session: [rule], allow_always: [rule] },
    },
  }
}

/** ⚑ The row Home draws for the conversation, off the real projection. */
function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const card = (item: PermissionItem, over: Record<string, unknown> = {}): Promise<string> =>
  render(PermissionCard, { item, provider: 'codex', ...over })

const renderHome = (row: AttentionRequest): Promise<string> =>
  render(AttentionQueue, { requests: [row], now: AT + 60_000 })

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

/** ⚑ How many elements carry this `data-cy`. */
const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

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
      /data-cy="permission-(allow|allow_for_session|allow_all_for_session|allow_always|deny|cancel)"/g,
    ),
  ].map((one) => one[1]!)

/**
 * ⚑ **The classes on a card's button for one outcome** — off its opening tag — or `[]` where there is
 * no such button (so an absent button fails an assertion, never a `TypeError`).
 */
function classesOf(markup: string, outcome: PermissionOutcome): string[] {
  const tag = new RegExp(`<button[^>]*data-cy="permission-${outcome}"[^>]*>`).exec(shown(markup))
  const classes = tag === null ? undefined : /class="([^"]*)"/.exec(tag[0])?.[1]
  return classes === undefined ? [] : classes.split(/\s+/).filter((one) => one !== '')
}

/** ⚑ The words on the card's buttons that say *always* — the row and the wholesale grant alike. */
const alwaysWordsOn = (markup: string): string[] =>
  buttonsOf(markup)
    .map((outcome) => wordOn(markup, outcome as PermissionOutcome) ?? '')
    .filter((word) => /always/i.test(word))

/** ⚑ The card, EXPANDED — a settled card folds its body away until a person opens it (034). */
const expanded = { draft: { answers: new Map(), sent: false, answered: false, open: true } }

/** ⚑ A decision exactly as a surface builds one for an outcome it adds nothing to. */
const plain = (outcome: PermissionOutcome): Extract<AttentionDecision, { kind: 'permission' }> => ({
  kind: 'permission',
  label: outcome,
  decision: permissionDecisionFor(outcome),
})

/** ⚑ The Home row's decision for one outcome, or `undefined` where the row offers none. */
const decisionFor = (
  row: AttentionRequest,
  outcome: PermissionOutcome,
): Extract<AttentionDecision, { kind: 'permission' }> | undefined =>
  row.decisions.find(
    (one): one is Extract<AttentionDecision, { kind: 'permission' }> =>
      one.kind === 'permission' && one.decision.outcome === outcome,
  )

/* ------------------------------------------------------------------ the words, verbatim ONCE */

/**
 * ⚑ **The line under *Always allow*, verbatim once** — the one action, that the provider's own rule
 * is kept beyond this conversation, then THE RULE and then the FILE the wire names. ⚑ Each subject
 * also composes it by the function every surface reads (`whatThisAnswerDoes` handed `keeps`, rule 5).
 * 🔴 **739 review · re-aimed — rule first**: it said *"…, in <file> — <rule>"*; the file's path is
 * long, and what is kept is what a person weighs, so the rule now leads (*"…: <rule>, in <file>"*).
 */
const THE_KEPT_LINE =
  'the agent may do this, and the provider’s own rule for it is kept beyond this conversation'
const keptLine = (rule: string, file: string): string => `${THE_KEPT_LINE}: ${rule}, in ${file}`
const mcpLine = (file: string): string => keptLine(`every ${TOOL} call on ${SERVER}`, file)
/** ⚑ The `kept grant` row and Home's scope line, verbatim once. */
const mcpKept = (file: string): string =>
  `beyond this conversation, its grant keeps: every ${TOOL} call on ${SERVER} — in ${file}`
/**
 * ⚑ What the (composed) Claude `rm` card's *Always allow* also installs for this conversation.
 * 🔴 **739 review · re-aimed**: *accept edits* says what was measured, the edits in the folders it
 * works in (`736`'s loopback). 🔴 **Round 2 (#17) · re-aimed again**: its folder IS the conversation's
 * (`/tmp/x`), and round 1 said it as *"working in /tmp/x — the folder it already works in, so the same
 * request is still asked"* — false after this press, which keeps (and installs for this conversation)
 * the rule that covers the request. ⚑ A folder that adds nothing is left out, so only the edits are.
 */
const RM_ALSO = 'every file edit in the folders it works in, without asking (accept edits)'
/** ⚑ One fact over — the same card, its folder ANOTHER one: that folder IS what the press adds. */
const RM_ELSEWHERE_GRANTS: Grants = {
  ...RM_GRANTS,
  allow_for_session: RM_GRANTS.allow_for_session!.map((rule) =>
    rule.kind === 'directory' ? { kind: 'directory', path: '/tmp/y' } : rule,
  ),
}
/**
 * ⚑ `740`'s host sentence for a failed keep — on `main` since 5f406f2f (`runtime-host.ts`'
 * `not-kept` arm; §0 reads it off the host). ⚑ Typed out here: data the renderer draws verbatim.
 */
const NOT_KEPT_740 =
  '“always” could not be kept, so nothing was sent — this request is still waiting'

/** ⚑ The line the card and Home compose for an *Always allow* that carries `keeps`. */
const keptLineBy = (keeps: KeptGrant): string =>
  whatThisAnswerDoes({ ...plain('allow_always'), keeps })

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the wire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · what main’s host sends — the premise every section below stands on', () => {
  it('⚑ Codex’s MCP card offers *Always allow* with the rule it keeps and the file it is kept in', () => {
    const { card: sent, home } = captured.asks
    expect(sent.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    expect(sent.scope.persistence).toBe('always')
    expect(sent.scope.grants?.allow_always).toEqual([{ kind: 'tool', tool: TOOL, server: SERVER }])
    expect(sent.scope.grants?.alwaysFile).toBe(join(home, 'brobot-kept-tool-approvals.json'))
    // ⚑ One fact over: Codex offered no `always`, and the card carries neither the answer nor its rule.
    const none = captured.asksNoAlways.card
    expect(none.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'deny',
      'cancel',
    ])
    expect(none.scope.grants?.allow_always).toBeUndefined()
    expect(none.scope.grants?.alwaysFile).toBeUndefined()
  })

  it('⚑ a Codex command whose ONLY accept is its prefix rule is offered *Always allow*, *Deny* and *Cancel* — the rule and `rules/default.rules` named', () => {
    const { card: sent, home } = captured.alwaysOnly
    expect(sent.scope.availableDecisions).toEqual(['allow_always', 'deny', 'cancel'])
    expect(sent.scope.noPositiveBecause).toBeUndefined()
    expect(sent.scope.grants).toEqual({
      allow_always: [{ kind: 'command-prefix', prefix: PREFIX }],
      alwaysFile: join(home, 'rules', 'default.rules'),
    })
    expect(sent.scope.amendments).toEqual([{ kind: 'exec', detail: PREFIX.join(' ') }])
    // ⚑ One fact over: no amendment offered — a plain accept, and no grant to keep.
    expect(captured.noAmendment.card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(captured.noAmendment.card.scope.grants).toBeUndefined()
    expect(captured.noAmendment.card.scope.amendments).toEqual(sent.scope.amendments)
  })

  it('⚑ `739` round 2 — a Codex command offered a plain accept AND its prefix rule: *Approve* · *Always allow* · *Deny* · *Cancel*, the same rule and file — and *Approve* pressed is taken and recorded', () => {
    const { card: sent, home } = captured.acceptOrKeep
    expect(sent.scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
    expect(sent.scope.grants).toEqual({
      allow_always: [{ kind: 'command-prefix', prefix: PREFIX }],
      alwaysFile: join(home, 'rules', 'default.rules'),
    })
    expect(sent.scope.amendments).toEqual([{ kind: 'exec', detail: PREFIX.join(' ') }])
    const approved = captured.acceptOrKeepApproved
    expect(approved.ack).toEqual({ outcome: 'taken' })
    expect(
      approved.messages
        .map((message) => message.event)
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event as { outcome: string }).outcome),
    ).toEqual(['allow'])
  })

  it('⚑ `736` F-6 — a keep that fails is refused, the request still waiting, and no decision is recorded', () => {
    const { ack, messages } = captured.keepRefused
    expect(ack?.outcome).toBe('refused')
    expect(ack?.outcome === 'refused' ? ack.stillOpen : null).toBe(true)
    expect(ack?.outcome === 'refused' ? ack.reason.length : 0).toBeGreaterThan(0)
    // ⚑ `740` (on `main` since 5f406f2f) — the host says a failed keep as one, in its own words.
    expect(ack?.outcome === 'refused' ? ack.reason : null).toBe(NOT_KEPT_740)
    expect(messages.some((message) => message.event.type === 'user_decision')).toBe(false)
    // ⚑ One fact over: *Allow once* on the same card is taken and recorded.
    expect(captured.pressedOnce.ack).toEqual({ outcome: 'taken' })
    expect(
      captured.pressedOnce.messages.filter((message) => message.event.type === 'user_decision'),
    ).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the card draws *Always allow*, and says what it keeps and where', () => {
  it('🔴 Codex’s MCP card: *Always allow* in the row, its line naming the rule AND the file verbatim, and the `kept grant` row', async () => {
    const one = captured.asks
    const html = await card(cardItem(one))
    const file = keptFileOf(one)
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel request*, and no *Always allow*.
    expect(buttonsOf(html)).toEqual([
      'allow',
      'allow_always',
      'deny',
      'cancel',
      'allow_all_for_session',
    ])
    // ⚑ Once verbatim — R95's word — and by the constant every surface says.
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    expect(wordOn(html, 'allow_always')).toBe(since739.ALWAYS_ALLOW)
    // ⚑ The line under it: the rule and the file, as the wire names them.
    const [line] = textsOf(html, 'permission-does-allow_always')
    expect(line).toBe(mcpLine(file))
    expect(line).toContain(file)
    expect(line).toBe(keptLineBy(since739.keptGrantOf(one.card.scope)!))
    // ⚑ …and the disclosure row, from the function Home reads too.
    expect(textsOf(html, 'permission-always-keeps')).toEqual([mcpKept(file)])
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      since739.keptGrantSaid(since739.keptGrantOf(one.card.scope)),
    ])
    // ⚑ The offer's own persistence: every button it summarises is drawn now.
    expect(textsOf(html, 'permission-persistence')).toEqual(['always'])
    // ⚑ …on a card that still says its other words.
    expect(wordOn(html, 'allow')).toBe('Allow once')
  })

  it('⚑ THE CONTROL — the card Codex offered no `always`: no *Always allow*, no `kept grant` row, and its other lines as they were', async () => {
    const html = await card(cardItem(captured.asksNoAlways))
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel', 'allow_all_for_session'])
    expect(wordOn(html, 'allow_always')).toBeUndefined()
    expect(count(html, 'permission-always-keeps')).toBe(0)
    expect(words(html)).not.toContain('beyond this conversation')
    // ⚑ The lines it does draw, each the one every surface says.
    expect(textsOf(html, 'permission-does-allow')).toEqual([whatThisAnswerDoes(plain('allow'))])
    expect(textsOf(html, 'permission-does-allow')).toEqual(['the agent may do this once'])
    expect(textsOf(html, 'permission-does-deny')).toEqual([whatThisAnswerDoes(plain('deny'))])
    expect(textsOf(html, 'permission-does-cancel')).toEqual([CANCEL_STOPS_NOTHING])
    expect(textsOf(html, 'permission-persistence')).toEqual(['session'])
  })

  it('🔴 the (composed) Claude `rm` card’s line adds what its press also covers for this conversation — the edits, and never its own folder, which adds nothing', async () => {
    const html = await card(
      wiredItem('claude', claudeCard('rm -f zz736.txt', RM_OFFER, RM_GRANTS)),
      { provider: 'claude' },
    )
    // ⛔ What `main` draws: no *Always allow*, no line.
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    const [line] = textsOf(html, 'permission-does-allow_always')
    expect(line).toBe(
      `${keptLine('Bash(rm -f zz736.txt)', '/tmp/x/home/settings.json')}; for this conversation it also covers: ${RM_ALSO}`,
    )
    expect(line).toBe(
      keptLineBy(
        since739.keptGrantOf({ availableDecisions: RM_OFFER, grants: RM_GRANTS, cwd: '/tmp/x' })!,
      ),
    )
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      `beyond this conversation, its grant keeps: Bash(rm -f zz736.txt) — in /tmp/x/home/settings.json; for this conversation it also covers: ${RM_ALSO}`,
    ])
    // ⛔ Round 2 (#17) — never *"the same request is still asked"* beside the rule that covers it,
    // under *Always allow* or in its row (each read beside the positive above, the whole line).
    for (const said of [line!, ...textsOf(html, 'permission-always-keeps')]) {
      expect(said).not.toContain('the same request is still asked')
      expect(said).not.toContain('working in /tmp/x')
    }
    // ⚑ In the row after the conversation's grant and before the refusals — the terminal's order.
    expect(buttonsOf(html)).toEqual([
      'allow',
      'allow_for_session',
      'allow_always',
      'deny',
      'cancel',
      'allow_all_for_session',
    ])
  })

  it('🔴 …one fact over, a folder that is NOT the conversation’s own IS said as what the press also covers', async () => {
    const html = await card(
      wiredItem('claude', claudeCard('rm -f zz736.txt', RM_OFFER, RM_ELSEWHERE_GRANTS)),
      { provider: 'claude' },
    )
    // ⛔ What `main` draws: no *Always allow*, no line.
    const [line] = textsOf(html, 'permission-does-allow_always')
    expect(line).toBe(
      `${keptLine('Bash(rm -f zz736.txt)', '/tmp/x/home/settings.json')}; for this conversation it also covers: working in /tmp/y; ${RM_ALSO}`,
    )
    expect(line).toBe(
      keptLineBy(
        since739.keptGrantOf({
          availableDecisions: RM_OFFER,
          grants: RM_ELSEWHERE_GRANTS,
          cwd: '/tmp/x',
        })!,
      ),
    )
  })

  // 🔴 **739 review · re-aimed onto `740`'s MEASURED card** — this read a `make build` shape `740`
  // had in flight (its own rule, no wholesale grant); `740` landed, so the card is the one the REAL
  // adapter publishes ({@link MAKE_BUILD_GRANTS}). ⚑ Its point is kept: the file is the WIRE's —
  // one fact over, another project's file is printed instead, and neither is typed into a word.
  it('🔴 `740`’s measured card: a Claude rule kept in the project’s local settings is printed as the wire names it — and a press that installs nothing more says nothing more', async () => {
    const html = await card(
      wiredItem('claude', claudeCard('make build', MAKE_BUILD_OFFER, MAKE_BUILD_GRANTS)),
      { provider: 'claude' },
    )
    // ⛔ What `main` draws: no line to print it in.
    expect(textsOf(html, 'permission-does-allow_always')).toEqual([
      keptLine(MAKE_BUILD_SAID, FILE_740),
    ])
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      `beyond this conversation, its grant keeps: ${MAKE_BUILD_SAID} — in ${FILE_740}`,
    ])
    // ⚑ One fact over — another project's file on the same wire — is printed as the wire names it.
    const elsewhere = '/work/other/.claude/settings.local.json'
    const moved = await card(
      wiredItem(
        'claude',
        claudeCard('make build', MAKE_BUILD_OFFER, { ...MAKE_BUILD_GRANTS, alwaysFile: elsewhere }),
      ),
      { provider: 'claude' },
    )
    expect(textsOf(moved, 'permission-does-allow_always')).toEqual([
      keptLine(MAKE_BUILD_SAID, elsewhere),
    ])
    expect(words(moved)).not.toContain(FILE_740)
    // ⛔ Never `736`'s provider-home file typed into a word.
    expect(words(html)).not.toContain('/home/settings.json')
  })

  it('🔴 a card offering *Always allow* with NO grants on the wire draws it with the line that names no rule and no file — never an empty list', async () => {
    const offer: PermissionOutcome[] = ['allow', 'allow_always', 'deny', 'cancel']
    const html = await card(wiredItem('claude', claudeCard('make build', offer)), {
      provider: 'claude',
    })
    // ⛔ What `main` draws: no *Always allow*.
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    // ⚑ Once verbatim — and it IS the line a decision that omits `keeps` says (a double that lags).
    expect(textsOf(html, 'permission-does-allow_always')).toEqual([THE_KEPT_LINE])
    expect(textsOf(html, 'permission-does-allow_always')).toEqual([
      whatThisAnswerDoes(plain('allow_always')),
    ])
    // ⚠️ Absent is not "nothing" (`permission.ts`): the row says the request did not name them.
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      'beyond this conversation, its grant keeps: the provider’s own rule for this, which this request does not name — where, this request does not say',
    ])
    expect(words(html)).not.toMatch(/keeps: —|, in —| — ;/)
  })

  /**
   * 🔴 **`739` round 2 (#3) — a server's tool with no clean name is *this tool*, never a gap.** The
   * rule's server arm put `rule.tool` straight into the words, so the line under *Always allow* and
   * the `kept grant` row read *"every  call on github"*; `730` gave every other sentence on this card
   * *this tool* ({@link withNoToolName}).
   */
  it("🔴 a server’s tool the adapter could not clean (`''`): the line under *Always allow*, the `kept grant` row and Home’s scope say *every call to this tool on github* — never a gap", async () => {
    const one = captured.asks
    const file = keptFileOf(one)
    const nameless = withNoToolName(one.card)
    const html = await card(wiredItem('codex', nameless))
    // ⛔ What `main` draws: no *Always allow*, no line.
    expect(textsOf(html, 'permission-does-allow_always')).toEqual([
      keptLine(`every call to this tool on ${SERVER}`, file),
    ])
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      `beyond this conversation, its grant keeps: every call to this tool on ${SERVER} — in ${file}`,
    ])
    // ⚑ Home's row, off the same card through the one door, says the card's words.
    const record = createSessionRecord('sess_nameless')
    record.meta = { ...one.meta, sessionId: 'sess_nameless' }
    record.phase = 'open'
    acceptEvent(record, {
      sessionId: 'sess_nameless',
      ordinal: 0,
      at: AT,
      event: toWireEvent('codex', nameless) satisfies TranscriptEvent,
    })
    const row = homeRow(record)
    expect(row.scope).toContain(
      `beyond this conversation, its grant keeps: every call to this tool on ${SERVER} — in ${file}`,
    )
    expect(whatThisAnswerDoes(decisionFor(row, 'allow_always')!)).toBe(
      keptLine(`every call to this tool on ${SERVER}`, file),
    )
    // ⛔ No gap anywhere a person reads: *"every  call"*, *"on on"*, or an empty tool before *on*.
    for (const said of [words(html), row.scope.join('\n')]) {
      expect(said).not.toMatch(/ {2}|every call on| on on /)
    }
  })

  it('⚑ THE CONTROL — the same card with its tool named says the tool, and *this tool* nowhere', async () => {
    const html = await card(cardItem(captured.asks))
    // ⚑ The sentence both trees draw that names the tool — the wholesale grant's warning (`730`).
    expect(textsOf(html, 'permission-wide-warning')[0]).toContain(
      `every call to ${TOOL} on ${SERVER}`,
    )
    expect(words(html)).not.toContain('this tool')
  })

  it('🔴 a Codex command whose ONLY accept keeps its prefix rule draws *Always allow* and NO cannot-allow sentence — and its proposal says which answer keeps it', async () => {
    const one = captured.alwaysOnly
    const html = await card(cardItem(one))
    const file = keptFileOf(one)
    // ⛔ What `main` draws: no button, and *"… BroBot does not offer that choice yet."*
    expect(count(html, 'permission-cannot-allow')).toBe(0)
    expect(buttonsOf(html)).toEqual(['allow_always', 'deny', 'cancel'])
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    expect(textsOf(html, 'permission-does-allow_always')).toEqual([
      keptLine(`commands starting with ${PREFIX.join(' ')}`, file),
    ])
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      `beyond this conversation, its grant keeps: commands starting with ${PREFIX.join(' ')} — in ${file}`,
    ])
    // ⚑ The proposal is not *"not applied here"* on the card whose Always allow applies it.
    expect(words(html)).not.toContain('proposed, not applied here')
    expect(textsOf(html, 'permission-proposed')).toEqual([
      `exec: ${PREFIX.join(' ')} — only Always allow keeps a rule here, the one under “kept grant”`,
    ])
  })

  it('⚑ THE CONTROL — the same command with no amendment offered: no *Always allow*, and its proposal is *not applied here*', async () => {
    const html = await card(cardItem(captured.noAmendment))
    expect(buttonsOf(html)).toEqual(['allow', 'deny', 'cancel'])
    expect(wordOn(html, 'allow')).toBe('Approve')
    expect(count(html, 'permission-always-keeps')).toBe(0)
    expect(count(html, 'permission-cannot-allow')).toBe(0)
    expect(words(html)).toContain(`proposed, not applied here exec: ${PREFIX.join(' ')}`)
  })

  it('⚑ `keeps` is read beside *Always allow* only — handed to another outcome it moves nothing', () => {
    const keeps: KeptGrant = {
      rules: 'Bash(make build)',
      file: FILE_740,
      alsoForThisConversation: null,
    }
    for (const outcome of ['allow', 'allow_for_session', 'deny', 'cancel'] as const) {
      expect(whatThisAnswerDoes({ ...plain(outcome), keeps }), outcome).toBe(
        whatThisAnswerDoes(plain(outcome)),
      )
    }
    expect(whatThisAnswerDoes({ ...plain('allow'), keeps })).toBe('the agent may do this once')
  })

  /**
   * 🔴 **739 review (findings 14 and 19) — *Always allow* is never the filled default.** 058 kept
   * the wholesale grant out of *"the filled primary style the approve buttons carry, so nothing
   * about it reads as the expected next click"*; a grant that outlives the conversation is drawn
   * the same way (`PermissionCard`'s `keptBeyond`). ⚠️ The always-only command card is the case it
   * protects: there *Always allow* is the ONE allowing button, and filled it would be the default.
   */
  it('🔴 *Always allow* is drawn OUTLINED — `approve-quiet`, never the filled `approve` — on Codex’s MCP card and on the always-only command card', async () => {
    for (const [name, one] of [
      ['the MCP card', captured.asks],
      ['the always-only command card', captured.alwaysOnly],
    ] as const) {
      const html = await card(cardItem(one))
      // ⛔ What `main` draws: no *Always allow* button at all — no classes to read.
      expect(classesOf(html, 'allow_always'), name).toContain('approve-quiet')
      expect(classesOf(html, 'allow_always'), name).not.toContain('approve')
      expect(classesOf(html, 'allow_always'), name).toContain('btn')
    }
  })

  it('⚑ THE CONTROL — the plain answer on the same request IS the filled `approve`: the MCP card’s *Allow once*, and the command with no amendment’s *Approve*', async () => {
    const mcp = await card(cardItem(captured.asks))
    expect(wordOn(mcp, 'allow')).toBe('Allow once')
    expect(classesOf(mcp, 'allow')).toContain('approve')
    expect(classesOf(mcp, 'allow')).not.toContain('approve-quiet')
    // ⚑ One fact over from the always-only card: the same command, offered a plain accept.
    const command = await card(cardItem(captured.noAmendment))
    expect(wordOn(command, 'allow')).toBe('Approve')
    expect(classesOf(command, 'allow')).toContain('approve')
    expect(classesOf(command, 'allow')).not.toContain('approve-quiet')
    // ⚑ …and the refusals keep their own style beside it.
    expect(classesOf(command, 'deny')).toContain('deny')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · Home
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · Home’s row offers *Always allow*, with the card’s own line', () => {
  // 🔴 743 · re-aimed — since `739` F-1 was ruled, the conversation's grant (*Allow for this
  // conversation*) follows the row on this surface too, so every list below ends with it.
  it('🔴 the MCP row offers *Allow once* · *Always allow* · *Deny* · *Cancel*, the line under *Always allow* is the card’s, and its scope says what is kept', async () => {
    const one = captured.asks
    const row = homeRow(recordOf(one))
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel*.
    expect(row.decisions.map((each) => each.label)).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    const always = decisionFor(row, 'allow_always')
    expect(always, 'the row offers no Always allow').toBeDefined()
    expect(always!.label).toBe(since739.ALWAYS_ALLOW)
    // ⚑ The card's small IS Home's sentence — one function, handed the same `keeps`.
    const cardHtml = await card(cardItem(one))
    expect(whatThisAnswerDoes(always!)).toBe(textsOf(cardHtml, 'permission-does-allow_always')[0])
    expect(whatThisAnswerDoes(always!)).toBe(mcpLine(keptFileOf(one)))
    // ⚑ …and the kept line in the row's scope, the card's `kept grant` row's words.
    expect(row.scope).toContain(mcpKept(keptFileOf(one)))
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-decide-word')).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(textsOf(html, 'attention-effect')[1]).toBe(mcpLine(keptFileOf(one)))
    expect(words(html)).toContain(mcpKept(keptFileOf(one)))
  })

  it('⚑ THE CONTROL — the row for the card Codex offered no `always` keeps *Allow once* · *Deny* · *Cancel*, and no kept line', async () => {
    const row = homeRow(recordOf(captured.asksNoAlways))
    expect(row.decisions.map((each) => each.label)).toEqual([
      'Allow once',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(decisionFor(row, 'allow_always')).toBeUndefined()
    expect(row.scope.join('\n')).not.toContain('beyond this conversation')
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-decide-word')).toEqual([
      'Allow once',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
  })

  it('🔴 the always-only command row offers *Always allow* and says no cannot-allow sentence — its proposal says which answer keeps it', async () => {
    const one = captured.alwaysOnly
    const row = homeRow(recordOf(one))
    // ⛔ What `main` draws: *Deny* · *Cancel*, under *"… BroBot does not offer that choice yet."*
    expect(row.noPositive).toBeNull()
    expect(row.decisions.map((each) => each.label)).toEqual(['Always allow', 'Deny', 'Cancel'])
    expect(whatThisAnswerDoes(decisionFor(row, 'allow_always')!)).toBe(
      keptLine(`commands starting with ${PREFIX.join(' ')}`, keptFileOf(one)),
    )
    expect(row.scope).toContain(
      `proposed for future exec: ${PREFIX.join(' ')} — only Always allow keeps a rule here, the one said above`,
    )
    const html = await renderHome(row)
    expect(count(html, 'attention-cannot-allow')).toBe(0)
    expect(textsOf(html, 'attention-decide-word')).toEqual(['Always allow', 'Deny', 'Cancel'])
  })

  it('⚑ THE CONTROL — the same command with no amendment offered keeps *Allow* and its proposal *not applied by any answer here*', () => {
    const row = homeRow(recordOf(captured.noAmendment))
    expect(row.decisions.map((each) => each.label)).toEqual(['Allow', 'Deny', 'Cancel'])
    expect(row.scope).toContain(
      `proposed for future exec, not applied by any answer here: ${PREFIX.join(' ')}`,
    )
  })

  it('🔴 pressed from Home, *Always allow* sends the plain outcome — rebuilt off a Vue-deep world, carried by the wire, and nothing it only SAYS goes with it', () => {
    const row = homeRow(recordOf(captured.asks))
    const always = decisionFor(row, 'allow_always')
    // ⛔ What `main` offers: no such decision to press.
    expect(always, 'the row offers no Always allow').toBeDefined()
    // ⚑ As the person's queue holds it — a deep `ref`, so every object on it is a Proxy.
    const world = ref({ decisions: [always!] })
    const answer = answerFor(world.value.decisions[0]!)
    expect(answer).toEqual({ permission: { outcome: 'allow_always' } })
    expect(asTheWireWouldCarry('739 · Always allow from Home', answer)).toEqual({
      permission: { outcome: 'allow_always' },
    })
    expect(JSON.stringify(answer)).not.toContain('keeps')
  })

  it('⚑ THE CONTROL — *Allow once* from the same row sends its own plain outcome', () => {
    const row = homeRow(recordOf(captured.asks))
    const once = decisionFor(row, 'allow')
    expect(once).toBeDefined()
    const world = ref({ decisions: [once!] })
    expect(
      asTheWireWouldCarry('739 · Allow once from Home', answerFor(world.value.decisions[0]!)),
    ).toEqual({ permission: { outcome: 'allow' } })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the person’s queue offers *Always allow* with the same line', () => {
  // 🔴 743 · re-aimed — since `739` F-1 was ruled, the conversation's grant (*Allow for this
  // conversation*) follows the row on this surface too, so every list below ends with it.
  afterEach(() => {
    usePersonsQueue().forget()
  })

  /** ⚑ The decision the host's walk hands the queue — `725`'s shape (`730`'s suite). */
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
   * answer's button, or the line a primary answer's button is described by (*"Allow once: …"*).
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

  it('🔴 the queue’s row for the MCP card offers *Always allow*, under the line the card and Home say', async () => {
    const one = captured.asks
    const live = homeRow(recordOf(one))
    const row = supply([live]).find((each) => each.key === live.key)
    expect(row, 'the person’s queue drew no row').toBeDefined()
    const answers = answersOn(await render(PersonsQueue, {}), live.key)
    // ⛔ What `main` draws: *Allow once* · *Deny* · *Cancel* — the request's own two first, then the
    // broader choices under more options, in the card's order.
    expect(answers.map((each) => each.word)).toEqual([
      'Allow once',
      'Deny',
      'Always allow',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(answers.find((each) => each.word === 'Always allow')?.says).toBe(
      mcpLine(keptFileOf(one)),
    )
  })

  it('⚑ THE CONTROL — the row for the card Codex offered no `always` keeps its three answers', async () => {
    const live = homeRow(recordOf(captured.asksNoAlways))
    supply([live])
    const answers = answersOn(await render(PersonsQueue, {}), live.key)
    expect(answers.map((each) => each.word)).toEqual([
      'Allow once',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
    expect(answers[0]?.says).toBe(whatThisAnswerDoes(plain('allow')))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · Home's refusal — `736` F-6
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · `736` F-6 — a keep that failed is said on the row it was pressed from', () => {
  // 🔴 743 · re-aimed — the conversation's grant follows the row here too (`739` F-1, ruled).
  /** ⚑ The conversation after the host refused the press — marked as the store marks it (`noteAnswer`). */
  function refusedWith(reason: string): SessionRecord {
    const one = captured.keepRefused
    const record = recordOf(one)
    markAnswerRefused(record.transcript, one.card.id, reason)
    if (record.control !== record.transcript) markAnswerRefused(record.control, one.card.id, reason)
    return record
  }

  const theHostsReason = (): string => {
    const { ack } = captured.keepRefused
    if (ack?.outcome !== 'refused') throw new Error('the host took the answer')
    return ack.reason
  }

  it('🔴 Home draws the host’s own reason, verbatim, on the row that is still waiting — its buttons back beside it', async () => {
    const reason = theHostsReason()
    const row = homeRow(refusedWith(reason))
    expect(row.refused).toBe(reason)
    const html = await renderHome(row)
    // ⛔ What `main` draws: the buttons back, and nothing said.
    expect(textsOf(html, 'attention-refused')).toEqual([reason])
    expect(textsOf(html, 'attention-decide-word')).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Cancel',
      'Allow for this conversation',
    ])
  })

  it('🔴 `740`’s sentence for a failed keep flows through as the host says it — the renderer writes none of its own', async () => {
    const html = await renderHome(homeRow(refusedWith(NOT_KEPT_740)))
    expect(textsOf(html, 'attention-refused')).toEqual([NOT_KEPT_740])
  })

  it('⚑ THE CONTROL — the card drew the same reason already; a row nobody refused draws none', async () => {
    const reason = theHostsReason()
    const refused = refusedWith(reason).transcript.items.find((each) => each.kind === 'permission')
    if (refused?.kind !== 'permission') throw new Error('no card')
    expect(textsOf(await card(refused), 'permission-refused')).toEqual([reason])
    // ⚑ One fact over: the same row, no refusal on it.
    const row = homeRow(recordOf(captured.asks))
    expect(row.refused).toBeNull()
    const html = await renderHome(row)
    expect(count(html, 'attention-refused')).toBe(0)
    expect(textsOf(html, 'attention-decide-word')[0]).toBe('Allow once')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the read-back — `737` F-5
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · `737` F-5 — what a settled card says was granted, and for how long', () => {
  it('🔴 Codex’s MCP card answered *Allow once* reads back *Allowed once* — never *Approved*', async () => {
    const item = cardItem(captured.pressedOnce)
    // ⚑ The premise, off main's own host: the press was recorded as `allow`.
    expect(item.outcome).toBe('allow')
    const html = await card(item)
    // ⛔ What `main` draws: *Approved*, a word no button on this card says.
    expect(textsOf(html, 'permission-verdict')).not.toEqual(['Approved'])
    expect(textsOf(html, 'permission-verdict')).toEqual(['Allowed once'])
    expect(textsOf(html, 'permission-verdict')).toEqual([since739.ALLOWED_ONCE])
  })

  it('⚑ THE CONTROL — the plain card reads *Approved*, a server’s card *Allowed*, and an *Always allow* its own verdict', async () => {
    const decided = (requestId: string, outcome: PermissionOutcome): TranscriptEvent => ({
      type: 'user_decision',
      requestId,
      outcome,
      by: { who: 'a-person' },
    })
    const sent = captured.pressedOnce.card
    // ⚑ One fact over: the same request without `mcpToolCall`, its button *Approve*.
    const plainCard = wiredItem('codex', without(sent, 'mcpToolCall'), decided(sent.id, 'allow'))
    expect(textsOf(await card(plainCard), 'permission-verdict')).toEqual(['Approved'])
    // ⚑ A server's own form, answered *Allow* off main's host (`737` review).
    const server = cardItem(captured.serverAllowed)
    expect(server.outcome).toBe('allow')
    expect(textsOf(await card(server), 'permission-verdict')).toEqual(['Allowed'])
    // ⚑ The MCP card answered *Always allow* — kept beyond this conversation, as it says.
    const kept = wiredItem('codex', sent, decided(sent.id, 'allow_always'))
    expect(textsOf(await card(kept), 'permission-verdict')).toEqual([
      'Always allowed, beyond this conversation',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · the settled card, expanded — review finding 11
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **739 review (finding 11) — a settled card's `kept grant` row only where *Always allow* was the
 * answer** (the pending card draws it whenever *Always allow* is offered, §1). The expanded body of an answered card is where a person goes *"to find out what they
 * agreed to"* (the verdict's own comment); a card answered *Allow once*, *Deny* or *Cancel*, or
 * settled by its turn's end, kept nothing — a row saying *"beyond this conversation, its grant
 * keeps: …"* there would say something was kept that never was.
 *
 * 🔴 **Round 2 (#2, #16) — and the proposal that POINTS at that row, on the same terms.** On a
 * Codex command card whose *Always allow* keeps its prefix rule, the proposal reads *"only Always
 * allow keeps a rule here, the one under “kept grant”"* — and round 1 hid that row on a settled card
 * answered anything else, leaving the pointer aimed at nothing. ⚑ Now the pointer is drawn only where
 * the row is (pending, or answered *Always allow*); a card answered *Approve*, *Deny* or *Cancel*
 * applied no rule, so its proposal reads as `main`'s — *proposed, not applied here*.
 */
describe('§6 · the settled card, expanded — the `kept grant` row only where *Always allow* was the answer', () => {
  const decidedOn = (card: PermissionRequest, outcome: PermissionOutcome): TranscriptEvent => ({
    type: 'user_decision',
    requestId: card.id,
    outcome,
    by: { who: 'a-person' },
  })
  const decided = (outcome: PermissionOutcome): TranscriptEvent =>
    decidedOn(captured.asks.card, outcome)
  /** ⚑ The proposal as `main` heads it — the words every settled card that kept nothing draws. */
  const notAppliedHere = `proposed, not applied here exec: ${PREFIX.join(' ')}`
  /** ⚑ The pointer at the `kept grant` row — drawn only where that row is. */
  const pointer = `exec: ${PREFIX.join(' ')} — only Always allow keeps a rule here, the one under “kept grant”`

  // ⚑ **THE PIN, green on `main` by construction** — `main` draws a `kept grant` row on no card at
  // all, so this absence cannot be RED there; it is the reading that kills the settled clause being
  // dropped (`keptSaid !== null` alone drew the row on every card here). ⚑ Beside a reading the same
  // markup holds: the body IS drawn (its one persistence row). ⚠️ It does not pin what that row
  // says — the offer's summary, not the answer — which is not this finding's subject.
  it('⚑ THE PIN — answered *Allow once* (off main’s own host), *Deny*, *Cancel*, or settled by its turn’s end: the expanded body is drawn, and NO `kept grant` row', async () => {
    const once = cardItem(captured.pressedOnce)
    // ⚑ The premise, off main's own host: the press was recorded as `allow`, on a card offering always.
    expect(once.outcome).toBe('allow')
    expect(once.request.scope.availableDecisions).toContain('allow_always')
    const settled: [string, PermissionItem][] = [
      ['Allow once', once],
      ['Deny', wiredItem('codex', captured.asks.card, decided('deny'))],
      ['Cancel', wiredItem('codex', captured.asks.card, decided('cancel'))],
      [
        'the turn’s end',
        wiredItem('codex', captured.asks.card, {
          type: 'turn',
          state: 'interrupted',
        } as TranscriptEvent),
      ],
    ]
    for (const [answer, item] of settled) {
      expect(item.outcome !== null || item.note !== null, `${answer} settled the card`).toBe(true)
      const html = await card(item, expanded)
      // ⚑ The body is drawn…
      expect(count(html, 'permission-persistence'), answer).toBe(1)
      // ⛔ …and nothing kept: no `kept grant` row, no sentence of it.
      expect(count(html, 'permission-always-keeps'), answer).toBe(0)
      expect(words(html), answer).not.toContain('its grant keeps')
    }
  })

  it('🔴 answered *Always allow*: the expanded body keeps the `kept grant` row — the rule and the file it was kept in', async () => {
    const item = wiredItem('codex', captured.asks.card, decided('allow_always'))
    expect(item.outcome).toBe('allow_always')
    const html = await card(item, expanded)
    // ⛔ What `main` draws: no `kept grant` row on any card.
    expect(textsOf(html, 'permission-always-keeps')).toEqual([mcpKept(keptFileOf(captured.asks))])
    expect(textsOf(html, 'permission-verdict')).toEqual([
      'Always allowed, beyond this conversation',
    ])
  })

  // ⚑ **THE PINS, green on `main` by construction** — `main` draws no pointer and no `kept grant` row
  // on any card, and heads every proposal *proposed, not applied here*; these are the readings that
  // kill the settled clause being dropped from the pointer (`keptRuleSaid` as `keepsARule` alone drew
  // *"… the one under “kept grant”"* over every card here, with no such row on it).
  it('⚑ THE PIN (round 2 #2) — a prefix-rule command card answered *Approve* (off main’s own host) or *Deny*, expanded: *proposed, not applied here*, no pointer, no `kept grant` row', async () => {
    const approved = cardItem(captured.acceptOrKeepApproved)
    // ⚑ The premise, off main's own host: *Approve* recorded, on a card whose Always allow keeps a rule.
    expect(approved.outcome).toBe('allow')
    expect(approved.request.scope.grants?.allow_always?.[0]?.kind).toBe('command-prefix')
    const settled: [string, PermissionItem][] = [
      ['Approve', approved],
      [
        'Deny',
        wiredItem(
          'codex',
          captured.acceptOrKeep.card,
          decidedOn(captured.acceptOrKeep.card, 'deny'),
        ),
      ],
    ]
    for (const [answer, item] of settled) {
      expect(item.outcome !== null, `${answer} settled the card`).toBe(true)
      const html = await card(item, expanded)
      // ⚑ The body is drawn, its proposal headed as one no answer here applied…
      expect(count(html, 'permission-persistence'), answer).toBe(1)
      expect(words(html), answer).toContain(notAppliedHere)
      // ⛔ …and nothing points at a row that is not there.
      expect(count(html, 'permission-proposed'), answer).toBe(0)
      expect(words(html), answer).not.toContain('the one under “kept grant”')
      expect(count(html, 'permission-always-keeps'), answer).toBe(0)
    }
  })

  it('⚑ THE PIN (round 2 #16) — the always-only command card answered *Deny* or *Cancel*, expanded: *proposed, not applied here*, no pointer, no `kept grant` row', async () => {
    const sent = captured.alwaysOnly.card
    for (const answer of ['deny', 'cancel'] as const) {
      const item = wiredItem('codex', sent, decidedOn(sent, answer))
      expect(item.outcome, answer).toBe(answer)
      const html = await card(item, expanded)
      expect(count(html, 'permission-persistence'), answer).toBe(1)
      expect(words(html), answer).toContain(notAppliedHere)
      expect(count(html, 'permission-proposed'), answer).toBe(0)
      expect(words(html), answer).not.toContain('the one under “kept grant”')
      expect(count(html, 'permission-always-keeps'), answer).toBe(0)
    }
  })

  it('🔴 the always-only command card answered *Always allow*, expanded: the pointer AND the `kept grant` row it points at', async () => {
    const one = captured.alwaysOnly
    const item = wiredItem('codex', one.card, decidedOn(one.card, 'allow_always'))
    expect(item.outcome).toBe('allow_always')
    const html = await card(item, expanded)
    // ⛔ What `main` draws: no `kept grant` row, and *proposed, not applied here* over the rule kept.
    expect(textsOf(html, 'permission-always-keeps')).toEqual([
      `beyond this conversation, its grant keeps: commands starting with ${PREFIX.join(' ')} — in ${keptFileOf(one)}`,
    ])
    expect(textsOf(html, 'permission-proposed')).toEqual([pointer])
    expect(words(html)).not.toContain('proposed, not applied here')
  })

  it('⚑ THE CONTROL — the settled *Allow once* card, expanded, draws its body (one persistence row, its verdict); folded, no body at all', async () => {
    const item = cardItem(captured.pressedOnce)
    const open = await card(item, expanded)
    expect(count(open, 'permission-persistence')).toBe(1)
    expect(textsOf(open, 'permission-verdict')).toHaveLength(1)
    // ⚑ One fact over — the same card folded — draws the verdict and no body.
    const folded = await card(item)
    expect(count(folded, 'permission-persistence')).toBe(0)
    expect(textsOf(folded, 'permission-verdict')).toEqual(textsOf(open, 'permission-verdict'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §7 · the two grants on one card — review findings 6, 12 and 30
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **739 review (findings 6, 12, 30) — *Always* belongs to the grant that is KEPT.** Since R95
 * *Always allow* is the grant that outlives the conversation, and `740`'s measured `make build` card
 * offers it beside the wholesale grant (058), which ENDS with the conversation. ⛔ On `main` that
 * one said *"Always allow Bash this session"* and read back *"Always allowed this session"* — two
 * buttons, on one card, both starting *Always*, lasting opposite lengths of time. ⚑ It says what it
 * does now, in `ruleSaid`'s words for a whole-tool rule: *every Bash call*, for this
 * conversation — as R80 already made the MCP card's conversation grant say (730).
 */
describe('§7 · a card offering the wholesale grant AND *Always allow* says *Always* once — of the kept one', () => {
  const makeBuild = (...more: TranscriptEvent[]): PermissionItem =>
    wiredItem('claude', claudeCard('make build', MAKE_BUILD_OFFER, MAKE_BUILD_GRANTS), ...more)

  it('🔴 the card: ONE button says *Always* — *Always allow* — and the wholesale grant reads *Allow every Bash call for this conversation*', async () => {
    const html = await card(makeBuild(), { provider: 'claude' })
    // ⚑ The premise: both grants are drawn, the wholesale one apart.
    expect(buttonsOf(html)).toContain('allow_always')
    expect(buttonsOf(html)).toContain('allow_all_for_session')
    // ⛔ What `main` draws: *Always allow Bash this session*, and no *Always allow* in the row.
    expect(alwaysWordsOn(html)).toEqual(['Always allow'])
    expect(wordOn(html, 'allow_always')).toBe('Always allow')
    expect(wordOn(html, 'allow_all_for_session')).toBe(
      'Allow every Bash call for this conversation',
    )
  })

  it('🔴 pressed, the wholesale grant reads back *Allowed every Bash call for this conversation* — never *always*', async () => {
    const decided: TranscriptEvent = {
      type: 'user_decision',
      requestId: 'req_1',
      outcome: 'allow_all_for_session',
      by: { who: 'a-person' },
    }
    const html = await card(makeBuild(decided), { provider: 'claude' })
    // ⛔ What `main` draws: *Always allowed this session*.
    expect(textsOf(html, 'permission-verdict')).toEqual([
      'Allowed every Bash call for this conversation',
    ])
    expect(textsOf(html, 'permission-verdict')[0]).not.toMatch(/always/i)
  })

  it('🔴 Home: its row says *Always* once — *Always allow* — and offers the wholesale grant in the card’s words', async () => {
    const record = createSessionRecord('sess_make')
    record.meta = { ...captured.asks.meta, sessionId: 'sess_make', provider: 'claude' }
    record.phase = 'open'
    acceptEvent(record, {
      sessionId: 'sess_make',
      ordinal: 0,
      at: AT,
      event: toWireEvent(
        'claude',
        claudeCard('make build', MAKE_BUILD_OFFER, MAKE_BUILD_GRANTS),
      ) satisfies TranscriptEvent,
    })
    const row = homeRow(record)
    // ⛔ What `main` draws: *Allow* · *Allow for this conversation* · *Deny* · *Cancel*, under
    // *"Always allow Bash this session is not offered here …"*.
    expect(row.decisions.map((one) => one.label).filter((label) => /always/i.test(label))).toEqual([
      'Always allow',
    ])
    // 🔴 743 · re-aimed — since `739` F-1 was ruled the wholesale grant is on the row (it pinned the
    // sentence saying where it was), in the card's words, and neither its word nor its warning says
    // *always*.
    const wide = row.decisions.at(-1)!
    expect(wide.label).toBe('Allow every Bash call for this conversation')
    expect(wide.kind === 'permission' ? wide.warns : null).toMatch(
      /^⚠ Covers any Bash command for this conversation — /,
    )
    expect(JSON.stringify(wide)).not.toMatch(/always/i)
  })

  it('⚑ THE CONTROL — the wholesale grant still names its tool from the request, and never reads back as the conversation grant’s *Allowed for this conversation* (058)', async () => {
    const html = await card(makeBuild(), { provider: 'claude' })
    expect(wordOn(html, 'allow_all_for_session')).toBe(since739.wideGrantLabel('Bash'))
    expect(wordOn(html, 'allow_all_for_session')).toContain('Bash')
    const decided: TranscriptEvent = {
      type: 'user_decision',
      requestId: 'req_1',
      outcome: 'allow_all_for_session',
      by: { who: 'a-person' },
    }
    const settled = await card(makeBuild(decided), { provider: 'claude' })
    expect(textsOf(settled, 'permission-verdict')).toHaveLength(1)
    expect(textsOf(settled, 'permission-verdict')).not.toEqual(['Allowed for this conversation'])
  })
})
