import type { LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import type {
  GivenLaunchSetting,
  GivenLaunchSettings,
  WhatThisAgentWasGiven,
} from '../../../shared/what-this-agent-was-given'

/**
 * The launch settings that change the provider's text, in words. The host sends each setting keyed,
 * with its value at launch and, for approval and planning, its value now; the words are these.
 */

/** The words that name this app, kept apart so a rename changes them here. */
export const SETTING_SELF_WORDS = {
  noSettingsFiles: 'Off. This app adds the instruction files itself.',
  attributionSet: 'Set by this app.',
} as const

/**
 * The words for each setting this window knows. ⚠️ Partial on purpose: the host may record a setting
 * before the window has words for it, and that one is drawn by its key and its value as sent.
 */
export const SETTING_LABEL: Readonly<Partial<Record<LaunchSettingKey, string>>> = {
  approval: 'Approval',
  mode: 'Plan',
  'collaboration-mode': 'Plan',
  'settings-sources': 'Settings files',
  'memory-folder': 'Memory',
  'built-in-tools': 'Built-in tools',
  'denied-tools': 'Not allowed',
  connectors: 'Account connectors',
  attribution: 'Commit signatures',
  'approval-sandbox': 'Approval and files',
  memory: 'Memory',
  'plan-tool': 'Plan tool',
  'thread-overrides': 'Thread settings',
  'tools-off': 'Turned off',
  'tools-left-on': 'Left on',
}

/** One value in words, with any list the words stand for kept apart to draw in mono. */
export interface SettingSaid {
  readonly words: string | null
  readonly lines: readonly string[]
}

const isList = (value: LaunchSettingValue): value is readonly string[] => Array.isArray(value)

/** `a`, `a and b`, `a, b and c`. */
function joined(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const said = (words: string | null, lines: readonly string[] = []): SettingSaid => ({
  words,
  lines,
})

export function settingSaid(key: LaunchSettingKey, value: LaunchSettingValue): SettingSaid {
  switch (key) {
    case 'approval':
      return said(
        value === 'ask' ? 'Asks first.' : value === 'auto' ? 'Runs without asking.' : null,
      )
    case 'mode':
      return said(value === 'plan' ? 'Plan mode.' : value === 'default' ? 'Off.' : null)
    case 'collaboration-mode':
      return said(value === 'plan' ? 'Plan mode.' : value === 'default' ? 'Default.' : null)
    case 'settings-sources': {
      if (!isList(value)) return said(null)
      const sources = value
      return sources.length === 0
        ? said(SETTING_SELF_WORDS.noSettingsFiles)
        : said(`Reads ${joined(sources)}.`)
    }
    case 'memory-folder':
      return typeof value === 'string'
        ? said('On, in this profile’s memory folder.', [value])
        : said(null)
    case 'built-in-tools': {
      if (!isList(value)) return said(null)
      const tools = value
      const named = tools.filter((one) => one !== 'preset:default')
      if (tools.includes('preset:default'))
        return said(named.length === 0 ? 'Default tools.' : `Default tools, plus ${joined(named)}.`)
      return said(`${joined(named)}.`)
    }
    case 'denied-tools': {
      if (!isList(value)) return said(null)
      const tools = value
      return said(tools.length === 0 ? 'None.' : `${joined(tools)}.`)
    }
    case 'connectors':
      return said(value === true ? 'On.' : value === false ? 'Off.' : null)
    case 'attribution':
      return said(
        value === 'provider-default'
          ? 'Provider default.'
          : value === 'set'
            ? SETTING_SELF_WORDS.attributionSet
            : null,
      )
    case 'approval-sandbox':
      return said(null, isList(value) ? value : [])
    case 'memory':
      return value === null ? said('Couldn’t be read.') : said(null, isList(value) ? value : [])
    case 'plan-tool':
      return said(value === true ? 'Enabled.' : value === false ? 'Off.' : null)
    case 'thread-overrides': {
      if (!isList(value)) return said(null)
      const overrides = value
      return overrides.length === 0 ? said('None.') : said(null, overrides)
    }
    case 'tools-off':
      if (!isList(value)) return said(null)
      return said(value.length === 0 ? 'None.' : `${joined(value)}.`)
    case 'tools-left-on':
      if (!isList(value)) return said(null)
      return said(value.length === 0 ? 'None.' : `${joined(value)} (no switch).`)
    default:
      return said(null)
  }
}

/** A value the words above do not name is drawn as the host sent it, rather than dropped. */
function asSent(value: LaunchSettingValue): string {
  if (Array.isArray(value)) return value.join(', ')
  return value === null ? 'unknown' : String(value)
}

/** A setting's sentence: its value at launch, and its value now where that has changed. */
export interface SettingRow {
  readonly key: LaunchSettingKey
  readonly label: string
  readonly words: string
  readonly lines: readonly string[]
}

function wordsFor(key: LaunchSettingKey, value: LaunchSettingValue): SettingSaid {
  const one = settingSaid(key, value)
  return one.words === null && one.lines.length === 0 ? said(`${asSent(value)}.`) : one
}

export function settingRow(setting: GivenLaunchSetting, recorded: boolean): SettingRow {
  const label = SETTING_LABEL[setting.key] ?? setting.key
  const now = setting.now === undefined ? null : wordsFor(setting.key, setting.now)
  // ⚠️ A recorded launch's null is a kept value (Codex's memory when its config could not be read):
  // it is said, or drawn as sent. Only a launch that kept no record has nothing to say.
  if (setting.atLaunch === null && !recorded) {
    const line = now ? `Not recorded. Now: ${now.words ?? ''}`.trim() : 'Not recorded.'
    return { key: setting.key, label, words: line, lines: now?.lines ?? [] }
  }
  const atLaunch = wordsFor(setting.key, setting.atLaunch)
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
}

export function settingRows(settings: GivenLaunchSettings | undefined): readonly SettingRow[] {
  return (settings?.settings ?? []).map((one) => settingRow(one, settings?.recorded === true))
}

/** Shown beside the provider's text when the launch's mode is not the one its copy was made in. */
export const MODE_DIFFERS = 'This launch’s mode differs from the copy.'

/**
 * Whether the launch's approval or planning differs from the mode the provider copy was captured
 * in. ⚠️ A setting the launch did not record says nothing either way.
 */
export function modeDiffersFromCopy(given: WhatThisAgentWasGiven): boolean {
  const captured = given.providerParts.capturedIn
  const settings = given.launchSettings?.settings ?? []
  if (captured === undefined) return false
  const at = (key: LaunchSettingKey): LaunchSettingValue | null =>
    settings.find((one) => one.key === key)?.atLaunch ?? null
  const approval = at('approval')
  const plan = at('mode') ?? at('collaboration-mode')
  return (
    (approval !== null && approval !== captured.approval) ||
    (plan !== null && (plan === 'plan') !== captured.planning)
  )
}
