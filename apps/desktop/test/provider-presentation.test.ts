import { describe, expect, it } from 'vitest'
import { providerDescriptor } from '@brobot2/shared'
import { parseRuntimeEvent, type RuntimeEvent } from '@brobot2/runtime'
import { errorForDisplay } from '../src/main/providers/error-presentation'
import { eventForDisplay, transcripts } from '../src/main/providers/claude/transcripts'
import type { TranscriptEvent } from '../src/shared/conversation-events'

const refusal = {
  is: 'model-needs-a-newer-cli' as const,
  model: 'fictional-fern',
  needs: '9.2.0',
  runs: '9.1.0',
}
const shown =
  'fictional-fern needs Claude Code 9.2.0 or newer, and this app runs Claude ' +
  'Code 9.1.0. Update Claude Code, or choose another model for this conversation.'

describe('provider-owned presentation for the window', () => {
  it('supplies probe success words alongside the existing name and mark', () => {
    expect(providerDescriptor('claude').signIn.manualProbeSuccess).toBe('Claude sign-in works.')
    expect(providerDescriptor('codex').signIn.manualProbeSuccess).toBeUndefined()
    const fictional = {
      ...providerDescriptor('claude'),
      id: 'fern',
      displayName: 'Fern Harness',
      signIn: { ...providerDescriptor('claude').signIn, manualProbeSuccess: 'Fern is connected.' },
    }
    expect(fictional.signIn.manualProbeSuccess).toBe('Fern is connected.')
    expect(fictional.displayName).toBe('Fern Harness')
  })

  it.each([false, true])(
    'decorates live and old replay rows without changing fatal=%s or raw diagnostics',
    (fatal) => {
      const event: TranscriptEvent = {
        type: 'error',
        message: 'fictional native diagnostic',
        fatal,
        refusal,
      }
      const saved = JSON.stringify(event)
      const live = eventForDisplay(event)
      const replay = transcripts.eventForDisplay!(JSON.parse(saved) as TranscriptEvent)
      expect(live).toEqual({
        ...event,
        presentation: {
          message: shown,
          level: fatal ? 'error' : 'warn',
          terminal: fatal,
          repeat: 'each',
        },
      })
      expect(replay).toEqual(live)
      expect(JSON.stringify(event)).toBe(saved)
      expect(live).toMatchObject({ message: event.message, fatal, refusal })
      expect(event).not.toHaveProperty('presentation')
    },
  )

  it('keeps existing sign-in observation and unrelated provider events', () => {
    const event: TranscriptEvent = {
      type: 'error',
      message: 'fictional auth failure',
      fatal: true,
      cause: 'auth',
      refusal,
    }
    expect(eventForDisplay(event)).toMatchObject({
      presentation: { message: shown },
      signIn: { state: 'refused' },
      message: event.message,
      fatal: true,
      cause: 'auth',
    })
    const other: TranscriptEvent = { type: 'assistant_message', text: 'Fern reply' }
    expect(eventForDisplay(other)).toBe(other)
  })

  it('does not invent advice for unknown or malformed historical refusal data', () => {
    for (const value of [{ is: 'fern-future' }, { ...refusal, needs: 9 }]) {
      const event: TranscriptEvent = {
        type: 'error',
        message: 'fictional native diagnostic',
        fatal: false,
      }
      Reflect.set(event, 'refusal', value)
      expect(eventForDisplay(event)).toBe(event)
    }
  })

  it('carries opaque fictional presentation in the existing error schema', () => {
    const event: RuntimeEvent = {
      type: 'error',
      message: 'fictional raw detail',
      fatal: false,
      presentation: { message: 'Fern needs its workspace opened. Choose a folder.' },
    }
    expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  })
})

it('preserves supplied fictional retry endings through the existing runtime schema and display projection', () => {
  const captions = {
    stopped: 'Fern paused its retry.',
    ended: 'Fern retry finished.',
    recovered: 'Fern is connected.',
  }
  const event: RuntimeEvent = {
    type: 'error',
    message: 'fictional raw detail',
    fatal: false,
    signIn: { state: 'retrying', message: 'Fern is reconnecting.', captions },
  }
  expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  expect(errorForDisplay(event, 'Another display name')).toBe(event)
  expect(errorForDisplay(event)).toBe(event)
  expect(event.message).toBe('fictional raw detail')
})

it('keeps supplied opaque retry rows without inventing provider endings', () => {
  const event: RuntimeEvent = {
    type: 'error',
    message: 'fictional raw detail',
    fatal: false,
    presentation: {
      message: 'Existing rich presentation',
      level: 'warn',
      terminal: false,
      repeat: 'each',
    },
    signIn: { state: 'retrying', message: 'An existing opaque retry line.' },
  }
  const saved = JSON.stringify(event)
  const displayed = errorForDisplay(event, 'Fern')
  expect(displayed).toBe(event)
  expect(displayed.signIn).toBe(event.signIn)
  expect(displayed.signIn?.captions).toBeUndefined()
  expect(JSON.stringify(event)).toBe(saved)
  expect(errorForDisplay(displayed, 'Fern')).toBe(displayed)
  const key: RuntimeEvent = { ...event, onAKey: true }
  expect(errorForDisplay(key, 'Fern')).toMatchObject({ signIn: event.signIn })
})
