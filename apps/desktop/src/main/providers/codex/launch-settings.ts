import type { LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import { settingWords } from '../given-policy'

/** Display the values this adapter records, including older kept launch values. */
export function launchSetting(key: LaunchSettingKey, value: LaunchSettingValue) {
  switch (key) {
    case 'collaboration-mode':
      return settingWords(
        'Plan',
        value === 'plan' ? 'Plan mode.' : value === 'default' ? 'Default.' : null,
      )
    case 'approval-sandbox':
      return settingWords('Approval and files', null, Array.isArray(value) ? value : [])
    case 'memory':
      return settingWords(
        'Memory',
        value === null ? 'Couldn’t be read.' : null,
        Array.isArray(value) ? value : [],
      )
    case 'plan-tool':
      return settingWords(
        'Plan tool',
        value === true ? 'Enabled.' : value === false ? 'Off.' : null,
      )
    case 'thread-overrides':
      return settingWords(
        'Thread settings',
        Array.isArray(value) && value.length === 0 ? 'None.' : null,
        Array.isArray(value) ? value : [],
      )
    default:
      return undefined
  }
}
