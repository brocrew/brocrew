import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import { STANDING_LABEL } from '../src/renderer/src/lib/agent-state'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import type { CreatedSession, SessionLiveness } from '../src/shared/runtime-ipc'
import type { TaskWait } from '../src/shared/tasks'

/**
 * 🔴 **636 · the PANE forwards the wait into the object all three of its surfaces are drawn
 * from** — `facetInput`, which feeds the header's pill, the shelf and the drawer's plate.
 *
 * ## ⛔ Why a render test as well as a dom one
 *
 * ⚠️ **The dom suite mounts `SessionHeader` directly with facets**, because what it measures is
 * ink in a box. ⛔ That leaves one hop unmeasured: whether the PANE puts the prop into
 * `facetInput` at all. ⚑ This file is that hop and nothing else — `a-test-that-imports-an-sfc-is
 * -a-renderer-file`, so it is a `.render.test.ts`.
 *
 * ⚠️ **Every assertion here is PAIRED** (`brobot2-ssr-tests-pass-vacuously`): the same mount
 * without the prop is rendered beside it, and it says the word this app said before `636`.
 */

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

const meta: CreatedSession = {
  sessionId: 'sess_brobot',
  provider: 'claude',
  cwd: '/work/brobot',
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
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work/brobot', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-sonnet-5',
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
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

function pane(waiting?: TaskWait): Record<string, unknown> {
  const record = createSessionRecord('sess_brobot')
  record.meta = meta
  record.phase = 'open'
  record.transcript.status = 'idle'
  return {
    record,
    mode: 'chat' as const,
    debug: false,
    drawerOpen: false,
    drawerTab: 'open' as const,
    draft: '',
    ...(waiting ? { waiting } : {}),
  }
}

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ConversationPane as never, props) }))

describe('636 · the pane hands the wait to the object its three surfaces are drawn from', () => {
  it('🔴 the header says another agent owes the next move — and without the prop it says Idle', async () => {
    const told = await render(pane('waiting-on-a-worker'))
    expect(told).toContain(STANDING_LABEL.elsewhere)
    expect(told).toContain('data-standing="elsewhere"')

    // ⛔ **THE PAIR** — the same conversation with nothing read about it, which is what every
    // real window draws on its first frame and what `main` drew for ever.
    const untold = await render(pane())
    expect(untold).toContain(STANDING_LABEL.idle)
    expect(untold).not.toContain(STANDING_LABEL.elsewhere)
    expect(untold).toContain('data-standing="idle"')
  })

  it('⚑ the one wait that IS a person’s reaches the same bar as *Waiting on you*', async () => {
    // 🔴 **`621` F2's half that a facet can close**: no card is drawn for a question passed up to
    // a person, so `pending` is empty and this bar had nothing to say.
    const told = await render(pane('waiting-on-a-person'))
    expect(told).toContain(STANDING_LABEL.waiting)
    expect(told).toContain('data-standing="waiting"')
    // ⛔ …and it is the AMBER one, which is the whole difference between the two families.
    expect(told).not.toContain('data-standing="elsewhere"')
  })

  it('⚠️ the second agent-owed wait says WHICH, on the plate under the avatar', async () => {
    // ⚑ The drawer's bot draws `plateWord`, which is the third of `HO-095` §5.1's surfaces — and
    // it is the one `250` and `258` each found printing `idle` over a paragraph that said
    // otherwise.
    const told = await render({ ...pane('waiting-on-an-answer'), drawerOpen: true })
    expect(told).toContain('waiting on an answer')
    const untold = await render({ ...pane(), drawerOpen: true })
    expect(untold).not.toContain('waiting on an answer')
  })
})
