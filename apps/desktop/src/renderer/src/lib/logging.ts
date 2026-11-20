import log from 'electron-log/renderer'

Object.assign(console, log.functions)

const rendererError = log.scope('renderer-error')

function report(kind: string, reason: unknown, message = '', location = ''): void {
  const error = reason instanceof Error ? reason : undefined
  const shape = error ? 'Error' : reason === null ? 'null' : typeof reason
  const detail = message || (typeof reason === 'string' ? reason : error?.message)
  const header = `${kind} reason=${shape}${location}${detail ? `: ${detail}` : ''}`
  rendererError.error(typeof error?.stack === 'string' ? `${header}\n${error.stack}` : header)
}

window.addEventListener('error', (event) => {
  const { filename, lineno, colno, message } = event
  const position = lineno > 0 ? `:${lineno}${colno > 0 ? `:${colno}` : ''}` : ''
  const location = filename ? ` at ${filename}${position}` : ''
  report('error', event.error, message, location)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  report('unhandledrejection', reason, '', reason === undefined ? ' origin=unavailable' : '')
})
