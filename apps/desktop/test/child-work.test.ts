import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  childWorkRoot,
  claudeSidecarPath,
  countThinkingBlocks,
  locateChildWork,
  parseClaudeSidecar,
  readChildFile,
  readChildWork,
} from '../src/main/child-work'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 112 · Finding a sub-agent's own work on disk, and everything the door will not open.
 *
 * The fixture matches the provider layout: `subagents/workflows/<runId>/` contains nine
 * `agent-<agentId>.jsonl` files, `.meta.json` sidecars, and `journal.jsonl`; the script is at
 * `workflows/scripts/<name>-<runId>.js`. A `tasks/<uuid>/N.json` fixture would exercise a
 * stale, empty layout.
 *
 * Real files, real symlinks, and a real directory tree — the same reasoning `workflow-output.test`
 * states: this module IS a filesystem boundary, and a mocked `fs` would assert that the mock behaves
 * the way the code expects.
 *
 * Fixtures contain no personal session content. The ids and directory shape are under test;
 * transcript bodies are synthetic.
 */

let home: string
let root: string

/** The ids are the real 17-hex shape, so a validator tuned to something narrower would fail here. */
const RUN = 'wf_7658bea5-b25'
const AGENT = 'a4d82f4376e9dd5c5'
const PLAIN = 'ab1bcb4820e3a1c8f'
const PARENT = {
  provider: 'claude',
  sessionId: 'fd4cb53c-79df-4db2-be37-4c7ce61c0cf8',
  cwd: '/tmp/brobot-workspace',
  rotation: 0,
} as const

const CHILD_LINE = JSON.stringify({
  type: 'assistant',
  isSidechain: true,
  agentId: AGENT,
  timestamp: '2026-08-10T20:43:30.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text: 'the fixture answer' }] },
})

beforeAll(() => {
  // `realpathSync` because macOS resolves `/tmp` to `/private/tmp`, and the door names a file by
  // its REAL path — a test rooted at the unresolved path would compare two spellings of one file.
  // (`726` · R92: it used to compare that real path against a real ROOT as well; there is none now.)
  home = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-112-')))
  root = childWorkRoot(home, PARENT)
  const runDir = join(root, 'subagents', 'workflows', RUN)
  mkdirSync(runDir, { recursive: true })
  mkdirSync(join(root, 'workflows', 'scripts'), { recursive: true })
  writeFileSync(join(runDir, `agent-${AGENT}.jsonl`), `${CHILD_LINE}\n`)
  writeFileSync(
    join(runDir, `agent-${AGENT}.meta.json`),
    // Measured: a workflow child's sidecar carries only these two keys — no `description` and no
    // `toolUseId`, which a plain Task child's does have.
    JSON.stringify({ agentType: 'workflow-subagent', spawnDepth: 1 }),
  )
  writeFileSync(
    join(runDir, 'journal.jsonl'),
    `${JSON.stringify({ type: 'started', key: 'v2:abc', agentId: AGENT })}\n` +
      `${JSON.stringify({ type: 'result', key: 'v2:abc', agentId: AGENT, result: { ok: 1 } })}\n`,
  )
  writeFileSync(join(root, 'workflows', 'scripts', `nested-parent-demo-${RUN}.js`), 'phase("x")\n')
  // The other half of the tree: a plain Task child, which belongs to no run at all.
  mkdirSync(join(root, 'subagents'), { recursive: true })
  writeFileSync(join(root, 'subagents', `agent-${PLAIN}.jsonl`), `${CHILD_LINE}\n`)
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('finding a child in the real layout (112)', () => {
  it('resolves an agent id to its own transcript, and reports the run it was in', () => {
    const read = readChildWork(root, AGENT, 'transcript')
    expect(read).toMatchObject({ name: `agent-${AGENT}.jsonl`, runId: RUN, truncated: false })
    expect(typeof read === 'string' ? '' : read.text).toContain('the fixture answer')
  })

  it("reaches the run's journal and its script THROUGH the agent — there is no run id on the wire", () => {
    // ⚠️ The measurement this whole shape rests on: the persisted `workflow_run` payload has no
    // `runId`. So the run directory is found by looking for an agent's own file inside it, and both
    // of these are addressed by an agent for that reason and no other.
    const journal = readChildWork(root, AGENT, 'journal')
    expect(journal).toMatchObject({ name: 'journal.jsonl', runId: RUN })
    expect(typeof journal === 'string' ? '' : journal.text).toContain('"type":"result"')

    const script = readChildWork(root, AGENT, 'script')
    expect(script).toMatchObject({ name: `nested-parent-demo-${RUN}.js`, runId: RUN })
  })

  it('a plain Task child is found in the flat directory, and honestly belongs to no run', () => {
    // 036 found this half. `runId: null` is not "unknown" — it is the statement that this child was
    // not part of a fan-out, which is why the two below have nothing to open.
    expect(readChildWork(root, PLAIN, 'transcript')).toMatchObject({ runId: null })
    expect(readChildWork(root, PLAIN, 'journal')).toBe('gone')
    expect(readChildWork(root, PLAIN, 'script')).toBe('gone')
  })

  it('locates without reading, so the run id is known before a byte is opened', () => {
    expect(locateChildWork(root, AGENT, 'transcript')).toMatchObject({ runId: RUN })
    expect(locateChildWork(root, 'a0000000000000000', 'transcript')).toBeNull()
  })
})

describe('⛔ what the record does NOT contain (109, measured for 112)', () => {
  /** The real block, verbatim in shape: an empty body and a signature. */
  const assistantWith = (...blocks: unknown[]): string =>
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-08-10T20:43:30.000Z',
      message: { role: 'assistant', content: blocks },
    })

  it('counts thinking blocks off the RECORDS, because the importer drops them', () => {
    const lines = [
      assistantWith(
        { type: 'thinking', thinking: '', signature: 'CAISnDUKhwEIEBgC' },
        { type: 'text', text: 'the answer' },
      ),
      assistantWith({ type: 'thinking', thinking: '', signature: 'CAIS6CoKhwEIEBgC' }),
      assistantWith({ type: 'text', text: 'no thinking here' }),
    ]
    expect(countThinkingBlocks(lines)).toBe(2)
  })

  it('a file with none counts none, so the viewer can stay silent rather than print a zero', () => {
    expect(countThinkingBlocks([assistantWith({ type: 'text', text: 'x' })])).toBe(0)
    expect(countThinkingBlocks([])).toBe(0)
  })

  it('a line that is not JSON is skipped rather than thrown over', () => {
    expect(
      countThinkingBlocks(['{not json', assistantWith({ type: 'thinking', thinking: '' })]),
    ).toBe(1)
  })
})

describe('what it refuses, and why each refusal is its own word (112)', () => {
  it('an agent with no file on disk is `gone` — never a blank pane', () => {
    // The ordinary case: the sweep archived the parent and the provider home was cleaned, or the
    // child was announced before it wrote its first line.
    expect(readChildWork(root, 'a9999999999999999', 'transcript')).toBe('gone')
  })

  it('a whole session directory that is not there is `gone` as well', () => {
    expect(readChildWork(join(home, 'nothing', 'here'), AGENT, 'transcript')).toBe('gone')
  })

  it('⚠️ an agent id that is a path is refused before any directory is looked at', () => {
    // The ledger check upstream is the real gate; this is the second lock, and it is the one that
    // would matter if a future caller reached this module without going through the host.
    for (const bad of ['../../../etc/passwd', 'a4d8/../..', 'agent id', 'a\0b', '.', '..']) {
      expect(locateChildWork(root, bad, 'transcript'), bad).toBeNull()
      expect(readChildWork(root, bad, 'transcript'), bad).toBe('gone')
    }
  })

  it('a symlink INSIDE the tree is followed — 112 asked for that, and the provider writes them', () => {
    const linked = 'a1111111111111111'
    symlinkSync(
      join(root, 'subagents', 'workflows', RUN, `agent-${AGENT}.jsonl`),
      join(root, 'subagents', `agent-${linked}.jsonl`),
    )
    const read = readChildWork(root, linked, 'transcript')
    // Named by where it LANDS, which is the file that was actually read.
    expect(read).toMatchObject({ name: `agent-${AGENT}.jsonl` })
    expect(typeof read === 'string' ? '' : read.text).toContain('the fixture answer')
  })

  it('🔴 726 · R92 — a symlink that LEAVES the session directory is followed and read', () => {
    // ⛔ On `main` this was refused (`not-readable`: the resolved file had to land inside the root).
    const escape = 'a2222222222222222'
    const outside = join(home, 'secret.jsonl')
    writeFileSync(outside, '{"secret":true}\n')
    symlinkSync(outside, join(root, 'subagents', `agent-${escape}.jsonl`))
    // The link is LIVE and its target readable, so what is asserted below is the door following
    // it and not an absence answered for an unrelated reason.
    const link = join(root, 'subagents', `agent-${escape}.jsonl`)
    expect(realpathSync(link)).toBe(outside)
    expect(readFileSync(link, 'utf8')).toContain('secret')

    const read = readChildWork(root, escape, 'transcript')
    // Named by where it LANDS, outside the tree, which is the file that was actually read.
    expect(read).toMatchObject({ name: 'secret.jsonl', truncated: false })
    expect(typeof read === 'string' ? '' : read.text).toContain('"secret":true')
    // ⚑ The control: a link out of the tree whose target is not there is still `gone`.
    const dangling = 'a2222222222222223'
    symlinkSync(
      join(home, 'never-written.jsonl'),
      join(root, 'subagents', `agent-${dangling}.jsonl`),
    )
    expect(readChildWork(root, dangling, 'transcript')).toBe('gone')
  })

  it('a directory wearing the right name is not a transcript', () => {
    const dir = 'a3333333333333333'
    mkdirSync(join(root, 'subagents', `agent-${dir}.jsonl`))
    expect(readChildWork(root, dir, 'transcript')).toBe('not-readable')
  })

  it('a long file is cut OUT LOUD, with its real size', () => {
    const big = 'a4444444444444444'
    writeFileSync(join(root, 'subagents', `agent-${big}.jsonl`), 'x'.repeat(500))
    const read = readChildWork(root, big, 'transcript', 100)
    expect(read).toMatchObject({ truncated: true, bytes: 500 })
    expect(typeof read === 'string' ? '' : read.text).toHaveLength(100)
  })
})

/**
 * 115 · **The read on its own**, because the second door has nothing in front of it.
 *
 * ⚠️ The Claude door composes every path itself, so `locateChildWork` is a guard before the read
 * ever happens. A Codex child's rollout is a path the PROVIDER recorded — `threads.rollout_path`,
 * an absolute path off a database this app does not write — so this read is the only thing between
 * that value and `open(2)`. That makes it worth asserting as itself rather than only through the
 * door that used to be its sole caller.
 *
 * ⚑ **`726` · R92 — it has no root any more.** Until `726` this block was *"the root is the
 * confinement"* (`readWithin`) and pinned that a file outside the home, or a case alias of one, was
 * refused; those two tests went with the root. What it still decides is that the file is there, is
 * a regular file, and fits a ceiling it reports.
 */
describe('the read, wherever the path came from (115)', () => {
  it('a path that is not there at all is `gone`, which is a different sentence', () => {
    expect(readChildFile(join(root, 'subagents', 'agent-nothing.jsonl'), 1024)).toBe('gone')
  })

  it('⚠️ it reports where the read LANDED, so a followed symlink names its target', () => {
    // The Claude door depends on this to title the viewer, and the Codex door depends on it to name
    // the rollout file. A `path` that echoed the argument would make both headers lie about a link.
    const link = join(root, 'subagents', 'agent-a7777777777777777.jsonl')
    symlinkSync(join(root, 'subagents', `agent-${PLAIN}.jsonl`), link)
    const read = readChildFile(link, 1024 * 1024)
    expect(typeof read === 'string' ? '' : read.path).toBe(
      join(root, 'subagents', `agent-${PLAIN}.jsonl`),
    )
  })
})

/**
 * 117 · The sidecar parser, asserted as itself now that the read is somebody else's job.
 *
 * ⚠️ **`036` shipped this as `readClaudeSidecar(path)` — parse AND read, and the read was
 * `readFileSync` with no realpath, no root, no `O_NOFOLLOW` and no ceiling.** `115` needed the
 * contents from a confined read and split the parsing out rather than call it, which left the
 * unhardened one in the tree with no callers and no tests. `117` deleted it. What survives is this
 * function, which cannot open anything — and the asymmetry it exists for was only ever recorded in
 * prose, so it is pinned here.
 */
describe('what a sidecar says, and the two shapes it comes in (115, pinned in 117)', () => {
  it('names the sidecar beside the transcript, same stem', () => {
    expect(claudeSidecarPath('/p/subagents/agent-a4d82f4376e9dd5c5.jsonl')).toBe(
      '/p/subagents/agent-a4d82f4376e9dd5c5.meta.json',
    )
  })

  it('⛔ refuses to build a stem out of a path that is not a transcript (117 review)', () => {
    // The door hands this the RESOLVED path and follows symlinks, so the landing can be any file
    // (`726` · R92: anywhere, not only inside the root). Chopping six characters blindly turns
    // `notes.txt` into the stem `n`, and any `n.meta.json` in the same directory would then title a
    // card about a different file.
    expect(claudeSidecarPath('/p/subagents/notes.txt')).toBeNull()
    expect(claudeSidecarPath('/p/subagents/agent-a4d82f4376e9dd5c5')).toBeNull()
    expect(claudeSidecarPath('/p/subagents/.jsonl')).toBe('/p/subagents/.meta.json')
  })

  it('⚑ a plain `Task` child carries a description and a tool-use id, and both are taken', () => {
    expect(
      parseClaudeSidecar(
        '{"agentType":"Explore","description":"Summarize workspace contents",' +
          '"toolUseId":"toolu_01Fes","spawnDepth":1}',
      ),
    ).toEqual({
      title: 'Summarize workspace contents',
      parentToolCallId: 'toolu_01Fes',
    })
  })

  it("⛔ a WORKFLOW child's carries neither, and neither is invented", () => {
    // The measured workflow shape. A parser that assumed the shape above would either crash or
    // describe this child with the other kind's words; the door renders the absence instead.
    // ⚠️ `agentType` is present in these bytes and deliberately NOT returned — no surface can show
    // it (117 review), and the card already has the kind from the parent's own stream.
    expect(parseClaudeSidecar('{"agentType":"workflow-subagent","spawnDepth":1}')).toEqual({})
  })

  it('an empty string is not a value — a blank description does not become a title', () => {
    expect(parseClaudeSidecar('{"description":"","toolUseId":""}')).toEqual({})
  })

  it('a real sidecar still yields its two usable fields, so the negatives above mean something', () => {
    // The paired positive for every `toEqual({})` in this block.
    expect(parseClaudeSidecar('{"description":"d","toolUseId":"t"}')).toEqual({
      title: 'd',
      parentToolCallId: 't',
    })
  })

  it('anything that is not an object of strings contributes nothing rather than throwing', () => {
    // The bytes come from a file this app did not write, through a symlink it followed. Every one
    // of these is a real thing that can be on the other end, and none of them may reach a card.
    expect(parseClaudeSidecar('')).toEqual({})
    expect(parseClaudeSidecar('not json at all')).toEqual({})
    expect(parseClaudeSidecar('null')).toEqual({})
    expect(parseClaudeSidecar('"a string"')).toEqual({})
    expect(parseClaudeSidecar('[{"description":"from an array"}]')).toEqual({})
    expect(parseClaudeSidecar('{"description":{"nested":"object"},"toolUseId":42}')).toEqual({})
  })
})

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * ⚠️ **The ledger is the allowlist, and this is where that is asserted** (112).
 *
 * The door above will happily read any well-named file it is pointed at (`726` · R92: wherever the
 * name leads). What stops a renderer naming an arbitrary agent is that the host asks THIS first, and
 * it answers out of the `workflow_run` events this app persisted — the same boundary
 * `workflowOutputPath` is.
 */
describe('which agents this session is allowed to open (112)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  const SESSION = 'sess_112'

  /** A `workflow_run` in the shape the ledger really holds — measured, and with no `runId` on it. */
  const run = (agents: string[]): TranscriptEvent =>
    ({
      type: 'workflow_run',
      taskId: 'waw6gpzzj',
      toolUseId: 'toolu_wf',
      name: 'nested-parent-demo',
      phases: [{ index: 1, title: 'Fixtures' }],
      agents: agents.map((agentId, index) => ({
        agentId,
        label: `fixture:${index}`,
        phaseIndex: 1,
        state: 'done' as const,
      })),
      source: 'task_progress',
    }) as TranscriptEvent

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-112-db-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    store.create({
      id: SESSION,
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('an agent the run reported resolves to the run that reported it', () => {
    store.append(SESSION, 0, run([AGENT, PLAIN]), 1)
    expect(store.workflowAgentTask(SESSION, AGENT)).toBe('waw6gpzzj')
    expect(store.workflowAgentTask(SESSION, PLAIN)).toBe('waw6gpzzj')
  })

  it('an agent nobody reported is null — and so is the empty string', () => {
    store.append(SESSION, 0, run([AGENT]), 1)
    expect(store.workflowAgentTask(SESSION, 'a9999999999999999')).toBeNull()
    expect(store.workflowAgentTask(SESSION, '')).toBeNull()
  })

  it("⚠️ another session's agent is not this session's to open", () => {
    // The confinement that matters: two conversations in one database, and the door is per-session.
    store.append(SESSION, 0, run([AGENT]), 1)
    store.create({
      id: 'sess_other',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    expect(store.workflowAgentTask('sess_other', AGENT)).toBeNull()
    // …and the paired positive: the other session is real and can be asked about its own.
    store.append('sess_other', 0, run(['a5555555555555555']), 1)
    expect(store.workflowAgentTask('sess_other', 'a5555555555555555')).toBe('waw6gpzzj')
  })

  it('an event with no agents at all does not break the lookup', () => {
    // Measured: the LAST `workflow_run` of every run carries `outputFile` and no `agents` array.
    // `json_each` over a missing path yields no rows rather than throwing, and this pins that.
    store.append(SESSION, 0, run([AGENT]), 1)
    store.append(
      SESSION,
      1,
      { type: 'workflow_run', taskId: 'waw6gpzzj', outputFile: '/tmp/x.output' } as TranscriptEvent,
      2,
    )
    expect(store.workflowAgentTask(SESSION, AGENT)).toBe('waw6gpzzj')
  })

  it('a non-workflow event holding an `agents` field is not a way in', () => {
    // ⚠️ **This was 112's, and it was vacuous in exactly the way 115's first attempt was** — found
    // by review while it was checking the new one. `$.agents` sat under `raw`, so `json_each` over
    // `$.agents` yielded no rows whether or not `type = 'workflow_run'` was in the WHERE, and
    // dropping the narrowing from `selectWorkflowAgentTask` stayed green. The first row below now
    // carries the array where the query really looks.
    store.append(
      SESSION,
      0,
      { type: 'unknown', agents: [{ agentId: AGENT }], raw: {} } as unknown as TranscriptEvent,
      1,
    )
    store.append(
      SESSION,
      1,
      { type: 'unknown', raw: { agents: [{ agentId: AGENT }] } } as TranscriptEvent,
      2,
    )
    expect(store.workflowAgentTask(SESSION, AGENT)).toBeNull()
    // …and the paired positive, so the negatives are not about an empty ledger.
    store.append(SESSION, 2, run([AGENT]), 3)
    expect(store.workflowAgentTask(SESSION, AGENT)).toBe('waw6gpzzj')
  })

  /**
   * 115 · **The other allowlist**, for the children that are in no run.
   *
   * Plain `Task` children and Codex child threads have only a `sub_agent` announcement, not a
   * `workflow_run` roster entry. `workflowAgentTask` returns `null` for both, so access to
   * those children must not depend on workflow membership.
   */
  const dispatched = (agentId: string, phase = 'started'): TranscriptEvent =>
    ({ type: 'sub_agent', agentId, phase, kind: 'Explore' }) as TranscriptEvent

  it('a sub-agent this session announced is one it may open', () => {
    store.append(SESSION, 0, dispatched(PLAIN), 1)
    expect(store.reportedSubAgent(SESSION, PLAIN)).toBe(true)
    // …and it is announced three times over its life, which must not change the answer.
    store.append(SESSION, 1, dispatched(PLAIN, 'progress'), 2)
    store.append(SESSION, 2, dispatched(PLAIN, 'ended'), 3)
    expect(store.reportedSubAgent(SESSION, PLAIN)).toBe(true)
  })

  it('⛔ an agent nobody announced is refused — and so is the empty string', () => {
    store.append(SESSION, 0, dispatched(PLAIN), 1)
    expect(store.reportedSubAgent(SESSION, 'a9999999999999999')).toBe(false)
    // ⚠️ **The empty-string case needs a row that really carries one, or it asserts nothing**
    // (review). With only `PLAIN` in the ledger, `$.agentId = ''` matches nothing whether the
    // guard exists or not — so deleting the guard survived. A provider that announced a nameless
    // sub-agent is the one case it is for.
    store.append(SESSION, 1, dispatched(''), 2)
    expect(store.reportedSubAgent(SESSION, '')).toBe(false)
    // …and the paired positive: that row IS in the ledger and is found by every other means.
    expect(store.events(SESSION).filter((e) => e.event.type === 'sub_agent')).toHaveLength(2)
  })

  it("⚠️ another session's sub-agent is not this session's to open", () => {
    store.append(SESSION, 0, dispatched(PLAIN), 1)
    store.create({
      id: 'sess_other',
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    expect(store.reportedSubAgent('sess_other', PLAIN)).toBe(false)
    // …and the paired positive: that session is real and can be asked about its own child thread.
    const THREAD = '019fdc5f-4aa4-7af0-9ce0-00a9f1541da1'
    store.append('sess_other', 0, dispatched(THREAD), 1)
    expect(store.reportedSubAgent('sess_other', THREAD)).toBe(true)
    expect(store.reportedSubAgent(SESSION, THREAD)).toBe(false)
  })

  it('⛔ a non-sub-agent event carrying an `agentId` is not a way in', () => {
    // The same hole the workflow lookup closes with `type = 'workflow_run'`.
    //
    // ⚠️ **The first version of this test was VACUOUS and mutation J proved it.** It appended
    // `{type:'unknown', raw:{agentId}}`, whose id sits one level down — so `$.agentId` was null
    // whether the query narrowed by type or not, and dropping `type = 'sub_agent'` from the SQL
    // changed nothing and stayed green. The row below carries the id where the query really looks.
    //
    // ⚑ **No event type but `sub_agent` has a top-level `agentId` today**, which is exactly why
    // this is worth pinning: the narrowing is what keeps the door shut when the next one does. The
    // store persists the payload it is handed, so this is the shape that row would have.
    const carrier = {
      type: 'unknown',
      provider: 'claude',
      category: 'lifecycle',
      raw: {},
      // ⚠️ Through `unknown`, because no event type declares this today — which is the point. The
      // store persists the payload it is handed, so this is the row a future one would write.
      agentId: PLAIN,
    } as unknown as TranscriptEvent
    store.append(SESSION, 0, carrier, 1)
    store.append(SESSION, 1, { type: 'unknown', raw: { agentId: PLAIN } } as TranscriptEvent, 2)
    expect(store.reportedSubAgent(SESSION, PLAIN)).toBe(false)
    // …and the paired positive, so the negatives are not about an empty ledger.
    store.append(SESSION, 2, dispatched(PLAIN), 3)
    expect(store.reportedSubAgent(SESSION, PLAIN)).toBe(true)
  })
})
