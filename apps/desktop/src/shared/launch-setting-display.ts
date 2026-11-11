import type { LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import type {
  GivenLaunchSetting,
  GivenLaunchSettings,
  GivenLaunchSettingRow,
} from './what-this-agent-was-given'

export interface SettingWords {
  readonly label: string
  readonly words: string | null
  readonly lines: readonly string[]
}

function asSent(value: LaunchSettingValue): string {
  if (Array.isArray(value)) return value.join(', ')
  return value === null ? 'unknown' : String(value)
}

/** Join opaque supplied words, keeping raw values visible when a reader has no display facts. */
export function launchSettingRows(
  settings: GivenLaunchSettings | undefined,
  describe?: (key: LaunchSettingKey, value: LaunchSettingValue) => SettingWords | undefined,
): readonly GivenLaunchSettingRow[] {
  const wordsFor = (key: LaunchSettingKey, value: LaunchSettingValue): SettingWords => {
    const one = describe?.(key, value) ?? { label: key, words: null, lines: [] }
    return one.words === null && one.lines.length === 0
      ? { ...one, words: `${asSent(value)}.` }
      : one
  }
  return (settings?.settings ?? []).map((setting: GivenLaunchSetting) => {
    const atLaunch = wordsFor(setting.key, setting.atLaunch)
    const label = atLaunch.label
    const now = setting.now === undefined ? null : wordsFor(setting.key, setting.now)
    // A recorded null is a kept value. Only a launch without a record has nothing to say.
    if (setting.atLaunch === null && settings?.recorded !== true) {
      const words = now ? `Not recorded. Now: ${now.words ?? ''}`.trim() : 'Not recorded.'
      return { key: setting.key, label, words, lines: now?.lines ?? [] }
    }
    const changed =
      setting.now !== undefined && JSON.stringify(setting.now) !== JSON.stringify(setting.atLaunch)
    if (!changed)
      return { key: setting.key, label, words: atLaunch.words ?? '', lines: atLaunch.lines }
    return {
      key: setting.key,
      label,
      words: `At launch: ${atLaunch.words ?? asSent(setting.atLaunch)} Now: ${now?.words ?? asSent(setting.now!)}`,
      lines: [],
    }
  })
}
