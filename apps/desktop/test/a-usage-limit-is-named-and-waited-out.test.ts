import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle, type StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { resourcesRoot } from '../src/main/resources/resources'
import {
  theStallAndItsAsk,
  undrivenWorkText,
  theLimitItStoppedOn,
} from '../src/main/runtime/reply-rails'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  readSignInChanges,
  SIGN_IN_CHANGES_FILE,
  signInChangesIn,
  writeSignInChanges,
} from '../src/main/sign-in-changes'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { clockTime } from '../src/shared/clock'
import type { Exchange } from '../src/shared/last-exchange'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { derivePieces, UNDRIVEN_SENTENCES, type StoppedOnALimit } from '../src/shared/tasks'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 F074 — a usage limit is named, with its reset, and what the app would start waits for it
 *
 * ⚑ Measured on 2026-10-02: Claude's five-hour limit stopped the team from 17:15 to 17:50. A restart
 * started a helper to tell it something, its turn was refused at once, and its giver read *"…is not
 * being worked on: its turn ended with this work still open"* — nothing about the limit or 17:50.
 *
 *  - §1 · the piece's record: a turn whose row carries `limit` stalls its open work
 *    `provider_limited`, with whose limit and the reset.
 *  - §2 · the words a giver is pushed, and `list_tasks`' line: the limit and the reset, and never
 *    *"not being worked on"*.
 *  - §3 · the conversation's own line: the turn's ending says the limit.
 *  - §4 · the hold: while a provider is at a limit with a reset, what the app or an agent would
 *    start waits for the reset; a person's own message goes.
 *
 * ⛔ Fake values only: a provider double, no login.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const GIVEN: PersistedEventInfo = {
  ordinal: 0,
  at: 10,
  event: {
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.33',
    parent: 'work_root',
    givenBy: 'sess_giver',
    title: 'tidy the notes',
    brief: 'tidy the notes',
  },
}

const turnAt = (ordinal: number, at: number, event: TranscriptEvent): PersistedEventInfo => ({
  ordinal,
  at,
  event,
})

const RESETS = Date.UTC(2026, 9, 2, 15, 50)
const REFUSED_AT = Date.UTC(2026, 9, 2, 15, 22)

describe('F074 · a usage limit is named, and what the app would start waits for its reset', () => {
  describe('§1 · the piece’s record', () => {
    it('🔴 a turn its provider refused for the usage limit stalls the work `provider_limited`, with whose limit and the reset', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT, {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'claude', window: 'five_hour', resetsAt: RESETS },
        }),
      ])
      expect(piece).toMatchObject({
        state: 'stalled',
        stalledBecause: 'provider_limited',
        stalledAt: REFUSED_AT,
        stoppedOnALimit: { provider: 'claude', resetsAt: RESETS },
      })
    })

    it('⛔ the control — a failed turn with no limit is `turn_ended`, and carries no limit', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT, { type: 'turn', state: 'failed' }),
      ])
      expect(piece).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
      expect(piece).not.toHaveProperty('stoppedOnALimit')
    })

    it('⛔ a reset at or before the turn’s own moment is no reset — whose limit is still said', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT, {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'codex', resetsAt: REFUSED_AT },
        }),
      ])
      expect(piece?.stalledBecause).toBe('provider_limited')
      expect(piece?.stoppedOnALimit).toEqual({ provider: 'codex' })
    })

    it('the provider’s name for the limit is kept, so a giver can be told whether there was one', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT, {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'codex', window: 'primary' },
        }),
      ])
      expect(piece?.stoppedOnALimit).toEqual({ provider: 'codex', window: 'primary' })
    })

    it('🔴 a message waiting to drive it does not keep it `working`: the limit is said at once (the message waits for the reset too)', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT - 1_000, {
          type: 'message_queued',
          messageId: 'msg_follow_up',
          kind: 'notice',
          text: 'how is it going?',
        } as TranscriptEvent),
        turnAt(2, REFUSED_AT, {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'claude', resetsAt: RESETS },
        }),
      ])
      expect(piece).toMatchObject({ state: 'stalled', stalledBecause: 'provider_limited' })
      // ⛔ The control: the same message beside a turn that ended for no limit holds the work.
      const [held] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT - 1_000, {
          type: 'message_queued',
          messageId: 'msg_follow_up',
          kind: 'notice',
          text: 'how is it going?',
        } as TranscriptEvent),
        turnAt(2, REFUSED_AT, { type: 'turn', state: 'failed' }),
      ])
      expect(held?.state).toBe('working')
    })

    it('⚑ a later stall of another cause drops the limit, so a row never carries an earlier stall’s', () => {
      const [piece] = derivePieces('sess_ali', [
        GIVEN,
        turnAt(1, REFUSED_AT, {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'claude', resetsAt: RESETS },
        }),
        // ⚑ **F097** — the giver's note: a turn a person's own words opened would leave the piece
        // waiting on them rather than stalled.
        turnAt(2, RESETS + 60_000, {
          type: 'user_turn',
          text: 'go on',
          attribution: 'app_authored',
          relayedFrom: 'sess_giver',
          says: 'note',
        } as TranscriptEvent),
        turnAt(3, RESETS + 90_000, { type: 'turn', state: 'completed' }),
      ])
      expect(piece).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
      expect(piece).not.toHaveProperty('stoppedOnALimit')
    })
  })

  describe('§2 · the words a giver reads', () => {
    const piece = {
      label: 'W1.33',
      title: 'tidy the notes',
      questionLostAtRestart: false,
      stalledAt: REFUSED_AT,
      stoppedOnALimit: { provider: 'claude', resetsAt: RESETS } as StoppedOnALimit,
    }
    const nothingSaid: Exchange = { received: null, answer: null }
    const notice = (stall: typeof piece | Omit<typeof piece, 'stoppedOnALimit'>): string =>
      undrivenWorkText(
        stall,
        'provider_limited',
        nothingSaid,
        'Ali',
        null,
        () => 'W1',
        false,
        false,
        [],
        [],
      )

    it('🔴 the notice says Claude’s usage limit and when it resets, and that a message waits until then', () => {
      const said = notice(piece)
      expect(said).toContain(
        `W1.33 · tidy the notes with Ali: its turn ended because Claude’s usage limit was reached; it resets at ${clockTime(RESETS)}.`,
      )
      expect(said).toContain('A message to Ali waits until then.')
      // ⛔ F074's own complaint, refused by name.
      expect(said).not.toContain('not being worked on')
    })

    it('⚑ with no reset known, it says whose limit and promises no wait', () => {
      const said = notice({
        ...piece,
        stoppedOnALimit: { provider: 'claude', window: 'five_hour' },
      })
      expect(said).toContain('its turn ended because Claude’s usage limit was reached.')
      expect(said).not.toContain('waits until then')
    })

    it('a limit with no name and no reset is said as the plan or usage, and points to the provider’s own words', () => {
      const said = notice({ ...piece, stoppedOnALimit: { provider: 'codex' } })
      expect(said).toContain(
        'W1.33 · tidy the notes with Ali: its turn ended because Codex refused it on its plan or usage; Codex’s own words are in that conversation.',
      )
      expect(said).not.toContain('usage limit was reached')
      expect(said).not.toContain('waits until then')
    })

    it('⛔ an ask to stop rides beside it as an ask — never as if the asker caused the limit', () => {
      expect(
        theStallAndItsAsk(
          'provider_limited',
          { by: 'a-person', called: null, byTheReader: false } as never,
          theLimitItStoppedOn(piece),
        ),
      ).toContain('it resets at')
      expect(
        theStallAndItsAsk(
          'provider_limited',
          { by: 'a-person', called: null, byTheReader: false } as never,
          theLimitItStoppedOn(piece),
        ),
      ).toContain('; it had been asked to stop')
    })

    it('⚑ `list_tasks`’ line says the same, and a surface with no limit to hand reads the table’s sentence', () => {
      expect(theStallAndItsAsk('provider_limited', null, theLimitItStoppedOn(piece))).toBe(
        `its turn ended because Claude’s usage limit was reached; it resets at ${clockTime(RESETS)}`,
      )
      expect(UNDRIVEN_SENTENCES.provider_limited).toBe(
        'its turn ended because its provider’s usage limit was reached.',
      )
    })
  })

  describe('§3 · the conversation’s own line', () => {
    it('🔴 the turn’s ending says the limit and the reset, in the conversation', () => {
      const state = createTranscript()
      applyEvent(
        state,
        {
          type: 'turn',
          state: 'failed',
          limit: { provider: 'claude', window: 'five_hour', resetsAt: RESETS },
        },
        REFUSED_AT,
        1,
      )
      expect(JSON.stringify(state.items)).toContain(
        `turn failed — Claude’s usage limit was reached; it resets at ${clockTime(RESETS)}`,
      )
    })

    it('a limit with no name and no reset says the plan or usage refused the turn, with the provider’s words above it', () => {
      const state = createTranscript()
      applyEvent(
        state,
        { type: 'error', message: 'You’ve hit your usage limit. Upgrade to Plus.', fatal: false },
        REFUSED_AT,
        1,
      )
      applyEvent(
        state,
        { type: 'turn', state: 'failed', limit: { provider: 'codex' } },
        REFUSED_AT,
        2,
      )
      const said = JSON.stringify(state.items)
      expect(said).toContain(
        'turn failed — Codex refused the turn on its plan or usage; what it said is just above',
      )
      expect(said.indexOf('Upgrade to Plus')).toBeLessThan(said.indexOf('refused the turn'))
      expect(said).not.toContain('usage limit was reached')
    })

    it('a named limit with no reset still says the limit was reached, and that no reset was said', () => {
      const state = createTranscript()
      applyEvent(
        state,
        { type: 'turn', state: 'failed', limit: { provider: 'codex', window: 'primary' } },
        REFUSED_AT,
        1,
      )
      expect(JSON.stringify(state.items)).toContain(
        'turn failed — Codex’s usage limit was reached; it hasn’t said when it resets',
      )
    })

    it('⛔ the control — a failed turn with no limit still reads `turn failed`', () => {
      const state = createTranscript()
      applyEvent(state, { type: 'turn', state: 'failed' }, REFUSED_AT, 1)
      const said = JSON.stringify(state.items)
      expect(said).toContain('turn failed')
      expect(said).not.toContain('usage limit')
    })
  })

  describe('§4 · the hold', () => {
    /** ⚑ A window: the one surface a person's words come through. */
    class RecordingSink implements RuntimeEventSink {
      readonly aPersonIsBehindIt = true
      readonly messages: RuntimeEventMessage[] = []
      alive = true
      constructor(readonly ownerId: string) {}
      send(message: RuntimeEventMessage): void {
        this.messages.push(message)
      }
      sendLiveness(): void {}
    }

    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let handles: FakeSessionHandle[]
    const window = new RecordingSink(sinkOwnerId({ id: 1 }))

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-f074-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-f074-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
      handles = []
      issued = new FakeProviderSessions()
      counter = 0
      host = aHost()
    })

    let issued: FakeProviderSessions
    let counter = 0
    /**
     * ⚑ This test's host on this test's store — again after a restart (W4.172), with the moments the
     * sign-in changed kept in its data folder, as `main/index.ts` keeps them.
     */
    function aHost(more: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}): RuntimeHost {
      return new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        resourcesRoot: () => resourcesRoot(userData),
        createRuntime: (provider: Provider) =>
          new ProviderDouble(provider, handles, issued, anOpenGate()),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${String(++counter)}`,
        commandListWaitMs: 200,
        afterALimitResetsMs: 20,
        signInChanges: signInChangesIn(userData),
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        ...more,
      })
    }

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    })

    const turns = (id: string): string[] =>
      store
        .events(id)
        .flatMap((entry) => (entry.event.type === 'user_turn' ? [entry.event.text] : []))

    const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 4_000
      while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    /** ⚑ A Claude conversation that has answered once and is idle — before any wall. */
    async function anIdleConversation(): Promise<string> {
      const { sessionId } = await host.createSession(
        { provider: 'claude', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.send(sessionId, 'the first thing', window)
      await waitFor(
        () => store.events(sessionId).some((entry) => entry.event.type === 'turn'),
        'the first turn to end',
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      return sessionId
    }

    /** ⚑ A wall another conversation recorded, as the adapter words it. */
    function aWall(said: string): void {
      store.create({
        id: 'sess_wall',
        provider: 'claude',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'default',
      })
      store.append('sess_wall', 0, { type: 'error', message: said, fatal: false }, Date.now())
    }
    const claudeWall = (resetsAt: number): string =>
      `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`

    async function twoCodexAccounts(
      knownA = true,
    ): Promise<{ a: string; b: string; resetA: number }> {
      await host.closeAll()
      class AccountRuntime extends ProviderDouble {
        override async start(options: StartOptions): Promise<FakeSessionHandle> {
          const handle = await super.start(options)
          Object.defineProperty(handle, 'signInTag', {
            value: () => {
              const willow = options.providerHome.split(/[\\/]/).includes('willow')
              if (!knownA && !willow) return null
              return willow ? 'willow-account' : 'fern-account'
            },
          })
          return handle
        }
      }
      host = aHost({
        createRuntime: (provider) => new AccountRuntime(provider, handles, issued, anOpenGate()),
      })
      const { sessionId: a } = await host.createSession(
        { provider: 'codex', profileId: 'fern', approvalMode: 'auto', cwd: root },
        window,
      )
      const { sessionId: b } = await host.createSession(
        { provider: 'codex', profileId: 'willow', approvalMode: 'auto', cwd: root },
        window,
      )
      for (const id of [a, b]) {
        await host.send(id, 'first fictional turn', window)
        await waitFor(
          () => store.events(id).some((row) => row.event.type === 'turn'),
          'the first turn',
        )
      }
      const resetA = Date.now() + 60_000
      handles[0]!.simulateError(
        `codex is rate-limited (weekly) — the turn may stall until it resets; resets ${new Date(resetA).toISOString()}`,
        false,
      )
      await waitFor(
        () => store.events(a).some((row) => row.event.type === 'error'),
        'the account wall',
      )
      return { a, b, resetA }
    }

    it('automatic work on a different known Codex account goes while the walled account waits', async () => {
      const { a, b } = await twoCodexAccounts()
      expect((await host.queueMessage(a, 'held for fern', THE_APP_ITSELF)).outcome).toBe('queued')
      expect((await host.queueMessage(b, 'news for willow', THE_APP_ITSELF)).outcome).toBe('sent')
      await waitFor(() => turns(b).length === 2, 'work on the other account')
      expect(turns(a)).toHaveLength(1)
      expect(host.whyWhatIsHeldWaits(a)).toContain('Codex’s usage limit is reached')
    })

    it('an unknown-account wall still holds automatic work on a known account', async () => {
      const { b } = await twoCodexAccounts(false)
      expect(
        (await host.queueMessage(b, 'held behind an unknown wall', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(b)).toContain('Codex’s usage limit is reached')
    })

    it('an overflowing account snapshot keeps the provider-wide hold', async () => {
      const { b } = await twoCodexAccounts()
      const boundary = host as unknown as {
        limitAccountLives: Map<string, Map<number, string | null>>
        wallsForTheHold: unknown
      }
      for (let n = 0; n < 32_769; n++)
        boundary.limitAccountLives.set(`fictional-overflow-${n}`, new Map([[0, 'fern-account']]))
      boundary.wallsForTheHold = null
      expect(
        (await host.queueMessage(b, 'held with incomplete accounts', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(b)).toContain('Codex’s usage limit is reached')
    })

    it('queued work behind another account’s turn is not labelled as waiting for the walled account', async () => {
      const { b } = await twoCodexAccounts()
      await handles[1]!.setApprovalMode('ask')
      await host.send(b, 'fictional parked work', window)
      await waitFor(
        () => store.events(b).some((row) => row.event.type === 'permission_request'),
        'the other account to wait for approval',
      )
      const held = await host.queueMessage(b, 'news behind its own turn', THE_APP_ITSELF)
      expect(held.outcome).toBe('queued')
      if (held.outcome !== 'queued') throw new Error('The fictional message was not queued')
      const look = await host.look(b, window, false)
      expect(look.liveness.queued?.find((row) => row.id === held.messageId)).toMatchObject({
        holdReasonStatus: 'current',
        holdReason: null,
      })
      expect(host.whyWhatIsHeldWaits(b)).not.toContain('Codex’s usage limit')
    })

    it('each account’s own wall keeps its own reset in conversation facts', async () => {
      const { a, b, resetA } = await twoCodexAccounts()
      handles[1]!.simulateError(
        `codex is rate-limited (weekly) — the turn may stall until it resets; resets ${new Date(resetA + 60_000).toISOString()}`,
        false,
      )
      await waitFor(
        () => store.events(b).some((row) => row.event.type === 'error'),
        'the second account wall',
      )
      host.limitsForAPerson()
      expect((await host.look(a, window, false)).liveness.providerBlock).toEqual({
        provider: 'codex',
        resetsAt: resetA,
      })
    })

    it('a completed turn on a different known Codex account leaves the first account’s wall standing', async () => {
      const { a, b } = await twoCodexAccounts()
      await host.send(b, 'another fictional turn', window)
      await waitFor(
        () => store.events(b).filter((row) => row.event.type === 'turn').length === 2,
        'the other account to finish',
      )
      expect((await host.queueMessage(a, 'held for fern', THE_APP_ITSELF)).outcome).toBe('queued')
      expect(host.whyWhatIsHeldWaits(a)).toContain('Codex’s usage limit is reached')
    })

    it('a known account’s wall survives its conversation closing and another account answering', async () => {
      const { a, b } = await twoCodexAccounts()
      await host.close(a, window)
      await host.send(b, 'another fictional turn', window)
      await waitFor(
        () => store.events(b).filter((row) => row.event.type === 'turn').length === 2,
        'the other account to finish',
      )
      expect(host.limitsForAPerson().rows).toContainEqual(
        expect.objectContaining({
          provider: 'codex',
          account: 'codex:fern-account',
          standing: 'stopped',
        }),
      )
    })

    it('🔴 the app’s own words to an idle Claude conversation are HELD while Claude is at its limit, and go at the reset', async () => {
      const id = await anIdleConversation()
      aWall(claudeWall(Date.now() + 600))
      const outcome = await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      expect(outcome.outcome).toBe('queued')
      // ⚑ The receipt's reason: the limit, and when it resets.
      expect(host.whyWhatIsHeldWaits(id)).toContain(
        'Claude’s usage limit is reached, so it waits until the limit resets, at',
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(turns(id)).toEqual(['the first thing'])
      // ⚑ …and at the reset it goes.
      await waitFor(() => turns(id).length === 2, 'the held words to go at the reset')
      expect(turns(id)[1]).toContain('the app has news for it')
    })

    it('⚑ a person’s own message goes, at the limit — and the provider answering it lets what waited go, long before the reset', async () => {
      const id = await anIdleConversation()
      aWall(claudeWall(Date.now() + 60_000))
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      const outcome = await host.queueMessage(id, 'mine, now', window)
      expect(outcome.outcome).toBe('sent')
      await waitFor(() => turns(id).includes('mine, now'), 'the person’s message to go')
      // ⚑ The person's turn COMPLETED: the provider answered after the wall, so the wall is
      // retracted (`foldProviderLimits`) and the held words go now, not at the reset a minute out.
      await waitFor(
        () => turns(id).some((text) => text.includes('the app has news for it')),
        'the held words to go once the provider answered',
      )
      expect(host.whyWhatIsHeldWaits(id)).toBeNull()
    })

    it('🔴 at the limit, a person’s words held behind a turn go FIRST, and what the app sent stays held', async () => {
      const { sessionId: id } = await host.createSession(
        { provider: 'claude', approvalMode: 'ask', cwd: root },
        window,
      )
      await host.send(id, 'the first thing', window)
      const cards = (): string[] =>
        store
          .events(id)
          .flatMap((entry) => (entry.event.type === 'permission_request' ? [entry.event.id] : []))
      await waitFor(() => cards().length === 1, 'the first turn to park on its card')
      aWall(claudeWall(Date.now() + 60_000))
      // ⚑ Both held behind the running turn: the app's first, then the person's.
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      expect((await host.queueMessage(id, 'mine, behind it', window)).outcome).toBe('queued')
      // ⚑ Cancelled, so the turn ends `interrupted`: a turn that COMPLETED would be the provider
      // answering after the wall, which retracts it (the test above), and nothing would be held.
      await host.respondPermission(id, cards()[0]!, { outcome: 'cancel' }, window)
      await waitFor(() => turns(id).includes('mine, behind it'), 'the person’s words to go')
      // ⛔ …and the app's, older, did not go with them: it waits for the reset.
      expect(turns(id).some((text) => text.includes('the app has news for it'))).toBe(false)
      expect(host.whyWhatIsHeldWaits(id)).toContain('Claude’s usage limit is reached')
    })

    it('⛔ the control — with no wall, the app’s words go straight in', async () => {
      const id = await anIdleConversation()
      const outcome = await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      expect(outcome.outcome).toBe('sent')
      expect(host.whyWhatIsHeldWaits(id)).toBeNull()
    })

    it('⛔ a wall with no reset holds nothing — there is no moment to wait for', async () => {
      const id = await anIdleConversation()
      aWall('claude is rate-limited — the turn may stall until it resets')
      const outcome = await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      expect(outcome.outcome).toBe('sent')
    })

    /** ⚑ A wall a conversation of its own recorded, so a test can record more than one. */
    let walls = 0
    function anotherWall(said: string): void {
      const id = `sess_wall_${String(++walls)}`
      store.create({ id, provider: 'claude', cwd: root, approvalMode: 'ask', profileId: 'default' })
      store.append(id, 0, { type: 'error', message: said, fatal: false }, Date.now())
    }
    /** ⚑ {@link anotherWall}, Codex's, as its adapter words it. */
    function anotherCodexWall(resetsAt: number): void {
      const id = `sess_wall_${String(++walls)}`
      store.create({ id, provider: 'codex', cwd: root, approvalMode: 'ask', profileId: 'default' })
      const said = `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`
      store.append(id, 0, { type: 'error', message: said, fatal: false }, Date.now())
    }

    /** ⚑ {@link anIdleConversation}, with the handle its provider gave it as it was created. */
    async function anIdleConversationAndItsHandle(): Promise<{
      id: string
      handle: FakeSessionHandle
    }> {
      const id = await anIdleConversation()
      return { id, handle: handles.at(-1)! }
    }

    /**
     * ⚑ A Claude conversation started and given nothing yet — so no turn of its own completes after
     * a wall, which would end the wall ({@link anIdleConversation}'s first turn does).
     */
    async function aConversationNotYetAnswered(): Promise<{
      id: string
      handle: FakeSessionHandle
    }> {
      const { sessionId } = await host.createSession(
        { provider: 'claude', approvalMode: 'auto', cwd: root },
        window,
      )
      return { id: sessionId, handle: handles.at(-1)! }
    }

    /**
     * ⚑ The Mac's Claude sign-in moves on under running conversations, as switching accounts does:
     * each handle now holds a sign-in the Mac has left (its `checkSignIn` says so). ⚑ Every Claude
     * child shares the one Keychain login, so a switch moves it under all of them at once.
     */
    function theSignInMovesOnUnder(...moved: FakeSessionHandle[]): void {
      for (const handle of moved) {
        Object.defineProperty(handle, 'checkSignIn', {
          value: async () => true,
          configurable: true,
        })
      }
    }

    /**
     * ⚑ Every life this runtime starts or resumes — those to come too — reads the Mac's sign-in as
     * `reads.moved` says: a launch whose credential and the Mac's are read differently.
     */
    function everyLifeReads(reads: { moved: boolean }, runtime: ProviderDouble): ProviderDouble {
      const reading = (handle: FakeSessionHandle): FakeSessionHandle => {
        Object.defineProperty(handle, 'checkSignIn', {
          value: async () => reads.moved,
          configurable: true,
        })
        return handle
      }
      const start = runtime.start.bind(runtime)
      const resume = runtime.resume.bind(runtime)
      runtime.start = async (options) => reading(await start(options))
      runtime.resume = async (ref, options) => reading(await resume(ref, options))
      return runtime
    }

    const aMoment = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

    it('🔴 a sign-in that changes ends the limits the sign-in before reached: what waited goes at once, on the conversation reopened on the new one', async () => {
      const held = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(held.id)).toContain('Claude’s usage limit is reached')
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      await aMoment()
      // ⚑ The person switches accounts: the next send meets the moved sign-in.
      theSignInMovesOnUnder(held.handle, other.handle)
      await host.send(other.id, 'hello again', window)
      // ⚑ …and what waited for the old account's limit goes now — the conversation holding it is
      // reopened on the new sign-in and sends it — not at the reset a minute out.
      await waitFor(
        () => turns(held.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once the sign-in changed',
      )
      expect(store.events(held.id).some((entry) => entry.event.type === 'reopened')).toBe(true)
      expect(host.whyWhatIsHeldWaits(held.id)).toBeNull()
    })

    it('⛔ a limit reached after the sign-in changed still holds', async () => {
      const id = await anIdleConversation()
      const other = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(other.handle)
      await host.send(other.id, 'hello again', window)
      await new Promise((resolve) => setTimeout(resolve, 10))
      // ⚑ No turn has answered since the old limit, so only the change ends it in the person's view.
      expect(host.limitsForAPerson().rows).toEqual([])
      // ⚑ The new sign-in reaches a limit of its own.
      anotherWall(claudeWall(Date.now() + 60_000))
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      expect(host.whyWhatIsHeldWaits(id)).toContain('Claude’s usage limit is reached')
      expect(host.limitsForAPerson().rows).toHaveLength(1)
    })

    it('⛔ one switch is one change: an older conversation that reports it later does not erase a limit the new sign-in reached since', async () => {
      const id = await anIdleConversation()
      const first = await anIdleConversationAndItsHandle()
      const late = await anIdleConversationAndItsHandle()
      // ⚑ Work in the background holds the reopen a person's words would make, so these sends
      // only report the switch: nothing goes in that could clear a limit.
      first.handle.simulateBackgroundWork()
      late.handle.simulateBackgroundWork()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      // ⚑ The switch, reported by the first conversation to send.
      theSignInMovesOnUnder(first.handle, late.handle)
      await host.send(first.id, 'hello again', window)
      await aMoment()
      // ⚑ The new sign-in reaches its own limit…
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      // ⚑ …and a conversation begun before the switch reports the same switch, later.
      await host.send(late.id, 'hello at last', window)
      await aMoment()
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      expect(host.whyWhatIsHeldWaits(id)).toContain('Claude’s usage limit is reached')
      expect(host.limitsForAPerson().rows).toHaveLength(1)
    })

    it('🔴 W4.172 · a sign-in change is kept across a restart: the old sign-in’s limit holds nothing after it, and a limit the new one reached still holds', async () => {
      const held = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(held.handle, other.handle)
      await host.send(other.id, 'hello again', window)
      await aMoment()
      // ⚑ Kept in the data folder, as `main/index.ts` keeps it.
      const kept = readSignInChanges(join(userData, SIGN_IN_CHANGES_FILE))
      expect(kept.get('claude')).toBeGreaterThan(0)
      expect(kept.has('codex')).toBe(false)
      // ⚑ The app restarts: every life of the next run starts on the current sign-in.
      await host.closeAll()
      host = aHost()
      expect(host.limitsForAPerson().rows).toEqual([])
      const fresh = await anIdleConversation()
      expect(
        (await host.queueMessage(fresh, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('sent')
      // ⚑ A limit the new sign-in reaches after the change still holds.
      await aMoment()
      anotherWall(claudeWall(Date.now() + 60_000))
      expect((await host.queueMessage(fresh, 'more news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      expect(host.whyWhatIsHeldWaits(fresh)).toContain('Claude’s usage limit is reached')
      expect(host.limitsForAPerson().rows).toHaveLength(1)
    })

    it('⛔ W4.172 · the control: without the kept moment, the old sign-in’s limit holds again after a restart', async () => {
      const other = await anIdleConversationAndItsHandle()
      // ⚑ Work in the background holds the reopen a person's words would make, so these sends
      // only report the switch: nothing goes in that could clear a limit.
      other.handle.simulateBackgroundWork()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(other.handle)
      await host.send(other.id, 'hello again', window)
      await aMoment()
      await host.closeAll()
      rmSync(join(userData, SIGN_IN_CHANGES_FILE))
      host = aHost()
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      // ⚑ …as a switch made while the app was closed is: every life now starts on the current
      // sign-in, so none can find it — and the receipt promises only what a life can find.
      const fresh = await aConversationNotYetAnswered()
      expect(
        (await host.queueMessage(fresh.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(fresh.id)).toContain(
        'when this app finds this computer’s Claude sign-in changed under a Claude conversation running here that started on the sign-in before',
      )
    })

    it('⛔ W4.172 · a kept moment still ahead of the clock is set aside: it would hide every limit until then', async () => {
      await host.closeAll()
      writeSignInChanges(
        join(userData, SIGN_IN_CHANGES_FILE),
        new Map([['claude', Date.now() + 86_400_000]]),
      )
      anotherWall(claudeWall(Date.now() + 60_000))
      host = aHost()
      expect(host.limitsForAPerson().rows).toHaveLength(1)
    })

    it('🔴 W4.172 · a switch made while everything waits for a limit is noticed at the next look, though nothing new is sent', async () => {
      await host.closeAll()
      host = aHost({ lookAtTheLimitAgainMs: 60 })
      const held = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      // ⚑ The person switches accounts, and nobody sends anything.
      theSignInMovesOnUnder(held.handle)
      await waitFor(
        () => turns(held.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once a look noticed the switch',
      )
      expect(store.events(held.id).some((entry) => entry.event.type === 'reopened')).toBe(true)
    })

    it('🔴 W4.172 · the look asks the oldest conversation, whatever it holds: a switch is found though only a conversation begun after it holds words', async () => {
      await host.closeAll()
      host = aHost({ lookAtTheLimitAgainMs: 60 })
      const idle = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      // ⚑ The person switches accounts; a conversation begun since holds the new sign-in.
      theSignInMovesOnUnder(idle.handle)
      const fresh = await aConversationNotYetAnswered()
      let asked = 0
      Object.defineProperty(fresh.handle, 'checkSignIn', {
        value: async () => {
          asked += 1
          return false
        },
        configurable: true,
      })
      expect(
        (await host.queueMessage(fresh.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      asked = 0
      // ⚑ Nobody sends anything: the look asks the idle one, which began on the sign-in before.
      await waitFor(
        () => turns(fresh.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once a look found the switch',
      )
      // ⚑ The one asked is marked, as any moved sign-in is; ⛔ with nothing held, it is not reopened.
      await host.send(idle.id, 'hello again', window)
      expect(store.events(idle.id).some((entry) => entry.event.type === 'reopened')).toBe(false)
      // ⚑ The one that began on the current sign-in was asked only by its own flush, never by a look.
      expect(asked).toBeLessThanOrEqual(1)
    })

    it('🔴 W4.172 · the receipt says what really ends the wait: the reset at the latest, sooner when Claude takes work again', async () => {
      const id = await anIdleConversation()
      anotherWall(claudeWall(Date.now() + 60_000))
      await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      const said = host.whyWhatIsHeldWaits(id) ?? ''
      expect(said).toMatch(
        /^Claude’s usage limit is reached, so it waits until the limit resets, at .+\. /,
      )
      expect(said).toContain(
        'It goes sooner if Claude takes work again first: at once when Claude says that limit has cleared, or when this app finds this computer’s Claude sign-in changed under a Claude conversation running here that started on the sign-in before — which it asks at least every 10 minutes while something waits; and within 10 minutes when a Claude conversation here completes a turn. If the change was only a renewal of the same sign-in, which reads the same, or the new sign-in has reached a limit too, it may be sent while that limit holds, and that turn is refused.',
      )
      // ⚑ Free, so nothing more: it waits for no turn of its own.
      expect(said).not.toContain('It also waits for the turn')
    })

    it('🔴 W4.172 · held behind a turn at a limit, the receipt says it waits for both — and the reset is armed though the conversation is busy', async () => {
      await host.closeAll()
      host = aHost({ lookAtTheLimitAgainMs: 60 })
      const { sessionId: parked } = await host.createSession(
        { provider: 'claude', approvalMode: 'ask', cwd: root },
        window,
      )
      const parkedHandle = handles.at(-1)!
      await host.send(parked, 'the first thing', window)
      await waitFor(
        () => store.events(parked).some((entry) => entry.event.type === 'permission_request'),
        'the first turn to park on its card',
      )
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      expect(
        (await host.queueMessage(parked, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      // ⚑ Its turn is stopped on a person's answer: that is said first, then the limit — and the
      // turn is not said a second time.
      const said = host.whyWhatIsHeldWaits(parked) ?? ''
      expect(said).toMatch(
        /^Its turn is stopped until a person answers its request to use .+ under Waiting on you: nothing sent to it goes in until then\. Claude’s usage limit is reached, so it waits until the limit resets, at .+\.$/,
      )
      expect(said).not.toContain('It also waits for the turn')
      // ⚑ The look runs though nothing is free to flush: a switch under the parked conversation is
      // found, and noted, while its card is still open.
      theSignInMovesOnUnder(parkedHandle)
      await waitFor(() => host.limitsForAPerson().rows.length === 0, 'the look to find the switch')
    })

    it('⚑ W4.172 · …and Codex’s says only what Codex has: a completed turn', async () => {
      const { sessionId: id } = await host.createSession(
        { provider: 'codex', approvalMode: 'auto', cwd: root },
        window,
      )
      anotherCodexWall(Date.now() + 60_000)
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      expect(host.whyWhatIsHeldWaits(id)).toMatch(
        /^Codex’s usage limit is reached, so it waits until the limit resets, at .+\. It goes sooner if Codex takes work again first: within 10 minutes when a Codex conversation here completes a turn\.$/,
      )
    })

    it('🔴 W4.172 · reopened on a new sign-in that is at a limit too, the receipt says the reopen alone does not send it', async () => {
      const late = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(late.handle, other.handle)
      await host.send(other.id, 'hello again', window)
      await aMoment()
      // ⚑ The new sign-in reaches a limit of its own.
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      expect(
        (await host.queueMessage(late.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(late.id)).toMatch(
        /^Its Claude sign-in changed after it started\. This app is reopening it on the current one\. After the reopen, what is held for it waits for Claude’s usage limit too: until the limit resets, at .+, or sooner — at once when Claude says that limit has cleared, and within 10 minutes when a Claude conversation here completes a turn\.$/,
      )
      // ⚑ …and it does: reopened, and still held, for the limit now.
      await waitFor(
        () => store.events(late.id).some((entry) => entry.event.type === 'reopened'),
        'the reopen',
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(turns(late.id).some((text) => text.includes('the app has news for it'))).toBe(false)
      expect(host.whyWhatIsHeldWaits(late.id)).toMatch(
        /^Claude’s usage limit is reached, so it waits until the limit resets/,
      )
    })

    it('🔴 W4.172 · a reopen that waits for something, at a limit: the receipt says when it reopens and that the limit holds after it, and it does', async () => {
      const other = await anIdleConversationAndItsHandle()
      const { sessionId: parked } = await host.createSession(
        { provider: 'claude', approvalMode: 'ask', cwd: root },
        window,
      )
      const parkedHandle = handles.at(-1)!
      await host.send(parked, 'the first thing', window)
      const cards = (): string[] =>
        store
          .events(parked)
          .flatMap((entry) => (entry.event.type === 'permission_request' ? [entry.event.id] : []))
      await waitFor(() => cards().length === 1, 'the first turn to park on its card')
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(other.handle, parkedHandle)
      await host.send(other.id, 'hello again', window)
      await aMoment()
      // ⚑ The new sign-in reaches a limit of its own.
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      expect(
        (await host.queueMessage(parked, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(parked)).toMatch(
        /^Its Claude sign-in changed after it started\. This app reopens it on the current one once the question or permission it is waiting on is answered\. After the reopen, what is held for it waits for Claude’s usage limit too: until the limit resets, at .+\.$/,
      )
      // ⚑ The card is answered: the turn ends, and the reopen is not held for the limit…
      await host.respondPermission(parked, cards()[0]!, { outcome: 'cancel' }, window)
      await waitFor(
        () => store.events(parked).some((entry) => entry.event.type === 'reopened'),
        'the reopen once the card was answered',
      )
      // ⚑ …and what is held waits for the limit after it, as the receipt said.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(turns(parked).some((text) => text.includes('the app has news for it'))).toBe(false)
      expect(host.whyWhatIsHeldWaits(parked)).toMatch(
        /^Claude’s usage limit is reached, so it waits until the limit resets/,
      )
    })

    it('⛔ W4.172 · a life this app reopened that reads as moved again at once is a launch read differently: no change is noted, and the limit still holds', async () => {
      const reads = { moved: false }
      /** ⚑ How far this host's clock runs ahead of the wall clock. */
      const ahead = { ms: 0 }
      const hours = (count: number): number => count * 3_600_000
      await host.closeAll()
      host = aHost({
        lookAtTheLimitAgainMs: 60,
        now: () => Date.now() + ahead.ms,
        createRuntime: (provider: Provider) =>
          everyLifeReads(reads, new ProviderDouble(provider, handles, issued, anOpenGate())),
      })
      const held = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      // ⚑ Work in the background holds the reopen a person's words would make, so these sends
      // only report the switch: nothing goes in that could clear a limit.
      other.handle.simulateBackgroundWork()
      // ⚑ Every life reads the sign-in as moved, those started from now on too.
      reads.moved = true
      await host.send(other.id, 'hello again', window)
      await aMoment()
      // ⚑ A limit reached after that change, with its reset hours out.
      anotherWall(claudeWall(Date.now() + hours(5)))
      await aMoment()
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      // ⚑ Reopened once, at the limit; the new life reads as moved at the next look.
      await waitFor(
        () => store.events(held.id).some((entry) => entry.event.type === 'reopened'),
        'the reopen',
      )
      await waitFor(
        () => (host.whyWhatIsHeldWaits(held.id) ?? '').includes('moments ago'),
        'the loop guard to hold it',
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      // ⛔ …which is no change: the limit still holds, and what waits for it is not sent.
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      expect(turns(held.id).some((text) => text.includes('the app has news for it'))).toBe(false)
      expect(host.whyWhatIsHeldWaits(held.id)).toMatch(
        /^Its Claude sign-in changed after it started\. This app reopened it on the current one moments ago, and it read as moved on again before it ever read as current, so this app does not reopen it again within 10 minutes of that reopen; until then, what is held for it waits for a person to reopen it\. After the reopen, what is held for it waits for Claude’s usage limit too: until the limit resets, at .+\.$/,
      )
      expect(store.events(held.id).filter((entry) => entry.event.type === 'reopened')).toHaveLength(
        1,
      )
      // ⚑ Past the loop guard's window, this app reopens it once more — and that spends nothing:
      // no change was noted, so the limit still holds what waits.
      ahead.ms = 11 * 60_000
      await waitFor(
        () => store.events(held.id).filter((entry) => entry.event.type === 'reopened').length === 2,
        'a second reopen past the window',
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      expect(turns(held.id).some((text) => text.includes('the app has news for it'))).toBe(false)
    })

    it('⚑ W4.172 · …and with no limit after the switch, it goes in as it starts, as it says', async () => {
      const late = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      await aMoment()
      theSignInMovesOnUnder(late.handle, other.handle)
      await host.send(other.id, 'hello again', window)
      await aMoment()
      // ⚑ Held for the reopen, not for the old sign-in's limit: the receipt says no limit.
      const outcome = await host.queueMessage(late.id, 'the app has news for it', THE_APP_ITSELF)
      expect(outcome.outcome).toBe('queued')
      expect(host.whyWhatIsHeldWaits(late.id)).toBe(
        'Its Claude sign-in changed after it started. This app is reopening it on the current one, and what is held for it goes in as it starts.',
      )
      await waitFor(
        () => turns(late.id).some((text) => text.includes('the app has news for it')),
        'the held words to go as the reopen starts',
      )
    })

    it('⛔ another provider’s limit holds nothing here', async () => {
      const id = await anIdleConversation()
      aWall(
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${new Date(Date.now() + 60_000).toISOString()}`,
      )
      const outcome = await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      expect(outcome.outcome).toBe('sent')
    })
  })
})
