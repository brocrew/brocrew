import { constants, realpath, type BigIntStats } from 'node:fs'
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isWithinOrSame, openFileNotThroughALink } from '../private-files'
import { pluginSha256 } from '../package-digests'
import type { PluginDiskOptions } from './disk'
import { decodeState, JournalRecord, refuseState, STATE_LIMITS } from './format'
import { journalEntries, stageName } from './journal'
import { foldRecord, newLifecycle } from './machine'

const canonical = promisify(process.platform === 'win32' ? realpath.native : realpath)
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino
const stamp = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(':')

/**
 * Committed display evidence only; never opens SQLite or grants mutation/admission authority.
 * Asynchronous, so a long journal never holds the main thread.
 */
async function readCommitted(options: PluginDiskOptions) {
  const pins: { path: string; stat: BigIntStats; handle: FileHandle }[] = []
  try {
    const root = resolve(options.root),
      parent = dirname(root)
    if (!isAbsolute(options.root) || (await canonical(parent)) !== parent)
      refuseState('unsafe-path')
    const canonicalRoot = await canonical(root)
    const workspaces = await Promise.all(
      options.workspaceRoots.map(async (path) => {
        const canonicalPath = await canonical(path),
          stat = await lstat(canonicalPath, { bigint: true })
        if (!stat.isDirectory() || isWithinOrSame(canonicalPath, canonicalRoot))
          refuseState('unsafe-path')
        return stat
      }),
    )
    for (let ancestor = canonicalRoot; workspaces.length > 0;) {
      const stat = await lstat(ancestor, { bigint: true })
      if (workspaces.some((workspace) => same(stat, workspace))) refuseState('unsafe-path')
      const above = dirname(ancestor)
      if (above === ancestor) break
      ancestor = above
    }
    const guard = join(root, 'lifecycle-guard')
    for (const path of [
      parent,
      root,
      guard,
      join(root, 'activations'),
      join(root, 'resolution-reservations'),
    ]) {
      const stat = await lstat(path, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink()) refuseState('unsafe-path')
      const flags =
        process.platform === 'win32'
          ? constants.O_RDONLY
          : constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      const handle = await open(path, flags)
      pins.push({ path, stat, handle })
      if (!same(stat, await handle.stat({ bigint: true }))) refuseState('unsafe-path')
    }
    const guardPin = pins.find((pin) => pin.path === guard)!
    const snapshot = async () => {
      const directory = await guardPin.handle.stat({ bigint: true })
      for (const pin of pins) {
        const now = await lstat(pin.path, { bigint: true })
        if (
          !now.isDirectory() ||
          now.isSymbolicLink() ||
          !same(pin.stat, now) ||
          !same(pin.stat, await pin.handle.stat({ bigint: true }))
        )
          refuseState('unsafe-path')
      }
      const names = (await readdir(guard)).sort()
      if (names.length > STATE_LIMITS.records * 2) refuseState('limit')
      const entries = new Map<string, BigIntStats>()
      for (const name of names) entries.set(name, await lstat(join(guard, name), { bigint: true }))
      if (stamp(directory) !== stamp(await guardPin.handle.stat({ bigint: true })))
        refuseState('busy')
      return entries
    }
    const before = await snapshot()
    const { records, seals } = journalEntries([...before.keys()])
    const counterpart = async (id: string, names: string[], held: BigIntStats) => {
      const folder = join(root, 'resolution-reservations', id)
      const before = await lstat(folder, { bigint: true })
      if (!before.isDirectory() || before.isSymbolicLink()) refuseState('unsafe-path')
      const flags =
        process.platform === 'win32'
          ? constants.O_RDONLY
          : constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      const handle = await open(folder, flags)
      try {
        if (!same(before, await handle.stat({ bigint: true }))) refuseState('unsafe-path')
        let found = false
        for (const name of names) {
          const stat = await lstat(join(folder, name), { bigint: true }).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null
              throw error
            },
          )
          if (stat?.isFile() && same(held, stat)) found = true
        }
        if (!same(before, await lstat(folder, { bigint: true }))) refuseState('unsafe-path')
        return found
      } finally {
        await handle.close()
      }
    }
    const read = async (name: string, linked: (held: BigIntStats) => Promise<boolean>) => {
      const path = join(guard, name)
      const handle = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const held = await handle.stat({ bigint: true })
        const staged =
          held.nlink === 2n &&
          [...before].some(
            ([candidate, stat]) => stageName.test(candidate) && stat.isFile() && same(stat, held),
          )
        if (
          !held.isFile() ||
          (held.nlink !== 1n && !(held.nlink === 2n && (staged || (await linked(held))))) ||
          held.size > BigInt(STATE_LIMITS.recordBytes) ||
          stamp(held) !== stamp(before.get(name)!)
        )
          refuseState('corrupt')
        const bytes = Buffer.alloc(Number(held.size) + 1)
        let at = 0
        for (;;) {
          const { bytesRead } = await handle.read(bytes, at, bytes.length - at, null)
          if (bytesRead === 0) break
          at += bytesRead
          if (at === bytes.length) refuseState('corrupt')
        }
        if (
          at !== Number(held.size) ||
          stamp(held) !== stamp(await handle.stat({ bigint: true })) ||
          stamp(held) !== stamp(await lstat(path, { bigint: true }))
        )
          refuseState('corrupt')
        return bytes.subarray(0, at)
      } finally {
        await handle.close()
      }
    }
    const state = newLifecycle()
    let total = 0
    for (const [index, name] of records.entries()) {
      if (name !== `${String(index).padStart(8, '0')}.json`) refuseState('corrupt')
      const prior = state.reservation
      const bytes = await read(name, async (held) => {
        if (prior) return counterpart(prior.id, ['complete.record', 'abort.record'], held)
        for (const id of await readdir(join(root, 'resolution-reservations'))) {
          if (!/^[a-f0-9-]{36}$/.test(id)) refuseState('corrupt')
          if (await counterpart(id, ['prepare.record'], held)) return true
        }
        return false
      })
      total += bytes.length
      if (total > STATE_LIMITS.journalBytes) refuseState('limit')
      const checksum = pluginSha256(bytes)
      const record = decodeState(bytes, JournalRecord)
      foldRecord(state, record, checksum)
      const expected = `${name.slice(0, 8)}-${checksum}.seal`
      const reservation = record.event.kind === 'prepared' ? record.event.reservation : prior
      const source =
        record.event.kind === 'prepared'
          ? 'prepare.seal'
          : record.event.kind === 'completed'
            ? 'complete.seal'
            : 'abort.seal'
      if (
        seals.get(name.slice(0, 8)) !== expected ||
        (
          await read(expected, (held) =>
            reservation ? counterpart(reservation.id, [source], held) : Promise.resolve(false),
          )
        ).length !== 0
      )
        refuseState('corrupt')
    }
    const after = await snapshot()
    if (
      before.size !== after.size ||
      [...before].some(
        ([name, stat]) => !after.has(name) || stamp(stat) !== stamp(after.get(name)!),
      )
    )
      refuseState('busy')
    return state
  } finally {
    await Promise.all(pins.map((pin) => pin.handle.close()))
  }
}

/** Missing, partial, busy or unsafe data is unknown (null), never an action state. */
export async function observeInstallations(options: PluginDiskOptions) {
  try {
    const state = await readCommitted(options)
    return {
      installed: [...state.admitted.keys()],
      pending: state.pending?.request.consent.pluginId ?? null,
    }
  } catch {
    return null
  }
}

/** The installed release of one plugin; unknown (null) while any operation is pending. */
export async function observeInstalledPackage(options: PluginDiskOptions, id: string) {
  try {
    const state = await readCommitted(options)
    if (state.pending !== null) return null
    const installed = state.admitted.get(id)
    if (!installed) return null
    return Object.freeze({
      version: installed.release.version,
      archiveSha256: installed.release.archiveSha256,
      manifestSha256: installed.release.manifestSha256,
    })
  } catch {
    return null
  }
}
