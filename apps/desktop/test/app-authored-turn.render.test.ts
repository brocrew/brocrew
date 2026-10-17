import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import {
  GO_AHEAD_AUTHORSHIP,
  GO_AHEAD_LABEL,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_NOTE,
  GO_AHEAD_SENDER,
} from '../src/renderer/src/lib/plan-mode'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { CreatedSession, SessionLiveness } from '../src/shared/runtime-ipc'

/**
 * # 🔴 What a reader meets after pressing the go-ahead (278 §1, from 276)
 *
 * Pressing “Start work on this plan” creates `Go ahead with this plan.` as a `user_turn`. It
 * must carry app authorship rather than the person’s avatar and name.
 *
 * ⛔ **The message itself is not the defect and may not be removed**: `276` measured the mode switch
 * alone starting **0/2** turns and producing **0/2** files against the real bundled Codex
 * `0.146.0` app-server, against **2/2** for the switch plus the sentence. What was wrong is who the
 * transcript said wrote it, and that is what these render assertions are about.
 *
 * ⚠️ **The wire and the fold are `app-authored-turn.test.ts`** — the node half of the same
 * dispatch. This file is the SFC half, and it lives under `.render.test.ts` because that is the
 * suffix `tsconfig.web.json` typechecks with `vue-tsc`; a plain `.test.ts` importing an SFC is
 * checked by the node project, which has no Vue shims.
 */

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

const meta = (over: Partial<CreatedSession> = {}): CreatedSession => ({
  sessionId: 'sess_1',
  provider: 'codex',
  cwd: '/work',
  providerHome: '/homes/codex',
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
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/codex',
    homeEnv: 'CODEX_HOME',
    model: 'files',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness,
  hasACommander: false,
  // 523 · a conversation a window started: it is not handed back, it is ended.
  startedWithoutAWindow: false,
  mayHandItBack: false,
  ...over,
})

/** The pane, holding one conversation whose transcript has already been folded. */
function pane(fold: (state: ReturnType<typeof createTranscript>) => void) {
  const record = createSessionRecord('sess_1')
  record.meta = meta()
  record.phase = 'open'
  fold(record.transcript)
  return {
    record,
    mode: 'normal' as const,
    debug: false,
    drawerOpen: false,
    drawerTab: 'open' as const,
    draft: '',
  }
}

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ConversationPane as never, props) }))

describe('what a reader meets afterwards (278 §1)', () => {
  it('🔴 the entry is attributed to BroBot and is NOT the user bubble', async () => {
    const html = await render(
      pane((state) => {
        applyEvent(state, { type: 'user_turn', text: 'plan a thing' }, 1_000)
        applyEvent(
          state,
          { type: 'user_turn', text: GO_AHEAD_MESSAGE, attribution: 'app_authored' },
          2_000,
        )
      }),
    )
    // Positive: the row is drawn, it names BroBot, and it quotes the sentence that was sent.
    expect(html).toContain('data-cy="continuation"')
    expect(html).toContain('data-cy="continuation-sender"')
    expect(html).toContain(GO_AHEAD_SENDER)
    expect(html).toContain(GO_AHEAD_MESSAGE)
    // …and it explains itself durably, in the transcript, rather than in a tooltip nobody opens.
    expect(html).toContain('data-cy="continuation-why"')
    expect(html).toContain(GO_AHEAD_AUTHORSHIP)

    // Draw “You” for the turn the person actually typed on the same page, and omit it for the
    // app-authored turn. That positive makes the absence meaningful.
    const bubbles = html.match(/data-cy="user-message"/g) ?? []
    expect(bubbles, 'exactly one bubble: the prompt, not the go-ahead').toHaveLength(1)
    expect(html).toContain('plan a thing')
  })

  it('⚠️ the go-ahead is not shown twice, as itself and as a bubble', async () => {
    const html = await render(
      pane((state) => {
        applyEvent(
          state,
          { type: 'user_turn', text: GO_AHEAD_MESSAGE, attribution: 'app_authored' },
          2_000,
        )
      }),
    )
    expect(html).toContain('data-cy="continuation-message"')
    expect(html).not.toContain('data-cy="user-message"')
  })

  it('the sentence promised before the click is the sentence shown after it', () => {
    // One value, three readers: the bar's disclosure, the string handed to the host, and the
    // transcript entry. They cannot drift because there is nothing to drift from.
    expect(GO_AHEAD_NOTE).toContain(GO_AHEAD_MESSAGE)
    expect(GO_AHEAD_AUTHORSHIP).toContain(GO_AHEAD_LABEL)
  })

  it('⛔ the explanation never says the message was optional', () => {
    // The one thing this copy must not do. 276 measured the switch alone at 0/2 turns and 0/2 work,
    // so an apology for "a message BroBot added" would be describing a build that does not run.
    expect(GO_AHEAD_AUTHORSHIP).toMatch(/starts no turn/i)
    expect(GO_AHEAD_AUTHORSHIP).not.toMatch(/only|merely|just a|no effect|does nothing/i)
    // State plainly that the person did not write the app-authored turn.
    expect(GO_AHEAD_AUTHORSHIP).toMatch(/you did not write it/i)
  })
})

/**
 * ⚠️ **Claude does not take this road, and 276 is where that was measured** (278 §3).
 *
 * ⛔ **It is asserted HERE as the renderer contract and NOWHERE as a provider claim, deliberately.**
 * The provider half is `packages/runtime/test/claude-runtime.test.ts` — *"the client-side switch OFF
 * is still refused"* — which drives the real adapter against a fake SDK query and pins both facts:
 * `setPlanMode(false)` rejects with *"cannot stop planning from here"*, and `planNeedsGoAhead` is
 * `false`. ⚑ **Restating that through `FakeRuntime` would prove nothing**: the double models plan
 * mode generically, reports `planNeedsGoAhead === true` for a session launched planning whatever
 * provider it was constructed with, and is right to — it stands in for an adapter, not for Claude.
 *
 * What this file owns is the consequence: BroBot draws the gesture from `planNeedsGoAhead` and from
 * nothing else, so on the provider that answers `false` there is no button, no `endPlanMode`, and
 * therefore no app-authored turn to attribute.
 */
describe('⚠️ Claude is untouched by all of it (278 §3)', () => {
  it('no go-ahead where the provider answers false — and one where it answers true', async () => {
    const withPlan = (planNeedsGoAhead: boolean) => {
      const props = pane((state) => {
        applyEvent(state, { type: 'user_turn', text: 'plan a thing' }, 1_000)
      })
      props.record.meta = meta({ planNeedsGoAhead })
      return props
    }
    // The negative, and the positive that stops it passing over an empty render: the SAME fixture,
    // the same conversation, one field apart.
    const absent = await render(withPlan(false))
    const present = await render(withPlan(true))
    expect(present).toContain('data-cy="plan-go-ahead-button"')
    expect(absent).not.toContain('data-cy="plan-go-ahead-button"')
    // …and both really rendered a conversation, so neither result is a fact about an empty string.
    for (const html of [absent, present]) expect(html).toContain('data-cy="user-message"')
  })

  it('the message the button carries is the one this app owns, not a provider affordance', () => {
    // No provider asks this question and none supplies this sentence: BroBot composed it, which is
    // exactly why the transcript now signs it. The renderer holds the string and hands it to the
    // host, so there is no second copy anywhere to disagree with this one.
    expect(GO_AHEAD_MESSAGE).toBe('Go ahead with this plan.')
    expect(GO_AHEAD_AUTHORSHIP).toContain(GO_AHEAD_SENDER)
  })
})
