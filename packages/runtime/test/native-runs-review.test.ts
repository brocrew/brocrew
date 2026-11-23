import { expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { runtimeEventSchema } from '../src/events'
import { normalizeMessage } from '../src/claude/normalize'
import { BackgroundTasks } from '../src/claude/background-tasks'
import { SubAgentTasks } from '../src/claude/sub-agent-tasks'
import { WorkflowTasks } from '../src/claude/workflow-tasks'
import { SchedulingCalls } from '../src/claude/scheduling-calls'
import { normalizeNotification } from '../src/codex/normalize'
import { CodexSubAgents } from '../src/codex/sub-agents'
import { scheduledRun } from '../src/native-run'

function session() {
  const background = new BackgroundTasks()
  const tasks = new SubAgentTasks()
  const workflows = new WorkflowTasks()
  const feed = (value: unknown) =>
    normalizeMessage(value as SDKMessage, tasks, undefined, workflows, background)
  return { feed, background }
}

const call = (name: string, input: unknown, id = 'call-a') => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
})
const reply = (id = 'call-a') => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Finished' }] },
})
const receipt = (tool_name: string, tool_input: unknown, tool_response: unknown) =>
  new SchedulingCalls().answered({ tool_name, tool_use_id: 'call-a', tool_input, tool_response })

it.each([
  ['CronList', {}, { jobs: [] }],
  ['CronDelete', { id: 'job-a' }, { id: 'job-a' }],
  ['ScheduleWakeup', { stop: true }, { scheduledFor: 0, stopped: true }],
])('does not create a job row for %s management', (tool, input, output) => {
  const event = receipt(tool, input, output)
  expect(event?.receipt).not.toHaveProperty('run')
})

it('keeps a wake-up prompt and numeric next time through the wire', () => {
  const prompt = 'Inspect every fictional pear.\nKeep the full question.'
  const nominalAt = 1_900_000_000_000
  const event = receipt(
    'ScheduleWakeup',
    { delaySeconds: 120, prompt },
    { scheduledFor: nominalAt },
  )
  expect(runtimeEventSchema.parse(event)).toMatchObject({
    receipt: { input: { prompt }, nominalAt, run: { kind: 'job', input: prompt } },
  })
  expect(event?.receipt?.run).not.toHaveProperty('progress')
})

it('leaves known next-time formatting to the consumer', () => {
  expect(scheduledRun({ prompt: 'Inspect pears', nominalAt: 1_900_000_000_000 })).toEqual({
    kind: 'job',
    input: 'Inspect pears',
  })
})

it.each(['Agent', 'Task', 'Workflow'])('keeps %s off command tool rows', (name) => {
  const { feed } = session()
  expect(feed(call(name, { prompt: 'Inspect pears', name: 'Orchard' }))[0]).not.toHaveProperty(
    'run',
  )
  expect(feed(reply())[0]).not.toHaveProperty('run')
})

it('uses the reported workflow description and verbatim args once', () => {
  const { feed } = session()
  feed(
    call('Workflow', {
      name: 'Orchard',
      scriptPath: '/fictional/orchard.ts',
      args: { fruit: 'pear', count: 3 },
      description: 'Ignored tool field',
      title: 'Ignored title',
    }),
  )
  const event = feed({
    type: 'system',
    subtype: 'task_started',
    task_id: 'flow-a',
    tool_use_id: 'call-a',
    task_type: 'local_workflow',
    workflow_name: 'Orchard',
    description: 'Inspect fruit',
  }).find((e) => e.type === 'workflow_run')
  expect(event).toMatchObject({
    run: {
      kind: 'workflow',
      input: 'Orchard\nInspect fruit\n/fictional/orchard.ts\n{"fruit":"pear","count":3}',
    },
  })
})

it('keeps Codex spawn plumbing out of shared top-level fields', () => {
  const params = {
    item: {
      type: 'collabAgentToolCall',
      id: 'spawn-a',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child-a'],
      prompt: 'Inspect pears',
      model: 'small',
    },
  }
  const event = normalizeNotification('item/completed', params).find((e) => e.type === 'sub_agent')!
  expect(event).not.toHaveProperty('prompt')
  expect(event).not.toHaveProperty('model')
  expect(event).toMatchObject({ run: { kind: 'agent', input: 'Inspect pears\nModel: small' } })
})

it('retains the known terminal result on a late spawn input update', () => {
  const children = new CodexSubAgents(() => 'parent')
  children.note({ type: 'sub_agent', agentId: 'child-a', phase: 'started' })
  const ending = children.report('turn/completed', {
    threadId: 'child-a',
    turn: {
      id: 'turn-a',
      status: 'completed',
      items: [{ type: 'agentMessage', text: '{"pears":3}' }],
    },
  })[0]!
  expect(ending).toMatchObject({ run: { result: '{"pears":3}' } })
  const params = {
    item: {
      type: 'collabAgentToolCall',
      id: 'spawn-a',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child-a'],
      prompt: 'Inspect pears',
    },
  }
  const event = normalizeNotification('item/completed', params).find((e) => e.type === 'sub_agent')!
  expect(children.note(event, params)).toMatchObject({
    phase: 'ended',
    outcome: 'completed',
    run: { input: 'Inspect pears', result: '{"pears":3}' },
  })
})

it('releases a foreground call input at its tool result', () => {
  const { feed, background } = session()
  feed(call('Bash', { command: 'printf pear' }))
  expect(background.runFor('call-a')?.input).toBe('printf pear')
  feed(reply())
  expect(background.runFor('call-a')).toBeUndefined()
})

it('keeps a detached command input only until its ending', () => {
  const { feed, background } = session()
  feed(call('Bash', { command: 'printf pear' }))
  feed({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'work-a', task_type: 'local_bash', description: 'Print fruit' }],
  })
  const started = feed({
    type: 'system',
    subtype: 'task_started',
    task_id: 'work-a',
    tool_use_id: 'call-a',
    task_type: 'local_bash',
  })
  expect(started[0]).toMatchObject({
    running: [{ run: { kind: 'command', input: 'printf pear' } }],
  })
  feed(reply())
  expect(background.runFor('call-a')?.input).toBe('printf pear')
  feed({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'work-a',
    tool_use_id: 'call-a',
    status: 'completed',
    summary: 'Printed pears',
  })
  expect(background.runFor('call-a')).toBeUndefined()
})

it('uses command results only as updates to the opening call on both providers', () => {
  const { feed } = session()
  const opened = feed(call('Bash', { command: 'printf pear' }))[0]
  expect(opened).toMatchObject({ type: 'tool_call', id: 'call-a', run: { kind: 'command' } })
  const ended = feed(reply())[0]
  expect(ended?.type === 'tool_result' && ended.run).toEqual({ result: 'Finished' })
  expect(runtimeEventSchema.parse(ended)).toEqual(ended)
  const codex = normalizeNotification('item/completed', {
    item: {
      type: 'commandExecution',
      id: 'cmd-a',
      command: 'printf pear',
      status: 'completed',
      aggregatedOutput: 'first\n{"pears":3}',
      exitCode: 0,
    },
  })[0]
  expect(codex?.type === 'tool_result' && codex.run).toEqual({ result: '{"pears":3}' })
  expect(runtimeEventSchema.parse(codex)).toEqual(codex)
})

it('emits sparse background progress and releases metadata before a richer late ending', () => {
  const { feed, background } = session()
  feed(call('Bash', { command: 'printf pear' }))
  feed({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'work-a', task_type: 'local_bash' }],
  })
  feed({
    type: 'system',
    subtype: 'task_started',
    task_id: 'work-a',
    tool_use_id: 'call-a',
    task_type: 'local_bash',
  })
  const progress = feed({
    type: 'system',
    subtype: 'task_progress',
    task_id: 'work-a',
    summary: 'Printing pears',
  })[0]
  expect(runtimeEventSchema.parse(progress)).toMatchObject({
    progress: {
      id: 'work-a',
      toolCallId: 'call-a',
      run: { kind: 'command', progress: 'Printing pears' },
    },
  })
  expect(progress).not.toHaveProperty('running')
  expect(progress).not.toHaveProperty('ended')
  feed({
    type: 'system',
    subtype: 'task_updated',
    task_id: 'work-a',
    patch: { status: 'completed' },
  })
  expect(background.runFor('call-a')).toBeUndefined()
  const richer = feed({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'work-a',
    status: 'completed',
    summary: '{"pears":3}',
  })[0]
  expect(runtimeEventSchema.parse(richer)).toMatchObject({
    ended: { run: { result: '{"pears":3}' } },
  })
  expect(richer?.type === 'background_work' && richer.ended?.run).toEqual({ result: '{"pears":3}' })
  expect(
    feed({ type: 'system', subtype: 'task_progress', task_id: 'work-a', summary: 'Late progress' }),
  ).not.toContainEqual(expect.objectContaining({ type: 'background_work' }))
})

it.each([
  ['Agent', 'local_agent'],
  ['Workflow', 'local_workflow'],
])('keeps %s progress on its specialized event', (tool, task_type) => {
  const { feed } = session()
  feed(call(tool, { prompt: 'Inspect pears', name: 'Orchard' }))
  feed({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'work-a', task_type }],
  })
  feed({
    type: 'system',
    subtype: 'task_started',
    task_id: 'work-a',
    tool_use_id: 'call-a',
    task_type,
  })
  const events = feed({
    type: 'system',
    subtype: 'task_progress',
    task_id: 'work-a',
    summary: 'Inspecting pears',
  })
  expect(events.filter((e) => e.type === 'sub_agent' || e.type === 'workflow_run')).toHaveLength(1)
  expect(events.filter((e) => e.type === 'background_work')).toHaveLength(0)
})

it('does not replace full child input when idle precedes the terminal turn', () => {
  const children = new CodexSubAgents(() => 'parent')
  const params = {
    item: {
      type: 'collabAgentToolCall',
      id: 'spawn-a',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child-a'],
      prompt: 'Inspect every fictional pear.',
      model: 'small',
    },
  }
  const spawn = normalizeNotification('item/completed', params).find((e) => e.type === 'sub_agent')!
  const opening = children.note(spawn, params)
  expect(opening).toMatchObject({ run: { input: 'Inspect every fictional pear.\nModel: small' } })
  children.status('thread/status/changed', { threadId: 'child-a', status: { type: 'active' } })
  children.status('thread/status/changed', { threadId: 'child-a', status: { type: 'idle' } })
  const terminal = children.report('turn/completed', {
    threadId: 'child-a',
    turn: {
      id: 'turn-a',
      status: 'completed',
      items: [{ type: 'agentMessage', text: '{"pears":3}' }],
    },
  })[0]
  expect(terminal).toMatchObject({
    phase: 'ended',
    outcome: 'completed',
    run: { result: '{"pears":3}' },
  })
  expect(terminal?.type === 'sub_agent' && terminal.run).not.toHaveProperty('input')
})
