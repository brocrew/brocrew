/**
 * The settings a launch gives its provider that change what the provider itself puts in front of
 * its model, as the adapter launched with them: one entry per setting, keyed, with no words.
 * Provider-owned display facts are projected separately when the launch record is read.
 */

export type LaunchSettingValue = string | boolean | readonly string[] | null

/** One setting, as launched. */
export interface LaunchSetting<Key extends string = string> {
  readonly key: Key
  readonly value: LaunchSettingValue
}
