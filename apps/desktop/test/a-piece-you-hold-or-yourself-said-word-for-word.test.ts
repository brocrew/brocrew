import { giveAndWaitForBriefTurn, giveWorkWithTitleAsBrief } from './lib/give-fixture'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { type RecordingSink, fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import { closeAndRemove, homesUnder, scratchHostState } from './helpers/scratch-host'
import { personOpener } from './helpers/person-opens-session'
import { answerOn } from './helpers/call-tool'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { sameLocalDay } from '../src/shared/local-time'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'

/**
 * 🔴 **W4.154 · F089–F091 — the words a model reads, WORD FOR WORD** (`52872cc0`, `8e0773c3`).
 *
 * The devs' own tests compare these refusals with the functions and constants that build them
 * (the take-back formatter), so a sentence
 * reworded in its builder still passes them, and `the-act-inside-the-cut` pins only each act. Here
 * every sentence is written out, so its whole meaning is pinned:
 *
 *  - §1 · F089 · `withdraw_task` on a piece the caller holds — open; ended each way (answered, taken
 *    back, closed), and read days later; on its own root; and on a name it neither holds nor gave.
 *  - §2 · F090 · `update_work` from the owner of a piece taken back while its give still waited
 *    (whose row names nobody) — close, new brief and title — and the words as the model reads them.
 *  - §3 · F091 · `interrupt_agent` naming itself — its id, a piece it holds open and once ended, its
 *    own root — and a piece it GAVE, which names its holder, never itself.
 *
 * Real host, real SQLite ledger, real migrations, over `FakeRuntime` — the harness of
 * `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`, cut to what this needs.
 */

const DAY_MS = 86_400_000

const UNKNOWN_PIECE =
  'no piece by that name is available to this call, so nothing was done. Check its label or id with search_work or list_tasks.'
const OWN_ROOT =
  'that is this conversation’s own work, from a person, so nothing was done: ask a person with ask_question naming it, and answer the person here when it is done. Close or withdraw a piece under a conversation’s own work.'
const heldEndedWords = (label: string, title: string, outcome: string, ending: string): string =>
  `Not changed: task ${label} · ${title} has ended (${outcome}) and keeps that outcome. ${ending}. Stop work on it; no further reply is owed.`

/** `FakeRuntime` with the toolset each launch was handed captured, so a test can act as that agent. */
describe('W4.154 · F089–F091 · a piece you hold, or yourself, said word for word', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      ...homesUnder(() => userData),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    clock = 7_200_000
    ;({ userData, root, db, store, issued, window } = scratchHostState('brobot2-held-words', tick))
    counter = 0
    hosts = []
    handed = []
    host = buildHost()
  })

  afterEach(() => closeAndRemove(hosts, db, userData, root))

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> =>
    host.close(await personOpens(profileId), window)

  /** The words a model reads, and the payload beside them. */
  const callWithWords = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const result = await answerOn(toolset, name, args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await callWithWords(toolset, name, args)).structured

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const aGive = giveWorkWithTitleAsBrief

  /** A PM a person opened, and one worker it gave a piece to. */
  const aPmAndItsWorker = async (title: string) => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await aGive(pmTools, 'worker', title)
    return {
      pm,
      worker: given.agent,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.piece,
      label: given.label,
    }
  }

  /** When the piece `label` that `holder` holds ended — its row's own moment. */
  const endedAt = (holder: string, label: string): number => {
    const at = store.piecesOwnedBy(holder).find((one) => one.label === label)?.endedAt
    if (typeof at !== 'number') throw new Error(`${label} has no moment it ended`)
    return at
  }

  /** A refusal, with its words as the model reads them and as the payload carries them. */
  const expectRefused = (
    said: { structured: Record<string, unknown>; text: string },
    rail: string,
    reason: string,
    what: string,
  ): void => {
    expect(said.structured, what).toMatchObject({
      outcome: 'refused',
      rail,
      permanence: 'permanent',
      retryable: false,
      reason,
    })
    // The rail's sentence as it was, then only the permanence the answer adds.
    expect(reason, what).toMatch(/[.!?]$/)
    const detail = rail === 'that-piece-was-already-answered' ? 'The reply outcome was done. ' : ''
    expect(said.text, what).toBe(
      reason.startsWith('Not changed:')
        ? reason
        : `refused (${rail}): ${reason} ${detail}${permanenceInWords(rail, 'permanent')}`,
    )
  }

  describe('§1 · F089 · withdraw_task on a piece the caller holds', () => {
    it('withdraws an open held piece and explains a later retry by the giver', async () => {
      const { workerTools, pmTools, label } = await aPmAndItsWorker('the piece')
      const taken = await callOn(workerTools, 'withdraw_task', { piece: label })
      expect(taken).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      const again = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(again).toMatchObject({ outcome: 'refused', rail: 'that-piece-was-already-taken-back' })
    })

    it('🔴 ended — answered by it, taken back by its giver, closed by its giver: each whole, with who and when', async () => {
      const { pm, worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
      await bringIdentityIntoBeing('helper')
      await bringIdentityIntoBeing('reviewer')
      const back = await aGive(pmTools, 'helper', 'the piece taken back')
      const closed = await aGive(pmTools, 'reviewer', 'the piece closed')
      expect(
        (
          await callOn(workerTools, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'done',
          })
        ).outcome,
      ).toBe('ok')
      expect((await callOn(pmTools, 'withdraw_task', { piece: back.label })).outcome).toBe('ok')
      expect(
        (await callOn(pmTools, 'update_work', { piece: closed.label, close: true })).outcome,
      ).toBe('ok')
      const thePm = host.whatToCallTheConversation(pm)
      for (const [holder, named, title, rail, outcome, actor, ending] of [
        [
          worker,
          label,
          'the piece',
          'that-piece-was-already-answered',
          'done',
          { endedByYou: true },
          `You answered ${label}`,
        ],
        [
          back.agent,
          back.label,
          'the piece taken back',
          'that-piece-was-already-taken-back',
          'withdrawn',
          { called: thePm },
          `${back.label} was taken back by ${thePm}`,
        ],
        [
          closed.agent,
          closed.label,
          'the piece closed',
          'that-piece-was-already-closed',
          'closed',
          { called: thePm },
          `${closed.label} was closed by ${thePm}`,
        ],
      ] as const) {
        const at = endedAt(holder, named)
        const tools = holder === worker ? workerTools : agentToolsFor(host, holder)
        const refused = await callWithWords(tools, 'withdraw_task', { piece: named })
        expectRefused(
          refused,
          rail,
          heldEndedWords(named, title, outcome, `${ending} at ${clockTime(at)}`),
          named,
        )
        expect(refused.structured.detail).toMatchObject({ label: named, at, ...actor })
      }
    })

    it('read days after it ended: the detail keeps the original ending timestamp', async () => {
      const { workerTools, worker, label } = await aPmAndItsWorker('the piece')
      expect(
        (
          await callOn(workerTools, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'done',
          })
        ).outcome,
      ).toBe('ok')
      const at = endedAt(worker, label)
      clock += 3 * DAY_MS
      expect(sameLocalDay(at, clock)).toBe(false)
      const said = clockTimeFrom(at, clock)
      expect(said).not.toBe(clockTime(at))
      const refused = await callWithWords(workerTools, 'withdraw_task', { piece: label })
      expectRefused(
        refused,
        'that-piece-was-already-answered',
        heldEndedWords(label, 'the piece', 'done', `You answered ${label} at ${said}`),
        label,
      )
      expect(refused.structured.detail).toMatchObject({ label, state: 'answered', at })
    })

    it('🔴 its own root: the whole sentence; a name it neither holds nor gave keeps the guess, whole', async () => {
      const { pm, pmTools, workerTools } = await aPmAndItsWorker('the piece')
      const itsRoot = store.rootOf(pm)?.label
      if (itsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      const ofTheRoot = await callWithWords(pmTools, 'withdraw_task', { piece: itsRoot })
      expectRefused(ofTheRoot, 'that-is-your-own-work', OWN_ROOT, itsRoot)
      expect(ofTheRoot.structured.detail).toEqual({ piece: itsRoot, label: itsRoot })
      // ⚑ …and a name that is none of the caller's: the pm's root, named by its worker, and a
      // made-up one — one answer, so a name is no oracle.
      for (const spelled of [itsRoot, 'W99.99']) {
        const refused = await callWithWords(workerTools, 'withdraw_task', { piece: spelled })
        expectRefused(refused, 'no-piece-by-that-name', UNKNOWN_PIECE, spelled)
        expect(refused.structured.detail, spelled).toEqual({ piece: spelled })
      }
    })
  })

  describe('§2 · F090 · update_work on an ended piece its caller holds', () => {
    it('🔴 taken back while its give still waited: close, new brief and title are told how and when, by nobody, as the model reads it', async () => {
      const { worker, pmTools, workerTools, label } = await aPmAndItsWorker('the first piece')
      const waited = await aGive(pmTools, 'worker', 'the piece that never reached it', worker)
      expect(waited.agent).toBe(worker)
      expect((await callOn(pmTools, 'withdraw_task', { piece: waited.label })).outcome).toBe('ok')
      const row = store.piecesOwnedBy(worker).find((one) => one.label === waited.label)
      expect(row?.state).toBe('withdrawn')
      expect(row?.endedBy).toBeNull()
      const at = endedAt(worker, waited.label)
      const words = heldEndedWords(
        waited.label,
        'the piece that never reached it',
        'withdrawn',
        `${waited.label} was taken back at ${clockTime(at)}`,
      )
      const withOtherTask = `${words} To note something, set the status of a task you hold: ${label} · the first piece.`
      for (const args of [
        { piece: waited.label, close: true },
        { piece: waited.label, brief: 'again' },
        { piece: waited.label, title: 'mine now' },
      ]) {
        const refused = await callWithWords(workerTools, 'update_work', args)
        expectRefused(refused, 'that-piece-has-ended', withOtherTask, JSON.stringify(args))
        expect(refused.structured.detail, JSON.stringify(args)).toMatchObject({
          piece: waited.piece,
          label: waited.label,
          state: 'withdrawn',
          at,
          yoursToRetitle: false,
        })
        expect(refused.structured.detail, JSON.stringify(args)).not.toHaveProperty('called')
      }
    })
  })

  it('§3 · Stop resolves its id, open and ended held piece, and own root', async () => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm', 'auto')
    const { agent: worker, label } = await giveAndWaitForBriefTurn(
      theToolsetJustHandedOut(),
      'worker',
      'the piece',
      (id) => store.events(id).map(({ event }) => event),
    )
    await host.closeAll()
    host = buildHost()
    const pmTools = agentToolsFor(host, pm)
    const workerTools = agentToolsFor(host, worker)
    const itsRoot = store.rootOf(pm)?.label
    if (itsRoot === undefined) throw new Error('a conversation a person opened owns a root')

    for (const [tools, address, target] of [
      [workerTools, worker, worker],
      [workerTools, label, worker],
      [pmTools, pm, pm],
      [pmTools, itsRoot, pm],
    ] as const) {
      expect(
        await callOn(tools, 'interrupt_agent', { agent: address, reason: 'stop' }),
        address,
      ).toMatchObject({ outcome: 'ok', agent: target, asked: false })
    }
    await host.resumeSession(worker, window)
    expect(
      await callOn(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'done',
      }),
    ).toMatchObject({ outcome: 'ok' })
    await host.close(worker, window)
    const ended = await callWithWords(workerTools, 'interrupt_agent', {
      agent: label,
      reason: 'stop',
    })
    expect(ended.structured).toMatchObject({ outcome: 'ok', agent: worker, asked: false })
    expect(ended.text).toContain('had no turn running, so nothing was interrupted')
    expect(
      await callOn(pmTools, 'interrupt_agent', { agent: label, reason: 'stop' }),
    ).toMatchObject({ outcome: 'ok', agent: worker, asked: false })
  })
})
