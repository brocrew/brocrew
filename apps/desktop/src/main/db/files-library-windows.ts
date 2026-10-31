import { randomUUID } from 'node:crypto'
import {
  libraryUnavailable,
  type FilesLibraryReader,
  type FilesLibraryRequest,
  type FilesLibraryResult,
} from '../../shared/files-library'

/** Dedicated caches and native permits belong to one window in this workspace. */
export class FilesLibraryWindows {
  private readonly workspace = randomUUID()
  private readonly windows = new Map<
    string,
    { reader: FilesLibraryReader; givers: string[]; closing?: Promise<void> }
  >()
  private closed = false
  private nextAdmission = 0
  private readonly admissions = new Map<string, number>()
  constructor(private readonly start: () => FilesLibraryReader) {}

  admit(owner: string): number {
    const ticket = ++this.nextAdmission
    this.admissions.set(owner, ticket)
    return ticket
  }
  isCurrent(owner: string, ticket: number): boolean {
    return !this.closed && this.admissions.get(owner) === ticket
  }

  async read(
    owner: string,
    request: FilesLibraryRequest,
    revision: string,
    givers?: readonly string[],
  ): Promise<FilesLibraryResult> {
    if (this.closed) return libraryUnavailable('closed')
    let window = this.windows.get(owner)
    if (window?.closing !== undefined) {
      await window.closing
      if (this.closed) return libraryUnavailable('closed')
      window = this.windows.get(owner)
    }
    if (window === undefined) {
      window = { reader: this.start(), givers: [] }
      this.windows.set(owner, window)
    }
    if (request.operation === 'query') window.givers = [...(givers ?? [])]
    return window.reader.read(request, {
      workspace: this.workspace,
      givers: [...window.givers],
      hostRevision: revision,
    })
  }
  async closeWindow(owner: string): Promise<void> {
    const window = this.windows.get(owner)
    if (window?.closing !== undefined) {
      await window.closing
      return
    }
    const admission = this.admit(owner)
    if (window === undefined) {
      this.admissions.delete(owner)
      return
    }
    window.closing ??= window.reader.close().finally(() => {
      if (this.windows.get(owner) === window) this.windows.delete(owner)
      if (this.admissions.get(owner) === admission) this.admissions.delete(owner)
    })
    await window.closing
  }
  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.windows.keys()].map((owner) => this.closeWindow(owner)))
  }
}
