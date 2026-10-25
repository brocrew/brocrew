import { defineComponent, h, nextTick } from 'vue'
import { scene } from '../capture'
import { windowStage } from '../fixtures/window'
import { RAIL_NARROW_BELOW } from '../../src/renderer/src/lib/rail-fold'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import {
  createTeamProfileGraph,
  provideTeamProfileGraph,
} from '../../src/renderer/src/composables/useTeamProfileGraph'
import { fictionalGraph, fictionalGraphWire } from '../../test/fixtures/team-profile-graph-view'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { themeCss } from '../../src/shared/themes/css'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import defined from '../../resources/themes/defined/theme.json'
import night from '../../resources/themes/crew-night/theme.json'

scene('team-profile-graph', async (stage) => {
  windowStage()
  const theme = String(import.meta.env['LOOK_GRAPH_THEME'] ?? 'classic')
  if (theme !== 'classic') {
    const base = resolveTheme(night as unknown as Theme, defined as unknown as Theme)
    const selected =
      theme === 'crew-night'
        ? base
        : resolveTheme(
            {
              format: 1,
              id: 'fictional-inherited',
              name: 'Fictional inherited',
              extends: 'crew-night',
              shared: { radius: 18 },
            } as Theme,
            base,
          )
    const style = document.createElement('style')
    style.textContent = themeCss(selected)
    document.head.append(style)
    document.documentElement.dataset.theme = selected.id
  } else document.documentElement.dataset.theme = 'classic'
  if (import.meta.env['LOOK_GRAPH_TEXT'] === '200') {
    const root = document.documentElement
    const probe = document.createElement('span')
    probe.hidden = true
    document.body.append(probe)
    for (const token of ['caption', 'small', 'body', 'reading', 'heading', 'title', 'display']) {
      probe.style.fontSize = `var(--type-${token})`
      const size = Number.parseFloat(getComputedStyle(probe).fontSize)
      if (!Number.isFinite(size)) throw Error('Text enlargement needs resolved type sizes')
      root.style.setProperty(`--type-${token}`, `${size * 2}px`)
    }
    probe.remove()
    root.style.fontSize = '200%'
  }
  const population = fictionalGraph(
    Number(import.meta.env['LOOK_GRAPH_COUNT'] ?? 100),
    import.meta.env['LOOK_GRAPH_DENSE'] === '1',
  )
  if (import.meta.env['LOOK_GRAPH_LONG'] === '1') {
    population.nodes[1]!.name = 'A long fictional display name '.repeat(12)
    population.nodes[1]!.profile = 'fictional-long-profile-'.repeat(12)
  }
  let controller!: ReturnType<typeof createTeamProfileGraph>
  const component = defineComponent({
    setup() {
      controller = createTeamProfileGraph({
        read: fictionalGraphWire(population),
        workspace: () => 'fictional-workspace',
      })
      provideTeamProfileGraph(controller)
      return () =>
        h(
          'div',
          {
            style: 'display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg)',
          },
          [
            h(AppTitleBar, { info: null, error: null }),
            h('div', { style: 'display:flex;flex:1;min-height:0;min-width:0' }, [
              h(
                'div',
                {
                  style: `width:${stage.width < RAIL_NARROW_BELOW ? 'var(--rail-w-collapsed)' : 'var(--rail-w)'};flex:none`,
                },
                [
                  h(SideRail, {
                    collapsed: stage.width < RAIL_NARROW_BELOW,
                    open: [],
                    activeId: null,
                    place: 'team',
                    workspaceFolder: {
                      name: 'Fictional workspace',
                      path: '/fictional/workspace',
                      isDefault: false,
                    },
                  }),
                ],
              ),
              h(TeamWorkspace, { agents: null, store: {} as AgentStore }),
            ]),
          ],
        )
    },
  })
  const mounted = stage.mount(component, {})
  mounted.q('team-tab-profile-graph').click()
  for (let i = 0; i < 100 && !controller.reading.value; i++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  if (!controller.reading.value) throw Error('Fictional reading did not complete')
  await nextTick()
  const pause = Array.from(mounted.host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === 'Pause',
  )
  pause?.click()
  await nextTick()
  const selected = mounted.host.querySelector<HTMLButtonElement>('[data-graph-agent]')
  selected?.click()
  await nextTick()
  mounted.q('team-panel-profile-graph').scrollIntoView({ block: 'start' })
})
