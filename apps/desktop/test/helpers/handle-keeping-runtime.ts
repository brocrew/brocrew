import { FakeRuntime, type FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle, StartOptions, ResumeOptions, SessionRef } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

export class HandleKeepingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}
