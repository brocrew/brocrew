import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import {
  GO_AHEAD_AUTHORSHIP,
  GO_AHEAD_LABEL,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_NOTE,
  LEAVE_PLAN_LABEL,
  LEAVE_PLAN_TITLE,
  LEAVE_PLAN_UNAVAILABLE,
} from '../src/renderer/src/lib/plan-mode'
import { acceptLiveness, createSessionRecord } from '../src/renderer/src/lib/session-record'
import type { CreatedSession, SessionLiveness } from '../src/shared/runtime-ipc'

/**
 * The go-ahead, as a user meets it (060).
 *
 * 057 wired Codex plan mode, proved the server implements it, and then found the half that was
 * missing — nothing sent the message that ends plan mode, so a planning conversation proposed and
 * re-proposed and never got to work. It disclosed that in the launcher rather than faking an
 * ending. 060 measured what the ending actually is (switching the turn's `collaborationMode` to
 * `default`) and built the gesture that sends it.
 *
 * ⚠️ **The affordance is OURS, and three rules govern it.** No provider raises this question, so
 * every one of these is a rule about our own copy and our own placement rather than about a
 * provider's behaviour:
 *
 *  1. It appears only where a go-ahead would do something — never as decoration on a conversation
 *     whose plan mode ends some other way.
 *  2. It sends a real message, and it says which one BEFORE it is pressed.
 *  3. It never implies plan mode was a safety gate. A planning agent already runs shell commands
 *     (057 measured one; 026 measured Claude writing a file), so "the agent can now act" would be
 *     false in the most dangerous direction available.
 */

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

const meta = (over: Partial<CreatedSession> = {}): CreatedSession => ({
  sessionId: 'sess_1',
  provider: 'codex',
  cwd: '/work',
  providerHome: '/homes/codex',
  profileId: 'default',
  // 158: told nothing extra — the shape every fixture that is not about instructions wants.
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
  planNeedsGoAhead: true,
  // Nothing waiting to be sent (077) — these fixtures describe sessions at rest.
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

function pane(
  over: Partial<CreatedSession> = {},
  status: 'idle' | 'working' = 'idle',
  busy = false,
) {
  const record = createSessionRecord('sess_1')
  record.meta = meta(over)
  record.phase = 'open'
  record.transcript.status = status
  record.busy = busy
  return {
    record,
    mode: 'chat' as const,
    debug: false,
    drawerOpen: false,
    drawerTab: 'open' as const,
    draft: '',
  }
}

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ConversationPane as never, props) }))

describe('the go-ahead bar (060)', () => {
  it('offers it while the conversation is planning, and says what pressing it sends', async () => {
    const html = await render(pane())
    expect(html).toContain('data-cy="plan-go-ahead"')
    expect(html).toContain(GO_AHEAD_LABEL)
    // Rule 2: the message is disclosed before it is sent, and the disclosure quotes the string that
    // will actually travel — one value, so the two cannot drift apart.
    expect(GO_AHEAD_NOTE).toContain(GO_AHEAD_MESSAGE)
    expect(html).toContain(GO_AHEAD_MESSAGE)
  })

  it('shows NOTHING when no go-ahead would do anything', async () => {
    // Rule 1, and the case that makes it matter: `planNeedsGoAhead` is false for a session that
    // never planned, for one already released, AND for a provider whose plan mode ends through its
    // own approval card. A bar drawn from "is this in plan mode" would appear beside Claude's card
    // and offer a second, rival way out of one state.
    const html = await render(pane({ planNeedsGoAhead: false }))
    expect(html).not.toContain('data-cy="plan-go-ahead"')
    expect(html).not.toContain(GO_AHEAD_LABEL)
  })

  it('is disabled while a turn is running, because pressing it SENDS', async () => {
    // Not cosmetic: the host refuses a go-ahead while a turn runs, before anything moves ("cannot
    // start work on the plan: this conversation is still working") — 678 corrected this from *"the
    // runtime refuses… 'a turn is in progress'"*, which the host's guard answers before, and since
    // 670 a race lost past that guard is HELD — so a live button here would be an error message
    // pretending to be a feature. It is derived from the same composer state as the box beside it,
    // so the two can never disagree.
    // The whole opening tag, because SSR emits attributes in its own order — an assertion anchored
    // on `data-cy` coming first would pass or fail on Vue's serializer rather than on the feature.
    const button = (html: string): string =>
      /<button[^>]*data-cy="plan-go-ahead-button"[^>]*>/.exec(html)?.[0] ?? ''
    expect(button(await render(pane({}, 'working')))).toContain('disabled')
    expect(button(await render(pane({}, 'idle')))).not.toContain('disabled')
    // …and while a command for this conversation is already in flight, which is what makes a
    // double click harmless: the second go-ahead would be refused by the handle — correctly, the
    // plan having already been approved — and the user would meet an error for pressing twice.
    expect(button(await render(pane({}, 'idle', true)))).toContain('disabled')
  })

  it('rides the liveness channel, so a pressed button disappears without a reload', async () => {
    // The state changes in the main process — the moment the command lands — and a second window
    // watching the same conversation has no command result to learn it from. The fold is what makes
    // one publish update every reader.
    const record = createSessionRecord('sess_1')
    record.meta = meta()
    acceptLiveness(record, { ...liveness, plan: { planNeedsGoAhead: false } })
    expect(record.meta.planNeedsGoAhead).toBe(false)
    // …and it leaves the approval disclosure it travels beside alone.
    expect(record.meta.approvalNote).toBe('approvals: ask')
  })
})

describe('the copy never says plan mode was stopping the agent (acceptance 6)', () => {
  /**
   * ⚠️ The claim being guarded against is the SDK's own — `permissionMode: 'plan'` is documented as
   * *"Planning mode, no actual tool execution"*, and 026 measured the model performing a `Write`
   * while in it. 056 then found the same thing in our own ledger. This feature is where that lie
   * would be easiest to tell, because the natural word for the button is "approve" and the natural
   * sentence after it is "the agent can now act".
   */
  const FORBIDDEN = [
    /\ballow(s|ed|ing)? (the agent|it) to\b/i,
    /\bpermit(s|ted|ting)?\b/i,
    /\bunlock/i,
    /\bnow (safe|allowed|permitted|able) to\b/i,
    /\bcan now (act|run|execute|touch)\b/i,
    /\bsafe(ly)?\b/i,
  ]

  it('not in the button, the bar, the message it sends, or the entry it leaves', () => {
    // ⚑ **`GO_AHEAD_AUTHORSHIP` joined the list at 278 §1**, and it is the copy most likely to break
    // this rule of the four: it explains, after the fact, why a message was sent — which is exactly
    // the sentence someone would reach for "now the agent is allowed to act" to write.
    for (const copy of [GO_AHEAD_LABEL, GO_AHEAD_NOTE, GO_AHEAD_MESSAGE, GO_AHEAD_AUTHORSHIP]) {
      for (const pattern of FORBIDDEN) {
        expect(copy, `"${copy}" must not say plan mode was a gate`).not.toMatch(pattern)
      }
    }
  })

  /*
   * ⛔ **`and the launcher tooltip no longer claims the setting is fixed for the session` went with
   * `planModeTitle`** (417, HO-022 §2). It swept both branches of the launcher checkbox's tooltip
   * for *"fixed when the session starts"* — 060's correction — and required the half that still
   * held, *"cannot be switched on later"*. ⚑ **The launcher has no checkbox and the tooltip is
   * deleted**, so there is no string left to make the claim; what a person can read about plan
   * mode is the drawer's, which `live-settings.render.test.ts` sweeps.
   */

  /**
   * The second outcome of the one gesture (085).
   *
   * ⚠️ **Not a second control that means "stop planning" — 076 forbids that and it is not reopened.**
   * Both buttons emit the SAME `endPlanMode`, which is the same `setPlanMode(false)` carried by the
   * same next `turn/start`. The only difference is whether a message rides with it, and that is the
   * whole difference between approving a plan and walking away from one.
   */
  describe('…and the way out that is not an approval (085)', () => {
    it('sits in the same bar, and says what happens INSTEAD of a message', async () => {
      const html = await render(pane())
      // Positive: both outcomes are on offer in the one place the gesture lives.
      expect(html).toContain('data-cy="plan-go-ahead-button"')
      expect(html).toContain('data-cy="plan-leave-button"')
      expect(html).toContain(LEAVE_PLAN_LABEL)
      // And it discloses what it does, in the same way its neighbour discloses its message: the
      // agent hears nothing, so the user has to be told that silence is the outcome.
      expect(LEAVE_PLAN_TITLE).toMatch(/nothing is sent/i)
      expect(html).toContain('Nothing is sent')
    })

    it('never appears without the gesture it belongs to', async () => {
      // Rule 1 again, and it must hold for BOTH outcomes: a Claude session has no bar at all, so it
      // must not acquire an escape hatch the model's own plan card knows nothing about.
      const html = await render(pane({ planNeedsGoAhead: false }))
      expect(html).not.toContain('data-cy="plan-leave-button"')
      expect(html).not.toContain('data-cy="plan-go-ahead-button"')
    })

    it('⚠️ stays live while a turn is running, where the go-ahead does not', async () => {
      // The asymmetry, rendered. Its neighbour SENDS and is frozen mid-turn; this one changes a mode
      // that rides the next turn, so freezing it would make "leave at will" mean "leave once the
      // agent lets you". Asserted as a PAIR on one render, so neither half can pass over the other's
      // absence.
      // ⚠️ The WHOLE opening tag, matched the way the test above matches it: SSR emits `disabled`
      // before the `data-cy`, so an assertion that reads forward from the marker skips the very
      // attribute it is about — and the negative half would then pass over nothing.
      const html = await render(pane({}, 'working'))
      const tag = (cy: string): string =>
        new RegExp(`<button[^>]*data-cy="${cy}"[^>]*>`).exec(html)?.[0] ?? ''
      expect(tag('plan-go-ahead-button'), 'positive: the neighbour IS frozen').toContain('disabled')
      expect(tag('plan-leave-button')).not.toContain('disabled')
      // …and the shared guard still holds for both: a command already in flight freezes the pair,
      // because that one is about double-clicking, not about the turn.
      const busy = await render(pane({}, 'idle', true))
      expect(/<button[^>]*data-cy="plan-leave-button"[^>]*>/.exec(busy)?.[0]).toContain('disabled')
    })

    it('is quieter than the approval, so the pair does not read as two equal ways out', () => {
      const source = readFileSync(
        fileURLToPath(
          new URL('../src/renderer/src/components/ConversationPane.vue', import.meta.url),
        ),
        'utf8',
      )
      const rule = source.slice(source.indexOf('.plan-bar-leave {'))
      const body = rule.slice(0, rule.indexOf('}'))
      expect(body).toContain('border: 0')
      expect(body).toContain('color: var(--muted)')
    })

    it('the provider that cannot offer it SAYS so, rather than showing nothing', () => {
      // Acceptance 5's second branch. Claude's planning ends inside the SDK, at the model's own
      // `ExitPlanMode` request; a client-side switch would be the rival exit 076 was written about,
      // and a Claude session resumes with `permissionMode:'plan'` regardless of what we recorded, so
      // "left planning" would come back planning. Stated in words the settings control renders.
      expect(LEAVE_PLAN_UNAVAILABLE).toMatch(/own plan-approval request/i)
      expect(LEAVE_PLAN_UNAVAILABLE).not.toMatch(/coming soon|not yet|unsupported/i)
    })
  })

  it('the bar is not styled as the primary action of the surface', () => {
    // Typing a reply to a plan is at least as ordinary as accepting it wholesale, and the one
    // filled button on this surface is Send. A second primary above it would read as the thing to
    // do — which is a nudge, not a disclosure.
    const source = readFileSync(
      fileURLToPath(
        new URL('../src/renderer/src/components/ConversationPane.vue', import.meta.url),
      ),
      'utf8',
    )
    const block = source.slice(source.indexOf('.plan-bar-button {'))
    expect(block.slice(0, block.indexOf('}'))).toContain('background: transparent')
  })
})
