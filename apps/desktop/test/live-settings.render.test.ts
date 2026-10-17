import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SessionDrawer from '../src/renderer/src/components/SessionDrawer.vue'
import { FIXED_SAYS } from '../src/renderer/src/composables/useConversationControls'
import type { DrawerFit, DrawerTab } from '../src/renderer/src/lib/drawer'
import { LEAVE_PLAN_UNAVAILABLE } from '../src/renderer/src/lib/plan-mode'
import { createTranscript } from '../src/renderer/src/lib/transcript'
import { createWindow } from '../src/renderer/src/lib/transcript-window'
import type {
  CreatedSession,
  SessionLiveness,
  SessionSettingsDisclosure,
} from '../src/shared/runtime-ipc'

/**
 * The agent card changes model, effort and plan mode without starting a new thread.
 * Assert effective settings separately from queued requests. This SSR harness fires no clicks,
 * so every negative assertion is paired with a positive one on the same rendered element.
 */

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

const noSettings: SessionSettingsDisclosure = {
  model: null,
  pendingModel: null,
  reasoningEffort: null,
  pendingReasoningEffort: null,
  planMode: false,
  pendingPlanMode: null,
}

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
  config: { home: '/homes/codex', homeEnv: 'CODEX_HOME', model: 'm', authNote: null, files: [] },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: noSettings,
  liveness,
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
  ...over,
})

/** The drawer on its Open tab, as the pane mounts it for a live conversation. */
function render(props: {
  session: CreatedSession
  /** ⚑ D-017b · nothing set here would reach the conversation (`CreatedSession.settingsFixed`). */
  fixed?: boolean
  /** Drawn from its ledger: its next start leaves planning. */
  recorded?: boolean
}): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(SessionDrawer as never, {
          session: props.session,
          state: createTranscript(),
          shown: createTranscript(),
          mode: 'normal',
          window: createWindow(),
          sessionRef: props.session.ref,
          status: 'idle',
          fixed: props.fixed ?? false,
          recorded: props.recorded ?? false,
          pickModel: () => Promise.resolve(),
          capabilities: null,
          waiting: 0,
          tab: 'open' as DrawerTab,
          fit: 'docked' as DrawerFit,
          facets: { doing: 'idle' as const, being: 'live' as const },
          work: null,
          identities: null,
        }),
    }),
  )
}

/**
 * The whole element for a `data-cy`, opening tag to its close.
 *
 * ⚠️ Every caller asserts something POSITIVE about the result, so an absent control fails rather
 * than quietly satisfying a `not.toContain`.
 */
function element(html: string, cy: string): string {
  const found =
    html.match(new RegExp(`<(button|span|p|div)[^>]*data-cy="${cy}"[^>]*>[\\s\\S]*?</\\1>`))?.[0] ??
    ''
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBe('')
  return found
}

/** The opening tag alone, for its attributes. */
function tag(html: string, cy: string): string {
  return element(html, cy).replace(/>[\s\S]*$/, '>')
}

const text = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

describe('the live settings, on the agent card (076)', () => {
  it('shows what is RUNNING and states the queued change separately (034’s rule)', async () => {
    const html = await render({
      session: meta({
        settings: {
          ...noSettings,
          model: 'gpt-5.6-sol',
          reasoningEffort: 'low',
          pendingReasoningEffort: { value: 'ultra' },
        },
      }),
    })
    // ⚠️ **What the CONTROL is showing is the assertion, not the line beside it** — a strip that
    // switched to the queued value would tell the person their change had landed on a turn it has
    // not reached.
    expect(text(element(html, 'card-run-model'))).toBe('gpt-5.6-sol')
    expect(text(element(html, 'card-run-effort'))).toBe('low')
    expect(element(html, 'card-run-effort')).not.toContain('ultra')
    // …and the queued change is stated separately, in words, against what runs now.
    expect(text(element(html, 'card-pending'))).toContain('Changes apply from your next message.')
    expect(text(element(html, 'card-pending-effort'))).toBe(
      'Effort ultra is asked for; low runs now.',
    )
    expect(html).not.toContain('data-cy="card-pending-model"')
  })

  it('says "the provider default" when a choice is being UNDONE', async () => {
    // ⚠️ The case a bare `string | undefined` could not express: handing the choice back to the
    // provider is a real thing to queue and its value is `undefined`.
    const html = await render({
      session: meta({
        settings: { ...noSettings, model: 'gpt-5.6-sol', pendingModel: { value: undefined } },
      }),
    })
    expect(text(element(html, 'card-pending-model'))).toBe(
      'Model the provider default is asked for; gpt-5.6-sol runs now.',
    )
  })

  it('nothing is said under the strip when nothing is queued', async () => {
    const html = await render({ session: meta({ settings: { ...noSettings, model: 'm-1' } }) })
    // Paired with the positive: the strip itself rendered.
    expect(text(element(html, 'card-run-model'))).toBe('m-1')
    expect(html).not.toContain('data-cy="card-pick-became"')
    expect(html).not.toContain('data-cy="card-pending"')
  })

  it('keeps a model the provider no longer lists, rather than showing it as a default', async () => {
    const html = await render({
      session: meta({ settings: { ...noSettings, model: 'gpt-4.1-retired' } }),
    })
    expect(text(element(html, 'card-run-model'))).toBe('gpt-4.1-retired')
  })

  it('offers no second go-ahead where the plan already has one (the 076 ruling)', async () => {
    // ⚠️ **The one-control rule, rendered.** Turning plan mode off and pressing "start work on the
    // plan" are the same state transition. Where `planNeedsGoAhead` is true the plan below the
    // transcript owns the gesture, so the chip shows the state and points there.
    const planning = await render({
      session: meta({ planNeedsGoAhead: true, settings: { ...noSettings, planMode: true } }),
    })
    const deferred = tag(planning, 'card-run-plan')
    expect(deferred).toContain('data-state="deferred"')
    expect(deferred).toContain('start work on the plan')
    expect(deferred).toContain('leave planning without approving it')
    expect(deferred, 'the chip offers an exit the plan already has').toMatch(/^<span/)
    expect(text(element(planning, 'card-run-plan'))).toBe('Planning')

    // And where nothing else offers a way in, the chip is it.
    const idle = await render({ session: meta() })
    expect(tag(idle, 'card-run-plan')).toMatch(/^<button/)
    expect(tag(idle, 'card-run-plan')).toContain('data-state="off"')
    expect(text(element(idle, 'card-run-plan'))).toBe('Plan off')
  })

  it('the provider with no client-side exit RENDERS why, not just exports the sentence (085)', async () => {
    const planning = await render({
      session: meta({ planNeedsGoAhead: false, settings: { ...noSettings, planMode: true } }),
    })
    const chip = tag(planning, 'card-run-plan')
    expect(chip).toContain('data-state="planning"')
    expect(chip).toContain(LEAVE_PLAN_UNAVAILABLE)
    // It states the fact and offers no exit, because the exit is the provider's own request.
    expect(chip).toMatch(/^<span/)
    expect(text(element(planning, 'card-run-plan'))).toBe('Planning')
    expect(LEAVE_PLAN_UNAVAILABLE).not.toMatch(/coming soon|not yet|unsupported|cannot be done/i)
  })

  it('announces a queued start and a queued stop, apart from the state (found in review)', async () => {
    // ⚠️ `pendingPlanMode` is `boolean | null`: `false` is the request "stop planning", and only
    // `null` means nothing queued.
    const stopping = await render({
      session: meta({ settings: { ...noSettings, planMode: true, pendingPlanMode: false } }),
    })
    expect(tag(stopping, 'card-run-plan')).toContain('data-state="stopping"')
    expect(text(element(stopping, 'card-run-plan'))).toBe('Planning')
    expect(text(element(stopping, 'card-pending-plan'))).toBe(
      'Leaving planning is asked for; it is planning now.',
    )

    const starting = await render({
      session: meta({ settings: { ...noSettings, planMode: false, pendingPlanMode: true } }),
    })
    // The chip still says what RUNS, and is not pressed again for a change already queued.
    expect(tag(starting, 'card-run-plan')).toContain('data-state="starting"')
    expect(tag(starting, 'card-run-plan')).toMatch(/^<span/)
    expect(text(element(starting, 'card-run-plan'))).toBe('Plan off')
    expect(text(element(starting, 'card-pending-plan'))).toBe(
      'Plan first is asked for; it is off now.',
    )
  })

  it('never implies plan mode is a safety gate', async () => {
    // 026 measured Claude writing a file while planning and 057 measured Codex running a command.
    // ⚠️ The positive and the negative are on the SAME string.
    const html = await render({ session: meta() })
    const plan = tag(html, 'card-run-plan')
    expect(plan).toContain('approvals are what gate those')
    expect(plan).toContain('not a safety gate')
    expect(plan).toContain('Applies from your next message.')
    expect(plan.toLowerCase()).not.toContain('cannot run')
    expect(plan.toLowerCase()).not.toContain('will not run')
  })

  it('a conversation whose settings are fixed states them instead of offering to change them', async () => {
    // ⚑ **D-017b · `fixed`, not `ended`** — the controls are statements where nothing set here
    // would reach the conversation. ⚑ Handed a Take, so only `fixed` can make them statements.
    const html = await render({
      session: meta({ settings: { ...noSettings, model: 'm-1', reasoningEffort: 'low' } }),
      fixed: true,
    })
    expect(tag(html, 'card-run-model')).toMatch(/^<span/)
    expect(tag(html, 'card-run-effort')).toMatch(/^<span/)
    expect(tag(html, 'card-run-plan')).toMatch(/^<span/)
    expect(tag(html, 'card-run-plan')).toContain(FIXED_SAYS)
    expect(tag(html, 'card-approval')).toContain('data-changeable="false"')

    // The control: the same conversation, not fixed, offers all three.
    const live = await render({
      session: meta({ settings: { ...noSettings, model: 'm-1', reasoningEffort: 'low' } }),
    })
    expect(tag(live, 'card-run-model')).toMatch(/^<button/)
    expect(tag(live, 'card-run-plan')).toMatch(/^<button/)
    expect(tag(live, 'card-approval')).toContain('data-changeable="true"')
  })

  it('a conversation drawn from its ledger is not offered plan first — its next start leaves it', async () => {
    const html = await render({ session: meta(), recorded: true })
    const chip = tag(html, 'card-run-plan')
    expect(chip).toMatch(/^<span/)
    expect(chip).toContain('leaves planning')
    expect(text(element(html, 'card-run-plan'))).toBe('Plan off')
  })
})
