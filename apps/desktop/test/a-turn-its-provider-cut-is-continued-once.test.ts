import {
  aTurnTheAppCutFixture,
  now,
  root,
  window,
  handles,
  waitFor,
  settle,
  aGate,
  CUT,
  SOON,
  TOO_LATE,
  GAP,
  ACCOUNT_WAIT,
  PROGRAM_WAIT,
  LIMIT_GAP,
  LIMIT_LOOK,
} from './helpers/a-turn-the-app-cut-fixture'
import type { Stops } from './helpers/cut-account-cases'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it, vi } from 'vitest'
import type { FakeSessionHandle } from '@brobot2/runtime'
import { THE_APP_ITSELF } from './helpers/giver-notice-host'
import { aTurnTheAppCutText } from '../src/main/runtime/host-split/wakes-and-restarts'
import { turnsTheAppCutIn } from '../src/main/turns-the-app-cut-file'

describe('a turn the app cut is continued once, on the account it ran on', () => {
  const app = aTurnTheAppCutFixture()
  const { starts, aTurnRunsIn, stateOf, continuations, askedFor, running, providerIdOf } = app

  /** The conversation's latest provider handle. */
  const itsHandle = (id: string): FakeSessionHandle => {
    const ref = providerIdOf(id)
    const found = handles.filter((one) => one.ref.sessionId === ref).at(-1)
    if (found === undefined) throw new Error(`${id} has no provider handle`)
    return found
  }
  /** Its provider's program stops while its turn runs, as a process that exits ends a session. */
  const itsProgramStops = (id: string): void => {
    itsHandle(id).simulateError('the provider process exited', true)
  }
  /** Its running turn ends on Claude's usage limit, which resets this long from now. */
  const itsTurnMeetsTheLimit = (
    id: string,
    resetsInMs: number | null,
    more: { readonly creditsRequired?: true } = {},
  ): number => {
    const resetsAt = app.clock + (resetsInMs ?? 0)
    const fake = itsHandle(id) as unknown as {
      push(event: unknown): void
      machine: { completeTurn(outcome: string, message?: string, limit?: unknown): void }
    }
    // ⚑ As Claude's adapter says it first: the limit's own line, which the hold reads.
    const resets = resetsInMs === null ? '' : `; resets ${new Date(resetsAt).toISOString()}`
    fake.push({
      type: 'error',
      message: `claude is rate-limited (five_hour) — the turn may stall until it resets${resets}`,
      fatal: false,
    })
    fake.machine.completeTurn('failed', 'You have reached your usage limit.', {
      provider: 'claude',
      window: 'five_hour',
      ...(resetsInMs === null ? {} : { resetsAt }),
      ...more,
    })
    return resetsAt
  }
  /** The person's own Stop, as a window asks it. */
  const aPersonCloses = (id: string): Promise<void> => now.host.close(id, window)

  describe('a program that stopped while its turn ran', () => {
    it('leaves a Codex program cut on a saved key for the person to resume', async () => {
      const a = await aTurnRunsIn({ provider: 'codex', savedKeyRevision: 17 })
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the saved-key program to end')
      await waitFor(() => typeof stateOf(a) === 'object', 'the unknown account decision')
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      const sent = await now.host.startAndSend(a, 'continue the work', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      expect(askedFor(now, a)).toBe(2)
    })

    it.each(['quit', 'crash'] as const)(
      'does not automatically continue a Codex saved-key turn after a %s',
      async (kind) => {
        const a = await aTurnRunsIn({ provider: 'codex', savedKeyRevision: 17 })
        if (kind === 'quit') await now.host.closeAll()
        starts(SOON, { provider: 'codex', savedKeyRevision: 17 })
        await waitFor(() => typeof stateOf(a) === 'object', 'the unknown account decision')
        expect(continuations(a)).toEqual([])
        expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      },
    )

    it('does not continue a Codex saved-key cut on a replacement key revision', async () => {
      const a = await aTurnRunsIn({ provider: 'codex', savedKeyRevision: 17 })
      await now.host.closeAll()
      starts(SOON, { provider: 'codex', savedKeyRevision: 18 })
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    it('is started once after the wait, and its words go as that life’s first turn', async () => {
      const a = await aTurnRunsIn()
      const stopped = performance.now()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      expect(stateOf(a)).toBe('pending')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT / 3))
      expect(askedFor(now, a)).toBe(1)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(2)
      expect((now.startedAt.at(-1) ?? 0) - stopped).toBeGreaterThanOrEqual(PROGRAM_WAIT - 5)
      expect(continuations(a)).toEqual([aTurnTheAppCutText('program', CUT, app.clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
      await settle()
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a turn a stop was asked of: no cut, and no start', async () => {
      const a = await aTurnRunsIn()
      await now.host.interrupt(a, window)
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toBeUndefined()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a login its provider refused is not a stopped program', async () => {
      const a = await aTurnRunsIn()
      const fake = itsHandle(a) as unknown as {
        push(event: unknown): void
        machine: { fatalAfterReportedError(said: { loginRefused: boolean }): void }
        queue: { close(): void }
      }
      fake.push({ type: 'error', message: 'token expired', fatal: true, cause: 'auth_stale' })
      fake.machine.fatalAfterReportedError({ loginRefused: true })
      fake.queue.close()
      await waitFor(() => !running(now, a), 'the conversation to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toBeUndefined()
      expect(continuations(a)).toEqual([])
    })

    it('a continuation whose program stops again is continued once more, and a third stop waits for a person', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => stateOf(a) === 'sent', 'the first continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the second continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end a third time')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(askedFor(now, a)).toBe(3)
      expect(continuations(a)).toHaveLength(2)
    })

    it('any mix counts toward the two: a program’s continuation, then a limit’s, then a third cut waits', async () => {
      const a = await aTurnRunsIn({ limitLookMs: LIMIT_LOOK })
      itsProgramStops(a)
      await waitFor(() => stateOf(a) === 'sent', 'the first continuation to be sent')
      await settle()
      const resetsAt = itsTurnMeetsTheLimit(a, 60 * 60_000)
      await settle()
      expect(stateOf(a)).toBe('pending')
      app.clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the second continuation to be sent')
      await settle()
      itsProgramStops(a)
      await waitFor(() => typeof stateOf(a) === 'object', 'the third cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(continuations(a)).toHaveLength(2)
    })

    it('⛔ on another account when it starts again: not continued, and that life is stopped again', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      ;(now.stops as { account?: Stops['account'] }).account = 'bea'
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'not-same-account' })
      expect(continuations(a)).toEqual([])
      expect(running(now, a)).toBe(false)
    })

    it('⛔ a person who writes first: the start their words make carries no stale continuation', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      const sent = await now.host.startAndSend(a, 'are you there?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a start that fails is not tried again', async () => {
      const a = await aTurnRunsIn({ startsFailFor: 'agent-a' })
      itsProgramStops(a)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 200))
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'start-failed' })
      expect(askedFor(now, a)).toBe(2)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a newer cut during the wait is not the program’s wake to act on: a limit’s waits for its reset', async () => {
      const a = await aTurnRunsIn({ limitLookMs: LIMIT_LOOK, programWaitMs: 4 * PROGRAM_WAIT })
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      const sent = await now.host.startAndSend(a, 'are you there?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => running(now, a), 'the person’s start')
      await settle()
      const resetsAt = itsTurnMeetsTheLimit(a, 60 * 60_000)
      await settle()
      expect(turnsTheAppCutIn(now.db).read().cuts[a]?.kind).toBe('limit')
      await new Promise((resolve) => setTimeout(resolve, 4 * PROGRAM_WAIT + 300))
      await settle()
      expect(stateOf(a)).toBe('pending')
      app.clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the limit’s continuation')
      expect(continuations(a)).toEqual([
        aTurnTheAppCutText('limit', resetsAt - 60 * 60_000, app.clock, 'claude'),
      ])
    })

    it('a teardown that outlasts the wait: its start waits it out, then continues it', async () => {
      const teardown = aGate()
      const a = await aTurnRunsIn({ closeWaitsFor: teardown })
      itsProgramStops(a)
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 4 * GAP + 400))
      expect(stateOf(a)).toBe('starting')
      expect(continuations(a)).toEqual([])
      teardown.open()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await waitFor(() => stateOf(a) === 'sent', 'the continuation to be sent')
      expect(askedFor(now, a)).toBe(2)
    })

    it('⛔ a person who writes while that teardown is held: their words go, and no stale continuation', async () => {
      const teardown = aGate()
      const a = await aTurnRunsIn({ closeWaitsFor: teardown })
      itsProgramStops(a)
      await new Promise((resolve) => setTimeout(resolve, PROGRAM_WAIT + 4 * GAP + 400))
      expect(stateOf(a)).toBe('starting')
      const sending = now.host.startAndSend(a, 'are you there?', window)
      teardown.open()
      const sent = await sending
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
    })

    it('a quit during the wait: the next launch continues it once', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await now.host.closeAll()
      expect(stateOf(a)).toBe('pending')
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ …but not more than an hour after it stopped', async () => {
      const a = await aTurnRunsIn()
      itsProgramStops(a)
      await waitFor(() => !running(now, a), 'the conversation to end')
      await now.host.closeAll()
      starts(TOO_LATE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })
  })

  describe('a turn its usage limit ended', () => {
    const anHour = 60 * 60_000
    const limited = { limitLookMs: LIMIT_LOOK } as const

    it('is continued once its limit resets, on the life still running', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      app.clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(continuations(a)).toEqual([aTurnTheAppCutText('limit', CUT, app.clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
      expect(askedFor(now, a)).toBe(1)
    })

    it('is started once for it after its reset, when the app stopped it meanwhile', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      expect(stateOf(a)).toBe('pending')
      app.clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(2)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a person who closes it ends its wait', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await aPersonCloses(a)
      expect(stateOf(a)).toEqual({ ended: 'stopped' })
      app.clock = resetsAt + 1_000
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(continuations(a)).toEqual([])
    })

    it.each([
      ['with no reset', null, {}, 'no-reset'],
      [
        'when it needs credits bought',
        anHour,
        { creditsRequired: true as const },
        'credits-required',
      ],
      ['when its reset is more than a day away', 25 * anHour, {}, 'reset-too-far'],
    ] as const)('⛔ %s, it is not continued', async (_what, resetsIn, more, why) => {
      const a = await aTurnRunsIn(limited)
      itsTurnMeetsTheLimit(a, resetsIn, more)
      await settle()
      expect(stateOf(a)).toEqual({ ended: why })
      app.clock += 26 * anHour
      await settle()
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a continuation held up until a day after its cut is not handed over', async () => {
      const a = await aTurnRunsIn({ ...limited, accountAfterMs: ACCOUNT_WAIT - 50 })
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_WAIT))
      const day = 24 * anHour
      const cutAt = app.clock
      const resetsAt = itsTurnMeetsTheLimit(a, day - 60_000)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      expect(stateOf(a)).toBe('pending')
      const before = now.startedAt.length
      app.clock = resetsAt + 1_000
      // Its start is made, and its account is read for a while: the day passes meanwhile.
      await waitFor(() => now.startedAt.length > before, 'its start')
      app.clock = cutAt + day + 60_000
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'reset-too-far' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a limit read that fails at the reset holds it, and it goes once the read answers', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      const read = now.store.providerLimitsSeen.bind(now.store)
      const failing = vi.spyOn(now.store, 'providerLimitsSeen').mockImplementation(() => {
        throw new Error('the disk could not be read')
      })
      app.clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      failing.mockImplementation(read)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ a limit row that cannot be read holds it at the reset, and it goes once the row reads', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      const wall = now.db
        .prepare(
          `SELECT id, payload FROM events WHERE session_id = ? AND type = 'error' AND payload LIKE '%rate-limited%'`,
        )
        .all(a) as { id: string; payload: string }[]
      expect(wall).toHaveLength(1)
      const [row] = wall
      if (row === undefined) throw new Error('no wall row')
      const torn = row.payload.slice(0, row.payload.indexOf('resets'))
      now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(torn, row.id)
      app.clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ held words whose last wait before the handover crosses a day from the cut: not handed over, and the life started for them is stopped again', async () => {
      const a = await aTurnRunsIn(limited)
      const day = 24 * anHour
      const cutAt = app.clock
      const resetsAt = itsTurnMeetsTheLimit(a, day - 60_000)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      const gate = aGate()
      now.stops.signInGate = gate
      app.clock = resetsAt + 1_000
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      expect(continuations(a)).toEqual([])
      app.clock = cutAt + day + 60_000
      gate.open()
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'reset-too-far' })
      await waitFor(() => !running(now, a), 'its life to stop')
    })

    it.each(['a read of the limits that fails', 'a limit row that cannot be read'] as const)(
      '⛔ held words whose last wait before the handover ends on %s: not handed over, and the life started for them is stopped again',
      async (what) => {
        const a = await aTurnRunsIn(limited)
        const resetsAt = itsTurnMeetsTheLimit(a, anHour)
        await settle()
        await now.host.close(a, THE_APP_ITSELF)
        const gate = aGate()
        now.stops.signInGate = gate
        app.clock = resetsAt + 1_000
        await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
        await settle()
        expect(continuations(a)).toEqual([])
        let restore: () => void
        if (what === 'a read of the limits that fails') {
          const failing = vi.spyOn(now.store, 'providerLimitsSeen').mockImplementation(() => {
            throw new Error('the disk could not be read')
          })
          restore = () => failing.mockRestore()
        } else {
          const [row] = now.db
            .prepare(
              `SELECT id, payload FROM events WHERE session_id = ? AND type = 'error' AND payload LIKE '%rate-limited%'`,
            )
            .all(a) as { id: string; payload: string }[]
          if (row === undefined) throw new Error('no wall row')
          const torn = row.payload.slice(0, row.payload.indexOf('resets'))
          now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(torn, row.id)
          restore = () => {
            now.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
          }
        }
        gate.open()
        await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
        await settle()
        expect(continuations(a)).toEqual([])
        expect(stateOf(a)).toEqual({ ended: 'limited' })
        await waitFor(() => !running(now, a), 'its life to stop')
        restore()
      },
    )

    it('⛔ a limit standing with no reset at its reset time holds it, and it goes once that limit is gone', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      // Another conversation's own limit line, which names no reset.
      now.store.create({
        id: 'sess_wall',
        provider: 'claude',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'default',
      })
      now.store.append(
        'sess_wall',
        0,
        {
          type: 'error',
          message: 'claude is rate-limited (five_hour) — the turn may stall until it resets',
          fatal: false,
        } as TranscriptEvent,
        app.clock,
      )
      app.clock = resetsAt + 1_000
      await settle()
      expect(stateOf(a)).toBe('pending')
      expect(continuations(a)).toEqual([])
      now.db.prepare(`DELETE FROM events WHERE session_id = 'sess_wall'`).run()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
    })

    it('⛔ newer words before the reset: no stale continuation', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.send(a, 'try something else', window)
      await settle()
      app.clock = resetsAt + 1_000
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
      expect(continuations(a)).toEqual([])
    })

    it('a continuation that meets the limit again waits again once, and a third cut waits for a person', async () => {
      const a = await aTurnRunsIn(limited)
      for (let round = 1; round <= 2; round++) {
        const resetsAt = itsTurnMeetsTheLimit(a, anHour)
        await settle()
        expect(stateOf(a)).toBe('pending')
        app.clock = resetsAt + 1_000
        await waitFor(() => continuations(a).length === round, `continuation ${String(round)}`)
        await waitFor(() => stateOf(a) === 'sent', `continuation ${String(round)} sent`)
        await settle()
      }
      itsTurnMeetsTheLimit(a, anHour)
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
      expect(continuations(a)).toHaveLength(2)
    })

    it('two cut by one limit are started after its reset, apart', async () => {
      const a = await aTurnRunsIn(limited)
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      itsTurnMeetsTheLimit(a, anHour)
      const resetsAt = itsTurnMeetsTheLimit(b, anHour)
      await settle()
      await now.host.close(a, THE_APP_ITSELF)
      await now.host.close(b, THE_APP_ITSELF)
      const before = now.startedAt.length
      app.clock = resetsAt + 1_000
      await waitFor(
        () => continuations(a).length === 1 && continuations(b).length === 1,
        'both continuations',
      )
      const [first, second] = now.startedAt.slice(before)
      expect(now.startedAt.slice(before)).toHaveLength(2)
      expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(LIMIT_GAP - 5)
    })

    it('a restart before its reset: the next launch waits for it, then continues it', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.closeAll()
      starts(app.clock + 60_000, limited)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toBe('pending')
      app.clock = resetsAt + 1_000
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a launch more than an hour after its reset does not continue it', async () => {
      const a = await aTurnRunsIn(limited)
      const resetsAt = itsTurnMeetsTheLimit(a, anHour)
      await settle()
      await now.host.closeAll()
      starts(resetsAt + anHour + 60_000, limited)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })
  })
})
