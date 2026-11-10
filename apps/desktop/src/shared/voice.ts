export const VOICE_CHANNELS = {
  start: 'voice:start',
  stop: 'voice:stop',
  cancel: 'voice:cancel',
  openSettings: 'voice:open-settings',
  state: 'voice:state',
} as const

export type VoicePhase = 'permission' | 'listening' | 'transcribing'
export const VOICE_ERRORS = {
  unavailable: 'Voice input could not start. Restart BroCrew and try again.',
  busy: 'Voice input is already in use. Stop it in the other window first.',
  local: 'Local speech recognition is not available for your Mac’s language.',
  microphone: 'Allow BroCrew in System Settings → Privacy & Security → Microphone, then try again.',
  speech:
    'Allow BroCrew in System Settings → Privacy & Security → Speech Recognition, then try again.',
  audio: 'The microphone could not start. Check your input device and try again.',
  recognition: 'Speech could not be transcribed on this Mac. Try again.',
  empty: 'No speech was recognized. Try again.',
  timeout: 'Voice input took too long. Try again.',
  protocol: 'Voice input stopped unexpectedly. Try again.',
  cancelled: '',
} as const
export type VoiceError = keyof typeof VOICE_ERRORS
/** The errors a person fixes in a System Settings pane. */
export type VoiceSettingsPane = 'microphone' | 'speech'
export function isVoiceSettingsPane(value: unknown): value is VoiceSettingsPane {
  return value === 'microphone' || value === 'speech'
}
export type VoiceResult = { ok: true; text: string } | { ok: false; error: VoiceError }
export interface VoiceState {
  id: string
  phase: VoicePhase
}
export interface VoiceBridge {
  readonly supported: boolean
  start(id: string): Promise<VoiceResult>
  stop(id: string): Promise<void>
  cancel(id: string): Promise<void>
  openSettings(pane: VoiceSettingsPane): Promise<void>
  onState(listener: (state: VoiceState) => void): () => void
}
export function isVoiceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(id)
}
export function isVoicePhase(value: unknown): value is VoicePhase {
  return value === 'permission' || value === 'listening' || value === 'transcribing'
}
export function appendDictation(draft: string, spoken: string): string {
  const words = spoken.trim()
  return words ? draft + (draft && !/\s$/.test(draft) ? ' ' : '') + words : draft
}
