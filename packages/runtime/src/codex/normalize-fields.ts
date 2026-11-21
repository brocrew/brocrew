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
 * A finite number at `key`, or undefined. Copied from `claude/normalize.ts` because the two files
 * share no runtime module by design. `modelContextWindow` is a denominator, so absence must stay
 * absence rather than becoming a zero.
 */
export function readNumber(value: unknown, key: string): number | undefined {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}
