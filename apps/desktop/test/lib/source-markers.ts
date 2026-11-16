import { expect } from 'vitest'

/** The index of a marker that is in the source exactly once. */
export function once(marker: string, file: string, source: string): number {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${file}`).toBeGreaterThan(-1)
  expect(
    source.indexOf(marker, at + 1),
    `${JSON.stringify(marker)} is in ${file} more than once`,
  ).toBe(-1)
  return at
}

/** From a marker that is in the source once, to (not including) the first `closing` after it. */
export function sliceOf(marker: string, closing: string, file: string, source: string): string {
  const at = once(marker, file, source)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)} in ${file}`).toBeGreaterThan(
    at,
  )
  return source.slice(at, end)
}
