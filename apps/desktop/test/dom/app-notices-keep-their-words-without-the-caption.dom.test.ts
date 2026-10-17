import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import AppNoticeEntry from '../../src/renderer/src/components/AppNoticeEntry.vue'
import { APP_NOTICES } from '../../src/shared/app-notice'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

const text = 'A person answered the question.\nYou asked: Which menu?\nanswer: The bakery menu.'
const item = (notice: string) => ({
  kind: 'appNotice',
  id: 'notice_1',
  notice,
  text,
  at: 1_800_000,
})

describe('App notices keep their words without the explanatory caption', () => {
  it.each([...APP_NOTICES, 'unknown-historical-notice'])(
    '%s: no caption, full header and message retained',
    (notice) => {
      const m = mount(AppNoticeEntry, { item: item(notice) })
      expect(m.all('app-notice-why')).toHaveLength(0)
      expect(m.host.textContent).not.toContain('This app put these words')
      expect(m.q('app-notice-message').textContent?.trim()).toBe(text)
      expect(m.q('app-notice-sender').textContent).toBe('This app')
      expect(m.q('app-notice-mark').textContent).toBe('reporting what happened')
      // What the model got is one press away, closed by default, and outside the message's words.
      expect(m.all('model-got-switch')).toHaveLength(1)
      expect(m.all('what-the-model-got')).toHaveLength(0)
      expect(m.q('app-notice-message').contains(m.q('model-got-switch'))).toBe(false)
    },
  )

  it('does not restore a caption when the notice kind changes on the same entry', async () => {
    const one = reactive(item('an-answer-to-a-question'))
    const m = mount(AppNoticeEntry, { item: one })
    one.notice = 'a-piece-taken-back'
    await nextTick()
    expect(m.all('app-notice-why')).toHaveLength(0)
    expect(m.q('app-notice-message').textContent?.trim()).toBe(text)
  })
})
