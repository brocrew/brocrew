import { randomUUID } from 'node:crypto'
import { isMainThread } from 'node:worker_threads'
import { PluginFence } from './fence'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import {
  isInsideCheckedRoot,
  isPrivateEntry,
  isWithinOrSame,
  openDirectoryNotThroughALink,
  realPath,
  syncDirectory,
} from '../private-files'
import { pluginSha256 } from '../package-digests'
import {
  decodeState,
  encodeState,
  equalState,
  JournalRecord,
  PluginStateError,
  STATE_LIMITS,
  refuseState,
  type ActivationRef,
  type ActivationSnapshot,
  type Operation,
  type ResolutionReservation,
} from './format'
import {
  foldRecord,
  newLifecycle,
  resolvedSnapshot,
  snapshotReference,
  type LifecycleState,
} from './machine'

export interface PluginDiskOptions {
  /** Explicit global plugin root. There is deliberately no workspace/live-root fallback. */
  root: string
  workspaceRoots: readonly string[]
  /** Fault seam for inert scratch-folder controls only. */
  fault?: (point: 'staged' | 'published' | 'durable') => void
}
interface Pin {
  path: string
  stat: BigIntStats
  fd: number
}
interface Counterpart {
  folder: string
  name: string
}
const same = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev && left.ino === right.ino
const stageName = /^\.stage-[0-9a-f-]{36}$/
const recordName = /^\d{8}\.json$/
const sealName = /^\d{8}-[a-f0-9]{64}\.seal$/

/** Kept-current journal + immutable activation objects, never a workspace DB. */
export class PluginStateDisk {
  private readonly pins: Pin[] = []
  readonly root: string
  readonly guard: string
  readonly activations: string
  readonly reservations: string
  private closed = false
  private fence: PluginFence | undefined
  constructor(
    private readonly options: PluginDiskOptions,
    create = false,
    existingOnly = false,
  ) {
    this.root = resolve(options.root)
    this.guard = join(this.root, 'lifecycle-guard')
    this.activations = join(this.root, 'activations')
    this.reservations = join(this.root, 'resolution-reservations')
    try {
      if (!isMainThread) refuseState('unsupported')
      if (!isAbsolute(options.root)) refuseState('unsafe-path')
      const parent = dirname(this.root)
      const canonicalParent = realPath(parent)
      if (canonicalParent !== parent) refuseState('unsafe-path')
      if (!isInsideCheckedRoot(canonicalParent)) refuseState('unsupported')
      const canonicalRoot = create
        ? join(canonicalParent, basename(this.root))
        : realPath(this.root)
      const workspaces = options.workspaceRoots.map((workspace) => {
        const path = realPath(workspace)
        const stat = lstatSync(path, { bigint: true })
        if (!stat.isDirectory()) refuseState('unsafe-path')
        return { path, stat }
      })
      if (workspaces.some((workspace) => isWithinOrSame(workspace.path, canonicalRoot)))
        refuseState('unsafe-path')
      // Canonical string comparison is supplemented by physical ancestry for case aliases.
      for (let ancestor = create ? canonicalParent : canonicalRoot; workspaces.length > 0;) {
        const stat = lstatSync(ancestor, { bigint: true })
        if (workspaces.some((workspace) => same(stat, workspace.stat))) refuseState('unsafe-path')
        const above = dirname(ancestor)
        if (above === ancestor) break
        ancestor = above
      }
      this.pin(parent)
      if (create) mkdirSync(this.root, { mode: 0o700 })
      this.pin(this.root)
      if (create) {
        mkdirSync(this.guard, { mode: 0o700 })
        mkdirSync(this.activations, { mode: 0o700 })
        syncDirectory(this.pins[1]!.fd)
      }
      this.pin(this.guard)
      this.pin(this.activations)
      try {
        lstatSync(this.reservations)
      } catch (error) {
        if (existingOnly || !(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw error
        this.check()
        mkdirSync(this.reservations, { mode: 0o700 })
        syncDirectory(this.pins[1]!.fd)
      }
      this.pin(this.reservations)
      const fencePath = join(this.root, 'writer-lock.sqlite')
      this.fence = PluginFence.acquire(fencePath, existingOnly)
      this.check()
      if (create) syncDirectory(this.pins[0]!.fd)
    } catch (error) {
      this.close()
      throw error instanceof PluginStateError ? error : new PluginStateError('unsafe-path')
    }
  }
  private privateDirectory(stat: BigIntStats): void {
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isPrivateEntry(stat))
      refuseState('unsafe-path')
  }
  private pin(path: string): void {
    const stat = lstatSync(path, { bigint: true })
    this.privateDirectory(stat)
    const fd = openDirectoryNotThroughALink(path)
    try {
      const held = fstatSync(fd, { bigint: true })
      this.privateDirectory(held)
      if (!same(stat, held)) refuseState('unsafe-path')
      this.pins.push({ path, stat, fd })
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }
  private check(): void {
    if (this.closed) refuseState('unsafe-path')
    for (const pin of this.pins) {
      const now = lstatSync(pin.path, { bigint: true })
      this.privateDirectory(now)
      if (!same(now, pin.stat) || !same(fstatSync(pin.fd, { bigint: true }), pin.stat))
        refuseState('unsafe-path')
    }
    this.fence?.check(join(this.root, 'writer-lock.sqlite'))
  }
  private exclusive<T>(run: () => T): T {
    this.check()
    try {
      return this.fence!.sync(this, () => {
        this.check()
        return run()
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  async withExclusive<T>(run: () => Promise<T>): Promise<T> {
    this.check()
    try {
      return await this.fence!.async(this, async () => {
        this.check()
        return run()
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  private file(stat: BigIntStats): void {
    if (
      !stat.isFile() ||
      !isPrivateEntry(stat) ||
      (stat.nlink !== 1n && stat.nlink !== 2n) ||
      stat.size > BigInt(STATE_LIMITS.recordBytes)
    )
      refuseState('unsafe-path')
  }
  private links(
    folder: string,
    name: string,
    held: BigIntStats,
    counterparts: readonly Counterpart[],
  ): void {
    if (held.nlink !== 2n) return
    if (
      counterparts.some((candidate) => {
        try {
          const stat = lstatSync(join(candidate.folder, candidate.name), { bigint: true })
          return stat.isFile() && same(stat, held)
        } catch {
          return false
        }
      })
    )
      return
    // Prove the second link is our private crash stage before reading any bytes.
    const names = readdirSync(folder)
    if (names.length > STATE_LIMITS.records * 2) refuseState('limit')
    if (
      !names.some((candidate) => {
        if (candidate === name || !stageName.test(candidate)) return false
        const stat = lstatSync(join(folder, candidate), { bigint: true })
        return stat.isFile() && same(stat, held)
      })
    )
      refuseState('unsafe-path')
  }
  private read(folder: string, name: string, counterparts: readonly Counterpart[] = []): Buffer {
    this.check()
    const path = join(folder, name)
    const fd = openNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const held = fstatSync(fd, { bigint: true })
      this.file(held)
      this.links(folder, name, held, counterparts)
      const bytes = Buffer.alloc(Number(held.size) + 1)
      let at = 0
      for (;;) {
        const n = readSync(fd, bytes, at, bytes.length - at, null)
        if (n === 0) break
        at += n
        if (at === bytes.length) refuseState('corrupt')
      }
      const after = fstatSync(fd, { bigint: true })
      if (
        at !== Number(held.size) ||
        !same(held, after) ||
        held.size !== after.size ||
        !same(lstatSync(path, { bigint: true }), held)
      )
        refuseState('corrupt')
      this.check()
      return bytes.subarray(0, at)
    } finally {
      closeSync(fd)
    }
  }
  private withReservation<T>(id: string, create: boolean, run: (folder: string) => T): T {
    if (!/^[a-f0-9-]{36}$/.test(id)) refuseState('corrupt')
    this.check()
    const folder = join(this.reservations, id)
    if (create) {
      if (readdirSync(this.reservations).length >= STATE_LIMITS.records * 2) refuseState('limit')
      mkdirSync(folder, { mode: 0o700 })
      syncDirectory(this.pins.find((pin) => pin.path === this.reservations)!.fd)
    }
    this.pin(folder)
    try {
      return run(folder)
    } finally {
      closeSync(this.pins.pop()!.fd)
    }
  }
  private publishReserved(
    folder: string,
    name: string,
    reservedFolder: string,
    reservedName: string,
    bytes: Buffer,
  ): void {
    this.check()
    if (!this.read(reservedFolder, reservedName, [{ folder, name }]).equals(bytes))
      refuseState('corrupt')
    this.options.fault?.('staged')
    this.check()
    try {
      linkSync(join(reservedFolder, reservedName), join(folder, name))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (!this.read(folder, name, [{ folder: reservedFolder, name: reservedName }]).equals(bytes))
        refuseState('conflict')
    }
    this.options.fault?.('published')
    syncDirectory(this.pins.find((pin) => pin.path === folder)!.fd)
    this.options.fault?.('durable')
    this.check()
  }
  private put(folder: string, name: string, bytes: Buffer): void {
    this.check()
    if (bytes.length > STATE_LIMITS.recordBytes) refuseState('limit')
    if (readdirSync(folder).length >= STATE_LIMITS.records * 2) refuseState('limit')
    const stage = join(folder, `.stage-${randomUUID()}`)
    const fd = createFreshFile(stage, 0o600)
    try {
      const held = fstatSync(fd, { bigint: true })
      this.file(held)
      if (held.nlink !== 1n) refuseState('unsafe-path')
      writeFileSync(fd, bytes)
      fsyncSync(fd)
      this.options.fault?.('staged')
      this.check()
      if (!same(lstatSync(stage, { bigint: true }), held)) refuseState('unsafe-path')
      try {
        linkSync(stage, join(folder, name))
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        if (!this.read(folder, name).equals(bytes)) {
          this.check()
          if (!same(lstatSync(stage, { bigint: true }), held)) refuseState('unsafe-path')
          unlinkSync(stage)
          syncDirectory(this.pins.find((pin) => pin.path === folder)!.fd)
          refuseState('conflict')
        }
      }
      this.options.fault?.('published')
      const pin = this.pins.find((pin) => pin.path === folder)!
      syncDirectory(pin.fd)
      this.options.fault?.('durable')
      this.check()
      if (!same(lstatSync(stage, { bigint: true }), held)) refuseState('unsafe-path')
      unlinkSync(stage)
      syncDirectory(pin.fd)
    } finally {
      closeSync(fd)
    }
  }
  private readPublished(folder: string, name: string, reservation: string, source: string): Buffer {
    if (lstatSync(join(folder, name), { bigint: true }).nlink === 1n) return this.read(folder, name)
    return this.withReservation(reservation, false, (reserved) =>
      this.read(folder, name, [{ folder: reserved, name: source }]),
    )
  }
  private readJournal(name: string, prior: ResolutionReservation | null): Buffer {
    if (lstatSync(join(this.guard, name), { bigint: true }).nlink === 1n)
      return this.read(this.guard, name)
    if (prior)
      return this.withReservation(prior.id, false, (folder) =>
        this.read(this.guard, name, [
          { folder, name: 'complete.record' },
          { folder, name: 'abort.record' },
        ]),
      )
    const target = lstatSync(join(this.guard, name), { bigint: true })
    for (const id of readdirSync(this.reservations)) {
      const found = this.withReservation(id, false, (folder) => {
        try {
          if (!same(lstatSync(join(folder, 'prepare.record'), { bigint: true }), target))
            return null
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
          throw error
        }
        return this.read(this.guard, name, [{ folder, name: 'prepare.record' }])
      })
      if (found !== null) return found
    }
    // Completed legacy publications may still have their verified guard-local crash stage.
    return this.read(this.guard, name)
  }
  load(keptActivations?: Set<string>): LifecycleState {
    return this.exclusive(() => this.loadLocked(keptActivations))
  }
  /** Display readers must not finish an interrupted owner publication. */
  loadForObservation(): LifecycleState {
    return this.exclusive(() => this.loadLocked(undefined, false))
  }
  private loadLocked(keptActivations?: Set<string>, repair = true): LifecycleState {
    try {
      this.check()
      const names = readdirSync(this.guard)
      if (
        names.length > STATE_LIMITS.records * 2 ||
        names.some(
          (name) => !recordName.test(name) && !stageName.test(name) && !sealName.test(name),
        )
      )
        refuseState('corrupt')
      const records = names.filter((name) => recordName.test(name)).sort()
      if (records.length === 0) refuseState('missing-guard')
      if (records.length > STATE_LIMITS.records) refuseState('limit')
      const recordNames = new Set(records)
      const seals = new Map<string, string>()
      // Even a missing final record must not rewind the last denying lifecycle floor.
      for (const name of names.filter((name) => sealName.test(name))) {
        const sequence = name.slice(0, 8)
        if (seals.has(sequence) || !recordNames.has(`${sequence}.json`)) refuseState('corrupt')
        seals.set(sequence, name)
      }
      const state = newLifecycle()
      let total = 0
      records.forEach((name, index) => {
        if (name !== `${String(index).padStart(8, '0')}.json`) refuseState('corrupt')
        const priorReservation = state.reservation
        const bytes = this.readJournal(name, priorReservation)
        total += bytes.length
        if (total > STATE_LIMITS.journalBytes) refuseState('limit')
        const checksum = pluginSha256(bytes)
        const record = decodeState(bytes, JournalRecord)
        foldRecord(state, record, checksum)
        if (record.event.kind === 'completed' || record.event.kind === 'aborted')
          keptActivations?.add(record.event.activation.name)
        const expectedSeal = `${name.slice(0, 8)}-${checksum}.seal`
        const existingSeal = seals.get(name.slice(0, 8))
        if (existingSeal !== undefined && existingSeal !== expectedSeal) refuseState('corrupt')
        if (existingSeal === undefined && !repair) refuseState('corrupt')
        const reservation =
          record.event.kind === 'prepared' ? record.event.reservation : priorReservation
        if (reservation) {
          const reservedName =
            record.event.kind === 'prepared'
              ? 'prepare.seal'
              : record.event.kind === 'completed'
                ? 'complete.seal'
                : 'abort.seal'
          if (existingSeal === undefined)
            this.withReservation(reservation.id, false, (folder) => {
              this.publishReserved(this.guard, expectedSeal, folder, reservedName, Buffer.alloc(0))
            })
          else if (
            this.readPublished(this.guard, expectedSeal, reservation.id, reservedName).length !== 0
          )
            refuseState('corrupt')
        } else if (existingSeal === undefined) {
          // Complete an interrupted publication, using only a validated chained record.
          // Directory fsync makes the record and this tail-loss marker durable together.
          this.put(this.guard, expectedSeal, Buffer.alloc(0))
        } else if (this.read(this.guard, expectedSeal).length !== 0) refuseState('corrupt')
      })
      this.check()
      return state
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  private encodedRecord(
    sequence: number,
    previous: string | null,
    publicationId: string,
    event: JournalRecord['event'],
  ): Buffer {
    return encodeState({ sequence, previous, publicationId, event })
  }
  /** Only called with kernel exclusion: no other process can still be preparing these objects. */
  reclaim(): void {
    this.exclusive(() => this.reclaimLocked())
  }
  private removeFile(folder: string, name: string): void {
    this.check()
    const path = join(folder, name)
    const fd = openNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const held = fstatSync(fd, { bigint: true })
      this.file(held)
      if (held.nlink === 2n)
        this.links(folder, name, held, [
          ...readdirSync(folder)
            .filter((candidate) => candidate !== name)
            .map((candidate) => ({ folder, name: candidate })),
          ...(folder.startsWith(this.reservations + sep)
            ? readdirSync(this.guard).map((candidate) => ({ folder: this.guard, name: candidate }))
            : []),
        ])
      if (!same(lstatSync(path, { bigint: true }), held)) refuseState('unsafe-path')
      unlinkSync(path)
    } finally {
      closeSync(fd)
    }
  }
  private reclaimLocked(): void {
    const keep = new Set<string>(),
      state = this.load(keep)
    if (state.reservation) {
      keep.add(state.reservation.complete.name)
      keep.add(state.reservation.abort.name)
    }
    const names = readdirSync(this.reservations)
    if (names.length > STATE_LIMITS.records * 2) refuseState('limit')
    for (const id of names) {
      if (id === state.reservation?.id) continue
      this.withReservation(id, false, (folder) => {
        const files = readdirSync(folder)
        if (
          files.length > STATE_LIMITS.records * 2 ||
          files.some(
            (name) =>
              !stageName.test(name) &&
              ![
                'prepare.record',
                'complete.record',
                'abort.record',
                'prepare.seal',
                'complete.seal',
                'abort.seal',
              ].includes(name),
          )
        )
          refuseState('corrupt')
        for (const name of files) this.removeFile(folder, name)
        syncDirectory(this.pins.find((pin) => pin.path === folder)!.fd)
        this.check()
        rmdirSync(folder)
      })
      syncDirectory(this.pins.find((pin) => pin.path === this.reservations)!.fd)
    }
    const activations = readdirSync(this.activations)
    if (activations.length > STATE_LIMITS.records * 2) refuseState('limit')
    for (const name of activations) {
      if (keep.has(name)) continue
      if (!stageName.test(name) && !/^\d{8}-[a-f0-9]{64}\.json$/.test(name)) refuseState('corrupt')
      this.removeFile(this.activations, name)
    }
    syncDirectory(this.pins.find((pin) => pin.path === this.activations)!.fd)
  }
  private journalSize(): number {
    return readdirSync(this.guard)
      .filter((name) => recordName.test(name))
      .reduce((sum, name) => sum + lstatSync(join(this.guard, name)).size, 0)
  }
  /** Reserve the whole two-record operation, both activation outcomes and publication inputs. */
  prepare(previous: LifecycleState, operation: Operation): void {
    this.exclusive(() => {
      this.reclaimLocked()
      try {
        this.prepareLocked(previous, operation)
      } finally {
        this.reclaimLocked()
      }
    })
  }
  private prepareLocked(previous: LifecycleState, operation: Operation): void {
    try {
      if (previous.sequence + 2 >= STATE_LIMITS.records) refuseState('limit')
      const future: LifecycleState = {
        ...previous,
        guards: new Map(previous.guards),
        pending: operation,
      }
      if (operation.next !== null) future.guards.set(operation.next.pluginId, operation.next)
      const complete = resolvedSnapshot(future, true),
        abort = resolvedSnapshot(future, false)
      const completeRef = snapshotReference(complete, previous.sequence + 2),
        abortRef = snapshotReference(abort, previous.sequence + 2)
      const id = operation.request.operationId
      const completeEvent: JournalRecord['event'] = {
        kind: 'completed',
        operationId: operation.request.operationId,
        activation: completeRef,
      }
      const abortEvent: JournalRecord['event'] = {
        kind: 'aborted',
        operationId: operation.request.operationId,
        activation: abortRef,
      }
      const recordBytes = Math.max(
        this.encodedRecord(previous.sequence + 2, '0'.repeat(64), id, completeEvent).length,
        this.encodedRecord(previous.sequence + 2, '0'.repeat(64), id, abortEvent).length,
      )
      const reservation: ResolutionReservation = {
        id,
        complete: completeRef,
        abort: abortRef,
        recordBytes,
        records: 1,
        guardNames: 2,
        activationNames: 0,
      }
      const prepared = this.encodedRecord(previous.sequence + 1, previous.head, id, {
        kind: 'prepared',
        operation,
        reservation,
      })
      const head = pluginSha256(prepared)
      const completeRecord = this.encodedRecord(previous.sequence + 2, head, id, completeEvent),
        abortRecord = this.encodedRecord(previous.sequence + 2, head, id, abortEvent)
      if (Math.max(completeRecord.length, abortRecord.length) !== recordBytes)
        refuseState('corrupt')
      const current = this.load()
      if (current.sequence !== previous.sequence || current.head !== previous.head)
        refuseState('conflict')
      if (
        this.journalSize() + prepared.length + recordBytes > STATE_LIMITS.journalBytes ||
        readdirSync(this.guard).length + 6 > STATE_LIMITS.records * 2 ||
        readdirSync(this.activations).length + 4 > STATE_LIMITS.records * 2
      )
        refuseState('limit')
      this.withReservation(id, true, (folder) => {
        this.put(folder, 'prepare.record', prepared)
        this.put(folder, 'complete.record', completeRecord)
        this.put(folder, 'abort.record', abortRecord)
        for (const name of ['prepare.seal', 'complete.seal', 'abort.seal'])
          this.put(folder, name, Buffer.alloc(0))
        // Both possible snapshots are durable before prepare can start the global barrier.
        this.putActivation(complete, completeRef)
        this.putActivation(abort, abortRef)
        const checked = this.load()
        if (checked.sequence !== previous.sequence || checked.head !== previous.head)
          refuseState('conflict')
        if (readdirSync(this.guard).length + 6 > STATE_LIMITS.records * 2) refuseState('limit')
        const name = `${String(previous.sequence + 1).padStart(8, '0')}.json`
        this.publishReserved(this.guard, name, folder, 'prepare.record', prepared)
        this.publishReserved(
          this.guard,
          `${name.slice(0, 8)}-${head}.seal`,
          folder,
          'prepare.seal',
          Buffer.alloc(0),
        )
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  /** No fresh bytes, stage names, activation files or reservation directories are allocated. */
  resolve(previous: LifecycleState, success: boolean): void {
    this.exclusive(() => {
      try {
        this.resolveLocked(previous, success)
      } finally {
        this.reclaimLocked()
      }
    })
  }
  private resolveLocked(previous: LifecycleState, success: boolean): void {
    try {
      const reservation = previous.reservation,
        operation = previous.pending
      if (!reservation || !operation) refuseState('corrupt')
      const snapshot = resolvedSnapshot(previous, success),
        ref = snapshotReference(snapshot, previous.sequence + 1)
      if (
        !equalState(ref, success ? reservation.complete : reservation.abort) ||
        !this.readActivation(ref).equals(encodeState(snapshot))
      )
        refuseState('corrupt')
      const event: JournalRecord['event'] = success
        ? { kind: 'completed', operationId: operation.request.operationId, activation: ref }
        : { kind: 'aborted', operationId: operation.request.operationId, activation: ref }
      const bytes = this.encodedRecord(previous.sequence + 1, previous.head, reservation.id, event)
      if (bytes.length > reservation.recordBytes) refuseState('corrupt')
      const current = this.load()
      if (current.sequence !== previous.sequence || current.head !== previous.head)
        refuseState('conflict')
      this.withReservation(reservation.id, false, (folder) => {
        const name = `${String(previous.sequence + 1).padStart(8, '0')}.json`,
          choice = success ? 'complete' : 'abort'
        this.publishReserved(this.guard, name, folder, `${choice}.record`, bytes)
        this.publishReserved(
          this.guard,
          `${name.slice(0, 8)}-${pluginSha256(bytes)}.seal`,
          folder,
          `${choice}.seal`,
          Buffer.alloc(0),
        )
      })
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  append(previous: LifecycleState, event: JournalRecord['event']): void {
    this.exclusive(() => this.appendLocked(previous, event))
  }
  private appendLocked(previous: LifecycleState, event: JournalRecord['event']): void {
    try {
      if (
        event.kind === 'created'
          ? previous.sequence !== -1
          : !['projected', 'reader-floor'].includes(event.kind) ||
            previous.sequence < 0 ||
            previous.pending !== null
      )
        refuseState('conflict')
      if (previous.sequence + 1 >= STATE_LIMITS.records) refuseState('limit')
      const bytes = encodeState({
        sequence: previous.sequence + 1,
        previous: previous.head,
        publicationId: randomUUID(),
        event,
      })
      const current = this.loadIfAny()
      if (current.sequence !== previous.sequence || current.head !== previous.head)
        refuseState('conflict')
      const total = readdirSync(this.guard)
        .filter((name) => recordName.test(name))
        .reduce((sum, name) => sum + lstatSync(join(this.guard, name)).size, 0)
      if (total + bytes.length > STATE_LIMITS.journalBytes) refuseState('limit')
      this.put(this.guard, `${String(previous.sequence + 1).padStart(8, '0')}.json`, bytes)
      this.put(
        this.guard,
        `${String(previous.sequence + 1).padStart(8, '0')}-${pluginSha256(bytes)}.seal`,
        Buffer.alloc(0),
      )
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  private loadIfAny(): LifecycleState {
    if (readdirSync(this.guard).every((name) => stageName.test(name))) return newLifecycle()
    return this.load()
  }
  private putActivation(snapshot: ActivationSnapshot, ref: ActivationRef): void {
    try {
      const bytes = encodeState(snapshot)
      if (pluginSha256(bytes) !== ref.sha256) refuseState('corrupt')
      this.put(this.activations, ref.name, bytes)
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  readActivation(ref: ActivationRef): Buffer {
    try {
      const bytes = this.read(this.activations, ref.name)
      if (pluginSha256(bytes) !== ref.sha256) refuseState('corrupt')
      return bytes
    } catch (error) {
      throw error instanceof PluginStateError ? error : new PluginStateError('corrupt')
    }
  }
  close(): void {
    if (this.closed) return
    this.fence?.release()
    this.fence = undefined
    for (const pin of this.pins.splice(0)) closeSync(pin.fd)
    this.closed = true
  }
}
