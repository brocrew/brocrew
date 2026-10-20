/** Inert real-Electron fixture: the production Settings components with a fake lifecycle controller. */
import { createApp, defineComponent, h } from 'vue'
import { settingsWindow } from './fixtures/settings-window'
import IconSprite from '../src/renderer/src/components/IconSprite.vue'
import '../src/renderer/src/assets/base.css'
import type { PluginsClient } from '../src/shared/plugin-settings'
declare global {
  interface Window {
    fixturePlugins: PluginsClient
  }
}
const theme = new URLSearchParams(location.search).get('theme') ?? 'classic'
const Settings = settingsWindow('plugins', theme, window.fixturePlugins)
createApp(defineComponent({ setup: () => () => [h(IconSprite), h(Settings)] })).mount('#app')
document.documentElement.style.height = '100%'
document.body.style.cssText = 'margin:0;height:100vh;display:flex'
document.querySelector<HTMLElement>('#app')!.style.cssText =
  'display:flex;flex:1;min-width:0!important;min-height:0'
