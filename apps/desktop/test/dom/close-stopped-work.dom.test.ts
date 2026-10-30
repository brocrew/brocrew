import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import CloseWorkButton from '../../src/renderer/src/components/CloseWorkButton.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { aWaitingPageWithEveryCard } from './a-waiting-page-with-every-card'
import { mount, unmountAll } from './harness'

const queue = usePersonsQueue()
afterEach(() => {
  unmountAll()
  queue.forget()
})
const tick = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}
function supply(closeWork: (piece: string) => Promise<{ ok: boolean; said: string }>) {
  queue.supply(
    null,
    null,
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now: 1700000000000,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
      closeWork,
    },
  )
}
it('shows Close on real stopped and stalled cards and opens to-do conversations', async () => {
  await page.viewport(1350, 1400)
  const m = await aWaitingPageWithEveryCard(1350, 1400, true)
  expect(m.q('persons-queue-stall-close-work_32').textContent?.trim()).toBe('Close')
  expect(m.q('persons-queue-stopped-close-work_41').textContent?.trim()).toBe('Close')
  expect(m.q('waiting-todo-open-req_todo').textContent?.trim()).toBe('Open the conversation')
  const text = m.q('waiting-todo-text-req_todo')
  const reference = m.host.querySelector<HTMLElement>('[data-cy="question-words"]')!
  expect(parseFloat(getComputedStyle(text).fontSize)).toBe(
    parseFloat(getComputedStyle(reference).fontSize),
  )
})
it('sends Close once, shares pending between copies, and keeps success disabled', async () => {
  const called: string[] = []
  let finish: (value: { ok: boolean; said: string }) => void = () => {}
  supply((piece) => {
    called.push(piece)
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const a = mount(CloseWorkButton, { piece: 'work_sample', cy: 'close-a' })
  const b = mount(CloseWorkButton, { piece: 'work_sample', cy: 'close-b' })
  a.q('close-a').click()
  b.q('close-b').click()
  await nextTick()
  expect(called).toEqual(['work_sample'])
  expect((b.q('close-b') as HTMLButtonElement).disabled).toBe(true)
  finish({ ok: true, said: 'W3.4 is closed.' })
  await tick()
  expect(a.q('close-a-said').textContent).toBe('W3.4 is closed.')
  expect((a.q('close-a') as HTMLButtonElement).disabled).toBe(true)
})
it('keeps refusal and transport failure visible and retryable', async () => {
  let calls = 0
  supply(async () => {
    calls++
    if (calls === 1) return { ok: false, said: 'The work has resumed.' }
    throw new Error('lost connection')
  })
  const m = mount(CloseWorkButton, { piece: 'work_sample', cy: 'close' })
  m.q('close').click()
  await tick()
  expect(m.q('close-said').textContent).toBe('The work has resumed.')
  expect((m.q('close') as HTMLButtonElement).disabled).toBe(false)
  m.q('close').click()
  await tick()
  expect(m.q('close-said').textContent).toContain('Try again.')
})
