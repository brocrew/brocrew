import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import { scene } from '../capture'
import { ACTIVITY_NOW, ACTIVITY_WINDOW, EVERY_CARD } from '../fixtures/recent-activity'

/** 🎨 **Recent activity, every kind of card on it** (classic). Fake data: `fixtures/recent-activity.ts`. */
scene('recent-activity-every-card', async (stage) => {
  stage.mount(RecentActivity, {
    reading: EVERY_CARD,
    windowMs: ACTIVITY_WINDOW,
    clock: ACTIVITY_NOW,
  })
  await new Promise((done) => setTimeout(done, 50))
})
