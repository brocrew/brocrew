import { nextTick } from 'vue'
import { crop, boxOf, type LookStage } from '../capture'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { wearTheme } from './themes'
import { aWaitingPageWithMarkdown } from '../../test/dom/a-waiting-page-with-markdown'
import {
  aTranscriptQuestionWithMarkdown,
  QUESTION_MARKDOWN,
} from '../../test/dom/a-transcript-question-with-markdown'

export async function markdownSurfaces(
  stage: LookStage,
  theme: 'classic' | 'crew-night' | 'synthwave',
) {
  applyTheme(null)
  if (theme !== 'classic') wearTheme(theme)
  const width = Math.floor(stage.width / 2) - 12
  const waiting = await aWaitingPageWithMarkdown(
    width,
    stage.height,
    false,
    false,
    QUESTION_MARKDOWN,
  )
  const transcript = aTranscriptQuestionWithMarkdown(false, width, stage.height)
  waiting.host.style.cssText += ';position:fixed;left:0;top:0'
  transcript.host.style.cssText += `;position:fixed;left:${width + 24}px;top:0`
  await nextTick()
  await crop(`${theme}-waiting`, boxOf(waiting.q('question-card')))
  await crop(`${theme}-transcript`, boxOf(transcript.q('outgoing')))
}
