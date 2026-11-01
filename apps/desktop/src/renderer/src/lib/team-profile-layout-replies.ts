import type { LayoutReply } from './team-profile-layout'

export function parseLayoutReply(value: unknown): LayoutReply | null {
  try {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const generation = record.generation
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0)
      return null
    const keys = Object.keys(record)
    if (record.type === 'paused' || record.type === 'failed') {
      if (keys.length !== 2 || keys.some((key) => key !== 'type' && key !== 'generation'))
        return null
      return { type: record.type, generation }
    }
    if (
      record.type !== 'positions' ||
      keys.length !== 3 ||
      keys.some((key) => key !== 'type' && key !== 'generation' && key !== 'positions')
    )
      return null
    const positions = record.positions
    if (
      !(positions instanceof Float64Array) ||
      positions.length > 2000 ||
      positions.length % 2 !== 0 ||
      positions.some((coordinate) => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1e8)
    )
      return null
    return { type: 'positions', generation, positions }
  } catch {
    return null
  }
}
