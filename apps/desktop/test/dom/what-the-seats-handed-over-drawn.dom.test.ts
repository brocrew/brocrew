import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { stalledWorkLead, usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { absenceUnreadSays } from '../../src/renderer/src/lib/rows-unread'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { workReading } from '../../src/renderer/src/lib/work-report'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../../src/shared/questions'
import {
  type AgentIdentities,
  type AgentIdentity,
  type ChildWorkResult,
  type ResumableSessionInfo,
  type TranscriptEvent,
  type WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import type { StalledWork } from '../../src/shared/stalled-work'
import { pieceCalled } from '../../src/shared/piece-called'
import type { WorkReport } from '../../src/shared/tasks'
import { assertDrawn, drawnReady, inkRects, lineCount } from './drawn'
import {
  mount,
  paneProps,
  record,
  unmountAll,
  visible,
  type Mounted,
  openWorkReports,
} from './harness'

/**
 * # 🔴 712 · what the seats handed over, DRAWN — what a person perceives of five of the ten draws
 *
 * ⚑ **`712`'s renderer work, read in a real engine** (the dom runner: no Electron, no port, no
 * photograph). Every arm below is a claim about something a person perceives — a word drawn, a tag
 * in the register of its neighbours, a sentence wrapped and not cut, a face that fits the rail — and
 * each carries a control one fact over in the SAME mount, because a negative with no positive
 * beside it passes against a surface that draws nothing (`brobot2-ssr-tests-pass-vacuously`).
 *
 * | § | the draw, and what ordered it | what is measured | the control, same mount |
 * |---|---|---|---|
 * | 1 | draw 1 · `702` GAP-1 — `TeamWorkspace` — ⚑ **D-016: gone with its subject** (no projects, no *Works in* line) | — | — |
 * | 2 | draw 2 · `702` GAP-3 — `PersonsQueue`'s stalled band | *…has not been told.*, whole, and the lib's own lead (⚑ D-016c: R54's first half — *was told a message would start it; not told nothing can start it now.* — went with that notice, so every row's giver was told nothing) | none: what is left is a positive — a sentence drawn and visible — which a surface drawing nothing fails |
 * | 3 | draw 3 · `697` H-a — `WorkflowOutputViewer`, `ChildWorkViewer` | the absence scoped to the rows read, by count; wrapped, not cut, inside a real `OverlayHost` | `0` and absent keep the old sentence; `gone` with a count is unchanged |
 * | 4 | draw 7 · `707` GAP-1 — `WorkReportEntry`, `QueuedMessage` | *W1.2* on the card and on the held row, one line at the narrow transcript (⚑ *Task #1 in beta* until D-016 took the project out, and the label in the number's place) | another piece's report: *W1.1* |
 * | 5 | draw 10 · **R55** — `SideRail`'s closed row — ⚑ **D-017b: gone with its subject** (no closed row, no crash flag on the wire) | — | — |
 *
 * ⛔ **Not here, and why**: draw 4 (R56) has its own file; draw 5 (R57) was not built (a GAP for
 * main — since amended by R62, carried by `716` and drawn by `725`'s `a-row-still-closing-says-so`);
 * draws 6 and 9 are comments; draw 8 (R41) is other files'.
 *
 * ⚠️ **What this file cannot say.** Each component is mounted through its own props — the queue
 * through `supply`, the viewers inside a real
 * `OverlayHost` but not through `ConversationPane`'s open doors — so it says nothing about the host
 * reads that fill them. ⛔ The widths are declared from `tokens.css`, never read out of a shot; the
 * dom runner draws 0 px overlay scrollbars where Electron draws 11 px
 * (`the-dom-runner-draws-overlay-scrollbars`), which moves no verdict here: every clipper measured
 * is `overflow: hidden` or the body, neither of which draws one.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⛔ Derived from `tokens.css`, not chosen: `--app-min-w` and `--rail-w` (208 px). */
const APP_MIN_W = 1180
const RAIL_W = 208

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity =>
  ({
    id: `aid:${slug}`,
    slug,
    displayName: null,
    role: null,
    createdAt: 1_700_000_000_000,
    createdBy: null,
    provider: null,
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map((key) => [key, 'default'])),
    ...over,
  }) as unknown as AgentIdentity

/* ---------------------------------------------------------------------------- the one stub */

/**
 * ⚠️ **One bridge for the whole file, installed before anything mounts** —
 * `what-a-quit-left-open-on-screen.dom.test.ts`' stub, for its reason: `useAgentStore` memoises the
 * bridge at its first call, so a per-test stub would be captured once and ignored after. ⚑ The
 * rail's two lists read {@link hostRows} — ⚑ D-017b: empty, now that §5's closed row is gone.
 */
const hostRows: { resumable: ResumableSessionInfo[] } = { resumable: [] }

const roster = (): AgentIdentities =>
  ({
    identities: [ident('pm')],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }) as unknown as AgentIdentities

;(window as unknown as { api?: unknown }).api = {
  runtime: {
    listResumable: () => Promise.resolve(hostRows.resumable),
    listUnresumable: () => Promise.resolve([]),
    agentIdentities: async () => roster(),
    setCapabilities: async () => roster().identities[0],
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
  },
}

const queue = usePersonsQueue()
const safety = useSpawnSafety()

beforeEach(() => {
  hostRows.resumable = []
})

afterEach(async () => {
  unmountAll()
  queue.forget()
  safety.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ============================================================ §1 · TeamWorkspace */

/*
 * ⚑ **D-016 · draw 1 (`702` GAP-1) went with its subject.** The Team page's *Works in* line drew a
 * launch's project as a place tag, in the recorded tags' register and gap. ⛔ There are no projects
 * now — no *Works in* line, no place tags, no `team-places-*` hooks — so there is no project for a
 * launch to name.
 */

/* ============================================================ §2 · PersonsQueue */

const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> =>
  ({ rows, walk: 'every-conversation-that-routed', ledgers: 1, rowsUnread: 0 }) as LedgerWalk<Row>

/** `one-task-one-name.dom.test.ts` §2b's row — the fields main copies off a `PieceRow`. */
const stalledRow = (over: Partial<StalledWork>): StalledWork => ({
  piece: 'work_x',
  label: 'W1.3',
  title: 'Build the world clock page.',
  owner: 'sess_pam',
  ownerName: 'Pam',
  giver: 'sess_ada',
  giverName: 'Ada',
  because: 'turn_ended',
  askedToStop: null,
  stalledAt: 1_000,
  ...over,
})

/** ⚑ A row whose giver was told nothing — since D-016c, every row the band draws. */
const NOT_TOLD = stalledRow({
  piece: 'work_quiet',
  label: 'W1.4',
  owner: 'sess_sam',
  ownerName: 'Sam',
})

describe('§2 · 712 draw 2 (`702` GAP-3) — the stalled band says its giver was told nothing (PersonsQueue)', () => {
  it('🔴 *…has not been told.* — the whole sentence, drawn, and the lib’s own lead', async () => {
    queue.supply(
      WALK<PersonsQuestion>([]),
      WALK<PersonsDecision>([]),
      {
        held: new Set<string>(),
        answerable: new Map<string, AttentionRequest>(),
        now: 900_000,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set<string>(),
      },
      { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
      undefined,
      { walked: WALK([NOT_TOLD]), lastLookAnswered: true },
    )
    await page.viewport(900, 700)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 880, height: 680 })
    await settle()
    m.q('persons-queue-toggle').click()
    await settle()

    const quiet = m.q('persons-queue-stall-says-work_quiet')
    expect(visible(quiet)).toBe(true)
    // 🔴 The whole sentence a person reads, pinned once — and the band draws the lib's own lead.
    expect(quiet.innerText.trim()).toBe(
      'W1.4 with Sam is not being worked on, and Ada — which gave it out — has not been told.',
    )
    expect(quiet.innerText.trim()).toBe(stalledWorkLead(NOT_TOLD))
  })
})

/* ============================================================ §3 · the two viewers */

/**
 * ⚑ **Mounted where they really sit — inside a real `OverlayHost`** (`a-stop-a-modal-cannot-cover`'s
 * `Layer`). ⚠️ The host div is 10 px because `OverlayHost` is `position: fixed`: a wide div would
 * supply the width the VIEWPORT is supposed to, and the width is what §3 measures.
 */
const Layer = defineComponent({
  name: 'OverlayUnderTest',
  props: { open: { type: Function as PropType<() => unknown>, required: true } },
  setup: (props) => () => h(OverlayHost, { label: 'A sheet' }, { default: () => [props.open()] }),
})

async function overlay(open: () => unknown, width: number): Promise<Mounted> {
  await page.viewport(width, 800)
  const m = mount(Layer, { open }, { width: 10, height: 10 })
  await settle()
  await drawnReady()
  return m
}

const output = (result: WorkflowOutputResult) => () =>
  h(WorkflowOutputViewer, { result, workflow: 'find-flaky-tests' })
const child = (result: ChildWorkResult) => () =>
  h(ChildWorkViewer, { result, label: 'fixture:overflow', agent: null })

/**
 * ⚑ The widths a pane draws these at — the panel is its content's width, capped at `900px` above
 * 978 px and at `92vw` below. ⚠️ Measured: the workflow sentence needs a ~500 px panel and gets it
 * at both, so it draws on ONE line there; {@link NARROWER_THAN_THE_APP} is where it has to wrap.
 */
const VIEWPORTS = [1100, 760] as const

/**
 * ⚠️ **Narrower than the app ever draws** (`--app-min-w` is 1180) — declared as such: here `92vw`
 * (≈442 px) is less than the workflow sentence, so this is the width that proves it WRAPS inside its
 * panel rather than running off it.
 */
const NARROWER_THAN_THE_APP = 480

/**
 * ⚑ **Drawn whole, wrapped rather than cut, and inside the panel it belongs to** — `drawn.ts`'s
 * verdict against the body (which is `overflow: hidden`, so off-screen ink is a `never` cut), and
 * the ink's own rects against the panel's box.
 */
function drawnInsideThePanel(el: HTMLElement, panel: HTMLElement, what: string): void {
  assertDrawn(el, what)
  const box = panel.getBoundingClientRect()
  for (const rect of inkRects(el)) {
    expect(rect.left, `${what} starts outside its panel`).toBeGreaterThanOrEqual(box.left - 0.5)
    expect(rect.right, `${what} runs past its panel`).toBeLessThanOrEqual(box.right + 0.5)
    expect(rect.right, `${what} runs past the window`).toBeLessThanOrEqual(window.innerWidth + 0.5)
  }
}

describe('§3 · 712 draw 3 (`697` H-a) — an absence says it is true of the rows this app could read', () => {
  it('⚑ the clause, pinned by name — and none at 0, at absent, at a count that is not a count', () => {
    expect(absenceUnreadSays(1)).toBe(
      'in the rows this app could read; 1 row of this app’s record could not be read',
    )
    expect(absenceUnreadSays(2)).toBe(
      'in the rows this app could read; 2 rows of this app’s record could not be read',
    )
    for (const none of [0, undefined, -1, Number.NaN]) expect(absenceUnreadSays(none)).toBeNull()
  })

  for (const width of VIEWPORTS) {
    it(`🔴 WorkflowOutputViewer at ${String(width)} px — *no output* with 1 row unread says so, drawn whole`, async () => {
      const m = await overlay(output({ ok: false, reason: 'no-output', rowsUnread: 1 }), width)
      const refusal = m.q('workflow-output-refusal')
      expect(visible(refusal)).toBe(true)
      // ⚑ Pinned by name, once.
      expect(refusal.innerText.trim()).toBe(
        'This run did not report an output file in the rows this app could read; 1 row of this app’s record could not be read.',
      )
      expect(refusal.innerText.trim()).toBe(
        `This run did not report an output file ${absenceUnreadSays(1) ?? ''}.`,
      )
      drawnInsideThePanel(refusal, m.q('workflow-output-viewer'), 'the no-output refusal')
    })
  }

  it(`🔴 WorkflowOutputViewer at ${String(NARROWER_THAN_THE_APP)} px — the longer sentence WRAPS inside its panel, and nothing is cut`, async () => {
    const m = await overlay(
      output({ ok: false, reason: 'no-output', rowsUnread: 1 }),
      NARROWER_THAN_THE_APP,
    )
    const refusal = m.q('workflow-output-refusal')
    expect(visible(refusal)).toBe(true)
    expect(lineCount(refusal)).toBeGreaterThanOrEqual(2)
    drawnInsideThePanel(refusal, m.q('workflow-output-viewer'), 'the wrapped no-output refusal')
  })

  it('🔴 WorkflowOutputViewer — 2 rows unread: *2 rows*', async () => {
    const m = await overlay(output({ ok: false, reason: 'no-output', rowsUnread: 2 }), 1100)
    expect(m.q('workflow-output-refusal').innerText.trim()).toBe(
      'This run did not report an output file in the rows this app could read; 2 rows of this app’s record could not be read.',
    )
  })

  it('⚑ THE CONTROL — WorkflowOutputViewer: 0 unread, and no count at all, keep the old sentence; *gone* with a count is unchanged', async () => {
    const zero = await overlay(output({ ok: false, reason: 'no-output', rowsUnread: 0 }), 1100)
    expect(zero.q('workflow-output-refusal').innerText.trim()).toBe(
      'This run did not report an output file.',
    )
    zero.unmount()
    const absent = await overlay(output({ ok: false, reason: 'no-output' }), 1100)
    expect(absent.q('workflow-output-refusal').innerText.trim()).toBe(
      'This run did not report an output file.',
    )
    absent.unmount()
    // ⛔ The count qualifies an ABSENCE only: *gone* names a file the read DID find.
    const gone = await overlay(output({ ok: false, reason: 'gone', rowsUnread: 3 }), 1100)
    const said = gone.q('workflow-output-refusal').innerText.trim()
    expect(said).toBe(
      'The output file is no longer on disk. Workflow outputs are written to a temporary directory, which the system clears.',
    )
    expect(said).not.toContain('could not be read')
  })

  for (const width of VIEWPORTS) {
    it(`🔴 ChildWorkViewer at ${String(width)} px — *no record of that agent* with 1 row unread says so, wrapped and drawn whole`, async () => {
      const m = await overlay(child({ ok: false, reason: 'unknown-agent', rowsUnread: 1 }), width)
      const refusal = m.q('child-work-refusal')
      expect(visible(refusal)).toBe(true)
      // ⚑ Pinned by name, once.
      expect(refusal.innerText.trim()).toBe(
        'This conversation has no record of that agent in the rows this app could read; 1 row of this app’s record could not be read. There is nothing to open. The transcript is found from the run this app recorded — not by searching the disk.',
      )
      expect(refusal.innerText).toContain(`of that agent ${absenceUnreadSays(1) ?? ''}. There is`)
      // ⚑ Longer than the panel is wide at either width, so it WRAPS rather than running off it.
      expect(lineCount(refusal)).toBeGreaterThanOrEqual(2)
      drawnInsideThePanel(refusal, m.q('child-work-viewer'), 'the unknown-agent refusal')
    })
  }

  it('🔴 ChildWorkViewer — 2 rows unread: *2 rows*', async () => {
    const m = await overlay(child({ ok: false, reason: 'unknown-agent', rowsUnread: 2 }), 1100)
    expect(m.q('child-work-refusal').innerText).toContain(
      'This conversation has no record of that agent in the rows this app could read; 2 rows of this app’s record could not be read. There is nothing to open.',
    )
  })

  it('⚑ THE CONTROL — ChildWorkViewer: 0 unread, and no count at all, keep the old sentence; *gone* with a count is unchanged', async () => {
    const OLD =
      'This conversation has no record of that agent, so there is nothing to open. The transcript is found from the run this app recorded — not by searching the disk.'
    const zero = await overlay(child({ ok: false, reason: 'unknown-agent', rowsUnread: 0 }), 1100)
    expect(zero.q('child-work-refusal').innerText.trim()).toBe(OLD)
    zero.unmount()
    const absent = await overlay(child({ ok: false, reason: 'unknown-agent' }), 1100)
    expect(absent.q('child-work-refusal').innerText.trim()).toBe(OLD)
    absent.unmount()
    const gone = await overlay(child({ ok: false, reason: 'gone', rowsUnread: 2 }), 1100)
    const said = gone.q('child-work-refusal').innerText.trim()
    expect(said).toBe(
      "There is no file for that yet. A child writes its record as it works, in the provider's home beside its parent's — so this is either an agent that has not started, or a home that has since been cleaned.",
    )
    expect(said).not.toContain('could not be read')
  })
})

/* ============================================================ §4 · the work card's heading */

/** `work-report.dom.test.ts`' builders. */
const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.1',
  state: 'answered',
  outcome: 'done',
  ...over,
})

const reported = (text: string, work: WorkReport): TranscriptEvent => ({
  type: 'user_turn',
  text,
  attribution: 'app_authored',
  work,
})

/**
 * ⚑ **Two pieces, W1.2 and W1.1** — the landed card and the held row, each beside its control, in
 * ONE transcript. ⚑ D-016: a piece is named by its label, so the two are told apart by their labels
 * (*"Two Task #1s, in two projects"*, and `elsewhere`, until then).
 */
const TWO_TASKS: TranscriptEvent[] = [
  { type: 'user_turn', text: 'give the workers something to do' },
  reported(
    'W1.2 · the index was answered by sess_beta: done.\n\nI wrote the index.',
    report({ piece: 'work_b1', label: 'W1.2' }),
  ),
  reported(
    'W1.1 · the migration was answered by sess_worker: done.\n\nI wrote the migration.',
    report({ piece: 'work_a1' }),
  ),
  ev({ type: 'status', state: 'running' }),
  ev({
    type: 'message_queued',
    messageId: 'msg_beta',
    kind: 'work',
    text: 'W1.2 · the index was answered by sess_beta: done.',
    attribution: 'app_authored',
    work: report({ piece: 'work_b2', label: 'W1.2' }),
  }),
  ev({
    type: 'message_queued',
    messageId: 'msg_here',
    kind: 'work',
    text: 'W1.1 · the migration was answered by sess_worker: done.',
    attribution: 'app_authored',
    work: report({ piece: 'work_a2' }),
  }),
]

async function pane(width: number, viewport: number, drawerOpen: boolean): Promise<Mounted> {
  await page.viewport(viewport, 808)
  const m = mount(ConversationPane, paneProps({ record: record(TWO_TASKS), drawerOpen }), {
    width,
    height: 808,
  })
  await openWorkReports(m)
  await settle()
  await drawnReady()
  return m
}

describe('§4 · 712 draw 7 (`707` GAP-1) — the work card names the piece the way its words do', () => {
  it('⚑ the heading, pinned by name — derived from the lib the cards read', () => {
    expect(workReading(report({ label: 'W1.2' })).heading).toBe('W1.2')
    expect(workReading(report({ label: 'W1.2' })).heading).toBe(pieceCalled([1, 2]))
    expect(workReading(report()).heading).toBe(pieceCalled([1, 1]))
  })

  it('🔴 *W1.2* on the landed card AND on the held row — beside *W1.1*, another piece’s report', async () => {
    const m = await pane(1180, 1200, false)
    const headings = m.all('work-report-heading')
    expect(headings.map(words)).toEqual(['W1.2', 'W1.1'])
    const senders = m.all('queued-sender')
    expect(senders.map(words)).toEqual(['W1.2', 'W1.1'])
    for (const one of [...headings, ...senders]) expect(visible(one)).toBe(true)
    // ⚑ A person reads the two cards as two pieces: the positive is not the control's words.
    expect(words(headings[0]!)).not.toBe(words(headings[1]!))
  })

  it('🔴 at the narrowest transcript — the app at its floor, the drawer open — each heading is on one line and drawn whole', async () => {
    // ⚑ `--app-min-w` less `--rail-w`: the box the pane is really given, with the drawer beside it.
    const m = await pane(APP_MIN_W - RAIL_W, APP_MIN_W, true)
    const headings = [...m.all('work-report-heading'), ...m.all('queued-sender')]
    expect(headings.map(words)).toEqual(['W1.2', 'W1.1', 'W1.2', 'W1.1'])
    for (const heading of headings) {
      const what = `the heading “${words(heading)}”`
      expect(visible(heading), what).toBe(true)
      expect(lineCount(heading), `${what} wrapped`).toBe(1)
      assertDrawn(heading, what, m.host)
      // ⚑ …and inside its own row's meta line, not across the words beside it.
      const meta = heading.closest('.msg-meta') as HTMLElement
      const line = meta.getBoundingClientRect()
      for (const rect of inkRects(heading)) {
        expect(rect.right, `${what} runs past its meta line`).toBeLessThanOrEqual(line.right + 0.5)
        expect(rect.bottom, `${what} falls out of its meta line`).toBeLessThanOrEqual(
          line.bottom + 0.5,
        )
      }
    }
  })
})

/* ============================================================ §5 · SideRail */

/*
 * ⚑ **D-017b · draw 10 (R55) went with its subject.** The rail's closed row drew a short face —
 * *"closed · quit didn’t finish"* — for a conversation a crash closed, measured at 208 px and
 * 220 px, with the ruled sentence whole on its hover. ⛔ There is no closed row now (one list; every
 * conversation opens in its full view), and `closedBecauseTheAppDidNotFinishQuitting` left the wire
 * (a process fact, `05` rule 5), so there is no crash row to put a face on.
 */
