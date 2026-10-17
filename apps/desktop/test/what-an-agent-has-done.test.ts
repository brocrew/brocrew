/**
 * 🔴 **F009 · what an agent has done, read when a caller chooses whom to give work to** —
 * `list_profiles` naming a profile, measured on a real host with the fake runtime.
 *
 * ⛔ **What it was**: no single read answered *"what has this agent done?"*. `get_agent_status`
 * answered for one conversation and named only its open work, `list_profiles` named agents with no
 * history, and `list_tasks {made}` covered only the caller's own profile.
 *
 *  1. **The record**: how its standing rules begin; its conversations within reach — who started
 *     each and when, and which could not be reopened and what took its place — never whether one
 *     runs; its newest pieces and how each stands or ended; the files it made — each list newest
 *     first and bounded, with the rest counted, and a piece it could not read said as one.
 *  2. **The reach**: its conversations and their pieces are folded by the reach `list_agents` folds
 *     by, and how its rules begin is told to a caller that reaches the agent; its files are not
 *     folded, as `find_files` asks nothing about the caller. A name this app holds no agent by is
 *     refused, and so is a profile that is not a name.
 *  3. **How the rules begin**: the first line that holds a word, its markdown marks left off, cut.
 *
 * ⛔ **The expected words are literals**; the record is the subject, never the oracle.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { howTheRulesBegin } from '../src/shared/own-instructions'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
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

/** ⚑ A conversation of the record, as its payload carries it. */
interface ConversationPayload {
  readonly agent: string
  readonly label: string | null
  readonly started_by: { readonly kind: string; readonly agent?: string }
  readonly started_at: number
  readonly last_changed_at: number
  readonly replaced_by?: string
}

/** ⚑ A piece of the record, as its payload carries it. */
interface PiecePayload {
  readonly label: string
  readonly title: string
  readonly agent: string
  readonly given_by: { readonly kind: string; readonly agent?: string }
  readonly stands: string
  readonly outcome?: string
  readonly ended_at?: number
}

const THE_RULES = [
  '',
  '- You are a careful tester of web pages: you check every link and every form.',
  'Report what fails, with the steps that reproduce it.',
].join('\n')

describe('F009 · what an agent has done, read on demand', () => {
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
  const tick = (): number => (clock += 1_000)

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
      announce: () => {},
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-record-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-record-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_790_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
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
    args: Record<string, unknown> = {},
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** A file on disk, to hand back. */
  const wrote = (name: string, content: string): string => {
    const path = join(root, name)
    writeFileSync(path, content)
    return path
  }

  /** ⚑ A give, admitted, and the turn its brief opened ended — the piece's label and holder. */
  const gives = async (
    tools: AgentToolset,
    title: string,
    { profile = 'tester', piece }: { readonly profile?: string; readonly piece?: string } = {},
  ): Promise<{ label: string; holder: string }> => {
    const given = await fullCall(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
      ...(piece === undefined ? {} : { piece }),
    })
    expect(given.structured, given.text).toMatchObject({ outcome: 'ok' })
    const holder = given.structured.agent as string
    const label = given.structured.label as string
    await waitFor(
      () =>
        ledger(holder).some(
          (event) => event.type === 'assistant_message' && event.text.includes(title),
        ) && store.piecesOwnedBy(holder).some((one) => one.label === label),
      `${label}'s brief to reach its holder`,
    )
    // ⚑ Every turn its words opened has ended.
    await waitFor(
      () => turnsIn(holder) >= ledger(holder).filter((event) => event.type === 'user_turn').length,
      'its turn to end',
    )
    return { label, holder }
  }

  /** The record a caller reads, by the profile it names. */
  const theRecordOf = (tools: AgentToolset, profile: string): Promise<Answer> =>
    fullCall(tools, 'list_profiles', { profile })

  /**
   * ⚑ **`tester`, made with standing rules, and the work it did for two givers**:
   *  - BroBot (`one`, W1) gave W1.1, answered *done* with a file; W1.2, taken back; W1.3, closed;
   *    and W1.4, still open — all in one conversation of `tester`, which was then stopped and,
   *    as it could not be reopened, replaced;
   *  - a second BroBot (`two`, W2) gave W2.1, still open, in a second conversation of `tester`,
   *    which was stopped.
   */
  const aTesterWithAHistory = async (): Promise<{
    one: string
    two: string
    oneTools: AgentToolset
    twoTools: AgentToolset
    first: string
    standIn: string
    second: string
    file: string
  }> => {
    const one = await personOpens(DEFAULT_PROFILE_ID)
    const oneTools = agentToolsFor(host, one)
    const made = await fullCall(oneTools, 'create_agent', {
      profile_slug: 'tester',
      rules: THE_RULES,
    })
    expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
    const w11 = await gives(oneTools, 'Build the clock page')
    expect(w11.label).toBe('W1.1')
    const first = w11.holder
    const firstTools = agentToolsFor(host, first)
    const replied = await fullCall(firstTools, 'reply_to_parent', {
      piece: 'W1.1',
      outcome: 'done',
      summary: 'built',
      resource_paths: [wrote('clock-report.md', '# Clock page report\nAll links work.\n')],
    })
    expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
    const file = (replied.structured.resources as string[])[0] ?? ''
    expect(file).toMatch(/^res_/)
    const w12 = await gives(oneTools, 'Test the clock page')
    expect(w12).toEqual({ label: 'W1.2', holder: first })
    const taken = await fullCall(oneTools, 'withdraw_task', { piece: 'W1.2' })
    expect(taken.structured, taken.text).toMatchObject({ outcome: 'ok' })
    const w13 = await gives(oneTools, 'Translate the clock page')
    expect(w13).toEqual({ label: 'W1.3', holder: first })
    const closed = await fullCall(oneTools, 'update_work', { piece: 'W1.3', close: true })
    expect(closed.structured, closed.text).toMatchObject({ outcome: 'ok' })
    const w14 = await gives(oneTools, 'Ship the clock page')
    expect(w14).toEqual({ label: 'W1.4', holder: first })

    const two = await personOpens(DEFAULT_PROFILE_ID)
    const twoTools = agentToolsFor(host, two)
    const w21 = await gives(twoTools, 'Plan the trip')
    expect(w21.label).toBe('W2.1')
    const second = w21.holder
    expect(second).not.toBe(first)

    // ⚑ The second conversation stopped by the app; the first stopped, then replaced as it could
    // never be reopened (D-017 · R10: its provider forgot it).
    await host.close(second, THE_APP_ITSELF)
    await host.close(first, THE_APP_ITSELF)
    for (const stopped of [first, second]) {
      await waitFor(
        () =>
          !host
            .resumableSessions()
            .some((row) => row.sessionId === stopped && row.running !== 'not-running'),
        `${stopped} to stop`,
      )
    }
    issued.forgetAll()
    const woken = await fullCall(oneTools, 'message_agent', {
      agent: first,
      kind: 'follow-up',
      piece: 'W1.4',
      text: 'carry on',
    })
    expect(woken.structured, woken.text).toMatchObject({ outcome: 'ok' })
    const standIn = woken.structured.went_to as string
    expect(typeof standIn).toBe('string')
    expect(standIn).not.toBe(first)
    await waitFor(() => turnsIn(standIn) > 0, 'the stand-in to take the follow-up')
    return { one, two, oneTools, twoTools, first, standIn, second, file }
  }

  describe('1 · the record', () => {
    it('🔴 its rules, its conversations and the one that ended, its pieces each way, and its file', async () => {
      const { one, two, oneTools, twoTools, first, standIn, second, file } =
        await aTesterWithAHistory()
      const record = await theRecordOf(oneTools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok', profile: 'tester' })

      // ⚑ Its rules, as they begin: the first line holding a word, the list's mark left off.
      expect(record.structured.rules_told).toBe(true)
      expect(record.structured.rules_begin).toBe(
        'You are a careful tester of web pages: you check every link and every form.',
      )
      expect(record.text).toContain(
        'Its standing rules begin: “You are a careful tester of web pages: you check every link and every form.”',
      )

      // ⚑ Its conversations — all three within BroBot's reach — and the one that ended, with what
      // took its place. ⛔ Never whether one runs: the stopped one and the running one read alike.
      const conversations = record.structured.conversations as ConversationPayload[]
      const byId = new Map(conversations.map((one_) => [one_.agent, one_]))
      expect([...byId.keys()].sort()).toEqual([first, second, standIn].sort())
      expect(byId.get(standIn)).toEqual(
        expect.objectContaining({ label: null, started_by: { kind: 'you' } }),
      )
      expect(byId.get(standIn)).not.toHaveProperty('replaced_by')
      expect(byId.get(second)).toMatchObject({
        label: 'W2.1',
        started_by: { kind: 'an-agent', agent: two },
      })
      expect(byId.get(second)).not.toHaveProperty('replaced_by')
      expect(byId.get(first)).toMatchObject({
        label: 'W1.4',
        replaced_by: standIn,
        started_by: { kind: 'you' },
      })
      // ⚑ Newest activity first.
      const lastChanged = conversations.map((one_) => one_.last_changed_at)
      expect(lastChanged).toEqual([...lastChanged].sort((a, b) => b - a))
      expect(record.structured.conversations_not_listed).toBe(0)
      expect(record.text).toMatch(
        / {2}- the owner of W2\.1 · Plan the trip · started by BroBot \(the owner of W2\) at .* · last changed at [^·\n]*\n/,
      )
      // ⚑ The conversation in its place is the same agent's, so it is named as its own line names it.
      expect(record.text).toMatch(
        new RegExp(
          ` {2}- the owner of W1\\.4 · Ship the clock page · you started it at .* · it could not be reopened, so conversation ${standIn} \\(it holds no work\\) took its place\\n`,
        ),
      )
      expect(record.text).toContain(
        `  - conversation ${standIn} (it holds no work) · you started it at `,
      )
      expect(record.text).toContain('get_agent_status says what any of them is doing now.')
      expect(record.text).not.toMatch(/running/)
      // ⚑ Read by another conversation of BroBot, the one that started them is named by its root —
      // a root names its owner in every sentence — for the one started by a give and the stand-in
      // started by a message alike.
      const fromTwo = await theRecordOf(twoTools, 'tester')
      expect(fromTwo.text).toContain(
        '  - the owner of W1.4 · Ship the clock page · started by BroBot (the owner of W1) at ',
      )
      expect(fromTwo.text).toContain(
        `  - conversation ${standIn} (it holds no work) · started by BroBot (the owner of W1) at `,
      )
      expect(fromTwo.text).toContain('  - the owner of W2.1 · Plan the trip · you started it at ')

      // ⚑ Its pieces, the newest given first, each with how it ended — and who gave it.
      const pieces = record.structured.pieces as PiecePayload[]
      expect(pieces.map((piece) => [piece.label, piece.stands, piece.outcome ?? null])).toEqual([
        ['W2.1', 'open', null],
        ['W1.4', 'open', null],
        ['W1.3', 'closed', null],
        ['W1.2', 'withdrawn', null],
        ['W1.1', 'answered', 'done'],
      ])
      expect(pieces.find((piece) => piece.label === 'W2.1')?.given_by).toEqual({
        kind: 'an-agent',
        agent: two,
      })
      expect(pieces.find((piece) => piece.label === 'W1.1')?.given_by).toEqual({ kind: 'you' })
      expect(pieces.find((piece) => piece.label === 'W1.1')?.agent).toBe(first)
      expect(record.structured.pieces_not_listed).toBe(0)
      expect(record.text).toMatch(
        / {2}- W2\.1 · Plan the trip · given by BroBot \(the owner of W2\) at .* · still open/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.4 · Ship the clock page · given by you at .* · still open/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.3 · Translate the clock page · given by you at .* · closed at /,
      )
      expect(record.text).toMatch(
        / {2}- W1\.2 · Test the clock page · given by you at .* · taken back at /,
      )
      expect(record.text).toMatch(
        / {2}- W1\.1 · Build the clock page · given by you at .* · answered \(done\) at /,
      )

      // ⚑ The file it made, by its id and title, on its piece.
      const files = record.structured.files as { resource: string; title: string; label: string }[]
      expect(files).toEqual([
        expect.objectContaining({ resource: file, title: 'Clock page report', label: 'W1.1' }),
      ])
      expect(record.structured.files_not_listed).toBe(0)
      expect(record.text).toContain(`Files it made, newest first:\n  ${file} (clock-report.md)`)
      expect(record.text).toContain('Read one with read_document.')
      expect(record.structured.rows_unread).toBe(0)

      // ⛔ No brief, no answer's words: what the record reads is how the work ended.
      expect(record.text).not.toContain('built')
      expect(one).not.toBe(two)
    })

    it('⚑ its own profile names the caller as you, and a person as the one who started it', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      const record = await theRecordOf(tools, DEFAULT_PROFILE_ID)
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      expect(record.structured.conversations).toEqual([
        expect.objectContaining({
          agent: brobot,
          label: 'W1',
          started_by: { kind: 'a-person' },
        }),
      ])
      expect(record.text).toMatch(/ {2}- you, the owner of W1 · a person started it at /)
      expect(record.text).toContain('It has no standing rules.')
      expect(record.text).toContain('It has made no files.')
      expect(record.text).toContain('Its conversations you can reach hold no pieces of work.')
    })

    it('🔴 each list is bounded, and what it leaves out is counted', async () => {
      // ⚑ An `ask`-mode giver: its helper parks on its card, so every further give is held open.
      const brobot = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const tools = agentToolsFor(host, brobot)
      const first = await fullCall(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        title: 'Piece 1',
        brief: 'piece 1',
      })
      expect(first.structured, first.text).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const holder = first.structured.agent as string
      await waitFor(
        () => ledger(holder).some((event) => event.type === 'permission_request'),
        'its first card',
      )
      for (let n = 2; n <= 12; n += 1) {
        const more = await fullCall(tools, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'tester',
          title: `Piece ${String(n)}`,
          brief: `piece ${String(n)}`,
        })
        expect(more.structured, more.text).toMatchObject({ outcome: 'ok', agent: holder })
      }
      // ⚑ Six files it made, kept on its first piece in one call.
      const kept = await fullCall(agentToolsFor(host, holder), 'update_work', {
        piece: 'W1.1',
        resources: [1, 2, 3, 4, 5, 6].map((n) =>
          wrote(`note-${String(n)}.md`, `# Note ${String(n)}\n`),
        ),
      })
      expect(kept.structured, kept.text).toMatchObject({ outcome: 'ok' })

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({
        outcome: 'ok',
        pieces_not_listed: 2,
        files_not_listed: 1,
      })
      const pieces = record.structured.pieces as PiecePayload[]
      expect(pieces.map((piece) => piece.label)).toEqual(
        [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((n) => `W1.${String(n)}`),
      )
      expect(pieces.every((piece) => piece.stands === 'open')).toBe(true)
      expect((record.structured.files as unknown[]).length).toBe(5)
      expect(record.text).toContain('  …and 2 older ones, not listed here.')
      expect(record.text).toContain(
        '  …and 1 older one: find_files with where: everywhere finds it by its profile.',
      )
    })

    it('⚑ its conversations are bounded too, the newest activity first, and the rest counted', async () => {
      // ⚑ Eleven of BroBot's conversations each give `tester` a piece: eleven conversations of it.
      for (let n = 1; n <= 11; n += 1) {
        const giver = await personOpens(DEFAULT_PROFILE_ID)
        const given = await fullCall(agentToolsFor(host, giver), 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'tester',
          ...(n === 1 ? { new: true } : {}),
          title: `Errand ${String(n)}`,
          brief: `errand ${String(n)}`,
        })
        expect(given.structured, given.text).toMatchObject({ outcome: 'ok' })
      }
      const reader = await personOpens(DEFAULT_PROFILE_ID)
      const record = await theRecordOf(agentToolsFor(host, reader), 'tester')
      expect(record.structured, record.text).toMatchObject({
        outcome: 'ok',
        conversations_not_listed: 1,
        pieces_not_listed: 1,
      })
      expect((record.structured.conversations as unknown[]).length).toBe(10)
      expect(record.text).toContain('  …and 1 more you can reach, not listed here.')
      expect(record.text).toContain('  …and 1 older one, not listed here.')
    })

    it('🔴 a newest piece its holder’s record cannot read is said as one, never called older and never none', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester' })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      const given = await gives(tools, 'Build the clock page')
      // ⚑ The give's own row torn in its holder's record, as a hand edit or a bad write leaves it.
      db.prepare(
        `UPDATE events SET payload = '{' WHERE session_id = ? AND type = 'work_given'`,
      ).run(given.holder)
      // ⚑ Read by a host started on that record — a launch's — so no fold of it is remembered.
      store = createSessionStore(db, tick)
      const after = buildHost()
      const record = await theRecordOf(agentToolsFor(after, brobot), 'tester')
      expect(record.structured, record.text).toMatchObject({
        outcome: 'ok',
        pieces: [],
        pieces_unread: 1,
        pieces_not_listed: 0,
      })
      expect(record.structured.rows_unread).toBeGreaterThan(0)
      expect(record.text).toContain('  …and 1 more of the newest, which this app could not read.')
      expect(record.text).not.toContain('hold no pieces of work')
      expect(record.text).toContain("of this app's record could not be read")
    })

    it('⚑ work taken on for a person was given by a person, and a root is never one of its pieces', async () => {
      // ⚑ BroBot takes ten pieces on for its person; then a second conversation of BroBot is opened,
      // whose root is newer than all ten — and must not take one of their places.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      await host.setApprovalMode(brobot, 'ask', window)
      await host.send(brobot, 'Please take on the ten fictional errands.', window)
      for (let n = 1; n <= 10; n += 1) {
        const taken = await fullCall(tools, 'take_on_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          title: `Errand ${String(n)}`,
          brief: `errand ${String(n)}`,
        })
        expect(taken.structured, taken.text).toMatchObject({
          outcome: 'ok',
          label: `W1.${String(n)}`,
        })
      }
      await personOpens(DEFAULT_PROFILE_ID)
      const record = await theRecordOf(tools, DEFAULT_PROFILE_ID)
      expect(record.structured, record.text).toMatchObject({
        outcome: 'ok',
        pieces_not_listed: 0,
      })
      const pieces = record.structured.pieces as PiecePayload[]
      expect(pieces.map((piece) => piece.label)).toEqual(
        [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `W1.${String(n)}`),
      )
      expect(pieces.every((piece) => piece.given_by.kind === 'a-person')).toBe(true)
      expect(record.text).toMatch(/ {2}- W1\.10 · Errand 10 · given by a person at .* · still open/)
      expect((record.structured.conversations as ConversationPayload[]).length).toBe(2)
    })

    /**
     * ⚑ **A starter that has moved on**: BroBot gives Ada (`worker`) W1.1, and Ada gives Ali
     * (`tester`) W1.1.1 from it, which starts Ali's conversation; both are answered. Then Ada is given
     * W1.2, gives Ali W1.2.1 from it — the newest piece Ali's conversation holds — and answers W1.2.
     * So the work that names Ada now, and the piece she last gave Ali from, both came after she
     * started Ali's conversation.
     */
    const aStarterThatMovedOn = async (): Promise<{
      tools: AgentToolset
      ada: string
      adaTools: AgentToolset
      ali: string
    }> => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      for (const name of ['worker', 'tester']) {
        const made = await fullCall(tools, 'create_agent', { profile_slug: name })
        expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      }
      const answer = async (who: AgentToolset, piece: string): Promise<void> => {
        const answered = await fullCall(who, 'reply_to_parent', {
          piece,
          outcome: 'done',
          summary: 'done',
        })
        expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })
      }
      const w11 = await gives(tools, 'Build the clock page', { profile: 'worker' })
      expect(w11.label).toBe('W1.1')
      const ada = w11.holder
      const adaTools = agentToolsFor(host, ada)
      const w111 = await gives(adaTools, 'Wire the routes', { piece: 'W1.1' })
      expect(w111.label).toBe('W1.1.1')
      const ali = w111.holder
      await answer(agentToolsFor(host, ali), 'W1.1.1')
      await answer(adaTools, 'W1.1')
      const w12 = await gives(tools, 'Live check: the clock page', { profile: 'worker' })
      expect(w12).toEqual({ label: 'W1.2', holder: ada })
      const w121 = await gives(adaTools, 'Check the routes', { piece: 'W1.2' })
      expect(w121).toEqual({ label: 'W1.2.1', holder: ali })
      await answer(adaTools, 'W1.2')
      // ⚑ The premise: what names Ada now is W1.2, answered — what the record named her by before.
      expect(host.nameByItsWork(ada)).toBe(
        'Ada (the owner of W1.2 · Live check: the clock page (answered))',
      )
      return { tools, ada, adaTools, ali }
    }

    it('🔴 a starter is named by the piece it started that conversation from — never its work now, nor a later piece, and with no mark', async () => {
      const { tools, ada, ali } = await aStarterThatMovedOn()
      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      expect(record.text).toContain(
        '  - the owner of W1.2.1 · Check the routes · started by Ada (the owner of W1.1 · Build the clock page) at ',
      )
      expect(record.text).not.toContain('started by Ada (the owner of W1.2')
      expect(record.text).not.toContain('(answered)')
      // ⚑ Each piece names its giver by its own piece above it, as the starter is named.
      expect(record.text).toMatch(
        / {2}- W1\.2\.1 · Check the routes · given by Ada \(the owner of W1\.2 · Live check: the clock page\) at .* · still open/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.1\.1 · Wire the routes · given by Ada \(the owner of W1\.1 · Build the clock page\) at .* · answered \(done\) at /,
      )
      expect((record.structured.conversations as ConversationPayload[])[0]).toMatchObject({
        agent: ali,
        started_by: { kind: 'an-agent', agent: ada },
      })
    })

    /** ⚑ A conversation stopped, and its provider made to forget it: what reaches it next replaces it. */
    const stoppedAndForgotten = async (conversation: string): Promise<void> => {
      await host.close(conversation, THE_APP_ITSELF)
      await waitFor(
        () =>
          !host
            .resumableSessions()
            .some((row) => row.sessionId === conversation && row.running !== 'not-running'),
        'it to stop',
      )
      issued.forgetAll()
    }

    it('⚑ a conversation started with no piece names its starter alone — in another’s place, even once it is given work', async () => {
      const { tools, ada, adaTools, ali } = await aStarterThatMovedOn()
      // ⚑ Ali's conversation replaced at Ada's next note, by a conversation started with no piece.
      await stoppedAndForgotten(ali)
      const noted = await fullCall(adaTools, 'message_agent', {
        agent: ali,
        kind: 'note',
        text: 'the routes are live',
      })
      expect(noted.structured, noted.text).toMatchObject({ outcome: 'ok' })
      const standIn = noted.structured.went_to as string
      expect(typeof standIn).toBe('string')
      expect(standIn).not.toBe(ali)
      // ⚑ Then Ada gives it work from a piece she is given after, and answers that piece.
      const w13 = await gives(tools, 'Ship the clock page', { profile: 'worker' })
      expect(w13).toEqual({ label: 'W1.3', holder: ada })
      const w131 = await gives(adaTools, 'Tag the release', { piece: 'W1.3' })
      expect(w131).toEqual({ label: 'W1.3.1', holder: standIn })
      const answered = await fullCall(adaTools, 'reply_to_parent', {
        piece: 'W1.3',
        outcome: 'done',
        summary: 'shipped',
      })
      expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      // ⛔ Not by W1.3, the piece Ada later gave it from: it was started with none.
      expect(record.text).toContain(
        '  - the owner of W1.3.1 · Tag the release · started by Ada at ',
      )
      // ⚑ The conversation it took the place of keeps the piece it was started from.
      expect(record.text).toContain(
        '  - the owner of W1.2.1 · Check the routes · started by Ada (the owner of W1.1 · Build the clock page) at ',
      )
      expect(record.text).toContain(
        'it could not be reopened, so the owner of W1.3.1 · Tag the release took its place',
      )
      const byId = new Map(
        (record.structured.conversations as ConversationPayload[]).map((one) => [one.agent, one]),
      )
      expect(byId.get(standIn)).toMatchObject({ started_by: { kind: 'an-agent', agent: ada } })
    })

    it('🔴 a conversation standing in another’s place that a give started names its starter by the piece it gave it from', async () => {
      const { tools, ada, adaTools, ali } = await aStarterThatMovedOn()
      // ⚑ Ali answers what Ada gave it, so Ada may give it more; Ada is given W1.3.
      const done = await fullCall(agentToolsFor(host, ali), 'reply_to_parent', {
        piece: 'W1.2.1',
        outcome: 'done',
        summary: 'checked',
      })
      expect(done.structured, done.text).toMatchObject({ outcome: 'ok' })
      const w13 = await gives(tools, 'Ship the clock page', { profile: 'worker' })
      expect(w13).toEqual({ label: 'W1.3', holder: ada })
      // ⚑ Ali's conversation replaced by Ada's give, whose brief starts the conversation in its place.
      await stoppedAndForgotten(ali)
      const w131 = await gives(adaTools, 'Tag the release', { piece: 'W1.3' })
      expect(w131.label).toBe('W1.3.1')
      const standIn = w131.holder
      expect(standIn).not.toBe(ali)
      const answered = await fullCall(adaTools, 'reply_to_parent', {
        piece: 'W1.3',
        outcome: 'done',
        summary: 'shipped',
      })
      expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      expect(record.text).toContain(
        '  - the owner of W1.3.1 · Tag the release · started by Ada (the owner of W1.3 · Ship the clock page) at ',
      )
      expect(record.text).toContain(
        'it could not be reopened, so the owner of W1.3.1 · Tag the release took its place',
      )
    })
  })

  describe('2 · the reach', () => {
    it('🔴 a caller that reaches only what it started reads only those conversations, and every file', async () => {
      const { one, two, oneTools, twoTools, first, standIn, second, file } =
        await aTesterWithAHistory()
      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' } as never)).toBe(true)

      const fromOne = await theRecordOf(oneTools, 'tester')
      expect(fromOne.structured, fromOne.text).toMatchObject({ outcome: 'ok' })
      const oneSees = (fromOne.structured.conversations as ConversationPayload[]).map(
        (row) => row.agent,
      )
      expect(oneSees.sort()).toEqual([first, standIn].sort())
      expect((fromOne.structured.pieces as PiecePayload[]).map((piece) => piece.label)).toEqual([
        'W1.4',
        'W1.3',
        'W1.2',
        'W1.1',
      ])
      expect(fromOne.text).not.toContain('W2.1')

      const fromTwo = await theRecordOf(twoTools, 'tester')
      expect(fromTwo.structured, fromTwo.text).toMatchObject({ outcome: 'ok' })
      expect(
        (fromTwo.structured.conversations as ConversationPayload[]).map((row) => row.agent),
      ).toEqual([second])
      expect((fromTwo.structured.pieces as PiecePayload[]).map((piece) => piece.label)).toEqual([
        'W2.1',
      ])
      expect(fromTwo.text).not.toContain('W1.4')
      // ⚑ Each reaches a conversation of it, so each is told how its rules begin.
      expect(fromTwo.structured.rules_told).toBe(true)
      // ⚑ Its files are not folded by reach: `find_files` names them to any caller.
      expect((fromTwo.structured.files as { resource: string }[]).map((f) => f.resource)).toEqual([
        file,
      ])
      // ⚑ What the record says of a conversation is what `get_agent_status` would admit.
      const status = await fullCall(twoTools, 'get_agent_status', { agent: first })
      expect(status.structured.outcome).toBe('refused')
      expect(one).not.toBe(two)
    })

    it('🔴 how its rules begin is told only to a caller that reaches the agent — never whether it has any', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      for (const [name, rules] of [
        ['auditor', 'You are an auditor of accounts.'],
        ['scribe', undefined],
      ] as const) {
        const made = await fullCall(tools, 'create_agent', {
          profile_slug: name,
          ...(rules === undefined ? {} : { rules }),
        })
        expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      }
      // ⚑ The paired positive: a grant that reaches any conversation reaches agents nobody started.
      const told = await theRecordOf(tools, 'auditor')
      expect(told.structured).toMatchObject({
        rules_told: true,
        rules_begin: 'You are an auditor of accounts.',
      })
      expect(told.text).toContain('It has no conversation within your reach.')

      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' } as never)).toBe(true)
      const NOT_TOLD =
        'How its standing rules begin is told only to a caller that can reach its conversations.'
      for (const name of ['auditor', 'scribe']) {
        const record = await theRecordOf(tools, name)
        expect(record.structured, record.text).toMatchObject({
          outcome: 'ok',
          rules_told: false,
          rules_begin: null,
        })
        // ⛔ One sentence for rules and for none: a caller out of reach learns neither.
        expect(record.text).toContain(NOT_TOLD)
        expect(record.text).not.toContain('auditor of accounts')
        expect(record.text).not.toContain('It has no standing rules.')
      }
    })

    it('⛔ a name this app holds no agent by is refused, and the refusal names the door that lists them', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      const refused = await theRecordOf(tools, 'nobody-by-this-name')
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-agent-by-that-name',
        permanence: 'permanent',
        retryable: false,
        detail: { profile: 'nobody-by-this-name' },
      })
      expect(refused.structured.reason).toContain('list_profiles')
    })

    it('⛔ a profile that names nobody is a malformed call, and without one the list is as it was', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, brobot)
      const blank = await theRecordOf(tools, '   ')
      expect(blank.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
      const listed = await fullCall(tools, 'list_profiles')
      expect(listed.structured).toMatchObject({ outcome: 'ok' })
      expect(listed.structured).toHaveProperty('profiles')
      expect(listed.structured).not.toHaveProperty('conversations')
    })
  })

  describe('3 · how the rules begin', () => {
    it('⚑ the first line holding a word, its markdown marks left off, cut on a word', () => {
      expect(howTheRulesBegin(null, 200)).toBeNull()
      expect(howTheRulesBegin('\n  \n', 200)).toBeNull()
      // ⚑ Rules with no word in them are still rules: their first line, quoted.
      expect(howTheRulesBegin('\n  \n---\n', 200)).toBe('---')
      expect(howTheRulesBegin('You are DEV, the developer.\nMore.', 200)).toBe(
        'You are DEV, the developer.',
      )
      expect(howTheRulesBegin('\n# Tester\nYou test.', 200)).toBe('Tester')
      expect(howTheRulesBegin('> - 1. Quoted list item', 200)).toBe('Quoted list item')
      expect(howTheRulesBegin('1. First rule', 200)).toBe('First rule')
      expect(howTheRulesBegin('one two three four five six', 12)).toBe('one two…')
      // ⛔ Never inside a character: a cut counts characters, not their halves.
      expect(howTheRulesBegin('😀'.repeat(5), 3)).toBe('😀😀😀…')
    })
  })
})
