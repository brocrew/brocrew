import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import { homeAttention } from '../../src/renderer/src/lib/home-attention'
import { DEFAULT_ACTIVITY_WINDOW_MS } from '../../src/renderer/src/lib/recent-activity'
import type { ActivityLine, RecentActivityReading } from '../../src/shared/recent-activity'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **606 · the split, PAINTED** — `EXT-008` §3, and rule 17.2's photograph is what this file is
 * the assertion half of.
 *
 * ⛔ **In the DOM project because every claim below is about what a person SEES**: two rows in the
 * rail with one badge between them, and two pages each holding one population. ⚠️
 * `brobot2-ssr-tests-pass-vacuously` — a rendered string proves none of it.
 *
 * ⚑ **D-016** deleted Home — the placeholder dashboard over the demo seed that held neither
 * population — with the seed, so §3 (*Home keeps the fixture*) and the rail's Home row went too.
 *
 * ⚑ **The two worlds are built ONCE and the numbers are derived from them**, so the case that
 * says *the two counts are different* is measuring two derivations rather than two literals
 * (`a-comparison-tested-where-both-sides-agree`).
 */

const NOW = 1_700_000_000_000
const TO = 1_760_000_000_000

const SCOPE = {
  cwd: '/Users/alex/dev/x',
  paths: ['write /Users/alex/dev/x/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

const PERMISSION: TranscriptEvent = {
  type: 'permission_request',
  id: 'perm-1',
  kind: 'command',
  action: 'Bash',
  detail: 'pnpm test:e2e --project=chromium',
  scope: SCOPE,
}

function conversation(sessionId: string, at: number): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: `/Users/alex/dev/${sessionId}`,
    profileId: 'default',
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: at },
  } as never
  acceptEvent(record, { sessionId, ordinal: 0, event: PERMISSION, at } as RuntimeEventMessage)
  return record
}

/** ⚑ **Two open conversations frozen on a permission** — the complete population. */
const OWED = (): AttentionRequest[] =>
  attentionQueue(
    [conversation('sess_a', NOW - 240_000), conversation('sess_b', NOW - 900_000)] as never,
    () => 'waiting: permission',
  )

/** ⚑ **A Recent activity reading with three lines** — the windowed population. */
function reading(): RecentActivityReading {
  const line = (id: string, what: ActivityLine['what'], at: number): ActivityLine => ({
    id,
    at,
    what,
    register: what === 'finished' || what === 'failed' ? 'claimed' : 'observed',
    piece: { id, label: `W1.${id}`, title: 'Check the release notes' },
    agent: 'Ada',
    conversation: `sess_${id}`,
  })
  return {
    window: { from: TO - DEFAULT_ACTIVITY_WINDOW_MS, to: TO },
    read: { walk: 'one-window-over-every-agents-conversation', ledgers: 5, rowsUnread: 0 },
    lines: [
      line('1', 'finished', TO - 90_000),
      line('2', 'failed', TO - 80_000),
      line('3', 'started', TO - 60_000),
    ],
    capped: false,
  } as RecentActivityReading
}

let mounted: Mounted | null = null
afterEach(() => {
  mounted = null
  unmountAll()
})

const text = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * ⚑ **Mounted at `251.68`, which is `--rail-w`'s own value and a width this app actually draws.**
 * ⛔ **Not a number chosen for the assertion** — `531`'s census keeps a backlog of suites that
 * measure the rail at a width it never has, and a new member of that backlog is a new defect
 * rather than a new test. ⚠️ Its own count is asserted, which is what made this a decision here
 * instead of a line somebody added later.
 */
describe('§1 · the rail draws two destinations and one count between them', () => {
  it('🔴 both rows are painted, in reading order, and only the complete one is badged', async () => {
    // ⚑ **The two numbers are DERIVED from the two worlds**, which is what makes the inequality
    // below a measurement rather than two literals that happen to differ.
    const owed = homeAttention({
      requests: OWED(),
      onlyYou: 1,
      unread: false,
    }).total
    const changed = reading().lines.length
    expect(owed).toBe(3)
    expect(changed).toBe(3)

    mounted = mount(
      SideRail,
      { open: [], activeId: null, place: 'waiting', needsYou: owed },
      { width: 251.68, height: 900 },
    )
    await nextTick()

    const waiting = mounted.q('rail-waiting')
    const away = mounted.q('rail-away')
    expect(visible(waiting)).toBe(true)
    expect(visible(away)).toBe(true)

    // ⛔ **The ORDER a person reads** — `EXT-008` §5's list, measured in pixels rather than in the
    // source, because a `v-if` could reorder them without moving a line. ⚑ D-016 took the Home
    // row that stood below them.
    expect(waiting.getBoundingClientRect().top).toBeLessThan(away.getBoundingClientRect().top)

    // ⛔ **The words, read off the painted rows** — `531`'s rule: a `textContent` assertion cannot
    // tell a drawn line from a clipped one, so the box is checked too.
    expect(text(waiting)).toContain('Waiting on you')
    expect(text(away)).toContain('Recent activity')

    // 🔴 **One badge, and it is the COMPLETE count** — `EXT-008` §5 keeps counts off the rail and
    // the mockup badges this row alone. ⚑ The windowed count is on its own page; see §3.
    const badge = mounted.q('waiting-badge')
    expect(visible(badge)).toBe(true)
    expect(text(badge)).toBe(String(owed))
    expect(mounted.all('away-badge')).toHaveLength(0)
  })

  /**
   * ⛔ **Zero draws NO badge**, which is `009`'s rule kept: a `0` on the rail is a mark that says
   * nothing, and the honest report of nothing waiting is the absence of the mark.
   */
  it('⛔ an empty queue draws no badge at all', async () => {
    mounted = mount(
      SideRail,
      { open: [], activeId: null, place: 'waiting', needsYou: 0 },
      { width: 251.68, height: 900 },
    )
    await nextTick()
    expect(mounted.all('waiting-badge')).toHaveLength(0)
    // ⚑ The paired positive, so the absence above is about the badge and not about the row.
    expect(visible(mounted.q('rail-waiting'))).toBe(true)
  })
})

describe('§2 · each destination paints ONE population, and not the other’s', () => {
  it('🔴 Waiting on you paints the queue, its bound and its stat — and nothing windowed', async () => {
    mounted = mount(WaitingOnYou, { needsYou: OWED(), clock: NOW }, { width: 1040, height: 900 })
    await nextTick()

    expect(mounted.all('attention-request-sess_a')).toHaveLength(1)
    expect(mounted.all('attention-request-sess_b')).toHaveLength(1)
    expect(text(mounted.q('waiting-stat'))).toBe('2 items')
    // ⛔ **The BOUND, in words, on the destination** — `HO-025` §2's half of the split. A page that
    // listed a complete queue without saying it was complete would be one property short.
    expect(visible(mounted.q('waiting-bound'))).toBe(true)
    expect(text(mounted.q('waiting-bound'))).toContain('not windowed')

    // 🔴 **Nothing windowed is on it** — the disjointness `EXT-008` §3 is about, asserted as an
    // absence beside the positives that make it mean something. ⚑ D-016 deleted the seed, so the
    // *nothing seeded* half has nothing left to be.
    expect(mounted.all('activity-list')).toHaveLength(0)
    expect(text(mounted.host)).not.toContain('Recent activity')
  })

  it('🔴 Recent activity paints its lines and its window — and no queue', async () => {
    mounted = mount(
      RecentActivity,
      { reading: reading(), windowMs: DEFAULT_ACTIVITY_WINDOW_MS, clock: TO },
      { width: 1040, height: 900 },
    )
    await nextTick()

    expect(visible(mounted.q('activity-list'))).toBe(true)
    expect(mounted.all('activity-line')).toHaveLength(3)
    // ⛔ **The window is chosen above the lines**, and the chosen one is marked.
    const chosen = mounted.q(`activity-window-${String(DEFAULT_ACTIVITY_WINDOW_MS)}`)
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    expect(chosen.getBoundingClientRect().top).toBeLessThan(
      mounted.q('activity-list').getBoundingClientRect().top,
    )

    expect(mounted.all('attention-request-sess_a')).toHaveLength(0)
    expect(mounted.all('waiting-stat')).toHaveLength(0)
  })

  /**
   * ⛔ **`null` is not zero.** ⚑ A window nobody has read has nothing to say, and an empty list
   * there would be the strongest thing this page could claim about a database it has not opened.
   */
  it('⛔ with nothing read, no list is drawn and the page says it has not read yet', async () => {
    mounted = mount(
      RecentActivity,
      { reading: null, windowMs: DEFAULT_ACTIVITY_WINDOW_MS, clock: TO },
      { width: 1040, height: 900 },
    )
    await nextTick()
    expect(mounted.all('activity-list')).toHaveLength(0)
    expect(mounted.all('activity-empty')).toHaveLength(0)
    expect(visible(mounted.q('activity-not-read'))).toBe(true)
  })
})
