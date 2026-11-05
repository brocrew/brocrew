export interface PluginNodeReady {
  readonly serverPid: number
  readonly origin: string
  /** Diagnostic snapshot of this authenticated owned server; never admission evidence. */
  readonly priorityClamped?: boolean | null
  /** These capabilities stay with the supervisor/broker; JSON contains no credential. */
  hooks?(): { url: string; headers: { Authorization: string } }
  mcp(): { url: string; headers: { Authorization: string } }
  admin(): { url: string; headers: { Authorization: string } }
}
