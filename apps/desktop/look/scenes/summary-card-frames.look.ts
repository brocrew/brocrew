import { scene } from '../capture'
import { windowStage } from '../fixtures/window'
import { SUMMARY_CARD_EVENTS } from '../fixtures/summary-cards'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { wearTheme } from '../fixtures/themes'

scene('summary and warning cards', (stage) => {
  if (import.meta.env['LOOK_THEME'] === 'crew-night') wearTheme('crew-night')
  else applyTheme(null)
  stage.mount(windowStage({ titleBar: true, more: SUMMARY_CARD_EVENTS, pane: { drawerOpen: false } }), {})
})
