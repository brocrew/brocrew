import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent, IpcRenderer, WebContents } from 'electron'
import { VOICE_SETTINGS, registerVoiceIpc } from '../src/main/voice/ipc'
import { VoiceService } from '../src/main/voice/service'
import type { VoicePhase, VoiceResult } from '../src/shared/voice'
import { VOICE_CHANNELS } from '../src/shared/voice'
import { voiceBridge } from '../src/preload/voice'

it('rejects foreign/subframe senders and cancels on renderer loss, navigation and close', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
      handlers.set(name, fn),
    removeHandler: (name: string) => handlers.delete(name),
  }
  const sender = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: vi.fn(),
  }) as unknown as WebContents
  const event = { sender } as IpcMainInvokeEvent
  const foreign = { sender: {} } as IpcMainInvokeEvent
  let resolve!: (result: VoiceResult) => void
  const cancel = vi.fn()
  const engine = vi.fn((state: (phase: VoicePhase) => void) => {
    state('permission')
    return {
      result: new Promise<VoiceResult>((done) => {
        resolve = done
      }),
      stop: vi.fn(),
      cancel,
    }
  })
  const openSettings = vi.fn<(url: string) => Promise<void>>(async () => {})
  const release = registerVoiceIpc(
    ipc as unknown as IpcMain,
    new VoiceService(engine),
    (candidate) => candidate === event,
    openSettings,
  )
  await handlers.get(VOICE_CHANNELS.openSettings)!(foreign, 'microphone')
  await handlers.get(VOICE_CHANNELS.openSettings)!(event, 'https://example.invalid')
  await handlers.get(VOICE_CHANNELS.openSettings)!(event, 'speech')
  expect(openSettings).toHaveBeenCalledExactlyOnceWith(VOICE_SETTINGS.speech)
  expect(await handlers.get(VOICE_CHANNELS.start)!(foreign, 'fictional-session-12345')).toEqual({
    ok: false,
    error: 'unavailable',
  })
  expect(engine).not.toHaveBeenCalled()
  for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) {
    const run = handlers.get(VOICE_CHANNELS.start)!(event, 'fictional-session-12345')
    sender.emit(name)
    expect(cancel).toHaveBeenCalledTimes(
      ['did-navigate', 'render-process-gone', 'destroyed'].indexOf(name) + 1,
    )
    resolve({ ok: false, error: 'cancelled' })
    await run
    expect(sender.listenerCount(name)).toBe(0)
  }
  const run = handlers.get(VOICE_CHANNELS.start)!(event, 'fictional-session-12345')
  release()
  expect(handlers.size).toBe(0)
  expect(cancel).toHaveBeenCalledTimes(4)
  resolve({ ok: false, error: 'cancelled' })
  await run
})

it('exposes narrow platform-aware operations and rejects malformed status events', async () => {
  const emitter = new EventEmitter()
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(async () => ({
    ok: false,
    error: 'cancelled',
  }))
  const ipc = Object.assign(emitter, { invoke }) as unknown as IpcRenderer
  const bridge = voiceBridge(ipc, 'darwin')
  const state = vi.fn()
  const release = bridge.onState(state)
  emitter.emit(VOICE_CHANNELS.state, {}, { id: 'fictional-session-12345', phase: 'listening' })
  emitter.emit(VOICE_CHANNELS.state, {}, { id: '../invalid', phase: 'listening' })
  emitter.emit(VOICE_CHANNELS.state, {}, { id: 'fictional-session-12345', phase: 'other' })
  expect(state).toHaveBeenCalledExactlyOnceWith({
    id: 'fictional-session-12345',
    phase: 'listening',
  })
  release()
  expect(emitter.listenerCount(VOICE_CHANNELS.state)).toBe(0)
  await bridge.start('fictional-session-12345')
  await bridge.stop('fictional-session-12345')
  await bridge.cancel('fictional-session-12345')
  expect(invoke.mock.calls.map(([name]) => name)).toEqual([
    VOICE_CHANNELS.start,
    VOICE_CHANNELS.stop,
    VOICE_CHANNELS.cancel,
  ])
  expect(bridge.supported).toBe(true)
  expect(voiceBridge(ipc, 'win32').supported).toBe(false)
})
