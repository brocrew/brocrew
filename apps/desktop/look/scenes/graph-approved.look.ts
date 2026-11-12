import { defineComponent, h, nextTick } from 'vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { conv, task, viewOf, forestOf } from '../../test/dom/forest-fixture'
import { scene, crop } from '../capture'
import { wearTheme } from '../fixtures/themes'

const env = import.meta.env
const scenario = String(env['LOOK_APPROVED_CASE'] ?? 'workspace')
const theme = String(env['LOOK_APPROVED_THEME'] ?? 'classic')
const now = Date.UTC(2026, 10, 12, 4)
const own = scenario === 'own-tree'
const large = scenario === 'large-all'
const amount = own ? 14 : large ? 500 : 6
const selectedWindow = large ? 'all' as const : 'day' as const
const counts = { active: 2, hour: 2, day: 6, week: 10, all: large ? 520 : 12 }
const titles = ['Plan the gallery', 'Draw the header', 'Check the spacing', 'Compare the themes', 'Review the cards', 'Polish the toolbar']
const nodes = [conv('aster-root', null, { identity: 'aster', updatedAt: now - 40 * 86400000 })]
for (let index = 0; index < amount; index++) {
  const id = `fictional-helper-${index + 1}`
  const identity = own ? ['teo', 'neri', 'orin'][index % 3]! : large ? `agent-${index % 6}` : 'teo'
  nodes.push(
    conv(id, 'aster-root', { identity, updatedAt: now - (own ? 35 * 86400000 : index * 3600000), status: index < 2 ? 'working' : 'idle' }),
    task(id, `fictional-piece-${index}`, `W${index + 1}`, titles[index % titles.length]!, 'aster-root'),
  )
}
const folded = viewOf(nodes)
const fixture = {
  reading: {
    loaded: amount + 1,
    expected: amount + 1,
    complete: true,
    reading: {
      id: 'fictional-frozen-reading',
      scope: own ? { is: 'the-tree-of' as const, conversation: 'aster-root' } : { is: 'the-workspace' as const, window: selectedWindow },
      measuredFrom: now,
      counts: own ? null : counts,
      root: own ? 'aster-root' : null,
      members: {
        total: large ? 520 : own ? 15 : 6,
        admitted: folded.rows.filter(row => row.kind === 'a-conversation' && (own || row.conversation !== 'aster-root')).map(row => row.conversation),
      },
      context: own ? [] : ['aster-root'],
      behind: [],
      nodes: forestOf(nodes).nodes,
      unfolded: [],
      heldByNoAgent: 0,
      readAt: now,
    },
  },
  ...folded,
  rows: folded.rows.map((row) => ({
    ...row,
    facets: { doing: row.conversation !== 'aster-root' && Number(row.conversation.split('-').at(-1)) <= 2 ? 'working' as const : 'idle' as const },
    says: row.conversation !== 'aster-root' && Number(row.conversation.split('-').at(-1)) <= 2 ? 'working' : 'idle',
    name: row.identity === 'aster' ? 'Aster' : row.identity === 'teo' ? 'Teo' : row.identity === 'neri' ? 'Neri' : row.identity === 'orin' ? 'Orin' : `Helper ${row.identity?.slice(-1)}`,
    ...(row.conversationRow ? { conversationRow: {
      ...row.conversationRow,
      updatedAt: row.conversation === 'aster-root' ? now - 40 * 86400000 : now - (own ? 35 * 86400000 : Number(row.conversation.split('-').at(-1)) * 3600000),
      ...(!own && row.conversation === 'aster-root' ? { context: large ? 'limit' as const : 'window' as const } : {}),
    }} : {}),
  })),
  coverage: { ...folded.coverage, there: large ? 520 : amount + 1, drawn: large ? 500 : amount + 1, cut: large ? 20 : 0 },
}

scene('graph-approved', async (stage) => {
  if (theme === 'crew-night') wearTheme('crew-night')
  const wrapper = defineComponent({
    setup: () => () => h('div', {
      'data-chat-theme': 'light',
      style: 'display:flex;flex-direction:column;width:100%;height:100%;padding:var(--space-8);background:var(--paper-bg);color:var(--paper-ink);box-sizing:border-box',
    }, [own
      ? h(TeamForest, { view: fixture, current: 'aster-root', direction: 'right', fill: true })
      : h(TeamWorkspace, { agents: null, store: {} as AgentStore, forest: fixture, forestWindow: selectedWindow, forestCounts: counts, forestPending: false }),
    ]),
  })
  const mounted = stage.mount(wrapper, {})
  if (!own) mounted.q('team-tab-forest').click()
  await nextTick()
  await document.fonts.ready
  await new Promise((resolve) => setTimeout(resolve, 800))
  mounted.q('forest-fit').click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  console.log('GRAPH_MEASUREMENTS', JSON.stringify({ theme, scenario, width: stage.width, height: stage.height, source: String(env['LOOK_APPROVED_SHA'] ?? 'unknown'), count: mounted.host.querySelector('[data-cy=forest-drawn]')?.textContent?.trim(), groups: mounted.host.querySelectorAll('[data-cy=forest-group]').length, filters: mounted.host.querySelectorAll('[data-cy^=forest-window-]').length, canvas: mounted.q('forest-rows').getBoundingClientRect().toJSON(), toolbar: mounted.host.querySelector('[data-cy=forest-toolbar]')?.getBoundingClientRect().toJSON(), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  await crop(`${theme}-${scenario}-collapsed`, { x: 0, y: 0, width: stage.width, height: stage.height })
  const toggle = mounted.host.querySelector<HTMLButtonElement>('[data-cy="forest-group-toggle"]')
  if (toggle) {
    toggle.click()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 400))
    mounted.q('forest-fit').click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await crop(`${theme}-${scenario}-expanded`, { x: 0, y: 0, width: stage.width, height: stage.height })
  }
})
