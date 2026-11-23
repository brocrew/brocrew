import type { NativeRun } from '@brobot2/runtime'

/** Sparse updates retain input and other facts supplied by earlier phases. */
export function mergeRun(
  before: NativeRun | undefined,
  update: NativeRun | undefined,
): NativeRun | undefined
export function mergeRun(
  before: Partial<NativeRun> | undefined,
  update: Partial<NativeRun> | undefined,
): Partial<NativeRun> | undefined
export function mergeRun(
  before: Partial<NativeRun> | undefined,
  update: Partial<NativeRun> | undefined,
): Partial<NativeRun> | undefined {
  if (update === undefined) return before
  return {
    ...before,
    ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
  }
}
