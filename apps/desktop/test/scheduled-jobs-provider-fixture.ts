import type { ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import {
  FakeRuntime,
  type FakeProviderSessions,
  type FakeSessionHandle,
} from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { KeptAttempts } from '../src/main/schedule-attempts-file'

/* The provider and saved-key doubles the scheduled-start tests build their hosts with. */

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A stretch of the event loop long enough for everything a provider row starts to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** What a test can switch on the provider double, and what it reads off it. */
interface ProviderControl {
  /** While set, a resume fails the way a machine that cannot spawn a process does. */
  failResume: boolean
  /** When each resume was asked for, on a clock that is never set. */
  resumedAt: number[]
  /** While set, what the host does about scheduled jobs cannot be written. */
  attemptsCannotBeKept?: boolean
  /** While set, a resume waits for it before the provider is up. */
  holdResume?: Promise<void>
  /** While set, the disk fills as a resume is asked for: nothing can be written after it. */
  diskFillsOnResume?: boolean
  closeDrainTimeoutMs?: number
  writeAttempts?: (kept: KeptAttempts) => Promise<void>
  /** While set, the host has a saved key, read as a launch begins, before anything starts. */
  keys?: FakeKeys
}

type KeyDeps = NonNullable<ConstructorParameters<typeof RuntimeHost>[0]['apiKeys']>
const UNREADABLE_KEY = 'BroCrew can’t read the API key saved for Claude on this computer.'

/** A saved key that cannot be read until it is saved again, and how often it was read. */
interface FakeKeys {
  broken: boolean
  knownUnreadable: boolean
  reads: number
  readonly deps: KeyDeps
}
function fakeKeys(): FakeKeys {
  const keys = { broken: true, knownUnreadable: false, reads: 0 } as FakeKeys
  const deps: KeyDeps = {
    status: (provider) =>
      ({
        provider,
        set: true,
        setAt: 1,
        inUse: !keys.broken && !keys.knownUnreadable,
        ...(keys.knownUnreadable
          ? { readState: 'unreadable', unreadableReason: UNREADABLE_KEY }
          : {}),
      }) as ReturnType<KeyDeps['status']>,
    remove: () => {
      keys.broken = false
      keys.knownUnreadable = false
      return true
    },
    set: () => {
      keys.broken = false
      keys.knownUnreadable = false
      return null
    },
    read: () => {
      keys.reads += 1
      if (keys.broken) {
        keys.knownUnreadable = true
        throw new Error(UNREADABLE_KEY)
      }
      return null
    },
  }
  return Object.assign(keys, { deps })
}

/** The provider double: every handle it issues, a start and a resume alike. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    private readonly control: ProviderControl,
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
    if (this.control.diskFillsOnResume === true) this.control.attemptsCannotBeKept = true
    if (this.control.failResume) throw new Error('the machine refused to spawn')
    // The key is read as a launch begins, before anything is started.
    if (this.control.keys !== undefined) await this.control.keys.deps.read('claude')
    this.control.resumedAt.push(performance.now())
    if (this.control.holdResume !== undefined) await this.control.holdResume
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

interface Job {
  readonly id: string
  readonly schedule: string
  readonly recurring: boolean
  readonly prompt: string
}

const NIGHTLY: Job = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'run the nightly check',
}

/** A one-shot job a minute after ONE_SHOT_A. */
const LATER: Job = {
  id: 'job-later',
  schedule: '46 14 28 9 *',
  recurring: false,
  prompt: 'then this',
}

export { fakeKeys, LATER, NIGHTLY, ProviderDouble, settle, waitFor, type Job, type ProviderControl }
