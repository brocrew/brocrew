import { boxOf, crop, scene } from '../capture'
import { settle, windowAtItsRailWidth } from '../fixtures/window'

/**
 * 🎨 **The agent card's Current task and Files, open and folded** — the heading's chevron, and the
 * section with its content shown and hidden. Saves, for each of `task` and `files`:
 * `4-<key>-after-<width>.png` (the heading, open), `4-<key>-folded-<width>.png` (the heading,
 * folded), and `4-<key>-section-open-<width>.png` / `4-<key>-section-folded-<width>.png`.
 */
scene('card-sections-fold', async (stage) => {
  await windowAtItsRailWidth(stage)
  for (const key of ['task', 'files']) {
    const section = document.querySelector<HTMLElement>(`[data-cy="card-${key}"]`)!
    const head = section.querySelector<HTMLElement>('.head')!
    const fold = head.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    head.scrollIntoView({ block: 'center' })
    await settle()
    await crop(`4-${key}-after-${stage.width}`, boxOf(head))
    await crop(`4-${key}-section-open-${stage.width}`, boxOf(section))
    fold.click()
    await settle()
    await crop(`4-${key}-folded-${stage.width}`, boxOf(head))
    await crop(`4-${key}-section-folded-${stage.width}`, boxOf(section))
    // Open again, so the next section and the scene's picture show the card as it opens.
    fold.click()
    await settle()
  }
  document.querySelector<HTMLElement>('[data-cy="panel-body"]')!.scrollTop = 0
})
