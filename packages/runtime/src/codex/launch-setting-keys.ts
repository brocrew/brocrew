/** Codex launch keys, including those retained in older records. */
export const CODEX_LAUNCH_SETTING_KEYS = [
  /**
   * The memory settings in its home's `config.toml`, each `table.key=value`; `null` where this app
   * could not confirm it wrote them, since writing them never stops a launch.
   */
  'memory',
  /** The overrides the thread is opened with, each `key=value`. */
  'thread-overrides',
  /** Whether its planning tool is on. */
  'plan-tool',
  /** Its approval policy, approvals reviewer and sandbox, each `name=value`. */
  'approval-sandbox',
  /**
   * Its collaboration mode as the adapter chose it at this launch: `plan`, or `default`, which also
   * covers a launch that sends no mode at all. ⚠️ Not proof of the mode a resumed thread is in.
   */
  'collaboration-mode',
] as const
