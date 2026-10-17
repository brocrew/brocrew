import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { HAND_IT_BACK } from '../../src/renderer/src/lib/handing-it-back'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **523 · Q1's second half: the reversible act asks ONCE.**
 *
 * ⛔ **In the DOM project because the claim is about presses.** An SSR assertion can see the markup
 * of a button and nothing at all about what one click does — and what this dispatch decided is a
 * property of clicks: *hand it back* reaches the host on the first press. ⚑ **D-017b** — the act that
 * ENDED a conversation, and the door `520` put in front of it, left this bar (a conversation is never
 * ended), so the contrast this file once measured on one mount has no second half to measure.
 *
 * ⚑ **`spawn-safety.ts` is the app's only confirmation idiom and it is the model for the contrast.**
 * There, the direction that WIDENS what agents may do asks twice and the kill direction asks once —
 * *"a kill switch you have to confirm is one you confirm after the thing you were trying to stop."*
 * ⚠️ `523` applies the same reasoning to a different axis: **the irreversible direction is the one
 * that asks.** Handing a conversation back is undone by taking it over again; ending it is undone by
 * nothing. ⛔ A confirmation in front of this press would teach a person the two acts weigh the same,
 * which is `519` F2's defect rebuilt in a dialog.
 */

const liveness = {
  state: 'live' as const,
  since: 1_700_000_000_000,
  signInSuperseded: false,
}

const CLAIMED: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
  profileId: 'default',
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: null,
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  queued: [],
  liveness,
  hasACommander: true,
  startedWithoutAWindow: true,
  mayHandItBack: true,
}

function bar(over: Record<string, unknown> = {}): {
  m: ReturnType<typeof mount>
  handBacks: number[]
} {
  const handBacks: number[] = []
  const m = mount(SessionHeader, {
    session: CLAIMED,
    status: 'idle',
    debug: false,
    facets: { doing: 'idle' as const, being: 'live' as const },
    onHandBack: () => handBacks.push(1),
    ...over,
  })
  return { m, handBacks }
}

afterEach(() => unmountAll())

describe('523 · the press that hands a conversation back', () => {
  it('🔴 one press reaches the host, with nothing armed in front of it', async () => {
    const { m, handBacks } = bar()
    expect(m.q('hand-it-back').textContent).toContain(HAND_IT_BACK)

    m.q('hand-it-back').click()
    await nextTick()
    // ⛔ **The first press is the whole gesture.** `spawn-safety.ts`'s arming shape asserts the
    // opposite of this line — `expect(spawning).toEqual([])` after press one — and the contrast is
    // the decision: a reversible act does not get a door.
    expect(handBacks, 'the press did not reach the host').toHaveLength(1)

    // ⚠️ **And the control does not become a second question.** An armed control rewrites itself
    // (*"Turn spawning back on?"*); this one still says what it said.
    expect(m.q('hand-it-back').textContent).toContain(HAND_IT_BACK)
  })

  it('⚑ a conversation this window STARTED has no such press to make', () => {
    const { m } = bar({
      session: { ...CLAIMED, startedWithoutAWindow: false, mayHandItBack: false },
    })
    expect(m.all('hand-it-back')).toHaveLength(0)
    // Paired on the same mount: the bar is drawn, and the drawer toggle beside it is still there.
    expect(m.all('toggle-session-panel')).toHaveLength(1)
  })
})
