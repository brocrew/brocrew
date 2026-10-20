export const TRANSCRIPT_RETENTION_CHANNELS = {
  read: 'app:transcript-retention:read',
  set: 'app:transcript-retention:set',
} as const

export const TRANSCRIPT_RETENTION_CHOICES = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 'forever', label: 'Forever' },
] as const
export type TranscriptRetention = (typeof TRANSCRIPT_RETENTION_CHOICES)[number]['value']
export const DEFAULT_TRANSCRIPT_RETENTION: TranscriptRetention = 90
export const TRANSCRIPT_RETENTION_FILE = 'transcript-retention.json'
export const TRANSCRIPT_CLEARING_DEADLINE_MS = 15_000
export interface TranscriptsCleared {
  readonly at: number
  readonly days: number
  readonly conversations: number
  readonly bytes: number
  readonly stoppedEarly?: true
}
export function isTranscriptRetention(value: unknown): value is TranscriptRetention {
  return TRANSCRIPT_RETENTION_CHOICES.some((choice) => choice.value === value)
}
export function transcriptsClearedWords(read: TranscriptsCleared): string {
  let bytes = read.bytes
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unit = 0
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024
    unit++
  }
  const size = unit === 0 ? String(bytes) : bytes.toFixed(1)
  const period = read.days === 365 ? '1 year' : `${read.days} days`
  const prefix = read.stoppedEarly
    ? `Transcript clearing stopped after ${TRANSCRIPT_CLEARING_DEADLINE_MS / 1000} seconds so agents could start. `
    : ''
  const rest = read.stoppedEarly ? ' The rest will be checked next time BroCrew starts.' : ''
  if (read.conversations === 0 && read.stoppedEarly)
    return `${prefix}No transcripts were cleared.${rest}`
  return `${prefix}Cleared the transcripts of ${read.conversations} ${read.conversations === 1 ? 'conversation' : 'conversations'} unused for ${period}, freeing ${size} ${units[unit]}.${rest}`
}
