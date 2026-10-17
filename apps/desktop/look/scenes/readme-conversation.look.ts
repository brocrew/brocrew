import { nextTick } from 'vue'
import { commands } from 'vitest/browser'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import { scene } from '../capture'

const NOW = Date.now()
const names = ['Glint', 'Loom', 'Pebble']
const roster: AgentIdentities = {
  identities: names.map((name, i) => ({
    id: `sample-${i}`,
    slug: name.toLowerCase(),
    displayName: name,
    createdAt: NOW - 86400000,
    createdBy: null,
    provider: i === 1 ? 'codex' : 'claude',
    externalMcpServerIds: [],
    capabilities: { ...DEFAULT_CAPABILITIES },
    chosen: {
      maxDepth: 'default',
      canMessage: 'default',
      canAssignWork: 'default',
      canCreateAgents: 'default',
      canWriteRules: 'default',
    },
  })),
  foldersWithoutARow: [],
  use: names.map((name, i) => ({
    slug: name.toLowerCase(),
    conversations: 1,
    thisAppMintsIt: false,
    isLaunching: false,
    isStarting: false,
    runsOn: {
      provider: i === 1 ? ('codex' as const) : ('claude' as const),
      from: 'saved' as const,
    },
  })),
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}
function drawn(element: HTMLElement, box: DOMRect): boolean {
  let left = box.left,
    right = box.right,
    top = box.top,
    bottom = box.bottom
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
      return false
    if (
      el.tagName === 'DETAILS' &&
      !el.hasAttribute('open') &&
      !el.querySelector('summary')?.contains(element)
    )
      return false
    const clip = el.getBoundingClientRect()
    if (el !== element && ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX)) {
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
    }
    if (el !== element && ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY)) {
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
    }
  }
  return (
    right > left &&
    bottom > top &&
    bottom > 0 &&
    top < innerHeight &&
    right > 0 &&
    left < innerWidth
  )
}
async function audit(host: HTMLElement) {
  await document.fonts.ready
  await nextTick()
  await new Promise((done) => setTimeout(done, 700))
  const text: string[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const parent = node.parentElement!
    if (parent.closest('svg,script,style,option')) continue
    if (drawn(parent, range.getBoundingClientRect())) {
      const value = node.textContent.trim()
      text.push(
        getComputedStyle(parent).textTransform === 'uppercase' ? value.toUpperCase() : value,
      )
    }
  }
  const controls = [...host.querySelectorAll<HTMLInputElement>('input,textarea')]
    .filter((el) => drawn(el, el.getBoundingClientRect()))
    .map((el) => ({ placeholder: el.placeholder, value: el.type === 'password' ? '' : el.value }))
  for (const el of host.querySelectorAll<HTMLSelectElement>('select'))
    if (drawn(el, el.getBoundingClientRect())) text.push(el.selectedOptions[0]?.textContent ?? '')
  const labels = [...host.querySelectorAll<HTMLElement>('[title],[aria-label]')].map((el) => ({
    title: el.title,
    aria: el.getAttribute('aria-label'),
  }))
  const report = {
    text,
    controls,
    labels,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
  }
  const raw = JSON.stringify(report, null, 2)
  if (/@|\/Users\/|\b[WFD]\d+(?:\.\d+)?\b/i.test(text.join(' ') + ' ' + JSON.stringify(controls)))
    throw Error('Public screenshot contains a forbidden label')
  const bytes = new TextEncoder().encode(raw)
  const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
  const out = (import.meta.env as Record<string, string>).LOOK_OUT!
  await commands.saveLook(out + '.audit.json', encoded)
}

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
  await audit(m.host)
})
