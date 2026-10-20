import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { pieceNumbersOf } from '../src/shared/piece-called'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import { code, sourceFiles, spellingsIn } from './lib/task-spellings'

/**
 * # 🔴 705 · R38 — anywhere a person may read it, a task is *Task #N*
 *
 * ⚑ **PM ruling R38** (`697` H-b): *"anywhere a person may read it, a task is Task #N, never a bare
 * #N (model text read through the digest too)."*
 *
 * ⛔ **What `main` still spelled, found by the search in §3** (`lib/task-spellings.ts`' four shapes,
 * pointed for the first time at `main/`, `shared/`, `preload/` and `packages/*\/src`):
 *
 * | where | a person reads it | ⛔ it said | ⚑ it says |
 * |---|---|---|---|
 * | `list_tasks`' lines (`agent-tools.ts` `taskText`) | the tool row; the digest's `tool-answered` line | `  #1 task_… · …` | `  Task #1 task_… · …` |
 * | `reply_to_parent`'s receipt | the tool row; the digest; the outgoing card when no reply row landed | `#1 answered · sent` | `Task #1 answered · sent` |
 * | `withdraw_task`'s receipt | the tool row; the digest | `task 2 is yours again — …` | `Task #2 is yours again — …` |
 * | the raw stream's `task_assigned` (`describe-event.ts`) | the drawer's Events tab | `#3 world-clock · task_1 ← …` | `Task #3 in world-clock · task_1 ← …` |
 *
 * ⚑ And four notices `reply-rails.ts` pushes to a parent, which already SAID *Task #N* but wrote it
 * by hand — asked of `taskCalled` now, so the census below has one spelling to find.
 *
 * ⚑ **D-016 · no project is said beside the number any more**: `707`'s *Task #N in <project>*
 * (`taskCalledFrom`, `taskCalledIn`) went with projects, so every site above asks `taskCalled`
 * alone and the Events tab reads *Task #3 · task_1 ← …*.
 *
 * ⚑ **D-016 · the tree — there is no *Task #N* any more**: work is a tree of pieces, and a piece
 * reads by its LABEL (`W1.2`), which `pieceCalled` makes once and the `work` row keeps. R38's rule
 * stands on the new name — anywhere a person may read it, a piece is its label, and never a bare
 * `#N` — so every section below asks the label where it asked *Task #N*.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const REPO = join(here, '..', '..', '..')

/** ⚑ A tool's answer: the text a model reads first, and the structured half it acts on. */
interface Answer {
  readonly text: string
  readonly structured: Readonly<Record<string, unknown>>
}

/** ⛔ A task number with no *Task* in front of it — `the-two-projects-the-digest-still-reads-partly`'s own. */
const NO_BARE_NUMBER = /(?<!Task )#\d/

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the receipts, from the real tools
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('705 · R38 — the receipts a model and a person both read', () => {
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-705-r38-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-705-r38-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_050_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = new RuntimeHost({
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
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(host)
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  /** ⚑ The WHOLE answer — the text is what a model reads first and what the receipt is cut from. */
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

  /** ⚑ The turn a piece's brief opened (D-016: the brief IS a turn), and it has ended. */
  const theTurnItOpenedEnded = (worker: string, piece: string): boolean => {
    const all = events(worker)
    const at = all.findIndex((event) => event.type === 'user_turn' && event.piece === piece)
    return at >= 0 && all.slice(at).some((event) => event.type === 'turn')
  }

  /**
   * ⚑ **D-016 · a give** — the first starts `worker`'s one conversation with this PM, and a second
   * reaches the same one. Answers the piece it opened, by id and by label.
   */
  const giveWork = async (
    pm: string,
    title: string,
    brief: string,
  ): Promise<{ worker: string; piece: string; label: string }> => {
    const given = await answerOf(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief,
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const worker = given.structured.agent as string
    const piece = given.structured.piece as string
    await waitFor(() => theTurnItOpenedEnded(worker, piece), 'the turn the brief opened to end')
    const row = store.piecesOwnedBy(worker).find((one) => one.piece === piece)
    if (row === undefined || !TASK_IS_OPEN[row.state]) throw new Error('the give opened no piece')
    return { worker, piece, label: row.label }
  }

  /** ⚑ A PM a person opened, with `worker` an agent a person opened once, so it exists. */
  const aPm = async (): Promise<string> => {
    await host.close(await personOpens('worker'), window)
    return personOpens('pm')
  }

  /** ⚑ The three receipts, each from its own real call, in the order a day would produce them. */
  const theThreeReceipts = async (): Promise<{
    workerList: Answer
    pmList: Answer
    replied: Answer
    withdrawn: Answer
    first: { piece: string; label: string }
    second: { piece: string; label: string }
  }> => {
    const pm = await aPm()
    const first = await giveWork(pm, 'Migrate the schema', 'migrate the schema')
    const worker = first.worker
    const workerList = await answerOf(worker, 'list_tasks')
    const pmList = await answerOf(pm, 'list_tasks')
    const replied = await answerOf(worker, 'reply_to_parent', {
      piece: first.label,
      outcome: 'done',
      summary: 'the schema is migrated',
    })
    expect(replied.structured.outcome, JSON.stringify(replied.structured)).toBe('ok')
    const second = await giveWork(pm, 'Backfill the column', 'backfill the column')
    expect(second.worker).toBe(worker)
    const withdrawn = await answerOf(pm, 'withdraw_task', { piece: second.label })
    expect(withdrawn.structured.outcome, JSON.stringify(withdrawn.structured)).toBe('ok')
    return { workerList, pmList, replied, withdrawn, first, second }
  }

  const lineFor = (text: string, label: string): string => {
    const found = text.split('\n').find((line) => line.startsWith(`  ${label} · `))
    if (found === undefined) throw new Error(`no line for ${label} in:\n${text}`)
    return found
  }

  it('🔴 list_tasks names each piece by its label — for the worker that holds it and the PM that gave it', async () => {
    const { workerList, pmList, first } = await theThreeReceipts()
    // ⚑ A given piece's label as `pieceCalled` makes it — asked of the product's own reader, and
    // at least two numbers deep, because a given piece sits under a root.
    expect(pieceNumbersOf(first.label)?.length).toBeGreaterThanOrEqual(2)
    // ⚑ the label, then the title, then the state — and the brief's first line, having no status line
    for (const said of [workerList.text, pmList.text]) {
      expect(lineFor(said, first.label)).toMatch(
        new RegExp(`^  ${first.label} · Migrate the schema · .* · migrate the schema$`),
      )
    }
    for (const said of [workerList.text, pmList.text]) expect(said).not.toMatch(NO_BARE_NUMBER)
    // ⚑ control: the payload carries the label and the id — the spelling is the row's, not the text's
    const held = workerList.structured.you_hold as Record<string, unknown>[]
    expect(held.find((row) => row.piece === first.piece)?.label).toBe(first.label)
  })

  it('🔴 reply_to_parent’s receipt and withdraw_task’s open on the label', async () => {
    const { replied, withdrawn, first, second } = await theThreeReceipts()
    expect(replied.text).toMatch(new RegExp(`^${first.label} answered · `))
    expect(withdrawn.text).toMatch(new RegExp(`^${second.label} is taken back — `))
    for (const said of [replied.text, withdrawn.text]) expect(said).not.toMatch(NO_BARE_NUMBER)
    // ⚑ control: each payload carries the label and the id, for a model to act on
    expect(replied.structured).toMatchObject({ piece: first.piece, label: first.label })
    expect(withdrawn.structured).toMatchObject({ piece: second.piece, label: second.label })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the digest's `tool-answered` line, read back
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **What each provider stores as a result's `summary`, and what it names our tool** — the shapes
   * the digest QUOTES, one per provider (`705` review: one fixture pairing Codex's name with Claude's
   * cut read back neither). ⚠️ Restated from the adapters, which do not export them:
   *
   * - **Claude** (`claude/normalize.ts` `summarizeToolResult`): the first text part, cut at
   *   `TOOL_SUMMARY_MAX` (200) with `…` — newlines KEPT; the tool is `mcp__brobot__<name>`.
   * - **Codex** (`codex/normalize.ts` `dynamicResultSummary`): `oneLine` (whitespace collapsed), then
   *   `boundedSummary` — past 200, `…` and ` (200 of N characters)`; the tool is `brobot__<name>`.
   */
  const PROVIDER_SHAPES = [
    {
      provider: 'claude' as const,
      named: (tool: ToolName): string => `mcp__brobot__${tool}`,
      summary: (text: string): string => (text.length > 200 ? `${text.slice(0, 200)}…` : text),
    },
    {
      provider: 'codex' as const,
      named: (tool: ToolName): string => `brobot__${tool}`,
      summary: (text: string): string => {
        const one = text.replace(/\s+/g, ' ').trim()
        return one.length > 200
          ? `${one.slice(0, 200)}… (200 of ${String(one.length)} characters)`
          : one
      },
    },
  ]

  describe.each(PROVIDER_SHAPES)(
    '§2 · what the digest quotes, on $provider',
    ({ provider, named, summary }) => {
      const TO = 1_800_000_000_000
      const FROM = TO - 12 * 3_600_000
      let digestDir: string
      let digestDb: AppDatabase
      let digestStore: SessionStore
      let ordinal: number

      beforeEach(() => {
        digestDir = mkdtempSync(join(tmpdir(), 'brobot2-705-digest-'))
        digestDb = openDatabase(join(digestDir, 'db.sqlite'))
        applyMigrations(digestDb, migrationsFolder)
        digestStore = createSessionStore(digestDb)
        digestStore.create({
          id: 'sess_worker',
          provider,
          cwd: digestDir,
          approvalMode: 'ask',
          profileId: 'worker',
        })
        ordinal = 0
      })

      afterEach(() => {
        digestDb.close()
        rmSync(digestDir, { recursive: true, force: true })
      })

      /**
       * ⚑ **A call of ours and its result, the result's summary being the receipt as THIS provider cuts
       * it** ({@link PROVIDER_SHAPES}). ⚠️ The receipt is the one §1's real tool returned, never a string
       * written here.
       */
      const answered = (tool: ToolName, receipt: string): string => {
        const id = `call_${String(ordinal)}`
        const at = TO - 3_600_000 + ordinal
        digestStore.append(
          'sess_worker',
          ordinal++,
          {
            type: 'tool_call',
            id,
            name: named(tool),
            summary: '',
          },
          at,
        )
        digestStore.append(
          'sess_worker',
          ordinal++,
          {
            type: 'tool_result',
            id,
            summary: summary(receipt),
            ok: true,
          },
          at + 1,
        )
        const line = distil(digestStore.digestWindow(FROM, TO), (s) => s).lines.find(
          (one) => one.kind === 'tool-answered',
        )
        if (line === undefined) throw new Error('the digest drew no tool-answered line')
        return line.text
      }

      it('🔴 the line quotes each receipt by its label — never a bare #N', async () => {
        const { replied, workerList, withdrawn, first, second } = await theThreeReceipts()
        const afterReply = answered('reply_to_parent', replied.text)
        expect(afterReply).toContain(
          `the most recent was reply_to_parent answered: ${first.label} answered · `,
        )
        expect(afterReply).not.toMatch(NO_BARE_NUMBER)
        const afterList = answered('list_tasks', workerList.text)
        // ⚠️ Claude keeps the newline and the indent; Codex collapses both to one space
        expect(afterList).toMatch(
          new RegExp(
            `list_tasks answered: work you hold:\\s+${first.label.split('.').join('\\.')} · `,
          ),
        )
        expect(afterList).not.toMatch(NO_BARE_NUMBER)
        const afterWithdraw = answered('withdraw_task', withdrawn.text)
        expect(afterWithdraw).toContain(`withdraw_task answered: ${second.label} is taken back`)
        expect(afterWithdraw).not.toMatch(NO_BARE_NUMBER)
      })

      it('⚑ control: the same fold over the receipt `main` wrote is caught by the same check', () => {
        expect(answered('reply_to_parent', '#1 answered · sent')).toMatch(NO_BARE_NUMBER)
      })
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the census — the same reader, pointed at everything main and the packages compose
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · no text main or a package composes writes a task number of its own', () => {
  /**
   * ⚑ **Every directory whose text reaches a model or a person without passing the renderer** —
   * `main/` (tool answers, notices, the digest), `shared/` (all of it, not only what the renderer
   * imports), `preload/`, and each package's `src`, derived from the directory rather than listed.
   * ⛔ Standing rule 27.1: scoped by what it is about, not by where things live today.
   */
  const ROOTS = [
    join(REPO, 'apps/desktop/src/main'),
    join(REPO, 'apps/desktop/src/shared'),
    join(REPO, 'apps/desktop/src/preload'),
    // ⚠️ Only a DIRECTORY with a `src` (`705` review): a stray `.DS_Store` Finder drops in `packages/`
    // would otherwise be walked as a package and throw — the guard `one-sentence-one-place` has.
    ...readdirSync(join(REPO, 'packages'), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(REPO, 'packages', entry.name, 'src')),
      )
      .map((entry) => join(REPO, 'packages', entry.name, 'src')),
  ]

  const walked = (): string[] => ROOTS.flatMap((dir) => sourceFiles(dir))

  it('⚑ the reader finds TWO planted spellings in two files, and a heading in neither (rule 12)', () => {
    const planted = new Map([
      ['a.ts', 'return `#${String(task.number)} answered · ${delivered}`'],
      ['b.ts', 'return `task ${outcome.number} is yours again`'],
    ])
    const found = [...planted].flatMap(([file, source]) =>
      spellingsIn(code(source)).map((line) => `${file} · ${line}`),
    )
    expect(found).toHaveLength(2)
    expect(new Set(found.map((one) => one.split(' · ')[0]))).toEqual(new Set(['a.ts', 'b.ts']))
    expect(spellingsIn("lines.push('# ' + title)")).toEqual([])
    expect(spellingsIn("heading: '## How you work',")).toEqual([])
  })

  // The exact exceptions are Markdown headings, config comments and a CSS colour.
  it('🔴 the population is exactly the seven prints that are not a task', () => {
    const files = walked()
    // ⚑ non-vacuity: the walk reaches every file a receipt or a notice is composed in
    for (const must of [
      'apps/desktop/src/main/runtime/agent-tools.ts',
      'apps/desktop/src/main/runtime/factory-text.ts',
      'apps/desktop/src/main/runtime/reply-rails.ts',
      'apps/desktop/src/main/runtime/digest.ts',
      'packages/runtime/src/codex/codex-transport.ts',
      'packages/shared/src/index.ts',
    ]) {
      expect(files).toContain(join(REPO, must))
    }
    const found = files.flatMap((file) =>
      spellingsIn(code(readFileSync(file, 'utf8'))).map(
        (line) => `${relative(REPO, file).replaceAll('\\', '/')} · ${line}`,
      ),
    )
    expect(found.sort()).toEqual(
      [
        // These plugin sections are Markdown headings, never task-number prints.
        "apps/desktop/src/main/plugins/instructions.ts · : `## ${PLUGINS_HEADING}\\n\\n${pluginInstructionParagraphs(entries).join('\\n\\n')}`",
        'apps/desktop/src/main/runtime/factory-text.ts · heading: `## ${PLUGINS_HEADING}`,',
        // The other dynamic Markdown headings in the instructions a model is given
        'apps/desktop/src/main/runtime/factory-text.ts · heading: `## ${YOUR_OWN_INSTRUCTIONS_HEADING}`,',
        'apps/desktop/src/main/runtime/factory-text.ts · heading: `## ${SAVED_METHODS_HEADING}`,',
        // ⚑ the same saved-methods heading, found in a Codex lead to scrub its index lines
        'apps/desktop/src/main/archive/codex-injected.ts · const SAVED_METHODS_SECTION = `\\n\\n## ${SAVED_METHODS_HEADING}\\n\\n`',
        // ⚑ a TOML comment in a provider's config file
        'packages/runtime/src/codex/memory-config.ts · return `# ${setting.key}: ${setting.why}`',
        // ⚑ a CSS hex colour the theme module writes
        'apps/desktop/src/shared/themes/colour.ts · const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`',
      ].sort(),
    )
  })

  it('⚑ each site that names a piece says its label — in the file that composes it', () => {
    const read = (path: string): string => code(readFileSync(join(REPO, path), 'utf8'))
    const tools = read('apps/desktop/src/main/runtime/agent-tools.ts')
    // ⚑ **D-016 · the tree** — the label is the `work` row's, made once by `pieceCalled`, so each
    // receipt opens on it (a board line asks `pieceLine`, the label and the title).
    expect(tools).toContain('return `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${')
    // ⚑ **D-030 — the receipt says where the reply went** (`whereTheReplyWent`, its giver by name),
    // so the pin is the label and the words it opens on.
    expect(tools).toContain(
      '`${replied.label} answered · ${whereTheReplyWent(replied)}${kept}${main}${saveMethod}`',
    )
    // What it adds is the kept files, by id.
    expect(tools).toContain('` ${keptResources(replied.resources)}`')
    expect(tools).toContain('`${outcome.label} is taken back — ${owner} no longer owes it${')
    const rails = read('apps/desktop/src/main/runtime/reply-rails.ts')
    // ⚑ **707 · R40 — every notice spelled for the giver it is pushed to**: the answer's
    // (`replyText`) and the stall's (`undrivenWorkText`). ⚑ **D-016c** — the correction a reopen
    // sent is gone, and its composer with it; ⚑ **D-030** — so is R48's line, since a reply its
    // giver cannot take now is kept for its next start: two compose a notice.
    // ⚑ **D-016** — each opens on the piece's line, `pieceLine`, its label and its title.
    expect(rails.match(/\bpieceLine\(piece\.label, piece\.title\)/g)).toHaveLength(2)
    expect(read('apps/desktop/src/renderer/src/lib/describe-event.ts')).toContain(
      'return `${event.label} · ${event.piece} · ${event.title} · given by ${event.givenBy} · ${',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the raw stream — the drawer's Events tab, a person's too
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the Events tab', () => {
  // ⚑ **D-016 · the tree** — `task_assigned` is `work_given` now, and the row carries the piece's
  // label where it carried *Task #N*.
  const given = (messageId?: string): TranscriptEvent => ({
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.3',
    parent: 'work_0',
    givenBy: 'sess_ada',
    title: 'The world clock page',
    brief: 'Build the world clock page.',
    ...(messageId === undefined ? {} : { messageId }),
  })

  it('🔴 a give is its label, with the id still beside it — sent or held', () => {
    expect(describeEvent(given())).toBe(
      'W1.3 · work_1 · The world clock page · given by sess_ada · sent (ours)',
    )
    expect(describeEvent(given('msg_1'))).toBe(
      'W1.3 · work_1 · The world clock page · given by sess_ada · held (ours)',
    )
  })

  it('⚑ control: the reply’s row, which names the piece by its id and no label, is unchanged', () => {
    const replied: TranscriptEvent = {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'the page is built',
      resources: [],
    }
    expect(describeEvent(replied)).toBe('work_1 · done · 17 chars (ours)')
  })
})
