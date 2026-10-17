import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SessionPanel from '../src/renderer/src/components/SessionPanel.vue'
import SideRail from '../src/renderer/src/components/SideRail.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  type CreatedSession,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 250 · ⛔ **The two WORD surfaces, in markup**
 *
 * `idle-truth.test.ts` holds the rule; this holds the wiring. The rule can be perfect and the pill
 * can still be reading something else — `099` is the dispatch where exactly that was true, and the
 * fix was one function with two callers rather than a better rule.
 *
 * ⚠️ **SSR: no DOM, no styles, no clicks** (086). So every negative below is PAIRED with a positive
 * from the same render — a `not.toContain('idle')` also passes against a component that rendered
 * nothing at all, which is `193`'s vacuity and this repo's most-repeated finding.
 */

const SCOPE = {
  cwd: '/work',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

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
  liveness: { state: 'live', since: 1_700_000_000_000 },
  hasACommander: false,
  // 523 · a conversation a window started: it is not handed back, it is ended.
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

/** A measured `local_bash` background-work payload. */
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

/** The same turn, with the provider's own `[]` saying the work is gone — every test's control. */
const TURN_OVER_QUIET: TranscriptEvent[] = [
  ...TURN_OVER,
  { type: 'background_work', running: [], source: 'background_tasks_changed' } as TranscriptEvent,
]

function record(events: TranscriptEvent[]): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = META
  r.phase = 'open'
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

const pane = (events: TranscriptEvent[]): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ConversationPane as never, {
          record: record(events),
          mode: 'normal' as const,
          debug: false,
          // ⚑ The bars are on the agent's card, in the drawer's Open tab.
          drawerOpen: true,
          drawerTab: 'open',
          models: null,
          draft: '',
        }),
    }),
  )

const rail = (events: TranscriptEvent[]): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SideRail as never, {
          open: [record(events)],
          activeId: 'sess_1',
          place: null,
        }),
    }),
  )

/** The opening tag for a `data-cy`, so attributes can be read without depending on SSR's order. */
function tag(html: string, cy: string): string {
  const found = html.match(new RegExp(`<[a-z]+[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBe('')
  return found
}

describe('250 · the header pill', () => {
  it('🔴 says "Still running" over a conversation whose work outlived the turn', async () => {
    const html = await pane(TURN_OVER)
    expect(tag(html, 'session-status')).toContain('data-standing="background"')
    expect(html).toContain('Still running')
    // ⚑ **The pairing**: `248`'s bar is on the SAME render, holding the row the pill describes. Two
    // readings of one object is the property 099 spent a dispatch buying.
    expect(html).toContain('data-cy="background-bar"')
    // ⛔ **The COMMAND, since 251 §2** — this line asserted the DESCRIPTION when 250 wrote it, which
    // is exactly the defect 251 was dispatched for: *"the registry row says what the model called the
    // work, never what it is running."* The fixture's row carries `toolCallId: 'toolu_1'`, so the
    // join finds that call and the row prints its summary. The pairing 250 was buying is unchanged —
    // the bar is on the same render, holding the row the pill describes.
    // ⚠️ **Read out of the REGISTRY ROW, not off the whole render** (found by the adversarial pass
    // over 251's diff). The tool card prints the same command in the same pane, so a loose
    // `toContain('node -e')` held even when the row showed the description — an assertion about the
    // row that could not fail for the row.
    expect(tag(html, 'background-what-b6uoyo82k')).toContain('data-from="command"')
    const cell = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .match(/data-cy="background-what-b6uoyo82k"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    expect(cell?.replace(/<[^>]+>/g, '')).toBe('Bash node -e &quot;…&quot;')
    // …and the description it replaced is gone, so this is a change of answer rather than a row that
    // grew a second one.
    expect(html).not.toContain('waiting for person.txt to appear on Desktop')
  })

  it('…and says "Idle" once the provider says the set is empty', async () => {
    const html = await pane(TURN_OVER_QUIET)
    expect(tag(html, 'session-status')).toContain('data-standing="idle"')
    expect(html).toContain('Idle')
    // The paired negative, meaningful because the positives above rendered from the same component:
    // the bar is gone too, so the pill and the bar went quiet together.
    expect(html).not.toContain('data-cy="background-bar"')
  })

  it('🔴 …and it reads the CONTROL projection, so paging back does not silence it (064)', async () => {
    // ⛔ **The pane half of 064, and it had NO coverage until the adversarial pass over 250's diff
    // said so.** `idle-truth.test.ts` forks the projections and asserts the RAIL; every record
    // helper in the suite — this file's, and `test/dom/harness.ts`'s — leaves `control` and
    // `transcript` as the SAME object, so a pane that read `record.transcript.background` was
    // indistinguishable from one that read `control`. The reviewer applied that exact mutation and
    // watched this file stay green.
    //
    // The state is the one `prependOlder` produces: the reader has paged back far enough that the
    // window released the tail, so `transcript` is a view of HISTORY with no level payload in it and
    // `control` is the fold that kept going.
    const r = record(TURN_OVER)
    const live = r.control
    r.transcript = createTranscript()
    expect(r.transcript.background.running, 'the reading fold really is empty').toEqual([])
    expect(live.background.running, 'and the control fold really is holding the work').toHaveLength(
      1,
    )

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ConversationPane as never, {
            record: r,
            mode: 'normal' as const,
            debug: false,
            // ⚑ The bars are on the agent's card, in the drawer's Open tab.
            drawerOpen: true,
            drawerTab: 'open',
            models: null,
            draft: '',
          }),
      }),
    )
    expect(tag(html, 'session-status')).toContain('data-standing="background"')
    expect(html).toContain('Still running')
  })

  it('⚠️ the `data-status` three live smokes read is UNTOUCHED — it is the host’s word', async () => {
    // ⛔ `SessionHeader` carries two attributes and they answer different questions. `data-status` is
    // `props.status`, the host's raw lifecycle word, and `ui-live-smoke` reads it; `data-standing` is
    // the derived one this dispatch changed. Widening the first would have been a silent change to
    // an instrument, which is `162`'s finding.
    const chip = tag(await pane(TURN_OVER), 'session-status')
    expect(chip).toContain('data-status="idle"')
    expect(chip).toContain('data-standing="background"')
  })
})

describe('250 · the rail row', () => {
  it('🔴 says "claude · running in the background", not "claude · idle"', async () => {
    const html = await rail(TURN_OVER)
    // ⚑ **F023 · the PM's phrase**, and the rail appends what it is running when the row names it.
    expect(html).toContain('claude · running in the background')
    expect(html).toContain('data-standing="background"')
  })

  it('…and goes back to "claude · idle" when the level empties', async () => {
    const html = await rail(TURN_OVER_QUIET)
    expect(html).toContain('claude · idle')
    expect(html).toContain('data-standing="idle"')
    // The paired negative: the same render really did produce a row, and the new word is not in it.
    expect(html).not.toContain('still running')
  })

  it('🔴 the plate’s accessible NAME carries it — the sentence a screen reader hears', async () => {
    // ⛔ **This was a branch nothing could reach until the prop was declared.** Callers spread the
    // whole facets object, so `detached` arrived as a fallthrough ATTRIBUTE — a stray
    // `detached="true"` on the root element — and `accessibleName` never saw it. 222 §4's *do not add
    // a word nothing can produce*, broken by the fix for it. Found by 250's own adversarial pass.
    const html = await rail(TURN_OVER)
    // ⛔ The WHOLE sentence, so this is not matching the visible row text beside the plate. The
    // subject is the rail's own label for the conversation — 🔴 **WHO is in it since 449**, where
    // it was the folder before — and the facets follow it in the order `accessibleName` states:
    // doing, then this. ⚑ **D-017b · no BEING between them**: a live provider draws no `live`, since
    // whether a process runs is not the plate's to say.
    //
    // ⚑ **The plate's subject moving with the row's is the point rather than a side effect**: the
    // label a screen reader hears and the label a sighted person reads are one string, passed to
    // `AgentState` from the same expression, so they cannot come to name a conversation two ways.
    expect(html).toContain(`aria-label="${DEFAULT_PROFILE_LABEL} — idle, work still running"`)
  })

  it('…and the same plate says nothing extra once the level empties', async () => {
    const html = await rail(TURN_OVER_QUIET)
    // The pairing: an `aria-label` really is rendered here, and the fragment is not in it.
    expect(html).toContain(`aria-label="${DEFAULT_PROFILE_LABEL} — idle"`)
    expect(html).not.toContain('work still running')
  })

  it('🔴 the DRAWER’s bot says it too — the fifth word surface, found in review (250)', async () => {
    // Render `SessionBot` and the panel paragraph together. The bot’s doing word can
    // correctly be `idle` while the panel says “Work this conversation started is still
    // running”; the plate word must reconcile these facts instead of contradicting the
    // paragraph.
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(SessionPanel as never, {
            state: record(TURN_OVER).control,
            mode: 'normal' as const,
            facets: { doing: 'idle', being: 'live', detached: true },
            provider: 'claude',
          }),
      }),
    )
    expect(html).toContain('data-cy="session-bot"')
    expect(html).toContain('still running')
    // ⚠️ The paired NEGATIVE, meaningful because the block above really rendered: the bare word the
    // drawer used to print is gone from it.
    expect(html).not.toContain('>idle<')
  })

  it('…and the drawer’s bot keeps the plain DOING word in every other state', async () => {
    // The pairing that keeps the change scoped to one standing: nothing else about this surface moved.
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(SessionPanel as never, {
            state: createTranscript(),
            mode: 'normal' as const,
            facets: { doing: 'tool', being: 'live' },
            provider: 'claude',
          }),
      }),
    )
    expect(html).toContain('using a tool')
    expect(html).not.toContain('still running')
  })

  it('⛔ the plate keeps the IDLE face, and that is the ruling rather than an oversight', async () => {
    // The avatar answers *what is the AGENT doing*, and the agent is not doing anything — a process
    // it detached is. 042's *"idle means we are no longer driving a turn"* stands; what was never
    // true is that the one-word surfaces could stop there. A new face would also have needed art.
    const html = await rail(TURN_OVER)
    expect(html).toContain('data-doing="idle"')
    // Paired, so this is not reading a render with no plate in it at all.
    expect(html).toContain('data-cy="agent-state"')
  })
})

describe('250 · a fresh conversation is untouched', () => {
  it('an ordinary idle session still reads idle on both surfaces', async () => {
    // The regression this change could most plausibly cause: a `background` word leaking onto every
    // quiet conversation. Both surfaces, over a fold that never saw a level payload at all.
    const quiet = createTranscript()
    expect(quiet.background).toEqual({ running: [], dropped: 0 })
    const railHtml = await rail([{ type: 'status', state: 'idle' }])
    expect(railHtml).toContain('claude · idle')
    const paneHtml = await pane([{ type: 'status', state: 'idle' }])
    expect(tag(paneHtml, 'session-status')).toContain('data-standing="idle"')
  })

  it('and a session waiting on a permission still says so, not "still running"', async () => {
    const html = await rail([
      ...TURN_OVER,
      {
        type: 'permission_request',
        id: 'req_1',
        kind: 'command',
        action: 'Bash',
        detail: 'rm -rf /tmp/build',
        scope: SCOPE,
      } as TranscriptEvent,
    ])
    // Permission waits require the person to act; background work asks nothing.
    expect(html).toContain('claude · needs you: permission')
    expect(html).toContain('data-standing="waiting"')
  })
})

/**
 * # 258 · **The schedule, in the same two surfaces**
 *
 * ⚠️ **The rule can be perfect and the pane can still be reading something else**, which is why
 * `250` wrote this file at all — and why a component that exists is not the same fact as a component
 * that is MOUNTED. `ScheduleBar` renders correctly in `schedule-bar.render.test.ts`; what these
 * assert is that `ConversationPane` gives it the registry, and that the pill agrees with it.
 */

/** A turn that ends having scheduled something and left NOTHING running. */
const TURN_SCHEDULED: TranscriptEvent[] = [
  { type: 'status', state: 'working' },
  { type: 'user_turn', text: 'check my Desktop every 2 minutes' },
  { type: 'turn', state: 'completed' },
  { type: 'status', state: 'idle' },
  {
    type: 'scheduled_work',
    jobs: [
      {
        id: 'e3826cc5',
        // The expression is DATA rather than prose — the two characters that spell a cron STEP also
        // end a block comment. See `scheduled-work.ts`.
        schedule: '*/2 * * * *',
        recurring: true,
        prompt: 'check whether person.txt has appeared on the Desktop',
      },
    ],
    source: 'hook/Stop',
  } as TranscriptEvent,
]

describe('258 · the header pill and the bar it points at', () => {
  it('🔴 says "Scheduled" over a conversation that is going to wake itself', async () => {
    const html = await pane(TURN_SCHEDULED)
    expect(tag(html, 'session-status')).toContain('data-standing="scheduled"')
    expect(html).toContain('Scheduled')
    // ⚑ **The pairing**: the bar is on the SAME render, holding the job the pill describes — two
    // readings of one object rather than two opinions.
    expect(html).toContain('data-cy="schedule-bar"')
    expect(html).toContain('data-cy="schedule-row-e3826cc5"')
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
    expect(stripped).toContain('1 job is scheduled')
    expect(stripped).toContain('*/2 * * * *')
    // ⛔ **And `248`'s bar is NOT drawn**, which is what makes this a fact about the schedule rather
    // than about a registry that happened to be full.
    expect(html).not.toContain('data-cy="background-bar"')
  })

  it('…and says "Idle" once the provider says nothing is scheduled', async () => {
    const html = await pane([
      ...TURN_SCHEDULED,
      { type: 'scheduled_work', jobs: [], source: 'hook/Stop' } as TranscriptEvent,
    ])
    expect(tag(html, 'session-status')).toContain('data-standing="idle"')
    expect(html).toContain('Idle')
    // The paired negative, meaningful because the positives above rendered from the same component:
    // the bar is gone too, so the pill and the bar went quiet together.
    expect(html).not.toContain('data-cy="schedule-bar"')
  })

  it('⚠️ the `data-status` three live smokes read is UNTOUCHED — it is still the host’s word', async () => {
    // `162`'s finding, kept: `data-status` is `props.status` and an instrument reads it; only the
    // derived `data-standing` moves.
    const chip = tag(await pane(TURN_SCHEDULED), 'session-status')
    expect(chip).toContain('data-status="idle"')
    expect(chip).toContain('data-standing="scheduled"')
  })

  it('🔴 …and the pane reads the CONTROL projection, so paging back does not silence it (064)', async () => {
    // ⛔ **The exact mutation the adversarial pass over `250`'s diff applied to the bar next door**:
    // every record helper in this suite leaves `control` and `transcript` as ONE object, so a pane
    // that read `record.transcript.schedule` would be indistinguishable from one that read
    // `control` — and would go blank the moment a reader paged back past the level.
    const r = record(TURN_SCHEDULED)
    const live = r.control
    r.transcript = createTranscript()
    expect(r.transcript.schedule.jobs, 'the reading fold really is empty').toEqual([])
    expect(live.schedule.jobs, 'and the control fold really is holding the job').toHaveLength(1)

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ConversationPane as never, {
            record: r,
            mode: 'normal' as const,
            debug: false,
            // ⚑ The bars are on the agent's card, in the drawer's Open tab.
            drawerOpen: true,
            drawerTab: 'open',
            models: null,
            draft: '',
          }),
      }),
    )
    expect(tag(html, 'session-status')).toContain('data-standing="scheduled"')
    expect(html).toContain('data-cy="schedule-row-e3826cc5"')
  })
})

describe('258 · the drawer’s bot, which went stale a SECOND time', () => {
  it('🔴 says "scheduled" over its own paragraph, instead of the bare DOING word', async () => {
    // A `SessionBot.vue` check for `background` misses `standingOf`’s `scheduled` facet,
    // printing `idle` above a paragraph saying a job will wake the conversation. `plateWord`
    // provides the shared rule for both facets.
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(SessionPanel as never, {
            state: record(TURN_SCHEDULED).control,
            mode: 'normal' as const,
            facets: { doing: 'idle', being: 'live', scheduled: true },
            provider: 'claude',
          }),
      }),
    )
    expect(html).toContain('data-cy="session-bot"')
    expect(html).toContain('scheduled')
    // ⚠️ The paired NEGATIVE, meaningful because the block above really rendered: the bare word the
    // drawer used to print is gone from it.
    expect(html).not.toContain('>idle<')
  })
})

describe('258 · the rail row', () => {
  it('🔴 says "claude · scheduled", not "claude · idle"', async () => {
    const html = await rail(TURN_SCHEDULED)
    expect(html).toContain('claude · scheduled')
    expect(html).toContain('data-standing="scheduled"')
  })

  it('…and a conversation with nothing scheduled is untouched', async () => {
    // The regression this change could most plausibly cause: a `scheduled` word leaking onto every
    // quiet conversation.
    const quiet = createTranscript()
    // ⚑ **D-029** — the level and its count, and no `sleeping` flag beside them: 258 §2's asleep
    // ruling went, since this app starts a stopped conversation in time for its jobs.
    expect(quiet.schedule).toEqual({ jobs: [], dropped: 0, left: [] })
    expect(await rail([{ type: 'status', state: 'idle' }])).toContain('claude · idle')
  })
})
