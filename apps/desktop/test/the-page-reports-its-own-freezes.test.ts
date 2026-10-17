import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { logWhenThePageStopsAnswering } from '../src/main/page-answers'
import {
  aPageReceipt,
  aPageSampleSays,
  pageHeardSays,
  type PageReportSender,
} from '../src/main/runtime/page-performance'
import {
  aCommandsKind,
  registerRuntimeIpc,
  runtimeCommandSchema,
  type IpcHandleRegistrar,
} from '../src/main/runtime/ipc'
import type { RuntimeEventSink, RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  MAX_PAGE_SAMPLES,
  PAGE_RECEIPT_KIND,
  type PagePerformanceReport,
  type PageSample,
} from '../src/shared/page-performance'
import { RUNTIME_COMMAND_CHANNEL } from '../src/shared/runtime-ipc'

/**
 * The page's own freeze reports reach the stall log through the window's command channel, checked
 * and never handed to the host; and the window's own "page stopped answering" events are logged.
 */

const A_SAMPLE: PageSample = {
  kind: 'long-task',
  startMs: 12_500,
  durationMs: 720,
  count: 1,
  surface: 'conversation',
  component: 'TranscriptView',
  attribution: 'active-view',
  input: 'scroll',
  conversation: 7,
  loadedItems: 840,
  fileCount: 180,
  contextUsed: 310_000,
}

const A_REPORT: PagePerformanceReport = {
  kind: PAGE_RECEIPT_KIND,
  version: 1,
  sequence: 24,
  visibility: 'visible',
  samples: [A_SAMPLE],
  health: { observing: true, entries: 40, probes: 12 },
  dropped: 0,
}

const THE_PAGE = (id = 3, pid = 4242): PageReportSender => ({
  sender: { id, isDestroyed: () => false, getOSProcessId: () => pid },
  senderFrame: { parent: null },
})

/** A host that records any use of it; the receipt must leave it alone. */
function recordingHost(closing: boolean): { host: RuntimeHost; touched: string[] } {
  const touched: string[] = []
  const host = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'closing') return closing
        if (typeof property !== 'string') return undefined
        return (): undefined => {
          touched.push(property)
          return undefined
        }
      },
    },
  ) as RuntimeHost
  return { host, touched }
}

/** `registerRuntimeIpc`'s own listener, as main registers it, with a receipt over a fake clock. */
function theDoor(options: { closing?: boolean } = {}): {
  send: (event: PageReportSender, raw: unknown) => unknown
  lines: string[]
  touched: string[]
  visibility: boolean[]
  advance: (ms: number) => void
  receipt: ReturnType<typeof aPageReceipt>
} {
  let at = 1_000_000
  const lines: string[] = []
  const visibility: boolean[] = []
  const { host, touched } = recordingHost(options.closing ?? false)
  const receipt = aPageReceipt({
    closing: () => host.closing,
    log: (line) => lines.push(line),
    visibility: (visible) => visibility.push(visible),
    now: () => at,
  })
  let listener: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | null = null
  const ipc: IpcHandleRegistrar = {
    handle: (channel, registered) => {
      expect(channel).toBe(RUNTIME_COMMAND_CHANNEL)
      listener = registered
    },
  }
  registerRuntimeIpc({
    ipc,
    host,
    sinkFor: () => ({}) as RuntimeEventSink,
    pageReceipt: receipt,
  })
  if (listener === null) throw new Error('nothing was registered')
  const door = listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  return {
    send: (event, raw) => door(event as unknown as IpcMainInvokeEvent, raw),
    lines,
    touched,
    visibility,
    advance: (ms) => {
      at += ms
    },
    receipt,
  }
}

describe('§1 · a report is written to the stall log, and the host is never asked', () => {
  it('⚑ a valid report writes one line per sample with the renderer’s pid and window, and touches no host method', () => {
    const door = theDoor()
    expect(door.send(THE_PAGE(), A_REPORT)).toEqual({ recorded: true })
    expect(door.lines).toEqual([
      'page renderer 4242 window 3 long-task 720 ms; surface conversation; component TranscriptView (active-view); conversation 7; loaded items 840; files 180; context used 310000; input scroll; page clock 12500',
    ])
    expect(door.touched).toEqual([])
    expect(door.visibility).toEqual([true])
  })

  it('⛔ while the app quits it is answered and dropped: no line, no host', () => {
    const door = theDoor({ closing: true })
    expect(door.send(THE_PAGE(), A_REPORT)).toEqual({ recorded: false, why: 'closing' })
    expect(door.lines).toEqual([])
    expect(door.touched).toEqual([])
  })

  it('⚑ a report with no samples writes nothing, and still counts as heard', () => {
    const door = theDoor()
    door.send(THE_PAGE(), { ...A_REPORT, samples: [], visibility: 'hidden' })
    expect(door.lines).toEqual([])
    expect(door.visibility).toEqual([false])
    expect(pageHeardSays(door.receipt.takeHeard(), 1_000_000 + 5_000)).toBe(
      'the page (renderer 4242) reported 1 time, last 5 s ago, observing long tasks, 40 entries, 12 frame probes',
    )
    expect(pageHeardSays(door.receipt.takeHeard(), 0)).toBe('the page did not report')
  })

  it('⚑ the kind is no runtime command: the command schema refuses it', () => {
    expect(runtimeCommandSchema.safeParse(A_REPORT).success).toBe(false)
  })
})

describe('§2 · only the window’s own top frame', () => {
  it('⛔ a subframe, a missing frame, or a destroyed page is refused', () => {
    const door = theDoor()
    expect(door.send({ ...THE_PAGE(), senderFrame: { parent: {} } }, A_REPORT)).toEqual({
      recorded: false,
      why: 'not-the-page',
    })
    expect(door.send({ ...THE_PAGE(), senderFrame: null }, A_REPORT)).toEqual({
      recorded: false,
      why: 'not-the-page',
    })
    const destroyed = THE_PAGE()
    expect(
      door.send(
        { ...destroyed, sender: { ...destroyed.sender, isDestroyed: () => true } },
        A_REPORT,
      ),
    ).toEqual({ recorded: false, why: 'not-the-page' })
    expect(door.lines).toEqual([])
  })
})

describe('§3 · numbers and the fixed words, nothing else', () => {
  const refused = (raw: unknown): void => {
    const door = theDoor()
    expect(door.send(THE_PAGE(), raw)).toEqual({ recorded: false, why: 'malformed' })
    expect(door.lines).toEqual([])
  }

  it('⛔ a key nobody declared, at the top, in a sample or in the health, is refused', () => {
    refused({ ...A_REPORT, note: 'x' })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, title: 'a client’s project' }] })
    refused({ ...A_REPORT, health: { ...A_REPORT.health, path: '/Users/x' } })
  })

  it('⛔ NaN, Infinity, a negative, an oversized and a fractional count are refused', () => {
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, durationMs: Number.NaN }] })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, startMs: Number.POSITIVE_INFINITY }] })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, durationMs: -1 }] })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, durationMs: 600_001 }] })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, count: 1.5 }] })
    refused({ ...A_REPORT, dropped: -1 })
  })

  it('⛔ a word off the lists is refused, so no text and no newline can reach the log', () => {
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, surface: 'conversation\nforged line' }] })
    refused({ ...A_REPORT, samples: [{ ...A_SAMPLE, component: 'Secret client name' }] })
  })

  it('accepts bounded hidden starvation measurements and keeps their words apart from frozen', () => {
    const door = theDoor()
    expect(
      door.send(THE_PAGE(1, 77), {
        ...A_REPORT,
        samples: [
          {
            ...A_SAMPLE,
            kind: 'starved',
            startMs: 1000,
            durationMs: 90_000,
            timerLateMs: 90_000,
            frameLateMs: 120_016,
            surface: 'away',
            input: 'none',
            component: null,
            conversation: null,
            loadedItems: null,
            fileCount: null,
            contextUsed: null,
          },
        ],
      }),
    ).toEqual({ recorded: true })
    expect(door.lines).toEqual([
      'page renderer 77 window 1 starved while hidden; timer late 90000 ms; frame late 120016 ms; surface away; input none; page clock 1000',
    ])
  })

  it('refuses missing, unbounded or textual hidden delays and undeclared native metadata', () => {
    const sample = { ...A_SAMPLE, kind: 'starved', timerLateMs: 1000, frameLateMs: 1016 }
    for (const invalid of [
      { ...A_SAMPLE, kind: 'starved', frameLateMs: 1016 },
      { ...A_SAMPLE, kind: 'starved', timerLateMs: 1000 },
      { ...sample, timerLateMs: 999 },
      { ...sample, timerLateMs: Number.NaN },
      { ...sample, timerLateMs: Number.POSITIVE_INFINITY },
      { ...sample, timerLateMs: 600_001 },
      { ...sample, frameLateMs: -1 },
      { ...sample, frameLateMs: Number.POSITIVE_INFINITY },
      { ...sample, frameLateMs: 600_001 },
      { ...sample, frameLateMs: 'a conversation title' },
      { ...sample, reason: 'a conversation title' },
      { ...A_SAMPLE, timerLateMs: 1000, frameLateMs: 1016 },
    ])
      refused({ ...A_REPORT, samples: [invalid] })
  })

  it(`⛔ ${String(MAX_PAGE_SAMPLES + 1)} samples are refused; ⚑ ${String(MAX_PAGE_SAMPLES)} are written`, () => {
    refused({ ...A_REPORT, samples: Array.from({ length: MAX_PAGE_SAMPLES + 1 }, () => A_SAMPLE) })
    const door = theDoor()
    door.send(THE_PAGE(), {
      ...A_REPORT,
      samples: Array.from({ length: MAX_PAGE_SAMPLES }, () => A_SAMPLE),
    })
    expect(door.lines).toHaveLength(MAX_PAGE_SAMPLES)
    for (const line of door.lines) {
      expect([...line].some((char) => char.charCodeAt(0) < 0x20)).toBe(false)
    }
  })
})

describe('§4 · one report a second from one page', () => {
  it('⛔ a second report within a second is answered too-soon; ⚑ after a second it is taken, and another page is its own', () => {
    const door = theDoor()
    expect(door.send(THE_PAGE(), A_REPORT)).toEqual({ recorded: true })
    expect(door.send(THE_PAGE(), A_REPORT)).toEqual({ recorded: false, why: 'too-soon' })
    expect(door.send(THE_PAGE(9, 99), A_REPORT)).toEqual({ recorded: true })
    door.advance(1_000)
    expect(door.send(THE_PAGE(), A_REPORT)).toEqual({ recorded: true })
    expect(door.lines).toHaveLength(3)
  })
})

describe('§4b · the page’s sight', () => {
  it('⚑ is taken from a report that comes too soon, and ⛔ never from one that is malformed', () => {
    const door = theDoor()
    door.send(THE_PAGE(), A_REPORT)
    expect(door.send(THE_PAGE(), { ...A_REPORT, visibility: 'hidden' })).toEqual({
      recorded: false,
      why: 'too-soon',
    })
    door.send(THE_PAGE(), { ...A_REPORT, visibility: 'visible', note: 'x' })
    expect(door.visibility).toEqual([true, false])
  })
})

describe('§5 · the words of a sample', () => {
  it('⚑ a burst says how many tasks; ⚑ unknown fields are left out', () => {
    expect(
      aPageSampleSays({
        ...A_SAMPLE,
        kind: 'task-burst',
        count: 14,
        durationMs: 640.4,
        component: null,
        conversation: null,
        loadedItems: null,
        fileCount: null,
        contextUsed: null,
        surface: 'waiting',
        input: 'none',
      }),
    ).toBe('14 tasks taking 640 ms in all; surface waiting; input none; page clock 12500')
  })
})

describe('§5b · a stall line names only commands this app knows', () => {
  it('⚑ a known kind and the page’s report by name; ⛔ a made-up kind or a non-command as a fixed word', () => {
    expect(aCommandsKind({ kind: 'send', sessionId: 's' })).toBe('send')
    expect(aCommandsKind(A_REPORT)).toBe(PAGE_RECEIPT_KIND)
    expect(aCommandsKind({ kind: 'send\n2026-10-07 pid 1: forged' })).toBe('of an unknown kind')
    expect(aCommandsKind({ kind: 7 })).toBe('not a command')
    expect(aCommandsKind(null)).toBe('not a command')
  })
})

describe('§6 · the window’s own "page stopped answering"', () => {
  it('⚑ an unresponsive page is logged once, and its return with how long it took; ⛔ a stray responsive logs nothing', () => {
    const window = new EventEmitter()
    const lines: string[] = []
    let at = 0
    logWhenThePageStopsAnswering(
      window,
      (line) => lines.push(line),
      () => at,
    )
    window.emit('responsive')
    window.emit('unresponsive')
    at = 16_000
    window.emit('unresponsive')
    at = 21_050
    window.emit('responsive')
    expect(lines).toEqual([
      'the window’s page stopped answering',
      'the window’s page answers again after 21050 ms',
    ])
  })
})
