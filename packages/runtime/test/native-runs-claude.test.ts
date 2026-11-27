import { expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { runtimeEventSchema } from '../src/events'
import { normalizeMessage } from '../src/claude/normalize'
import { SubAgentTasks } from '../src/claude/sub-agent-tasks'
import { BackgroundTasks } from '../src/claude/background-tasks'
import { TodoPlan } from '../src/claude/todo-plan'
import { SessionCrons } from '../src/claude/session-crons'
import { SchedulingCalls } from '../src/claude/scheduling-calls'
import { WorkflowTasks } from '../src/claude/workflow-tasks'

const message = (value: unknown): SDKMessage => value as SDKMessage
const call = (name: string, input: unknown): SDKMessage =>
  message({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'call-a', name, input }] },
  })

it('carries a monitor last event and terminal summary on its existing background item', () => {
  const background = new BackgroundTasks()
  const feed = (value: unknown) =>
    normalizeMessage(message(value), undefined, undefined, undefined, background)
  feed({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'watch-a', task_type: 'monitor', description: 'Watch the orchard' }],
  })
  expect(
    feed({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'watch-a',
      summary: 'A pear fell\nFurther detail',
    })[0],
  ).toMatchObject({
    progress: { id: 'watch-a', run: { kind: 'monitor', progress: 'A pear fell' } },
  })
  const ended = feed({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'watch-a',
    status: 'completed',
    summary: '{"pears":3}',
  })[0]
  expect(runtimeEventSchema.parse(ended)).toMatchObject({
    ended: { run: { kind: 'monitor', result: '{"pears":3}' } },
  })
})

it('carries workflow labelled args, progress and terminal result through its existing identity', () => {
  const runs = new WorkflowTasks()
  const background = new BackgroundTasks()
  const feed = (value: SDKMessage) =>
    normalizeMessage(value, undefined, undefined, runs, background)
  feed(
    call('Workflow', {
      description: 'Inspect fruit',
      scriptPath: '/fictional/orchard.ts',
      args: { fruit: 'pear', count: 3 },
    }),
  )
  const started = feed(
    message({
      type: 'system',
      subtype: 'task_started',
      task_id: 'flow-a',
      tool_use_id: 'call-a',
      task_type: 'local_workflow',
      workflow_name: 'Orchard',
    }),
  )
  expect(started.find((e) => e.type === 'workflow_run')).toMatchObject({
    run: { kind: 'workflow', input: expect.stringContaining('{"fruit":"pear","count":3}') },
  })
  const progress = feed(
    message({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'flow-a',
      summary: 'Inspecting pears',
    }),
  )
  expect(progress.find((e) => e.type === 'workflow_run')).toMatchObject({
    run: { kind: 'workflow', progress: 'Inspecting pears' },
  })
  const ended = feed(
    message({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'flow-a',
      status: 'completed',
      summary: '{"fruit":"pear"}',
    }),
  )
  expect(runtimeEventSchema.parse(ended.find((e) => e.type === 'workflow_run'))).toMatchObject({
    run: { kind: 'workflow', result: '{"fruit":"pear"}' },
  })
})

it('keeps the full agent prompt, role and model on its existing card', () => {
  const tasks = new SubAgentTasks()
  const background = new BackgroundTasks()
  const prompt = 'Inspect the fictional orchard.\n' + 'Keep each detail. '.repeat(30)
  normalizeMessage(
    call('Agent', {
      prompt,
      description: 'Inspect orchard',
      subagent_type: 'Explore',
      model: 'small',
    }),
    tasks,
    undefined,
    undefined,
    background,
  )
  const events = normalizeMessage(
    message({
      type: 'system',
      subtype: 'task_started',
      task_id: 'agent-a',
      tool_use_id: 'call-a',
      task_type: 'local_agent',
      subagent_type: 'Explore',
      description: 'Inspect orchard',
    }),
    tasks,
    undefined,
    undefined,
    background,
  )
  const event = events.find((e) => e.type === 'sub_agent')
  expect(event).toMatchObject({ run: { kind: 'agent', input: expect.stringContaining(prompt) } })
  expect(JSON.stringify(event)).toContain('small')
  expect(runtimeEventSchema.parse(event)).toMatchObject({ run: { kind: 'agent' } })
})

it.each([
  ['in the same session', false],
  ['after a reopen that first sees the resume', true],
])('drops the notification prompt of a resumed sub-agent %s', (_, reopen) => {
  let tasks = new SubAgentTasks()
  let background = new BackgroundTasks()
  const feed = (value: unknown) => {
    const events = normalizeMessage(message(value), tasks, undefined, undefined, background)
    return events.find((e) => e.type === 'sub_agent')
  }
  const started = {
    type: 'system',
    subtype: 'task_started',
    task_id: 'agent-a',
    tool_use_id: 'call-a',
    task_type: 'local_agent',
    description: 'Wait for the kettle',
  }
  expect(feed({ ...started, prompt: 'Boil the fictional kettle, then report' })).toMatchObject({
    run: { kind: 'agent', input: 'Boil the fictional kettle, then report' },
  })
  feed({ type: 'system', subtype: 'task_notification', task_id: 'agent-a', status: 'completed' })
  if (reopen) {
    tasks = new SubAgentTasks()
    background = new BackgroundTasks()
  }
  const resumed = feed({
    ...started,
    prompt:
      '<task-notification>\n<task-id>kettle-1</task-id>\n<tool-use-id>call-b</tool-use-id>\n' +
      '<status>completed</status>\n<summary>The kettle boiled</summary>\n</task-notification>',
  })
  expect(resumed).toMatchObject({ phase: 'started', title: 'Wait for the kettle' })
  expect((resumed as { run?: unknown }).run).toEqual({ kind: 'agent' })
})

const example =
  '<task-notification>\n<task-id>kettle-1</task-id>\n<status>completed</status>\n' +
  '</task-notification>'

it.each([
  ['the tag alone', '<task-notification> is the XML tag. Explain its fields.'],
  ['a whole example block', `${example}\nExplain the example above.`],
  ['two example blocks', `${example}\nCompare the first example with the second:\n${example}`],
])('keeps a genuine sub-agent prompt that begins with %s', (_, prompt) => {
  const events = normalizeMessage(
    message({
      type: 'system',
      subtype: 'task_started',
      task_id: 'agent-b',
      task_type: 'local_agent',
      description: 'Explain the tag',
      prompt,
    }),
    new SubAgentTasks(),
    undefined,
    undefined,
    new BackgroundTasks(),
  )
  expect(events.find((e) => e.type === 'sub_agent')).toMatchObject({
    run: { kind: 'agent', input: prompt },
  })
})

it('carries the full command and its ending without changing the returned format', () => {
  const background = new BackgroundTasks()
  const normalize = (m: SDKMessage) =>
    normalizeMessage(m, undefined, undefined, undefined, background)
  const command = 'printf \'{"fruit":"pear"}\\n\''
  expect(normalize(call('Bash', { command }))[0]).toMatchObject({
    run: { kind: 'command', input: command },
  })
  const ended = normalize(
    message({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'call-a', content: '{"fruit":"pear"}' }],
      },
    }),
  )
  expect(ended[0]).toMatchObject({ run: { result: '{"fruit":"pear"}' } })
})

it.each([
  ['local_bash', 'command'],
  ['local_agent', 'agent'],
  ['local_workflow', 'workflow'],
  ['monitor', 'monitor'],
])('maps %s background facts to %s', (native, kind) => {
  const events = normalizeMessage(
    message({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'work-a', task_type: native, description: 'Watch the orchard' }],
    }),
  )
  expect(events[0]).toMatchObject({ running: [{ run: { kind, input: 'Watch the orchard' } }] })
})

it('leaves an unknown native background kind unclassified', () => {
  const events = normalizeMessage(
    message({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'work-a', task_type: 'future-kind' }],
    }),
  )
  expect(events[0]).toMatchObject({ running: [{ id: 'work-a' }] })
  expect(JSON.stringify(events[0])).not.toContain('"run"')
})

it('keeps workflow input and live roster facts on the existing workflow event', () => {
  const events = normalizeMessage(
    message({
      type: 'system',
      subtype: 'task_started',
      task_id: 'flow-a',
      task_type: 'local_workflow',
      workflow_name: 'Orchard',
      description: 'Inspect fruit',
      prompt: 'Run every orchard phase',
    }),
  )
  expect(events.find((e) => e.type === 'workflow_run')).toMatchObject({
    run: { kind: 'workflow', input: expect.stringContaining('Inspect fruit') },
  })
})

it('gives the existing checklist its input and current progress', () => {
  const events = new TodoPlan().observe(
    call('TodoWrite', { todos: [{ content: 'Inspect pears', status: 'in_progress' }] }),
  )
  expect(events[0]).toMatchObject({
    run: { kind: 'checklist', input: 'Inspect pears', progress: 'Inspect pears' },
  })
})

it('carries the job prompt on both the level and the create receipt', () => {
  const prompt = 'Inspect every fictional pear.\nKeep the full prompt.'
  const level = new SessionCrons().observe(
    [{ id: 'job-a', schedule: '*/5 * * * *', prompt }],
    'Stop',
  )
  expect(level).toMatchObject({
    jobs: [{ run: { kind: 'job', input: expect.stringContaining(prompt) } }],
  })
  const receipt = new SchedulingCalls().answered({
    tool_name: 'CronCreate',
    tool_use_id: 'call-a',
    tool_input: { cron: '*/5 * * * *', prompt },
    tool_response: { id: 'job-a', recurring: true },
  })
  expect(receipt).toMatchObject({
    receipt: { input: { prompt }, run: { kind: 'job', input: expect.stringContaining(prompt) } },
  })
  expect(runtimeEventSchema.parse(receipt)).toMatchObject({
    receipt: { input: { prompt }, run: { kind: 'job' } },
  })
})
