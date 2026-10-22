import { link, lstat, mkdir, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { BigIntStats } from 'node:fs'
import { providerValue, type Provider } from '@brobot2/shared'
import type { TranscriptRetention } from '../shared/transcript-retention'
import { PROVIDER_HOMES_DIRNAME } from './runtime/provider-homes'

const DAY = 86_400_000
interface Entry {
  readonly path: string
  readonly stat: BigIntStats
  readonly directory: boolean
}
export interface TranscriptToClear {
  readonly home: string
  readonly provider: Provider
  readonly session: string
  readonly file: string
  readonly directory: string | null
  readonly cutoff: number
  readonly entries: readonly Entry[]
}
export interface TranscriptClearList {
  readonly root: string
  readonly rootIdentity: BigIntStats | null
  readonly entries: readonly TranscriptToClear[]
}
export interface TranscriptClearBatch extends TranscriptClearList {
  /** The last examined name; a later start can resume after a completed batch. */
  readonly through: string
}
export type ProviderHomeInUse = (home: string, provider: Provider) => boolean
const SCAN_BATCH_SIZE = 4
const scanKey = (root: string, path: string) => relative(root, path).split(sep).join('/')
const compareScanKeys = (one: string, two: string): number => {
  const left = one.split('/')
  const right = two.split('/')
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index]! < right[index]!) return -1
    if (left[index]! > right[index]!) return 1
  }
  return Math.sign(left.length - right.length)
}

async function plainDirectory(path: string): Promise<boolean> {
  try {
    const s = await lstat(path)
    return s.isDirectory() && !s.isSymbolicLink()
  } catch {
    return false
  }
}
async function* children(
  path: string,
  includes: (child: string) => boolean = () => true,
): AsyncGenerator<string> {
  if (!(await plainDirectory(path))) return
  const canonical = await realpath(path)
  for (const name of (await readdir(canonical)).sort()) {
    const child = join(canonical, name)
    if (!includes(child)) continue
    yield child
    await setImmediate()
  }
}
async function ownedRoot(userData: string): Promise<string | null> {
  try {
    const root = join(await realpath(userData), PROVIDER_HOMES_DIRNAME)
    return (await plainDirectory(root)) ? await realpath(root) : null
  } catch {
    return null
  }
}
async function inside(root: string, path: string): Promise<boolean> {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || resolve(root, rel) !== path) return false
  let parent = dirname(path)
  while (parent !== root) {
    if (!(await plainDirectory(parent))) return false
    const next = dirname(parent)
    if (next === parent) return false
    parent = next
  }
  return (await plainDirectory(root)) && (await realpath(path)) === path
}
async function describe(path: string, cutoff: number, depth = 0): Promise<Entry[] | null> {
  if (depth > 32) return null
  try {
    const stat = await lstat(path, { bigint: true })
    if (stat.isSymbolicLink() || stat.mtimeNs >= BigInt(cutoff) * 1_000_000n) return null
    if (stat.isFile()) return [{ path, stat, directory: false }]
    if (!stat.isDirectory()) return null
    const entries: Entry[] = []
    for await (const child of children(path)) {
      const read = await describe(child, cutoff, depth + 1)
      if (read === null || entries.length + read.length > 10_000) return null
      entries.push(...read)
    }
    entries.push({ path, stat, directory: true })
    return entries
  } catch {
    return null
  }
}

async function* scannedFiles(
  root: string,
  period: TranscriptRetention,
  now: number,
  inUse: ProviderHomeInUse,
  after: string,
  before: string,
): AsyncGenerator<{ path: string; candidate: TranscriptToClear | null }> {
  const cutoff = now - (period as number) * DAY
  const overlaps = (path: string): boolean => {
    const key = scanKey(root, path)
    return (
      (compareScanKeys(key, after) >= 0 || after.startsWith(`${key}/`)) &&
      (before === '' || compareScanKeys(key, before) <= 0)
    )
  }
  const scanChildren = (path: string) => children(path, overlaps)
  for await (const workspace of scanChildren(root))
    for await (const profile of scanChildren(workspace)) {
      for (const provider of ['claude', 'codex'] as const) {
        const home = join(profile, provider)
        if (!overlaps(home) || inUse(home, provider) || !(await plainDirectory(home))) continue
        const add = async (
          file: string,
          session: string,
          directory: string | null,
        ): Promise<TranscriptToClear | null> => {
          if (inUse(home, provider) || !(await inside(root, file))) return null
          const transcript = await describe(file, cutoff)
          if (transcript === null || transcript.length !== 1 || transcript[0]!.directory)
            return null
          let accompanying: Entry[] = []
          if (directory !== null) {
            try {
              await lstat(directory)
              if (!(await inside(root, directory))) return null
              const read = await describe(directory, cutoff)
              if (read === null) return null
              accompanying = read
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
            }
          }
          return {
            home,
            provider,
            session,
            file,
            directory,
            cutoff,
            entries: [...accompanying, ...transcript],
          }
        }
        const considered = (path: string) => {
          const key = scanKey(root, path)
          return (
            compareScanKeys(key, after) > 0 && (before === '' || compareScanKeys(key, before) <= 0)
          )
        }
        if (providerValue(provider, { claude: true, codex: false })) {
          for await (const project of scanChildren(join(home, 'projects'))) {
            if (!(await plainDirectory(project))) continue
            for await (const file of scanChildren(project)) {
              if (!considered(file)) continue
              const match = /^([a-zA-Z0-9_-]{1,200})\.jsonl$/.exec(basename(file))
              yield {
                path: file,
                candidate: match ? await add(file, match[1]!, join(project, match[1]!)) : null,
              }
            }
          }
        } else {
          const walk = async function* (
            path: string,
            depth = 0,
          ): AsyncGenerator<{ path: string; candidate: TranscriptToClear | null }> {
            if (depth > 8) return
            for await (const file of scanChildren(path)) {
              const match =
                /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
                  basename(file),
                )
              if (considered(file))
                yield { path: file, candidate: match ? await add(file, match[1]!, null) : null }
              if (!match && (await plainDirectory(file))) yield* walk(file, depth + 1)
            }
          }
          yield* walk(join(home, 'sessions'))
        }
      }
    }
}

async function* batchesAtRoot(
  root: string,
  rootIdentity: BigIntStats,
  period: TranscriptRetention,
  now: number,
  inUse: ProviderHomeInUse,
  after: string,
  before: string,
  maxBatchAgeMs: number,
): AsyncGenerator<TranscriptClearBatch> {
  let examined: { path: string; candidate: TranscriptToClear | null }[] = []
  let beganAt = performance.now()
  const batch = (): TranscriptClearBatch => ({
    root,
    rootIdentity,
    through: scanKey(root, examined[examined.length - 1]!.path),
    entries: examined
      .flatMap(({ candidate }) => (candidate === null ? [] : [candidate]))
      .sort((a, b) => {
        const ageA = a.entries.find((entry) => entry.path === a.file)!.stat.mtimeNs
        const ageB = b.entries.find((entry) => entry.path === b.file)!.stat.mtimeNs
        return ageA < ageB ? -1 : ageA > ageB ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0
      }),
  })
  for await (const one of scannedFiles(root, period, now, inUse, after, before)) {
    examined.push(one)
    if (examined.length < SCAN_BATCH_SIZE && performance.now() - beganAt < maxBatchAgeMs) continue
    yield batch()
    examined = []
    beganAt = performance.now()
  }
  if (examined.length > 0) yield batch()
}

/** Yield bounded, deterministic batches so a slow scan can still delete before the deadline. */
export async function* batchesToClear(
  userData: string,
  period: TranscriptRetention,
  now: number,
  inUse: ProviderHomeInUse,
  after = '',
  before = '',
  maxBatchAgeMs = 1_000,
): AsyncGenerator<TranscriptClearBatch> {
  if (period === 'forever') return
  const root = await ownedRoot(userData)
  if (root === null) return
  const rootIdentity = await lstat(root, { bigint: true })
  yield* batchesAtRoot(root, rootIdentity, period, now, inUse, after, before, maxBatchAgeMs)
}

/** Decide from names and ages only. Nothing outside this workspace's managed homes is listed. */
export async function whatToClear(
  userData: string,
  period: TranscriptRetention,
  now: number,
  inUse: ProviderHomeInUse,
): Promise<TranscriptClearList> {
  if (period === 'forever') return { root: '', rootIdentity: null, entries: [] }
  const root = await ownedRoot(userData)
  if (root === null) return { root: '', rootIdentity: null, entries: [] }
  const rootIdentity = await lstat(root, { bigint: true })
  const entries: TranscriptToClear[] = []
  for await (const batch of batchesAtRoot(root, rootIdentity, period, now, inUse, '', '', Infinity))
    entries.push(...batch.entries)
  return { root, rootIdentity, entries }
}

/** Recheck the same files and live ownership before deleting; changed or uncertain files stay. */
export async function clearTranscripts(
  list: TranscriptClearList,
  inUse: ProviderHomeInUse,
  current: () => boolean = () => true,
): Promise<{ conversations: number; bytes: number; stopped?: true }> {
  let conversations = 0
  let bytes = 0
  let staging: { path: string; identity: BigIntStats } | null = null
  const rootIsSame = async () =>
    list.rootIdentity !== null &&
    sameIdentity(await lstat(list.root, { bigint: true }), list.rootIdentity)
  const stageIsSame = async () =>
    staging !== null &&
    (await rootIsSame()) &&
    (await inside(list.root, staging.path)) &&
    sameIdentity(await lstat(staging.path, { bigint: true }), staging.identity)
  try {
    for (const candidate of list.entries) {
      await setImmediate()
      if (!current()) break
      if (inUse(candidate.home, candidate.provider)) continue
      let valid = true
      for (const entry of candidate.entries) {
        try {
          if (!(await inside(list.root, entry.path))) {
            valid = false
            break
          }
          const stat = await lstat(entry.path, { bigint: true })
          if (!sameSnapshot(stat, entry.stat)) {
            valid = false
            break
          }
          if (entry.directory) {
            const names: string[] = []
            for await (const child of children(entry.path)) names.push(child)
            const expected = candidate.entries
              .filter((one) => dirname(one.path) === entry.path)
              .map((one) => one.path)
            if (
              names.length !== expected.length ||
              names.some((name) => !expected.includes(name))
            ) {
              valid = false
              break
            }
          }
        } catch {
          valid = false
          break
        }
      }
      if (!valid || !current() || inUse(candidate.home, candidate.provider)) continue
      for (const entry of candidate.entries) {
        if (!current() || inUse(candidate.home, candidate.provider)) break
        // Empty accompanying directories stay; no pathname-based recursive removal is needed.
        if (entry.directory) continue
        if (!(await inside(list.root, entry.path))) break
        if (staging === null) {
          if (!(await rootIsSame())) throw new Error('The managed transcript root changed.')
          const path = join(list.root, `.transcript-cleanup-${randomUUID()}`)
          await mkdir(path, { mode: 0o700 })
          staging = { path, identity: await lstat(path, { bigint: true }) }
        }
        if (!(await stageIsSame())) throw new Error('The transcript staging directory changed.')
        const moved = join(staging.path, randomUUID())
        if (!current() || inUse(candidate.home, candidate.provider))
          return { conversations, bytes, stopped: true }
        await rename(entry.path, moved)
        let verified = false
        let verificationFailure: unknown
        try {
          verified =
            (await stageIsSame()) && sameSnapshot(await lstat(moved, { bigint: true }), entry.stat)
          if (verified && (!current() || inUse(candidate.home, candidate.provider))) {
            verified = false
            verificationFailure = new Error('The app started work or cleanup stopped.')
          }
        } catch (error) {
          verificationFailure = error
        }
        if (!verified) {
          // Hard-link restoration is exclusive: a new source file is never overwritten.
          // The staging name is removed only after the original name holds that exact inode.
          if (!(await stageIsSame())) throw new Error(`A moved transcript is retained at ${moved}.`)
          const identity = await lstat(moved, { bigint: true })
          if (!identity.isFile()) throw new Error(`A changed transcript is retained at ${moved}.`)
          try {
            await link(moved, entry.path)
            if (!sameIdentity(await lstat(entry.path, { bigint: true }), identity))
              throw new Error('The restored transcript identity changed.')
            await unlink(moved)
          } catch (cause) {
            throw new Error(`A moved transcript is retained at ${moved}.`, { cause })
          }
          throw verificationFailure ?? new Error('A moved transcript changed; it was put back.')
        }
        await unlink(moved)
        bytes += Number(entry.stat.size)
        if (entry.path === candidate.file) conversations++
      }
    }
    return { conversations, bytes }
  } catch (error) {
    console.warn('Transcript cleanup stopped without deleting the changed file.', error)
    return { conversations, bytes, stopped: true }
  } finally {
    // Only our own empty staging directory may be removed. Uncertain contents remain recoverable.
    try {
      if (staging !== null && (await stageIsSame())) await rmdir(staging.path)
    } catch {
      /* A nonempty or changed directory stays. */
    }
  }
}

function sameIdentity(one: BigIntStats, other: BigIntStats): boolean {
  return !one.isSymbolicLink() && one.ino !== 0n && one.dev === other.dev && one.ino === other.ino
}
function sameSnapshot(one: BigIntStats, other: BigIntStats): boolean {
  return (
    sameIdentity(one, other) &&
    one.isFile() === other.isFile() &&
    one.isDirectory() === other.isDirectory() &&
    one.size === other.size &&
    one.mtimeNs === other.mtimeNs
  )
}
