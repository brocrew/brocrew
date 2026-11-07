import { scene } from '../capture'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { aWaitingPageWithMarkdown } from '../../test/dom/a-waiting-page-with-markdown'

scene('waiting-markdown-classic', async (stage) => {
  applyTheme(null)
  await aWaitingPageWithMarkdown(stage.width, stage.height)
})
