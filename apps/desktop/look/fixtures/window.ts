import { defineComponent, h, nextTick, type Component } from 'vue'
import type { LookStage } from '../capture'
import type { Mounted } from '../../test/dom/harness'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { hiddenDrawerTabs } from '../../src/renderer/src/lib/developer-views'
import { RAIL_NARROW_BELOW } from '../../src/renderer/src/lib/rail-fold'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META, paneProps } from '../../test/dom/harness'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'
import { panelEvents, SESSION, setTheCast } from './right-panel'

/**
 * 🎨 **The whole window** — the rail, the conversation and the Agent panel docked beside it, at the
 * widths the window gives each: the rail's 208 px, and the panel between 360 and 560 px with the
 * transcript keeping its floor. Fake data: `right-panel.ts`.
 */
const NOW = Date.now()
const RAIL = [
  { id: META.sessionId, label: 'BroBot', profileId: 'default', title: 'W1 · Bakery website' },
  { id: 'sess_ada', label: 'Ada', profileId: 'designer', title: 'W1.2 · Landing page header' },
  { id: 'sess_ali', label: 'Ali', profileId: 'developer', title: 'W1.3 · Contact form' },
]

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Each provider's usage readings, for the shelf's four cells. */
const USAGE = {
  claude: [
    {
      window: 'five_hour',
      usedPercent: 28,
      resetsAt: NOW + 3 * HOUR + 12 * MIN + 30_000,
      at: NOW - 4 * MIN,
    },
    { window: 'seven_day', usedPercent: 61, resetsAt: NOW + 2 * DAY + 2 * HOUR, at: NOW - 4 * MIN },
  ],
  codex: [
    {
      window: 'a 5-hour window',
      usedPercent: 12,
      resetsAt: NOW + HOUR + 14 * MIN + 30_000,
      at: NOW - 2 * MIN,
    },
    {
      window: 'a 7-day window',
      usedPercent: 35,
      resetsAt: NOW + 4 * DAY + 2 * HOUR,
      at: NOW - 2 * MIN,
    },
  ],
}

export interface WindowStageOptions {
  /** Merged into the conversation pane's props: a wait it is in, who holds its work. */
  readonly pane?: Record<string, unknown>
  /** The window's title bar above it all, with its usage line. */
  readonly titleBar?: boolean
  /** The left menu collapsed to its icons, as the app draws it below its narrow width. */
  readonly railCollapsed?: boolean
  /** Events after the conversation's own, with their times. */
  readonly more?: readonly [unknown, number][]
}

/** Let reads, fonts and layout settle before a crop. */
export async function settle(): Promise<void> {
  await nextTick()
  await document.fonts.ready
  await new Promise((done) => setTimeout(done, 200))
}

/**
 * ⚑ The whole window, mounted, with its rail at the width the app gives it now (the wide rail at
 * 1400 px and up) rather than the stage's fixed 208 px, so a crop sits where the app draws it.
 */
export async function windowAtItsRailWidth(
  stage: LookStage,
  options: WindowStageOptions = {},
): Promise<Mounted> {
  const mounted = stage.mount(
    windowStage({ railCollapsed: stage.width < RAIL_NARROW_BELOW, ...options }),
    {},
  )
  await settle()
  const rail =
    mounted.host.querySelector<HTMLElement>('[data-cy="side-rail"]')?.parentElement ?? null
  if (rail && !(options.railCollapsed ?? stage.width < RAIL_NARROW_BELOW))
    rail.style.width = stage.width >= 1400 ? 'var(--rail-w-wide)' : 'var(--rail-w)'
  await settle()
  return mounted
}

/** ⚑ Sets the cast and the rail's list, and returns the window, ready to mount. */
export function windowStage(options: WindowStageOptions = {}): Component {
  setTheCast()
  window.api = {
    ...window.api,
    runtime: {
      providerUsage: async () => USAGE,
      onProvidersChanged: () => () => {},
      listResumable: async () =>
        RAIL.map((one, index) => ({
          sessionId: one.id,
          provider: 'claude',
          cwd: SESSION.cwd,
          status: 'idle',
          state: { is: 'idle' },
          label: one.label,
          profileId: one.profileId,
          named: { label: one.title.split(' · ')[0], title: one.title.split(' · ')[1] },
          updatedAt: NOW - index * 60_000,
          createdAt: NOW - 3_600_000,
          running: 'unwatched',
          inAnotherWindow: false,
        })),
      listUnresumable: async () => [],
    },
  } as never
  const record = createSessionRecord(META.sessionId)
  record.meta = SESSION as never
  record.phase = 'open'
  ;[...panelEvents(), ...(options.more ?? [])].forEach(([event, at], index) =>
    applyEvent(record.transcript, event as never, at, index + 1),
  )
  const Window = defineComponent({
    setup: () => () => {
      const body = h(
        'div',
        { style: 'display:flex;width:100%;min-height:0;flex:1;background:var(--bg)' },
        [
          h(
            'div',
            {
              style: `flex:none;width:${options.railCollapsed ? 'var(--rail-w-collapsed)' : 'var(--rail-w)'};height:100%`,
            },
            [
              h(SideRail as never, {
                collapsed: options.railCollapsed ?? false,
                open: [],
                activeId: META.sessionId,
                place: null,
                workspaceFolder: {
                  name: 'Default',
                  path: '/Users/someone/Library/Application Support/@brobot2/desktop',
                  isDefault: true,
                },
              }),
            ],
          ),
          h('div', { style: 'display:flex;min-width:0;flex:1;height:100%' }, [
            h(
              ConversationPane as never,
              paneProps({
                record,
                drawerOpen: true,
                drawerTab: 'open',
                capabilities: CAPABILITY_FIXTURE,
                hiddenDrawerTabs: hiddenDrawerTabs(false),
                ...options.pane,
              }),
            ),
          ]),
        ],
      )
      return options.titleBar
        ? h('div', { style: 'display:flex;flex-direction:column;width:100%;height:100%' }, [
            h(AppTitleBar as never, { info: null, error: null }),
            body,
          ])
        : h('div', { style: 'display:flex;width:100%;height:100%' }, [body])
    },
  })
  return Window
}
