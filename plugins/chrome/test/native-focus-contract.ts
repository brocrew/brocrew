// Pure evidence checks; no GUI actions or browser launch.
export interface NativeSample {
  at: number
  pid: number
  bundle: string
  space: string
  displays: Record<string, string>
  name?: string
  bundlePath?: string
  nativeAt?: number
}
export interface NativeSnapshot {
  capturedAt: number
  sample: NativeSample
  observed?: boolean
  ancestryKnown?: boolean
  frontmostOwnership?: { owned: boolean }
}
export function classifyPid(
  pid: number,
  roots: number[],
  rows: Array<{ pid: number; ppid: number }>,
) {
  const parents = new Map(rows.map((row) => [row.pid, row.ppid]))
  const chain: number[] = []
  let current = pid
  while (current > 0 && !chain.includes(current)) {
    chain.push(current)
    if (roots.includes(current))
      return {
        owned: true,
        relation: current === pid ? 'direct' : 'descendant',
        rootPid: current,
        chain,
      }
    current = parents.get(current) ?? 0
  }
  return { owned: false, relation: 'neither', rootPid: null, chain }
}
export function calibrateNativeClock(sentAt: number, receivedAt: number, nativeAt: number) {
  const valid = [sentAt, receivedAt, nativeAt].every(Number.isFinite) && receivedAt >= sentAt
  const uncertainty = valid ? (receivedAt - sentAt) / 2 : null
  return {
    offset: valid ? (sentAt + receivedAt) / 2 - nativeAt : null,
    uncertainty,
    warning: !valid
      ? 'native clock calibration unavailable'
      : uncertainty! > 100
        ? 'native clock calibration uncertainty exceeds100ms'
        : undefined,
  }
}
export interface NativeCaseInput {
  expectedPid: number
  ownedPids: number[]
  start: number
  returnedAt: number
  before: NativeSnapshot
  at1: NativeSnapshot
  at4: NativeSnapshot
  samples: NativeSample[]
}
export function diagnoseNativeTiming(input: NativeCaseInput): string[] {
  const { before, at1, at4, samples } = input
  const failures: string[] = []
  if (
    [before.sample, ...samples, at1.sample, at4.sample].some(
      (s) =>
        !Number.isFinite(s.at) ||
        s.pid <= 0 ||
        !s.bundle ||
        s.space === '0' ||
        !Object.keys(s.displays).length,
    )
  )
    failures.push('native identity or Space unavailable')
  if (before.sample.pid !== input.expectedPid)
    failures.push('baseline is not the pinned BroCrew process')
  if (input.ownedPids.includes(before.sample.pid))
    failures.push('baseline is an owned Chrome process')
  const snapshots = [before, at1, at4]
  if (
    ![input.start, input.returnedAt, ...snapshots.map((s) => s.capturedAt)].every(Number.isFinite)
  )
    failures.push('invalid observation timestamps')
  // Native observations are timestamped on receipt in the same Node monotonic clock.
  // Calibration remains a recorded diagnostic, never an observation admission gate.
  if (snapshots.some((s) => s.capturedAt - s.sample.at < 0 || s.capturedAt - s.sample.at > 20))
    failures.push('stale native sample')
  if (
    Math.abs(at1.capturedAt - input.returnedAt - 1000) > 250 ||
    Math.abs(at4.capturedAt - input.returnedAt - 4000) > 250
  )
    failures.push('observation timing outside 250ms tolerance')
  if (samples.length < 20) failures.push('too few native samples')
  const stream = [before.sample, ...samples.filter((s) => s.at !== before.sample.at)]
  if (stream.some((s, index) => index > 0 && s.at <= stream[index - 1].at))
    failures.push('native timestamps are not monotonic')
  if (
    stream.some((s, index) => index > 0 && s.at - stream[index - 1].at > 20) ||
    at4.capturedAt - (stream.at(-1)?.at ?? input.start) > 20
  )
    failures.push('native observation gap exceeds 20ms')
  const observed = [...samples, at1.sample, at4.sample]
  if (observed.some((s) => s.pid !== before.sample.pid || s.bundle !== before.sample.bundle))
    failures.push('intermediate frontmost application changed')
  if (observed.some((s) => s.space !== before.sample.space)) failures.push('global Space changed')
  const displayKey = (s: NativeSample) => JSON.stringify(Object.entries(s.displays).sort())
  if (observed.some((s) => displayKey(s) !== displayKey(before.sample)))
    failures.push('display active Space changed')
  return failures
}
// W4 2026-10-31 16:15: only the two endpoint ownership/Space observations decide a case.
export function assessNativeCase(input: NativeCaseInput): string[] {
  const failures: string[] = []
  const endpoints = [input.at1, input.at4]
  if (
    endpoints.some(
      (e) =>
        e.observed === false ||
        !Number.isInteger(e.sample.pid) ||
        e.sample.pid <= 0 ||
        !e.sample.bundle,
    )
  )
    failures.push('endpoint frontmost identity unavailable')
  if (endpoints.some((e) => e.ancestryKnown !== true))
    failures.push('endpoint ancestry unavailable')
  if (
    endpoints.some(
      (e) => input.ownedPids.includes(e.sample.pid) || e.frontmostOwnership?.owned === true,
    )
  )
    failures.push('owned Chrome or descendant is frontmost at an endpoint')
  const validSpace = (value: string) => !!value && value !== '0'
  if (
    !validSpace(input.before.sample.space) ||
    endpoints.some(
      (e) => !validSpace(e.sample.space) || e.sample.space !== input.before.sample.space,
    )
  )
    failures.push('endpoint global Space changed or unavailable')
  const displayKey = (s: NativeSample) => JSON.stringify(Object.entries(s.displays).sort())
  if (
    !Object.keys(input.before.sample.displays).length ||
    endpoints.some(
      (e) =>
        !Object.keys(e.sample.displays).length ||
        displayKey(e.sample) !== displayKey(input.before.sample),
    )
  )
    failures.push('endpoint display active Space changed or unavailable')
  return failures
}
export type NativeFatalCondition = 'positive-control' | 'screen-lock' | 'owned-pid' | 'cleanup'
export class NativeFatalError extends Error {
  constructor(
    readonly condition: NativeFatalCondition,
    message: string,
  ) {
    super(message)
  }
}
export async function runNativeCases<T>(
  count: number,
  run: (index: number) => Promise<T>,
  onError: (index: number, error: unknown) => Promise<T>,
): Promise<T[]> {
  const results: T[] = []
  for (let index = 0; index < count; index++) {
    try {
      results.push(await run(index))
    } catch (error) {
      if (error instanceof NativeFatalError) throw error
      results.push(await onError(index, error))
    }
  }
  return results
}
export function finalNativeVerdict(input: {
  positiveDetected: boolean
  screenLocked: boolean
  caseFailures: string[][]
  cleanup: { observerExited: boolean; rootRemoved: boolean; ownedProcessesGone: boolean }
}): 'passed' | 'failed' {
  return input.positiveDetected === true &&
    input.screenLocked === false &&
    input.caseFailures.length === 4 &&
    input.caseFailures.every((f) => f.length === 0) &&
    input.cleanup.observerExited === true &&
    input.cleanup.rootRemoved === true &&
    input.cleanup.ownedProcessesGone === true
    ? 'passed'
    : 'failed'
}
