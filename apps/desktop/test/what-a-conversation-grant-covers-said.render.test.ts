import type { LedgerWalk, PersonsDecision } from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
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
  type PermissionOutcome,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { ClaudeRuntime, type ClaudeQuery } from '@brobot2/runtime/claude'
import { CodexRuntime } from '@brobot2/runtime/codex'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  ALLOW_FOR_THIS_CONVERSATION,
  conversationGrantCovers,
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
import { decisionReading, readingSentence } from '../src/shared/questions'
import { DEFAULT_PROFILE_ID, type CreatedSession } from '../src/shared/runtime-ipc'
import { ScriptedAppServer, waitFor } from './lib/scripted-codex-host'

const AT = 1_700_000_000_000

const LINE_WITHOUT_RULE =
  'the agent may do this, and what the provider’s own rule for it covers, for this conversation'

const READ_SAID = 'reading from /elsewhere (Read(//elsewhere/**))'

const EDITS_SAID = 'every file edit in the folders it works in, without asking (accept edits)'

const LINE_WITH = (covers: string): string =>
  `the agent may do this, and for this conversation what the provider’s own rule for it covers: ${covers}`

const DISCLOSED = (covers: string): string => `for this conversation, its grant covers: ${covers}`

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>

const READ_OFFER: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']

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

function withoutGrants(card: PermissionRequest): PermissionRequest {
  const { grants: _dropped, ...scope } = card.scope
  void _dropped
  return { ...card, scope }
}

function withRules(
  card: PermissionRequest,
  rules: NonNullable<NonNullable<PermissionRequest['scope']['grants']>['allow_for_session']>,
): PermissionRequest {
  return { ...card, scope: { ...card.scope, grants: { allow_for_session: rules } } }
}

const READ_SUGGESTS = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }],
    behavior: 'allow',
    destination: 'session',
  },
]
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

const captured: {
  read: PermissionRequest
  write: PermissionRequest
  codexFile: PermissionRequest
} = {} as never

const homes: string[] = []

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

function cardItem(record: SessionRecord): PermissionItem {
  const item = record.transcript.items.find((each) => each.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const renderCard = (card: PermissionRequest, provider: 'claude' | 'codex' = 'claude') =>
  render(PermissionCard, { item: cardItem(frozenOn(card, provider)), provider })

const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const textsOf = (markup: string, cy: string): string[] =>
  [
    ...shown(markup).matchAll(new RegExp(`data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map((one) => decode(one[1]!.trim()).replace(/\s+/g, ' '))

function wordOn(markup: string, outcome: PermissionOutcome): string | undefined {
  const button = new RegExp(`data-cy="permission-${outcome}"[^>]*>([\\s\\S]*?)</button>`).exec(
    shown(markup),
  )?.[1]
  const strong =
    button === undefined ? undefined : /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(button)?.[1]
  return strong === undefined ? undefined : decode(strong.trim())
}

function cardLine(markup: string): string {
  const lines = textsOf(markup, 'permission-does-allow_for_session')
  expect(lines, 'the card draws one line under its conversation grant').toHaveLength(1)
  return lines[0]!
}

function homeRow(record: SessionRecord): AttentionRequest {
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

function homesGrant(row: AttentionRequest): Extract<AttentionDecision, { kind: 'permission' }> {
  const grant = row.decisions.find(
    (one) => one.kind === 'permission' && one.decision.outcome === 'allow_for_session',
  )
  if (grant?.kind !== 'permission') throw new Error('Home offers no conversation grant')
  expect(grant.label).toBe(ALLOW_FOR_THIS_CONVERSATION)
  return grant
}

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

async function homeLine(row: AttentionRequest): Promise<string> {
  const under = (await homeButtons(row)).filter((one) => one.word === ALLOW_FOR_THIS_CONVERSATION)
  expect(under, 'Home draws one conversation grant').toHaveLength(1)
  return under[0]!.says
}

async function homeScope(row: AttentionRequest): Promise<string[]> {
  const html = shown(await render(AttentionQueue, { requests: [row], now: AT + 60_000 }))
  const list = /data-cy="attention-scope"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1]
  expect(list, 'Home drew no scope list').toBeDefined()
  return [...list!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((one) =>
    decode(one[1]!.trim()).replace(/\s+/g, ' '),
  )
}

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

async function queueLine(row: AttentionRequest, sent: PermissionRequest): Promise<string> {
  queueOver(row, sent)
  const html = shown(await render(PersonsQueue, {}))
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

describe('§0 · what the adapters publish — the premise every section below stands on', () => {
  it('the REAL Claude adapter publishes a read outside the folder with the CLI’s own directory rule as the conversation grant', () => {
    expect(captured.read).toEqual(READ_OUTSIDE)
  })

  it('…a Write with the CLI’s *accept edits*, and the REAL Codex adapter a file card offering the conversation grant with NO rules', () => {
    expect(captured.write.scope.availableDecisions).toEqual(READ_OFFER)
    expect(captured.write.scope.grants).toEqual({
      allow_for_session: [{ kind: 'mode', mode: 'acceptEdits' }],
    })
    expect(captured.codexFile.scope.availableDecisions).toContain('allow_for_session')
    expect(captured.codexFile.scope.grants).toBeUndefined()
    expect(captured.codexFile.kind).toBe('file')
  })
})

describe('§1 · the card — the line under *Allow for this conversation* names the rule it installs', () => {
  it('a read outside the folder: the line says the folder in the CLI’s words, and the `conversation grant` row too', async () => {
    const html = await renderCard(captured.read)
    expect(wordOn(html, 'allow_for_session')).toBe('Allow for this conversation')
    expect(cardLine(html)).toBe(LINE_WITH(READ_SAID))
    expect(textsOf(html, 'permission-grant-covers')).toEqual([DISCLOSED(READ_SAID)])
  })

  it('a Write: the line names the edits in the folders it works in — the CLI’s own *accept edits*, as measured', async () => {
    const html = await renderCard(captured.write)
    expect(cardLine(html)).toBe(LINE_WITH(EDITS_SAID))
  })

  it('an `rm` whose grant is the conversation’s own folder: the line says it adds nothing — never *"working in <folder>"* as if that covered the `rm`', async () => {
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
    expect(cardLine(await renderCard(rm))).toBe(LINE_WITH(said))
    expect(await homeLine(homeRow(frozenOn(rm)))).toBe(LINE_WITH(said))
  })

  it('a read card with no `grants` keeps the general line, and draws no `conversation grant` row', async () => {
    const html = await renderCard(withoutGrants(captured.read))
    expect(cardLine(html)).toBe(LINE_WITHOUT_RULE)
    expect(textsOf(html, 'permission-grant-covers')).toEqual([])
    expect(textsOf(html, 'permission-persistence')).toEqual(['session'])
  })

  it('the Codex file card, which carries no rule, keeps the general line', async () => {
    const html = await renderCard(captured.codexFile, 'codex')
    expect(cardLine(html)).toBe(LINE_WITHOUT_RULE)
    expect(textsOf(html, 'permission-grant-covers')).toEqual([])
    expect(textsOf(html, 'permission-persistence')).toEqual(['session'])
  })
})

describe('§2 · Home — the effect under *Allow for this conversation* names the rule', () => {
  it('a read outside the folder: the effect and the scope line both say the folder in the CLI’s words', async () => {
    const row = homeRow(frozenOn(captured.read))
    expect(await homeLine(row)).toBe(LINE_WITH(READ_SAID))
    expect(whatThisAnswerDoes(homesGrant(row))).toBe(LINE_WITH(READ_SAID))
    const scope = await homeScope(row)
    expect(scope).toContain(DISCLOSED(READ_SAID))
    expect(scope).toContain('for the whole conversation, not just this action')
  })

  it('a card with no `grants`, and the Codex file card, keep the general line on Home', async () => {
    for (const [card, provider] of [
      [withoutGrants(captured.read), 'claude'],
      [captured.codexFile, 'codex'],
    ] as const) {
      const row = homeRow(frozenOn(card, provider))
      expect(await homeLine(row), provider).toBe(LINE_WITHOUT_RULE)
      expect(whatThisAnswerDoes(homesGrant(row)), provider).toBe(LINE_WITHOUT_RULE)
      expect(
        (await homeScope(row)).filter((line) => line.startsWith('for this conversation, its')),
      ).toEqual([])
    }
  })
})

describe('§3 · the person’s queue — it copies Home’s decision, and so its line', () => {
  it('a spawned child’s read outside the folder: the queue’s line under *Allow for this conversation* names the rule', async () => {
    const live = homeRow(frozenOn(captured.read))
    expect(await queueLine(live, captured.read)).toBe(LINE_WITH(READ_SAID))
  })

  it('a card with no `grants`, and the Codex file card, keep the general line in the queue', async () => {
    for (const [card, provider] of [
      [withoutGrants(captured.read), 'claude'],
      [captured.codexFile, 'codex'],
    ] as const) {
      const live = homeRow(frozenOn(card, provider))
      expect(await queueLine(live, card), provider).toBe(LINE_WITHOUT_RULE)
      usePersonsQueue().forget()
    }
  })
})

describe('§4 · the card, Home and the queue — one sentence for one grant', () => {
  it('on every card, the card’s line is Home’s line for the same request', async () => {
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

describe('§5 · the rule, in words — one derivation, and only the `//<dir>/**` form is a folder', () => {
  it('`conversationGrantCovers` says the rules the conversation grant installs, or `null` where there are none to say', () => {
    expect(conversationGrantCovers(READ_OUTSIDE.scope)).toBe(READ_SAID)
    expect(
      conversationGrantCovers({ ...READ_OUTSIDE.scope, availableDecisions: ['allow', 'deny'] }),
    ).toBeNull()
    expect(conversationGrantCovers(withoutGrants(READ_OUTSIDE).scope)).toBeNull()
    expect(conversationGrantCovers(withRules(READ_OUTSIDE, []).scope)).toBeNull()
    expect(conversationGrantSaid(READ_OUTSIDE.scope)).toBe(
      DISCLOSED(conversationGrantCovers(READ_OUTSIDE.scope)!),
    )
  })

  it('a decision with no `covers` keeps the general line, and `covers` beside another outcome moves nothing', () => {
    expect(
      whatThisAnswerDoes({
        kind: 'permission',
        label: ALLOW_FOR_THIS_CONVERSATION,
        decision: permissionDecisionFor('allow_for_session'),
      }),
    ).toBe(LINE_WITHOUT_RULE)
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

  it('a Bash rule, a Read rule whose path is not `//<dir>/**`, and an `Edit` over a folder are said RAW', async () => {
    const said = (rules: Parameters<typeof withRules>[1]): string | null =>
      conversationGrantSaid(withRules(READ_OUTSIDE, rules).scope)
    expect(said([{ kind: 'tool', tool: 'Bash', content: 'rm -f x' }])).toBe(
      DISCLOSED('Bash(rm -f x)'),
    )
    // A single `/` is relative to the settings file in Claude's rule syntax — not a folder.
    expect(said([{ kind: 'tool', tool: 'Read', content: '/src/**' }])).toBe(
      DISCLOSED('Read(/src/**)'),
    )
    // One file, not a folder — no `/**`.
    expect(said([{ kind: 'tool', tool: 'Read', content: '//elsewhere/n.txt' }])).toBe(
      DISCLOSED('Read(//elsewhere/n.txt)'),
    )
    // Only a READ rule is *reading from* — an edit rule over the same folder is said as it is.
    expect(said([{ kind: 'tool', tool: 'Edit', content: '//elsewhere/**' }])).toBe(
      DISCLOSED('Edit(//elsewhere/**)'),
    )
    const html = await renderCard(
      withRules(captured.read, [{ kind: 'tool', tool: 'Read', content: '/src/**' }]),
    )
    expect(textsOf(html, 'permission-grant-covers')).toEqual([DISCLOSED('Read(/src/**)')])
  })

  it('*accept edits* says what was measured — the edits in the folders it works in, never *every file edit* — in the disclosure, on the card and on Home', async () => {
    expect(
      conversationGrantSaid(withRules(READ_OUTSIDE, [{ kind: 'mode', mode: 'acceptEdits' }]).scope),
    ).toBe(DISCLOSED(EDITS_SAID))
    const write = await renderCard(captured.write)
    expect(textsOf(write, 'permission-grant-covers')).toEqual([DISCLOSED(EDITS_SAID)])
    expect(await homeScope(homeRow(frozenOn(captured.write)))).toContain(DISCLOSED(EDITS_SAID))
  })

  it('a raw rule is still named under the button — the line says the rule, whatever its form', async () => {
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
