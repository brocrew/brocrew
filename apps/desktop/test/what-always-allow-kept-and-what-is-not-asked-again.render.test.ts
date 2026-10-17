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
import {
  DEFAULT_PROFILE_ID,
  type CreatedSession,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 739 · Draw 1 (the disclosure half) — what *Always allow* KEPT, and what is only *not asked again*
 *
 * ⚑ **The findings, verbatim.**
 *
 * - `736` §12 **F-1**: *"disclose kept grants apart from conversation grants: the header chip and
 *   `GRANTS_END_WITH_THE_CONVERSATION` would be false of a kept Codex tool; add a `kept` row to
 *   `REOPEN_COSTS`"*.
 * - `730` §8 **F-1**: *"After *Allow for this conversation*, the conversation header draws *"⚠ always
 *   allowed: mcp__github__create_issue"* … The grant ends with the conversation."*
 *
 * ⚑ **What `739` built** (`standing-grants.ts`): Info's list says *not asked again*
 * (`NOT_ASKED_AGAIN`) — true of every entry, a conversation grant and a Codex tool kept by another
 * conversation alike, because `blanketGrants` carries no lifetime (`739` GAP) — and the sentence
 * behind it says both lifetimes (`HOW_THESE_GRANTS_END`). ⚑ What a person answered *Always allow* in
 * THIS conversation is read off its own card (`keptInThisConversation` — `scope.grants.allow_always`
 * in the card's words, `alwaysFile` verbatim) and drawn APART: a row in Info's AGENT group
 * (`info-kept`), and never also on the not-asked-again list. ⚑ A reopen keeps it (`REOPEN_COSTS`'
 * `kept` row, told in `REOPENING_SAYS.free`).
 *
 * The header’s two warning marks are absent, avoiding conditional height changes. The
 * surviving cases read the facts through Info and the module.
 *
 * | § | surface | 🔴 subject (RED on `main` 8a52dfd8, by assertion) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | Info, a CONVERSATION grant | *not asked again*, never *always allowed* | no grant at all: no grants row, no kept row |
 * | 2 | Info, *Always allow* on Codex's MCP tool | — | *Always allow* REFUSED (a failed keep) is not kept; offered and DENIED is not kept |
 * | 3 | Info, the same records | the agent group draws the kept row; the conversation group the rest under *not asked again* | a caller that omits `kept` keeps the old drawing: the whole list, no kept row |
 * | 4 | a Claude kept rule, off `740`'s MEASURED `make build` card | `Bash(make build *)` — a rule with content, never on `blanketGrants` — is still drawn as kept, in the project's `.claude/settings.local.json`; another project's file, one fact over, is printed as the card names it; a card with no `alwaysFile` names none; a Claude MCP tool kept WHOLE — which main's adapter DOES list on `blanketGrants` — is drawn as kept and the not-asked-again list does not claim it too | the same MCP card answered *Allow for this conversation*: on the not-asked-again list, not kept |
 * | 5 | a reopen | `REOPEN_COSTS` has the kept row, naming `740`'s exception, and the free sentence says where it STAYS | the conversation grant's row is still lost, and still told |
 * | 6 | the kept list's own two branches (`keptInThisConversation`, round 2 #18) | two cards answered *Always allow* for the same tool, in the same file: ONE entry in Info; the same tool in two files: two; a card answered *Always allow* that named no rule: *the provider’s own rule for <action>, which its card did not name*, and no file | — |
 *
 * ⚠️ **What `main` (8a52dfd8, with `740` and `741`; 176a860f before them) draws instead, measured**:
 * §1 Info's label *always allowed*; §3 no kept row, and the kept tool listed as *always allowed* in
 * the conversation's group; §4 no kept row over `Bash(make build *)`; §5 no `kept` row, and
 * *"Reopening keeps the transcript and whatever you have typed or attached. It forgets … approvals,
 * leaves plan mode and stops …"*; §6 no kept row at all.
 *
 * ⚠️ **Re-aimed at `739`'s review round 2** (rule 26; `739` #11, #18, #20). ⛔ §4 built its Claude
 * kept rule as an `rm` *Always allow* in the provider home's `settings.json` — `736`'s shape, which
 * the base (`740`, R99) never offers: an `rm` is offered no *always*, and a Claude rule is kept in
 * the PROJECT's `.claude/settings.local.json`. ⚑ It is now `740`'s measured `make build` card; and
 * ⛔ the docblock said the Claude adapter never lists an *Always allow* on `blanketGrants` — true only
 * of a rule with CONTENT: main's `allow_always` arm lists a kept rule for the WHOLE tool (an MCP
 * tool's, `740`'s review), so §4 also draws that one — the one Claude path where `notKeptHere` works.
 *
 * ⚑ **The premises go through the real doors**: every adapter card is sent through main's wire
 * (`toWireEvent`, so a literal the contract refuses would degrade to `unknown` and draw no card; the
 * host's own `user_turn` and `user_decision` are not provider events and skip it, as they do in the
 * app), and every row is folded by `acceptEvent` into the record the pane reads — so the kept list
 * comes off `record.control`, the path `ConversationPane` hands its drawer. ⚑ A
 * failed keep is the host's refusal marked by `markAnswerRefused`, the function the store's
 * `noteAnswer` calls.
 *
 * ⚠️ **The new exports are reached INSIDE subjects only, by a dynamic `import()` after the drawing was
 * asserted** — `standing-grants.ts` is on `main`, its `739` exports are not — so on `main` a subject
 * fails on what `main` draws and every control still runs. ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]])
 * — every reading is off the element, with the templates' comments stripped (they quote the old
 * words), and every negative sits beside a positive the same markup satisfies. The engine's half —
 * Info's rows drawn whole at the pane's width, and its folds opened — is
 * `test/dom/what-always-allow-kept-and-what-is-not-asked-again.dom.test.ts`.
 */

/** ⚑ The `739` exports — read inside subjects only (see the header). */
const since739 = (): Promise<typeof import('../src/renderer/src/lib/standing-grants')> =>
  import('../src/renderer/src/lib/standing-grants')

/* ------------------------------------------------------------------ the words, verbatim ONCE */

const NOT_ASKED_AGAIN = 'not asked again'
const KEPT_BEYOND_THIS_CONVERSATION = 'kept beyond this conversation'
// ⚑ **D-017b** — a conversation grant's lifetime is no longer said as *ends when it is closed*:
// whether a conversation's process ends is a process fact a person no longer reads (`05` rule 5),
// so the two lifetimes are said as what a person meets — asked again later, or not.
const HOW_THESE_GRANTS_END =
  'This conversation no longer asks before running these — whatever the arguments. BroCrew cannot take ' +
  'them back. One allowed for this conversation may be asked about again later; one kept with ' +
  '“Always allow” is not.'
/**
 * ⚠️ `739` round 2 — *whose launch APPLIES that file*, not *reads*: since `740` a Claude project's file
 * the repository carries, in a folder not yet trusted, is read and not applied; and *beyond the
 * provider's own safety checks*, which the CLI still asks before any allow rule (`728`'s review).
 */
const KEPT_BEYOND_IT_SAYS =
  'Kept with “Always allow” in this conversation, each in the file named beside it: a later ' +
  'conversation whose launch applies that file is not asked about what it covers, beyond the ' +
  'provider’s own safety checks. BroCrew cannot take them back. Listed from the part of this ' +
  'conversation this window has loaded.'
/**
 * ⚠️ `739` round 2 — over `741`'s sentence (*"leaves plan mode"*), and where the kept grant STAYS —
 * never that the reopen applies it (`740`'s exception, named in the kept row's `how`).
 * ⚑ D-017 · R3 — a message waiting to be sent is handed on and sent once it has reopened, so the
 * last clause no longer offers it back as text.
 */
const REOPENING_FREE =
  'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +
  'always allow stays where it was kept. It forgets its “Allow for this conversation” ' +
  'approvals, leaves plan mode and stops anything still running in the background, and a message ' +
  'waiting to be sent is sent once it has reopened.'

/* ------------------------------------------------------------------ the conversations */

const AT = 1_700_000_000_000
const SERVER = 'github'
const CREATE = 'create_issue'
const LIST = 'list_issues'
/** ⚑ The name the Codex adapter lists a granted MCP tool under (`mcp__<server>__<tool>`). */
const CREATE_LISTED = `mcp__${SERVER}__${CREATE}`
const LIST_LISTED = `mcp__${SERVER}__${LIST}`
/** ⚑ Where `736` keeps Codex's MCP *Always allow* — the file the card names, typed, not imported. */
const CODEX_KEPT_FILE = '/homes/codex/brobot-kept-tool-approvals.json'
/**
 * ⚑ Where `740` (R99, on `main` since 5f406f2f) keeps a Claude rule: the conversation's PROJECT's own
 * local settings — for this conversation's folder (`/work/checkout`), typed, not imported.
 */
const CLAUDE_PROJECT_FILE = '/work/checkout/.claude/settings.local.json'
/** ⚑ One fact over — another project's file, as a card for a conversation there would name it. */
const ANOTHER_PROJECT_FILE = '/work/other/.claude/settings.local.json'
/** ⚑ `740`'s measured rule — the CLI's *"Yes, and don't ask again for: make build \*"*. */
const MAKE_BUILD = 'make build *'
/** ⚑ A Claude MCP tool, as the SDK names it (`mcp__<server>__<tool>`) — its own `blanketGrants` name. */
const CLAUDE_MCP_TOOL = 'mcp__srv__note'

/** ⚑ A conversation's meta as the host echoes it — `test/dom/harness.ts`' `META`, in node. */
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
  // ⚑ D-017b — `process` left `SessionLiveness` with the Info process row.
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

/**
 * ⚑ **Codex's own MCP tool card, as `736`'s adapter publishes it** where Codex offers `session` and
 * `always` (`aToolApprovalsGrants`: the rule `{kind:'tool', tool, server}` for both standing buttons,
 * and the kept file in the conversation's home) — the shape `when-codex-asks-to-run-an-mcp-tool`
 * pins to the card main's host really sent.
 */
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

/**
 * ⚑ **`740`'s MEASURED Claude card** (R99, `736` F-4): `make build`, whose CLI row is *"Yes, and
 * don't ask again for: make build \*"* — the rule held for this conversation AND kept in the
 * project's `.claude/settings.local.json` — offered beside the wholesale grant, as the REAL
 * `ClaudeRuntime` publishes it (`claude-runtime.test.ts`' *"740 · R99 (`736` F-4) — `make build`’s
 * rule is offered as *always*…"*; `always-allow-on-every-surface.render.test.ts`' `MAKE_BUILD_GRANTS`).
 * ⚠️ **A rule with CONTENT is never on `blanketGrants`** — main's `allow_always` arm lists only a
 * rule for the WHOLE tool there (`wholeToolsOf`) — so this grant reaches no surface but its own card,
 * until `739`. ⚑ `alwaysFile` `null`: a card that named no file (a handle with no project to keep in).
 */
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

/**
 * ⚑ **A Claude MCP tool call whose CLI rule IS the whole tool** — the shape main's adapter publishes
 * for it (`claude-runtime.test.ts`' `mcp__srv__do_it` case: *Allow* · *Allow for this conversation* ·
 * *Always allow* · *Deny* · *Cancel*, no wholesale button beside a rule that already is the whole
 * tool), both standing buttons installing `{ kind: 'tool', tool: 'mcp__srv__note' }`.
 * ⚠️ **The one Claude rule main DOES list on `blanketGrants`** — pressed *Always allow* (or *Allow for
 * this conversation*), the adapter `grantAll`s the whole tool (`740`'s review, `wholeToolsOf`).
 */
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

/** ⚑ The host's own record of a press (`publishOurs`) — not a provider event, so not wired. */
const decided = (
  requestId: string,
  outcome: Extract<TranscriptEvent, { type: 'user_decision' }>['outcome'],
): TranscriptEvent => ({ type: 'user_decision', requestId, outcome, by: { who: 'a-person' } })

/** ⚑ The person's turn, as the host records it (`UserTurnEvent`: "nothing said it, we did"). */
const asked: TranscriptEvent = { type: 'user_turn', text: 'file the bug you found' }

/**
 * ⚑ **The conversation as the window's store holds it** — the host's meta, and every row through the
 * one door (`acceptEvent`; the adapter's cards through main's wire first, {@link wired}), so
 * `record.control` is what the pane reads.
 */
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

/**
 * ⚑ **An adapter's card through main's wire** (`toWireEvent`) — the parse every provider event takes
 * before a window sees it. ⛔ A literal the contract refuses arrives as `unknown` and draws no card,
 * so that is said here rather than read later as an absence.
 */
function wired(provider: string, event: RuntimeEvent): TranscriptEvent {
  const sent = toWireEvent(provider, event) satisfies TranscriptEvent
  expect(sent.type, `the wire refused a ${event.type}`).toBe(event.type)
  return sent
}

/** ⚑ The Codex MCP tool answered *Allow for this conversation* — `730` F-1's own premise. */
const CONVERSATION_GRANT = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', CREATE),
    decided('req_1', 'allow_all_for_session'),
  ])

/**
 * ⚑ **The same card answered *Always allow*** — ONE fact over. `blanketGrants` holds its name, which
 * is what the Codex adapter lists after an *always* press (`mcpCalls.grant`, `736`).
 */
const KEPT_HERE = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', CREATE),
    decided('req_1', 'allow_always'),
  ])

/** ⚑ Both at once: `list_issues` for this conversation, then `create_issue` kept. */
const BOTH = (): SessionRecord =>
  conversation({ ...CODEX_META, blanketGrants: [LIST_LISTED, CREATE_LISTED] }, [
    asked,
    mcpCard('req_1', LIST),
    decided('req_1', 'allow_all_for_session'),
    mcpCard('req_2', CREATE),
    decided('req_2', 'allow_always'),
  ])

/* ------------------------------------------------------------------ the readers */

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

/** ⚑ The pane over a record, as the app mounts it — the drawer's parent. */
const pane = (record: SessionRecord, over: Record<string, unknown> = {}): Promise<string> =>
  render(ConversationPane, {
    record,
    mode: 'normal' as const,
    debug: false,
    drawerOpen: false,
    drawerTab: 'open' as DrawerTab,
    models: null,
    capabilities: null,
    draft: '',
    handing: createAttachmentBook().handing(draftKey(record.sessionId)),
    ...over,
  })

/** ⚑ The pane with the drawer open on Info — `SessionDrawer` → `SessionInfo`, the app's own hops. */
const infoOf = (record: SessionRecord): Promise<string> =>
  pane(record, { drawerOpen: true, drawerTab: 'info' })

/** ⚑ What a person reads — the templates carry their reasoning inline, as comments. */
const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const squash = (text: string): string => decode(text).replace(/\s+/g, ' ').trim()

/** ⚑ How many elements carry this `data-cy`. */
const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

/** ⚑ The one element with this `data-cy` — its text — or `undefined` when none is drawn. */
function markOf(markup: string, cy: string): { text: string } | undefined {
  const found = new RegExp(`<([a-z0-9]+)\\b([^>]*\\bdata-cy="${cy}"[^>]*)>([\\s\\S]*?)</\\1>`).exec(
    shown(markup),
  )
  if (found === null) return undefined
  return { text: squash(found[3]!.replace(/<[^>]+>/g, '')) }
}

/** ⚑ One of Info's two headed groups, comments gone — `null` when it is not drawn. */
function groupOf(markup: string, subject: 'conversation' | 'agent'): string | null {
  return (
    new RegExp(`<section\\b[^>]*data-subject="${subject}"[^>]*>([\\s\\S]*?)</section>`).exec(
      shown(markup),
    )?.[1] ?? null
  )
}

/** ⚑ The `<dt>` over the row whose value carries this `data-cy`, or `undefined`. */
function labelOf(group: string, cy: string): string | undefined {
  const found = new RegExp(
    `<dt\\b[^>]*>([^<]*)</dt>\\s*<dd\\b[^>]*>\\s*<span\\b[^>]*data-cy="${cy}"`,
  ).exec(group)
  return found === null ? undefined : squash(found[1]!)
}

/** ⚑ Every `<dt>` label a group draws, in order. */
const labelsIn = (group: string): string[] =>
  [...group.matchAll(/<dt\b[^>]*>([^<]*)<\/dt>/g)].map((one) => squash(one[1]!))

/* ------------------------------------------------------------------ §1 */

describe('§1 · `730` F-1 — a CONVERSATION grant is *not asked again*, never *always allowed*', () => {
  it('🔴 Info’s conversation row is labelled *not asked again* over the same grant', async () => {
    const html = await infoOf(CONVERSATION_GRANT())
    const conversationGroup = groupOf(html, 'conversation')
    expect(conversationGroup, 'Info drew no conversation group').not.toBeNull()
    expect(markOf(conversationGroup!, 'info-grants')?.text).toBe(CREATE_LISTED)
    // ⛔ `main`: *always allowed*.
    expect(labelOf(conversationGroup!, 'info-grants')).toBe(NOT_ASKED_AGAIN)
    expect(labelsIn(conversationGroup!)).not.toContain('always allowed')
    // ⚑ …and the agent's group keeps nothing: the grant ends with the conversation.
    expect(count(html, 'info-kept')).toBe(0)
    expect(groupOf(html, 'agent')).not.toBeNull()

    const said = await since739()
    expect(labelOf(conversationGroup!, 'info-grants')).toBe(said.NOT_ASKED_AGAIN)
    // ⚑ …and the sentence behind that row's fold says BOTH lifetimes — the words read once, above.
    expect(said.HOW_THESE_GRANTS_END).toBe(HOW_THESE_GRANTS_END)
  })

  it('⚑ THE CONTROL — nothing granted: no grants row and no kept row', async () => {
    const info = await infoOf(conversation(CODEX_META, [asked, mcpCard('req_1', CREATE)]))
    // ⚑ The positive the absences sit beside: Info drew its conversation group, with rows in it,
    // and the card is up, waiting.
    expect(count(info, 'session-info')).toBe(1)
    expect(count(info, 'permission-card')).toBe(1)
    const labels = labelsIn(groupOf(info, 'conversation') ?? '')
    expect(labels.length, 'Info drew no conversation rows').toBeGreaterThan(0)
    expect(labels).not.toContain(NOT_ASKED_AGAIN)
    expect(count(info, 'info-grants')).toBe(0)
    expect(count(info, 'info-kept')).toBe(0)
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · `736` F-1 — only an *Always allow* the host TOOK is kept', () => {
  it('⚑ THE CONTROL — *Always allow* the host REFUSED (a failed keep) is not kept: the card is still waiting', async () => {
    // ⚑ `736`: a keep that cannot write refuses the answer — no `user_decision`, nothing granted, the
    // card stays live with the host's words on it (`markAnswerRefused`, as `noteAnswer` marks it).
    const refusal = `could not keep "always" for ${SERVER}/${CREATE} in ${CODEX_KEPT_FILE}: EACCES`
    const record = conversation(CODEX_META, [asked, mcpCard('req_1', CREATE)], (held) =>
      markAnswerRefused(held.control, 'req_1', refusal),
    )
    const card = record.control.items.find((item) => item.kind === 'permission')
    expect(card?.kind === 'permission' && [card.outcome, card.refused]).toEqual([null, refusal])
    const html = await infoOf(record)
    // ⚑ The positive: the refusal is drawn on the live card, beside Info.
    expect(markOf(html, 'permission-refused')?.text).toContain(refusal)
    expect(count(html, 'session-info')).toBe(1)
    expect(count(html, 'info-kept')).toBe(0)
  })

  it('⚑ THE CONTROL — offered *Always allow* and answered Deny is not kept', async () => {
    const html = await infoOf(
      conversation(CODEX_META, [asked, mcpCard('req_1', CREATE), decided('req_1', 'deny')]),
    )
    expect(markOf(html, 'permission-verdict')?.text).toBe('Denied')
    expect(count(html, 'session-info')).toBe(1)
    expect(count(html, 'info-kept')).toBe(0)
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · Info — the kept grant in the AGENT’s group, the rest in the conversation’s', () => {
  it('🔴 the agent group draws *kept beyond this conversation*; the conversation group lists only what is not kept', async () => {
    const html = await infoOf(BOTH())
    const agent = groupOf(html, 'agent')
    const conversationGroup = groupOf(html, 'conversation')
    expect(agent, 'Info drew no agent group').not.toBeNull()
    expect(conversationGroup, 'Info drew no conversation group').not.toBeNull()
    // ⛔ `main`: no kept row — both tools under *always allowed*, in the conversation's group.
    expect(markOf(agent!, 'info-kept')?.text).toBe(`every ${CREATE} call on ${SERVER}`)
    expect(labelOf(agent!, 'info-kept')).toBe(KEPT_BEYOND_THIS_CONVERSATION)
    expect(count(agent!, 'info-why-kept')).toBe(1)
    expect(markOf(conversationGroup!, 'info-grants')?.text).toBe(LIST_LISTED)
    expect(labelOf(conversationGroup!, 'info-grants')).toBe(NOT_ASKED_AGAIN)
    // ⚑ One fact, one home: neither group holds the other's row.
    expect(count(conversationGroup!, 'info-kept')).toBe(0)
    expect(count(agent!, 'info-grants')).toBe(0)
    expect(shown(conversationGroup!)).not.toContain(CREATE_LISTED)

    const said = await since739()
    expect(labelOf(agent!, 'info-kept')).toBe(said.KEPT_BEYOND_THIS_CONVERSATION)
  })

  it('🔴 the kept tool alone: the conversation group draws no grants row at all', async () => {
    const html = await infoOf(KEPT_HERE())
    expect(markOf(groupOf(html, 'agent')!, 'info-kept')?.text).toBe(
      `every ${CREATE} call on ${SERVER}`,
    )
    // ⛔ `main` drew it here, as *always allowed*.
    expect(count(html, 'info-grants')).toBe(0)
    expect(count(html, 'info-why-grants')).toBe(0)
  })

  it('⚑ THE CONTROL — a caller that omits `kept` keeps the old drawing: the whole list, and no kept row', async () => {
    // ⚑ The new prop is optional on `SessionInfo`; a double that does not pass it gets what `main`
    // drew — the whole `blanketGrants` on one list, nothing apart. Green on both trees.
    const session = { ...CODEX_META, blanketGrants: [LIST_LISTED, CREATE_LISTED] }
    const info = await render(SessionInfo, { session, sessionRef: null, ended: false })
    expect(markOf(info, 'info-grants')?.text).toBe(`${LIST_LISTED} · ${CREATE_LISTED}`)
    expect(count(info, 'info-kept')).toBe(0)
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · a Claude kept rule, off `740`’s measured card, and the file each card names', () => {
  const MAKE_BUILD_SAID = `commands starting with make build (Bash(${MAKE_BUILD}))`

  it('🔴 `Bash(make build *)` kept — a rule with content, never on `blanketGrants` — is still drawn in Info, in the project’s file', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', CLAUDE_PROJECT_FILE),
      decided('req_1', 'allow_always'),
    ])
    // ⚑ The premise: nothing on the not-asked-again list — main's adapter lists no rule with content.
    expect(record.meta?.blanketGrants).toEqual([])
    // ⛔ `main`: no kept row — a rule kept for every later conversation, drawn nowhere but its card.
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    expect(labelOf(groupOf(info, 'agent')!, 'info-kept')).toBe(KEPT_BEYOND_THIS_CONVERSATION)
    expect(count(info, 'info-grants')).toBe(0)

    const said = await since739()
    expect(said.KEPT_BEYOND_IT_SAYS).toBe(KEPT_BEYOND_IT_SAYS)
    expect(said.keptInThisConversation(record.control.items)).toEqual([
      { said: MAKE_BUILD_SAID, file: CLAUDE_PROJECT_FILE, listedAs: [] },
    ])
  })

  it('🔴 the file is printed as the card names it — another project’s `.claude/settings.local.json`, one fact over — never a copy of this one’s', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', ANOTHER_PROJECT_FILE),
      decided('req_1', 'allow_always'),
    ])
    // ⚑ Info's kept row is the premise; the file is the line its fold draws (`keptAndWhere`).
    expect(markOf(groupOf(await infoOf(record), 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    const said = await since739()
    // ⛔ `main`: no kept row, so no file.
    const where = said.keptAndWhere(said.keptInThisConversation(record.control.items)[0]!)
    expect(where).toBe(`${MAKE_BUILD_SAID} — in ${ANOTHER_PROJECT_FILE}`)
    expect(where).not.toContain(CLAUDE_PROJECT_FILE)
  })

  it('🔴 a card that named no file (a handle with no project to keep in) says the rule and claims no file', async () => {
    const record = conversation(CLAUDE_META, [
      asked,
      claudeMakeBuildCard('req_1', null),
      decided('req_1', 'allow_always'),
    ])
    expect(markOf(groupOf(await infoOf(record), 'agent')!, 'info-kept')?.text).toBe(MAKE_BUILD_SAID)
    const said = await since739()
    const where = said.keptAndWhere(said.keptInThisConversation(record.control.items)[0]!)
    expect(where).toBe(MAKE_BUILD_SAID)
    expect(where).not.toContain(' — in ')
  })

  /**
   * 🔴 **`739` round 2 (#11) — the one Claude path where the not-asked-again list must be read APART.**
   * Main's `allow_always` arm lists a kept rule for the WHOLE tool on `blanketGrants` (`740`'s review),
   * so without `notKeptHere` Info's conversation row would claim `mcp__srv__note` as *not asked again*
   * beside the agent's row that says it was kept beyond the conversation — one grant, drawn twice,
   * with two lifetimes.
   */
  it('🔴 a Claude MCP tool kept WHOLE — on `blanketGrants`, as main’s adapter lists it — is drawn as kept, and the not-asked-again list does not claim it too', async () => {
    const record = conversation({ ...CLAUDE_META, blanketGrants: [CLAUDE_MCP_TOOL] }, [
      asked,
      claudeMcpCard('req_1'),
      decided('req_1', 'allow_always'),
    ])
    // ⛔ `main`: listed as *always allowed* in the conversation's group, and no kept row.
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(`every ${CLAUDE_MCP_TOOL} call`)
    // ⚑ One grant, drawn once: the list without it is empty, so its row is not drawn.
    expect(count(info, 'info-grants')).toBe(0)

    const said = await since739()
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

  it('⚑ THE CONTROL — the same Claude MCP card answered *Allow for this conversation*: on the not-asked-again list, and not kept', async () => {
    const record = conversation({ ...CLAUDE_META, blanketGrants: [CLAUDE_MCP_TOOL] }, [
      asked,
      claudeMcpCard('req_1'),
      decided('req_1', 'allow_for_session'),
    ])
    const html = await infoOf(record)
    // ⚑ Green on both: `main`'s row names it too (*always allowed*), and neither draws a kept row.
    expect(markOf(groupOf(html, 'conversation')!, 'info-grants')?.text).toBe(CLAUDE_MCP_TOOL)
    expect(count(html, 'info-kept')).toBe(0)
    expect(shown(html)).not.toContain(`— in ${CLAUDE_PROJECT_FILE}`)
  })
})

/* ------------------------------------------------------------------ §5 */

describe('§5 · a reopen keeps what a person chose to *Always allow*', () => {
  it('🔴 `REOPEN_COSTS` has the kept row, and the free sentence tells it', () => {
    const row = REOPEN_COSTS.find(
      (one) => 'isTold' in one.person && one.person.isTold === 'always allow',
    )
    // ⛔ `main`: no such row — the table said nothing about a grant that outlives the conversation.
    expect(row?.becomes).toBe('kept')
    expect(row?.what).toBe('what you chose to “Always allow”')
    expect(row?.sweeps).toEqual([])
    // ⚑ `alwaysFile`'s field named in the row's own `how`, and `740` (R99) with it — ⚠️ round 2:
    // and `740`'s exception, a file the repository carries in a folder not yet trusted, whose allow
    // rules the CLI's launch does not apply.
    expect(row?.how).toContain('scope.grants.alwaysFile')
    expect(row?.how).toContain('740')
    expect(row?.how).toContain('carriedByTheRepository')
    // ⚑ So the sentence says where it STAYS — never that the reopen applies it.
    expect(REOPENING_SAYS.free).toContain('what you chose to always allow stays where it was kept')
    expect(REOPENING_SAYS.free).toBe(REOPENING_FREE)
    // ⚑ …over `741`'s sentence, whose *"leaves plan mode"* it keeps.
    expect(REOPENING_SAYS.free).toContain('leaves plan mode')
  })

  it('⚑ THE CONTROL — the conversation grant is still LOST on a reopen, and still told', () => {
    const row = REOPEN_COSTS.find(
      (one) => 'isTold' in one.person && one.person.isTold === 'Allow for this conversation',
    )
    expect(row?.becomes).toBe('lost')
    expect(REOPENING_SAYS.free).toContain('“Allow for this conversation” approvals')
    expect(REOPENING_SAYS.free).toContain('Reopening keeps the transcript')
  })
})

/* ------------------------------------------------------------------ §6 */

/**
 * 🔴 **`739` round 2 (#18) — the kept list's own two branches** (`keptInThisConversation`). Every
 * section above reads ONE card with rules; these are the two readings nothing else makes:
 *
 * - **the dedupe** — a person can answer *Always allow* on the same tool twice in one conversation
 *   (Codex asks again when the first keep has not reached the next call), and the file holds one rule:
 *   Info lists it ONCE. ⚑ Keyed by what is kept AND where — the same rule in two files is
 *   two grants, and both are listed.
 * - **the no-rule fallback** — a card answered *Always allow* that named no rule (`scope.grants`
 *   absent: *absent is not "nothing"*, `permission.ts`) is said as *the provider’s own rule for <action>, which its card did not name* — never the bare action,
 * which reads as the whole tool — and claims no file.
 */
describe('§6 · the kept list: one entry per rule and file, and a card with no rule said as the provider’s own rule for its action', () => {
  const KEPT_SAID = `every ${CREATE} call on ${SERVER}`
  /**
   * ⚑ The same MCP card, its *Always allow* kept in ANOTHER provider home — one fact over, COMPOSED:
   * one conversation's cards name one file today, and this reads what the list keys on, not a path
   * the adapter takes.
   */
  const OTHER_HOME_FILE = '/homes/codex-2/brobot-kept-tool-approvals.json'
  const inOtherHome = (id: string): TranscriptEvent => {
    const card = mcpCard(id, CREATE) as PermissionRequest
    return {
      ...card,
      scope: { ...card.scope, grants: { ...card.scope.grants, alwaysFile: OTHER_HOME_FILE } },
    } as TranscriptEvent
  }

  it('🔴 two cards answered *Always allow* for the same tool, kept in the same file: ONE entry in Info', async () => {
    const record = conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
      asked,
      mcpCard('req_1', CREATE),
      decided('req_1', 'allow_always'),
      mcpCard('req_2', CREATE),
      decided('req_2', 'allow_always'),
    ])
    // ⛔ `main`: no kept row at all.
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(KEPT_SAID)

    const said = await since739()
    expect(said.keptInThisConversation(record.control.items)).toEqual([
      { said: KEPT_SAID, file: CODEX_KEPT_FILE, listedAs: [CREATE_LISTED] },
    ])
  })

  it('🔴 …one fact over, the same tool kept in TWO files: two entries, each with its file', async () => {
    const record = conversation({ ...CODEX_META, blanketGrants: [CREATE_LISTED] }, [
      asked,
      mcpCard('req_1', CREATE),
      decided('req_1', 'allow_always'),
      inOtherHome('req_2'),
      decided('req_2', 'allow_always'),
    ])
    // ⛔ `main`: no kept row at all.
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(`${KEPT_SAID} · ${KEPT_SAID}`)
    const said = await since739()
    expect(said.keptInThisConversation(record.control.items).map((one) => one.file)).toEqual([
      CODEX_KEPT_FILE,
      OTHER_HOME_FILE,
    ])
  })

  it('🔴 a card answered *Always allow* that named no rule: said as the provider’s own rule for its action — never the bare action, which reads as the whole tool — and no file claimed', async () => {
    const card = claudeMakeBuildCard('req_1', CLAUDE_PROJECT_FILE) as PermissionRequest
    const scope: Partial<PermissionRequest['scope']> = { ...card.scope }
    delete scope.grants
    const noRule = { ...card, scope } as TranscriptEvent
    const record = conversation(CLAUDE_META, [asked, noRule, decided('req_1', 'allow_always')])
    // ⛔ `main`: no kept row at all. ⚑ `739` (lead, after round 2): the bare action — *"kept beyond
    // this conversation: Bash"* — read as the whole tool, while the card's own kept row says the
    // rule was not named; the row now says what the card knows.
    const NO_RULE_SAID = 'the provider’s own rule for Bash, which its card did not name'
    const info = await infoOf(record)
    expect(markOf(groupOf(info, 'agent')!, 'info-kept')?.text).toBe(NO_RULE_SAID)

    const said = await since739()
    const list = said.keptInThisConversation(record.control.items)
    expect(list).toEqual([{ said: NO_RULE_SAID, file: null, listedAs: [] }])
    // ⚑ …and its fold claims no file.
    expect(said.keptAndWhere(list[0]!)).not.toContain(' — in ')
  })
})
