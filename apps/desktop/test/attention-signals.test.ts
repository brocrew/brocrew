import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { AttentionSignals, ATTENTION_SIGNAL_INTERVAL_MS } from '../src/main/attention-signals'
import { attentionOverlay, attentionOverlayLabel } from '../src/main/attention-overlay'
import {
  MAX_ATTENTION_COUNT,
  MAX_ATTENTION_ARRIVAL,
  isAttentionSignal,
} from '../src/shared/attention-signals'
import { attentionSignalTracker } from '../src/renderer/src/lib/attention-signals'

function native(platform = 'darwin') {
  const effects = {
    platform,
    isFocused: vi.fn(() => false),
    badge: vi.fn(),
    bounce: vi.fn(() => 7),
    cancelBounce: vi.fn(),
    flash: vi.fn(),
    overlay: vi.fn(),
  }
  let now = 0
  return {
    effects,
    signals: new AttentionSignals(effects, () => now),
    advance: () => {
      now += ATTENTION_SIGNAL_INTERVAL_MS
    },
  }
}
let arrival = 0
const update = (count: number, added = false, enabled = true) => ({
  count,
  arrival: added ? ++arrival : arrival,
  enabled,
})
const population = (keys: string[], ready = true, name = 'questions') => ({ name, keys, ready })

describe('native signs for Waiting on you', () => {
  it('restores the launch badge without bouncing, even if the first reading says added', () => {
    const { effects, signals } = native()
    signals.update(update(3, true))
    expect(effects.badge).toHaveBeenLastCalledWith(3)
    expect(effects.bounce).not.toHaveBeenCalled()
  })

  it('bounces informationally only for a new item while unfocused', () => {
    const { effects, signals } = native()
    signals.update(update(2))
    signals.update(update(2))
    expect(effects.bounce).not.toHaveBeenCalled()
    signals.update(update(2, true))
    expect(effects.bounce).toHaveBeenCalledExactlyOnceWith('informational')
    effects.isFocused.mockReturnValue(true)
    signals.update(update(3, true))
    expect(effects.bounce).toHaveBeenCalledTimes(1)
    signals.focused()
    expect(effects.cancelBounce).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('keeps the full badge count, clears at zero, and cancels an outstanding bounce', () => {
    const { effects, signals } = native()
    signals.update(update(1))
    signals.update(update(19, true))
    expect(effects.badge).toHaveBeenLastCalledWith(19)
    signals.update(update(0))
    expect(effects.badge).toHaveBeenLastCalledWith(0)
    expect(effects.cancelBounce).toHaveBeenLastCalledWith(7)
  })

  it.each(['darwin', 'win32', 'linux'])('off clears every native sign on %s', (platform) => {
    const { effects, signals } = native(platform)
    signals.update(update(1))
    signals.update(update(2, true))
    signals.update(update(5, true, false))
    expect(platform === 'win32' ? effects.overlay : effects.badge).toHaveBeenLastCalledWith(0)
    if (platform === 'win32') expect(effects.flash).toHaveBeenLastCalledWith(false)
    if (platform === 'darwin') expect(effects.cancelBounce).toHaveBeenCalledWith(7)
    effects.bounce.mockClear()
    effects.flash.mockClear()
    signals.update(update(6, true, false))
    expect(effects.bounce).not.toHaveBeenCalled()
    expect(effects.flash).not.toHaveBeenCalledWith(true)
    signals.update(update(6, true, true))
    expect(effects.bounce).not.toHaveBeenCalled()
    expect(effects.flash).not.toHaveBeenCalledWith(true)
  })

  it('flashes Windows until focus, and clears an overlay at zero and on teardown', () => {
    const { effects, signals } = native('win32')
    signals.update(update(1, true))
    expect(effects.flash).not.toHaveBeenCalledWith(true)
    signals.update(update(2, true))
    expect(effects.flash).toHaveBeenLastCalledWith(true)
    signals.update(update(2))
    expect(effects.flash).toHaveBeenLastCalledWith(true)
    signals.focused()
    expect(effects.flash).toHaveBeenLastCalledWith(false)
    signals.update(update(0))
    expect(effects.overlay).toHaveBeenLastCalledWith(0)
    signals.update(update(9))
    signals.clear()
    expect(effects.overlay).toHaveBeenLastCalledWith(0)
    expect(effects.badge).not.toHaveBeenCalled()
  })

  it('only sets the supported Linux badge, without a summons', () => {
    const { effects, signals } = native('linux')
    signals.update(update(1))
    signals.update(update(2, true))
    expect(effects.badge).toHaveBeenLastCalledWith(2)
    expect(effects.bounce).not.toHaveBeenCalled()
    expect(effects.flash).not.toHaveBeenCalled()
    expect(effects.overlay).not.toHaveBeenCalled()
  })
})

describe('the existing lists, with delayed first readings', () => {
  it('baselines each initial read silently, then gives same-count replacements distinct identities', () => {
    const next = attentionSignalTracker()
    const first = next(true, 0, [population([], false)]).arrival
    expect(next(true, 1, [population(['old'])]).arrival).toBe(first)
    expect(next(true, 2, [population(['old']), population(['late'], true, 'asks')]).arrival).toBe(
      first,
    )
    const added = next(true, 2, [population(['new']), population(['late'], true, 'asks')]).arrival
    expect(added).toBeGreaterThan(first)
    expect(next(true, 2, [population(['new']), population(['late'], true, 'asks')]).arrival).toBe(
      added,
    )
    expect(
      next(true, 2, [population(['newer']), population(['late'], true, 'asks')]).arrival,
    ).toBeGreaterThan(added)
  })

  it('tracks silently while off and does not summon on enabling or reordering', () => {
    const next = attentionSignalTracker()
    const first = next(true, 1, [population(['a'])]).arrival
    expect(next(false, 2, [population(['a', 'b'])]).arrival).toBe(first)
    expect(next(true, 3, [population(['a', 'b', 'c'])]).arrival).toBe(first)
    expect(next(true, 3, [population(['c', 'a', 'b'])]).arrival).toBe(first)
    expect(next(true, 2, [population(['a', 'b'])]).arrival).toBe(first)
  })

  it('never treats an unread list as new or forgets its last known keys', () => {
    const next = attentionSignalTracker()
    const first = next(true, 1, [population(['a'])]).arrival
    expect(next(true, 0, [population([], false)]).arrival).toBe(first)
    expect(next(true, 1, [population(['a'])]).arrival).toBe(first)
    expect(next(true, 2, [population(['a', 'b'])]).arrival).toBeGreaterThan(first)
  })
})

it('main consumes replays and focused/rate-limited arrivals, with no delayed summons', () => {
  const { effects, signals, advance } = native()
  signals.update({ enabled: true, count: 1, arrival: 0 })
  const first = { enabled: true, count: 1, arrival: 1 }
  signals.update(first)
  advance()
  signals.update(first)
  expect(effects.bounce).toHaveBeenCalledTimes(1)
  signals.update({ ...first, arrival: 2 })
  signals.update({ ...first, arrival: 3 })
  expect(effects.bounce).toHaveBeenCalledTimes(2)
  advance()
  signals.update({ ...first, arrival: 3 })
  expect(effects.bounce).toHaveBeenCalledTimes(2)
  effects.isFocused.mockReturnValue(true)
  signals.update({ ...first, arrival: 4 })
  effects.isFocused.mockReturnValue(false)
  signals.update({ ...first, arrival: 4 })
  expect(effects.bounce).toHaveBeenCalledTimes(2)
  signals.update({ ...first, arrival: 5 })
  expect(effects.bounce).toHaveBeenCalledTimes(3)
})

it('only a document reload resets the replay baseline, while retaining the native rate budget', () => {
  const { effects, signals, advance } = native()
  signals.update({ enabled: true, count: 1, arrival: 20 })
  signals.update({ enabled: true, count: 1, arrival: 21 })
  signals.reloaded()
  signals.update({ enabled: true, count: 1, arrival: 0 })
  signals.update({ enabled: true, count: 1, arrival: 1 })
  expect(effects.bounce).toHaveBeenCalledTimes(1)
  advance()
  signals.update({ enabled: true, count: 1, arrival: 1 })
  expect(effects.bounce).toHaveBeenCalledTimes(1)
  signals.update({ enabled: true, count: 1, arrival: 2 })
  expect(effects.bounce).toHaveBeenCalledTimes(2)
})

function decode(png: Buffer | null): Buffer {
  if (png === null) throw new Error('An overlay was expected.')
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.readUInt32BE(16)).toBe(16)
  expect(png.readUInt32BE(20)).toBe(16)
  const length = png.readUInt32BE(33)
  expect(png.subarray(37, 41).toString()).toBe('IDAT')
  const pixels = inflateSync(png.subarray(41, 41 + length))
  expect(pixels.length).toBe(16 * 65)
  return pixels
}

it('Windows overlays are cleared at zero, show 1, and use 9+ above nine', () => {
  expect(attentionOverlay(0)).toBeNull()
  expect(attentionOverlayLabel(0)).toBe('')
  expect(attentionOverlayLabel(1)).toBe('1')
  expect(attentionOverlayLabel(9)).toBe('9')
  expect(attentionOverlayLabel(10)).toBe('9+')
  expect(attentionOverlayLabel(100)).toBe('9+')
  const one = decode(attentionOverlay(1))
  const ninePlus = decode(attentionOverlay(10))
  expect(one).not.toEqual(ninePlus)
  // The centered 1 is drawn at double size; 9+ has two distinct glyphs.
  const white = (pixels: Buffer, x: number, y: number) => [
    ...pixels.subarray(y * 65 + 1 + x * 4, y * 65 + 5 + x * 4),
  ]
  expect(white(one, 7, 3)).toEqual([255, 255, 255, 255])
  expect(white(ninePlus, 4, 5)).toEqual([255, 255, 255, 255])
  expect(white(ninePlus, 9, 6)).toEqual([255, 255, 255, 255])
  expect([...ninePlus.subarray(1, 5)]).toEqual([0, 0, 0, 0])
})

it('refuses malformed IPC metadata rather than asking native code to guess', () => {
  expect(isAttentionSignal(update(1))).toBe(true)
  expect(
    isAttentionSignal({
      enabled: true,
      count: MAX_ATTENTION_COUNT,
      arrival: MAX_ATTENTION_ARRIVAL,
    }),
  ).toBe(true)
  for (const value of [
    null,
    {},
    update(-1),
    update(1.5),
    update(Infinity),
    { ...update(0), enabled: 'yes' },
    { ...update(0), extra: true },
    { enabled: true, count: 1 },
    { ...update(0), arrival: -1 },
    { ...update(0), arrival: 1.5 },
    { ...update(0), arrival: Infinity },
    { ...update(0), arrival: MAX_ATTENTION_ARRIVAL + 1 },
    { ...update(0), count: MAX_ATTENTION_COUNT + 1 },
  ]) {
    expect(isAttentionSignal(value)).toBe(false)
  }
})

it('wires the existing page count and all its populations, with no extra host read', () => {
  const screen = readFileSync(
    new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url),
    'utf8',
  )
  const start = screen.indexOf('syncAttentionSignals(\n')
  expect(start).toBeGreaterThan(0)
  const slice = screen.slice(start, screen.indexOf('/**\n * ⛔ **A clock', start))
  expect(slice).toContain('count: homeNeedsYou.value.total')
  expect(slice).toContain('ready: agentStore.identities.value !== null')
  for (const read of [
    'waitingHere.value',
    'persons.view.value',
    'persons.asks.value',
    'persons.serverRequests.value',
    'persons.waitingOnWhoWrote.value',
    'persons.workWaits.value.todos',
    'persons.workWaits.value.incidents',
    'providersNotChosenIn(agentStore.identities.value)',
  ]) {
    expect(slice).toContain(read)
  }
  expect(slice).not.toContain('window.api.runtime.')
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const handler = main.slice(
    main.indexOf('const attentionWindows'),
    main.indexOf('registerWindowControls(ipcMain'),
  )
  expect(handler).toContain('BrowserWindow.fromWebContents(event.sender)')
  expect(handler).toContain("window.on('focus', () => owned.focused())")
  expect(handler).toContain("setBadge(count === 0 ? '' : String(count))")
  expect(handler).toContain('app.setBadgeCount(count)')
  expect(handler).toContain('window.flashFrame(active)')
  expect(handler).toContain("window.webContents.on('did-navigate', () => owned.reloaded())")
  expect(handler).toContain("window.webContents.on('render-process-gone', () => owned.reloaded())")
  expect(handler).toContain('png === null ? null : nativeImage.createFromBuffer(png)')
})

it.each([
  ['did-navigate', 'darwin'],
  ['render-process-gone', 'darwin'],
  ['did-navigate', 'win32'],
  ['render-process-gone', 'win32'],
])('the main %s wiring silently rebaselines %s and retains its rate budget', (event, platform) => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const start = source.indexOf(
    "      window.webContents.on('render-process-gone', () => owned.reloaded())",
  )
  const end = source.indexOf('      attentionWindows.set(window, signals)', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const { effects, signals, advance } = native(platform)
  const handlers = new Map<string, () => void>()
  const window = {
    webContents: {
      on: (name: string, callback: () => void) => {
        handlers.set(name, callback)
      },
    },
  }
  // Evaluate only the two registrations from main; no Electron or app startup runs here.
  new Function('window', 'owned', source.slice(start, end))(window, signals)
  expect([...handlers.keys()]).toEqual(['render-process-gone', 'did-navigate'])
  expect(handlers.has('did-start-navigation')).toBe(false)
  const summons = () =>
    platform === 'darwin'
      ? effects.bounce.mock.calls.length
      : effects.flash.mock.calls.filter(([active]) => active).length
  signals.update({ enabled: true, count: 1, arrival: 20 })
  signals.update({ enabled: true, count: 2, arrival: 21 })
  expect(summons()).toBe(1)
  const reset = handlers.get(event)
  if (reset === undefined) throw new Error('the native reset was not installed')
  reset()
  signals.update({ enabled: true, count: 3, arrival: 0 })
  expect(summons()).toBe(1)
  expect(platform === 'darwin' ? effects.badge : effects.overlay).toHaveBeenLastCalledWith(3)
  signals.update({ enabled: true, count: 3, arrival: 1 })
  expect(summons()).toBe(1)
  advance()
  signals.update({ enabled: true, count: 3, arrival: 1 })
  expect(summons()).toBe(1)
  signals.update({ enabled: true, count: 3, arrival: 2 })
  expect(summons()).toBe(2)
})
