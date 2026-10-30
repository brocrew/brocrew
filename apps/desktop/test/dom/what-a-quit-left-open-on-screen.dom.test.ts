import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import ReadingPane from '../../src/renderer/src/components/ReadingPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import WorkFacts from '../../src/renderer/src/components/WorkFacts.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import {
  DEFAULT_IS_NO,
  GRANT_WITHHELD,
  inTheProvidersWords,
} from '../../src/renderer/src/lib/permission-offer'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import type { QueuedItem } from '../../src/renderer/src/lib/transcript'
import { foldWindow, type WindowState } from '../../src/renderer/src/lib/transcript-window'
import { workReading } from '../../src/renderer/src/lib/work-report'
import { aNoticeALaterFactRetracted } from '../../src/main/runtime/reply-rails'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import {
  chainReading,
  chainSentence,
  escalationChain,
  aPersonsSince,
  NOTHING_NAMED_THE_WORK,
  type LedgerWalk,
  type LedgerWalkKind,
  type PersonsQuestion,
  type RoutedRequest,
} from '../../src/shared/questions'
import {
  DEFAULT_PROFILE_ID,
  type AgentIdentities,
  type AgentIdentity,
  type HandedPath,
  type LibraryEntry,
  type ResumableSessionInfo,
  type ResumedSession,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type TranscriptEvent,
  type UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { UNDRIVEN_SENTENCES, type WorkReport } from '../../src/shared/tasks'
import { assertDrawn, drawnReady } from './drawn'
import {
  META,
  mount,
  paintedBackground,
  parseColor,
  permission,
  show,
  unmountAll,
  visible,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * # 🔴 701 · what a quit left open, on screen — what a person SEES, each with its control
 *
 * ⚑ **`701`'s renderer work, read in a real engine** (the dom runner: no Electron, no port). Every
 * section below is a claim about something a person perceives — a word drawn, a pill kept inside
 * its box, an ink, an order, a press — and each carries a control one fact over in the SAME mount
 * or page, because a negative with no positive beside it passes against a surface that draws
 * nothing (`brobot2-ssr-tests-pass-vacuously`). ⚑ §3 is the one exception: it IS the control that
 * stood beside a pair whose subject went, and its box check first asserts the pill has a box.
 *
 * | § | the item, and the dispatch that ordered it | what is measured | the control |
 * |---|---|---|---|
 * | 1 | `692` F-a / F-b — ⚑ **D-017b: the one full view** (`ConversationPane` over the host's recorded hand-over; `KeptOpenPane` is gone) | the header names the agent, the right panel's toggle is there, and no sentence says whether anything runs; a live composer; a card asked before the stop is drawn settled | `ReadingPane` HAS the read-only banner; the same card un-settled offers Allow |
 * | 2 | `701` rail — ⚑ **D-017b: the one list** (`SideRail`) | the row whose conversation is on screen drawn active; every row's press is the one open | the same row with nothing on screen |
 * | 3 | `699` GAP-1 — `WorkFacts` — ⚑ **D-016c: one reading** (the `now` / `as-reported` pair read off `holderKeptOpen` went with it) | at 320 and 380 px a stalled piece's pill says its cause's own words, carries no hover, and stays inside its box (`.wr-word` is `nowrap`) | — this is the geometry and no-hover control that stood beside the pair; the pill must have a box and be drawn |
 * | 4 | `retracted` — `QueuedMessage` | every ending's state and body ink = a `--faint` probe | the same item waiting: `--accent-text` / `--muted` probes |
 * | 5 | `700` §5 GAP 1 — `PersonsQueue`, floating | the marks drawn before the answers, in order, in `--muted`; the refusals NOT dimmed | an unmarked row dims its refusals |
 *
 * ⚠️ **What this file cannot say.** It mounts each component through its own props, so it says
 * nothing about `RuntimeScreen`'s wiring of them (`openConversation`, the send that continues a
 * recorded conversation). ⚑ §1's record is made by the renderer store's own `look` over a stubbed
 * bridge, so the view is handed what the store adopts. ⛔ And the widths are declared, never
 * read back out of a shot: the dom runner draws 0 px overlay scrollbars where Electron draws 11 px
 * (`the-dom-runner-draws-overlay-scrollbars`).
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⛔ Derived from `tokens.css`, not chosen: `--app-min-w` and `--rail-w` (208 px, 220 px ≥1400). */
const APP_MIN_W = 1180
const RAIL_W = 208
/** ⚑ The box a conversation is really given: the app at its floor, and the app as it opens. */
const PANE_WIDTHS = [APP_MIN_W - RAIL_W, 1200 - RAIL_W] as const
const PANE_H = 808

const NOW = Date.now()
const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}
const ink = (el: Element): Rgba => {
  const colour = parseColor(getComputedStyle(el).color)
  expect(colour, `${el.tagName} resolved no colour`).not.toBeNull()
  return colour as Rgba
}
const same = (a: Rgba, b: Rgba): boolean => a.slice(0, 4).join(',') === b.slice(0, 4).join(',')

/**
 * ⚑ **A probe painted in the SAME scope as the element it is compared against** — a custom property
 * resolves where it is read, so a probe at `document.body` would answer for the page's tokens and
 * not for the component's (`an-inherited-property-carries-a-resolved-colour-past-a-token-scope`).
 */
function probe(beside: Element, token: string): HTMLElement {
  const el = document.createElement('span')
  el.style.color = `var(${token})`
  el.textContent = token
  el.dataset.probe = token
  beside.append(el)
  return el
}

/* ---------------------------------------------------------------------------- the one stub */

/**
 * ⚠️ **One bridge for the whole file, installed before anything mounts.** `useAgentStore` memoises
 * the bridge at its first call (`persons-queue.dom.test.ts`' note), so a per-test stub would be
 * captured once and ignored after. ⚑ The rail's two lists read {@link hostRows}, which each test
 * sets before it mounts.
 */
const hostRows: { resumable: ResumableSessionInfo[]; unresumable: UnresumableSessionInfo[] } = {
  resumable: [],
  unresumable: [],
}

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `agp:default:${slug}`,
  slug,
  displayName,
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const roster = (): AgentIdentities => ({
  identities: [identity('pm', null)],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

;(window as unknown as { api?: unknown }).api = {
  runtime: {
    listResumable: () => Promise.resolve(hostRows.resumable),
    listUnresumable: () => Promise.resolve(hostRows.unresumable),
    agentIdentities: async () => roster(),
    setCapabilities: async () => roster().identities[0],
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
  },
}

const queue = usePersonsQueue()
const safety = useSpawnSafety()

beforeEach(() => {
  hostRows.resumable = []
  hostRows.unresumable = []
})

afterEach(async () => {
  unmountAll()
  queue.forget()
  safety.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ---------------------------------------------------------------------------- the rows */

const resumableBase = {
  provider: 'claude' as const,
  cwd: '/Users/alex/dev/brobot-2',
  status: 'idle' as const,
  approvalMode: 'ask' as const,
  profileId: DEFAULT_PROFILE_ID,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed' as const,
  updatedAt: NOW - 240_000,
  running: 'not-running' as const,
  state: { is: 'idle' } as const,
  // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so a row is titled by its agent, as it was.
  named: null,
  resumeRefusal: null,
}

/** An ordinary closed recording: a press reopens it, and its row says when it was last touched. */
const OPENABLE: ResumableSessionInfo = {
  ...resumableBase,
  sessionId: 'sess_openable',
  ref: { provider: 'claude', sessionId: 'thread-1', cwd: resumableBase.cwd, rotation: 0 },
}

/**
 * ⚑ **692 · the quit stopped it** — the quit's own ending wrote `ended`. ⚑ **D-017b** — nothing on
 * the wire says the quit left it open any more (`keptOpenAcrossAQuit` went): it is a conversation
 * nothing runs, like any other, and it opens in its one full view.
 */
const KEPT: ResumableSessionInfo = {
  ...OPENABLE,
  sessionId: 'sess_kept',
  profileId: 'ada',
  status: 'ended',
  ref: { provider: 'claude', sessionId: 'thread-kept', cwd: resumableBase.cwd, rotation: 0 },
}

/** ⚑ A second one, so "drawn active" has a row one fact over in the same rail. */
const KEPT_TOO: ResumableSessionInfo = {
  ...KEPT,
  sessionId: 'sess_kept_too',
  cwd: '/Users/alex/dev/acme/billing-api',
  ref: { provider: 'claude', sessionId: 'thread-kept-2', cwd: '/x', rotation: 0 },
}

/* ============================================================ §1 · KeptOpenPane */

const ADA = 'Ada'
const IDS: AgentIdentity[] = [identity('ada', ADA)]

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent
const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
  sessionId: KEPT.sessionId,
  ordinal,
  at: 1_700_000_000_000 + ordinal * 1_000,
  event,
})

const USER_SAID = 'rebuild the orders index, then tell me what broke'
const AGENT_SAID = 'Rebuilding it now — I need to run one command first.'

/** ⚑ One user turn, one reply, and a permission the provider asked and nobody answered. */
const ENTRIES: RuntimeEventMessage[] = [
  at(0, ev({ type: 'user_turn', text: USER_SAID })),
  at(1, ev({ type: 'assistant_message', text: AGENT_SAID })),
  at(2, permission('req_1')),
  at(3, ev({ type: 'status', state: 'waiting_permission' })),
]

const history = (): WindowState => ({
  entries: ENTRIES,
  from: 0,
  hasOlder: false,
  turnAligned: true,
  atTail: true,
  behind: 0,
})

interface Seen {
  sent: unknown[][]
}

/**
 * ⚑ **D-017b · a press on a conversation nothing runs, through the renderer store's own door** —
 * `store.look` over a bridge that answers as the host does for such a conversation: a `recorded`
 * hand-over of its ledger, with `liveFrom` where the life the page records stopped (so what that
 * life left open is settled there). ⛔ Nothing is started; the store adopts what it is handed.
 */
async function looked(): Promise<SessionStore> {
  const handed = {
    ...META,
    sessionId: KEPT.sessionId,
    profileId: KEPT.profileId,
    cwd: KEPT.cwd,
    ref: KEPT.ref,
    handover: 'recorded',
    history: history(),
    liveFrom: ENTRIES.length,
  } as unknown as ResumedSession
  const store = createSessionStore({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    look: () => Promise.resolve(handed),
  } as unknown as RuntimeBridge)
  expect(await store.look(KEPT.sessionId), store.lookError.value ?? 'the look answered null').toBe(
    KEPT.sessionId,
  )
  // ⚑ The premise: drawn from its ledger, and not fed — nothing runs it here.
  expect(store.get(KEPT.sessionId)?.phase).toBe('recorded')
  expect(store.isLive(KEPT.sessionId)).toBe(false)
  return store
}

/**
 * The full view under a parent that HOLDS its draft — the composer's text is the caller's (`019`),
 * so a mount that did not write `update:draft` back would send whatever the DOM happened to hold.
 */
async function fullView(
  box: { width: number; height?: number } = { width: PANE_WIDTHS[1], height: PANE_H },
): Promise<{ m: Mounted; seen: Seen }> {
  const store = await looked()
  const record = store.get(KEPT.sessionId)!
  const seen: Seen = { sent: [] }
  const draft = ref('')
  const handing = createAttachmentBook().handing(draftKey(KEPT.sessionId))
  const Host = defineComponent({
    name: 'FullViewHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          record,
          identities: IDS,
          mode: 'normal',
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          models: null,
          capabilities: null,
          draft: draft.value,
          handing,
          'onUpdate:draft': (text: string) => {
            draft.value = text
          },
          onSend: (...args: unknown[]) => seen.sent.push(args),
        })
    },
  })
  return { m: mount(Host, {}, box), seen }
}

const READING_ENTRY: LibraryEntry = {
  id: 'sess_read',
  provider: 'claude',
  providerSessionId: 'thread-read',
  recordId: 'sess_read',
  cwd: resumableBase.cwd,
  title: 'Rebuild the orders index',
  preview: USER_SAID,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_060_000,
  bytes: 4_096,
  origin: 'ours',
  onDisk: true,
  readable: true,
  derived: null,
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
}

/**
 * A conversation left by quit opens in the same full view, with header, controls, and right
 * panel, rendered from its ledger until a message continues it. There is no separate
 * kept-open pane.
 */
describe('§1 · 692 F-a/F-b — a conversation the quit left open opens in the one full view', () => {
  it('🔴 the full view: its header, the right panel one press away, the agent named — and nothing says whether it runs', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const { m } = await fullView()
    await settle()
    expect(visible(m.q('conversation-pane'))).toBe(true)
    expect(visible(m.q('session-header'))).toBe(true)
    // ⚑ The name planted in the roster, on the agent's own reply — the full view names who spoke.
    expect(m.q('transcript').innerText).toContain(ADA)
    // ⚑ The right panel's toggle — the full view's controls, not a reduced pane's.
    expect(visible(m.q('toggle-session-panel'))).toBe(true)
    // ⚑ The transcript the ledger holds is on screen — the user's words and the agent's.
    expect(m.q('transcript').innerText).toContain(USER_SAID)
    expect(m.q('transcript').innerText).toContain(AGENT_SAID)
    // ⛔ **No sentence about the process** (`05` rule 5) — the kept-open pane's two.
    const said = m.q('conversation-pane').innerText
    expect(said).not.toContain('nothing running')
    expect(said).not.toContain('Nothing is running in it')
    expect(said).not.toContain('open when BroBot quit')
    expect(m.all('kept-open-pane')).toHaveLength(0)
  })

  it('⛔ carries NO read-only banner — and the recording, mounted over the same ledger, does', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const { m } = await fullView()
    const reading = mount(
      ReadingPane,
      { entry: READING_ENTRY, history: history(), mode: 'normal' },
      { width: PANE_WIDTHS[1], height: PANE_H },
    )
    await settle()
    // ⚑ The control FIRST: the banner is findable, visible, and says what it says.
    const banner = reading.q('read-only-banner')
    expect(visible(banner)).toBe(true)
    const bannerSays = words(banner.querySelector('strong'))
    expect(bannerSays).toBe('Read-only.')
    // ⛔ …and the conversation carries neither the hook nor the word.
    expect(m.all('read-only-banner')).toHaveLength(0)
    expect(m.q('conversation-pane').innerText).not.toContain(bannerSays)
    expect(visible(m.q('conversation-pane'))).toBe(true)
  })

  it('🔴 the composer is live: type, press Send, and the view emits `send` with the words', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const { m, seen } = await fullView()
    await settle()
    const box = m.q('prompt-input') as HTMLTextAreaElement
    expect(visible(box)).toBe(true)
    expect(box.disabled).toBe(false)
    box.value = 'go ahead and rebuild it'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const send = m.q('send-prompt') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    send.click()
    await settle()
    expect(seen.sent).toHaveLength(1)
    expect(seen.sent[0]?.[0]).toBe('go ahead and rebuild it')
    // ⚑ `now` — an ordinary turn: nothing is running to queue behind (`SendIntent`).
    expect(seen.sent[0]?.[1]).toBe('now')
    expect(seen.sent[0]?.[2]).toEqual([])
  })

  it('🔴 the permission asked before the quit is drawn settled, with why — and offers no Allow', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const { m } = await fullView()
    // ⚑ The control, one fact over: the SAME entries, folded with no stop to settle them — the card
    // is live and offers Allow. Without it, the absence below is satisfied by a card that never draws.
    const live = mount(
      TranscriptView,
      { items: foldWindow(ENTRIES).items, mode: 'normal' },
      { width: PANE_WIDTHS[1], height: PANE_H },
    )
    await settle()
    expect(live.all('permission-allow')).toHaveLength(1)
    expect(visible(live.q('permission-allow'))).toBe(true)
    expect(live.all('permission-answered')).toHaveLength(0)

    const card = m.q('permission-card')
    expect(visible(card)).toBe(true)
    expect(visible(m.q('permission-answered'))).toBe(true)
    // ⚑ **D-017b** — the stop the recorded hand-over carries (`liveFrom`) settles it, as a reopen's
    // crossing does; the kept-open pane said *"asked before the quit"*.
    expect(words(m.q('permission-note'))).toBe('settled when this conversation was last open')
    expect(m.all('permission-allow')).toHaveLength(0)
    expect(m.all('permission-deny')).toHaveLength(0)
  })

  /**
   * 🔴 **D-010 · *Put it back* APPENDS** — `puttingItBack`, `withTheseToo`: it joins what the composer
   * already holds, and never replaces it. ⚑ **D-017b** — asked of the one full view (the kept-open
   * pane had its own copy of the rule); the record is the store's own adoption of a ledger that
   * ends with a held message taken back.
   */
  it('🔴 D-010 · a message put back joins what the composer already holds — the words and the files', async () => {
    const theirs: HandedPath = { path: '/work/checkout/notes.md', kind: 'file', outsideCwd: false }
    const mine: HandedPath = { path: '/work/checkout/plan.md', kind: 'file', outsideCwd: false }
    const book = createAttachmentBook()
    const key = draftKey(KEPT.sessionId)
    book.write(key, [mine])
    const drafted: string[] = []
    const withAPutBack: RuntimeEventMessage[] = [
      at(0, ev({ type: 'user_turn', text: USER_SAID })),
      at(1, ev({ type: 'assistant_message', text: AGENT_SAID })),
      at(2, ev({ type: 'message_queued', text: 'when you get a moment', attachments: [theirs] })),
      at(3, ev({ type: 'message_unqueued', reason: 'cancelled' })),
    ]
    const store = createSessionStore({
      onEvent: () => () => {},
      onLiveness: () => () => {},
      look: () =>
        Promise.resolve({
          ...META,
          sessionId: KEPT.sessionId,
          profileId: KEPT.profileId,
          handover: 'recorded',
          history: { ...history(), entries: withAPutBack },
          liveFrom: withAPutBack.length,
        } as unknown as ResumedSession),
    } as unknown as RuntimeBridge)
    expect(await store.look(KEPT.sessionId)).toBe(KEPT.sessionId)
    const m = mount(
      ConversationPane,
      {
        record: store.get(KEPT.sessionId)!,
        identities: IDS,
        mode: 'normal',
        debug: false,
        drawerOpen: false,
        drawerTab: 'open',
        models: null,
        capabilities: null,
        draft: 'half a thought',
        handing: book.handing(key),
        'onUpdate:draft': (text: string) => drafted.push(text),
      },
      { width: PANE_WIDTHS[1], height: PANE_H },
    )
    await nextTick()
    ;(m.q('restore-queued') as HTMLButtonElement).click()
    await nextTick()
    expect(drafted).toEqual(['half a thought\n\nwhen you get a moment'])
    expect(book.read(key)).toEqual([mine, theirs])
  })
})

/* ============================================================ §2 · SideRail */

interface RailSeen {
  selected: string[]
}

/**
 * The rail over the stubbed host lists — ⚑ **D-017b · one list**, no closed group to expand — with
 * the id on screen held in a ref so ONE mount can be read with it set and with it cleared (two
 * mounts would prove two components, not one transition).
 */
async function rail(
  rows: ResumableSessionInfo[],
  width: number,
  onScreen: string | null = null,
): Promise<{ m: Mounted; seen: RailSeen; onScreen: { value: string | null } }> {
  hostRows.resumable = rows
  const seen: RailSeen = { selected: [] }
  const shown = ref<string | null>(onScreen)
  const Host = defineComponent({
    name: 'RailHost',
    setup() {
      return () =>
        h(SideRail as Component, {
          open: [],
          activeId: shown.value,
          place: null,
          onSelect: (id: string) => seen.selected.push(id),
        })
    },
  })
  const m = mount(Host, {}, { width, height: 1400 })
  await settle()
  await drawnReady()
  return { m, seen, onScreen: shown }
}

describe('§2 · the rail — the row of a conversation on screen, and the one press (SideRail)', () => {
  it('🔴 the row whose conversation is on screen is DRAWN active — and stops being when it is not', async () => {
    await page.viewport(1200, PANE_H)
    const { m, onScreen } = await rail([KEPT, KEPT_TOO], RAIL_W, KEPT.sessionId)
    const on = m.q(`open-session-${KEPT.sessionId}`)
    const off = m.q(`open-session-${KEPT_TOO.sessionId}`)
    expect(visible(on)).toBe(true)
    expect(visible(off)).toBe(true)
    // ⚑ Perceivable: the row's surface and its ink, against the row one fact over in the same rail.
    const onGround = paintedBackground(on)
    const offGround = paintedBackground(off)
    expect(same(onGround, offGround), `${show(onGround)} vs ${show(offGround)}`).toBe(false)
    expect(same(ink(on), ink(off))).toBe(false)
    // ⚑ …and the accent bar on its edge, which only the active row paints.
    expect(getComputedStyle(on, '::before').content).not.toBe('none')
    expect(getComputedStyle(off, '::before').content).toBe('none')

    // ⚑ The same mount, the fact cleared: the row reads exactly as its neighbour.
    onScreen.value = null
    await nextTick()
    expect(same(paintedBackground(on), offGround)).toBe(true)
    expect(same(ink(on), ink(off))).toBe(true)
  })

  /**
   * ⚑ **D-017b · re-aimed** — a kept-open row's press OPENED it and a closed recording's REOPENED it:
   * two presses over one list. ⛔ There is one press now: every row selects its conversation, and the
   * screen opens it in its full view whatever it is doing.
   */
  it('⛔ …and every row’s press is the one open — a conversation the quit stopped and any other alike', async () => {
    await page.viewport(1200, PANE_H)
    const { m, seen } = await rail([KEPT, OPENABLE], RAIL_W)
    m.q(`open-session-${KEPT.sessionId}`).click()
    await nextTick()
    m.q(`open-session-${OPENABLE.sessionId}`).click()
    await nextTick()
    expect(seen.selected).toEqual([KEPT.sessionId, OPENABLE.sessionId])
    // ⛔ …and no closed group, and no second kind of row.
    expect(m.all('rail-closed-conversations')).toHaveLength(0)
    expect(m.all(`kept-open-session-${KEPT.sessionId}`)).toHaveLength(0)
    expect(m.all(`closed-session-${OPENABLE.sessionId}`)).toHaveLength(0)
  })

  /**
   * ⚑ **D-017b · `699` GAP-2's row went with its subject** — a row a crash closed said *"closed ·
   * quit didn’t finish"* under *Closed conversations*, measured at the rail's two widths. There is
   * no closed group and no crash flag on the wire (`05` rule 5), so there is no such row to draw.
   */
})

/* ============================================================ §3 · WorkFacts */

/*
 * ⚑ **D-016c · §3 keeps its control, and its pair went with its subject.** The pair read the Work
 * tab's pill for work whose holder a stop had left open two ways — *idle* `now`, with the band's
 * sentence on the hover, and *it was idle* `as-reported` — off `holderKeptOpen` (`WorkReadAt`,
 * `IDLE`, `IT_WAS_IDLE`, `leftOpenByTheQuit`). A stop changes nothing about a piece now, so there
 * is one reading. ⚑ The control's claim still holds and nothing else measures it: a stalled piece's
 * pill says its cause's own words, with no hover, and at the Work tab's narrow floors it stays
 * inside its box. `.wr-word` is `white-space: nowrap`, so this is the guard against a long cause
 * running out of the box — `turn_ended`'s 40 characters, the length of the word the old control
 * drew.
 */

async function facts(reading: ReturnType<typeof workReading>, width: number): Promise<Mounted> {
  await page.viewport(1200, 600)
  const m = mount(WorkFacts, { reading }, { width, height: 120 })
  // ⚑ A card is a BLOCK box; the harness's flex row would size the line to its own content.
  m.host.style.display = 'block'
  await settle()
  await drawnReady()
  return m
}

/** The pill stays inside the box it is drawn in — on the right edge, where a long word would go. */
function insideItsBox(m: Mounted, what: string): void {
  const pill = m.q('work-report-word')
  const box = m.host.getBoundingClientRect()
  const drawn = pill.getBoundingClientRect()
  expect(drawn.width, `${what} has no box`).toBeGreaterThan(0)
  expect(drawn.right, `${what} runs past its ${String(box.width)} px box`).toBeLessThanOrEqual(
    box.right + 0.5,
  )
  expect(drawn.left).toBeGreaterThanOrEqual(box.left - 0.5)
  assertDrawn(pill, what, m.host)
}

describe('§3 · 699 GAP-1 — a stalled piece’s pill at the Work tab’s narrow floors (WorkFacts)', () => {
  for (const width of [320, 380]) {
    it(`⛔ at ${String(width)} px · the pill says its cause’s own words, carries no hover, and stays inside its box`, async () => {
      const m = await facts(
        workReading({ label: 'W1.7', state: 'stalled', stalledBecause: 'turn_ended' }),
        width,
      )
      const word = m.q('work-report-word')
      expect(words(word)).toBe(UNDRIVEN_SENTENCES.turn_ended.replace(/\.$/, ''))
      expect(word.hasAttribute('title')).toBe(false)
      insideItsBox(m, 'the cause’s pill')
    })
  }
})

/* ============================================================ §4 · QueuedMessage */

const REPORT: WorkReport = {
  piece: 'work_7',
  label: 'W1.7',
  state: 'stalled',
  stalledBecause: 'turn_ended',
}

type Held = QueuedItem & { at: number }

/** Each ending, as the fold makes it — and ⚑ `retracted` always carries the host's own reason. */
const ENDINGS: readonly { name: string; item: Held }[] = [
  {
    name: 'cancelled',
    item: {
      kind: 'queued',
      id: 'queued_c',
      text: 'also check the foreign keys',
      outcome: 'cancelled',
      messageId: 'msg_c',
      at: 1_700_000_000_000,
    } as Held,
  },
  {
    name: 'abandoned',
    item: {
      kind: 'queued',
      id: 'queued_a',
      text: 'also check the foreign keys',
      outcome: 'abandoned',
      at: 1_700_000_000_000,
    } as Held,
  },
  {
    name: 'retracted',
    item: {
      kind: 'queued',
      id: 'queued_r',
      text: `W1.7 · Rebuild the index with Ada is not being worked on: ${UNDRIVEN_SENTENCES.turn_ended}`,
      outcome: 'retracted',
      detail: aNoticeALaterFactRetracted('asked-about-it', 'Ada'),
      report: REPORT,
      at: 1_700_000_000_000,
    } as Held,
  },
]

async function held(item: Held): Promise<Mounted> {
  await page.viewport(900, 500)
  const m = mount(
    QueuedMessage,
    { item, identities: null, ownAgent: null, mayCarryOn: false },
    { width: 860, height: 480 },
  )
  await settle()
  return m
}

describe('§4 · 690’s `retracted` — every ending is drawn quiet, like cancelled and abandoned (QueuedMessage)', () => {
  it('⚑ the retraction the fixture carries is the host’s own sentence', () => {
    expect(ENDINGS[2]?.item.detail).toMatch(
      /^taken back by this app before it was read, because it was no longer true: /,
    )
  })

  for (const { name, item } of ENDINGS) {
    it(`🔴 ${name}: the state and the words are drawn in --faint — and the same row waiting is not`, async () => {
      const ended = await held(item)
      const waiting = await held({ ...item, outcome: null })

      const endedRow = ended.q('queued-entry')
      const faint = ink(probe(endedRow, '--faint'))
      expect(same(ink(ended.q('queued-state')), faint), `${name}’s state ink`).toBe(true)
      expect(same(ink(ended.q('queued-message')), faint), `${name}’s body ink`).toBe(true)
      if (name === 'retracted') {
        // ⚑ …and it is the not-sent arm that says why.
        expect(words(ended.q('queued-state'))).toBe(`not sent · ${item.detail ?? ''}`)
      }

      // ⚑ The control: the same row, waiting — the live colours, measured by probes in ITS scope.
      const waitingRow = waiting.q('queued-entry')
      // The state's words are drawn in the accent's text colour.
      const accent = ink(probe(waitingRow, '--accent-text'))
      const muted = ink(probe(waitingRow, '--muted'))
      expect(same(ink(waiting.q('queued-state')), accent), `${name} waiting: state ink`).toBe(true)
      expect(same(ink(waiting.q('queued-message')), muted), `${name} waiting: body ink`).toBe(true)
      // ⛔ …and the three are three colours, or every equality above proves nothing.
      expect(same(faint, accent), `--faint ${show(faint)} = --accent-text ${show(accent)}`).toBe(
        false,
      )
      expect(same(faint, muted), `--faint ${show(faint)} = --muted ${show(muted)}`).toBe(false)
    })
  }
})

/* ============================================================ §5 · PersonsQueue, floating */

const KEY = 'sess_worker-7:req_1'
const HELD = new Set(['sess_worker-7'])
const NAME = (id: string): string => id.replace('sess_', '')

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_pm-alpha',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_700_000_000_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 1_700_000_030_000,
    ...over,
  }
}

function asked(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): PersonsQuestion {
  const request = routed(over)
  const chain = escalationChain(request, () => null)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'the-provider',
    offered: null,
    asked: null,
  }
}

/** ⚑ One live attention row, as `attention.ts` projects it — `persons-queue.dom.test.ts`' shape. */
function live(over: Partial<AttentionRequest> = {}): AttentionRequest {
  const [sessionId = '', requestId = ''] = KEY.split(':')
  return {
    key: KEY,
    sessionId,
    requestId,
    itemId: `item_${requestId}`,
    kind: 'permission',
    where: 'worker-7',
    hasACommander: false,
    provider: 'claude',
    profileId: null,
    who: null,
    standing: 'waiting: permission',
    asked: 'run a command',
    scope: [],
    underDisclosed: false,
    detailOmitted: null,
    noPositive: null,
    at: 1_700_000_000_000,
    decisions: [
      { kind: 'permission', label: 'Deny', decision: { outcome: 'deny' } },
      { kind: 'permission', label: 'Cancel', decision: { outcome: 'cancel' } },
      { kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } },
    ],
    limit: null,
    sent: false,
    refused: null,
    ...over,
  }
}

function walked<Row>(rows: readonly Row[], walk: LedgerWalkKind): LedgerWalk<Row> {
  return { rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }
}

function supply(row: AttentionRequest): void {
  queue.supply(
    walked(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker-7' })],
      'every-conversation-that-routed',
    ),
    walked([], 'every-conversation-that-routed'),
    {
      held: HELD,
      answerable: new Map([[KEY, row]]),
      now: 1_700_000_120_000,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
}

/** ⚑ The floating copy, through the door the app draws it by: the overlay layer's corner. */
async function overlay(): Promise<Mounted> {
  await page.viewport(1180, 808)
  const Layer = defineComponent({
    name: 'OverlayUnderTest',
    setup: () => () =>
      h(
        OverlayHost as Component,
        { label: 'A sheet', onClose: () => {} },
        {
          default: () => [h('div', { 'data-cy': 'the-sheet-under-it' }, 'a sheet')],
        },
      ),
  })
  const m = mount(Layer, {}, { width: 10, height: 10 })
  await settle()
  m.q('persons-queue-toggle').click()
  await settle()
  return m
}

const MARKS = [GRANT_WITHHELD, DEFAULT_IS_NO, inTheProvidersWords('this could delete the index')]

describe('§5 · 700 §5 GAP 1 — the person’s queue draws the marks, and does not dim a refusal-first ask (PersonsQueue)', () => {
  beforeEach(() => {
    safety.supply(roster(), () => {})
  })

  it('🔴 a marked ask: the three lines, in order, before the answers, in the quiet ink — Deny not dimmed', async () => {
    supply(live({ marksSay: MARKS, refusesFirst: true }))
    const m = await overlay()
    const queueCard = m.q('persons-queue')
    expect(queueCard.dataset.place).toBe('overlay')
    const lines = m.all(`persons-queue-mark-${KEY}`)
    expect(lines.map(words)).toEqual(MARKS)
    const answers = m.all(`persons-queue-answer-${KEY}`)
    // The request's own answers first, in the card's order; Cancel, a broader choice, is under the
    // row's more options after them.
    expect(answers.map((a) => words(a.querySelector('strong')))).toEqual([
      'Deny',
      'Allow',
      'Cancel',
    ])
    const first = answers[0] as HTMLElement
    // ⚑ Each line visible, in the order given, and every one BEFORE the first answer.
    for (const [i, line] of lines.entries()) {
      expect(visible(line), `mark ${String(i)} is not on screen`).toBe(true)
      expect(
        line.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
        `mark ${String(i)} is not before the answers`,
      ).toBeTruthy()
      if (i > 0) {
        expect(
          (lines[i - 1] as HTMLElement).compareDocumentPosition(line) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }
    }
    // ⚑ The quiet ink — measured against a --muted probe in the row's own scope, and that probe is
    // not the loud ink an answer's word carries.
    const row = lines[0]?.parentElement as HTMLElement
    const muted = ink(probe(row, '--muted'))
    const text = ink(probe(row, '--text'))
    expect(same(muted, text)).toBe(false)
    for (const line of lines) expect(same(ink(line), muted)).toBe(true)
    // ⛔ …and no refusal is dimmed: Deny's word is drawn as Allow's is.
    expect(answers.filter((a) => a.classList.contains('deny'))).toHaveLength(0)
    const deny = ink(first.querySelector('strong') as HTMLElement)
    const allow = ink((answers[1] as HTMLElement).querySelector('strong') as HTMLElement)
    expect(same(deny, allow), `Deny ${show(deny)} vs Allow ${show(allow)}`).toBe(true)
    expect(same(allow, text)).toBe(true)
  })

  it('⛔ the control: an unmarked ask draws no mark and DIMS its refusals', async () => {
    supply(live())
    const m = await overlay()
    expect(m.all(`persons-queue-mark-${KEY}`)).toHaveLength(0)
    const answers = m.all(`persons-queue-answer-${KEY}`)
    expect(answers).toHaveLength(3)
    // Deny, Allow, then Cancel under the row's more options.
    expect(answers.map((a) => a.classList.contains('deny'))).toEqual([true, false, true])
    const allow = ink((answers[1] as HTMLElement).querySelector('strong') as HTMLElement)
    for (const refusal of [answers[0]!, answers[2]!]) {
      const word = ink(refusal.querySelector('strong') as HTMLElement)
      expect(same(word, allow), `${show(word)} is drawn as Allow is`).toBe(false)
    }
  })
})
