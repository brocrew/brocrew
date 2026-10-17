import { scene } from '../capture'
import { RAIL_NARROW_BELOW } from '../../src/renderer/src/lib/rail-fold'
import { windowStage } from '../fixtures/window'

/**
 * 🎨 **The whole window** — the rail, the conversation and the Agent panel docked at its real width.
 * ⚑ Try `--width 1440` (the panel at 560 px) and `--width 1180` (the app's floor: a narrower panel).
 */
scene('window', async (stage) => {
  // The menu collapses below its narrow width, as the app draws it.
  stage.mount(windowStage({ railCollapsed: stage.width < RAIL_NARROW_BELOW, titleBar: true }), {})
  await new Promise((done) => setTimeout(done, 50))
})
