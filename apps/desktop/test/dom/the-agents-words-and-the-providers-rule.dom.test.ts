import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import { inTheProvidersWords } from '../../src/renderer/src/lib/permission-offer'
import * as since725 from '../../src/renderer/src/lib/permission-offer'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import {
  agentName,
  type AgentIdentity,
  type CreatedSession,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import {
  META,
  contrast,
  mount,
  paintedInk,
  paneProps,
  parseColor,
  show,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * # 🔴 725 · Draws 1 and 2, DRAWN — the agent's words and the provider's rule, in a real engine
 *
 * ⚑ **R44** — *"words the MODEL wrote that reach a card are the agent's, drawn under the agent's
 * name; never unlabelled, never the provider's. Rows written before 709 carry them unlabelled in
 * permission.reason and are drawn as they were."* ⚑ **R73** — *"Codex's "… requires approval: <rule
 * text>" is the provider's words, labelled as Codex's rule (providerReason, a-policy-rule)."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a Codex conversation, run as an agent a person named *Ada* | the command card's agent line is drawn whole and legible, ABOVE the disclosure; the grant card's ABOVE and OUTSIDE the grant block; a policy card reads *Codex’s rule* | a card with no `agentReason` draws none; a legacy grant draws its words in the grant block, as it did; a Claude marked ask still reads *The provider’s reason* |
 * | 2 | Home | the row's agent line is drawn between what is asked and the scope; a policy row reads *Codex’s rule* | a legacy grant's reason is still its first scope line |
 *
 * ⚑ **Mounted through `ConversationPane`**, so the name and the provider travel the hops the app
 * uses — `agentName(meta.profileId, identities)` and `record.meta.provider`, through
 * `TranscriptView`, into each card — and are never handed to a card by the test. ⚑ At the width a
 * conversation is drawn at beside the rail (1180 − 208 = 972 px), in a window that wide.
 *
 * ⚠️ **The new exports are read through the module's namespace** (`since725`): the browser runner
 * links native modules, and a named import of an export `main` does not have would fail the whole
 * file there — controls included. ⚑
 * So they are called only inside subjects; on `main` a subject fails on what `main` draws.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ R44's and R73's words — `undefined` on `main`, which has none. */
const { inItsRulesWords, inTheAgentsWords } = since725

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972

const THE_MODELS_WORDS = 'Do you want me to clean the build folder?'
const COMMAND = 'rm -rf build'

const POLICY_COMMAND = 'touch /work/a.txt'
const THE_POLICYS_WORDS = `\`${POLICY_COMMAND}\` requires approval: POLICY-JUSTIFICATION-720`

const THE_CLIS_OWN = 'This command runs in the background, past the checks made at approval time.'
const THE_AGENT_ASKS_FOR_ACCESS = 'The agent asks you to grant it more access.'

/** ⚑ The ink a sentence a person must read has to reach — WCAG AA for body text. */
const AA = 4.5

/* ------------------------------------------------------------------ fixtures */

const SCOPE = {
  cwd: '/work',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const, 'cancel' as const],
  underDisclosed: true,
}

/** ⚑ A command the MODEL escalated — `agentReason` carried (`709`), or not, one fact apart. */
const escalated = (withWords: boolean): TranscriptEvent =>
  ({
    type: 'permission_request',
    id: 'number:71',
    kind: 'command',
    action: COMMAND,
    detail: COMMAND,
    scope: SCOPE,
    ...(withWords ? { agentReason: THE_MODELS_WORDS } : {}),
  }) as TranscriptEvent

/** ⚑ A command a POLICY rule stopped — Codex's own sentence, labelled (`720`). */
const stoppedByPolicy: TranscriptEvent = {
  type: 'permission_request',
  id: 'number:74',
  kind: 'command',
  action: POLICY_COMMAND,
  detail: POLICY_COMMAND,
  scope: { ...SCOPE, availableDecisions: ['allow', 'cancel'] },
  providerReason: THE_POLICYS_WORDS,
  providerReasonFrom: 'a-policy-rule',
} as TranscriptEvent

/** ⚑ A Claude ask the CLI marked, with its own reason — R73's control. */
const markedAsk: TranscriptEvent = {
  type: 'permission_request',
  id: 'req_1',
  kind: 'command',
  action: 'Bash',
  detail: 'echo r36 &',
  scope: SCOPE,
  suppressAlwaysAllowRule: true,
  providerReason: THE_CLIS_OWN,
} as TranscriptEvent

/** ⚑ A permissions card as main writes it since `709`. */
const aGrant: TranscriptEvent = {
  type: 'user_input_request',
  id: 'number:73',
  prompt: THE_AGENT_ASKS_FOR_ACCESS,
  questions: [],
  permission: {
    cwd: '/work',
    agentReason: THE_MODELS_WORDS,
    paths: ['write /work/out'],
    network: true,
  },
} as TranscriptEvent

/** ⚑ The same card written before `709`: the model's words as `prompt` AND as `permission.reason`. */
const aLegacyGrant: TranscriptEvent = {
  type: 'user_input_request',
  id: 'number:63',
  prompt: THE_MODELS_WORDS,
  questions: [],
  permission: {
    cwd: '/work',
    reason: THE_MODELS_WORDS,
    paths: ['write /work/out'],
    network: true,
  },
} as TranscriptEvent

const CHOSEN = {
  canSpawn: 'default',
  canStaff: 'default',
  maxDepth: 'default',
  maxConcurrent: 'default',
  canMessage: 'default',
  canAssignWork: 'default',
  canInterrupt: 'default',
  canCreateAgents: 'default',
  takesWorkFrom: 'default',
  canCreateProjects: 'default',
  canWriteRules: 'default',
} as unknown as AgentIdentity['chosen']

/** ⚑ The identity the conversation runs as, NAMED by a person — `agentName` finds it by its slug. */
const ADA: AgentIdentity = {
  id: 'aid:ada',
  slug: 'ada',
  displayName: 'Ada',
  createdAt: AT - 86_400_000,
  createdBy: null,
  provider: 'codex',
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
}

/** ⚑ A Codex conversation, run as `ada` — the host's echo of both facts on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  profileId: 'ada',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** A record built rather than patched — `SessionRecord.sessionId` is readonly. */
function conversation(meta: CreatedSession, ...events: TranscriptEvent[]) {
  const r = createSessionRecord(meta.sessionId)
  r.meta = meta
  r.phase = 'open'
  for (const event of events) applyEvent(r.transcript, event, AT)
  return r
}

/** ⚑ The pane, frozen on its one card, in a window as wide as the pane plus the rail. */
async function pane(meta: CreatedSession, event: TranscriptEvent): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, 900)
  const status = event.type === 'user_input_request' ? 'waiting_input' : 'waiting_permission'
  const m = mount(
    ConversationPane,
    paneProps({
      record: conversation(meta, event, { type: 'status', state: status } as TranscriptEvent),
      identities: [ADA],
    }),
    { width: PANE_W, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ Whether a person can READ it where it sits — its painted ink over its painted ground. */
function ink(el: HTMLElement): { ratio: number; says: string } {
  const colour = parseColor(getComputedStyle(el).color)
  expect(colour, 'the line has no colour the harness can read').not.toBeNull()
  const { fg, bg } = paintedInk(el, colour!)
  return { ratio: contrast(fg, bg), says: `${show(fg)} on ${show(bg)}` }
}

/** ⚑ `a` ends at or above where `b` begins — read first, top to bottom. */
const above = (a: Element, b: Element): boolean =>
  a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 0.5

/* ------------------------------------------------------------------ §1 · the conversation */

describe('§1 · R44 + R73 — in a Codex conversation run as Ada', () => {
  it('🔴 the command card draws *Ada says* — drawn whole, legible, inside the card and ABOVE what Allow runs', async () => {
    const m = await pane(CODEX_META, escalated(true))
    const card = m.q('permission-card')
    const detail = m.q('permission-detail')
    const lines = m.all('permission-agent-reason')
    expect(lines.map(text)).toEqual([`Ada says: “${THE_MODELS_WORDS}”`])
    const line = lines[0]!
    expect(text(line)).toBe(inTheAgentsWords('Ada', THE_MODELS_WORDS))
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the agent’s words on the command card')
    expect(card.contains(line)).toBe(true)
    // ⛔ Beside the disclosure, never in it (`181`) — and read before it.
    expect(detail.contains(line)).toBe(false)
    expect(text(detail)).toBe(COMMAND)
    expect(above(line, detail)).toBe(true)
    const { ratio, says } = ink(line)
    expect(ratio, says).toBeGreaterThanOrEqual(AA)
  })

  it('⚑ THE CONTROL — the same card with no `agentReason` draws the disclosure and no agent line', async () => {
    const m = await pane(CODEX_META, escalated(false))
    expect(visible(m.q('permission-detail'))).toBe(true)
    expect(m.all('permission-agent-reason')).toEqual([])
    expect(text(m.q('permission-card'))).not.toContain(' says: “')
  })

  it('🔴 a policy card reads *Codex’s rule* — named from the conversation’s own provider, visible and legible', async () => {
    const m = await pane(CODEX_META, stoppedByPolicy)
    const rule = m.q('permission-provider-reason')
    // ⛔ What `main` draws — the generic label — first.
    expect(text(rule)).not.toBe(inTheProvidersWords(THE_POLICYS_WORDS))
    expect(text(rule)).toBe(inItsRulesWords(THE_POLICYS_WORDS, 'codex'))
    expect(visible(rule)).toBe(true)
    assertDrawn(rule, 'Codex’s rule on the policy card')
    const { ratio, says } = ink(rule)
    expect(ratio, says).toBeGreaterThanOrEqual(AA)
    // ⚑ A policy card carries no agent's words, so it draws no agent line.
    expect(m.all('permission-agent-reason')).toEqual([])
  })

  it('⚑ THE CONTROL — a Claude marked ask still reads *The provider’s reason*, visible', async () => {
    const m = await pane(META, markedAsk)
    const reason = m.q('permission-provider-reason')
    expect(text(reason)).toBe(inTheProvidersWords(THE_CLIS_OWN))
    expect(visible(reason)).toBe(true)
  })

  it('🔴 the grant card draws *Ada says* ABOVE the grant block and outside it — whole and legible', async () => {
    const m = await pane(CODEX_META, aGrant)
    const grant = m.q('user-input-permission')
    const lines = m.all('user-input-agent-reason')
    expect(lines, 'the grant card draws no agent line').toHaveLength(1)
    expect(lines.map(text)).toEqual([inTheAgentsWords('Ada', THE_MODELS_WORDS)])
    const line = lines[0]!
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the agent’s words on the grant card')
    // ⛔ Never a scope line: not in the block, and read before it.
    expect(grant.contains(line)).toBe(false)
    expect(text(grant)).not.toContain(THE_MODELS_WORDS)
    expect(above(line, grant)).toBe(true)
    expect(text(m.q('user-input-prompt'))).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    const { ratio, says } = ink(line)
    expect(ratio, says).toBeGreaterThanOrEqual(AA)
  })

  it('⚑ THE CONTROL — a grant from before `709` is drawn as it was: its words in the grant block, no agent line', async () => {
    const m = await pane(CODEX_META, aLegacyGrant)
    expect(m.all('user-input-agent-reason')).toEqual([])
    const grant = m.q('user-input-permission')
    expect(visible(grant)).toBe(true)
    expect(text(grant.firstElementChild!)).toBe(THE_MODELS_WORDS)
    expect(text(m.q('user-input-prompt'))).toBe(THE_MODELS_WORDS)
  })
})

/* ------------------------------------------------------------------ §2 · Home */

/** ⚑ The row, through the real projection over a record folded by `acceptEvent`, named by `agentName`. */
function homeRow(event: TranscriptEvent): AttentionRequest {
  const record = createSessionRecord('sess_home')
  record.meta = { ...CODEX_META, sessionId: 'sess_home' }
  record.phase = 'open'
  acceptEvent(record, {
    sessionId: 'sess_home',
    ordinal: 0,
    event,
    at: AT,
  } as RuntimeEventMessage)
  const rows = attentionQueue(
    [record],
    () => 'waiting: permission',
    (slug) => agentName(slug, [ADA]),
  )
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's queue, as wide as the page beside the rail. */
async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, 900)
  const m = mount(AttentionQueue, { requests: [row], now: AT + 60_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

describe('§2 · Home — the row draws the agent’s words between what is asked and the scope', () => {
  it('🔴 a command row: *Ada says* is drawn whole and legible, below what is asked and above the scope', async () => {
    const m = await home(homeRow(escalated(true)))
    const row = m.q('attention-request-sess_home')
    const asked = m.q('attention-asked')
    const scope = m.q('attention-scope')
    const lines = m.all('attention-agent-reason')
    expect(lines, 'the row draws no agent line').toHaveLength(1)
    expect(lines.map(text)).toEqual([inTheAgentsWords('Ada', THE_MODELS_WORDS)])
    const line = lines[0]!
    expect(row.contains(line)).toBe(true)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the agent’s words on Home’s row')
    expect(scope.contains(line)).toBe(false)
    expect(above(asked, line)).toBe(true)
    expect(above(line, scope)).toBe(true)
    const { ratio, says } = ink(line)
    expect(ratio, says).toBeGreaterThanOrEqual(AA)
  })

  it('🔴 a grant row draws it too, above a scope that is only what the grant authorizes', async () => {
    const m = await home(homeRow(aGrant))
    const lines = m.all('attention-agent-reason')
    expect(lines, 'the row draws no agent line').toHaveLength(1)
    expect(lines.map(text)).toEqual([inTheAgentsWords('Ada', THE_MODELS_WORDS)])
    expect(visible(lines[0]!)).toBe(true)
    expect(above(lines[0]!, m.q('attention-scope'))).toBe(true)
    expect(text(m.q('attention-scope'))).not.toContain(THE_MODELS_WORDS)
  })

  it('⚑ THE CONTROL — a legacy grant row keeps its words as the first scope line, and draws no agent line', async () => {
    const m = await home(homeRow(aLegacyGrant))
    expect(m.all('attention-agent-reason')).toEqual([])
    const scope = m.q('attention-scope')
    expect(visible(scope)).toBe(true)
    expect(text(scope.firstElementChild!)).toBe(THE_MODELS_WORDS)
  })

  it('🔴 a policy row reads *Codex’s rule* where the provider’s words are drawn', async () => {
    const m = await home(homeRow(stoppedByPolicy))
    const marks = m.all('attention-mark')
    expect(marks.map(text)).not.toEqual([inTheProvidersWords(THE_POLICYS_WORDS)])
    expect(marks.map(text)).toEqual([`Codex’s rule: “${THE_POLICYS_WORDS}”`])
    expect(marks.map(text)).toEqual([inItsRulesWords(THE_POLICYS_WORDS, 'codex')])
    expect(visible(marks[0]!)).toBe(true)
  })
})
