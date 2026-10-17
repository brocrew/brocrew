import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANNEL_REFUSALS, CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { distil } from '../src/main/runtime/digest'
import {
  DIGEST_EVENT_TYPES,
  DIGEST_GAP_KINDS,
  DIGEST_LINE_KINDS,
  type DigestLineKind,
} from '../src/shared/digest'
import { LEDGER_WALK_KINDS, WALK_COVERS } from '../src/shared/questions'
import { PERMANENCE_SAID, RAIL_PERMANENCES } from '../src/shared/refusals'
import { activitySays } from '../src/renderer/src/lib/recent-activity'
import type { RecentActivityReading } from '../src/shared/recent-activity'
import { MAX_FOREST_CONVERSATIONS } from '../src/shared/the-whole-forest'

/**
 * 🔴 **466 · the night the digest could not describe** — `463` F6 and F3, criterion 16's exit.
 *
 * > ⛔ `463`: *"in each one the digest drew its honest silent sentence over something that had
 * > happened."* Three of seven active projects scored **no**, and the third was the worst: *"a row
 * > that could not be read is being reported as nothing happened."*
 *
 * ## ⚠️ What this file owns, and what it deliberately does not
 *
 * ⛔ **`a-nights-backlog-rehearsed.render.test.ts` is where the VERDICTS moved.** That file is
 * `463`'s instrument and its brief says so — *"make your new sentences appear in ITS output, not
 * in a fixture you wrote to match them"* — so the seven-project table, the sentences and the
 * rendered card are asserted there, against a night nobody wrote to match.
 *
 * ⚑ **What is here is the STRUCTURE the night cannot show**: that the silent sentence is
 * unreachable rather than merely absent on one fixture; that the walk's three counts come from
 * the query; that the tool narrowing tells one provider's spelling from the other's and this
 * app's tools from the agent's; and that every sentence a person reads is derived from a closed
 * vocabulary rather than typed twice. ⛔ **Each of those needs a control where the two readings
 * DIVERGE**, and a single fixture night has at most one of each.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const FOLD = join(here, '../src/main/runtime/digest.ts')
const REGISTER = join(here, '../src/shared/questions.ts')
const STORE = join(here, '../src/main/db/session-store.ts')

const TO = 1_800_000_000_000
const FROM = TO - 12 * 3_600_000
const INSIDE = TO - 3_600_000

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-466-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function conversation(id: string): void {
  store.create({ id, provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: id })
}

let ordinals = new Map<string, number>()
beforeEach(() => {
  ordinals = new Map()
})

function at(id: string, when: number, event: Parameters<SessionStore['append']>[2]): void {
  const next = ordinals.get(id) ?? 0
  ordinals.set(id, next + 1)
  store.append(id, next, event, when)
}

/**
 * ⛔ **A row of a type the digest SELECTS whose payload cannot be parsed** — written straight
 * into the table, because no writer in this app can produce one. ⚑ `463` planted exactly this
 * shape and this is the same damage, made reusable.
 */
function tornRow(id: string, sessionId: string, when: number): void {
  const next = ordinals.get(sessionId) ?? 0
  ordinals.set(sessionId, next + 1)
  db.prepare(
    `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, next, 'turn', '{"type":"tur', when, null, 0)
}

const digestOf = (): ReturnType<typeof distil> =>
  distil(store.digestWindow(FROM, TO), (session) => session.replace('sess_', ''))

/** A Recent activity reading over a walk, so what the page says can be asked without a database. */
function activity(
  read: RecentActivityReading['read'],
  lines: RecentActivityReading['lines'] = [],
): RecentActivityReading {
  return { window: { from: FROM, to: TO }, read, lines, capped: false } as RecentActivityReading
}

const oneLine: RecentActivityReading['lines'] = [
  {
    id: 'a',
    at: INSIDE,
    what: 'finished',
    register: 'claimed',
    piece: { id: 'a', label: 'W1.1', title: null },
    agent: 'Ada',
    conversation: null,
  },
]

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · "nothing happened", made unreachable over a row nobody could read
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · 463 F3 · a row this app could not read is not “nothing happened”', () => {
  it('🔴 a window whose ONLY eligible row is unreadable is read in part, never empty', () => {
    conversation('sess_torn')
    tornRow('ev_torn', 'sess_torn', INSIDE)
    const read = store.digestWindow(FROM, TO)
    const distilled = distil(read, (session) => session)
    // ⛔ **The shape 463 measured**: no lines, no rows — byte-identical to a window that recorded
    // nothing, apart from the count of what could not be read.
    expect(distilled.lines).toEqual([])
    expect(read.rows).toEqual([])
    // ⚑ **The walk is the STORE's own**, so this is the real read's disclosure and not a value
    // typed to make the branch fire.
    const walked = { walk: read.walk, ledgers: read.ledgers, rowsUnread: read.rowsUnread }
    expect(activitySays(activity(walked))).toBe('read-in-part')
  })

  it('⚑ …and the CONTROL, one fact over: the same emptiness with a whole record says so', () => {
    // 🔴 **Tested where the two readings DIVERGE**, or a page that never says "nothing recorded"
    // would pass the case above — HO-024 §5.3's *"omission is indistinguishable from
    // nothing-happened"*, the other way round.
    const whole = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 4,
      rowsUnread: 0,
    } as const
    expect(activitySays(activity(whole))).toBe('nothing-recorded')
  })

  it('⛔ read in part is asked FIRST, so a reading with lines and a hole is still read in part', () => {
    const torn = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 4,
      rowsUnread: 1,
    } as const
    expect(activitySays(activity(torn, oneLine))).toBe('read-in-part')
    expect(activitySays(activity(torn))).toBe('read-in-part')
    // ⚑ The other arms, each reached only when the record is whole.
    const whole = { ...torn, rowsUnread: 0 }
    expect(activitySays(activity(whole, oneLine))).toBe('lines')
    expect(activitySays(activity(whole))).toBe('nothing-recorded')
  })

  it('🔴 the gap says how many rows, and a whole record draws no gap at all', () => {
    conversation('sess_mixed')
    at('sess_mixed', INSIDE, { type: 'turn', state: 'completed' })
    // ⛔ **Absent rather than zeroed** — `DIGEST_GAP_KINDS`' own rule: *"a gap with no rows is not
    // drawn"*, so a window over a whole record must not carry a `source-unreadable: 0`. ⚑ Read
    // BEFORE the damage, because since D-016 there is one window over every conversation and no
    // second project to hold the whole record apart.
    expect(digestOf().gaps.map((gap) => gap.kind)).not.toContain('source-unreadable')
    expect(DIGEST_GAP_KINDS).toContain('source-unreadable')

    tornRow('ev_torn_a', 'sess_mixed', INSIDE + 1)
    tornRow('ev_torn_b', 'sess_mixed', INSIDE + 2)
    const torn = digestOf().gaps.find((gap) => gap.kind === 'source-unreadable')
    expect(torn?.count).toBe(2)
    expect(torn?.says).toContain('2 rows of the record this digest reads could not be read')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the walk, and the three counts that come from the query
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · 453’s walk, carried into the digest rather than forked', () => {
  it('🔴 `ledgers` is the candidate query’s and `rows` is what it found — and they diverge', () => {
    // ⛔ **The one control that matters.** Three conversations, one row in the window: a
    // `ledgers` derived from the rows would answer 1, and a `ledgers` derived from the distinct
    // sessions of the result would answer 1 as well. Only the candidate query answers 3.
    conversation('sess_a')
    conversation('sess_b')
    conversation('sess_c')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    const read = store.digestWindow(FROM, TO)
    expect(read.ledgers).toBe(3)
    expect(read.rows).toHaveLength(1)
    expect(new Set(read.rows.map((row) => row.sessionId)).size).toBe(1)
    expect(read.walk).toBe('one-window-over-every-agents-conversation')
    expect(read.rowsUnread).toBe(0)
  })

  it('⚑ …and a quiet window is not an empty one: `ledgers: 3, rows: 0`', () => {
    conversation('sess_a')
    conversation('sess_b')
    conversation('sess_c')
    // ⚠️ Nothing inside the window at all. Before `466` this and a read that opened nothing
    // produced the same `[]`, which is `453`'s whole argument moved one surface over.
    const read = store.digestWindow(FROM, TO)
    expect([read.ledgers, read.rows.length]).toEqual([3, 0])
  })

  it('⚑ …and an app whose agents hold nothing is the digest’s word at `ledgers: 0`', () => {
    // ⚠️ **One of the three empties, and it is not a word — it is a count.** The ledger is open
    // and no agent of this app holds a conversation, which `no-ledger` would misreport as badly in
    // the other direction.
    const read = store.digestWindow(FROM, TO)
    expect(read.walk).toBe('one-window-over-every-agents-conversation')
    expect([read.ledgers, read.rows.length]).toEqual([0, 0])
  })

  it('⛔ the store with no ledger says `no-ledger`, which is the reachable false case', () => {
    const empty = NULL_SESSION_STORE.digestWindow(FROM, TO)
    expect(empty).toEqual({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 })
    expect(WALK_COVERS['no-ledger']).toContain('no ledger')
  })

  it('⚠️ the digest’s walk word has a sentence of its own, and it is not one of the queue’s', () => {
    expect(LEDGER_WALK_KINDS).toContain('one-window-over-every-agents-conversation')
    expect(Object.keys(WALK_COVERS).sort()).toEqual([...LEDGER_WALK_KINDS].sort())
    const said = Object.values(WALK_COVERS)
    expect(new Set(said).size).toBe(said.length)
    // 🔴 **The reason a member of its own was needed rather than a reused one.** The queue's
    // sentence promises *"no window"*; a digest read is one, so borrowing it would have been a
    // false sentence rather than a shortcut.
    expect(WALK_COVERS['one-window-over-every-agents-conversation']).toContain(
      'one of this app’s agents holds',
    )
    expect(WALK_COVERS['one-window-over-every-agents-conversation']).toContain(
      'inside the window you chose',
    )
    for (const queue of ['every-conversation-that-routed'] as const) {
      expect(WALK_COVERS[queue]).toContain('no window')
      expect(WALK_COVERS['one-window-over-every-agents-conversation']).not.toBe(WALK_COVERS[queue])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · what the digest may now say, and whose tool it was
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · 463 F6 · the vocabulary a night actually needs', () => {
  it('🔴 a tool answer is drawn for THIS APP’s tools on both providers, and for nothing else', () => {
    conversation('sess_codex')
    // ⚑ **Codex's spelling**, measured by `353`: the namespace and the tool, no `mcp__`.
    at('sess_codex', INSIDE, {
      type: 'tool_call',
      id: 'c1',
      name: 'brobot__list_agents',
      summary: '',
    })
    at('sess_codex', INSIDE + 1, { type: 'tool_result', id: 'c1', summary: 'one agent', ok: true })
    // ⚑ **Claude's spelling**, measured 5 of 5 in `system/init.tools`.
    at('sess_codex', INSIDE + 2, {
      type: 'tool_call',
      id: 'c2',
      name: 'mcp__brobot__list_tasks',
      summary: '',
    })
    at('sess_codex', INSIDE + 3, { type: 'tool_result', id: 'c2', summary: 'two tasks', ok: true })
    // ⛔ **The divergence**: the agent's own work, which this digest reads and passes over.
    at('sess_codex', INSIDE + 4, { type: 'tool_call', id: 'c3', name: 'Bash', summary: 'ls -la' })
    at('sess_codex', INSIDE + 5, {
      type: 'tool_result',
      id: 'c3',
      summary: 'a directory',
      ok: true,
    })
    // ⛔ **A SECOND control, because the two fail differently.** A built-in has no separator at
    // all and is refused by the split; another server's tool splits cleanly and is refused only
    // by the comparison with this app's own server name. ⚠️ With only the first, a fold that had
    // no server check at all would pass — which is exactly what M13 removes.
    at('sess_codex', INSIDE + 6, {
      type: 'tool_call',
      id: 'c4',
      name: 'mcp__github__create_issue',
      summary: '',
    })
    at('sess_codex', INSIDE + 7, { type: 'tool_result', id: 'c4', summary: 'issue 12', ok: true })

    const line = digestOf().lines.find((one) => one.kind === 'tool-answered')
    expect(line?.count).toBe(2)
    expect(line?.register).toBe('observed')
    // ⚠️ **Unqualified, which is `tool_refused`'s own spelling and `317`'s rule about provider
    // names in user-visible text.**
    expect(line?.text).toContain('list_tasks answered: two tasks')
    expect(line?.text).not.toContain('brobot__')
    expect(line?.text).not.toContain('mcp__')
    expect(line?.text).not.toContain('a directory')
    expect(line?.text).not.toContain('issue 12')
    expect(line?.text).not.toContain('create_issue')
  })

  it('⛔ a result is matched to a call in its OWN conversation, never one that shares an id', () => {
    // 🔴 **463 F2 measured this collision on request ids** — *"provider request IDs are only
    // session-local"* — and this is the same hazard arriving on tool-call ids. ⚠️ F2 itself is
    // another dispatch's; what is asserted here is that `466` did not add a second instance.
    conversation('sess_one')
    conversation('sess_two')
    at('sess_one', INSIDE, {
      type: 'tool_call',
      id: 'shared',
      name: 'brobot__list_agents',
      summary: '',
    })
    at('sess_two', INSIDE + 1, { type: 'tool_result', id: 'shared', summary: 'leaked', ok: true })
    expect(digestOf().lines.some((one) => one.kind === 'tool-answered')).toBe(false)
    // ⚑ The paired positive, one fact over: the same id, answered in its own conversation.
    at('sess_one', INSIDE + 2, { type: 'tool_result', id: 'shared', summary: 'kept', ok: true })
    expect(digestOf().lines.find((one) => one.kind === 'tool-answered')?.text).toContain('kept')
  })

  it('⚑ a failed answer says so, and the words are the receipt’s short form', () => {
    conversation('sess_fail')
    at('sess_fail', INSIDE, {
      type: 'tool_call',
      id: 'f1',
      name: 'brobot__spawn_agent',
      summary: '',
    })
    at('sess_fail', INSIDE + 1, {
      type: 'tool_result',
      id: 'f1',
      summary: 'no such name',
      ok: false,
    })
    expect(digestOf().lines.find((one) => one.kind === 'tool-answered')?.text).toContain(
      'spawn_agent failed: no such name',
    )
  })

  it('🔴 a question that names its work says which, whenever the work was handed out', () => {
    conversation('sess_q')
    at('sess_q', INSIDE, {
      type: 'work_given',
      piece: 'work_in',
      label: 'W1.2',
      parent: 'work_root_q',
      givenBy: 'sess_giver',
      title: 'the work',
      brief: 'the work',
    })
    at('sess_q', INSIDE + 1, {
      type: 'question_asked',
      requestId: 'req_1',
      piece: 'work_in',
      label: 'W1.2',
      prompt: 'Which database?',
      questions: [],
    })
    expect(digestOf().lines.find((one) => one.kind === 'question-about-work')?.text).toBe(
      '1 question says which piece of work it is about — the most recent is W1.2.',
    )
    // ⛔ **The prompt is the agent's words and is not drawn** — the fold's own standing rule.
    expect(JSON.stringify(digestOf())).not.toContain('Which database?')

    // ⚑ The divergence: a question about work this window never saw handed out — asked LATER, so
    // it is the most recent, which is the one the line names (one window over both since D-016).
    // 🔴 **D-016 · the row carries the piece's LABEL**, so the line still names it: the give
    // being before the window no longer costs the name.
    conversation('sess_q2')
    at('sess_q2', INSIDE + 2, {
      type: 'question_asked',
      requestId: 'req_2',
      piece: 'work_before',
      label: 'W3.1',
      prompt: 'and this one?',
      questions: [],
    })
    expect(digestOf().lines.find((one) => one.kind === 'question-about-work')?.text).toBe(
      '2 questions say which piece of work it is about — the most recent is W3.1.',
    )
  })

  it('⛔ every refusal reason and every permanence reaches the card in its own vocabulary’s words', () => {
    conversation('sess_r')
    for (const [index, because] of CHANNEL_REFUSALS.entries()) {
      at('sess_r', INSIDE + index, {
        type: 'request_routed',
        requestId: `req_${because}`,
        to: 'a-person',
        because,
        parent: 'sess_r',
      })
    }
    for (const [index, permanence] of RAIL_PERMANENCES.entries()) {
      at('sess_r', INSIDE + 100 + index, {
        type: 'tool_refused',
        tool: 'spawn_agent',
        rail: `rail-${String(index)}`,
        permanence,
        retryable: permanence === 'while-this-holds',
      })
    }
    const lines = digestOf().lines
    const raised = lines.find((one) => one.kind === 'decision-raised')
    expect(raised?.count).toBe(CHANNEL_REFUSALS.length)
    for (const because of CHANNEL_REFUSALS) {
      expect(raised?.text).toContain(CHANNEL_REFUSAL_SENTENCES[because])
      // ⚠️ **The CODE never reaches a person**, which is what the sentences are for.
      expect(raised?.text).not.toContain(because)
    }
    const refused = lines.find((one) => one.kind === 'tool-refused')
    for (const permanence of RAIL_PERMANENCES) {
      expect(refused?.text).toContain(PERMANENCE_SAID[permanence])
      expect(refused?.text).not.toContain(permanence)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the fold, censused
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the fold says nothing it did not derive', () => {
  const code = readFileSync(FOLD, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('🔴 the order the surface draws is DERIVED from the vocabulary, not typed beside it', () => {
    // ⛔ **The hole this closes**: `sentence()` is exhaustive so a missing arm is a compile error,
    // but a kind left out of the draw order compiled, folded and was never emitted, with nothing
    // red — `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
    expect(code).toContain('DIGEST_LINE_KINDS.filter(')
    const claimed: DigestLineKind[] = ['worker-reported']
    // ⚑ Every kind is either drawn in order or is the one claimed kind. No third state.
    for (const kind of DIGEST_LINE_KINDS) {
      expect(claimed.includes(kind) || DIGEST_LINE_KINDS.includes(kind)).toBe(true)
    }
    expect(DIGEST_LINE_KINDS.filter((kind) => !claimed.includes(kind))).not.toHaveLength(0)
  })

  it('⛔ no sentence of another module’s vocabulary is re-spelled here', () => {
    // ⚠️ **`405` §2's rule, as a census.** Two closed vocabularies reach a person through this
    // fold since D-016 took the proposal shapes and endings out — permanences and request reasons
    // — and each of them is looked up. A literal copy would be free to drift from the table a
    // person reads on the card beside it.
    for (const said of [
      ...Object.values(PERMANENCE_SAID),
      ...Object.values(CHANNEL_REFUSAL_SENTENCES),
    ]) {
      expect(code).not.toContain(said)
    }
    // ⚑ **The positive control**, so this is not a test that passes on a file that imports none
    // of them: each table is named in the code that is left after the comments are stripped.
    for (const table of ['PERMANENCE_SAID', 'CHANNEL_REFUSAL_SENTENCES']) {
      expect(code).toContain(table)
    }
  })

  it('⚠️ the tool types 466 added are in the read vocabulary and the fold branches on each', () => {
    // ⚑ 466 added four; D-016 took its two proposal types out with proposals.
    for (const type of ['tool_call', 'tool_result'] as const) {
      expect(DIGEST_EVENT_TYPES).toContain(type)
      expect(code).toContain(`case '${type}':`)
    }
    // ⛔ **And the two the exclusion paragraph still names stay out**, because their reasons did
    // not change: one is context occupancy and the other widens the scan the cost claim rests on.
    for (const type of ['context_reading', 'status'] as const) {
      expect(DIGEST_EVENT_TYPES).not.toContain(type)
    }
  })

  it('⚑ what a reading says of itself cannot be spelled in the fold: the surface owns it', () => {
    // ⛔ `438`'s rule about `register:` one field over — the fold composes sentences and the
    // renderer decides what a reading says of itself.
    for (const says of ['not-read', 'read-in-part', 'nothing-recorded'])
      expect(code).not.toContain(says)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · 466 · relay 1 · the register 467 and 466 both extended, reconciled into one account
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · relay 1 · one register, and the table that says what each word narrowed', () => {
  const register = readFileSync(REGISTER, 'utf8')
  /** The docblock above `LEDGER_WALK_KINDS`, and nothing else in the file. */
  const account = register.slice(
    register.indexOf('🔴 **What NARROWED one walk over ledgers'),
    register.indexOf('export const LEDGER_WALK_KINDS = ['),
  )

  it('🔴 the docblock’s table names EVERY word and invents none', () => {
    // ⛔ **A pointer clause is a claim** — the account says *"the six words, and what each one
    // narrowed"*, so a seventh member added without a row here would be described by a table
    // that silently does not cover it. ⚑ The table is read back against the array rather than
    // trusted.
    const ROW = /^ \* \| `([a-z-]+)` \|/gm
    const tabled = [...account.matchAll(ROW)].map(([, word]) => word ?? '')
    expect([...tabled].sort()).toEqual([...LEDGER_WALK_KINDS].sort())
    // ⚠️ **The control the extractor needs** (standing rule 12): the pattern is shown matching a
    // row it was written for, so an empty match set is a fact about the docblock and not about a
    // regex that could never fire.
    expect(tabled.length).toBeGreaterThan(0)
    expect(new RegExp(ROW.source, 'm').test(' * | `a-word` | opened | narrowed |')).toBe(true)
  })

  it('⚠️ the count the account SPELLS is the count the array holds', () => {
    // 🔴 **`458`'s rule paid rather than dodged.** A number in prose outlives the derivation that
    // made it true, so the number this docblock spells is derived HERE from the array: adding a
    // member makes this test look for *seven* while the heading still says *six*, and it goes red.
    // ⚠️ **543 · the list runs to twelve now, and the list is the only thing that moved.** ⛔ The
    // rule is unchanged and so is what it pins: the account's own heading names a COUNT, and the
    // count is derived here from the array rather than read out of the prose. ⚑ The list is
    // extended rather than the assertion loosened — `expect(word).toBeDefined()` is what refuses a
    // twelfth member added with no word for it, and dropping that line to pass would be
    // `a-mutation-on-a-census-is-invisible-to-that-census`.
    const SPELLED = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      // ⚑ **637 · the list is EXTENDED and the assertion is untouched**, which is this test's own
      // instruction two paragraphs up: `expect(word).toBeDefined()` is what refuses a fourteenth
      // member added with no word for it, and loosening it to pass would be
      // `a-mutation-on-a-census-is-invisible-to-that-census`.
      'thirteen',
    ]
    const word = SPELLED[LEDGER_WALK_KINDS.length]
    expect(word).toBeDefined()
    expect(account).toContain(`The ${String(word)} words`)
  })

  it('⛔ the two words over ONE candidate set are not substrings of one another', () => {
    // 🔴 **`an-assertion-can-be-satisfied-by-a-neighbouring-element`.** The forest and the digest
    // open the same ledgers, so their words are the first pair in this register close enough for
    // an assertion written against either to be answered by the other.
    for (const left of LEDGER_WALK_KINDS) {
      for (const right of LEDGER_WALK_KINDS) {
        if (left === right) continue
        expect(left.includes(right), `${left} contains ${right}`).toBe(false)
      }
    }
    // ⚑ **The control**, so this is not a loop that passes because it compared nothing: two words
    // where one DOES contain the other are caught by the same expression.
    expect('one-window-over-a-project'.includes('a-project')).toBe(true)
  })

  it('🔴 the digest and the forest really do open the same ledgers, which is why two words', () => {
    // ⛔ **The account claims the digest and the forest open the SAME conversations — every one an
    // agent of this app holds — and narrow them differently.** That is a claim about SQL and it is
    // asserted against the SQL rather than left in prose — if either query is narrowed later, the
    // register's justification for holding two words is gone and this goes red before the
    // docblock does.
    const store = readFileSync(STORE, 'utf8')
    const sqlOf = (name: string): string => {
      const opens = store.indexOf(`const ${name} = db.prepare(`)
      // ⚠️ **A slicer that cannot find its anchor must FAIL, not return the tail of the file** —
      // `store.slice(-1)` is one character and every `toContain` below would go red for the wrong
      // reason, which reads as a narrowed query when it is a renamed constant.
      expect(opens, `${name} is gone from the store`).toBeGreaterThan(-1)
      // ⛔ **Its OWN literal and nothing past it** — a slice running on into the next statement
      // would let a neighbour's join answer for this one's.
      const starts = store.indexOf('`', opens)
      const closes = store.indexOf('`', starts + 1)
      expect(closes, `${name} is no longer a prepared statement`).toBeGreaterThan(starts)
      return store.slice(starts + 1, closes)
    }
    // ⚑ The digest's rows, the digest's `ledgers` (the same count the forest reports as how many
    // there are), and the forest's rows.
    for (const query of [
      'selectDigestWindow',
      'countPlacedConversations',
      'selectEveryPlacedConversation',
    ]) {
      const sql = sqlOf(query)
      // ⚑ **D-016 · the population is keyed on the identity column**, so that is what each names.
      for (const name of ['agent_identity_id', 'provider_session']) {
        expect(sql, `${query} no longer reads ${name}`).toContain(name)
      }
    }
    // ⚠️ **And the digest's own row query adds the clock that earns the second word.**
    expect(sqlOf('selectDigestWindow')).toContain('e.created_at >= ? AND e.created_at < ?')
  })

  it('🔴 …and they agree on the COUNT, where bindings and conversations differ', () => {
    // ⛔ **The SQL census above is textual; this is the same claim measured.** ⚠️ Two
    // conversations under ONE identity, because the fixture's usual shape gives every
    // conversation a profile of its own — and on that shape a count of BINDINGS and a count of
    // CONVERSATIONS are the same number, so a walk narrowed to the wrong one passes:
    // `a-comparison-tested-where-both-sides-agree-measures-nothing`.
    store.create({
      id: 'sess_twin_a',
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'one-identity',
    })
    store.create({
      id: 'sess_twin_b',
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'one-identity',
    })
    const digest = store.digestWindow(FROM, TO)
    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    // ⚑ **Two conversations, one binding** — the premise the assertion below needs, asserted
    // rather than assumed (`a-fixture-must-plant-what-the-subject-eats`).
    expect(
      forest.rows.flatMap((row) => (row.node === 'a-conversation' ? [row.identity] : [])),
    ).toEqual(['one-identity', 'one-identity'])
    expect(digest.ledgers).toBe(2)
    // 🔴 **The register holds two words for one population because both open the same ledgers.**
    // If either query is narrowed, they stop agreeing here before the docblock stops claiming it.
    expect(digest.ledgers).toBe(forest.ledgers)
  })

  it('⚠️ every sentence that READ a ledger carries the generation clause, the forest included', () => {
    // 🔴 **The sentence of mine that went false while I was in flight.** 466 wrote *"the
    // generation clause is in every sentence that read anything"*; 467 then landed a roster
    // sentence without one, over a read that does narrow by generation — `piecesOfSession` (then
    // `tasksOfSession`) passes `activeGeneration`. ⛔ The clause was added to 467's sentence rather than the claim
    // weakened, because the read really does that. ⚑ D-016 took the roster's word out; the
    // forest's is the other word over the digest's candidate set, and it folds the same way.
    const READS_A_LEDGER = [
      'every-conversation-that-routed',
      'every-conversation-this-app-placed',
      'one-window-over-every-agents-conversation',
    ] as const
    for (const walk of READS_A_LEDGER) {
      expect(WALK_COVERS[walk], walk).toContain('live projection')
    }
    // ⛔ **And the two that read nothing must NOT claim it**, which is the negative that stops
    // this passing by pasting the clause everywhere.
    for (const empty of ['no-such-conversation', 'no-ledger'] as const) {
      expect(WALK_COVERS[empty], empty).not.toContain('live projection')
    }
    // ⚑ **The forest's read is the one being asserted about**, so the fold it goes through is
    // pinned here too rather than taken on trust.
    const store = readFileSync(STORE, 'utf8')
    expect(store).toContain('const generation = activeGeneration(sessionId)')
    expect(store).toContain(
      '...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(',
    )
  })

  it('⛔ nothing in the app still spells the name the register was renamed from', () => {
    // ⚑ **The rename is the whole of what 466 changed about the symbol**, and a survivor would be
    // a second name for one register — which is the two-vocabularies hazard 467 named, arriving
    // by the back door.
    //
    // ⛔ **Prose is stripped first, and it has to be**: the account above `LEDGER_WALK_KINDS`
    // quotes the retired name twice on purpose, to say what was renamed and why. A census that
    // read the docblock would go red on the sentence explaining itself —
    // `a-source-census-must-strip-prose-before-it-asserts`.
    const withoutProse = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const file of [REGISTER, STORE, FOLD]) {
      const code = withoutProse(readFileSync(file, 'utf8'))
      expect(code, file).not.toContain('QUEUE_WALKS')
      expect(code, file).not.toContain('QueueWalk')
    }
    // ⚠️ **Two controls, because there are two ways this could pass vacuously.** The register
    // still spells the name it was renamed TO after stripping, so the files were read and the
    // stripper did not empty them; and the stripper is shown removing the very comment the
    // negatives would otherwise trip on.
    expect(withoutProse(readFileSync(REGISTER, 'utf8'))).toContain('LEDGER_WALK_KINDS')
    expect(withoutProse('/**\n * a constant called `QUEUE_WALKS`,\n */\nconst kept = 1\n')).toBe(
      '\nconst kept = 1\n',
    )
  })
})
