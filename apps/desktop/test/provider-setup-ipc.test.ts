import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type {
  IpcMain,
  IpcMainInvokeEvent,
  WebContents,
  IpcRenderer,
  IpcRendererEvent,
} from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeSetupService } from '../src/main/providers/claude/setup-service'
import { registerProviderSetup } from '../src/main/provider-setup/ipc'
import { providerSetupBridge } from '../src/preload/provider-setup'
import { PROVIDER_SETUP_CHANNELS as channels } from '../src/shared/provider-setup'

class FakeContents extends EventEmitter {
  readonly mainFrame = { fictional: 'main' }
  readonly send = vi.fn()
  destroyed = false
  isDestroyed(): boolean {
    return this.destroyed
  }
}
class FakeChild extends EventEmitter {
  readonly pid = 70124
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
}
function fixture() {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const ipc = {
    handle: (channel: string, handler: Parameters<IpcMain['handle']>[1]): void => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string): void => {
      handlers.delete(channel)
    },
  }
  const child = new FakeChild(),
    stop = vi.fn(),
    spawn = vi.fn(() => child)
  const service = new ClaudeSetupService({
    platform: 'darwin',
    findProgram: () => null,
    spawn,
    stop,
  })
  const allowed = new Set<FakeContents>()
  const close = registerProviderSetup(ipc, { claude: service }, (event) => {
    const contents = event.sender as unknown as FakeContents
    return (
      allowed.has(contents) &&
      !contents.isDestroyed() &&
      event.senderFrame === event.sender.mainFrame
    )
  })
  const sender = new FakeContents(),
    other = new FakeContents(),
    foreign = new FakeContents()
  allowed.add(sender)
  allowed.add(other)
  function invoke(
    action: keyof Omit<typeof channels, 'changed'>,
    contents = sender,
    args: unknown[] = ['claude'],
    subframe = false,
  ): unknown {
    // Only Electron's transport is doubled. Production authorization and lifecycle handlers run.
    const event = {
      sender: contents as unknown as WebContents,
      senderFrame: subframe ? { fictional: 'child' } : contents.mainFrame,
    } as unknown as IpcMainInvokeEvent
    return handlers.get(channels[action])!(event, ...args)
  }
  return { invoke, sender, other, foreign, spawn, stop, child, close, handlers, service }
}

describe('provider setup sender and document ownership', () => {
  it('rejects unregistered windows, subframes, invalid providers and renderer command arguments', async () => {
    const f = fixture()
    expect(f.invoke('install', f.foreign)).toEqual({ ok: false, reason: 'not-authorized' })
    expect(f.invoke('install', f.sender, ['claude'], true)).toEqual({
      ok: false,
      reason: 'not-authorized',
    })
    expect(f.invoke('install', f.sender, ['fictional-provider'])).toEqual({
      ok: false,
      reason: 'not-authorized',
    })
    expect(f.invoke('install', f.sender, ['claude', 'arbitrary shell command'])).toEqual({
      ok: false,
      reason: 'not-authorized',
    })
    expect(() => f.invoke('state', f.foreign)).toThrow('not authorized')
    expect(f.spawn).not.toHaveBeenCalled()
    await f.close()
  })
  it('reports unsupported providers without selecting a different installer or login', async () => {
    const f = fixture()
    expect(f.invoke('state', f.sender, ['codex'])).toMatchObject({
      provider: 'codex',
      supported: { install: false, signIn: false },
      error: 'unsupported-provider',
    })
    expect(f.invoke('install', f.sender, ['codex'])).toEqual({
      ok: false,
      reason: 'unsupported-provider',
    })
    expect(f.spawn).not.toHaveBeenCalled()
    await f.close()
  })
  it('forwards progress only to subscribers and keeps another window from cancelling an operation', async () => {
    const f = fixture()
    expect(f.invoke('install')).toEqual({ ok: true })
    expect(f.sender.send).toHaveBeenCalledWith(
      channels.changed,
      expect.objectContaining({ provider: 'claude', phase: 'installing' }),
    )
    expect(f.other.send).not.toHaveBeenCalled()
    expect(f.invoke('cancel', f.other)).toEqual({ ok: false, reason: 'busy' })
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.invoke('cancel')).toEqual({ ok: true })
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
    f.child.emit('close', null)
    await f.close()
  })
  it.each(['did-navigate', 'render-process-gone', 'destroyed'])(
    'cancels on %s and removes document subscriptions',
    async (actual) => {
      const f = fixture()
      f.invoke('state')
      f.invoke('install')
      f.sender.emit('will-navigate', { preventDefault: vi.fn() })
      f.sender.emit('did-start-navigation')
      f.sender.emit('did-start-loading')
      expect(f.stop).not.toHaveBeenCalled()
      f.sender.emit(actual)
      expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
      const count = f.sender.send.mock.calls.length
      f.child.emit('close', null)
      expect(f.sender.send).toHaveBeenCalledTimes(count)
      for (const event of ['did-navigate', 'render-process-gone', 'destroyed'])
        expect(f.sender.listenerCount(event)).toBe(0)
      await f.close()
    },
  )
  it('does not cancel another document’s operation when an idle subscriber navigates', async () => {
    const f = fixture()
    f.invoke('state', f.other)
    f.invoke('install')
    f.other.emit('did-navigate')
    expect(f.stop).not.toHaveBeenCalled()
    f.child.emit('close', 1)
    await f.close()
  })
  it('shutdown removes every handler, cancels the child, and is idempotent', async () => {
    const f = fixture()
    f.invoke('install')
    const closing = f.close()
    expect(f.handlers.size).toBe(0)
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
    f.child.emit('close', null)
    await closing
    await f.close()
    expect(f.sender.listenerCount('destroyed')).toBe(0)
  })
})

describe('frozen preload provider setup bridge', () => {
  it('carries provider identity on every invoke and leaves the privileged event in preload', async () => {
    const invoke = vi.fn<IpcRenderer['invoke']>(async () => ({ ok: true })),
      on = vi.fn<IpcRenderer['on']>(),
      off = vi.fn<IpcRenderer['off']>()
    const ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'> = { invoke, on, off }
    const bridge = providerSetupBridge(ipc)
    expect(Object.isFrozen(bridge)).toBe(true)
    await bridge.state('claude')
    await bridge.install('claude')
    await bridge.signIn('claude')
    await bridge.cancel('claude')
    expect(invoke.mock.calls.map((call) => [...call])).toEqual([
      [channels.state, 'claude'],
      [channels.install, 'claude'],
      [channels.signIn, 'claude'],
      [channels.cancel, 'claude'],
    ])
    const listener = vi.fn(),
      unsubscribe = bridge.onState(listener)
    const [, forward] = on.mock.calls[0]!
    const state = { provider: 'claude', phase: 'installing' }
    forward({ fictional: 'privileged-event' } as unknown as IpcRendererEvent, state)
    expect(listener).toHaveBeenCalledExactlyOnceWith(state)
    unsubscribe()
    expect(off).toHaveBeenCalledWith(channels.changed, forward)
  })
})
