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
export interface TranscriptsCleared {
  readonly at: number
  readonly days: number
  readonly conversations: number
  readonly bytes: number
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
  return `Cleared the transcripts of ${read.conversations} ${read.conversations === 1 ? 'conversation' : 'conversations'} unused for ${period}, freeing ${size} ${units[unit]}.`
}
