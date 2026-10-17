import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType, type VNode } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import AllFilesDialog from '../../src/renderer/src/components/AllFilesDialog.vue'
import AllTasksDialog from '../../src/renderer/src/components/AllTasksDialog.vue'
import ContextDialog from '../../src/renderer/src/components/ContextDialog.vue'
import DeleteConversation from '../../src/renderer/src/components/DeleteConversation.vue'
import { createTranscript } from '../../src/renderer/src/lib/transcript'
import AgentSectionsSheet from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ExternalMcpRegistry from '../../src/renderer/src/components/ExternalMcpRegistry.vue'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import ToolAnswerViewer from '../../src/renderer/src/components/ToolAnswerViewer.vue'
import ImageViewer from '../../src/renderer/src/components/ImageViewer.vue'
import NewAgent from '../../src/renderer/src/components/NewAgent.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import ScheduledJobDialog from '../../src/renderer/src/components/ScheduledJobDialog.vue'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import SessionTools from '../../src/renderer/src/components/SessionTools.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import type { ToolRegistry } from '../../src/renderer/src/lib/transcript'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  ChildWorkResult,
  WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **390 · a stop a modal cannot cover.**
 *
 * ## ⛔ The defect, and it is not the one 385 fixed
 *
 * `385 §3` moved the global spawn stop out of the rail's scroller so a long list could not carry it
 * off the bottom of the screen. ✅ **That fix is real and `rail-rhythm.dom.test.ts` proves it.**
 * ⛔ **It is not the whole invariant.** `388` measured `529649c`:
 *
 * > Every `OverlayHost` is a fixed `inset: 0` `aria-modal` layer with a focus trap; **it
 * > deliberately covers the rail.** `rail-spawning` remains beneath that layer in `SideRail`'s
 * > anchored rail-bottom, **so it cannot be clicked or tabbed to while a modal is open. No current
 * > test exercises that cross-layer state.**
 *
 * ⚠️ **The modal is not broken.** Its isolation and its focus trap are correct and every assertion
 * in §5 exists to keep them that way. ⚑ **What was missing is a safety decision**, and the PM made
 * it: *the emergency stop for new spawns stays reachable while a modal is open* — because a person
 * reaches for an emergency stop at the worst moment, not at a convenient one.
 *
 * ## ⚑ Where the control lives, and why that is the shape of the census
 *
 * ⛔ **`OverlayHost` draws it, once, for every overlay in the app.** The alternative — a copy in
 * each panel's header, which is where the v2.5 standalone puts it — is a rule eleven components
 * have to remember, and HO-013 §3 is at the head of this project's standing rules for that exact
 * failure: *"a rule that must be remembered each time is a rule that will eventually be
 * forgotten."*
 *
 * ⚠️ **So the census below is not decoration.** Hosting it makes the control PRESENT everywhere; it
 * does not make it REACHABLE everywhere, because reachability is a question about the panel in
 * front of it. §2 opens every path with its real panel and asks the question a person asks: is the
 * thing I am pointing at the thing that gets the click.
 *
 * ## ⚠️ In the DOM project, and there is no SSR version of any of this
 *
 * `elementFromPoint` needs a real compositor, a focus trap needs real key events, and *"the rail is
 * covered"* is a statement about two layers of a real layout. ⛔ **The viewport is shared across
 * this whole directory**, so it is captured before the first resize and restored after every test.
 */

/* ------------------------------------------------------------------------------ the fixtures */

const NOW = 1_700_000_000_000

const identities = (over: Partial<AgentIdentities> = {}): AgentIdentities => ({
  identities: [
    {
      id: 'agp:default:pm',
      slug: 'pm',
      displayName: null,
      createdAt: NOW,
      // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
      createdBy: null,
      provider: null,
      // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    },
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  // 500 · required on `AgentIdentities`; none of these fixtures is about the launch default.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
  ...over,
})

const CHILD: ChildWorkResult = {
  ok: true,
  part: 'transcript',
  name: 'agent-a4d82f4376e9dd5c5.jsonl',
  runId: 'wf_7658bea5-b25',
  taskId: 'waw6gpzzj',
  text: '{"type":"assistant_message","text":"Done."}',
  truncated: false,
  bytes: 43,
  entries: [{ type: 'assistant_message', text: 'Done.' }],
}

const OUTPUT: WorkflowOutputResult = {
  ok: true,
  name: 'journal.jsonl',
  text: '{"agent":1,"result":"ok"}',
  truncated: false,
  bytes: 25,
}

const TOOLS: ToolRegistry = { set: null, dropped: 0, at: null }

/** A provider's setup at its install step: the widest, with the command and its Copy. */
const SETUP_AT_INSTALL = {
  provider: 'claude',
  version: {
    version: null,
    reason: 'Not found.',
    program: {
      standing: 'missing',
      from: null,
      path: null,
      version: null,
      tested: { oldest: '2.1.0', newest: '2.1.290' },
      said: 'Not found on this computer.',
      help: { label: 'How to install', url: 'https://example.com/install' },
      update: null,
      others: [],
      updatedFrom: null,
    },
  },
  setup: {
    tool: 'The Tool',
    install: { command: `install ${'a'.repeat(200)}`, docs: 'https://example.com/docs' },
    signInCommand: 'the-tool',
    platform: 'macOS',
    shell: 'Terminal',
  },
  auth: { state: 'absent', reason: 'Never signed in.' },
  keyRefused: false,
  signIn: { state: 'absent', reason: 'Signs in with its command.', checkedAgainst: 'test' },
  reprovision: { state: 'absent', reason: 'Nothing to copy.', checkedAgainst: 'test' },
  busy: 'idle',
  notice: null,
  recheck: async () => undefined,
} as const

/**
 * ⚠️ **One stub for the whole file, installed before anything mounts.** `useAgentStore` memoises
 * the bridge at first call and is a module singleton, so a per-test stub is captured by the first
 * test and ignored by every later one: a stable object over mutable state. ⚑ **D-016** took the
 * project doors (and the folder check only the project sheets asked) out of it, with the panels.
 */
;(window as unknown as { api?: unknown }).api = {
  runtime: {
    agentIdentities: async () => identities(),
    setCapabilities: async () => identities().identities[0],
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
    listResumable: async () => [],
    listUnresumable: async () => [],
    // The delete sheet reads its list as it opens: a path with no break in it is its widest state.
    checkDeleteConversation: async () => ({
      ok: true,
      conversation: 'sess_1',
      name: 'W1 · Bakery website',
      helpers: [],
      parts: [
        {
          id: 'records',
          kind: 'records',
          says: 'Its messages, pieces of work and the files kept for them, and its questions.',
          conversation: 'sess_1',
          paths: [],
          bytes: null,
        },
        {
          id: 'files:sess_1',
          kind: 'provider-files',
          says: 'Its transcript and what the provider kept for it (1 item).',
          conversation: 'sess_1',
          paths: [`/homes/pm/projects/${'a'.repeat(300)}.jsonl`],
          bytes: 2_048,
        },
      ],
      ends: [],
      stays: ['Copies of what it sent to other conversations stay in theirs.'],
      cannot: ['The recovery copies in the data folder still hold its records.'],
    }),
  },
  chooseCwd: async () => null,
}

/* ------------------------------------------------------------------------------- the harness */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const safety = useSpawnSafety()
/** Every press either surface makes, in order, so a test can see WHICH state was written. */
let pressed: boolean[] = []

/**
 * 🔴 **THE CENSUS — every `OverlayHost` path in the app, with the panel it really opens.**
 *
 * ⛔ **Not a representative one.** Whether the safety lane can be clicked depends on the size and
 * the paint order of what is in front of it, and that is a different answer per panel. The paths
 * are grouped by the component that raises the host, which is how §3's source census counts them.
 *
 * ⚠️ **`RuntimeScreen` switches panels in its main host and opens linked history in another**; `ConversationPane` and
 * `ReadingPane` raise their own, and the `ReadingPane` panels are the same components
 * `ConversationPane` opens — which is why the panel count is larger than the mount-site count.
 *
 * 🔴 **No count is written here** (444). This docblock said *"eleven different answers"* and
 * *"seven branches"* while the list below held fifteen entries and §3's own assertion derived
 * nine; `423` added `NewAgent` and `StartAsAgent` and the prose did not follow.
 * ⚠️ **`PATHS.length` is NOT asserted anywhere in this file and this sentence does not pretend it
 * is** — what §3 checks is the `RuntimeScreen` SLICE of it, against a branch count read out of
 * that component's own source, plus a mount-site count. ⛔ So the honest statement is: the numbers
 * that are checked live where they are checked, and no number lives in this paragraph.
 * `a-number-can-survive-the-death-of-its-derivation`.
 */
const PATHS = [
  {
    host: 'WorkSearchDialog',
    panel: 'WorkSearchDialog',
    cy: 'work-search',
    selfHosted: true,
    open: () =>
      h(WorkSearchDialog, {
        conversation: 'sess_1',
        canOpen: false,
        search: async () => ({
          ok: true as const,
          page: {
            hits: [],
            searched: 0,
            rows_unread: 0,
            ledgers_skipped: 0,
            complete: true,
            next_cursor: null,
          },
        }),
      }),
  },
  {
    host: 'ScheduleBar',
    panel: 'ScheduledJobDialog',
    cy: 'scheduled-job-dialog',
    open: () =>
      h(ScheduledJobDialog, {
        job: {
          id: 'bakery',
          schedule: '21 12 8 10 *',
          recurring: false,
          prompt: 'Recipe '.repeat(100),
        },
        now: NOW,
      }),
  },
  // ⚑ **D-016** — the screen's host lost six branches with the seed and the projects: the document
  // drawer, the dispatch gate, the recruit and all-documents sheets, the project sheet and the
  // new-project form. §3 reads the branch count from the source, so it moved with them.
  // 423 · a branch of the screen's one host. ⚑ It takes no props: the overlay member carries
  // nothing, because there is no identity to name until this sheet makes one.
  { host: 'RuntimeScreen', panel: 'NewAgent', cy: 'new-agent', open: () => h(NewAgent) },
  // 423 relay 1 · the app's second launch door.
  {
    host: 'RuntimeScreen',
    panel: 'StartAsAgent',
    cy: 'start-as-agent',
    // 500 · the two props the sheet now reads to disclose the launch default. `null` is *the
    // roster read has not landed*, which is this fixture's state and is not about approvals.
    open: () =>
      h(StartAsAgent, {
        profileSlug: 'archivist',
        provider: 'codex',
        defaultApprovalMode: null,
        capabilities: null,
      }),
  },
  {
    host: 'RuntimeScreen',
    panel: 'CapabilitiesSheet',
    cy: 'capabilities-sheet',
    open: () => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }),
  },
  // 626 · what shapes one agent, read from the Team page with no conversation
  // open (`EXT-015` §1). ⚑ Mounted with a slug and nothing else, exactly as `CapabilitiesSheet`
  // above it is: both sheets read their own answer through `useAgentStore`, which is what makes the
  // overlay member a slug rather than a snapshot.
  {
    host: 'RuntimeScreen',
    panel: 'AgentSectionsSheet',
    cy: 'agent-sections-sheet',
    open: () => h(AgentSectionsSheet, { profileSlug: 'pm', agentName: 'Pat' }),
  },
  // 516 · the screen's host's external MCP registry. ⚑ It takes no
  // props: the overlay member carries nothing, because the registry is app-wide and this surface is
  // about all of it rather than about one row.
  {
    host: 'RuntimeScreen',
    panel: 'ExternalMcpRegistry',
    cy: 'external-mcp-registry',
    open: () => h(ExternalMcpRegistry),
  },
  // The confirmation before a conversation is deleted, with its list read and its paths drawn.
  {
    host: 'RuntimeScreen',
    panel: 'DeleteConversation',
    cy: 'delete-conversation',
    open: () => h(DeleteConversation, { sessionId: 'sess_1' }),
  },
  {
    host: 'ConversationPane',
    panel: 'ImageViewer',
    cy: 'image-viewer',
    open: () => h(ImageViewer, { path: '/tmp/shot.png' }),
  },
  {
    host: 'ConversationPane',
    panel: 'WorkflowOutputViewer',
    cy: 'workflow-output-viewer',
    open: () => h(WorkflowOutputViewer, { result: OUTPUT, workflow: 'find-flaky-tests' }),
  },
  {
    host: 'ConversationPane',
    panel: 'SessionTools',
    cy: 'session-tools',
    open: () => h(SessionTools, { tools: TOOLS }),
  },
  // 527 · the pane's seventh host. ⚑ **`HO-050` §1.1's wide surface** — the agent's composed
  // instructions, its memory and the files the provider loaded, opened from the Info tab's index
  // entry. ⛔ **Its widest state is the one measured**: the sheet caps at
  // `min(780px, 100% - 2 × --lane-clear)`, and the second term IS this file's gutter — so a sheet
  // that stopped deriving from `--lane-w` would sit on the stop at the narrow widths.
  {
    host: 'ConversationPane',
    panel: 'AgentInstructionsSheet',
    cy: 'agent-sheet',
    open: () =>
      h(AgentInstructionsSheet, {
        relaunched: false,
        instructions: {
          injected: [
            {
              kind: 'workspace-instructions',
              path: '/work/checkout/CLAUDE.md',
              text: 'Use conventional commits.',
              bytes: 1240,
              truncated: false,
            },
          ],
          agentMemory: [],
          provider: [{ path: '/work/checkout/AGENTS.md', scope: 'project' as const }],
          refused: [],
          note: 'read at launch; searched 2 directories',
          recallsReported: false,
          writesReported: false,
          composed: '# BroBot\n\nAnswer in short sentences.',
        },
      }),
  },
  // W4.183 · the agent panel's two popups, at their widest: every piece, and every file.
  {
    host: 'SessionPanel',
    panel: 'AllTasksDialog',
    cy: 'all-tasks-dialog',
    open: () =>
      h(AllTasksDialog, {
        tasks: [],
        root: { label: 'W1', title: 'a'.repeat(300) },
        canOpen: false,
        state: createTranscript(),
      }),
  },
  {
    host: 'SessionPanel',
    panel: 'AllFilesDialog',
    cy: 'all-files-dialog',
    open: () => h(AllFilesDialog, { files: [], canOpen: false }),
  },
  // The agent panel's Context popup, opened from the context figure.
  {
    host: 'SessionPanel',
    panel: 'ContextDialog',
    cy: 'context-dialog',
    open: () =>
      h(ContextDialog, {
        state: createTranscript(),
        mode: 'normal',
        provider: 'claude',
        capability: null,
        conversation: null,
      }),
  },
  // F093 · the pane's eighth host: "What this agent receives", opened from the Open tab's door.
  {
    host: 'ConversationPane',
    panel: 'AgentInputPopup',
    cy: 'input-popup',
    open: () =>
      h(AgentInputPopup, {
        sessionId: 'sess_1',
        provider: 'claude',
        who: 'Ada',
        profile: null,
        state: null,
        startLoaded: true,
      }),
  },
  // 510 · the pane's sixth host, and the reading pane's third — ⛔ **640 · and since the fold,
  // NEITHER**: all three surfaces mount one `CanonicalDocumentOverlay`, which raises the host.
  // ⚑ **The three rows below are kept and only their `host` changed**, because what they measure
  // is a STATE of the panel and not a mount site: the widest body, a `changed` refusal and a
  // `no-store` refusal (no resources folder) each sit differently over the safety lane. ⚑ **Its
  // widest state is the one measured** — a file whose longest line has no break opportunity in
  // it, because the paper wraps rather than scrolling the panel sideways and a rule that let it
  // grow instead would be the gutter case this file exists for.
  {
    host: 'CanonicalDocumentOverlay',
    panel: 'CanonicalDocumentViewer',
    cy: 'canonical-document-viewer',
    open: () =>
      h(CanonicalDocumentViewer, {
        result: {
          ok: true,
          form: 'markdown',
          resourceId: 'res_4d2c3b1a5e6f4a7b8c9d0e1f2a3b4c5d',
          name: '004-response.md',
          text: `# the answer\n\n${'a'.repeat(300)}\n`,
          bytes: 320,
        },
      }),
  },
  {
    host: 'CanonicalDocumentOverlay',
    panel: 'CanonicalDocumentViewer',
    cy: 'canonical-document-viewer',
    open: () =>
      h(CanonicalDocumentViewer, {
        result: { ok: false, reason: 'changed' },
      }),
  },
  // 550 · the project room was the app's third surface to open this viewer, and `640` folded all
  // three into one component. ⛔ Its `no-store` arm (the app keeps no resources folder) is the one
  // measured here, because the two rows above already measure the widest body and a `changed`
  // refusal.
  {
    host: 'CanonicalDocumentOverlay',
    panel: 'CanonicalDocumentViewer',
    cy: 'canonical-document-viewer',
    open: () =>
      h(CanonicalDocumentViewer, {
        result: { ok: false, reason: 'no-store' },
      }),
  },
  {
    host: 'ConversationPane',
    panel: 'ChildWorkViewer',
    cy: 'child-work-viewer',
    open: () => h(ChildWorkViewer, { result: CHILD, label: 'fixture:overflow' }),
  },
  // 462 · the pane's fifth host. ⚑ **Its widest state is the one that is measured** — a payload with
  // no break opportunities in it, because the panel wraps rather than scrolling sideways and a rule
  // that let it grow instead would be the gutter case this file exists for.
  {
    host: 'ConversationPane',
    panel: 'ToolAnswerViewer',
    cy: 'tool-answer-viewer',
    open: () =>
      h(ToolAnswerViewer, {
        name: 'mcp__brobot__list_projects',
        answer: {
          parts: [
            { text: 'Six projects, and you may send work into all of them.', dropped: 0 },
            {
              text: JSON.stringify({ outcome: 'ok', count: 6, projects: ['a'.repeat(300)] }),
              dropped: 0,
            },
          ],
          partsDropped: 0,
        },
        canAsk: true,
      }),
  },
  {
    host: 'ReadingPane',
    panel: 'WorkflowOutputViewer',
    cy: 'workflow-output-viewer',
    open: () => h(WorkflowOutputViewer, { result: OUTPUT, workflow: 'find-flaky-tests' }),
  },
  {
    host: 'ReadingPane',
    panel: 'ChildWorkViewer',
    cy: 'child-work-viewer',
    open: () => h(ChildWorkViewer, { result: CHILD, label: 'fixture:overflow' }),
  },
  // ⚑ **D-017b · the kept-open pane's two hosts (`701`) went with the pane**: a conversation the quit
  // left open opens in the one full view, whose hosts are `ConversationPane`'s above.
  // A provider's setup, from its card's Set up and by itself at launch.
  {
    host: 'ProviderCard',
    panel: 'ProviderSetupWizard',
    cy: 'provider-setup-dialog',
    open: () => h(ProviderSetupWizard, SETUP_AT_INSTALL),
  },
  {
    host: 'ProviderSetupAtLaunch',
    panel: 'ProviderSetupWizard',
    cy: 'provider-setup-dialog',
    open: () => h(ProviderSetupWizard, SETUP_AT_INSTALL),
  },
] as const

const Layer = defineComponent({
  name: 'OverlayUnderTest',
  props: { open: { type: Function as PropType<() => unknown>, required: true } },
  setup: (props) => () => h(OverlayHost, { label: 'A sheet' }, { default: () => [props.open()] }),
})

/**
 * ⚠️ **A 10px box.** `OverlayHost` is `position: fixed`, so a wide host div would silently supply
 * the width the VIEWPORT is supposed to — `session-tools.dom.test.ts`'s note, and it matters twice
 * as much here because the whole question is which layer is on top at a real coordinate.
 */
async function overlay(
  open: () => VNode,
  width = 1180,
  height = 808,
  selfHosted = false,
): Promise<Mounted> {
  await page.viewport(width, height)
  const host = selfHosted ? defineComponent({ setup: () => () => open() }) : Layer
  const m = mount(host, { open }, { width: 10, height: 10 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

/**
 * ⛔ **The question a person asks: is the thing I am pointing at the thing that gets the click.**
 *
 * Presence is not reachability — `388`'s whole finding is about a control that was present, painted,
 * and under another layer — so this is `elementFromPoint` at the element's own centre, and the
 * element passes only if the point lands on it or inside it.
 */
function reachable(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return false
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return at !== null && element.contains(at)
}

/** A real Tab, at the window, where `OverlayHost` listens. */
function tab(shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
}

beforeEach(() => {
  pressed = []
  safety.supply(identities(), (enabled) => pressed.push(enabled))
})

afterEach(async () => {
  unmountAll()
  safety.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ---------------------------------------------------- §1 · the defect, with the app's own material */

describe('§1 · what the overlay layer does to the rail (388 §3)', () => {
  /**
   * 🔴 **The control for everything below, and it is the defect itself.** With a modal open, the
   * rail's own switch is not the element a click at its coordinates reaches — so `385 §3`'s
   * anchoring, which is real, is a guarantee about SCROLLING and about nothing else.
   */
  it('🔴 the rail’s own switch is covered by an open overlay', async () => {
    const Shell = defineComponent({
      name: 'RailUnderAnOverlay',
      props: { modal: { type: Boolean, required: true } },
      setup: (props) => () =>
        h('div', { style: 'display:flex;width:100%;height:100%' }, [
          h(SideRail, { open: [], activeId: null, place: null, agents: identities() }),
          props.modal
            ? h(OverlayHost, { label: 'A sheet' }, { default: () => [h(NewAgent)] })
            : null,
        ]),
    })
    await page.viewport(1180, 808)

    // ⚑ **The pair first**: with nothing open, the rail's switch really is reachable — otherwise the
    // assertion below is about a control that was never clickable in this fixture at all.
    const bare = mount(Shell, { modal: false }, { width: 1180, height: 808 })
    await nextTick()
    expect(reachable(bare.q('rail-spawning'))).toBe(true)
    bare.unmount()

    const covered = mount(Shell, { modal: true }, { width: 1180, height: 808 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    const railSwitch = covered.q('rail-spawning')
    expect(
      railSwitch.getBoundingClientRect().height,
      'the rail switch is not drawn',
    ).toBeGreaterThan(0)
    expect(reachable(railSwitch), 'the overlay no longer covers the rail').toBe(false)

    // ⛔ …and what IS at that point is the overlay layer, rather than nothing at all.
    const box = railSwitch.getBoundingClientRect()
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    expect(covered.q('overlay-host').contains(at)).toBe(true)

    // 🔴 **And the answer to it, in the same fixture**: the stop is reachable anyway.
    expect(reachable(covered.q('overlay-spawning'))).toBe(true)
  })
})

/* ------------------------------------------------------------------- §2 · the census of the paths */

describe('§2 · every OverlayHost path carries a reachable stop (390 §3)', () => {
  for (const path of PATHS) {
    it(`⛔ ${path.host} → ${path.panel}`, async () => {
      const m = await overlay(path.open, 1180, 808, 'selfHosted' in path)
      // The panel really opened — a census over overlays that failed to render would pass every
      // assertion below and measure nothing.
      expect(m.all(path.cy).length, `${path.panel} did not render`).toBeGreaterThan(0)

      const lane = m.q('overlay-spawning')
      expect(reachable(lane), `${path.panel} covers the stop`).toBe(true)
      expect(lane.textContent).toContain('Spawning is on')

      // ⛔ **Inside the host**, which is what puts it inside the trap and inside the light scope.
      expect(m.q('overlay-host').contains(lane)).toBe(true)

      // …and it is the control, not a label: one press writes the state.
      lane.click()
      await nextTick()
      expect(pressed).toEqual([false])
    })
  }

  /**
   * ⚑ **At 1440 × 1000 as well as at the app's own floor**, because the widest panels sit in the
   * gutter the lane occupies and the gutter is a function of the window. ⚠️ The two widths are the
   * two this project photographs.
   */
  it('⚠️ …and at the other size anybody photographs', async () => {
    for (const path of PATHS) {
      unmountAll()
      const m = await overlay(path.open, 1440, 1000, 'selfHosted' in path)
      expect(reachable(m.q('overlay-spawning')), `${path.panel} covers the stop at 1440`).toBe(true)
    }
  })
})

/* ------------------------------------------------------- §3 · a census a new overlay cannot escape */

describe('§3 · the mount sites are counted from the source (390 §3)', () => {
  /**
   * ⛔ **The list above is a claim about the app, so it is checked against the app.** An overlay
   * added tomorrow in a component nobody thought about would leave {@link PATHS} short, and every
   * test in §2 would still pass — which is the exact shape of a census that reads as stronger than
   * it is.
   *
   * ⚠️ **Standing rule 12: the control plants TWO.** A walk that stopped at the first `<OverlayHost`
   * in a file would report `ConversationPane` as one site and miss three, which is `store.create(`'s
   * defect one dispatch over.
   */
  it('🔴 every <OverlayHost mount site in the renderer is in the census', async () => {
    const sources = import.meta.glob('../../src/renderer/src/components/*.vue', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    const found = new Map<string, number>()
    for (const [file, text] of Object.entries(sources)) {
      const name = file.split('/').pop()!.replace('.vue', '')
      if (name === 'OverlayHost') continue
      const count = (text.match(/<OverlayHost[\s>]/g) ?? []).length
      if (count > 0) found.set(name, count)
    }

    // ⛔ The control: the walk really does see more than one per file.
    expect(found.get('ConversationPane'), 'the walk stopped at the first host in a file').toBe(7)
    expect(found.get('ReadingPane')).toBe(2)
    // ⚑ **D-017b** — the kept-open pane (`701`'s two) is gone: one full view for every conversation.
    expect(found.has('KeptOpenPane')).toBe(false)
    // An archived conversation's history is a page now, not a popup: one host is left.
    expect(found.get('RuntimeScreen')).toBe(1)
    // ⚑ **550 · a fourth host**, and it arrived exactly the way this census exists to catch one:
    // a component nobody on this file had thought about grew an overlay of its own.
    // 🔴 **640 · and then three of them became one.** `ConversationPane` and `ReadingPane` each
    // lost the document host and `ProjectWorkspace` lost its only one; `CanonicalDocumentOverlay`
    // raises it for all three. ⚠️ **The census going DOWN is the deliverable** — this is the
    // instrument that measures *one mount per kind*, so it is read here rather than asserted
    // somewhere new.
    expect(found.get('CanonicalDocumentOverlay')).toBe(1)
    expect(found.has('ProjectWorkspace')).toBe(false)
    expect(found.get('ProviderCard')).toBe(1)
    expect(found.get('ProviderSetupAtLaunch')).toBe(1)
    expect([...found.keys()].sort()).toEqual([
      'CanonicalDocumentOverlay',
      'ConversationPane',
      'ProviderCard',
      'ProviderSetupAtLaunch',
      'ReadingPane',
      'RuntimeScreen',
      'ScheduleBar',
      // ⚑ W4.183 · the agent panel's "All tasks" and "View all" popups.
      'SessionPanel',
      'WorkSearchDialog',
    ])

    // …and the census covers every one of them, with nothing invented.
    const censused = new Set(PATHS.map((path) => path.host))
    expect([...censused].sort()).toEqual([...found.keys()].sort())
    const sites = [...found.values()].reduce((all, one) => all + one, 0)
    expect(sites, 'a mount site appeared that this file has never opened').toBe(18)
  })

  /**
   * ⛔ **The screen really supplies the state, and nothing in `ci` can mount it to find out.**
   *
   * ⚠️ **`211` §11, `212` §9 and `214` §8 each filed the same gap and it is still open**: nothing in
   * this repository mounts `RuntimeScreen`. So the one hop that makes every assertion in this file
   * about the RUNNING app — the store's identities reaching the module, and `setSpawning` reaching
   * it as the commit — is asserted at the source or it is asserted nowhere.
   *
   * ⚑ **Both halves, because they fail differently**: a screen that supplies no state draws no stop
   * anywhere, and a screen that supplies a commit which writes nothing draws a stop that does not
   * stop.
   */
  it('🔴 the screen supplies the module from the store, and setSpawning as the commit', async () => {
    const screen = (
      (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
        default: string
      }
    ).default
    const call = /safety\.supply\(([^)]*\)?[^)]*)\)/.exec(screen)
    expect(call, 'RuntimeScreen no longer supplies the spawn safety module').not.toBe(null)
    expect(call![1]).toContain('agentStore.identities.value')
    expect(call![1]).toContain('setSpawning')
    // ⛔ …and it is re-supplied on every read, not once at mount.
    expect(screen).toContain('watchEffect(() => {\n  safety.supply(')
  })

  /**
   * ⛔ **And the second half: `RuntimeScreen`'s main host has a branch per panel**, so a census that
   * counted HOSTS would have opened one of those sheets and called the whole layer covered.
   *
   * ⚑ **The count below is read from `RuntimeScreen` itself** and then checked against this file's
   * own list, so the two cannot drift apart; the literal is the value that derivation currently
   * yields, and it is the one thing here a new branch is meant to move.
   */
  it('⚠️ …and the screen’s main host branches each have their own path', async () => {
    const screen = (
      (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
        default: string
      }
    ).default
    const host = screen.slice(screen.indexOf('<OverlayHost'), screen.indexOf('</OverlayHost>'))
    const branches = (host.match(/overlays\.overlay\.value\.kind === '(\w+)'/g) ?? []).length
    // ⚑ **D-016 · eleven → five**: the six seed and project panels went with their branches.
    // ⚑ Five → six: the delete confirmation.
    expect(branches).toBe(6)
    expect(PATHS.filter((path) => path.host === 'RuntimeScreen')).toHaveLength(branches)
  })
})

/* ------------------------------------------------------------------- §4 · the paired negative */

describe('§4 · the assertion fails when the stop is absent (390 §3)', () => {
  /**
   * 🔴 **An assertion no mutation can kill is not carrying its rule.**
   *
   * ⛔ **The planted control is the app one line back**: a fixed `inset: 0` `aria-modal` layer with
   * a panel on it and NO safety lane, which is what every path in §2 was until this dispatch. The
   * same two questions are asked of it, and both answer the other way.
   */
  it('🔴 a modal layer with no lane in it fails the same two questions', async () => {
    await page.viewport(1180, 808)
    const Bare = defineComponent({
      name: 'AModalThatForgotTheStop',
      setup: () => () =>
        h(
          'div',
          {
            'data-cy': 'bare-host',
            'aria-modal': 'true',
            role: 'dialog',
            style:
              'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(3,5,8,0.58)',
          },
          [h(NewAgent)],
        ),
    })
    const m = mount(Bare, {}, { width: 10, height: 10 })
    await nextTick()

    // ⛔ It is a real modal — it renders its panel and it covers the window.
    expect(m.all('new-agent').length).toBeGreaterThan(0)
    expect(m.q('bare-host').getBoundingClientRect().width).toBe(1180)

    // …and the stop is nowhere in it.
    expect(m.all('overlay-spawning')).toHaveLength(0)

    // ⚑ **The pair, in the same test**: the SAME panel inside the real host answers the other way.
    m.unmount()
    const hosted = await overlay(() => h(NewAgent))
    expect(hosted.all('overlay-spawning')).toHaveLength(1)
    expect(reachable(hosted.q('overlay-spawning'))).toBe(true)
  })

  /**
   * ⚠️ **And the lane really is what `reachable()` is measuring.** A panel drawn ON TOP of the lane
   * fails the check — so a green §2 is a statement about paint order, not a statement about the
   * lane merely existing in the markup.
   */
  it('⛔ a panel painted over the lane is reported unreachable', async () => {
    const m = await overlay(() =>
      h('div', {
        'data-cy': 'a-panel-over-the-lane',
        style: 'position:fixed;inset:0;z-index:3;background:#fff',
      }),
    )
    expect(m.all('overlay-spawning')).toHaveLength(1)
    expect(m.q('overlay-spawning').getBoundingClientRect().height).toBeGreaterThan(0)
    expect(reachable(m.q('overlay-spawning'))).toBe(false)
  })

  /**
   * ⛔ **And the lane's `z-index` is a rule rather than a decoration**, so the hazard it defends
   * against is put on the path (`put-the-hazard-on-the-path-the-code-walks`).
   *
   * ⚠️ **The shape was `AllDocumentsSheet`'s, in the app until D-016 deleted it**: a `position:
   * sticky` table header with `z-index: 1`, inside a panel that is not itself positioned — so it
   * paints in the HOST's stacking context at level 1, which is where a lane at `auto` would also
   * be. A number no mutation could make observable would be a line carrying nothing.
   */
  it('⚠️ a z-index-1 element inside the panel does NOT cover it', async () => {
    const m = await overlay(() =>
      h('div', { 'data-cy': 'a-sticky-shaped-panel', style: 'position:relative' }, [
        h('div', {
          'data-cy': 'the-sticky-header',
          style:
            'position:absolute;left:-600px;top:-380px;width:1200px;height:800px;z-index:1;background:#fff',
        }),
      ]),
    )
    // The control: the planted element really does sit over the lane's corner.
    const lane = m.q('overlay-spawning').getBoundingClientRect()
    const planted = m.q('the-sticky-header').getBoundingClientRect()
    expect(planted.left, 'the plant does not reach the lane').toBeLessThan(lane.left)
    expect(planted.bottom).toBeGreaterThan(lane.bottom)
    expect(reachable(m.q('overlay-spawning'))).toBe(true)
  })
})

/* -------------------------------------------------------------- §5 · one state, drawn on two layers */

describe('§5 · the rail and the lane are two views of ONE state (390 §2)', () => {
  const Both = defineComponent({
    name: 'RailAndOverlay',
    setup: () => () =>
      h('div', { style: 'display:flex;width:100%;height:100%' }, [
        h(SideRail, { open: [], activeId: null, place: null, agents: identities() }),
        h(OverlayHost, { label: 'A sheet' }, { default: () => [h(NewAgent)] }),
      ]),
  })

  async function both(): Promise<Mounted> {
    await page.viewport(1180, 808)
    const m = mount(Both, {}, { width: 1180, height: 808 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    return m
  }

  /**
   * 🔴 **The state moves once and both surfaces move with it** — including the armed confirm, which
   * is the state a person could most plausibly be shown twice with two different answers.
   */
  it('🔴 every state the switch has reads the same on both layers', async () => {
    const m = await both()
    const rail = (): string => m.q('rail-spawning-state').textContent!.trim()
    const lane = (): string => m.q('overlay-spawning-state').textContent!.trim()
    const railLine = (): string => m.q('rail-spawning-line').textContent!.trim()
    const laneLine = (): string => m.q('overlay-spawning-line').textContent!.trim()

    expect(rail()).toBe('Spawning is on')
    expect(lane()).toBe(rail())
    expect(laneLine()).toBe(railLine())

    safety.supply(identities({ spawningEnabled: false }), (enabled) => pressed.push(enabled))
    await nextTick()
    expect(rail()).toBe('Spawning is off')
    expect(lane()).toBe(rail())
    expect(laneLine()).toBe(railLine())

    // ⛔ The armed confirm, pressed on the LANE and read on the RAIL.
    m.q('overlay-spawning').click()
    await nextTick()
    expect(lane()).toBe('Turn spawning back on?')
    expect(rail()).toBe(lane())
    expect(railLine()).toBe(laneLine())
    expect(pressed, 'a single press widened what agents may do').toEqual([])

    // ⚑ …and the confirm is one switch, so the SECOND press can be made on the other surface.
    m.q('rail-spawning').click()
    await nextTick()
    expect(pressed).toEqual([true])
  })

  /**
   * ⛔ **The asymmetry survives the second surface** (355, `340`'s ruling applied to a gesture). Off
   * is one press from either layer; on is a press and a press, whichever layer they are made on.
   */
  it('⛔ one press stops spawning from the lane, exactly as from the rail', async () => {
    const m = await both()
    m.q('overlay-spawning').click()
    await nextTick()
    expect(pressed).toEqual([false])
  })

  /** ⚠️ …and the lane is honest about what the stop does NOT do. */
  it('⚠️ the lane says that nothing running was stopped', async () => {
    safety.supply(identities({ spawningEnabled: false }), (enabled) => pressed.push(enabled))
    const m = await both()
    expect(m.q('overlay-spawning-line').textContent).toContain('Nothing running was stopped')
  })

  /**
   * ⚠️ **Before the identities read lands there is no stop on either layer** — `355`'s `v-if`,
   * which the module answers for now. A kill switch drawn before anybody knows the answer is a
   * claim neither surface has earned.
   */
  it('⚠️ neither layer draws a stop before anything has been supplied', async () => {
    safety.forget()
    const m = await both()
    expect(m.all('rail-spawning')).toHaveLength(0)
    expect(m.all('overlay-spawning')).toHaveLength(0)
    // ⚑ The pair: with an answer, both are drawn.
    safety.supply(identities(), (enabled) => pressed.push(enabled))
    await nextTick()
    expect(m.all('rail-spawning')).toHaveLength(1)
    expect(m.all('overlay-spawning')).toHaveLength(1)
  })

  /**
   * 🔴 **The words are composed in ONE place**, so the two surfaces cannot drift apart in a way the
   * assertions above would not notice — a sentence retyped into a second template is how *"the rail
   * says one thing and a modal header says another"* actually arrives.
   */
  it('⛔ neither component composes the switch’s sentences for itself', async () => {
    const sources = import.meta.glob('../../src/renderer/src/**/*.{vue,ts}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    const named = (file: string): string => file.split('/').pop()!

    /**
     * ⛔ **A census that reads prose reads code wrong**, and this file proved it on itself: the
     * lane's own docblock quotes *"Nothing running was stopped"* to say why the line wraps, and the
     * first version of this assertion called that a second author of the sentence.
     */
    const withoutProse = (text: string): string =>
      text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

    // ⚑ **The control for the stripper, planted both ways round.** It must not be so eager that it
    // empties the file that DOES author the sentences, and it must really remove the one that only
    // talks about them — a stripper failing either way makes every assertion below vacuous.
    const lane = Object.entries(sources).find(([file]) => named(file) === 'SpawnStopLane.vue')![1]
    const module_ = Object.entries(sources).find(([file]) => named(file) === 'spawn-safety.ts')![1]
    expect(lane, 'the lane no longer explains itself').toContain('Nothing running was stopped')
    expect(withoutProse(lane)).not.toContain('Nothing running was stopped')
    expect(withoutProse(module_)).toContain('Nothing running was stopped')

    for (const sentence of [
      'Spawning is on',
      'Spawning is off',
      'Turn spawning back on?',
      'Nothing running was stopped',
    ]) {
      const carriers = Object.entries(sources)
        .filter(([, text]) => withoutProse(text).includes(sentence))
        .map(([file]) => named(file))
      expect(carriers, `"${sentence}" is written in more than one place`).toEqual([
        'spawn-safety.ts',
      ])
    }
  })
})

/* ------------------------------------------------------------------ §6 · the trap is not weakened */

describe('§6 · modal isolation is exactly as correct as it was (390 §2)', () => {
  /**
   * ⛔ **The host still lays out exactly ONE thing**, which is the whole reason the lane is out of
   * flow. `.overlay-host` is a centring flex container; a second IN-FLOW child would make the panel
   * one of two flex items and shift every sheet in the app sideways.
   */
  it('🔴 the panel is still centred in the window', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    const sheet = m.q('capabilities-sheet').getBoundingClientRect()
    const host = m.q('overlay-host').getBoundingClientRect()
    expect(sheet.width, 'the sheet did not render').toBeGreaterThan(100)
    expect(
      Math.abs(sheet.left + sheet.width / 2 - (host.left + host.width / 2)),
      'the safety lane pushed the panel off centre',
    ).toBeLessThan(1)
  })

  it('🔴 the lane does not take the focus a dialog opens with', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    const active = document.activeElement as HTMLElement | null
    expect(active, 'nothing was focused when the dialog opened').not.toBe(null)
    expect(
      m.q('overlay-spawning').contains(active),
      'the safety lane stole the dialog’s opening focus',
    ).toBe(false)
    expect(m.q('capabilities-sheet').contains(active)).toBe(true)
  })

  /**
   * ⚑ **One Shift+Tab from where a dialog opens.** The trap wraps at the ends, and the lane is the
   * last focusable inside the host — so a keyboard-only person reaches the stop in one keystroke
   * without the control ever having taken the focus in the first place.
   */
  it('🔴 one Shift+Tab from the opening focus lands on the stop', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    tab(true)
    await nextTick()
    expect(m.q('overlay-spawning').contains(document.activeElement)).toBe(true)
  })

  /**
   * ⛔ **And Tab off the end of it goes back INTO the dialog, not out of it.** This is the trap's
   * own wrap, measured from the element this dispatch added — the one place a new last-focusable
   * could have punched a hole in it.
   */
  it('🔴 Tab from the stop wraps back into the dialog', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    tab(true)
    await nextTick()
    expect(m.q('overlay-spawning').contains(document.activeElement)).toBe(true)

    tab()
    await nextTick()
    expect(
      m.q('overlay-host').contains(document.activeElement),
      'Tab walked out of the overlay',
    ).toBe(true)
    expect(m.q('capabilities-sheet').contains(document.activeElement)).toBe(true)
  })

  /**
   * ⚠️ **Pressing the stop does not dismiss what a person was doing.** `OverlayHost` closes on a
   * mousedown that STARTED on the backdrop; the lane is a child of the backdrop, so this is the
   * assertion that it is a child and not the backdrop itself.
   */
  it('⛔ pressing the stop does not close the overlay', async () => {
    let closes = 0
    const Watched = defineComponent({
      name: 'OverlayThatCounts',
      setup: () => () =>
        h(
          OverlayHost,
          { label: 'A sheet', onClose: () => (closes += 1) },
          { default: () => [h(NewAgent)] },
        ),
    })
    await page.viewport(1180, 808)
    const m = mount(Watched, {}, { width: 10, height: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    m.q('overlay-spawning').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    m.q('overlay-spawning').click()
    await nextTick()
    expect(closes, 'the stop closed the dialog it was pressed in').toBe(0)
    expect(pressed).toEqual([false])

    // ⚑ The pair: a mousedown that really did start on the backdrop still closes it.
    m.q('overlay-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(closes).toBe(1)
  })

  /** ⚠️ …and Escape still belongs to the dialog. */
  it('⚠️ Escape still closes', async () => {
    let closes = 0
    const Watched = defineComponent({
      name: 'OverlayThatCountsEscape',
      setup: () => () =>
        h(
          OverlayHost,
          { label: 'A sheet', onClose: () => (closes += 1) },
          { default: () => [h(NewAgent)] },
        ),
    })
    await page.viewport(1180, 808)
    mount(Watched, {}, { width: 10, height: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closes).toBe(1)
  })
})

/* ------------------------------------------------- §7 · the same claims at a window under 840 */

/**
 * 🔴 **`411` §6 item 2, closed** (444) — *"a ≤840 physical-window/DOM geometry case covering a
 * sheet/modal, the lane, focus order, occlusion and the direct stop action, BEFORE changing
 * layout."*
 *
 * ⚑ **Three of the five already existed and two did not.** `session-tools.dom.test.ts` has had a
 * 460 × 760 case since before `411` measured — sheet, lane and occlusion — and it demonstrates the
 * conflict rather than a non-overlap policy: below the 1000px breakpoint the sheet reaches INTO the
 * lane's band. ⛔ **Focus order and the direct stop press had no case at any width under 1180.**
 *
 * 🔴 **What keeps the stop pressable under an overlapping panel is `position: absolute`, NOT
 * `z-index: 2`** — measured while reviewing this dispatch's own diff, and it corrects a claim an
 * earlier draft of this block made. ⛔ **No panel root in the app is positioned**: all fifteen are
 * static flex children of the host, so the lane paints in the positioned step and wins at any
 * `z-index`. ⚠️ **Deleting `z-index: 2` leaves every assertion in this section GREEN** — verified
 * by applying it — and what kills that edit is §4's PLANTED `position: absolute; z-index: 1`
 * control at 1180, which predates this dispatch. ⚑ So the rule §7 carries is the lane's
 * POSITIONING, and `390` was right that the `z-index` row is a phantom against real panels.
 *
 * ⚠️ **Two widths, and they are the two ends of the band item 2 names**: 840 is its boundary and
 * 460 is `378`'s overlay fit floor — the width at which v2.6 argued two 210px bands leave 40px and
 * proposed a bottom band instead. ⛔ **This dispatch changes no layout.** It measures what the
 * shipped one does at those widths, which is what item 2 asked to happen first.
 *
 * 🔴 **What it does NOT measure, and the honest limit of the whole file**: nothing here is a
 * PHYSICAL window. `app-frame-window.test.ts` asserts the app never resizes itself and no script
 * in this repository drives a window narrower than the 1200 × 840 it opens at, so the physical half
 * of item 2's wording has no instrument. `--app-min-w` is 1180 and `#app` scrolls, so a person at a
 * 460px window sees a 1180px app with a horizontal bar — a different layout from the one measured
 * here, and one nothing in this repository mounts.
 */
describe('§7 · at a window under 840 (444, 411 §6 item 2)', () => {
  const NARROW = [840, 460] as const

  /** Do the two rects share any area — the BAND question, which is what `411` §2.1 is about. */
  function meets(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  }

  /**
   * ⛔ **Does this panel cover the exact point `reachable()` probes** — a different question from
   * `meets`, and the only one that decides a click.
   *
   * ⚠️ **A first draft of this section used `meets` as the guard for a reachability assertion and
   * that was wrong.** A panel can clip the lane's band by a pixel at the top and sit entirely
   * above the card's centre; the guard fills, the assertion passes, and `reachable()` has answered
   * about clear air. `an-assertion-can-be-satisfied-by-a-neighbouring-element`.
   */
  function coversTheProbe(panel: DOMRect, lane: DOMRect): boolean {
    const x = lane.left + lane.width / 2
    const y = lane.top + lane.height / 2
    return panel.left <= x && x <= panel.right && panel.top <= y && y <= panel.bottom
  }

  for (const width of NARROW) {
    it(`⛔ at ${String(width)}px every path still carries a reachable stop`, async () => {
      for (const path of PATHS) {
        unmountAll()
        const m = await overlay(path.open, width, 760, 'selfHosted' in path)
        expect(
          m.all(path.cy).length,
          `${path.panel} did not render at ${String(width)}`,
        ).toBeGreaterThan(0)
        expect(
          reachable(m.q('overlay-spawning')),
          `${path.panel} covers the stop at ${String(width)}px`,
        ).toBe(true)
      }
    })
  }

  /** Record which panels share the stop's coordinates, alongside the actual hit-test for each. */
  it('🔴 at 460px overlapping panels keep the stop reachable', async () => {
    const inBand: string[] = []
    const onThePoint: string[] = []
    for (const path of PATHS) {
      unmountAll()
      const m = await overlay(path.open, 460, 760, 'selfHosted' in path)
      const lane = m.q('overlay-spawning').getBoundingClientRect()
      const panel = m.q(path.cy).getBoundingClientRect()
      if (meets(panel, lane)) inBand.push(path.panel)
      if (coversTheProbe(panel, lane)) onThePoint.push(path.panel)
      expect(reachable(m.q('overlay-spawning')), `${path.panel} covers the stop`).toBe(true)
    }
    // ⛔ **The conflict is real at the band level** — this is `411` §2.1's subject, and without it
    // the line below would be a statement about panels that are simply somewhere else.
    expect(
      inBand.length,
      'no panel even reaches the lane’s band at 460px, so this width measures nothing',
    ).toBeGreaterThan(0)
    // Both panels reach behind the stop at this width. The hit-tests above must still pick the stop.
    expect(onThePoint, 'another panel now covers the stop’s own centre').toEqual(['SessionTools'])
  })

  /**
   * ⚑ **Focus order, at the narrow end** — §6 asks this at 1180 and `411` §6 item 2 asks it here.
   *
   * ⚠️ **Said plainly: the trap is width-invariant and this test cannot answer differently from
   * §6.** `OverlayHost`'s `FOCUSABLE` selector and its wrap have no geometry in them, so a defect
   * that showed here would show at 1180 too. ⛔ **It is kept because item 2 names focus order at
   * ≤840 as something that must be MEASURED there**, and because *"it cannot differ"* is a claim
   * about the trap that nothing had checked at a width where the lane is under a sheet — not
   * because it is a second instrument.
   */
  it('🔴 at 460px one Shift+Tab still lands on the stop, and Tab goes back into the dialog', async () => {
    const m = await overlay(
      () => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }),
      460,
      760,
    )
    // The control: the dialog opened with the focus, and it was not the lane that took it.
    expect(m.q('overlay-spawning').contains(document.activeElement)).toBe(false)
    expect(m.q('capabilities-sheet').contains(document.activeElement)).toBe(true)

    tab(true)
    await nextTick()
    expect(m.q('overlay-spawning').contains(document.activeElement)).toBe(true)

    tab()
    await nextTick()
    expect(
      m.q('overlay-host').contains(document.activeElement),
      'Tab walked out of the overlay',
    ).toBe(true)
    expect(m.q('capabilities-sheet').contains(document.activeElement)).toBe(true)
  })

  /**
   * ⛔ **The direct stop action, at the narrow end.** One press writes the state, and it does not
   * dismiss what the person was doing — the lane is a child of the backdrop rather than the
   * backdrop itself. ⚠️ **Width-invariant for the same reason as the focus test above**, and kept
   * for the same reason: item 2 asks for the press at ≤840, and a narrow window not changing the
   * answer is itself the thing nobody had measured.
   */
  it('🔴 at 460px one press stops spawning and does not close the overlay', async () => {
    let closes = 0
    const Watched = defineComponent({
      name: 'ANarrowOverlayThatCounts',
      setup: () => () =>
        h(
          OverlayHost,
          { label: 'A sheet', onClose: () => (closes += 1) },
          { default: () => [h(NewAgent)] },
        ),
    })
    await page.viewport(460, 760)
    const m = mount(Watched, {}, { width: 10, height: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    m.q('overlay-spawning').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    m.q('overlay-spawning').click()
    await nextTick()
    expect(pressed, 'the press at 460px wrote nothing').toEqual([false])
    expect(closes, 'the stop closed the dialog it was pressed in').toBe(0)

    // ⚑ The pair: a mousedown that really did start on the backdrop still closes it here too.
    m.q('overlay-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(closes).toBe(1)
  })

  /**
   * ⚠️ **The paired negative, re-run at this width** — §4's planted cover, so a green §7 is a
   * statement about paint order at 460 and not about `reachable()` having gone blind there.
   */
  it('⛔ …and a panel painted over the lane is still reported unreachable at 460px', async () => {
    const m = await overlay(
      () =>
        h('div', {
          'data-cy': 'a-panel-over-the-lane',
          style: 'position:fixed;inset:0;z-index:3;background:#fff',
        }),
      460,
      760,
    )
    expect(m.all('overlay-spawning')).toHaveLength(1)
    expect(m.q('overlay-spawning').getBoundingClientRect().height).toBeGreaterThan(0)
    expect(reachable(m.q('overlay-spawning'))).toBe(false)
  })
})
