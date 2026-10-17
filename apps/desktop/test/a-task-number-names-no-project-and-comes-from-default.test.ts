import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { pieceLine } from '../src/shared/piece-called'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # D-016 · what a giver is told about a piece it gave, through the real tools
 *
 * ## What this file pinned, and what it holds now
 *
 * Until D-016 commit 3 this file pinned where a task's NUMBER came from — `default`'s one sequence,
 * whichever project an old database bound the holder in — and that no sentence a model or a person
 * reads said *in <project>* beside it. ⚑ Commit 3 replaced tasks with PIECES: a piece reads by its
 * label (`W1.2`), numbered under its parent. The project numbering, `list_documents` and the
 * `(task, project)` pair an old ledger's assignment wrote are gone, and the cases about them with
 * them.
 *
 * Two cases keep their subject, because the product still composes the words they pinned and no
 * other test pins them whole:
 *
 *  - a taking-back the app refuses states a closed set of the piece's own facts — `piece`, `label`,
 *    and for a piece already answered `answered`, `resources` and `at` when there are any; for one
 *    already taken back, exactly `piece` and `label` — and none of them a project;
 *  - the sentence a giver is handed when a piece comes back reads
 *    `<label> · <title> was answered by <holder>: <outcome>.`, with the summary as its own paragraph
 *    — the holder by its agent's NAME since D-016 · commit 7 (R3): the piece names the conversation.
 *
 * ⚠️ The file keeps its name, which is what every anchor into it points at; the describe below says
 * what it holds now.
 *
 * ## The shape of every case
 *
 * Every negative here is measured on a row that is present and complete, and sits beside the
 * positive from the same reader: a key asserted absent is asserted next to the keys that ARE there,
 * a line asserted free of a word is asserted equal to the whole line it should be. The work is given
 * through `give_work`, answered through `reply_to_parent` and taken back through `withdraw_task`: a
 * real `RuntimeHost` over a real SQLite ledger and the fake provider, and nothing constructed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A tool's answer: the text a model reads first, and the structured half it acts on. */
interface Answer {
  readonly text: string
  readonly structured: Readonly<Record<string, unknown>>
}

/** A piece given through `give_work`, as its answer named it. */
interface Given {
  readonly owner: string
  readonly piece: string
  readonly label: string
  readonly title: string
}

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

describe('D-016 · what a giver is told about a piece it gave, through the real tools', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016-number-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d016-number-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 16_000_000
    store = createSessionStore(db, tick)
    counter = 0
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
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

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  /** The WHOLE answer: the text is what a model reads first, the structured half is what it acts on. */
  const answerOf = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Answer> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return { text: answered.text, structured: answered.structured ?? {} }
  }

  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length

  /** A PM a person opened, with the `worker` identity already brought into being. */
  const aPm = async (): Promise<string> => {
    await host.close(await personOpens('worker'), window)
    return personOpens('pm')
  }

  /**
   * ⚑ **Work given through the one verb that gives**, and the turn its brief opened waited out. The
   * first give starts the PM's one conversation with `worker`; a later one reaches that same
   * conversation, which is why `worker` is passed back in once there is one.
   */
  const giveWork = async (pm: string, title: string, worker?: string): Promise<Given> => {
    const turns = worker === undefined ? 0 : turnsIn(worker)
    const given = await answerOf(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief: title.toLowerCase(),
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const owner = given.structured.agent as string
    if (worker !== undefined) expect(owner).toBe(worker)
    await waitFor(() => turnsIn(owner) > turns, 'the turn the brief opened to end')
    const piece = given.structured.piece as string
    const label = given.structured.label as string
    // ⚠️ The premise, asserted: the piece is open in its owner's ledger, under the label it was given.
    expect(
      store.openPiecesOf(owner).map((one) => [one.piece, one.label]),
      `${owner}'s open pieces`,
    ).toContainEqual([piece, label])
    return { owner, piece, label, title }
  }

  const replies = async (given: Given): Promise<void> => {
    const replied = await answerOf(given.owner, 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'the schema is migrated',
    })
    expect(replied.structured.outcome, JSON.stringify(replied.structured)).toBe('ok')
  }

  it('🔴 a taking-back the app refuses states the piece’s own facts and names no project', async () => {
    const pm = await aPm()
    const first = await giveWork(pm, 'Migrate the schema')
    const worker = first.owner
    await replies(first)

    // The answered piece cannot be taken back: the refusal states the piece's own facts.
    const tooLate = await answerOf(pm, 'withdraw_task', { piece: first.label })
    expect(tooLate.structured).toMatchObject({
      outcome: 'refused',
      rail: 'that-piece-was-already-answered',
      detail: { piece: first.label, label: first.label, answered: 'done' },
    })
    const answeredDetail = tooLate.structured.detail as Record<string, unknown>
    expect(Object.keys(answeredDetail).length).toBeGreaterThanOrEqual(3)
    for (const key of Object.keys(answeredDetail)) {
      expect(['piece', 'label', 'answered', 'resources', 'at'], `detail key ${key}`).toContain(key)
    }
    expect(Object.keys(answeredDetail)).not.toContain('project')

    // A second piece to the same worker, taken back (the positive of the same door) — by its id,
    // the other spelling the door takes — and taken back again.
    const second = await giveWork(pm, 'Backfill the column', worker)
    const taken = await answerOf(pm, 'withdraw_task', { piece: second.piece })
    expect(taken.structured, JSON.stringify(taken.structured)).toMatchObject({
      outcome: 'ok',
      piece: second.piece,
      label: second.label,
      state: 'withdrawn',
    })
    expect(taken.text.startsWith(`${second.label} is taken back — `), taken.text).toBe(true)

    const again = await answerOf(pm, 'withdraw_task', { piece: second.piece })
    expect(again.structured).toMatchObject({
      outcome: 'refused',
      rail: 'that-piece-was-already-taken-back',
    })
    const takenBackDetail = again.structured.detail as Record<string, unknown>
    expect(takenBackDetail).toEqual({ piece: second.piece, label: second.label })
    expect(Object.keys(takenBackDetail).sort()).toEqual(['label', 'piece'])
  })

  it('🔴 the parent reads the answer as `<label> · <title> was answered by <holder>: <outcome>.` and no project is in it', async () => {
    const pm = await aPm()
    const given = await giveWork(pm, 'Migrate the schema')
    const worker = given.owner
    await replies(given)

    const read = (): string[] =>
      events(pm).flatMap((event) =>
        event.type === 'user_turn' && event.text.includes('was answered by') ? [event.text] : [],
      )
    await waitFor(() => read().length > 0, 'the answer to reach the parent')
    const [text] = read()
    if (text === undefined) throw new Error('the parent read no answer')

    // The whole sentence: the label, the title, the holder and the outcome are each the real
    // piece's, so nothing (`in default`, `in <project>`) can sit between them. ⚑ D-016 · commit 7 ·
    // R3 — the holder is its agent's name, as the host calls it, and its id is not in the words.
    const holder = host.whatToCallTheConversation(worker)
    expect(holder).not.toContain('sess_')
    const paragraphs = text.split('\n\n')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toBe(
      `${pieceLine(given.label, given.title)} was answered by ${holder}: done.`,
    )
    expect(text).not.toContain(worker)
    expect(paragraphs[1]).toBe('the schema is migrated')
  })
})
