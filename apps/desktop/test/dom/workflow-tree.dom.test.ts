import { nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkflowEntry from '../../src/renderer/src/components/WorkflowEntry.vue'
import type { WorkflowRunCard } from '../../src/renderer/src/lib/transcript'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type {
  ChildWorkInput,
  ChildWorkResult,
  TranscriptEvent,
  WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import {
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
} from './harness'

/**
 * 108 · The workflow tree with a real cascade and a real click (083's harness).
 *
 * ⚠️ **This file exists because the tree does not exist until the head is clicked**, and every other
 * renderer test in this repo is SSR-only. The restraint 107 designed — *"finished phases collapse to
 * a tally; only the running phase lists rows"* — is a claim about the EXPANDED tree, so it cannot be
 * asserted anywhere else without measuring something different and calling it the same thing.
 *
 * The stylesheet is real here (`base.css` → `tokens.css`), so `getComputedStyle` answers the
 * question a string could not: what `--accent` actually RESOLVES to where this component sits.
 */

afterEach(unmountAll)

const PHASES = [
  { index: 1, title: 'Draft' },
  { index: 2, title: 'Judge' },
]

function run(over: Partial<WorkflowRunCard> = {}): WorkflowRunCard {
  return {
    taskId: 'wq1demo',
    toolUseId: 'toolu_wf',
    name: 'demo-panel',
    description: 'Three drafters, then a judge',
    phases: PHASES,
    agents: [
      {
        agentId: 'a1',
        label: 'drafter:one',
        phaseIndex: 1,
        state: 'done',
        tokens: 7718,
        toolCalls: 0,
      },
      {
        agentId: 'a2',
        label: 'drafter:two',
        phaseIndex: 1,
        state: 'done',
        tokens: 7718,
        toolCalls: 1,
      },
      {
        agentId: 'a3',
        label: 'judge',
        phaseIndex: 2,
        state: 'running',
        lastTool: 'StructuredOutput',
      },
    ],
    usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
    running: true,
    ...over,
  }
}

/**
 * Mount and open the fold — the tree only exists on the other side of a click.
 *
 * ⚠️ **`await nextTick()`, and without it every assertion below reads the COLLAPSED markup.** Vue
 * batches updates, so the DOM after `click()` is still the pre-click one; the negatives ("no rows in
 * a finished phase") would all have passed for the wrong reason. The transition is asserted here
 * rather than trusted, which is the same guard `drawer-tabs.dom.test.ts` documents.
 */
async function open(card: WorkflowRunCard, width = 720): Promise<ReturnType<typeof mount>> {
  const view = mount(WorkflowEntry, { run: card }, { width })
  view.q('workflow-head').click()
  await nextTick()
  expect(view.q('workflow-head').getAttribute('aria-expanded'), 'the fold did not open').toBe(
    'true',
  )
  return view
}

describe('the expanded tree (108)', () => {
  it('opens on a click, and the head says so to a screen reader', async () => {
    const view = mount(WorkflowEntry, { run: run() }, { width: 720 })
    const head = view.q('workflow-head')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(view.all('workflow-tree')).toHaveLength(0)
    head.click()
    await nextTick()
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(view.all('workflow-tree')).toHaveLength(1)
  })

  it('⚠️ a FINISHED phase can be EXPANDED, and is still collapsed until it is asked (112)', async () => {
    // A finished workflow has every phase marked `done`. It must still expose the recorded
    // rows behind the tallies instead of applying ongoing-run restraint with no way to open
    // the history.
    //
    // The negative and the positive are one test on purpose (`SSR tests pass vacuously`): "no rows"
    // alone would pass on a component that rendered nothing at all.
    const finished = run({ running: false, outcome: 'completed' })
    finished.agents = finished.agents.map((agent) => ({ ...agent, state: 'done' as const }))
    const view = await open(finished)

    // Collapsed by default — the restraint is intact.
    expect(view.all('workflow-agent')).toHaveLength(0)
    const head = view.q('workflow-phase-head-1')
    expect(head.getAttribute('aria-expanded'), 'a finished phase says it can open').toBe('false')

    head.click()
    await nextTick()

    // …and now the rows are there, which is what he asked for.
    expect(head.getAttribute('aria-expanded')).toBe('true')
    const rows = view.all('workflow-agent')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('drafter:one'),
      expect.stringContaining('drafter:two'),
    ])
    // Phase 2 was not touched and stays a tally, so the toggle is per-phase and not a global switch.
    expect(view.all('workflow-agents-2')).toHaveLength(0)

    // And it closes again — a disclosure that only opens is a one-way door.
    head.click()
    await nextTick()
    expect(view.all('workflow-agent')).toHaveLength(0)
  })

  it('⚠️ an agent frozen `running` inside a KILLED run stops claiming to work (118)', async () => {
    // ⛔ **117 §2's defect, on the surface it is drawn on.** The provider kills a `Workflow` when
    // the model stops talking, and 117 measured what that leaves behind: `"status":"killed"`,
    // `error: "Workflow aborted"`, `result: null`, no terminal notification — so the run settles
    // (`running:false`, no `outcome`) with its Judge still marked `running` in the last frame.
    // Until 118 that row drew **working · live**, forever, inside a tree whose head said it was
    // over. The facet rule is pinned in `workflow-tree.test.ts`; this is the pixel it reaches.
    const killed = run({ running: false, unfinished: true })
    const view = await open(killed)
    // ⚠️ **The rows are disclosed however the phase decides to disclose them** (review). A phase's
    // state is still derived from its agents alone, so today the phase holding the frozen row reads
    // `running` and lists it unasked — which is exactly how 117 met it. That is the PHASE-level half
    // of 117 §2 and it is deliberately not fixed here; asserting `aria-expanded === 'true'` would
    // pin the unfixed behaviour in place and make the eventual fix read as a regression.
    if (view.q('workflow-phase-head-2').getAttribute('aria-expanded') !== 'true') {
      view.q('workflow-phase-head-2').click()
      await nextTick()
    }

    const rows = view.all('workflow-agent')
    expect(rows, 'the killed run disclosed no rows, so nothing below is being read').toHaveLength(1)
    expect(rows[0]!.textContent).toContain('judge')
    const plate = rows[0]!.querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(plate, 'the row has no agent plate').not.toBeNull()
    // The faceless ring, and NO underline: 039's vocabulary, not a fabricated outcome.
    expect(plate!.dataset.doing).toBe('unknown')
    expect(plate!.dataset.being, 'an underline is a claim about how it is going').toBeUndefined()
    expect(rows[0]!.querySelector('[data-cy="agent-unknown"]')).not.toBeNull()
    expect(rows[0]!.querySelector('[data-cy="agent-underline"]')!.className).toContain('none')
    // ⛔ Never amber — a finished run may not spend the attention channel (108).
    expect(rows[0]!.querySelector('[data-cy="agent-needing"]')).toBeNull()
    // …and the word beside it says the same thing, so a reader who never sees a colour still gets it.
    expect(plate!.getAttribute('aria-label')).toContain('state unknown')
    expect(plate!.getAttribute('aria-label')).not.toContain('live')

    // ⛔ **THE half the first version of this fix missed** (review). Correcting the avatar and
    // leaving the words rendered `judge · StructuredOutput · running` beside a ring whose
    // accessible name said *state unknown* — the two-answers-in-one-card defect restated, not
    // fixed. Every part of the row answers to one predicate now.
    const word = rows[0]!.querySelector('[data-cy="workflow-agent-status"]')
    expect(word!.textContent?.trim()).toBe('state not reported')
    expect(rows[0]!.textContent).not.toContain('running')
    // The last tool is no more current than the `running` was, so it goes with it.
    expect(rows[0]!.querySelector('[data-cy="workflow-agent-tool"]')).toBeNull()
    expect(rows[0]!.getAttribute('data-state')).toBe('unknown')
    // …and the head above them stops counting it as working, so the card has ONE answer top to
    // bottom: it used to read `1 running` directly beside its own word, *did not finish*.
    const head = view.q('workflow-head').textContent ?? ''
    expect(head).toContain('did not finish')
    expect(head).toContain('not reported')
    expect(head).not.toContain('1 running')

    // ⚠️ **The paired positive, in the same engine.** The SAME agent, in a run that is still going,
    // still reads live — the correction is keyed on the run, not on a new suspicion of `running`.
    const going = await open(run())
    const live = going
      .all('workflow-agent')[0]!
      .querySelector<HTMLElement>('[data-cy="agent-state"]')
    expect(live!.dataset.doing, 'the running case was collateral damage').toBe('tool')
    expect(live!.dataset.being).toBe('live')
  })

  it('the RUNNING phase can be collapsed too, and stays collapsed when it finishes (112)', async () => {
    // ⚠️ **`reactive()`, and without it this test asserts nothing.** Vue wraps only the top-level
    // `props` object in `shallowReactive`, so mutating a PLAIN card after mount re-renders nothing
    // and the post-mutation assertion compares the DOM to itself. Review caught exactly that: the
    // first version of this test passed while the bug it names was live. The store really does hand
    // this component a deep-`reactive` record (`session-store.ts` → `reactive(createSessionRecord)`),
    // so this is the production shape and not a trick to make the test fail.
    const card = reactive(run())
    const view = await open(card)
    expect(view.all('workflow-agent')).toHaveLength(1)
    view.q('workflow-phase-head-2').click()
    await nextTick()
    expect(view.all('workflow-agent'), 'the click did not collapse the phase').toHaveLength(0)

    // The run ends: the phase's state changes under the reader, and their choice survives it.
    // ⛔ This is the XOR bug. Storing "the reader changed this" and XOR-ing it against a default
    // that has since flipped reopens the phase they had just put away.
    card.agents = card.agents.map((agent) => ({ ...agent, state: 'done' as const }))
    await nextTick()
    expect(view.q('workflow-phase-head-2').getAttribute('aria-expanded')).toBe('false')
    expect(view.all('workflow-agent'), 'the collapsed phase reopened on its own').toHaveLength(0)

    // …and the paired positive: it is still a control, so "collapsed" is not "gone".
    view.q('workflow-phase-head-2').click()
    await nextTick()
    expect(view.all('workflow-agent')).toHaveLength(1)
  })

  it('a phase the reader OPENED while it was done stays open if it somehow runs again (112)', async () => {
    // The mirror of the case above, and the reason the map stores an answer rather than a delta.
    const card = reactive(run({ running: false, outcome: 'completed' }))
    card.agents = card.agents.map((agent) => ({ ...agent, state: 'done' as const }))
    const view = await open(card)
    view.q('workflow-phase-head-1').click()
    await nextTick()
    expect(view.all('workflow-agents-1')).toHaveLength(1)

    card.agents = card.agents.map((agent) =>
      agent.phaseIndex === 1 ? { ...agent, state: 'running' as const } : agent,
    )
    await nextTick()
    expect(view.q('workflow-phase-head-1').getAttribute('aria-expanded')).toBe('true')
    expect(view.all('workflow-agents-1')).toHaveLength(1)
  })

  it('⛔ a phase with NO agents gets no button — never a control with nothing behind it', async () => {
    const view = await open(
      run({
        phases: [
          { index: 1, title: 'Fixtures' },
          { index: 2, title: 'Nested' },
        ],
        agents: [{ agentId: 'a1', label: 'one', phaseIndex: 1, state: 'done' }],
      }),
    )
    expect(view.q('workflow-phase-head-1').tagName).toBe('BUTTON')
    expect(view.q('workflow-phase-head-2').tagName).not.toBe('BUTTON')
    // …and it still says what it is, which is the whole truth about an empty phase.
    expect(view.q('workflow-phase-head-2').textContent).toContain('not started')
  })

  it('an agent row OPENS that agent — the id, not a path (112)', async () => {
    const opened: unknown[][] = []
    const view = mount(
      WorkflowEntry,
      { run: run(), onOpenChild: (...args: unknown[]) => opened.push(args) },
      { width: 720 },
    )
    view.q('workflow-head').click()
    await nextTick()
    view.q('workflow-agent-label').click()
    expect(opened).toEqual([[{ part: 'transcript', agentId: 'a3' }, 'judge']])
  })

  it('⛔ a QUEUED agent is NOT a control — it has written nothing to open (112)', async () => {
    const view = await open(
      run({
        phases: [{ index: 1, title: 'Draft' }],
        agents: [
          { agentId: 'q1', label: 'waiting', phaseIndex: 1, state: 'queued' },
          { agentId: 'r1', label: 'going', phaseIndex: 1, state: 'running' },
        ],
      }),
    )
    // The queued one renders its name and no button; the running one is a button.
    expect(view.all('workflow-agent-label')).toHaveLength(1)
    expect(view.q('workflow-agent-label').textContent).toContain('going')
    expect(view.q('workflow-agent-label-plain').textContent).toContain('waiting')
    // …and it still says why there is nothing to open, rather than going quiet.
    expect(view.q('workflow-queued').textContent).toContain('awaiting a slot')
  })

  it("the person's prefix is surfaced where it LANDS, and identity never depends on it (112)", async () => {
    // Measured: the prefix he asked his agents for arrives as `lastToolSummary`.
    const view = await open(
      run({
        phases: [{ index: 1, title: 'Fixtures' }],
        agents: [
          {
            agentId: 'a4d82f4376e9dd5c5',
            label: 'fixture:overflow',
            phaseIndex: 1,
            state: 'running',
            lastTool: 'StructuredOutput',
            lastToolSummary: '[fixture-overflow]',
          },
        ],
      }),
    )
    expect(view.q('workflow-agent-summary').textContent).toContain('[fixture-overflow]')
    // ⚠️ The paired point: the LABEL is the control, and it carries the exact id — so opening the
    // child never depends on a convention the user typed (111's ruling, restated).
    expect(view.q('workflow-agent-label').textContent).toContain('fixture:overflow')
  })

  it('a FINISHED phase lists no rows; the RUNNING one lists its own', async () => {
    // ⚠️ 107 §3's restraint, and the assertion the SSR file could not make. Phase 1 has two done
    // agents and contributes zero rows; phase 2 has the one that is still going.
    const view = await open(run())
    expect(view.all('workflow-agents-1')).toHaveLength(0)
    expect(view.all('workflow-agents-2')).toHaveLength(1)
    const rows = view.all('workflow-agent')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('judge')
    // …and the paired positive: the finished phase is not simply missing — it is there as a tally.
    const tallies = view.all('workflow-phase-tally')
    expect(tallies).toHaveLength(2)
    expect(tallies[0]?.textContent).toContain('2 agents')
    expect(tallies[0]?.textContent).toContain('done')
  })

  it('a five-phase, 22-agent run stays ONE collapsed row and never grows the transcript', async () => {
    const long = run({
      phases: Array.from({ length: 5 }, (_, index) => ({
        index: index + 1,
        title: `Phase ${index + 1}`,
      })),
      agents: Array.from({ length: 22 }, (_, index) => ({
        agentId: `a${index}`,
        label: `agent-${index}`,
        phaseIndex: (index % 5) + 1,
        // Only the last phase is still going, so the other four collapse to tallies.
        state: (index % 5) + 1 === 5 ? ('running' as const) : ('done' as const),
      })),
    })
    const view = mount(WorkflowEntry, { run: long }, { width: 720 })
    // ⚠️ **Measured on the HEAD, not on the root.** The harness mounts into a `display: flex` box,
    // so the component's root stretches to the box's 800px whatever it contains — an assertion on
    // the root would have been measuring the test's own container. The head is what the transcript
    // actually gets when the tree is folded, and in the app the row sits in a block flow.
    const collapsed = view.q('workflow-head').getBoundingClientRect().height
    // A number, not a vibe: one row of chrome. 22 agents at ~20px each would be 400+.
    expect(collapsed, 'collapsed, a 22-agent run must read as one row').toBeLessThan(80)
    expect(view.all('workflow-agent')).toHaveLength(0)
    expect(view.all('workflow-tree')).toHaveLength(0)

    view.q('workflow-head').click()
    await nextTick()
    // Expanded, only the running phase's agents are listed — four of five phases are tallies.
    expect(view.all('workflow-agent')).toHaveLength(4)
    expect(view.all('workflow-phase-tally')).toHaveLength(5)
    // …and even expanded it cannot grow without bound: the tree scrolls inside its own ceiling.
    const tree = view.q('workflow-tree')
    expect(tree.getBoundingClientRect().height).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(tree).maxHeight),
    )
  })

  it('the expanded tree owns a BOUNDED scroll, so a long run cannot grow the conversation', async () => {
    // 107 §3. Without this a 22-agent run expands to the height of 22 rows and pushes the reader's
    // place out of the viewport, which is the whole thing the collapse was protecting against.
    const view = await open(run())
    const tree = view.q('workflow-tree')
    const style = getComputedStyle(tree)
    expect(style.overflowY).toBe('auto')
    const max = Number.parseFloat(style.maxHeight)
    expect(Number.isFinite(max), `max-height resolved to ${style.maxHeight}`).toBe(true)
    expect(max).toBeGreaterThan(100)
    expect(max).toBeLessThan(600)
  })

  it('an attempt above 1 rides ALONGSIDE the state — it is not flattened into it', async () => {
    // The fact `subAgentFacets` would lose. A retry is a second try at the same work, which is a
    // different thing from a second agent.
    const view = await open(
      run({
        agents: [{ agentId: 'a3', label: 'judge', phaseIndex: 2, state: 'running', attempt: 2 }],
      }),
    )
    const tag = view.q('workflow-attempt')
    expect(tag.textContent).toContain('attempt 2')
    // The state word is still there beside it, not replaced by the tag.
    expect(view.q('workflow-agent-status').textContent?.trim()).toBe('running')
  })

  it('attempt 1 draws no tag — 1 is the ordinary case, and 75 of 75 measured agents were on it', async () => {
    const view = await open(
      run({
        agents: [{ agentId: 'a3', label: 'judge', phaseIndex: 2, state: 'running', attempt: 1 }],
      }),
    )
    expect(view.all('workflow-attempt')).toHaveLength(0)
    // Paired positive: the row rendered, so the absence above is about the tag and not the row.
    expect(view.all('workflow-agent')).toHaveLength(1)
  })

  it('queued renders differently from running, and says what it is waiting for', async () => {
    // Never observed on the wire — 0 of 75 agents had a `queuedAt` without a `startedAt`. Kept
    // reachable and drawn, because a fan-out wider than the concurrency cap produces exactly this.
    const view = await open(
      run({
        phases: [{ index: 1, title: 'Draft' }],
        agents: [
          { agentId: 'q1', label: 'waiting', phaseIndex: 1, state: 'queued' },
          { agentId: 'r1', label: 'going', phaseIndex: 1, state: 'running' },
        ],
      }),
    )
    expect(view.q('workflow-queued').textContent).toContain('awaiting a slot')
    const rows = view.all('workflow-agent')
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['queued', 'running'])
  })

  it('a failure docks its reason BELOW the row, and says so when there is no reason', async () => {
    // ⚠️ **The wire carries no failure reason** — 0 failures in 75 agent entries, and the states the
    // provider sends are `start`/`progress`/`done`. So the dock states what we genuinely have, and
    // states the absence when we have nothing. A blank dock would read as "that is all there is to
    // know", which is a claim nobody made.
    const view = await open(
      run({
        phases: [{ index: 1, title: 'Draft' }],
        agents: [
          { agentId: 'f1', label: 'fell-over', phaseIndex: 1, state: 'failed' },
          { agentId: 'f2', label: 'also-fell', phaseIndex: 1, state: 'failed', lastTool: 'Bash' },
        ],
      }),
    )
    const reasons = view.all('workflow-agent-reason')
    expect(reasons).toHaveLength(2)
    expect(reasons[0]?.textContent).toContain('no reason was reported')
    expect(reasons[1]?.textContent).toContain('Bash')
    // Docked BELOW: the reason is a sibling after the row, not inside it.
    const row = view.all('workflow-agent')[0]!
    expect(row.querySelector('.wf-agent-row')?.contains(reasons[0]!)).toBe(false)
  })

  it('the phase chip turns a tick and a bang, and neither is amber', async () => {
    const view = await open(
      run({
        phases: PHASES,
        agents: [
          { agentId: 'a1', label: 'one', phaseIndex: 1, state: 'done' },
          { agentId: 'a2', label: 'two', phaseIndex: 2, state: 'failed' },
        ],
      }),
    )
    const chips = view.all('workflow-phase-chip')
    expect(chips[0]?.textContent?.trim()).toBe('✓')
    expect(chips[1]?.textContent?.trim()).toBe('!')
    // ⚠️ The colours RESOLVED, which is the whole point of this project. `--danger` and `--waiting`
    // are different hues and a string comparison could never have told them apart.
    // ⚠️ Resolved through a PROBE rather than read off `--waiting` directly: the token's declared
    // value is a hex string, and `parseColor` only reads the `rgb()` form the browser computes. A
    // direct read returns null, and `expect(null).not.toBe(null)` would have failed for a reason
    // that has nothing to do with amber.
    const probe = document.createElement('span')
    probe.style.color = 'var(--waiting)'
    view.host.append(probe)
    const danger = parseColor(getComputedStyle(chips[1]!).color)
    const waiting = parseColor(getComputedStyle(probe).color)
    expect(danger, 'the failed chip has no resolved colour').not.toBeNull()
    expect(waiting, '--waiting is not declared — this comparison would be vacuous').not.toBeNull()
    expect(show(danger!), 'the failed chip must not be the attention amber').not.toBe(
      show(waiting!),
    )
  })

  it('the finished footer offers the output, and a running one offers nothing yet', async () => {
    const running = await open(run())
    expect(running.all('workflow-foot')).toHaveLength(0)

    const done = await open(
      run({ running: false, outcome: 'completed', outputFile: '/tmp/x/tasks/wq1demo.output' }),
    )
    const button = done.q('workflow-open-output')
    expect(button.textContent).toContain('Open output')
    expect(button.textContent).toContain('wq1demo.output')
  })

  it('a finished run with no output file offers no button — never a dead one', async () => {
    const view = await open(run({ running: false, outcome: 'completed' }))
    expect(view.all('workflow-open-output')).toHaveLength(0)
    // Paired positive: the footer itself is there, saying how the run ended.
    expect(view.q('workflow-foot').textContent).toContain('completed')
  })

  it('the footer offers the journal and the script, addressed by the RUN (112)', async () => {
    const opened: unknown[][] = []
    const view = mount(
      WorkflowEntry,
      {
        run: run({ running: false, outcome: 'completed' }),
        onOpenChild: (...args: unknown[]) => opened.push(args),
      },
      { width: 720 },
    )
    view.q('workflow-head').click()
    await nextTick()
    view.q('workflow-open-journal').click()
    view.q('workflow-open-script').click()
    // ⚠️ **By TASK, not by `agents[0]`.** Review found the hole in the first version: `agents[0]` is
    // whichever agent the provider announced first, which for a pipeline is routinely one still
    // queued — no file, so no run directory, so both buttons refused a journal that was on disk.
    expect(opened).toEqual([
      [{ part: 'journal', taskId: 'wq1demo' }, 'demo-panel'],
      [{ part: 'script', taskId: 'wq1demo' }, 'demo-panel'],
    ])
  })

  it('a run with no agents offers neither — there would be no id to find the run by (112)', async () => {
    const view = await open(run({ running: false, outcome: 'completed', agents: [] }))
    expect(view.all('workflow-open-journal')).toHaveLength(0)
    expect(view.all('workflow-open-script')).toHaveLength(0)
    // Paired positive: the footer is there and says how it ended.
    expect(view.q('workflow-foot').textContent).toContain('completed')
  })

  it('the tree paints on the conversation surface, not on a ground of its own', async () => {
    // 091: exactly one `data-chat-theme` carrier per view. The tree renders INSIDE the existing
    // surface, so its background has to come from the cascade rather than from a new scope.
    const view = await open(run())
    expect(view.q('workflow-entry').getAttribute('data-chat-theme')).toBeNull()
    expect(view.host.querySelectorAll('[data-chat-theme]')).toHaveLength(0)
    // …and the paired positive: it is painted, not transparent onto nothing.
    const painted = paintedBackground(view.q('workflow-entry'))
    // `Rgba` is a tuple; index 3 is alpha.
    expect(painted[3]).toBeGreaterThan(0)
  })
})

describe("the drawer's workflow row (108)", () => {
  /** A conversation with one running workflow on a real `Workflow` tool row. */
  function withWorkflow(): ReturnType<typeof createTranscript> {
    const state = createTranscript()
    const events: TranscriptEvent[] = [
      { type: 'tool_call', id: 'toolu_wf', name: 'Workflow', summary: '{"script":"…"}' },
      {
        type: 'workflow_run',
        taskId: 'wq1demo',
        toolUseId: 'toolu_wf',
        name: 'demo-panel',
        description: 'Three drafters, then a judge',
        phases: PHASES,
        agents: Array.from({ length: 22 }, (_, index) => ({
          agentId: `a${index}`,
          label: `agent-${index}`,
          phaseIndex: (index % 5) + 1,
          state: 'running' as const,
        })),
        source: 'task_progress',
      } as TranscriptEvent,
    ]
    for (const event of events) applyEvent(state, event)
    return state
  }

  it('⚠️ is CLICKABLE — the row that shipped permanently disabled', () => {
    // ⚠️ **108 review, HIGH.** `SECTIONS` gained a fourth entry and `reachable` still built its set
    // from the other three by hand, so every workflow row rendered `disabled`, wearing "this part of
    // the conversation is not on screen" about a tool row that was right there. A disabled button
    // dispatches no click, so the one thing the row exists for could not be done — and nothing
    // failed, because no test had ever clicked one.
    const view = mount(SessionPanel, { state: withWorkflow(), mode: 'normal' }, { width: 360 })
    const section = view.q('panel-workflows')
    const rows = [...section.querySelectorAll<HTMLButtonElement>('[data-cy=panel-row]')]
    // One row, not twenty-two — the same restraint, asserted where the drawer actually draws it.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.disabled, 'the workflow row is disabled and cannot be clicked').toBe(false)
    expect(rows[0]!.getAttribute('title')).toBe('Show this in the conversation')
    expect(rows[0]!.textContent).toContain('demo-panel')
  })

  it('and the click actually reaches the conversation', () => {
    // The paired positive for the assertion above: not merely enabled, but wired.
    const navigated: string[] = []
    const view = mount(
      SessionPanel,
      {
        state: withWorkflow(),
        mode: 'normal',
        onNavigate: (itemId: string) => navigated.push(itemId),
      },
      { width: 360 },
    )
    view.q('panel-workflows').querySelector<HTMLButtonElement>('[data-cy=panel-row]')!.click()
    expect(navigated).toHaveLength(1)
    // It points at the `Workflow` tool row, which is where the tree is.
    expect(navigated[0]).toMatch(/^tool_/)
  })

  it('a busy workflow leaves the panel’s own waiting count at zero', () => {
    // The drawer half of 080's line, read off the rendered attribute rather than the projection.
    const view = mount(SessionPanel, { state: withWorkflow(), mode: 'normal' }, { width: 360 })
    expect(view.q('session-panel').getAttribute('data-waiting')).toBe('0')
    // …and the paired positive: the panel is not simply empty — it is saying something.
    expect(view.all('panel-workflows')).toHaveLength(1)
  })
})

/**
 * 114 · **The walk step `57` has never finished**, from the transcript rather than from a component.
 *
 * ⛔ **`113`'s own words: "Acceptance 4 is NOT met. Nothing here reached the finished-phase
 * disclosure, the child transcript, or the output document."** Nine live attempts died before this
 * point — on an approval gate, on a hook built at runtime, and four times on a provider that kills a
 * background run the moment the model stops talking. The path itself was never walked.
 *
 * ⚠️ **Not a copy of the tests above, and the mount is the difference.** Every one of those hands
 * `WorkflowEntry` a card that a test wrote by hand. This starts from **events**, folds them with the
 * app's own `applyEvent`, and mounts `ConversationPane` — which is the component that owns both
 * overlays. So the seams it crosses are the ones the component tests cannot: the fold putting a tree
 * on a tool row, `TranscriptView` re-emitting the row's request, and the pane turning that request
 * into a document. That is the whole of what `57`'s remaining assertions are about.
 */
describe('the walk step 57 could not finish (114)', () => {
  const AGENT = 'a4d82f4376e9dd5c5'
  const CHILD: TranscriptEvent[] = [
    { type: 'user_turn', text: 'Judge the three drafts and pick one.' } as TranscriptEvent,
    {
      type: 'assistant_message',
      text: 'The second draft. It is the only one that cites.',
    } as TranscriptEvent,
  ]

  /** A run that has ENDED — every phase finished, which is the state 112's disclosure exists for. */
  function finishedRun(): TranscriptEvent[] {
    return [
      { type: 'user_turn', text: 'Run the demo panel.' } as TranscriptEvent,
      {
        type: 'tool_call',
        id: 'toolu_wf',
        name: 'Workflow',
        summary: '{"script":"…"}',
      } as TranscriptEvent,
      {
        type: 'workflow_run',
        taskId: 'wq1demo',
        toolUseId: 'toolu_wf',
        name: 'demo-panel',
        description: 'Three drafters, then a judge',
        phases: PHASES,
        agents: [
          { agentId: 'a1', label: 'drafter:one', phaseIndex: 1, state: 'done', tokens: 7718 },
          { agentId: 'a2', label: 'drafter:two', phaseIndex: 1, state: 'done', tokens: 7718 },
          { agentId: AGENT, label: 'judge', phaseIndex: 2, state: 'done', tokens: 9004 },
        ],
        usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
        outcome: 'completed',
        outputFile: '/tmp/wf/tasks/wq1demo.output',
        source: 'task_notification',
      } as unknown as TranscriptEvent,
      { type: 'assistant_message', text: 'The judge picked the second draft.' } as TranscriptEvent,
    ]
  }

  const OUTPUT = '# The pick\n\nThe **second** draft.\n'

  /**
   * Mount the pane over a finished run, with both readers wired.
   *
   * The readers record what they were ASKED for, because "the overlay opened" and "the overlay
   * opened on the thing that was clicked" are different claims and only the second one is the
   * feature. `asked` is asserted at every call site below.
   */
  function pane(): {
    view: ReturnType<typeof mount>
    asked: { child: ChildWorkInput[]; output: string[] }
  } {
    const asked: { child: ChildWorkInput[]; output: string[] } = { child: [], output: [] }
    const view = mount(
      ConversationPane,
      paneProps({
        record: record(finishedRun()),
        mode: 'normal',
        debug: false,
        onReadChildWork: async (what: ChildWorkInput): Promise<ChildWorkResult> => {
          asked.child.push(what)
          const text = CHILD.map((event) => JSON.stringify(event)).join('\n')
          return {
            ok: true,
            part: 'transcript',
            name: `agent-${AGENT}.jsonl`,
            runId: 'wf_7658bea5-b25',
            taskId: 'wq1demo',
            text,
            truncated: false,
            bytes: text.length,
            entries: CHILD,
          } as ChildWorkResult
        },
        onReadWorkflowOutput: async (taskId: string): Promise<WorkflowOutputResult> => {
          asked.output.push(taskId)
          return {
            ok: true,
            name: 'wq1demo.output',
            text: OUTPUT,
            truncated: false,
            bytes: OUTPUT.length,
          }
        },
      }),
      { width: 1200, height: 900 },
    )
    return { view, asked }
  }

  it('collapsed → expanded → a finished phase → the agent’s own transcript → the run’s output', async () => {
    const { view, asked } = pane()

    // **Collapsed**, and on ONE transcript row — the tree is a facet of the `Workflow` call, which
    // is the whole of 078's rule stated where a reader can see it.
    expect(view.host.querySelectorAll('.entry[data-item] [data-cy=workflow-entry]')).toHaveLength(1)
    expect(view.q('workflow-head').getAttribute('aria-expanded')).toBe('false')
    expect(view.all('workflow-tree')).toHaveLength(0)

    // **Expanded.**
    view.q('workflow-head').click()
    await nextTick()
    expect(view.all('workflow-tree')).toHaveLength(1)
    // Both finished phases start closed, so the click opens an actually closed phase. Assert
    // `aria-expanded`; `workflow-phase-tally` is always rendered in a phase heading and
    // cannot establish whether its rows are expanded.
    expect(
      view
        .all('workflow-phase-head-1')
        .concat(view.all('workflow-phase-head-2'))
        .map((el) => [el.tagName, el.getAttribute('aria-expanded')]),
    ).toEqual([
      ['BUTTON', 'false'],
      ['BUTTON', 'false'],
    ])
    expect(view.all('workflow-agent')).toHaveLength(0)

    // **A finished phase discloses.** Phase 2 is the judge's, and the judge is the child we open.
    const head = view.q('workflow-phase-head-2')
    expect(head.tagName).toBe('BUTTON')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    head.click()
    await nextTick()
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(view.all('workflow-agent')).toHaveLength(1)

    // **The agent's own transcript**, addressed by the id the tree carries.
    view.q('workflow-agent-label').click()
    await nextTick()
    expect(asked.child).toEqual([{ part: 'transcript', agentId: AGENT }])
    await nextTick()
    const child = view.q('child-work-viewer')
    expect(view.all('child-work-refusal')).toHaveLength(0)
    expect(view.q('child-work-name').textContent).toContain(`agent-${AGENT}.jsonl`)
    expect(view.q('child-work-run').textContent).toContain('wf_7658bea5-b25')
    // ⚠️ **Rows, not characters** — `113` found the character count unfalsifiable, because the
    // overlay's own chrome makes it non-zero over a transcript that folded to nothing.
    expect(child.querySelectorAll('.entry[data-item]')).toHaveLength(CHILD.length)
    expect(view.all('child-work-empty')).toHaveLength(0)
    expect(child.textContent).toContain('It is the only one that cites.')
    // The standing document rule: it is readable AND checkable against the bytes.
    expect(view.all('child-view-raw')).toHaveLength(1)

    // **Closed**, and the tree is still where it was — an overlay that eats its own page would pass
    // every assertion above and leave the reader nowhere.
    view.q('close-overlay').click()
    await nextTick()
    expect(view.all('child-work-viewer')).toHaveLength(0)
    expect(view.all('workflow-tree')).toHaveLength(1)

    // **The run's output**, as a document with both views (107 §4).
    view.q('workflow-open-output').click()
    await nextTick()
    expect(asked.output).toEqual(['wq1demo'])
    await nextTick()
    expect(view.all('workflow-output-refusal')).toHaveLength(0)
    expect(view.q('workflow-output-name').textContent).toContain('wq1demo.output')
    expect(view.all('doc-view-markdown')).toHaveLength(1)
    expect(view.all('doc-view-raw')).toHaveLength(1)
    // Rendered, not merely present: the heading is markup, so the Markdown view really ran.
    expect(view.q('document-body').querySelector('h1')?.textContent).toContain('The pick')
  })

  it('⛔ a QUEUED agent opens nothing — the reader is never handed a door to an empty room', async () => {
    // The paired negative for the walk above, at the same altitude: the pane is wired, so a click
    // that reached the reader would be visible in `asked`.
    const asked: ChildWorkInput[] = []
    const events = finishedRun()
    const run = events[2] as unknown as {
      agents: { agentId: string; state: string }[]
      outcome?: string
    }
    run.agents = [{ agentId: 'q1', label: 'waiting', phaseIndex: 1, state: 'queued' } as never]
    delete run.outcome
    const view = mount(
      ConversationPane,
      paneProps({
        record: record(events),
        mode: 'normal',
        debug: false,
        onReadChildWork: async (what: ChildWorkInput) => {
          asked.push(what)
          return { ok: false, reason: 'unknown-agent' } as ChildWorkResult
        },
      }),
      { width: 1200, height: 900 },
    )
    view.q('workflow-head').click()
    await nextTick()
    expect(view.all('workflow-agent-label')).toHaveLength(0)
    const plain = view.q('workflow-agent-label-plain')
    expect(plain.textContent).toContain('waiting')
    // ⛔ **The click is the assertion, and the first version of this test did not make it.** Review
    // caught `expect(asked).toHaveLength(0)` sitting over a gesture nobody performed — an empty
    // array asserted to be empty. Pressing the row is what proves it is inert: no button, and
    // nothing behind it either, so a reader who tries gets no request and no overlay.
    expect(plain.tagName).not.toBe('BUTTON')
    plain.click()
    await nextTick()
    await nextTick()
    expect(asked).toHaveLength(0)
    expect(view.all('child-work-viewer')).toHaveLength(0)
    // …and the paired positive, so the three negatives are not about an empty component: the tree
    // is open and it says what the row is waiting for.
    expect(view.q('workflow-queued').textContent).toContain('awaiting a slot')
  })
})
