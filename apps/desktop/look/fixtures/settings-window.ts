import type { PluginsClient } from '../../src/shared/plugin-settings'
import type { ProviderCapabilityMap } from '../../src/shared/runtime-ipc'
import { defineComponent, h, ref } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import SettingsScreen, {
  type SettingsTab,
} from '../../src/renderer/src/components/SettingsScreen.vue'
import { providersBridge } from './providers'
import { themesBridge } from './themes'
import { wearReadabilityTheme } from './readability-themes'
import { useRailFold } from '../../src/renderer/src/composables/useRailFold'
import { fictionalSkills, SKILLS_CAST } from './skills'

/** A whole window assembled from its real components and fictional catalogue/agents. */
export function settingsWindow(
  start: SettingsTab = 'skills',
  theme = 'classic',
  plugins?: PluginsClient,
  providerCapabilities: ProviderCapabilityMap | null = null,
) {
  providersBridge()
  themesBridge(theme)
  wearReadabilityTheme(theme)
  const fixture = fictionalSkills()
  window.api = {
    ...window.api,
    runtime: {
      ...window.api.runtime,
      skills: fixture.bridge,
      agentIdentities: async () => SKILLS_CAST,
    },
  }
  return defineComponent({
    setup() {
      const tab = ref(start)
      const railFold = useRailFold()
      return () =>
        h(
          'div',
          {
            style: 'display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg)',
          },
          [
            h(AppTitleBar, { info: null, error: null }),
            h('div', { style: 'display:flex;min-height:0;flex:1' }, [
              h(
                'div',
                {
                  style: `width:var(${railFold.collapsed.value ? '--rail-w-collapsed' : '--rail-w'});flex:none;display:flex`,
                },
                [
                  h(SideRail, {
                    open: [],
                    activeId: null,
                    place: 'settings',
                    agents: SKILLS_CAST,
                    collapsed: railFold.collapsed.value,
                    onFold: () => railFold.toggle(),
                  }),
                ],
              ),
              h(SettingsScreen, {
                tab: tab.value,
                capabilities: providerCapabilities,
                warnings: null,
                clock: Date.now(),
                store: fixture.store,
                plugins,
                'onUpdate:tab': (next: SettingsTab) => {
                  tab.value = next
                },
              }),
            ]),
          ],
        )
    },
  })
}
