import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  MOST_MISSING_ORDINALS_TRACKED,
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  createSessionRecord,
  openWindow,
  reopenAtLatest,
} from '../src/renderer/src/lib/session-record'
import type { HistoryWindow, RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 623 · the event that did not arrive — `HO-095` §2
 *
 * ## ⛔ The question, and what the instrument could actually answer
 *
 * > ⚠️ *"`event stream gap: expected ordinal 486, got 487`… Was an event lost, or did the numbering
 * > skip? If one was lost, a screen can be quietly wrong — and every other observation in this
 * > document was made through that screen."*
 *
 * 🔴 **The notice cannot answer either half, and that is this dispatch's finding.** ⛔ `nextOrdinal`
 * is the highest ordinal SEEN plus one — `session-record.ts` has said so since `320`, *"not a set of
 * what arrived"* — so the sentence is a statement about ONE INSTANT: at the moment 487 landed, 486
 * had not been folded. ⚠️ **It says nothing about whether 486 landed a moment later**, and nothing
 * ever revisited it. ⚑ `320`'s own measurement is the proof: hand this fold `182` then `181` and it
 * prints the gap, prints *"not lost, only late"* one event afterwards, and leaves the alarming line
 * standing over the reassuring one forever.
 *
 * ## ⚑ What is measured here, in the order the brief asks for it
 *
 *  - **§1** — the ALLOCATOR, across a refused call and its retry, on a real host and a real ledger,
 *    with the wire and the ledger read separately and compared. ⛔ This is `HO-095` §2's second row —
 *    *486 was never minted* — and it is measured rather than argued.
 *  - **§2** — the SEARCH SHAPE for the negative above (standing rule 4): every place an ordinal is
 *    allocated, derived from the source, and what each one owes.
 *  - **§3** — the INSTRUMENT: the set the window now keeps, its bound, and the sentence that takes
 *    the earlier one back.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const hostSource = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')

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

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the allocator, across the exact sequence HO-095 names
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · a refused call and its retry take contiguous ordinals', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-623-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-623-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
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
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /**
   * 🔴 **`HO-095` §2's sequence, on a real host: a refused call, and its retry, mid-turn.**
   *
   * ⛔ **Mid-turn is load-bearing and is asserted rather than hoped for.** A refusal is published by
   * {@link RuntimeHost.noteRefusal} from inside a tool handler while the provider's own events are
   * still flowing through `deliver` — two producers taking ordinals from one counter — and that
   * interleaving is the only state in which `320`'s defect was ever reachable. ⚠️ A test that ran the
   * tool between turns would measure a quieter sequence and report it as this one.
   */
  const aRefusedCallAndItsRetry = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'pm', cwd: work, approvalMode: 'auto' },
      window,
    )
    const set = agentToolsFor(host, sessionId)
    const call = async (name: ToolName, args: Record<string, unknown>): Promise<void> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      await tool.call(args)
    }
    // A turn is running from here: the fake drives it asynchronously, exactly as a provider does.
    await host.send(sessionId, 'plan the world clock page', window)
    // ⚑ **D-016** — `spawn_agent` is gone; a give to an agent this app does not hold is the same
    // refusal mid-turn (`no-such-profile`, R3), which is all this sequence needs of it.
    const aGiveToNobody = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'nobody',
      title: 'a worker',
      brief: 'build the page',
    }
    await call('give_work', aGiveToNobody)
    // ⚑ **The retry** — the model reads the refusal and tries the same call again, which is the
    // behaviour `agent-tools.ts` instructs it to have and the shape `HO-095` §2 describes.
    await call('give_work', aGiveToNobody)
    await host.send(sessionId, 'carry on then', window)
    await vi.waitFor(() => expect(store.events(sessionId).at(-1)?.event.type).toBe('status'))
    return sessionId
  }

  it('🔴 the wire and the ledger both run 0,1,2,… with nothing skipped', async () => {
    const sessionId = await aRefusedCallAndItsRetry()

    const wire = window.messages.map((one) => one.ordinal)
    const ledger = store.events(sessionId).map((one) => one.ordinal)

    // ⛔ **The premise, asserted**: this really is the interleaved case. A refusal landed while the
    // turn that provoked it was still emitting, so two producers really did share the counter.
    const refusalAt = store.events(sessionId).findIndex((one) => one.event.type === 'tool_refused')
    expect(
      refusalAt,
      'no refusal was recorded — the sequence under test did not happen',
    ).toBeGreaterThan(0)
    const kinds = store.events(sessionId).map((one) => one.event.type)
    expect(
      kinds.indexOf('turn'),
      'the refusal landed between turns, not inside one',
    ).toBeGreaterThan(refusalAt)
    expect(kinds.filter((kind) => kind === 'tool_refused')).toHaveLength(2)

    // 🔴 **`HO-095` §2 row two — *an ordinal allocated and then not emitted* — does not happen here.**
    expect(wire).toEqual(wire.map((_, at) => at))
    expect(ledger).toEqual(ledger.map((_, at) => at))
    // ⚑ …and they are the SAME ordinals, which is the half a wire-only or ledger-only read misses:
    // a row written and never sent, and a row sent and never written, are both invisible to one of
    // them and both produce exactly the sentence the PO photographed.
    expect(wire).toEqual(ledger)
  })

  it('⚑ …and the renderer folding that wire reports no hole at all', async () => {
    const sessionId = await aRefusedCallAndItsRetry()
    const record = createSessionRecord(sessionId)
    for (const message of window.messages) acceptEvent(record, message)

    expect(record.missing.size).toBe(0)
    expect(record.missingBeyondTheList).toBe(0)
    // ⚠️ **Narrowed to THIS instrument's claim, not to *the transcript is silent***. An ordinary
    // conversation grows notices — `session started`, `turn completed`, and the two refusals this
    // very sequence produced — so a bare *no notices* assertion would be measuring the fixture.
    expect(holesReportedIn(record)).toEqual([])
  })

  it('⛔ …and the CONTROL: take one message out of that wire and it says so', async () => {
    // 🔴 **§4.3's control, and it is the same wire one event lighter.** ⚠️ Without it *"the renderer
    // reported no hole"* is satisfiable by a renderer that cannot report one — which is the failure
    // mode every negative in this file shares.
    const sessionId = await aRefusedCallAndItsRetry()
    const record = createSessionRecord(sessionId)
    // The event AFTER the first refusal — the one a drop at this exact moment would take.
    const dropped = window.messages.findIndex((one) => one.event.type === 'tool_refused') + 1
    expect(dropped).toBeGreaterThan(1)
    for (const [at, message] of window.messages.entries()) {
      if (at !== dropped) acceptEvent(record, message)
    }

    expect(record.missing.size).toBe(1)
    expect(holesReportedIn(record)).toHaveLength(1)
    expect(holesReportedIn(record)[0]).toContain('1 event of this conversation')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the search shape for the negative above (standing rule 4)
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · every place an ordinal is allocated, and what each one owes', () => {
  /** Every event that consumes a live ordinal, with the rest of its writing method. */
  const allocations = (): string[] => {
    const at: string[] = []
    let from = 0
    for (;;) {
      const match = /session\.ordinal\+\+|this\.takeLedgerOrdinal\(session\)/g
      match.lastIndex = from
      const found = match.exec(hostSource)?.index ?? -1
      if (found < 0) return at
      // ⚠️ **A window AROUND it, not after it.** `reportRecordingFailure` writes the allocation as a
      // FIELD of the object it is sending — `ordinal: session.ordinal++,` — so the send that proves
      // it is a publish rather than a drop is above the line, not below it.
      // ⚑ **D-016 · and after it, to the END OF ITS METHOD** (a class member closes on `\n  }\n`):
      // `replyToParent` keeps its resources' rows and its reply's row in one transaction, so its
      // append is further down than a fixed window reaches.
      const end = hostSource.indexOf('\n  }\n', found)
      expect(end, 'an allocation with no end to its method').toBeGreaterThan(found)
      at.push(hostSource.slice(Math.max(0, found - 300), end))
      from = found + 1
    }
  }

  /**
   * ⚑ **A durable write, in either of the two spellings the host has** — a row appended, or (D-016)
   * a piece given, which `SessionStore.recordGive` writes as its `work` row and its `work_given`
   * row in one transaction.
   */
  const writesTheLedger = (source: string): boolean =>
    source.includes('this.deps.store.append(') || source.includes('this.deps.store.recordGive(')

  /**
   * 🔴 **The negative in `HO-095` §2 needs a shape, and this is it** (standing rule 4).
   *
   * ⛔ **`316` counted item TYPES and the answer was a FIELD.** The claim being made is *no path
   * allocates an ordinal and then neither records nor sends it*, and the shape that could have found
   * a counter-example is this one: every direct increment or `takeLedgerOrdinal` call, classified by whether a
   * durable append follows it.
   *
   * ⚠️ **It is a CENSUS and it cannot see delivery**, which is said out loud rather than implied: the
   * send is gated on `session.sink.alive` at every site, and a dead sink drops the whole stream
   * rather than one event of it — so an ordinal is never sent-and-not-recorded by that gate.
   */
  it('🔴 there are exactly five, and four of them write the ledger', () => {
    const sites = allocations()
    // ⚑ **D-016 added two** — `replyToParent`'s reply row with its resources, and `recordTheGive`'s
    // piece — and both write the ledger.
    expect(sites, 'an event allocator appeared and nothing classified it').toHaveLength(5)
    expect(hostSource.match(/this\.takeLedgerOrdinal\(session\)/g)).toHaveLength(4)
    const allocator = hostSource.slice(
      hostSource.indexOf('private takeLedgerOrdinal('),
      hostSource.indexOf('\n  }\n', hostSource.indexOf('private takeLedgerOrdinal(')),
    )
    expect(allocator).toContain('this.deps.store.nextOrdinal(session.id)')
    expect(allocator).toContain('session.ordinal = ordinal + 1')
    const appends = sites.filter(writesTheLedger)
    expect(appends).toHaveLength(4)
  })

  /**
   * ⛔ **The one that does not write the ledger spends an ordinal the ledger never gets, and it
   * says so** — which is a real *numbering skip*, `HO-095` §2's second row, reachable and
   * documented.
   *
   * ⚠️ **It is not what the PO saw, and the reason is the SHAPE of the hole it leaves.**
   * {@link RuntimeHost.record} stops appending after the first failure — *"do not hammer a broken
   * database"* — so a ledger that reaches this line is TRUNCATED from that point, not short by one.
   * ⚑ And the notice itself IS sent, so a window watching live sees no hole at all.
   */
  it('⛔ the one allocator that does not write the ledger is the recording-failure notice, and its ordinal is never written', () => {
    const [orphan] = allocations().filter((source) => !writesTheLedger(source))
    expect(orphan).toBeDefined()
    // It goes out — this is an allocate-and-send, never an allocate-and-drop.
    expect(orphan).toContain('this.emit(session, {')
    // ⛔ **And the source says the row is not in the ledger**, by name, so the exception is declared
    // rather than inferred by this census (standing rule 5).
    const declares = hostSource.slice(
      hostSource.indexOf('private reportRecordingFailure'),
      hostSource.indexOf('private reportRecordingFailure') + 900,
    )
    expect(declares).toContain('it is not in the ledger')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the instrument — what the window now knows, and what it says
// ───────────────────────────────────────────────────────────────────────────────────────────────

const SESSION = 'sess_623'

const message = (ordinal: number, text: string): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: 1_800_000_000_000 + ordinal * 1_000,
  event: { type: 'assistant_message', text },
})

const noticesOn = (record: ReturnType<typeof createSessionRecord>): string[] =>
  record.control.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

/** ⚑ Only the notices THIS instrument wrote — see the assertion in §1 that explains the narrowing. */
const holesReportedIn = (record: ReturnType<typeof createSessionRecord>): string[] =>
  noticesOn(record).filter((said) => said.includes(NOT_REACHED_THIS_WINDOW))

const page = (from: number, count: number): HistoryWindow => ({
  entries: Array.from({ length: count }, (_, index) => ({
    ordinal: from + index,
    at: 1_800_000_000_000 + (from + index) * 1_000,
    event: { type: 'assistant_message', text: `reply ${from + index}` } as const,
  })),
  from,
  hasOlder: from > 0,
  turnAligned: true,
})

describe('§3 · the window keeps what it is short by', () => {
  it('🔴 a hole opens, and the SET says which ordinals — not just how far the counter jumped', () => {
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(4, 'five'))
    // ⛔ **The fact `nextOrdinal` cannot hold.** It is 5 either way; only this says *1, 2 and 3*.
    expect([...record.missing].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(record.nextOrdinal).toBe(5)
  })

  it('⚑ a late arrival closes its own hole, and the window says so ONLY when nothing is left', () => {
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(4, 'five'))
    acceptEvent(record, message(1, 'two'))
    // Two still absent, so the reassuring sentence is refused — 074's rule, with a set behind it.
    expect(noticesOn(record)[1]).toContain('2 events are still missing')
    expect(noticesOn(record)[1]).not.toContain('nothing is missing')

    acceptEvent(record, message(2, 'three'))
    expect(noticesOn(record)[2]).toContain('1 event is still missing')
    acceptEvent(record, message(3, 'four'))
    // ⚑ …and now it is earned.
    expect(record.missing.size).toBe(0)
    expect(noticesOn(record)[3]).toContain('nothing is missing from what you are reading')
  })

  it('⛔ an arrival this window was never short by does NOT claim it filled a hole', () => {
    // 🔴 **The discriminant, and without it the retraction is a lie told on the wrong event.** A page
    // anchors `nextOrdinal` part-way through a ledger, so an ordinal BELOW that anchor is ordinary
    // history and was never missing — a window that answered *nothing is missing now* to it would be
    // reporting a repair it never made.
    const record = createSessionRecord(SESSION)
    openWindow(record, page(100, 3))
    for (const entry of page(100, 3).entries) acceptEvent(record, { sessionId: SESSION, ...entry })
    expect(record.missing.size).toBe(0)

    acceptEvent(record, message(42, 'an event from before this page'))
    expect(noticesOn(record)).toHaveLength(1)
    expect(noticesOn(record)[0]).not.toContain('nothing is missing')
    expect(noticesOn(record)[0]).toContain('at the end of this list rather than in its place')
  })

  it('⚠️ the LIST is bounded and the COUNT is not, so a huge jump names a number rather than a set', () => {
    // ⛔ **The hazard is a loop, not memory**: the width of a gap is `arrival − expected`, and the
    // walk that lists it would otherwise be as long as the jump. Measured on a jump three times the
    // cap, so the assertion is about the bound rather than about the arithmetic happening to be small.
    const record = createSessionRecord(SESSION)
    const jump = MOST_MISSING_ORDINALS_TRACKED * 3
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(jump, 'much later'))

    expect(record.missing.size).toBe(MOST_MISSING_ORDINALS_TRACKED)
    expect(record.missingBeyondTheList).toBe(jump - 1 - MOST_MISSING_ORDINALS_TRACKED)
    // ⚑ **And the SENTENCE is still exact**, because the bound is on the list and not on the fact.
    expect(noticesOn(record)[0]).toContain(`${jump - 1} events of this conversation`)
  })

  it('⛔ the cap is on the WINDOW and not on each gap, so a second hole cannot buy another capful', () => {
    // 🔴 **Measured where the two readings DIVERGE** (standing rule 3, and
    // `a-rule-measured-only-where-both-readings-agree`). ⚠️ A single gap from a fresh record cannot
    // tell `CAP − already listed` from `CAP`: the set is empty, so both answers are the same number
    // and the bound is untested. ⛔ **Two gaps is where they part**, and a per-gap cap is not a
    // bound at all — it is a rate limit, and the list grows with the number of holes.
    const record = createSessionRecord(SESSION)
    const wide = Math.floor(MOST_MISSING_ORDINALS_TRACKED * 0.8)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(wide + 1, 'after the first hole'))
    expect(record.missing.size).toBe(wide)
    acceptEvent(record, message(wide * 2 + 2, 'after the second'))

    expect(record.missing.size).toBe(MOST_MISSING_ORDINALS_TRACKED)
    expect(record.missingBeyondTheList).toBe(wide * 2 - MOST_MISSING_ORDINALS_TRACKED)
    // ⚑ …and the COUNT is unharmed by the bound, which is the property the whole split exists for.
    expect(noticesOn(record)[1]).toContain(`${wide * 2} events of this conversation`)
  })

  it('⛔ …and in that state it can never say a hole closed, because it does not know which', () => {
    const record = createSessionRecord(SESSION)
    const jump = MOST_MISSING_ORDINALS_TRACKED * 3
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(jump, 'much later'))
    // Every listed ordinal arrives; the unlisted ones cannot be struck off, so the count never reaches
    // zero and the reassuring sentence is never reachable. ⚑ The weaker true thing, by construction.
    for (let ordinal = 1; ordinal <= MOST_MISSING_ORDINALS_TRACKED; ordinal += 1) {
      acceptEvent(record, message(ordinal, `late ${ordinal}`))
    }
    expect(record.missing.size).toBe(0)
    expect(record.missingBeyondTheList).toBeGreaterThan(0)
    expect(noticesOn(record).some((said) => said.includes('nothing is missing'))).toBe(false)
  })

  it('🔴 re-anchoring the window forgets what it was short of — both doors', () => {
    // ⛔ **`openWindow` and `reopenAtLatest` both move `nextOrdinal` directly**, and an ordinal below
    // the new anchor stops meaning *absent* and starts meaning *before this page*. ⚠️ Carried across,
    // a hole from a life this page replaces would be reported against the page that replaced it.
    const opened = createSessionRecord(SESSION)
    acceptEvent(opened, message(0, 'one'))
    acceptEvent(opened, message(9, 'ten'))
    expect(opened.missing.size).toBe(8)
    openWindow(opened, page(100, 2))
    expect(opened.missing.size).toBe(0)
    expect(opened.missingBeyondTheList).toBe(0)

    const jumped = createSessionRecord(SESSION)
    acceptEvent(jumped, message(0, 'one'))
    acceptEvent(jumped, message(9, 'ten'))
    expect(jumped.missing.size).toBe(8)
    reopenAtLatest(jumped, page(200, 2))
    expect(jumped.missing.size).toBe(0)
    expect(jumped.missingBeyondTheList).toBe(0)
  })

  it('⚠️ the notice keeps its severity, on the projection and at the moment 064 put it', () => {
    // ⛔ **`HO-095` §2 is a REWORDING and `320` §5 refuses the other repair**: a notice at `info` is
    // dropped by the reading view, so a quieter level would have softened this out of existence.
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(2, 'three'))
    const [item] = record.control.items.filter((one) => one.kind === 'notice')
    expect(item?.kind === 'notice' && item.level).toBe('warn')
    // ⚑ Stamped with the ARRIVING event's time, not with now — the notice belongs in the timeline.
    expect(item?.at).toBe(1_800_000_000_000 + 2_000)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the words the ruling removed are gone from the app, not merely unused
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · no source in the app writes the retired sentences', () => {
  /** ⚠️ Prose is stripped first — this file quotes both sentences it counts (rule 26). */
  const codeOf = (body: string): string =>
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  /** Every `.ts`/`.vue` the app SHIPS — tests excluded, build output excluded. */
  const everyAppSource = (): string[] => {
    const out: string[] = []
    const walk = (at: string): void => {
      for (const name of readdirSync(at)) {
        if (name === 'node_modules' || name === 'out' || name === 'dist') continue
        const full = join(at, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full)
      }
    }
    walk(join(here, '../src'))
    return out
  }

  /**
   * ⛔ **Strip AND re-aim** (rule 26). ⚠️ A census repaired by rewording one producer goes green
   * over a second producer that still says the old thing — and *"event stream gap: expected ordinal
   * 486, got 487"* is precisely the string `HO-095` §2 ruled must not reach a person. ⚑ This is the
   * assertion that stops it coming back through a different door.
   */
  it('⛔ neither *event stream gap* nor *event out of order* is composed anywhere in the app', () => {
    const still = everyAppSource().filter((file) => {
      const code = codeOf(readFileSync(file, 'utf8'))
      return code.includes('event stream gap') || code.includes('event out of order')
    })
    expect(still.map((file) => basename(file))).toEqual([])
  })

  /**
   * ⚑ **The control, and it is the same walk one fact over** (standing rule 3). ⛔ Without it the
   * negative above is satisfiable by a walk that reads nothing, a strip that eats everything, or a
   * root that points at the wrong tree.
   */
  it('⚑ …and the walk CAN find a sentence in that tree, because it finds this one', () => {
    const found = everyAppSource().filter((file) =>
      codeOf(readFileSync(file, 'utf8')).includes(NOT_REACHED_THIS_WINDOW),
    )
    expect(found.map((file) => basename(file))).toEqual(['session-record.ts'])
  })
})
