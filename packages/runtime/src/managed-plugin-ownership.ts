import type { SessionHandle } from './runtime'

/** Retired handles remain owned until teardown and their exit fact both settle. */
export class ManagedPluginOwnership {
  private readonly handles = new Map<
    SessionHandle,
    {
      exit: Promise<void> | undefined
      closing?: Promise<void>
      retired: boolean
    }
  >()
  private sealed = false
  private hasWitness = false
  private resolveExit!: () => void
  private readonly exit = new Promise<void>((resolve) => {
    this.resolveExit = resolve
  })

  track(handle: SessionHandle): void {
    if (this.handles.has(handle)) return
    let exit: Promise<void> | undefined
    try {
      exit = handle.awaitProcessExit?.()
    } catch {
      /* An unreadable fact remains unknown. */
    }
    this.hasWitness ||= exit !== undefined
    exit?.catch(() => undefined)
    this.handles.set(handle, { exit, retired: false })
  }
  retire(handle: SessionHandle): Promise<void> {
    this.track(handle)
    const record = this.handles.get(handle)!
    record.retired = true
    if (!record.closing) {
      record.closing = Promise.resolve().then(() => handle.close())
      record.closing.catch(() => undefined)
      if (record.exit)
        void Promise.all([record.closing, record.exit]).then(
          () => {
            this.handles.delete(handle)
            this.finish()
          },
          () => {
            /* Rejected cleanup is not proof of exit. */
          },
        )
    }
    return record.closing
  }
  async mayReopen(): Promise<boolean> {
    // Witnesses are already awaited; an unknown retirement blocks replacement, not turns.
    await Promise.resolve()
    return ![...this.handles.values()].some((record) => record.retired)
  }
  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.handles.keys()].map((handle) => this.retire(handle)))
  }
  seal(): void {
    this.sealed = true
    this.finish()
  }
  private finish(): void {
    if (this.sealed && this.handles.size === 0) this.resolveExit()
  }
  awaitProcessExit(): Promise<void> | undefined {
    return this.hasWitness ? this.exit : undefined
  }
}
