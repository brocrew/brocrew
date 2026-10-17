import type { FileChange } from '@brobot2/runtime'
import type { TranscriptItem, TranscriptState } from './transcript'

/**
 * 096 · **What this conversation did to your working tree**, folded to one row per file.
 *
 * The pane's whole unit is the DISTINCT FILE, not the turn and not the edit (092 §4): a conversation
 * that rewrites one file 200 times is 200 turns of transcript and **one row** here. That is what
 * makes the collapsed pane affordable after 054 measured the transcript fold going quadratic
 * (2,646 ms and ~1 GB at 1,600 turns), and it is why {@link ChangeRow} carries no diff text at all —
 * the body stays where the observation is, on the item, and one is read on expand.
 */

/** One file, as a row draws it. Metadata only — see {@link ChangeSet} for why. */
export interface ChangeRow {
  readonly path: string
  readonly status: FileChange['status']
  readonly oldPath?: string
  readonly added?: number
  readonly removed?: number
  /** True when THIS file's diff was over the per-file ceiling — the row stubs to "open in editor". */
  readonly oversize?: boolean
  /** True when the diff would have fit but the report's budget was spent by the files ahead of it. */
  readonly crowdedOut?: boolean
  /** The report holding this file's diff, or null when no diff is held for it. */
  readonly bodyReportId: string | null
  /** The provider signal this row came from — `turn/diff/updated`, `Edit`, `Write`. */
  readonly source: string
  /** The turn this file was last touched in, counting from 1. Drives the This turn / Whole scope. */
  readonly turn: number
}

export interface ChangeSet {
  /** One row per distinct path, in the order the files were first seen. */
  readonly rows: ChangeRow[]
  /** The turn number the conversation is on — `rows.filter(r => r.turn === turn)` is "this turn". */
  readonly turn: number
  /**
   * How many changes are known to have happened with the files undisclosed (092 §3).
   *
   * ⚠️ **A count, and deliberately not rows.** The provider told us a file change was approved and
   * did not say which files; there is nothing to name, so the pane draws ONE faceless row saying so
   * and no path and no count appear anywhere near it. Fabricating N rows to match N approvals would
   * be exactly the invention this whole surface is built to refuse.
   */
  readonly underDisclosed: number
  /** Rows a report named beyond the cap. Non-zero is stated on the surface, never swallowed. */
  readonly dropped: number
  /**
   * Whole REPORTS this conversation no longer holds, because it rolled its reading window past
   * `MAX_CARRIED_CHANGE_REPORTS` (299 §2 finding 5).
   *
   * ⚠️ **Reports, not files, and the difference is what can honestly be said.** {@link dropped}
   * counts files a report NAMED and we did not keep; this counts observations that are gone whole,
   * so there is no file count to give and inventing one would be the invention this surface exists
   * to refuse. Zero for any conversation short enough never to roll its window.
   */
  readonly droppedReports: number
  /** Distinct provider signals that fed this set — the pane labels its source rather than averaging. */
  readonly sources: string[]
}

export const EMPTY_CHANGE_SET: ChangeSet = {
  rows: [],
  turn: 0,
  underDisclosed: 0,
  dropped: 0,
  droppedReports: 0,
  sources: [],
}

/**
 * Fold a transcript into its change set.
 *
 * Later wins per path, which is right for both providers and for two different reasons: Codex's
 * `turn/diff/updated` is a full snapshot of the turn re-sent three to five times (measured), so
 * later is the same answer; Claude reports one edit at a time, so later is the newer edit.
 *
 * ⚠️ **A file the agent wrote and then put back is KEPT** — 074, quoted by 092: *"don't claim what
 * you didn't observe and don't hide what you did."* It arrives as a real diff whose counts are zero,
 * and the pane tags it `net unchanged`. This is the reason `added`/`removed` being ABSENT and being
 * ZERO must stay different all the way down: absent means nobody counted (Claude), zero means
 * somebody counted and the answer was nothing.
 */
export function changeSet(state: TranscriptState): ChangeSet {
  const byPath = new Map<string, ChangeRow>()
  const sources: string[] = []
  let underDisclosed = 0
  let dropped = 0

  // The one place a change we know happened but were not told the contents of is counted. It comes
  // from the permission cards rather than from an event of its own, because the flag is already
  // there and already correct — see {@link isUndisclosedFileChange}.
  //
  // ⚠️ **Only the FILE cards are walked, and that is a real bound rather than a tidy-up** (review).
  // This is a Vue `computed` read by the drawer on every render, so an unconditional walk of
  // `state.items` re-scans the whole conversation each time an event lands — O(n²) over a session,
  // which is precisely the shape 054 measured going quadratic. `cardTools` is not the right index
  // either; the transcript keeps no list of permission items. So the walk stays, but it stops at the
  // first field: `kind === 'permission'` is a string compare on a discriminant, and a conversation's
  // cards are a handful among thousands of items.
  for (const item of state.items)
    if (item.kind === 'permission' && isUndisclosedFileChange(item)) underDisclosed += 1

  // ⚠️ **The SAME reading the reports were stamped with** (review). The log counts turns from zero
  // and a report is stamped `max(turn, 1)`, because a change can be reported before the reader has
  // said anything — a resumed session replaying, an agent that moves first. Reading a bare `turn`
  // here made "This turn" match nothing while the pane held rows, which is an empty scope drawn over
  // real content. One expression, used at both ends.
  const turn = Math.max(state.changes.turn, 1)
  for (const report of state.changes.reports) {
    dropped += report.dropped
    if (!sources.includes(report.source)) sources.push(report.source)
    for (const change of report.changes) {
      const existing = byPath.get(change.path)
      byPath.set(change.path, {
        path: change.path,
        status: change.status,
        ...(change.oldPath !== undefined ? { oldPath: change.oldPath } : {}),
        ...(change.added !== undefined ? { added: change.added } : {}),
        ...(change.removed !== undefined ? { removed: change.removed } : {}),
        ...(change.oversize ? { oversize: true } : {}),
        ...(change.crowdedOut ? { crowdedOut: true } : {}),
        // ⚠️ A later report that carries no body must not erase a body we already hold. Codex re-sends
        // the same snapshot, so later usually carries the same text — but a report whose bodies were
        // RELEASED to bound memory carries none, and without this an expandable row would silently
        // stop expanding the moment the twenty-first report arrived.
        bodyReportId: change.diff !== undefined ? report.id : (existing?.bodyReportId ?? null),
        source: report.source,
        turn: report.turn,
      })
    }
  }
  return {
    rows: [...byPath.values()],
    turn,
    underDisclosed,
    dropped,
    droppedReports: state.changes.dropped,
    sources,
  }
}

/**
 * A file change this app allowed without being told which files (092 §3, from `codex-runtime.ts`).
 *
 * Codex's `item/fileChange/requestApproval` params carry a reason and an optional grant root and
 * **not the changed files** — they live on the `fileChange` item — so the adapter already flags the
 * scope `underDisclosed`. That flag is the whole source here; nothing new is emitted for it.
 *
 * ⚠️ **`outcome` must be an allow.** A declined approval changed nothing, and a card still frozen
 * awaiting an answer has changed nothing YET. Counting either would put a permanent "we don't know
 * what happened" row under a conversation where demonstrably nothing happened.
 */
function isUndisclosedFileChange(item: Extract<TranscriptItem, { kind: 'permission' }>): boolean {
  if (item.request.kind !== 'file') return false
  if (!item.request.scope.underDisclosed) return false
  return (
    item.outcome === 'allow' ||
    item.outcome === 'allow_for_session' ||
    item.outcome === 'allow_all_for_session' ||
    item.outcome === 'allow_always'
  )
}

/** The diff body for a row, read from the item it was recorded on — the ONE lazy read (092 §4). */
export function diffBody(state: TranscriptState, row: ChangeRow): string | null {
  if (row.bodyReportId === null) return null
  const report = state.changes.reports.find((entry) => entry.id === row.bodyReportId)
  return report?.changes.find((change) => change.path === row.path)?.diff ?? null
}

/** Rows in the reader's chosen scope. `'turn'` is the turn the conversation is on right now. */
export function scoped(set: ChangeSet, scope: 'turn' | 'conversation'): ChangeRow[] {
  return scope === 'conversation' ? set.rows : set.rows.filter((row) => row.turn === set.turn)
}

/** `+N −N` totals across rows — absent counts contribute nothing, they do not contribute zero. */
export function totals(rows: readonly ChangeRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    added += row.added ?? 0
    removed += row.removed ?? 0
  }
  return { added, removed }
}

/**
 * True when a diff was read for this file and came to nothing — 092's `net unchanged` tag.
 *
 * ⚠️ **A second copy of the runtime's rule, and the duplication is CHECKED rather than removed.**
 * Review was right that two copies drift: the obvious future refinement — *"net unchanged applies to
 * a `modified` file, not a `deleted` one"* — would land on one, compile clean, and leave the pane
 * saying the wrong thing. Delegating to `@brobot2/runtime`'s copy was tried and reverted: it is a
 * VALUE import, so it drags the package index — and `codex/generated-image.ts`'s `node:fs` — into a
 * browser bundle, which broke the DOM project outright. The renderer's seam
 * (`shared/runtime-ipc.ts`) carries types only, by design.
 *
 * So the rule stays here and `changes.test.ts` runs BOTH implementations over the same table. A
 * refinement applied to one copy fails that test, which is the guarantee the import was for.
 */
export function isNetUnchanged(row: ChangeRow): boolean {
  return row.added === 0 && row.removed === 0
}

/**
 * How many files the tab's quiet count shows, or `null` for absent (092 §2, from 081: never a zero).
 *
 * ⚠️ It counts the **whole conversation**, not the scope the pane happens to be showing: the badge's
 * job is *"something changed while you were looking elsewhere"*, and a reader on This turn who saw a
 * `2` drop to nothing when they switched scope would be reading the toggle, not the tree.
 */
export function tabCount(set: ChangeSet): number | null {
  return set.rows.length > 0 ? set.rows.length : null
}
