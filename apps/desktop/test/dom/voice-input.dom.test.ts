import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import type { VoiceBridge, VoiceResult, VoiceState } from '../../src/shared/voice'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  delete (window as unknown as { api?: unknown }).api
})

function composer(supported = true) {
  let resolve!: (value: VoiceResult) => void
  let listener: ((value: VoiceState) => void) | undefined
  let id = ''
  const bridge: VoiceBridge = {
    supported,
    start: vi.fn((token: string) => {
      id = token
      return new Promise<VoiceResult>((done) => {
        resolve = done
      })
    }),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}),
    onState: (next) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }
  ;(window as unknown as { api: unknown }).api = { voice: bridge }
  const draft = ref('Keep my draft')
  const state = ref('idle')
  const identity = ref('first')
  const blocked = ref<{ words: string }[]>([])
  const book = createAttachmentBook()
  const send = vi.fn()
  const Host = defineComponent({
    setup: () => () =>
      h(PromptComposer as Component, {
        state: state.value,
        blocked: blocked.value,
        draft: draft.value,
        canAttach: true,
        cwd: '/fictional',
        handing: book.handing(identity.value),
        'onUpdate:draft': (value: string) => {
          draft.value = value
        },
        onSend: send,
      }),
  })
  const m = mount(Host, {})
  return {
    m,
    bridge,
    draft,
    state,
    identity,
    blocked,
    send,
    handing: book.handing('first'),
    phase: async (phase: VoiceState['phase']) => {
      listener?.({ id, phase })
      await nextTick()
    },
    finish: async (result: VoiceResult) => {
      resolve(result)
      await nextTick()
      await nextTick()
    },
  }
}
async function click(el: HTMLElement) {
  el.click()
  await nextTick()
}

it('records, shows a countdown, preserves live edits and requires a fresh Send', async () => {
  const c = composer()
  await click(c.m.q('voice-mic'))
  expect(c.m.q('voice-status').textContent).toContain('Waiting for permission')
  await c.phase('listening')
  expect(c.m.q('voice-countdown').textContent).toBe('0:50')
  c.draft.value = 'Keep my edited draft'
  await nextTick()
  expect((c.m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
  c.m
    .q('prompt-input')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  await nextTick()
  expect(c.send).not.toHaveBeenCalled()
  await click(c.m.q('voice-mic'))
  expect(c.bridge.stop).toHaveBeenCalledOnce()
  expect(c.m.q('voice-status').textContent).toContain('Transcribing')
  await c.finish({ ok: true, text: 'Purple robot.' })
  expect(c.draft.value).toBe('Keep my edited draft Purple robot.')
  expect(c.send).not.toHaveBeenCalled()
  await click(c.m.q('send-prompt'))
  expect(c.send).toHaveBeenCalledOnce()
})

it.each(['permission', 'listening', 'transcribing'] as const)(
  'cancels during %s and discards a late result',
  async (phase) => {
    const c = composer()
    await click(c.m.q('voice-mic'))
    await c.phase(phase)
    await click(c.m.q('voice-cancel'))
    expect(c.bridge.cancel).toHaveBeenCalledOnce()
    await c.finish({ ok: true, text: 'must not appear' })
    expect(c.draft.value).toBe('Keep my draft')
    expect(c.send).not.toHaveBeenCalled()
  },
)

it('cancels when a reused composer gets another draft', async () => {
  const c = composer()
  await click(c.m.q('voice-mic'))
  await c.phase('listening')
  c.identity.value = 'second'
  c.draft.value = 'Other conversation'
  await nextTick()
  await c.finish({ ok: true, text: 'first conversation speech' })
  expect(c.bridge.cancel).toHaveBeenCalledOnce()
  expect(c.draft.value).toBe('Other conversation')
})
it('cancels on unmount and when typing freezes', async () => {
  const c = composer()
  await click(c.m.q('voice-mic'))
  c.state.value = 'frozen'
  await nextTick()
  expect(c.bridge.cancel).toHaveBeenCalledOnce()
  await c.finish({ ok: false, error: 'cancelled' })
  c.state.value = 'idle'
  await nextTick()
  await click(c.m.q('voice-mic'))
  c.m.unmount()
  expect(c.bridge.cancel).toHaveBeenCalledTimes(2)
})
it('shows permission denial without losing the draft and allows retry', async () => {
  const c = composer()
  await click(c.m.q('voice-mic'))
  await c.finish({ ok: false, error: 'microphone' })
  expect(c.m.q('voice-error').getAttribute('role')).toBe('alert')
  expect(c.m.q('voice-error').textContent).toContain('System Settings')
  await click(c.m.q('notice-fix'))
  expect(c.bridge.openSettings).toHaveBeenCalledWith('microphone')
  expect(c.draft.value).toBe('Keep my draft')
  await click(c.m.q('voice-mic'))
  expect(c.bridge.start).toHaveBeenCalledTimes(2)
  expect(c.m.all('voice-error')).toHaveLength(0)
})
it('clears an old error when the composer moves to another draft', async () => {
  const c = composer()
  await click(c.m.q('voice-mic'))
  await c.finish({ ok: false, error: 'speech' })
  c.identity.value = 'second'
  await nextTick()
  expect(c.m.all('voice-error')).toHaveLength(0)
})
it('hides the microphone on unsupported platforms', () => {
  const c = composer(false)
  expect(c.m.all('voice-mic')).toHaveLength(0)
  expect(c.bridge.start).not.toHaveBeenCalled()
})
it('places the mic beside Send using the composer’s control size', () => {
  const c = composer()
  const mic = c.m.q('voice-mic').getBoundingClientRect()
  const send = c.m.q('send-prompt').getBoundingClientRect()
  expect(Math.round(mic.height)).toBe(Math.round(send.height))
  expect(Math.round(mic.width)).toBe(Math.round(send.width))
  expect(send.left - mic.right).toBeGreaterThanOrEqual(0)
  expect(send.left - mic.right).toBeLessThan(24)
})
it('keeps Send dark when the composer reports a blocker over a typed draft', async () => {
  const c = composer()
  expect((c.m.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
  c.blocked.value = [{ words: 'This conversation is closing' }]
  await nextTick()
  expect((c.m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
  expect(c.m.q('send-blocked').textContent).toContain('This conversation is closing')
})

it('counts down and asks the core to stop at fifty seconds', async () => {
  vi.useFakeTimers()
  const c = composer()
  await click(c.m.q('voice-mic'))
  await c.phase('listening')
  await vi.advanceTimersByTimeAsync(25_000)
  await nextTick()
  expect(c.m.q('voice-countdown').textContent).toBe('0:25')
  await vi.advanceTimersByTimeAsync(25_000)
  await nextTick()
  expect(c.bridge.stop).toHaveBeenCalledOnce()
  expect(c.m.q('voice-status').textContent).toContain('Transcribing')
  expect(c.send).not.toHaveBeenCalled()
})

it('requires a fresh Send when an earlier Send was waiting for an attachment', async () => {
  const c = composer()
  let release!: () => void
  const attaching = c.handing.acquire(
    () =>
      new Promise<null>((done) => {
        release = () => done(null)
      }),
  )
  await click(c.m.q('send-prompt'))
  expect(c.send).not.toHaveBeenCalled()
  await click(c.m.q('voice-mic'))
  await c.phase('listening')
  await c.finish({ ok: true, text: 'Review this speech.' })
  release()
  await attaching
  await c.handing.settle()
  await new Promise<void>((done) => setTimeout(done, 0))
  await nextTick()
  expect(c.send).not.toHaveBeenCalled()
  expect(c.draft.value).toBe('Keep my draft Review this speech.')
  await click(c.m.q('send-prompt'))
  expect(c.send).toHaveBeenCalledOnce()
})

it('honors a fresh Send after dictation even while the attachment is still pending', async () => {
  const c = composer()
  let release!: () => void
  const attaching = c.handing.acquire(
    () =>
      new Promise<null>((done) => {
        release = () => done(null)
      }),
  )
  await click(c.m.q('send-prompt'))
  await click(c.m.q('voice-mic'))
  await c.phase('listening')
  await c.finish({ ok: true, text: 'Reviewed speech.' })
  await click(c.m.q('send-prompt'))
  release()
  await attaching
  await c.handing.settle()
  await new Promise<void>((done) => setTimeout(done, 0))
  await nextTick()
  expect(c.send).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'uses the fresh send intent after dictation: interrupt=%s',
  async (interrupting) => {
    const c = composer()
    c.state.value = 'busy'
    await nextTick()
    let release!: () => void
    const attaching = c.handing.acquire(
      () =>
        new Promise<null>((done) => {
          release = () => done(null)
        }),
    )
    await click(c.m.q('interrupt-send-prompt'))
    await click(c.m.q('voice-mic'))
    await c.phase('listening')
    await c.finish({ ok: true, text: 'Reviewed words.' })
    await click(c.m.q(interrupting ? 'interrupt-send-prompt' : 'queue-prompt'))
    release()
    await attaching
    await c.handing.settle()
    await new Promise<void>((done) => setTimeout(done, 0))
    await nextTick()
    expect(c.send).toHaveBeenCalledOnce()
    expect(c.send.mock.calls[0]?.[1]).toBe(interrupting ? 'interrupt' : 'queue')
  },
)

it('retains a deliberate interrupt within one dictation version', async () => {
  const c = composer()
  c.state.value = 'busy'
  await nextTick()
  let release!: () => void
  const attaching = c.handing.acquire(
    () =>
      new Promise<null>((done) => {
        release = () => done(null)
      }),
  )
  await click(c.m.q('interrupt-send-prompt'))
  await click(c.m.q('queue-prompt'))
  release()
  await attaching
  await c.handing.settle()
  await new Promise<void>((done) => setTimeout(done, 0))
  await nextTick()
  expect(c.send).toHaveBeenCalledOnce()
  expect(c.send.mock.calls[0]?.[1]).toBe('interrupt')
})
