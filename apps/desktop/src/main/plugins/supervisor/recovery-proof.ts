import { lstat, readdir, open, rename, unlink } from 'node:fs/promises'
import { constants, realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { privateChild, sourceBytes } from '../node-host-files'
import { isPrivateEntry, openFileNotThroughALink, syncDirectoryAt } from '../private-files'
import {
  bootWitness,
  laterBoot,
  readBootWitness,
} from '../../../../resources/plugin-host/boot-witness.mjs'
import type { OwnerRecord } from './protocol'

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
type Census = z.infer<typeof markerSchema>['census']
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const identity = async (path: string) => {
  const stat = await lstat(path, { bigint: true })
  return `${stat.dev}:${stat.ino}`
}
async function binding(root: string) {
  const canonical = realpathSync.native(root)
  return {
    root: process.platform === 'win32' ? canonical.toLowerCase() : canonical,
    rootIdentity: await identity(root),
    fenceIdentity: await identity(join(root, 'supervisor/owner-lock.sqlite')),
    hostIdentity: await identity(join(root, 'host')),
    runsIdentity: await identity(join(root, 'host/runs')),
  }
}
/** The original fence excludes every legitimate publisher while these immutable proofs are made. */
async function publish(folder: string, name: string, value: unknown): Promise<void> {
  const target = join(folder, name)
  if (await exists(target)) throw new Error('Recovery proof already exists')
  const temporary = join(folder, `.proof-${randomUUID()}`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    if (await exists(target)) throw new Error('Recovery proof already exists')
    await rename(temporary, target)
    await syncDirectoryAt(folder)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
async function census(root: string): Promise<Census> {
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
    result.push({ id: entry.name, identity: await identity(directory) })
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

export interface RecoveryObservation {
  previous: OwnerRecord | null
  /** Trusted tests may substitute the native observation, never workspace or plugin input. */
  readBootWitness?: () => Promise<unknown>
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
        !isPrivateEntry(stat) ||
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
    const covered = await census(root)
    const unresolved = new Set<string>()
    for (const run of covered) if (!(await hasExitReceipt(root, run.id))) unresolved.add(run.id)
    if (!unresolved.size) return true
    if (!observation) return false
    const bound = await binding(root)
    const proofs = await privateChild(root, 'supervisor/reboot-proofs')
    if ((await readdir(proofs)).length > 8192) return false
    const certificates = await privateChild(proofs, 'certificates')
    await syncDirectoryAt(join(root, 'supervisor'))
    await syncDirectoryAt(proofs)
    const entries = await readdir(certificates)
    if (entries.length > 4096) return false
    const identities = new Map(covered.map((run) => [run.id, run.identity]))
    for (const name of entries) {
      const certificate = certificateSchema.parse(
        JSON.parse((await sourceBytes(join(certificates, name), 1024 * 1024)).toString('utf8')),
      )
      const marker = certificate.marker
      if (
        name !== `${marker.nonce}.json` ||
        !validMarker(marker) ||
        !equal(marker.binding, bound) ||
        !laterBoot(marker.witness, certificate.after) ||
        marker.census.some((run) => identities.get(run.id) !== run.identity)
      )
        return false
      for (const run of marker.census) unresolved.delete(run.id)
    }
    // A completed certificate survives a crash between proof and owner publication. It never
    // needs a second tick comparison and cannot cover a newly created run directory.
    if (!unresolved.size) {
      await syncDirectoryAt(certificates)
      return equal(bound, await binding(root)) && equal(covered, await census(root))
    }
    const previous = observation.previous
    if (!previous || (previous.phase !== 'blocked' && previous.phase !== 'draining')) return false
    const name = `pending-${previous.epoch}.json`
    const path = join(proofs, name)
    let pending: z.infer<typeof markerSchema> | undefined
    if (await exists(path)) {
      pending = markerSchema.parse(
        JSON.parse((await sourceBytes(path, 1024 * 1024)).toString('utf8')),
      )
      if (
        !validMarker(pending) ||
        pending.epoch !== previous.epoch ||
        pending.phase !== previous.phase ||
        !equal(pending.binding, bound) ||
        !equal(pending.census, covered)
      )
        return false
      await syncDirectoryAt(proofs)
    }
    const current = bootWitness(await (observation.readBootWitness ?? readBootWitness)())
    if (!current || !equal(bound, await binding(root)) || !equal(covered, await census(root)))
      return false
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
      return false
    }
    if (!laterBoot(pending.witness, current)) return false
    await publish(
      certificates,
      `${pending.nonce}.json`,
      certificateSchema.parse({
        format: 1,
        method: 'post-marker-boot-boundary',
        marker: pending,
        after: current,
      }),
    )
    return equal(bound, await binding(root)) && equal(covered, await census(root))
  } catch {
    return false
  }
}
