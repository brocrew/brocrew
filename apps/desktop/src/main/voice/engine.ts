import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  VOICE_ERRORS,
  isVoicePhase,
  type VoiceError,
  type VoicePhase,
  type VoiceResult,
} from '../../shared/voice'

export interface VoiceSession {
  result: Promise<VoiceResult>
  stop(): void
  cancel(): void
}
export type VoiceEngine = (state: (phase: VoicePhase) => void) => VoiceSession

/** The child pipe carries bounded status and final text, never framework diagnostics. */
export function runVoiceHelper(
  binary: string,
  state: (phase: VoicePhase) => void,
  launch: (binary: string) => ChildProcessWithoutNullStreams = (binary) =>
    spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
): VoiceSession {
  const child = launch(binary)
  let answer: VoiceResult | undefined
  let cancelled = false
  let closed = false
  let terminal = false
  let phase: VoicePhase = 'permission'
  let announced = false
  let stopRequested = false
  let bytes = 0
  let buffer = ''
  let deadline: ReturnType<typeof setTimeout>
  let reap: ReturnType<typeof setTimeout> | undefined
  let resolve!: (result: VoiceResult) => void
  const result = new Promise<VoiceResult>((done) => {
    resolve = done
  })
  // Once the helper has handed over its text, nothing after it (a slow exit, a kill) replaces it.
  const fail = (error: VoiceError): void => {
    if (closed) return
    if (answer?.ok !== true) answer = { ok: false, error }
    terminal = true
    clearTimeout(deadline)
    child.kill('SIGTERM')
    reap ??= setTimeout(() => {
      if (!closed) child.kill('SIGKILL')
    }, 500)
  }
  const bound = (ms: number): void => {
    clearTimeout(deadline)
    deadline = setTimeout(() => fail('timeout'), ms)
  }
  bound(120_000)
  child.stdin.on('error', () => fail('protocol'))
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > 32_768) fail('protocol')
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (terminal) return
    bytes += Buffer.byteLength(chunk)
    if (bytes > 32_768) {
      fail('protocol')
      return
    }
    buffer += chunk
    while (buffer.includes('\n') && !terminal) {
      const at = buffer.indexOf('\n')
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      try {
        const item: unknown = JSON.parse(line)
        if (!item || typeof item !== 'object') {
          fail('protocol')
          return
        }
        const value = item as Record<string, unknown>
        if (isVoicePhase(value.state)) {
          const next = value.state
          if (
            (announced && next === phase) ||
            (next === 'permission' && phase !== 'permission') ||
            (next === 'listening' && phase !== 'permission') ||
            (next === 'transcribing' && phase !== 'listening')
          ) {
            fail('protocol')
            return
          }
          phase = next
          announced = true
          bound(next === 'permission' ? 120_000 : next === 'listening' ? 52_000 : 15_000)
          state(next)
        } else if (
          typeof value.text === 'string' &&
          value.text.length <= 8_192 &&
          value.text.trim() &&
          phase !== 'permission'
        ) {
          answer = { ok: true, text: value.text.trim() }
          terminal = true
          bound(1_000)
        } else if (typeof value.error === 'string' && Object.hasOwn(VOICE_ERRORS, value.error)) {
          answer = { ok: false, error: value.error as VoiceError }
          terminal = true
          bound(1_000)
        } else {
          fail('protocol')
        }
      } catch {
        fail('protocol')
      }
    }
  })
  child.once('error', () => {
    if (answer?.ok !== true) answer = { ok: false, error: 'unavailable' }
  })
  child.once('close', () => {
    closed = true
    clearTimeout(deadline)
    clearTimeout(reap)
    resolve(
      cancelled ? { ok: false, error: 'cancelled' } : (answer ?? { ok: false, error: 'protocol' }),
    )
  })
  return {
    result,
    stop() {
      if (closed || terminal || stopRequested || phase !== 'listening') return
      stopRequested = true
      bound(15_000)
      child.stdin.write('stop\n')
    },
    cancel() {
      if (closed || cancelled) return
      cancelled = true
      fail('cancelled')
    },
  }
}
