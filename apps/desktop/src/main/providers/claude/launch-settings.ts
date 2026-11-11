import type { LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import { joinedSettingNames, settingWords } from '../given-policy'

/** Display the values this adapter records, including older kept launch values. */
export function launchSetting(key: LaunchSettingKey, value: LaunchSettingValue) {
  switch (key) {
    case 'mode':
      return settingWords(
        'Plan',
        value === 'plan' ? 'Plan mode.' : value === 'default' ? 'Off.' : null,
      )
    case 'settings-sources':
      return settingWords(
        'Settings files',
        Array.isArray(value)
          ? value.length === 0
            ? 'Off. This app adds the instruction files itself.'
            : `Reads ${joinedSettingNames(value)}.`
          : null,
      )
    case 'memory-folder':
      return settingWords(
        'Memory',
        typeof value === 'string' ? 'On, in this profile’s memory folder.' : null,
        typeof value === 'string' ? [value] : [],
      )
    case 'built-in-tools': {
      if (!Array.isArray(value)) return settingWords('Built-in tools', null)
      const named = value.filter((one) => one !== 'preset:default')
      return settingWords(
        'Built-in tools',
        value.includes('preset:default')
          ? named.length === 0
            ? 'Default tools.'
            : `Default tools, plus ${joinedSettingNames(named)}.`
          : `${joinedSettingNames(named)}.`,
      )
    }
    case 'denied-tools':
      return settingWords(
        'Not allowed',
        Array.isArray(value)
          ? value.length === 0
            ? 'None.'
            : `${joinedSettingNames(value)}.`
          : null,
      )
    case 'connectors':
      return settingWords(
        'Account connectors',
        value === true ? 'On.' : value === false ? 'Off.' : null,
      )
    case 'attribution':
      return settingWords(
        'Commit signatures',
        value === 'provider-default'
          ? 'Provider default.'
          : value === 'set'
            ? 'Set by this app.'
            : null,
      )
    default:
      return undefined
  }
}
