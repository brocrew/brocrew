import { afterEach, expect, it } from 'vitest'
import EventStream from '../../src/renderer/src/components/EventStream.vue'
import { createWindow } from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

it('shows a worker birth as quiet metadata while keeping the ordinary reply as content', () => {
  const entries: RuntimeEventMessage[] = [
    {
      sessionId: 'fictional-worker',
      ordinal: 0,
      at: 1_700_000_000_000,
      event: {
        type: 'worker_registered',
        identity: 'aid:document-reader',
        identityCreatedAt: 123,
        giver: 'fictional-giver',
        number: 2,
      },
    },
    {
      sessionId: 'fictional-worker',
      ordinal: 1,
      at: 1_700_000_000_001,
      event: { type: 'assistant_message', text: 'The draft is ready.' },
    },
  ]
  const view = mount(
    EventStream,
    { window: { ...createWindow(), entries } },
    { width: 900, height: 700 },
  )
  const log = view.q('event-log')
  expect(log.querySelectorAll('li[data-type]')).toHaveLength(2)
  const worker = log.querySelector<HTMLElement>('li[data-type="worker_registered"]')
  expect(worker).not.toBeNull()
  expect(worker!.classList.contains('k-lifecycle')).toBe(true)
  expect(worker!.querySelector('.rdetail')?.textContent).toBe('Worker registered (ours)')
  const reply = log.querySelector<HTMLElement>('li[data-type="assistant_message"]')
  expect(reply).not.toBeNull()
  expect(reply!.classList.contains('k-lifecycle')).toBe(false)
  expect(reply!.querySelector('.rdetail')?.textContent).toBe('19 chars')
})
