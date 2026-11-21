export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

export function readString(value: unknown, key: string): string {
  const field = readField(value, key)
  return typeof field === 'string' ? field : ''
}

/**
 * A finite number at `key`, or undefined (087) — the same helper `claude/normalize.ts` already has,
 * and it is a copy for the same reason every other one here is: these two files share no runtime
 * module by design, so neither can drift the other's parsing.
 *
 * ⚠️ **`Number.isFinite` is not decoration.** `modelContextWindow` is a denominator, and JSON is
 * perfectly happy to carry a value that is not a number; absence must stay absence rather than
 * becoming a zero the meter would divide by.
 */
export function readNumber(value: unknown, key: string): number | undefined {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}
