import { afterEach, describe, expect, it } from 'vitest'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { page } from 'vitest/browser'
import { assertDrawn, drawnReady } from './drawn'
import { defineComponent, h, nextTick, type PropType, type VNode } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import AllFilesDialog from '../../src/renderer/src/components/AllFilesDialog.vue'
import AllTasksDialog from '../../src/renderer/src/components/AllTasksDialog.vue'
import ContextDialog from '../../src/renderer/src/components/ContextDialog.vue'
import HumanAnswerDialog from '../../src/renderer/src/components/HumanAnswerDialog.vue'
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
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import FilesTaskPicker from '../../src/renderer/src/components/FilesTaskPicker.vue'
import ScheduledJobDialog from '../../src/renderer/src/components/ScheduledJobDialog.vue'
import SessionTools from '../../src/renderer/src/components/SessionTools.vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import type { ToolRegistry } from '../../src/renderer/src/lib/transcript'
import type {
  AgentIdentities,
  ChildWorkResult,
  WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { aRoster, anIdentity } from './identity-fixture'

const NOW = 1_700_000_000_000

/** ⚠️ The identity keeps its pre-369 `agp:` id: nothing here reads the id's shape. */
const identities = (over: Partial<AgentIdentities> = {}): AgentIdentities =>
  aRoster([anIdentity('pm', { id: 'agp:default:pm', createdAt: NOW })], [], over)

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

/**
 * ⚠️ **One stub for the whole file, installed before anything mounts.** `useAgentStore` memoises
 * the bridge at first call and is a module singleton, so a per-test stub is captured by the first
 * test and ignored by every later one: a stable object over mutable state. ⚑ **D-016** took the
 * project doors (and the folder check only the project sheets asked) out of it, with the panels.
 */
;(window as unknown as { api?: unknown }).api = {
  runtime: {
    providerCatalogue: async () => PROVIDER_DESCRIPTORS,
    checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
    apiKeyStatus: async ({ provider }: { provider: string }) => ({
      provider,
      set: false,
      setAt: null,
      inUse: false,
    }),
    providerVersions: async () => ({}),
    providerSetup: async () => ({}),
    providerUsage: async () => ({}),
    providerResources: async () => ({
      claude: { running: 0, at: NOW, rssBytes: 0, cpuPercent: 0 },
      codex: { running: 0, at: NOW, rssBytes: 0, cpuPercent: 0 },
    }),
    onProvidersChanged: () => () => {},
    modelList: async ({ provider }: { provider: string }) => ({
      provider,
      notAsked: null,
      standIn: null,
      models: [],
      lastPicked: null,
      startsOn: null,
    }),
    keptRules: async () => ({ claude: [], codex: [] }),
    agentIdentities: async () => identities(),
    setExternalMcpServers: async () => identities().identities[0],
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
const PATHS = [
  {
    host: 'HumanAnswerDialog',
    panel: 'HumanAnswerDialog',
    cy: 'human-answer-dialog',
    selfHosted: true,
    open: () =>
      h(HumanAnswerDialog, {
        answer: {
          promptOrdinal: 1,
          prompt: '# Fictional question\n\n' + 'Please compare the bakery recipes.\n\n'.repeat(80),
          final: {
            ordinal: 2,
            at: NOW,
            text:
              '| Recipe | Notes |\n| --- | --- |\n| Bread | ' +
              'long-note'.repeat(80) +
              ' |\n\n```text\n' +
              'long-code'.repeat(100) +
              '\n```\n\nLast answer paragraph.',
          },
        },
      }),
  },
  {
    host: 'FilesTaskPicker',
    panel: 'FilesTaskPicker',
    cy: 'files-task-picker',
    selfHosted: true,
    open: () =>
      h(FilesTaskPicker, {
        includeSubtasks: true,
        read: async () => ({
          type: 'tasks' as const,
          snapshot: 'fictional-tasks',
          readAt: 1,
          stale: false,
          metrics: { rows: 0, bytes: 0, elapsedMs: 1, cacheBytes: 0 },
          tasks: [],
          total: 0,
          next: null,
        }),
      }),
  },
  {
    host: 'ProvidersScreen',
    panel: 'ProviderCard',
    cy: 'provider-drawer',
    selfHosted: true,
    open: () =>
      h(ProvidersScreen, {
        setupProvider: 'codex',
        capabilities: null,
        warnings: null,
        clock: NOW,
        style: 'position:fixed;inset:100px 0 0 52px',
      }),
  },
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
  // The screen's host branch count is read from its source in §3.
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

        provider: 'claude',
        capability: null,
        conversation: null,
      }),
  },
  // F093 · the pane's eighth host: "Instructions, memory and tools", opened from the Open tab's door.
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
          path: '/fictional/kept/004-response.md',
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

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('Overlay dialogs', () => {
  it('keeps the long human answer scrollable, its close button reachable, and Tab inside the dialog', async () => {
    const path = PATHS.find((one) => one.host === 'HumanAnswerDialog')!
    const m = await overlay(path.open, 1180, 808, true)
    const dialog = m.q('human-answer-dialog')
    const close = dialog.querySelector<HTMLButtonElement>('button')!
    expect(document.activeElement).toBe(close)
    tab(true)
    await nextTick()
    expect(dialog.contains(document.activeElement)).toBe(true)
    tab()
    await nextTick()
    expect(dialog.contains(document.activeElement)).toBe(true)
    const scroll = dialog.querySelector<HTMLElement>('.answer-scroll')!
    expect(getComputedStyle(scroll).overflowY).toBe('auto')
    scroll.scrollTop = 0
    expect(scroll.scrollTop).toBe(0)
    scroll.scrollTop = scroll.scrollHeight
    await nextTick()
    expect(scroll.scrollTop).toBeGreaterThan(0)
    const last = m.q('human-answer-final').querySelector<HTMLElement>(':scope > :last-child')!
    expect(last.textContent).toContain('Last answer paragraph')
    await drawnReady()
    assertDrawn(last, 'last answer paragraph after scrolling', scroll)
    expect(m.q('human-answer-final').querySelector('table')).not.toBeNull()
    expect(m.q('human-answer-final').querySelector('pre code')).not.toBeNull()
    expect(reachable(close)).toBe(true)
    const originalStyle = last.getAttribute('style')
    try {
      last.style.height = '0px'
      last.style.overflow = 'hidden'
      expect(() => assertDrawn(last, 'planted clipped answer paragraph', scroll)).toThrow()
    } finally {
      if (originalStyle === null) last.removeAttribute('style')
      else last.setAttribute('style', originalStyle)
    }
    scroll.scrollTop = scroll.scrollHeight
    await nextTick()
    assertDrawn(last, 'restored last answer paragraph', scroll)
  })

  for (const path of PATHS) {
    it(`${path.host} → ${path.panel} opens inside its overlay`, async () => {
      const m = await overlay(path.open, 1180, 808, 'selfHosted' in path)
      expect(m.q('overlay-host').contains(m.q(path.cy))).toBe(true)
    })
  }

  it.each([
    [1440, 1000],
    [840, 760],
    [460, 760],
  ])('opens each overlay at %s × %s', async (width, height) => {
    for (const path of PATHS) {
      unmountAll()
      const m = await overlay(path.open, width, height, 'selfHosted' in path)
      expect(m.all(path.cy).length, path.panel).toBeGreaterThan(0)
    }
  })

  it('🔴 the panel is still centred in the window', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    const sheet = m.q('capabilities-sheet').getBoundingClientRect()
    const host = m.q('overlay-host').getBoundingClientRect()
    expect(sheet.width, 'the sheet did not render').toBeGreaterThan(100)
    expect(
      Math.abs(sheet.left + sheet.width / 2 - (host.left + host.width / 2)),
      'the panel is off centre',
    ).toBeLessThan(1)
  })

  it('🔴 opening a dialog focuses its panel', async () => {
    const m = await overlay(() => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }))
    const active = document.activeElement as HTMLElement | null
    expect(active, 'nothing was focused when the dialog opened').not.toBe(null)
    expect(m.q('capabilities-sheet').contains(active)).toBe(true)
  })

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
