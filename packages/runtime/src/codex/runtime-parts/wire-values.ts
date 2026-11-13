export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

export function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

export function readOptionalString(value: unknown, key: string): string | undefined {
  return readString(value, key) || undefined
}

// Filter malformed provider entries rather than displaying coerced objects; no usable entries means no report.
export function readStringArray(value: unknown, key: string): readonly string[] | undefined {
  if (!isRecord(value)) return undefined
  const raw = value[key]
  if (!Array.isArray(raw)) return undefined
  const items = raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  return items.length > 0 ? items : undefined
}

// Preserve id type: numeric 1 and string "1" are distinct requests throughout the lifecycle.
export function requestKey(id: string | number): string {
  return `${typeof id}:${id}`
}

// Only numeric ids can participate in the session's monotonic retired-id floor.
export function numericIdFromKey(key: string): number | null {
  if (!key.startsWith('number:')) return null
  const value = Number(key.slice('number:'.length))
  return Number.isFinite(value) ? value : null
}
