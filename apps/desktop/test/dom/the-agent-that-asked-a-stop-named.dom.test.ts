import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { CAPABILITY_FIELDS, DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { ASKED_TO_STOP, stoppedBy } from '../../src/shared/how-work-stopped'
import {
  AGENT_DISPLAY_NAME_CHARS,
  DEFAULT_PROFILE_ID,
  agentName,
  providerName,
  type AgentIdentity,
  type CreatedSession,
  type TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady, lineCount } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 737 · Draw 2, first half, DRAWN — the agent that asked a turn to stop, named in a real engine
 *
 * ⚑ **The finding, verbatim** (`734` F-2): *"`stop_unanswered.agentProfile` and
 * `work_interrupted.agentProfile`, through `agentName(slug, identities)`; absent → the category,
 * never the handle."* Under **R41** — *"every identity a person reads is NAMED (`agentName`), never
 * by slug, and never by a folder."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a running Codex conversation an agent (Grace) asked to stop, and Codex has not answered — at 972 px with the roster | the ask's line, R83's line and the composer's foot name Grace, each drawn whole; the Stop's title names her | the same conversation with no roster: R83's line, the Stop and the foot say *an agent*, drawn whole |
 * | 2 | …when Grace carries the longest name a person may give (`AGENT_DISPLAY_NAME_CHARS`), beside the drawer | both lines and the foot WRAP and are drawn whole | the same roster over rows with no identity: *an agent*, drawn whole |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the one
 * door — so the roster travels the hops the app uses (`identities` → `TranscriptView` → `NoticeEntry`;
 * `identities` → `stopUnansweredWords` → `PromptComposer`) and is never handed to a child by the
 * test. ⚑ At the width a conversation is drawn at beside the rail (1180 − 208 = 972 px), in a window
 * that wide, and left mounted until the test ends.
 *
 * ⚠️ **What `main` (92209678) draws instead** — MEASURED: the ask's line *"asked to stop by
 * sess_7c1e0b"* (the asking conversation's handle), and R83's line, the Stop's title and the foot
 * *"…asked for by an agent"*, whatever the roster.
 *
 * ⚠️ **The new exports** (`askedToStopSays`) are not on `main`, and this runner fails the WHOLE file
 * on an import it cannot resolve — so `lib/stop-unanswered.ts` is reached by `import.meta.glob`,
 * awaited only inside subjects, after the drawing was asserted.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type Since737 = typeof import('../../src/renderer/src/lib/stop-unanswered')
const SINCE_737 = import.meta.glob<Since737>('../../src/renderer/src/lib/stop-unanswered.ts')

/** ⚑ The module — reached inside subjects only. */
async function since737(): Promise<Since737> {
  const load = Object.values(SINCE_737)[0]
  if (load === undefined) throw new Error('`lib/stop-unanswered.ts` is not on this tree')
  return load()
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/* ------------------------------------------------------------------ the roster */

const CHOSEN = Object.fromEntries(
  CAPABILITY_FIELDS.map((field) => [field.key, 'default']),
) as unknown as AgentIdentity['chosen']

/** ⚑ A whole roster row, as the host's `agentIdentities` hands it out. */
const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: AT - 86_400_000,
  createdBy: null,
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
  provider: null,
  externalMcpServerIds: [],
})

/** ⚑ `734`'s rig: Grace is `boss-g`. */
const GRACE_SLUG = 'boss-g'
const rosterNaming = (name: string): readonly AgentIdentity[] => [
  identity(DEFAULT_PROFILE_ID, null),
  identity(GRACE_SLUG, name),
  identity('pm-g', 'Ada'),
]
const ROSTER = rosterNaming('Grace')
/** ⚑ The name, derived once by the one naming function — and pinned. */
const GRACE = 'Grace'

/**
 * ⚑ **The longest name a person may give** — words, as a person types them, to the schema's own
 * bound (`AGENT_DISPLAY_NAME_CHARS`, the control's `maxlength`).
 */
const LONGEST = (() => {
  const words = ['Grace', 'Brewster', 'Murray', 'Hopper', 'of', 'the', 'Mark', 'One', 'team']
  let name = ''
  for (let i = 0; ; i++) {
    const next = name === '' ? words[i % words.length]! : `${name} ${words[i % words.length]!}`
    if (next.length > AGENT_DISPLAY_NAME_CHARS) return name
    name = next
  }
})()

/** ⚑ The asking conversation's handle — never drawn. */
const HANDLE = 'sess_7c1e0b'

/* ------------------------------------------------------------------ the words, verbatim ONCE */

const ASKED_BY_GRACE = 'asked to stop by Grace'
const CODEX_NOT_ANSWERED_GRACE = 'Codex has not answered the stop asked for by Grace'
const CODEX_JOINS_GRACE = `${CODEX_NOT_ANSWERED_GRACE} — while that ask stands, Stop joins it rather than asking Codex again`
/** ⚑ The category — `main`'s own composition, the same bytes on both trees. */
const CODEX_NOT_ANSWERED_AN_AGENT = `${providerName('codex')} has not answered the stop asked for by ${stoppedBy('an-agent', null)}`
const CODEX_JOINS_AN_AGENT = `${CODEX_NOT_ANSWERED_AN_AGENT} — while that ask stands, Stop joins it rather than asking Codex again`

/* ------------------------------------------------------------------ the conversation */

const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  profileId: 'worker-g',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

const started = { type: 'session', state: 'started', ref: CODEX_META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

/** ⚑ An agent's ask, as the host writes it (`the-queue-names-agents-not-folders.test.ts` §2.1). */
const agentsAsk = (agentProfile?: string): TranscriptEvent => ({
  type: 'work_interrupted',
  by: 'an-agent',
  agent: HANDLE,
  ...(agentProfile === undefined ? {} : { agentProfile }),
})
const agentsUnanswered = (agentProfile?: string): TranscriptEvent => ({
  type: 'stop_unanswered',
  waitedMs: 2_000,
  by: 'an-agent',
  agent: HANDLE,
  ...(agentProfile === undefined ? {} : { agentProfile }),
})

/** ⚑ One row through the one door, at the next ordinal — as the store feeds a live record. */
function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
}

/** ⚑ `reactive`, as the store holds a record. */
function conversation(...events: TranscriptEvent[]): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = CODEX_META
  record.phase = 'open'
  for (const event of events) feed(record, event)
  return record
}

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(record: SessionRecord, over: Record<string, unknown>): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work', ...over }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The one notice line whose words start so — asserted to be ONE. */
function theLine(m: Mounted, starts: string): HTMLElement {
  const found = m.all('what-the-notice-says').filter((el) => text(el).startsWith(starts))
  expect(
    found.map(text),
    `lines: ${JSON.stringify(m.all('what-the-notice-says').map(text))}`,
  ).toHaveLength(1)
  return found[0]!
}

const stopTitle = (m: Mounted): string | null => m.q('interrupt-session').getAttribute('title')

/* ------------------------------------------------------------------ §1 */

describe('§1 · a running Codex conversation Grace asked to stop, and Codex has not answered — at 972 px', () => {
  it('🔴 with the roster, the ask’s line, R83’s line and the composer’s foot name Grace — each drawn whole; the Stop’s title names her', async () => {
    const record = conversation(
      started,
      asked,
      working,
      agentsAsk(GRACE_SLUG),
      agentsUnanswered(GRACE_SLUG),
    )
    const m = await pane(record, { identities: ROSTER })

    // ⛔ What `main` draws — the handle — first, so a RED there is about it.
    const ask = theLine(m, `${ASKED_TO_STOP} by `)
    expect(text(ask)).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
    expect(text(ask)).toBe(ASKED_BY_GRACE)
    expect(ask.getAttribute('title')).toBe(ASKED_BY_GRACE)
    expect(visible(ask)).toBe(true)
    assertDrawn(ask, 'the ask’s line naming Grace', m.host)

    const r83 = theLine(m, `${providerName('codex')} has not answered the stop`)
    expect(text(r83)).not.toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(text(r83)).toBe(CODEX_NOT_ANSWERED_GRACE)
    expect(r83.getAttribute('title')).toBe(CODEX_NOT_ANSWERED_GRACE)
    expect(visible(r83)).toBe(true)
    assertDrawn(r83, 'R83’s line naming Grace', m.host)

    expect(stopTitle(m)).toBe(`${CODEX_JOINS_GRACE} (Esc)`)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${CODEX_JOINS_GRACE}. Esc is Stop; type to queue a message.`)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the composer’s foot naming Grace', m.host)
    // ⚑ At the 12 px floor the sentence is wider than the composer's width: two lines, none cut.
    expect(lineCount(foot)).toBe(2)

    // ⛔ …and the handle is nowhere a person reads.
    expect(text(m.host)).not.toContain(HANDLE)

    // ⚑ rule 5 — the name is `agentName`'s, and the words the module's, for these facts.
    expect(agentName(GRACE_SLUG, ROSTER)).toBe(GRACE)
    const { askedToStopSays, stopJoinsThatAsk } = await since737()
    expect(text(ask)).toBe(
      askedToStopSays({ by: 'an-agent', agent: HANDLE, agentProfile: GRACE_SLUG }, ROSTER),
    )
    expect(stopTitle(m)).toBe(
      `${stopJoinsThatAsk({ by: 'an-agent', waitedMs: 2_000, agentProfile: GRACE_SLUG }, 'codex', ROSTER)} (Esc)`,
    )
  })

  it('⚑ THE CONTROL — the same conversation with no roster: R83’s line, the Stop and the foot say *an agent*, drawn whole; nobody is named', async () => {
    const record = conversation(
      started,
      asked,
      working,
      agentsAsk(GRACE_SLUG),
      agentsUnanswered(GRACE_SLUG),
    )
    const m = await pane(record, { identities: null })
    const r83 = theLine(m, `${providerName('codex')} has not answered the stop`)
    expect(text(r83)).toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    assertDrawn(r83, 'R83’s line with the category', m.host)
    expect(stopTitle(m)).toBe(`${CODEX_JOINS_AN_AGENT} (Esc)`)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${CODEX_JOINS_AN_AGENT}. Esc is Stop; type to queue a message.`)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the composer’s foot with the category', m.host)
    expect(text(m.host)).not.toContain(GRACE)
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the longest name a person may give, beside the drawer — the narrowest the composer is drawn at', () => {
  it('🔴 both lines and the foot carry the whole name, WRAP, and are drawn in full', async () => {
    expect(LONGEST.length).toBeLessThanOrEqual(AGENT_DISPLAY_NAME_CHARS)
    expect(LONGEST.length).toBeGreaterThan(AGENT_DISPLAY_NAME_CHARS - 10)
    const roster = rosterNaming(LONGEST)
    const record = conversation(
      started,
      asked,
      working,
      agentsAsk(GRACE_SLUG),
      agentsUnanswered(GRACE_SLUG),
    )
    const m = await pane(record, { identities: roster, drawerOpen: true })

    const ask = theLine(m, `${ASKED_TO_STOP} by `)
    expect(text(ask)).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
    expect(text(ask)).toBe(`${ASKED_TO_STOP} by ${LONGEST}`)
    expect(lineCount(ask), 'the ask’s line did not wrap').toBeGreaterThan(1)
    assertDrawn(ask, 'the ask’s line with the longest name', m.host)

    const says = `${providerName('codex')} has not answered the stop asked for by ${LONGEST}`
    const r83 = theLine(m, `${providerName('codex')} has not answered the stop`)
    expect(text(r83)).toBe(says)
    expect(lineCount(r83), 'R83’s line did not wrap').toBeGreaterThan(1)
    assertDrawn(r83, 'R83’s line with the longest name', m.host)

    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(
      `${says} — while that ask stands, Stop joins it rather than asking Codex again. Esc is Stop; type to queue a message.`,
    )
    expect(visible(foot)).toBe(true)
    expect(lineCount(foot), 'the foot did not wrap beside the drawer').toBeGreaterThan(1)
    assertDrawn(foot, 'the composer’s foot with the longest name', m.host)
  })

  it('⚑ THE CONTROL — the same long-named roster over rows that carry no identity (before `734`): *an agent*, drawn whole, never the name', async () => {
    const roster = rosterNaming(LONGEST)
    const record = conversation(started, asked, working, agentsAsk(), agentsUnanswered())
    const m = await pane(record, { identities: roster, drawerOpen: true })
    const r83 = theLine(m, `${providerName('codex')} has not answered the stop`)
    expect(text(r83)).toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    assertDrawn(r83, 'R83’s line with the category', m.host)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${CODEX_JOINS_AN_AGENT}. Esc is Stop; type to queue a message.`)
    assertDrawn(foot, 'the composer’s foot with the category', m.host)
    expect(text(m.host)).not.toContain('Brewster')
    // ⚠️ The absent identity never reaches `agentName`, which would answer *BroBot* for it.
    expect(text(m.host)).not.toContain('asked for by BroBot')
  })
})
