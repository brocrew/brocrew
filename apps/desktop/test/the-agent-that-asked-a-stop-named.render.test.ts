import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import NoticeEntry from '../src/renderer/src/components/NoticeEntry.vue'
import ReadingPane from '../src/renderer/src/components/ReadingPane.vue'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { WindowState } from '../src/renderer/src/lib/transcript-window'
import { CAPABILITY_FIELDS, DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { ASKED_TO_STOP, stoppedBy } from '../src/shared/how-work-stopped'
import {
  DEFAULT_PROFILE_ID,
  agentName,
  providerName,
  type AgentIdentity,
  type CreatedSession,
  type LibraryEntry,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 737 · Draw 2, first half — the agent that asked a turn to stop, NAMED
 *
 * ⚑ **The findings, verbatim** — `734` F-2: *"`stop_unanswered.agentProfile` and
 * `work_interrupted.agentProfile`, through `agentName(slug, identities)`; absent → the category,
 * never the handle."* `732` §3.4: *"The renderer is untouched and still draws "asked to stop by
 * sess_…" until the frontend reads `agentProfile`."* Under **R41** — *"every identity a person reads
 * is NAMED (`agentName`), never by slug, and never by a folder."*
 *
 * | § | surface | 🔴 subject (RED on `main` 92209678) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | `NoticeEntry` over the ask (`work_interrupted`) | with the roster: *"asked to stop by Grace"*; the fold's own text is the category and never `sess_…`; no roster → the category; a row with no identity → the category; an identity the roster lacks → `agentName`'s fallback | a PERSON's ask carrying a planted identity is *a person*; an agent's ask that carries neither handle nor identity is *an agent*, never *BroBot*; a text-only double keeps its text; the third kind keeps its words |
 * | 2 | `NoticeEntry` over `stop_unanswered` | with the provider AND the roster: *"Codex has not answered the stop asked for by Grace"*; the fold keeps `agentProfile` on the fact; an identity the roster lacks → the slug | no roster → *an agent*; a row with no identity (before `734`) → *an agent*, never *BroBot*; a PERSON's with a planted identity → *a person*; no provider and no roster → the fold's own words |
 * | 3 | `ConversationPane` — the Stop's title, the composer's foot, and both lines | with the roster, all four name Grace | the same pane with no roster, and the same pane over rows that carry no identity: *an agent*, never *BroBot* |
 * | 4 | the reading pane, and the full view of a conversation drawn from its ledger (D-017b: the kept-open pane went with the open/closed split) | each draws both lines naming Grace | the same pane with no roster draws no name |
 *
 * ⚠️ **What `main` (92209678) draws instead** — MEASURED: the ask's line reads *"asked to stop by
 * sess_7c1e0b"* (the asking conversation's HANDLE, `stoppedBy(by, event.agent)`) whatever the roster,
 * and the unanswered line, the Stop's title and the foot read *"…asked for by an agent"* even when
 * the row names the identity (`stopUnansweredSays` read `stoppedBy(fact.by, null)`, and the fold
 * dropped `agentProfile`).
 *
 * ⚑ **The rows are the host's own shape**: `the-queue-names-agents-not-folders.test.ts` §2.1 measures
 * the real host writing `{ type: 'work_interrupted', by: 'an-agent', agent, agentProfile: 'boss-g' }`
 * and the `stop_unanswered` that follows it, with Grace's identity as `boss-g` — the same slug and
 * the same name here. ⚑ Every item a component is handed is the REAL fold's (`applyEvent`, or the
 * record's one door `acceptEvent`), and every identity is a whole `AgentIdentity`.
 *
 * ⚠️ **New exports** (`askedToStopSays`, `whoAskedItToStop`) are reached only INSIDE subjects, by a
 * dynamic `import()` taken AFTER the drawing was asserted — so on `main` a subject fails on what
 * `main` draws, and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — every negative sits beside a positive the same
 * markup satisfies, markup is read with its comments stripped, and every reading is taken off the
 * ELEMENT (a line's text, a `title`, the foot). The engine's half — drawn whole at 972 px — is
 * `test/dom/the-agent-that-asked-a-stop-named.dom.test.ts`.
 */

const AT = 1_700_000_000_000

/** ⚑ The new exports — read inside subjects only (see the header). */
const since737 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

/* ------------------------------------------------------------------ the roster */

/** ⚑ Every capability at `'default'` — nothing here reads a grant; a grant invented here would be this file's. */
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

/** ⚑ `734`'s rig: Grace is `boss-g` — a name that is NOT its slug, so a drawing of the slug cannot pass. */
const GRACE_SLUG = 'boss-g'
/** ⚑ An identity this roster does not hold — a row that outlived its identity, or a roster read before it. */
const UNLISTED_SLUG = 'auditor'
/**
 * ⚑ The seeded one included, unnamed — so `agentName(null, ROSTER)` really answers *BroBot* here and
 * a drawing that let an absent identity reach it would say so (the hazard is armed, §0).
 */
const ROSTER: readonly AgentIdentity[] = [
  identity(DEFAULT_PROFILE_ID, null),
  identity(GRACE_SLUG, 'Grace'),
  identity('pm-g', 'Ada'),
]

/** ⚑ The name, derived ONCE by the one naming function and pinned as one literal. */
const GRACE = 'Grace'

/** ⚑ The asking conversation's handle — the word that must never be drawn (`HO-095` §5.3). */
const HANDLE = 'sess_7c1e0b'

/* ------------------------------------------------------------------ the words, verbatim ONCE */

const ASKED_BY_GRACE = 'asked to stop by Grace'
const CODEX_NOT_ANSWERED_GRACE = 'Codex has not answered the stop asked for by Grace'
const CODEX_JOINS_GRACE =
  'Codex has not answered the stop asked for by Grace — while that ask stands, Stop joins it rather than asking Codex again'
/** ⚑ The category — `main`'s own composition, so it is the same bytes on both trees. */
const ASKED_BY_AN_AGENT = `${ASKED_TO_STOP} by ${stoppedBy('an-agent', null)}`
const CODEX_NOT_ANSWERED_AN_AGENT = `${providerName('codex')} has not answered the stop asked for by ${stoppedBy('an-agent', null)}`
const CODEX_JOINS_AN_AGENT = `${CODEX_NOT_ANSWERED_AN_AGENT} — while that ask stands, Stop joins it rather than asking Codex again`

/* ------------------------------------------------------------------ the rows */

const CODEX_REF = { provider: 'codex' as const, sessionId: 'th_1', cwd: '/work', rotation: 0 }
const started = { type: 'session', state: 'started', ref: CODEX_REF } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

/** ⚑ An agent's ask, as the host writes it: the handle always, the identity when it holds a binding. */
const agentsAsk = (agentProfile?: string): TranscriptEvent => ({
  type: 'work_interrupted',
  by: 'an-agent',
  agent: HANDLE,
  ...(agentProfile === undefined ? {} : { agentProfile }),
})

/** ⚑ …and the row the host writes when the provider has not answered it within its bound. */
const agentsUnanswered = (agentProfile?: string): TranscriptEvent => ({
  type: 'stop_unanswered',
  waitedMs: 2_000,
  by: 'an-agent',
  agent: HANDLE,
  ...(agentProfile === undefined ? {} : { agentProfile }),
})

/**
 * ⚑ **A person's ask carrying an identity** — `732` M14's plant: the live wire is not bounded, so a
 * planted identity on a person's row reaches the renderer (the replay bound strips it).
 */
const aPersonsPlantedAsk: TranscriptEvent = {
  type: 'work_interrupted',
  by: 'a-person',
  agentProfile: GRACE_SLUG,
}
const aPersonsPlantedUnanswered: TranscriptEvent = {
  type: 'stop_unanswered',
  waitedMs: 2_000,
  by: 'a-person',
  agentProfile: GRACE_SLUG,
}

/* ------------------------------------------------------------------ the fold and the markup */

type NoticeItem = Extract<TranscriptItem, { kind: 'notice' }>

function foldOf(...events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  events.forEach((event, index) => applyEvent(state, event, AT + index * 1_000, index))
  return state
}

const notices = (items: readonly TranscriptItem[]): NoticeItem[] =>
  items.filter((item): item is NoticeItem => item.kind === 'notice')

/** ⚑ The ask's own line — found by its opening words (`ASKED_TO_STOP`), asserted to exist ONCE. */
function theAsk(items: readonly TranscriptItem[]): NoticeItem {
  const found = notices(items).filter((one) => one.text.startsWith(`${ASKED_TO_STOP} by `))
  expect(found, 'the fold drew no notice for the ask').toHaveLength(1)
  return found[0]!
}

/** ⚑ R83's line — asserted to exist ONCE. */
function theUnanswered(items: readonly TranscriptItem[]): NoticeItem {
  const found = notices(items).filter((one) => one.text.includes('has not answered the stop'))
  expect(found, 'the fold drew no notice for `stop_unanswered`').toHaveLength(1)
  return found[0]!
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

/** ⚑ The `title` of every element with this `data-cy`, decoded — `[]` when none is drawn. */
const titlesOf = (markup: string, cy: string): string[] =>
  [...shown(markup).matchAll(new RegExp(`<[a-z]+\\b[^>]*data-cy="${escapeRegExp(cy)}"[^>]*>`, 'g'))]
    .map((tag) => /\btitle="([^"]*)"/.exec(tag[0])?.[1])
    .filter((title): title is string => title !== undefined)
    .map(decode)

/** ⚑ The composer's foot, as a person reads it — tags gone, whitespace collapsed. */
function footOf(markup: string): string {
  const body = /<p[^>]*data-cy="composer-hint"[^>]*>([\s\S]*?)<\/p>/.exec(shown(markup))?.[1]
  expect(body, 'no composer-hint was drawn').toBeDefined()
  return decode(body!.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** ⚑ The one notice line `NoticeEntry` draws, and its title — asserted to be ONE of each. */
async function noticeSays(
  item: NoticeItem,
  over: Record<string, unknown>,
): Promise<{ line: string; title: string; html: string }> {
  const html = await render(NoticeEntry, { item, ...over })
  const lines = textsOf(html, 'what-the-notice-says')
  const titles = titlesOf(html, 'what-the-notice-says')
  expect(lines, JSON.stringify(over)).toHaveLength(1)
  expect(titles, JSON.stringify(over)).toHaveLength(1)
  return { line: lines[0]!, title: titles[0]!, html }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the premise — the name, and the hazard
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · the premise, measured off the one naming function', () => {
  it('⚑ `agentName` names Grace from the slug; the handle and the unlisted slug are not names it holds; and `agentName(null, …)` answers BroBot here', () => {
    expect(agentName(GRACE_SLUG, ROSTER)).toBe(GRACE)
    expect(GRACE).not.toContain(GRACE_SLUG)
    expect(agentName(UNLISTED_SLUG, ROSTER)).toBe(UNLISTED_SLUG)
    // ⚠️ **The hazard is armed**: an absent identity handed to `agentName` would say BroBot — so a
    // drawing below that never says BroBot is a fact about the guard, not about this roster.
    expect(agentName(null, ROSTER)).toBe('BroBot')
    expect(ASKED_BY_GRACE).toBe(`${ASKED_TO_STOP} by ${agentName(GRACE_SLUG, ROSTER)}`)
    expect(ASKED_BY_AN_AGENT).toBe('asked to stop by an agent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the ask's own line (`work_interrupted`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the ask’s line names the agent that asked — with the roster; its category without', () => {
  it('🔴 an agent’s ask carrying its identity, drawn with the roster, reads *asked to stop by Grace* — on the line and on its title', async () => {
    const item = theAsk(foldOf(started, asked, working, agentsAsk(GRACE_SLUG)).items)
    const { line, title, html } = await noticeSays(item, { identities: ROSTER })
    // ⛔ What `main` draws — the asking conversation's HANDLE — first, so a RED there is about it.
    expect(line).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
    expect(line).toBe(ASKED_BY_GRACE)
    expect(title).toBe(ASKED_BY_GRACE)
    expect(decode(shown(html))).not.toContain('sess_')
    expect(decode(shown(html))).not.toContain(GRACE_SLUG)
    // ⚑ rule 5 — the module's one function, with the roster, over the facts the fold kept.
    const { askedToStopSays, whoAskedItToStop } = await since737()
    expect(item.askedToStop).toEqual({ by: 'an-agent', agent: HANDLE, agentProfile: GRACE_SLUG })
    expect(line).toBe(askedToStopSays(item.askedToStop!, ROSTER))
    expect(whoAskedItToStop(item.askedToStop!, ROSTER)).toBe(agentName(GRACE_SLUG, ROSTER))
  })

  it('🔴 the fold’s own text — what a reader with no roster prints — is the asker’s CATEGORY, and never a `sess_` handle, for every asker', () => {
    for (const [ask, says] of [
      [agentsAsk(GRACE_SLUG), ASKED_BY_AN_AGENT],
      [agentsAsk(), ASKED_BY_AN_AGENT],
      [{ type: 'work_interrupted', by: 'an-agent' } as TranscriptEvent, ASKED_BY_AN_AGENT],
      [
        { type: 'work_interrupted', by: 'a-person' } as TranscriptEvent,
        `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
      ],
      [aPersonsPlantedAsk, `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`],
      [
        { type: 'work_interrupted', by: 'a-caller-this-app-cannot-name' } as TranscriptEvent,
        `${ASKED_TO_STOP} by ${stoppedBy('a-caller-this-app-cannot-name', null)}`,
      ],
    ] as const) {
      const state = foldOf(started, asked, working, ask)
      const every = notices(state.items)
        .map((one) => one.text)
        .join('\n')
      expect(every, JSON.stringify(ask)).not.toContain('sess_')
      expect(theAsk(state.items).text, JSON.stringify(ask)).toBe(says)
      // ⚑ A fold holds no roster, so it never names — the name is the drawing's (`NoticeEntry`).
      expect(every, JSON.stringify(ask)).not.toContain(GRACE)
    }
  })

  it('🔴 with NO roster (not landed: absent or `null`) the line says the category — never the handle, never the slug', async () => {
    const item = theAsk(foldOf(started, asked, working, agentsAsk(GRACE_SLUG)).items)
    for (const over of [{}, { identities: null }]) {
      const { line, title } = await noticeSays(item, over)
      expect(line, JSON.stringify(over)).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
      expect(line, JSON.stringify(over)).toBe(ASKED_BY_AN_AGENT)
      expect(title, JSON.stringify(over)).toBe(ASKED_BY_AN_AGENT)
      expect(line, JSON.stringify(over)).not.toContain(GRACE_SLUG)
    }
  })

  it('🔴 a row with no identity (written before `732`, or no binding), WITH the roster, says the category — never the handle, never BroBot', async () => {
    const item = theAsk(foldOf(started, asked, working, agentsAsk()).items)
    const { line } = await noticeSays(item, { identities: ROSTER })
    expect(line).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
    expect(line).toBe(ASKED_BY_AN_AGENT)
    expect(line).not.toContain(agentName(null, ROSTER))
  })

  it('🔴 an identity the roster does not hold reads `agentName`’s own fallback — the folded slug — never the handle, and not the category', async () => {
    const item = theAsk(foldOf(started, asked, working, agentsAsk(UNLISTED_SLUG)).items)
    const { line } = await noticeSays(item, { identities: ROSTER })
    expect(line).not.toBe(`${ASKED_TO_STOP} by ${HANDLE}`)
    expect(line).toBe(`${ASKED_TO_STOP} by ${agentName(UNLISTED_SLUG, ROSTER)}`)
    expect(line).not.toBe(ASKED_BY_AN_AGENT)
  })

  it('⚑ THE CONTROL — a PERSON’s ask carrying a planted identity (`732` M14), with the roster, is *a person*: an identity is read only on an agent’s ask', async () => {
    const item = theAsk(foldOf(started, asked, working, aPersonsPlantedAsk).items)
    const { line, title } = await noticeSays(item, { identities: ROSTER })
    expect(line).toBe(`${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`)
    expect(line).toBe('asked to stop by a person')
    expect(title).toBe(line)
    expect(line).not.toContain(GRACE)
  })

  it('⚑ THE CONTROL — an agent’s ask carrying neither handle nor identity, with the roster, is *an agent* — the absent identity never reaches `agentName` (no BroBot)', async () => {
    const item = theAsk(
      foldOf(started, asked, working, { type: 'work_interrupted', by: 'an-agent' }).items,
    )
    for (const over of [{ identities: ROSTER }, { identities: null }, {}]) {
      const { line } = await noticeSays(item, over)
      expect(line, JSON.stringify(over)).toBe(ASKED_BY_AN_AGENT)
      expect(line, JSON.stringify(over)).not.toContain('BroBot')
    }
  })

  it('⚑ THE CONTROL — the third kind keeps its own words, with the roster or without', async () => {
    const item = theAsk(
      foldOf(started, asked, working, {
        type: 'work_interrupted',
        by: 'a-caller-this-app-cannot-name',
      }).items,
    )
    for (const over of [{ identities: ROSTER }, { identities: null }]) {
      const { line } = await noticeSays(item, over)
      expect(line, JSON.stringify(over)).toBe(
        `${ASKED_TO_STOP} by ${stoppedBy('a-caller-this-app-cannot-name', null)}`,
      )
    }
  })

  it('⚑ THE CONTROL — a double that carries only the TEXT (no `askedToStop`) keeps the old drawing: its text, roster or not', async () => {
    // ⚑ A SYNTHETIC item — the fold always carries the facts; this carries the words and none of
    // them, so the pin is that `NoticeEntry` keys on the facts and never re-reads the text.
    const item: NoticeItem = {
      kind: 'notice',
      id: 'notice-1',
      level: 'warn',
      text: `${ASKED_TO_STOP} by ${stoppedBy('an-agent', null)}`,
      at: AT,
    }
    for (const over of [{ identities: ROSTER }, { identities: null }]) {
      const { line, title } = await noticeSays(item, over)
      expect(line, JSON.stringify(over)).toBe(item.text)
      expect(title, JSON.stringify(over)).toBe(item.text)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the unanswered stop's line (`stop_unanswered`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the unanswered stop’s line names the agent that asked — with the provider AND the roster', () => {
  const twoRows = (profile?: string): TranscriptState =>
    foldOf(started, asked, working, agentsAsk(profile), agentsUnanswered(profile))

  it('🔴 with `provider: codex` and the roster it reads *Codex has not answered the stop asked for by Grace* — on the line and on its title', async () => {
    const item = theUnanswered(twoRows(GRACE_SLUG).items)
    const { line, title, html } = await noticeSays(item, { provider: 'codex', identities: ROSTER })
    // ⛔ What `main` draws — the category, with the identity on the row — first.
    expect(line).not.toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(line).toBe(CODEX_NOT_ANSWERED_GRACE)
    expect(title).toBe(CODEX_NOT_ANSWERED_GRACE)
    expect(decode(shown(html))).not.toContain('sess_')
    // ⚑ rule 5 — the module's one function, with the provider and the roster.
    const { stopUnansweredSays } = await since737()
    expect(line).toBe(
      stopUnansweredSays(
        { by: 'an-agent', waitedMs: 2_000, agentProfile: GRACE_SLUG },
        'codex',
        ROSTER,
      ),
    )
  })

  it('🔴 the fold keeps WHICH agent asked on the fact (`agentProfile`), and its own text stays the roster-less category', () => {
    const state = twoRows(GRACE_SLUG)
    const item = theUnanswered(state.items)
    const fact = { by: 'an-agent', waitedMs: 2_000, agent: HANDLE, agentProfile: GRACE_SLUG }
    expect(item.stopUnanswered).toEqual(fact)
    // ⚑ …and the standing fact the Stop reads is the same one.
    expect(state.stopUnanswered).toEqual(fact)
    expect(item.text).toBe('The provider has not answered the stop asked for by an agent')
    expect(item.text).not.toContain('sess_')
  })

  it('🔴 an identity the roster does not hold reads `agentName`’s fallback — the slug — never the handle', async () => {
    const item = theUnanswered(twoRows(UNLISTED_SLUG).items)
    const { line } = await noticeSays(item, { provider: 'codex', identities: ROSTER })
    expect(line).not.toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(line).toBe(
      `${providerName('codex')} has not answered the stop asked for by ${agentName(UNLISTED_SLUG, ROSTER)}`,
    )
    expect(line).not.toContain('sess_')
  })

  it('⚑ THE CONTROL — the same notice with NO roster (absent or `null`) says the category', async () => {
    const item = theUnanswered(twoRows(GRACE_SLUG).items)
    for (const over of [{}, { identities: null }]) {
      const { line, title } = await noticeSays(item, { provider: 'codex', ...over })
      expect(line, JSON.stringify(over)).toBe(CODEX_NOT_ANSWERED_AN_AGENT)
      expect(title, JSON.stringify(over)).toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    }
  })

  it('⚑ THE CONTROL — a row with no identity (written before `734`), WITH the roster, says the category — never BroBot', async () => {
    const item = theUnanswered(twoRows().items)
    expect(item.stopUnanswered).toEqual({ by: 'an-agent', waitedMs: 2_000, agent: HANDLE })
    const { line } = await noticeSays(item, { provider: 'codex', identities: ROSTER })
    expect(line).toBe(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(line).not.toContain('BroBot')
  })

  it('⚑ THE CONTROL — a PERSON’s unanswered Stop carrying a planted identity, with the roster, is *a person*', async () => {
    const item = theUnanswered(
      foldOf(started, asked, working, aPersonsPlantedAsk, aPersonsPlantedUnanswered).items,
    )
    const { line } = await noticeSays(item, { provider: 'codex', identities: ROSTER })
    expect(line).toBe('Codex has not answered the stop asked for by a person')
    expect(line).not.toContain(GRACE)
  })

  it('⚑ THE CONTROL — no provider and no roster: the fold’s own words, as a surface that knows neither draws them', async () => {
    const item = theUnanswered(twoRows(GRACE_SLUG).items)
    const { line } = await noticeSays(item, {})
    expect(line).toBe(item.text)
    expect(line).toBe('The provider has not answered the stop asked for by an agent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the Stop control — `ConversationPane` hands the roster to the words it gives the composer
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`. */
const CODEX_META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'codex',
  cwd: '/work',
  providerHome: '/homes/codex',
  profileId: 'worker-g',
  ref: CODEX_REF,
  config: {
    home: '/homes/codex',
    homeEnv: 'CODEX_HOME',
    model: 'gpt-5-codex',
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
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: AT },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

/** ⚑ Every row through the record's one door, at the next ordinal — as the store feeds a live record. */
function running(...events: TranscriptEvent[]): SessionRecord {
  const record = createSessionRecord('sess_1')
  record.meta = CODEX_META
  record.phase = 'open'
  for (const event of events) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
  }
  return record
}

const pane = (
  record: SessionRecord,
  identities: readonly AgentIdentity[] | null,
): Promise<string> =>
  render(ConversationPane, {
    record,
    cwd: '/work',
    mode: 'normal' as const,
    debug: false,
    drawerOpen: false,
    drawerTab: 'open',
    models: null,
    capabilities: null,
    draft: '',
    handing: createAttachmentBook().handing(draftKey('sess_1')),
    identities,
  })

describe('§3 · `ConversationPane` — the Stop’s title, the composer’s foot and both lines name the agent that asked', () => {
  it('🔴 with the roster: the Stop’s title and the foot say Stop joins GRACE’s ask; the transcript’s two lines name her', async () => {
    const html = await pane(
      running(started, asked, working, agentsAsk(GRACE_SLUG), agentsUnanswered(GRACE_SLUG)),
      ROSTER,
    )
    // ⚑ The premise — a running conversation with a Stop drawn once.
    expect(titlesOf(html, 'interrupt-session')).toHaveLength(1)
    // ⛔ What `main` draws — the category on the Stop, the handle on the ask — first.
    expect(titlesOf(html, 'interrupt-session')).not.toEqual([`${CODEX_JOINS_AN_AGENT} (Esc)`])
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${CODEX_JOINS_GRACE} (Esc)`])
    expect(footOf(html)).toBe(`${CODEX_JOINS_GRACE}. Esc is Stop; type to queue a message.`)
    const lines = textsOf(html, 'what-the-notice-says')
    expect(lines).toContain(ASKED_BY_GRACE)
    expect(lines).toContain(CODEX_NOT_ANSWERED_GRACE)
    expect(lines.indexOf(ASKED_BY_GRACE)).toBeLessThan(lines.indexOf(CODEX_NOT_ANSWERED_GRACE))
    expect(lines.join('\n')).not.toContain('sess_')
    // ⚑ rule 5 — the words the pane hands the composer are the module's, with the roster.
    const { stopJoinsThatAsk } = await since737()
    expect(CODEX_JOINS_GRACE).toBe(
      stopJoinsThatAsk(
        { by: 'an-agent', waitedMs: 2_000, agent: HANDLE, agentProfile: GRACE_SLUG },
        'codex',
        ROSTER,
      ),
    )
  })

  it('⚑ THE CONTROL — the same pane with NO roster: the Stop and the foot say *an agent*, and neither line names anybody', async () => {
    const html = await pane(
      running(started, asked, working, agentsAsk(GRACE_SLUG), agentsUnanswered(GRACE_SLUG)),
      null,
    )
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${CODEX_JOINS_AN_AGENT} (Esc)`])
    expect(footOf(html)).toBe(`${CODEX_JOINS_AN_AGENT}. Esc is Stop; type to queue a message.`)
    const lines = textsOf(html, 'what-the-notice-says')
    expect(lines).toContain(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(lines.join('\n')).not.toContain(GRACE)
  })

  it('⚑ THE CONTROL — the same pane WITH the roster over rows that carry no identity (before `734`): *an agent*, never BroBot', async () => {
    const html = await pane(
      running(started, asked, working, agentsAsk(), agentsUnanswered()),
      ROSTER,
    )
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${CODEX_JOINS_AN_AGENT} (Esc)`])
    expect(footOf(html)).toBe(`${CODEX_JOINS_AN_AGENT}. Esc is Stop; type to queue a message.`)
    expect(textsOf(html, 'what-the-notice-says')).toContain(CODEX_NOT_ANSWERED_AN_AGENT)
    expect(footOf(html)).not.toContain('BroBot')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the panes that replay a conversation — the same two lines, named
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **D-017b · the kept-open pane is gone** — a conversation the quit left open, like every other,
 * opens in the one full view, drawn from its ledger (`handover: 'recorded'`) until a message
 * continues it. ⚑ So its arm is re-aimed at that view: `ConversationPane` over a RECORDED record.
 */
describe('§4 · the reading pane and the full view of a recorded conversation hand the roster to both lines', () => {
  const SESSION = 'sess_r737'
  /** ⚑ The ledger an agent's unanswered Stop leaves — replayed, as both panes replay it. */
  const ROWS: TranscriptEvent[] = [asked, agentsAsk(GRACE_SLUG), agentsUnanswered(GRACE_SLUG)]
  const page = (rows: TranscriptEvent[]): WindowState => ({
    entries: rows.map((event, ordinal) => ({
      sessionId: SESSION,
      ordinal,
      at: AT + ordinal,
      event,
    })),
    from: 0,
    hasOlder: false,
    turnAligned: true,
    atTail: true,
    behind: 0,
  })
  const entry: LibraryEntry = {
    id: SESSION,
    provider: 'codex',
    providerSessionId: 'thread-r737',
    recordId: SESSION,
    cwd: '/work/checkout',
    title: 'Count to sixty',
    preview: 'count to sixty, slowly',
    createdAt: AT,
    updatedAt: AT + 60_000,
    bytes: 4_096,
    origin: 'ours',
    onDisk: true,
    readable: true,
    derived: null,
    lastEnding: 'interrupted',
    unresumableReason: null,
    child: null,
  }
  const reading = (identities: readonly AgentIdentity[] | null): Promise<string> =>
    render(ReadingPane, { entry, history: page(ROWS), mode: 'normal', identities })
  /**
   * ⚑ **A conversation drawn from its ledger** — what the store adopts from `bridge.look` when
   * nothing runs it here: the page replayed through the record's one door, the host's recorded
   * hand-over on `meta`, and the record `recorded`.
   */
  const recorded = (identities: readonly AgentIdentity[] | null): Promise<string> => {
    const record = createSessionRecord(SESSION)
    record.meta = {
      ...CODEX_META,
      sessionId: SESSION,
      cwd: '/work/checkout',
      handover: 'recorded',
    } as CreatedSession
    for (const one of page(ROWS).entries) acceptEvent(record, one)
    record.phase = 'recorded'
    return render(ConversationPane, {
      record,
      cwd: '/work/checkout',
      mode: 'normal' as const,
      debug: false,
      drawerOpen: false,
      drawerTab: 'open',
      models: null,
      capabilities: null,
      draft: '',
      handing: createAttachmentBook().handing(draftKey(SESSION)),
      identities,
    })
  }

  for (const [name, draw] of [
    ['the reading pane', reading],
    ['the full view of a recorded conversation', recorded],
  ] as const) {
    it(`🔴 ${name}, with the roster, draws both lines naming Grace`, async () => {
      const lines = textsOf(await draw(ROSTER), 'what-the-notice-says')
      expect(lines).not.toContain(`${ASKED_TO_STOP} by ${HANDLE}`)
      expect(lines).toContain(ASKED_BY_GRACE)
      expect(lines).toContain(CODEX_NOT_ANSWERED_GRACE)
    })

    it(`⚑ THE CONTROL — ${name} with no roster names nobody, and says Codex’s line with the category`, async () => {
      const lines = textsOf(await draw(null), 'what-the-notice-says')
      expect(lines).toContain(CODEX_NOT_ANSWERED_AN_AGENT)
      expect(lines.join('\n')).not.toContain(GRACE)
    })
  }
})
