import {
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  runtime,
} from './runtime-screen-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'
import { mount } from './harness'
import { settleFrames as settle } from './settle-dom'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

const recentActivity = vi.fn<RuntimeBridge['recentActivity']>()
beforeEach(() => {
  installRuntimeScreenFixture()
  Object.assign(window.api.runtime, { recentActivity })
})

/**
 * Recent activity and "Since you were last here", through the real screen: the last-seen record
 * the window keeps, the host's activity read, and the conversation each line opens.
 */

afterEach(() => {
  // What a test told the host to answer goes back to the fixture's own answers.
  for (const one of [runtime.look, recentActivity]) one.mockReset()
  disposeRuntimeScreenFixture()
})

const MINUTE = 60_000
const LAST_SEEN = 'brocrew:last-seen:/fictional/work'

function line(id: string, what: ActivityLine['what'], minutesAgo: number): ActivityLine {
  return {
    id,
    at: Date.now() - minutesAgo * MINUTE,
    what,
    register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
    piece: { id, label: `W1.${id}`, title: `Piece ${id}` },
    agent: 'Ada',
    conversation: `recorded-${id}`,
  }
}

const reading = (lines: ActivityLine[]): RecentActivityReading => ({
  window: { from: 0, to: Date.now() },
  read: { walk: 'one-window-over-every-agents-conversation', ledgers: 2, rowsUnread: 0 },
  lines,
  capped: false,
})

async function screen() {
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  await expect.poll(() => m.all('rail-waiting').length).toBe(1)
  await settle()
  return m
}

/** What the since chip says, or nothing while it is not drawn. */
const summary = (m: { host: HTMLElement }): string =>
  m.host.querySelector('[data-cy="since-summary"]')?.textContent ?? ''

it('Waiting on you says what finished or failed since the person was last here, above its lists', async () => {
  const since = Date.now() - 40 * MINUTE
  localStorage.setItem(LAST_SEEN, String(since))
  recentActivity.mockResolvedValue(
    reading([line('1', 'finished', 5), line('2', 'failed', 10), line('3', 'started', 15)]),
  )
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => summary(m)).toContain('1 reported done · 1 failed')
  // The chip asks for exactly the time since the person was last here.
  expect(recentActivity).toHaveBeenCalledWith({ from: since, to: expect.any(Number) })
  // It sits in the page head, above the lists.
  const chip = m.q('since-last-here').getBoundingClientRect()
  const lists = m.host.querySelector<HTMLElement>('.attention-list')!.getBoundingClientRect()
  expect(chip.bottom).toBeLessThanOrEqual(lists.top)
})

it('See all goes to Recent activity, which reads the chosen window', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 40 * MINUTE))
  recentActivity.mockResolvedValue(reading([line('1', 'finished', 5)]))
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => m.all('since-last-here').length).toBe(1)
  m.q('since-last-here').click()
  await expect.poll(() => m.all('recent-activity').length).toBe(1)
  await expect.poll(() => m.all('activity-line').length).toBe(1)
  recentActivity.mockClear()
  m.q(`activity-window-${String(7 * 24 * 3_600_000)}`).click()
  await expect.poll(() => recentActivity.mock.calls.length).toBeGreaterThan(0)
  const asked = recentActivity.mock.calls.at(-1)![0]
  expect(asked.to - asked.from).toBe(7 * 24 * 3_600_000)
})

it('without a last-seen record there is no box, and nothing is guessed', async () => {
  recentActivity.mockResolvedValue(reading([line('1', 'finished', 5)]))
  const m = await screen()
  m.q('rail-waiting').click()
  await settle()
  await settle()
  expect(m.all('waiting-on-you')).toHaveLength(1)
  expect(m.all('since-last-here')).toHaveLength(0)
})

it('a read that fails draws no box, rather than an empty one', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 40 * MINUTE))
  recentActivity.mockRejectedValue(new Error('The read could not be made.'))
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => recentActivity.mock.calls.length).toBeGreaterThan(0)
  await settle()
  expect(m.all('since-last-here')).toHaveLength(0)
  m.q('rail-away').click()
  await expect.poll(() => m.all('activity-not-read').length).toBe(1)
})

/** Every activity read waits until the test answers it, in the order they were asked. */
function heldReplies() {
  const waiting: ((value: RecentActivityReading) => void)[] = []
  recentActivity.mockImplementation(
    () =>
      new Promise((done) => {
        waiting.push(done)
      }),
  )
  return waiting
}

const H = 3_600_000

it('a reply for another window never speaks for the one chosen', async () => {
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  replies[0]!(reading([]))
  await expect.poll(() => m.all('activity-empty').length).toBe(1)
  expect(m.q('activity-empty').textContent).toContain('12 hours')
  // The next window is chosen and its reply is still out: the 12-hour reading is not its.
  m.q(`activity-window-${String(7 * 24 * H)}`).click()
  await expect.poll(() => replies.length).toBe(2)
  await settle()
  expect(m.all('activity-empty')).toHaveLength(0)
  expect(m.all('activity-not-read')).toHaveLength(1)
  replies[1]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => m.all('activity-line').length).toBe(1)
})

it('an older reply arriving last is dropped, however the windows were chosen', async () => {
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  m.q(`activity-window-${String(24 * H)}`).click()
  m.q(`activity-window-${String(12 * H)}`).click()
  await expect.poll(() => replies.length).toBe(3)
  replies[2]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => m.all('activity-line').length).toBe(1)
  // The 24-hour reply, then the first 12-hour one, both arrive after the newest.
  replies[1]!(reading([line('2', 'failed', 5), line('3', 'failed', 6)]))
  replies[0]!(reading([]))
  await settle()
  await settle()
  expect(m.all('activity-line')).toHaveLength(1)
  expect(m.all('activity-empty')).toHaveLength(0)
})

it('a reply for an earlier "last here" is dropped once the boundary moved', async () => {
  const first = Date.now() - 60 * MINUTE
  const later = Date.now() - 20 * MINUTE
  localStorage.setItem(LAST_SEEN, String(first))
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-waiting').click()
  await expect.poll(() => replies.length).toBe(1)
  // Another window of the workspace moves the boundary while the first reply is out.
  localStorage.setItem(LAST_SEEN, String(later))
  window.dispatchEvent(new StorageEvent('storage', { key: LAST_SEEN }))
  await expect.poll(() => replies.length).toBe(2)
  expect(recentActivity.mock.calls.at(-1)![0].from).toBe(later)
  replies[1]!(reading([line('1', 'finished', 5)]))
  await expect.poll(() => summary(m)).toContain('1 reported done')
  replies[0]!(
    reading([line('2', 'finished', 30), line('3', 'failed', 40), line('4', 'failed', 50)]),
  )
  await settle()
  await settle()
  expect(summary(m)).toContain('1 reported done')
  expect(summary(m)).not.toContain('failed')
})

it('a page read still out when the person moves to Waiting on you starts no read for the box', async () => {
  localStorage.setItem(LAST_SEEN, String(Date.now() - 60 * MINUTE))
  const replies = heldReplies()
  const m = await screen()
  m.q('rail-away').click()
  await expect.poll(() => replies.length).toBe(1)
  m.q('rail-waiting').click()
  await expect.poll(() => replies.length).toBe(2)
  replies[1]!(reading([line('1', 'finished', 1)]))
  await expect.poll(() => summary(m)).toContain('1 reported done')
  // The page's reply arrives last: it asks for nothing more and changes nothing.
  replies[0]!(reading([]))
  await settle()
  await settle()
  expect(replies).toHaveLength(2)
  expect(summary(m)).toContain('1 reported done')
})
