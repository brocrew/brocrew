import type { GivenPolicy as PortablePolicy } from '@brobot2/runtime/provider-module'
import type { DesktopProviderValues } from './desktop-values'
import type { LaunchSetting, LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import type {
  GivenLaunchSettings,
  GivenLaunchSettingDisplay,
} from '../../shared/what-this-agent-was-given'
import { launchSettingRows, type SettingWords } from '../../shared/launch-setting-display'
export type GivenPolicy = PortablePolicy<DesktopProviderValues>

export function settingWords(
  label: string,
  words: string | null,
  lines: readonly string[] = [],
): SettingWords {
  return { label, words, lines }
}

export function joinedSettingNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function appSetting(key: LaunchSettingKey, value: LaunchSettingValue): SettingWords | undefined {
  if (key === 'approval')
    return settingWords(
      'Approval',
      value === 'ask' ? 'Asks first.' : value === 'auto' ? 'Runs without asking.' : null,
    )
  if (key === 'tools-off' || key === 'tools-left-on')
    return settingWords(
      key === 'tools-off' ? 'Turned off' : 'Left on',
      !Array.isArray(value)
        ? null
        : value.length === 0
          ? 'None.'
          : `${joinedSettingNames(value)}${key === 'tools-left-on' ? ' (no switch)' : ''}.`,
    )
  return undefined
}

/** The current read supplies display facts without changing any kept launch values. */
export function launchSettingDisplay(
  settings: GivenLaunchSettings,
  policy: Partial<Pick<GivenPolicy, 'launchSetting' | 'planningKey'>>,
  captured: { readonly approval: string; readonly planning: boolean } | undefined,
): GivenLaunchSettingDisplay {
  const at = (key: LaunchSettingKey | undefined) =>
    settings.settings.find((one) => one.key === key)?.atLaunch ?? null
  const approval = at('approval')
  const plan = at(policy.planningKey)
  return {
    rows: launchSettingRows(
      settings,
      (key, value) => policy.launchSetting?.(key, value) ?? appSetting(key, value),
    ),
    modeDiffersFromCopy:
      captured !== undefined &&
      ((approval !== null && approval !== captured.approval) ||
        (plan !== null && (plan === 'plan') !== captured.planning)),
  }
}

export function launchSettingsAtRead(
  kept: readonly LaunchSetting[] | undefined,
  policy: Pick<GivenPolicy, 'planningKey' | 'launchSetting'>,
  standsNow: { readonly approval: string | null; readonly planning: boolean | null },
  captured: { readonly approval: string; readonly planning: boolean } | undefined,
): { launchSettings: GivenLaunchSettings; launchSettingDisplay: GivenLaunchSettingDisplay } {
  const nowOf = (key: LaunchSettingKey): { now: LaunchSettingValue } | object =>
    key === 'approval'
      ? { now: standsNow.approval }
      : key === policy.planningKey
        ? { now: standsNow.planning === null ? null : standsNow.planning ? 'plan' : 'default' }
        : {}
  const launchSettings: GivenLaunchSettings =
    kept === undefined
      ? {
          recorded: false,
          settings: (['approval', policy.planningKey] as const).map((key) => ({
            key,
            atLaunch: null,
            ...nowOf(key),
          })),
        }
      : {
          recorded: true,
          settings: kept.map((one) => ({ key: one.key, atLaunch: one.value, ...nowOf(one.key) })),
        }
  return {
    launchSettings,
    launchSettingDisplay: launchSettingDisplay(launchSettings, policy, captured),
  }
}
