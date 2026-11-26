import { expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import { BackgroundTasks } from '../../../packages/runtime/src/claude/background-tasks'
import { FileEdits } from '@brobot2/runtime/claude'
import { importClaudeTranscript } from '../src/main/providers/claude/import-transcript'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'

function call(id: string, name: string, input: unknown): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  })
}

function result(id: string, content: unknown, is_error = false): string {
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] },
  })
}

function live(frames: string[]) {
  const background = new BackgroundTasks()
  const edits = new FileEdits()
  return frames.flatMap((frame) =>
    normalizeMessage(JSON.parse(frame) as SDKMessage, undefined, edits, undefined, background),
  )
}

function imported(frames: string[], chunked: boolean) {
  let carry: object | undefined
  return (chunked ? frames.map((frame) => [frame]) : [frames]).flatMap((chunk) => {
    const parsed = importClaudeTranscript(chunk, 1000, carry)
    carry = parsed.edits
    return parsed.entries.map((entry) => entry.event)
  })
}

it.each([
  { content: 'Listing\n{"pears":3}', failed: false, ending: '{"pears":3}' },
  {
    content: [
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Last' },
    ],
    failed: false,
    ending: 'Last',
  },
  { content: '', failed: false, ending: 'Completed' },
  { content: [], failed: true, ending: 'Failed' },
  { content: 'Permission denied', failed: true, ending: 'Permission denied' },
])(
  'preserves command input and result in whole and chunked imports: $ending',
  ({ content, failed, ending }) => {
    const command = 'printf fictional\n' + 'echo orchard\n'.repeat(30)
    const frames = [
      call('orchard', 'Bash', { command, cwd: '/fictional/grove' }),
      result('orchard', content, failed),
    ]
    const events = live(frames)
    expect(events[0]).toMatchObject({
      run: { kind: 'command', input: command + '\nDirectory: /fictional/grove' },
    })
    expect(events[1]).toMatchObject({ run: { result: ending }, ok: !failed })
    for (const chunked of [false, true]) expect(imported(frames, chunked)).toEqual(events)
    expect(NORMALIZER_VERSION).toBeGreaterThanOrEqual(6)
  },
)

it('keeps file-edit carry alongside interleaved commands and releases completed command identities', () => {
  const frames = [
    call('shell', 'Bash', { command: 'pwd' }),
    call('edit', 'Edit', {
      file_path: '/fictional/pear.ts',
      old_string: 'green',
      new_string: 'ripe',
    }),
    result('edit', 'Saved'),
    result('shell', '/fictional'),
    result('shell', 'Repeated receipt'),
    result('unseen', 'No recorded call'),
  ]
  const events = live(frames)
  expect(events.find((event) => event.type === 'file_change')).toMatchObject({
    changes: [{ path: '/fictional/pear.ts', status: 'modified' }],
  })
  expect(events.filter((event) => event.type === 'tool_result').map((event) => event.run)).toEqual([
    undefined,
    { result: '/fictional' },
    undefined,
    undefined,
  ])
  for (const chunked of [false, true]) expect(imported(frames, chunked)).toEqual(events)
})

it('leaves unrecorded command facts and specialized agent/workflow identities absent from tool rows', () => {
  const frames = [
    result('unknown', '{"fruit":"pear"}'),
    call('agent', 'Agent', { prompt: 'Inspect pears', subagent_type: 'Explore' }),
    result('agent', 'Checked'),
    call('flow', 'Workflow', { scriptPath: '/fictional/pears.ts', args: { fruit: 'pear' } }),
    result('flow', '{"count":3}'),
  ]
  const events = live(frames)
  expect(events.every((event) => !('run' in event))).toBe(true)
  for (const chunked of [false, true]) expect(imported(frames, chunked)).toEqual(events)
})

it.each([false, true])(
  'does not end a background request on its successful detach receipt (failed: %s)',
  (failed) => {
    const frames = [
      call('background-shell', 'Bash', { command: 'sleep 30', run_in_background: true }),
      result(
        'background-shell',
        failed ? 'Permission denied' : 'Command running in background with ID: orchard-job',
        failed,
      ),
    ]
    const events = live(frames)
    expect(events[0]).toMatchObject({ run: { kind: 'command', input: 'sleep 30' } })
    expect(events[1]).toMatchObject({ ok: !failed })
    if (failed) expect(events[1]).toMatchObject({ run: { result: 'Permission denied' } })
    else expect(events[1]).not.toHaveProperty('run')
    for (const chunked of [false, true]) expect(imported(frames, chunked)).toEqual(events)
  },
)
