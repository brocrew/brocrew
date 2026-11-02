import fs from 'node:fs'
import path from 'node:path'
import { privateFolder } from '../privatePaths.js'
import { PRIVATE } from '../privateModes.js'
export const PROFILE_NAME = /^[a-z0-9-]{1,32}$/
export interface ProfileFlags {
  enabled: boolean
  allowExtensions: boolean
  allowSettings: boolean
  allowSync: boolean
  keepRunning: boolean
}
export const FLAG_NAMES = [
  'enabled',
  'allowExtensions',
  'allowSettings',
  'allowSync',
  'keepRunning',
] as const
export type CreatedBy = 'agent' | 'panel'
export interface ProfileRecord {
  name: string
  enabled: boolean
  allowExtensions: boolean
  allowSettings: boolean
  allowSync: boolean
  keepRunning: boolean
  createdAt: string
  createdBy: CreatedBy
  description: string
  temporary: boolean
  /**
   * The person's switch for the BroCrew helper. off: never loaded until they turn it on.
   * turning-on: they pressed Turn on, which beats Chrome's older record of the switch until the
   * helper is running again.
   */
  helper: HelperSwitch
}
export type HelperSwitch = 'on' | 'off' | 'turning-on'
export const DESCRIPTION_MAX = 500
// eslint-disable-next-line no-control-regex -- Refuse control characters in profile labels.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
export function checkDescription(value: unknown): string {
  if (typeof value !== 'string') throw new ProfileStoreError('the description must be text')
  const text = value.trim()
  if (text.length > DESCRIPTION_MAX)
    throw new ProfileStoreError(`the description is longer than ${DESCRIPTION_MAX} characters`)
  if (CONTROL.test(text)) throw new ProfileStoreError('the description must be plain text')
  return text
}
export class ProfileStoreError extends Error {}
export interface ProfileStore {
  list(): ProfileRecord[]
  get(name: string): ProfileRecord | undefined
  dirOf(name: string): string
  create(
    name: string,
    createdBy: CreatedBy,
    opts?: {
      temporary?: boolean
      description?: string
    },
  ): ProfileRecord
  setDescription(name: string, description: string): ProfileRecord
  setFlags(name: string, flags: Partial<ProfileFlags>): ProfileRecord
  setHelper(name: string, helper: HelperSwitch): ProfileRecord
  remove(name: string): void
}
export function isProfileName(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_NAME.test(value)
}
/**
 * Sync and extensions are on by default, except in temporary profiles. Profiles made before that
 * were switched on once, and profiles.json records it, so a person's later choice to turn either
 * off is kept.
 */
export const DEFAULTS_VERSION = 2
export function createProfileStore(opts: { home: string; now?: () => Date }): ProfileStore {
  const now = opts.now ?? (() => new Date())
  const file = path.join(opts.home, 'profiles.json')
  const profilesDir = path.join(opts.home, 'profiles')
  privateFolder(opts.home, profilesDir, true)
  if (PRIVATE.dir !== undefined) fs.chmodSync(opts.home, PRIVATE.dir)
  const readFile = (): { defaults: number; profiles: ProfileRecord[] } => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return { defaults: DEFAULTS_VERSION, profiles: [] }
      throw new ProfileStoreError('profiles.json cannot be read')
    }
    try {
      const parsed = JSON.parse(text) as {
        defaults?: unknown
        profiles?: unknown
      }
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('shape')
      const defaults = Number.isSafeInteger(parsed.defaults) ? (parsed.defaults as number) : 1
      const profiles: ProfileRecord[] = parsed.profiles
        .filter((p): p is ProfileRecord => isRecord(p) && isProfileName(p.name))
        .map((p) => ({
          name: p.name,
          enabled: p.enabled === true,
          allowExtensions: p.allowExtensions === true,
          allowSettings: p.allowSettings === true,
          allowSync: p.allowSync === true,
          keepRunning: p.keepRunning === true,
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
          createdBy: p.createdBy === 'panel' ? 'panel' : 'agent',
          description:
            typeof p.description === 'string' ? p.description.slice(0, DESCRIPTION_MAX) : '',
          temporary: p.temporary === true,
          helper: p.helper === 'off' || p.helper === 'turning-on' ? p.helper : 'on',
        }))
      return { defaults, profiles }
    } catch {
      throw new ProfileStoreError('profiles.json is not valid')
    }
  }
  const read = (): ProfileRecord[] => readFile().profiles
  const write = (profiles: ProfileRecord[]): void => {
    const tmp = path.join(opts.home, `.profiles.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(
      tmp,
      JSON.stringify({ defaults: DEFAULTS_VERSION, profiles }, null, 2) + '\n',
      {
        mode: PRIVATE.file,
      },
    )
    fs.renameSync(tmp, file)
  }
  try {
    const stored = readFile()
    if (stored.defaults < DEFAULTS_VERSION)
      write(
        stored.profiles.map((p) =>
          p.temporary ? p : { ...p, allowExtensions: true, allowSync: true },
        ),
      )
  } catch (error) {
    // An unreadable file is reported by the calls that read it, as before.
    if (!(error instanceof ProfileStoreError)) throw error
  }
  const must = (
    name: string,
  ): {
    all: ProfileRecord[]
    index: number
  } => {
    const all = read()
    const index = all.findIndex((p) => p.name === name)
    if (index < 0) throw new ProfileStoreError(`profile "${name}" does not exist`)
    return { all, index }
  }
  const dirOf = (name: string): string => {
    if (!isProfileName(name))
      throw new ProfileStoreError('profile names are 1-32 characters of a-z, 0-9 and dash')
    privateFolder(opts.home, profilesDir)
    return privateFolder(profilesDir, path.join(profilesDir, name))
  }
  return {
    list: read,
    get: (name) => read().find((p) => p.name === name),
    dirOf,
    create(name, createdBy, createOpts = {}) {
      const dir = dirOf(name)
      const description =
        createOpts.description === undefined ? '' : checkDescription(createOpts.description)
      const temporary = createOpts.temporary === true
      const all = read()
      if (all.some((p) => p.name === name))
        throw new ProfileStoreError(`profile "${name}" already exists`)
      const record: ProfileRecord = {
        name,
        enabled: temporary,
        allowExtensions: !temporary,
        allowSettings: false,
        allowSync: !temporary,
        keepRunning: false,
        createdAt: now().toISOString(),
        createdBy,
        description,
        temporary,
        helper: 'on',
      }
      privateFolder(profilesDir, dir, true)
      write([...all, record])
      return record
    },
    setFlags(name, flags) {
      const { all, index } = must(name)
      const next = { ...all[index] }
      for (const f of FLAG_NAMES) if (typeof flags[f] === 'boolean') next[f] = flags[f] as boolean
      all[index] = next
      write(all)
      return all[index]
    },
    setHelper(name, helper) {
      const { all, index } = must(name)
      all[index] = { ...all[index], helper }
      write(all)
      return all[index]
    },
    setDescription(name, description) {
      const text = checkDescription(description)
      const { all, index } = must(name)
      all[index] = { ...all[index], description: text }
      write(all)
      return all[index]
    },
    remove(name) {
      const { all, index } = must(name)
      const dir = dirOf(name)
      // Keep the name reserved if disk removal fails, so old sign-ins cannot be reused.
      fs.rmSync(dir, { recursive: true, force: true })
      all.splice(index, 1)
      write(all)
    },
  }
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
