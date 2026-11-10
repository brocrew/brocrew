import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { guardedAppIpc } from '../src/main/app-ipc'
import { logInfo, setDebug } from '../src/main/logging/log'
import { captureLog } from './lib/log-file'

vi.mock('electron', () => ({ ipcMain: {} }))
vi.mock('../src/main/plugins/ui/senders', () => ({ isPluginSender: () => false }))

const captures: Awaited<ReturnType<typeof captureLog>>[] = []
afterEach(async () => {
  for (const log of captures.splice(0)) await log.close()
})

async function ipcCapture() {
  const log = await captureLog()
  captures.push(log)
  setDebug(false)
  const backend = {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  return { log, backend }
}

it.each(['throw', 'reject'] as const)(
  'logs an IPC %s with Debug mode off and keeps the original error',
  async (kind) => {
    const { log, backend } = await ipcCapture()
    const failure = new Error('fictional save failed')
    guardedAppIpc(backend).handle('app:fictional-save', () => {
      if (kind === 'throw') throw failure
      return Promise.reject(failure)
    })
    const listener = backend.handle.mock.calls[0]![1] as Parameters<IpcMain['handle']>[1]
    const event = { sender: {} } as IpcMainInvokeEvent
    if (kind === 'throw') expect(() => listener(event)).toThrow(failure)
    else await expect(listener(event)).rejects.toBe(failure)
    const [line] = await log.lines()
    expect(line).toContain('[error] (ipc) app:fictional-save')
    expect(line).toContain('fictional save failed')
  },
)

it('returns successful results unchanged and records their detail only in Debug mode', async () => {
  const { log, backend } = await ipcCapture()
  const result = { saved: true }
  guardedAppIpc(backend).handle('app:fictional-save', () => result)
  const listener = backend.handle.mock.calls[0]![1] as Parameters<IpcMain['handle']>[1]
  const event = { sender: {} } as IpcMainInvokeEvent
  expect(listener(event)).toBe(result)
  await Promise.resolve()
  logInfo('test', 'fictional file barrier')
  expect((await log.lines())[0]).toContain('fictional file barrier')
  expect(await log.text()).not.toContain('app:fictional-save')
  setDebug(true)
  expect(listener(event)).toBe(result)
  const [, line] = await log.lines(2)
  expect(line).toMatch(/\[debug\] \(ipc\)\s+app:fictional-save/)
  expect(line).toContain('ms:')
})
