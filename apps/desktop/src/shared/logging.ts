export const LOGGING_CHANNELS = {
  get: 'app:logging:get',
  setDebug: 'app:logging:set-debug',
} as const

export interface LoggingState {
  readonly debug: boolean
  readonly path: string
  readonly servicePath: string | null
}

export interface LoggingClient {
  getLogging(): Promise<LoggingState>
  setLoggingDebug(debug: boolean): Promise<LoggingState>
}

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

export function loggingClient(invoke: Invoke): Readonly<LoggingClient> {
  return Object.freeze({
    getLogging: () => invoke(LOGGING_CHANNELS.get) as Promise<LoggingState>,
    setLoggingDebug: (debug: boolean) =>
      invoke(LOGGING_CHANNELS.setDebug, debug) as Promise<LoggingState>,
  })
}
