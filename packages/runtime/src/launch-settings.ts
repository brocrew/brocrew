/**
 * The settings a launch gives its provider that change what the provider itself puts in front of
 * its model, as the adapter launched with them: one entry per setting, keyed, with no words.
 * Provider-owned display facts are projected separately when the launch record is read.
 */

/** @deprecated Closed legacy compatibility alias; portable records use LaunchSetting<string>. */
export type ClaudeLaunchSettingKey =
  | 'settings-sources'
  | 'memory-folder'
  | 'built-in-tools'
  | 'denied-tools'
  | 'mode'
  | 'connectors'
  | 'attribution'

/** @deprecated Closed legacy compatibility alias; portable records use LaunchSetting<string>. */
export type CodexLaunchSettingKey =
  'memory' | 'thread-overrides' | 'plan-tool' | 'approval-sandbox' | 'collaboration-mode'

/**
 * One of either provider's keys; the approval mode this app runs the conversation in; `tools-off`,
 * the provider's own question tools this app turned off for the launch; or `tools-left-on`, those it
 * has no switch for and leaves on. Each by the provider's own names.
 */
export type LaunchSettingKey =
  ClaudeLaunchSettingKey | CodexLaunchSettingKey | 'approval' | 'tools-off' | 'tools-left-on'

export type LaunchSettingValue = string | boolean | readonly string[] | null

/** One setting, as launched. */
export interface LaunchSetting<Key extends string = LaunchSettingKey> {
  readonly key: Key
  readonly value: LaunchSettingValue
}
