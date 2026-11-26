import { expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'
import { readTerminalPage, endingsBetween } from '../src/codex/background-terminals'
import { CodexSubAgents } from '../src/codex/sub-agents'
import { runtimeEventSchema } from '../src/events'

it('keeps an ended child ended when its spawn receipt arrives late', () => {
  const children = new CodexSubAgents(() => 'parent')
  children.note({ type: 'sub_agent', agentId: 'child-a', phase: 'ended', outcome: 'completed' })
  const params = {
    item: {
      type: 'collabAgentToolCall',
      id: 'spawn-a',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child-a'],
      prompt: 'Inspect every pear',
    },
  }
  const prompt = normalizeNotification('item/completed', params).find(
    (e) => e.type === 'sub_agent',
  )!
  expect(children.note(prompt, params)).toMatchObject({
    phase: 'ended',
    outcome: 'completed',
    run: { kind: 'agent', input: 'Inspect every pear' },
  })
})

it.each([true, false])(
  'keeps prompt, type and model across child event ordering (%s)',
  (promptFirst) => {
    const children = new CodexSubAgents(() => 'parent')
    const spawn = {
      item: {
        type: 'collabAgentToolCall',
        id: 'spawn-a',
        tool: 'spawnAgent',
        status: 'completed',
        receiverThreadIds: ['child-a'],
        prompt: 'Inspect every pear',
        model: 'small',
      },
    }
    const birth = {
      item: {
        type: 'subAgentActivity',
        id: 'spawn-a',
        kind: 'started',
        agentThreadId: 'child-a',
        agentPath: '/root/orchard',
        model: 'small',
      },
    }
    const ordered = promptFirst ? [spawn, birth] : [birth, spawn]
    const events = ordered.flatMap((params) =>
      normalizeNotification(params === spawn ? 'item/completed' : 'item/started', params).map(
        (event) => children.note(event, params),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      run: { kind: 'agent', input: 'Inspect every pear\nType: orchard\nModel: small' },
    })
  },
)

it('carries a command and cwd while it runs and its output when it ends', () => {
  const item = {
    type: 'commandExecution',
    id: 'cmd-a',
    command: 'printf pear',
    cwd: '/fictional/orchard',
    status: 'inProgress',
    processId: '12',
  }
  const started = normalizeNotification('item/started', { item })
  expect(started[0]).toMatchObject({
    run: { kind: 'command', input: 'printf pear\nDirectory: /fictional/orchard' },
  })
  const ended = normalizeNotification('item/completed', {
    item: {
      ...item,
      status: 'completed',
      aggregatedOutput: 'first\n{"fruit":"pear"}',
      exitCode: 0,
    },
  })
  expect(ended[0]).toMatchObject({ run: { result: '{"fruit":"pear"}' } })
  expect(runtimeEventSchema.parse(started[0])).toMatchObject({ run: { kind: 'command' } })
})

it('retains the full background terminal command and cwd', () => {
  const command = 'printf pear '.repeat(40)
  const page = readTerminalPage({
    data: [{ processId: '12', itemId: 'cmd-a', command, cwd: '/fictional/orchard' }],
  })
  expect(page.rows[0]).toMatchObject({
    run: { kind: 'command', input: command + '\nDirectory: /fictional/orchard' },
  })
})

it('carries a collab spawn prompt onto the child identity', () => {
  const prompt = 'Inspect the fictional orchard.\n' + 'Keep each detail. '.repeat(30)
  const events = normalizeNotification('item/completed', {
    item: {
      type: 'collabAgentToolCall',
      id: 'spawn-a',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child-a'],
      prompt,
      model: 'small',
    },
  })
  expect(events.find((e) => e.type === 'sub_agent')).toMatchObject({
    agentId: 'child-a',
    run: { kind: 'agent', input: expect.stringContaining(prompt) },
  })
})

it('reports child progress and its supplied terminal answer', () => {
  const children = new CodexSubAgents(() => 'parent')
  for (const event of normalizeNotification('item/started', {
    item: {
      type: 'subAgentActivity',
      id: 'spawn-a',
      kind: 'started',
      agentThreadId: 'child-a',
      agentPath: '/root/orchard',
    },
  }))
    children.note(event)
  expect(
    children.status('thread/status/changed', {
      threadId: 'child-a',
      status: { type: 'active' },
    })[0],
  ).toMatchObject({ run: { kind: 'agent', progress: 'Running' } })
  const events = children.report('turn/completed', {
    threadId: 'child-a',
    turn: {
      id: 'turn-a',
      status: 'completed',
      items: [{ type: 'agentMessage', text: '{"fruit":"pear"}' }],
    },
  })
  expect(events[0]).toMatchObject({ run: { kind: 'agent', result: '{"fruit":"pear"}' } })
})

it('maps checklist input, progress, note and completion', () => {
  const events = normalizeNotification('turn/plan/updated', {
    plan: [{ step: 'Inspect pears', status: 'inProgress' }],
    explanation: 'Start in the orchard',
  })
  expect(events[0]).toMatchObject({
    run: {
      kind: 'checklist',
      input: expect.stringContaining('Inspect pears'),
      progress: 'Inspect pears',
    },
  })
  const ended = normalizeNotification('turn/plan/updated', {
    plan: [{ step: 'Inspect pears', status: 'completed' }],
    explanation: 'All fruit checked',
  })
  expect(ended[0]).toMatchObject({ run: { kind: 'checklist', result: 'All fruit checked' } })
})

it.each(['job', 'monitor', 'workflow'])('does not invent unsupported %s facts', (kind) => {
  const events = normalizeNotification('item/started', {
    item: { type: kind, id: 'future-a', prompt: 'Unknown native item' },
  })
  expect(events.every((e) => e.type === 'unknown')).toBe(true)
  expect(JSON.stringify(events)).not.toContain('"run"')
})

it('carries a known background ending without inventing an unknown outcome', () => {
  const page = readTerminalPage({
    data: [{ processId: '12', itemId: 'cmd-a', command: 'printf pear', cwd: '/fictional/orchard' }],
  })
  expect(endingsBetween(page.rows, [], new Set(['12']))[0]).toMatchObject({
    id: '12',
    toolCallId: 'cmd-a',
    outcome: 'stopped',
    run: {
      kind: 'command',
      input: 'printf pear\nDirectory: /fictional/orchard',
      result: 'Stopped',
    },
  })
  expect(endingsBetween(page.rows, [], new Set())[0]?.run).not.toHaveProperty('result')
})
