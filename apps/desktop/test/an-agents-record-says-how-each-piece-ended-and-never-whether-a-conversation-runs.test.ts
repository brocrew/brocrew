/**
 * 🔴 **F009 · an agent's record, the cases its own test leaves open** — `list_profiles` naming a
 * profile, on a real host with the fake runtime and a temp SQLite store.
 *
 * `what-an-agent-has-done.test.ts` (the dev's) pins the record's shape, the bounds over the edge, the
 * four endings with an answer `done`, one replacement, the reach of a `none` grant and the refusals.
 * This file adds what it does not measure:
 *
 *  1. ⛔ **"running" appears nowhere in the record** — read while one of its conversations IS mid-turn
 *     (parked on a card) and another was stopped by the app, so the record had a running state to
 *     leak and the two lines must read alike (the second review's first defect).
 *  2. ⚑ **A chain of replacements names the end of the chain** — both the first conversation and its
 *     stand-in, which itself could not be reopened, name the conversation standing now.
 *  3. ⚑ **Each ending, every outcome** — answered `blocked` / `failed` / `done`, and an open piece with
 *     no ending time and no outcome in its payload; never a brief's or a summary's words.
 *  4. ⚑ **The bounds AT the edge** — exactly 10 pieces and 5 files say no "…and" line; one piece and
 *     two files more say the singular and the plural, and the files are the newest five.
 *  5. ⛔ **The rules line, paired under one grant** — two callers with `can_message: none` while the
 *     agent HAS a conversation: the one that started it is told, the one that did not is not (and
 *     counts nothing it cannot reach).
 *  6. ⛔ **The profile is read as `list_profiles` folds it** — case and blanks around it; a near miss
 *     is refused with its rail and carries no record.
 *
 * ⛔ The expected words are literals; the record is the subject, never the oracle.
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

interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

interface ConversationPayload {
  readonly agent: string
  readonly label: string | null
  readonly started_by: { readonly kind: string; readonly agent?: string }
  readonly started_at: number
  readonly last_changed_at: number
  readonly replaced_by?: string
}

interface PiecePayload {
  readonly label: string
  readonly title: string
  readonly agent: string
  readonly given_by: { readonly kind: string; readonly agent?: string }
  readonly given_at: number
  readonly stands: string
  readonly outcome?: string
  readonly ended_at?: number
}

interface FilePayload {
  readonly resource: string
  readonly name: string
}

const RULES = 'You are a careful tester of web pages.\nReport what fails.'
const NOT_TOLD =
  'How its standing rules begin is told only to a caller that can reach its conversations.'

describe('F009 · an agent’s record — the cases beyond the dev’s own', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => (clock += 1_000)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-record-gaps-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-record-gaps-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_790_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
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
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ── the rig ──────────────────────────────────────────────────────────────────────────────────

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

  /** ⚑ Bounded: 400 × 10 ms at most, then a named failure. */
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const wrote = (name: string, content: string): string => {
    const path = join(root, name)
    writeFileSync(path, content)
    return path
  }

  /** ⚑ A give to `tester`, admitted, and the turn its brief opened ended — the label and holder. */
  const gives = async (
    tools: AgentToolset,
    title: string,
    brief: string = title,
  ): Promise<{ label: string; holder: string }> => {
    const given = await fullCall(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      title,
      brief,
    })
    expect(given.structured, given.text).toMatchObject({ outcome: 'ok' })
    const holder = given.structured.agent as string
    const label = given.structured.label as string
    await waitFor(
      () =>
        ledger(holder).some(
          (event) => event.type === 'assistant_message' && event.text.includes(brief),
        ) && store.piecesOwnedBy(holder).some((one) => one.label === label),
      `${label}'s brief to reach its holder`,
    )
    await waitFor(
      () => turnsIn(holder) >= ledger(holder).filter((event) => event.type === 'user_turn').length,
      'its turn to end',
    )
    return { label, holder }
  }

  /** ⚑ Stopped by the app, and seen stopped by the host's own slot map. */
  const theAppStops = async (conversation: string): Promise<void> => {
    await host.close(conversation, THE_APP_ITSELF)
    await waitFor(() => isNotRunning(conversation), `${conversation} to stop`)
  }

  const runningOf = (conversation: string): string | undefined =>
    host.resumableSessions().find((row) => row.sessionId === conversation)?.running

  const isNotRunning = (conversation: string): boolean => {
    const running = runningOf(conversation)
    return running === undefined || running === 'not-running'
  }

  const theRecordOf = (tools: AgentToolset, profile: string): Promise<Answer> =>
    fullCall(tools, 'list_profiles', { profile })

  const conversationLines = (text: string): string[] => {
    const block = text
      .split('\n\n')
      .find((one) => one.startsWith('Its conversations you can reach'))
    if (block === undefined) throw new Error(`no conversations block: ${text}`)
    return block.split('\n').filter((line) => line.startsWith('  - '))
  }

  // ── 1 · never whether a conversation runs ────────────────────────────────────────────────────

  describe('1 · ⛔ the record never says whether a conversation runs', () => {
    it('🔴 read while one conversation is mid-turn and another was stopped, "running" is nowhere in it — and the two read alike', async () => {
      // ⚑ An `ask`-mode giver: its helper parks on its card, mid-turn (the dev's own instrument).
      const parkedGiver = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const parkedTools = agentToolsFor(host, parkedGiver)
      const first = await fullCall(parkedTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        title: 'Check the forms',
        brief: 'check the forms',
      })
      expect(first.structured, first.text).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const parked = first.structured.agent as string
      await waitFor(
        () => ledger(parked).some((event) => event.type === 'permission_request'),
        'the parked helper’s card',
      )

      // ⚑ A second giver, auto: its helper's turn ends, then the app stops that conversation.
      const reader = await personOpens(DEFAULT_PROFILE_ID)
      const readerTools = agentToolsFor(host, reader)
      const second = await gives(readerTools, 'Check the links')
      expect(second.holder).not.toBe(parked)
      await theAppStops(second.holder)

      // ⚠️ The premise: the host's own slot map says one runs and one does not.
      expect(runningOf(parked), 'the parked helper runs').toBeDefined()
      expect(runningOf(parked), 'the parked helper runs').not.toBe('not-running')
      expect(isNotRunning(second.holder), 'the stopped helper does not').toBe(true)

      const record = await theRecordOf(readerTools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok', profile: 'tester' })
      const conversations = record.structured.conversations as ConversationPayload[]
      expect(conversations.map((one) => one.agent).sort()).toEqual([parked, second.holder].sort())

      // ⛔ The whole text and the whole payload: no running state, in any spelling the review met.
      expect(record.text).not.toMatch(/running/i)
      expect(record.text).not.toMatch(/a message starts it again/i)
      expect(JSON.stringify(record.structured)).not.toMatch(/running/i)
      // ⛔ …and no key a state could ride in on: each conversation carries exactly these.
      for (const one of conversations) {
        expect(Object.keys(one).sort(), one.agent).toEqual(
          ['agent', 'label', 'last_changed_at', 'started_at', 'started_by'].sort(),
        )
      }
      // ⚑ The running one and the stopped one read alike: who started it, when, when it last
      // changed — and nothing after that.
      const lines = conversationLines(record.text)
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        expect(line).toMatch(
          /^ {2}- .+ · (?:you started it|started by .+|a person started it) at [^·]+ · last changed at [^·]+$/,
        )
      }
      expect(record.text).toContain('get_agent_status says what any of them is doing now.')
    })
  })

  // ── 2 · a chain of replacements ──────────────────────────────────────────────────────────────

  describe('2 · ⚑ replaced conversations name the one standing now', () => {
    it('🔴 a conversation replaced twice, and its stand-in, each name the end of the chain', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester', rules: RULES })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      const { label, holder } = await gives(tools, 'Ship the clock page')

      /** ⚑ Stopped by the app, its provider forgets it, and a follow-up finds it cannot reopen. */
      const replaceWhatStandsFor = async (conversation: string): Promise<string> => {
        await theAppStops(conversation)
        issued.forgetAll()
        const woken = await fullCall(tools, 'message_agent', {
          agent: holder,
          kind: 'follow-up',
          piece: label,
          text: 'carry on',
        })
        expect(woken.structured, woken.text).toMatchObject({ outcome: 'ok' })
        const standIn = woken.structured.went_to as string
        expect(typeof standIn).toBe('string')
        expect(standIn).not.toBe(conversation)
        await waitFor(() => turnsIn(standIn) > 0, `${standIn} to take the follow-up`)
        return standIn
      }
      const firstStandIn = await replaceWhatStandsFor(holder)
      const secondStandIn = await replaceWhatStandsFor(firstStandIn)
      expect(secondStandIn).not.toBe(holder)

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      const byId = new Map(
        (record.structured.conversations as ConversationPayload[]).map((one) => [one.agent, one]),
      )
      expect([...byId.keys()].sort()).toEqual([holder, firstStandIn, secondStandIn].sort())
      // ⚑ The END of the chain, never the hop in between.
      expect(byId.get(holder)?.replaced_by).toBe(secondStandIn)
      expect(byId.get(firstStandIn)?.replaced_by).toBe(secondStandIn)
      expect(byId.get(secondStandIn)).not.toHaveProperty('replaced_by')
      expect(record.text).toMatch(
        new RegExp(
          ` {2}- the owner of ${label.replace('.', '\\.')} · Ship the clock page · you started it at .* · it could not be reopened, so conversation ${secondStandIn} \\(it holds no work\\) took its place\\n`,
        ),
      )
      expect(record.text).toContain(
        `  - conversation ${firstStandIn} (it holds no work) · you started it at `,
      )
      expect(record.text).not.toContain(`so conversation ${firstStandIn} (it holds no work) took`)
      expect(record.text).not.toMatch(/running/i)
    })
  })

  // ── 3 · each ending, every outcome ───────────────────────────────────────────────────────────

  describe('3 · ⚑ each piece’s ending, with every outcome an answer has', () => {
    it('🔴 answered blocked, failed and done each say their outcome and when; an open piece carries neither', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester' })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      let holder: string | null = null
      const answers = [
        ['Alpha page', 'blocked'],
        ['Beta page', 'failed'],
        ['Gamma page', 'done'],
      ] as const
      for (const [n, [title, outcome]] of answers.entries()) {
        const given = await gives(tools, title, `zebra brief ${String(n)}`)
        holder ??= given.holder
        expect(given.holder).toBe(holder)
        const replied = await fullCall(agentToolsFor(host, given.holder), 'reply_to_parent', {
          piece: given.label,
          outcome,
          summary: `quokka summary ${String(n)}`,
        })
        expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      }
      const open = await gives(tools, 'Delta page', 'zebra brief open')
      expect(open.holder).toBe(holder)

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok', pieces_not_listed: 0 })
      const pieces = record.structured.pieces as PiecePayload[]
      expect(pieces.map((one) => [one.title, one.stands, one.outcome ?? null])).toEqual([
        ['Delta page', 'open', null],
        ['Gamma page', 'answered', 'done'],
        ['Beta page', 'answered', 'failed'],
        ['Alpha page', 'answered', 'blocked'],
      ])
      // ⚑ An open piece has no ending: no time it ended and no outcome, in the payload either.
      const [delta, ...ended] = pieces
      expect(delta).not.toHaveProperty('ended_at')
      expect(delta).not.toHaveProperty('outcome')
      for (const one of ended) {
        expect(typeof one.ended_at, one.title).toBe('number')
        expect(one.ended_at ?? 0, one.title).toBeGreaterThanOrEqual(one.given_at)
      }
      expect(record.text).toMatch(
        / {2}- W1\.4 · Delta page · given by you at [^·\n]+ · still open\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.3 · Gamma page · given by you at [^·\n]+ · answered \(done\) at [^·\n]+\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.2 · Beta page · given by you at [^·\n]+ · answered \(failed\) at [^·\n]+\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.1 · Alpha page · given by you at [^·\n]+ · answered \(blocked\) at [^·\n]+\n/,
      )
      // ⛔ No brief's words and no answer's words, in the text or the payload.
      for (const said of ['zebra', 'quokka']) {
        expect(record.text).not.toContain(said)
        expect(JSON.stringify(record.structured)).not.toContain(said)
      }
    })
  })

  // ── 4 · the bounds at the edge ───────────────────────────────────────────────────────────────

  describe('4 · ⚑ the bounds, at the edge and one past it', () => {
    it('🔴 ten pieces and five files say no “…and”; one more piece and two more files say “1 older one” and “finds them”, the newest five files first', async () => {
      // ⚑ An `ask`-mode giver: its helper parks on its card, so every further give is held open.
      const giver = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const tools = agentToolsFor(host, giver)
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
      const givePiece = async (n: number): Promise<void> => {
        const more = await fullCall(tools, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'tester',
          title: `Piece ${String(n)}`,
          brief: `piece ${String(n)}`,
        })
        expect(more.structured, more.text).toMatchObject({ outcome: 'ok', agent: holder })
      }
      const holderTools = agentToolsFor(host, holder)
      /** ⚑ One file per call, so each takes its own time and "newest" means something. */
      const keepFile = async (n: number): Promise<void> => {
        const kept = await fullCall(holderTools, 'update_work', {
          piece: 'W1.1',
          resources: [wrote(`note-${String(n)}.md`, `# Note ${String(n)}\n`)],
        })
        expect(kept.structured, kept.text).toMatchObject({ outcome: 'ok' })
      }
      for (let n = 2; n <= 10; n += 1) await givePiece(n)
      for (let n = 1; n <= 5; n += 1) await keepFile(n)

      const atTheEdge = await theRecordOf(tools, 'tester')
      expect(atTheEdge.structured, atTheEdge.text).toMatchObject({
        outcome: 'ok',
        pieces_not_listed: 0,
        files_not_listed: 0,
      })
      expect((atTheEdge.structured.pieces as unknown[]).length).toBe(10)
      expect((atTheEdge.structured.files as unknown[]).length).toBe(5)
      expect(atTheEdge.text).not.toContain('…and')

      await givePiece(11)
      await keepFile(6)
      await keepFile(7)
      const past = await theRecordOf(tools, 'tester')
      expect(past.structured, past.text).toMatchObject({
        outcome: 'ok',
        pieces_not_listed: 1,
        files_not_listed: 2,
      })
      expect((past.structured.pieces as PiecePayload[]).map((one) => one.label)).toEqual(
        [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => `W1.${String(n)}`),
      )
      expect((past.structured.files as FilePayload[]).map((one) => one.name)).toEqual([
        'note-7.md',
        'note-6.md',
        'note-5.md',
        'note-4.md',
        'note-3.md',
      ])
      expect(past.text).toContain('  …and 1 older one, not listed here.')
      expect(past.text).toContain(
        '  …and 2 older ones: find_files with where: everywhere finds them by its profile.',
      )
      // ⚑ The text lists them newest first too.
      const at = (name: string): number => past.text.indexOf(`(${name})`)
      expect(at('note-7.md')).toBeGreaterThan(-1)
      expect(at('note-7.md')).toBeLessThan(at('note-6.md'))
      expect(at('note-4.md')).toBeLessThan(at('note-3.md'))
      expect(at('note-2.md')).toBe(-1)
    })
  })

  // ── 5 · the rules line, paired under one grant ───────────────────────────────────────────────

  describe('5 · ⛔ how its rules begin, to a caller that reaches it — paired under one grant', () => {
    it('🔴 with can_message none, the caller that started its conversation is told and the one that did not is not — and counts nothing out of reach', async () => {
      const starter = await personOpens(DEFAULT_PROFILE_ID)
      const outsider = await personOpens(DEFAULT_PROFILE_ID)
      const starterTools = agentToolsFor(host, starter)
      const outsiderTools = agentToolsFor(host, outsider)
      const made = await fullCall(starterTools, 'create_agent', {
        profile_slug: 'tester',
        rules: RULES,
      })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      const { holder, label: first } = await gives(starterTools, 'Build the clock page')
      // ⚑ Answered first: a give to a helper still holding stalled work is refused.
      const replied = await fullCall(agentToolsFor(host, holder), 'reply_to_parent', {
        piece: first,
        outcome: 'done',
        summary: 'built',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      await gives(starterTools, 'Test the clock page')

      // ⚑ Under the default grant the outsider reaches it too (the third row of the pair).
      const before = await theRecordOf(outsiderTools, 'tester')
      expect(before.structured, before.text).toMatchObject({
        outcome: 'ok',
        rules_told: true,
        rules_begin: 'You are a careful tester of web pages.',
      })

      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' } as never)).toBe(true)

      const told = await theRecordOf(starterTools, 'tester')
      expect(told.structured, told.text).toMatchObject({
        outcome: 'ok',
        rules_told: true,
        rules_begin: 'You are a careful tester of web pages.',
        conversations_not_listed: 0,
        pieces_not_listed: 0,
      })
      expect(
        (told.structured.conversations as ConversationPayload[]).map((one) => one.agent),
      ).toEqual([holder])
      expect((told.structured.pieces as PiecePayload[]).length).toBe(2)
      expect(told.text).toContain(
        'Its standing rules begin: “You are a careful tester of web pages.”',
      )
      expect(told.text).not.toContain(NOT_TOLD)

      // ⛔ The agent HAS a conversation — just not one this caller reaches.
      const notTold = await theRecordOf(outsiderTools, 'tester')
      expect(notTold.structured, notTold.text).toMatchObject({
        outcome: 'ok',
        rules_told: false,
        rules_begin: null,
        conversations: [],
        conversations_not_listed: 0,
        pieces: [],
        pieces_not_listed: 0,
      })
      expect(notTold.structured).not.toHaveProperty('pieces_unread')
      expect(notTold.text).toContain(NOT_TOLD)
      expect(notTold.text).toContain('It has no conversation within your reach.')
      expect(notTold.text).not.toContain('careful tester')
      expect(notTold.text).not.toContain('It has no standing rules.')
      expect(notTold.text).not.toContain('clock page')
      expect(notTold.text).not.toContain(holder)
    })
  })

  // ── 6 · the profile, folded as the roster folds it; a near miss refused ──────────────────────

  describe('6 · ⛔ the profile is read as the roster names it, and a near miss is refused', () => {
    it('🔴 TESTER and “  Tester  ” open tester’s record; “teste” is refused with its rail and no record', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester', rules: RULES })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })

      for (const spelled of ['TESTER', '  Tester  ']) {
        const record = await theRecordOf(tools, spelled)
        expect(record.structured, `${spelled}: ${record.text}`).toMatchObject({
          outcome: 'ok',
          profile: 'tester',
          rules_begin: 'You are a careful tester of web pages.',
        })
      }

      const refused = await theRecordOf(tools, 'teste')
      expect(refused.structured, refused.text).toMatchObject({
        outcome: 'refused',
        rail: 'no-agent-by-that-name',
        permanence: 'permanent',
        retryable: false,
        detail: { profile: 'teste' },
      })
      expect(refused.structured.reason).toContain(
        'no agent has that profile, so there is no record to read',
      )
      // ⛔ A refusal carries no part of any record.
      for (const key of ['conversations', 'pieces', 'files', 'rules_begin', 'rules_told']) {
        expect(refused.structured, key).not.toHaveProperty(key)
      }
      expect(refused.text).not.toContain('careful tester')
    })
  })
})
