import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { privateFolder } from '../privatePaths.js'
import {
  browserProcessesOf,
  parseCimRows,
  BROWSER_EXE,
  WINDOWS_LIST_SCRIPT,
} from '../browser/processes.js'
import {
  createProfileStore,
  checkDescription,
  checkDisplayName,
  checkDisplayNameAvailable,
  RENAME_ERRORS,
  isProfileName,
  ProfileStoreError,
  FLAG_NAMES,
} from './store.js'
import type { ProfileStore, ProfileRecord, HelperSwitch } from './store.js'
import { durableJson, identity, ownerState, withSharedLock } from './sharedLock.js'
import type { ProcessIdentity, Liveness } from './sharedLock.js'
import type { SharedProfileAccess, SharedProfileAdmission } from './sharedTypes.js'
import { readVolumeIdentity } from './volumeIdentity.js'
export type ChromeState = 'ended' | 'live' | 'unknown'
export class ProfileInUseElsewhereError extends ProfileStoreError {
  readonly transient = true
  constructor(readonly label: string) {
    super(
      `Chrome profile is in use in ${label === 'the default workspaces' ? label : `the ${label} workspace`} right now. Use another profile, or ask the person to close it there. You can retry after it closes.`,
    )
  }
}
interface Workspace {
  label: string
  lastSeenAt: string
  [key: string]: unknown
}
interface Lease extends ProcessIdentity {
  token: string
  runId: string
  workspaceId: string
  label: string
  startedAt: string
}
interface FileIdentity {
  dev: string
  ino: string
  volume?: string
  uid?: string
  mode?: string
  birthtime?: string
  type?: 'directory'
}
interface Migration {
  id: string
  workspaceId: string
  sourceName: string
  sourceAlias?: string
  home: FileIdentity
  source: FileIdentity
  phase: 'reserved' | 'moved' | 'retired'
  owner: Lease
  error?: string
}
interface SharedRecord extends Omit<ProfileRecord, 'enabled' | 'keepRunning'> {
  id: string
  directory: FileIdentity
  permissionRevision: number
  authorizationSchema: number
  state: 'ready' | 'moving' | 'deleting'
  perWorkspace: Record<string, { enabled: boolean; keepRunning: boolean; [key: string]: unknown }>
  lease?: Lease
  migration?: Migration
  migratedFrom?: string
  deleteOwner?: Lease
  [key: string]: unknown
}
interface Registry {
  format: number
  revision: number
  workspaces: Record<string, Workspace>
  profiles: SharedRecord[]
  [key: string]: unknown
}
/** workspaceId/workspaceLabel are historical schema names for the verified plugin OWNER/root,
 * never the request workspace. Default-root workspaces share one owner switch in v1. */
export interface SharedStoreOptions {
  home: string
  shared: string
  workspaceId: string
  workspaceLabel: string
  now?: () => Date
  /** Release-level platform signal. Qualification harnesses opt in only on fictional homes. */
  migrationApproved?: boolean
  chromeState?: (dir: string) => ChromeState
  ownerState?: (owner: ProcessIdentity) => Liveness
  processIdentity?: ProcessIdentity
  checkpoint?: (phase: string) => void
  rename?: (source: string, destination: string) => void
  /** Trusted fictional-volume tests only; never a plugin or workspace configuration field. */
  readVolumeIdentity?: (path: string, device: string) => string | undefined
}
function readJson<T>(file: string, absent: () => T): T {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new ProfileStoreError('Shared Chrome metadata is not a regular file.')
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return absent()
    throw e
  }
}
const directoryStat = (p: string) => {
  try {
    const s = fs.lstatSync(p, { bigint: true })
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new ProfileStoreError('Profile folder identity changed.')
    return s
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}
const same = (a: FileIdentity | undefined, b: FileIdentity | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.volume === b.volume &&
  a.uid === b.uid &&
  a.mode === b.mode &&
  a.birthtime === b.birthtime &&
  a.type === b.type
/** A successful complete process listing AND absent native lock is required for an ended proof.
 * Inspection errors and a native lock with no provable owner remain unknown. */
export function inspectChrome(
  dir: string,
  inspection: { platform?: NodeJS.Platform; list?: () => string | null } = {},
): ChromeState {
  try {
    const win = (inspection.platform ?? process.platform) === 'win32'
    const text = inspection.list
      ? inspection.list()
      : execFileSync(
          win ? 'powershell' : 'ps',
          win
            ? ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LIST_SCRIPT]
            : ['-axo', 'pid=,command='],
          { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        )
    if (!text?.trim()) return 'unknown'
    let listing: string
    if (win) {
      const processes = parseCimRows(text)
      if (!processes?.length) return 'unknown'
      // CIM withholds command lines for system/other-user processes. A name can identify a
      // non-browser; an unreadable browser or unidentified row never proves Chrome has ended.
      if (
        processes.some(
          (p) => !p.command && (!p.name || BROWSER_EXE.test(path.win32.basename(p.name))),
        )
      )
        return 'unknown'
      listing = processes
        .filter((p) => p.command)
        .map((p) => `${p.pid} ${p.command.replace(/\s+/g, ' ')}`)
        .join('\n')
    } else {
      listing = text
      const rows = listing.split(/\r?\n/).filter((line) => line.trim())
      if (!rows.length || rows.some((line) => !/^\s*\d+\s+\S/.test(line))) return 'unknown'
    }
    if (browserProcessesOf(listing, dir, win ? 'win32' : process.platform).length) return 'live'
    const normalized = win ? listing.toLowerCase() : listing
    const target = win ? dir.toLowerCase() : dir
    // Readable commands are checked without guessing the browser executable name. Any process
    // mentioning the exact profile directory keeps it excluded, including wrappers and renamed Chrome.
    if (normalized.includes(target)) return 'unknown'
    for (const name of ['SingletonLock', 'lockfile']) {
      try {
        fs.lstatSync(path.join(dir, name))
        if (win && name === 'lockfile') {
          const fd = fs.openSync(path.join(dir, name), 'r+')
          fs.closeSync(fd)
          continue
        }
        if (!win && name === 'SingletonLock') {
          const target = fs.readlinkSync(path.join(dir, name))
          const match = /-(\d+)$/.exec(target)
          if (match) {
            try {
              process.kill(Number(match[1]), 0)
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === 'ESRCH') continue
            }
          }
        }
        return 'unknown'
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return 'unknown'
      }
    }
    return 'ended'
  } catch {
    return 'unknown'
  }
}
const displayLabel = (s: string) =>
  Array.from(
    s
      .normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, 80)
    .join('') || 'another'
export function createSharedProfileStore(
  o: SharedStoreOptions,
): ProfileStore & { shared: SharedProfileAccess } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(o.workspaceId) || !path.isAbsolute(o.shared))
    throw new ProfileStoreError('Shared Chrome workspace identity is invalid.')
  privateFolder(o.shared, o.shared)
  const profilesDir = privateFolder(o.shared, path.join(o.shared, 'profiles'), true)
  // Nested synchronous reads share one native observation per device. Every outer public
  // operation starts and ends empty; lease callbacks outside an operation read afresh.
  let operationDepth = 0
  const volumes = new Map<string, string | undefined>()
  const fileIdentity = (p: string): FileIdentity | undefined => {
    const s = directoryStat(p)
    if (!s) return undefined
    const dev = String(s.dev)
    if (!volumes.has(dev)) volumes.set(dev, (o.readVolumeIdentity ?? readVolumeIdentity)(p, dev))
    const volume = volumes.get(dev)
    if (volume !== undefined && !/^(apfs:[a-f0-9-]{36}|winvol:[0-9]+)$/.test(volume))
      throw new ProfileStoreError('Profile folder identity changed.')
    const after = directoryStat(p)
    if (
      !after ||
      s.dev !== after.dev ||
      s.ino !== after.ino ||
      s.uid !== after.uid ||
      s.mode !== after.mode
    )
      throw new ProfileStoreError('Profile folder identity changed.')
    return {
      dev,
      ino: String(s.ino),
      ...(volume ? { volume } : {}),
      uid: String(s.uid),
      mode: String(s.mode),
      birthtime: String(s.birthtimeNs),
      type: 'directory',
    }
  }
  // createProfileStore enforces the home mode. Observe it first so that enforcement cannot
  // accidentally hide a changed mode on a previously bound migration home.
  const initialHome = fileIdentity(o.home)
  const owner = o.processIdentity ?? identity()
  const alive = o.ownerState ?? ownerState
  const chrome = o.chromeState ?? inspectChrome
  const runId = randomUUID()
  const label = displayLabel(o.workspaceLabel)
  const file = path.join(o.shared, 'registry.json')
  const now = () => (o.now?.() ?? new Date()).toISOString()
  const read = (): Registry => {
    if (operationDepth === 0) volumes.clear()
    const r = readJson<Registry>(file, () => ({
      format: 1,
      revision: 0,
      workspaces: {},
      profiles: [],
    }))
    if (
      !r ||
      !Number.isSafeInteger(r.format) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 0 ||
      !r.workspaces ||
      typeof r.workspaces !== 'object' ||
      !Array.isArray(r.profiles)
    )
      throw new ProfileStoreError('Shared Chrome registry is invalid.')
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const p of r.profiles) {
      if (
        !p ||
        !isProfileName(p.name) ||
        (p.displayName !== undefined &&
          (typeof p.displayName !== 'string' ||
            checkDisplayName(p.displayName) !== p.displayName)) ||
        typeof p.id !== 'string' ||
        ids.has(p.id) ||
        names.has(p.name) ||
        !p.perWorkspace ||
        typeof p.perWorkspace !== 'object'
      )
        throw new ProfileStoreError('Shared Chrome registry is invalid.')
      ids.add(p.id)
      names.add(p.name)
    }
    return r
  }
  const initialRegistry = read()
  if (
    process.platform !== 'win32' &&
    initialRegistry.format === 1 &&
    initialRegistry.profiles.some((p) => p.migration?.workspaceId === o.workspaceId) &&
    (!initialHome ||
      initialHome.uid !== String(process.getuid!()) ||
      initialHome.mode !== String(0o40700))
  )
    throw new ProfileStoreError('Profile folder identity changed.')
  const local = createProfileStore({ home: o.home, now: o.now, scopedAuthorization: true })
  const write = (r: Registry) => {
    r.revision++
    durableJson(file, r)
  }
  const transaction = <T>(fn: (r: Registry) => T): T =>
    withSharedLock(o.shared, owner, () => {
      const r = read()
      if (r.format !== 1)
        throw new ProfileStoreError('Shared Chrome format requires a newer plugin.')
      if (r.revision >= Number.MAX_SAFE_INTEGER)
        throw new ProfileStoreError('Shared Chrome revision limit reached.')
      const result = fn(r)
      write(r)
      return result
    })
  const raw = (r: Registry, name: string): SharedRecord => {
    const p = r.profiles.find((p) => p.name === name)
    if (!p) throw new ProfileStoreError(`profile "${name}" does not exist`)
    return p
  }
  const supported = (p: SharedRecord, r: Registry) =>
    same(fileIdentity(sharedDir(p.name)), p.directory) &&
    r.format === 1 &&
    p.authorizationSchema === 1 &&
    Number.isSafeInteger(p.permissionRevision) &&
    p.permissionRevision >= 0 &&
    p.state === 'ready' &&
    typeof p.allowExtensions === 'boolean' &&
    typeof p.allowSync === 'boolean' &&
    typeof p.allowSettings === 'boolean' &&
    ['on', 'off', 'turning-on'].includes(p.helper) &&
    (p.perWorkspace[o.workspaceId] === undefined ||
      (typeof p.perWorkspace[o.workspaceId].enabled === 'boolean' &&
        typeof p.perWorkspace[o.workspaceId].keepRunning === 'boolean' &&
        (p.perWorkspace[o.workspaceId].accessEpoch === undefined ||
          (Number.isSafeInteger(p.perWorkspace[o.workspaceId].accessEpoch) &&
            Number(p.perWorkspace[o.workspaceId].accessEpoch) >= 0))))
  const effective = (p: SharedRecord, r: Registry): ProfileRecord => ({
    name: p.name,
    ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
    description: p.description,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    temporary: false,
    helper: p.helper,
    allowExtensions: p.allowExtensions === true,
    allowSettings: p.allowSettings === true,
    allowSync: p.allowSync === true,
    enabled: supported(p, r) && p.perWorkspace[o.workspaceId]?.enabled === true,
    keepRunning: supported(p, r) && p.perWorkspace[o.workspaceId]?.keepRunning === true,
  })
  const sharedDir = (name: string) => {
    if (!isProfileName(name)) throw new ProfileStoreError('Invalid profile name.')
    return privateFolder(profilesDir, path.join(profilesDir, name))
  }
  // One unambiguous namespace: local profiles always have a workspace-scoped facade name.
  const alias = (p: ProfileRecord) =>
    `local-${createHash('sha256').update(`${o.workspaceId}\0${p.name}\0${p.createdAt}`).digest('hex').slice(0, 20)}`
  const localRecord = (name: string) => local.list().find((p) => alias(p) === name)
  const localFallbackAllowed = (reservation: SharedRecord | undefined) =>
    !reservation ||
    (reservation.migration?.error === 'different-disk' &&
      same(reservation.migration.home, fileIdentity(o.home)))
  const migrationOf = (r: Registry, p: ProfileRecord) => {
    // A failed identity enrollment does not dissolve a reservation. Keep even an
    // unrecognized home fenced, and prefer any blocking reservation over a proven
    // different-disk fallback when duplicate legacy journals already exist.
    const reservations = r.profiles.filter(
      (s) => s.migration?.workspaceId === o.workspaceId && s.migration.sourceName === p.name,
    )
    return reservations.find((s) => !localFallbackAllowed(s)) ?? reservations[0]
  }
  const localAvailable = (p: ProfileRecord, r: Registry) => {
    if (!fileIdentity(local.dirOf(p.name)))
      throw new ProfileStoreError('Profile folder is missing; its name stays reserved.')
    const m = migrationOf(r, p)
    if (!localFallbackAllowed(m)) throw new ProfileStoreError('Profile migration is reserved.')
  }
  const localView = (p: ProfileRecord, r: Registry) => {
    const moving = migrationOf(r, p)
    return {
      ...p,
      name: alias(p),
      enabled: p.enabled && !!fileIdentity(local.dirOf(p.name)) && localFallbackAllowed(moving),
    }
  }
  const reboundReasons: string[] = []
  if (read().format === 1) {
    transaction((r) => {
      rebindVolumes(r)
      r.workspaces[o.workspaceId] = { ...r.workspaces[o.workspaceId], label, lastSeenAt: now() }
    })
    for (const reason of reboundReasons) console.warn(reason)
  }
  const mine = (): Lease => ({
    ...owner,
    token: randomUUID(),
    runId,
    workspaceId: o.workspaceId,
    label,
    startedAt: now(),
  })
  const stale = (lease: Lease | undefined, dir: string) =>
    !!lease && alive(lease) === 'gone' && chrome(dir) === 'ended'
  const onIn = (r: Registry, p: SharedRecord): string[] =>
    Object.entries(p.perWorkspace)
      .filter(([, v]) => v.enabled === true)
      .map(([id]) => {
        const w = r.workspaces[id]
        if (!w) return 'another workspace'
        return Date.parse(now()) - Date.parse(w.lastSeenAt) > 30 * 86400000
          ? `a workspace not opened since ${w.lastSeenAt.slice(0, 10)}`
          : displayLabel(w.label)
      })
      .sort()
  const confirmation = (r: Registry, p: SharedRecord) =>
    createHash('sha256')
      .update(JSON.stringify([p.id, r.revision, onIn(r, p)]))
      .digest('hex')
  const mutate = (name: string, update: (p: SharedRecord) => void): ProfileRecord =>
    transaction((r) => {
      const p = raw(r, name)
      if (!supported(p, r))
        throw new ProfileStoreError('Profile is reserved or requires a newer plugin.')
      update(p)
      return effective(p, r)
    })
  const migrationHolds = new Map<string, 'chrome-unknown'>()
  const pendingDisk = new Map<string, { release(): boolean | void }>()
  const admissionSnapshot = (name: string): SharedProfileAdmission => {
    const lp = localRecord(name)
    const r = read()
    if (lp) {
      localAvailable(lp, r)
      const p = localView(lp, r)
      if (!localFallbackAllowed(migrationOf(r, lp)))
        throw new ProfileStoreError('Profile migration is reserved.')
      return {
        profile: p,
        identity: `local:${alias(lp)}`,
        authorization: JSON.stringify([
          o.workspaceId,
          p.name,
          p.createdAt,
          p.authorizationEpoch ?? '',
          r.workspaces[o.workspaceId]?.authorizationEpoch ?? 0,
          p.enabled,
          p.allowExtensions,
          p.allowSettings,
          p.allowSync,
        ]),
      }
    }
    const p = raw(r, name)
    if (!supported(p, r))
      throw new ProfileStoreError('Profile is reserved or requires a newer plugin.')
    const profile = effective(p, r)
    return {
      profile,
      identity: `shared:${p.id}`,
      authorization: JSON.stringify([
        p.id,
        p.permissionRevision,
        p.perWorkspace[o.workspaceId]?.accessEpoch ?? 0,
        profile.enabled,
        p.allowExtensions,
        p.allowSettings,
        p.allowSync,
      ]),
    }
  }
  const shared: SharedProfileAccess = {
    acquire(name) {
      const pending = pendingDisk.get(name)
      if (pending && pending.release() !== false) pendingDisk.delete(name)
      const lp = localRecord(name)
      if (lp) {
        const r = read()
        localAvailable(lp, r)
        const moving = migrationOf(r, lp)
        if (!localFallbackAllowed(moving))
          throw new ProfileStoreError('Profile migration is reserved.')
        return { release() {} }
      }
      const previous = raw(read(), name).lease
      // Process inspection stays outside the metadata mutex; takeover compares this exact token.
      const reclaim = stale(previous, sharedDir(name))
      const lease = mine()
      transaction((r) => {
        const p = raw(r, name)
        if (!supported(p, r))
          throw new ProfileStoreError('Profile is reserved or requires a newer plugin.')
        if (p.lease && !(reclaim && p.lease.token === previous?.token))
          throw new ProfileInUseElsewhereError(p.lease.label)
        p.lease = lease
      })
      return {
        release() {
          if (chrome(sharedDir(name)) !== 'ended') return false
          transaction((r) => {
            const p = r.profiles.find((p) => p.name === name)
            if (p?.lease?.token === lease.token && p.lease.runId === runId) delete p.lease
          })
          return true
        },
      }
    },
    withDiskAccess(name, write, work) {
      const lp = localRecord(name)
      if (lp) {
        localAvailable(lp, read())
        return work()
      }
      const held = raw(read(), name).lease
      if (held && held.runId !== runId && !stale(held, sharedDir(name)))
        throw new ProfileInUseElsewhereError(held.label)
      // Reads may share this process's live browser. Writes always need a stopped Chrome
      // and a fresh reservation, including after our own browser has been closed.
      if (!write && held?.runId === runId) return work()
      if (chrome(sharedDir(name)) !== 'ended')
        throw new ProfileStoreError('Profile is in use or its Chrome state cannot be confirmed.')
      const lease = shared.acquire(name)
      try {
        return work()
      } finally {
        // Keep the exact handle before attempting publication: release can throw
        // after an I/O fault, and the same process must be able to retry it.
        pendingDisk.set(name, lease)
        if (lease.release() !== false) pendingDisk.delete(name)
      }
    },
    identity(name) {
      const lp = localRecord(name)
      if (lp) {
        localAvailable(lp, read())
        return `local:${alias(lp)}`
      }
      const r = read()
      const p = raw(r, name)
      if (!supported(p, r)) throw new ProfileStoreError('Profile is reserved.')
      return `shared:${p.id}`
    },
    resolveSaved(name, savedIdentity, legacy) {
      const r = read()
      const resolved = (p: SharedRecord | undefined) =>
        p && supported(p, r) ? { name: p.name, identity: `shared:${p.id}` } : undefined
      const migrated = (match: (m: Migration) => boolean) =>
        r.profiles.find(
          (p) =>
            p.migration?.workspaceId === o.workspaceId &&
            match(p.migration) &&
            same(p.migration.home, fileIdentity(o.home)),
        )
      if (savedIdentity?.startsWith('shared:'))
        return resolved(r.profiles.find((p) => p.id === savedIdentity.slice(7)))
      if (savedIdentity?.startsWith('local:')) {
        const sourceAlias = savedIdentity.slice(6)
        const p = migrated((m) => m.sourceAlias === sourceAlias)
        if (p) return resolved(p)
        const lp = localRecord(sourceAlias)
        return lp ? { name: alias(lp), identity: `local:${alias(lp)}` } : undefined
      }
      // Only unversioned local saves may use the legacy rename map. A new save
      // without its immutable identity is never guessed from an overlapping name.
      if (!legacy) return undefined
      const p = migrated((m) => m.sourceName === name || m.sourceAlias === name)
      if (p) return resolved(p)
      const lp = local.get(name) ?? localRecord(name)
      return lp
        ? { name: alias(lp), identity: `local:${alias(lp)}` }
        : resolved(r.profiles.find((p) => p.name === name))
    },
    admission: admissionSnapshot,
    authorization(name) {
      return admissionSnapshot(name).authorization
    },
    view(name) {
      const r = read()
      const lp = localRecord(name)
      if (lp)
        return {
          shared: false,
          migration: lp.temporary
            ? undefined
            : (migrationOf(r, lp)?.migration?.error ??
              migrationHolds.get(lp.name) ??
              'qualification-required'),
        }
      const p = raw(r, name)
      return {
        shared: true,
        profileId: p.id,
        globalRevision: r.revision,
        onIn: onIn(r, p),
        inUseIn: p.lease?.label,
        status: p.state,
        migratedFrom: p.migratedFrom,
        appliesAtNextLaunch: !!p.lease,
        deleteConfirmation: confirmation(r, p),
      }
    },
    confirmation(name) {
      const r = read()
      return confirmation(r, raw(r, name))
    },
    remove(name, expected) {
      const dir = sharedDir(name)
      if (chrome(dir) !== 'ended')
        throw new ProfileStoreError('Profile is in use or its Chrome state cannot be confirmed.')
      const previous = raw(read(), name).lease
      const reclaim = stale(previous, dir)
      const deletion = mine()
      let resuming = false
      transaction((r) => {
        const p = raw(r, name)
        if (confirmation(r, p) !== expected)
          throw new ProfileStoreError('Profile changed; review the current deletion warning again.')
        if (p.lease && !(reclaim && previous?.token === p.lease.token))
          throw new ProfileInUseElsewhereError(p.lease.label)
        if (
          p.state === 'moving' ||
          (p.state === 'deleting' &&
            p.deleteOwner &&
            p.deleteOwner.runId !== runId &&
            alive(p.deleteOwner) !== 'gone')
        )
          throw new ProfileStoreError('Profile is reserved.')
        resuming = p.state === 'deleting' && p.deleteOwner !== undefined
        // Both writes are the same durable registry transaction. No crash gap admits a launch.
        p.state = 'deleting'
        p.deleteOwner = deletion
        delete p.lease
      })
      const diskIdentity = fileIdentity(dir)
      if (diskIdentity ? !same(diskIdentity, raw(read(), name).directory) : !resuming)
        throw new ProfileStoreError('Profile folder identity changed.')
      // Long removal is outside the mutex. A failure leaves a visible, reserved tombstone.
      fs.rmSync(dir, { recursive: true, force: true })
      transaction((r) => {
        const p = raw(r, name)
        if (p.state !== 'deleting' || p.deleteOwner?.token !== deletion.token)
          throw new ProfileStoreError('Deletion ownership changed.')
        r.profiles = r.profiles.filter((q) => q.id !== p.id)
      })
    },
    restoreName(name) {
      const r = read()
      const p = r.profiles.find(
        (p) =>
          p.state === 'ready' &&
          p.migration?.workspaceId === o.workspaceId &&
          (p.migration.sourceName === name || p.migration.sourceAlias === name) &&
          same(p.migration.home, fileIdentity(o.home)),
      )
      if (p) return p.name
      const lp = local.get(name)
      return lp ? alias(lp) : name
    },
  }
  const facade: ProfileStore & { shared: SharedProfileAccess } = {
    shared,
    list() {
      const r = read()
      return [
        ...r.profiles.map((p) => effective(p, r)),
        ...local.list().map((p) => localView(p, r)),
      ]
    },
    get(name) {
      return facade.list().find((p) => p.name === name)
    },
    dirOf(name) {
      const lp = localRecord(name)
      if (lp) {
        localAvailable(lp, read())
        const p = migrationOf(read(), lp)
        if (!localFallbackAllowed(p)) throw new ProfileStoreError('Profile migration is reserved.')
        return local.dirOf(lp.name)
      }
      const r = read()
      if (raw(r, name).state === 'deleting') return sharedDir(name)
      if (!supported(raw(r, name), r))
        throw new ProfileStoreError('Profile is reserved or requires a newer plugin.')
      return sharedDir(name)
    },
    create(name, createdBy, opts = {}) {
      if (!isProfileName(name) || name.startsWith('local-'))
        throw new ProfileStoreError('Profile name is invalid or reserved.')
      return transaction((r) => {
        if (
          r.profiles.some((p) => p.name === name) ||
          local.list().some((p) => p.name === name || alias(p) === name)
        )
          throw new ProfileStoreError(`profile "${name}" already exists`)
        if (opts.temporary) {
          const p = local.create(name, createdBy, opts)
          return localView(p, r)
        }
        const dir = sharedDir(name)
        if (fileIdentity(dir)) throw new ProfileStoreError('Profile folder is already reserved.')
        const p: SharedRecord = {
          id: randomUUID(),
          directory: { dev: '0', ino: '0' },
          permissionRevision: 0,
          authorizationSchema: 1,
          state: 'ready',
          name,
          createdBy,
          createdAt: now(),
          description: checkDescription(opts.description ?? ''),
          temporary: false,
          allowSync: true,
          allowExtensions: true,
          allowSettings: false,
          helper: 'on',
          perWorkspace: { [o.workspaceId]: { enabled: true, keepRunning: false } },
        }
        privateFolder(profilesDir, dir, true)
        p.directory = fileIdentity(dir)!
        r.profiles.push(p)
        return effective(p, r)
      })
    },
    setFlags(name, flags) {
      const lp = localRecord(name)
      if (lp)
        return transaction((r) => {
          localAvailable(lp, r)
          r.workspaces[o.workspaceId].authorizationEpoch =
            Number(r.workspaces[o.workspaceId].authorizationEpoch ?? 0) + 1
          return localView(local.setFlags(lp.name, flags), r)
        })
      return mutate(name, (p) => {
        for (const f of FLAG_NAMES)
          if (typeof flags[f] === 'boolean') {
            if (f === 'enabled' || f === 'keepRunning')
              p.perWorkspace[o.workspaceId] = {
                ...p.perWorkspace[o.workspaceId],
                enabled: p.perWorkspace[o.workspaceId]?.enabled === true,
                keepRunning: p.perWorkspace[o.workspaceId]?.keepRunning === true,
                accessEpoch: Number(p.perWorkspace[o.workspaceId]?.accessEpoch ?? 0) + 1,
                [f]: flags[f],
              }
            else {
              p.permissionRevision++
              p[f] = flags[f]!
            }
          }
      })
    },
    setHelper(name, helper: HelperSwitch) {
      const lp = localRecord(name)
      return lp
        ? transaction((r) => {
            localAvailable(lp, r)
            return localView(local.setHelper(lp.name, helper), r)
          })
        : mutate(name, (p) => {
            p.helper = helper
          })
    },
    rename(name, newName) {
      const text = checkDisplayName(newName)
      return transaction((r) => {
        const lp = localRecord(name)
        const records = [
          ...r.profiles.map((p) => effective(p, r)),
          ...local.list().map((p) => localView(p, r)),
        ]
        if (lp) {
          if (lp.deleting) throw new ProfileStoreError(RENAME_ERRORS.deleting)
          localAvailable(lp, r)
          checkDisplayNameAvailable(records, name, text)
          return localView(local.rename(lp.name, text), r)
        }
        const p = raw(r, name)
        if (p.state === 'deleting') throw new ProfileStoreError(RENAME_ERRORS.deleting)
        if (!supported(p, r))
          throw new ProfileStoreError('Profile is reserved or requires a newer plugin.')
        checkDisplayNameAvailable(records, name, text)
        p.displayName = text
        return effective(p, r)
      })
    },
    setDescription(name, description) {
      const text = checkDescription(description)
      const lp = localRecord(name)
      return lp
        ? transaction((r) => {
            localAvailable(lp, r)
            return localView(local.setDescription(lp.name, text), r)
          })
        : mutate(name, (p) => {
            p.description = text
          })
    },
    remove(name) {
      const lp = localRecord(name)
      if (lp) {
        transaction((r) => {
          localAvailable(lp, r)
          local.remove(lp.name)
        })
        return
      }
      throw new ProfileStoreError('A fresh global deletion confirmation is required.')
    },
  }
  if (o.migrationApproved && read().format === 1) migrate()
  for (const api of [shared, facade]) {
    for (const key of Object.keys(api)) {
      const method = Reflect.get(api, key)
      if (typeof method !== 'function') continue
      Reflect.set(api, key, function (this: unknown, ...args: unknown[]) {
        const outer = operationDepth === 0
        if (outer) volumes.clear()
        operationDepth++
        try {
          return Reflect.apply(method, this, args)
        } finally {
          operationDepth--
          if (outer) volumes.clear()
        }
      })
    }
  }
  volumes.clear()
  return facade
  function rebindVolumes(r: Registry) {
    const eligible = (saved: FileIdentity, current: FileIdentity | undefined) =>
      !!saved &&
      !!current &&
      /^[0-9]+$/.test(saved.dev) &&
      /^[0-9]+$/.test(saved.ino) &&
      saved.ino === current.ino &&
      (saved.type === undefined || saved.type === current.type) &&
      (saved.uid === undefined
        ? current.uid === String(process.getuid?.() ?? 0)
        : saved.uid === current.uid) &&
      (saved.mode === undefined
        ? process.platform === 'win32' || current.mode === String(0o40700)
        : saved.mode === current.mode) &&
      (saved.birthtime === undefined || saved.birthtime === current.birthtime) &&
      (saved.volume === undefined || saved.volume === current.volume) &&
      (saved.dev === current.dev || current.volume?.startsWith('apfs:') === true)
    for (const p of r.profiles) {
      if (p.authorizationSchema !== 1 || !['ready', 'moving', 'deleting'].includes(p.state))
        continue
      try {
        const destination = sharedDir(p.name)
        const migration = p.migration
        let source: string | undefined
        if (migration?.workspaceId === o.workspaceId) source = local.dirOf(migration.sourceName)
        const directoryPath =
          p.state === 'moving' && source && fileIdentity(source) ? source : destination
        const candidates: Array<{
          saved: FileIdentity
          current: FileIdentity | undefined
          path: string
        }> = [{ saved: p.directory, current: fileIdentity(directoryPath), path: directoryPath }]
        if (migration) {
          // A moved/retired journal's source inode is now at the destination. No Chrome data
          // is copied or read; this is the original rename-only migration identity.
          const sourcePath = source && fileIdentity(source) ? source : destination
          candidates.push({
            saved: migration.source,
            current: fileIdentity(sourcePath),
            path: sourcePath,
          })
          if (migration.workspaceId === o.workspaceId)
            candidates.push({ saved: migration.home, current: initialHome, path: o.home })
        }
        if (candidates.some((c) => !eligible(c.saved, c.current))) continue
        volumes.clear()
        if (candidates.some((c) => !same(c.current, fileIdentity(c.path)))) continue
        // The explicit proportionate-security decision accepts a legacy same-path clone
        // or restore with matching inode/private ownership. Its current UUID is enrolled
        // once; an already anchored volume mismatch is never accepted.
        for (const { saved, current } of candidates) {
          if (same(saved, current)) continue
          const renumbered = saved.dev !== current!.dev
          Object.assign(saved, current)
          reboundReasons.push(
            renumbered ? 'rebound after device renumbering' : 'recorded durable volume identity',
          )
        }
      } catch {
        // Leave the exact profile/journal identities alone. Existing admission remains closed.
      }
    }
  }
  function migrate() {
    // Only the released platform signal reaches here; tests opt in on fictional folders.
    const homeId = fileIdentity(o.home)!
    for (const lp of local.list().filter((p) => !p.temporary && !p.deleting)) {
      if (migrationOf(read(), lp)) continue
      const source = local.dirOf(lp.name)
      const sourceId = fileIdentity(source)
      if (!sourceId) continue
      const state = chrome(source)
      if (state !== 'ended') {
        if (state === 'unknown') migrationHolds.set(lp.name, 'chrome-unknown')
        continue
      }
      transaction((r) => {
        if (migrationOf(r, lp)) return
        const baseName = lp.name.startsWith('local-')
          ? `migrated-${createHash('sha256').update(lp.name).digest('hex').slice(0, 16)}`
          : lp.name
        let name = baseName
        let n = 1
        while (
          name.startsWith('local-') ||
          r.profiles.some((p) => p.name === name) ||
          fileIdentity(sharedDir(name))
        ) {
          const suffix = `-${createHash('sha256').update(o.workspaceId).digest('hex').slice(0, 6)}-${n++}`
          name = baseName.slice(0, 32 - suffix.length) + suffix
        }
        const { enabled, keepRunning, authorizationEpoch: _localEpoch, ...global } = lp
        void _localEpoch
        r.profiles.push({
          ...global,
          name,
          id: randomUUID(),
          directory: sourceId,
          permissionRevision: 0,
          authorizationSchema: 1,
          state: 'moving',
          migratedFrom: lp.name,
          perWorkspace: { [o.workspaceId]: { enabled, keepRunning } },
          migration: {
            id: randomUUID(),
            workspaceId: o.workspaceId,
            sourceName: lp.name,
            sourceAlias: alias(lp),
            home: homeId,
            source: sourceId,
            phase: 'reserved',
            owner: mine(),
          },
        })
      })
      o.checkpoint?.('reserved')
    }
    for (const snapshot of read().profiles.filter(
      (p) =>
        p.state === 'moving' &&
        p.migration?.workspaceId === o.workspaceId &&
        same(p.migration.home, homeId),
    )) {
      const journal = snapshot.migration!
      const source = local.dirOf(journal.sourceName)
      const destination = sharedDir(snapshot.name)
      const sameOwner = (a: Lease, b: Lease) =>
        a.token === b.token &&
        a.workspaceId === b.workspaceId &&
        a.runId === b.runId &&
        a.pid === b.pid &&
        a.birth === b.birth &&
        a.label === b.label &&
        a.startedAt === b.startedAt
      // Unknown inspection must not strand an untouched local account behind our reservation.
      // Never withdraw a moved/ambiguous journal or another live owner's authority.
      const withdrawUnknown = (expectedOwner: Lease): boolean => {
        if (expectedOwner.runId !== runId && alive(expectedOwner) !== 'gone') return false
        const withdrawn = transaction((r) => {
          const index = r.profiles.findIndex(
            (p) => p.id === snapshot.id && p.name === snapshot.name,
          )
          if (index < 0) return false
          const p = r.profiles[index]
          const m = p.migration
          if (
            p.state !== 'moving' ||
            p.authorizationSchema !== 1 ||
            !same(p.directory, journal.source) ||
            !m ||
            m.phase !== 'reserved' ||
            m.error ||
            p.lease ||
            m.id !== journal.id ||
            m.workspaceId !== o.workspaceId ||
            m.workspaceId !== journal.workspaceId ||
            m.sourceAlias !== journal.sourceAlias ||
            m.sourceName !== journal.sourceName ||
            !same(m.source, journal.source) ||
            !same(m.home, journal.home) ||
            !sameOwner(m.owner, expectedOwner) ||
            !same(fileIdentity(o.home), journal.home) ||
            !same(fileIdentity(source), journal.source) ||
            fileIdentity(destination)
          )
            return false
          const localProfile = local.get(journal.sourceName)
          if (
            !localProfile ||
            localProfile.deleting ||
            localProfile.temporary ||
            localProfile.createdAt !== snapshot.createdAt ||
            (m.sourceAlias && alias(localProfile) !== m.sourceAlias)
          )
            return false
          r.profiles.splice(index, 1)
          return true
        })
        if (withdrawn) migrationHolds.set(journal.sourceName, 'chrome-unknown')
        return withdrawn
      }
      const recoveryChrome = chrome(destination)
      if (recoveryChrome === 'unknown') {
        withdrawUnknown(journal.owner)
        // A refused withdrawal must never fall through and replace changed authority.
        continue
      }
      const claimable =
        journal.owner.runId === runId ||
        (recoveryChrome === 'ended' && alive(journal.owner) === 'gone')
      if (!claimable) continue
      const claimed = transaction((r) => {
        const p = raw(r, snapshot.name)
        const m = p.migration
        // Inspection/liveness happened outside this transaction. Revalidate the complete
        // observed journal and owner before acquiring authority, even for this run.
        if (
          p.id !== snapshot.id ||
          p.state !== 'moving' ||
          p.authorizationSchema !== 1 ||
          p.lease ||
          !same(p.directory, snapshot.directory) ||
          !m ||
          m.id !== journal.id ||
          m.phase !== journal.phase ||
          m.error !== journal.error ||
          m.workspaceId !== journal.workspaceId ||
          m.sourceName !== journal.sourceName ||
          m.sourceAlias !== journal.sourceAlias ||
          !same(m.home, journal.home) ||
          !same(m.source, journal.source) ||
          !sameOwner(m.owner, journal.owner)
        )
          return false
        m.owner = mine()
        return m.owner
      })
      if (!claimed) continue
      const migrationWrite = (apply: (p: SharedRecord) => void) =>
        transaction((r) => {
          const p = raw(r, snapshot.name)
          if (p.migration?.id !== journal.id || !sameOwner(p.migration.owner, claimed))
            throw new ProfileStoreError('Migration ownership changed.')
          apply(p)
        })
      const src = fileIdentity(source)
      const dst = fileIdentity(destination)
      if (
        (src && dst) ||
        (!src && !dst) ||
        (src && !same(src, journal.source)) ||
        (dst && !same(dst, journal.source))
      ) {
        migrationWrite((p) => {
          p.migration!.error = 'folder-identity-conflict'
        })
        continue
      }
      if (src) {
        const sourceState = chrome(source)
        if (sourceState !== 'ended') {
          if (sourceState === 'unknown') withdrawUnknown(claimed)
          continue
        }
        try {
          ;(o.rename ?? fs.renameSync)(source, destination)
          if (process.platform !== 'win32')
            for (const parent of [path.dirname(source), path.dirname(destination)]) {
              const fd = fs.openSync(parent, 'r')
              try {
                fs.fsyncSync(fd)
              } finally {
                fs.closeSync(fd)
              }
            }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            migrationWrite((p) => {
              p.migration!.error = 'different-disk'
            })
            continue
          }
          throw e
        }
        o.checkpoint?.('renamed')
      }
      if (!same(fileIdentity(destination), journal.source))
        throw new ProfileStoreError('Migration destination identity changed.')
      migrationWrite((p) => {
        p.migration!.phase = 'moved'
        delete p.migration!.error
      })
      o.checkpoint?.('moved')
      // Retire local metadata durably; Chrome data is never read, copied, rebuilt, or deleted.
      migrationWrite(() => {
        const localFile = path.join(o.home, 'profiles.json')
        const data = readJson<{ profiles: ProfileRecord[]; [key: string]: unknown }>(
          localFile,
          () => ({ profiles: [] }),
        )
        data.profiles = data.profiles.filter((p) => p.name !== journal.sourceName)
        durableJson(localFile, data)
        o.checkpoint?.('local-retired')
        const retiredFile = path.join(o.home, 'shared-retired.json')
        const retired = readJson<Record<string, unknown>>(retiredFile, () => ({}))
        retired[journal.sourceName] = {
          profileId: snapshot.id,
          migrationId: journal.id,
          name: snapshot.name,
        }
        durableJson(retiredFile, retired)
      })
      o.checkpoint?.('retired')
      migrationWrite((p) => {
        p.migration!.phase = 'retired'
        p.state = 'ready'
      })
      o.checkpoint?.('ready')
    }
  }
}
