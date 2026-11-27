import { vi } from 'vitest'
import { commands } from 'vitest/browser'
import { README_NAMES, readmeRoster } from '../fixtures/readme-sample'
import { scene } from '../capture'
import { auditVisibleScene } from '../lib/audit-visible-scene'

// One fixed clock, so the picture and its audit come out the same on every capture.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(Date.UTC(2026, 10, 20, 15, 30))
const NOW = Date.now()
const names = README_NAMES
const roster = readmeRoster(NOW)
import { defineComponent, h } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { META, paneProps, record } from '../../test/dom/harness'
scene('readme-conversation', async (stage) => {
  const events = [
    {
      type: 'user_turn',
      text: 'Build a small notes app. Ask Loom to add search and Pebble to review keyboard navigation. Check with me before running the build.',
    },
    { type: 'status', state: 'working' },
    {
      type: 'assistant_message',
      text: 'Loom is adding search. Pebble has reviewed keyboard navigation. I have connected the note list and editor.\n\nThe first version is ready to check. May I run the local build?',
    },
    {
      type: 'permission_request',
      id: 'sample-permission',
      kind: 'command',
      action: 'Bash',
      detail: 'npm run build',
      scope: {
        cwd: '~/projects/notes-app',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    },
    { type: 'activity', phase: 'waiting' },
    { type: 'status', state: 'waiting_permission' },
  ]
  const records = names.map((name, i) => {
    const r = record(
      (i === 0
        ? events
        : [
            {
              type: 'user_turn',
              text: i === 1 ? 'Add search to the notes app' : 'Review keyboard navigation',
            },
            { type: 'status', state: i === 1 ? 'working' : 'idle' },
          ]) as never,
      `sample-${i}`,
    )
    r.meta = {
      ...META,
      sessionId: `sample-${i}`,
      profileId: name.toLowerCase(),
      provider: i === 1 ? 'codex' : 'claude',
      cwd: '~/projects/notes-app',
      providerHome: '~/sample-provider',
      settings: { ...META.settings, model: 'claude-opus-5', reasoningEffort: 'high' },
      liveness: {
        state: 'live',
        since: NOW - 300000,
        agent: [
          { label: 'model', value: 'claude-opus-5' },
          { label: 'reasoning', value: 'high' },
        ],
      },
      config: { ...META.config, home: '~/sample-provider' },
      ref: {
        ...META.ref,
        provider: i === 1 ? 'codex' : 'claude',
        rotation: 0,
        sessionId: `sample-provider-${i}`,
        cwd: '~/projects/notes-app',
      },
    }
    if (i === 0)
      r.window.entries = events.map((event, ordinal) => ({
        sessionId: r.sessionId,
        ordinal,
        at: NOW - 60000 + ordinal * 1000,
        event,
      })) as never
    return r
  })
  window.api = {
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  } as never
  const Window = defineComponent({
    setup: () => () =>
      h('div', { style: 'display:flex;width:100%;height:100%;background:var(--bg)' }, [
        h('div', { style: 'display:grid;width:var(--rail-w);flex:none;height:100%' }, [
          h(SideRail as never, {
            open: records,
            agents: roster,
            activeId: 'sample-0',
            place: null,
            needsYou: 1,
            workspaceFolder: { name: 'Notes app', path: '~/projects/notes-app', isDefault: false },
          }),
        ]),
        h('div', { style: 'display:flex;min-width:0;flex:1;height:100%' }, [
          h(
            ConversationPane as never,
            paneProps({ record: records[0], drawerOpen: false, identities: roster.identities }),
          ),
        ]),
      ]),
  })
  const m = stage.mount(Window, {})
  await auditVisibleScene(m.host, (import.meta.env as Record<string, string>).LOOK_OUT!, {
    save: commands.saveLook,
  })
})
