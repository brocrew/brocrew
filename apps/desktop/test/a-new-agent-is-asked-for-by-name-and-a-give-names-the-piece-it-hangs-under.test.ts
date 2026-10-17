import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolAnswer, AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentIdentityRowId } from '../src/main/db/identity'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  agentName,
  type IdentityCreator,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # D-016 · what `give_work` asks of a NEW agent, and which piece a give hangs under
 *
 * Every existing give in the tree names a profile that already exists in lower case, is made by a
 * giver that holds exactly one piece, is sent to an idle receiver, and names no folder it would
 * have to explain. So five branches of the give's admission and two sentences it produces were
 * never read by a test that would go red if they went:
 *
 * - **R3 · the name.** A new agent is asked for by `new: true` alone. It is made by the give, with
 *   the giver recorded as its creator, under the folded spelling; a giver without the grant to
 *   create agents is refused and nothing is made; and `new` given to a name that already is an agent
 *   is refused, whether or not the giver has a conversation with it - reusing it would hand a "new"
 *   agent the old one's memory.
 * - **R2 step 2 · the piece.** A giver that holds several pieces that have reached it must say which
 *   one the new piece hangs under, by label or by id (D-022 · R4: a piece whose give still waits
 *   behind the giver's turn has not reached it, so it does not count, and the one that has is
 *   enough); one that holds none has nothing to give from, and is told so rather than told to name
 *   a piece it cannot.
 * - **The answer.** A folder named for an agent the giver already talks to is reported unused, and a
 *   brief held behind a turn (`delivery: 'held'`, D-022 · R3) names the piece it gives and the
 *   earlier work of the same giver, without listing its own piece twice.
 *
 * Each test pairs the refusal (or the sentence) with the identical request that goes (or is
 * silent), so a refusal cannot pass by the whole call failing for another reason.
 *
 * Real host, real SQLite ledger, real toolsets; the only double is the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** One `an-agent` creator, folded - see `AgentIdentity.createdBy`. */
const by = (agent: string): IdentityCreator => ({ by: 'an-agent', agent })

describe('D-016 · a new agent is asked for by name, and a give names the piece it hangs under', () => {
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

  /** Every toolset a launch was handed, in order. */
  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly order: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let order: AgentToolset[]
  let counter: number
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016-new-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d016-new-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    order = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, order, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  /** A known agent: opened by a person and closed, so nobody holds a conversation with it. */
  const aKnownAgent = async (profileId: string): Promise<void> => {
    await host.close((await personOpens(profileId)).id, window)
  }

  const wholeCallOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    (await wholeCallOn(toolset, name, args)).structured as Record<string, unknown>

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** What the PROVIDER was handed, turn by turn - the double's echo of it. */
  const heard = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ')
        ? [event.text.slice('echo: '.length)]
        : [],
    )

  /** The turn that carried these words, as the provider was handed it. */
  const theTurnCarrying = async (sessionId: string, words: string): Promise<string> => {
    await waitFor(() => heard(sessionId).some((one) => one.includes(words)), `"${words}"`)
    return heard(sessionId).find((one) => one.includes(words)) ?? ''
  }

  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  /** Let the turn parked on its card finish, so what is held behind it goes. */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    await waitFor(() => cards(sessionId).length > 0, 'a card to answer')
    host.claimSession(sessionId, window)
    await host.respondPermission(
      sessionId,
      cards(sessionId).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
  }

  /**
   * D-022 · R4 - let the worker's turns run out, the held brief's included: its second piece has
   * reached it, and no turn of its is open, so no turn drives either piece. Each turn parks on its
   * own card in `ask`, so the second card is waited for and answered in its turn.
   */
  const bothPiecesReach = async (worker: string): Promise<void> => {
    await letTheTurnFinish(worker)
    await waitFor(() => cards(worker).length > 1, 'the held brief’s card')
    // The first answer claimed the conversation for this window; the second only answers.
    await host.respondPermission(
      worker,
      cards(worker).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
    // ⚑ The turn's ENDING, which is when the host stops counting it open: the `idle` status the
    // machine publishes right after the second turn's own row.
    await waitFor(() => {
      const events = ledger(worker)
      const lastTurn = events.map((event) => event.type).lastIndexOf('turn')
      return (
        events.filter((event) => event.type === 'turn').length > 1 &&
        events
          .slice(lastTurn + 1)
          .some((event) => event.type === 'status' && event.state === 'idle')
      )
    }, 'both turns to end')
  }

  const nameOf = (profile: string): string => agentName(profile, store.agentIdentities())

  /** The tag's own sentence, the first of the line; a person opened the sender, so its clause follows. */
  const theTagIn = (turn: string): string =>
    (turn.split('\n')[0] ?? '').split('. A person')[0] + '.'

  /** Who created this identity, as the store reads it back; `undefined` is no such row. */
  const createdByOf = (slug: string): IdentityCreator | null | undefined =>
    store.agentIdentities().find((one) => one.slug === slug)?.createdBy

  const creatorColumn = (slug: string): unknown =>
    (
      db.prepare('SELECT created_by AS value FROM agent_identity WHERE slug = ?').get(slug) as
        { value: unknown } | undefined
    )?.value ?? null

  /**
   * A PM a person opened, and a worker it gave TWO pieces: the first started the worker (its brief
   * parked on the Fake's card, the PM being in `ask`), the second is held behind that turn - so the
   * worker holds both, and only the first has reached it (D-022 · R4). The worker's toolset is the
   * one its launch was handed, read right after the first give.
   */
  const aWorkerHoldingTwoPieces = async () => {
    await aKnownAgent('worker')
    await aKnownAgent('helper')
    const pm = await personOpens('pm')
    const first = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Piece one',
      brief: 'do piece one',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    expect(first.started).toBe(true)
    const workerTools = order.at(-1) as AgentToolset
    const second = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Piece two',
      brief: 'do piece two',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    expect(second.delivery).toBe('held')
    const worker = first.agent as string
    expect(second.agent).toBe(worker)
    const l1 = first.label as string
    const l2 = second.label as string
    expect(store.piecesOwnedBy(worker).map((one) => one.label)).toEqual([l1, l2])
    return {
      pm,
      worker,
      workerTools,
      p1: first.piece as string,
      p2: second.piece as string,
      l1,
      l2,
    }
  }

  describe('R3 · a new agent is asked for by name', () => {
    it('a give with `new: true` to a name nobody holds makes the agent and records the giver as its creator', async () => {
      const pm = await personOpens('pm')
      // The control: a launch-made identity reads `this-app`, which is exactly what a give that
      // left the creating to the launch would write for the new one.
      expect(createdByOf('pm')).toEqual({ by: 'this-app' })
      expect(createdByOf('archivist')).toBeUndefined()

      // A typo is still refused, and makes nothing.
      const ghost = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'ghost',
        title: 'Haunt',
        brief: 'boo',
      })
      expect(ghost.rail, JSON.stringify(ghost)).toBe('no-such-profile')
      expect(createdByOf('ghost')).toBeUndefined()

      const given = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'Index the ledger',
        brief: 'index it',
        new: true,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.started).toBe(true)
      expect(createdByOf('archivist')).toEqual(by('pm'))
      expect(creatorColumn('archivist')).toBe(agentIdentityRowId('pm'))
      expect(store.identityOf(given.agent as string)?.profileSlug).toBe('archivist')
    })

    it("a new agent's name is folded once - `Archivist` is the identity `archivist`, and its conversation starts under that spelling", async () => {
      await aKnownAgent('worker')
      const pm = await personOpens('pm')

      const given = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'Archivist',
        title: 'Index the ledger',
        brief: 'index it',
        new: true,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const identities = store
        .agentIdentities()
        .filter((one) => one.slug.toLowerCase() === 'archivist')
      expect(identities.map((one) => one.slug)).toEqual(['archivist'])
      expect(store.find(given.agent as string)?.profileId).toBe('archivist')

      // A known agent keeps the spelling it was asked for: the fold is for a NEW name only.
      const known = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'Worker',
        title: 'Build it',
        brief: 'build it',
      })
      expect(known.outcome, JSON.stringify(known)).toBe('ok')
      expect(store.find(known.agent as string)?.profileId).toBe('Worker')
    })

    it('a giver without the grant to create agents is refused a new name and nothing is made - granted, the identical call makes it', async () => {
      const pm = await personOpens('pm')
      expect(store.setCapabilities('pm', { canCreateAgents: 'none' })).toBe(true)
      const sessionsBefore = host.sessionIds.length
      const launchesBefore = order.length
      const ask = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'Index the ledger',
        brief: 'index it',
        new: true,
      }

      const refused = await callOn(pm.tools, 'give_work', ask)
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('may-not-create-agents')
      expect(refused.permanence).toBe('until-a-person-changes-it')
      expect(store.agentIdentities().some((one) => one.slug === 'archivist')).toBe(false)
      expect(host.sessionIds.length).toBe(sessionsBefore)
      expect(order.length).toBe(launchesBefore)

      // One grant over, the same call.
      expect(store.setCapabilities('pm', { canCreateAgents: 'any' })).toBe(true)
      const granted = await callOn(pm.tools, 'give_work', ask)
      expect(granted.outcome, JSON.stringify(granted)).toBe('ok')
      expect(granted.started).toBe(true)
      expect(store.agentIdentities().some((one) => one.slug === 'archivist')).toBe(true)
    })

    it('`new: true` for a name that already is an agent is refused and starts nothing - the identical give without it goes', async () => {
      await aKnownAgent('worker')
      const pm = await personOpens('pm')
      const pmRoot = store.rootOf(pm.id)
      if (pmRoot === null) throw new Error('a conversation a person opened has a root')
      const sessionsBefore = host.sessionIds.length
      const launchesBefore = order.length
      const ask = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Build it',
        brief: 'build it',
      }

      const refused = await callOn(pm.tools, 'give_work', { ...ask, new: true })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('that-profile-exists')
      expect(refused.permanence).toBe('permanent')
      expect(host.sessionIds.length).toBe(sessionsBefore)
      expect(order.length).toBe(launchesBefore)
      expect(store.childrenOf(pmRoot.piece)).toEqual([])

      // The same request with `new` left out uses the agent that exists.
      const went = await callOn(pm.tools, 'give_work', ask)
      expect(went.outcome, JSON.stringify(went)).toBe('ok')
      expect(went.started).toBe(true)
      expect(host.sessionIds.length).toBe(sessionsBefore + 1)
      expect(order.length).toBe(launchesBefore + 1)
      expect(store.childrenOf(pmRoot.piece)).toHaveLength(1)
    })

    it('`new: true` is refused the same when the giver already has a conversation with that agent, and nothing reaches it', async () => {
      await aKnownAgent('worker')
      const pm = await personOpens('pm')
      const first = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'First piece',
        brief: 'do the first',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      expect(first.started).toBe(true)
      const worker = first.agent as string
      const sessionsBefore = host.sessionIds.length
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
      const ask = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Second piece',
        brief: 'do the second',
      }

      const refused = await callOn(pm.tools, 'give_work', { ...ask, new: true })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('that-profile-exists')
      expect(host.sessionIds.length).toBe(sessionsBefore)
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
      expect(JSON.stringify(ledger(worker))).not.toContain('do the second')

      // The same give with `new` left out goes to the conversation it has.
      const went = await callOn(pm.tools, 'give_work', ask)
      expect(went.outcome, JSON.stringify(went)).toBe('ok')
      expect(went.agent).toBe(worker)
      expect(went.started).toBe(false)
      expect(store.piecesOwnedBy(worker)).toHaveLength(2)
      expect(JSON.stringify(ledger(worker))).toContain('do the second')
    })
  })

  describe('R2 · the piece a give hangs under', () => {
    it('a giver holding two pieces that have reached it and names none is told which it holds - naming one hangs the new piece under it', async () => {
      const { worker, workerTools, p2, l1, l2 } = await aWorkerHoldingTwoPieces()
      await bothPiecesReach(worker)
      const sessionsBefore = host.sessionIds.length
      const launchesBefore = order.length
      const ask = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub',
        brief: 'sub',
      }

      const refused = await callOn(workerTools, 'give_work', ask)
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('name-the-piece-you-give-from')
      expect(String(refused.reason)).toContain(l1)
      expect(String(refused.reason)).toContain(l2)
      expect(host.sessionIds.length).toBe(sessionsBefore)
      expect(order.length).toBe(launchesBefore)

      const given = await callOn(workerTools, 'give_work', { ...ask, piece: l2 })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.label).toBe(`${l2}.1`)
      expect(store.workById(given.piece as string)?.parent).toBe(p2)
    })

    it('a piece whose give still waits has not reached the giver - naming none is enough while only the first has, and the refusal above needs both', async () => {
      const { worker, workerTools, p1, l1 } = await aWorkerHoldingTwoPieces()
      // D-022 · R4: the second piece is held behind the worker's turn, so the worker holds two and
      // only one has reached it. The refusal's control - the same request, the other state of the
      // second piece - is the give that names nothing and goes.
      expect(store.openPiecesOf(worker)).toHaveLength(2)
      const sessionsBefore = host.sessionIds.length

      const given = await callOn(workerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub',
        brief: 'sub',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.label).toBe(`${l1}.1`)
      expect(store.workById(given.piece as string)?.parent).toBe(p1)
      expect(host.sessionIds.length).toBe(sessionsBefore + 1)
    })

    it('a giver holding no piece is told it has nothing to give from - the giver that holds one is not', async () => {
      await aKnownAgent('worker')
      await aKnownAgent('helper')
      const pm = await personOpens('pm')
      const first = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Only piece',
        brief: 'do it',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      const workerTools = order.at(-1) as AgentToolset
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: first.label,
        outcome: 'done',
        summary: 'done',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(store.openPiecesOf(first.agent as string)).toEqual([])
      const sessionsBefore = host.sessionIds.length
      const ask = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub',
        brief: 'sub',
      }

      const refused = await callOn(workerTools, 'give_work', ask)
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('no-piece-to-give-from')
      expect(refused.rail).not.toBe('name-the-piece-you-give-from')
      expect(host.sessionIds.length).toBe(sessionsBefore)

      // The giver that holds its root only needs to name nothing. The worker's piece was the
      // root's first child, so this one is its second.
      const pmRoot = store.rootOf(pm.id)
      if (pmRoot === null) throw new Error('a conversation a person opened has a root')
      const given = await callOn(pm.tools, 'give_work', ask)
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.label).toBe(`${pmRoot.label}.2`)
      expect(store.workById(given.piece as string)?.parent).toBe(pmRoot.piece)
    })

    it('the piece a give hangs under may be named by its id as well as by its label', async () => {
      const { pm, workerTools, p2, l2 } = await aWorkerHoldingTwoPieces()
      const pmRoot = store.rootOf(pm.id)
      if (pmRoot === null) throw new Error('a conversation a person opened has a root')

      const byId = await callOn(workerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub by id',
        brief: 'sub by id',
        piece: p2,
      })
      expect(byId.outcome, JSON.stringify(byId)).toBe('ok')
      expect(store.workById(byId.piece as string)?.parent).toBe(p2)
      expect(String(byId.label).startsWith(`${l2}.`)).toBe(true)

      // The label reaches the same piece.
      const byLabel = await callOn(workerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub by label',
        brief: 'sub by label',
        piece: l2,
      })
      expect(byLabel.outcome, JSON.stringify(byLabel)).toBe('ok')
      expect(store.workById(byLabel.piece as string)?.parent).toBe(p2)

      // A piece the worker does not hold is refused by its id, as by its label.
      const notHeld = await callOn(workerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Sub of the root',
        brief: 'sub of the root',
        piece: pmRoot.piece,
      })
      expect(notHeld.outcome, JSON.stringify(notHeld)).toBe('refused')
      expect(notHeld.rail).toBe('no-piece-you-hold-by-that-name')
    })
  })

  describe('the answer a give returns', () => {
    it('W4.189 · a folder named for an agent the giver already has a conversation with is granted for that piece — a blank one, and a started one, are not', async () => {
      await aKnownAgent('worker')
      const pm = await personOpens('pm')
      const granted = `${root} while`
      const give = (title: string, folder?: string) =>
        wholeCallOn(pm.tools, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title,
          brief: `do ${title}`,
          ...(folder === undefined ? {} : { folder }),
        })

      // The give that STARTS the conversation uses the folder it was given.
      const started = await give('Started', root)
      expect(started.structured?.outcome, started.text).toBe('ok')
      expect(started.structured?.started).toBe(true)
      expect(started.text).not.toContain(granted)
      expect(started.structured?.folder).toEqual({ folder: root, use: 'working-folder' })

      // ⚑ Found: the folder is granted to the conversation it has, for that piece (W4.189).
      const found = await give('Found', root)
      expect(found.structured?.outcome, found.text).toBe('ok')
      expect(found.structured?.started).toBe(false)
      expect(found.text).toContain(granted)
      expect(found.structured?.folder).toEqual({ folder: root, use: 'grant' })

      // A blank folder is an absent one, and so is none.
      const blank = await give('Blank', '   ')
      expect(blank.structured?.outcome, blank.text).toBe('ok')
      expect(blank.text).not.toContain(granted)
      expect(blank.structured?.folder).toBeUndefined()
      const none = await give('None')
      expect(none.structured?.outcome, none.text).toBe('ok')
      expect(none.text).not.toContain(granted)
    })

    it('a brief held behind a turn names the piece it gives and the earlier work of the same giver, and never lists its own piece twice', async () => {
      await aKnownAgent('worker')
      const pm = await personOpens('pm')
      const first = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'First job',
        brief: 'do the first',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      const worker = first.agent as string
      const firstTurn = await theTurnCarrying(worker, 'do the first')
      // The brief that STARTED the conversation names only what it gives.
      expect(theTagIn(firstTurn)).toBe(
        `Sent by ${nameOf('pm')} (pm), who is giving you ${first.label as string} · First job.`,
      )

      const second = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Second job',
        brief: 'do the second',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.delivery).toBe('held')
      expect(second.agent).toBe(worker)
      await letTheTurnFinish(worker)
      const secondTurn = await theTurnCarrying(worker, 'do the second')
      // The held brief's piece already has its row at the flush, and must be left out of the list of
      // what was given before it: `W1.1 and W1.2` after "gave you" is the defect.
      expect(theTagIn(secondTurn)).toBe(
        `Sent by ${nameOf('pm')} (pm), who is giving you ${second.label as string} · Second job and gave you ${first.label as string}.`,
      )
    })
  })
})
