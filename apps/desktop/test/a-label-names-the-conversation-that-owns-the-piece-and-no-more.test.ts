import { expectIdsOnlyInLinkTargets } from './helpers/navigation-reply'
/**
 * ⚑ **A piece's label names the conversation that owns it — and no more** (W1.2).
 *
 * A label (`W1.1`) is a second spelling of a conversation, beside its id, and it is worth exactly
 * what the id is worth. This file pins the four places that could make it worth more or less.
 *
 *  1. **Reach.** `get_agent_status`, `interrupt_agent` and `read_transcript` take the label as they
 *     take the id. ⛔ A label whose owner is out of the caller's reach is told exactly like a label
 *     no piece carries — it must not disclose that the conversation exists (its id, or its name) —
 *     while the SAME conversation's id meets the reach rail. ⚠️ `interrupt_agent` and
 *     `read_transcript` widen along the spawn chain, so they widen only to a GRANDPARENT: a direct
 *     parent is in reach whatever it may message, and the narrowed caller in those two cases is the
 *     grandparent.
 *  2. **The person's door.** A person renames a ROOT piece (`retitleForAPerson`); a piece another
 *     conversation gave is named by that conversation, never by a person. A blank title is refused
 *     first, before the piece is looked up.
 *  3. **The naming sentence.** A conversation is named by its newest OPEN piece and how many more
 *     it holds open, else (F033) the piece that ended last, marked with how it ended — and a write
 *     to its ledger re-names it. A sentence names another conversation by its work and hands back
 *     the label — never the id, which only the structured payload carries.
 *  4. **The announcement.** A person's rename announces `work` once, after the row is down, and a
 *     refused rename announces nothing.
 *
 * ⛔ **The expected words are literals.** `nameByItsWork` and `addressOf` are the SUBJECT of the
 * cases that name them and never the oracle: every name, label and sentence below is spelled out
 * here. ⚑ Every negative is paired with a positive from the SAME reader, so a refusal is never a
 * reader that could not see anything at all.
 *
 * ⚑ **The fixture gives its children with `new: true`**, because a person-opened conversation owns
 * a root and takes the next label: opening a helper first, to bring its identity into being, would
 * make the parent `W2` and the literals below `W2.1`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  ApprovalMode,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { RETITLE_SAID } from '../src/shared/piece-called'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { RuntimeChangeMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A reopen the test can hold at the provider: `hold` is awaited by every `resume`. */
interface ResumeGate {
  hold: Promise<void> | null
  entered: number
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly resumeGate: ResumeGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.resumeGate.entered += 1
    if (this.resumeGate.hold !== null) await this.resumeGate.hold
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** The conversation a person is behind: the sink a window hands the host. */
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

/** What a tool answered: the payload a model parses and the sentence it reads. */
interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

/** The sentence every case below expects Ada, BroBot's child, to be called by. */
const ADA_BY_ITS_WORK = 'Ada (the owner of W1.1 · Build the pages)'

describe('a label names the conversation that owns the piece, and no more', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let resumeGate: ResumeGate
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every change the host announced, in order. */
  let announced: string[]
  /** ⚑ Told at the moment of each announcement, so a case can look at the world THEN. */
  let atAnnouncement: ((what: string) => void) | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, resumeGate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      announce: (change: RuntimeChangeMessage) => {
        announced.push(change.what)
        atAnnouncement?.(change.what)
      },
      readProviderConfig: (provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-label-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-label-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    announced = []
    atAnnouncement = null
    resumeGate = { hold: null, entered: 0 }
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: ApprovalMode = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const fullCall = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await fullCall(toolset, name, args)).structured

  /** A refusal, less the one field that echoes the spelling the caller used. */
  const withoutTheEchoedSpelling = (refusal: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(refusal).filter(([key]) => key !== 'detail'))

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const retitlesIn = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'work_retitled')
  const worksAnnounced = (): number => announced.filter((what) => what === 'work').length

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }
  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  /**
   * ⚑ **One family and one stranger**, literal in every label and name:
   *
   * - `brobot` — a person's conversation, owning the root `W1`; the caller in most cases.
   * - `ada` — BroBot's child, `W1.1 · Build the pages`, named Ada.
   * - `ali` — Ada's child and BroBot's GRANDCHILD, `W1.1.1 · Wire the routes`, named Ali.
   * - `stranger` — a person's other conversation, the root `W2`, named Amara, opened AFTER the
   *   gives so it does not take `W1.x`'s numbers. Nothing started it and nothing it started is
   *   BroBot's.
   */
  interface Family {
    readonly brobot: string
    readonly brobotTools: AgentToolset
    readonly ada: string
    readonly adaPiece: string
    readonly ali: string
    readonly aliHandle: FakeSessionHandle
    readonly stranger: string
    readonly strangerHandle: FakeSessionHandle
  }
  const aFamily = async (): Promise<Family> => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = agentToolsFor(host, brobot)
    const givenAda = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(givenAda, JSON.stringify(givenAda)).toMatchObject({
      outcome: 'ok',
      label: 'W1.1',
      started: true,
    })
    const ada = givenAda.agent as string
    await waitFor(() => ledger(ada).some((event) => event.type === 'turn'), 'Ada’s first turn')
    const givenAli = await callOn(agentToolsFor(host, ada), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      new: true,
      title: 'Wire the routes',
      brief: 'wire the routes',
    })
    expect(givenAli, JSON.stringify(givenAli)).toMatchObject({
      outcome: 'ok',
      label: 'W1.1.1',
      started: true,
    })
    const ali = givenAli.agent as string
    await waitFor(() => ledger(ali).some((event) => event.type === 'turn'), 'Ali’s first turn')
    expect(handles).toHaveLength(3)
    const aliHandle = latestHandle()
    const stranger = await personOpens('reviewer')
    const strangerHandle = latestHandle()
    // ⚠️ The premises, read off the store and not off the subject: who started whom, and who owns
    // which root.
    expect(store.parentOf(ada)).toBe(brobot)
    expect(store.parentOf(ali)).toBe(ada)
    expect(store.parentOf(stranger)).toBeNull()
    expect(store.rootOf(brobot)?.label).toBe('W1')
    expect(store.rootOf(stranger)?.label).toBe('W2')
    return {
      brobot,
      brobotTools,
      ada,
      adaPiece: givenAda.piece as string,
      ali,
      aliHandle,
      stranger,
      strangerHandle,
    }
  }

  /** ⚑ The person narrows BroBot's message grant to `none`, and the store says it took. */
  const narrowBroBot = (): void => {
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('none')
  }

  it('🔴 a piece’s label names the conversation that owns it: the status, interrupt and read doors take it exactly as they take the id', async () => {
    const { brobotTools, ada, ali } = await aFamily()
    const owners: [string, string, string][] = [
      ['W1.1', ada, 'Build the pages'],
      ['W1.1.1', ali, 'Wire the routes'],
    ]

    for (const [label, id, title] of owners) {
      // get_agent_status — the same conversation, said by the same label and title.
      const byLabel = await callOn(brobotTools, 'get_agent_status', { agent: label })
      const byId = await callOn(brobotTools, 'get_agent_status', { agent: id })
      expect(byLabel.outcome, JSON.stringify(byLabel)).toBe('ok')
      expect(byId.outcome, JSON.stringify(byId)).toBe('ok')
      expect((byLabel.agent as { agent: string }).agent).toBe(id)
      expect((byId.agent as { agent: string }).agent).toBe(id)
      expect((byLabel.agent as { named: unknown }).named).toEqual({ label, title })

      // interrupt_agent — the same conversation, the same answer (it has no turn running).
      const stoppedByLabel = await callOn(brobotTools, 'interrupt_agent', {
        agent: label,
        reason: 'no longer needed',
      })
      const stoppedById = await callOn(brobotTools, 'interrupt_agent', {
        agent: id,
        reason: 'no longer needed',
      })
      expect(stoppedByLabel, JSON.stringify(stoppedByLabel)).toMatchObject({
        outcome: 'ok',
        agent: id,
      })
      expect(stoppedByLabel).toEqual(stoppedById)

      // read_transcript — the same conversation's lines.
      const readByLabel = await fullCall(brobotTools, 'read_transcript', { agent: label })
      const readById = await fullCall(brobotTools, 'read_transcript', { agent: id })
      expect(readByLabel.structured, readByLabel.text).toMatchObject({ outcome: 'ok', agent: id })
      expect(readById.structured, readById.text).toMatchObject({ outcome: 'ok', agent: id })
      expect(readByLabel.text).toBe(readById.text)
    }
    // ⚑ What the read carried is the child's own words, so "ok" is not an empty read.
    const aliLines = await fullCall(brobotTools, 'read_transcript', { agent: 'W1.1.1' })
    expect(aliLines.text).toContain('wire the routes')

    // ⛔ And a label no piece carries is what an id no conversation carries is: the same refusal at
    // each door, apart from the spelling the caller used.
    const doors: [ToolName, Record<string, unknown>, string][] = [
      ['get_agent_status', {}, 'no-such-agent'],
      ['interrupt_agent', { reason: 'no longer needed' }, 'no-such-agent'],
      ['read_transcript', {}, 'not-a-conversation-below-you'],
    ]
    for (const [name, rest, rail] of doors) {
      const noLabel = await callOn(brobotTools, name, { agent: 'W9.9', ...rest })
      const noId = await callOn(brobotTools, name, { agent: 'sess_nothing', ...rest })
      expect(noLabel, JSON.stringify(noLabel)).toMatchObject({ outcome: 'refused', rail })
      expect(withoutTheEchoedSpelling(noLabel)).toEqual(withoutTheEchoedSpelling(noId))
      expect(noLabel.detail).toEqual({ agent: 'W9.9' })
      expect(noId.detail).toEqual({ agent: 'sess_nothing' })
    }
  })

  it('⛔ to a caller that may not message, the label of a conversation out of its reach is unknown, told exactly like a label no piece carries, while the same conversation’s id meets the reach rail', async () => {
    const { brobotTools, ada, stranger } = await aFamily()

    // ⚑ The paired positive, BEFORE the narrowing: the default caller reaches the stranger by its
    // label. So the refusal below is the narrowing, and not a label the door cannot resolve.
    const reachedByLabel = await callOn(brobotTools, 'get_agent_status', { agent: 'W2' })
    expect(reachedByLabel, JSON.stringify(reachedByLabel)).toMatchObject({ outcome: 'ok' })
    expect((reachedByLabel.agent as { agent: string }).agent).toBe(stranger)
    expect((reachedByLabel.agent as { whose: { name: string } }).whose.name).toBe('Amara')

    narrowBroBot()
    const rowsBefore = ledger(stranger).length

    // The stranger's id meets the reach rail — the premise that it IS out of reach.
    const byId = await callOn(brobotTools, 'get_agent_status', { agent: stranger })
    expect(byId, JSON.stringify(byId)).toMatchObject({
      outcome: 'refused',
      rail: 'may-not-message',
      detail: { reach: 'none', agent: stranger },
    })

    // ⛔ Its label is a label no piece carries.
    const byLabel = await fullCall(brobotTools, 'get_agent_status', { agent: 'W2' })
    const unknownLabel = await fullCall(brobotTools, 'get_agent_status', { agent: 'W9.9' })
    expect(byLabel.structured, byLabel.text).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
    })
    expect(withoutTheEchoedSpelling(byLabel.structured)).toEqual(
      withoutTheEchoedSpelling(unknownLabel.structured),
    )
    expect(byLabel.structured.detail).toEqual({ agent: 'W2' })
    expect(byLabel.text).toBe(unknownLabel.text)
    // ...and neither the payload nor the sentence lets slip that the conversation exists.
    for (const said of [JSON.stringify(byLabel.structured), byLabel.text]) {
      expect(said).not.toContain(stranger)
      expect(said).not.toContain('Amara')
    }
    expect(ledger(stranger)).toHaveLength(rowsBefore)

    // ⚑ The same reader, one fact over: its own child is still reached by label and by id.
    const child = await callOn(brobotTools, 'get_agent_status', { agent: 'W1.1' })
    expect(child, JSON.stringify(child)).toMatchObject({ outcome: 'ok' })
    expect((child.agent as { agent: string }).agent).toBe(ada)
  })

  it('🔴 a caller that may not message still interrupts, by label, the conversation it may interrupt, and not a stranger’s', async () => {
    const { brobot, brobotTools, ali, aliHandle, stranger, strangerHandle } = await aFamily()
    narrowBroBot()

    // ⚠️ The premise: Ali is a GRANDCHILD, so it is out of a `none` caller's messaging reach.
    const premise = await callOn(brobotTools, 'get_agent_status', { agent: ali })
    expect(premise.rail, JSON.stringify(premise)).toBe('may-not-message')

    await makeItWork(aliHandle)
    await makeItWork(strangerHandle)
    // ⚠️ The stranger's own thinking is a row of its own: wait for it, so the count below is the
    // one nothing else is still writing to.
    await waitFor(
      () => ledger(stranger).some((event) => event.type === 'thinking'),
      'the stranger’s thinking to be recorded',
    )
    const strangerRows = ledger(stranger).length

    // The chain admits the grandparent: Ali, by its label, is asked to stop.
    const stopped = await callOn(brobotTools, 'interrupt_agent', {
      agent: 'W1.1.1',
      reason: 'the routes are no longer wanted',
    })
    expect(stopped, JSON.stringify(stopped)).toMatchObject({
      outcome: 'ok',
      agent: ali,
      asked: true,
    })
    const interrupts = ledger(ali).filter((event) => event.type === 'work_interrupted')
    expect(interrupts, JSON.stringify(interrupts)).toHaveLength(1)
    expect(interrupts[0], JSON.stringify(interrupts)).toMatchObject({
      by: 'an-agent',
      agent: brobot,
    })

    // ⛔ The stranger's label is unknown, and its id meets the chain rail — nothing reached it.
    const strangerByLabel = await callOn(brobotTools, 'interrupt_agent', {
      agent: 'W2',
      reason: 'the routes are no longer wanted',
    })
    const unknownLabel = await callOn(brobotTools, 'interrupt_agent', {
      agent: 'W9.9',
      reason: 'the routes are no longer wanted',
    })
    expect(strangerByLabel, JSON.stringify(strangerByLabel)).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
    })
    expect(withoutTheEchoedSpelling(strangerByLabel)).toEqual(
      withoutTheEchoedSpelling(unknownLabel),
    )
    expect(JSON.stringify(strangerByLabel)).not.toContain(stranger)
    const strangerById = await callOn(brobotTools, 'interrupt_agent', {
      agent: stranger,
      reason: 'the routes are no longer wanted',
    })
    expect(strangerById, JSON.stringify(strangerById)).toMatchObject({
      outcome: 'refused',
      rail: 'not-below-you',
    })
    expect(strangerHandle.status()).toBe('working')
    expect(ledger(stranger)).toHaveLength(strangerRows)
    expect(ledger(stranger).some((event) => event.type === 'work_interrupted')).toBe(false)
  })

  it('🔴 a caller that may not message reads, by label, the transcript of a conversation it may read, and not a stranger’s', async () => {
    const { brobotTools, ali, stranger } = await aFamily()
    narrowBroBot()

    // ⚠️ The premise: Ali is out of a `none` caller's messaging reach.
    const premise = await callOn(brobotTools, 'get_agent_status', { agent: ali })
    expect(premise.rail, JSON.stringify(premise)).toBe('may-not-message')

    // The chain admits the grandparent: Ali's lines, by its label.
    const read = await fullCall(brobotTools, 'read_transcript', { agent: 'W1.1.1' })
    expect(read.structured, read.text).toMatchObject({ outcome: 'ok', agent: ali, name: 'Ali' })
    expect(read.text).toContain('wire the routes')

    // ⛔ A stranger's label reads as the label no piece carries, and its id as the same rail.
    const byLabel = await fullCall(brobotTools, 'read_transcript', { agent: 'W2' })
    const unknownLabel = await fullCall(brobotTools, 'read_transcript', { agent: 'W9.9' })
    const byId = await fullCall(brobotTools, 'read_transcript', { agent: stranger })
    for (const refused of [byLabel, unknownLabel, byId]) {
      expect(refused.structured, refused.text).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-conversation-below-you',
      })
    }
    expect(withoutTheEchoedSpelling(byLabel.structured)).toEqual(
      withoutTheEchoedSpelling(unknownLabel.structured),
    )
    expect(byLabel.text).toBe(unknownLabel.text)
    for (const said of [JSON.stringify(byLabel.structured), byLabel.text]) {
      expect(said).not.toContain(stranger)
      expect(said).not.toContain('Amara')
    }
  })

  it('🔴 a person’s rename of a root piece writes one row by nobody, and the conversation is named by the new title from then on', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const rootPiece = store.rootOf(brobot)
    expect(rootPiece?.label).toBe('W1')

    // Before: the root is named by its label alone.
    expect(store.workThatNames(brobot)).toEqual({
      label: 'W1',
      title: null,
      definitionOfDone: null,
    })
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1)')
    expect(retitlesIn(brobot)).toHaveLength(0)

    // The title is trimmed, and the answer names the piece as it now stands.
    const renamed = host.retitleForAPerson('W1', '  Build the pages ')
    expect(renamed).toEqual({
      ok: true,
      piece: rootPiece?.piece,
      label: 'W1',
      title: 'Build the pages',
    })
    expect(retitlesIn(brobot)).toEqual([
      { type: 'work_retitled', piece: rootPiece?.piece, title: 'Build the pages', by: null },
    ])
    expect(store.workThatNames(brobot)).toEqual({
      label: 'W1',
      title: 'Build the pages',
      definitionOfDone: null,
    })
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1 · Build the pages)')

    // A second rename wins, and the first stays in the ledger as the history it is.
    const again = host.retitleForAPerson('W1', 'Ship the pages')
    expect(again).toMatchObject({ ok: true, label: 'W1', title: 'Ship the pages' })
    expect(retitlesIn(brobot)).toHaveLength(2)
    expect(store.workThatNames(brobot)).toEqual({
      label: 'W1',
      title: 'Ship the pages',
      definitionOfDone: null,
    })
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1 · Ship the pages)')

    // ⚑ The same conversation, read by another reader: the agents' list carries the new title.
    const listed = await callOn(agentToolsFor(host, brobot), 'list_agents', {})
    const mine = (listed.agents as { agent: string; named: unknown }[]).find(
      (one) => one.agent === brobot,
    )
    expect(mine?.named).toEqual({ label: 'W1', title: 'Ship the pages', definitionOfDone: null })
  })

  it('⛔ a blank title is refused first, as a title of one line, before the piece is looked up; a name no piece carries is refused after it', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    expect(store.rootOf(brobot)?.label).toBe('W1')
    const rowsBefore = ledger(brobot).length

    // A blank title, whichever piece it is asked of — even one that does not exist.
    for (const [spelled, title] of [
      ['W1', ''],
      ['W1', '   '],
      ['W99', '   '],
    ] as const) {
      const refused = host.retitleForAPerson(spelled, title)
      expect(refused, `${spelled} / ${JSON.stringify(title)}`).toEqual({
        ok: false,
        rail: 'a-title-is-one-line',
        reason: RETITLE_SAID['a-title-is-one-line'],
      })
    }
    expect(RETITLE_SAID['a-title-is-one-line']).toBe(
      'Nothing was renamed: a title is one line of 1 to 200 characters.',
    )

    // A good title, asked of a name no piece carries: the labels are exact.
    for (const spelled of ['W99', 'W01', 'w1', ' W1 ', 'work_nope']) {
      const refused = host.retitleForAPerson(spelled, 'Build the world')
      expect(refused, spelled).toEqual({
        ok: false,
        rail: 'no-piece-by-that-name',
        reason: RETITLE_SAID['no-piece-by-that-name'],
      })
    }
    expect(RETITLE_SAID['no-piece-by-that-name']).toBe(
      'Nothing was renamed: this app holds no piece by that name.',
    )

    // ⛔ Nothing was written, and the conversation is named as it was.
    expect(retitlesIn(brobot)).toHaveLength(0)
    expect(ledger(brobot)).toHaveLength(rowsBefore)
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1)')

    // ⚑ The paired positive, from the same door: a good title for the piece that exists.
    const renamed = host.retitleForAPerson('W1', ' Build the world ')
    expect(renamed).toMatchObject({ ok: true, label: 'W1', title: 'Build the world' })
    expect(retitlesIn(brobot)).toHaveLength(1)
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1 · Build the world)')
  })

  it('⛔ a piece a conversation gave is named by that conversation: a person’s rename of it, by label or by id, changes nothing and announces nothing', async () => {
    const { brobot, ada, adaPiece } = await aFamily()
    expect(store.workThatNames(ada)).toEqual({ label: 'W1.1', title: 'Build the pages' })
    const adaRows = ledger(ada).length
    const announcedBefore = worksAnnounced()

    for (const spelled of ['W1.1', adaPiece]) {
      const refused = host.retitleForAPerson(spelled, 'A title from a person')
      expect(refused, spelled).toEqual({
        ok: false,
        rail: 'a-conversation-names-that-piece',
        reason: RETITLE_SAID['a-conversation-names-that-piece'],
      })
    }
    expect(RETITLE_SAID['a-conversation-names-that-piece']).toBe(
      'Nothing was renamed: a conversation gave that piece, and that conversation names it.',
    )
    expect(retitlesIn(ada)).toHaveLength(0)
    expect(ledger(ada)).toHaveLength(adaRows)
    expect(store.workThatNames(ada)).toEqual({ label: 'W1.1', title: 'Build the pages' })
    expect(host.nameByItsWork(ada)).toBe(ADA_BY_ITS_WORK)
    expect(worksAnnounced()).toBe(announcedBefore)

    // ⚑ The paired positive, in the same test: the root piece, which nobody gave, is renamed by the
    // same person through the same door, and that one announces.
    const renamed = host.retitleForAPerson('W1', 'Build the site')
    expect(renamed).toMatchObject({ ok: true, label: 'W1', title: 'Build the site' })
    expect(retitlesIn(brobot)).toHaveLength(1)
    expect(worksAnnounced()).toBe(announcedBefore + 1)
    // ...and the child, still, is named as it was.
    expect(host.nameByItsWork(ada)).toBe(ADA_BY_ITS_WORK)
  })

  describe('a conversation holding several pieces', () => {
    /**
     * ⚑ **A parent in `ask` mode, and a child parked on its card** — so the child's first piece is
     * open and not stalled, and a second give is admitted (held), as
     * `a-conversation-holding-open-work-takes-no-more-from-anyone` measures.
     */
    const aChildHoldingTwoPieces = async (): Promise<{ parent: string; child: string }> => {
      const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const parentTools = agentToolsFor(host, parent)
      const first = await callOn(parentTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        new: true,
        title: 'Build the world clock page',
        brief: 'build the world clock page',
      })
      expect(first, JSON.stringify(first)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const child = first.agent as string
      await waitFor(
        () => ledger(child).some((event) => event.type === 'permission_request'),
        'the card the brief’s turn raised',
      )
      const second = await callOn(parentTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Test the clock page',
        brief: 'test the clock page',
      })
      expect(second, JSON.stringify(second)).toMatchObject({
        outcome: 'ok',
        agent: child,
        label: 'W1.2',
      })
      return { parent, child }
    }

    it('🔴 is named by its newest OPEN piece and how many more, else the piece that ended last and how, and a write to its ledger re-names it', async () => {
      const { parent, child } = await aChildHoldingTwoPieces()
      const parentTools = agentToolsFor(host, parent)
      expect(store.openPiecesOf(child).map((one) => one.label)).toEqual(['W1.1', 'W1.2'])

      // (a) Both open: the newest of them names it, and says it holds one more (F033).
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.2',
        title: 'Test the clock page',
        more: 1,
      })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.2 · Test the clock page (and 1 more))',
      )

      // (b) A giver’s new title for the piece is a write to the child’s ledger — the name, already
      // asked for once, follows at once.
      const retitled = await callOn(parentTools, 'update_work', {
        piece: 'W1.2',
        title: 'Test the world clock page',
      })
      expect(retitled, JSON.stringify(retitled)).toMatchObject({ outcome: 'ok' })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.2 · Test the world clock page (and 1 more))',
      )

      // (c) The newer piece closed: the older one, still open, names it — alone now.
      const closedNewer = await callOn(parentTools, 'update_work', { piece: 'W1.2', close: true })
      expect(closedNewer, JSON.stringify(closedNewer)).toMatchObject({ outcome: 'ok' })
      expect(store.openPiecesOf(child).map((one) => one.label)).toEqual(['W1.1'])
      expect(host.nameByItsWork(child)).toBe('Ada (the owner of W1.1 · Build the world clock page)')

      // (d) Nothing open: ⚑ F033 · the piece that ENDED LAST names it — W1.1, closed after W1.2,
      // though W1.2 is the newest it held — and says how it ended, so nobody reads her as still on it.
      const closedOlder = await callOn(parentTools, 'update_work', { piece: 'W1.1', close: true })
      expect(closedOlder, JSON.stringify(closedOlder)).toMatchObject({ outcome: 'ok' })
      expect(store.openPiecesOf(child)).toHaveLength(0)
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.1',
        title: 'Build the world clock page',
        ended: 'closed',
      })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.1 · Build the world clock page (closed))',
      )
    })
  })

  it('⚑ W4.209 · a card names who started it by the piece it started it from, never by the starter’s work now', async () => {
    const { brobotTools, ada } = await aFamily()
    // ⚑ W4.209 · never by the starter's work NOW: Ada started Ali from W1.1, and is then given W1.2,
    // which is what names Ada now — Ali's card still says the piece Ada started it from.
    const startedAli = 'started by Ada (the owner of W1.1 · Build the pages)'
    expect((await fullCall(brobotTools, 'get_agent_status', { agent: 'W1.1.1' })).text).toContain(
      startedAli,
    )
    const givenMore = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Write the tests',
      brief: 'write the tests',
    })
    expect(givenMore, JSON.stringify(givenMore)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
    expect(store.workThatNames(ada)?.label).toBe('W1.2')
    const aliNow = await fullCall(brobotTools, 'get_agent_status', { agent: 'W1.1.1' })
    expect(aliNow.text).toContain(startedAli)
    expect(aliNow.text).not.toContain('started by the owner of W1.2')
  })

  it('⚑ a sentence names another conversation by its work and hands back the label, and ids occur only in link targets or the structured payload', async () => {
    const { brobotTools, brobot, ada, stranger } = await aFamily()
    const adaHandle = handles[1]
    if (adaHandle === undefined) throw new Error('Ada has no provider handle')
    await waitFor(
      () =>
        adaHandle.status() === 'idle' &&
        ledger(ada).filter((event) => event.type === 'turn').length >= 2,
      'Ada to be idle after Ali’s notice',
    )

    // The status line names the child by its work and says who started it — ⚑ W4.209 · by the piece
    // the parent started it from, with the parent's name, as its record and its launch line say it.
    const status = await fullCall(brobotTools, 'get_agent_status', { agent: 'W1.1' })
    expect(status.text).toContain('the owner of W1.1 · Build the pages · Ada (worker)')
    expect(status.text).toContain('started by BroBot (the owner of W1')
    expect(status.text).toContain('holds W1.1 · Build the pages')

    // The interrupt sentence names the child by its work.
    const interrupt = await fullCall(brobotTools, 'interrupt_agent', {
      agent: 'W1.1',
      reason: 'nothing to stop',
    })
    expect(interrupt.text).toContain(ADA_BY_ITS_WORK)

    // The receipt of a message names the child by its work.
    const message = await fullCall(brobotTools, 'message_agent', {
      agent: 'W1.1',
      kind: 'follow-up',
      piece: 'W1.1',
      text: 'hello',
    })
    expect(message.text).toContain(ADA_BY_ITS_WORK)
    await waitFor(
      () => ledger(ada).filter((event) => event.type === 'turn').length >= 3,
      'Ada to answer the follow-up',
    )

    // The read names the SENDER by its work: BroBot, the owner of W1.
    const read = await fullCall(brobotTools, 'read_transcript', { agent: 'W1.1' })
    expect(read.text).toContain('came from BroBot (the owner of W1)')

    // IDs are destinations only; prose and visible link labels still name the conversation.
    for (const said of [status.text, interrupt.text, message.text, read.text]) {
      expectIdsOnlyInLinkTargets(said, [ada, brobot])
      // A visible handle still fails, even when the answer also has a valid destination for it.
      expect(() => expectIdsOnlyInLinkTargets(`${said}\n${ada}`, [ada, brobot])).toThrow()
    }
    // ⚑ ...and the payloads, the same readers' other half, do.
    expect((status.structured.agent as { agent: string }).agent).toBe(ada)
    expect((status.structured.agent as { spawnedBy: string }).spawnedBy).toBe(brobot)
    expect(interrupt.structured.agent).toBe(ada)
    expect(message.structured.agent).toBe(ada)
    expect(read.structured.agent).toBe(ada)

    // ⚑ The address a conversation hands back is its label, or its id when it holds no piece.
    expect(host.addressOf(ada)).toBe('W1.1')
    expect(host.addressOf(stranger)).toBe('W2')
    store.create({
      id: 'sess_bare',
      provider: 'claude',
      cwd: root,
      approvalMode: 'auto',
      profileId: 'worker',
      parentSessionId: brobot,
    })
    expect(store.workThatNames('sess_bare')).toBeNull()
    expect(host.nameByItsWork('sess_bare')).toBe('Ada')
    expect(host.addressOf('sess_bare')).toBe('sess_bare')
  })

  it('⚑ a person’s rename announces work once, after the row is down, and a refused rename announces nothing', async () => {
    const { brobot, ada } = await aFamily()
    const before = worksAnnounced()

    // Three refusals: blank, a name no piece carries, and a piece a conversation gave.
    expect(host.retitleForAPerson('W1', '   ').ok).toBe(false)
    expect(host.retitleForAPerson('W99', 'Build the pages').ok).toBe(false)
    expect(host.retitleForAPerson('W1.1', 'Build the pages').ok).toBe(false)
    expect(worksAnnounced()).toBe(before)

    // The rename that lands: told once, and the world at that moment already has the row.
    const seen: unknown[] = []
    atAnnouncement = (what) => {
      if (what === 'work') seen.push(store.workThatNames(brobot))
    }
    const renamed = host.retitleForAPerson('W1', 'Build the pages')
    atAnnouncement = null
    expect(renamed.ok).toBe(true)
    expect(worksAnnounced()).toBe(before + 1)
    expect(seen).toEqual([{ label: 'W1', title: 'Build the pages', definitionOfDone: null }])
    expect(retitlesIn(brobot)).toHaveLength(1)
    expect(retitlesIn(ada)).toHaveLength(0)
  })

  it('⚑ a rename of a conversation that is still starting is announced when its launch settles, with the row down', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    await host.close(brobot, window)
    expect(store.rootOf(brobot)?.label).toBe('W1')

    // Hold the reopen at the provider, so the conversation is starting and has not registered.
    let release: () => void = () => undefined
    resumeGate.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = resumeGate.entered
    const reopening = host.resumeSession(brobot, window)
    await waitFor(() => resumeGate.entered === entered + 1, 'the reopen to reach the provider')
    const before = worksAnnounced()

    const renamed = host.retitleForAPerson('W1', 'Build the pages')
    expect(renamed).toMatchObject({ ok: true, label: 'W1', title: 'Build the pages' })
    // Not yet: the conversation has not registered, so the row waits for it — and so does the word.
    expect(retitlesIn(brobot)).toHaveLength(0)
    expect(worksAnnounced()).toBe(before)

    const seen: unknown[] = []
    atAnnouncement = (what) => {
      if (what === 'work') seen.push(store.workThatNames(brobot))
    }
    release()
    await reopening
    await waitFor(() => worksAnnounced() > before, 'the rename to be announced')
    atAnnouncement = null

    expect(worksAnnounced()).toBe(before + 1)
    expect(seen).toEqual([{ label: 'W1', title: 'Build the pages', definitionOfDone: null }])
    expect(retitlesIn(brobot)).toHaveLength(1)
    expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1 · Build the pages)')
  })

  describe('a self-address names the helpers under the caller’s piece', () => {
    const settledFamily = async (): Promise<Family> => {
      const family = await aFamily()
      await waitFor(
        () => ledger(family.ada).filter((event) => event.type === 'turn').length >= 2,
        'Ada’s child notice to finish',
      )
      const owned = () => store.piecesOwnedBy(family.ada).find((one) => one.label === 'W1.1')
      await waitFor(() => owned()?.state === 'stalled', 'Ada’s notice to finish')
      expect(owned()?.state).toBe('stalled')
      return family
    }
    const acts = (events: readonly TranscriptEvent[]): TranscriptEvent[] =>
      events.filter(
        (event) => !['tool_call', 'tool_result', 'assistant_message', 'turn'].includes(event.type),
      )
    for (const tool of ['message_agent', 'ask_question', 'interrupt_agent'] as const) {
      const argsFor = (agent: string): Record<string, unknown> =>
        tool === 'message_agent'
          ? { agent, kind: 'note', text: 'Read the helper’s result.' }
          : tool === 'ask_question'
            ? { agent, who_answers: 'an-agent', question: 'Which helper owns this?' }
            : { agent, reason: 'Stop the unfinished draft.' }

      for (const ended of [false, true]) {
        it(`${tool} lists the visible ${ended ? 'ended' : 'ongoing'} helper without sending or asking it`, async () => {
          const { brobot, brobotTools, ada } = await settledFamily()
          if (ended) {
            expect(
              await callOn(brobotTools, 'update_work', { piece: 'W1.1', close: true }),
            ).toMatchObject({ outcome: 'ok' })
          }
          const before = acts(ledger(ada))
          const beforeCaller = ledger(brobot).filter((row) => row.type === 'tool_refused').length
          const queued = vi.spyOn(host, 'queueMessage')
          const asked = vi.spyOn(host, 'raiseAQuestion')
          const stopped = vi.spyOn(host, 'interruptAgent')
          const refusalWritten = vi.spyOn(host, 'noteRefusal')
          const said = await fullCall(brobotTools, tool, argsFor('W1'))
          expect(said.structured).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you' })
          expect(said.text).toContain('W1 is your own piece.')
          expect(said.text).toContain('Ada (worker) on W1.1')
          if (ended) expect(said.text).toContain('(ended: closed)')
          else expect(said.text).not.toContain('(ended:')
          expect(said.text).toContain('kind: note')
          expect(said.text).toContain('give_work')
          expect(acts(ledger(ada))).toEqual(before)
          expect(queued).not.toHaveBeenCalled()
          expect(asked).not.toHaveBeenCalled()
          expect(stopped).not.toHaveBeenCalled()
          const told = `${said.structured.reason} This exact call can never succeed.`
          expect(said.text).toBe(`refused (that-agent-is-you): ${told}`)
          expect(refusalWritten).toHaveBeenCalledTimes(1)
          expect(refusalWritten).toHaveBeenCalledWith(brobot, tool, {
            rail: 'that-agent-is-you',
            permanence: 'permanent',
            retryable: false,
            remedy: null,
            told: { text: told, dropped: 0 },
          })
          const refusals = ledger(brobot).filter((event) => event.type === 'tool_refused')
          expect(refusals.slice(beforeCaller)).toEqual([
            {
              type: 'tool_refused',
              tool,
              rail: 'that-agent-is-you',
              permanence: 'permanent',
              retryable: false,
              remedy: null,
              told: { text: told, dropped: 0 },
            },
          ])
        })
      }
      it(`${tool} does not disclose helpers when a stranger’s label is refused`, async () => {
        const { brobotTools } = await settledFamily()
        narrowBroBot()
        const said = await fullCall(brobotTools, tool, argsFor('W2'))
        expect(said.structured.outcome).toBe('refused')
        expect(said.text).not.toContain('Its helpers:')
        expect(said.text).not.toContain('Amara')
      })
    }

    it('the caller’s non-root piece lists its own child and not the parent’s helper', async () => {
      const { ada } = await settledFamily()
      const said = await fullCall(agentToolsFor(host, ada), 'message_agent', {
        agent: 'W1.1',
        kind: 'note',
        text: 'Read the helper’s result.',
      })
      expect(said.text).toContain('W1.1 is your own piece.')
      expect(said.text).toContain('Ali (tester) on W1.1.1')
      expect(said.text).not.toContain('Ada (worker) on')
    })

    it('an ended helper remains listed and its ended label still accepts a note and question', async () => {
      const { brobot, brobotTools, ada } = await settledFamily()
      expect(
        await callOn(brobotTools, 'update_work', { piece: 'W1.1', close: true }),
      ).toMatchObject({ outcome: 'ok' })
      const agents = await fullCall(brobotTools, 'list_agents', {})
      expect(agents.text).toContain('W1.1')
      const tasks = await fullCall(brobotTools, 'list_tasks', { state: 'ended' })
      expect(tasks.text).toContain('Ada (worker)')
      const record = await fullCall(brobotTools, 'list_tasks', { piece: 'W1' })
      expect(record.structured).toMatchObject({
        children: [expect.objectContaining({ label: 'W1.1', owner: ada, profile: 'worker' })],
      })
      const note = await callOn(brobotTools, 'message_agent', {
        agent: 'W1.1',
        kind: 'note',
        text: 'Read the completed piece.',
      })
      expect(note.outcome).toBe('ok')
      expect(ledger(brobot)).toContainEqual(
        expect.objectContaining({ type: 'message_sent', to: ada }),
      )
      const question = await callOn(brobotTools, 'ask_question', {
        agent: 'W1.1',
        who_answers: 'an-agent',
        question: 'What did the finished piece find?',
      })
      expect(question.outcome).toBe('ok')
      expect(ledger(brobot)).toContainEqual(
        expect.objectContaining({ type: 'request_routed', parent: ada }),
      )
    })

    it('does not describe the caller’s own taken-on work as a helper', async () => {
      const me = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, me)
      await host.setApprovalMode(me, 'ask', window)
      await host.send(me, 'Please take on these notes.', window)
      expect(
        await callOn(tools, 'take_on_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          title: 'Write the notes',
          brief: 'Write the notes here.',
        }),
      ).toMatchObject({ outcome: 'ok' })
      const said = await fullCall(tools, 'message_agent', {
        agent: 'W1',
        kind: 'note',
        text: 'Read this.',
      })
      expect(said.text).toContain('W1 is your own piece, with no helpers recorded under it.')
      expect(said.text).not.toContain('Its helpers:')
    })

    it('a visible helper whose identity is unknown still has a usable label, without an invented profile', async () => {
      const { brobot, brobotTools, ada } = await settledFamily()
      const readPiece = host.pieceRecord.bind(host)
      vi.spyOn(host, 'pieceRecord').mockImplementation((caller, label) => {
        const record = readPiece(caller, label)
        const ownRoot = caller === brobot && label === 'W1'
        if (!ownRoot || record.is === 'no-piece-by-that-name') return record
        return {
          ...record,
          children: record.children.map((child) => {
            if (child.owner !== ada) return child
            return { ...child, state: 'working' as const }
          }),
        }
      })
      const premise = host.pieceRecord(brobot, 'W1')
      expect(premise.is).not.toBe('no-piece-by-that-name')
      if (premise.is === 'no-piece-by-that-name') throw new Error('the caller owns this root')
      expect(premise.children.find((child) => child.owner === ada)?.state).toBe('working')
      const read = host.agentCard.bind(host)
      const spy = vi.spyOn(host, 'agentCard').mockImplementation((id, by, me) => {
        const card = read(id, by, me)
        return id === ada && card !== null
          ? { ...card, whose: { is: 'an-identity-this-app-cannot-name' } }
          : card
      })
      try {
        const said = await fullCall(brobotTools, 'message_agent', {
          agent: 'W1',
          kind: 'note',
          text: 'Read this.',
        })
        expect(said.text).toContain('Its helpers: W1.1 (working).')
        expect(said.text).not.toContain('None of its helpers')
        expect(said.text).not.toContain('For new work')
        const record = await fullCall(brobotTools, 'list_tasks', { piece: 'W1' })
        expect(record.structured).toMatchObject({
          children: [expect.objectContaining({ label: 'W1.1', owner: ada })],
        })
        expect((record.structured.children as Record<string, unknown>[])[0]).not.toHaveProperty(
          'profile',
        )
      } finally {
        spy.mockRestore()
      }
    })

    it('does not reveal a helper identity outside the same card reach', async () => {
      const { brobotTools, ada } = await settledFamily()
      const read = host.agentCard.bind(host)
      const spy = vi
        .spyOn(host, 'agentCard')
        .mockImplementation((id, by, me) => (id === ada ? null : read(id, by, me)))
      try {
        const said = await fullCall(brobotTools, 'message_agent', {
          agent: 'W1',
          kind: 'note',
          text: 'Read this.',
        })
        expect(said.text).toContain('None of its helpers is in your reach.')
        expect(said.text).not.toContain('Ada')
        expect(said.text).not.toContain('worker')
        const record = await fullCall(brobotTools, 'list_tasks', { piece: 'W1' })
        expect((record.structured.children as Record<string, unknown>[])[0]).not.toHaveProperty(
          'owner',
        )
      } finally {
        spy.mockRestore()
      }
    })

    it('a root with no helper pieces says so, while an id self-address stays generic', async () => {
      const me = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, me)
      const label = await fullCall(tools, 'message_agent', {
        agent: 'W1',
        kind: 'note',
        text: 'Read this.',
      })
      expect(label.text).toContain('W1 is your own piece, with no helpers recorded under it.')
      const id = await fullCall(tools, 'message_agent', {
        agent: me,
        kind: 'note',
        text: 'Read this.',
      })
      expect(id.structured.rail).toBe('that-agent-is-you')
      expect(id.text).not.toContain('is your own piece')
    })
  })
})
