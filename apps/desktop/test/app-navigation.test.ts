import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAppNavigation } from '../src/main/app-navigation'
import { APP_NAVIGATE_CHANNEL } from '../src/shared/app-navigation'

const ipc = vi.hoisted(() => ({
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  expose: vi.fn(),
  invoke: vi.fn(),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: ipc.expose },
  ipcRenderer: {
    invoke: ipc.invoke,
    on(channel: string, listener: (...args: unknown[]) => void) {
      const listeners = ipc.listeners.get(channel) ?? new Set()
      listeners.add(listener)
      ipc.listeners.set(channel, listeners)
    },
    off(channel: string, listener: (...args: unknown[]) => void) {
      ipc.listeners.get(channel)?.delete(listener)
    },
  },
  webUtils: {},
}))
afterEach(() => {
  ipc.listeners.clear()
  ipc.invoke.mockClear()
})

function nativeWindow() {
  const window = Object.assign(new EventEmitter(), { webContents: { send: vi.fn() } })
  installAppNavigation(window as unknown as Parameters<typeof installAppNavigation>[0])
  return window
}

describe('native history gestures', () => {
  it.each([
    ['swipe', 'left', 'back'],
    ['swipe', 'right', 'forward'],
    ['app-command', 'browser-backward', 'back'],
    ['app-command', 'browser-forward', 'forward'],
  ])('%s %s pushes %s', (event, value, direction) => {
    const window = nativeWindow()
    window.emit(event, {}, value)
    expect(window.webContents.send.mock.calls).toEqual([['app:navigate', direction]])
  })

  it('ignores every other value on both events', () => {
    const window = nativeWindow()
    for (const value of ['up', 'down', 'back', 'forward', 'browser-refresh', '', null, 1, {}, []]) {
      window.emit('swipe', {}, value)
      window.emit('app-command', {}, value)
    }
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('installs the handler on the app window', () => {
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const create = main.slice(
      main.indexOf('function createWindow(): void {'),
      main.indexOf('function appDocument('),
    )
    expect(create).toContain('installAppNavigation(window)')
  })
})

it('the actual preload validates pushes, hides the event and unsubscribes independently', async () => {
  await import('../src/preload/index')
  const api = ipc.expose.mock.calls.find((call) => call[0] === 'api')?.[1] as {
    onNavigate(listener: (direction: 'back' | 'forward') => void): () => void
  }
  expect(api).toBeDefined()
  const first = vi.fn(),
    second = vi.fn()
  const unsubscribe = api.onNavigate(first)
  const unsubscribeSecond = api.onNavigate(second)
  const emit = (value: unknown) => {
    for (const listener of ipc.listeners.get(APP_NAVIGATE_CHANNEL) ?? [])
      listener({ sender: 'hidden' }, value)
  }
  emit('back')
  emit('forward')
  for (const value of ['left', 'right', undefined, null, {}, ['back'], 42]) emit(value)
  expect(first.mock.calls).toEqual([['back'], ['forward']])
  unsubscribe()
  unsubscribe()
  emit('back')
  expect(first).toHaveBeenCalledTimes(2)
  expect(second.mock.calls).toEqual([['back'], ['forward'], ['back']])
  unsubscribeSecond()
  expect(ipc.listeners.get(APP_NAVIGATE_CHANNEL)?.size).toBe(0)
  expect(ipc.invoke).not.toHaveBeenCalled()
})
