import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)

describe('the header names a pending conversation launch', () => {
  it.each(['open', 'recorded'] as const)(
    'shows starting in the %s view, then returns to its current state',
    async (phase) => {
      const reading = record([{ type: 'status', state: 'idle' }])
      reading.phase = phase
      const launching = ref(true)
      const draft = ref('')
      let stops = 0
      const fixture = defineComponent(
        () => () =>
          h(
            ConversationPane,
            paneProps({
              record: reading,
              listedState: { is: 'active' },
              launching: launching.value,
              draft: draft.value,
              onInterrupt: () => stops++,
            }),
          ),
      )
      const m = mount(fixture, {}, { width: 1180, height: 760 })
      await nextTick()
      const capture = import.meta.env.VITE_W4904_CAPTURE
      if (capture)
        await page.screenshot({
          element: m.q('session-header'),
          path: `__screenshots__/header-${capture}-${phase}.png`,
        })
      expect(m.q('session-status').textContent?.trim()).toBe('Starting')
      const plate = m.q('session-header').querySelector('[data-cy="agent-state"]')
      expect(plate?.getAttribute('data-being')).toBe('starting')
      expect(plate?.getAttribute('aria-label')).toContain('starting')
      const stop = m.q('interrupt-session') as HTMLButtonElement
      expect(stop.disabled).toBe(false)
      stop.click()
      expect(stops).toBe(1)
      expect((m.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(false)
      draft.value = 'A fictional follow-up.'
      await nextTick()
      expect(m.all('queue-prompt')).toHaveLength(1)

      launching.value = false
      await nextTick()
      expect(m.q('session-status').textContent?.trim()).toBe(
        phase === 'recorded' ? 'Active' : 'Idle',
      )
      expect(plate?.getAttribute('data-being')).not.toBe('starting')
    },
  )
})
