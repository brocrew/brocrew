import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { OwnerRecord, refuse, StopRecord } from './protocol'
import { isSocketFile, localEndpoint } from '../local-endpoint'

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** Storage under the caller's selected root. No path identity or permission enrollment. */
export class SupervisorStorage {
  readonly folder: string
  readonly socket: string
  readonly lock: string
  readonly record: string
  readonly stop: string
  readonly identity: string
  readonly rootIdentity: string
  private closed = false
  constructor(
    readonly root: string,
    _workspaceRoots: readonly string[],
    create: boolean,
  ) {
    if (!isAbsolute(root)) refuse()
    this.folder = join(root, 'supervisor')
    this.socket = join(this.folder, 'owner.sock')
    this.lock = join(this.folder, 'owner-lock.sqlite')
    this.record = join(this.folder, 'owner.json')
    this.stop = join(this.folder, 'owner-stop.json')
    const path = resolve(root)
    this.rootIdentity = process.platform === 'win32' ? path.toLowerCase() : path
    this.identity = this.rootIdentity
    if (create) mkdirSync(this.folder, { recursive: true, mode: 0o700 })
  }
  check(): void {
    if (this.closed) refuse()
  }
  read(): OwnerRecord | null {
    this.check()
    try {
      return OwnerRecord.parse(JSON.parse(readFileSync(this.record, 'utf8')))
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }
  /** Legacy informational stop reason; never used to permit or prevent startup. */
  readStop(): StopRecord | null {
    this.check()
    try {
      return StopRecord.parse(JSON.parse(readFileSync(this.stop, 'utf8')))
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }
  write(value: OwnerRecord): void {
    this.publish(this.record, JSON.stringify(OwnerRecord.parse(value)))
  }
  writeStop(value: StopRecord): void {
    this.publish(this.stop, JSON.stringify(StopRecord.parse(value)))
  }
  private publish(path: string, text: string): void {
    this.check()
    const temporary = join(this.folder, `.owner-${randomUUID()}`)
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, text)
      fsyncSync(fd)
      renameSync(temporary, path)
    } finally {
      closeSync(fd)
      try {
        unlinkSync(temporary)
      } catch {
        /* only this unpublished temporary */
      }
    }
  }
  endpoint(record: OwnerRecord): string {
    return localEndpoint(this.socket, 'owner', record.key)
  }
  /** The service owns this endpoint name while its ordinary lifetime writer is held. */
  clearPersonSocket(): void {
    this.check()
    if (!isSocketFile()) return
    const path = join(this.root, 'person-control', 'person.sock')
    try {
      if (lstatSync(path).isSocket()) unlinkSync(path)
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  clearSocket(): void {
    this.check()
    if (!isSocketFile()) return
    try {
      if (!lstatSync(this.socket).isSocket()) refuse()
      unlinkSync(this.socket)
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  close(): void {
    this.closed = true
  }
}
