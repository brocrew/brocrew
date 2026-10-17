import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { SubAgentTasks } from '../src/claude/sub-agent-tasks'
import { WorkflowTasks } from '../src/claude/workflow-tasks'
import { FileEdits } from '../src/claude/file-edits'
import {
  MAX_WORKFLOW_AGENTS,
  MAX_WORKFLOW_DESCRIPTION,
  MAX_WORKFLOW_TEXT,
  runtimeEventSchema,
  workflowAgentState,
  type RuntimeEvent,
} from '../src/index'

/**
 * 108 · The dynamic-workflow extraction, against the shapes the wire really sends.
 *
 * ⚠️ **Every fixture here is written by hand and none is copied from a real session.** The shapes,
 * the field names, the presence pattern and the state words are all measured — from 4 real workflow
 * runs across 19 sessions in this machine's own database — but the *content* (names, labels, task
 * ids) is invented, because a fixture in this repo may not carry anyone's conversation.
 *
 * What was measured, and what each number pins below:
 *
 * | fact | measured |
 * |---|---|
 * | `task_progress` frames carrying `workflow_progress` | **22 of 41** |
 * | agent states ever seen | `start`, `progress`, `done` — never queued, never failed |
 * | `attempt` values ever seen | `1`, in 75 of 75 |
 * | agents with `queuedAt` and no `startedAt` | **0** |
 * | `tool_use_id` on `task_updated` | **never** |
 * | the roster shrinking between frames | **never** |
 */

function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

/** One normalizer session: the three registries the adapter threads through, held together. */
function session(): (message: Record<string, unknown>) => RuntimeEvent[] {
  const tasks = new SubAgentTasks()
  const edits = new FileEdits()
  const runs = new WorkflowTasks()
  return (message) => normalizeMessage(sdk(message), tasks, edits, runs)
}

const TASK = 'wq1demo'
const TOOL = 'toolu_01Demo'

const started = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'system',
  subtype: 'task_started',
  task_id: TASK,
  tool_use_id: TOOL,
  description: 'Three drafters in parallel, then one judge',
  task_type: 'local_workflow',
  workflow_name: 'demo-panel',
  // The whole script, as the wire really sends it — and the field this must never carry through.
  prompt: `export const meta = { name: 'demo-panel' }\n${'// filler\n'.repeat(80)}`,
  session_id: 's',
  ...over,
})

const agentEntry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'workflow_agent',
  index: 1,
  label: 'drafter:one',
  phaseIndex: 1,
  phaseTitle: 'Draft',
  agentId: 'a1',
  model: 'claude-opus-5[1m]',
  state: 'start',
  startedAt: 1_700_000_000_100,
  queuedAt: 1_700_000_000_090,
  attempt: 1,
  // ~210–400 bytes on the wire, byte-identical on every frame for the agent's whole life.
  promptPreview: 'Write a short paragraph about parallel work. '.repeat(6),
  lastProgressAt: 1_700_000_000_100,
  ...over,
})

const phases = [
  { type: 'workflow_phase', index: 1, title: 'Draft' },
  { type: 'workflow_phase', index: 2, title: 'Judge' },
]

const progress = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'system',
  subtype: 'task_progress',
  task_id: TASK,
  tool_use_id: TOOL,
  description: 'Draft: drafter:one',
  summary: 'Three drafters in parallel, then one judge',
  usage: { total_tokens: 7718, tool_uses: 1, duration_ms: 2710 },
  last_tool_name: 'drafter:one',
  session_id: 's',
  ...over,
})

/** Narrow to the one variant, so a test that stops producing it fails instead of passing on `[]`. */
function onlyRun(events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'workflow_run' }> {
  expect(events).toHaveLength(1)
  const event = events[0]!
  expect(event.type).toBe('workflow_run')
  if (event.type !== 'workflow_run') throw new Error('unreachable')
  // Everything this normalizer emits crosses IPC and lands in SQLite, so nothing is asserted about
  // an event the boundary schema would have rejected.
  expect(runtimeEventSchema.safeParse(event).success).toBe(true)
  return event
}

describe('the workflow gate — which tracked tasks become a run (108)', () => {
  it('a local_workflow start opens a run, and carries the anchor and the name', () => {
    const run = onlyRun(session()(started()))
    expect(run.taskId).toBe(TASK)
    expect(run.toolUseId).toBe(TOOL)
    expect(run.name).toBe('demo-panel')
    expect(run.description).toBe('Three drafters in parallel, then one judge')
    expect(run.source).toBe('task_started')
  })

  it('a local_bash task is NOT a run — it stays the chatter it always was', () => {
    // 8 of the 12 `task_started` messages measured are `local_bash`. If this gate admitted them,
    // every backgrounded shell command would grow a phase tree with no phases in it.
    const events = session()(started({ task_type: 'local_bash', workflow_name: undefined }))
    expect(events[0]?.type).toBe('unknown')
    // …and the paired positive, so this cannot pass by the gate rejecting everything.
    expect(session()(started())[0]?.type).toBe('workflow_run')
  })

  it('a local_workflow that ALSO declares subagent_type stays a sub-agent, and is not both', () => {
    // `sub-agent-tasks.ts` documents this case as deliberately admitted there. Two registries
    // claiming one task would draw a card AND a tree for the same work — the "same fact twice"
    // defect 028 and 037 exist to prevent. Never observed (0 of 12); settled so it cannot become a
    // race between two gates later.
    const events = session()(started({ subagent_type: 'Explore' }))
    expect(events[0]?.type).toBe('sub_agent')
    expect(events.some((event) => event.type === 'workflow_run')).toBe(false)
  })

  it('an ambient task is hidden at birth, and stays hidden through its ending', () => {
    const feed = session()
    expect(feed(started({ skip_transcript: true }))[0]?.type).toBe('unknown')
    expect(
      feed({
        type: 'system',
        subtype: 'task_notification',
        task_id: TASK,
        tool_use_id: TOOL,
        status: 'completed',
        session_id: 's',
      })[0]?.type,
    ).toBe('unknown')
  })

  it('…and a later roster does not un-hide it', () => {
    // ⚠️ **108 review.** The refusal used to leave no trace, so the very next `task_progress` — which
    // carries a roster and therefore names itself — walked in through `join()` and opened the exact
    // task the SDK asked us to hide. A refusal has to be remembered or it is not a refusal.
    const feed = session()
    feed(started({ skip_transcript: true }))
    expect(feed(progress({ workflow_progress: [...phases, agentEntry()] }))[0]?.type).toBe(
      'unknown',
    )
    // …and the paired positive: the same frame DOES open a run that was never hidden.
    const other = session()
    expect(other(progress({ workflow_progress: [...phases, agentEntry()] }))[0]?.type).toBe(
      'workflow_run',
    )
  })

  it('the anchor is remembered FIRST-wins, and never for a task we did not admit', () => {
    // ⚠️ Two guards the mutation battery found untested. Asked of the registry directly, because the
    // normalizer only ever calls `anchor()` after admission — which makes the second guard
    // unreachable from there and therefore impossible to pin through it.
    const runs = new WorkflowTasks()
    // Never admitted: naming an anchor must not smuggle it into the registry.
    runs.anchor('ghost', 'toolu_ghost')
    expect(runs.knows('ghost')).toBe(false)
    expect(runs.anchorOf('ghost')).toBe('')
    // Admitted, then anchored — and a SECOND id does not move a live run onto someone else's row.
    expect(runs.start('real', 'local_workflow', '', false)).toBe(true)
    runs.anchor('real', 'toolu_first')
    runs.anchor('real', 'toolu_second')
    expect(runs.anchorOf('real')).toBe('toolu_first')
    // An empty id is not an anchor and must not overwrite one either.
    runs.anchor('real', '')
    expect(runs.anchorOf('real')).toBe('toolu_first')
  })

  it('a run joined mid-flight names itself by carrying a roster — and only by that', () => {
    // The one self-naming a workflow can do. `usage` and `last_tool_name` are what a `local_bash`
    // sends too, so a progress frame without a roster cannot vouch for a task we never saw start.
    expect(session()(progress())[0]?.type).toBe('unknown')
    expect(session()(progress({ workflow_progress: [...phases, agentEntry()] }))[0]?.type).toBe(
      'workflow_run',
    )
  })

  it('the ending on task_updated lands, even though it carries no tool_use_id at all', () => {
    // ⚠️ The shape that decided the registry. `task_updated` sends `{task_id, patch}` and nothing
    // else — no anchor, no task_type. Without a remembered anchor the run's ending would have
    // nowhere to attach and the tree would sit "running" forever.
    const feed = session()
    feed(started())
    const ended = onlyRun(
      feed({
        type: 'system',
        subtype: 'task_updated',
        task_id: TASK,
        patch: { status: 'completed', end_time: 1_700_000_030_000 },
        session_id: 's',
      }),
    )
    expect(ended.toolUseId).toBe(TOOL)
    expect(ended.outcome).toBe('completed')
  })

  it('a task_updated that is not an ending does not close the run', () => {
    // 035's ruling, inherited: a patch is a patch. Falling through to chatter leaves the run
    // running, which is the safe direction — the notification will close it honestly.
    const feed = session()
    feed(started())
    expect(
      feed({ type: 'system', subtype: 'task_updated', task_id: TASK, patch: {} })[0]?.type,
    ).toBe('unknown')
  })

  it('a notification with an unreadable status still ENDS the run, as `unknown`', () => {
    // A notification IS the ending. Rounding an unreadable status to `completed` would put a green
    // tick under a run nobody said succeeded; leaving it open would spin forever.
    const feed = session()
    feed(started())
    const ended = onlyRun(
      feed({
        type: 'system',
        subtype: 'task_notification',
        task_id: TASK,
        tool_use_id: TOOL,
        status: 'something-new',
        output_file: '/tmp/x/tasks/wq1demo.output',
        session_id: 's',
      }),
    )
    expect(ended.outcome).toBe('unknown')
    expect(ended.outputFile).toBe('/tmp/x/tasks/wq1demo.output')
  })
})

describe('what a frame carries, and what it refuses to (108)', () => {
  it('the workflow SCRIPT never reaches the event', () => {
    // ⚠️ 052's rule at the point it applies. `task_started.prompt` is the entire script (~2.4 KB
    // measured); it is the tool call's own input and is already in the transcript as that row's
    // summary. A second copy in the ledger is the same bytes recorded twice.
    const run = onlyRun(session()(started()))
    const wire = started()
    expect(String(wire['prompt']).length).toBeGreaterThan(800) // the fixture really is large
    expect(JSON.stringify(run)).not.toContain('export const meta')
  })

  it('the per-agent PREVIEWS never reach the event either', () => {
    // The field the dispatch's warning was actually about — see `workflow-run.ts`. ~800 of an
    // agent's ~1,114 wire bytes, repeated verbatim on every frame, drawn by nothing 107 designed.
    const run = onlyRun(
      session()(
        progress({
          workflow_progress: [...phases, agentEntry({ resultPreview: 'x'.repeat(300) })],
        }),
      ),
    )
    expect(JSON.stringify(run)).not.toContain('Write a short paragraph')
    expect(JSON.stringify(run)).not.toContain('xxxxxxxxxx')
    // …and the paired positive: the fields the tree DOES draw all survive.
    expect(run.agents?.[0]).toMatchObject({ agentId: 'a1', label: 'drafter:one', phaseIndex: 1 })
  })

  /**
   * 🔴 **The bound this family never got** (299 §2, from 297 finding 2).
   *
   * ⛔ **`background-work.test.ts:242`'s docblock is the rule and it is this event's too:** ⚑ *"a
   * bound the PRODUCER can exceed is not a bound, it is a delete."* Four sibling families cap
   * producer strings; `workflow_run` was the fifth and capped none, while its schema said
   * `.max(200)` — so an over-long label failed `runtimeEventSchema` at `toWireEvent`,
   * `degradeEvent` replaced the whole event with `unknown{degradedFrom:'workflow_run'}`, and the
   * card ran to completion with **no phases and no agents**, permanently, in the ledger and every
   * resume.
   *
   * ⚠️ **`onlyRun` is where it dies**: every event this normalizer emits is re-validated there
   * against the same schema the IPC boundary uses. That check has been in this file since 108 — the
   * fixture was 11 characters long.
   */
  it('🔴 a 224-character agent label is SHORTENED, and the roster is not deleted', () => {
    // The reachable shape, and 297 read the asymmetry out of the pinned SDK rather than assuming it:
    // the DEFAULT label is `.slice(0, 60)` and an explicit one is not sliced at all. This is a
    // dynamic workflow fanning out over a list and passing each item as its agent's label.
    const label = `fan-out over ${'the-quick-brown-fox-'.repeat(11)}`
    expect(label.length).toBeGreaterThan(200)
    const run = onlyRun(
      session()(progress({ workflow_progress: [...phases, agentEntry({ label })] })),
    )
    // ⛔ The roster survives — the fact the delete destroyed.
    expect(run.agents).toHaveLength(1)
    expect(run.phases).toHaveLength(2)
    // …and the label is the author's own words, shortened, with the mark that says so.
    expect(run.agents?.[0]?.label).toHaveLength(MAX_WORKFLOW_TEXT)
    expect(run.agents?.[0]?.label.startsWith('fan-out over the-quick-brown-fox')).toBe(true)
    expect(run.agents?.[0]?.label.endsWith('…')).toBe(true)
    // ⚑ **201, not 200** — `truncate` appends an ellipsis, so a `.max(200)` schema would have
    // rejected precisely the string the bound had just produced. See {@link MAX_WORKFLOW_TEXT}.
    expect(MAX_WORKFLOW_TEXT).toBe(201)
  })

  it('⛔ …and the other three strings an AUTHOR writes are bounded too', () => {
    // `meta.name` and `meta.phases[].title` are hand-written in the workflow script with nothing
    // between them and the wire; `description` is the run's own brief and has the larger ceiling
    // because it is a sentence rather than a name.
    const long = 'z'.repeat(400)
    const start = onlyRun(
      session()(
        started({
          workflow_name: long,
          description: 'd'.repeat(3_000),
          workflow_progress: [{ type: 'workflow_phase', index: 1, title: long }],
        }),
      ),
    )
    expect(start.name).toHaveLength(MAX_WORKFLOW_TEXT)
    expect(start.phases?.[0]?.title).toHaveLength(MAX_WORKFLOW_TEXT)
    expect(start.description).toHaveLength(MAX_WORKFLOW_DESCRIPTION)
  })

  it('⚠️ a short string is untouched — the bound shortens, it does not rewrite', () => {
    // The paired positive. A rule that trimmed everything would pass every assertion above and be
    // wrong about every real run.
    const run = onlyRun(session()(started()))
    expect(run.name).toBe('demo-panel')
    expect(run.description).toBe('Three drafters in parallel, then one judge')
    expect(run.name?.endsWith('…')).toBe(false)
  })

  it('an agent keeps every number the provider gave it, and invents none', () => {
    const run = onlyRun(
      session()(
        progress({
          workflow_progress: [
            ...phases,
            agentEntry({
              state: 'done',
              lastToolName: 'StructuredOutput',
              lastToolSummary: 'one',
              tokens: 7718,
              // ⚠️ Zero, and it is REAL — measured on every agent of two runs. It must survive as 0
              // and not be dropped as falsy, or the row shows nothing where the provider said none.
              toolCalls: 0,
              durationMs: 2691,
            }),
          ],
        }),
      ),
    )
    expect(run.agents?.[0]).toMatchObject({
      state: 'done',
      lastTool: 'StructuredOutput',
      lastToolSummary: 'one',
      tokens: 7718,
      toolCalls: 0,
      durationMs: 2691,
    })
    // Absent stays ABSENT, which is the other half of the same rule.
    const bare = onlyRun(session()(progress({ workflow_progress: [...phases, agentEntry()] })))
    expect(bare.agents?.[0]).not.toHaveProperty('tokens')
    expect(bare.agents?.[0]).not.toHaveProperty('durationMs')
    expect(bare.agents?.[0]).not.toHaveProperty('lastTool')
  })

  it('a frame with no roster carries NO `agents` key — not an empty one', () => {
    // ⚠️ **The load-bearing distinction, and 19 of 41 measured frames are on this side of it.** An
    // empty array would tell the fold the run has zero agents, and the tree would blank twice a
    // second for the length of the run.
    const feed = session()
    feed(started())
    const heartbeat = onlyRun(feed(progress()))
    expect(heartbeat).not.toHaveProperty('agents')
    expect(heartbeat).not.toHaveProperty('phases')
    expect(heartbeat.usage).toEqual({ tokens: 7718, toolCalls: 1, ms: 2710 })
    // The paired positive: a frame that DOES carry one says so.
    const withRoster = onlyRun(feed(progress({ workflow_progress: [...phases, agentEntry()] })))
    expect(withRoster.agents).toHaveLength(1)
    expect(withRoster.phases).toHaveLength(2)
  })

  it('a roster of entries we cannot read is also NO roster, not an empty one', () => {
    const feed = session()
    feed(started())
    const run = onlyRun(
      feed(
        progress({
          workflow_progress: [
            { type: 'workflow_agent' }, // no agentId, no phaseIndex — cannot be merged or placed
            { type: 'something_new', index: 1 },
          ],
        }),
      ),
    )
    expect(run).not.toHaveProperty('agents')
  })

  it("the run's heading does not follow what it is doing this second", () => {
    // 029's lesson. On `task_progress` the `description` field holds the CURRENT activity
    // ("Draft: drafter:one"), which would rewrite the tree's heading on every heartbeat. `summary`
    // is the durable one there.
    const run = onlyRun(session()(progress({ workflow_progress: [...phases, agentEntry()] })))
    expect(run.description).toBe('Three drafters in parallel, then one judge')
  })

  it('a roster past the cap is COUNTED, never quietly cut', () => {
    const many = Array.from({ length: MAX_WORKFLOW_AGENTS + 7 }, (_, index) =>
      agentEntry({ agentId: `a${index}`, label: `agent-${index}` }),
    )
    const run = onlyRun(session()(progress({ workflow_progress: [...phases, ...many] })))
    expect(run.agents).toHaveLength(MAX_WORKFLOW_AGENTS)
    expect(run.droppedAgents).toBe(7)
    // A cap that fits is silent — `droppedAgents` is a fact, not a field that is always there.
    const few = onlyRun(session()(progress({ workflow_progress: [...phases, agentEntry()] })))
    expect(few).not.toHaveProperty('droppedAgents')
  })
})

describe('the state vocabulary (108)', () => {
  it('maps the three states the wire actually sends', () => {
    // 26 `start`, 6 `progress`, 43 `done` — the whole observed set.
    expect(workflowAgentState('start')).toBe('running')
    expect(workflowAgentState('progress')).toBe('running')
    expect(workflowAgentState('done')).toBe('done')
  })

  it('keeps queued and failed reachable, though neither was ever observed', () => {
    // ⚠️ Absence in a capture is not absence on the wire. These are here because a run CAN fail and
    // a fan-out CAN outrun its slots, and because a state we cannot read must never be rounded to
    // one we can — least of all to `done`.
    expect(workflowAgentState('failed')).toBe('failed')
    expect(workflowAgentState('queued')).toBe('queued')
  })

  it('an unrecognised state is `unknown`, never rounded to done or running', () => {
    expect(workflowAgentState('materialising')).toBe('unknown')
    expect(workflowAgentState('')).toBe('unknown')
  })

  it('nineteen heartbeats after a roster still each carry NO roster of their own', () => {
    // The end-to-end statement of the 22-vs-19 measurement, at the boundary this file owns: the
    // normalizer must not synthesise a roster onto a frame that had none. What the FOLD then does
    // with that absence is `apps/desktop/test/workflow-fold.test.ts`.
    const feed = session()
    feed(started())
    const withRoster = onlyRun(
      feed(
        progress({ workflow_progress: [...phases, agentEntry(), agentEntry({ agentId: 'a2' })] }),
      ),
    )
    expect(withRoster.agents).toHaveLength(2)
    for (let beat = 0; beat < 19; beat++) {
      expect(onlyRun(feed(progress()))).not.toHaveProperty('agents')
    }
  })
})
