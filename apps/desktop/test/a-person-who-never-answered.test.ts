import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DIGEST_LINE_KINDS,
  DIGEST_REGISTERS,
  LINE_REGISTERS,
  type DigestRegister,
} from '../src/shared/digest'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **465 · a person who never answered** — `463`'s F1, and the type hole beside it.
 *
 * > ⛔ HO-024 §5.1: *"An outcome an agent declared is the agent's claim and a digest may report it
 * > as such; **it may never restate a claim as an observation**."*
 *
 * ## ⛔ What was false, and how it was measured
 *
 * An answer made through the production door by a parent agent must not make the digest say a
 * person answered. A durable row with no actor does not support a claim about a person’s
 * action, even under an `observed` chip.
 *
 * ## ⚑ The instrument is the production door, twice, and the two doors DIVERGE
 *
 * ⛔ **A test that asked the fold about a hand-built row would be asking the fold about itself.**
 * §1 drives both doors that write {@link UserDecisionEvent} with an answer — the PERSON's
 * (`RuntimeHost.respondUserInput`, from a sink that declares a person behind it) and the AGENT's
 * (`RuntimeHost.answerQuestion`, from a parent agent's caller id) — and asks what each one left on
 * disk. 🔴 **They leave the same three keys.** That is the whole argument for the sentence: a
 * register that cannot tell the two apart may not name either.
 *
 * ## ⚠️ What this file does NOT do
 *
 * ⛔ **It does not add an actor to the durable event.** That was a schema decision the PO held, and
 * `465` §1.2 forbade the column and the migration. The response priced it; nothing here wrote it.
 *
 * 🔴 **477 · the PO ruled and the field landed, so §1 now measures the OPPOSITE property** —
 * HO-029 §1: *"`465` priced it and the risk I was protecting against does not exist here: no
 * migration, no column… deferring a decision whose price is paid in elapsed time is the one case
 * where waiting is strictly worse."* ⚑ **The two doors now disagree in the ledger**, which is what
 * lets a sentence say which one answered. ⚠️ **Everything else in this file is untouched**: the
 * type-level requirement, `LINE_REGISTERS`, and the eleven-sentence map are `465`'s and still
 * pass — a line may name an actor exactly when the row it stands for carries one, and `477` is
 * that row carrying one rather than the rule being relaxed.
 *
 * ⚑ The provider is a double, every directory is temporary, and no live app or provider is run.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000
const FROM = 1_800_000_000_000
const TO = FROM + 12 * HOUR
/** Comfortably inside the window, and on neither boundary. */
const INSIDE = FROM + 6 * HOUR
/**
 * ⚑ **D-016 · the window after it**, because the digest is ONE window over every conversation an
 * agent of this app holds. §1 needs each door read on its own, so the second door answers here.
 */
const NEXT_TO = TO + 12 * HOUR
const INSIDE_NEXT = TO + 6 * HOUR

/** A window sink: `aPersonIsBehindIt` is what the person's answer door reads (`340`). */
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

/** Keep the provider handles, so a question can be raised through the real card path. */
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

describe('465 · a person who never answered', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let counter: number
  let handles: FakeSessionHandle[]
  let window: RecordingSink
  let ordinals: Map<string, number>

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-465-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-465-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = INSIDE
    counter = 0
    handles = []
    ordinals = new Map()
    const sessions = new FakeProviderSessions()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_live_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:465')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  const callOn = async (
    tools: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    // ⛔ **Bounded, and it reports rather than hangs** (standing rule 13).
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const digestOf = (from = FROM, to = TO): ReturnType<typeof distil> =>
    distil(store.digestWindow(from, to), (id) => id.replace('sess_', ''))

  const answerRowOf = (sessionId: string): Record<string, unknown> => {
    const row = store.events(sessionId).find(({ event }) => event.type === 'user_decision')?.event
    if (row === undefined) throw new Error(`no user_decision in ${sessionId}`)
    return row as unknown as Record<string, unknown>
  }

  /** The PERSON's door: a provider card, answered by the window that owns the conversation. */
  const answeredByAPerson = async (): Promise<{ sessionId: string; requestId: string }> => {
    const opened = await host.createSession(
      {
        provider: 'claude',
        profileId: 'person-side',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('the conversation received no provider handle')
    const asked = handle.simulateUserInput('Which database?', ['Postgres', 'SQLite'])
    const taken = await host.respondUserInput(
      opened.sessionId,
      asked.id,
      { kind: 'answer', answers: { q0: ['Postgres'] } },
      window,
    )
    expect(taken, JSON.stringify(taken)).toEqual({ outcome: 'taken' })
    await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    return { sessionId: opened.sessionId, requestId: asked.id }
  }

  /**
   * The AGENT's door: a started worker's routed question, answered by its parent (`463`'s path). ⚑
   * D-016 · the parent starts it with a give, and the brief is the worker's first turn.
   */
  const answeredByAnAgent = async (): Promise<{
    sessionId: string
    requestId: string
    /** ⚑ **477** — the conversation the row must now name, so §1 compares against a value it built. */
    parentSessionId: string
  }> => {
    const seeded = await host.createSession(
      {
        provider: 'claude',
        profileId: 'agent-side-worker',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    await host.close(seeded.sessionId, window)
    const parent = await host.createSession(
      {
        provider: 'claude',
        profileId: 'agent-side-parent',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const spawned = await callOn(agentToolsFor(host, parent.sessionId), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'agent-side-worker',
      title: 'the question under test',
      brief: 'raise the question whose answer provenance is under test',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const worker = spawned.agent as string
    const workerHandle = handles.at(-1)
    if (workerHandle === undefined) throw new Error('the worker received no provider handle')
    const asked = workerHandle.simulateUserInput('Which database?', ['Postgres', 'SQLite'])
    await waitFor(
      () =>
        store
          .events(worker)
          .some(({ event }) => event.type === 'request_routed' && event.requestId === asked.id),
      'the worker question to route to its parent',
    )
    const answered = await host.answerQuestion(
      { questionId: asked.id, answers: [{ part: 'q0', answer: ['Postgres'] }] },
      { ownerId: `agent:${parent.sessionId}` },
    )
    expect(answered.ok, JSON.stringify(answered)).toBe(true)
    await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    return { sessionId: worker, requestId: asked.id, parentSessionId: parent.sessionId }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · two doors, one row — and since `477` the row says which door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 the two production answer doors now write DIFFERENT actors, and the digest says which', async () => {
    const person = await answeredByAPerson()
    // ⚑ **D-016 · the agent's door answers in the NEXT window**, so each reading holds one door.
    clock = INSIDE_NEXT
    const agent = await answeredByAnAgent()

    // ⛔ **The keys, enumerated — not `toHaveProperty('by')`.** A named absence is only as strong as
    // its search shape (standing rule 4), and the same is true of a named presence: this asserts
    // the WHOLE key set, so a row that grew `by` and also grew something nobody decided about is a
    // failure rather than a pass.
    //
    // 🔴 **`477` · this assertion is `465`'s, inverted by the fix it asked for.** It used to read
    // `['outcome','requestId','type']` and then assert the agent's row had the SAME keys — *"byte-
    // identical apart from the id a provider minted… the ledger cannot tell you which."* ⚑ The
    // keys are the same on both rows again; what changed is that the VALUE of `by` differs, which
    // is the whole of HO-029 §2.1.
    expect(Object.keys(answerRowOf(person.sessionId)).sort()).toEqual([
      'by',
      'outcome',
      'requestId',
      'type',
    ])
    expect(answerRowOf(person.sessionId)).toEqual({
      type: 'user_decision',
      requestId: person.requestId,
      outcome: 'answered',
      // ⛔ **`a-person` and NOT a name.** This app has no person identity; what
      // `RuntimeHost.requireToAnswer` proved is that the surface this card was shown on declares a
      // person behind it and that this caller is that surface.
      by: { who: 'a-person' },
    })
    expect(Object.keys(answerRowOf(agent.sessionId)).sort()).toEqual(
      Object.keys(answerRowOf(person.sessionId)).sort(),
    )
    expect(answerRowOf(agent.sessionId)).toEqual({
      type: 'user_decision',
      requestId: agent.requestId,
      outcome: 'answered',
      // ⛔ **The answering conversation's SESSION id**, not its `agent:` caller id — built here
      // from what `give_work` returned rather than re-derived, so the assertion cannot agree with
      // the code by copying it.
      by: { who: 'an-agent', agent: agent.parentSessionId },
    })
    // 🔴 **The property `463` measured, now true the other way**: the two doors disagree, in the
    // ledger, about who answered — which is the only thing that lets a sentence say it.
    expect(answerRowOf(agent.sessionId)['by']).not.toEqual(answerRowOf(person.sessionId)['by'])

    // ⚑ **And so the two digests are now DIFFERENT sentences**, each naming the door that was
    // actually used. ⛔ Neither of them is `465`'s sentence, because neither of these rows is one
    // of the rows `465`'s sentence is about.
    const said = (door: 'by-a-person' | 'by-an-agent'): string => {
      const line = (door === 'by-a-person' ? digestOf() : digestOf(TO, NEXT_TO)).lines.find(
        (one) => one.kind === 'request-answered',
      )
      expect(line, door).toMatchObject({ register: 'observed', count: 1, saidBy: null })
      return line?.text ?? ''
    }
    expect(said('by-a-person')).toBe('1 request was answered. Who answered: 1 · a person.')
    expect(said('by-an-agent')).toBe('1 request was answered. Who answered: 1 · an agent.')
    expect(said('by-a-person')).not.toBe(said('by-an-agent'))
    // ⛔ **`465`'s sentence is not drawn for EITHER**, because both rows record an answerer. It is
    // still drawn — for the rows written before this app recorded one, which the next case plants.
    for (const door of ['by-a-person', 'by-an-agent'] as const) {
      expect(said(door), door).not.toContain('Nothing in the ledger records')
    }
    // ⛔ **Still `observed`, and still `saidBy: null`.** ⚑ The line names an actor the ROW carries;
    // it is not an agent's claim, and `465`'s type-level requirement is untouched by this dispatch
    // — see `LINE_REGISTERS` below, which is asserted whole and did not move.
  })

  it('⚠️ the absence is said about the RIGHT number of requests, in both grammars', async () => {
    // Assert a plural case as well as a singular one: both use the same template, so a
    // hard-coded singular sentence must fail when two requests are present.
    const id = 'sess_two'
    store.create({
      id,
      provider: 'codex',
      cwd: root,
      approvalMode: 'ask',
      profileId: 'p',
    })
    at(id, INSIDE, { type: 'user_decision', requestId: 'r1', outcome: 'answered' })
    at(id, INSIDE + 1, { type: 'user_decision', requestId: 'r2', outcome: 'allow' })

    const line = digestOf().lines.find((one) => one.kind === 'request-answered')
    expect(line?.count).toBe(2)
    expect(line?.text).toBe(
      '2 requests were answered. Nothing in the ledger records who answered them.',
    )
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the requirement, in the type — and the two rumours `463` measured getting through it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ every kind DECLARES the registers it may be built in, and no kind declares `unknown`', () => {
    // ⛔ **The declaration, whole.** ⚠️ Pinned as a value rather than as a shape, because the
    // constructors' parameter types are DERIVED from it: this object is the only place that says
    // an agent's sentence may not be built as something the engine watched, and a row added here
    // in silence widens `ObservedLineKind` without touching a line of the fold.
    expect(LINE_REGISTERS).toEqual({
      'work-handed-out': ['observed'],
      'work-taken-back': ['observed'],
      // ⚑ A person's take-back of the piece a service was on: the row's `by` names no conversation.
      'work-taken-back-by-a-person': ['observed'],
      // ⚑ **D-016 · a close**, `work-taken-back`'s twin: the engine watched the giver close it.
      'work-closed': ['observed'],
      // ⚑ **475's one**, and this census is what made it declare itself: the engine watched a
      // held message end without being sent, so it is an observation and nothing an agent said.
      'work-not-sent': ['observed'],
      'question-travelled': ['observed'],
      // ⚑ **611** — the engine watched a routing the asker aimed at a person.
      'question-addressed-to-a-person': ['observed'],
      'decision-raised': ['observed'],
      'question-escalated': ['observed'],
      'question-lost': ['observed'],
      'request-answered': ['observed'],
      'work-interrupted': ['observed'],
      'work-restarted': ['observed'],
      'tool-refused': ['observed'],
      'turn-ended': ['observed'],
      // ⚑ **466's four**, declared here the day they were added — which is what this census is
      // for: a kind that reached `DIGEST_LINE_KINDS` without a register would widen
      // `ObservedLineKind` in silence. ⚑ D-016 took the two proposal kinds out with proposals.
      'question-about-work': ['observed'],
      'tool-answered': ['observed'],
      'worker-reported': ['claimed'],
    })
    // ⛔ **The vocabulary and the declaration are the same set, in both directions.** A kind added
    // to one and not the other is already a compile error (`satisfies`); this is the runtime half.
    expect(Object.keys(LINE_REGISTERS).sort()).toEqual([...DIGEST_LINE_KINDS].sort())
    for (const kind of DIGEST_LINE_KINDS) {
      const declared: readonly DigestRegister[] = LINE_REGISTERS[kind]
      // ⚑ **At least one**, or the kind is a member nothing can ever build.
      expect(declared.length, kind).toBeGreaterThan(0)
      for (const register of declared) expect(DIGEST_REGISTERS).toContain(register)
      // ⛔ **Never `unknown`**: what the ledger cannot answer is a gap, which carries the count a
      // line has no field for — `DIGEST_REGISTERS`' own stated reason for having no constructor.
      expect(declared).not.toContain('unknown')
    }
  })

  it('🔴 the constructors refuse the wrong kind IN SOURCE, and the fold spells no register itself', () => {
    // ⚠️ **A source census, and `438` wrote the first half of it over the fold.** ⛔ The second
    // half is over the shared module, and it is here because the two rumour routes `463` measured
    // are closed by TYPES — which `typecheck` proves and a test run cannot. A census is what makes
    // the closure visible to a suite, and to a mutation.
    const strip = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const fold = readFileSync(join(here, '../src/main/runtime/digest.ts'), 'utf8')
    const code = strip(fold)
    // ⚑ **The strip really stripped** — this file's own subject is prose, and a census over a
    // docblock that quotes what it retired asserts nothing. ⚠️ Two controls, because one of them
    // is the retired sentence itself: `HO-024` is the stable half, so the strip is still proven
    // the day somebody shortens the comment that records what `465` removed.
    expect(fold).toContain('HO-024')
    expect(code).not.toContain('HO-024')
    expect(fold).toContain('answered by a person')
    expect(code).not.toContain('answered by a person')
    expect(code).not.toMatch(/register:\s*'/)
    expect(code).toContain('observedLine(')
    expect(code).toContain('claimedLine(')
    // ⛔ **The sentence composer no longer has an arm for the claimed kind**, which used to be a
    // comment saying it was unreachable. The parameter type is what says it now.
    expect(code).not.toContain("case 'worker-reported':")
    expect(code).toContain('function sentence(kind: ObservedLineKind')

    const shared = strip(readFileSync(join(here, '../src/shared/digest.ts'), 'utf8'))
    // 🔴 **The narrowed constructors**, which is `463`'s first rumour route closed.
    expect(shared).toContain('  kind: ObservedLineKind,')
    expect(shared).toContain('  kind: ClaimedLineKind,')
    expect(shared).not.toMatch(/export function (observed|claimed)Line\([^)]*kind: DigestLineKind/)
    // ⛔ **The discriminated union**, which is the second route: one interface with a nullable
    // speaker is what let an object literal spell `register: 'claimed'` with `saidBy: null`.
    expect(shared).toContain('export type DigestLine = ObservedLine | ClaimedLine')
    expect(shared).toMatch(/readonly saidBy: null$/m)
    expect(shared).toMatch(/readonly saidBy: string$/m)
    expect(shared).not.toContain('saidBy: string | null')
  })

  it('⚑ a planted speaker DRAWS, and the same reading’s observation still has none', () => {
    // ⛔ **`toBe(null)` on an actor proves nothing if `null` is what an unset field already is.**
    // So the control is planted in the SAME reading: one row whose author the ledger does carry,
    // one row whose author it does not, and the two lines disagree about `saidBy`.
    const id = 'sess_both'
    store.create({
      id,
      provider: 'codex',
      cwd: root,
      approvalMode: 'ask',
      profileId: 'p',
    })
    at(id, INSIDE, { type: 'user_decision', requestId: 'r1', outcome: 'answered' })
    at(id, INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'the migration is in',
      resources: [],
    })

    const lines = digestOf().lines
    const observed = lines.find((one) => one.kind === 'request-answered')
    const claimed = lines.find((one) => one.kind === 'worker-reported')
    expect(claimed?.saidBy).toBe('both')
    expect(claimed?.register).toBe('claimed')
    expect(claimed?.text).toContain('both reported')
    expect(observed?.saidBy).toBeNull()
    expect(observed?.register).toBe('observed')
    // 🔴 **The divergence, said once**: the field exists, it is populated when a row names an
    // author, and the answered request is the row that names none.
    expect(claimed?.saidBy).not.toBe(observed?.saidBy)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one failure is not the failure shape — every observed sentence, from one reading
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 no OTHER observed sentence names a doer the row it stands for does not carry', () => {
    // Plant one row of every kind the fold draws and pin all eleven sentences, so any
    // invented actor is caught by the assertion.
    const id = 'sess_all'
    store.create({
      id,
      provider: 'codex',
      cwd: root,
      approvalMode: 'ask',
      profileId: 'p',
    })
    let when = INSIDE
    const row = (event: TranscriptEvent): void => at(id, when++, event)
    row({
      type: 'work_given',
      piece: 'work_1',
      label: 'W1.7',
      parent: 'work_root',
      givenBy: 'sess_brobot',
      title: 'the migration',
      brief: 'the work itself, which is never drawn',
    })
    row({ type: 'work_taken_back', piece: 'work_1', by: 'sess_brobot' })
    // ⚑ **D-016 · a close, on a piece of its own** — handed out before this window, so its line
    // names no piece, and no piece here is the subject of two endings.
    row({ type: 'work_closed', piece: 'work_3', by: 'sess_brobot' })
    // ⚑ **A person's take-back, on a piece of its own**, handed out before this window.
    row({ type: 'work_taken_back', piece: 'work_4', by: null })
    row({ type: 'request_routed', requestId: 'r_travelled', to: 'the-parent', parent: 'sess_up' })
    // ⚑ **611 · the THIRD routing outcome** (HO-088 §2) — `to: 'a-person'` with nothing refused,
    // which is an asker that addressed its question to the person.
    row({ type: 'request_routed', requestId: 'r_addressed', to: 'a-person', parent: 'sess_up' })
    row({
      type: 'request_routed',
      requestId: 'r_decision',
      to: 'a-person',
      parent: 'sess_up',
      because: 'a-permission-decision',
    })
    row({ type: 'request_escalated', requestId: 'r_travelled' })
    row({ type: 'request_stranded', requestId: 'r_lost' })
    row({ type: 'user_decision', requestId: 'r_travelled', outcome: 'answered' })
    row({ type: 'work_interrupted', by: 'a-person' })
    row({ type: 'work_restarted' })
    row({
      type: 'tool_refused',
      tool: 'give_work',
      rail: 'spawning-disabled',
      permanence: 'until-a-person-changes-it',
      retryable: false,
    })
    row({ type: 'turn', state: 'completed' })
    // ⚑ **466's kinds, one row each** — this audit is *"one row of every kind the fold draws"*.
    // ⚑ D-016 took the two proposal kinds out with proposals. ⛔ A tool answer needs the PAIR: a
    // call this app published and the receipt that answers it, in the same conversation.
    row({
      type: 'question_asked',
      requestId: 'r_named',
      piece: 'work_1',
      label: 'W1.7',
      prompt: 'the question itself, which is never drawn',
      questions: [],
    })
    // ⚠️ `list_tasks` rather than `list_agents`, and a summary with no actor word in it — the
    // audit below asks whether a sentence names a DOER, and a tool whose own name contains
    // `agent` would answer that question with its own spelling.
    row({ type: 'tool_call', id: 'call_1', name: 'brobot__list_tasks', summary: '' })
    row({ type: 'tool_result', id: 'call_1', summary: 'two open, one finished', ok: true })
    // ⚑ **475's one kind, and it needs the PAIR too**: a held message's ending says which work it
    // carried only because the give beside it names the same message. ⛔ Its own piece, because
    // `work_1` above is taken back and one piece of work must not be the subject of two endings in
    // a fixture whose whole point is one row of each kind.
    row({
      type: 'work_given',
      piece: 'work_2',
      label: 'W1.8',
      parent: 'work_root',
      givenBy: 'sess_brobot',
      title: 'the backups',
      brief: 'work handed to a busy child, which is never drawn',
      messageId: 'msg_held',
    })
    row({
      type: 'message_unqueued',
      messageId: 'msg_held',
      reason: 'abandoned',
      text: 'the words of the work, which are never drawn either',
    })

    const drawn = new Map(digestOf().lines.map((line) => [line.kind, line.text] as const))
    // ⛔ **Every observed kind reached**, or an absent line would make a missing sentence look
    // like a clean one — `an-unenumerated-state-counts-as-success`.
    const observedKinds = DIGEST_LINE_KINDS.filter((kind) =>
      (LINE_REGISTERS[kind] as readonly DigestRegister[]).includes('observed'),
    )
    expect([...drawn.keys()].sort()).toEqual([...observedKinds].sort())
    expect(Object.fromEntries(drawn)).toEqual({
      // ⚑ **Two, since `475`** — a held message's ending can only name work this window also saw
      // handed out, so the new kind's row brings a second give with it. ⚑ D-016 · a piece is named
      // by its label and title.
      'work-handed-out':
        '2 pieces of work were handed out — the most recent is W1.8 · the backups, to all.',
      'work-taken-back':
        '1 piece of work was taken back by whoever gave it — the most recent is W1.7 · the migration.',
      'work-taken-back-by-a-person':
        '1 piece of work was taken back by a person — the most recent is work handed out before ' +
        'this window.',
      'work-closed':
        '1 piece of work was closed by whoever gave it — the most recent is work handed out before ' +
        'this window.',
      'question-travelled': '1 question travelled to a parent.',
      // ⚑ **611 · it says WHO it was for and never who read it** (HO-028 §2).
      'question-addressed-to-a-person':
        '1 question was addressed to a person by the conversation that asked.',
      'decision-raised':
        '1 request came up that only a person can settle: 1 · a command or file approval, which ' +
        'is a person’s to give.',
      'question-escalated': '1 question ran past a deadline and reached a person.',
      'question-lost': '1 question was still open when the app last went away.',
      'request-answered': '1 request was answered. Nothing in the ledger records who answered it.',
      // 🔴 **709 · R43 — the row is the ASK**, and the turn line below is the provider's word: here
      // the one turn COMPLETED, so *"Work was stopped"* beside it was the relabel's sentence.
      'work-interrupted': 'Work was asked to stop 1 time.',
      'work-restarted':
        'The app restarted while 1 conversation still held work nobody had finished; that work ' +
        'is stalled until somebody drives it.',
      'tool-refused':
        '1 tool call was refused — the most recent was give_work, by the rail ' +
        'spawning-disabled. How long each is expected to hold: 1 · until somebody changes it.',
      'turn-ended': '1 turn ended — 1 completed.',
      'question-about-work':
        '1 question says which piece of work it is about — the most recent is W1.7.',
      'tool-answered':
        '1 call to this app’s own tools came back — the most recent was list_tasks answered: ' +
        'two open, one finished.',
      'work-not-sent':
        '1 held message carrying work was not sent — the most recent carried W1.8 · the backups.',
    })
    // ⚑ **The three sentences that DO name a party, and why each one may.** *"to a parent"* is
    // `RequestRoutedEvent.parent`, a field on the row; *"reached a person"* is this app's own act —
    // `escalationsDueNow` writes the row precisely because it put the question in a person's
    // queue, which is the app reporting what it did rather than who did it.
    expect(drawn.get('question-travelled')).toContain('a parent')
    expect(drawn.get('question-escalated')).toContain('a person')
    // ⚑ *"by a person"* is the row's own `by`, which names no conversation: a person took it back.
    expect(drawn.get('work-taken-back-by-a-person')).toContain('a person')
    // ⛔ **And the one row that DOES carry an actor is drawn without naming it** —
    // `WorkInterruptedEvent.by` is `'a-person' | 'an-agent'` and this sentence reads neither. That
    // is conservative rather than wrong, and it is a finding, not a fix: see `465` §8.
    expect(drawn.get('work-interrupted')).not.toContain('person')
    expect(drawn.get('work-interrupted')).not.toContain('agent')
    // 🔴 **466's kinds, asked the same question this file asks of the other eleven.** ⛔ Neither
    // names an actor at all (D-016 took the proposal kinds, the one that named its proposer).
    for (const kind of ['question-about-work', 'tool-answered'] as const) {
      expect(drawn.get(kind)).not.toContain('person')
      expect(drawn.get(kind)).not.toContain('agent')
      expect(drawn.get(kind)).not.toContain('brobot')
    }
    // ⛔ **And the question's words are nowhere**, which is the same rule one field over: an
    // `observed` line may not carry an agent's sentence.
    const everything = JSON.stringify([...drawn.values()])
    expect(everything).not.toContain('the question itself')
    expect(everything).not.toContain('the work itself')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · D-009 · a question one agent asked another by name
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ a question to a named agent is not a request only a person can settle', async () => {
    // A peer question routed `to: 'an-agent'` carries no refusal and must not be counted as a
    // person-only channel refusal or acquire an absent reason. Pair it with a real refusal in
    // the same window, whose count and reasons remain stable. This test does not specify how
    // peer questions themselves are counted. Read the digest after routing has settled: the
    // recipient was opened by a person, so its question turn parks the card in that window
    // without writing further routing. A started recipient could introduce a refusal after
    // the digest is read.
    const seeded = await host.createSession(
      {
        provider: 'claude',
        profileId: 'peer-refused',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    await host.close(seeded.sessionId, window)
    const asker = await host.createSession(
      {
        provider: 'claude',
        profileId: 'peer-asker',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const askerTools = agentToolsFor(host, asker.sessionId)
    const spawned = await callOn(askerTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'peer-refused',
      title: 'hold a card',
      brief: 'hold a card only a person can settle',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const child = spawned.agent as string
    const childHandle = handles.at(-1)
    if (childHandle === undefined) throw new Error('the spawned agent received no provider handle')
    const eventsOf = (sessionId: string): TranscriptEvent[] =>
      store.events(sessionId).map(({ event }) => event)
    const routingIn = (sessionId: string, requestId: string): TranscriptEvent | undefined =>
      eventsOf(sessionId).find(
        (event) => event.type === 'request_routed' && event.requestId === requestId,
      )

    // ⚑ **The control** — a permission the spawned agent's provider raises, which the channel
    // refuses by name.
    void childHandle.simulatePermission('perm_peer', {
      action: 'Bash',
      detail: 'run: ls',
      availableDecisions: ['allow', 'deny'],
    })
    await waitFor(
      () => routingIn(child, 'perm_peer') !== undefined,
      'the permission to be refused the channel',
    )
    expect(routingIn(child, 'perm_peer')).toMatchObject({ because: 'a-permission-decision' })
    // ⚑ **D-016 · and the give's brief is that agent's first turn**, which in `ask` parks on its
    // OWN card — a permission the channel refuses the same way, so it is a second request of the
    // same reason, from a row that earns it.
    await waitFor(
      () =>
        eventsOf(child).filter(
          (event) =>
            event.type === 'request_routed' &&
            event.requestId !== 'perm_peer' &&
            event.because === 'a-permission-decision',
        ).length === 1,
      'the brief’s own card to be refused the channel',
    )

    // ⚑ **The one asked** — a conversation a person opened from a window.
    const named = await host.createSession(
      {
        provider: 'claude',
        profileId: 'peer-named',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )

    // ⚑ **The subject** — the asker asks that agent by name, through D-009's door.
    const question = await callOn(askerTools, 'ask_question', {
      who_answers: 'an-agent',
      agent: named.sessionId,
      question: 'which schema do you use?',
    })
    expect(question.outcome, JSON.stringify(question)).toBe('ok')
    const id = question.question as string
    // ⛔ **The premise, off the ledger**: the routing names the agent and carries no refusal.
    expect(routingIn(asker.sessionId, id)).toEqual({
      type: 'request_routed',
      requestId: id,
      to: 'an-agent',
      parent: named.sessionId,
    })
    // ⛔ **Settled before it is read**: the question reached the one asked, started its turn, and
    // that turn parked on its own card in the person's window. ⚠️ It had no turn before this one,
    // so its only card is this turn's.
    await waitFor(
      () =>
        eventsOf(named.sessionId).some(
          (event) =>
            (event.type === 'user_turn' || event.type === 'message_queued') &&
            event.text.includes(id),
        ) &&
        window.messages.some(
          (message) =>
            message.sessionId === named.sessionId && message.event.type === 'permission_request',
        ),
      'the question to start the named agent’s turn, and its card to reach the person’s window',
    )
    // ⚑ **D-017 · R19 — that card is written down as a PERSON's**: the one asked is a conversation
    // nobody spawned, so its card has no channel and is a person's, with its reason and no parent.
    // ⛔ It is the one asked's own card and not the question: the question is routed to the AGENT.
    const card = window.messages.find(
      (message) =>
        message.sessionId === named.sessionId && message.event.type === 'permission_request',
    )?.event
    if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
    await waitFor(
      () => routingIn(named.sessionId, card.id) !== undefined,
      'the routing of the named agent’s own card',
    )
    expect(eventsOf(named.sessionId).filter((event) => event.type === 'request_routed')).toEqual([
      {
        type: 'request_routed',
        requestId: card.id,
        to: 'a-person',
        because: 'a-permission-decision',
      },
    ])

    const lines = digestOf().lines
    // 🔴 **The requests only a person can settle are the three permissions — the control's, the
    // brief's own card (⚑ D-016), and (⚑ D-017 · R19) the named agent's own card — and the question
    // is not among them**: all carry the one reason a permission has, and a question to an agent
    // would be a fourth.
    expect(lines.find((one) => one.kind === 'decision-raised')).toMatchObject({
      register: 'observed',
      count: 3,
      text:
        '3 requests came up that only a person can settle: 3 · a command or file approval, which ' +
        'is a person’s to give.',
    })
    // ⛔ **Nor was it addressed to a person** — the asker named an agent.
    expect(lines.find((one) => one.kind === 'question-addressed-to-a-person')).toBeUndefined()
    // ⛔ **And no reason nobody gave**: an unknown word is drawn as the fallback sentence.
    const everything = JSON.stringify(lines)
    expect(everything).not.toContain('undefined')
    expect(everything).not.toContain('of a kind this app has not been taught')
  })
})
