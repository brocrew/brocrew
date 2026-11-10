import type { WorkReport } from '../src/shared/task-contracts'
import type { QueuedMessageEvent, UnqueuedMessageEvent } from '../src/shared/conversation-events'
import type { UserTurnEvent } from '../src/shared/human-answer-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { isAWorkReport } from '../src/shared/tasks'

/**
 * # 🔴 518 · what a REPLAYED work report may hand a person
 *
 * ## ⛔ The gap, and it was written down in the code before it was found
 *
 * `runtime-ipc.ts`, on `UserTurnEvent.relayedFrom`: *"`boundStoredEvent` has no arm for this key,
 * exactly as it has none for `work.taskId` (406), `task_assigned.assignedBy` or
 * `request_routed.requestId` … it is named here so that whoever bounds one of them bounds all of
 * them."* ⚠️ **That paragraph classified the four together as ids printed unbounded in the DEBUG
 * STREAM, and `510` made it false for one of them**: the report's document id (its RESOURCE ids
 * since D-016) and its owner are read off a replayed row, drawn as `data-*` attributes on a
 * transcript row, and sent back over the command wire when a person presses. ⛔ The other three are
 * still debug-stream only.
 *
 * ## ⚠️ Replay is a trust boundary and nothing schema-parses it
 *
 * `toPersistedEvents` CASTS (`JSON.parse(row.payload) as TranscriptEvent`) — `216` §2's rule, the
 * one `318` and `319` are each an instance of. ⛔ **And the ledger has two doors this process did
 * not write**: `importBundle` hands `bundle.ledger` entries on untouched, and `read-bundle.ts`
 * validates a ledger event as `z.object({ type: z.string().min(1) }).passthrough()` under a
 * 128 MB file ceiling — so every key beside `type` arrives verbatim, at any size.
 *
 * ## ⛔ What this file is arranged around
 *
 * §1 **the bound, planted and found, with the legitimate control in the same sample** · §2 **the
 * three types that carry it, and the turn that carries a report AND an attachment** · §3 **a
 * `work` that is not a report at all**, which is a second hole with its own victim · §4 **the
 * census that makes a ninth field somebody's problem** · §5 **the ceiling is the command wire's
 * own**, which is what `wire-bounds.test.ts` cannot see from where it stands.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

/** ⚑ The ceiling is `session-store.ts`'s own and is not exported; §5 pins it against the wire. */
const CEILING = 200

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-518-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
  store.create({ id: 'sess_w', provider: 'claude', cwd: dir, approvalMode: 'ask', profileId: 'd' })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A report this app really could have written — `reply-rails.ts`'s `workAnswered`, whole. */
const legitimate = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_9f1c5b7e-0c2a-4d3e-9a10-2b6c8d4e1f00',
  label: 'W1.4',
  owner: 'sess_2b6c8d4e-1f00-4d3e-9a10-9f1c5b7e0c2a',
  state: 'answered',
  outcome: 'done',
  resources: ['res_4c2f0e1a111142228333444455556666'],
  ...over,
})

const replayed = (ordinal: number): UserTurnEvent =>
  store.events('sess_w')[ordinal]!.event as UserTurnEvent

/**
 * ⛔ **The row as it actually sits on disk** (518) — ONE application of the bound, and the only way
 * to see it.
 *
 * ⚠️ **`boundStoredEvent` runs on both sides of this store** — `appendTx` on the way in and
 * `toPersistedEvents` on the way out — so every assertion taken through {@link replayed} has been
 * bounded twice, and a defect that only costs the FIRST pass is invisible there. ⛔ That is not a
 * hypothetical: the row that moves the work bound out of the chain survives every replay assertion
 * in this file and is caught only here (`518 M4`). ⚑ `session-store.ts`'s own claim is *"the
 * database can neither accept nor hand back a payload the rest of the app has agreed not to
 * hold"*, and this is the ACCEPT half of that sentence.
 */
const stored = (ordinal: number): UserTurnEvent =>
  JSON.parse(
    (
      db
        .prepare('SELECT payload FROM events WHERE session_id = ? AND ordinal = ?')
        .get('sess_w', ordinal) as { payload: string }
    ).payload,
  ) as UserTurnEvent

/** One turn, with whatever payload this test wants on it. */
const turn = (ordinal: number, over: Record<string, unknown>): void => {
  store.append(
    'sess_w',
    ordinal,
    {
      type: 'user_turn',
      text: 'the child answered',
      attribution: 'app_authored',
      ...over,
    } as never,
    1_000 + ordinal,
  )
}

describe('518 §1 · the bound, planted and found', () => {
  it('🔴 drops an id too long to be one and keeps the legitimate one, in ONE sample', () => {
    // ⛔ **Both in one event**, so a bound that dropped everything would fail the same assertion a
    // bound that dropped nothing does — `a-positive-assertion-must-differ-from-the-default`.
    turn(0, {
      work: legitimate({ resources: ['res_'.concat('x'.repeat(1_000_000))] }),
    })
    const back = replayed(0).work
    expect(back, 'the whole report was dropped for one bad field').toBeDefined()
    // 🔴 **The oversized id is ABSENT, not shortened.** A cut resource id draws *Open the file
    // kept with this reply* over a press that opens a refusal — `memory_loaded`'s rule, one field
    // over.
    expect(back).not.toHaveProperty('resources')
    // ⚑ …and every legitimate field beside it survived untouched, which is the control.
    expect(back?.piece).toBe(legitimate().piece)
    expect(back?.owner).toBe(legitimate().owner)
    expect(back?.label).toBe('W1.4')
    expect(back?.state).toBe('answered')
    expect(back?.outcome).toBe('done')
  })

  it('⚠️ exactly AT the ceiling survives and one character past it does not', () => {
    turn(0, { work: legitimate({ resources: ['d'.repeat(CEILING)] }) })
    turn(1, { work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }) })
    // ⛔ The boundary itself, both sides — a bound tested only far past its ceiling measures
    // nothing about where the ceiling is.
    expect(replayed(0).work?.resources).toEqual(['d'.repeat(CEILING)])
    expect(replayed(1).work).not.toHaveProperty('resources')
  })

  it('⛔ a report that cannot name its own task loses the whole key, and the turn keeps its words', () => {
    turn(0, { work: legitimate({ piece: 't'.repeat(CEILING + 1) }) })
    // 🔴 **Dropped rather than refused** — the attachments arm's rule: a conversation is worth more
    // than the caption on one of its turns.
    expect(replayed(0).work).toBeUndefined()
    expect(replayed(0).text).toBe('the child answered')
    // ⚑ And the paired positive: the same turn with a piece id it CAN name keeps its report.
    turn(1, { work: legitimate() })
    expect(replayed(1).work?.piece).toBe(legitimate().piece)
  })

  it('⚠️ every optional field that cannot be one of this app’s own is absent, one at a time', () => {
    const optional = ['owner', 'outcome', 'stalledBecause'] as const
    optional.forEach((key, index) => {
      turn(index, { work: legitimate({ [key]: 'x'.repeat(CEILING + 1) }) })
      const back = replayed(index).work
      expect(back, `${key} took the whole report with it`).toBeDefined()
      expect(back, key).not.toHaveProperty(key)
    })
    // ⚑ **D-016 · the resource ids are a LIST**, each one an id, so the fourth is planted as one.
    turn(optional.length, { work: legitimate({ resources: ['x'.repeat(CEILING + 1)] }) })
    expect(replayed(optional.length).work, 'resources took the whole report').toBeDefined()
    expect(replayed(optional.length).work).not.toHaveProperty('resources')
    // ⛔ **The control that the loop is not passing because nothing is kept**: the same four at a
    // legitimate size all survive.
    turn(optional.length + 1, {
      work: legitimate({ stalledBecause: 'turn_ended', state: 'stalled' }),
    })
    const whole = replayed(optional.length + 1).work
    for (const key of [...optional, 'resources']) expect(whole, key).toHaveProperty(key)
  })

  it('⚠️ an EMPTY id is absent too, and a required one empty takes the report with it', () => {
    // ⛔ **Empty is not short** — `boundHandedPaths`' own `each.path.length > 0`, and
    // `memory_loaded`'s *"a path that does not survive is EMPTIED, and the FOLD is what refuses the
    // row"*. ⚑ Here the store refuses it instead, so no reader has to learn a second spelling.
    turn(0, { work: legitimate({ resources: [''] }) })
    expect(replayed(0).work).toBeDefined()
    expect(replayed(0).work).not.toHaveProperty('resources')
    // 🔴 A required one cannot be emptied — a row drawing `W1.4` about a piece with no id is the
    // shape `isAWorkReport` exists to refuse — so the key goes.
    turn(1, { work: legitimate({ piece: '' }) })
    expect(replayed(1).work).toBeUndefined()
  })

  it('🔴 a `state` too long to be one takes the whole report, not just the field', () => {
    // ⛔ **`state` is REQUIRED and it is painted verbatim** — `WorkReportEntry.vue` renders
    // `:data-state="props.item.report.state"` on every report row, so the raw string reaches the
    // DOM even though the visible pill falls back to *in a state this app has not been taught*.
    turn(0, { work: legitimate({ state: 's'.repeat(CEILING + 1) as never }) })
    expect(replayed(0).work).toBeUndefined()
    // ⚑ The paired positive: a state this app has never heard of but COULD have minted survives,
    // because the bound holds lengths and says nothing about membership.
    turn(1, { work: legitimate({ state: 'sideways' as never }) })
    expect(replayed(1).work?.state).toBe('sideways')
  })

  it('⛔ lets no undeclared key ride the report into the renderer', () => {
    // The `.brobot` door, exactly: `read-bundle.ts` validates the EVENT as `{type}.passthrough()`,
    // so a ninth key on the report arrives verbatim at any size.
    turn(0, { work: { ...legitimate(), blob: 'z'.repeat(50_000) } })
    expect(Object.keys(replayed(0).work!)).not.toContain('blob')
    expect(JSON.stringify(replayed(0))).not.toContain('zzzz')
  })

  it('⚑ returns the ordinary report by IDENTITY, so a replay of a long conversation pays nothing', () => {
    // ⚠️ Asserted through the ONE thing a test can see from outside: the bound is idempotent, so a
    // row written through `appendTx` and read back through `toPersistedEvents` — both call it — is
    // the same value it was handed. A bound that rebuilt every report would still pass this, which
    // is why the claim here is idempotence and the identity half is stated in the docblock.
    const report = legitimate()
    turn(0, { work: report })
    expect(replayed(0).work).toEqual(report)
    expect(Object.keys(replayed(0).work!)).toEqual(Object.keys(report))
  })
})

describe('518 §2 · the three types that carry it', () => {
  it('🔴 bounds a held message and an abandoned one, not only the turn', () => {
    const tooLong = { work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }) }
    store.append(
      'sess_w',
      0,
      { type: 'message_queued', messageId: 'msg_1', text: 'held', ...tooLong } as never,
      1_000,
    )
    store.append(
      'sess_w',
      1,
      { type: 'message_unqueued', messageId: 'msg_1', reason: 'cancelled', ...tooLong } as never,
      1_001,
    )
    const held = store.events('sess_w')[0]!.event as QueuedMessageEvent
    const gone = store.events('sess_w')[1]!.event as UnqueuedMessageEvent
    expect(held.work).not.toHaveProperty('resources')
    expect(gone.work).not.toHaveProperty('resources')
    // ⚑ The control: the rest of each payload is untouched, so this is a bound and not a filter.
    expect(held.text).toBe('held')
    expect(gone.reason).toBe('cancelled')
  })

  it('⛔ bounds the report AND the attachments on one turn — the arm below this one RETURNS', () => {
    // 🔴 **The whole reason the work bound runs first.** `work` rides on exactly the three types
    // the attachments arm handles, and that arm returns: ordered the other way, a turn carrying
    // both would have had its paths bounded and its report handed on whole.
    turn(0, {
      work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }),
      attachments: [
        { path: '/tmp/ok.png', kind: 'file', outsideCwd: false },
        { path: `/tmp/${'p'.repeat(9_000)}.png`, kind: 'file', outsideCwd: false },
      ],
    })
    const back = replayed(0)
    expect(back.work, 'the report rode past the attachments arm').not.toHaveProperty('resources')
    expect(back.work?.piece).toBe(legitimate().piece)
    expect(back.attachments?.map((each) => each.path)).toEqual(['/tmp/ok.png'])
  })

  it('🔴 ONE application bounds both — read off the row on disk, not off the replay', () => {
    // ⛔ **The replay assertion above cannot see this.** The bound runs on the way in and on the
    // way out, so a version that returned early after bounding the report would have its
    // attachments bounded by the second pass and every `store.events` assertion would pass.
    // ⚑ Reading the stored payload is what makes the ORDERING a measurable proposition.
    turn(0, {
      work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }),
      attachments: [
        { path: '/tmp/ok.png', kind: 'file', outsideCwd: false },
        { path: `/tmp/${'p'.repeat(9_000)}.png`, kind: 'file', outsideCwd: false },
      ],
    })
    const onDisk = stored(0)
    expect(onDisk.work, 'the report was not bounded on the way in').not.toHaveProperty('resources')
    expect(onDisk.attachments?.map((each) => each.path)).toEqual(['/tmp/ok.png'])
    // ⚠️ The control that this reader is reading the row and not the replay: the payload column
    // holds the turn's own text, which no bound touches.
    expect(onDisk.text).toBe('the child answered')
  })

  it('⚠️ a turn with a report and NO attachments still reaches the bound', () => {
    // ⛔ The other half of the ordering: with no attachments the arm below never fires at all and
    // the event falls to `return event` — so this is the path that was unreachable, not merely
    // second in line.
    turn(0, { work: legitimate({ owner: 's'.repeat(CEILING + 1) }) })
    expect(replayed(0).work).not.toHaveProperty('owner')
    expect(replayed(0)).not.toHaveProperty('attachments')
  })
})

describe('518 §3 · a `work` that is not a report at all', () => {
  it('🔴 drops it, which is the shape `describe-event.ts` reads with no guard of its own', () => {
    // ⛔ **The victim, named.** `describe-event.ts` read
    // `event.work === undefined ? '' : event.work.taskId` — a PRESENCE check — and it runs for
    // every row of the Raw Events tab. A stored `work: null` threw inside that map.
    const forged = [null, 'hello', 42, [], true, {}, { piece: 't' }]
    forged.forEach((each, index) => {
      turn(index, { work: each })
      expect(replayed(index).work, JSON.stringify(each)).toBeUndefined()
      // ⚑ …and the turn itself is still a turn, so the drop costs the conversation nothing.
      expect(replayed(index).text).toBe('the child answered')
    })
    // ⛔ **The positive control**: the same door with a real report admits it.
    turn(forged.length, { work: legitimate() })
    expect(replayed(forged.length).work?.piece).toBe(legitimate().piece)
  })

  it('⛔ a `label` that is not a label takes the report — the gate answers what the ids cannot', () => {
    // 🔴 **The label is the one painted field with no length rule of its own**: `work-report.ts`
    // heads the row with it and `WorkReportEntry` renders it (a task's `number` until D-016).
    // ⚠️ The id checks say nothing about it, so the bound's `pieceNumbersOf` is what stops a
    // megabyte reaching a heading — and this is the assertion that makes that gate a measurable
    // proposition rather than a defensible one.
    turn(0, { work: { ...legitimate(), label: 'n'.repeat(500_000) } })
    expect(replayed(0).work).toBeUndefined()
    expect(JSON.stringify(replayed(0))).not.toContain('nnnn')
    // ⚑ The paired positive, in the same sample: a real label survives the same door.
    turn(1, { work: legitimate({ label: 'W1.4' }) })
    expect(replayed(1).work?.label).toBe('W1.4')
  })

  it('🔴 a label `pieceCalled` could not spell takes the report — `Task #NaN` is not a heading', () => {
    // ⛔ **`isAWorkReport` admits any string**, and `work-report.ts` heads the row with it. ⚑
    // `memory_loaded`'s arm two over states the rule this follows, and its example is literally
    // *`NaN memories`*: a heading this app could never have written is dropped, not drawn.
    for (const [index, label] of ['WNaN', 'W1.Infinity', 'Task #4', 'W0', 'W1.0'].entries()) {
      turn(index, { work: { ...legitimate(), label } })
      expect(replayed(index).work, label).toBeUndefined()
    }
    // ⚑ The paired positive, in the same sample — a root's label and a deep one.
    turn(5, { work: legitimate({ label: 'W1' }) })
    expect(replayed(5).work?.label).toBe('W1')
    turn(6, { work: legitimate({ label: 'W12.3.40' }) })
    expect(replayed(6).work?.label).toBe('W12.3.40')
  })

  it('⚠️ the gate is `isAWorkReport` — ONE reading, not a fourth', () => {
    // 🔴 The values the bound drops are exactly the values the fold already refuses, so a row the
    // transcript would not have drawn is a row the ledger no longer carries.
    for (const forged of [null, 'hello', 42, true, { piece: 't' }]) {
      expect(isAWorkReport(forged), JSON.stringify(forged)).toBe(false)
    }
    expect(isAWorkReport(legitimate())).toBe(true)
    // ⛔ **And it stays STRUCTURAL.** `isAWorkReport` admits a state this app has never heard of on
    // purpose — the vocabulary has three readers already and a fourth could disagree with them — so
    // the bound holds LENGTHS and says nothing about membership.
    expect(isAWorkReport({ piece: 't', label: 'W1.1', state: 'sideways' })).toBe(true)
    turn(0, { work: { piece: 'work_x', label: 'W1.1', state: 'sideways' } })
    expect(replayed(0).work?.state).toBe('sideways')
  })
})

describe('518 §5 · the ceiling is the command wire’s own', () => {
  it('🔴 a stored resource id that survives is one `readResource` accepts', () => {
    // ⛔ **The two wires meet here and nowhere else.** A person presses *Open the file kept with
    // this reply* on a replayed row; the renderer sends the stored id straight back. A stored
    // ceiling looser than the command's would publish a live-looking control whose press answers
    // `Too big: expected string to have <=200 characters` — `221 §3`'s own defect, arriving from
    // the direction `wire-bounds.test.ts` does not read.
    const ok = (resourceId: string): boolean =>
      runtimeCommandSchema.safeParse({ kind: 'readResource', resourceId }).success
    expect(ok('d'.repeat(CEILING))).toBe(true)
    expect(ok('d'.repeat(CEILING + 1))).toBe(false)
    // ⚑ …and BOTH SIDES of the same number on the other two ids a report hands back — one side
    // proves the ceiling is not lower, and only the other proves it is not higher.
    const claim = (sessionId: string): boolean =>
      runtimeCommandSchema.safeParse({ kind: 'claim', sessionId }).success
    expect(claim('s'.repeat(CEILING))).toBe(true)
    expect(claim('s'.repeat(CEILING + 1))).toBe(false)
    const task = (taskId: string): boolean =>
      runtimeCommandSchema.safeParse({
        kind: 'readWorkflowOutput',
        sessionId: 'sess_1',
        taskId,
      }).success
    expect(task('t'.repeat(CEILING))).toBe(true)
    expect(task('t'.repeat(CEILING + 1))).toBe(false)
  })

  it('⚠️ …and the store round-trips exactly what that command would accept', () => {
    turn(0, { work: legitimate({ resources: ['d'.repeat(CEILING)] }) })
    const survived = replayed(0).work?.resources?.[0]
    expect(survived).toBeDefined()
    expect(
      runtimeCommandSchema.safeParse({ kind: 'readResource', resourceId: survived }).success,
      'the store handed back an id its own app would refuse',
    ).toBe(true)
  })
})
