import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { claudeResultOutcome } from '../src/claude/normalize'
import { codexTurnOutcome } from '../src/codex/normalize'
import { runtimeEventSchema, type RuntimeEvent } from '../src/events'
import { SessionMachine } from '../src/internal/session-machine'

describe('native terminal diagnostics through the core', () => {
  const cases = [
    {
      name: 'Claude result errors',
      ending: claudeResultOutcome({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['first native error', 'second native error'],
      } as unknown as SDKMessage),
      message: 'turn failed: first native error\nsecond native error',
    },
    {
      name: 'Codex terminal explanation',
      ending: codexTurnOutcome({
        turn: {
          status: 'failed',
          error: {
            message: 'native error',
            misalignment: { detailedExplanation: 'native detail' },
          },
        },
      }),
      message: 'turn failed: native error — native detail',
    },
  ]

  it.each(cases)(
    '$name reaches one provider terminal, preserving command metadata',
    ({ ending, message }) => {
      expect(ending).not.toBeNull()
      const events: RuntimeEvent[] = []
      const machine = new SessionMachine((event) => events.push(runtimeEventSchema.parse(event)))
      machine.markStarting()
      machine.sessionStarted(
        { provider: 'claude', sessionId: 'fixture', cwd: '/tmp/fixture', rotation: 0 },
        'started',
      )
      const turn = machine.beginTurn()!
      machine.noteWhatTheStopEnded(turn, ['command-one'])
      const before = events.length
      machine.completeTurn(ending!.outcome, ending!.message)
      expect(events.slice(before)).toEqual([
        { type: 'error', message, fatal: false },
        { type: 'turn', state: 'failed', endedCommands: ['command-one'] },
        { type: 'status', state: 'idle' },
      ])
      const after = events.length
      machine.completeTurn(ending!.outcome, ending!.message)
      expect(events).toHaveLength(after)
    },
  )

  it('keeps an app failure attributed to the app', () => {
    const events: RuntimeEvent[] = []
    const machine = new SessionMachine((event) => events.push(event))
    machine.markStarting()
    machine.sessionStarted(
      { provider: 'codex', sessionId: 'fixture', cwd: '/tmp/fixture', rotation: 0 },
      'started',
    )
    machine.beginTurn()
    machine.failTurn('launch was refused')
    expect(events.filter((event) => event.type === 'turn')).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app' },
    ])
  })
})
