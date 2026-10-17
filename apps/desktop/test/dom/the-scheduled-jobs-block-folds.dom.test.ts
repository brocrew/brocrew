import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import ScheduleBar from '../../src/renderer/src/components/ScheduleBar.vue'
import type { ScheduleRegistry } from '../../src/renderer/src/lib/transcript'
import type { RuntimeEvent } from '@brobot2/runtime'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { comingTimeWords } from '../../src/renderer/src/lib/scheduled-job-details'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { assertDrawn, drawnReady, wordRects } from './drawn'
import { drawerProps, mount, unmountAll, visible, type Mounted } from './harness'
import agentCard from '../../src/renderer/src/components/AgentCard.vue?raw'

/**
 * The scheduled-jobs block folds the way an agent card's Current task and Files do: a chevron, the
 * heading as the button, only the rows hidden, and the fold remembered. A check that the rows are
 * hidden sits beside one that the heading is still drawn, so a block that drew nothing cannot pass.
 */

const KEY = 'brobot2.cardScheduleFolded'

/** This file's own storage: the dom project runs files side by side on one origin. */
const memoryStorage = (): Storage => {
  const kept = new Map<string, string>()
  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

const job = (id: string) => ({
  id,
  schedule: '17 12 7 10 *',
  recurring: false,
  prompt: 'check the build and say what broke',
})

const registry = (count: number): ScheduleRegistry => ({
  jobs: Array.from({ length: count }, (_, index) => job(`job${index}`)),
  dropped: 0,
  left: [],
})

const block = (count: number, fold: string | undefined = KEY): Mounted =>
  mount(ScheduleBar, { registry: registry(count), fold }, { width: 400, height: 400 })

/**
 * How many lines an element's words are laid on. An icon or a dot beside them is a box of its own
 * at its own height, so the words alone are measured, a line being a jump of more than half a line.
 */
function wordLines(el: HTMLElement): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const tops: number[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    for (const rect of wordRects(node as Text)) tops.push(rect.top)
  }
  tops.sort((a, b) => a - b)
  let lines = tops.length === 0 ? 0 : 1
  for (let at = 1; at < tops.length; at += 1) if (tops[at]! - tops[at - 1]! > 6) lines += 1
  return lines
}

const button = (m: Mounted): HTMLButtonElement | null =>
  m.host.querySelector<HTMLButtonElement>('[data-cy="schedule-fold"]')

describe('the scheduled-jobs block folds', () => {
  it('🔴 the heading is the button, with a chevron and the count, and the rows start folded', async () => {
    const m = block(1)
    await nextTick()
    const fold = button(m)
    expect(fold, 'the block has no fold').not.toBeNull()
    expect(fold!.getAttribute('aria-expanded')).toBe('false')
    expect(fold!.querySelector('use')!.getAttribute('href')).toBe('#i-chevron')
    expect(m.q('schedule-head').textContent?.trim()).toBe('1 job is scheduled')
    expect(fold!.contains(m.q('schedule-head'))).toBe(true)
    const body = document.getElementById(fold!.getAttribute('aria-controls')!)
    expect(body).not.toBeNull()
    expect(body!.contains(m.q('schedule-row-job0'))).toBe(true)
    expect(visible(m.q('schedule-row-job0'))).toBe(false)
  })

  it('🔴 folded, the heading says when the next job fires, and says nothing where no time is known', async () => {
    const now = Date.now()
    const timed: ScheduleRegistry = {
      jobs: [
        { ...job('later'), nominalAt: now + 3 * 60 * 60_000 },
        { ...job('sooner'), nominalAt: now + 60 * 60_000 },
      ],
      dropped: 0,
      left: [],
    }
    const m = mount(ScheduleBar, { registry: timed, fold: KEY }, { width: 400, height: 400 })
    await nextTick()
    const next = m.q('schedule-next')
    expect(visible(next)).toBe(true)
    expect(button(m)!.contains(next)).toBe(true)
    expect(next.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `· next ${comingTimeWords(now + 60 * 60_000, Date.now())}`,
    )
    unmountAll()
    // One fact over: jobs with no time the provider named give no next.
    const untimed = block(2)
    await nextTick()
    expect(untimed.all('schedule-next')).toHaveLength(0)
  })

  it('🔴 folding hides the rows alone and keeps the count; unfolding brings them back', async () => {
    const m = block(3)
    await nextTick()
    const fold = button(m)!
    fold.click()
    await nextTick()
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    for (const id of ['job0', 'job1', 'job2']) expect(visible(m.q(`schedule-row-${id}`))).toBe(true)

    fold.click()
    await nextTick()
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(m.q('schedule-bar').dataset['folded']).toBe('true')
    expect(visible(m.q('schedule-row-job0'))).toBe(false)
    expect(visible(m.q('schedule-head'))).toBe(true)
    expect(m.q('schedule-head').textContent?.trim()).toBe('3 jobs are scheduled')
  })

  it('⚑ the keyboard folds it: Tab reaches the heading, Enter and Space toggle', async () => {
    const m = block(1)
    await nextTick()
    const fold = button(m)!
    fold.focus()
    expect(document.activeElement).toBe(fold)
    await userEvent.keyboard('{Enter}')
    await nextTick()
    expect(visible(m.q('schedule-row-job0'))).toBe(true)
    await userEvent.keyboard(' ')
    await nextTick()
    expect(visible(m.q('schedule-row-job0'))).toBe(false)
  })

  it('🔴 the fold is remembered: a block mounted again starts as it was left', async () => {
    const first = block(1)
    await nextTick()
    button(first)!.click()
    await nextTick()
    expect(storage.getItem(KEY)).toBe('false')
    unmountAll()

    const again = block(1)
    await nextTick()
    expect(button(again)!.getAttribute('aria-expanded')).toBe('true')
    expect(visible(again.q('schedule-row-job0'))).toBe(true)
    // The control: with nothing remembered it starts folded.
    unmountAll()
    storage.clear()
    const fresh = block(1)
    await nextTick()
    expect(visible(fresh.q('schedule-row-job0'))).toBe(false)
  })

  it('⛔ the control: given no fold, the block keeps its clock, has no button and never hides', async () => {
    storage.setItem(KEY, 'true')
    const m = mount(ScheduleBar, { registry: registry(1) }, { width: 400, height: 400 })
    await nextTick()
    expect(button(m)).toBeNull()
    expect(m.host.querySelector('.sch-head use')!.getAttribute('href')).toBe('#i-clock')
    expect(visible(m.q('schedule-row-job0'))).toBe(true)
    expect(m.q('schedule-head').textContent?.trim()).toBe('1 job is scheduled')
  })

  it('🔴 in the Agent panel at its narrowest, each folded heading is one whole line at the panel’s width', async () => {
    await page.viewport(900, 1000)
    const next = Date.now() + 60 * 60_000
    const state = createTranscript()
    applyEvent(state, {
      type: 'background_work',
      running: [{ id: 'bg_1', kind: 'local_bash', description: 'the long build' }],
      source: 'background_tasks_changed',
    } as RuntimeEvent)
    applyEvent(state, {
      type: 'scheduled_work',
      jobs: [
        { ...job('later'), nominalAt: next + 2 * 60 * 60_000 },
        { ...job('sooner'), nominalAt: next },
      ],
      source: 'hook/Stop',
    } as RuntimeEvent)
    const m = mount(SessionDrawer as never, drawerProps({ state, canStopBackgroundWork: true }), {
      width: DRAWER_W_MIN,
      height: 900,
    })
    await drawnReady()

    const scheduleFold = m.q('schedule-fold')
    const backgroundFold = m.q('background-fold')
    // ⚑ Both start folded, and each says what it holds in full: the next time whole, too.
    expect(scheduleFold.getAttribute('aria-expanded')).toBe('false')
    expect(backgroundFold.getAttribute('aria-expanded')).toBe('false')
    expect(m.q('schedule-head').textContent?.trim()).toBe('2 jobs are scheduled')
    expect(m.q('schedule-next').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `· next ${comingTimeWords(next, Date.now())}`,
    )
    for (const [el, what] of [
      [m.q('schedule-head'), 'the schedule heading'],
      [m.q('schedule-next'), 'the next time'],
      [backgroundFold, 'the running heading'],
    ] as const) {
      assertDrawn(el, what, m.host)
      expect(wordLines(el), `${what} is one line`).toBe(1)
    }
    // ⚑ One line each, at the left edge and the width of the Current task section above them.
    const task = m.q('card-task').getBoundingClientRect()
    for (const bar of [m.q('schedule-bar'), m.q('background-bar')]) {
      const box = bar.getBoundingClientRect()
      expect(
        Math.abs(box.left - task.left),
        `${bar.dataset.cy} starts where the section does`,
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(box.right - task.right),
        `${bar.dataset.cy} ends where the section does`,
      ).toBeLessThanOrEqual(1)
    }
    expect(wordLines(scheduleFold), 'the schedule heading and its next time share a line').toBe(1)
  })

  it('⚑ the Agent panel turns the fold on, under the key this file reads', () => {
    expect(agentCard).toContain(`<ScheduleBar :registry="props.state.schedule" fold="${KEY}" />`)
  })
})
