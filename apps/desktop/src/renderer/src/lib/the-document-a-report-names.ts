import type { WorkReport } from '../../../shared/tasks'
import type { TranscriptItem } from './transcript'

/**
 * Turn file ids named by a work report into resources the person can open.
 *
 * ## ⛔ The sentence is CORRECT, and that is why this file exists rather than a rewording
 *
 * ⚠️ **`replyText` addresses the parent AGENT.** `read_document` is that agent's tool, and `380`'s
 * rule is why an id appears there rather than a path — the id is what `read_document` takes. ⚑
 * Nothing about those words is the defect. **What was missing is a door for the PERSON reading the
 * same row**, and a person's door needs the id as a FACT rather than as a phrase in a paragraph.
 *
 * ## ⛔ Derived from the REPORT, never from the sentence beside it
 *
 * 🔴 **The ids are printed in the row's own body, six lines under where this control draws** — the
 * `msg-body` is `replyText`'s output verbatim. ⚠️ **A control parsed out of it would be the one
 * thing `work-report.ts` forbids by name**: *"Nothing here is computed from the words … a renderer
 * that read the outcome out of the prose would be a second reading of a fold it cannot see."* ⛔ So
 * the ids are on {@link WorkReport.resources} and this reads the field.
 *
 * ## ⚑ A SECOND lib and not a field on `WorkIsWith`, argued from that file's own docblock
 *
 * ⛔ **`where-the-work-is.ts` is about a CONVERSATION and says so in its filename.** All three of
 * its fields answer *where is the work*; a file is not where the work is, and one returned object
 * answering two unrelated questions is `395`'s defect — the same one `transcript.ts` cites as the
 * reason `WorkReportItem` was split out at all.
 *
 * ⚠️ **And its two nulls do not transfer.** One is *the report names no conversation*; the other is
 * *this surface cannot say what the window holds* — a fact about the RUNTIME, carried as
 * `held: ReadonlySet<string> | null`. ⛔ A file's door needs no held set: it needs to know whether
 * the surface has a reader behind it. Folding a third question into that same guard is `506 M5`'s
 * hazard widened — *"the difference between `this window holds none` and `this window cannot say`
 * collapsed into one answer"*.
 *
 * ⚑ **What it DOES copy is the shape**: pure and total, so a test drives every arm with no renderer
 * at all.
 */

/**
 * ⛔ **The resource ids a work report's row may offer — empty for nothing at all.**
 *
 * ⚠️ **Two absences, and each is a missing FACT rather than a refusal** — `118`'s rule, which
 * `where-the-work-is.ts` applies to the conversation one field over: a control is absent where
 * nothing would make it work.
 *
 *  - **The reply handed in no file.** The commonest case by far: most replies fit in the summary,
 *    and `reply_to_parent`'s `resource_paths` is an optional argument. ⛔ It is not *"the answer is
 *    missing"*.
 *  - **The surface has no reader behind it.** `ReadingPane` and `ChildWorkViewer` render the same
 *    transcript with no door to ask, which is `TranscriptView.canOpenStore`'s own default and its
 *    stated reason.
 *
 * ## 🔴 Each id is guarded and not merely the list
 *
 * ⛔ **`typeof === 'string'`, because the wire is not typed at the boundary it crosses.**
 * `toPersistedEvents` CASTS (`JSON.parse(row.payload) as TranscriptEvent`), a `.brobot` bundle is
 * validated as `z.object({ type: z.string().min(1) }).passthrough()` and written verbatim, and
 * `isAWorkReport` is structural by design — it checks `piece`, `label` and `state` and says so.
 * ⚠️ So `resources: 42` and `resources: [{}]` are bytes on disk rather than hypotheses, and a
 * presence check would hand one of them to the bridge. ⚑ `wasRelayed` and `workIsWith` guard the
 * same way, for the same reason.
 */
export function theResourcesAReportNames(
  report: Pick<WorkReport, 'resources'>,
  /** Whether this surface can actually ask for the bytes. ⛔ `false` draws nothing. */
  canOpen: boolean,
): readonly string[] {
  const resources: unknown = report.resources
  if (!canOpen || !Array.isArray(resources)) return []
  return resources.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * 🔴 **Every resource THIS TRANSCRIPT was handed, as a roster** (562) — the set a model's own
 * sentence is matched against before any of it becomes a press.
 *
 * ## ⛔ One derivation with the row's press, and that is the whole point of it being here
 *
 * ⚠️ **`562` §4.4 asks whether the two presses are one decision about WHEN.** ⛔ They are, and they
 * are by construction rather than by agreement: this function calls
 * {@link theResourcesAReportNames} once per row and keeps what it answered. ⚑ To make the prose
 * control and the meta-row button disagree, somebody has to write a second predicate — which is
 * what `562 M5` does.
 *
 * ## ⚠️ What it is NOT, and the cost is stated rather than hidden
 *
 * ⛔ **It is not every resource this app holds.** ⚑ **So an id naming a real resource this
 * conversation was never told about draws no control** — `118`'s direction of travel: less, never
 * something else.
 *
 * ⛔ **And it is the WINDOW's items, not the conversation's whole history.** `transcript-window.ts`
 * re-folds from `createTranscript()` on every window change, so a report that has scrolled out of
 * the window is out of this roster too — which is also why the resolution could not be cached onto
 * an item (`562` §3.2): anything not re-derivable from the events in the window is discarded at the
 * next release.
 *
 * @param canOpen whether this surface can actually ask for the bytes — `false` yields an empty
 *   roster, so a surface with no reader draws no control anywhere, exactly as its rows draw none.
 */
export function everyResourceAReportNames(
  items: readonly TranscriptItem[],
  canOpen: boolean,
): readonly string[] {
  const found: string[] = []
  for (const item of items) {
    if (item.kind !== 'workReport') continue
    found.push(...theResourcesAReportNames(item.report, canOpen))
  }
  // ⚑ **Deduped, because nothing stops two reports naming one id** — and a roster with a duplicate
  // builds an alternation that matches the same string twice over for no gain.
  return [...new Set(found)]
}

/**
 * ⚑ **The words on the press.** ⛔ One constant, because the row and every test that pins it must
 * read the same bytes — `169` §1, one rule spelled in two places drifts.
 *
 * ⚠️ **It says what the press OPENS and never what it costs.** `taking-over.ts` exists because
 * opening a conversation is two different acts and a person must be told which; reading a file is
 * one act, claims nothing, changes nothing, and ends when the panel is closed. ⛔ A second sentence
 * here would be borrowing a disclosure from a gesture that has a cost to disclose.
 *
 * ⚠️ **Not *"Read the full response"*, which it said until D-016**: the reply's summary is the whole
 * reply now, and a file kept with it is something the reply handed in beside it.
 */
export const OPEN_THE_DOCUMENT = 'Open the file kept with this reply'

/**
 * ⚑ **The press's words when a reply kept SEVERAL files** — which one of how many, because a row of
 * presses that all said {@link OPEN_THE_DOCUMENT} would not tell a person which is which, and the
 * file's name is not known until it is read.
 */
export function openTheDocumentSaid(index: number, count: number): string {
  return count === 1
    ? OPEN_THE_DOCUMENT
    : `Open file ${String(index + 1)} of ${String(count)} kept with this reply`
}
