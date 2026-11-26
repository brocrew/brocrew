import { nameGracesTeam } from './helpers/graces-team'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, SessionMachine } from '@brobot2/runtime'
import type { FakeSessionHandle, RuntimeEvent, StartOptions } from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { stalledWorkLead } from '../src/renderer/src/lib/persons-queue'
import { incidentSays } from '../src/renderer/src/lib/work-waits'
import { agentName } from '../src/shared/runtime-ipc'
import { theConversationCalled } from '../src/shared/piece-called'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
  migrationsFolder,
} from './lib/host-fixture'
import { callAs } from './helpers/call-tool'

/**
 * # 🔴 732 · a retry that works, and names, not folders
 *
 *  - **§2 · `729` F-1, under R41** — *"every identity a person reads is NAMED (`agentName`), never by
 *    slug, and never by a folder."* ⛔ On `main` the stalled-work band named the holder and the giver by
 *    the basename of their working folder, and in the default folder that is `brobot-workspace` for
 *    both.
 *    ⚑ Both provider shapes of a stopped turn: finished anyway (`turn_ended`) and honoured
 *    (`turn_interrupted`).
 *  - **§3 · `730` F-4** — `work_interrupted` carries the asking agent's IDENTITY (its folded slug,
 *    as `relayedFromProfile` does), so the transcript can name who asked through `agentName`; the
 *    frontend draws it. ⛔ On `main` the row carried the session id alone.
 *
 * ⚑ Real host, real SQLite, real migrations, real tools; the only double is the provider.
 */

/** ⚑ `ProviderDouble`, with one start's handle decorated — the worker whose turn a stop ends. */
class DecoratingDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly takeDecoration: () =>
      ((handle: FakeSessionHandle) => FakeSessionHandle) | null,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const decorate = this.takeDecoration()
    return decorate === null ? handle : decorate(handle)
  }
}

/**
 * ⚑ **A turn that stays `working` until a stop ends it, in the provider's own word** —
 * `state-a-supervisor-can-trust`'s instrument. ⛔ The Fake's own turn parks on a permission card,
 * and an agent may not stop a turn a person is being asked in. ⚑ `completed` is the turn a provider
 * finishes anyway (Codex, `709`); `interrupted` is the stop honoured.
 */
function aTurnAStopEnds(
  handle: FakeSessionHandle,
  itsWord: 'interrupted' | 'completed',
): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'send') {
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
        }
      }
      if (property === 'interrupt') {
        return async (): Promise<void> => {
          machine.requestInterrupt()
          machine.completeTurn(itsWord)
        }
      }
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

describe('732 · a retry that works, and names, not folders', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  let decorateNext: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  /** ⚑ Lets a held resume through — a failed assertion must not leave the teardown waiting on it. */
  let releaseTheHeldResume: () => void
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-732-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_320_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    decorateNext = null
    releaseTheHeldResume = () => {}
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new DecoratingDouble(provider, handles, issued, gate, () => {
          const decorate = decorateNext
          decorateNext = null
          return decorate
        }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    releaseTheHeldResume()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⚑ **A person opens a conversation with NO folder chosen** — the app's default workspace, which
   * every conversation below shares: the folder is one word for all of them (§2's premise).
   */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callOn = (caller: string, name: ToolName, args: Record<string, unknown> = {}) =>
    callAs(host, caller, name, args)

  const asAgent = (id: string): { ownerId: string } => ({ ownerId: `agent:${id}` })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · `681` F-a — a retry is said only where a retry can work
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  interface AWakeInFlight {
    readonly parent: string
    readonly child: string
    /** ⚑ **D-016** — the piece the parent gave the child, which a follow-up names. */
    readonly piece: string
    /** Lets the held resume through; the wake then lands and `woken` settles. */
    readonly release: () => void
    readonly woken: Promise<Record<string, unknown>>
  }

  /**
   * ⚑ **The case `681`'s review found**: a child holding work its parent gave it, stopped, and woken
   * by that parent — ⚑ **D-017 · R1: by a message, since every delivery starts its recipient**
   * (`resume_agent` and `end_agent` are gone; the stop is the app's own) — held at the provider's
   * door, so it is STARTING while the parent's next call arrives. ⚠️ `auto`, so the work's turn runs
   * to its end rather than parking on a card. ⚑ **D-016 · the work is a give**, whose brief is the
   * child's first turn.
   */
  const aWakeInFlightIntoWorkItHolds = async (
    silent: boolean,
    // ⚑ Who starts it again: its parent's message (the case), or a person's Reopen (§1.4).
    reopenedBy: 'its-parent' | 'a-person' = 'its-parent',
  ): Promise<AWakeInFlight> => {
    await bringIdentityIntoBeing('worker')
    const parent = await personOpens('lead', 'auto')
    const given = await callOn(parent, 'give_work', {
      to: 'new',
      conversation_title: 'the work',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'hold this',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string
    const piece = given.piece as string
    await waitFor(
      () => host.agentCard(child, asAgent(parent), parent)?.state.is === 'idle',
      'the work’s turn to end',
    )
    await host.close(child, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(child), 'the child to be stopped')
    const task = store.piecesOwnedBy(child)[0]
    if (task === undefined) throw new Error('the product path gave no piece')
    // ⛔ The premise: the work is still OPEN, and it is this parent's.
    expect(task).toMatchObject({ piece, giver: parent, state: 'stalled' })
    let release!: () => void
    gate.held = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseTheHeldResume = () => {
      gate.held = null
      release()
    }
    gate.silentUntilItsFirstTurn = silent
    const woken =
      reopenedBy === 'its-parent'
        ? callOn(parent, 'message_agent', {
            agent: child,
            text: 'wake up',
            kind: 'follow-up',
            piece,
          })
        : host.resumeSession(child, window).then(() => ({ outcome: 'ok' }))
    await waitFor(() => gate.entered > 0, 'the wake to reach the provider’s door')
    // ⛔ And the child really is STARTING — the state *not started* is said about; ⚑ **D-017 ·
    // R11: `active`**, the one state's word for a start on its way in.
    expect(host.agentCard(child, asAgent(parent), parent)?.state).toEqual({ is: 'active' })
    return {
      parent,
      child,
      piece,
      release: () => {
        releaseTheHeldResume()
      },
      woken,
    }
  }

  describe('§1 · `681` F-a — the receiver’s open work answers before *not started*', () => {
    // ⛔ **§1.1 and §1.3 are gone with their subject** (D-016): they measured
    // `agent-already-has-work-open` — and `assign-work-to-one-you-did-not-start` — answering before
    // *not started*, and both rails left with the work message. ⚑ A give reaches the giver's OWN
    // conversation with an agent, so an outsider's give never reaches this child at all, and the
    // rail that holds a give back from a helper is the stall rule, asked of what the child's ledger
    // says — and the two resume shapes they ran in went with them. ⚑ What §1 still measures is the
    // rest of R30b's order: a question and a person's words WAIT for the start (§1.2, §1.4).

    it('⚑ §1.2 control · a QUESTION to the same starting child WAITS for the start and is delivered — never told to retry', async () => {
      // ⚑ A question never meets the open-work rail (HO-021 §1: the investigate half), so for it the
      // only thing standing between the call and the child is the start — ⚑ **D-017 · R1: and a
      // start in flight is waited on**, never answered *not started* (*still starting* is never a
      // refusal).
      const wake = await aWakeInFlightIntoWorkItHolds(false)
      const ask = {
        agent: wake.child,
        text: 'how far did you get?',
        kind: 'follow-up',
        piece: wake.piece,
      }
      const asking = callOn(wake.parent, 'message_agent', ask)
      // ⛔ **Still pending while the start is held** — a refusal would already have settled it.
      expect(
        await Promise.race([
          asking.then(() => 'settled'),
          new Promise((resolve) => setTimeout(() => resolve('still pending'), 50)),
        ]),
      ).toBe('still pending')
      wake.release()
      expect((await wake.woken).outcome).toBe('ok')
      expect(await asking).toMatchObject({ outcome: 'ok' })
      await waitFor(
        () =>
          events(wake.child).some(
            (event) => event.type === 'user_turn' && event.text.includes('how far did you get?'),
          ),
        'the question to reach the child it waited for',
      )
    })

    it('⚑ §1.4 control · a PERSON typing into the same child while their Reopen starts it WAITS for the start — never the agent’s rail', async () => {
      // ⚑ **The rail is about work an AGENT gives** — a person composing in a window declares nothing
      // (`queueMessage` reads `says` only for an agent; theirs is `MESSAGE_KIND_WHEN_UNSAID`, a
      // question) and opens no task, so the parent's open work is nothing to them: what stands
      // between their words and the child is the start alone — ⚑ **D-017 · R1: and it is waited
      // on**, never refused *still starting*.
      const reopen = await aWakeInFlightIntoWorkItHolds(false, 'a-person')
      const typed = host.queueMessage(reopen.child, 'what happened to the work?', window)
      // ⛔ **Still pending while the start is held** — a refusal would already have settled it.
      expect(
        await Promise.race([
          typed.then(
            () => 'settled',
            () => 'settled',
          ),
          new Promise((resolve) => setTimeout(() => resolve('still pending'), 50)),
        ]),
      ).toBe('still pending')
      reopen.release()
      expect((await reopen.woken).outcome).toBe('ok')
      await typed
      await waitFor(
        () =>
          events(reopen.child).some(
            (event) =>
              event.type === 'user_turn' && event.text.includes('what happened to the work?'),
          ),
        'the words to reach the child they waited for',
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · `729` F-1 — the band names the holder and the giver
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  interface GraceAdaAndBob {
    readonly boss: string
    readonly pm: string
    readonly worker: string
    readonly piece: string
  }

  /**
   * ⚑ **`729`'s ancestor rig, in the default folder**: Grace opened by a person, Ada given a piece
   * by Grace, Bob given a piece by Ada — Bob's turn WORKING, so an agent may stop it. ⚑ **D-016 · a
   * give starts each of them, and its brief is the first turn**: Ada's parks on a card (Grace's
   * `ask`), and Bob's is the held provider turn. ⚠️ Every one of them works in the one default
   * workspace, so the folder names none of them.
   */
  const graceAdaAndBob = async (
    itsWord: 'interrupted' | 'completed',
    words: string,
  ): Promise<GraceAdaAndBob> => {
    const boss = await nameGracesTeam(host, bringIdentityIntoBeing, personOpens)
    const givenPm = await callOn(boss, 'give_work', {
      to: 'new',
      conversation_title: 'plan',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'pm-g',
      title: 'plan',
      brief: 'plan',
    })
    expect(givenPm.outcome, JSON.stringify(givenPm)).toBe('ok')
    const pm = givenPm.agent as string
    decorateNext = (handle) => aTurnAStopEnds(handle, itsWord)
    let givenWorker: Record<string, unknown>
    try {
      givenWorker = await callOn(pm, 'give_work', {
        to: 'new',
        conversation_title: 'work',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker-g',
        title: 'work',
        brief: words,
      })
    } finally {
      decorateNext = null
    }
    expect(givenWorker.outcome, JSON.stringify(givenWorker)).toBe('ok')
    const worker = givenWorker.agent as string
    await waitFor(
      () => host.agentCard(worker, asAgent(pm), pm)?.state.is === 'active',
      'the held provider turn to be working',
    )
    const task = store.piecesOwnedBy(worker).find((row) => row.brief === words)
    if (task === undefined) throw new Error('the product path gave no piece')
    return { boss, pm, worker, piece: task.piece }
  }

  /** ⚑ Ada goes away, then Grace stops Bob: the work stalls with nobody left to tell. */
  const graceStopsBobWhileAdaIsClosed = async (rig: GraceAdaAndBob): Promise<void> => {
    host.claimSession(rig.pm, window)
    await host.close(rig.pm, window)
    const stopped = await callOn(rig.boss, 'interrupt_agent', {
      agent: rig.worker,
      reason: 'the plan changed',
    })
    expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
    await waitFor(
      () =>
        store.piecesOwnedBy(rig.worker).find((row) => row.piece === rig.piece)?.state === 'stalled',
      'the work to stall on the turn Grace stopped',
    )
  }

  const theFolderOf = (sessionId: string): string =>
    basename(store.recordedOne(sessionId)?.cwd ?? '')

  describe('§2 · `729` F-1 — a person’s band names the holder and the giver, never their folder', () => {
    for (const [itsWord, because] of [
      ['completed', 'turn_ended'],
      ['interrupted', 'turn_interrupted'],
    ] as const) {
      it(`🔴 §2.1 Bob holds the work Ada gave out — the band says Bob and Ada, in the default folder (${because})`, async () => {
        const rig = await graceAdaAndBob(itsWord, `732-the-band-names-them-${because}`)
        if (because === 'turn_ended') {
          // Closing a giver permits a later wake; this case needs a giver that cannot be woken.
          const boundary = host as unknown as { reconciliationMayWake(target: string): boolean }
          const mayWake = boundary.reconciliationMayWake.bind(host)
          vi.spyOn(boundary, 'reconciliationMayWake').mockImplementation(
            (target) => target !== rig.pm && mayWake(target),
          )
        }
        await graceStopsBobWhileAdaIsClosed(rig)
        // ⛔ **The premise**: each runs in its own profile's home, named by its slug, which is not
        // the name a person reads.
        expect(theFolderOf(rig.worker)).toBe('worker-g')
        expect(theFolderOf(rig.pm)).toBe('pm-g')
        if (because === 'turn_ended') {
          await waitFor(
            () => host.workIncidentsForAPerson().rows.some((one) => one.piece === rig.piece),
            'the failed holder and unavailable giver to reach the person',
          )
          expect(host.stalledWorkForAPerson().rows.some((one) => one.piece === rig.piece)).toBe(
            false,
          )
          const incident = host
            .workIncidentsForAPerson()
            .rows.find((one) => one.piece === rig.piece)
          expect(incident).toMatchObject({
            holder: rig.worker,
            holderName: 'Bob',
            giver: rig.pm,
            giverName: 'Ada',
            kind: 'stopped',
            cause: because,
          })
          if (incident === undefined) throw new Error('the serial incident was not listed')
          const lead = incidentSays(incident, tick())
          expect(lead).toContain('Bob')
          expect(lead).toContain('Ada')
          expect(lead).not.toContain('worker-g')
          expect(lead).not.toContain('pm-g')
          expect(
            store.piecesOwnedBy(rig.worker).find((one) => one.piece === rig.piece)?.stalledBy,
          ).toMatchObject({ by: 'an-agent', asker: rig.boss })
          expect(store.reconciliationReceipts(rig.worker, rig.piece)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ step: 'holder', outcome: 'failed' }),
              expect.objectContaining({ step: 'giver', outcome: 'failed' }),
              expect.objectContaining({ step: 'person', outcome: 'listed' }),
            ]),
          )
          return
        }
        const row = host.stalledWorkForAPerson().rows.find((one) => one.piece === rig.piece)
        expect(row).toMatchObject({ owner: rig.worker, giver: rig.pm, because })
        // 🔴 **RED on `main`**: the folders' names.
        expect({ holder: row?.ownerName, giver: row?.giverName }).toEqual({
          holder: 'Bob',
          giver: 'Ada',
        })
        // ⚑ **Control — a name that was already an identity's is unchanged**: the asker, named since
        // `729` (R41 on `askedToStop`) — ⚑ D-016 · commit 7 · R3: beside the piece it owns (its
        // root), which nothing else on the band names, composed by the product's one helper.
        const bossOwns = store.workThatNames(rig.boss)
        if (bossOwns === null) throw new Error('the asker holds no piece to be named by')
        expect(bossOwns.label).toBe(store.rootOf(rig.boss)?.label)
        expect(row?.askedToStop).toEqual({
          by: 'an-agent',
          asker: rig.boss,
          askerName: theConversationCalled('Grace', bossOwns),
        })
        // ⚑ **The sentence a person reads**, the renderer's own lead over this row.
        const lead = row === undefined ? '' : stalledWorkLead(row)
        expect(lead).toContain('with Bob is not being worked on')
        expect(lead).toContain('and Ada — which gave it out —')
        expect(lead).not.toContain('worker-g')
        expect(lead).not.toContain('pm-g')
      })
    }

    it('⚑ §2.2 the names are read per look — renamed, the next look says the new ones', async () => {
      // ⚠️ A memo that outlived one answer would say *Bob* and *Ada* for the life of the app.
      const rig = await graceAdaAndBob('interrupted', '732-renamed')
      await graceStopsBobWhileAdaIsClosed(rig)
      expect(await host.setAgentDisplayName('worker-g', 'Ben')).not.toBeNull()
      expect(await host.setAgentDisplayName('pm-g', 'Ava')).not.toBeNull()
      const row = host.stalledWorkForAPerson().rows.find((one) => one.piece === rig.piece)
      expect({ holder: row?.ownerName, giver: row?.giverName }).toEqual({
        holder: 'Ben',
        giver: 'Ava',
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · `730` F-4 — `work_interrupted` says WHO asked
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  const asksIn = (sessionId: string): TranscriptEvent[] =>
    events(sessionId).filter((event) => event.type === 'work_interrupted')

  /**
   * ⚑ **The identity on the row, named through the roster** — `agentName`, the function the frontend
   * is to draw it with. ⚠️ No product reader draws it yet: this measures what the row lets a reader
   * say, not a drawing.
   */
  const drawnAs = (ask: TranscriptEvent | undefined): string | null =>
    ask?.type === 'work_interrupted' && ask.agentProfile !== undefined
      ? agentName(ask.agentProfile, store.agentIdentities())
      : null

  describe('§3 · `730` F-4 — the ask carries the asking agent’s identity', () => {
    // ⚠️ **The row is written BEFORE the provider is touched** (`recordTheAsk`, then `interrupt()`), so
    // the two words below measure one write — kept so a writer moved to the turn's terminal would be
    // measured on the word that finishes the turn anyway, too.
    for (const itsWord of ['completed', 'interrupted'] as const) {
      it(`🔴 §3.1 Grace stops Bob — Bob’s ledger says it was Grace’s identity, beside her id (${itsWord})`, async () => {
        const rig = await graceAdaAndBob(itsWord, `732-the-ask-names-grace-${itsWord}`)
        const stopped = await callOn(rig.boss, 'interrupt_agent', {
          agent: rig.worker,
          reason: 'the plan changed',
        })
        expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
        // 🔴 **RED on `main`**: `{ by, agent }` and no identity — the transcript could only say the id.
        expect(asksIn(rig.worker)).toEqual([
          {
            type: 'work_interrupted',
            by: 'an-agent',
            agent: rig.boss,
            agentProfile: 'boss-g',
            reason: 'the plan changed',
          },
        ])
        // ⚑ …which the one naming function names (R41) — what the transcript is to draw.
        expect(drawnAs(asksIn(rig.worker)[0])).toBe('Grace')
      })
    }

    it('🔴 §3.2 Ada, its parent, stops Bob — the ask says it was Ada', async () => {
      // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the parent's own stop.
      const rig = await graceAdaAndBob('interrupted', '732-the-stop-names-ada')
      const stopped = await callOn(rig.pm, 'interrupt_agent', { agent: rig.worker, reason: 'done' })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      expect(asksIn(rig.worker)).toEqual([
        {
          type: 'work_interrupted',
          by: 'an-agent',
          agent: rig.pm,
          agentProfile: 'pm-g',
          reason: 'done',
        },
      ])
      expect(drawnAs(asksIn(rig.worker)[0])).toBe('Ada')
    })

    it('⚑ §3.3 control · a PERSON’s Stop names nobody — no id, and no identity, stored or sent live', async () => {
      const rig = await graceAdaAndBob('interrupted', '732-a-person-stops-bob')
      host.claimSession(rig.worker, window)
      await host.interrupt(rig.worker, window)
      expect(asksIn(rig.worker)).toEqual([{ type: 'work_interrupted', by: 'a-person' }])
      // ⚠️ **And the LIVE row** (`732`'s review): the store's door bounds the persisted copy only, and
      // the window is sent what the writer built.
      expect(
        window.messages
          .filter((one) => one.sessionId === rig.worker && one.event.type === 'work_interrupted')
          .map((one) => one.event),
      ).toEqual([{ type: 'work_interrupted', by: 'a-person' }])
    })

    it('⚑ §3.4 the row keeps WHO across a rename, not what it was called — named over it, the answer is the new name', async () => {
      // ⛔ `relayedFromProfile`'s rule: never a display name on a durable row, so one rename moves every
      // surface at once — the band (§2.2), the relayed bubble, and this.
      const rig = await graceAdaAndBob('interrupted', '732-renamed-after')
      expect(
        (await callOn(rig.boss, 'interrupt_agent', { agent: rig.worker, reason: 'why' })).outcome,
      ).toBe('ok')
      expect(await host.setAgentDisplayName('boss-g', 'Gina')).not.toBeNull()
      expect(asksIn(rig.worker)).toEqual([
        {
          type: 'work_interrupted',
          by: 'an-agent',
          agent: rig.boss,
          agentProfile: 'boss-g',
          reason: 'why',
        },
      ])
      expect(drawnAs(asksIn(rig.worker)[0])).toBe('Gina')
    })

    it('⛔ §3.5 a replayed row keeps an identity only by the slug’s own rule, and only beside a conversation', async () => {
      // ⚑ **The store's door is a trust boundary** (`boundRelayedIdentity`): an imported or edited
      // ledger could otherwise put anything where a person will read a name. ⚑ The control is the row
      // this app writes, which survives whole.
      const ledger = await personOpens('a-ledger')
      await host.close(ledger, window)
      const planted: Record<string, unknown>[] = [
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x', agentProfile: 'boss-g' },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x', agentProfile: 'Grace Hopper' },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x', agentProfile: 42 },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x', agentProfile: 'g'.repeat(65) },
        { type: 'work_interrupted', by: 'a-person', agentProfile: 'boss-g' },
      ]
      for (const row of planted) {
        store.append(ledger, store.nextOrdinal(ledger), row as unknown as TranscriptEvent, tick())
      }
      expect(asksIn(ledger)).toEqual([
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x', agentProfile: 'boss-g' },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x' },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x' },
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_x' },
        { type: 'work_interrupted', by: 'a-person' },
      ])
    })
  })
})
