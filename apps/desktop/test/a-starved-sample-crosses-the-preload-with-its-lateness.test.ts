import { describe, expect, it, vi } from 'vitest'
import { aPageReceipt, type PageReportSender } from '../src/main/runtime/page-performance'
import {
  PAGE_RECEIPT_KIND,
  type PagePerformanceReport,
  type PageReportAnswer,
  type PageSample,
} from '../src/shared/page-performance'

const ipc = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: ipc.expose },
  ipcRenderer: { invoke: ipc.invoke, on: vi.fn(), off: vi.fn() },
  webUtils: {},
}))

const A_LONG_TASK: PageSample = {
  kind: 'long-task',
  startMs: 12_500,
  durationMs: 720,
  count: 1,
  component: null,
  attribution: 'unknown',
  input: 'scroll',
  conversation: null,
  loadedItems: null,
  fileCount: null,
  contextUsed: null,
}

const A_STARVED: PageSample = {
  ...A_LONG_TASK,
  kind: 'starved',
  startMs: 1_000,
  durationMs: 90_000,
  input: 'none',
  timerLateMs: 90_000,
  frameLateMs: 120_016,
}

const THE_PAGE: PageReportSender = {
  sender: { id: 1, isDestroyed: () => false, getOSProcessId: () => 77 },
  senderFrame: { parent: null },
}

/** What the page's report becomes after the actual preload carries it to main. */
async function carried(report: PagePerformanceReport): Promise<unknown> {
  await import('../src/preload/index')
  const api = ipc.expose.mock.calls.find((call) => call[0] === 'api')?.[1] as {
    recordPagePerformance(report: PagePerformanceReport): Promise<PageReportAnswer>
  }
  ipc.invoke.mockClear()
  ipc.invoke.mockResolvedValue({ recorded: true })
  await api.recordPagePerformance(report)
  expect(ipc.invoke).toHaveBeenCalledTimes(1)
  return ipc.invoke.mock.calls[0]![1]
}

describe('a starved sample crosses the preload with its lateness', () => {
  it('main records the starved sample and the long task beside it', async () => {
    const lines: string[] = []
    const receipt = aPageReceipt({ closing: () => false, log: (line) => lines.push(line) })
    const report: PagePerformanceReport = {
      kind: PAGE_RECEIPT_KIND,
      version: 1,
      sequence: 3,
      visibility: 'visible',
      samples: [A_LONG_TASK, A_STARVED],
      health: { observing: true, entries: 2, probes: 1 },
      dropped: 0,
    }
    expect(receipt.take(THE_PAGE, await carried(report))).toEqual({ recorded: true })
    expect(lines).toEqual([
      'page renderer 77 window 1 long-task 720 ms; input scroll; page clock 12500',
      'page renderer 77 window 1 starved while hidden; timer late 90000 ms; frame late 120016 ms; input none; page clock 1000',
    ])
  })
})
