import { META } from '../../test/dom/harness'
import { scene } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'

/** 🎨 **The drawer's Work tab** — what this agent handed out, and how each piece is going. */
const NOW = Date.now()
const row = (
  piece: string,
  label: string,
  title: string,
  state: string,
  to: string,
  ago: number,
) => ({
  piece,
  label,
  title,
  state,
  givenToProfile: to,
  givenAt: NOW - ago,
})

scene('drawer-work', (stage) => {
  stage.mount(
    rightPanelStage({
      tab: 'work',
      work: {
        conversation: META.sessionId,
        walk: {
          rows: [
            row('work_1', 'W1.2', 'Landing page header', 'working', 'designer', 600_000),
            row('work_2', 'W1.3', 'Contact form', 'answered', 'developer', 1_800_000),
            row('work_3', 'W1.4', 'Menu page photos', 'waiting', 'designer', 300_000),
          ],
          walk: 'every-conversation-this-one-gave-work-to',
          ledgers: 2,
          rowsUnread: 0,
        },
        answered: true,
        at: NOW,
      },
    }),
    {},
  )
})
