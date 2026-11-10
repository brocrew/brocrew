import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { RuntimeEvent } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SessionInfo from '../src/renderer/src/components/SessionInfo.vue'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import type { DrawerTab } from '../src/renderer/src/lib/drawer'
import { REOPEN_COSTS, REOPENING_SAYS } from '../src/renderer/src/lib/reopening'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import { markAnswerRefused } from '../src/renderer/src/lib/transcript'
import { DEFAULT_PROFILE_ID, type CreatedSession } from '../src/shared/runtime-ipc'
import * as said from '../src/renderer/src/lib/standing-grants'

/**
 * What *Always allow* kept and what is only *not asked again*: a conversation grant is listed under
 * *not asked again* in Info's conversation group, a kept grant in the agent's group, and a reopen
 * keeps the kept one. Every card goes through main's wire and every row through `acceptEvent`.
 */

const NOT_ASKED_AGAIN = 'not asked again'
const KEPT_BEYOND_THIS_CONVERSATION = 'kept beyond this conversation'
const HOW_THESE_GRANTS_END =
  'This conversation no longer asks before running these — whatever the arguments. BroCrew cannot take ' +
  'them back. One allowed for this conversation may be asked about again later; one kept with ' +
  '“Always allow” is not.'
const KEPT_BEYOND_IT_SAYS =
  'Kept with “Always allow” in this conversation, each in the file named beside it: a later ' +
  'conversation whose launch applies that file is not asked about what it covers, beyond the ' +
  'provider’s own safety checks. BroCrew cannot take them back. Listed from the part of this ' +
  'conversation this window has loaded.'
const REOPENING_FREE =
  'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +
  'always allow stays where it was kept. It forgets its “Allow for this conversation” ' +
  'approvals, leaves plan mode and stops anything still running in the background, and a message ' +
  'waiting to be sent is sent once it has reopened.'

const AT = 1_700_000_000_000
const SERVER = 'github'
const CREATE = 'create_issue'
const LIST = 'list_issues'
const CREATE_LISTED = `mcp__${SERVER}__${CREATE}`
const LIST_LISTED = `mcp__${SERVER}__${LIST}`
const CODEX_KEPT_FILE = '/homes/codex/brobot-kept-tool-approvals.json'
const CLAUDE_PROJECT_FILE = '/work/checkout/.claude/settings.local.json'
const ANOTHER_PROJECT_FILE = '/work/other/.claude/settings.local.json'
const MAKE_BUILD = 'make build *'
const CLAUDE_MCP_TOOL = 'mcp__srv__note'

const CLAUDE_META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
  profileId: DEFAULT_PROFILE_ID,
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work/checkout', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-opus-5',
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
  approvalNote: 'approvals: ask',
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

const CODEX_META: CreatedSession = {
  ...CLAUDE_META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work/checkout', rotation: 0 },
  config: { ...CLAUDE_META.config, home: '/homes/codex', homeEnv: 'CODEX_HOME', model: 'gpt-5' },
}

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>
type Grants = NonNullable<PermissionRequest['scope']['grants']>

function mcpCard(id: string, tool: string): TranscriptEvent {
  const rule = { kind: 'tool' as const, tool, server: SERVER }
  const grants: Grants = {
    allow_all_for_session: [rule],
    allow_always: [rule],
    alwaysFile: CODEX_KEPT_FILE,
  }
  return wired('codex', {
    type: 'permission_request',
    id,
    kind: 'command',
    action: tool,
    detail: `${SERVER} · ${tool}`,
    cancelStopsNothing: true,
    mcpToolCall: { server: SERVER, tool, parameters: [{ name: 'title', value: 'the bug' }] },
    scope: {
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants,
      amendments: [],
      availableDecisions: ['allow', 'allow_all_for_session', 'allow_always', 'deny', 'cancel'],
      underDisclosed: true,
      approvalMode: 'ask',
    },
  })
}

function claudeMakeBuildCard(id: string, alwaysFile: string | null): TranscriptEvent {
  const rule = { kind: 'tool' as const, tool: 'Bash', content: MAKE_BUILD }
  return wired('claude', {
    type: 'permission_request',
    id,
    kind: 'command',
    action: 'Bash',
    detail: 'make build',
    scope: {
      cwd: '/work/checkout',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [rule],
        allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
        allow_always: [rule],
        ...(alwaysFile === null ? {} : { alwaysFile }),
      },
      amendments: [],
      availableDecisions: [
        'allow',
        'allow_for_session',
        'allow_all_for_session',
        'allow_always',
        'deny',
        'cancel',
      ],
      underDisclosed: true,
    },
  })
}

function claudeMcpCard(id: string): TranscriptEvent {
  const rule = { kind: 'tool' as const, tool: CLAUDE_MCP_TOOL }
  return wired('claude', {
    type: 'permission_request',
    id,
    kind: 'command',
    action: CLAUDE_MCP_TOOL,
    detail: '{"q":"x"}',
    scope: {
      cwd: '/work/checkout',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [rule],
        allow_always: [rule],
        alwaysFile: CLAUDE_PROJECT_FILE,
      },
      amendments: [],
      availableDecisions: ['allow', 'allow_for_session', 'allow_always', 'deny', 'cancel'],
      underDisclosed: true,
    },
  })
}

const decided = (
  requestId: string,
  outcome: Extract<TranscriptEvent, { type: 'user_decision' }>['outcome'],
): TranscriptEvent => ({ type: 'user_decision', requestId, outcome, by: { who: 'a-person' } })

const asked: TranscriptEvent = { type: 'user_turn', text: 'file the bug you found' }

function conversation(
  meta: CreatedSession,
  events: TranscriptEvent[],
  after?: (record: SessionRecord) => void,
): SessionRecord {
  const record = createSessionRecord(meta.sessionId)
  record.meta = meta
  record.phase = 'open'
  for (const event of events) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, { sessionId: meta.sessionId, ordinal, at: AT + ordinal * 1_000, event })
  }
  after?.(record)
  return record
}

function wired(provider: string, event: RuntimeEvent): TranscriptEvent {
  const sent = toWireEvent(provider, event) satisfies TranscriptEvent
  expect(sent.type, `the wire refused a ${event.type}`).toBe(event.type)
  return sent
}

const CONVERSATION_GRANT = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', CREATE),
    decided('req_1', 'allow_all_for_session'),
  ])

const KEPT_HERE = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', CREATE),
    decided('req_1', 'allow_always'),
  ])

const BOTH = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [LIST_LISTED, CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', LIST),
    decided('req_1', 'allow_all_for_session'),
    mcpCard('req_2', CREATE),
    decided('req_2', 'allow_always'),
  ])

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const pane = (record: SessionRecord, over: Record<string, unknown> = {}): Promise<string> =>
  render(ConversationPane, {
    record,

    drawerOpen: false,
    drawerTab: 'open' as DrawerTab,
    models: null,
    capabilities: null,
    draft: '',
    handing: createAttachmentBook().handing(draftKey(record.sessionId)),
    ...over,
  })

const infoOf = (record: SessionRecord): Promise<string> =>
  pane(record, { drawerOpen: true, drawerTab: 'info' })

const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const squash = (text: string): string => decode(text).replace(/\s+/g, ' ').trim()

const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

function markOf(markup: string, cy: string): { text: string } | undefined {
  const found = new RegExp(`<([a-z0-9]+)\\b([^>]*\\bdata-cy="${cy}"[^>]*)>([\\s\\S]*?)</\\1>`).exec(
    shown(markup),
  )
  if (found === null) return undefined
  return { text: squash(found[3]!.replace(/<[^>]+>/g, '')) }
}

function groupOf(markup: string, subject: 'conversation' | 'agent'): string | null {
  return (
    new RegExp(`<section\\b[^>]*data-subject="${subject}"[^>]*>([\\s\\S]*?)</section>`).exec(
      shown(markup),
    )?.[1] ?? null
  )
}

function labelOf(group: string, cy: string): string | undefined {
  const found = new RegExp(
    `<dt\\b[^>]*>([^<]*)</dt>\\s*<dd\\b[^>]*>\\s*<span\\b[^>]*data-cy="${cy}"`,
  ).exec(group)
  return found === null ? undefined : squash(found[1]!)
}

const labelsIn = (group: string): string[] =>
  [...group.matchAll(/<dt\b[^>]*>([^<]*)<\/dt>/g)].map((one) => squash(one[1]!))

describe('a CONVERSATION grant is *not asked again*, never *always allowed*', () => {
  it('Info’s conversation row is labelled *not asked again* over the same grant', async () => {
    const html = await infoOf(CONVERSATION_GRANT())
    const conversationGroup = groupOf(html, 'conversation')
    expect(conversationGroup, 'Info drew no conversation group').not.toBeNull()
    expect(markOf(conversationGroup!, 'info-grants')?.text).toBe(CREATE_LISTED)
    expect(labelOf(conversationGroup!, 'info-grants')).toBe(NOT_ASKED_AGAIN)
    expect(labelsIn(conversationGroup!)).not.toContain('always allowed')
    expect(count(html, 'info-kept')).toBe(0)
    expect(groupOf(html, 'agent')).not.toBeNull()

    expect(labelOf(conversationGroup!, 'info-grants')).toBe(said.NOT_ASKED_AGAIN)
    expect(said.HOW_THESE_GRANTS_END).toBe(HOW_THESE_GRANTS_END)
  })

  it('nothing granted: no grants row and no kept row', async () => {
    const info = await infoOf(conversation(CODEX_META, [asked, mcpCard('req_1', CREATE)]))
    expect(count(info, 'session-info')).toBe(1)
    expect(count(info, 'permission-card')).toBe(1)
    const labels = labelsIn(groupOf(info, 'conversation') ?? '')
    expect(labels.length, 'Info drew no conversation rows').toBeGreaterThan(0)
    expect(labels).not.toContain(NOT_ASKED_AGAIN)
    expect(count(info, 'info-grants')).toBe(0)
    expect(count(info, 'info-kept')).toBe(0)
  })
})

describe('only an *Always allow* the host TOOK is kept', () => {
  it('*Always allow* the host REFUSED (a failed keep) is not kept: the card is still waiting', async () => {
    const refusal = `could not keep "always" for ${SERVER}/${CREATE} in ${CODEX_KEPT_FILE}: EACCES`
    const record = conversation(CODEX_META, [asked, mcpCard('req_1', CREATE)], (held) =>
      markAnswerRefused(held.control, 'req_1', refusal),
    )
    const card = record.control.items.find((item) => item.kind === 'permission')
    expect(card?.kind === 'permission' && [card.outcome, card.refused]).toEqual([null, refusal])
    const html = await infoOf(record)
    expect(markOf(html, 'permission-refused')?.text).toContain(refusal)
    expect(count(html, 'session-info')).toBe(1)
    expect(count(html, 'info-kept')).toBe(0)
  })

  it('offered *Always allow* and answered Deny is not kept', async () => {
    const html = await infoOf(
      conversation(CODEX_META, [asked, mcpCard('req_1', CREATE), decided('req_1', 'deny')]),
    )
    expect(markOf(html, 'permission-verdict')?.text).toBe('Denied')
    expect(count(html, 'session-info')).toBe(1)
    expect(count(html, 'info-kept')).toBe(0)
  })
})

describe('Info — the kept grant in the AGENT’s group, the rest in the conversation’s', () => {
  it('the agent group draws *kept beyond this conversation*; the conversation group lists only what is not kept', async () => {
    const html = await infoOf(BOTH())
    const agent = groupOf(html, 'agent')
    const conversationGroup = groupOf(html, 'conversation')
    expect(agent, 'Info drew no agent group').not.toBeNull()
    expect(conversationGroup, 'Info drew no conversation group').not.toBeNull()
    expect(markOf(agent!, 'info-kept')?.text).toBe(`every ${CREATE} call on ${SERVER}`)
    expect(labelOf(agent!, 'info-kept')).toBe(KEPT_BEYOND_THIS_CONVERSATION)
    expect(count(agent!, 'info-why-kept')).toBe(1)
    expect(markOf(conversationGroup!, 'info-grants')?.text).toBe(LIST_LISTED)
    expect(labelOf(conversationGroup!, 'info-grants')).toBe(NOT_ASKED_AGAIN)
    expect(count(conversationGroup!, 'info-kept')).toBe(0)
    expect(count(agent!, 'info-grants')).toBe(0)
    expect(shown(conversationGroup!)).not.toContain(CREATE_LISTED)

    expect(labelOf(agent!, 'info-kept')).toBe(said.KEPT_BEYOND_THIS_CONVERSATION)
  })

  it('the kept tool alone: the conversation group draws no grants row at all', async () => {
    const html = await infoOf(KEPT_HERE())
    expect(markOf(groupOf(html, 'agent')!, 'info-kept')?.text).toBe(
      `every ${CREATE} call on ${SERVER}`,
    )
    expect(count(html, 'info-grants')).toBe(0)
    expect(count(html, 'info-why-grants')).toBe(0)
  })

  it('a caller that omits `kept` keeps the old drawing: the whole list, and no kept row', async () => {
    const session = { ...CODEX_META, blanketGrants: [LIST_LISTED, CREATE_LISTED] }
    const info = await render(SessionInfo, { session, sessionRef: null, ended: false })
    expect(markOf(info, 'info-grants')?.text).toBe(`${LIST_LISTED} · ${CREATE_LISTED}`)
    expect(count(info, 'info-kept')).toBe(0)
  })
})

describe('a Claude kept rule, and the file each card names', () => {
  const MAKE_BUILD_SAID = `commands starting with make build (Bash(${MAKE_BUILD}))`

  it('`Bash(make build *)` kept — a rule with content, never on `blanketGrants` — is still drawn in Info, in the project’s file', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', CLAUDE_PROJECT_FILE),
      decided('req_1', 'allow_always'),
    ])
    expect(record.meta?.blanketGrants).toEqual([])
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    expect(labelOf(groupOf(info, 'agent')!, 'info-kept')).toBe(KEPT_BEYOND_THIS_CONVERSATION)
    expect(count(info, 'info-grants')).toBe(0)

    expect(said.KEPT_BEYOND_IT_SAYS).toBe(KEPT_BEYOND_IT_SAYS)
    expect(said.keptInThisConversation(record.control.items)).toEqual([
      { said: MAKE_BUILD_SAID, file: CLAUDE_PROJECT_FILE, listedAs: [] },
    ])
  })

  it('the file is printed as the card names it — another project’s `.claude/settings.local.json`, one fact over — never a copy of this one’s', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', ANOTHER_PROJECT_FILE),
      decided('req_1', 'allow_always'),
    ])
    expect(markOf(groupOf(await infoOf(record), 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    const where = said.keptAndWhere(said.keptInThisConversation(record.control.items)[0]!)
    expect(where).toBe(`${MAKE_BUILD_SAID} — in ${ANOTHER_PROJECT_FILE}`)
    expect(where).not.toContain(CLAUDE_PROJECT_FILE)
  })

  it('a card that named no file (a handle with no project to keep in) says the rule and claims no file', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', null),
      decided('req_1', 'allow_always'),
    ])
    expect(markOf(groupOf(await infoOf(record), 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    const where = said.keptAndWhere(said.keptInThisConversation(record.control.items)[0]!)
    expect(where).toBe(MAKE_BUILD_SAID)
    expect(where).not.toContain(' — in ')
  })

  it('a Claude MCP tool kept WHOLE — on `blanketGrants`, as main’s adapter lists it — is drawn as kept, and the not-asked-again list does not claim it too', async () => {
    const record = conversation({ ...CLAUDE_META, blanketGrants: [CLAUDE_MCP_TOOL] }, [
      asked,
      claudeMcpCard('req_1'),
      decided('req_1', 'allow_always'),
    ])
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(`every ${CLAUDE_MCP_TOOL} call`)
    expect(count(info, 'info-grants')).toBe(0)

    const list = said.keptInThisConversation(record.control.items)
    expect(list).toEqual([
      {
        said: `every ${CLAUDE_MCP_TOOL} call`,
        file: CLAUDE_PROJECT_FILE,
        listedAs: [CLAUDE_MCP_TOOL],
      },
    ])
    expect(said.notKeptHere(record.meta!.blanketGrants, list)).toEqual([])
  })

  it('the same Claude MCP card answered *Allow for this conversation*: on the not-asked-again list, and not kept', async () => {
    const record = conversation({ ...CLAUDE_META, blanketGrants: [CLAUDE_MCP_TOOL] }, [
      asked,
      claudeMcpCard('req_1'),
      decided('req_1', 'allow_for_session'),
    ])
    const html = await infoOf(record)
    expect(markOf(groupOf(html, 'conversation')!, 'info-grants')?.text).toBe(CLAUDE_MCP_TOOL)
    expect(count(html, 'info-kept')).toBe(0)
    expect(shown(html)).not.toContain(`— in ${CLAUDE_PROJECT_FILE}`)
  })
})

describe('a reopen keeps what a person chose to *Always allow*', () => {
  it('`REOPEN_COSTS` has the kept row, and the free sentence tells it', () => {
    const row = REOPEN_COSTS.find(
      (one) => 'isTold' in one.person && one.person.isTold === 'always allow',
    )
    expect(row?.becomes).toBe('kept')
    expect(row?.what).toBe('what you chose to “Always allow”')
    expect(row?.sweeps).toEqual([])
    expect(REOPENING_SAYS.free).toContain('what you chose to always allow stays where it was kept')
    expect(REOPENING_SAYS.free).toBe(REOPENING_FREE)
    expect(REOPENING_SAYS.free).toContain('leaves plan mode')
  })

  it('the conversation grant is still LOST on a reopen, and still told', () => {
    const row = REOPEN_COSTS.find(
      (one) => 'isTold' in one.person && one.person.isTold === 'Allow for this conversation',
    )
    expect(row?.becomes).toBe('lost')
    expect(REOPENING_SAYS.free).toContain('“Allow for this conversation” approvals')
    expect(REOPENING_SAYS.free).toContain('Reopening keeps the transcript')
  })
})

describe('the kept list: one entry per rule and file, and a card with no rule said as the provider’s own rule for its action', () => {
  const KEPT_SAID = `every ${CREATE} call on ${SERVER}`
  const OTHER_HOME_FILE = '/homes/codex-2/brobot-kept-tool-approvals.json'
  const inOtherHome = (id: string): TranscriptEvent => {
    const card = mcpCard(id, CREATE) as PermissionRequest
    return {
      ...card,
      scope: { ...card.scope, grants: { ...card.scope.grants, alwaysFile: OTHER_HOME_FILE } },
    } as TranscriptEvent
  }

  it('two cards answered *Always allow* for the same tool, kept in the same file: ONE entry in Info', async () => {
    const record = conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
      asked,
      mcpCard('req_1', CREATE),
      decided('req_1', 'allow_always'),
      mcpCard('req_2', CREATE),
      decided('req_2', 'allow_always'),
    ])
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(KEPT_SAID)

    expect(said.keptInThisConversation(record.control.items)).toEqual([
      { said: KEPT_SAID, file: CODEX_KEPT_FILE, listedAs: [CREATE_LISTED] },
    ])
  })

  it('…one fact over, the same tool kept in TWO files: two entries, each with its file', async () => {
    const record = conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
      asked,
      mcpCard('req_1', CREATE),
      decided('req_1', 'allow_always'),
      inOtherHome('req_2'),
      decided('req_2', 'allow_always'),
    ])
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(`${KEPT_SAID} · ${KEPT_SAID}`)
    expect(said.keptInThisConversation(record.control.items).map((one) => one.file)).toEqual([
      CODEX_KEPT_FILE,
      OTHER_HOME_FILE,
    ])
  })

  it('a card answered *Always allow* that named no rule: said as the provider’s own rule for its action — never the bare action, which reads as the whole tool — and no file claimed', async () => {
    const card = claudeMakeBuildCard('req_1', CLAUDE_PROJECT_FILE) as PermissionRequest
    const scope: Partial<PermissionRequest['scope']> = { ...card.scope }
    delete scope.grants
    const noRule = { ...card, scope } as TranscriptEvent
    const record = conversation(CLAUDE_META, [asked, noRule, decided('req_1', 'allow_always')])
    const NO_RULE_SAID = 'the provider’s own rule for Bash, which its card did not name'
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(NO_RULE_SAID)

    const list = said.keptInThisConversation(record.control.items)
    expect(list).toEqual([{ said: NO_RULE_SAID, file: null, listedAs: [] }])
    expect(said.keptAndWhere(list[0]!)).not.toContain(' — in ')
  })
})
