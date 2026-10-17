import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { drawerProps, META } from '../../test/dom/harness'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { defineComponent, h, type Component } from 'vue'
import { hiddenDrawerTabs } from '../../src/renderer/src/lib/developer-views'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'

/**
 * 🎨 **The right panel** — the agent's card with its Sub agents and tasks, as the `right-panel` and
 * `context-popup` scenes draw it. ⚑ Fake data only: change CHILDREN and GIVEN for another.
 */
const NOW = Date.now()
const CHILDREN = [
  { conversation: 'sess_ada', identity: 'designer' },
  { conversation: 'sess_ali', identity: 'developer' },
]
const GIVEN = [
  {
    piece: 'work_1',
    label: 'W1.2',
    title: 'Landing page header',
    to: 'sess_ada',
    toIdentity: 'designer',
    state: 'working',
  },
  {
    piece: 'work_2',
    label: 'W1.3',
    title: 'Contact form',
    to: 'sess_ali',
    toIdentity: 'developer',
    state: 'answered',
  },
]

const walk = <Row>(rows: readonly Row[], walk: string) =>
  ({ rows, walk, ledgers: rows.length, rowsUnread: 0 }) as never

const READ: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>(
    CHILDREN.map((one) => ({ ...one, provider: 'claude', running: 'unwatched' })),
    'every-conversation-this-one-spawned',
  ),
  workGivenOut: walk<WorkEdge>(
    GIVEN.map((one) => ({
      ...one,
      from: META.sessionId,
      fromIdentity: 'default',
      givenAt: NOW - 600_000,
      endedAt: one.state === 'answered' ? NOW - 60_000 : null,
    })) as never,
    'every-conversation-this-one-gave-work-to',
  ),
  workTakenIn: walk<WorkEdge>(
    [
      {
        piece: 'work_0',
        label: 'W1',
        title: 'Build the bakery website with the team',
        from: 'sess_pm',
        fromIdentity: 'pm',
        to: META.sessionId,
        toIdentity: 'default',
        state: 'working',
        givenAt: NOW - 3_600_000,
        endedAt: null,
      },
      {
        piece: 'work_a',
        label: 'W0.4',
        title: 'Pick the bakery’s brand colours',
        from: 'sess_pm',
        fromIdentity: 'pm',
        to: META.sessionId,
        toIdentity: 'default',
        state: 'answered',
        givenAt: NOW - 86_400_000,
        endedAt: NOW - 80_000_000,
      },
      {
        piece: 'work_b',
        label: 'W0.5',
        title: 'Draft the menu copy',
        from: 'sess_pm',
        fromIdentity: 'pm',
        to: META.sessionId,
        toIdentity: 'default',
        state: 'closed',
        givenAt: NOW - 70_000_000,
        endedAt: NOW - 60_000_000,
      },
    ] as never,
    'every-piece-of-work-this-one-was-given',
  ),
  readAt: NOW,
  // ⚑ W4.203 · the ended developer's last report: model, effort and context with its time.
  lastReported: {
    sess_ali: {
      model: 'claude-sonnet-5-5',
      modelFrom: 'its-provider',
      effort: 'high',
      effortFrom: 'its-setting',
      context: { reading: { kind: 'tokens', used: 141_404 }, at: NOW - 2_400_000 },
    },
  },
}

const FILES = Array.from({ length: 9 }, (_, at) => ({
  resourceId: `res_${at}`,
  title: ['icon-1024.png', 'palette.png', 'menu.pdf', 'logo.svg', 'copy-notes.md'][at % 5]!,
  name: ['icon-1024.png', 'palette.png', 'menu.pdf', 'logo.svg', 'copy-notes.md'][at % 5]!,
  form: null,
  bytes: 1200,
  role: 'made',
  keptAt: NOW - at * 60_000,
  sha256: 'a'.repeat(64),
  addedBy: { conversation: META.sessionId, profile: 'default' },
  piece: at < 5 ? 'work_1' : 'work_2',
  label: at < 5 ? 'W1.2' : 'W1.3',
  pieceTitle: at < 5 ? 'Landing page header' : 'Contact form',
}))

export const SESSION = {
  ...META,
  cwd: '/Users/someone/work/bakery',
  settings: { ...META.settings, model: 'claude-opus-5-5[1m]', reasoningEffort: 'xhigh' },
}

/** ⚑ What the agent changed in its folder, for the Changes tab. */
const DIFF =
  '@@ -1,4 +1,6 @@\n <header class="site-header">\n-  <img src="logo.svg" height="28">\n+  <img src="logo.svg" height="40" alt="Bakery">\n+  <nav class="site-nav">\n'
const CHANGED = [
  { path: 'src/components/SiteHeader.vue', status: 'modified', added: 24, removed: 6, diff: DIFF },
  { path: 'src/pages/Menu.vue', status: 'added', added: 118, removed: 0, diff: DIFF },
  { path: 'src/styles/brand.css', status: 'modified', added: 12, removed: 3, diff: DIFF },
  { path: 'public/logo-old.svg', status: 'deleted', added: 0, removed: 41, diff: DIFF },
]

/** ⚑ The window's cast channel: the agents around this one, their telemetry and its files. */
export function setTheCast(): void {
  window.api = {
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  } as never
  const cast = useWhoCalledWhom()
  cast.reading.value = {
    conversation: META.sessionId,
    read: READ,
    answered: true,
    atWork: {
      readAt: NOW,
      conversations: [
        {
          conversation: 'sess_ada',
          identity: 'designer',
          told: { said: 'nothing', because: 'nothing-has-arrived' },
          status: 'running',
          streaming: false,
          since: NOW - 60_000,
          context: { kind: 'tokens', used: 240_000 },
        },
        {
          conversation: 'sess_ali',
          identity: 'developer',
          told: { said: 'nothing', because: 'nothing-has-arrived' },
          status: 'idle',
          streaming: false,
          since: NOW - 600_000,
          context: null,
        },
      ],
    } as never,
  }
  cast.railSays.value = new Map([
    [
      'sess_ada',
      {
        facets: { doing: 'tool', being: 'live' },
        word: 'working',
        model: 'claude-opus-5-5[1m]',
        effort: 'xhigh',
      },
    ],
    [
      'sess_ali',
      {
        facets: { doing: 'idle', being: 'live' },
        word: 'idle',
        model: 'claude-sonnet-5-5',
        effort: 'high',
      },
    ],
  ]) as never
  cast.processMemory.value = new Map([
    [META.sessionId, 442_000_000],
    ['sess_ada', 310_000_000],
  ])
  cast.goTo.value = () => {}
  cast.cardFiles.value = { conversation: META.sessionId, files: FILES, answered: true } as never
}

/** ⚑ The conversation's own events, with their times, as the ledger replays them. */
export function panelEvents(): [unknown, number][] {
  return [
    [
      {
        type: 'user_turn',
        text: 'Build the bakery website with the team: the header, the menu and the contact form. Keep the brand colours, and check each page on a phone before you call it done.',
        relayedFrom: 'sess_pm',
        relayedFromProfile: 'pm',
        piece: 'work_0',
        label: 'W1',
      },
      NOW - 3_600_000,
    ],
    // ⚑ W4.208 · two compactions, for the Context popup's history.
    [
      {
        type: 'compaction',
        source: 'compact_boundary',
        compactionId: 'c1',
        before: 182_000,
        after: 41_000,
      },
      NOW - 2_700_000,
    ],
    [
      {
        type: 'compaction',
        source: 'compact_boundary',
        compactionId: 'c2',
        before: 176_000,
        after: 38_000,
      },
      NOW - 1_500_000,
    ],
    [
      {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 224_000 },
        source: 'message_start',
      },
      NOW - 960_000,
    ],
    [{ type: 'file_change', changes: CHANGED, source: 'turn/diff/updated' }, NOW - 950_000],
    [
      {
        type: 'assistant_message',
        text: 'It’s under way but not finished: the header is done, the menu is with Ada, and Ali is on the contact form.',
      },
      NOW - 960_000,
    ],
  ]
}

/**
 * ⚑ Sets the cast and returns the pane holding the drawer, ready to mount. `over` is merged into
 * the drawer's props: another tab, the work it gave out, and so on.
 */
export function rightPanelStage(over: Record<string, unknown> = {}): Component {
  setTheCast()
  const state = createTranscript()
  const events = panelEvents()
  events.forEach(([event, at], index) => applyEvent(state, event as never, at, index + 1))
  // ⚑ The drawer as the window draws it: inside the conversation pane's light surface
  // (`ConversationPane`'s `data-chat-theme="light"`), with the developer tabs hidden as they are
  // outside debug mode.
  const Pane = defineComponent({
    setup: () => () =>
      h(
        'section',
        {
          'data-chat-theme': 'light',
          class: 'conversation-pane',
          // ⚑ The drawer's real width, whatever the picture's: 360–560 px, as the window docks it.
          style:
            'display:flex;width:clamp(var(--drawer-w-min),100%,var(--drawer-w-max));height:100%;background:var(--chat-bg)',
        },
        [
          h(
            SessionDrawer as never,
            drawerProps({
              identities: null,
              session: SESSION,
              state,
              shown: state,
              hiddenTabs: hiddenDrawerTabs(false),
              facets: { doing: 'tool', being: 'live' },
              onRevealPath: async () => ({ ok: true }),
              capabilities: CAPABILITY_FIXTURE,
              compaction: {
                state: 'idle',
                closing: false,
                signInSuperseded: false,
                hasQueued: false,
                compactionIsWaiting: false,
                who: 'default',
              },
              ...over,
            }),
          ),
        ],
      ),
  })
  return Pane
}
