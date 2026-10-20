import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  pageMarkers,
  safePageState,
  stateInPage,
  pageStateSnapshot,
  printPageState,
  pageStateFrames,
  connectDiagnosticPage,
} from '../gates/plugin-packaged/page-state.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
function documentFor(markers = [], changes = {}) {
  return {
    readyState: 'complete',
    body: { childElementCount: 2 },
    location: { pathname: '/fictional/private', protocol: 'file:' },
    querySelector(selector) {
      if (selector === '#app') return { childElementCount: 1 }
      return markers.some(
        (key) => selector === `[data-testid="${key}"]` || selector === `[data-cy="${key}"]`,
      )
        ? {}
        : null
    },
    ...changes,
  }
}
describe('closed page observation independent of the normal preload', () => {
  it('uses the read-only protocol without waiting for a bridge, aborts pending requests and rejects foreign sockets', async () => {
    const abort = new AbortController(),
      calls = []
    class Socket extends EventTarget {
      constructor(url) {
        super()
        calls.push(String(url))
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }
      send(text) {
        const message = JSON.parse(text)
        calls.push(message.method)
        if (message.params.expression === 'stuck') return
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                id: message.id,
                result: {
                  result: {
                    value: {
                      readyState: 'complete',
                      routeCategory: 'recovery',
                      markers: ['recovery'],
                    },
                  },
                },
              }),
            }),
          ),
        )
      }
      close() {
        calls.push('close')
        this.dispatchEvent(new Event('close'))
      }
    }
    const request = async () => ({
      json: async () => [
        { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/fern' },
      ],
    })
    const client = await connectDiagnosticPage(12345, abort.signal, { request, Socket })
    expect(await client.evaluate('document')).toEqual({
      readyState: 'complete',
      routeCategory: 'recovery',
      markers: ['recovery'],
    })
    const pending = client.evaluate('stuck').catch((error) => error.message)
    abort.abort()
    expect(await pending).toBe('Diagnostic page closed')
    client.close()
    expect(calls).toContain('Runtime.evaluate')
    const foreign = async () => ({
      json: async () => [
        { type: 'page', webSocketDebuggerUrl: 'ws://foreign.invalid:12345/fictional-secret' },
      ],
    })
    await expect(
      connectDiagnosticPage(12345, new AbortController().signal, { request: foreign, Socket }),
    ).rejects.toThrow('Foreign diagnostic endpoint')
    expect(calls.join('')).not.toMatch(/fictional|secret|foreign/)
  })
  it.each([
    [['recovery'], 'recovery'],
    [['pane-sign-in'], 'sign-in'],
    [['provider-setup-dialog', 'setup-close'], 'setup'],
    [['session-error'], 'error'],
    [['rail-settings'], 'workspace'],
    [[], 'other'],
  ])('classifies only fixed markers %j without reading text or a full URL', (markers, wanted) => {
    const doc = documentFor(markers)
    Object.defineProperty(doc, 'textContent', {
      get() {
        throw new Error('Text must not be read')
      },
    })
    Object.defineProperty(doc.location, 'href', {
      get() {
        throw new Error('URL must not be read')
      },
    })
    const state = stateInPage(doc, pageMarkers)
    expect(state.routeCategory).toBe(wanted)
    expect(state.markers).toEqual(pageMarkers.filter((key) => markers.includes(key)))
    expect(safeReport({ pageState: state })).toBe(true)
    expect(JSON.stringify(state)).not.toMatch(/fictional|private|file:|textContent/)
  })
  it('recognizes recovery by its fixed route suffix and an empty document without inventing a workspace', () => {
    expect(
      stateInPage(
        documentFor([], { location: { pathname: '/fictional/recovery.html' } }),
        pageMarkers,
      ).routeCategory,
    ).toBe('recovery')
    expect(
      stateInPage(documentFor([], { body: null, readyState: 'loading' }), pageMarkers),
    ).toEqual({ readyState: 'loading', routeCategory: 'blank', markers: [] })
  })
  it('inspects a recovery page with no window.api, validates the reply, and always closes the connection', async () => {
    let closed = 0
    const state = await pageStateSnapshot(12345, {
      connect: async () => ({
        evaluate: async (expression) =>
          Function('document', 'return ' + expression)(documentFor(['recovery'])),
        close() {
          closed++
        },
      }),
    })
    expect(state).toEqual({
      readyState: 'complete',
      routeCategory: 'recovery',
      markers: ['recovery'],
    })
    expect(closed).toBe(1)
  })
  it('bounds a stuck diagnostic connection, aborts it, and returns explicitly unknown', async () => {
    vi.useFakeTimers()
    let signal
    const waiting = pageStateSnapshot(12345, {
      connect: async (_port, aborted) => {
        signal = aborted
        return await new Promise(() => {})
      },
    })
    await vi.advanceTimersByTimeAsync(5001)
    expect(await waiting).toEqual({ readyState: 'unknown', routeCategory: 'other', markers: [] })
    expect(signal.aborted).toBe(true)
  })
  it('refuses native observation locally and refuses arbitrary fields, values and markers in every output channel', async () => {
    vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
    await expect(pageStateSnapshot(12345)).rejects.toThrow('Private Mac gate only')
    const good = { readyState: 'complete', routeCategory: 'setup', markers: ['setup-close'] },
      lines = [],
      frames = []
    const scan = pageStateFrames((value) => frames.push(value))
    for (const bad of [
      { ...good, url: '/fictional' },
      { ...good, readyState: 'HOME=madeup' },
      { ...good, routeCategory: '/fictional' },
      { ...good, markers: ['madeup-secret'] },
      { ...good, markers: ['setup-close', 'setup-close'] },
    ]) {
      expect(safePageState(bad)).toBe(false)
      expect(safeReport({ pageState: bad })).toBe(false)
      expect(safeReport({ matrixPageStates: { V2F: bad } })).toBe(false)
      printPageState(bad, (line) => lines.push(line))
      scan(Buffer.from('gate-page-state ' + JSON.stringify(bad) + '\n'))
      expect(
        await pageStateSnapshot(12345, {
          connect: async () => ({ evaluate: async () => bad, close() {} }),
        }),
      ).toEqual({ readyState: 'unknown', routeCategory: 'other', markers: [] })
    }
    printPageState(good, (line) => lines.push(line))
    scan(Buffer.from(lines[0] + '\n'))
    expect(frames).toEqual([good])
    expect(lines.join('')).not.toMatch(/fictional|HOME|madeup|secret|url/)
  })
})
