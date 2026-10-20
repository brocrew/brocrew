import { scene, crop, boxOf } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { settle } from '../fixtures/window'

scene('settings-window', async (stage) => {
  const m = stage.mount(settingsWindow('providers'), {})
  await settle()
  await crop('providers-helper', boxOf(m.q('providers-per-workspace')))
})
