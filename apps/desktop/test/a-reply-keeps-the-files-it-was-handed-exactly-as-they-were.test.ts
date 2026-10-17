import { navigationReply } from './helpers/navigation-reply'
import { conversationLink, agentLink, pieceLink } from '../src/shared/links'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { WorkSearchEngine } from '../src/main/db/work-search-engine'
import { WorkSearchPageBudget, workSearchMaterialization } from '../src/main/db/bounded-work-search'
import type { WorkSearchReader } from '../src/main/db/work-search-reader'
import type { WorkSearchPage } from '../src/shared/work-search'
import { workSearchQuery, clippedWorkText } from '../src/shared/work-search'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { keepResource, resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { CAPABILITY_FIELDS, MAX_CAPABILITY_COUNT } from '../src/shared/capabilities'
import { MAX_RESOURCES_PER_REPLY, RESOURCE_ROLES } from '../src/shared/documents'
import { PIECE_EVENT_TYPES } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * D-016b · a reply keeps the files it was handed exactly as they were, and the tables that hold
 * them refuse what this app never writes.
 *
 * ## What this file pins, and why it is a file of its own
 *
 * `a-reply-and-its-absence` §4 proves that a reply names its resource and that the bytes read
 * back, with ASCII text where a character is a byte and a file with LF endings only. Every one of
 * those fixtures survives a writer that rewrites what it keeps, a size column that counts
 * characters, a role column that says the wrong thing, or a check that admits one more than its
 * bound. This file is the measurement those fixtures cannot make:
 *
 *  - the bytes: a BOM, CRLF endings, multi-byte UTF-8 and bytes that are not UTF-8 at all are kept
 *    byte for byte, and the row's hash and size are those of the SOURCE bytes, hashed here with an
 *    independent implementation (never the app's own `sha256Hex`);
 *  - the role: a reply's file is `made`, an input is `input`, and the reader prints the row's;
 *  - the cap: ten files and not eleven, and the eleventh keeps nothing;
 *  - the order: every file is read before any is kept, so a reply refused on its last file keeps
 *    nothing of the files before it; a file that cannot be kept refuses the reply naming it;
 *  - the writer's own guard: only a lowercase sha-256 and a one-segment name are ever written;
 *  - the schema: `max_depth` admits 0 to the capability count, each capability column admits its
 *    own words and refuses another column's, `events_work_idx` lists the seven piece events, the
 *    resource table refuses a role, a hash and a size this app never writes, and a database the
 *    previous build made is refused untouched by the tree's migrations (one until D-042, two since).
 *
 * Every refusal is paired with the identical call one fact over that lands, so a test that stops
 * reaching its rule goes red rather than green.
 *
 * Real host, real SQLite, real migrations, real tools, real filesystem. The only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** An INDEPENDENT hash: never the app's own, so a writer and its reader cannot agree on a mistake. */
const shaOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

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

describe('D-016b · a reply keeps the files it was handed exactly as they were', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (workSearchReader?: WorkSearchReader): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      workSearchReader,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-keeps-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-keeps-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The toolset a session's calls are driven through, built the way the launch builds it. */
  const toolsOf = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** A PM that gave a piece of work to a worker, through the real door: the state every test starts from. */
  const workWasGiven = async (
    text = 'the work',
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset; task: string }> => {
    const nth = ++pairs
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(`pm-${String(nth)}`)
    const pmTools = toolsOf(pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: text,
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools, task: given.piece as string }
  }

  const taskOf = (sessionId: string, piece: string) =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const reply = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => callOn(toolsOf(sessionId), 'reply_to_parent', args)

  /** A file in the working folder, from a string or from raw bytes. */
  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  /** What is kept, by hash directory. Dot-names are temporary files, which are not kept anything. */
  const keptHashes = (): string[] => {
    try {
      return readdirSync(resourcesRoot(userData))
        .filter((name) => !name.startsWith('.'))
        .sort()
    } catch {
      return []
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · what a reply keeps
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('the recorded files have separate work memberships', () => {
    it('selects the listed main document by a resolved relative spelling', async () => {
      const { worker, task } = await workWasGiven()
      const paths = [wrote('notes.md', '# Notes'), wrote('result.md', '# Result')]
      const folder = store.recordedOne(worker)?.cwd
      if (folder == null) throw new Error('the worker has no recorded folder')
      const main = relative(folder, paths[1]!)
      expect(main).not.toBe(paths[1])
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: paths,
        result_document: main,
      })
      expect(landed.outcome).toBe('ok')
      const ids = landed.resources as string[]
      expect(ids).toHaveLength(2)
      expect(landed.result_document).toBe(ids[1])
      expect(taskOf(worker, task)?.resultDocument).toBe(ids[1])
      expect(keptHashes()).toEqual(paths.map((path) => shaOf(readFileSync(path))).sort())
    })

    it('records an optional main document by returned id in the same reply and preserves it on a fresh host', async () => {
      const { worker, task } = await workWasGiven()
      const paths = [wrote('notes.md', '# Notes'), wrote('result.html', '<title>Result</title>')]
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: paths,
        result_document: paths[1],
      })
      expect(landed.outcome).toBe('ok')
      const ids = landed.resources as string[]
      expect(landed.result_document).toBe(ids[1])
      const event = ledger(worker).find((one) => one.type === 'work_replied')
      expect(event).toMatchObject({ resources: ids, resultDocument: ids[1] })
      expect(taskOf(worker, task)?.resultDocument).toBe(ids[1])
      const files = buildHost().filesKept({ scope: 'piece', piece: task })
      expect(files.ok).toBe(true)
      if (!files.ok) throw new Error('no files')
      expect(files.files.map((file) => [file.resourceId, file.mainResult ?? false]).sort()).toEqual(
        [
          [ids[0], false],
          [ids[1], true],
        ].sort(),
      )
      expect(JSON.stringify(event)).not.toContain(paths[1])
    })

    it.each(['automatic', 'explicit'] as const)(
      'keeps no main id after a rolled-back %s-main transaction',
      async (kind) => {
        const { worker, task } = await workWasGiven()
        const path = wrote('result.md', '# Result')
        const original = store.atomically.bind(store)
        const failure = vi.spyOn(store, 'atomically').mockImplementationOnce((write) =>
          original(() => {
            write()
            throw new Error('fictional reply transaction failure')
          }),
        )
        const replied = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'Delivered.',
          resource_paths: [path],
          ...(kind === 'explicit' ? { result_document: path } : {}),
        })
        failure.mockRestore()
        expect(replied.outcome).toBe('ok')
        expect(replied.resources).toEqual([])
        expect(replied).not.toHaveProperty('result_document')
        expect(store.resourcesOf(task)).toEqual([])
        expect(ledger(worker).filter((one) => one.type === 'work_replied')).toEqual([])
        expect(taskOf(worker, task)?.state).not.toBe('answered')
        expect(taskOf(worker, task)?.resultDocument).toBeUndefined()
        const skipped = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'Still delivered.',
          resource_paths: [path],
          ...(kind === 'explicit' ? { result_document: path } : {}),
        })
        expect(skipped.outcome).toBe('ok')
        expect(skipped.resources).toEqual([])
        expect(skipped).not.toHaveProperty('result_document')
        expect(store.resourcesOf(task)).toEqual([])
        expect(ledger(worker).filter((one) => one.type === 'work_replied')).toEqual([])
      },
    )

    it('binds designation refusals to the final prose and one app-only receipt before IO or copies', async () => {
      const { worker, task } = await workWasGiven()
      const image = wrote('image.png', Buffer.from([1, 2, 3]))
      const alias = join(root, 'caller-picture-alias.md')
      symlinkSync(image, alias)
      const absent = join(root, 'fictional-unreadable', 'caller-secret.md')
      const pdf = wrote('caller-main.pdf', Buffer.from('%PDF-fictional'))
      const reason =
        'The main result document must be a Markdown file or page listed in resource_paths. Nothing was recorded.'
      const tool = toolsOf(worker).tools.find((one) => one.name === 'reply_to_parent')!
      for (const args of [
        { resource_paths: [join(root, 'also-unreadable.md')], result_document: absent },
        {
          resource_paths: [join(root, 'fictional-unreadable', 'sibling.md')],
          result_document: absent,
        },
        { resource_paths: [wrote('valid.md', '# Valid'), alias], result_document: alias },
        { resource_paths: [pdf], result_document: pdf },
      ]) {
        const before = ledger(worker).filter((one) => one.type === 'tool_refused').length
        const hashes = keptHashes()
        const answered = await tool.call({
          piece: task,
          outcome: 'done',
          summary: 'Delivered.',
          ...args,
        })
        expect(answered.structured).toEqual({
          outcome: 'refused',
          rail: 'result-document-not-returned',
          reason,
          detail: {
            path: args.result_document,
            resultDocumentProblem: args.result_document === absent ? 'not-listed' : 'not-document',
          },
          permanence: 'permanent',
          retryable: false,
          remedy: null,
        })
        const cause = args.result_document === absent ? 'not listed' : 'not Markdown or a page'
        expect(answered.text).toBe(
          `refused (result-document-not-returned): ${reason} ${args.result_document} is ${cause}.`,
        )
        expect(answered.text.match(/Nothing was recorded\./g)).toHaveLength(1)
        expect(answered.text).not.toContain('This exact call can never succeed.')
        const told = reason
        const carriers = ledger(worker)
          .filter((one) => one.type === 'tool_refused')
          .slice(before)
        expect(carriers).toEqual([
          {
            type: 'tool_refused',
            tool: 'reply_to_parent',
            rail: 'result-document-not-returned',
            permanence: 'permanent',
            retryable: false,
            remedy: null,
            told: { text: told, dropped: 0 },
          },
        ])
        expect(
          answered.text.slice('refused (result-document-not-returned): '.length).startsWith(told),
        ).toBe(true)
        expect(JSON.stringify(carriers)).not.toContain(args.result_document)
        expect(store.resourcesOf(task)).toEqual([])
        expect(keptHashes()).toEqual(hashes)
        expect(ledger(worker).filter((one) => one.type === 'work_replied')).toEqual([])
        expect(taskOf(worker, task)?.state).not.toBe('answered')
      }
      const text = wrote('valid-result.md', '# Resolved text')
      const textAlias = join(root, 'caller-text-alias.png')
      symlinkSync(text, textAlias)
      const answered = await tool.call({
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: [textAlias],
        result_document: textAlias,
      })
      expect(answered.structured).toMatchObject({ outcome: 'ok' })
      const resources = answered.structured!['resources'] as string[]
      expect(resources).toHaveLength(1)
      expect(answered.structured!['result_document']).toBe(resources[0])
      expect(store.resourcesOf(task)).toMatchObject([
        { resource: resources[0], name: 'valid-result.md' },
      ])
      expect(taskOf(worker, task)?.resultDocument).toBe(resources[0])
      expect(keptHashes()).toEqual([shaOf(Buffer.from('# Resolved text'))])
    })

    it('refuses an unreturned or non-document designation before copying files or closing the piece', async () => {
      const { worker, task } = await workWasGiven()
      const path = wrote('result.md', '# Result')
      const image = wrote('image.png', Buffer.from([1, 2, 3]))
      for (const args of [
        { resource_paths: [path], result_document: wrote('outside.md', '# Unreturned') },
        { resource_paths: [path, image], result_document: image },
      ]) {
        const before = store.resourcesOf(task)
        const hashes = keptHashes()
        const refusalCount = ledger(worker).filter((one) => one.type === 'tool_refused').length
        const refused = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'Delivered.',
          ...args,
        })
        expect(refused).toMatchObject({
          outcome: 'refused',
          rail: 'result-document-not-returned',
          permanence: 'permanent',
          retryable: false,
          reason:
            'The main result document must be a Markdown file or page listed in resource_paths. Nothing was recorded.',
        })
        expect(store.resourcesOf(task)).toEqual(before)
        expect(keptHashes()).toEqual(hashes)
        expect(ledger(worker).filter((one) => one.type === 'work_replied')).toHaveLength(0)
        expect(ledger(worker).filter((one) => one.type === 'tool_refused')).toHaveLength(
          refusalCount + 1,
        )
        expect(taskOf(worker, task)?.state).not.toBe('answered')
        expect(
          JSON.stringify(ledger(worker).filter((one) => one.type === 'tool_refused')),
        ).not.toContain(args.result_document)
      }
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: [path],
      })
      expect(landed.outcome).toBe('ok')
      expect(taskOf(worker, task)?.resultDocument).toBe((landed.resources as string[])[0])
    })

    it('keeps working copies distinct from returned copies and names a sole result document', async () => {
      const { worker, pmTools, task } = await workWasGiven()
      const path = wrote('report.md', '# Result\n')
      const input = await callOn(pmTools, 'update_work', { piece: task, resources: [path] })
      const working = await callOn(toolsOf(worker), 'update_work', {
        piece: task,
        resources: [path],
      })
      expect(input.outcome).toBe('ok')
      expect(working.outcome).toBe('ok')
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: [path, wrote('picture.png', Buffer.from([1, 2, 3]))],
      })
      expect(landed.outcome).toBe('ok')
      const changes = db.prepare('SELECT total_changes() AS count').get()
      const files = host.filesKept({ scope: 'piece', piece: task })
      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
      expect(files.ok).toBe(true)
      if (!files.ok) throw new Error('files were not read')
      expect(
        files.files.map((file) => [file.name, file.group, file.mainResult ?? false]).sort(),
      ).toEqual(
        [
          ['report.md', 'brief', false],
          ['report.md', 'working', false],
          ['report.md', 'result', true],
          ['picture.png', 'attachments', false],
        ].sort(),
      )
      expect(
        new Set(files.files.filter((file) => file.name === 'report.md').map((file) => file.sha256))
          .size,
      ).toBe(1)
      expect(new Set(files.files.map((file) => file.resourceId)).size).toBe(4)
      expect(taskOf(worker, task)?.resources).toEqual(landed.resources)
      const reopenedHost = buildHost()
      const reread = reopenedHost.filesKept({ scope: 'piece', piece: task })
      expect(reread).toEqual(files)
    })

    it('does not invent a main document among several returned text documents or an image-only reply', async () => {
      for (const paths of [
        [wrote('one.md', '# One'), wrote('two.html', '<title>Two</title>')],
        [wrote('only.pdf', Buffer.from('%PDF-fictional'))],
      ]) {
        const { worker, task } = await workWasGiven()
        const landed = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'Delivered.',
          resource_paths: paths,
        })
        expect(landed.outcome).toBe('ok')
        const files = host.filesKept({ scope: 'piece', piece: task })
        expect(files.ok).toBe(true)
        if (!files.ok) throw new Error('files were not read')
        expect(files.files).toHaveLength(paths.length)
        expect(files.files.every((file) => file.mainResult === undefined)).toBe(true)
        expect(files.files.map((file) => file.group)).toEqual(
          paths.length === 2 ? ['result', 'result'] : ['attachments'],
        )
      }
    })

    it('keeps unread reply membership unknown rather than claiming a returned file is working', async () => {
      const { worker, task } = await workWasGiven()
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'Delivered.',
        resource_paths: [wrote('one.md', '# One')],
      })
      expect(landed.outcome).toBe('ok')
      db.prepare(
        "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'work_replied'",
      ).run('{broken', worker)
      const files = host.filesKept({ scope: 'piece', piece: task })
      expect(files.ok).toBe(true)
      if (!files.ok) throw new Error('files were not read')
      expect(files.files).toHaveLength(1)
      expect(files.files[0]?.group).toBeUndefined()
      expect(files.files[0]?.mainResult).toBeUndefined()
      expect(files.files[0]?.resourceId).toBe((landed.resources as string[])[0])
    })
  })

  describe('work search reads current small facts without changing the ledger', () => {
    it('matches title and result, never brief or status, and uses the recorded profile across conversations', async () => {
      const { worker, task, pmTools } = await workWasGiven('searchable title')
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'searchable result',
        resource_paths: [wrote('result.md', '# Body-only canary')],
      })
      expect(landed.outcome).toBe('ok')
      const otherConversation = await personOpens('worker-1')
      await host.send(otherConversation, 'Please take on this separate search example.', window)
      const taken = await callOn(toolsOf(otherConversation), 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'searchable second',
        brief: 'brief-only-canary',
      })
      expect(taken.outcome).toBe('ok')
      const unrelated = await workWasGiven('unrelated')
      await callOn(unrelated.pmTools, 'update_work', {
        piece: unrelated.task,
        brief: 'searchable',
        status: 'status-only-canary',
      })
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'))
      const read = (caller: string, scope: 'mine' | 'this-conversation' | 'all', words: string) => {
        const answer = engine.read(caller, { scope, words })
        expect(answer.ok, JSON.stringify(answer)).toBe(true)
        if (!answer.ok) throw new Error('no search page')
        return answer.page
      }
      try {
        const mine = read(worker, 'mine', 'SEARCHABLE')
        expect(mine.rows_unread).toBe(0)
        expect(mine.ledgers_skipped).toBe(0)
        expect(mine.hits.map((hit) => hit.piece)).toEqual(
          expect.arrayContaining([task, taken.piece]),
        )
        expect(mine.hits.some((hit) => hit.piece === unrelated.task)).toBe(false)
        expect(
          read(worker, 'this-conversation', 'searchable').hits.map((hit) => hit.piece),
        ).toEqual([task])
        expect(read(worker, 'all', 'brief-only-canary').hits).toEqual([])
        expect(read(worker, 'all', 'status-only-canary').hits).toEqual([])
        expect(read(worker, 'all', 'Body-only').hits).toEqual([])
        const replyHit = read(worker, 'all', 'title result').hits.find((hit) => hit.piece === task)
        expect(replyHit).toMatchObject({
          state: 'answered',
          result: { outcome: 'done', summary: 'searchable result' },
          resource_ids: { result: landed.resources },
        })
        const rename = await callOn(pmTools, 'update_work', { piece: task, title: 'changed title' })
        expect(rename.outcome).toBe('ok')
        expect(read(worker, 'all', 'changed result').hits.some((hit) => hit.piece === task)).toBe(
          true,
        )
      } finally {
        engine.close()
      }
    })

    it('carries complete and partial reader facts once through the final search tool', async () => {
      const { worker } = await workWasGiven()
      for (const partial of [false, true]) {
        const page: WorkSearchPage = {
          hits: [
            {
              kind: 'piece',
              piece: 'work_fictional',
              label: 'W9.1',
              title: 'Matched',
              state: 'answered',
              owner: { conversation: worker, name: 'Lena', profile: 'worker-1' },
              giver: null,
              result: { outcome: 'done', summary: 'Result sentence' },
              status: 'Status sentence',
              resource_ids: {
                brief: ['res_brief'],
                result: ['res_result'],
                attachments: ['res_attachment'],
                working: ['res_working'],
              },
              clipped: { title: true, result: true, status: true },
              resources_omitted: 2,
            },
          ],
          searched: 17,
          rows_unread: partial ? 2 : 0,
          ledgers_skipped: partial ? 1 : 0,
          complete: !partial,
          next_cursor: partial ? 'opaque-next' : null,
        }
        const reader: WorkSearchReader = {
          read: vi.fn().mockResolvedValue({ ok: true, page }),
          close: async () => undefined,
        }
        const withSearch = buildHost(reader)
        const before = db.prepare('SELECT total_changes() AS count').get()
        const tool = agentToolsFor(withSearch, worker).tools.find(
          (one) => one.name === 'search_work',
        )!
        const answer = await tool.call({ scope: 'all', words: 'PRIVATE_QUERY_CANARY', limit: 1 })
        expect(reader.read).toHaveBeenCalledExactlyOnceWith(worker, {
          scope: 'all',
          words: 'PRIVATE_QUERY_CANARY',
          limit: 1,
        })
        expect(answer.structured).toEqual({ outcome: 'ok', ...page })
        const hit =
          'W9.1 · Matched (clipped) · answered · Lena\nStatus: Status sentence (clipped)\nResult: done · Result sentence (clipped)\nBrief: res_brief\nResult: res_result\nAttachments: res_attachment\nWorking files: res_working\n2 more file references omitted.'
        const facts = `Searched: 17; rows_unread: ${partial ? 2 : 0}; ledgers_skipped: ${partial ? 1 : 0}; complete: ${!partial}.`
        const paragraphs = partial
          ? [
              hit,
              facts,
              'Some work could not be read.',
              'Older work has not been searched yet. next_cursor: opaque-next',
              'Results may change when work is edited.',
            ]
          : [hit, facts, 'Results may change when work is edited.']
        const reply = navigationReply(answer.text)
        expect(reply.prose).toBe(paragraphs.join('\n\n'))
        const identity = store.agentIdentities().find((one) => one.slug === 'worker-1')
        if (identity === undefined) throw new Error('fictional worker identity missing')
        expect(reply.links).toEqual([
          pieceLink('work_fictional', 'W9.1', 'Matched'),
          conversationLink(worker, 'Ada (the owner of W2.1 · the work)'),
          agentLink(identity.id, 'Ada'),
        ])
        expect(answer.text).not.toContain('PRIVATE_QUERY_CANARY')
        expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
      }
    })

    it('omits two owners sharing a torn child ledger in either candidate order', async () => {
      const first = await workWasGiven('shared dependency first')
      const second = await workWasGiven('shared dependency second')
      await bringIdentityIntoBeing('shared-child')
      const a = await callOn(toolsOf(first.worker), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'shared-child',
        title: 'child A',
        brief: 'child A',
        piece: first.task,
      })
      const b = await callOn(toolsOf(second.worker), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'shared-child',
        title: 'child B',
        brief: 'child B',
        piece: second.task,
      })
      expect(a.outcome).toBe('ok')
      expect(b.outcome).toBe('ok')
      db.prepare('UPDATE work SET owner_session_id = ? WHERE id = ?').run(a.agent, b.piece)
      const event = db
        .prepare("SELECT id, payload FROM events WHERE session_id = ? AND type = 'work_given'")
        .get(a.agent) as { id: string; payload: string }
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'), () => 1)
      try {
        for (const reversed of [false, true]) {
          db.prepare('UPDATE work SET created_at = ? WHERE id = ?').run(
            reversed ? 10 : 20,
            first.task,
          )
          db.prepare('UPDATE work SET created_at = ? WHERE id = ?').run(
            reversed ? 20 : 10,
            second.task,
          )
          db.prepare('UPDATE work SET owner_session_id = ? WHERE id = ?').run(a.agent, b.piece)
          db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('{torn', event.id)
          const before = db.prepare('SELECT total_changes() AS count').get()
          const bad = engine.read(first.worker, { scope: 'all', words: 'shared dependency' })
          expect(bad.ok).toBe(true)
          if (!bad.ok) throw new Error('no partial page')
          expect(bad.page.hits).toEqual([])
          expect(bad.page.rows_unread).toBeGreaterThan(0)
          expect(bad.page.complete).toBe(false)
          expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
          db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(event.payload, event.id)
          db.prepare('UPDATE work SET owner_session_id = ? WHERE id = ?').run(b.agent, b.piece)
          const good = engine.read(first.worker, { scope: 'all', words: 'shared dependency' })
          expect(good.ok).toBe(true)
          if (!good.ok) throw new Error('no complete page')
          expect(good.page.hits.map((hit) => hit.piece).sort()).toEqual(
            [first.task, second.task].sort(),
          )
          expect(good.page.rows_unread + good.page.ledgers_skipped).toBe(0)
          expect(good.page.complete).toBe(true)
        }
      } finally {
        engine.close()
      }
    })

    it('keeps an overflowed engine candidate behind its cursor and returns it on the next page', async () => {
      const pending = await workWasGiven('budget continuation pending')
      const first = await workWasGiven('budget continuation first')
      for (const one of [pending, first])
        expect(
          (
            await reply(one.worker, {
              piece: one.task,
              outcome: 'done',
              summary: 'budget continuation result',
            })
          ).outcome,
        ).toBe('ok')
      const original = WorkSearchPageBudget.prototype.database
      let consumed = false
      let sawBudgetOverflow = false
      const hook = vi
        .spyOn(WorkSearchPageBudget.prototype, 'database')
        .mockImplementation(function (this: WorkSearchPageBudget, source) {
          const bounded = original.call(this, source)
          return new Proxy(bounded, {
            get: (target, key) => {
              if (key === 'prepare')
                return (sql: string) => {
                  const statement = target.prepare(sql)
                  return new Proxy(statement, {
                    get: (prepared, method) => {
                      const value = Reflect.get(prepared, method, prepared) as unknown
                      if (typeof value !== 'function') return value
                      return (...args: unknown[]) => {
                        if (
                          !consumed &&
                          ['get', 'all', 'iterate'].includes(String(method)) &&
                          args.includes(pending.worker)
                        ) {
                          consumed = true
                          while (this.returnedRows < 50000) {
                            const ledger = workSearchMaterialization(this)
                            const room = Math.min(10000, 50000 - this.returnedRows)
                            expect(
                              ledger
                                .database(db)
                                .prepare(
                                  'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < ?) SELECT x FROM n',
                                )
                                .all(room),
                            ).toHaveLength(room)
                          }
                          expect(this.returnedRows).toBe(50000)
                        }
                        try {
                          return Reflect.apply(value, prepared, args)
                        } catch (error) {
                          sawBudgetOverflow ||= this.overflowed
                          throw error
                        }
                      }
                    },
                  })
                }
              const value = Reflect.get(target, key, target) as unknown
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        })
      const before = db.prepare('SELECT total_changes() AS count').get()
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'), () => 1)
      try {
        const query = {
          scope: 'all' as const,
          words: 'budget continuation',
          state: 'answered' as const,
        }
        const head = engine.read(first.worker, query)
        expect(head.ok).toBe(true)
        if (!head.ok) throw new Error('no partial head')
        expect(consumed).toBe(true)
        expect(sawBudgetOverflow).toBe(true)
        expect(head.page.hits.map((hit) => hit.piece)).toEqual([first.task])
        expect(head.page.complete).toBe(false)
        expect(head.page.next_cursor).not.toBeNull()
        const cursor = JSON.parse(
          Buffer.from(head.page.next_cursor!, 'base64url').toString('utf8'),
        ) as { after: { id: string } }
        expect(cursor.after.id).not.toBe(pending.task)
        const tail = engine.read(first.worker, { ...query, cursor: head.page.next_cursor! })
        expect(tail.ok).toBe(true)
        if (!tail.ok) throw new Error('no continuation')
        expect(tail.page.hits.map((hit) => hit.piece)).toEqual([pending.task])
        expect(tail.page.rows_unread + tail.page.ledgers_skipped).toBe(0)
        expect(tail.page.complete).toBe(true)
        expect(tail.page.next_cursor).toBeNull()
        expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
      } finally {
        hook.mockRestore()
        engine.close()
      }
    })

    it('stops at 1000 candidates and continues without repeating the first page', async () => {
      const one = await workWasGiven()
      const actual = db.prepare('SELECT parent_id FROM work WHERE id = ?').get(one.task) as {
        parent_id: string
      }
      const insert = db.prepare(
        'INSERT INTO work (id,parent_id,number,owner_session_id,given_by_session_id,title,brief,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      for (let index = 0; index < 1005; index++)
        insert.run(
          `work_candidate_${index}`,
          actual.parent_id,
          index + 100,
          one.worker,
          one.pm,
          'candidate',
          'candidate',
          100 + index,
        )
      const before = db.prepare('SELECT total_changes() AS count').get()
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'), () => 1)
      try {
        const query = { scope: 'this-conversation' as const, words: 'no-match-canary' }
        const first = engine.read(one.worker, query)
        expect(first.ok).toBe(true)
        if (!first.ok) throw new Error('no first page')
        expect(first.page.hits).toEqual([])
        expect(first.page.searched).toBe(1000)
        expect(first.page.next_cursor).not.toBeNull()
        expect(first.page.complete).toBe(false)
        const next = engine.read(one.worker, { ...query, cursor: first.page.next_cursor! })
        expect(next.ok).toBe(true)
        if (!next.ok) throw new Error('no continuation')
        expect(next.page.searched).toBe(6)
        expect(next.page.hits).toEqual([])
        expect(next.page.next_cursor).toBeNull()
        expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
      } finally {
        engine.close()
      }
    })

    it('records one app-only refusal through the final search tool for each failure kind', async () => {
      const { worker } = await workWasGiven()
      const tool = toolsOf(worker).tools.find((one) => one.name === 'search_work')!
      const cases = [
        {
          kind: 'invalid' as const,
          args: { scope: 'caller-private-scope' },
          reason: 'Use a listed scope and state, at most 20 words, and a limit from 1 to 50.',
          permanence: 'permanent',
          clause: 'This exact call can never succeed.',
        },
        {
          kind: 'cursor-invalid' as const,
          args: { scope: 'all', cursor: 'caller-private-cursor' },
          reason: 'That search cursor does not match this query. Start the search again.',
          permanence: 'permanent',
          clause: 'This exact call can never succeed.',
        },
        {
          kind: 'unavailable' as const,
          args: { scope: 'all', words: 'caller-private-text' },
          reason: 'Work search failed to read the work. Try again.',
          permanence: 'while-this-holds',
          clause: 'This refusal holds only while the reason lasts.',
        },
      ]
      for (const one of cases) {
        const boundary = vi
          .spyOn(host, 'searchWork')
          .mockResolvedValue({ ok: false, reason: one.kind })
        const before = ledger(worker).filter((row) => row.type === 'tool_refused').length
        const answered = await tool.call(one.args)
        if (one.kind === 'invalid') expect(boundary).not.toHaveBeenCalled()
        else expect(boundary).toHaveBeenCalledTimes(1)
        boundary.mockRestore()
        const told = `${one.reason} ${one.clause}`
        expect(answered.structured).toEqual({
          outcome: 'refused',
          rail: `work-search-${one.kind}`,
          reason: one.reason,
          detail: {},
          permanence: one.permanence,
          retryable: one.kind === 'unavailable',
          remedy: null,
        })
        expect(answered.text).toBe(`refused (work-search-${one.kind}): ${told}`)
        const carriers = ledger(worker)
          .filter((row) => row.type === 'tool_refused')
          .slice(before)
        expect(carriers).toEqual([
          {
            type: 'tool_refused',
            tool: 'search_work',
            rail: `work-search-${one.kind}`,
            permanence: one.permanence,
            retryable: one.kind === 'unavailable',
            remedy: null,
            told: { text: told, dropped: 0 },
          },
        ])
        expect(JSON.stringify(carriers)).not.toContain('caller-private')
      }
    })

    it('uses the existing document reader for cross-profile hit ids and still refuses missing or changed bytes', async () => {
      const producer = await workWasGiven('searchable resource')
      const landed = await reply(producer.worker, {
        piece: producer.task,
        outcome: 'done',
        summary: 'searchable result',
        resource_paths: [wrote('search-result.md', '# Existing resource reach')],
      })
      expect(landed.outcome).toBe('ok')
      const resource = (landed.resources as string[])[0]!
      const caller = await personOpens('other-reader')
      const before = await callOn(toolsOf(caller), 'read_document', { resource })
      expect(before).toMatchObject({ outcome: 'ok', resource })
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'))
      try {
        const found = engine.read(caller, { scope: 'all', words: 'searchable', state: 'answered' })
        expect(found.ok).toBe(true)
        if (!found.ok) throw new Error('no page')
        expect(
          found.page.hits.find((hit) => hit.piece === producer.task)?.resource_ids.result,
        ).toEqual([resource])
        expect(await callOn(toolsOf(caller), 'read_document', { resource })).toEqual(before)
        expect(
          await callOn(toolsOf(caller), 'read_document', { resource: 'res_fictional_missing' }),
        ).toMatchObject({ outcome: 'refused', rail: 'no-such-resource' })
        const row = store.resource(resource)!
        writeFileSync(join(resourcesRoot(userData), row.sha256, row.name), '# Changed bytes')
        expect(await callOn(toolsOf(caller), 'read_document', { resource })).toMatchObject({
          outcome: 'refused',
          rail: 'resource-bytes-changed',
        })
      } finally {
        engine.close()
      }
    })

    it('pins continuation creation order and rejects a cursor for a different query', async () => {
      const first = await workWasGiven('searchable first')
      const second = await workWasGiven('searchable second')
      for (const one of [first, second])
        expect(
          (
            await reply(one.worker, {
              piece: one.task,
              outcome: 'done',
              summary: 'searchable result',
            })
          ).outcome,
        ).toBe('ok')
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'))
      try {
        const query = {
          scope: 'all' as const,
          state: 'answered' as const,
          words: 'searchable',
          limit: 1,
        }
        const head = engine.read(first.worker, query)
        expect(head.ok).toBe(true)
        if (!head.ok) throw new Error('no head')
        expect(head.page.hits.map((hit) => hit.piece)).toEqual([second.task])
        expect(head.page.next_cursor).not.toBeNull()
        const added = await workWasGiven('searchable newer')
        expect(
          (
            await reply(added.worker, {
              piece: added.task,
              outcome: 'done',
              summary: 'searchable result',
            })
          ).outcome,
        ).toBe('ok')
        const cursor = head.page.next_cursor!
        expect(engine.read(first.worker, { ...query, words: 'changed', cursor })).toEqual({
          ok: false,
          reason: 'cursor-invalid',
        })
        expect(engine.read(second.worker, { ...query, cursor })).toEqual({
          ok: false,
          reason: 'cursor-invalid',
        })
        const tail = engine.read(first.worker, { ...query, cursor })
        expect(tail.ok).toBe(true)
        if (!tail.ok) throw new Error('no tail')
        expect(tail.page.hits.map((hit) => hit.piece)).toEqual([first.task])
        expect(tail.page.hits.some((hit) => hit.kind === 'root')).toBe(false)
        expect(tail.page.hits.some((hit) => hit.piece === added.task)).toBe(false)
      } finally {
        engine.close()
      }
    })

    it('clips returned facts and stops at oversized ledger cells without reading file bytes', async () => {
      const one = await workWasGiven('searchable clipped')
      expect(
        (
          await reply(one.worker, {
            piece: one.task,
            outcome: 'done',
            summary: 'searchable ' + 'x'.repeat(800),
          })
        ).outcome,
      ).toBe('ok')
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'))
      try {
        const first = engine.read(one.worker, {
          scope: 'all',
          state: 'answered',
          words: 'searchable',
        })
        expect(first.ok).toBe(true)
        if (!first.ok) throw new Error('no clipped page')
        expect(first.page.hits).toHaveLength(1)
        expect(first.page.hits[0]?.result?.summary).toHaveLength(320)
        expect(first.page.hits[0]?.clipped.result).toBe(true)
        expect(first.page.rows_unread + first.page.ledgers_skipped).toBe(0)
        const row = db
          .prepare("SELECT payload FROM events WHERE session_id = ? AND type = 'work_replied'")
          .get(one.worker) as { payload: string }
        const large = {
          ...JSON.parse(row.payload),
          summary: 'searchable ' + 'x'.repeat(2 * 1024 * 1024),
        }
        db.prepare(
          "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'work_replied'",
        ).run(JSON.stringify(large), one.worker)
        const bounded = engine.read(one.worker, {
          scope: 'all',
          state: 'answered',
          words: 'searchable',
        })
        expect(bounded.ok).toBe(true)
        if (!bounded.ok) throw new Error('no partial page')
        expect(bounded.page.hits).toEqual([])
        expect(bounded.page.rows_unread + bounded.page.ledgers_skipped).toBeGreaterThan(0)
        expect(bounded.page.complete).toBe(false)
        expect(bounded.page.searched).toBeGreaterThan(0)
      } finally {
        engine.close()
      }
    })

    it('reports a malformed owner ledger as partial and preserves readable work', async () => {
      const good = await workWasGiven('searchable good')
      const bad = await workWasGiven('searchable bad')
      for (const one of [good, bad])
        expect(
          (
            await reply(one.worker, {
              piece: one.task,
              outcome: 'done',
              summary: 'searchable result',
            })
          ).outcome,
        ).toBe('ok')
      db.prepare(
        "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'work_replied'",
      ).run('{broken', bad.worker)
      const before = db.prepare('SELECT total_changes() AS count').get()
      const engine = new WorkSearchEngine(join(userData, 'brobot2.sqlite'))
      try {
        const read = engine.read(good.worker, {
          scope: 'all',
          words: 'searchable',
          state: 'answered',
        })
        expect(read.ok).toBe(true)
        if (!read.ok) throw new Error('no page')
        expect(read.page.hits.map((hit) => hit.piece)).toEqual([good.task])
        expect(read.page.rows_unread + read.page.ledgers_skipped).toBeGreaterThan(0)
        expect(read.page.complete).toBe(false)
        expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
      } finally {
        engine.close()
      }
      expect(workSearchQuery.safeParse({ scope: 'all', words: 'word '.repeat(21) }).success).toBe(
        false,
      )
      expect(workSearchQuery.safeParse({ scope: 'all', limit: 51 }).success).toBe(false)
      expect(clippedWorkText('a'.repeat(319) + '😀' + 'z', 320)).toEqual({
        text: 'a'.repeat(319),
        clipped: true,
      })
    })
  })

  describe('§1 · what a reply keeps', () => {
    it('a reply keeps every file byte for byte, and the row’s hash and size are of exactly those bytes', async () => {
      const { worker, task } = await workWasGiven()
      // The control is a plain LF-only ASCII file, in the same call: a failure on the other three is
      // about THEIR bytes and not about the path.
      const sources = [
        { name: 'plain.md', bytes: Buffer.from('one\ntwo\n', 'utf8') },
        {
          name: 'crlf.md',
          bytes: Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from('Titre\r\n\r\nligne un\r\nligne deux\r\n', 'utf8'),
          ]),
        },
        { name: 'accents.md', bytes: Buffer.from('Résumé — café — 日本語\n', 'utf8') },
        {
          name: 'pixel.png',
          bytes: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x0d, 0x0a,
          ]),
        },
      ]
      // Premise: the fixtures are the kind that tell a byte count from a character count, and one of
      // them is not text at all.
      const accents = sources[2]
      const pixel = sources[3]
      expect(accents?.bytes.length).toBeGreaterThan(
        [...(accents?.bytes.toString('utf8') ?? '')].length,
      )
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(pixel?.bytes)).toThrow()
      const paths = sources.map((one) => wrote(one.name, one.bytes))

      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'the files, untouched',
        resource_paths: paths,
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      const ids = landed.resources as string[]
      expect(ids).toHaveLength(sources.length)

      for (const [index, source] of sources.entries()) {
        const row = store.resource(ids[index] as string)
        expect(row, source.name).not.toBeNull()
        expect(row?.name, source.name).toBe(source.name)
        expect(row?.sha256, source.name).toBe(shaOf(source.bytes))
        // A Buffer length, never a string length: it differs from the character count for the
        // multi-byte file and for the file that is not UTF-8.
        expect(row?.bytes, source.name).toBe(source.bytes.length)
        expect(row?.piece, source.name).toBe(task)
        expect(row?.addedBy, source.name).toBe(worker)
        const kept = readFileSync(join(resourcesRoot(userData), row?.sha256 ?? '', source.name))
        expect(kept.equals(source.bytes), `${source.name} was kept as it was`).toBe(true)
      }
      expect(keptHashes()).toEqual(sources.map((one) => shaOf(one.bytes)).sort())
    })

    it('a resource a reply hands in is made, and one written as an input reads back as an input', async () => {
      const { worker, pmTools, task } = await workWasGiven()
      const replied = Buffer.from('# what I made\n', 'utf8')
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'made a file',
        resource_paths: [wrote('made.md', replied)],
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      const madeId = (landed.resources as string[])[0] as string

      // The row written as an input, through the store's own door, beside the reply's.
      const given = Buffer.from('# what I was given\n', 'utf8')
      const givenHash = shaOf(given)
      expect(
        keepResource(resourcesRoot(userData), {
          bytes: given,
          sha256: givenHash,
          name: 'brief.md',
        }),
      ).toEqual({
        ok: true,
      })
      const inputRow = store.addResource(
        {
          piece: task,
          role: 'input',
          // ⚑ D-026 · every kept file has a title: the one its own bytes give.
          title: 'what I was given',
          summary: null,
          name: 'brief.md',
          sha256: givenHash,
          bytes: given.length,
          addedBy: worker,
        },
        tick(),
      )

      // Both words are choices: 'made' is not the only word the column admits.
      expect(RESOURCE_ROLES).toContain('input')
      expect(RESOURCE_ROLES).toContain('made')

      expect(store.resource(madeId)?.role).toBe('made')
      const readMade = await callOn(pmTools, 'read_document', { resource: madeId })
      expect(readMade.outcome, JSON.stringify(readMade)).toBe('ok')
      expect(readMade.role).toBe('made')
      expect(readMade.sha256).toBe(shaOf(replied))

      // The same reader over the input row: the reply's 'made' is the door's choice, not a constant
      // the reader prints.
      expect(store.resource(inputRow.resource)?.role).toBe('input')
      const readInput = await callOn(pmTools, 'read_document', { resource: inputRow.resource })
      expect(readInput.outcome, JSON.stringify(readInput)).toBe('ok')
      expect(readInput.role).toBe('input')
      expect(readInput.sha256).toBe(givenHash)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a reply may hand in, and what a refusal leaves behind
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what a reply may hand in, and what a refusal leaves behind', () => {
    it('a reply may hand in ten files and not eleven, and the eleventh keeps nothing', async () => {
      // The literal is asserted, so the expectation below cannot move with the constant unseen.
      expect(MAX_RESOURCES_PER_REPLY).toBe(10)
      const { worker, task } = await workWasGiven()
      const paths = Array.from({ length: MAX_RESOURCES_PER_REPLY + 1 }, (_, index) =>
        wrote(`f${String(index + 1).padStart(2, '0')}.md`, `file number ${String(index + 1)}\n`),
      )

      const refused = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'one file too many',
        resource_paths: paths,
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      const said = JSON.stringify(refused.detail)
      expect(said).toContain(`at most ${String(MAX_RESOURCES_PER_REPLY)}`)
      expect(said).toContain(`got ${String(MAX_RESOURCES_PER_REPLY + 1)}`)
      // Nothing was kept, nothing was recorded, and the piece is still open.
      expect(keptHashes()).toEqual([])
      expect(store.resourcesOf(task)).toEqual([])
      expect(taskOf(worker, task)?.state).toBe('working')
      expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)

      // One fact over: the same call with only the first ten paths.
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'ten files',
        resource_paths: paths.slice(0, MAX_RESOURCES_PER_REPLY),
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect((landed.resources as string[]).length).toBe(MAX_RESOURCES_PER_REPLY)
      expect(keptHashes()).toHaveLength(MAX_RESOURCES_PER_REPLY)
      expect(store.resourcesOf(task)).toHaveLength(MAX_RESOURCES_PER_REPLY)
      expect(taskOf(worker, task)?.state).toBe('answered')
    })

    it('a reply refused on its last file keeps nothing of the files before it', async () => {
      const { worker, task } = await workWasGiven()
      const a = wrote('a.md', 'alpha\n')
      const b = wrote('b.md', 'beta\n')
      const c = wrote('c.md', '')
      const call = () =>
        reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'three files, the last one empty',
          resource_paths: [a, b, c],
        })

      const refused = await call()
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('resource-empty')
      // Every file is read before any is kept: neither a's nor b's hash directory exists.
      expect(keptHashes()).toEqual([])
      expect(store.resourcesOf(task)).toEqual([])
      expect(taskOf(worker, task)?.state).toBe('working')
      expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)

      // One fact over: c has content, and the identical call lands.
      writeFileSync(c, 'gamma\n')
      const landed = await call()
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect(landed.resources as string[]).toHaveLength(3)
      expect(keptHashes()).toEqual(
        ['alpha\n', 'beta\n', 'gamma\n'].map((text) => shaOf(Buffer.from(text))).sort(),
      )
      expect(store.resourcesOf(task)).toHaveLength(3)
    })

    it('a file that cannot be kept refuses the reply naming that file, and the same reply lands once the way is clear', async () => {
      const { worker, task } = await workWasGiven()
      const firstBytes = Buffer.from('alpha\n')
      const secondBytes = Buffer.from('beta\n')
      const first = wrote('first.md', firstBytes)
      const second = wrote('second.md', secondBytes)
      // Somebody else already stands on the name the second file would be kept at.
      const planted = join(resourcesRoot(userData), shaOf(secondBytes))
      mkdirSync(planted, { recursive: true })
      writeFileSync(join(planted, 'second.md'), 'somebody else wrote this\n')
      const call = () =>
        reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'two files, one of them blocked',
          resource_paths: [first, second],
        })

      const refused = await call()
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('resource-could-not-be-kept')
      expect(refused.detail).toEqual({ problem: 'something-else-is-at-that-name', path: second })
      expect((refused.detail as { path: string }).path).not.toBe(first)
      // What stood there is untouched, and nothing was recorded. Whether the first file was left
      // kept is not asserted: the module calls that harmless, and it is not a promise.
      expect(readFileSync(join(planted, 'second.md'), 'utf8')).toBe('somebody else wrote this\n')
      expect(store.resourcesOf(task)).toEqual([])
      expect(taskOf(worker, task)?.state).toBe('working')
      expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)

      // One fact over: the way is clear, and the identical call lands. The first file, possibly kept
      // by the failed attempt, is not duplicated: the same bytes at the same name is a success.
      rmSync(planted, { recursive: true, force: true })
      const landed = await call()
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect(landed.resources as string[]).toHaveLength(2)
      expect(keptHashes()).toEqual([shaOf(firstBytes), shaOf(secondBytes)].sort())
      expect(readFileSync(join(resourcesRoot(userData), shaOf(firstBytes), 'first.md'))).toEqual(
        firstBytes,
      )
      expect(readFileSync(join(resourcesRoot(userData), shaOf(secondBytes), 'second.md'))).toEqual(
        secondBytes,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the writer's own guard
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the writer’s own guard', () => {
    it('the writer keeps only a lowercase sha-256 and a one-segment name, and writes nothing for anything else', () => {
      // Through the reply door the hash and the name always come from the app's own hash and a
      // basename, so only a direct call reaches this guard.
      const dir = mkdtempSync(join(tmpdir(), 'brobot2-keeps-writer-'))
      try {
        const kept = join(dir, 'resources')
        const bytes = Buffer.from('the answer\n')
        const good = shaOf(bytes)
        const listing = (): string[] => (existsSync(kept) ? readdirSync(kept) : [])

        // A hash that is not a hash, and one in the wrong case: refused, and no directory was made.
        expect(keepResource(kept, { bytes, sha256: 'not-a-hash', name: 'a.md' })).toEqual({
          ok: false,
          problem: 'write-failed',
        })
        expect(listing()).toEqual([])
        expect(keepResource(kept, { bytes, sha256: good.toUpperCase(), name: 'a.md' })).toEqual({
          ok: false,
          problem: 'write-failed',
        })
        expect(listing()).toEqual([])

        // The positive over the same root and the same bytes: only the spelling differed above.
        expect(keepResource(kept, { bytes, sha256: good, name: 'a.md' })).toEqual({ ok: true })
        expect(readFileSync(join(kept, good, 'a.md'))).toEqual(bytes)
        expect(keepResource(kept, { bytes, sha256: good, name: 'a.md' })).toEqual({ ok: true })
        expect(listing()).toEqual([good])

        // A name that is not one path segment: refused, and nothing escaped the hash directory.
        for (const name of ['../escape.md', '..', '.', '', 'a\0b.md']) {
          expect(keepResource(kept, { bytes, sha256: good, name }), JSON.stringify(name)).toEqual({
            ok: false,
            problem: 'write-failed',
          })
        }
        expect(existsSync(join(dir, 'escape.md'))).toBe(false)
        expect(existsSync(join(kept, 'escape.md'))).toBe(false)
        expect(listing()).toEqual([good])
        expect(readdirSync(join(kept, good))).toEqual(['a.md'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the schema
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the schema refuses what this app never writes', () => {
    it('max_depth admits the whole numbers from 0 to the capability count and refuses the ones either side', async () => {
      await bringIdentityIntoBeing('pm')
      const set = (value: number | null) =>
        db.prepare("UPDATE agent_identity SET max_depth = ? WHERE slug = 'pm'").run(value)
      const raw = (): number | null =>
        (
          db.prepare("SELECT max_depth FROM agent_identity WHERE slug = 'pm'").get() as {
            max_depth: number | null
          }
        ).max_depth

      // Both bounds are inclusive, and the row is known to be writable before any refusal.
      for (const value of [0, MAX_CAPABILITY_COUNT]) {
        expect(() => set(value), String(value)).not.toThrow()
        expect(raw(), String(value)).toBe(value)
      }
      // The bound comes from the shared constant, so the static SQL is tied to the wire's.
      expect(MAX_CAPABILITY_COUNT).toBe(64)
      for (const value of [-1, MAX_CAPABILITY_COUNT + 1]) {
        expect(() => set(value), String(value)).toThrow('agent_identity_max_depth_ck')
        expect(raw(), `${String(value)} moved the row`).toBe(MAX_CAPABILITY_COUNT)
      }
      // NULL follows the ruled default, and is admitted.
      expect(() => set(null)).not.toThrow()
      expect(raw()).toBeNull()
    })

    it('each capability column admits its own words and refuses every other column’s words', async () => {
      await bringIdentityIntoBeing('pm')
      const fields = CAPABILITY_FIELDS.flatMap((field) =>
        'vocabulary' in field && field.vocabulary !== undefined
          ? [{ column: field.column, vocabulary: [...field.vocabulary] as string[] }]
          : [],
      )
      const union = new Set(fields.flatMap((field) => field.vocabulary))
      const write = (column: string, word: string) =>
        db.prepare(`UPDATE agent_identity SET ${column} = ? WHERE slug = 'pm'`).run(word)
      const read = (column: string): string | null =>
        (
          db.prepare(`SELECT ${column} AS held FROM agent_identity WHERE slug = 'pm'`).get() as {
            held: string | null
          }
        ).held

      // Vacuity guards: there are enough columns, and every one has a word that is not its own.
      expect(fields.length).toBeGreaterThanOrEqual(4)
      for (const field of fields) {
        const foreign = [...union].filter((word) => !field.vocabulary.includes(word))
        expect(foreign.length, `${field.column} has no foreign word to be refused`).toBeGreaterThan(
          0,
        )

        // Its own words first, from the descriptor (an independent source from the static SQL).
        for (const word of field.vocabulary) {
          expect(() => write(field.column, word), `${field.column} = ${word}`).not.toThrow()
          expect(read(field.column), `${field.column} = ${word}`).toBe(word)
        }
        // Then every other column's word, and the column keeps what it held.
        const held = read(field.column)
        for (const word of foreign) {
          expect(() => write(field.column, word), `${field.column} = ${word}`).toThrow(
            `agent_identity_${field.column}_ck`,
          )
          expect(read(field.column), `${field.column} moved on ${word}`).toBe(held)
        }
        db.prepare(`UPDATE agent_identity SET ${field.column} = NULL WHERE slug = 'pm'`).run()
        expect(read(field.column)).toBeNull()
      }
    })

    it('events_work_idx lists exactly the seven piece events, and the store’s piece read is served by it', () => {
      const indexSql = (name: string): string | undefined =>
        (
          db
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
            .get(name) as { sql: string } | undefined
        )?.sql
      const ddl = indexSql('events_work_idx')
      expect(ddl).toBeDefined()
      const listed = (ddl?.match(/'work_[a-z_]+'/g) ?? []).map((word) => word.replace(/'/g, ''))

      // Both ways, in the index's own order: none missing, none extra.
      expect(PIECE_EVENT_TYPES).toHaveLength(7)
      expect(listed).toEqual([...PIECE_EVENT_TYPES])
      expect(ddl).toContain('WHERE')

      // The control: an index that must not be narrowed to the piece events is still whole.
      const whole = indexSql('events_session_idx')
      expect(whole).toBeDefined()
      expect(whole).not.toContain('WHERE')

      // The store's minimum-ordinal shape, with the seven words spelled out beside the one asked
      // for: SQLite uses a partial index only for a WHERE that implies the index's own.
      const plan = (words: readonly string[]): string =>
        (
          db
            .prepare(
              `EXPLAIN QUERY PLAN SELECT min(ordinal) FROM events
                WHERE session_id = 's' AND +generation = 0
                  AND type IN (${words.map((word) => `'${word}'`).join(', ')})
                  AND type = 'work_given'`,
            )
            .all() as { detail: string }[]
        )
          .map((row) => row.detail)
          .join('\n')
      expect(plan(PIECE_EVENT_TYPES)).toContain('events_work_idx')
      // One word fewer and the read is no longer served by it: the plan tells the two apart.
      expect(plan(PIECE_EVENT_TYPES.slice(0, -1))).not.toContain('events_work_idx')
    })

    it('the resource table refuses a role, a hash and a size this app never writes', async () => {
      const { worker, task } = await workWasGiven()
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'a file, so a piece has a resource',
        resource_paths: [wrote('one.md', 'one\n')],
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      const workId = (
        db.prepare('SELECT work_id FROM work_resource LIMIT 1').get() as {
          work_id: string
        }
      ).work_id
      const insert = (id: string, role: string, sha: string, bytes: number) =>
        db
          .prepare(
            'INSERT INTO work_resource (id, work_id, role, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id, workId, role, 'x.md', sha, bytes, 1)
      const count = (): number =>
        (db.prepare('SELECT count(*) AS n FROM work_resource').get() as { n: number }).n

      // The positives first: each refusal below is about ONE column's value, the rest of the row valid.
      expect(() => insert('res_ok1', 'input', 'a'.repeat(64), 1)).not.toThrow()
      expect(() => insert('res_ok2', 'made', '0123456789abcdef'.repeat(4), 1)).not.toThrow()
      expect(count()).toBe(3)

      expect(() => insert('res_a1', 'draft', 'a'.repeat(64), 1)).toThrow('work_resource_role_ck')
      // An uppercase hash, a short one, and one with a character outside 0-9a-f.
      expect(() => insert('res_a2', 'made', 'A'.repeat(64), 1)).toThrow('work_resource_sha256_ck')
      expect(() => insert('res_a3', 'made', 'a'.repeat(63), 1)).toThrow('work_resource_sha256_ck')
      expect(() => insert('res_a4', 'made', `${'a'.repeat(63)}g`, 1)).toThrow(
        'work_resource_sha256_ck',
      )
      expect(() => insert('res_a5', 'made', 'a'.repeat(64), 0)).toThrow('work_resource_bytes_ck')
      expect(count()).toBe(3)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · a database the previous build made
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a database the previous build made', () => {
    it('a database the previous build made is refused and left exactly as it was, while a new file migrates', () => {
      const oldPath = join(userData, 'old.sqlite')
      const old = openDatabase(oldPath)
      try {
        // 1790366221584 is the stamp of the last migration the previous build applied.
        old.exec(`
          CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC);
          INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('an-older-build', 1790366221584);
          CREATE TABLE provider_session (id TEXT PRIMARY KEY, note TEXT);
          INSERT INTO provider_session VALUES ('sess_old', 'kept');
          CREATE TABLE events (id TEXT PRIMARY KEY, note TEXT);
          INSERT INTO events VALUES ('evt_old', 'kept');
        `)
        const snapshot = (): unknown[] => [
          old.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all(),
          old.prepare('SELECT * FROM __drizzle_migrations').all(),
          old.prepare('SELECT * FROM provider_session').all(),
          old.prepare('SELECT * FROM events').all(),
        ]
        const before = snapshot()

        // The message is not asserted: the migrator may wrap the database's own.
        expect(() => applyMigrations(old, migrationsFolder)).toThrow()
        expect(snapshot()).toEqual(before)
        // The migration rolled back whole: a table it creates before the clash is not there.
        const names = (
          old.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]
        ).map((row) => row.name)
        expect(names).not.toContain('agent_identity')
        expect(names).not.toContain('work')
        // ⚑ **D-042** · nor the second migration's table: nothing after the clash ran either.
        expect(names).not.toContain('provider_model_setting')
      } finally {
        old.close()
      }

      // One fact over: the same folder and the same call on a brand-new file. Only the history differs.
      const fresh = openDatabase(join(userData, 'new.sqlite'))
      try {
        expect(() => applyMigrations(fresh, migrationsFolder)).not.toThrow()
        const names = (
          fresh.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]
        ).map((row) => row.name)
        for (const table of [
          'work',
          'work_resource',
          'work_sequence',
          'events',
          'agent_identity',
          // ⚑ **D-042** · `0001_the_model_list.sql`'s table — the second migration really ran.
          'provider_model_setting',
          // ⚑ `0003_the_api_keys.sql`'s table — the fourth ran too.
          'provider_api_key',
        ]) {
          expect(names, table).toContain(table)
        }
        // ⚑ **D-042 · two migrations now** — `0000_the_tree` and `0001_the_model_list` — and a
        // brand-new file records both.
        // ⚑ **D-050 · three** — `0002_no_agent_limit` too, and a brand-new file records all three.
        // ⚑ **Four** — `0003_the_api_keys` too.
        // ⚑ **Five** — `0004_no_stream_fragments` too, which removes rows and creates no table.
        // ⚑ **Six** — `0005_the_fold_index` too, which creates an index and no table.
        // ⚑ **Seven** — `0006_the_inventory_index` too, which creates an index and no table.
        // ⚑ **Eight** — `0007_the_mcp_request_index` too, which creates an index and no table.
        // The ninth migration adds only event indexes for work reconciliation.
        // ⚑ **Ten** — `0009_the_fold_index_ends_passed_up_questions` too, which recreates an index
        // and creates no table.
        // The legacy stall cut adds one migration and preserves the same resource schema.
        expect(
          (fresh.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number })
            .n,
        ).toBe(12)
      } finally {
        fresh.close()
      }
    })
  })
})
