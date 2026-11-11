import { requireEvidence } from './upgrade-path.mjs'

export const HEADROOM = 10_000_000_000
export const OVERSHOOT = 32 * 1024 * 1024
export const STATE_AND_WAL = 64 * 1024 * 1024

export function measurementSize(value) {
  const bytes = Number(value)
  requireEvidence(
    /^\d+$/.test(String(value)) && Number.isSafeInteger(bytes),
    'Measurement ceiling must be a nonnegative safe decimal integer.',
  )
  return bytes
}

export function requireMeasurementCapacity({ bytes, free, filesystem, cloned }) {
  requireEvidence(
    filesystem === 'apfs' && cloned,
    'Measurement needs APFS and a successful FORCE clone.',
  )
  requireEvidence(
    free >= 3 * (bytes + OVERSHOOT) + HEADROOM + STATE_AND_WAL,
    'Post-build space is below the live/copy/migration-rebuild measurement budget.',
  )
}

export function measurementSizes(ceiling, free) {
  const maximum = Math.min(
    ceiling,
    Math.floor((free - HEADROOM - 2 * STATE_AND_WAL) / 3) - OVERSHOOT,
  )
  requireEvidence(maximum >= 8 * 1024 * 1024, 'No populated fixture fits above the10GB free floor.')
  return [...new Set([Math.max(8 * 1024 * 1024, Math.floor(maximum / 4)), maximum])]
}

export function secondMeasurementSelection({ ceiling, planned, free, firstBytes }) {
  const selected = Math.min(planned, measurementSizes(ceiling, free).at(-1))
  requireEvidence(
    selected > firstBytes,
    'Fresh space cannot fit a second fixture larger than the first populated size.',
  )
  return { ceiling, planned, free, firstBytes, selected }
}
