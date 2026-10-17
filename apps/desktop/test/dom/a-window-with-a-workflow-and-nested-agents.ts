import { reactive } from 'vue'
import { page, userEvent } from 'vitest/browser'
import { panelEvents, SESSION } from '../../look/fixtures/right-panel'
import { settle, windowStage } from '../../look/fixtures/window'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META, mount, type Mounted } from './harness'

/**
 * The real window, with what makes the content stack its surfaces: a workflow (its block's wash,
 * its head's second wash under the pointer), a sub-agent nested three deep, and a child's work that
 * opens in the overlay.
 */

const NOW = Date.now()

/** A workflow and three nested sub-agents, after the window's own conversation. */
export const STACKING_EVENTS: [unknown, number][] = [
  [{ type: 'tool_call', id: 'call_1', name: 'Task', summary: 'research the bakery' }, NOW - 50_000],
  [
    {
      type: 'sub_agent',
      phase: 'started',
      agentId: 'a1',
      parentToolCallId: 'call_1',
      title: 'researcher',
    },
    NOW - 49_000,
  ],
  [
    {
      type: 'tool_call',
      id: 'call_2',
      name: 'Task',
      summary: 'dig into prices',
      parentToolCallId: 'call_1',
    },
    NOW - 48_000,
  ],
  [
    {
      type: 'sub_agent',
      phase: 'started',
      agentId: 'a2',
      parentToolCallId: 'call_2',
      title: 'pricer',
    },
    NOW - 47_000,
  ],
  [
    {
      type: 'tool_call',
      id: 'call_3',
      name: 'Task',
      summary: 'check one shop',
      parentToolCallId: 'call_2',
    },
    NOW - 46_000,
  ],
  [
    {
      type: 'sub_agent',
      phase: 'started',
      agentId: 'a3',
      parentToolCallId: 'call_3',
      title: 'checker',
    },
    NOW - 45_000,
  ],
  [
    {
      type: 'tool_call',
      id: 'call_4',
      name: 'Bash',
      summary: 'ls -la',
      parentToolCallId: 'call_3',
    },
    NOW - 44_000,
  ],
  [
    { type: 'tool_call', id: 'toolu_wf', name: 'Workflow', summary: '{"script":"…"}' },
    NOW - 41_000,
  ],
  [
    {
      type: 'workflow_run',
      taskId: 'wq1demo',
      toolUseId: 'toolu_wf',
      name: 'site-review',
      description: 'Two drafters, then a judge',
      phases: [
        { index: 1, title: 'Draft' },
        { index: 2, title: 'Judge' },
      ],
      agents: [
        { agentId: 'w1', label: 'drafter:one', phaseIndex: 1, state: 'done', tokens: 7718 },
        { agentId: 'w2', label: 'drafter:two', phaseIndex: 1, state: 'running' },
        { agentId: 'w3', label: 'judge', phaseIndex: 2, state: 'queued' },
      ],
      usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
      source: 'task_progress',
    },
    NOW - 40_000,
  ],
]

/** What a drafter did, as the child-work viewer reads it. */
export const CHILD_WORK = {
  ok: true,
  part: 'transcript',
  name: 'agent-w1.jsonl',
  runId: 'wf_1',
  taskId: 'wq1demo',
  text: '{"type":"assistant_message","text":"Done."}',
  truncated: false,
  bytes: 43,
  entries: [{ type: 'assistant_message', text: 'Done. The header and the menu are in.' }],
}

/** Press `selector` if it is there, and let the window settle. */
export async function press(root: ParentNode, selector: string): Promise<boolean> {
  const el = root.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.click()
  await settle()
  return true
}

/**
 * The window at `width`, its stacking content in the conversation, then `more`, with `pane` merged
 * into the conversation pane's props. Its record is reactive, as the app's store holds it, so a
 * card that writes its draft (an answer picked) redraws.
 */
export async function stackingWindow(
  width = 1180,
  more: [unknown, number][] = [],
  pane: Record<string, unknown> = {},
): Promise<Mounted> {
  await page.viewport(width, 800)
  const record = createSessionRecord(META.sessionId)
  record.meta = SESSION as never
  record.phase = 'open'
  ;[...panelEvents(), ...STACKING_EVENTS, ...more].forEach(([event, at], index) =>
    applyEvent(record.transcript, event as never, at, index + 1),
  )
  const m = mount(
    windowStage({
      titleBar: true,
      pane: { record: reactive(record), onReadChildWork: async () => CHILD_WORK, ...pane },
    }),
    {},
    { width, height: 800 },
  )
  await settle()
  return m
}

/** Every sub-agent card opened, three deep. */
export async function openEverySubAgent(m: Mounted): Promise<void> {
  for (let depth = 0; depth < 3; depth++) {
    for (const head of [
      ...m.host.querySelectorAll<HTMLElement>('[data-cy="subagent-head"][aria-expanded="false"]'),
    ]) {
      head.click()
      await settle()
    }
  }
}

/** The workflow's head, scrolled into view and under the pointer. */
export async function pointAtTheWorkflow(m: Mounted): Promise<HTMLElement> {
  const head = m.host.querySelector<HTMLElement>('[data-cy="workflow-head"]')!
  head.scrollIntoView({ block: 'center' })
  await userEvent.hover(head)
  await new Promise((done) => setTimeout(done, 300))
  return head
}

/** The child-work viewer, opened from the workflow's first drafter. */
export async function openAChildsWork(m: Mounted): Promise<void> {
  await press(m.host, '[data-cy="workflow-head"]')
  const phase = m.host.querySelector<HTMLElement>('[data-cy="workflow-phase-head-1"]')
  if (phase?.getAttribute('aria-expanded') !== 'true')
    await press(m.host, '[data-cy="workflow-phase-head-1"]')
  await press(m.host, '[data-cy="workflow-agent-label"]')
  await new Promise((done) => setTimeout(done, 300))
}
