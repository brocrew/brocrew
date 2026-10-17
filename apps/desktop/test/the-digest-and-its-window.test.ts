import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type DigestRow, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { distil } from '../src/main/runtime/digest'
import {
  DIGEST_EVENT_TYPES,
  DIGEST_REGISTERS,
  WINDOW_WAS_CHOSEN,
  type DigestGapKind,
} from '../src/shared/digest'

/**
 * 🔴 **438 · HO-025 criteria 16, 18 and 19 — the digest, its window, and how it knows.**
 *
 * > ⛔ HO-024 §5.1: *"An outcome an agent declared is the agent's claim… it may never restate a
 * > claim as an observation."*
 * > ⛔ HO-024 §5.3: *"A digest that omits an unanswerable thing is worse than one that names it."*
 * > ⛔ HO-024 §5.4: *"Regenerate it from the ledger and get the same digest."*
 *
 * ## ⚠️ Why a real database and not a fixture list of rows
 *
 * ⛔ **The window is SQL**, and so is the generation, and so is the agent binding. A fold handed
 * a list cannot put back a row the statement did not return, so a test that plants rows in
 * TypeScript would measure the half of this that cannot be wrong. §5 and §7 are the two that only
 * a database can answer.
 *
 * ## ⛔ What this file does NOT test
 *
 * ⚠️ The surface — `digest-card.render.test.ts` owns the register chips and the withholding; the
 * dom test owns the layout. What is here is the fold, the read, and the three properties the
 * criteria name.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000
const TO = 1_800_000_000_000
const FROM = TO - 12 * HOUR
/** Comfortably inside the window, and not on either boundary. */
const INSIDE = TO - HOUR

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-438-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A conversation an agent of this app holds, so the digest's join can reach it. */
function conversation(id: string): void {
  store.create({
    id,
    provider: 'codex',
    cwd: dir,
    approvalMode: 'ask',
    profileId: 'd',
  })
}

let ordinals = new Map<string, number>()
beforeEach(() => {
  ordinals = new Map()
})

/** Append one event, allocating the session's next ordinal so a test never has to count. */
function at(id: string, when: number, event: Parameters<SessionStore['append']>[2]): void {
  const next = ordinals.get(id) ?? 0
  ordinals.set(id, next + 1)
  store.append(id, next, event, when)
}

/** The fold, over the read — exactly what `RuntimeHost.digest` does. */
function digestOf(from = FROM, to = TO): ReturnType<typeof distil> {
  return distil(store.digestWindow(from, to), (id) => id.replace('sess_', ''))
}

const gapKinds = (gaps: readonly { kind: DigestGapKind }[]): DigestGapKind[] =>
  gaps.map((gap) => gap.kind)

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · criterion 18 · every line carries its register, and the two registers behave differently
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · a line cannot be drawn without saying how it is known', () => {
  it('🔴 THE CRITERION: every line the fold produces carries a register from the closed vocabulary', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_a', INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'migrated the invoice table',
      resources: [],
    })
    at('sess_a', INSIDE + 2, { type: 'work_restarted' })

    const { lines } = digestOf()
    expect(lines.length).toBeGreaterThan(0)
    // ⛔ **Not `every(line => line.register !== undefined)`** — that passes on a typo. The register
    // has to be a MEMBER, and the vocabulary is the only list it may come from.
    for (const line of lines) expect(DIGEST_REGISTERS).toContain(line.register)
  })

  it('⛔ an observation has no author and a claim always has one', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_a', INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'blocked',
      summary: 'the migration needs a password',
      resources: [],
    })

    const { lines } = digestOf()
    const observed = lines.filter((line) => line.register === 'observed')
    const claimed = lines.filter((line) => line.register === 'claimed')
    expect(observed.length).toBeGreaterThan(0)
    expect(claimed).toHaveLength(1)
    // ⚑ **The engine watched it, so nobody said it.** A `saidBy` on an observation would be this
    // app attributing its own reading to an agent.
    for (const line of observed) expect(line.saidBy).toBeNull()
    // ⛔ **A claim with no speaker is a rumour**, and `claimedLine`'s signature is what stops one.
    expect(claimed[0]?.saidBy).toBe('a')
    expect(claimed[0]?.text).toContain('the migration needs a password')
  })

  it('🔴 observations GROUP and claims do not — because two claims are not interchangeable', () => {
    conversation('sess_a')
    for (let n = 0; n < 4; n++) at('sess_a', INSIDE + n, { type: 'turn', state: 'completed' })
    at('sess_a', INSIDE + 10, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'FIRST REPORT',
      resources: [],
    })
    at('sess_a', INSIDE + 20, {
      type: 'work_replied',
      piece: 'work_2',
      outcome: 'failed',
      summary: 'SECOND REPORT',
      resources: [],
    })

    const { lines } = digestOf()
    const turns = lines.filter((line) => line.kind === 'turn-ended')
    const reports = lines.filter((line) => line.kind === 'worker-reported')
    // ⚑ Four rows, ONE line, count four — an observation's instances say nothing separately.
    expect(turns).toHaveLength(1)
    expect(turns[0]?.count).toBe(4)
    expect(turns[0]?.text).toBe('4 turns ended — 4 completed.')
    // ⛔ Two claims, TWO lines, and both sentences survive. Collapsing them into "2 workers
    // reported" would throw away the only content a person reads this instead of a transcript for.
    expect(reports).toHaveLength(2)
    expect(reports.map((line) => line.count)).toEqual([1, 1])
    const said = reports.map((line) => line.text).join(' ')
    expect(said).toContain('FIRST REPORT')
    expect(said).toContain('SECOND REPORT')
  })

  it('⚑ observations come before claims, which is HO-001’s provenance ordering', () => {
    conversation('sess_a')
    // ⚠️ **The claim is planted FIRST in the ledger**, so an order that merely followed the rows
    // would put it first and this would pass for the wrong reason.
    at('sess_a', INSIDE, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'done first',
      resources: [],
    })
    at('sess_a', INSIDE + 1, { type: 'turn', state: 'completed' })

    const registers = digestOf().lines.map((line) => line.register)
    expect(registers).toEqual(['observed', 'claimed'])
  })

  it('🔴 a `turn` state this build cannot read is COUNTED, so the breakdown adds up to itself', () => {
    conversation('sess_a')
    for (let n = 0; n < 3; n++) at('sess_a', INSIDE + n, { type: 'turn', state: 'completed' })
    // ⛔ **Reachable through a cast**: `toPersistedEvents` does `JSON.parse(...) as
    // TranscriptEvent`, so an imported ledger or a later build's fourth member arrives unchecked.
    // ⚠️ Indexing a three-slot record with it set `NaN` on a key nothing read and dropped the row
    // out of a breakdown that still counted it.
    at('sess_a', INSIDE + 9, { type: 'turn', state: 'aborted' } as never)

    const line = digestOf().lines.find((one) => one.kind === 'turn-ended')
    expect(line?.count).toBe(4)
    expect(line?.text).toBe('4 turns ended — 3 completed, 1 this app could not read.')
    expect(line?.text).not.toContain('NaN')
  })

  it('⛔ a restart is drawn as what the row MEANS — work nobody is driving, not work that came back', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'work_restarted' })
    // ⚠️ **Two rows, one conversation**: `settleRestartedWork` writes one per conversation per
    // launch, so a count of ROWS would name more conversations than exist.
    at('sess_a', INSIDE + 1, { type: 'work_restarted' })

    const line = digestOf().lines.find((one) => one.kind === 'work-restarted')
    expect(line?.text).toBe(
      'The app restarted while 1 conversation still held work nobody had finished; that work is ' +
        'stalled until somebody drives it.',
    )
    // ⛔ The sentence this replaced said the opposite of the row it is drawn from.
    expect(line?.text).not.toContain('came back')
    expect(line?.register).toBe('observed')
  })

  it('⛔ the fold has no line constructor other than the three that take a register', () => {
    // ⚠️ **A source census, and it is the structural half of this criterion.** The behavioural
    // tests above can only see the lines the fold chose to build; this sees whether a fourth way
    // to build one exists at all.
    const source = readFileSync(join(here, '../src/main/runtime/digest.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // ⚑ **The strip really stripped**, or the negatives below are asserted over prose that
    // happens to quote the constructors (`a-source-census-must-strip-prose-before-it-asserts`).
    expect(source).toContain('HO-024')
    expect(code).not.toContain('HO-024')
    // ⛔ Every line is built by one of the three, and no object literal spells `register:` itself.
    expect(code).not.toMatch(/register:\s*'/)
    expect(code).toContain('observedLine(')
    expect(code).toContain('claimedLine(')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · criterion 18 · the gaps are rendered, and each one is conditional on its own rows
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · where it does not know, it says so — and only then', () => {
  it('⛔ a worker’s outcome is always flagged unverified', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'all green',
      resources: [],
    })
    const { gaps } = digestOf()
    expect(gapKinds(gaps)).toContain('unverified-outcome')
    expect(gaps.find((gap) => gap.kind === 'unverified-outcome')?.says).toContain(
      'Nothing in this app checked one',
    )
  })

  it('🔴 a report about work handed out BEFORE the window says it cannot name the work', () => {
    conversation('sess_a')
    // ⛔ **The assignment is outside the window and the reply is inside it** — `432`'s carry-in
    // limit, arriving as a gap instead of as a confident sentence about the wrong task.
    at('sess_a', FROM - HOUR, {
      type: 'work_given',
      piece: 'work_1',
      label: 'W1.14',
      parent: 'work_root_pm',
      givenBy: 'sess_pm',
      title: 'do the thing',
      brief: 'do the thing',
    })
    at('sess_a', INSIDE, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'finished it',
      resources: [],
    })

    const { lines, gaps } = digestOf()
    expect(gapKinds(gaps)).toContain('carried-in')
    expect(lines.find((line) => line.kind === 'worker-reported')?.text).toContain(
      'work it was given before this window',
    )
    // ⚑ **The paired positive**: with the give INSIDE the window the label is named and the gap
    // is gone, so this is a window property rather than a missing feature.
    const wide = distil(store.digestWindow(FROM - 2 * HOUR, TO), (id) => id)
    expect(gapKinds(wide.gaps)).not.toContain('carried-in')
    expect(wide.lines.find((line) => line.kind === 'worker-reported')?.text).toContain('W1.14')
  })

  it('🔴 437 · a question that NAMES its task closes the "which work" gap; a provider-raised one does not', () => {
    conversation('sess_a')
    // `437`'s `ask_parent` writes both rows, and `question_asked` is the only row in this app that
    // says which piece of work a question is about.
    at('sess_a', INSIDE, {
      type: 'question_asked',
      requestId: 'req_asked',
      piece: 'work_1',
      prompt: 'which database?',
      questions: [],
    })
    at('sess_a', INSIDE + 1, {
      type: 'request_routed',
      requestId: 'req_asked',
      to: 'the-parent',
      parent: 'sess_pm',
    })
    const named = digestOf()
    expect(gapKinds(named.gaps)).not.toContain('question-without-work')

    // ⛔ **And a provider-raised question has no such row**, so the gap is drawn for it. This is
    // the half of `430`'s fifth renderable unknown that survived `437`.
    conversation('sess_b')
    at('sess_b', INSIDE, {
      type: 'request_routed',
      requestId: 'req_provider',
      to: 'the-parent',
      parent: 'sess_pm',
    })
    const both = digestOf()
    const hole = both.gaps.find((gap) => gap.kind === 'question-without-work')
    expect(hole?.count).toBe(1)
  })

  it('⛔ "open" is reported as nothing-ended-it, never as somebody-is-waiting', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'request_routed',
      requestId: 'req_1',
      to: 'the-parent',
      parent: 'sess_pm',
    })
    const open = digestOf()
    expect(open.gaps.find((gap) => gap.kind === 'open-is-not-waiting')?.says).toContain(
      'never that somebody is still waiting',
    )

    // ⚑ **The paired positive**: a routing this window also saw answered is not in the gap.
    conversation('sess_b')
    at('sess_b', INSIDE, {
      type: 'request_routed',
      requestId: 'req_2',
      to: 'the-parent',
      parent: 'sess_pm',
    })
    at('sess_b', INSIDE + 1, { type: 'user_decision', requestId: 'req_2', outcome: 'answered' })
    expect(digestOf().gaps.find((gap) => gap.kind === 'open-is-not-waiting')?.count).toBe(1)
  })

  it('🔴 a person pressing STOP ends the requests, and the digest reads the endings it is looking at', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'request_routed',
      requestId: 'req_1',
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_pm',
    })
    // ⛔ **`askTheWorkToStop`'s own shape**: one `work_interrupted`, then one
    // `request_interrupted` per open request, at adjacent ordinals in the same window.
    at('sess_a', INSIDE + 1, { type: 'work_interrupted', by: 'a-person' })
    at('sess_a', INSIDE + 2, { type: 'request_interrupted', requestId: 'req_1' })

    const { lines, gaps } = digestOf()
    expect(lines.find((line) => line.kind === 'work-interrupted')).toBeDefined()
    // ⚠️ **The defect this replaced**: the card drew *"work was stopped"* beside *"nothing in
    // this window ended one"*, with the ending three ordinals away in the same window.
    expect(gapKinds(gaps)).not.toContain('open-is-not-waiting')
  })

  it('⛔ a provider WITHDRAWING a request ends it too — and that row is keyed `id`, not `requestId`', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'request_routed',
      requestId: 'req_1',
      to: 'the-parent',
      parent: 'sess_pm',
    })
    at('sess_a', INSIDE + 1, { type: 'request_resolved', id: 'req_1' })
    expect(gapKinds(digestOf().gaps)).not.toContain('open-is-not-waiting')
  })

  it('🔴 a PERMISSION never asks *which work*, so the gap that cannot be closed is not drawn for one', () => {
    conversation('sess_a')
    // ⛔ A request refused the channel never travelled and has no task to name. Counting it in
    // `question-without-work` fired that gap on every permission in every window, for ever —
    // which is the *"a gap on every project every time"* state HO-025 §5.3 calls a design fault.
    at('sess_a', INSIDE, {
      type: 'request_routed',
      requestId: 'req_perm',
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_pm',
    })
    const { lines, gaps } = digestOf()
    expect(lines.find((line) => line.kind === 'decision-raised')).toBeDefined()
    expect(gapKinds(gaps)).not.toContain('question-without-work')
  })

  it('⛔ a refusal says the target is not recorded, because the row deliberately omits it', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'tool_refused',
      tool: 'spawn_agent',
      rail: 'spawn-must-prompt',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
    })
    const { lines, gaps } = digestOf()
    expect(lines.find((line) => line.kind === 'tool-refused')?.text).toContain(
      'spawn_agent, by the rail spawn-must-prompt',
    )
    expect(gapKinds(gaps)).toContain('collision-target')
  })

  it('🔴 a window with nothing unanswerable in it shows NO gaps at all', () => {
    // ⛔ **HO-025 §5.3's test, made checkable.** *"If your digest shows a gap on every project
    // every time, something is wrong with the design rather than with the ledger."* Every gap
    // here is conditional on rows the window contains; the one permanent limit is a property of
    // the WINDOW and lives on the reading's `limit`, not among the digest's gaps.
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_a', INSIDE + 1, { type: 'work_interrupted', by: 'a-person' })
    const { lines, gaps } = digestOf()
    expect(lines.length).toBeGreaterThan(0)
    expect(gaps).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · native fan-out is coverage, never a total
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · tokens reported for observed native fan-out', () => {
  it('🔴 the MAXIMUM per child, never a sum of progress frames', () => {
    conversation('sess_a')
    // ⚠️ **`430`'s measured control, replanted**: Claude re-sends one child's cumulative total.
    // Summing the frames reports 15,941 for a child that spent 8,944.
    at('sess_a', INSIDE, {
      type: 'sub_agent',
      agentId: 'child_1',
      phase: 'progress',
      usage: { tokens: 6_997 },
    })
    at('sess_a', INSIDE + 1, {
      type: 'sub_agent',
      agentId: 'child_1',
      phase: 'ended',
      usage: { tokens: 8_944 },
    })
    const { fanOut } = digestOf()
    expect(fanOut.tokens).toBe(8_944)
    expect(fanOut.tokens).not.toBe(15_941)
    expect(fanOut.children).toBe(1)
    expect(fanOut.reported).toBe(1)
  })

  it('⛔ children with no reading are COUNTED, and never imputed as zero', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'sub_agent',
      agentId: 'child_1',
      phase: 'ended',
      usage: { tokens: 100 },
    })
    at('sess_a', INSIDE + 1, { type: 'sub_agent', agentId: 'child_2', phase: 'ended' })
    at('sess_a', INSIDE + 2, { type: 'sub_agent', agentId: 'child_3', phase: 'started' })
    const { fanOut } = digestOf()
    expect(fanOut).toEqual({ children: 3, reported: 1, missing: 2, tokens: 100 })
  })

  it('⛔ the missing-usage gap is scoped to the WINDOW, because a child may have reported outside it', () => {
    conversation('sess_a')
    // ⚠️ **The reachable shape**: Claude's ending frame is `task_updated {task_id, patch}` and
    // carries no usage at all, so a child that reported 8,944 tokens two minutes before `from`
    // and ended inside the window is seen here reporting nothing.
    at('sess_a', FROM - 120_000, {
      type: 'sub_agent',
      agentId: 'child_1',
      phase: 'progress',
      usage: { tokens: 8_944 },
    })
    at('sess_a', INSIDE, { type: 'sub_agent', agentId: 'child_1', phase: 'ended' })

    const { fanOut, gaps } = digestOf()
    expect(fanOut).toEqual({ children: 1, reported: 0, missing: 1, tokens: null })
    const hole = gaps.find((gap) => gap.kind === 'native-usage-incomplete')
    // ⛔ **The module's own rule — *say what was not seen, never what did not happen*** — and the
    // first wording of this sentence broke it by one word: *"reported no usage at all"* is an
    // absolute stated from a window.
    expect(hole?.says).toContain('INSIDE this window')
    expect(hole?.says).toContain('before the window is not in this number')
    expect(hole?.says).not.toContain('no usage at all')
  })

  it('⛔ no child reported anything: the reading is NULL, because zero is a claim about spend', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'sub_agent', agentId: 'child_1', phase: 'ended' })
    expect(digestOf().fanOut.tokens).toBeNull()
  })

  it('🔴 a workflow’s own usage is NEVER added to its roster — one spend, two descriptions', () => {
    conversation('sess_a')
    // ⚠️ **The repo's own fixture shape**: `usage.total_tokens` and the single roster agent carry
    // the SAME 7,718, produced from one frame. Adding both reports 15,436 for a run that spent
    // 7,718.
    at('sess_a', INSIDE, {
      type: 'workflow_run',
      taskId: 'wf_1',
      source: 'task_progress',
      usage: { tokens: 7_718 },
      agents: [{ agentId: 'a1', label: 'one', phaseIndex: 0, state: 'done', tokens: 7_718 }],
    })
    const { fanOut } = digestOf()
    expect(fanOut.children).toBe(1)
    expect(fanOut.tokens).toBe(7_718)
    expect(fanOut.tokens).not.toBe(15_436)
  })

  it('⛔ context occupancy is not spend, and a rate-limit percentage is not tokens', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, {
      type: 'sub_agent',
      agentId: 'child_1',
      phase: 'ended',
      usage: { tokens: 500 },
    })
    // ⚠️ **`430` refused both of these by name.** `context_reading.reading.used` is how full a
    // context is; a rate-limit notice carries percentages. Neither is a child's billing.
    at('sess_a', INSIDE + 1, {
      type: 'context_reading',
      reading: { kind: 'tokens', used: 120_000 },
      source: 'message_start',
    })
    at('sess_a', INSIDE + 2, { type: 'error', message: 'primary limit 97% used', fatal: false })
    expect(digestOf().fanOut.tokens).toBe(500)
    // ⚑ **And the structural reason it cannot leak in**: neither type is in the read's vocabulary,
    // so the row never reaches the fold at all.
    expect(DIGEST_EVENT_TYPES).not.toContain('context_reading')
    const read = store.digestWindow(FROM, TO)
    expect(read.rows.map((row) => row.event.type)).toEqual(['sub_agent'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · criterion 19 · derived, never stored
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · regenerate it and get the same digest', () => {
  it('🔴 two reads of one unchanged ledger are byte-identical', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'failed' })
    at('sess_a', INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'failed',
      summary: 'it broke',
      resources: [],
    })
    at('sess_a', INSIDE + 2, {
      type: 'tool_refused',
      tool: 'apply_patch',
      rail: 'cwd-outside-project',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
    })
    expect(digestOf()).toEqual(digestOf())
  })

  it('⚑ and it is not frozen: one more row and the digest moves', () => {
    // ⛔ **The control the equality above needs.** A fold that returned a constant would satisfy
    // *"the same digest twice"* perfectly.
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    const before = digestOf()
    at('sess_a', INSIDE + 1, { type: 'turn', state: 'interrupted' })
    const after = digestOf()
    expect(after).not.toEqual(before)
    expect(after.lines.find((line) => line.kind === 'turn-ended')?.text).toBe(
      '2 turns ended — 1 completed, 1 interrupted.',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · criterion 16 · the window is a window
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the window covers what it says and nothing else', () => {
  it('🔴 half-open: a row AT `from` is in, a row AT `to` is out', () => {
    conversation('sess_a')
    at('sess_a', FROM - 1, { type: 'turn', state: 'completed' })
    at('sess_a', FROM, { type: 'turn', state: 'failed' })
    at('sess_a', TO - 1, { type: 'turn', state: 'interrupted' })
    at('sess_a', TO, { type: 'turn', state: 'completed' })

    // ⛔ **Two adjacent windows must not both hold a row stamped on the boundary**, or a person
    // reading yesterday and then today counts one turn twice.
    expect(digestOf().lines.find((line) => line.kind === 'turn-ended')?.text).toBe(
      '2 turns ended — 1 failed, 1 interrupted.',
    )
  })

  it('⛔ a row older than the window is gone, however much of it there is', () => {
    conversation('sess_a')
    for (let n = 0; n < 50; n++)
      at('sess_a', FROM - n * 1_000 - 1, { type: 'turn', state: 'completed' })
    expect(digestOf().lines).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · the read shape — the SQL, the vocabulary and the fold move together
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · the statement, censused', () => {
  const storeSource = readFileSync(join(here, '../src/main/db/session-store.ts'), 'utf8')

  /** The one extractor this census reads the shipped statement with. */
  function statement(name: string): string {
    const start = storeSource.indexOf(`const ${name} = db.prepare(`)
    expect(start, `${name} is not declared where this census looks`).toBeGreaterThan(-1)
    const open = storeSource.indexOf('`', start)
    const close = storeSource.indexOf('`', open + 1)
    expect(close, `${name}'s SQL is not one template literal`).toBeGreaterThan(open)
    return storeSource.slice(open + 1, close)
  }

  it('🔴 the digest SQL is ONE flat literal, so this census reads the shipped string', () => {
    const sql = statement('selectDigestWindow')
    // ⚑ Non-vacuity: an extractor that returned '' would make every negative below pass.
    expect(sql.toLowerCase()).toContain('where s.agent_identity_id is not null')
    expect(sql.toLowerCase()).toContain('join events e')
    // ⛔ **No interpolation.** `indexOf('`')` stops at the first backtick, so a `${…}` anywhere in
    // this statement would hand the census a fragment and a very good match.
    expect(sql).not.toContain('${')
    // ⚑ The positive control on that check: the pattern really does fire on a string that has one.
    expect('SELECT ${types} FROM events').toContain('${')
  })

  it('⛔ the SQL type list and `DIGEST_EVENT_TYPES` are the same set', () => {
    // ⚠️ **`selectPieceEvents`' rule, inherited**: a type the fold branches on and the statement
    // omits reads as *"that event never happened"* — silently, and only on the replayed path.
    const sql = statement('selectDigestWindow')
    const inList = sql.slice(sql.indexOf('e.type IN ('))
    const spelled = [...inList.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
    expect(spelled.length).toBeGreaterThan(0)
    expect([...spelled].sort()).toEqual([...DIGEST_EVENT_TYPES].sort())
  })

  it('⛔ every type the fold branches on is a type the statement selects', () => {
    const fold = readFileSync(join(here, '../src/main/runtime/digest.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const branches = [...fold.matchAll(/^\s*case '([a-z_]+)':/gm)].map((match) => match[1])
    // ⚑ The census can see more than one arm — a positive control on the pattern itself.
    expect(branches.length).toBeGreaterThan(5)
    for (const branch of branches) expect(DIGEST_EVENT_TYPES).toContain(branch)
    // 🔴 **The OTHER direction, which is the one that loses rows** — and the one the first
    // version of this census did not check. A vocabulary member with no arm is still selected by
    // the SQL, still widens the scan the cost claim rests on, and falls into `default`
    // contributing nothing: `selectPieceEvents`' *"that event never happened, silently"*, seen
    // from the side nobody was watching.
    for (const type of DIGEST_EVENT_TYPES) expect(branches).toContain(type)
  })

  it('⛔ the statement carries no LIMIT, and its only clock is the window it was given', () => {
    const sql = statement('selectDigestWindow')
    expect(sql.toLowerCase()).not.toContain('limit')
    // ⚠️ **Exactly two bounds on `created_at`, which are the two the caller passed.** A third
    // would be a window the caller did not choose.
    expect([...sql.matchAll(/created_at\s*(>=|<|<=|>)/g)]).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §7 · what the read can and cannot reach
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§7 · the read is scoped to agents’ conversations, the generation, and says what it misses', () => {
  it('🔴 a rebuilt conversation’s superseded rows are not in the window', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    // ⛔ **Generation 0's row is still in the table and still in the window by its stamp.** Only
    // the correlated `derived_generation` lookup keeps it out, and without it the same work is
    // counted twice.
    const generation = store.beginGeneration('sess_a')
    store.appendGeneration('sess_a', generation, [
      { ordinal: 0, at: INSIDE, event: { type: 'turn', state: 'failed' } },
    ])
    store.promoteGeneration('sess_a', generation, { normalizerVersion: 1, derivedThrough: 0 })

    const rows: readonly DigestRow[] = store.digestWindow(FROM, TO).rows
    expect(rows).toHaveLength(1)
    expect(digestOf().lines.find((line) => line.kind === 'turn-ended')?.text).toBe(
      '1 turn ended — 1 failed.',
    )
  })

  it('⚠️ a conversation no agent holds is COUNTED, so its absence is visible', () => {
    conversation('sess_a')
    expect(store.conversationsHeldByNoAgent()).toBe(0)
    // A conversation swept out of the user's own provider home has no profile of ours.
    store.adopt({
      id: 'sess_adopted',
      provider: 'claude',
      sessionId: 'ext_1',
      cwd: dir,
      // ⛔ **Null is not *unknown***: it is the statement that no home of OURS holds this
      // conversation, which is exactly the class `agent_identity_id IS NOT NULL` cannot reach.
      profileId: null,
      updatedAt: INSIDE,
      createdAt: INSIDE,
    })
    expect(store.conversationsHeldByNoAgent()).toBe(1)
    // ⛔ **And it really is outside the digest** — the count is the disclosure, not a hint.
    at('sess_adopted', INSIDE, { type: 'turn', state: 'completed' })
    expect(digestOf().lines).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §8 · the host · one reading, and the two sentences only it can attach
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ **This section exists because two mutation rows SURVIVED without it** (`438` M18, M19).
 *
 * ⚠️ Every property above is asserted against the store read and the pure fold, which is where
 * they belong — and it left the layer that composes them untested: the window it echoes back,
 * the standing limit it attaches, the one read it folds, and the coverage count. ⛔ *A line no
 * mutation can kill is not carrying its rule*, so the rows were kept and this was written rather
 * than the other way round.
 */
describe('§8 · RuntimeHost.digest composes the reading', () => {
  function aHost(): RuntimeHost {
    const userData = mkdtempSync(join(tmpdir(), 'brobot2-438-host-'))
    const sessions = new FakeProviderSessions()
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => join(userData, 'resources'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_host_${String(++counter)}`,
      now: () => TO,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  it('🔴 the window is echoed back EXACTLY as it was asked for, and the standing limit is on it', () => {
    const reading = aHost().digest(FROM, TO)
    // ⛔ Criterion 16 is *covers a window AND names the window it covers*. A reading that
    // silently widened or moved the span would make the card's own sentence false about it.
    expect(reading.window).toEqual({ from: FROM, to: TO })
    // ⚠️ **`430` searched the schema, the IPC surface and the renderer for a durable last-view
    // marker and found none**, so this sentence is the one thing standing between the card and
    // *"while you were away"*.
    expect(reading.limit.says).toBe(WINDOW_WAS_CHOSEN)
    expect(reading.limit.says).toContain('chosen here')
  })

  it('⛔ a window wider than the read will scan is REFUSED, not answered', () => {
    // ⛔ **The statement carries no `LIMIT` and `events.created_at` has no index**, so a span IS
    // the scan bound. `digest(0, Date.now())` validates cleanly at the wire — `z.number().int()`
    // has no maximum and a `.refine` cannot live in a discriminated union — and would walk every
    // digest-eligible row of every conversation into main-process memory.
    expect(() => aHost().digest(0, TO)).toThrow(/span at most/)
    // ⚑ …and a reversed window is refused too, rather than answered with a confident emptiness.
    expect(() => aHost().digest(TO, FROM)).toThrow(/must end after it starts/)
    // ⚠️ **The paired positive**: the widest span the surface offers is seven days and it passes.
    expect(() => aHost().digest(TO - 7 * 24 * HOUR, TO)).not.toThrow()
  })

  it('⚑ the cost is measured with a clock that can SEE a sub-millisecond read', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    const reading = aHost().digest(FROM, TO)
    // ⛔ **`Date.now()` reported `0 ms` on every database this app will ever hold** — a probe
    // measured 0.12 ms per read on a 20 MiB ledger — so the one number the card offers as
    // criterion 19's evidence could not move. A figure that cannot move is not evidence.
    expect(Number.isFinite(reading.cost.totalMs)).toBe(true)
    expect(reading.cost.totalMs).toBeGreaterThan(0)
  })

  it('⛔ `sessions` counts the conversations the READ covered, not the ones there are', () => {
    conversation('sess_quiet')
    conversation('sess_busy')
    // Only one of the two produced anything the digest reads, inside the window.
    at('sess_busy', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_quiet', FROM - HOUR, { type: 'turn', state: 'completed' })

    const { digest } = aHost().digest(FROM, TO)
    // ⚠️ **One, not two** — and the surface says *in this window* beside it, because on its own
    // the number reads as a fact about every conversation.
    expect(digest.sessions).toBe(1)
  })

  it('⚠️ a conversation no agent holds is counted on the reading, because no digest covers it', () => {
    store.adopt({
      id: 'sess_adopted',
      provider: 'claude',
      sessionId: 'ext_1',
      cwd: dir,
      profileId: null,
      updatedAt: INSIDE,
      createdAt: INSIDE,
    })
    expect(aHost().digest(FROM, TO).heldByNoAgent).toBe(1)
  })

  it('🔴 the whole reading regenerates identically — cost excluded, because cost is a clock', () => {
    conversation('sess_a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    const host = aHost()
    const first = host.digest(FROM, TO)
    const second = host.digest(FROM, TO)
    // ⛔ **`digest` is the derived part and `cost` is not**, which is why they are separate
    // fields: comparing the whole object would be comparing a stopwatch.
    expect(second.digest).toEqual(first.digest)
    expect(second.window).toEqual(first.window)
  })
})
