import { nextTick } from 'vue'
import { commands } from 'vitest/browser'
import {
  README_NAMES,
  README_STORE,
  readmeBeingDone,
  readmeRoster,
} from '../fixtures/readme-sample'
import { scene } from '../capture'
import { auditVisibleScene } from '../lib/audit-visible-scene'

const NOW = Date.now()
const names = README_NAMES
const roster = readmeRoster(NOW)
const beingDone = readmeBeingDone(NOW)
const store = README_STORE
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { forestView } from '../../src/renderer/src/lib/the-forest'
scene('readme-delegation', async (stage) => {
  const nodes = names.map((name, i) => ({
    node: 'a-conversation',
    conversation: `sample-${i}`,
    under: i === 0 ? { is: 'the-person' } : { is: 'a-conversation', conversation: 'sample-0' },
    identity: name.toLowerCase(),
    provider: i === 1 ? 'codex' : 'claude',
    status: ['waiting_permission', 'working', 'idle'][i],
    running: 'in-a-window',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 600000 + i * 1000,
    updatedAt: NOW - 60000,
  }))
  const view = forestView({
    forest: {
      readAt: NOW,
      nodes: { rows: nodes, walk: 'every-conversation-this-app-placed', ledgers: 3, rowsUnread: 0 },
      conversations: 3,
      heldByNoAgent: 0,
    },
    atWork: beingDone,
    waits: null,
    identities: roster.identities,
    held: new Set(['sample-0', 'sample-1', 'sample-2']),
  } as never)
  const m = stage.mount(TeamWorkspace, {
    agents: roster,
    store,
    beingDone,
    conversations: [],
    forest: view,
  })
  await nextTick()
  const tab = [...m.host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === 'Who called whom',
  )!
  tab.click()
  await auditVisibleScene(m.host, (import.meta.env as Record<string, string>).LOOK_OUT!, {
    save: commands.saveLook,
  })
})
