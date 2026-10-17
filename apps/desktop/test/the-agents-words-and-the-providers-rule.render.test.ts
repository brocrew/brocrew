import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome, RuntimeEvent } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import UserInputCard from '../src/renderer/src/components/UserInputCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  GRANT_WITHHELD,
  THE_AGENT,
  inItsRulesWords,
  inTheAgentsWords,
  inTheProvidersWords,
} from '../src/renderer/src/lib/permission-offer'
import {
  usePersonsQueue,
  type PersonsQueueDoors,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import { acceptEvent, createSessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type PermissionItem,
  type TranscriptItem,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
} from '../src/shared/questions'
import {
  agentName,
  providerName,
  type AgentIdentity,
  type CreatedSession,
  type Provider,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 725 · Draws 1 and 2 — the agent's words and the provider's rule, on every card that carries them
 *
 * ⚑ **The two rulings, verbatim** (`725` §1):
 *
 *  - **R44** — *"words the MODEL wrote that reach a card are the agent's, drawn under the agent's
 *    name; never unlabelled, never the provider's. Rows written before 709 carry them unlabelled in
 *    permission.reason and are drawn as they were."*
 *  - **R73** — *"Codex's "… requires approval: <rule text>" is the provider's words, labelled as
 *    Codex's rule (providerReason, a-policy-rule)."*
 *
 * | § | surface | 🔴 subject (RED on `main`) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | the command card | `agentReason` → *"<Name> says: “…”"* in the body, BEFORE the disclosure | the same card with no `agentReason` draws no such line |
 * | 2 | the grant card | `permission.agentReason` → the same line, OUTSIDE the grant block | a row from before `709` draws exactly as it did |
 * | 3 | Home's row | `agentSays`, named by `who`, on BOTH arms — never a scope line | the legacy grant's `reason` is still its first scope line |
 * | 4 | the rule (R73) | *"Codex’s rule: “…”"* on the card, on Home, on the person's queue | the SAME words with no `providerReasonFrom` still read *The provider’s reason* |
 * | 5 | the hops | `TranscriptView` hands each card its name and its provider | a Claude marked ask through the same view is unchanged |
 *
 * ⚑ **The premises go through the real wire and the real fold** — every event crosses
 * `toWireEvent` (which strips any field the schema does not name) and is folded by `applyEvent` /
 * `acceptEvent`, so no card here holds a field main could not have handed it. ⚑ The fixtures are
 * the MEASURED shapes, from `the-agents-words-on-a-card.test.ts`: a command the model escalated with
 * a justification (an offered prefix rule), a permissions request, and a command a policy stopped.
 *
 * ⚠️ **What is RED on `main` and why.** On `97336ddc` no renderer file reads `agentReason`,
 * `permission.agentReason` or `providerReasonFrom`: the cards draw no agent line, Home's row has no
 * `agentSays`, and a policy card reads *"The provider’s reason: “…”"*. ⚠️ The three new exports
 * (`inTheAgentsWords`, `THE_AGENT`, `inItsRulesWords`) are read only INSIDE subjects, never at module
 * scope, so on `main` a subject fails on its own assertion and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — every negative sits beside a positive the same
 * markup satisfies, and markup is read with its comments stripped: this repo's templates carry their
 * reasoning inline, and a comment is not a sentence a person reads. The engine's half — drawn,
 * legible, in order — is `test/dom/the-agents-words-and-the-providers-rule.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/** ⚑ The model's words — `the-agents-words-on-a-card.test.ts`' own fixture, measured as a justification. */
const THE_MODELS_WORDS = 'Do you want me to clean the build folder?'
const COMMAND = 'rm -rf build'

/** ⚑ Codex's policy sentence, in the measured shape — its head is the request's own command. */
const POLICY_COMMAND = "/bin/zsh -lc '/usr/bin/touch a.txt'"
const THE_POLICYS_WORDS = `\`${POLICY_COMMAND}\` requires approval: POLICY-JUSTIFICATION-720`

/** ⚑ The Claude CLI's own reason on a marked ask (`695`, measured) — R73's control. */
const THE_CLIS_OWN =
  'This command runs in the background, past the checks made at approval time. Approve only if you trust it.'

/** ⚑ The headline main has sent on a permissions card since `709` (`THE_AGENT_ASKS_FOR_ACCESS`). */
const THE_AGENT_ASKS_FOR_ACCESS = 'The agent asks you to grant it more access.'

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>
type UserInputRequest = Extract<RuntimeEvent, { type: 'user_input_request' }>

const commandScope = (
  availableDecisions: PermissionOutcome[] = ['allow', 'deny', 'cancel'],
): PermissionRequest['scope'] => ({
  cwd: '/work',
  paths: [],
  networkHosts: [],
  persistence: 'once',
  amendments: [],
  availableDecisions,
  underDisclosed: true,
})

/** ⚑ A command the MODEL escalated — `agentReason` carried (`709`), or not, one fact apart. */
const escalated = (withWords: boolean, id = 'number:71'): PermissionRequest => ({
  type: 'permission_request',
  id,
  kind: 'command',
  action: COMMAND,
  detail: COMMAND,
  scope: commandScope(),
  ...(withWords ? { agentReason: THE_MODELS_WORDS } : {}),
})

/** ⚑ A command a POLICY rule stopped — Codex's sentence as `providerReason`, labelled or not. */
const stoppedByPolicy = (labelled: boolean, id = 'number:74'): PermissionRequest => ({
  type: 'permission_request',
  id,
  kind: 'command',
  action: POLICY_COMMAND,
  detail: POLICY_COMMAND,
  scope: commandScope(['allow', 'cancel']),
  providerReason: THE_POLICYS_WORDS,
  ...(labelled ? { providerReasonFrom: 'a-policy-rule' as const } : {}),
})

/** ⚑ A Claude ask the CLI marked, with its own reason and no `providerReasonFrom`. */
const markedAsk = (id = 'req_1'): PermissionRequest => ({
  type: 'permission_request',
  id,
  kind: 'command',
  action: 'Bash',
  detail: 'echo r36 &',
  scope: commandScope(),
  suppressAlwaysAllowRule: true,
  providerReason: THE_CLIS_OWN,
})

/** ⚑ A permissions card as main has written it since `709` — this app's headline, the agent's words by name. */
const aGrant = (id = 'number:73'): UserInputRequest => ({
  type: 'user_input_request',
  id,
  prompt: THE_AGENT_ASKS_FOR_ACCESS,
  questions: [],
  permission: {
    cwd: '/work',
    agentReason: THE_MODELS_WORDS,
    paths: ['write /work/out'],
    network: true,
  },
})

/**
 * ⚑ **The same card written BEFORE `709`** — the model's words unlabelled TWICE, as `prompt` and as
 * `permission.reason` (`git show 2125bc52^:…/codex-runtime.ts`), and no `agentReason`.
 */
const aLegacyGrant = (id = 'number:63'): UserInputRequest => ({
  type: 'user_input_request',
  id,
  prompt: THE_MODELS_WORDS,
  questions: [],
  permission: {
    cwd: '/work',
    reason: THE_MODELS_WORDS,
    paths: ['write /work/out'],
    network: true,
  },
})

/** ⚑ Across main's wire, which keeps only the fields its schema names — the premise is never hand-set. */
const wired = (provider: Provider, event: RuntimeEvent): TranscriptEvent =>
  toWireEvent(provider, event) satisfies TranscriptEvent

/** ⚑ One event through the wire and the real fold — the item the transcript hands its card. */
function folded(provider: Provider, event: RuntimeEvent): TranscriptItem[] {
  const state = createTranscript()
  applyEvent(state, wired(provider, event), AT)
  return state.items
}

function permissionItem(provider: Provider, event: PermissionRequest): PermissionItem {
  const item = folded(provider, event).find((one) => one.kind === 'permission')
  if (item?.kind !== 'permission') throw new Error('the fold made no permission card')
  return item
}

function userInputItem(event: UserInputRequest): UserInputItem {
  const item = folded('codex', event).find((one) => one.kind === 'userInput')
  if (item?.kind !== 'userInput') throw new Error('the fold made no grant card')
  return item
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

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

/** ⚑ Every text a `data-cy` element holds, decoded, in document order — the element's own text only. */
const textsOf = (markup: string, cy: string): string[] =>
  [
    ...shown(markup).matchAll(new RegExp(`data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map((one) => decode(one[1]!.trim()))

/** ⚑ Where an element starts in the markup, or `-1` — for asking what is drawn before what. */
const at = (markup: string, cy: string): number => shown(markup).indexOf(`data-cy="${cy}"`)

/** ⚑ How many times a person reads these words anywhere on the surface. */
const times = (markup: string, words: string): number =>
  decode(shown(markup)).split(words).length - 1

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · R44 — the command card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · R44 — a command card draws the model’s words as its agent’s, beside the disclosure', () => {
  const card = (request: PermissionRequest, over: Record<string, unknown> = {}): Promise<string> =>
    render(PermissionCard, { item: permissionItem('codex', request), ...over })

  it('🔴 a Codex command card with `agentReason` says it under the agent’s NAME — inside the body, before what Allow runs', async () => {
    const html = await card(escalated(true), { ownAgent: 'Ada', provider: 'codex' })
    // ⚑ The words, once verbatim — R44 fixed the rule; `725` chose the form (the proposal row's
    // *"<name> says: …"*, quoted like the provider's own reason).
    expect(textsOf(html, 'permission-agent-reason')).toEqual([
      'Ada says: “Do you want me to clean the build folder?”',
    ])
    expect(textsOf(html, 'permission-agent-reason')).toEqual([
      inTheAgentsWords('Ada', THE_MODELS_WORDS),
    ])
    // ⛔ **Never the disclosure** (`181`): the detail is still exactly the command, and the model's
    // words are read ONCE on the card — in the agent's line and nowhere else.
    expect(textsOf(html, 'permission-detail')).toEqual([COMMAND])
    expect(times(html, THE_MODELS_WORDS)).toBe(1)
    // ⚑ In the body, above the disclosure: a sentence ABOUT the command, read before the command.
    expect(at(html, 'permission-agent-reason')).toBeGreaterThan(
      shown(html).indexOf('class="permission-body"'),
    )
    expect(at(html, 'permission-agent-reason')).toBeGreaterThan(at(html, 'permission-action'))
    expect(at(html, 'permission-agent-reason')).toBeLessThan(at(html, 'permission-detail'))
    // ⛔ Never unlabelled, never the provider's.
    expect(textsOf(html, 'permission-summary')).toEqual([])
    expect(textsOf(html, 'permission-provider-reason')).toEqual([])
  })

  it('⚑ THE CONTROL — the same card with no `agentReason` draws no agent line, and the same disclosure', async () => {
    const html = await card(escalated(false), { ownAgent: 'Ada', provider: 'codex' })
    expect(at(html, 'permission-agent-reason')).toBe(-1)
    expect(decode(shown(html))).not.toContain(' says: “')
    // ⚑ …and it is a card that drew its body — the negative sits beside what the markup does hold.
    expect(textsOf(html, 'permission-action')).toEqual([COMMAND])
    expect(textsOf(html, 'permission-detail')).toEqual([COMMAND])
  })

  it('🔴 a card mounted with no name says *The agent* — the absence said out loud, never an invented identity', async () => {
    for (const over of [{}, { ownAgent: null }]) {
      const html = await card(escalated(true), over)
      expect(textsOf(html, 'permission-agent-reason'), JSON.stringify(over)).toEqual([
        `${THE_AGENT} says: “${THE_MODELS_WORDS}”`,
      ])
    }
    // ⚑ rule 5 — the word, verbatim once.
    expect(THE_AGENT).toBe('The agent')
  })

  it('🔴 the agent’s words are drawn as TEXT — markup in them is escaped, never rendered', async () => {
    const html = await card(
      { ...escalated(false), agentReason: 'Allow <img src=x onerror=1> please' },
      { ownAgent: 'Ada' },
    )
    expect(textsOf(html, 'permission-agent-reason')).toEqual([
      'Ada says: “Allow <img src=x onerror=1> please”',
    ])
    expect(html).not.toContain('<img')
  })

  it('⚑ a policy card carries no `agentReason` — so it draws no agent line (it fails closed, `709` F-11)', async () => {
    const html = await card(stoppedByPolicy(true), { ownAgent: 'Ada', provider: 'codex' })
    expect(at(html, 'permission-agent-reason')).toBe(-1)
    // ⚑ …beside the provider's line the same markup does draw.
    expect(textsOf(html, 'permission-provider-reason')).toHaveLength(1)
  })

  it('⚑ an ANSWERED card folds its body away — and the agent’s line with it, as the disclosure goes', async () => {
    const item = { ...permissionItem('codex', escalated(true)), outcome: 'allow' as const }
    const html = await render(PermissionCard, { item, ownAgent: 'Ada' })
    expect(at(html, 'permission-detail')).toBe(-1)
    expect(at(html, 'permission-agent-reason')).toBe(-1)
    expect(html).toContain('data-cy="permission-card"')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · R44 — the grant card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · R44 — a grant card draws the model’s words as its agent’s, outside what the grant authorizes', () => {
  const card = (request: UserInputRequest, over: Record<string, unknown> = {}): Promise<string> =>
    render(UserInputCard, { item: userInputItem(request), ...over })

  /** ⚑ The grant block's first line — the one a legacy row fills with the model's words. */
  const firstGrantLine = (html: string): string | undefined =>
    /data-cy="user-input-permission"[^>]*>\s*<div[^>]*>([^<]*)<\/div>/.exec(shown(html))?.[1]

  it('🔴 `permission.agentReason` is drawn by the agent’s name, under this app’s headline and BEFORE the grant block', async () => {
    const html = await card(aGrant(), { ownAgent: 'Ada' })
    expect(textsOf(html, 'user-input-agent-reason')).toEqual([
      'Ada says: “Do you want me to clean the build folder?”',
    ])
    expect(textsOf(html, 'user-input-agent-reason')).toEqual([
      inTheAgentsWords('Ada', THE_MODELS_WORDS),
    ])
    // ⚑ The headline stays this app's own sentence.
    expect(textsOf(html, 'user-input-prompt')).toEqual([THE_AGENT_ASKS_FOR_ACCESS])
    // ⛔ **Never a scope line** (`permission.ts`): read once, and that once is above the block.
    expect(times(html, THE_MODELS_WORDS)).toBe(1)
    expect(at(html, 'user-input-prompt')).toBeLessThan(at(html, 'user-input-agent-reason'))
    expect(at(html, 'user-input-agent-reason')).toBeLessThan(at(html, 'user-input-permission'))
    expect(firstGrantLine(html)).toBe('cwd: /work')
  })

  it('⚑ THE CONTROL — a row from before `709` is drawn as it was: its words unlabelled, as prompt and first grant line, and no agent line', async () => {
    const html = await card(aLegacyGrant(), { ownAgent: 'Ada' })
    expect(at(html, 'user-input-agent-reason')).toBe(-1)
    expect(decode(shown(html))).not.toContain(' says: “')
    expect(textsOf(html, 'user-input-prompt')).toEqual([THE_MODELS_WORDS])
    expect(firstGrantLine(html)).toBe(THE_MODELS_WORDS)
    expect(times(html, THE_MODELS_WORDS)).toBe(2)
  })

  it('🔴 a grant card mounted with no name says *The agent*', async () => {
    const html = await card(aGrant())
    expect(textsOf(html, 'user-input-agent-reason')).toEqual([
      `${THE_AGENT} says: “${THE_MODELS_WORDS}”`,
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · R44 — Home's row
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ The roster the screen names a profile through — `agentName`, the app's one naming function. */
const ROSTER = [{ slug: 'ada', displayName: 'Ada' }] as unknown as AgentIdentity[]
const nameOf = (slug: string): string => agentName(slug, ROSTER)

/** ⚑ A conversation as the store holds one: the host's meta, and a message folded by `acceptEvent`. */
function homeRow(
  event: RuntimeEvent,
  meta: { provider: Provider | null; profileId: string | null },
): AttentionRequest {
  const record = createSessionRecord('sess_1')
  record.meta = {
    sessionId: 'sess_1',
    cwd: '/work',
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: AT },
    ...meta,
  } as unknown as CreatedSession
  record.phase = 'open'
  const provider = meta.provider ?? 'codex'
  acceptEvent(record, {
    sessionId: 'sess_1',
    ordinal: 0,
    event: wired(provider, event),
    at: AT,
  } as RuntimeEventMessage)
  const rows = attentionQueue([record], () => 'waiting: permission', nameOf)
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

const ADA = { provider: 'codex' as const, profileId: 'ada' }
const renderHome = (row: AttentionRequest): Promise<string> =>
  render(AttentionQueue, { requests: [row], now: AT + 60_000 })

describe('§3 · R44 — Home’s row says the agent’s words by its name, and never as a scope line', () => {
  it('🔴 a command row carries `agentSays`, named by `who`, and draws it between what is asked and the scope', async () => {
    const row = homeRow(escalated(true), ADA)
    // ⚑ The premise, off the real projection: the name is `who`, through the roster.
    expect(row.who).toBe('Ada')
    expect(row.agentSays).toBe('Ada says: “Do you want me to clean the build folder?”')
    expect(row.agentSays).toBe(inTheAgentsWords(row.who, THE_MODELS_WORDS))
    // ⛔ Never a scope line — the scope is still what Allow runs.
    expect(row.scope).toEqual([COMMAND, 'in /work'])
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-agent-reason')).toEqual([row.agentSays])
    expect(at(html, 'attention-asked')).toBeLessThan(at(html, 'attention-agent-reason'))
    expect(at(html, 'attention-agent-reason')).toBeLessThan(at(html, 'attention-scope'))
    expect(times(html, THE_MODELS_WORDS)).toBe(1)
  })

  it('⚑ THE CONTROL — the same row with no `agentReason` carries no `agentSays` key and draws no line', async () => {
    const row = homeRow(escalated(false), ADA)
    expect(row.who).toBe('Ada')
    expect('agentSays' in row).toBe(false)
    expect(row.scope).toEqual([COMMAND, 'in /work'])
    const html = await renderHome(row)
    expect(at(html, 'attention-agent-reason')).toBe(-1)
    expect(textsOf(html, 'attention-asked')).toEqual([COMMAND])
  })

  it('🔴 a grant row carries it too — off `permission.agentReason`, and its scope is only what the grant authorizes', async () => {
    const row = homeRow(aGrant(), ADA)
    expect(row.kind).toBe('question')
    expect(row.asked).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    expect('agentSays' in row, 'the grant row carries no agent line').toBe(true)
    expect(row.agentSays).toBe(inTheAgentsWords('Ada', THE_MODELS_WORDS))
    expect(row.scope).toEqual([
      'in /work',
      'paths: write /work/out',
      'network: access requested, without naming a host',
    ])
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-agent-reason')).toEqual([
      'Ada says: “Do you want me to clean the build folder?”',
    ])
    expect(at(html, 'attention-agent-reason')).toBeLessThan(at(html, 'attention-scope'))
  })

  it('⚑ THE CONTROL — a LEGACY grant keeps its `reason` as the first scope line, as it was, and carries no `agentSays`', async () => {
    const row = homeRow(aLegacyGrant(), ADA)
    expect('agentSays' in row).toBe(false)
    expect(row.asked).toBe(THE_MODELS_WORDS)
    expect(row.scope).toEqual([
      THE_MODELS_WORDS,
      'in /work',
      'paths: write /work/out',
      'network: access requested, without naming a host',
    ])
    const html = await renderHome(row)
    expect(at(html, 'attention-agent-reason')).toBe(-1)
    expect(decode(shown(html))).not.toContain(' says: “')
  })

  it('🔴 a conversation whose profile the host has not said is drawn as *The agent*’s — on both arms', () => {
    const nobody = { provider: 'codex' as const, profileId: null }
    for (const event of [escalated(true), aGrant()]) {
      const row = homeRow(event, nobody)
      expect(row.who).toBeNull()
      expect(row.agentSays, event.type).toBe(`${THE_AGENT} says: “${THE_MODELS_WORDS}”`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · R73 — the provider's rule
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · R73 — a policy’s words are labelled as the provider’s RULE, wherever the provider’s reason is drawn', () => {
  it('🔴 the card, in a Codex conversation, reads *Codex’s rule* — the whole sentence, between the quotes', async () => {
    const html = await render(PermissionCard, {
      item: permissionItem('codex', stoppedByPolicy(true)),
      provider: 'codex',
    })
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      "Codex’s rule: “`/bin/zsh -lc '/usr/bin/touch a.txt'` requires approval: POLICY-JUSTIFICATION-720”",
    ])
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      inItsRulesWords(THE_POLICYS_WORDS, 'codex'),
    ])
    expect(decode(shown(html))).not.toContain('The provider’s reason')
    // ⚠️ **Not split** (`720` F-G): the command inside it is the model's bytes, and the quotes say
    // where the provider's words begin and end — so the whole sentence is inside them, once.
    expect(times(html, THE_POLICYS_WORDS)).toBe(1)
  })

  it('🔴 a card that does not know its conversation’s provider says *The provider’s rule*', async () => {
    for (const over of [{}, { provider: null }]) {
      const html = await render(PermissionCard, {
        item: permissionItem('codex', stoppedByPolicy(true)),
        ...over,
      })
      expect(textsOf(html, 'permission-provider-reason'), JSON.stringify(over)).toEqual([
        `The provider’s rule: “${THE_POLICYS_WORDS}”`,
      ])
    }
  })

  it('⚑ THE CONTROL — the SAME words with no `providerReasonFrom` are still *the provider’s reason*', async () => {
    const html = await render(PermissionCard, {
      item: permissionItem('codex', stoppedByPolicy(false)),
      provider: 'codex',
    })
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      inTheProvidersWords(THE_POLICYS_WORDS),
    ])
    expect(decode(shown(html))).not.toContain('’s rule: “')
  })

  it('⚑ THE CONTROL — a Claude marked ask reads *The provider’s reason*, whatever provider the card is told', async () => {
    const html = await render(PermissionCard, {
      item: permissionItem('claude', markedAsk()),
      provider: 'claude',
    })
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      `The provider’s reason: “${THE_CLIS_OWN}”`,
    ])
    expect(textsOf(html, 'permission-grant-withheld')).toEqual([GRANT_WITHHELD])
  })

  it('🔴 Home’s row says the same sentence, named from the row’s own provider', async () => {
    const row = homeRow(stoppedByPolicy(true), ADA)
    expect(row.provider).toBe('codex')
    // ⛔ What `main` draws here — the generic label — first, so a RED on `main` is about the drawing.
    expect(row.marksSay).toHaveLength(1)
    expect(row.marksSay).not.toEqual([inTheProvidersWords(THE_POLICYS_WORDS)])
    expect(row.marksSay).toEqual([inItsRulesWords(THE_POLICYS_WORDS, 'codex')])
    expect(textsOf(await renderHome(row), 'attention-mark')).toEqual([
      `${providerName('codex')}’s rule: “${THE_POLICYS_WORDS}”`,
    ])
    // ⚑ …and a policy row carries no agent's words.
    expect('agentSays' in row).toBe(false)
  })

  it('⚑ THE CONTROLS on Home — the unlabelled words, and a Claude marked ask, read as they did', async () => {
    const unlabelled = homeRow(stoppedByPolicy(false), ADA)
    expect(unlabelled.marksSay).toEqual([inTheProvidersWords(THE_POLICYS_WORDS)])
    const claude = homeRow(markedAsk(), { provider: 'claude', profileId: 'ada' })
    expect(claude.marksSay).toEqual([GRANT_WITHHELD, inTheProvidersWords(THE_CLIS_OWN)])
    expect(textsOf(await renderHome(claude), 'attention-mark')).toEqual([
      GRANT_WITHHELD,
      `The provider’s reason: “${THE_CLIS_OWN}”`,
    ])
  })

  it('⚑ rule 5 — the label is composed from the provider’s name, never typed, and names Claude too', () => {
    expect(inItsRulesWords('r', 'codex')).toBe('Codex’s rule: “r”')
    expect(inItsRulesWords('r', 'claude')).toBe(`${providerName('claude')}’s rule: “r”`)
    expect(inItsRulesWords('r', null)).toBe('The provider’s rule: “r”')
    expect(inTheAgentsWords(null, 'w')).toBe('The agent says: “w”')
    expect(inTheAgentsWords('Ada', 'w')).toBe('Ada says: “w”')
  })
})

describe('§4b · R73 — the person’s queue copies the live row’s sentence', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  /** ⚑ The decision the host's walk hands the queue — `what-main-handed-and-nobody-drew`'s shape. */
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

  /** ⚑ Supplied the way the screen supplies it; the rows are read off the SAME state the component draws. */
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

  it('🔴 a policy row on the person’s queue reads *Codex’s rule*, off the live row', async () => {
    const live = homeRow(stoppedByPolicy(true), ADA)
    const row = supply([live]).find((one) => one.key === live.key)
    if (row === undefined) throw new Error('the person’s queue drew no row')
    expect(row.marksSay).toEqual([`Codex’s rule: “${THE_POLICYS_WORDS}”`])
    const markup = await render(PersonsQueue, {})
    expect(textsOf(markup, `persons-queue-mark-${live.key}`)).toEqual([
      inItsRulesWords(THE_POLICYS_WORDS, 'codex'),
    ])
  })

  it('⚑ THE CONTROL — the same words, unlabelled, read *The provider’s reason* there too', async () => {
    const live = homeRow(stoppedByPolicy(false), ADA)
    supply([live])
    const markup = await render(PersonsQueue, {})
    expect(textsOf(markup, `persons-queue-mark-${live.key}`)).toEqual([
      inTheProvidersWords(THE_POLICYS_WORDS),
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the hops — TranscriptView hands each card its agent's name and its provider
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the transcript hands each card the name and the provider it draws under', () => {
  const view = (items: TranscriptItem[], over: Record<string, unknown> = {}): Promise<string> =>
    render(TranscriptView, { items, mode: 'normal', ...over })

  it('🔴 the command card in a transcript is named by the view’s `ownAgent`', async () => {
    const html = await view(folded('codex', escalated(true)), { ownAgent: 'Ada' })
    expect(textsOf(html, 'permission-agent-reason'), 'no agent line').toHaveLength(1)
    expect(textsOf(html, 'permission-agent-reason')).toEqual([
      inTheAgentsWords('Ada', THE_MODELS_WORDS),
    ])
  })

  it('🔴 the grant card in a transcript is named by the view’s `ownAgent`', async () => {
    const html = await view(folded('codex', aGrant()), { ownAgent: 'Ada' })
    expect(textsOf(html, 'user-input-agent-reason'), 'no agent line').toHaveLength(1)
    expect(textsOf(html, 'user-input-agent-reason')).toEqual([
      inTheAgentsWords('Ada', THE_MODELS_WORDS),
    ])
  })

  it('🔴 a view with no name hands its cards none — they say *The agent*', async () => {
    const items = [...folded('codex', escalated(true)), ...folded('codex', aGrant())]
    const html = await view(items)
    expect(textsOf(html, 'permission-agent-reason'), 'no agent line').toHaveLength(1)
    expect(textsOf(html, 'user-input-agent-reason'), 'no agent line').toHaveLength(1)
    expect(textsOf(html, 'permission-agent-reason')).toEqual([
      inTheAgentsWords(null, THE_MODELS_WORDS),
    ])
    expect(textsOf(html, 'user-input-agent-reason')).toEqual([
      inTheAgentsWords(null, THE_MODELS_WORDS),
    ])
  })

  it('🔴 the policy card in a transcript is labelled by the view’s `provider`', async () => {
    const html = await view(folded('codex', stoppedByPolicy(true)), { provider: 'codex' })
    expect(textsOf(html, 'permission-provider-reason')).toHaveLength(1)
    expect(textsOf(html, 'permission-provider-reason')).not.toEqual([
      inTheProvidersWords(THE_POLICYS_WORDS),
    ])
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      inItsRulesWords(THE_POLICYS_WORDS, 'codex'),
    ])
  })

  it('⚑ THE CONTROL — a Claude marked ask through the same view reads as it did', async () => {
    const html = await view(folded('claude', markedAsk()), { provider: 'claude', ownAgent: 'Ada' })
    expect(textsOf(html, 'permission-provider-reason')).toEqual([inTheProvidersWords(THE_CLIS_OWN)])
    expect(at(html, 'permission-agent-reason')).toBe(-1)
  })
})
