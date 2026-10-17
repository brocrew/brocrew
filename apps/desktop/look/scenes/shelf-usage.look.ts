import { boxOf, crop, scene } from '../capture'
import { settle, windowAtItsRailWidth } from '../fixtures/window'

/**
 * 🎨 **The usage cards** — each provider's usage and the agents running, opened from the title
 * bar's usage line. Saves `1-usage-after-<width>.png`, the cards alone. Fake data:
 * `fixtures/window.ts`.
 */
scene('shelf-usage', async (stage) => {
  await windowAtItsRailWidth(stage, { titleBar: true })
  await settle()
  document.querySelector<HTMLElement>('[data-cy="app-usage"]')!.click()
  await settle()
  const cards = document.querySelector('[data-cy="app-usage-cards"]')!
  await crop(`1-usage-after-${stage.width}`, boxOf(cards))
})
