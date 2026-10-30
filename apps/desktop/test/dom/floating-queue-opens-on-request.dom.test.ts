import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { aWaitingPageWithEveryCard } from './a-waiting-page-with-every-card'
import { mount, unmountAll, visible } from './harness'

const queue = usePersonsQueue()
afterEach(() => {
  unmountAll()
  queue.forget()
})
it('opening an overlay leaves Waiting on you collapsed until its button is pressed', async () => {
  await aWaitingPageWithEveryCard(1200, 1200, true)
  const m = mount(OverlayHost, { label: 'Sample report' })
  await nextTick()
  const toggle = m.q('persons-queue-toggle')
  expect(visible(toggle)).toBe(true)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(Number(m.q('persons-queue-count').textContent)).toBeGreaterThan(0)
  expect(visible(m.q('persons-queue-body'))).toBe(false)
  await userEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(visible(m.q('persons-queue-body'))).toBe(true)
  expect(visible(m.q('persons-queue-todo-done-req_todo'))).toBe(true)
  await userEvent.click(toggle)
  expect(visible(m.q('persons-queue-body'))).toBe(false)
})
it('a newly opened overlay starts collapsed after another overlay was expanded', async () => {
  await aWaitingPageWithEveryCard(1200, 1200, true)
  const first = mount(OverlayHost, { label: 'Sample report' })
  await userEvent.click(first.q('persons-queue-toggle'))
  expect(first.q('persons-queue-toggle').getAttribute('aria-expanded')).toBe('true')
  first.unmount()
  const next = mount(OverlayHost, { label: 'Another sample report' })
  await nextTick()
  expect(next.q('persons-queue-toggle').getAttribute('aria-expanded')).toBe('false')
  expect(visible(next.q('persons-queue-body'))).toBe(false)
})
