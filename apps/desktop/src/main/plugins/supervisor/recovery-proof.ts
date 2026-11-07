import { lstat, readdir, open, rename, unlink } from 'node:fs/promises'
import { constants, realpathSync, type Stats } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import { openFileNotThroughALink, syncDirectoryAt } from '../private-files'
import {
  bootWitness,
  laterBoot,
  readBootWitness,
} from '../../../../resources/plugin-host/boot-witness.mjs'
import type { OwnerRecord } from './protocol'
import { readVolumeIdentity } from '../../../../resources/plugin-host/volume-identity.mjs'

const directoryIdentity = z.strictObject({ id: z.uuid(), identity: z.string().max(128) })
const bindingSchema = z.strictObject({
  root: z.string().max(4096),
  rootIdentity: z.string().max(128),
  fenceIdentity: z.string().max(128),
  hostIdentity: z.string().max(128),
  runsIdentity: z.string().max(128),
})
const witnessSchema = z.strictObject({
  kind: z.enum(['darwin-boot-session-v1', 'windows-tick64-v1']),
  value: z.string().max(64),
})
const markerSchema = z.strictObject({
  format: z.literal(1),
  nonce: z.uuid(),
  epoch: z.uuid(),
  phase: z.enum(['blocked', 'draining']),
  binding: bindingSchema,
  census: z.array(directoryIdentity).max(4096),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  witness: witnessSchema,
})
const certificateSchema = z.strictObject({
  format: z.literal(1),
  method: z.literal('post-marker-boot-boundary'),
  marker: markerSchema,
  after: witnessSchema,
})
// Existing certificates stay immutable. A hash-bound enrollment supplies durable identities
// for an older certificate without rewriting its original reboot evidence.
const enrollmentSchema = z.strictObject({
  format: z.literal(1),
  certificateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  binding: bindingSchema,
  census: z.array(directoryIdentity).max(4096),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
type Census = z.infer<typeof markerSchema>['census']
type Binding = z.infer<typeof bindingSchema>
type VolumeReader = (
  path: string,
  device: string,
) => string | undefined | Promise<string | undefined>
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const identity = async (path: string) => {
  const stat = await lstat(path, { bigint: true })
  return `${stat.dev}:${stat.ino}`
}
const legacyIdentity = /^([0-9]+):([0-9]+)$/
const durableIdentity = /^(apfs:[a-f0-9-]{36}|winvol:[0-9]+):([0-9]+)(?::[0-9]+:[0-9]+)?$/
function matchesIdentity(
  saved: string,
  current: string,
  runtime: string | undefined,
  allowDeviceChange: boolean,
) {
  const previous = durableIdentity.exec(saved), observed = durableIdentity.exec(current)
  if (previous && observed && previous[1] === observed[1] && previous[2] === observed[2]) return true
  if (saved === current || saved === runtime) return true
  const old = legacyIdentity.exec(saved),
    next = durableIdentity.exec(current)
  return !!(allowDeviceChange && old && next?.[1]?.startsWith('apfs:') && old[2] === next[2])
}
function matchesBinding(
  saved: Binding,
  current: Binding,
  runtime: Binding | undefined,
  allowDeviceChange: boolean,
) {
  return (
    saved.root === current.root &&
    (['rootIdentity', 'fenceIdentity', 'hostIdentity', 'runsIdentity'] as const).every((key) =>
      matchesIdentity(saved[key], current[key], runtime?.[key], allowDeviceChange),
    )
  )
}
function matchesCensus(
  saved: Census,
  current: Census,
  runtime: Census | undefined,
  allowDeviceChange: boolean,
  full: boolean,
) {
  const identities = new Map(current.map((run) => [run.id, run.identity]))
  const pins = new Map(runtime?.map((run) => [run.id, run.identity]))
  return (
    (!full || saved.length === current.length) &&
    saved.every((run) => {
      const now = identities.get(run.id),
        pin = pins.get(run.id)
      return now !== undefined && matchesIdentity(run.identity, now, pin, allowDeviceChange)
    })
  )
}
function rebindReason(
  saved: { binding: Binding; census: Census },
  runtimeBinding: Binding,
  runtimeCensus: Census,
) {
  const pins = new Map(runtimeCensus.map((run) => [run.id, run.identity]))
  const changed =
    (['rootIdentity', 'fenceIdentity', 'hostIdentity', 'runsIdentity'] as const).some(
      (key) =>
        legacyIdentity.test(saved.binding[key]) && saved.binding[key] !== runtimeBinding[key],
    ) ||
    saved.census.some(
      (run) => legacyIdentity.test(run.identity) && run.identity !== pins.get(run.id),
    )
  return changed ? 'rebound after device renumbering' : 'recorded durable volume identity'
}
async function snapshot(root: string, readVolume: VolumeReader) {
  // The cache lasts for this one snapshot only. Each revalidation asks the native system again.
  const volumes = new Map<string, Promise<string | undefined>>()
  const pins: Record<string, string> = {}
  const identify = async (path: string) => {
    const stat = await lstat(path, { bigint: true })
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !stat.isFile())
    )
      throw new Error('Untrusted recovery identity')
    const device = String(stat.dev),
      runtime = `${stat.dev}:${stat.ino}`
    let volume = volumes.get(device)
    if (!volume) {
      volume = Promise.resolve(readVolume(path, device))
      volumes.set(device, volume)
    }
    const value = await volume
    if (value !== undefined && !/^(apfs:[a-f0-9-]{36}|winvol:[0-9]+)$/.test(value))
      throw new Error('Invalid volume identity')
    pins[path] = runtime
    return value ? `${value}:${stat.ino}` : runtime
  }
  const bound = await binding(root, identify)
  const covered = await census(root, identify)
  const runtimeBinding = await binding(root, identity)
  const runtimeCensus = await census(root)
  // Native volume observation may yield. Retain the original dev:ino race check.
  for (const [path, pin] of Object.entries(pins)) {
    const stat = await lstat(path, { bigint: true })
    if (pin !== `${stat.dev}:${stat.ino}`)
      throw new Error('Changed recovery identity')
  }
  return {
    bound,
    covered,
    runtimeBinding,
    runtimeCensus,
    pins: Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b))),
  }
}
/** Reboot metadata has the same descriptor trust boundary as a guardian's exit proof. */
async function readRebootProof(path: string): Promise<unknown> {
  const file = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
  const accepted = (stat: Stats) =>
    stat.isFile() &&
    stat.nlink === 1 &&
    stat.size > 0 &&
    stat.size <= 1024 * 1024
  try {
    const before = await file.stat()
    if (!accepted(before)) throw new Error('Untrusted recovery proof')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await file.stat()
    if (
      !accepted(after) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      length !== before.size
    )
      throw new Error('Changed recovery proof')
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally {
    await file.close()
  }
}
async function binding(root: string, identify = identity) {
  const canonical = realpathSync.native(root)
  return {
    root: process.platform === 'win32' ? canonical.toLowerCase() : canonical,
    rootIdentity: await identify(root),
    fenceIdentity: await identify(join(root, 'supervisor/owner-lock.sqlite')),
    hostIdentity: await identify(join(root, 'host')),
    runsIdentity: await identify(join(root, 'host/runs')),
  }
}
/** The original fence excludes every legitimate publisher while these immutable proofs are made. */
async function publish(folder: string, name: string, value: unknown): Promise<void> {
  const target = join(folder, name)
  if (await exists(target)) throw new Error('Recovery proof already exists')
  const temporary = join(folder, `.proof-${randomUUID()}`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(value))
      await file.sync()
    } finally {
      await file.close()
    }
    if (await exists(target)) throw new Error('Recovery proof already exists')
    await rename(temporary, target)
    await syncDirectoryAt(folder)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
async function census(root: string, identify = identity): Promise<Census> {
  if (!(await exists(join(root, 'host')))) return []
  const host = await privateChild(root, 'host', false)
  if (!(await exists(join(host, 'runs')))) return []
  const runs = await privateChild(host, 'runs', false)
  const entries = await readdir(runs, { withFileTypes: true })
  if (entries.length > 4096) throw new Error('Run history too large')
  const result: Census = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success)
      throw new Error('Invalid run history')
    const directory = await privateChild(runs, entry.name, false)
    result.push({ id: entry.name, identity: await identify(directory) })
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

export interface RecoveryObservation {
  previous: OwnerRecord | null
  /** Trusted tests may substitute the native observation, never workspace or plugin input. */
  readBootWitness?: () => Promise<unknown>
  /** Native identity seam for trusted fictional-volume tests; never a plugin setting. */
  readVolumeIdentity?: VolumeReader
  /** A verified pending reboot marker permits advice, never admission. */
  onRebootRequired?: () => void
}

const receipt = z.object({
  format: z.literal(1),
  runId: z.uuid(),
  pluginId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  guardianPid: z.number().int().min(2),
  groups: z.array(z.tuple([z.number().int().min(2), z.string().min(1).max(256)])).max(1024),
  exited: z.literal(true),
})
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function hasExitReceipt(root: string, runId: string): Promise<boolean> {
  try {
    const file = await openFileNotThroughALink(
      join(root, 'host/runs', runId, 'exit.json'),
      constants.O_RDONLY | constants.O_NONBLOCK,
    )
    try {
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 64 * 1024 ||
        stat.size === 0
      )
        return false
      const proof = receipt.parse(JSON.parse(await file.readFile('utf8')))
      return proof.runId === runId
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

function validMarker(marker: z.infer<typeof markerSchema>): boolean {
  return (
    !!bootWitness(marker.witness) &&
    marker.digest === hash(marker.census) &&
    new Set(marker.census.map((run) => run.id)).size === marker.census.length &&
    equal(
      marker.census,
      [...marker.census].sort((a, b) => a.id.localeCompare(b.id)),
    )
  )
}

/** Called only while the original owner fence remains held. Runs are created before every fork. */
export async function previousRunsProvenStopped(
  root: string,
  observation?: RecoveryObservation,
): Promise<boolean> {
  try {
    let covered = await census(root)
    const unresolved = new Set<string>()
    for (const run of covered) if (!(await hasExitReceipt(root, run.id))) unresolved.add(run.id)
    if (!unresolved.size) return true
    if (!observation) return false
    const readVolume = observation.readVolumeIdentity ?? readVolumeIdentity
    const initial = await snapshot(root, readVolume)
    if (!equal(covered, initial.runtimeCensus)) return false
    const bound = initial.bound
    covered = initial.covered
    const unchanged = async () => equal(initial, await snapshot(root, readVolume))
    const proofs = await privateChild(root, 'supervisor/reboot-proofs')
    if ((await readdir(proofs)).length > 8192) return false
    const certificates = await privateChild(proofs, 'certificates')
    const enrollments = await privateChild(proofs, 'volume-bindings')
    await syncDirectoryAt(join(root, 'supervisor'))
    await syncDirectoryAt(proofs)
    const entries = await readdir(certificates)
    if (entries.length > 4096) return false
    for (const name of entries) {
      // A crash may leave an unpublished temporary; it is never positive evidence.
      if (name.startsWith('.proof-') && z.uuid().safeParse(name.slice(7)).success) continue
      const certificate = certificateSchema.parse(await readRebootProof(join(certificates, name)))
      const marker = certificate.marker
      if (
        name !== `${marker.nonce}.json` ||
        !validMarker(marker) ||
        !laterBoot(marker.witness, certificate.after)
      )
        return false
      const enrollmentPath = join(enrollments, name)
      let enrolled: z.infer<typeof enrollmentSchema> | undefined
      if (await exists(enrollmentPath)) {
        enrolled = enrollmentSchema.parse(await readRebootProof(enrollmentPath))
        // Its link to the immutable certificate is exact; a different nonce, census or
        // previously recorded volume cannot be laundered through a new enrollment.
        if (
          enrolled.certificateDigest !== hash(certificate) ||
          enrolled.digest !== hash(enrolled.census) ||
          ![
            enrolled.binding.rootIdentity,
            enrolled.binding.fenceIdentity,
            enrolled.binding.hostIdentity,
            enrolled.binding.runsIdentity,
            ...enrolled.census.map((run) => run.identity),
          ].every((value) => durableIdentity.test(value)) ||
          !matchesBinding(marker.binding, enrolled.binding, undefined, true) ||
          !matchesCensus(marker.census, enrolled.census, undefined, true, true)
        )
          return false
      }
      const acceptedBinding = enrolled?.binding ?? marker.binding
      const acceptedCensus = enrolled?.census ?? marker.census
      if (
        !matchesBinding(acceptedBinding, bound, initial.runtimeBinding, !enrolled) ||
        !matchesCensus(acceptedCensus, covered, initial.runtimeCensus, !enrolled, false)
      )
        return false
      const legacy =
        !enrolled &&
        [
          marker.binding.rootIdentity,
          marker.binding.fenceIdentity,
          marker.binding.hostIdentity,
          marker.binding.runsIdentity,
          ...marker.census.map((run) => run.identity),
        ].some((value) => legacyIdentity.test(value))
      if (legacy && bound.rootIdentity.startsWith('apfs:')) {
        const selected = covered.filter((run) => marker.census.some((old) => old.id === run.id))
        if (!(await unchanged())) return false
        await publish(
          enrollments,
          name,
          enrollmentSchema.parse({
            format: 1,
            certificateDigest: hash(certificate),
            binding: bound,
            census: selected,
            digest: hash(selected),
          }),
        )
        console.warn(rebindReason(marker, initial.runtimeBinding, initial.runtimeCensus))
      }
      for (const run of marker.census) unresolved.delete(run.id)
    }
    // A completed certificate survives a crash between proof and owner publication. It never
    // needs a second tick comparison and cannot cover a newly created run directory.
    if (!unresolved.size) {
      await syncDirectoryAt(certificates)
      return unchanged()
    }
    const previous = observation.previous
    if (!previous || (previous.phase !== 'blocked' && previous.phase !== 'draining')) return false
    const name = `pending-${previous.epoch}.json`
    const path = join(proofs, name)
    let pending: z.infer<typeof markerSchema> | undefined
    if (await exists(path)) {
      pending = markerSchema.parse(await readRebootProof(path))
      if (
        !validMarker(pending) ||
        pending.epoch !== previous.epoch ||
        pending.phase !== previous.phase
      )
        return false
      await syncDirectoryAt(proofs)
    }
    const current = bootWitness(await (observation.readBootWitness ?? readBootWitness)())
    if (!current || !(await unchanged())) return false
    if (!pending) {
      await publish(
        proofs,
        name,
        markerSchema.parse({
          format: 1,
          nonce: randomUUID(),
          epoch: previous.epoch,
          phase: previous.phase,
          binding: bound,
          census: covered,
          digest: hash(covered),
          witness: current,
        }),
      )
      try {
        observation.onRebootRequired?.()
      } catch {
        /* Advice cannot change proof. */
      }
      return false
    }
    if (pending.witness.kind !== current.kind) return false
    const rebooted = laterBoot(pending.witness, current)
    if (
      !matchesBinding(pending.binding, bound, initial.runtimeBinding, rebooted) ||
      !matchesCensus(pending.census, covered, initial.runtimeCensus, rebooted, true)
    )
      return false
    if (!rebooted) {
      try {
        observation.onRebootRequired?.()
      } catch {
        /* Advice cannot change proof. */
      }
      return false
    }
    await publish(
      certificates,
      `${pending.nonce}.json`,
      certificateSchema.parse({
        format: 1,
        method: 'post-marker-boot-boundary',
        // The release decision accepts an anchorless same-path clone/restore with matching
        // inodes. The changed boot proves old processes gone; enroll the current UUID
        // now so every later volume change refuses. The pending marker stays intact.
        marker: { ...pending, binding: bound, census: covered, digest: hash(covered) },
        after: current,
      }),
    )
    if (!equal(pending.binding, bound) || !equal(pending.census, covered))
      console.warn(rebindReason(pending, initial.runtimeBinding, initial.runtimeCensus))
    return unchanged()
  } catch {
    return false
  }
}
