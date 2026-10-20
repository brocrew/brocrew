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
}
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
  remove(name: string): void
}
export function isProfileName(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_NAME.test(value)
}
export function createProfileStore(opts: { home: string; now?: () => Date }): ProfileStore {
  const now = opts.now ?? (() => new Date())
  const file = path.join(opts.home, 'profiles.json')
  const profilesDir = path.join(opts.home, 'profiles')
  privateFolder(opts.home, profilesDir, true)
  if (PRIVATE.dir !== undefined) fs.chmodSync(opts.home, PRIVATE.dir)
  const read = (): ProfileRecord[] => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new ProfileStoreError('profiles.json cannot be read')
    }
    try {
      const parsed = JSON.parse(text) as {
        profiles?: unknown
      }
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('shape')
      return parsed.profiles
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
        }))
    } catch {
      throw new ProfileStoreError('profiles.json is not valid')
    }
  }
  const write = (profiles: ProfileRecord[]): void => {
    const tmp = path.join(opts.home, `.profiles.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify({ profiles }, null, 2) + '\n', { mode: PRIVATE.file })
    fs.renameSync(tmp, file)
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
        allowExtensions: false,
        allowSettings: false,
        allowSync: false,
        keepRunning: false,
        createdAt: now().toISOString(),
        createdBy,
        description,
        temporary,
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
      all.splice(index, 1)
      write(all)
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
