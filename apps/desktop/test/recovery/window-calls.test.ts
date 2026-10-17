import { describe, expect, it } from 'vitest'
import {
  RECOVERY_CHANNELS,
  type HistoryOnlyGate,
  type StartupVerdict,
} from '../../src/shared/recovery'
import type { ClosableHistoryReader } from '../../src/main/recovery/history-reader'
import {
  INVOKED_CHANNELS,
  createRecoveryCalls,
  type RecoveryCalls,
} from '../../src/main/recovery/window-calls'
import { createFakeRecoveryService, type FakeVerdicts } from './lib/fake-recovery-service'

/**
 * What main answers the recovery window, against a scripted service: every call checked against the
 * verdict that stands, one restore, return or retry at a time, and the history reader closed before
 * any of them.
 */

const OFFER = {
  id: '0b5f0a3e-1c1a-4d55-9a54-6f3a8e1f2c11',
  createdAt: '2026-10-05T09:00:00.000Z',
  bytes: 4096,
}

const NEWER: StartupVerdict = {
  kind: 'newer',
  workspace: '/data',
  newer: { inTheDatabase: 8, inTheBuild: 7, madeBy: { appVersion: '0.2.0' } },
  offers: OFFER,
}

const GATE: HistoryOnlyGate = {
  format: 'brobot-history-only',
  version: 1,
  restoreId: '6a3e3c1d-55c8-4e36-9c40-0e9b7a0d7b21',
  checkpointId: OFFER.id,
  checkpointCreatedAt: OFFER.createdAt,
  installed: [{ live: 'brobot2.sqlite', present: true, sha256: 'a'.repeat(64) }],
  preserved: 'recovery/preserved/6a3e3c1d-55c8-4e36-9c40-0e9b7a0d7b21',
  preservedFiles: [{ live: 'brobot2.sqlite', present: true, sha256: 'b'.repeat(64) }],
}

const HISTORY_ONLY: StartupVerdict = {
  kind: 'history-only',
  gate: GATE,
  database: '/data/brobot2.sqlite',
}

const MAY_RETRY: StartupVerdict = {
  kind: 'failed',
  reason: 'checkpoint-failed',
  canRetry: true,
  detail: 'The disk is full.',
}

interface Harness {
  readonly calls: RecoveryCalls
  readonly service: ReturnType<typeof createFakeRecoveryService>
  readonly sent: StartupVerdict[]
  readonly progress: (readonly [number, number])[]
  readonly readers: { file: string; closed: boolean }[]
  readonly ended: string[]
}

function harness(verdict: StartupVerdict, script: Omit<FakeVerdicts, 'inspect'> = {}): Harness {
  const service = createFakeRecoveryService({ inspect: verdict, ...script })
  const sent: StartupVerdict[] = []
  const progress: (readonly [number, number])[] = []
  const readers: { file: string; closed: boolean }[] = []
  const ended: string[] = []
  const calls = createRecoveryCalls({
    service,
    verdict,
    openReader: (file): ClosableHistoryReader => {
      const reader = { file, closed: false }
      readers.push(reader)
      return {
        conversations: () => Promise.resolve([]),
        transcript: () => Promise.resolve([]),
        workingFolder: () => Promise.resolve(null),
        close: () => {
          reader.closed = true
        },
      }
    },
    zone: () => null,
    sendVerdict: (settled) => sent.push(settled),
    sendProgress: (done, total) => progress.push([done, total]),
    quit: () => ended.push('quit'),
    relaunch: () => ended.push('relaunch'),
  })
  return { calls, service, sent, progress, readers, ended }
}

describe('the recovery window’s calls', () => {
  it('are exactly the channels the window invokes', () => {
    expect([...INVOKED_CHANNELS].sort()).toEqual(
      Object.values(RECOVERY_CHANNELS)
        .filter((channel) => channel !== RECOVERY_CHANNELS.progress)
        .sort(),
    )
  })

  it('answer the verdict that stands, and the zone', async () => {
    const { calls } = harness(NEWER)
    expect(await calls.answer(RECOVERY_CHANNELS.verdict, [])).toEqual(NEWER)
    expect(await calls.answer(RECOVERY_CHANNELS.zone, [])).toBeNull()
  })

  it('restore only the copy the verdict offers, and send the settled verdict once', async () => {
    const { calls, service, sent, progress } = harness(NEWER, {
      restore: HISTORY_ONLY,
      progress: [
        [1, 6],
        [6, 6],
      ],
    })
    await expect(calls.answer(RECOVERY_CHANNELS.restore, ['../escape'])).rejects.toThrow(
      /not a recovery copy/,
    )
    await expect(
      calls.answer(RECOVERY_CHANNELS.restore, ['1e0c8f9d-6b77-4c5a-8c3e-2a7c1d9e4f00']),
    ).rejects.toThrow(/not the one offered/)
    await expect(calls.answer(RECOVERY_CHANNELS.restore, [42])).rejects.toThrow()
    // A plain name is not a copy's id either: only an id the app made, a lowercase UUID.
    for (const id of ['CON', 'a-copy', OFFER.id.toUpperCase()]) {
      await expect(calls.answer(RECOVERY_CHANNELS.restore, [id])).rejects.toThrow(
        /not a recovery copy/,
      )
    }
    expect(service.calls).toEqual([])

    expect(await calls.answer(RECOVERY_CHANNELS.restore, [OFFER.id])).toEqual(HISTORY_ONLY)
    expect(service.calls).toEqual([{ call: 'restore', checkpointId: OFFER.id }])
    expect(progress).toEqual([
      [1, 6],
      [6, 6],
    ])
    expect(sent).toEqual([HISTORY_ONLY])
    expect(calls.current()).toEqual(HISTORY_ONLY)
  })

  it('run one step at a time, and say it is working while it runs', async () => {
    let release = (): void => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls } = harness(NEWER, { restore: HISTORY_ONLY, hold })
    const running = calls.answer(RECOVERY_CHANNELS.restore, [OFFER.id])
    await Promise.resolve()
    expect(calls.current()).toEqual({ kind: 'working', what: 'restore' })
    await expect(calls.answer(RECOVERY_CHANNELS.restore, [OFFER.id])).rejects.toThrow()
    await expect(calls.answer(RECOVERY_CHANNELS.conversations, [])).rejects.toThrow()
    release()
    expect(await running).toEqual(HISTORY_ONLY)
  })

  it('read the restored copy only while it is open to be read, and close the reader before a return', async () => {
    const { calls, readers } = harness(NEWER)
    await expect(calls.answer(RECOVERY_CHANNELS.conversations, [])).rejects.toThrow(
      /no restored copy/,
    )
    expect(readers).toEqual([])

    const reading = harness(HISTORY_ONLY, { returnToNewer: NEWER })
    expect(await reading.calls.answer(RECOVERY_CHANNELS.conversations, [])).toEqual([])
    expect(await reading.calls.answer(RECOVERY_CHANNELS.transcript, ['conversation-1'])).toEqual([])
    await expect(reading.calls.answer(RECOVERY_CHANNELS.transcript, [''])).rejects.toThrow()
    await expect(
      reading.calls.answer(RECOVERY_CHANNELS.transcript, ['x'.repeat(201)]),
    ).rejects.toThrow()
    expect(reading.readers).toEqual([{ file: HISTORY_ONLY.database, closed: false }])

    expect(await reading.calls.answer(RECOVERY_CHANNELS.return, [])).toEqual(NEWER)
    expect(reading.readers).toEqual([{ file: HISTORY_ONLY.database, closed: true }])
    await expect(reading.calls.answer(RECOVERY_CHANNELS.return, [])).rejects.toThrow(
      /not a restored copy/,
    )
  })

  it('retry only after a failure that may pass, and relaunch when the data now opens', async () => {
    const refused = harness({ ...MAY_RETRY, canRetry: false }, { retry: NEWER })
    await expect(refused.calls.answer(RECOVERY_CHANNELS.retry, [])).rejects.toThrow()
    expect(refused.service.calls).toEqual([])

    const opens = harness(MAY_RETRY, { retry: { kind: 'open', checkpoint: 'made' } })
    expect(await opens.calls.answer(RECOVERY_CHANNELS.retry, [])).toEqual({
      kind: 'open',
      checkpoint: 'made',
    })
    expect(opens.ended).toEqual(['relaunch'])
  })

  it('try a failed migration again by starting the app again, with no check of their own', async () => {
    const migration: StartupVerdict = {
      kind: 'failed',
      reason: 'migration-failed',
      canRetry: true,
      detail: 'It broke.',
    }
    const { calls, service, ended } = harness(migration, {
      retry: { kind: 'open', checkpoint: 'made' },
    })
    expect(await calls.answer(RECOVERY_CHANNELS.retry, [])).toEqual(migration)
    expect(service.calls).toEqual([])
    expect(ended).toEqual(['relaunch'])
  })

  it('keep the verdict that stood when a step throws', async () => {
    const { calls, sent } = harness(NEWER, { restore: new Error('the disk went away') })
    await expect(calls.answer(RECOVERY_CHANNELS.restore, [OFFER.id])).rejects.toThrow(
      'the disk went away',
    )
    expect(calls.current()).toEqual(NEWER)
    expect(sent).toEqual([])
  })

  it('quit after closing the reader, and refuse a channel they do not answer', async () => {
    const { calls, readers, ended } = harness(HISTORY_ONLY)
    await calls.answer(RECOVERY_CHANNELS.conversations, [])
    await calls.answer(RECOVERY_CHANNELS.quit, [])
    expect(readers.map((reader) => reader.closed)).toEqual([true])
    expect(ended).toEqual(['quit'])
    await expect(calls.answer('app:info', [])).rejects.toThrow(/does not answer/)
  })

  it('send a verdict settled outside the calls, and progress, to a window that may be gone', async () => {
    const { calls, sent } = harness({ kind: 'working', what: 'checkpoint' })
    calls.settle(MAY_RETRY)
    expect(sent).toEqual([MAY_RETRY])
    expect(await calls.answer(RECOVERY_CHANNELS.verdict, [])).toEqual(MAY_RETRY)

    const gone = createRecoveryCalls({
      service: createFakeRecoveryService({ inspect: NEWER }),
      verdict: NEWER,
      openReader: () => {
        throw new Error('no reader here')
      },
      zone: () => null,
      sendVerdict: () => {
        throw new Error('the window is gone')
      },
      sendProgress: () => {
        throw new Error('the window is gone')
      },
      quit: () => undefined,
      relaunch: () => undefined,
    })
    expect(() => gone.settle(MAY_RETRY)).not.toThrow()
    expect(() => gone.progress(1, 2)).not.toThrow()
  })
})
