import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { stalledPiecesSaid } from '../src/main/runtime/spawn-rails'
import { TASK_STALL_CAUSES, undrivenSentence } from '../src/shared/tasks'
import { readOfferedResource } from '../src/main/resources/resources'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # The survivors the tree landing left — four mutation rows that no test killed
 *
 * ⚑ **What this file pins, and why it is one file.** The tree landing (D-016) deleted or reshaped
 * the fixtures that used to kill five mutation rows, and the rows survived. Four are pinned here,
 * each by the test below that kills it on the landed tree; the fifth was retired with its subject,
 * and its entry says why. ⛔ None of the tests touches product code, an old test, a mutation table
 * or a census.
 *
 *  - **380 M17 · the cap is inclusive.** A text resource of EXACTLY 1,048,576 bytes is offered; one
 *    byte over is refused `resource-too-large`, naming both numbers. ⚑ The literal is written here,
 *    never the constant plus one (the constant's own doc says why).
 *  - **404 M10 · a parent is told one notice at a time.** Two pieces of one parent stalling together
 *    put two notices at ONE door; the second waits behind the first (`parent.telling`), so no two
 *    sends are ever in flight on the parent's handle. ⚑ Measured on the handle, because the end state
 *    is the same either way — a lost race is HELD and read later.
 *  - **428 M6 · a give's refusal never promises that trying again works.** `its-work-has-stalled`
 *    holds until the piece is answered, closed or taken back (a stopped holder included); waiting
 *    does nothing to it.
 *  - ⛔ **711 M2 · retired with its subject (D-030).** It pinned R48's line after a push already
 *    READ — the snapshot taken as the answer was recorded. ⚑ A reply whose delivery fails is now
 *    held for its giver, so the answer itself follows the push and no line is composed; the
 *    snapshot and the line are gone, and so is the test.
 *  - **1016 M9 · the stall rule is asked of the worker, not of the caller's own id.** A replaced
 *    giver's replacement is refused a give to the worker still holding the PREDECESSOR's stalled piece.
 *
 * ⚑ **Every negative below is paired with a positive read by the same reader**, and presence is
 * asserted before order or text. ⚠️ Nothing here plants a mutation: the rows are verified RED by the
 * landing, so each test states the fact its row breaks and the premise that lets it be seen.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('the survivors the tree landing left', () => {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 380 M17 — the cap of a text resource, at the byte
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('380:M17 · the cap of a text resource', () => {
    let dir: string

    beforeEach(() => {
      dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'brobot2-survivors-cap-')))
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('380:M17 · a text resource of exactly the cap is offered, one byte over it is refused', () => {
      for (const name of ['prose.md', 'page.html']) {
        const atTheCap = 'a'.repeat(1_048_576)
        const overTheCap = 'a'.repeat(1_048_577)
        const exact = join(dir, `exact-${name}`)
        const over = join(dir, `over-${name}`)
        writeFileSync(exact, atTheCap)
        writeFileSync(over, overTheCap)

        // ⚑ The cap itself is inside it: every one of its bytes is read, and hashed.
        const offered = readOfferedResource(exact)
        if (!offered.ok) throw new Error(`${name} at the cap was refused: ${offered.refusal.rail}`)
        expect(offered.bytes.length).toBe(1_048_576)
        expect(offered.sha256).toBe(createHash('sha256').update(atTheCap).digest('hex'))

        // ⚑ …and the byte after it is not — the same reader, the same name, one byte more.
        const refused = readOfferedResource(over)
        if (refused.ok) throw new Error(`${name} one byte over the cap was offered`)
        expect(refused.refusal.rail).toBe('resource-too-large')
        expect(refused.refusal.detail).toEqual({ path: over, bytes: 1_048_577, limit: 1_048_576 })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 428 M6 — the sentence a give says of a stalled piece
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('428:M6 · the sentence of a stalled give', () => {
    /**
     * ⚑ Words that promise a retry will work. ⚠️ Kept broad on purpose: a sentence that grows a
     * promise grows it in any of these.
     */
    const A_PROMISE_TO_RETRY =
      /try again|again once|once it has finished|make the same call again|wait|retry/i

    it("428:M6 · a give's sentence about a stalled piece never promises that waiting or trying again will work", () => {
      // ⚑ **Paired positive — the reader can SEE a promise.** Two sentences that do make one, one
      // of them this app's own words for a call that IS worth repeating.
      expect('Make the same call again in a moment.').toMatch(A_PROMISE_TO_RETRY)
      expect('nothing was given. Or try again once it has finished.').toMatch(A_PROMISE_TO_RETRY)

      for (const labels of [['W1.1'], ['W1.2', 'W1.3']]) {
        const stalled = labels.map((label) => ({ label, cause: 'turn_ended' as const }))
        const said = stalledPiecesSaid(stalled)
        // ⚑ The acts it does name are there, in the tools' own words.
        expect(said).toContain('withdraw_task')
        expect(said).toContain('message_agent')
        // ⚑ The kind that continues the work, so it is not re-sent as new work.
        expect(said).toContain('(kind follow-up)')
        for (const label of labels) expect(said).toContain(label)
        expect(said.endsWith('back with withdraw_task.')).toBe(true)
        // ⛔ …and it promises nothing about waiting.
        expect(said).not.toMatch(A_PROMISE_TO_RETRY)
      }
      // ⚑ A give that found no stall says nothing of one.
      expect(stalledPiecesSaid([])).toBe('')
    })

    it('⚑ F146 · every stall cause is named, in the words list_tasks already says it in', () => {
      for (const cause of TASK_STALL_CAUSES) {
        const said = stalledPiecesSaid([{ label: 'W1.1', cause }])
        expect(said, cause).toContain(`W1.1 (${undrivenSentence(cause)})`)
      }
      // ⚑ Two pieces, each beside its own cause.
      expect(
        stalledPiecesSaid([
          { label: 'W1.1', cause: 'turn_ended' },
          { label: 'W1.2', cause: 'app_restarted' },
        ]),
      ).toContain(
        `W1.1 (${undrivenSentence('turn_ended')}) and W1.2 (${undrivenSentence('app_restarted')}) from you`,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Over a real host — 404 M10, 1016 M9
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('over a real host', () => {
    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let hosts: RuntimeHost[]
    let handles: FakeSessionHandle[]
    let issued: FakeProviderSessions
    let counter: number
    let clock: number
    let window: RecordingSink
    let gate: ResumeGate
    const tick = (): number => clock++

    const buildHost = (): RuntimeHost => {
      const built = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        now: tick,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      hosts.push(built)
      return built
    }

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-survivors-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-survivors-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      clock = 9_100_000
      store = createSessionStore(db, tick)
      counter = 0
      hosts = []
      handles = []
      issued = new FakeProviderSessions()
      gate = anOpenGate()
      host = buildHost()
      window = new RecordingSink('webContents:1')
    })

    afterEach(async () => {
      for (const built of hosts) await built.closeAll()
      db.close()
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
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

    /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
    const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

    const personOpens = async (
      profileId: string,
      approvalMode: 'ask' | 'auto' = 'ask',
    ): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId, approvalMode, cwd: root },
        window,
      )
      return sessionId
    }

    /** ⚑ An identity brought into being and stopped, so a give finds it by its name. */
    const identitiesExist = async (
      profiles: readonly string[],
      approvalMode: 'ask' | 'auto' = 'ask',
    ): Promise<void> => {
      for (const profile of profiles)
        await host.close(await personOpens(profile, approvalMode), window)
    }

    const callOn = async (
      caller: string,
      name: ToolName,
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> => {
      const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }

    /**
     * ⚑ Every way words reach a conversation — a busy one HOLDS them, an idle one takes a turn.
     * 🔴 **D-027** — a turn of several carries each message as a `part`, its own `text` the words
     * joined, so a turn is read message by message through `theMessagesOf`.
     */
    const wordsIn = (sessionId: string): string[] =>
      events(sessionId).flatMap((event) =>
        event.type === 'user_turn'
          ? theMessagesOf(event).map((message) => message.text)
          : event.type === 'message_queued'
            ? [event.text]
            : [],
      )
    /** ⚑ What a conversation has READ — every message of every turn it was handed (D-027, above). */
    const read = (sessionId: string): string[] =>
      events(sessionId).flatMap((event) =>
        event.type === 'user_turn' ? theMessagesOf(event).map((message) => message.text) : [],
      )

    const labelOf = (piece: string): string => {
      const label = store.workById(piece)?.label
      if (label === undefined) throw new Error(`no piece ${piece}`)
      return label
    }

    /** ⚑ The giver's receipts, keyed by piece — what it was told, and how (`work_stall_told`). */
    const receiptsTo = (parent: string, piece: string) =>
      giverStallReceipts(store, parent).filter((event) => event.piece === piece)

    /**
     * ⚑ Matched on the FIRST line and the closing imperative — a notice names its piece by the
     * label where it quoted the id.
     */
    const noticesAbout = (parent: string, label: string, opening: string): string[] =>
      wordsIn(parent).filter((text) => {
        const lines = text.split('\n')
        return (
          ((lines[0] ?? '').includes(opening) &&
            (lines.at(-1) ?? '').includes(`naming ${label}.`)) ||
          (opening === 'not being worked on' &&
            (lines[0] ?? '').startsWith(`${label} still needs attention:`))
        )
      })

    const runningOf = (sessionId: string): string | undefined =>
      [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (row) => row.sessionId === sessionId,
      )?.running

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // 404 M10
    // ─────────────────────────────────────────────────────────────────────────────────────────

    it('404:M10 · two pieces of one parent are told one at a time, never two sends in flight on the parent', async () => {
      await identitiesExist(['worker-a', 'worker-b'], 'auto')
      const pm = await personOpens('pm', 'auto')
      const pmHandle = handles.at(-1)
      if (pmHandle === undefined) throw new Error('the parent has no provider handle')

      // ⚑ **The parent's door, held.** The wrapper counts how many sends are at the door at once and
      // holds each one BEFORE the provider is touched, so the handle stays idle and a second notice
      // that is not made to wait would walk straight in behind the first.
      let reached = 0
      let inFlight = 0
      let mostInFlight = 0
      let openTheDoor!: () => void
      const theDoor = new Promise<void>((resolve) => {
        openTheDoor = resolve
      })
      const send = pmHandle.send.bind(pmHandle)
      Object.defineProperty(pmHandle, 'send', {
        value: async (...args: Parameters<FakeSessionHandle['send']>) => {
          reached++
          inFlight++
          mostInFlight = Math.max(mostInFlight, inFlight)
          try {
            await theDoor
            return await send(...args)
          } finally {
            inFlight--
          }
        },
        configurable: true,
      })

      const first = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker-a',
        title: 'The first piece',
        brief: 'do the first piece',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      // ⚑ **The premise**: the first notice is AT the door, so the second has something to queue behind.
      await waitFor(() => reached === 1, 'the first notice at the parent’s door')

      const second = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker-b',
        title: 'The second piece',
        brief: 'do the second piece',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      const firstPiece = first.piece as string
      const secondPiece = second.piece as string
      await waitFor(
        () => store.piecesOwnedBy(second.agent as string)[0]?.state === 'stalled',
        'the second piece to stop being driven',
      )
      await letItSettle()

      // ⛔ **One at the door, while it is held**: the second notice is waiting its turn, not walking in.
      expect(reached).toBe(1)
      expect(mostInFlight).toBe(1)

      openTheDoor()
      // ⚑ **Paired positive — the second is not lost, only later**: both pieces reach the parent.
      await waitFor(
        () => receiptsTo(pm, firstPiece).length > 0 && receiptsTo(pm, secondPiece).length > 0,
        'both notices to be told',
      )
      expect(noticesAbout(pm, labelOf(firstPiece), 'not being worked on').length).toBeGreaterThan(0)
      expect(noticesAbout(pm, labelOf(secondPiece), 'not being worked on').length).toBeGreaterThan(
        0,
      )
      expect(mostInFlight).toBe(1)
    })

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // 1016 M9
    // ─────────────────────────────────────────────────────────────────────────────────────────

    it("1016:M9 · a replaced giver is told of its predecessor's stalled piece when it gives the worker more", async () => {
      await host.close(await personOpens('worker', 'auto'), window)
      const pm = await personOpens('pm', 'auto')
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The schema',
        brief: 'migrate the schema',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const worker = given.agent as string
      const label = given.label as string
      // ⚑ The worker's turn ends with the piece open: nothing drives it.
      await waitFor(
        () => store.piecesOwnedBy(worker)[0]?.state === 'stalled',
        'the piece to stop being driven',
      )
      expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_ended')
      // ⚑ The giver is told, and stops; then its provider forgets it, so a message replaces it.
      await waitFor(() => read(pm).some((text) => isGiverStallNotice(text)), 'the giver to be told')
      await letItSettle()
      await host.close(pm, window)
      await waitFor(() => runningOf(pm) === 'not-running', 'the giver to be stopped')
      issued.forgetAll()
      const answer = await host.startAndSend(pm, 'are you there', window)
      if (!('sent' in answer)) throw new Error(`not sent: ${JSON.stringify(answer)}`)
      const next = answer.sent.sessionId
      expect(next).not.toBe(pm)
      expect(events(pm)).toContainEqual({ type: 'replaced_by', sessionId: next })

      // ⚑ **The premise**: the piece is the PREDECESSOR's — its giver is not the caller below — and
      // it is still stalled with the worker still running.
      const piece = store.piecesOwnedBy(worker)[0]
      expect(piece?.giver).toBe(pm)
      expect(piece?.state).toBe('stalled')
      expect(next).not.toBe(piece?.giver)

      const said = (): string[] => read(worker).filter((text) => text.includes('and another piece'))
      const named = await callOn(next, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'And another',
        brief: 'and another piece',
      })
      // ⚑ Admitted, and the predecessor's stalled piece is named to its replacement.
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      expect(named.agent).toBe(worker)
      expect(named.stalled).toEqual([label])
      await waitFor(() => said().length > 0, 'the worker to read the give')

      // ⚑ **Paired positive — one fact over**: the replacement takes the predecessor's piece back,
      // and the next give names it no more.
      const back = await callOn(next, 'withdraw_task', { piece: label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      const admitted = await callOn(next, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'And a third',
        brief: 'a third piece',
      })
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
      expect((admitted.stalled as string[] | undefined) ?? []).not.toContain(label)
    })
  })
})
