import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { LOOK_EVERY_MS } from '../../src/renderer/src/lib/persons-queue'
import type { LimitsDisplayAnswer } from '../../src/shared/limits-display'
import { readProviderLimit } from '../../src/shared/provider-limit'
import { combinedPersonsQueue } from '../helpers/combined-persons-queue'
import { waitingCardReaders } from './a-waiting-page-with-every-card'
import { mount } from './harness'
import {
  changed,
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
} from './runtime-screen-fixture'

beforeEach(installRuntimeScreenFixture)
afterEach(() => {
  vi.restoreAllMocks()
  disposeRuntimeScreenFixture()
  vi.useRealTimers()
})

function stoppedProvider(): LimitsDisplayAnswer {
  const at = Date.now()
  const wall = readProviderLimit(
    'claude is rate-limited (seven_day); resets 2126-09-23T11:00:00.000Z',
    at - 60_000,
  )
  if (wall === null) throw new Error('Could not build the stopped provider fixture')
  return {
    is: 'read',
    reading: {
      operation: 1,
      databaseEpoch: 1,
      signInEpoch: 1,
      pinStartedAt: at - 2,
      pinFinishedAt: at - 1,
      evaluatedAt: at,
      usageAt: at - 2,
      finishedAt: at,
      walked: {
        rows: [wall],
        walk: 'every-provider-wall-recently-recorded',
        ledgers: 1,
        rowsUnread: 0,
      },
    },
  }
}

it('moves the rail badge and the page together on a person-queue notice', async () => {
  vi.useFakeTimers({
    toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  const queue = vi.spyOn(window.api.runtime, 'personsQueue')
  queue.mockImplementation(() => combinedPersonsQueue(waitingCardReaders()))
  vi.spyOn(window.api.runtime, 'readLimitsDisplay').mockResolvedValue(stoppedProvider())

  const windowView = mount(RuntimeScreen, {}, { width: 1440, height: 950 })
  windowView.q('rail-waiting').click()
  const words = (cy: string) => windowView.q(cy).textContent?.trim()
  await expect.poll(() => windowView.all('waiting-badge')[0]?.textContent?.trim()).toBe('10')
  await expect
    .poll(() => windowView.all('waiting-intro')[0]?.textContent?.trim())
    .toBe('10 things need you.')
  expect(
    ['questions', 'todo', 'approvals', 'work', 'reply'].map((id) =>
      words(`waiting-pill-count-${id}`),
    ),
  ).toEqual(['2', '1', '5', '1', '1'])
  await expect
    .poll(() => windowView.all('rail-live-stopped')[0]?.textContent)
    .toContain('Claude limit')
  expect(windowView.q('rail-live-signal').title).toContain('Work on Claude has stopped.')
  expect(windowView.host.textContent).not.toContain('9 needs you')

  // Only the notice may trigger each of the reads below.
  vi.clearAllTimers()

  const baseReaders = waitingCardReaders()
  queue.mockImplementation(() =>
    combinedPersonsQueue({ ...baseReaders, questionsForAPerson: async () => null }),
  )
  changed({ what: 'persons' })
  await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
  await expect.poll(() => words('waiting-badge')).toBe('10*')
  expect(words('waiting-intro')).toBe('10 things need you.')
  expect(windowView.q('waiting-badge').title).toContain('out of date')
  expect(windowView.q('waiting-badge').title).not.toContain('floor')

  const shortReaders = waitingCardReaders(1)
  queue.mockImplementation(() =>
    combinedPersonsQueue({
      ...shortReaders,
      questionsForAPerson: async () => {
        const read = await shortReaders.questionsForAPerson()
        return { ...read, rows: read.rows.slice(1) }
      },
    }),
  )
  changed({ what: 'persons' })
  await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
  await expect.poll(() => words('waiting-badge')).toBe('9*')
  expect(words('waiting-intro')).toBe('9 things need you.')
  expect(windowView.q('waiting-badge').title).toContain('incomplete')
  expect(words('rail-live-stopped')).toContain('Claude limit')

  queue.mockImplementation(() => combinedPersonsQueue(runtime))
  changed({ what: 'persons' })
  await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
  await expect.poll(() => words('waiting-intro')).toBe('Nothing needs you.')
  expect(windowView.all('waiting-badge')).toHaveLength(0)
  expect(words('rail-live-stopped')).toContain('Claude limit')
  expect(runtime.readWorkspace).not.toHaveBeenCalled()
})
