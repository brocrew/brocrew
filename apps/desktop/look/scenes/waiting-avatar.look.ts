import { boxOf, crop, scene } from '../capture'
import { settle, windowAtItsRailWidth } from '../fixtures/window'

/**
 * 🎨 **The agent's plate while it waits on another agent** — its robot, and the hourglass in the
 * corner. Saves `5-waiting-after-<width>.png`, the plate with its name and word. Fake data:
 * `fixtures/window.ts`, idle with its work out with Glint.
 */
scene('waiting-avatar', async (stage) => {
  await windowAtItsRailWidth(stage, {
    pane: { waiting: 'waiting-on-a-worker', workWith: ['Glint'] },
    more: [[{ type: 'status', state: 'idle' }, Date.now() - 900_000]],
  })
  await settle()
  const bot = document.querySelector<HTMLElement>('[data-cy="session-bot"]')!
  const box = boxOf(bot, bot.querySelector('.bot-state')!)
  await crop(`5-waiting-after-${stage.width}`, { ...box, height: Math.max(110, box.height) })
})
