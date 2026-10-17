import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIMITS_LOOK_EVERY_MS,
  LOOK_EVERY_MS,
  limitsReadCadence,
} from '../src/renderer/src/lib/persons-queue'
import { limitsDisplayLane, type LimitsDisplayState } from '../src/renderer/src/lib/limits-display'
import { readProviderLimit, type ProviderLimitSeen } from '../src/shared/provider-limit'
import type { LedgerWalk } from '../src/shared/questions'

const screen = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
  'utf8',
)
const NOW = Date.UTC(2026, 9, 8, 9)
const actionable = [
  'questionsForAPerson',
  'decisionsForAPerson',
  'stalledWorkForAPerson',
  'instructionAsksForAPerson',
  'waitingOnWhoWroteForAPerson',
  'mcpServerRequestsForAPerson',
  'stoppedWorkForAPerson',
  'workIncidentsForAPerson',
] as const
const wall = readProviderLimit('claude is rate-limited (five_hour)', NOW)
if (wall === null) throw new Error('the fictional provider limit was not recognized')
const walked: LedgerWalk<ProviderLimitSeen> = {
  rows: [wall],
  walk: 'every-provider-wall-recently-recorded',
  ledgers: 1,
  rowsUnread: 0,
  ledgersSkipped: 0,
}
const empty = {
  rows: [],
  walk: 'one-window-over-every-agents-conversation',
  ledgers: 1,
  rowsUnread: 0,
}

function functionSource(name: string): string {
  const start = screen.indexOf(`async function ${name}(`)
  const end = screen.indexOf('\n}\n', start)
  if (start < 0 || end < start) throw new Error(`the screen has no complete ${name} function`)
  return screen.slice(start, end + 2)
}

function fixture() {
  const state = {
    escalated: { value: null },
    decided: { value: null },
    walled: { value: null as typeof walked | null },
    lastWallLookAnswered: { value: true },
    limitsDisplay: {
      value: { status: 'unavailable', reading: null } as LimitsDisplayState,
    },
    stalledWork: { value: null },
    lastStallLookAnswered: { value: true },
    instructionAsks: { value: null },
    lastAskLookAnswered: { value: true },
    waitingOnWhoWrote: { value: null },
    lastReplyLookAnswered: { value: true },
    mcpServerRequests: { value: null },
    lastServerRequestLookAnswered: { value: true },
    stoppedWork: { value: null },
    lastStopLookAnswered: { value: true },
    workIncidents: { value: null },
    lastIncidentLookAnswered: { value: true },
    lastLookAnswered: { value: { questions: true, decisions: true } },
  }
  const store = {
    questionsForAPerson: vi.fn().mockResolvedValue(empty),
    decisionsForAPerson: vi.fn().mockResolvedValue(empty),
    readLimitsDisplay: vi.fn<() => Promise<typeof walked | null>>().mockResolvedValue(walked),
    stalledWorkForAPerson: vi.fn().mockResolvedValue(empty),
    instructionAsksForAPerson: vi.fn().mockResolvedValue([]),
    waitingOnWhoWroteForAPerson: vi.fn().mockResolvedValue(empty),
    mcpServerRequestsForAPerson: vi.fn().mockResolvedValue([]),
    stoppedWorkForAPerson: vi.fn().mockResolvedValue(empty),
    workIncidentsForAPerson: vi.fn().mockResolvedValue(empty),
  }
  const body = functionSource('lookForWhatIsYours')
  expect(body).toContain('void refreshLimitsDisplay(scheduled)')
  expect(functionSource('refreshLimitsDisplay')).toContain(
    'lookAtLimits(() => limitsLane.refresh(() => store.readLimitsDisplay()), scheduled)',
  )
  // Execute the screen's real look with only its return type removed, using fictional IPC replies.
  let operation = 0
  const limitsLane = limitsDisplayLane((next) => {
    state.limitsDisplay.value = next
    state.walled.value = next.reading?.walked ?? null
    state.lastWallLookAnswered.value = next.status === 'ready'
  })
  const runtimeStore = {
    ...store,
    readLimitsDisplay: async () => {
      const mine = ++operation
      const at = Date.now()
      const answer = await store.readLimitsDisplay()
      return answer === null
        ? null
        : {
            is: 'read' as const,
            reading: {
              operation: mine,
              databaseEpoch: 1,
              signInEpoch: 1,
              pinStartedAt: at,
              pinFinishedAt: at,
              evaluatedAt: at,
              usageAt: at,
              finishedAt: at,
              walked: answer,
            },
          }
    },
  }
  const look = runInNewContext(
    `${functionSource('refreshLimitsDisplay').replace(': Promise<void>', '')}; ${body.replace(': Promise<void>', '')}; lookForWhatIsYours`,
    {
      store: runtimeStore,
      limitsLane,
      actionableReadSequence: 0,
      actionableReadsClosed: false,
      lookAtLimits: limitsReadCadence(),
      ...state,
    },
  ) as (scheduled?: boolean) => Promise<void>
  const readTheWorkspace = vi.fn()
  const readWhatIsWaiting = vi.fn()

  function startTimer(): void {
    const timers = screen.match(/looking = setInterval\(\(\) => \{[\s\S]*?\}, LOOK_EVERY_MS\)/g)
    expect(timers).toHaveLength(1)
    const timer = timers?.[0]
    if (timer === undefined) throw new Error('the screen has no actionable look timer')
    runInNewContext(timer, {
      looking: null,
      setInterval,
      LOOK_EVERY_MS,
      lookForWhatIsYours: look,
      readTheWorkspace,
      readWhatIsWaiting,
    })
  }

  return { state, store, look, startTimer, readTheWorkspace, readWhatIsWaiting }
}

describe('limits polling without delaying person asks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('makes two scheduled limits walks and twelve actionable looks in a minute for one window', async () => {
    expect(LOOK_EVERY_MS).toBe(5_000)
    expect(LIMITS_LOOK_EVERY_MS).toBe(30_000)
    const one = fixture()
    const mount = screen.slice(
      screen.indexOf('onMounted(() => {'),
      screen.indexOf('looking = setInterval'),
    )
    expect(mount.match(/void lookForWhatIsYours\(\)/g)).toHaveLength(1)
    await one.look()
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(1)
    for (const name of actionable) one.store[name].mockClear()
    one.store.readLimitsDisplay.mockClear()
    one.startTimer()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
    for (const name of actionable) expect(one.store[name]).toHaveBeenCalledTimes(12)
    expect(one.readTheWorkspace).toHaveBeenCalledTimes(12)
    expect(one.readWhatIsWaiting).toHaveBeenCalledTimes(12)
  })

  it.each(['answerWhereNobodyHolds', 'answerFromTheQueue', 'decideInstructionAsk'])(
    'keeps %s as an immediate fresh limits look',
    async (name) => {
      expect(functionSource(name)).toContain('await lookForWhatIsYours()')
      const one = fixture()
      await one.look()
      vi.setSystemTime(NOW + 1_000)
      await one.look()
      expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
      vi.setSystemTime(NOW + LOOK_EVERY_MS)
      await one.look(true)
      expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
      for (const reader of actionable) expect(one.store[reader]).toHaveBeenCalledTimes(3)
    },
  )

  it('keeps Providers usage refreshes fresh and coalesces only their own pending look', async () => {
    const start = screen.indexOf('function lookAfterAUsageNotice(): void {')
    const end = screen.indexOf('\n}\n', start)
    if (start < 0 || end < start) throw new Error('the usage look disappeared')
    expect(screen).toContain('@usage-moved="lookAfterAUsageNotice"')
    const one = fixture()
    await one.look()
    const usage = runInNewContext(
      `let aLookAfterANotice = null; ${screen.slice(start, end + 2).replace(': void', '')}; lookAfterAUsageNotice`,
      { lookForWhatIsYours: one.look },
    ) as () => void
    vi.setSystemTime(NOW + 1_000)
    usage()
    usage()
    await vi.advanceTimersByTimeAsync(0)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
    vi.setSystemTime(NOW + 2_000)
    usage()
    await vi.advanceTimersByTimeAsync(0)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(3)
  })

  it('does not let immediate refreshes postpone the two periodic limits reads', async () => {
    const one = fixture()
    await one.look()
    one.startTimer()
    await vi.advanceTimersByTimeAsync(10_000)
    await one.look()
    await vi.advanceTimersByTimeAsync(10_000)
    await one.look()
    await vi.advanceTimersByTimeAsync(40_000)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(5)
    for (const name of actionable) expect(one.store[name]).toHaveBeenCalledTimes(15)
  })

  it('keeps a failed limits look and its last good answer through skipped ticks', async () => {
    const one = fixture()
    await one.look()
    one.store.readLimitsDisplay.mockResolvedValue(null)
    vi.setSystemTime(NOW + 1_000)
    await one.look()
    expect(one.state.walled.value).toBe(walked)
    expect(one.state.lastWallLookAnswered.value).toBe(false)
    expect(one.state.limitsDisplay.value.status).toBe('unavailable')
    expect(one.state.limitsDisplay.value.reading?.evaluatedAt).toBe(NOW)
    for (const elapsed of [5_000, 10_000, 25_000]) {
      vi.setSystemTime(NOW + elapsed)
      await one.look(true)
      expect(one.state.walled.value).toBe(walked)
      expect(one.state.lastWallLookAnswered.value).toBe(false)
      expect(one.state.limitsDisplay.value.status).toBe('unavailable')
      expect(one.state.limitsDisplay.value.reading?.evaluatedAt).toBe(NOW)
      expect(one.state.lastLookAnswered.value).toEqual({ questions: true, decisions: true })
    }
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
    const fresh = { ...walked, rowsUnread: 0 }
    one.store.readLimitsDisplay.mockResolvedValue(fresh)
    vi.setSystemTime(NOW + LIMITS_LOOK_EVERY_MS)
    await one.look(true)
    expect(one.state.walled.value).toBe(fresh)
    expect(one.state.lastWallLookAnswered.value).toBe(true)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(3)
  })

  it('does not mistake a skipped tick for the answer to a still pending limits read', async () => {
    const one = fixture()
    let release: ((answer: typeof walked) => void) | undefined
    one.store.readLimitsDisplay.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const initial = one.look()
    vi.setSystemTime(NOW + LOOK_EVERY_MS)
    await one.look(true)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(1)
    expect(one.state.walled.value).toBeNull()
    expect(one.state.limitsDisplay.value.status).toBe('updating')
    expect(one.state.lastWallLookAnswered.value).toBe(false)
    if (release === undefined) throw new Error('the fictional limits read never started')
    release(walked)
    await initial
    await vi.advanceTimersByTimeAsync(0)
    expect(one.state.walled.value).toBe(walked)
  })

  it('starts with a fresh scheduled look and does not wait forever after the clock moves back', async () => {
    const one = fixture()
    await one.look(true)
    vi.setSystemTime(NOW - 60_000)
    await one.look(true)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
    await one.look(true)
    expect(one.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
  })

  it('keeps each window on its own limits schedule', async () => {
    const first = fixture()
    const second = fixture()
    await first.look()
    vi.setSystemTime(NOW + 10_000)
    await second.look()
    vi.setSystemTime(NOW + LIMITS_LOOK_EVERY_MS)
    await first.look(true)
    await second.look(true)
    expect(first.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
    expect(second.store.readLimitsDisplay).toHaveBeenCalledTimes(1)
  })
})
