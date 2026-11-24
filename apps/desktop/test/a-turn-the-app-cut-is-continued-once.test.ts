import {
  registerPersistedCutIdentityCases,
  registerLegacyCutIdentityCase,
  registerFrozenCutAccountCases,
  type Gate,
} from './helpers/cut-account-cases'
import {
  aTurnTheAppCutFixture,
  now,
  root,
  window,
  handles,
  waitFor,
  settle,
  held,
  aGate,
  CUT,
  SOON,
  TOO_LATE,
  GAP,
} from './helpers/a-turn-the-app-cut-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { aTurnTheAppCutText } from '../src/main/runtime/host-split/wakes-and-restarts'
import { turnsTheAppCutIn } from '../src/main/turns-the-app-cut-file'

/**
 * **A turn this app's quit, or a crash, cut is continued once, on the account it ran on, at the
 * next launch** — and never twice, never on another account, never after newer work, never for a
 * turn a person stopped or that waited on a person.
 */

describe('a turn the app cut is continued once, on the account it ran on', () => {
  const app = aTurnTheAppCutFixture()
  const {
    tick,
    starts,
    aTurnRunsIn,
    stateOf,
    continuations,
    heldCount,
    askedFor,
    running,
    ledger,
    theLimitIsReached,
    itsNewestLaunch,
    accountCases,
  } = app

  it('does not continue a cut overtaken after pre-use repair but before deferred activation', async () => {
    const conversation = await aTurnRunsIn()
    await now.host.closeAll()
    starts(SOON, {}, true, false)
    await now.host.look(conversation, window, false)
    expect(stateOf(conversation)).toBe('pending')
    now.store.append(
      conversation,
      now.store.nextOrdinal(conversation),
      { type: 'user_turn', text: 'Newer work before the deferred activation' },
      tick(),
    )
    now.host.firstListPainted()
    await settle()
    expect(askedFor(now, conversation)).toBe(0)
    expect(continuations(conversation)).toEqual([])
    expect(stateOf(conversation)).toEqual({ ended: 'overtaken' })
  })

  describe('a quit that cut a running turn', () => {
    registerPersistedCutIdentityCases(accountCases)

    it.each([false, true])(
      'the next launch continues it once, on the same account, saying when the app restarted (deferred %s)',
      async (deferred) => {
        const a = await aTurnRunsIn()
        await now.host.closeAll()
        expect(stateOf(a)).toBe('pending')

        starts(SOON, {}, deferred)
        await waitFor(() => continuations(a).length === 1, 'the continuation')
        await settle()
        expect(askedFor(now, a)).toBe(1)
        expect(continuations(a)).toEqual([aTurnTheAppCutText('quit', CUT, app.clock, 'claude')])
        expect(stateOf(a)).toBe('sent')

        // ⛔ …and once: a further launch does nothing more.
        await now.host.closeAll()
        starts(SOON + 60_000, {}, deferred)
        await settle()
        expect(askedFor(now, a)).toBe(0)
        expect(continuations(a)).toHaveLength(1)
      },
    )

    it('an idle conversation at the quit has no cut', async () => {
      starts(CUT - 60_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'quick one', window)
      await settle()
      await now.host.closeAll()
      expect(stateOf(sessionId)).toBeUndefined()
      starts(SOON)
      await settle()
      expect(askedFor(now, sessionId)).toBe(0)
    })

    it('⛔ more than an hour later, it is not continued', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(TOO_LATE)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'too-old' })
    })

    it.each([false, true])(
      '⛔ on another account, it is not continued, and the life started for it is stopped again (deferred %s)',
      async (deferred) => {
        const a = await aTurnRunsIn()
        await now.host.closeAll()
        starts(SOON, { account: 'bea' }, deferred)
        await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
        await settle()
        expect(askedFor(now, a)).toBe(1)
        expect(continuations(a)).toEqual([])
        expect(heldCount(a)).toBe(0)
        expect(stateOf(a)).toEqual({ ended: 'not-same-account' })
        expect(running(now, a)).toBe(false)
      },
    )

    registerLegacyCutIdentityCase(accountCases)

    it('⛔ with an account that does not answer in time, it is not continued and not tried again', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON, { account: 'never' })
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      await now.host.closeAll()
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
    })

    it('⛔ a turn that went in before the next launch that continues anything: no stale continuation', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      // A life that continues nothing, in which a person writes and the turn ends.
      starts(SOON, { nobodyListens: true })
      const sent = await now.host.startAndSend(a, 'where were we?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      await now.host.closeAll()
      expect(stateOf(a)).toBe('pending')
      starts(SOON + 60_000)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a quit while the continuation is being handed over: never sent again, and no start for it', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      const taken = held('the words are never taken')
      starts(SOON, { beforeTheWordsAreTaken: taken })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      await now.host.closeAll()
      expect(stateOf(a)).toEqual({ ended: 'handover-uncertain' })
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a person who writes first takes the conversation: no stale continuation follows', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON, { account: 'never' })
      const sent = await now.host.startAndSend(a, 'where were we?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })
  })

  describe('a quit cut short', () => {
    it('the turns it was cutting, kept before the first close, are continued with the quit’s words', async () => {
      const a = await aTurnRunsIn()
      const host = now.host as unknown as {
        whatTheQuitCloses(): unknown[]
        keepTheTurnsTheQuitCuts(closing: unknown[]): void
      }
      // The quit keeps what it is about to cut, then dies before any close.
      host.keepTheTurnsTheQuitCuts(host.whatTheQuitCloses())
      expect(stateOf(a)).toBe('pending')
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      expect(continuations(a)).toEqual([aTurnTheAppCutText('quit', CUT, app.clock, 'claude')])
    })
  })

  describe('the account, frozen to the life', () => {
    registerFrozenCutAccountCases(accountCases)

    it('a key without a confirmed account cannot authorize automatic continuation', async () => {
      const a = await aTurnRunsIn({ account: 'none', tag: 'key-a' })
      await now.host.closeAll()
      starts(SOON, { account: 'none', tag: 'key-b' })
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      expect(continuations(a)).toEqual([])

      const b = await aTurnRunsIn({ account: 'none', tag: 'key-a' })
      await now.host.closeAll()
      starts(SOON + 120_000, { account: 'none', tag: 'key-a' })
      await waitFor(() => typeof stateOf(b) === 'object', 'the unknown account decision')
      expect(stateOf(b)).toEqual({ ended: 'account-not-known' })
      expect(continuations(b)).toEqual([])
    })

    it('⛔ a crash in a life whose account was never known does not take an earlier life’s', async () => {
      // The first life's account is known, and its turn ends.
      starts(CUT - 120_000)
      const { sessionId: a } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(a, 'quick one', window)
      await settle()
      await now.host.closeAll()
      // The next life never learns its account, and crashes in a turn.
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    /** A first life on Ada whose turn ends, then a quit: its account is kept for the conversation. */
    const aFirstLifeOnAda = async (): Promise<string> => {
      starts(CUT - 120_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'quick one', window)
      await settle()
      await now.host.closeAll()
      return sessionId
    }

    it('⛔ a crash after the earlier life’s account could not be let go does not take it', async () => {
      const a = await aFirstLifeOnAda()
      expect(turnsTheAppCutIn(now.db).read().lives[a]).toBeDefined()
      // Nothing can be written in this life, and its account is never learned; it crashes in a turn.
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true, cutsCannotBeKept: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      // The next launch can write again, on the first life's account.
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    it('⛔ an earlier life’s account kept with the very moment the crashed life began does not bind it', async () => {
      const a = await aFirstLifeOnAda()
      const earlier = turnsTheAppCutIn(now.db).read().lives[a]
      if (earlier === undefined) throw new Error('the first life kept no account')
      starts(CUT - 60_000, { account: 'never', turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      const since = (
        now.host as unknown as { slots: Map<string, { session: { lifeSince: number } }> }
      ).slots.get(a)?.session.lifeSince
      if (since === undefined) throw new Error('the second life is not running')
      const kept = turnsTheAppCutIn(now.db).read()
      turnsTheAppCutIn(now.db).write({
        ...kept,
        lives: { ...kept.lives, [a]: { ...earlier, since } },
      })
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
    })

    it('an account its provider names only after the life’s launch row is kept for that life, and a crash is continued on it', async () => {
      const a = await aTurnRunsIn({ accountAfterMs: 120 })
      await waitFor(
        () => turnsTheAppCutIn(now.db).read().lives[a] !== undefined,
        'the account to be kept',
      )
      expect(turnsTheAppCutIn(now.db).read().lives[a]?.launched).toBe(itsNewestLaunch(a))
      starts(SOON, { accountAfterMs: 120 })
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('…and so in a reopened life', async () => {
      const a = await aFirstLifeOnAda()
      starts(CUT - 60_000, { turnsStayOpen: true, accountAfterMs: 120 })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(
        () => turnsTheAppCutIn(now.db).read().lives[a]?.launched === itsNewestLaunch(a),
        'the reopened life’s account to be kept',
      )
      starts(SOON, { accountAfterMs: 120 })
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('a crash in a reopened life is continued on that life’s own account', async () => {
      const a = await aFirstLifeOnAda()
      starts(CUT - 60_000, { turnsStayOpen: true })
      const sent = await now.host.startAndSend(a, 'build the thing', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await settle()
      expect(turnsTheAppCutIn(now.db).read().lives[a]?.launched).toBe(itsNewestLaunch(a))
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ an account named by its email and one named by its launch credential are not compared, and stop no other cut', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      await now.host.closeAll()
      // The next life's account read names no email: only its launch credential's tag is known.
      starts(SOON, { account: 'none', tag: 'key-a' })
      await waitFor(
        () => typeof stateOf(a) === 'object' && typeof stateOf(b) === 'object',
        'both cuts to end',
      )
      await settle()
      expect(stateOf(a)).toEqual({ ended: 'account-not-known' })
      expect(stateOf(b)).toEqual({ ended: 'account-not-known' })
      expect(now.asked).toHaveLength(2)
      expect(continuations(a)).toEqual([])
      expect(continuations(b)).toEqual([])
    })

    it('⛔ once another account is found, no other cut of that provider and profile is continued', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      await now.host.closeAll()
      starts(SOON, { account: 'bea' })
      await waitFor(
        () => typeof stateOf(a) === 'object' && typeof stateOf(b) === 'object',
        'both cuts to end',
      )
      await settle()
      expect([stateOf(a), stateOf(b)]).toContainEqual({ ended: 'not-same-account' })
      expect([stateOf(a), stateOf(b)]).toContainEqual({ ended: 'not-same-account-cohort' })
      expect(now.asked).toHaveLength(1)
    })
  })

  describe('a crash that cut a running turn', () => {
    it('the next launch continues it once, naming the last thing the app recorded', async () => {
      const a = await aTurnRunsIn()
      const lastAt = (
        now.db.prepare('SELECT max(created_at) AS at FROM events WHERE session_id = ?').get(a) as {
          at: number
        }
      ).at
      starts(SOON)
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(continuations(a)).toEqual([aTurnTheAppCutText('crash', lastAt, app.clock, 'claude')])
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a turn a person stopped is not a cut', async () => {
      const a = await aTurnRunsIn()
      await now.host.interrupt(a, window)
      await settle()
      starts(SOON)
      await settle()
      expect(continuations(a)).toEqual([])
    })

    it('⛔ a turn a person cancelled from its card is not a cut', async () => {
      const a = await aTurnRunsIn()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        { type: 'user_decision', requestId: 'req_1', outcome: 'cancel' } as TranscriptEvent,
        CUT,
      )
      starts(SOON)
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'not-cut' })
    })

    it('⛔ a turn waiting on a person is not continued, though the repair cleared its block', async () => {
      starts(CUT - 60_000)
      const { sessionId } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-a', approvalMode: 'ask', cwd: root },
        window,
      )
      await now.host.send(sessionId, 'needs a yes', window)
      await settle()
      starts(SOON)
      await settle()
      expect(askedFor(now, sessionId)).toBe(0)
      expect(stateOf(sessionId)).toEqual({ ended: 'blocked' })
    })

    it('a continuation that is cut again is continued once more, and a third cut waits for a person', async () => {
      const a = await aTurnRunsIn()
      starts(SOON, { turnsStayOpen: true })
      await waitFor(() => continuations(a).length === 1, 'the first continuation')
      await settle()
      starts(SOON + 5 * 60_000, { turnsStayOpen: true })
      await waitFor(() => continuations(a).length === 2, 'the second continuation')
      await settle()
      starts(SOON + 10 * 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toHaveLength(2)
      expect(stateOf(a)).toEqual({ ended: 'continued-twice' })
    })

    it('⛔ a start kept as begun, then a crash before its provider is up: never started again', async () => {
      const a = await aTurnRunsIn()
      const up = held('the provider never comes up')
      starts(SOON, { beforeTheProviderIsUp: up })
      await waitFor(() => stateOf(a) === 'starting', 'the start to be kept as begun')
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'start-uncertain' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ words held, then a crash before they are taken: never sent again', async () => {
      const a = await aTurnRunsIn()
      const taken = held('the words are never taken')
      starts(SOON, { beforeTheWordsAreTaken: taken })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      starts(SOON + 60_000)
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'handover-uncertain' })
      expect(continuations(a)).toEqual([])
    })

    it('⛔ when the cut cannot be kept, nothing is continued', async () => {
      const a = await aTurnRunsIn()
      starts(SOON, { cutsCannotBeKept: true })
      await settle()
      expect(askedFor(now, a)).toBe(0)
      expect(continuations(a)).toEqual([])
    })
  })

  describe('the last check, after the last wait before the handover', () => {
    /** A cut whose continuation is held, and whose handover waits on its sign-in check. */
    const aContinuationWaitsAtTheGate = async (): Promise<{ a: string; gate: Gate }> => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      const gate = aGate()
      starts(SOON, { signInGate: gate })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      expect(continuations(a)).toEqual([])
      return { a, gate }
    }

    it('with nothing newer, it goes once the wait ends', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      gate.open()
      await waitFor(() => continuations(a).length === 1, 'the continuation')
      await settle()
      expect(stateOf(a)).toBe('sent')
    })

    it('⛔ a turn its provider ran by itself during that wait: the continuation ends unsent', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('the woken life has no handle')
      const machine = (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
      machine.noteProviderWork()
      await waitFor(() => ledger(a).some((event) => event.type === 'provider_turn'), 'its turn')
      machine.completeTurn('completed')
      await settle()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a usage limit reached during that wait: the continuation ends unsent, and the life started for it is stopped again', async () => {
      const { a, gate } = await aContinuationWaitsAtTheGate()
      theLimitIsReached()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await settle()
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'limited' })
      await waitFor(() => !running(now, a), 'its life to stop')
    })

    it('⛔ what else waited in the same batch still goes when the continuation is dropped', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        {
          type: 'background_work',
          running: [{ id: 't0', description: 'Run the full live test' }],
          source: 'test',
        } as unknown as TranscriptEvent,
        CUT - 5_000,
      )
      const gate = aGate()
      starts(SOON, { signInGate: gate })
      await waitFor(() => stateOf(a) === 'queued', 'the words to be held')
      await settle()
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('the woken life has no handle')
      const machine = (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
      machine.noteProviderWork()
      await waitFor(() => ledger(a).some((event) => event.type === 'provider_turn'), 'its turn')
      machine.completeTurn('completed')
      await settle()
      gate.open()
      // Settled either way, sent or ended, so the state below is what is asserted.
      await waitFor(() => stateOf(a) !== 'queued', 'the held words to be settled')
      await waitFor(
        () =>
          ledger(a).some(
            (event) =>
              event.type === 'user_turn' &&
              (event as { text: string }).text.includes('stopped your background work'),
          ),
        'the background notice to go',
      )
      expect(continuations(a)).toEqual([])
      expect(stateOf(a)).toEqual({ ended: 'overtaken' })
    })

    it('⛔ a usage limit already standing at the launch: no words are held, and its life is stopped again', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      starts(SOON)
      theLimitIsReached()
      await waitFor(() => typeof stateOf(a) === 'object', 'the cut to end')
      await settle()
      expect(heldCount(a)).toBe(0)
      expect(stateOf(a)).toEqual({ ended: 'limited' })
      expect(running(now, a)).toBe(false)
    })
  })

  describe('pacing', () => {
    it('two cut turns are started one at a time, four gaps apart', async () => {
      const a = await aTurnRunsIn()
      const { sessionId: b } = await now.host.createSession(
        { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await now.host.send(b, 'the other thing', window)
      await settle()
      starts(SOON)
      await waitFor(
        () => continuations(a).length === 1 && continuations(b).length === 1,
        'both continuations',
      )
      const [first, second] = now.startedAt
      expect(now.startedAt).toHaveLength(2)
      expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(4 * GAP - 5)
    })

    it('a cut turn whose background work the quit also stopped is started once, and both notices go in as one turn', async () => {
      const a = await aTurnRunsIn()
      await now.host.closeAll()
      now.store.append(
        a,
        now.store.nextOrdinal(a),
        {
          type: 'background_work',
          running: [{ id: 't0', description: 'Run the full live test' }],
          source: 'test',
        } as unknown as TranscriptEvent,
        CUT - 5_000,
      )
      starts(SOON)
      await waitFor(() => stateOf(a) === 'sent', 'the continuation to be sent')
      await settle()
      expect(askedFor(now, a)).toBe(1)
      const turns = ledger(a)
        .filter((event) => event.type === 'user_turn')
        .map((event) => (event as { text: string }).text)
      expect(turns.at(-1)).toContain('stopped your background work')
      expect(turns.at(-1)).toContain(aTurnTheAppCutText('quit', CUT, app.clock, 'claude'))
    })
  })
})
