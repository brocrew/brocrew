import { describe, expect, it } from 'vitest'
import {
  assessNativeCase,
  finalNativeVerdict,
  classifyPid,
  calibrateNativeClock,
} from './native-focus-contract.js'

const sample = (at: number, pid = 41) => ({
  at,
  pid,
  bundle: 'fictional.brocrew',
  space: '9',
  displays: { panel: '9' },
})
function fixture() {
  const samples = Array.from({ length: 801 }, (_, n) => sample(1000 + n * 5))
  return {
    expectedPid: 41,
    ownedPids: [77],
    clockUncertaintyMs: 1,
    start: 1000,
    returnedAt: 1000,
    before: { capturedAt: 1000, sample: sample(995) },
    at1: { capturedAt: 2000, sample: sample(2000.5) },
    at4: { capturedAt: 5000, sample: sample(4999) },
    samples,
  }
}
describe('native focus evidence admission', () => {
  it('bounds monotonic clock conversion before accepting observations', () => {
    expect(calibrateNativeClock(100, 104, 500)).toEqual({ offset: -398, uncertainty: 2 })
    expect(() => calibrateNativeClock(100, 111, 500)).toThrow('uncertainty')
    expect(() => calibrateNativeClock(104, 100, 500)).toThrow('uncertainty')
  })
  it('accepts fresh independent baselines including fractional clock rounding', () => {
    expect(assessNativeCase(fixture())).toEqual([])
  })
  it('rejects already-owned or unreset baselines even when the later PID stays unchanged', () => {
    const f = fixture()
    f.expectedPid = 77
    f.ownedPids = [41]
    expect(assessNativeCase(f)).toContain('baseline is not the pinned BroCrew process')
    expect(assessNativeCase(f)).toContain('baseline is an owned Chrome process')
  })
  it('rejects a brief focus theft even when both endpoints look unchanged', () => {
    const f = fixture()
    f.samples[3] = sample(1015, 77)
    expect(assessNativeCase(f)).toContain('frontmost application changed')
  })
  it('rejects global or per-display Space changes', () => {
    const f = fixture()
    f.samples[2].space = '10'
    expect(assessNativeCase(f)).toContain('global Space changed')
    f.samples[2].space = '9'
    f.samples[3].displays.panel = '11'
    expect(assessNativeCase(f)).toContain('display active Space changed')
  })
  it('rejects a blind interval despite fresh endpoints and many samples', () => {
    const f = fixture()
    f.samples = f.samples.filter((s) => s.at < 2000 || s.at > 3500)
    expect(assessNativeCase(f)).toContain('native observation gap exceeds 20ms')
  })
  it('rejects nonmonotonic data and missing operation-boundary coverage', () => {
    const f = fixture()
    ;[f.samples[3], f.samples[4]] = [f.samples[4], f.samples[3]]
    expect(assessNativeCase(f)).toContain('native timestamps are not monotonic')
    const g = fixture()
    g.samples = g.samples.slice(10)
    expect(assessNativeCase(g)).toContain('native observation gap exceeds 20ms')
  })
  it('refuses unavailable native observations', () => {
    const f = fixture()
    f.samples[5].pid = 0
    expect(assessNativeCase(f)).toContain('native identity or Space unavailable')
  })
  it('rejects stale endpoints and incorrectly timed captures', () => {
    const f = fixture()
    f.at1.sample.at = 1700
    f.at4.capturedAt = 5500
    expect(assessNativeCase(f)).toContain('stale native sample')
    expect(assessNativeCase(f)).toContain('observation timing outside 250ms tolerance')
  })
  it('records exact owned PID ancestry without treating a sibling as owned', () => {
    const rows = [
      { pid: 77, ppid: 1 },
      { pid: 78, ppid: 77 },
      { pid: 79, ppid: 78 },
      { pid: 41, ppid: 1 },
    ]
    expect(classifyPid(77, [77], rows).relation).toBe('direct')
    expect(classifyPid(79, [77], rows)).toMatchObject({
      relation: 'descendant',
      rootPid: 77,
      chain: [79, 78, 77],
    })
    expect(classifyPid(41, [77], rows).relation).toBe('neither')
    expect(
      classifyPid(
        8,
        [77],
        [
          { pid: 8, ppid: 9 },
          { pid: 9, ppid: 8 },
        ],
      ).relation,
    ).toBe('neither')
  })
  it.each(['observerExited', 'rootRemoved', 'ownedProcessesGone'])(
    'cannot PASS without cleanup witness %s',
    (key) => {
      const cleanup = {
        observerExited: true,
        rootRemoved: true,
        ownedProcessesGone: true,
        [key]: false,
      }
      expect(
        finalNativeVerdict({
          positiveDetected: true,
          screenLocked: false,
          caseFailures: [[], [], [], []],
          cleanup,
        }),
      ).toBe('failed')
    },
  )
  it('requires positive calibration and all four cases before final PASS', () => {
    const f = {
      positiveDetected: true,
      screenLocked: false,
      caseFailures: [[], [], [], []],
      cleanup: { observerExited: true, rootRemoved: true, ownedProcessesGone: true },
    }
    expect(finalNativeVerdict(f)).toBe('passed')
    expect(finalNativeVerdict({ ...f, positiveDetected: false })).toBe('failed')
    expect(finalNativeVerdict({ ...f, screenLocked: true })).toBe('failed')
    expect(finalNativeVerdict({ ...f, caseFailures: [[], []] })).toBe('failed')
    expect(finalNativeVerdict({ ...f, caseFailures: [[], ['focus'], [], []] })).toBe('failed')
  })
})
