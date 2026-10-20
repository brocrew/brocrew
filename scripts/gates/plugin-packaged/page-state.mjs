// Independent of the normal window.api bridge: recovery/setup pages must remain inspectable.
import { requireCI } from './contract.mjs'
import { closedFrames } from './diagnostics.mjs'
import { bounded } from './processes.mjs'

export const pageMarkers = [
  'rail-settings',
  'provider-setup-dialog',
  'setup-close',
  'recovery',
  'recovery-no-bridge',
  'pane-sign-in',
  'session-error',
  'plugins-section',
]
const readyStates = ['loading', 'interactive', 'complete', 'unknown']
const routes = ['workspace', 'setup', 'recovery', 'sign-in', 'error', 'blank', 'other']
export function safePageState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'markers,readyState,routeCategory' &&
    readyStates.includes(value.readyState) &&
    routes.includes(value.routeCategory) &&
    Array.isArray(value.markers) &&
    value.markers.length <= pageMarkers.length &&
    new Set(value.markers).size === value.markers.length &&
    value.markers.every((key) => pageMarkers.includes(key))
  )
}
// Serialized into the owned page. Return no URL, text, arbitrary attribute name or value.
export function stateInPage(doc, allowed) {
  const markers = allowed.filter(
    (key) => doc.querySelector(`[data-testid="${key}"]`) || doc.querySelector(`[data-cy="${key}"]`),
  )
  const pathname = doc.location?.pathname ?? ''
  const routeCategory =
    markers.includes('recovery') || pathname.endsWith('/recovery.html')
      ? 'recovery'
      : markers.includes('pane-sign-in')
        ? 'sign-in'
        : markers.includes('provider-setup-dialog')
          ? 'setup'
          : markers.includes('session-error') || doc.location?.protocol === 'chrome-error:'
            ? 'error'
            : markers.includes('rail-settings')
              ? 'workspace'
              : !doc.body ||
                  doc.body.childElementCount === 0 ||
                  doc.querySelector('#app')?.childElementCount === 0
                ? 'blank'
                : 'other'
  return {
    readyState: ['loading', 'interactive', 'complete'].includes(doc.readyState)
      ? doc.readyState
      : 'unknown',
    routeCategory,
    markers,
  }
}
const unknown = () => ({ readyState: 'unknown', routeCategory: 'other', markers: [] })
export async function connectDiagnosticPage(port, signal, io = {}) {
  if (!io.request || !io.Socket) requireCI()
  const response = await (io.request ?? fetch)(`http://127.0.0.1:${port}/json/list`, { signal })
  const rows = await response.json()
  const target =
    Array.isArray(rows) && rows.find((row) => row.type === 'page' && row.webSocketDebuggerUrl)
  if (!target) throw new Error('No diagnostic page')
  const url = new URL(target.webSocketDebuggerUrl)
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    Number(url.port) !== port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Foreign diagnostic endpoint')
  const socket = new (io.Socket ?? WebSocket)(url)
  let next = 0
  const pending = new Map()
  const refuse = () => {
    for (const item of pending.values()) item.reject(new Error('Diagnostic page closed'))
    pending.clear()
  }
  const stop = () => {
    refuse()
    try {
      socket.close()
    } catch {
      /* Already closed. */
    }
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    await new Promise((resolve, reject) => {
      const failed = () => reject(new Error('Diagnostic connection closed'))
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('close', failed, { once: true })
      if (signal.aborted) {
        stop()
        failed()
      }
    })
    socket.addEventListener('close', refuse)
    socket.addEventListener('error', refuse)
    socket.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(data),
          item = pending.get(message.id)
        if (!item) return
        pending.delete(message.id)
        if (message.error) item.reject(new Error('Diagnostic protocol refused'))
        else item.resolve(message.result)
      } catch {
        refuse()
      }
    })
    return {
      evaluate(expression) {
        if (signal.aborted) return Promise.reject(new Error('Diagnostic deadline'))
        return new Promise((resolve, reject) => {
          const id = ++next
          pending.set(id, {
            resolve: (value) => {
              if (value.exceptionDetails) reject(new Error('Diagnostic evaluation refused'))
              else resolve(value.result?.value)
            },
            reject,
          })
          socket.send(
            JSON.stringify({
              id,
              method: 'Runtime.evaluate',
              params: {
                expression,
                returnByValue: true,
                awaitPromise: false,
              },
            }),
          )
        })
      },
      close() {
        signal.removeEventListener('abort', stop)
        stop()
      },
    }
  } catch (error) {
    signal.removeEventListener('abort', stop)
    stop()
    throw error
  }
}
export async function pageStateSnapshot(port, io = {}) {
  if (!io.connect) requireCI()
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return unknown()
  const abort = new AbortController()
  let client
  const timer = setTimeout(() => abort.abort(), 5000)
  try {
    const state = await bounded(
      (async () => {
        client = await (io.connect ?? connectDiagnosticPage)(port, abort.signal)
        if (abort.signal.aborted) {
          client.close()
          throw new Error('Diagnostic deadline')
        }
        return await client.evaluate(
          `(${stateInPage.toString()})(document, ${JSON.stringify(pageMarkers)})`,
        )
      })(),
      5000,
    )
    return safePageState(state) ? state : unknown()
  } catch {
    return unknown()
  } finally {
    clearTimeout(timer)
    abort.abort()
    client?.close()
  }
}
export function printPageState(value, write = (line) => console.log(line)) {
  if (safePageState(value)) write('gate-page-state ' + JSON.stringify(value))
}
export const pageStateFrames = (receive) => closedFrames('gate-page-state ', safePageState, receive)
