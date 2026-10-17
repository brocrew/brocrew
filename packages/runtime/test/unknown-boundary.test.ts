import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { normalizeNotification } from '../src/codex/normalize'

/**
 * The unknown-event boundary must never let a RAW provider payload masquerade as
 * a real runtime event (007 P2-8). A provider message that happens to be shaped
 * exactly like one of our discriminants (e.g. `{type:'status',state:'ended'}`)
 * must degrade to `unknown{raw}` via the adapter fallback — NOT be returned as a
 * lifecycle event that could mutate UI state without adapter intent.
 *
 * Each fixture below is a VALID instance of its variant, so the pre-fix boundary
 * (`toRuntimeEvent`, which re-parses the raw payload against the union) returns
 * it as the REAL event — these assertions therefore FAIL on the pre-fix code.
 */

const ref = { provider: 'claude' as const, sessionId: 's1', cwd: '/tmp/x', rotation: 0 }
const scope = {
  cwd: '/tmp/x',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: [],
  underDisclosed: false,
}

/** One valid instance of every non-`unknown` discriminant (would parse as a real event). */
const collisionFixtures: Record<string, unknown> = {
  session: { type: 'session', state: 'ended', ref },
  turn: { type: 'turn', state: 'interrupted' },
  assistant_delta: { type: 'assistant_delta', text: 'x' },
  assistant_message: { type: 'assistant_message', text: 'x' },
  tool_call: { type: 'tool_call', id: 'c1', name: 'Bash', summary: 's' },
  tool_result: { type: 'tool_result', id: 'c1', summary: 's', ok: true },
  permission_request: {
    type: 'permission_request',
    id: 'p1',
    kind: 'command',
    action: 'Bash',
    detail: 'x',
    scope,
  },
  user_input_request: {
    type: 'user_input_request',
    id: 'u1',
    prompt: 'q',
    questions: [{ id: 'q0', prompt: 'q', options: [] }],
  },
  status: { type: 'status', state: 'ended' },
  error: { type: 'error', message: 'boom', fatal: false },
}

describe('unknown boundary — a raw provider payload never masquerades as a real event (007 P2-8)', () => {
  it('Claude: a provider message shaped like ANY discriminant degrades to unknown{raw}', () => {
    for (const [type, fixture] of Object.entries(collisionFixtures)) {
      // The message.type is one of our discriminants (never an SDK message type),
      // so it hits the unmapped fallback.
      const out = normalizeMessage(fixture as unknown as SDKMessage)
      expect(out).toHaveLength(1)
      expect(out[0]?.type, `${type}-shaped payload must not surface as a real ${type} event`).toBe(
        'unknown',
      )
      if (out[0]?.type === 'unknown') {
        expect(out[0].provider).toBe('claude')
        expect(out[0].raw).toEqual(fixture)
      }
    }
  })

  it('Codex: an unmapped notification degrades to unknown even when its params are shaped like a discriminant', () => {
    // Codex wraps the synthetic `{method, params}` (no top-level `type`), so it is
    // structurally immune; assert it here so a future fallback change can't regress.
    for (const [type, fixture] of Object.entries(collisionFixtures)) {
      const out = normalizeNotification('some/unmapped/method', fixture)
      expect(out).toHaveLength(1)
      expect(out[0]?.type, `codex ${type}-shaped params must stay unknown`).toBe('unknown')
    }
  })
})
