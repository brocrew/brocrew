import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import SinceYouWereLastHere from '../../src/renderer/src/components/SinceYouWereLastHere.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import {
  DEFAULT_ACTIVITY_WINDOW_MS,
  SINCE_SHOWN,
  dayWord,
  sinceView,
} from '../../src/renderer/src/lib/recent-activity'
import {
  AWAY_LONG_ENOUGH_MS,
  awaySinceKey,
  backAtKey,
  lastSeenKey,
  useLastSeen,
} from '../../src/renderer/src/composables/useLastSeen'
import { readLocalTimeFrom, type LocalZone } from '../../src/shared/local-time'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'
import { mount, unmountAll } from './harness'

/**
 * Recent activity and the "Since you were last here" box: dated lines that open their
 * conversation, an empty window said as one, and a window not read yet (or read in part) never
 * said as "nothing happened".
 */

const NOW = new Date(2026, 9, 16, 9, 45).getTime()
const MINUTE = 60_000

let lineNumber = 0
function line(what: ActivityLine['what'], minutesAgo: number, more: Partial<ActivityLine> = {}) {
  lineNumber += 1
  return {
    id: `line-${String(lineNumber)}`,
    at: NOW - minutesAgo * MINUTE,
    what,
    register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
    piece: {
      id: `piece-${String(lineNumber)}`,
      label: `W1.${String(lineNumber)}`,
      title: 'Check the release notes',
    },
    agent: 'Ada',
    conversation: `conversation-${String(lineNumber)}`,
    ...more,
  } satisfies ActivityLine
}

function reading(
  lines: ActivityLine[],
  read: Partial<RecentActivityReading['read']> = {},
  capped = false,
): RecentActivityReading {
  return {
    capped,
    window: { from: NOW - DEFAULT_ACTIVITY_WINDOW_MS, to: NOW },
    read: { walk: 'one-window-over-every-agents-conversation', ledgers: 4, rowsUnread: 0, ...read },
    lines,
  } as RecentActivityReading
}

function page(value: RecentActivityReading | null) {
  const opened: string[] = []
  const chosen: number[] = []
  const m = mount(
    defineComponent({
      setup: () => () => [
        h(IconSprite),
        h(RecentActivity, {
          reading: value,
          windowMs: DEFAULT_ACTIVITY_WINDOW_MS,
          clock: NOW,
          onOpen: (id: string) => opened.push(id),
          onChooseWindow: (ms: number) => chosen.push(ms),
        }),
      ],
    }),
    {},
  )
  return { m, opened, chosen }
}

afterEach(() => {
  unmountAll()
  localStorage.clear()
  sessionStorage.clear()
  readLocalTimeFrom(() => null)
})

describe('Recent activity', () => {
  it('a window not read yet says so, and never that nothing happened', () => {
    const { m } = page(null)
    expect(m.q('activity-not-read').textContent).toContain('Not read yet')
    expect(m.all('activity-empty')).toHaveLength(0)
    expect(m.all('activity-list')).toHaveLength(0)
  })

  it('a window read whole with nothing in it says so, and offers a longer window', () => {
    const { m } = page(reading([]))
    expect(m.q('activity-empty').textContent).toContain(
      'No activity recorded in the last 12 hours.',
    )
    expect(m.q('activity-empty').textContent).toContain('Try a longer time window.')
    expect(m.all('activity-not-read')).toHaveLength(0)
  })

  it('explains a kept skill collision as a dated activity line instead of an empty window', () => {
    const value = reading([])
    const { m } = page({
      ...value,
      skillImports: [
        {
          id: 'fictional-import',
          at: NOW - MINUTE,
          name: 'recipe-check',
          existing: 'recipe-check',
          imported: 'recipe-check-2',
        },
      ],
    })
    const row = m.q('activity-skill-import')
    expect(row.textContent).toContain(
      'Two different skills were named recipe-check. Both are kept: recipe-check and recipe-check-2.',
    )
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(NOW - MINUTE).toISOString(),
    )
    expect(m.all('activity-empty')).toHaveLength(0)
  })

  it('a window read only in part is never said to be empty', () => {
    for (const read of [{ rowsUnread: 3 }, { ledgersSkipped: 1 }]) {
      const { m } = page(reading([], read))
      expect(m.q('activity-read-in-part').textContent).toContain('some lines may be missing')
      expect(m.all('activity-empty')).toHaveLength(0)
      unmountAll()
    }
  })

  it('draws dated lines newest first, each naming its piece and agent and opening its conversation', async () => {
    const lines = [
      line('started', 20),
      line('finished', 3),
      line('failed', 14, { agent: 'Felix' }),
      line('stopped', 60 * 24, { conversation: null }),
    ]
    const { m, opened } = page(reading(lines))
    const drawn = m.all('activity-line')
    expect(drawn.map((one) => one.dataset.what)).toEqual([
      'finished',
      'failed',
      'started',
      'stopped',
    ])
    expect(drawn[0]!.textContent).toContain('Ada reported done')
    expect(drawn[0]!.textContent).toContain(`${lines[1]!.piece.label} · Check the release notes`)
    expect(drawn[1]!.textContent).toContain('Felix failed')
    expect(m.all('activity-day').map((day) => day.querySelector('strong')?.textContent)).toEqual([
      'Today',
      'Yesterday',
    ])
    drawn[1]!.click()
    await nextTick()
    expect(opened).toEqual([lines[2]!.conversation])
    // A line with no conversation to open is not a link.
    expect((drawn[3] as HTMLButtonElement).disabled).toBe(true)
    expect(m.q('activity-claimed-note').textContent?.trim()).toBe(
      'Reported outcomes come from the agent.',
    )
  })

  it('a long piece title stays inside the line, at a narrow width', () => {
    const long = line('finished', 2, {
      piece: {
        id: 'long',
        label: 'W1.12.3',
        title:
          'Read every ledger the night left behind, reconcile the failed turns with what each agent reported, and write the result where the person will see it first',
      },
    })
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(RecentActivity, {
            reading: reading([long]),
            windowMs: DEFAULT_ACTIVITY_WINDOW_MS,
            clock: NOW,
          }),
      }),
      {},
      { width: 520 },
    )
    const row = m.q('activity-line').getBoundingClientRect()
    const piece = m.q('activity-line').querySelector('.piece')!.getBoundingClientRect()
    expect(piece.right).toBeLessThanOrEqual(row.right)
    expect(m.q('activity-list').scrollWidth).toBeLessThanOrEqual(m.q('activity-list').clientWidth)
  })

  it('a read stopped at its newest lines says so, and promises no window that would show the rest', () => {
    const { m } = page(reading([line('finished', 2)], {}, true))
    expect(m.q('activity-capped').textContent?.trim()).toBe(
      'Showing the newest 200. Older lines aren’t shown here.',
    )
    expect(m.host.textContent).not.toContain('shorter window')
    // Paired: a read that was not stopped says nothing of the kind.
    unmountAll()
    expect(page(reading([line('finished', 2)])).m.all('activity-capped')).toHaveLength(0)
  })

  it('keeps the window chooser', async () => {
    const { m, chosen } = page(reading([]))
    m.q(`activity-window-${String(7 * 24 * 3_600_000)}`).click()
    await nextTick()
    expect(chosen).toEqual([7 * 24 * 3_600_000])
  })
})

describe('Since you were last here', () => {
  function box(
    lines: ActivityLine[],
    since: number,
    read: Partial<RecentActivityReading['read']> = {},
    capped = false,
  ) {
    const view = sinceView(reading(lines, read, capped), since)!
    const opened: string[] = []
    let seeAll = 0
    const m = mount(
      defineComponent({
        setup: () => () => [
          h(IconSprite),
          h(SinceYouWereLastHere, {
            view,
            since,
            clock: NOW,
            onOpen: (id: string) => opened.push(id),
            onSeeAll: () => (seeAll += 1),
          }),
        ],
      }),
      {},
    )
    return { m, opened, seeAll: () => seeAll }
  }

  it(`shows at most ${String(SINCE_SHOWN)} lines, of what finished or failed since then, and counts them all`, () => {
    const since = NOW - 35 * MINUTE
    const lines = [
      ...[1, 2, 3, 4, 5, 6].map((minutes) => line('finished', minutes)),
      line('failed', 7),
      line('started', 8),
      line('stopped', 9),
      line('finished', 40),
    ]
    const { m } = box(lines, since)
    expect(m.all('since-line')).toHaveLength(SINCE_SHOWN)
    expect(
      m.all('since-line').every((one) => ['finished', 'failed'].includes(one.dataset.what!)),
    ).toBe(true)
    expect(m.q('since-summary').textContent).toContain('6 reported done · 1 failed')
    expect(m.q('since-summary').textContent).toContain('Today, since')
  })

  it('each line opens its conversation, and See all goes to Recent activity', async () => {
    const lines = [line('failed', 2, { agent: 'Felix' })]
    const { m, opened, seeAll } = box(lines, NOW - 10 * MINUTE)
    expect(m.q('since-line').textContent).toContain('Felix')
    m.q('since-line').click()
    m.q('since-see-all').click()
    await nextTick()
    expect(opened).toEqual([lines[0]!.conversation])
    expect(seeAll()).toBe(1)
    expect(m.q('since-see-all').textContent?.trim()).toBe('See all in Recent activity')
  })

  it('says nothing finished or failed only over a whole read', () => {
    const { m } = box([line('started', 2)], NOW - 10 * MINUTE)
    expect(m.all('since-line')).toHaveLength(0)
    expect(m.q('since-summary').textContent).toContain('nothing finished or failed')
    expect(m.all('since-read-in-part')).toHaveLength(0)
  })

  it('a read made only in part claims no absence, and says lines may be missing', () => {
    for (const read of [{ rowsUnread: 2 }, { ledgersSkipped: 1 }]) {
      const { m } = box([line('started', 2)], NOW - 10 * MINUTE, read)
      expect(m.q('since-summary').textContent).not.toContain('nothing')
      expect(m.q('since-read-in-part').textContent).toContain('some lines may be missing')
      unmountAll()
    }
  })

  it('a read stopped at its newest lines, all starts and stops, claims no absence', () => {
    const { m } = box([line('started', 2), line('stopped', 3)], NOW - 10 * MINUTE, {}, true)
    expect(m.all('since-line')).toHaveLength(0)
    expect(m.q('since-summary').textContent).not.toContain('nothing')
    expect(m.q('since-capped').textContent?.trim()).toBe(
      'Only the newest 200 were read; older ones may be missing.',
    )
    expect(m.host.textContent).not.toContain('Showing the newest')
  })

  it('a capped read with more outcomes than the box shows says what was read, not what is shown', () => {
    const lines = Array.from({ length: 8 }, (_, at) => line('finished', at + 1))
    const { m } = box(lines, NOW - 30 * MINUTE, {}, true)
    expect(m.all('since-line')).toHaveLength(SINCE_SHOWN)
    expect(m.q('since-capped').textContent?.trim()).toBe(
      'Only the newest 200 were read; older ones may be missing.',
    )
  })

  it('has nothing to say without a last-seen record or a reading', () => {
    expect(sinceView(reading([line('finished', 2)]), null)).toBeNull()
    expect(sinceView(null, NOW - 10 * MINUTE)).toBeNull()
  })
})

describe('Today and Yesterday are days on the Mac’s calendar', () => {
  const H = 3_600_000
  const at = (zone: LocalZone) => readLocalTimeFrom(() => zone)

  it('after a 23-hour day, the day before is Yesterday and the one before that is not', () => {
    // +01:00, and +02:00 from 01:00Z on 29 March: that local day is 23 hours long.
    at({ before: H, changes: [{ at: Date.UTC(2026, 2, 29, 1), offset: 2 * H }], rule: null })
    const now = Date.UTC(2026, 2, 29, 22, 30) // 30 March, 00:30 local
    expect(dayWord(Date.UTC(2026, 2, 29, 10), now)).toBe('Yesterday') // 29 March, 12:00
    expect(dayWord(Date.UTC(2026, 2, 28, 22, 30), now)).toBeNull() // 28 March, 23:30
    expect(dayWord(Date.UTC(2026, 2, 29, 22, 15), now)).toBe('Today') // 30 March, 00:15
  })

  it('on a 25-hour day, the day before is still Yesterday', () => {
    // +02:00, and +01:00 from 01:00Z on 25 October: that local day is 25 hours long.
    at({ before: 2 * H, changes: [{ at: Date.UTC(2026, 9, 25, 1), offset: H }], rule: null })
    const now = Date.UTC(2026, 9, 25, 22, 30) // 25 October, 23:30 local
    expect(dayWord(Date.UTC(2026, 9, 24, 10), now)).toBe('Yesterday') // 24 October, 12:00
    expect(dayWord(Date.UTC(2026, 9, 24, 22, 30), now)).toBe('Today') // 25 October, 00:30
    expect(dayWord(Date.UTC(2026, 9, 23, 10), now)).toBeNull()
  })
})

describe('the last-seen record', () => {
  const WS = '/fictional/work'
  const boundary = () => localStorage.getItem(lastSeenKey(WS))

  /** An event that happened at `at`, or at the clock's time when it is handled. */
  type Timed = Event & { at?: number }

  /**
   * One window of the workspace, with its own events, visibility and session storage, sharing
   * the workspace's storage with any other; `front` says whether it is in front of the person.
   */
  function seen(
    clock: { now: number },
    front = { value: true },
    win: { events: EventTarget; session: Storage } = { events: window, session: sessionStorage },
  ) {
    let since: { value: number | null } = { value: null }
    const visibility = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    })
    const m = mount(
      defineComponent({
        setup() {
          since = useLastSeen(() => WS, {
            storage: localStorage,
            session: win.session,
            now: () => clock.now,
            eventAt: (event) => (event as Timed).at ?? clock.now,
            inFront: () => front.value,
            events: win.events,
            visibility,
          }).since
          return () => h('div')
        },
      }),
      {},
    )
    const hide = () => {
      visibility.visibilityState = 'hidden'
      visibility.dispatchEvent(new Event('visibilitychange'))
    }
    return { since: () => since.value, unmount: m.unmount, hide }
  }

  const fire = (type: string, target: EventTarget = window, at?: number) =>
    target.dispatchEvent(Object.assign(new Event(type), at === undefined ? {} : { at }))

  /** A second window: its own events and its own session storage. */
  const otherWindow = () => {
    const kept = new Map<string, string>()
    return {
      events: new EventTarget(),
      session: {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
      } as unknown as Storage,
    }
  }

  it('is not there before the window has ever gone away', () => {
    expect(seen({ now: NOW }).since()).toBeNull()
  })

  it('is the moment the window last went away for long enough, kept per workspace', () => {
    const clock = { now: NOW }
    const { since } = seen(clock)
    fire('blur')
    clock.now += AWAY_LONG_ENOUGH_MS
    fire('focus')
    expect(since()).toBe(NOW)
    expect(boundary()).toBe(String(NOW))
    expect(localStorage.getItem(awaySinceKey(WS))).toBeNull()
  })

  it('a glance at another app moves it neither in this window nor in storage', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const { since } = seen(clock)
    fire('blur')
    clock.now += 30_000
    fire('focus')
    expect(since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('leaving heard twice keeps the first leaving', () => {
    const clock = { now: NOW }
    const { since } = seen(clock)
    fire('blur')
    clock.now += 9 * MINUTE
    fire('pagehide')
    clock.now += MINUTE
    fire('focus')
    expect(since()).toBe(NOW)
  })

  it('a reload that takes six minutes still leaves the boundary where it was', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const first = seen(clock)
    fire('pagehide')
    first.unmount()
    clock.now += 6 * MINUTE
    // The same window, reloaded: its session storage is kept.
    expect(seen(clock).since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a window left by blur and then reloaded keeps the boundary, after six minutes too', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const first = seen(clock)
    fire('blur')
    clock.now += 1_000
    fire('pagehide')
    first.unmount()
    clock.now += 6 * MINUTE
    expect(seen(clock).since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a window hidden and then reloaded keeps the boundary, after six minutes too', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const first = seen(clock)
    first.hide()
    clock.now += 1_000
    fire('pagehide')
    first.unmount()
    clock.now += 6 * MINUTE
    expect(seen(clock).since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a return handled late is dated when it happened, so a leaving queued after it still counts', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const frontA = { value: true }
    const frontB = { value: false }
    const a = otherWindow()
    const b = otherWindow()
    seen(clock, frontA, a)
    seen(clock, frontB, b)
    // A is left at 10:00; B's focus (10:01) and blur (10:10) are both handled at 10:11.
    fire('blur', a.events, NOW)
    frontA.value = false
    clock.now = NOW + 11 * MINUTE
    fire('focus', b.events, NOW + MINUTE)
    fire('blur', b.events, NOW + 10 * MINUTE)
    // The person comes back to B at 10:15: five minutes away, from 10:10.
    clock.now = NOW + 15 * MINUTE
    frontB.value = true
    fire('focus', b.events)
    expect(boundary()).toBe(String(NOW + 10 * MINUTE))
  })

  it('an old return handled late in one window neither ends a later absence nor moves the last return back', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const frontA = { value: false }
    const frontB = { value: false }
    const a = otherWindow()
    const b = otherWindow()
    seen(clock, frontA, a)
    seen(clock, frontB, b)
    // The person comes back to A at 10:05 and leaves it at 10:10.
    frontA.value = true
    fire('focus', a.events, NOW + 5 * MINUTE)
    frontA.value = false
    fire('blur', a.events, NOW + 10 * MINUTE)
    // B handles its focus from 10:01 only now, at 10:11.
    clock.now = NOW + 11 * MINUTE
    fire('focus', b.events, NOW + MINUTE)
    expect(localStorage.getItem(backAtKey(WS))).toBe(String(NOW + 5 * MINUTE))
    expect(localStorage.getItem(awaySinceKey(WS))).toBe(String(NOW + 10 * MINUTE))
    // The person comes back to A at 10:16: six minutes away, from 10:10.
    clock.now = NOW + 16 * MINUTE
    frontA.value = true
    fire('focus', a.events)
    expect(boundary()).toBe(String(NOW + 10 * MINUTE))
  })

  it('a return never ends an absence that began after it', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const front = { value: false }
    seen(clock, front)
    // Another window was left at 10:10; this window's return from 10:03 is handled at 10:11.
    localStorage.setItem(awaySinceKey(WS), String(NOW + 10 * MINUTE))
    clock.now = NOW + 11 * MINUTE
    front.value = true
    fire('focus', window, NOW + 3 * MINUTE)
    expect(localStorage.getItem(awaySinceKey(WS))).toBe(String(NOW + 10 * MINUTE))
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a short absence whose return is handled six minutes late stays a glance', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    seen(clock)
    fire('blur', window, NOW)
    // Back at 10:02, handled at 10:08.
    clock.now = NOW + 8 * MINUTE
    fire('focus', window, NOW + 2 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a quit and a reopen six minutes later moves the boundary to the quit', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const first = seen(clock)
    fire('pagehide')
    first.unmount()
    // A quit takes the window's session storage with it.
    sessionStorage.clear()
    clock.now += 6 * MINUTE
    expect(seen(clock).since()).toBe(NOW)
  })

  it('an old leaving handled late in one window never replaces a later leaving in another', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const frontA = { value: true }
    const frontB = { value: false }
    const a = otherWindow()
    const b = otherWindow()
    const inA = seen(clock, frontA, a)
    seen(clock, frontB, b)
    void inA
    // The person moves from A to B at 10:00; B is chosen, A's blur is not handled yet.
    frontA.value = false
    frontB.value = true
    clock.now = NOW + 60_000
    fire('focus', b.events)
    // B is left at 10:10.
    clock.now = NOW + 10 * MINUTE
    frontB.value = false
    fire('blur', b.events)
    // A finally handles its blur from 10:00, at 10:11.
    clock.now = NOW + 11 * MINUTE
    fire('blur', a.events, NOW)
    // The person comes back to B at 10:15: five minutes away, from 10:10.
    clock.now = NOW + 15 * MINUTE
    frontB.value = true
    fire('focus', b.events)
    expect(boundary()).toBe(String(NOW + 10 * MINUTE))
  })

  it('a leaving never replaces a later one already recorded', () => {
    const clock = { now: NOW }
    seen(clock)
    // Another window was left later, at 10:10; this one's leaving from 10:05 is handled after.
    localStorage.setItem(awaySinceKey(WS), String(NOW + 10 * MINUTE))
    clock.now = NOW + 11 * MINUTE
    fire('blur', window, NOW + 5 * MINUTE)
    expect(localStorage.getItem(awaySinceKey(WS))).toBe(String(NOW + 10 * MINUTE))
  })

  it('a leaving from before the person last came back records nothing', () => {
    const clock = { now: NOW }
    seen(clock)
    // The person came back to another of the workspace's windows at 10:01.
    localStorage.setItem(backAtKey(WS), String(NOW + MINUTE))
    clock.now = NOW + 2 * MINUTE
    fire('blur', window, NOW)
    expect(localStorage.getItem(awaySinceKey(WS))).toBeNull()
  })

  it('a reload is a brief absence and leaves the boundary where it was', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const first = seen(clock)
    fire('pagehide')
    first.unmount()
    clock.now += 2_000
    expect(seen(clock).since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a window opened after the app was closed a long while starts from when it closed', () => {
    const clock = { now: NOW }
    const first = seen(clock)
    fire('pagehide')
    first.unmount()
    // A quit takes the window's session storage with it.
    sessionStorage.clear()
    clock.now += 2 * 60 * MINUTE
    expect(seen(clock).since()).toBe(NOW)
  })

  it('a window not in front records no leaving of its own', () => {
    const clock = { now: NOW }
    const front = { value: false }
    const { since } = seen(clock, front)
    fire('blur')
    clock.now += 10 * MINUTE
    expect(localStorage.getItem(awaySinceKey(WS))).toBeNull()
    front.value = true
    fire('focus')
    expect(since()).toBeNull()
  })

  it('two windows keep one boundary: a quick move between them leaves it, and either one moving it moves both', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const front = { value: false }
    const { since } = seen(clock, front)
    // The other window, in front, is left; this one is chosen 30 s later.
    localStorage.setItem(awaySinceKey(WS), String(NOW))
    clock.now += 30_000
    front.value = true
    fire('focus')
    expect(since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
    // The other window moves the boundary after a long absence: this one shows the same.
    localStorage.setItem(lastSeenKey(WS), String(NOW + 5 * MINUTE))
    window.dispatchEvent(new StorageEvent('storage', { key: lastSeenKey(WS) }))
    expect(since()).toBe(NOW + 5 * MINUTE)
  })

  it('another window’s leaving heard late is replaced by this window’s own', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 60 * MINUTE))
    const clock = { now: NOW }
    const { since } = seen(clock)
    // The window the person came from says it was left, after this one is already in front.
    localStorage.setItem(awaySinceKey(WS), String(NOW - 10 * MINUTE))
    fire('blur')
    clock.now += 3 * MINUTE
    fire('focus')
    // Three minutes away is a glance, whatever the other window wrote earlier.
    expect(since()).toBe(NOW - 60 * MINUTE)
    expect(boundary()).toBe(String(NOW - 60 * MINUTE))
  })

  it('a window opened again starts from what the last one wrote', () => {
    localStorage.setItem(lastSeenKey(WS), String(NOW - 90 * MINUTE))
    expect(seen({ now: NOW }).since()).toBe(NOW - 90 * MINUTE)
  })
})

it('Recent activity reports a transcript cleanup without claiming that nothing happened', () => {
  const value = {
    ...reading([]),
    transcriptsCleared: [{ at: NOW - 1000, days: 90, conversations: 3, bytes: 1288490189 }],
  }
  const { m } = page(value)
  expect(m.q('activity-transcripts-cleared').textContent).toContain(
    'Cleared the transcripts of 3 conversations unused for 90 days, freeing 1.2 GB.',
  )
  expect(m.all('activity-empty')).toHaveLength(0)
})

it('Recent activity names an early stop even when no transcript was cleared', () => {
  const value = {
    ...reading([]),
    transcriptsCleared: [
      { at: NOW - 1000, days: 90, conversations: 0, bytes: 0, stoppedEarly: true as const },
    ],
  }
  const { m } = page(value)
  expect(m.q('activity-transcripts-cleared').textContent).toContain(
    'Transcript clearing stopped after 15 seconds so agents could start. No transcripts were cleared. The rest will be checked next time BroCrew starts.',
  )
  expect(m.all('activity-empty')).toHaveLength(0)
})
