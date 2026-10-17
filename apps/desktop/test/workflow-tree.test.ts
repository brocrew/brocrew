import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  markReopened,
  type ToolItem,
  type TranscriptState,
  type WorkflowRunCard,
} from '../src/renderer/src/lib/transcript'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { attentionTraces, tracesOutsideDrawer } from '../src/renderer/src/lib/drawer'
import { workflowAgentFacets, workflowRunFacets } from '../src/renderer/src/lib/agent-state'
import type { TranscriptEvent, WorkflowAgent } from '../src/shared/runtime-ipc'

/**
 * 108 · The workflow tree: what the fold does with twelve frames, and what the drawer does not do
 * with a busy run.
 *
 * ⚠️ **Every negative here is paired with a positive**, because these renderers are SSR-only and a
 * `not.toContain` over markup that failed to render passes over nothing (`brobot2-ssr-tests-pass-
 * vacuously`). Where the claim is "no amber", the pair is "and here is the amber when it is earned".
 */

const TOOL = 'toolu_wf'
const TASK = 'wq1demo'

const launch: TranscriptEvent = {
  type: 'tool_call',
  id: TOOL,
  name: 'Workflow',
  summary: '{"script":"export const meta = …"}',
}

const frame = (over: Partial<Extract<TranscriptEvent, { type: 'workflow_run' }>> = {}) =>
  ({
    type: 'workflow_run',
    taskId: TASK,
    toolUseId: TOOL,
    name: 'demo-panel',
    source: 'task_progress',
    ...over,
  }) as TranscriptEvent

const agent = (over: Record<string, unknown> = {}) => ({
  agentId: 'a1',
  label: 'drafter:one',
  phaseIndex: 1,
  state: 'running' as const,
  ...over,
})

const PHASES = [
  { index: 1, title: 'Draft' },
  { index: 2, title: 'Judge' },
]

function feed(...events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

/** The tool row the tree hangs off, asserted to exist — a query that returns undefined is vacuous. */
function anchorRow(state: TranscriptState): ToolItem {
  const row = state.items.find((item) => item.kind === 'tool')
  expect(row, 'the Workflow tool row').toBeDefined()
  if (row?.kind !== 'tool') throw new Error('unreachable')
  return row
}

describe('twelve frames, one tree (108)', () => {
  it('nine progress frames add NOTHING to the transcript', () => {
    // ⚠️ 078's rule, and the whole reason this is a facet rather than an item. The reproduction run
    // sent nine `task_progress` frames; a 22-agent run sends many more.
    const state = feed(launch)
    expect(state.items).toHaveLength(1)
    for (let beat = 0; beat < 9; beat++) {
      applyEvent(state, frame({ usage: { tokens: 100 * beat, toolCalls: beat, ms: beat * 10 } }))
    }
    expect(state.items).toHaveLength(1)
    // …and the paired positive: the one row DID take the run, so this is not passing over nothing.
    expect(anchorRow(state).workflow?.taskId).toBe(TASK)
    expect(anchorRow(state).workflow?.usage).toEqual({ tokens: 800, toolCalls: 8, ms: 80 })
  })

  it('a heartbeat with no roster does not blank the tree', () => {
    // The 22-vs-19 measurement, at the fold. Nineteen of forty-one measured frames carry no roster.
    const state = feed(
      launch,
      frame({ phases: PHASES, agents: [agent(), agent({ agentId: 'a2', label: 'drafter:two' })] }),
    )
    expect(anchorRow(state).workflow?.agents).toHaveLength(2)
    applyEvent(state, frame({ usage: { tokens: 9 } }))
    expect(anchorRow(state).workflow?.agents).toHaveLength(2)
    expect(anchorRow(state).workflow?.phases).toHaveLength(2)
  })

  it('the tree finds its row even when the frames arrive FIRST', () => {
    // In every measured conversation the `Workflow` call leads by six events, so this is the guard
    // rather than the norm — and a nesting rule that only holds when events are ordered is not one.
    const state = feed(frame({ phases: PHASES, agents: [agent()] }), launch)
    expect(anchorRow(state).workflow?.agents).toHaveLength(1)
  })

  it('an ending settles the run, and a reopen does not un-settle it', () => {
    const state = feed(launch, frame({ agents: [agent()] }))
    expect(anchorRow(state).workflow?.running).toBe(true)
    applyEvent(state, frame({ outcome: 'completed', source: 'task_notification' }))
    const run = anchorRow(state).workflow
    expect(run?.running).toBe(false)
    expect(run?.outcome).toBe('completed')
    expect(run).not.toHaveProperty('unfinished')
  })

  it('a frame arriving after we stopped watching REVIVES the run', () => {
    // ⚠️ **108 review + the mutation battery, the same defect from two directions.** A dynamic
    // workflow is a background task and legitimately outlives the turn that launched it — and
    // `stopOpenToolCalls` runs at every turn boundary. Without this the head froze on "did not
    // finish" while the rows underneath it kept updating: two answers to one question, in one card.
    const state = feed(launch, frame({ agents: [agent()] }))
    markReopened(state)
    expect(anchorRow(state).workflow?.unfinished).toBe(true)
    applyEvent(state, frame({ agents: [agent({ state: 'done' })] }))
    const run = anchorRow(state).workflow
    expect(run?.running).toBe(true)
    expect(run).not.toHaveProperty('unfinished')
    // …and an ENDING still settles it, clearing the mark rather than leaving both on.
    applyEvent(state, frame({ outcome: 'completed', source: 'task_notification' }))
    expect(anchorRow(state).workflow?.running).toBe(false)
    expect(anchorRow(state).workflow).not.toHaveProperty('unfinished')
  })

  it('an ending clears a stale "did not finish" mark', () => {
    // The mutation that survived: deleting `delete run.unfinished` changed nothing, because no test
    // reached that line with the mark actually set.
    const state = feed(launch, frame({ agents: [agent()] }))
    markReopened(state)
    expect(anchorRow(state).workflow?.unfinished).toBe(true)
    applyEvent(state, frame({ outcome: 'failed', source: 'task_notification' }))
    expect(anchorRow(state).workflow).not.toHaveProperty('unfinished')
    expect(anchorRow(state).workflow?.outcome).toBe('failed')
  })

  it('a run still going when the session died says "did not finish", never an outcome', () => {
    // ⚠️ 074's rule one level down. Without this a reopened conversation draws a blue running dot,
    // indefinitely, about agents that stopped when the app did.
    const state = feed(launch, frame({ agents: [agent()] }))
    markReopened(state)
    const run = anchorRow(state).workflow
    expect(run?.running).toBe(false)
    expect(run?.unfinished).toBe(true)
    // The distinction that matters: we stopped watching, we did not learn an outcome.
    expect(run).not.toHaveProperty('outcome')
  })
})

/**
 * 🔴 **D-003 · `738` P-3 — a running workflow read *"did not finish"* at every turn end**, with its
 * agents not live, while the background bar listed it running — until the next progress frame
 * revived it, 0.5 to 10 s later (`smoke:ui` 57). ⚑ The level named the run by its own `task_id`
 * (`wdrzvugu5` in batch 2) before the turn completed.
 */
describe('D-003 · a turn ending spares the run the level still lists', () => {
  const listed = (...ids: string[]): TranscriptEvent => ({
    type: 'background_work',
    running: ids.map((id) => ({ id, toolCallId: TOOL, kind: 'local_workflow' })),
    source: 'task_started',
  })
  const completed: TranscriptEvent = { type: 'turn', state: 'completed' }

  it('🔴 still running after the turn, and its agents still live', () => {
    const state = feed(
      launch,
      listed(TASK),
      frame({ phases: PHASES, agents: [agent()] }),
      completed,
    )
    const run = anchorRow(state).workflow!
    expect(run.running, 'the turn end stopped a run the level still lists').toBe(true)
    expect(run).not.toHaveProperty('unfinished')
    expect(workflowRunFacets(run)).toEqual({ doing: 'working', being: 'live' })
    expect(workflowAgentFacets(run.agents[0]!, run).being).toBe('live')
  })

  it('the paired positive: a run the level does NOT list is still marked at the turn end', () => {
    const state = feed(launch, listed('some-other-task'), frame({ agents: [agent()] }), completed)
    const run = anchorRow(state).workflow!
    expect(run.running).toBe(false)
    expect(run.unfinished).toBe(true)
  })

  it('⛔ a session boundary spares nothing: the child’s exit takes every task with it', () => {
    const state = feed(launch, listed(TASK), frame({ agents: [agent()] }))
    markReopened(state)
    expect(anchorRow(state).workflow?.running).toBe(false)
    expect(anchorRow(state).workflow?.unfinished).toBe(true)
  })

  // ⚑ **T-002 · the other two boundaries the card named** (`1003 M6`, `M7`): each would otherwise
  // leave a listed run drawn running for ever, with nothing left to correct it.
  it('⛔ …nor does a session close', () => {
    const state = feed(launch, listed(TASK), frame({ agents: [agent()] }), {
      type: 'status',
      state: 'ended',
    })
    expect(anchorRow(state).workflow?.running).toBe(false)
    expect(anchorRow(state).workflow?.unfinished).toBe(true)
  })

  it('⛔ …nor a read-only recording', () => {
    const state = feed(launch, listed(TASK), frame({ agents: [agent()] }))
    markReadOnly(state, 'a recording')
    expect(anchorRow(state).workflow?.running).toBe(false)
    expect(anchorRow(state).workflow?.unfinished).toBe(true)
  })
})

describe('the drawer: one row, and never amber (108)', () => {
  const busy = () =>
    feed(
      launch,
      frame({
        phases: PHASES,
        agents: Array.from({ length: 22 }, (_, index) =>
          agent({ agentId: `a${index}`, label: `agent-${index}`, phaseIndex: (index % 5) + 1 }),
        ),
      }),
    )

  it('a 22-agent run is ONE row in the Open tab, not twenty-two', () => {
    const panel = sessionPanel(busy())
    expect(panel.workflows).toHaveLength(1)
    expect(panel.workflows[0]?.title).toBe('demo-panel')
    // The children are emphatically not in the agents list either — that is for real sub-agents.
    expect(panel.agents).toHaveLength(0)
  })

  it('a busy workflow raises NONE of 080s five attention traces', () => {
    const panel = sessionPanel(busy())
    expect(panel.waiting).toBe(0)
    const traces = attentionTraces({
      waiting: panel.waiting,
      drawerOpen: true,
      status: 'working',
      tab: 'changes',
    })
    expect(traces).toEqual({
      badge: false,
      urgent: false,
      statusPill: false,
      tabDot: false,
      crossTab: false,
    })
    expect(tracesOutsideDrawer(traces)).toBe(0)
  })

  it('…and the paired positive: a permission RAISED BY that run does count', () => {
    // ⚠️ The half that makes the negative above mean something. A workflow agent hitting a
    // permission is a real question, and it arrives as a real `permission_request` card — counted
    // by the same code as any other, with no special case anywhere.
    const state = busy()
    applyEvent(state, {
      type: 'permission_request',
      id: 'p1',
      kind: 'command',
      action: 'Bash',
      detail: 'rm -rf build',
      scope: {
        cwd: '/tmp/x',
        paths: ['write /tmp/x/out'],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    })
    const panel = sessionPanel(state)
    expect(panel.waiting).toBe(1)
    // Still one workflow row — the permission did not turn into a second one.
    expect(panel.workflows).toHaveLength(1)
    const traces = attentionTraces({
      waiting: panel.waiting,
      drawerOpen: true,
      status: 'waiting_permission',
      tab: 'changes',
    })
    expect(traces.badge).toBe(true)
    expect(traces.tabDot).toBe(true)
    expect(traces.crossTab).toBe(true)
    expect(tracesOutsideDrawer(traces)).toBeGreaterThan(0)
  })

  it('a running workflow is not "nothing is happening", even though it needs nothing', () => {
    // The asymmetry stated: counted as HAPPENING, never as WAITING.
    expect(sessionPanel(busy()).empty).toBe(false)
    expect(sessionPanel(busy()).waiting).toBe(0)
  })

  it('a finished workflow leaves the Open tab', () => {
    const state = busy()
    applyEvent(state, frame({ outcome: 'completed', source: 'task_notification' }))
    expect(sessionPanel(state).workflows).toHaveLength(0)
  })

  it('the run row can never carry a needing — the type forbids it', () => {
    // 107 §6 as a signature rather than as a rule someone has to remember. A caller cannot pass a
    // flag that would badge the drawer for a workflow that is merely busy.
    expect(workflowRunFacets({ running: true })).toEqual({ doing: 'working', being: 'live' })
    expect(workflowRunFacets({ running: false, outcome: 'failed' })).toEqual({
      doing: 'idle',
      being: 'errored',
    })
    // An ending we could not read, and an ending we never saw, are the same faceless answer.
    expect(workflowRunFacets({ running: false, outcome: 'unknown' })).toEqual({ doing: 'unknown' })
    expect(workflowRunFacets({ running: false })).toEqual({ doing: 'unknown' })
    expect(Object.keys(workflowRunFacets({ running: true }))).not.toContain('needing')
  })
})

describe('the agent plate speaks 081, and adds no words (108)', () => {
  /** A run that is still going — the premise every `live` answer below depends on. */
  const LIVE = { running: true }
  /** A run that is over. How it ended is a different fact and none of these read it. */
  const OVER = { running: false }

  it('queued and running are drawn DIFFERENTLY', () => {
    // ⚠️ The two facts `subAgentFacets` would flatten — it collapses everything non-running and
    // non-ended to `{doing:'unknown'}` and has no `queued` at all.
    expect(workflowAgentFacets({ state: 'queued' }, LIVE)).toEqual({
      doing: 'unknown',
      being: 'unstarted',
    })
    expect(workflowAgentFacets({ state: 'running' }, LIVE)).toEqual({
      doing: 'working',
      being: 'live',
    })
    expect(workflowAgentFacets({ state: 'running', lastTool: 'Grep' }, LIVE)).toEqual({
      doing: 'tool',
      being: 'live',
    })
  })

  it('done, failed and unreadable are three answers, not two', () => {
    expect(workflowAgentFacets({ state: 'done' }, LIVE)).toEqual({ doing: 'idle', being: 'ended' })
    expect(workflowAgentFacets({ state: 'failed' }, LIVE)).toEqual({
      doing: 'idle',
      being: 'errored',
    })
    // No underline: we were told a state and could not read it, which is not "it is running".
    expect(workflowAgentFacets({ state: 'unknown' }, LIVE)).toEqual({ doing: 'unknown' })
  })

  it('an agent row can NEVER wear a needing badge, because nothing could supply one', () => {
    // ⚠️ **This test used to assert the opposite, by handing the helper an argument no production
    // path supplied** (108 review). It proved a function signature, not a surface — the badge could
    // not appear on screen and the test could not tell. The wire carries no link from a permission
    // to a workflow agent (`permission_request` has no agentId and no task_id in any measured
    // payload), so the honest assertion is that this facet is unreachable here.
    for (const state of ['queued', 'running', 'done', 'failed', 'unknown'] as const) {
      expect(workflowAgentFacets({ state }, LIVE)).not.toHaveProperty('needing')
    }
    // ⚠️ **118 added an OVER half to this loop and review removed it again.** The function returns
    // one of four hard-coded literals and has no parameter that could carry a `needing`, so the
    // assertion is about a signature; running it twice doubles nothing. The "never amber" rule that
    // 108 actually cares about is asserted where it can be broken — on the rendered row, in
    // `dom/workflow-tree.dom.test.ts`, which reads the real element for a needing badge.
    // …and the paired positive is above: a permission raised while a workflow runs DOES count,
    // through the ordinary card, which is 107 §6's ruling by the route that actually exists.
  })

  it('an agent frozen `running` inside a run that is OVER is not live — and not done (118)', () => {
    // The faceless ring, and no underline. 039's vocabulary: the provider stopped saying. It is
    // deliberately NOT `ended` (a claim it finished) and NOT `errored` (an invented outcome).
    expect(workflowAgentFacets({ state: 'running' }, OVER)).toEqual({ doing: 'unknown' })
    // The tool it was last seen using is no more current than the `running` was.
    expect(workflowAgentFacets({ state: 'running', lastTool: 'Grep' }, OVER)).toEqual({
      doing: 'unknown',
    })
    // ⚠️ **The paired positive, without which the four lines above pass over nothing** (114/115's
    // rule, and 083's). The SAME agent inside a run that is still going still reads live — the
    // correction is keyed on the run, not on some new blanket suspicion of `running`.
    expect(workflowAgentFacets({ state: 'running' }, LIVE)).toEqual({
      doing: 'working',
      being: 'live',
    })
    // And nothing else moves. A queued agent never started and now never will: "not started" is
    // the permanent truth about that row, not a stale claim about now.
    expect(workflowAgentFacets({ state: 'queued' }, OVER)).toEqual({
      doing: 'unknown',
      being: 'unstarted',
    })
    expect(workflowAgentFacets({ state: 'done' }, OVER)).toEqual({ doing: 'idle', being: 'ended' })
    expect(workflowAgentFacets({ state: 'failed' }, OVER)).toEqual({
      doing: 'idle',
      being: 'errored',
    })
  })

  it("117's real killed run: the head settles and the Judge row stops claiming to work", () => {
    // ⚠️ **The fixture is measured, not invented** (117 §2). The provider KILLS a `Workflow` when
    // the model stops talking: the manifest recorded `"status":"killed"`, `error: "Workflow
    // aborted"`, `result: null`, and no terminal `task_notification` was ever sent — so the run's
    // last frame still says its Judge is running, and `outcome` never arrives.
    const state = feed(
      launch,
      frame({
        phases: PHASES,
        agents: [agent({ agentId: 'judge', label: 'judge:correctness', phaseIndex: 2 })],
      }),
    )
    /** The run, and its Judge row, both asserted to exist — a lookup that yields undefined is vacuous. */
    const judgeIn = (run: WorkflowRunCard | undefined): [WorkflowRunCard, WorkflowAgent] => {
      expect(run, 'the workflow run').toBeDefined()
      const row = run!.agents.find((each) => each.agentId === 'judge')
      expect(row, 'the Judge row').toBeDefined()
      return [run!, row!]
    }

    const [live, liveJudge] = judgeIn(state.workflows[TASK])
    expect(live.running).toBe(true)
    // While the run is going, the row is right to say so.
    expect(workflowAgentFacets(liveJudge, live)).toEqual({ doing: 'working', being: 'live' })

    // Now the thing running it goes away — the turn ends, the app is quit, or the provider kills
    // the run and no frame ever comes back. `stopOpenToolCalls` settles the RUN on exactly that
    // boundary, and has never touched the rows underneath it.
    markReopened(state)
    const [dead, deadJudge] = judgeIn(state.workflows[TASK])
    expect(dead.running).toBe(false)
    expect(dead.unfinished).toBe(true)
    // ⛔ **The provider's own word is untouched** — 039's rule. The row is drawn honestly by
    // derivation; rewriting `state` would destroy what the run was doing when it was killed.
    expect(deadJudge.state).toBe('running')
    expect(workflowAgentFacets(deadJudge, dead)).toEqual({ doing: 'unknown' })
    // And no outcome was invented for the run either, which is the same rule one level up.
    expect(dead.outcome).toBeUndefined()
  })
})
