import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  eachOrSkipped,
  ledgersSkippedOf,
  readOrSkip,
  rowsUnreadOnce,
  skipTheLedger,
  type SessionStore,
} from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-017 · R8 — one bad row never stops the app**, pinned against `session-store.ts`'s
 * counters (`RowsUnread`, `readOrSkip`, `eachOrSkipped`, `ledgersSkippedOf`, `walkLedgers`), the
 * instruction-ask ledger, the launch sweep's own sentence, and the three `agent-tools.ts` readers
 * that splice a skipped-records sentence onto their answer.
 *
 * ⚠️ **`ledgersSkipped` (a whole ledger this app could not read at all) and `rowsUnread` (a torn
 * row it read AROUND) are two different tallies, and the whole point of this dispatch is that
 * nothing may conflate them** — a mutation that swaps one for the other, or that lets a whole-
 * ledger skip fall through into the row tally, is what every section here is built to catch.
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const STORE_SRC = join(here, '../src/main/db/session-store.ts')
const TOOLS_SRC = join(here, '../src/main/runtime/agent-tools.ts')

const NOW = 1_800_000_000_000

const sourceOf = (path: string): string => readFileSync(path, 'utf8')

/**
 * ⛔ **One declaration's body** — `a-decision-only-a-person-can-make.test.ts`'s device, copied for
 * its own reason: slicing the raw source rather than the whole file keeps a census pinned to the
 * one function it names.
 */
const bodyIn = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from)
  expect(start, `${from} is not in this file`).toBeGreaterThan(-1)
  const end = source.indexOf(to, start)
  expect(end, `${to} does not close ${from}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** ⚑ The line immediately after one marker line, trimmed — indentation-proof. */
const nextLineAfter = (source: string, marker: string): string => {
  const at = source.indexOf(marker)
  expect(at, `${marker} is not in this file`).toBeGreaterThan(-1)
  const eol = source.indexOf('\n', at)
  const nextEol = source.indexOf('\n', eol + 1)
  return source.slice(eol + 1, nextEol).trim()
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

/* ══════════════════ §1 · the two counters, pure — no database at all ══════════════════ */

describe('D-017 · the two tallies, pure', () => {
  it("rowsUnreadOnce keeps a row's ordinal and a whole ledger's skip in two separate tallies", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const unread = rowsUnreadOnce()
      expect(unread.count).toBe(0)
      expect(unread.ledgersSkipped).toBe(0)

      // ⚑ TWO rows noted in one ledger, so `seen.size` and `skipped.size` cannot coincide by
      // accident below — a single row of each would leave both sets at size 1.
      unread.in('sess_a')(3)
      unread.in('sess_a')(4)
      expect(unread.count).toBe(2)
      expect(unread.ledgersSkipped).toBe(0)

      skipTheLedger('sess_b', new Error('boom'), unread.in('sess_b'))
      expect(unread.ledgersSkipped).toBe(1)
      // ⛔ **The paired negative**: a DIFFERENT ledger's whole-ledger skip must not touch the row
      // tally the first ledger already earned.
      expect(unread.count).toBe(2)

      expect(warn).toHaveBeenCalledWith(
        'session ledger: sess_b could not be read and was skipped (boom)',
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('readOrSkip throws for a caller with no note, and only there', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const boom = (): string => {
        throw new Error('boom')
      }
      // ⛔ **No note, no catch** — a write door with nowhere to put a count gets the throw.
      expect(() => readOrSkip('sess_a', undefined, 'fallback', boom)).toThrow('boom')

      // ⚑ **The SAME fold**, handed a note this time — it is skipped, not thrown.
      const unread = rowsUnreadOnce()
      expect(readOrSkip('sess_a', unread.in('sess_a'), 'fallback', boom)).toBe('fallback')
      expect(unread.ledgersSkipped).toBe(1)

      // ⛔ **Paired positive**: a fold that never throws is untouched either way.
      const real = (): string => 'real value'
      expect(readOrSkip('sess_a', undefined, 'fallback', real)).toBe('real value')
      expect(readOrSkip('sess_a', unread.in('sess_a'), 'fallback', real)).toBe('real value')
    } finally {
      warn.mockRestore()
    }
  })

  it('eachOrSkipped drops only the row whose build throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const rows: { askedBy: string }[] = [{ askedBy: 'a' }, { askedBy: 'b' }, { askedBy: 'c' }]
      const buildThrowingForB = (row: { askedBy: string }): string => {
        if (row.askedBy === 'b') throw new Error('cannot build b')
        return `built(${row.askedBy})`
      }
      let unread = rowsUnreadOnce()
      const built = eachOrSkipped(rows, 'askedBy', unread, buildThrowingForB)
      expect(built).toEqual(['built(a)', 'built(c)'])
      expect(unread.ledgersSkipped).toBe(1)
      expect(warn).toHaveBeenCalledWith(
        'session ledger: b could not be read and was skipped (cannot build b)',
      )

      // ⛔ **Paired positive**: the same call with a build that never throws keeps all three, in
      // order, and counts nothing as skipped.
      unread = rowsUnreadOnce()
      const clean = eachOrSkipped(rows, 'askedBy', unread, (row) => `built(${row.askedBy})`)
      expect(clean).toEqual(['built(a)', 'built(b)', 'built(c)'])
      expect(unread.ledgersSkipped).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('ledgersSkippedOf answers the empty object for undefined and for zero, and only for those', () => {
    expect(Object.keys(ledgersSkippedOf(undefined))).toEqual([])
    expect(Object.keys(ledgersSkippedOf(0))).toEqual([])
    // ⚑ **The paired positive**, in the same breath: a real count answers with exactly one key.
    expect(ledgersSkippedOf(3)).toEqual({ ledgersSkipped: 3 })
  })
})

/* ══════════════════ §2 · walkLedgers, by its source ══════════════════ */

describe('D-017 · walkLedgers, by its source', () => {
  it('walkLedgers folds every candidate through the same per-ledger recovery its answer reports', () => {
    const body = bodyIn(
      sourceOf(STORE_SRC),
      'function walkLedgers<Row, Candidate extends { id: string }>(',
      'interface GivenWorkRow',
    )
    // ⛔ **The outer net, named**: every candidate's fold is wrapped in the SAME `readOrSkip` a
    // single-ledger reader uses, so a candidate whose fold throws is skipped and not fatal.
    expect(body).toContain(
      'readOrSkip(candidate.id, noteSkip, [], () => foldOne(candidate.id, noteSkip, candidate))',
    )
  })
})

/* ══════════════════ §3 · a torn instruction row is skipped, never the whole read ══════════════════ */

describe('D-017 · the instruction-ask ledger', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-asks-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-asks-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_bad_row_asks_${String(tick())}`,
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
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: workspace, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  /** ⚑ An identity exists once a conversation has run as it — `the-layer-a-person-writes`'s helper. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  /** A conversation planted directly, for a raw row — `who-called-whom.test.ts`'s device. */
  const conversation = (id: string, profileId: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId,
    })
    return id
  }

  it('a torn instruction row is skipped, never the whole read — a healthy ask elsewhere still answers', async () => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('asker')
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)
    const asking = await personOpens('asker')
    const asked = host.proposeAgentRules(
      asking,
      { about: 'worker', text: 'Never force-push.', why: 'it keeps coming up', relaying: false },
      window,
    )
    expect(asked.ok && asked.wrote).toBe('a-request')

    // ⚑ **The control**: one healthy ask, before anything is torn.
    const before = store.instructionAsksWaiting()
    expect(before).toHaveLength(1)
    expect(before[0]?.conversation).toBe(asking)

    // ⛔ **A second, unrelated conversation's ledger holds a row that is not JSON at all.**
    const other = conversation('sess_unrelated', 'auditor')
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'instruction_proposed', '{not json', ?)`,
    ).run('evt_torn_instruction', other, 900, tick())

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => store.instructionAsksWaiting()).not.toThrow()
      const after = store.instructionAsksWaiting()
      // ⚑ **The healthy ask is still the only one** — the torn row answered nobody.
      expect(after).toHaveLength(1)
      expect(after[0]?.conversation).toBe(asking)
      expect(host.agentInstructions('worker').waiting).toHaveLength(1)

      // ⛔ **`noteUnreadRow`'s own wording**, not the generic `JSON.parse`-catch sentence, and it
      // names the torn row's ordinal.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `session ledger: ${other} ordinal 900 is not JSON and was skipped by a guarded read`,
        ),
      )
    } finally {
      warn.mockRestore()
    }
    await host.close(asking, window)
  })

  it('an instruction row with no ask id is skipped, never surfaced as a phantom ask', async () => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('asker')
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)
    const asking = await personOpens('asker')
    host.proposeAgentRules(
      asking,
      { about: 'worker', text: 'Never force-push.', why: 'it keeps coming up', relaying: false },
      window,
    )
    const before = store.instructionAsksWaiting()
    expect(before.length).toBeGreaterThan(0)

    // ⛔ **Valid JSON, and it carries no `askId` at all.**
    const other = conversation('sess_no_ask_id', 'auditor')
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'instruction_proposed', ?, ?)`,
    ).run('evt_no_ask_id', other, 901, JSON.stringify({ type: 'instruction_proposed' }), tick())

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const after = store.instructionAsksWaiting()
      // ⚑ **No growth** — the malformed row answered nobody, and there is no entry with an
      // `askId` of `undefined` hiding among the real ones.
      expect(after).toHaveLength(before.length)
      expect(after.find((one) => (one.asked as { askId?: unknown }).askId === undefined)).toBe(
        undefined,
      )
    } finally {
      warn.mockRestore()
    }
    await host.close(asking, window)
  })
})

/* ══════════════════ §4 · the launch sweep's own sentence ══════════════════ */

describe("D-017 · the launch sweep's own sentence", () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let hosts: RuntimeHost[]
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_sweep_${String(tick())}`,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-sweep-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    hosts = []
    // ⚑ **The first launch** — nothing has happened yet, standing for the run that will hand out
    // the work below and then die without a graceful quit.
    buildHost()
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it("the launch sweep's line for an ordinary settle carries no skipped-ledger suffix", () => {
    // ⛔ **Planted directly, bypassing every host** — exactly the state a crash leaves: a
    // conversation nobody is running, still holding a given, undriven piece. ⚑ D-016 · the piece
    // is a `work` row beside its `work_given`, written together as a give writes them, hung under
    // the giver's root.
    for (const [id, profileId] of [
      ['sess_pm', 'pm'],
      ['sess_undriven', 'worker'],
    ] as const) {
      store.create({ id, provider: 'codex', cwd: userData, approvalMode: 'ask', profileId })
    }
    const root = store.rootOf('sess_pm')
    if (root === null) throw new Error('the giver owns no root')
    const given = {
      piece: 'work_a',
      parent: root.piece,
      number: 1,
      owner: 'sess_undriven',
      givenBy: 'sess_pm',
      title: 'the migration',
      brief: 'run the migration',
      folder: null,
      inputs: [],
    } as const
    store.recordGive(
      given,
      0,
      {
        type: 'work_given',
        piece: given.piece,
        label: `${root.label}.1`,
        parent: given.parent,
        givenBy: given.givenBy,
        title: given.title,
        brief: given.brief,
        messageId: 'msg_work_a',
      },
      tick(),
    )

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      // ⚑ **The restart** — a second host over the same store/db, never told about the first
      // conversation as one it is running.
      buildHost()
      expect(info).toHaveBeenCalledWith(
        'pieces: 1 conversation(s) held work a previous run did not finish',
      )
      const suffixed = info.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('ledger(s) skipped'),
      )
      expect(suffixed).toBe(false)
    } finally {
      info.mockRestore()
    }
  })
})

/* ══════════════════ §5 · a torn ROW inside one ledger is not a skipped LEDGER ══════════════════ */

describe('D-017 · a torn row inside one ledger is not a skipped ledger', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-two-counts-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** `two-counts-and-one-moment.test.ts`'s fixture, copied for the one world it needs. */
  const conversation = (id: string, profileId: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: userData,
      approvalMode: 'ask',
      profileId,
    })
    return id
  }

  const ordinals = new Map<string, number>()
  const append = (id: string, event: TranscriptEvent, at = tick()): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event, at)
  }

  const aDecisionOnlyAPersonCanMake = (id: string, requestId: string): string => {
    append(id, {
      type: 'request_routed',
      requestId,
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_parent',
    } as TranscriptEvent)
    return requestId
  }

  it("a torn ROW inside one conversation's ledger is not a skipped LEDGER", () => {
    const worker = conversation('sess_worker', 'worker')
    aDecisionOnlyAPersonCanMake(worker, 'req_decision')

    // ⚑ **The control, in the same fixture, before anything is torn**: a clean walk carries no
    // `ledgersSkipped` key at all.
    const before = store.decisionsAwaitingAPerson()
    expect(before.rowsUnread).toBe(0)
    expect('ledgersSkipped' in before).toBe(false)

    // ⛔ **One row of the worker's ledger is torn** — not a whole-ledger throw.
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'request_routed', '{not json', ?)`,
    ).run('evt_unreadable', worker, 900, tick())

    const decisions = store.decisionsAwaitingAPerson()
    const questions = store.questionsAPersonMustAnswer()
    expect(decisions.rowsUnread).toBe(1)
    expect(questions.rowsUnread).toBe(1)
    // 🔴 **The whole point**: a torn ROW is counted, and it is never reported as a skipped LEDGER.
    expect('ledgersSkipped' in decisions).toBe(false)
    expect('ledgersSkipped' in questions).toBe(false)
  })
})

/* ══════════════════ §6 · agent-tools.ts, by its source ══════════════════ */

describe('D-017 · agent-tools.ts, by its source', () => {
  it('recordsOf spells the boundary at exactly one conversation', () => {
    const source = sourceOf(TOOLS_SRC)
    expect(source).toContain(`count === 1 ? "1 conversation's record" : `)
  })

  it('every reader that carries ledgersSkipped still splices its own skipped-records sentence', () => {
    const source = sourceOf(TOOLS_SRC)
    expect(
      nextLineAfter(source, '...(rowsUnread === 0 ? [] : [unreadRowsSentence(rowsUnread)]),'),
    ).toBe('...whenSkipped(ledgersSkipped, skippedRecordsSentence),')
    expect(
      nextLineAfter(
        source,
        '...(listed.rowsUnread === 0 ? [] : [unreadQuestionRowsSentence(listed.rowsUnread)]),',
      ),
    ).toBe('...whenSkipped(listed.ledgersSkipped, skippedQuestionRecordsSentence),')
  })
})

/* ══════════════════ §7 · a healthy record never claims it could not be read ══════════════════ */

class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('D-017 · a healthy record never claims it could not be read', () => {
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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-record-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-bad-row-record-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const listAgentsText = async (toolset: AgentToolset): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === 'list_agents')
    if (tool === undefined) throw new Error('no list_agents')
    return (await tool.call({})).text
  }

  /**
   * `who-can-i-talk-to.test.ts` §5's fixture: a parent in a window with one child it started — ⚑
   * D-016 · by giving it a piece, whose brief is the child's first turn.
   */
  const aParentAndItsChild = async (): Promise<{ tools: AgentToolset; child: string }> => {
    await host.close(await personOpens('worker'), window)
    await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const spawned = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the notes',
      brief: 'the notes',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    return { tools, child: spawned.agent as string }
  }

  it("a healthy conversation's rendered line never claims its record could not be read", async () => {
    const { tools, child } = await aParentAndItsChild()

    // ⚑ **The positive case**: a clean, fully-readable record — this is what `M18`/`M19`'s
    // inverted conditions falsify. The running child's line is drawn by `cardText`.
    const before = await listAgentsText(tools)
    expect(before).not.toContain('its record could not be read')

    host.claimSession(child, window)
    await host.close(child, window)

    // ⚑ Ended, so its line is now drawn by `leftText` instead — the OTHER call site.
    const after = await listAgentsText(tools)
    expect(after).not.toContain('its record could not be read')
  })
})
