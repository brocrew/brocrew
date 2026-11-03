import { scene } from '../capture'
import { wearTheme } from '../fixtures/themes'
import { aWaitingPageWithMarkdown } from '../../test/dom/a-waiting-page-with-markdown'

scene('waiting-markdown-crew-night', async (stage) => {
  wearTheme('crew-night')
  await aWaitingPageWithMarkdown(stage.width, stage.height)
})
