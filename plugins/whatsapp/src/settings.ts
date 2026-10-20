import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** What the person chose on the settings page. Every choice applies to all agents. */
export interface Settings {
  /** Agents may read chats, messages, contacts and media. Off until the person turns it on. */
  read: boolean
  /** Messages agents send begin with 🤖. */
  prefix: boolean
  /** The groups agents may send to, by group id. A group not listed cannot be written to. */
  writable: readonly string[]
}
export const GROUP_ID = /^[0-9]{5,40}(?:-[0-9]{1,20})?@g\.us$/
const MAX_GROUPS = 1024
const DEFAULTS: Settings = Object.freeze({ read: false, prefix: true, writable: Object.freeze([]) })

function parse(text: string): Settings {
  const value = JSON.parse(text) as Partial<Record<keyof Settings, unknown>>
  if (
    typeof value?.read !== 'boolean' ||
    typeof value.prefix !== 'boolean' ||
    !Array.isArray(value.writable) ||
    value.writable.length > MAX_GROUPS ||
    !value.writable.every((one) => typeof one === 'string' && GROUP_ID.test(one))
  )
    throw new Error('settings')
  return { read: value.read, prefix: value.prefix, writable: [...new Set(value.writable)] }
}

export interface SettingsStore {
  get(): Settings
  setRead(on: boolean): Settings
  setPrefix(on: boolean): Settings
  setWritable(group: string, on: boolean): Settings
  /** A new link starts with no group writable: group ids belong to the account that was linked. */
  forgetGroups(): Settings
}

/** settings.json in the plugin's private root. A missing or damaged file means the defaults. */
export function createSettingsStore(home: string): SettingsStore {
  const file = path.join(home, 'settings.json')
  let current: Settings
  try {
    current = parse(fs.readFileSync(file, 'utf8'))
  } catch {
    current = DEFAULTS
  }
  const save = (next: Settings): Settings => {
    const stage = path.join(home, `.settings-${randomBytes(8).toString('hex')}.json`)
    fs.writeFileSync(stage, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' })
    try {
      fs.renameSync(stage, file)
    } catch (error) {
      fs.rmSync(stage, { force: true })
      throw error
    }
    current = next
    return current
  }
  return {
    get: () => current,
    setRead: (on) => save({ ...current, read: on }),
    setPrefix: (on) => save({ ...current, prefix: on }),
    setWritable(group, on) {
      if (!GROUP_ID.test(group)) throw new Error('group')
      const rest = current.writable.filter((one) => one !== group)
      if (on && rest.length >= MAX_GROUPS) throw new Error('group')
      return save({ ...current, writable: on ? [...rest, group] : rest })
    },
    forgetGroups: () => save({ ...current, writable: [] }),
  }
}
