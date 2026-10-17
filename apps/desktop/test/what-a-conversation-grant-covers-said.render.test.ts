import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  askedOfTheChannel,
  CHANNEL_REFUSAL_SENTENCES,
  ClaudeRuntime,
  CodexRuntime,
  type ClaudeQuery,
  type PermissionOutcome,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  ALLOW_FOR_THIS_CONVERSATION,
  conversationGrantSaid,
  permissionDecisionFor,
} from '../src/renderer/src/lib/permission-offer'
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
import type { PermissionItem } from '../src/renderer/src/lib/transcript'
import {
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
  DEFAULT_PROFILE_ID,
  type CreatedSession,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ScriptedAppServer, waitFor } from './lib/scripted-codex-host'

/**
 * # 🔴 739 · Draw 3 — the conversation grant says what its rule covers (`726` F-14, R94)
 *
 * ⚑ **The finding, verbatim** (`726` §9, F-14): *"On a read outside the folder, the grant is the
 * CLI's own suggestion: a DIRECTORY rule, measured. The card says *"this, and the same thing
 * again"*. It is the provider's own semantics (R92), but the words understate it, and that is the
 * person's copy for its surface owner."*
 *
 * ⚑ **The ruling it answers, verbatim** (`739` §1): *"**R94:** a grant is the CLI's own suggested
 * rule for the ask, and the card's words say what the rule covers."*
 *
 * ⚠️ **The quoted words are already gone on `main`** — `736` replaced them with
 * *"the agent may do this, and what the provider’s own rule for it covers, for this conversation"*
 * — so a negative over *"the same thing again"* passes on both trees and proves nothing. ⚑ Every
 * subject below asserts the NEW positive words: the rule, said, under the button on all three
 * surfaces, and a Claude folder rule in its CLI's own row (*"allow reading from <dir>"*, `736` §1).
 *
 * | § | surface | 🔴 subject (RED on `main` 5f406f2f) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 0 | the wire | — | the REAL `ClaudeRuntime` publishes a read outside the folder with the CLI's `Read(//elsewhere/**)` as `grants.allow_for_session`, and a Write with *accept edits*; the REAL `CodexRuntime` publishes a file card offering the conversation grant with NO `grants` — each equal to the literal the DOM suite mounts |
 * | 1 | the card | the line under *Allow for this conversation* names the rule, and the `conversation grant` row says the folder in the CLI's words; a Write card's line names the edits in the folders it works in (*accept edits*); an `rm`'s folder grant (`740`, measured) says it adds nothing | the same read card with no `grants` (a row before `736`) and the Codex file card keep `main`'s line, with no `conversation grant` row |
 * | 2 | Home | the effect under *Allow for this conversation* names the rule, and the scope line says the folder | the same two cards keep `main`'s line |
 * | 3 | the person's queue | the line under *Allow for this conversation* names the rule — the queue copies Home's decision | the same two cards keep `main`'s line |
 * | 4 | all three | one sentence on the card, Home and the queue, and it is the rule's | the card's line IS Home's line on every card here — the join holds on both trees |
 * | 5 | the rule's words | `conversationGrantCovers` (new) says the rules or `null`; `whatThisAnswerDoes` composes the line from `covers`; *accept edits* says what was measured — the edits in the folders it works in, never *every file edit* | a Bash rule, a Read rule whose path is not `//<dir>/**`, and an `Edit` over a folder are said RAW; a decision with no `covers` keeps `main`'s line |
 *
 * ⚠️ **What `main` (5f406f2f) draws instead, measured**: under the conversation grant on every
 * surface, *"the agent may do this, and what the provider’s own rule for it covers, for this
 * conversation"* whatever the card's rules; and the card's and Home's disclosure
 * *"for this conversation, its grant covers: Read(//elsewhere/**)"* — the rule in the CLI's own
 * syntax, with no folder named in words; and *accept edits* as *"every file edit, without asking"*.
 *
 * ⚠️ **`conversationGrantCovers` is a NEW export** of a module `main` has: it is reached only INSIDE
 * subjects, by a dynamic `import()`, and asserted to be a function before it is called — so on
 * `main` that subject fails on an assertion, not a `TypeError`, and the controls still run.
 * ⚑ **`covers` is a NEW renderer-only field** of `AttentionDecision`: a decision built without it is
 * the double that omits the field, and §5 shows it keeps `main`'s line.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — each reading is taken off the ELEMENT (the
 * button's `<small>`, the `dd`, the scope `li`) with the templates' comments stripped, and each
 * absence sits beside a reading the same markup does hold. The engine's half — the line drawn whole
 * at 972 px in a conversation and on Home — is
 * `test/dom/what-a-conversation-grant-covers-said.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/* ------------------------------------------------------------------ the words, verbatim ONCE */

/** ⚑ `main`'s line under the conversation grant — kept, byte for byte, where no rule is carried. */
const MAINS_LINE =
  'the agent may do this, and what the provider’s own rule for it covers, for this conversation'

/** ⚑ The CLI's own row for a read outside the folder (`736` §1), with the rule kept beside it. */
const READ_SAID = 'reading from /elsewhere (Read(//elsewhere/**))'

/**
 * ⚑ *Accept edits*, in words for what was MEASURED. 🔴 **739 review · re-aimed** (findings 1 and 13):
 * it said *"every file edit, without asking"* — but `736`'s loopback ran the next edit in the
 * conversation's folder unasked and ASKED one outside it, and since `739` these words are the line
 * under the conversation grant on every surface, not only the disclosure row.
 */
const EDITS_SAID = 'every file edit in the folders it works in, without asking (accept edits)'
/** ⛔ `main`'s words for the same rule — an edit anywhere, which was not what was measured. */
const MAINS_EDITS_SAID = 'every file edit, without asking (accept edits)'

/** ⚑ The line under the conversation grant where the card names its rule — the clause, then it. */
const LINE_WITH = (covers: string): string =>
  `the agent may do this, and for this conversation what the provider’s own rule for it covers: ${covers}`

/** ⚑ The card's and Home's disclosure — `conversationGrantSaid`'s prefix, which `main` has. */
const DISCLOSED = (covers: string): string => `for this conversation, its grant covers: ${covers}`

/** ⚑ The new export — read inside subjects only (see the header). */
const since739 = (): Promise<typeof import('../src/renderer/src/lib/permission-offer')> =>
  import('../src/renderer/src/lib/permission-offer')

/* ------------------------------------------------------------------ the cards, as the adapters publish them */

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>

const READ_OFFER: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']

/**
 * ⚑ **A Claude read outside the folder, as the adapter publishes it** — the CLI suggested its own
 * directory rule (`the-cli-decides-what-to-ask.test.ts`, `736`'s loopback), held to the session.
 * §0 pins this literal to the REAL `ClaudeRuntime`'s card; the DOM suite mounts the same literal.
 */
const READ_OUTSIDE: PermissionRequest = {
  type: 'permission_request',
  id: 'tu_read',
  kind: 'command',
  action: 'Read',
  detail: '/elsewhere/n.txt',
  scope: {
    cwd: '/tmp/x',
    paths: ['/elsewhere/n.txt'],
    networkHosts: [],
    persistence: 'session',
    grants: { allow_for_session: [{ kind: 'tool', tool: 'Read', content: '//elsewhere/**' }] },
    amendments: [],
    availableDecisions: READ_OFFER,
    underDisclosed: false,
    approvalMode: 'ask',
  },
}

/** ⚑ The same card with no `grants` — a row written before `736`, one fact over. */
function withoutGrants(card: PermissionRequest): PermissionRequest {
  const { grants: _dropped, ...scope } = card.scope
  void _dropped
  return { ...card, scope }
}

/** ⚑ The same card, its conversation grant carrying other rules — one fact over, at the rule. */
function withRules(
  card: PermissionRequest,
  rules: NonNullable<NonNullable<PermissionRequest['scope']['grants']>['allow_for_session']>,
): PermissionRequest {
  return { ...card, scope: { ...card.scope, grants: { allow_for_session: rules } } }
}

/** ⚑ The CLI's suggestion for a read outside the folder — what the SDK hands `canUseTool`. */
const READ_SUGGESTS = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }],
    behavior: 'allow',
    destination: 'session',
  },
]
/** ⚑ …and for a Write: the CLI's own *allow all edits*. */
const WRITE_SUGGESTS = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]

/** The SDK `Query` stand-in: scripted messages in. */
class FakeQuery implements ClaudeQuery {
  readonly messages = new AsyncQueue<SDKMessage>()
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/** The adapters' own cards, captured once in `beforeAll`. */
const captured: {
  read: PermissionRequest
  write: PermissionRequest
  codexFile: PermissionRequest
} = {} as never

const homes: string[] = []

/**
 * ⚑ **One Claude card, as the REAL adapter publishes it** — a live session with a turn open, the
 * CLI's `canUseTool` called with its own suggestions. ⚠️ The call is left PARKED and never awaited
 * (a pending promise is not a result); `close()` settles it.
 */
async function claudeCard(
  tool: string,
  input: Record<string, unknown>,
  suggestions: unknown[],
  toolUseID: string,
): Promise<PermissionRequest> {
  const home = mkdtempSync(join(tmpdir(), 'brobot2-739-claude-'))
  homes.push(home)
  const query = new FakeQuery()
  let canUse: CanUseTool | undefined
  const runtime = new ClaudeRuntime(
    (params: { options: Options }) => {
      canUse = params.options.canUseTool
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: home })
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  if (canUse === undefined) throw new Error('the adapter wired no canUseTool')
  await handle.send('go')
  query.messages.push({
    type: 'system',
    subtype: 'init',
    session_id: 'claude_1',
    cwd: '/tmp/x',
  } as unknown as SDKMessage)
  await waitFor(() => events.some((one) => one.type === 'session'), 'the session event')
  void canUse(tool, input, {
    signal: new AbortController().signal,
    toolUseID,
    suggestions,
  } as never).catch(() => undefined)
  await waitFor(() => events.some((one) => one.type === 'permission_request'), 'the card')
  const card = events.find((one): one is PermissionRequest => one.type === 'permission_request')!
  await handle.close()
  return card
}

/** ⚑ The file card the REAL `CodexRuntime` publishes for a patch it announced two frames earlier. */
async function codexFileCard(): Promise<PermissionRequest> {
  const home = mkdtempSync(join(tmpdir(), 'brobot2-739-codex-'))
  homes.push(home)
  let server: ScriptedAppServer | undefined
  const runtime = new CodexRuntime(() => {
    server = new ScriptedAppServer(home)
    return server
  })
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: home })
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  await handle.send('write the notes')
  await waitFor(() => server?.sent('turn/start').length === 1, 'the first turn')
  await new Promise((resolve) => setTimeout(resolve, 20))
  server!.announce('item/started', {
    item: {
      type: 'fileChange',
      id: 'it_9',
      changes: [{ path: '/tmp/x/notes.txt', kind: { type: 'add' }, diff: '@@' }],
      status: 'pending',
    },
  })
  await waitFor(() => events.some((one) => one.type === 'tool_call'), 'the patch item')
  server!.raise(57, 'item/fileChange/requestApproval', { itemId: 'it_9', startedAtMs: 0 })
  await waitFor(() => events.some((one) => one.type === 'permission_request'), 'the card')
  const card = events.find((one): one is PermissionRequest => one.type === 'permission_request')!
  await handle.close()
  return card
}

beforeAll(async () => {
  captured.read = await claudeCard(
    'Read',
    { file_path: '/elsewhere/n.txt' },
    READ_SUGGESTS,
    'tu_read',
  )
  captured.write = await claudeCard(
    'Write',
    { file_path: '/tmp/x/a.txt', content: 'x' },
    WRITE_SUGGESTS,
    'tu_write',
  )
  captured.codexFile = await codexFileCard()
})

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ folding and reading */

/** ⚑ A conversation's meta as the host echoes it — `test/dom/harness.ts`' `META`, in node. */
function metaOf(provider: 'claude' | 'codex', sessionId: string): CreatedSession {
  return {
    sessionId,
    provider,
    cwd: '/tmp/x',
    providerHome: `/homes/${provider}`,
    profileId: DEFAULT_PROFILE_ID,
    ref: { provider, sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
    config: {
      home: `/homes/${provider}`,
      homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
      model: provider === 'codex' ? 'gpt-5-codex' : 'claude-opus-5',
      authNote: null,
      files: [],
    },
    instructions: {
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    },
    approvalMode: 'ask',
    pendingApprovalMode: null,
    approvalNote: 'Asks before consequential actions',
    blanketGrants: [],
    planNeedsGoAhead: false,
    settings: {
      model: null,
      pendingModel: null,
      reasoningEffort: null,
      pendingReasoningEffort: null,
      planMode: false,
      pendingPlanMode: null,
    },
    queued: [],
    liveness: { state: 'live', since: AT },
    hasACommander: false,
    startedWithoutAWindow: false,
    mayHandItBack: false,
  }
}

/**
 * ⚑ **A conversation frozen on the card, as the window's store holds it** — every row through the
 * wire's own parse (`toWireEvent`, which strips a field the schema does not declare) and the one
 * door (`acceptEvent`).
 */
function frozenOn(
  card: PermissionRequest,
  provider: 'claude' | 'codex' = 'claude',
  sessionId = 'sess_1',
): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = metaOf(provider, sessionId)
  record.phase = 'open'
  let ordinal = record.nextOrdinal
  for (const event of [
    { type: 'session', state: 'started', ref: record.meta.ref },
    { type: 'user_turn', text: 'what is in the notes?' },
    { type: 'status', state: 'working' },
    toWireEvent(provider, card),
    { type: 'status', state: 'waiting_permission' },
  ] as TranscriptEvent[]) {
    acceptEvent(record, { sessionId, ordinal, at: AT + ordinal, event })
    ordinal = record.nextOrdinal
  }
  return record
}

/** ⚑ The card the conversation holds for its one request. */
function cardItem(record: SessionRecord): PermissionItem {
  const item = record.transcript.items.find((each) => each.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const renderCard = (card: PermissionRequest, provider: 'claude' | 'codex' = 'claude') =>
  render(PermissionCard, { item: cardItem(frozenOn(card, provider)), provider })

/** ⚑ What a person reads — the templates carry their reasoning inline, as comments. */
const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ⚑ Every text an element with this `data-cy` holds, decoded, in document order. */
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

/** ⚑ The one line under the card's conversation-grant button — asserted to be drawn once. */
function cardLine(markup: string): string {
  const lines = textsOf(markup, 'permission-does-allow_for_session')
  expect(lines, 'the card draws one line under its conversation grant').toHaveLength(1)
  return lines[0]!
}

/** ⚑ The row Home draws for the conversation, off the real projection. */
function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's decision for the conversation grant — asserted to be offered under its word. */
function homesGrant(row: AttentionRequest): Extract<AttentionDecision, { kind: 'permission' }> {
  const grant = row.decisions.find(
    (one) => one.kind === 'permission' && one.decision.outcome === 'allow_for_session',
  )
  if (grant?.kind !== 'permission') throw new Error('Home offers no conversation grant')
  expect(grant.label).toBe(ALLOW_FOR_THIS_CONVERSATION)
  return grant
}

/** ⚑ Home's buttons as drawn: each word, and the line under it. */
async function homeButtons(row: AttentionRequest): Promise<{ word: string; says: string }[]> {
  const html = shown(await render(AttentionQueue, { requests: [row], now: AT + 60_000 }))
  return [
    ...html.matchAll(
      /data-cy="attention-decide-word"[^>]*>([\s\S]*?)<\/strong>[\s\S]*?data-cy="attention-effect"[^>]*>([\s\S]*?)<\/small>/g,
    ),
  ].map((one) => ({
    word: decode(one[1]!.trim()),
    says: decode(one[2]!.trim()).replace(/\s+/g, ' '),
  }))
}

/** ⚑ Home's line under *Allow for this conversation*, as drawn — asserted to be drawn once. */
async function homeLine(row: AttentionRequest): Promise<string> {
  const under = (await homeButtons(row)).filter((one) => one.word === ALLOW_FOR_THIS_CONVERSATION)
  expect(under, 'Home draws one conversation grant').toHaveLength(1)
  return under[0]!.says
}

/** ⚑ Home's scope lines, as drawn. */
async function homeScope(row: AttentionRequest): Promise<string[]> {
  const html = shown(await render(AttentionQueue, { requests: [row], now: AT + 60_000 }))
  const list = /data-cy="attention-scope"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1]
  expect(list, 'Home drew no scope list').toBeDefined()
  return [...list!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((one) =>
    decode(one[1]!.trim()).replace(/\s+/g, ' '),
  )
}

/* ------------------------------------------------------------------ the person's queue */

/**
 * ⚑ **A spawned child's decision, in the shape main's walk writes TODAY** — the refusal read off the
 * channel's own classifier over the card the adapter sent (a permission decision is a person's),
 * and the vocabulary's sentence for it.
 */
function decisionFor(row: AttentionRequest, sent: PermissionRequest): PersonsDecision {
  const verdict = askedOfTheChannel(sent)
  if (verdict === null || verdict.travels) throw new Error('the channel let a permission travel')
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

/** ⚑ The queue's line under *Allow for this conversation*, as drawn — asserted to be drawn once. */
async function queueLine(row: AttentionRequest, sent: PermissionRequest): Promise<string> {
  queueOver(row, sent)
  const html = shown(await render(PersonsQueue, {}))
  // One button at a time: the conversation grant is a broader choice, with its line inside it.
  const under = [
    ...html.matchAll(
      new RegExp(
        `<button[^>]*data-cy="persons-queue-answer-${escapeRegExp(row.key)}"[^>]*>([\\s\\S]*?)</button>`,
        'g',
      ),
    ),
  ]
    .map((one) => ({
      word: decode(/<strong[^>]*>([\s\S]*?)<\/strong>/.exec(one[1]!)?.[1]?.trim() ?? ''),
      says: decode(/<small[^>]*>([\s\S]*?)<\/small>/.exec(one[1]!)?.[1]?.trim() ?? ''),
    }))
    .filter((one) => one.word === ALLOW_FOR_THIS_CONVERSATION)
  expect(under, 'the queue draws one conversation grant').toHaveLength(1)
  return under[0]!.says.replace(/\s+/g, ' ')
}

afterEach(() => {
  usePersonsQueue().forget()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the wire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · what the adapters publish — the premise every section below stands on', () => {
  it('⚑ the REAL Claude adapter publishes a read outside the folder with the CLI’s own directory rule as the conversation grant — the literal the DOM suite mounts', () => {
    expect(captured.read).toEqual(READ_OUTSIDE)
  })

  it('⚑ …a Write with the CLI’s *accept edits*, and the REAL Codex adapter a file card offering the conversation grant with NO rules', () => {
    expect(captured.write.scope.availableDecisions).toEqual(READ_OFFER)
    expect(captured.write.scope.grants).toEqual({
      allow_for_session: [{ kind: 'mode', mode: 'acceptEdits' }],
    })
    // ⚑ The double that omits the field is the adapter's own card here: Codex says no rule.
    expect(captured.codexFile.scope.availableDecisions).toContain('allow_for_session')
    expect(captured.codexFile.scope.grants).toBeUndefined()
    expect(captured.codexFile.kind).toBe('file')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the card — the line under *Allow for this conversation* names the rule it installs', () => {
  it('🔴 a read outside the folder: the line says the folder in the CLI’s words, and the `conversation grant` row too', async () => {
    const html = await renderCard(captured.read)
    // ⚑ The premise, off the same markup: the button is drawn, under its own word.
    expect(wordOn(html, 'allow_for_session')).toBe('Allow for this conversation')
    // ⛔ `main`: *"… what the provider’s own rule for it covers, for this conversation"*.
    // ⚑ `expect.soft`, so `main` is measured on both readings, not only the first.
    expect.soft(cardLine(html)).toBe(LINE_WITH(READ_SAID))
    // ⛔ `main`: *"for this conversation, its grant covers: Read(//elsewhere/**)"*.
    expect.soft(textsOf(html, 'permission-grant-covers')).toEqual([DISCLOSED(READ_SAID)])
  })

  it('🔴 a Write: the line names the edits in the folders it works in — the CLI’s own *accept edits*, as measured', async () => {
    const html = await renderCard(captured.write)
    expect(cardLine(html)).toBe(LINE_WITH(EDITS_SAID))
    expect(cardLine(html)).not.toContain(MAINS_EDITS_SAID)
  })

  /**
   * ⚑ **`740`'s measured `rm`** (R99, `736` F-9; `what-a-grant-covers.render.test.ts`' `RM_MEASURED`):
   * the interactive CLI's own choice is the command's FOLDER — here the folder the conversation
   * already works in, so the same `rm` is asked again. `740` said so in the disclosure; since `739`
   * the same words are the line under the button, so `conversationGrantCovers` hands the scope's
   * `cwd` to `ruleSaid` too. ⚑ The adapter offers no such grant, so only a card saved with one
   * carries it.
   */
  it('🔴 an `rm` whose grant is the conversation’s own folder (`740`, measured): the line says it adds nothing — never *"working in <folder>"* as if that covered the `rm`', async () => {
    const rm: PermissionRequest = {
      ...READ_OUTSIDE,
      id: 'tu_rm',
      action: 'Bash',
      detail: 'rm -f zz736.txt',
      scope: {
        ...READ_OUTSIDE.scope,
        paths: [],
        grants: {
          allow_for_session: [{ kind: 'directory', path: '/tmp/x' }],
          allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
        },
        availableDecisions: [
          'allow',
          'allow_for_session',
          'allow_all_for_session',
          'deny',
          'cancel',
        ],
        underDisclosed: true,
      },
    }
    const said =
      'working in /tmp/x — the folder it already works in, so the same request is still asked'
    // ⛔ What `main` draws: *"… what the provider’s own rule for it covers, for this conversation"*.
    expect(cardLine(await renderCard(rm))).toBe(LINE_WITH(said))
    expect(await homeLine(homeRow(frozenOn(rm)))).toBe(LINE_WITH(said))
  })

  it('⚑ THE CONTROL — the same read card with no `grants` (a row before `736`) keeps `main`’s line, and draws no `conversation grant` row', async () => {
    const html = await renderCard(withoutGrants(captured.read))
    expect(cardLine(html)).toBe(MAINS_LINE)
    expect(textsOf(html, 'permission-grant-covers')).toEqual([])
    // ⚑ …beside a reading the same markup holds: the scope's persistence row.
    expect(textsOf(html, 'permission-persistence')).toEqual(['session'])
  })

  it('⚑ THE CONTROL — the Codex file card, which carries no rule, keeps `main`’s line', async () => {
    const html = await renderCard(captured.codexFile, 'codex')
    expect(cardLine(html)).toBe(MAINS_LINE)
    expect(textsOf(html, 'permission-grant-covers')).toEqual([])
    expect(textsOf(html, 'permission-persistence')).toEqual(['session'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · Home
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · Home — the effect under *Allow for this conversation* names the rule', () => {
  it('🔴 a read outside the folder: the effect and the scope line both say the folder in the CLI’s words', async () => {
    const row = homeRow(frozenOn(captured.read))
    // ⛔ `main`: the same line as the card's, *"… for this conversation"*.
    expect.soft(await homeLine(row)).toBe(LINE_WITH(READ_SAID))
    expect.soft(whatThisAnswerDoes(homesGrant(row))).toBe(LINE_WITH(READ_SAID))
    const scope = await homeScope(row)
    // ⛔ `main`: *"for this conversation, its grant covers: Read(//elsewhere/**)"*.
    expect.soft(scope).toContain(DISCLOSED(READ_SAID))
    // ⚑ …beside the line the same list held before `739`: the grant lasts the conversation.
    expect(scope).toContain('for the whole conversation, not just this action')
  })

  it('⚑ THE CONTROL — the same card with no `grants`, and the Codex file card, keep `main`’s line on Home', async () => {
    for (const [card, provider] of [
      [withoutGrants(captured.read), 'claude'],
      [captured.codexFile, 'codex'],
    ] as const) {
      const row = homeRow(frozenOn(card, provider))
      expect(await homeLine(row), provider).toBe(MAINS_LINE)
      expect(whatThisAnswerDoes(homesGrant(row)), provider).toBe(MAINS_LINE)
      expect(
        (await homeScope(row)).filter((line) => line.startsWith('for this conversation, its')),
      ).toEqual([])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the person’s queue — it copies Home’s decision, and so its line', () => {
  it('🔴 a spawned child’s read outside the folder: the queue’s line under *Allow for this conversation* names the rule', async () => {
    const live = homeRow(frozenOn(captured.read))
    expect(await queueLine(live, captured.read)).toBe(LINE_WITH(READ_SAID))
  })

  it('⚑ THE CONTROL — the same card with no `grants`, and the Codex file card, keep `main`’s line in the queue', async () => {
    for (const [card, provider] of [
      [withoutGrants(captured.read), 'claude'],
      [captured.codexFile, 'codex'],
    ] as const) {
      const live = homeRow(frozenOn(card, provider))
      expect(await queueLine(live, card), provider).toBe(MAINS_LINE)
      usePersonsQueue().forget()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · all three
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the card, Home and the queue — one sentence for one grant', () => {
  it('🔴 the read card’s line is ONE sentence on all three surfaces, and it is the rule’s', async () => {
    const onTheCard = cardLine(await renderCard(captured.read))
    const live = homeRow(frozenOn(captured.read))
    const onHome = await homeLine(live)
    const onTheQueue = await queueLine(live, captured.read)
    expect(new Set([onTheCard, onHome, onTheQueue])).toEqual(new Set([LINE_WITH(READ_SAID)]))
  })

  it('⚑ THE JOIN — on every card here, the card’s line IS Home’s line for the same request (both trees)', async () => {
    for (const [card, provider] of [
      [captured.read, 'claude'],
      [captured.write, 'claude'],
      [withoutGrants(captured.read), 'claude'],
      [captured.codexFile, 'codex'],
    ] as const) {
      const onTheCard = cardLine(await renderCard(card, provider))
      const onHome = await homeLine(homeRow(frozenOn(card, provider)))
      expect(onTheCard, `${provider} ${card.action}`).toBe(onHome)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the rule's words
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the rule, in words — one derivation, and only the `//<dir>/**` form is a folder', () => {
  it('🔴 `conversationGrantCovers` says the rules the conversation grant installs, or `null` where there are none to say', async () => {
    const { conversationGrantCovers } = await since739()
    expect(typeof conversationGrantCovers, 'the derivation is exported').toBe('function')
    expect(conversationGrantCovers(READ_OUTSIDE.scope)).toBe(READ_SAID)
    // ⚑ …`null` where the grant is not offered, or carries no rules (never an empty *covers:*).
    expect(
      conversationGrantCovers({ ...READ_OUTSIDE.scope, availableDecisions: ['allow', 'deny'] }),
    ).toBeNull()
    expect(conversationGrantCovers(withoutGrants(READ_OUTSIDE).scope)).toBeNull()
    expect(conversationGrantCovers(withRules(READ_OUTSIDE, []).scope)).toBeNull()
    // ⚑ rule 5 — the disclosure is built on it: `main`'s prefix, then the same words.
    expect(conversationGrantSaid(READ_OUTSIDE.scope)).toBe(
      DISCLOSED(conversationGrantCovers(READ_OUTSIDE.scope)!),
    )
  })

  it('🔴 `whatThisAnswerDoes` composes the line from the decision’s `covers`', () => {
    const decision = {
      kind: 'permission',
      label: ALLOW_FOR_THIS_CONVERSATION,
      decision: permissionDecisionFor('allow_for_session'),
      covers: READ_SAID,
    } as AttentionDecision
    expect(whatThisAnswerDoes(decision)).toBe(LINE_WITH(READ_SAID))
  })

  it('⚑ THE CONTROL — a decision with no `covers` (the double that omits the field) keeps `main`’s line, and `covers` beside another outcome moves nothing', () => {
    expect(
      whatThisAnswerDoes({
        kind: 'permission',
        label: ALLOW_FOR_THIS_CONVERSATION,
        decision: permissionDecisionFor('allow_for_session'),
      }),
    ).toBe(MAINS_LINE)
    const allowOnce = whatThisAnswerDoes({
      kind: 'permission',
      label: 'Approve',
      decision: permissionDecisionFor('allow'),
    })
    expect(
      whatThisAnswerDoes({
        kind: 'permission',
        label: 'Approve',
        decision: permissionDecisionFor('allow'),
        covers: READ_SAID,
      } as AttentionDecision),
    ).toBe(allowOnce)
    expect(allowOnce).toBe('the agent may do this once')
  })

  // 🔴 **739 review · re-aimed** — this control also pinned *accept edits* as *"every file edit"*;
  // the review bounded those words to what was measured, so they differ between the trees and moved
  // to the subject below. ⚑ The raw rules stay here, as they were, green on both.
  it('⚑ THE CONTROL — a Bash rule, a Read rule whose path is not `//<dir>/**`, and an `Edit` over a folder are said RAW', async () => {
    const said = (rules: Parameters<typeof withRules>[1]): string | null =>
      conversationGrantSaid(withRules(READ_OUTSIDE, rules).scope)
    expect(said([{ kind: 'tool', tool: 'Bash', content: 'rm -f x' }])).toBe(
      DISCLOSED('Bash(rm -f x)'),
    )
    // ⚠️ A single `/` is relative to the settings file in Claude's rule syntax — not a folder.
    expect(said([{ kind: 'tool', tool: 'Read', content: '/src/**' }])).toBe(
      DISCLOSED('Read(/src/**)'),
    )
    // ⚑ One file, not a folder — no `/**`.
    expect(said([{ kind: 'tool', tool: 'Read', content: '//elsewhere/n.txt' }])).toBe(
      DISCLOSED('Read(//elsewhere/n.txt)'),
    )
    // ⚑ Only a READ rule is *reading from* — an edit rule over the same folder is said as it is.
    expect(said([{ kind: 'tool', tool: 'Edit', content: '//elsewhere/**' }])).toBe(
      DISCLOSED('Edit(//elsewhere/**)'),
    )
    // ⚑ …and on the card, the same raw rule in its `conversation grant` row.
    const html = await renderCard(
      withRules(captured.read, [{ kind: 'tool', tool: 'Read', content: '/src/**' }]),
    )
    expect(textsOf(html, 'permission-grant-covers')).toEqual([DISCLOSED('Read(/src/**)')])
  })

  it('🔴 *accept edits* says what was measured — the edits in the folders it works in, never *every file edit* — in the disclosure, on the card and on Home', async () => {
    // ⛔ What `main` says: *"every file edit, without asking (accept edits)"*.
    expect(
      conversationGrantSaid(withRules(READ_OUTSIDE, [{ kind: 'mode', mode: 'acceptEdits' }]).scope),
    ).toBe(DISCLOSED(EDITS_SAID))
    const write = await renderCard(captured.write)
    expect(textsOf(write, 'permission-grant-covers')).toEqual([DISCLOSED(EDITS_SAID)])
    expect(await homeScope(homeRow(frozenOn(captured.write)))).toContain(DISCLOSED(EDITS_SAID))
    expect(decode(shown(write))).not.toContain(MAINS_EDITS_SAID)
  })

  it('🔴 a raw rule is still named under the button — the line says the rule, whatever its form', async () => {
    const html = await renderCard(
      withRules(captured.read, [{ kind: 'tool', tool: 'Read', content: '/src/**' }]),
    )
    expect(cardLine(html)).toBe(LINE_WITH('Read(/src/**)'))
    const row = homeRow(
      frozenOn(withRules(captured.read, [{ kind: 'tool', tool: 'Bash', content: 'rm -f x' }])),
    )
    expect(await homeLine(row)).toBe(LINE_WITH('Bash(rm -f x)'))
  })
})
