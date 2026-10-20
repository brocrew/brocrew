export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}
export function createLogger(
  scope: string,
  sink: (line: string) => void = (l) => process.stderr.write(l + '\n'),
): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>): void =>
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        msg,
        ...(fields ? { fields } : {}),
      }),
    )
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  }
}
export const silentLogger: Logger = { info() {}, warn() {}, error() {} }
