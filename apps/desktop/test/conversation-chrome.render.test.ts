import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { allProviderCapabilities } from '@brobot2/runtime'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../src/renderer/src/components/SessionDrawer.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { createWindow } from '../src/renderer/src/lib/transcript-window'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { HOW_THESE_GRANTS_END, NOT_ASKED_AGAIN } from '../src/renderer/src/lib/standing-grants'
import {
  DRAWER_TABS,
  RESERVED_TABS,
  type DrawerFit,
  type DrawerTab,
} from '../src/renderer/src/lib/drawer'

/**
 * The chrome half of 080: one quiet top bar, one tabbed drawer, and the attention model built.
 *
 * ⚠️ **These are SSR renders — no DOM, no clicks, no computed styles** (086). So every negative
 * assertion is paired with a positive one: `not.toContain('live-model-select')` also passes against
 * a component that rendered nothing at all. What this file genuinely cannot see is the one thing
 * chrome is mostly made of — layout and colour — and that limitation is stated in 080's response
 * rather than papered over here.
 */

const SCOPE = {
  cwd: '/work',
  paths: ['write /work/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

const permission = (id: string): TranscriptEvent => ({
  type: 'permission_request',
  id,
  kind: 'command',
  action: 'Bash',
  detail: 'run: ls',
  scope: SCOPE,
})

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
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

/**
 * A record with the given events in BOTH folds — which is the ordinary case, where the reader is at
 * the tail and the control projection and the reading window are the same object (064).
 */
function record(events: TranscriptEvent[], meta: CreatedSession = META): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = meta
  r.phase = 'open'
  // ⚠️ Folded into `transcript`, which a fresh record holds as the SAME object as `control` — the
  // ordinary case, where the reader is at the tail. Forking them here would have made every card in
  // these tests invisible in the conversation while still counting in the drawer, which is a real
  // state (064) but not the one the chrome is being asserted in. `tail` stays null for the same
  // reason: that field is what a reader scrolled off the end produces.
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

const paneProps = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  record: record([permission('req_1'), { type: 'status', state: 'waiting_permission' }]),
  mode: 'normal' as const,
  debug: false,
  drawerOpen: false,
  drawerTab: 'open' as DrawerTab,
  draft: '',
  // ⛔ The conversation's attachment transaction (292 §2) — required since the staged paths and
  // the operations that produce them became one object.
  handing: createAttachmentBook().handing(draftKey('sess_1')),
  ...over,
})

const pane = (over: Record<string, unknown> = {}): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ConversationPane as never, paneProps(over)) }))

const drawer = (over: Record<string, unknown> = {}): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SessionDrawer as never, {
          session: META,
          state: createTranscript(),
          shown: createTranscript(),
          mode: 'normal',
          window: createWindow(),
          sessionRef: META.ref,
          status: 'idle',
          fixed: false,
          recorded: false,
          // ⚑ UI-012 · what the screen hands every live conversation: a pick, carried out.
          pickModel: () => Promise.resolve(),
          waiting: 0,
          tab: 'open' as DrawerTab,
          fit: 'docked' as DrawerFit,
          facets: { doing: 'idle' as const, being: 'live' as const },
          ...over,
        }),
    }),
  )

/** The opening tag for a `data-cy`, so attributes can be read without depending on SSR's order. */
function tag(html: string, cy: string): string {
  const found = html.match(new RegExp(`<[a-z]+[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBe('')
  return found
}

describe('the top bar states and does not act (079 §1)', () => {
  it('carries the read-only indicators and exactly three affordances', async () => {
    const html = await pane()

    // States.
    expect(html).toContain('data-cy="provider-chip"')
    expect(html).toContain('data-cy="session-status"')
    // ⚑ **D-017b · the liveness pill is drawn only while the provider is silent** — *provider
    // live* was whether a process runs (`05` rule 5); see the pill's own test below.
    expect(html).not.toContain('data-cy="session-liveness"')
    // Acts — the drawer and the lifecycle toggle, and nothing else. ⚑ **D-017b · the third, End
    // conversation (`close-session`), is gone**: a conversation is never ended, and a message
    // continues it.
    expect(html).toContain('data-cy="toggle-session-panel"')
    expect(html).toContain('data-cy="toggle-debug-mode"')

    // The five that moved, and the one D-017b removed. Paired with the positives above, so an
    // empty render cannot pass.
    for (const gone of [
      'live-model-select',
      'live-effort-select',
      'live-plan-start',
      'toggle-session-info',
      'toggle-chat-theme',
      'close-session',
    ]) {
      expect(html, `${gone} is still on the top bar`).not.toContain(`data-cy="${gone}"`)
    }
  })

  it('the agent plate is up there too, and it is what the two pill dots became (082)', async () => {
    // ⚠️ Found in review: 082 deleted `.liveness.live .dot`, `.liveness.waiting .dot` and
    // `.liveness.error .dot` and put the plate in their place, and NOTHING in this file asserted
    // the plate. Deleting the `:facets` binding — or the component from the header — passed every
    // test in a 400-line file about the top bar.
    const html = await pane()
    expect(html).toContain('data-cy="agent-state"')
    const plate = tag(html, 'agent-state')
    // Fed by the pane, not worked out in the header. This fixture has a permission open and the
    // provider live, so two facets are on: mid-turn, and blocked on you. ⚑ **D-017b · and no
    // BEING**: a live provider draws no line, since whether a process runs is not the plate's to say.
    expect(plate).toContain('data-doing="working"')
    expect(plate).not.toContain('data-being')
    expect(plate).toContain('data-needing="permission"')
    expect(plate).toContain('role="img"')
    expect(html).toContain('#i-lock')
    // The dots it replaced are gone from the two pills, and the status pill still says the word
    // (the liveness pill says its word only while the provider is silent — D-017b).
    expect(html).toContain('data-cy="session-status"')
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/SessionHeader.vue', import.meta.url)),
      'utf8',
    )
    expect(source).not.toContain('.liveness.live .dot')
    expect(source).not.toContain('.liveness.waiting .dot')
    // …but the yolo pill, which is a different axis, keeps its own.
    expect(source).toContain('.liveness.auto .dot')
  })

  it('…and with nothing open it wears no badge, which is the pairing for the test above', async () => {
    const quiet = await pane({ record: record([{ type: 'status', state: 'idle' }]) })
    const plate = tag(quiet, 'agent-state')
    expect(plate).not.toContain('data-needing')
    expect(quiet).not.toContain('#i-lock')
    // The plate is still drawn, and still says what it does know.
    expect(quiet).toContain('data-cy="agent-plate"')
    expect(plate).toContain('data-doing="idle"')
  })

  /**
   * Plan mode left the shelf and the bar for the Agent panel, where its states are pinned
   * (`live-settings.render.test.ts`), and the usage cells left the conversation for the title bar.
   * Asserted positively, because these renders are server-side: the bar's provider is on the page.
   */
  it('the plan state is not on the shelf or the bar, and the usage is the title bar’s', async () => {
    const planning = await pane({
      capabilities: allProviderCapabilities(),
      record: record([{ type: 'status', state: 'working' }], {
        ...META,
        settings: { ...META.settings, planMode: true, pendingPlanMode: false },
      }),
    })
    // The words a person reads on this render: the provider the bar states.
    expect(planning).toMatch(/data-cy="provider-chip"[^>]*><span class="dot"[^>]*><\/span>claude</)
    expect(planning).not.toContain('data-cy="shelf-usage-claude-5h"')
    expect(planning).not.toContain('data-cy="shelf-plan"')
    expect(planning).not.toContain('PLAN · proposing first')
    expect(planning).not.toContain('planning · stopping next message')
    expect(planning).not.toContain('data-cy="session-plan-indicator"')
  })

  it('⚑ D-017b · the liveness pill is drawn only while the provider is silent — the one condition it says', async () => {
    // ⛔ *provider live*, *ended* and *errored* were whether a process runs (`05` rule 5), and so was
    // the pid, which left this pill for the Info tab at 079 §1 and left the Info tab at D-017b (its
    // `session-process` row is gone).
    const live = await pane()
    expect(live).not.toContain('data-cy="session-liveness"')
    // ⚑ **The paired positive** — the same conversation, its provider gone quiet mid-turn: the pill
    // is there and says the silence, so the absence above is the rule and not a broken pill.
    const quiet = await pane({
      record: record([permission('req_1'), { type: 'status', state: 'waiting_permission' }], {
        ...META,
        liveness: { state: 'silent', since: 1_700_000_000_000 },
      }),
    })
    expect(tag(quiet, 'session-liveness')).toContain('data-state="silent"')
    expect(quiet).toMatch(/silent \d+s/)
    // …and the Info tab draws its conversation rows with no process row among them.
    const info = await drawer({ tab: 'info' })
    expect(info).toContain('data-cy="session-ref"')
    expect(info).not.toContain('data-cy="session-process"')
  })

  /**
   * ⚠️ **The pill and the plate, in one render, with the real fold between them** (089).
   *
   * The unit tests next door pin `activityLine`; this pins that the pill is WIRED to it. Before
   * this change the two were built from separate readings of `control`, so the only thing that
   * could catch them disagreeing was rendering both at once — which nothing did.
   */
  it('⚠️ the pill cannot say a tool is running while the plate says replying (074’s class)', async () => {
    const events: TranscriptEvent[] = [
      { type: 'status', state: 'working' },
      { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
      { type: 'tool_result', callId: 't1', ok: true },
      // The delta that opens the reply. `activity` is NOT cleared by `tool_result` — only the
      // `turn` event clears it — so this is the frame where the old pill said "running Bash".
      { type: 'assistant_delta', text: 'The listing shows' },
    ] as never
    const streaming = await pane({ record: record(events) })

    expect(tag(streaming, 'activity-pill')).toContain('data-doing="replying"')
    expect(tag(streaming, 'agent-state')).toContain('data-doing="replying"')
    // Assert the words the person reads on screen.
    expect(streaming).toContain('replying')
    expect(streaming).not.toContain('running Bash')

    // ⚠️ **The positive half, and without it the negative above is worthless**: the same pane one
    // event earlier DOES say "running Bash", so the assertion is watching the delta and not a pill
    // that never draws a tool name at all.
    const mid = await pane({ record: record(events.slice(0, 2)) })
    expect(tag(mid, 'activity-pill')).toContain('data-doing="tool"')
    expect(mid).toContain('running Bash')
  })

  it('says nothing about approvals while the session still asks, and shouts when it stops', async () => {
    // A permanent "approvals: ask" is a label nobody keeps reading; the whole value of the pill is
    // that its appearance is the news (082).
    expect(await pane()).toContain('data-cy="session-approval-indicator"')

    const auto = await pane({
      record: record([], { ...META, approvalMode: 'auto', approvalNote: 'approvals: auto' }),
    })
    expect(auto).toContain('data-cy="session-approval-indicator"')
    // The mark says only “YOLO”, matching the mode that uses
    // `--dangerously-skip-permissions`. `the-conversation-header.test.ts` §2 asserts that
    // disclosure clauses stay out of the mark while both facts remain in `yoloTitle`. This
    // block pins the visible word read by two live smoke steps using `/YOLO/`.
    expect(auto).toContain('Auto')
    expect(auto, 'the word it was named after is gone').not.toContain('AUTO')
    // ⚠️ **And the two clauses really are off this surface**, so the shortening is measured here
    // rather than only asserted one file over.
    // ⛔ **Over the rendered TEXT, not the rendered HTML** — Vue's SSR emits template comments
    // verbatim, and `SessionHeader.vue`'s own comment QUOTES the clauses to record the reversal.
    // 🔴 A negative over the raw string would have read a docblock and called it a surface, which
    // is `a-source-census-must-strip-prose-before-it-asserts` arriving through a render instead of
    // through a file read. ⚑ The paired positive is the line above: `YOLO` survives the strip.
    const seen = auto.replace(/<!--[\s\S]*?-->/g, ' ')
    expect(seen, 'the strip ate the mark as well').toContain('Auto')
    expect(seen).not.toContain('nothing is confined')
    expect(seen).not.toContain('nothing is asked')
    // Read-only up top: the toggle is on the agent card, and one `data-cy` cannot mean both.
    expect(auto).not.toContain('data-cy="card-approval"')
  })

  it('marks a requested change without wearing its colour (034/079 §6)', async () => {
    const html = await pane({
      record: record([], {
        ...META,
        settings: { ...META.settings, pendingReasoningEffort: { value: 'max' } },
      }),
    })

    expect(html).toContain('data-cy="live-settings-pending"')
    expect(html).toContain('max requested')
    // …and the chip still states what is RUNNING, which is the whole point of marking the other.
    expect(html).toContain('data-cy="provider-chip"')
  })

  it('a queued approval change is marked too, though 079 only named model and effort', async () => {
    // The most safety-relevant of the four pending things. Leaving it as the one with nowhere to
    // show would be 074's defect: the UI stating less than it knows.
    const html = await pane({
      record: record([], { ...META, pendingApprovalMode: 'auto' }),
    })
    expect(html).toContain('approvals off requested')
  })

  it('nothing is marked pending when nothing is', async () => {
    // Non-vacuity for the two above: a marker that always rendered would satisfy both.
    const html = await pane()
    expect(html).not.toContain('data-cy="live-settings-pending"')
    // Draw a surviving settings cell on this same render, in effect and unmarked. Without
    // that positive, “nothing is marked pending” would pass on a blank pane. The absent
    // marker is therefore tested against a surface that demonstrably rendered its settings. ⚑ The shelf's plan cell left with its four
    // settings, so the reading is the bar's provider chip — the setting the bar states, unmarked.
    // The usage cells left the conversation for the title bar.
    expect(html).toMatch(/data-cy="provider-chip"[^>]*><span class="dot"[^>]*><\/span>claude</)
  })
})

describe('one drawer, every tab live (079 §2 → 096 → 508)', () => {
  it('renders every tab, and there is no reserved slot left', async () => {
    const html = await drawer()
    for (const tab of DRAWER_TABS) expect(html).toContain(`data-cy="drawer-tab-${tab.id}"`)
    // ⚠️ **The count is gone from the titles rather than corrected** (458's rule): a number in
    // prose outlives the derivation that made it true, and *six* had already survived one dispatch
    // that changed it. ⛔ The COUNT itself is asserted in `conversation-chrome.test.ts`, where the
    // comment beside it says what re-measuring it cost; here the claim is that every member of the
    // list renders, which is true at any length.
    expect(DRAWER_TABS.length, 'the strip renders nothing at all').toBeGreaterThan(0)
    // ⚠️ **The `for (const slot of RESERVED_TABS)` loop that used to sit here is GONE, not kept for
    // symmetry** (096 review). `RESERVED_TABS` is empty, so it iterated zero times and asserted
    // nothing while reading as coverage — the project's own recurring failure, and leaving it would
    // have been the nineteenth instance. The claim it can still make is this one:
    expect(
      RESERVED_TABS,
      'a slot is reserved again — restore the loops these tests dropped',
    ).toEqual([])
  })

  it('nothing on the strip is disabled any more, and the reserved copy is gone with it', async () => {
    const html = await drawer()
    for (const tab of DRAWER_TABS)
      expect(tag(html, `drawer-tab-${tab.id}`)).not.toContain('disabled')
    // The positive that stops the line above being a claim about an empty page: the phrase that
    // marked a slot as unbuilt appears nowhere on the strip, and the tabs themselves are there.
    expect(html).not.toContain('Reserved; not built yet')
    expect(html).toContain('data-cy="drawer-tab-changes"')
  })

  it('shows one tab’s body at a time, and it is the one marked active', async () => {
    const open = await drawer({ tab: 'open' })
    expect(open).toContain('data-cy="session-panel"')
    expect(open).not.toContain('data-cy="session-info"')
    expect(tag(open, 'drawer-tab-open')).toContain('data-active="true"')
    expect(tag(open, 'drawer-tab-info')).toContain('data-active="false"')

    const events = await drawer({ tab: 'events' })
    expect(events).toContain('data-cy="event-stream"')
    expect(events).not.toContain('data-cy="session-panel"')

    const info = await drawer({ tab: 'info' })
    expect(info).toContain('data-cy="session-info"')
    expect(info).toContain('data-cy="session-cwd"')
    expect(info).not.toContain('data-cy="event-stream"')
  })

  it('only the ACTIVE tab carries its label — at both widths, all six present (088 §2)', async () => {
    // Draw text only on the active drawer tab; inactive tabs show only icons. Exactly one
    // label is visible, so width does not need to choose which labels to hide.
    for (const fit of ['comfortable', 'narrow'] as const) {
      const open = await drawer({ fit, tab: 'open' })
      expect(open, `${fit}: the active tab lost its label`).toContain('>Open</span>')
      for (const quiet of ['Events', 'Info', 'Changes']) {
        expect(open, `${fit}: ${quiet} is labelled while inactive`).not.toContain(
          `>${quiet}</span>`,
        )
      }

      // …and the label MOVES with the active tab rather than Open being special.
      const info = await drawer({ fit, tab: 'info' })
      expect(info, `${fit}: the label did not move`).toContain('>Info</span>')
      expect(info).not.toContain('>Open</span>')

      // ⚠️ The assertion that matters, unchanged from 079: every tab is STILL THERE as an icon. A
      // strip that dropped a tab — or hid one behind a "more" menu — would be hiding an attention
      // signal, which is the hazard the whole model exists for.
      // RESERVED_TABS was spread in here and is empty since 096, contributing zero iterations under a
      // comment that said "every tab" — dropped rather than left reading as coverage (review).
      for (const tab of DRAWER_TABS) {
        expect(open, `${tab.id} vanished at ${fit}`).toContain(`data-cy="drawer-tab-${tab.id}"`)
      }
    }
  })

  it('and the underline is gone, with the label and the ink carrying active instead (088 §3)', async () => {
    // The tab has no underline and retains the alternative active marker. Assert both
    // together; use a source assertion for the style because SSR has no computed styles.
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/SessionDrawer.vue', import.meta.url)),
      'utf8',
    )
    // ⚠️ Scoped to the style block AND stripped of comments. Two earlier versions of these three
    // lines went red on the prose that explains the removal — the comment naming the deleted rule
    // is inside the `<style>` block, so scoping alone was not enough. A source assertion that can
    // be satisfied, or broken, by its own documentation is the shape that has caught this project
    // before.
    const styles = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(styles).not.toContain('border-bottom-color: var(--accent)')
    expect(styles).not.toMatch(
      /border-bottom: (?:2px|var\(--border-accent-width\)) solid transparent/,
    )
    // The positive pairing: `active` still styles something, and the label is still conditional.
    expect(styles).toMatch(/\.tab\.active \{[^}]*color: var\(--text\)/)
    expect(styles).toMatch(/\.tab\.active \{[^}]*font-weight/)
    // …and 080's width-driven mechanism is DELETED rather than left dormant (088 §2). Checked
    // against the SCRIPT with its comments stripped, for the same reason as the styles above: the
    // comment that explains the deletion is free to name the thing it deleted, and a maintenance
    // note that did so would otherwise turn this green assertion red for saying something true.
    const script = source
      .slice(0, source.indexOf('</script>'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(script).not.toContain('iconOnly')
    // The positive pairing: the script is not empty and the label is still decided, just per-tab.
    expect(script).toContain('attentionTraces')

    // In the markup: the active tab is the one that is marked as such and the one with the words.
    const html = await drawer({ tab: 'events' })
    expect(tag(html, 'drawer-tab-events')).toContain('data-active="true"')
    expect(tag(html, 'drawer-tab-open')).toContain('data-active="false"')
    expect(html).toContain('>Events</span>')
  })

  it('floats over the transcript with a scrim rather than crushing it', async () => {
    const docked = await drawer({ fit: 'docked' })
    const floating = await drawer({ fit: 'overlay' })

    expect(docked).not.toContain('drawer-scrim')
    expect(floating).toContain('drawer-scrim')
    expect(tag(floating, 'session-drawer')).toContain('data-fit="overlay"')
  })

  it('the agent card holds the four that left the bar, each a press', async () => {
    const html = await drawer({
      tab: 'open',
      session: {
        ...META,
        blanketGrants: ['Bash', 'Write'],
        settings: { ...META.settings, model: 'claude-opus-5', reasoningEffort: 'high' },
      },
    })

    // ⚑ UI-012 · the model and its effort open the one model picker; plan first and the approval
    // mode sit beside them — all four presses on a conversation whose settings reach it.
    expect(tag(html, 'card-run-model')).toMatch(/^<button/)
    expect(tag(html, 'card-run-effort')).toMatch(/^<button/)
    expect(tag(html, 'card-run-plan')).toMatch(/^<button/)
    expect(tag(html, 'card-approval')).toMatch(/^<input/)
    // App reading appearance belongs to the titlebar, outside conversation-specific controls.
    expect(html).not.toContain('data-cy="toggle-chat-theme"')
    // 034/076's rule, said where the change is asked for.
    expect(tag(html, 'card-run-plan')).toContain('from your next message')

    // 🔴 **529 · and the grants are NOT here** (`HO-050` §1.2): a thing you can only read is on
    // Info, as the test below pins. ⚑ The label the row wears there is drawn nowhere on this tab.
    expect(html).not.toContain(NOT_ASKED_AGAIN)
    expect(html).not.toContain('data-cy="info-grants"')
  })

  it('🔴 529 · …and Info holds them, because a thing you can only read is not a control', async () => {
    const html = await drawer({
      tab: 'info',
      session: { ...META, blanketGrants: ['Bash', 'Write'] },
    })

    // ⚠️ Grants are LISTED, not managed — there is no revoke anywhere in this app, so a button
    // would be a control that cannot do what it says. What it must do is say how they end.
    expect(html).toContain('data-cy="info-grants"')
    expect(html).toContain('Bash')
    // ⛔ **The sentence is behind the row's fold** since `527` made this panel an index, so the
    // render carries the trigger rather than the words — `356 §1`'s rule for this surface.
    expect(html).toContain('data-cy="info-why-grants"')
    // ⚠️ **739 · re-aimed, not stripped** (rule 26): the sentence behind the fold is
    // `HOW_THESE_GRANTS_END` now — `736` F-1: *"`GRANTS_END_WITH_THE_CONVERSATION` would be false of
    // a kept Codex tool"* — so the old clause was absent from every render and this had gone
    // vacuous. ⚑ Still: the words are behind the fold, and the label over the row is on the line.
    expect(html).not.toContain(HOW_THESE_GRANTS_END)
    expect(html).toMatch(new RegExp(`<dt\\b[^>]*>${NOT_ASKED_AGAIN}</dt>`))

    // ⛔ **The paired absence, so the row is conditional rather than always drawn.** A
    // conversation that granted nothing gets no row at all and the panel is what it was.
    const none = await drawer({ tab: 'info' })
    expect(none).toContain('data-cy="session-info"')
    expect(none).not.toContain('data-cy="info-grants"')
  })

  it('uses a real Ask/Auto switch on the agent card', async () => {
    const asking = await drawer({ tab: 'open' })
    expect(tag(asking, 'card-approval')).toContain('role="switch"')
    expect(tag(asking, 'card-approval')).toContain('data-mode="ask"')
    expect(asking).not.toContain('data-cy="card-approval-confirm"')
    expect(asking).not.toContain('data-cy="card-approval-panel"')
  })

  it.each(['ask', 'auto'] as const)(
    'the bar and the card switch both state a conversation running in %s',
    async (mode) => {
      const meta: CreatedSession = {
        ...META,
        approvalMode: mode,
        approvalNote: `approvals: ${mode}`,
      }
      const bar = await pane({ record: record([], meta) })
      const mark = tag(bar, 'session-approval-indicator')
      // The pill's own text, not its title, which names the mode as well.
      const word = bar.slice(bar.indexOf(mark) + mark.length).match(/^(?:<[^>]*>)*([^<]*)/)?.[1]
      expect(word?.trim()).toBe(mode === 'auto' ? 'Auto' : 'Ask')
      const card = tag(await drawer({ session: meta, tab: 'open' }), 'card-approval')
      expect(card).toContain(`data-mode="${mode}"`)
      expect(/\schecked(?=[\s>=/])/.test(card)).toBe(mode === 'auto')
    },
  )
})

describe('the attention model, built (079 §5)', () => {
  it('drawer SHUT: the count and the amber pill are on screen, and so is the card', async () => {
    const html = await pane({ drawerOpen: false })

    // Trace 1 — outside the drawer, and shouting because the drawer is shut.
    expect(tag(html, 'toggle-session-panel')).toContain('data-waiting="1"')
    expect(tag(html, 'toggle-session-panel')).toContain('data-urgent="true"')
    expect(html).toContain('data-cy="session-panel-badge"')
    // Trace 2 — the top bar states it in words, independent of the drawer entirely: the one
    // state's *Needs you* since UI-008 (F051).
    expect(tag(html, 'session-status')).toContain('data-status="waiting_permission"')
    expect(html).toContain('Needs you')
    // Trace 5 — the card is still inline in the transcript, so the drawer is never the only route.
    expect(html).toContain('data-cy="permission-card"')
    // And the list itself is genuinely not on screen, which is what makes this a real test.
    expect(html).not.toContain('data-cy="session-drawer"')
  })

  it('drawer OPEN on Info: the Open tab is dotted and the bar names what is waiting', async () => {
    const html = await pane({ drawerOpen: true, drawerTab: 'info' })

    expect(html).toContain('data-cy="drawer-tab-attention"')
    expect(html).toContain('data-cy="drawer-attention-bar"')
    expect(html).toContain('1 waiting on you')
    // One click to it — and it is an offer, never a jump made for you.
    expect(html).toContain('data-cy="drawer-show-open"')
    expect(html).toContain('Show in Open')
    // The tab you are on is still Info: nothing moved you.
    expect(tag(html, 'drawer-tab-info')).toContain('data-active="true"')
    expect(tag(html, 'drawer-tab-open')).toContain('data-active="false"')
    // The two outside traces do not stand down because the drawer happens to be open.
    expect(tag(html, 'toggle-session-panel')).toContain('data-waiting="1"')
    expect(html).toContain('Needs you')
  })

  it('drawer OPEN on Open: dotted, but no bar — you are looking at the list', async () => {
    const html = await pane({ drawerOpen: true, drawerTab: 'open' })

    expect(html).toContain('data-cy="drawer-tab-attention"')
    expect(html).not.toContain('data-cy="drawer-attention-bar"')
    // Paired positive: the list it would have pointed at is right there.
    expect(html).toContain('data-cy="session-panel"')
    expect(html).toContain('data-cy="panel-permissions"')
  })

  it('answered: every trace clears, on every tab and either way round', async () => {
    const settled = record([
      permission('req_1'),
      { type: 'user_decision', requestId: 'req_1', outcome: 'allow' },
      { type: 'request_resolved', id: 'req_1' },
      { type: 'status', state: 'working' },
    ])

    for (const drawerOpen of [true, false]) {
      for (const drawerTab of ['open', 'info'] as DrawerTab[]) {
        const html = await pane({ record: settled, drawerOpen, drawerTab })
        const where = `open=${drawerOpen} tab=${drawerTab}`
        expect(html, where).not.toContain('data-cy="session-panel-badge"')
        expect(html, where).not.toContain('data-cy="drawer-tab-attention"')
        expect(html, where).not.toContain('data-cy="drawer-attention-bar"')
        expect(tag(html, 'toggle-session-panel'), where).toContain('data-urgent="false"')
        expect(tag(html, 'session-status'), where).toContain('data-status="working"')
      }
    }
  })

  it('an UNATTENDED session is no exception — the traces are outside the drawer for this', async () => {
    // 063's rule, and the reason the badge and the pill live on the bar rather than in the panel:
    // a blocked card has to show without opening anything, whoever is or is not watching.
    const html = await pane({
      drawerOpen: false,
      record: record([permission('req_1'), { type: 'status', state: 'waiting_permission' }], {
        ...META,
        approvalMode: 'auto',
        approvalNote: 'approvals: auto',
      }),
    })

    expect(html).toContain('data-cy="session-panel-badge"')
    expect(html).toContain('Needs you')
    expect(html).toContain('data-cy="permission-card"')
    // ⚑ **`579` relay 3b · the mark is one word now** — see the §1 block above for the reversal it
    // records. ⛔ What this line is FOR is unchanged: an unattended session still SAYS so on the
    // bar, without the drawer being open, which is `063`'s rule and the whole of this test.
    expect(html).toContain('data-cy="session-approval-indicator"')
    expect(html).toContain('Auto')
  })
})

describe('the reading light covers the whole pane, drawer included', () => {
  it('is scoped ONCE, on the pane, so nothing inside it can be left behind', async () => {
    // The drawer and reading column share one light scope. Splitting scopes could leave a
    // future column, image viewer, or overlay scrim outside the body theme.
    const html = await pane({ drawerOpen: true })

    expect(html.match(/data-chat-theme="light"/g)?.length).toBe(1)
    expect(tag(html, 'conversation-pane')).toContain('data-chat-theme="light"')
    // The drawer carries none of its own — it INHERITS, which is the whole point. A drawer with its
    // own attribute would be a second boundary and could disagree with the one above it.
    expect(tag(html, 'session-drawer')).not.toContain('data-chat-theme')
  })

  it('…and there is no longer a dark branch for it to disagree with (344)', async () => {
    // The pane is always paper, with no `chatLight` branch. Verify `data-chat-theme` remains
    // functional: it says `light`, never `dark`, on both the drawer-open and plain renders.
    const open = await pane({ drawerOpen: true })
    const shut = await pane({ drawerOpen: false })
    for (const html of [open, shut]) {
      expect(html).not.toContain('data-chat-theme="dark"')
      expect(html.match(/data-chat-theme="light"/g)?.length).toBe(1)
    }
    // ⚠️ The pane must not have kept a prop that no longer does anything. Read from the source,
    // because a leftover `chatLight: boolean` would be silently satisfied by every call above.
    //
    // ⛔ **With its PROSE removed, and that is not tidiness.** The pane's own template comment
    // explains, in words, that `chatLight` is the thing 344 removed — so the first version of this
    // line went red over a sentence describing its own success. A `toContain` in the same shape
    // fails the other way and is silent. Same fix as `conversation-chrome.test.ts`'s `source()`.
    const code = readFileSync(
      fileURLToPath(
        new URL('../src/renderer/src/components/ConversationPane.vue', import.meta.url),
      ),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toContain('chatLight')
    // Paired positive: the strip left real code behind, so the absence above is a finding.
    expect(code).toContain('data-chat-theme="light"')
  })
})
