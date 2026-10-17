import type {
  ProgressListener,
  RecoveryService,
  StartupVerdict,
} from '../../../src/shared/recovery'

/**
 * A {@link RecoveryService} that answers scripted verdicts and touches no file, for tests of what
 * stands between the service and the recovery window: the IPC handlers, the window's choice of
 * screen, and quitting.
 *
 * It keeps a current verdict, as the real service's next start would find it: `inspect()` answers
 * it, and a restore, a return or a retry that answers a verdict makes that verdict current.
 */

/** A scripted answer: a verdict, or an error the call rejects with. */
export type FakeAnswer = StartupVerdict | Error

export interface FakeVerdicts {
  /** What `inspect()` answers until another call answers a verdict. */
  readonly inspect: StartupVerdict
  /** What each call answers, in turn; the last one answers again once the list runs out. */
  readonly restore?: FakeAnswer | readonly FakeAnswer[]
  readonly returnToNewer?: FakeAnswer | readonly FakeAnswer[]
  readonly retry?: FakeAnswer | readonly FakeAnswer[]
  /** What a restore or a return reports to its listener before it answers, as [done, total]. */
  readonly progress?: readonly (readonly [number, number])[]
  /** When given, a restore or a return waits for it after its progress and before it answers. */
  readonly hold?: Promise<void>
}

export type FakeRecoveryCall =
  | { readonly call: 'inspect' }
  | { readonly call: 'restore'; readonly checkpointId: string }
  | { readonly call: 'returnToNewer' }
  | { readonly call: 'retry' }

export interface FakeRecoveryService extends RecoveryService {
  /** Every call so far, in order. */
  readonly calls: readonly FakeRecoveryCall[]
  /** What `inspect()` would answer now. */
  current(): StartupVerdict
}

type Scripted = 'restore' | 'returnToNewer' | 'retry'

export function createFakeRecoveryService(verdicts: FakeVerdicts): FakeRecoveryService {
  const calls: FakeRecoveryCall[] = []
  let current = verdicts.inspect
  const asked: Record<Scripted, number> = { restore: 0, returnToNewer: 0, retry: 0 }

  function answer(call: Scripted): StartupVerdict {
    const script = verdicts[call]
    if (script === undefined) throw new Error(`no verdict was scripted for ${call}()`)
    const list: readonly FakeAnswer[] = Array.isArray(script) ? script : [script as FakeAnswer]
    const next = list[Math.min(asked[call], list.length - 1)]
    asked[call] += 1
    if (next === undefined) throw new Error(`no verdict was scripted for ${call}()`)
    if (next instanceof Error) throw next
    current = next
    return next
  }

  async function working(call: Scripted, progress: ProgressListener): Promise<StartupVerdict> {
    for (const [done, total] of verdicts.progress ?? []) {
      progress(done, total)
      await Promise.resolve()
    }
    if (verdicts.hold !== undefined) await verdicts.hold
    return answer(call)
  }

  return {
    calls,
    current: () => current,
    async inspect() {
      calls.push({ call: 'inspect' })
      return current
    },
    restore(checkpointId, progress) {
      calls.push({ call: 'restore', checkpointId })
      return working('restore', progress)
    },
    returnToNewer(progress) {
      calls.push({ call: 'returnToNewer' })
      return working('returnToNewer', progress)
    },
    async retry() {
      calls.push({ call: 'retry' })
      return answer('retry')
    },
  }
}
