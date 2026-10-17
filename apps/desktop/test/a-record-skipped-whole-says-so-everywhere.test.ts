import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  rowsUnreadSays,
  unreadSays,
  waitsNotReadSays,
  waitsUnreadSays,
} from '../src/renderer/src/lib/rows-unread'
import { activitySays } from '../src/renderer/src/lib/recent-activity'
import type { RecentActivityReading } from '../src/shared/recent-activity'
import { distil, distilSkipping } from '../src/main/runtime/digest'
import type { DigestRow } from '../src/main/db/session-store'
import type { LedgerWalk } from '../src/shared/questions'
import {
  NOTHING_GIVEN_OUT,
  workGivenOutView,
  type WorkGivenOutReading,
} from '../src/renderer/src/lib/work-given-out'
import { workingTogetherView } from '../src/renderer/src/lib/working-together'
import type { WhoCalledWhom } from '../src/shared/who-called-whom'
import { forestView } from '../src/renderer/src/lib/the-forest'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'
import { NOTHING_IT_WAITS_ON } from '../src/shared/tasks'

/**
 * # 🔴 D-017 · R8 — a record skipped whole says so everywhere, not only where a torn ROW does
 *
 * ⚑ **R8's own words**: a conversation whose ledger throws is skipped WHOLE, counted apart from the
 * `rowsUnread` a torn row leaves — a whole record is not one row, and counting it as one would
 * understate it. ⛔ **`rows-unread.ts` composes the sentence in one place** and six other readers —
 * `digest.ts` (renderer and main), `work-given-out.ts`, `working-together.ts`, `the-forest.ts`, and
 * the Vue paragraphs that gate on it (two since D-016 took the project room's out) — each have to
 * carry `ledgersSkipped` through to it rather than stopping at `rowsUnread`. ⚠️ **This file pins that the count survives the whole chain,
 * kept beside — never summed into — the unread-rows count at every stop**, mirroring M20–M29.
 *
 * ⚑ **Where each `it` sits against the copied file's shape**: pure composers first
 * (`the-night-the-digest-could-not-describe.test.ts` §1's method, one vocabulary over), then the
 * fold and its isolation path, then the three renderer surfaces, then the one durable constant D-017
 * added, then the census over the components that draw the sentence.
 */

const here = dirname(fileURLToPath(import.meta.url))
const rendererComponents = join(here, '../src/renderer/src/components')
const componentSource = (name: string): string =>
  readFileSync(join(rendererComponents, name), 'utf8')

const NOW = 1_800_000_000_000

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · rows-unread.ts — the two sentences that compose the count
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · D-017 R8 · `rows-unread.ts` composes the rows-unread and skipped-ledger sentences', () => {
  it('unreadSays composes the rows-unread sentence and the D-017 skipped-ledger sentence, and neither survives alone at zero', () => {
    expect(unreadSays(0, undefined)).toBeNull()
    expect(unreadSays(0, 0)).toBeNull()

    // ⚑ The rows-only case is its own control: a non-zero rows count with no skip still says
    // something, byte for byte what `rowsUnreadSays` says on its own.
    expect(unreadSays(2, undefined)).toBe(rowsUnreadSays(2))
    expect(unreadSays(2, undefined)).toBe(
      '2 rows of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.',
    )

    // ⛔ The skipped-only case, singular and plural — never "1 conversations’ records".
    expect(unreadSays(0, 1)).toBe(
      '1 conversation’s record could not be read, so a piece of work may be missing here, or its state may be wrong.',
    )
    expect(unreadSays(0, 3)).toBe(
      '3 conversations’ records could not be read, so a piece of work may be missing here, or its state may be wrong.',
    )

    // 🔴 Both at once: the two sentences, joined by exactly one space, rows-sentence first.
    expect(unreadSays(2, 1)).toBe(`${rowsUnreadSays(2)} ${unreadSays(0, 1)}`)
  })

  it('waitsNotReadSays says the WAITING sentence for a record skipped whole too, and never the work-may-be-missing sentence', () => {
    expect(waitsNotReadSays(0, undefined)).toBeNull()
    expect(waitsNotReadSays(0, 0)).toBeNull()

    expect(waitsNotReadSays(0, 1)).toBe(
      '1 conversation’s record could not be read, so a conversation shown here may be waiting without saying so.',
    )
    expect(waitsNotReadSays(0, 2)).toBe(
      '2 conversations’ records could not be read, so a conversation shown here may be waiting without saying so.',
    )

    // ⚑ Rows-only and skipped-only are each other's control; both-at-once is their composition.
    expect(waitsNotReadSays(1, 1)).toBe(`${waitsUnreadSays(1)} ${waitsNotReadSays(0, 1)}`)

    // ⛔ 685's distinguishing assertion, mirrored: this vocabulary never claims a piece of work may
    // be missing — only that a conversation shown here may be waiting without saying so.
    for (const said of [
      waitsUnreadSays(1),
      waitsNotReadSays(0, 1),
      waitsNotReadSays(0, 2),
      waitsNotReadSays(1, 1),
    ]) {
      expect(said).not.toBeNull()
      expect(said).not.toContain('may be missing')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · digest.ts (renderer + main) — torn, gapped, and skipped around
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A Recent activity reading, so what it says can be asked without a database. */
function activity(
  read: RecentActivityReading['read'],
  lines: RecentActivityReading['lines'] = [],
): RecentActivityReading {
  return { window: { from: 0, to: 1 }, read, lines, capped: false } as RecentActivityReading
}

const oneLine: RecentActivityReading['lines'] = [
  {
    id: 'a',
    at: 0,
    what: 'finished',
    register: 'claimed',
    piece: { id: 'a', label: 'W1.1', title: null },
    agent: 'Ada',
    conversation: null,
  },
]

describe('§2 · D-017 R8 · Recent activity reads a record skipped whole', () => {
  it('a reading is read in part when a whole ledger was skipped, even with zero unread rows', () => {
    const skipped = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 4,
      rowsUnread: 0,
      ledgersSkipped: 2,
    } as const
    expect(activitySays(activity(skipped, oneLine))).toBe('read-in-part')
    expect(activitySays(activity(skipped))).toBe('read-in-part')

    // ⚑ Paired positive: the same shape with NO `ledgersSkipped` field at all, which reads whole.
    const whole = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 4,
      rowsUnread: 0,
    } as const
    expect(activitySays(activity(whole, oneLine))).toBe('lines')
    expect(activitySays(activity(whole))).toBe('nothing-recorded')
  })

  it('the digest’s own gap for a record skipped whole is counted and worded apart from an unread row', () => {
    const name = (id: string): string => id

    const skippedTwo: LedgerWalk<DigestRow> = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 2,
      rowsUnread: 0,
      rows: [],
      ledgersSkipped: 2,
    }
    expect(distil(skippedTwo, name).gaps).toEqual([
      {
        kind: 'source-skipped',
        count: 2,
        says: '2 conversations’ records could not be read, so part of what happened here is missing from every line above. ⚠️ Nothing records why.',
      },
    ])

    const skippedOne: LedgerWalk<DigestRow> = { ...skippedTwo, ledgersSkipped: 1 }
    const saidOne = distil(skippedOne, name).gaps.find((gap) => gap.kind === 'source-skipped')
    expect(saidOne?.says.startsWith('1 conversation’s record could not be read')).toBe(true)

    // ⚑ Paired positive: rowsUnread carries the count instead, and the two gaps do not cross.
    const unreadTwo: LedgerWalk<DigestRow> = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 2,
      rowsUnread: 2,
      rows: [],
      ledgersSkipped: 0,
    }
    const unreadGaps = distil(unreadTwo, name).gaps
    expect(unreadGaps.find((gap) => gap.kind === 'source-unreadable')?.count).toBe(2)
    expect(unreadGaps.map((gap) => gap.kind)).not.toContain('source-skipped')
  })

  it('distilSkipping folds around the one conversation whose ledger the fold cannot read, and counts it whole', () => {
    const rowGood: DigestRow = {
      sessionId: 'sess_good',
      ordinal: 0,
      at: NOW,
      event: {
        type: 'work_given',
        piece: 'work_1',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'x',
        brief: 'x',
      },
    }
    const rowBad: DigestRow = {
      sessionId: 'sess_bad',
      ordinal: 0,
      at: NOW + 1,
      event: {
        type: 'work_given',
        piece: 'work_2',
        label: 'W1.2',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'x',
        brief: 'x',
      },
    }
    const read: LedgerWalk<DigestRow> = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 2,
      rowsUnread: 0,
      rows: [rowGood, rowBad],
    }
    const name = (id: string): string => {
      if (id === 'sess_bad') throw new Error('boom')
      return id.replace('sess_', '')
    }
    // ⛔ The precondition that makes the isolation path meaningful: the whole-read fold really does
    // throw on this fixture.
    expect(() => distil(read, name)).toThrow()

    const warn = console.warn
    console.warn = (): void => {}
    let result: ReturnType<typeof distilSkipping>
    try {
      result = distilSkipping(read, name)
    } finally {
      console.warn = warn
    }

    expect(result.read.rows).toEqual([rowGood])
    expect(result.read.ledgersSkipped).toBe(1)
    expect(result.read.rowsUnread).toBe(0)
    const line = result.distilled.lines.find((one) => one.kind === 'work-handed-out')
    expect(line).toBeDefined()
    expect(line?.text).toContain('good')
    expect(line?.text).not.toContain('bad')
    // ⛔ **Not an exact-length check**: rowGood's own piece is legitimately counted by
    // `work-without-an-ending` too (nothing in this fixture replies to it) — what this pins is that
    // the SKIP is counted apart from an unread ROW, which `source-unreadable` would be.
    expect(result.distilled.gaps).toContainEqual(
      expect.objectContaining({ kind: 'source-skipped', count: 1 }),
    )
    expect(result.distilled.gaps.map((gap) => gap.kind)).not.toContain('source-unreadable')

    // ⚑ Paired positive: a name() that never throws is a transparent no-op over the ordinary read.
    const neverThrows = (id: string): string => id.replace('sess_', '')
    expect(distilSkipping(read, neverThrows)).toEqual({
      read,
      distilled: distil(read, neverThrows),
    })
  })

  it('when even an isolated ledger cannot save the fold, distilSkipping gives up on every conversation in the read rather than guessing which one is bad', () => {
    const rowGood: DigestRow = {
      sessionId: 'sess_good',
      ordinal: 0,
      at: NOW,
      event: {
        type: 'work_given',
        piece: 'work_1',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'x',
        brief: 'x',
      },
    }
    const rowBad: DigestRow = {
      sessionId: 'sess_bad',
      ordinal: 0,
      at: NOW + 1,
      event: {
        type: 'work_given',
        piece: 'work_2',
        label: 'W1.2',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'x',
        brief: 'x',
      },
    }
    const read: LedgerWalk<DigestRow> = {
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 2,
      rowsUnread: 0,
      rows: [rowGood, rowBad],
    }
    // ⛔ Reproduces distilSkipping's documented "a fault only two conversations’ rows reproduce
    // together" branch: the whole-read attempt throws on its 2nd call (sess_bad), each of the two
    // per-session isolation retries succeeds alone (calls 3 and 4, so neither is individually
    // blamed), and the final retry over the still-unfiltered "kept" set throws again on its 6th
    // call. This test is coupled to distilSkipping's own call order (whole attempt, then per-session
    // in Set-insertion order, then one retry) — a deliberate trade-off, since fold()'s switch has no
    // data shape that makes it throw on its own (its default arm is a silent no-op), so a
    // caller-supplied name() misbehaving is the only realistic trigger.
    let calls = 0
    const name = (id: string): string => {
      calls += 1
      if (calls === 2 || calls === 6) throw new Error(`boom#${String(calls)}`)
      return id.replace('sess_', '')
    }

    const warn = console.warn
    console.warn = (): void => {}
    let result: ReturnType<typeof distilSkipping>
    try {
      result = distilSkipping(read, name)
    } finally {
      console.warn = warn
    }

    expect(result.read.rows).toEqual([])
    expect(result.read.ledgersSkipped).toBe(2)
    expect(result.distilled.lines).toEqual([])
    expect(result.distilled.gaps).toEqual([
      expect.objectContaining({ kind: 'source-skipped', count: 2 }),
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · every surface a reading of ledgersSkipped reaches
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · D-017 R8 · every reader that draws a walk’s completeness carries the skip through', () => {
  it('a conversation is not read as having given nobody work while one of its ledgers was skipped whole', () => {
    const reading: WorkGivenOutReading = {
      conversation: 'sess_a',
      walk: {
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 1,
        rowsUnread: 0,
        rows: [],
        ledgersSkipped: 2,
      },
      answered: true,
      at: NOW,
    }
    const view = workGivenOutView({
      reading,
      forConversation: 'sess_a',
      identities: null,
      now: NOW,
    })
    expect(view?.empty).toBeNull()
    expect(view?.short).toBe(unreadSays(0, 2))
    expect(view?.unread).toBe(0)

    // ⚑ Paired positive: the same reading with `ledgersSkipped` left off entirely.
    const wholeReading: WorkGivenOutReading = {
      conversation: 'sess_a',
      walk: {
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 1,
        rowsUnread: 0,
        rows: [],
      },
      answered: true,
      at: NOW,
    }
    const wholeView = workGivenOutView({
      reading: wholeReading,
      forConversation: 'sess_a',
      identities: null,
      now: NOW,
    })
    expect(wholeView?.empty).toBe(NOTHING_GIVEN_OUT)
    expect(wholeView?.short).toBeNull()
  })

  it('the gave-out and taken-in lists read as short when a whole ledger was skipped, even at zero unread rows', () => {
    const read: WhoCalledWhom = {
      conversation: 'sess_a',
      parent: null,
      children: {
        walk: 'every-conversation-this-one-spawned',
        ledgers: 0,
        rowsUnread: 0,
        rows: [],
      },
      workGivenOut: {
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 2,
        rowsUnread: 0,
        rows: [],
        ledgersSkipped: 2,
      },
      workTakenIn: {
        walk: 'every-piece-of-work-this-one-was-given',
        ledgers: 0,
        rowsUnread: 0,
        rows: [],
      },
      readAt: NOW,
    }
    const view = workingTogetherView({
      reading: { conversation: 'sess_a', read, answered: true, atWork: null },
      forConversation: 'sess_a',
      identities: null,
      now: NOW,
    })
    expect(view?.gaveOutShort).toBe(unreadSays(0, 2))

    // ⚑ Paired positive: the same shape with `workGivenOut.ledgersSkipped` left off — a genuinely
    // complete, empty list.
    const wholeRead: WhoCalledWhom = {
      ...read,
      workGivenOut: {
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 2,
        rowsUnread: 0,
        rows: [],
      },
    }
    const wholeView = workingTogetherView({
      reading: { conversation: 'sess_a', read: wholeRead, answered: true, atWork: null },
      forConversation: 'sess_a',
      identities: null,
      now: NOW,
    })
    expect(wholeView?.gaveOutShort).toBeNull()
  })

  it('the forest’s own coverage sentence names a whole record skipped, kept beside — never summed into — its unread-rows count', () => {
    const conversation = (id: string): ForestNode =>
      ({
        node: 'a-conversation',
        conversation: id,
        under: { is: 'the-person' },
        identity: 'worker',
        provider: 'claude',
        status: 'idle',
        running: 'unwatched',
        standsInFor: [],
        inItsPlace: null,
        startedAt: NOW - 60_000,
        updatedAt: NOW - 1_000,
      }) as ForestNode

    const forest = (rowsUnread: number, ledgersSkipped: number | undefined) =>
      forestView({
        forest: {
          readAt: NOW,
          nodes: {
            rows: [conversation('sess_a')],
            walk: 'every-conversation-this-app-placed',
            ledgers: 1,
            rowsUnread,
            ...(ledgersSkipped === undefined ? {} : { ledgersSkipped }),
          },
          conversations: 1,
          heldByNoAgent: 0,
        } as TheWholeForest,
        atWork: null,
        waits: null,
        identities: null,
        held: new Set<string>(),
      })!

    const view = forest(0, 2)
    expect(view.coverage.short).toBe(unreadSays(0, 2))
    expect(view.coverage.rowsUnread).toBe(0)

    // ⚑ Paired positive: nothing unread and nothing skipped draws no sentence at all.
    expect(forest(0, undefined).coverage.short).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · a conversation whose whole record was skipped waits on nothing this read saw
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · D-017 R8 · `NOTHING_IT_WAITS_ON`', () => {
  it('NOTHING_IT_WAITS_ON is genuinely nothing — no pending answers, no open children and no person', () => {
    // ⚑ D-016 · the wait is per piece now: the pieces it asked about, a person, and the pieces with
    // an open piece given under them — so "nothing" is two empty sets and one false flag.
    expect(NOTHING_IT_WAITS_ON).toEqual({
      answers: new Set(),
      aPerson: false,
      childrenOpen: new Set(),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the paragraphs gate on the composed sentence, never on the raw count
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · D-017 R8 · the unread-rows paragraphs gate on `.short`, never on a raw count', () => {
  it('the unread-rows paragraphs gate on the composed sentence, never on the raw unread count alone', () => {
    // ⚑ D-016 took the third paragraph out with the project room (`ProjectWorkspace.vue`).
    const sessionWork = componentSource('SessionWork.vue')
    const teamForest = componentSource('TeamForest.vue')

    const lineWith = (source: string, needle: string): string => {
      const line = source.split('\n').find((one) => one.includes(needle))
      expect(line, `no line in the source contains ${needle}`).toBeDefined()
      return line ?? ''
    }

    // ⚑ This is itself the missing half of two already-rendered controls
    // (`the-forest-from-the-person-down.dom.test.ts`, `one-count-one-sentence.dom.test.ts`), which
    // already prove the paragraph draws correctly when the raw count is > 0. What neither states is
    // that the gate is no longer that raw count — asserted here as a source census.
    expect(lineWith(sessionWork, 'data-cy="work-short"')).toContain('v-if="view.short"')
    expect(lineWith(teamForest, 'data-cy="forest-rows-unread"')).toContain(
      'v-if="props.view.coverage.short"',
    )

    for (const source of [sessionWork, teamForest]) {
      expect(source).not.toContain('unread > 0')
      expect(source).not.toContain('rowsUnread > 0')
    }
  })
})
