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
const beingDone = {
  readAt: NOW,
  conversations: names.map((name, i) => ({
    conversation: `sample-${i}`,
    identity: name.toLowerCase(),
    told:
      i === 1
        ? { said: 'an-activity', phase: 'thinking', detail: null }
        : i === 0
          ? { said: 'an-activity', phase: 'waiting', detail: null }
          : { said: 'nothing', because: 'no-activity-right-now' },
    status: ['waiting_permission', 'working', 'idle'][i],
    streaming: false,
    since: NOW - 60000,
    context: null,
  })),
}
const store = { renameTo: async () => null, remove: async () => null }
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

import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
scene('readme-team', async (stage) => {
  const m = stage.mount(TeamWorkspace, {
    agents: roster,
    store,
    beingDone,
    conversations: [],
    held: ['sample-0', 'sample-1'],
  })
  await audit(m.host)
})
