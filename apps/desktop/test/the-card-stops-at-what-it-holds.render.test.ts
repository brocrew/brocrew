import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { AgentFacets } from '../src/renderer/src/lib/agent-state'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SessionBot from '../src/renderer/src/components/SessionBot.vue'
import SessionPanel from '../src/renderer/src/components/SessionPanel.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  DEFAULT_PROFILE_ID,
  type CreatedSession,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * The card stops at what this window holds (bb5ab496, a1f5a4d1).
 *
 * `bb5ab496` folded the top agent and every sub-agent card into one `AgentCard`, on the rule *"its
 * transcript is not held in this window, so its card stops there"*. ⚑ **UI-006 (F045) ended the
 * cards drawn without a transcript** — the card is only ever the selected agent's, the conversation
 * on screen, whose transcript this window holds — so the card with no `panel`/`state` and its test
 * went with it.
 *
 * Three things go unpinned by the other files: the redline colour on the context bar
 * (`3be2eaeb` reuses the Context tab's own rule, and nothing asserts the class turns on at 90%), the
 * wrapper's own `title` on `SessionBot` (`bb5ab496`'s stated reason for the change — *"a spawned
 * agent's longer name clips at the big title's width"* — which only a title on the WRAPPER, not the
 * plate's own separately-clipped one, actually fixes), and whether the running-work bar answers to
 * the work ending or to the drawer closing (`ac9c71fd` moved it onto the card, inside the drawer's
 * Open tab, so paging the drawer shut now also takes the bar with it).
 *
 * A `.render.test.ts` for the reason its neighbours are one: it imports SFCs, which `vue-tsc` checks
 * under the web project rather than the node one. Every negative below is paired with a positive
 * from the same render — a `not.toContain` over nothing passes vacuously.
 */

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

/** The opening tag for a `data-cy`, so an attribute can be read without depending on SSR's order. */
function tag(html: string, cy: string): string {
  const found = html.match(new RegExp(`<[a-z]+[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBe('')
  return found
}

describe('the card stops at what it holds (bb5ab496)', () => {
  it("SessionBot puts the agent's whole name on its own wrapper's title, not just on the plate's own (clipping) title", async () => {
    const bot = (props: { facets: AgentFacets; who?: string }): Promise<string> =>
      renderToString(createSSRApp({ render: () => h(SessionBot, props) }))

    const longName = 'a name long enough to clip at the big plate width'
    const named = await bot({ facets: { doing: 'idle' }, who: longName })
    const wrapper = tag(named, 'session-bot')
    // ⚠️ The WHOLE name, off the wrapper's own `title` — not the plate's separately-clipped one,
    // which `AgentState` owns and draws further inside this same block.
    expect(/title="([^"]*)"/.exec(wrapper)?.[1]).toBe(longName)

    // The paired positive: with `who` omitted, the wrapper's title falls back to the component's
    // own default word — proving the attribute tracks the prop rather than being a static string
    // that happened to match the first fixture.
    const fallback = await bot({ facets: { doing: 'idle' } })
    expect(/title="([^"]*)"/.exec(tag(fallback, 'session-bot'))?.[1]).toBe('agent')
  })

  it('the card marks its context reading as over the redline, and only over it', async () => {
    const render = (state: TranscriptState, over: Record<string, unknown> = {}): Promise<string> =>
      renderToString(
        createSSRApp({
          render: () => h(SessionPanel, { state, mode: 'normal' as const, ...over }),
        }),
      )
    const reading = (r: Record<string, unknown>): TranscriptEvent =>
      ({ type: 'context_reading', reading: r, source: 'test/reading' }) as TranscriptEvent

    // Exactly REDLINE (0.9, `context-meter.ts`). ⚑ W4.183 · the reading is a run-strip item now.
    // ⚑ W4.208 · and a `<component :is>` (the Context popup's door), whose merge puts the dynamic
    // key last.
    const over = await render(
      feed(createTranscript(), reading({ kind: 'proportional', used: 90_000, window: 100_000 })),
      { facets: { doing: 'idle' } },
    )
    expect(over).toContain('class="run-item context limit"')

    // The paired positive: well under the redline, the class is present but unqualified — so the
    // mark is conditional on crossing the line, not always on.
    const under = await render(
      feed(createTranscript(), reading({ kind: 'proportional', used: 50_000, window: 100_000 })),
      { facets: { doing: 'idle' } },
    )
    expect(under).toContain('class="run-item context"')
    expect(under).not.toContain('class="run-item context limit"')
  })

  describe('the running-work bar, since it moved onto the card (ac9c71fd)', () => {
    const META: CreatedSession = {
      sessionId: 'sess_1',
      provider: 'claude',
      cwd: '/work/checkout',
      providerHome: '/homes/claude',
      profileId: DEFAULT_PROFILE_ID,
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
      ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work', rotation: 0 },
      config: {
        home: '/homes/claude',
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'claude-opus-5',
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
      liveness: {
        state: 'live',
        since: 1_700_000_000_000,
        canStopBackgroundWork: true,
      },
      hasACommander: false,
      startedWithoutAWindow: false,
      mayHandItBack: false,
    }

    /** The measured `local_bash` row used by `idle-truth.render.test.ts`. */
    const LEVEL = {
      type: 'background_work',
      running: [
        {
          id: 'b6uoyo82k',
          kind: 'local_bash',
          toolCallId: 'toolu_1',
          description: 'waiting for person.txt to appear on Desktop',
        },
      ],
      source: 'background_tasks_changed',
    } as unknown as TranscriptEvent

    /** A detachment followed by turn completion and host idle. */
    const TURN_OVER: TranscriptEvent[] = [
      { type: 'status', state: 'working' },
      { type: 'user_turn', text: 'watch my Desktop for person.txt' },
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "…"' },
      LEVEL,
      {
        type: 'tool_result',
        id: 'toolu_1',
        summary: 'Command running in background with ID: b6uoyo82k.',
        ok: true,
        backgrounded: true,
        backgroundId: 'b6uoyo82k',
      } as TranscriptEvent,
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
    ]

    function record(events: TranscriptEvent[]): SessionRecord {
      const r = createSessionRecord('sess_1')
      r.meta = META
      r.phase = 'open'
      for (const event of events) applyEvent(r.transcript, event)
      return r
    }

    const pane = (drawerOpen: boolean): Promise<string> =>
      renderToString(
        createSSRApp({
          render: () =>
            h(ConversationPane as never, {
              record: record(TURN_OVER),
              mode: 'normal' as const,
              debug: false,
              drawerOpen,
              drawerTab: 'open' as const,
              models: null,
              draft: '',
            }),
        }),
      )

    it('leaves the screen entirely once the drawer is shut, not only once the work ends', async () => {
      const closed = await pane(false)
      // The pill still knows the work is running — the bar's absence is about the drawer, not
      // about the work having ended.
      expect(tag(closed, 'session-status')).toContain('data-standing="background"')
      expect(closed).not.toContain('data-cy="background-bar"')

      // The paired positive: the same record, drawer open on the Open tab — where `idle-truth`'s
      // own tests already pin the bar as present.
      const open = await pane(true)
      expect(tag(open, 'session-status')).toContain('data-standing="background"')
      expect(open).toContain('data-cy="background-bar"')
    })
  })
})
