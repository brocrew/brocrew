/**
 * The settings a launch gives its provider that change what the provider itself puts in front of
 * its model, as the adapter launched with them: one entry per setting, keyed, with no words. The
 * window says each in its own words.
 */

/** Claude Code's settings that change what it sends its model. */
export type ClaudeLaunchSettingKey =
  /** Which settings files it reads: `[]`, none. */
  | 'settings-sources'
  /** The folder its memory is kept in. */
  | 'memory-folder'
  /** The built-in tools it is given beyond its own default set. */
  | 'built-in-tools'
  /** The tool names it is told it may not use. */
  | 'denied-tools'
  /** Its permission mode: `default`, or `plan`. */
  | 'mode'
  /** Whether the account's claude.ai connectors are on. */
  | 'connectors'
  /** Who decides the commit attribution it adds: `provider-default`, its own. */
  | 'attribution'

/** Codex's settings that change what it sends its model. */
export type CodexLaunchSettingKey =
  /**
   * The memory settings in its home's `config.toml`, each `table.key=value`; `null` where this app
   * could not confirm it wrote them, since writing them never stops a launch.
   */
  | 'memory'
  /** The overrides the thread is opened with, each `key=value`. */
  | 'thread-overrides'
  /** Whether its planning tool is on. */
  | 'plan-tool'
  /** Its approval policy, approvals reviewer and sandbox, each `name=value`. */
  | 'approval-sandbox'
  /**
   * Its collaboration mode as the adapter chose it at this launch: `plan`, or `default`, which also
   * covers a launch that sends no mode at all. ⚠️ Not proof of the mode a resumed thread is in.
   */
  | 'collaboration-mode'

/**
 * One of either provider's keys; the approval mode this app runs the conversation in; `tools-off`,
 * the provider's own question tools this app turned off for the launch; or `tools-left-on`, those it
 * has no switch for and leaves on. Each by the provider's own names.
 */
export type LaunchSettingKey =
  ClaudeLaunchSettingKey | CodexLaunchSettingKey | 'approval' | 'tools-off' | 'tools-left-on'

export type LaunchSettingValue = string | boolean | readonly string[] | null

/** One setting, as launched. */
export interface LaunchSetting {
  readonly key: LaunchSettingKey
  readonly value: LaunchSettingValue
}
