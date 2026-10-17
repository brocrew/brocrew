import { ref, type Ref } from 'vue'
import type { AdoptionReport } from '../../../shared/runtime-ipc'
import { readableError } from './session-record'

/**
 * **Looking through the provider homes — ONE operation, surfaced twice** (121, `120` §7).
 *
 * The rail's *"scan for existing sessions"* and Sessions' **Check homes** are the same act, and this
 * file is what makes that a fact rather than a claim. `120` ruled it explicitly:
 *
 * > *"It must be the **same** operation, surfaced twice, never forked… two scan buttons that look
 * > alike and behave differently is **061 finding 6 in control form**."*
 *
 * Expose the scan on the Library because `adoptSessions()` refreshes the `child` descent used by Kind filtering. Hiding that refresh elsewhere can leave the filter reading stale descent.
 *
 * ## What is shared and what is not
 *
 * The call and the wording are shared, because those are the two things that could differ and
 * should not. What each surface does AFTERWARDS is its own: the rail re-lists resumable and
 * unresumable rows, Sessions re-reads the library page it is showing. Sharing that too would mean
 * one press re-reading a list nobody is looking at.
 *
 * The state is per-caller rather than module-level for the same reason: two mounted surfaces each
 * report the press that happened on them, and a shared singleton would have the rail claiming
 * a scan the Sessions page ran while it was not on screen.
 */
export interface HomeScan {
  /** Whether a scan is running from THIS surface. */
  readonly scanning: Ref<boolean>
  /** What the last scan from this surface did, or null before one has been run. */
  readonly lastScan: Ref<AdoptionReport | null>
  /** When it landed, so a surface can say how long ago. Null until one has. */
  readonly scannedAt: Ref<number | null>
  /**
   * Run it. Resolves to the report, or to the failure's message — never throws, because both
   * callers show the failure on their own surface rather than letting it escape into a handler.
   * A second press while one is in flight is refused and reports `null`.
   */
  scan(after?: () => Promise<void>): Promise<{ report: AdoptionReport } | { error: string } | null>
}

/**
 * ⛔ **The run in flight, shared by every caller** (review).
 *
 * Per-surface state is right for REPORTING and wrong for concurrency, and the first version had
 * only the former: `ResumableSessions` is mounted under a `v-show` in the rail while
 * `SessionLibrary` is on screen beside it, so both buttons exist at once and each guarded only
 * itself. Two `adoptSessions()` passes then interleave over the same homes — and that pass adopts
 * by asking the store first, which is a check-then-write.
 *
 * Coalesced rather than refused, because both presses asked the same question: the second joins the
 * first and gets the same report to display.
 */
let inFlight: Promise<AdoptionReport> | null = null

export function useHomeScan(): HomeScan {
  const scanning = ref(false)
  const lastScan = ref<AdoptionReport | null>(null)
  const scannedAt = ref<number | null>(null)

  /**
   * `after` runs INSIDE the busy flag, which is the difference between a button that is honest
   * about being busy and one that re-enables while its own follow-up is still fetching (review).
   * Each surface passes its own: the rail re-lists resumable rows, Sessions re-reads its page.
   */
  async function scan(
    after?: () => Promise<void>,
  ): Promise<{ report: AdoptionReport } | { error: string } | null> {
    if (scanning.value) return null
    scanning.value = true
    try {
      inFlight ??= window.api.runtime.adoptSessions()
      const mine = inFlight
      try {
        const report = await mine
        lastScan.value = report
        scannedAt.value = Date.now()
        await after?.()
        return { report }
      } finally {
        // Only the run that started it may retire it — a joiner clearing the slot would let a
        // third press start a second concurrent pass.
        if (inFlight === mine) inFlight = null
      }
    } catch (cause) {
      return { error: readableError(cause) }
    } finally {
      scanning.value = false
    }
  }

  return { scanning, lastScan, scannedAt, scan }
}

/**
 * **What the scan did, in one sentence — the same sentence on both surfaces.**
 *
 * ⚠️ **`descentsLearned` is in here and it is new** (121). `120`'s mock draws the freshness note as
 * *"4 new, 153 descents back-filled"*, and until this task the report carried no such number — so
 * the caption would have had to invent one. It now counts rows whose recorded descent actually
 * changed, which is a smaller and truer number than anything nearby: `113` measured 153 as the
 * child-chip count in one 200-row window, and the rail's collapsed summary counts closed threads.
 * Three different quantities that happened to be one number in a mock.
 *
 * The wording is deliberately plain about doing nothing: a scan that adopts nothing can still have
 * imported or learned something, and a summary that said "nothing found" over a panel
 * listing what it found and rejected would be contradicting its own detail.
 */
export function scanSummary(report: AdoptionReport | null): string | null {
  if (report === null) return null
  /**
   * ⚠️ **Lifted from `ResumableSessions.vue` UNCHANGED except for the new clause** (121). The rail
   * is the reopen lane and `120` §9.10 says leave it alone; rewording its summary to something
   * tidier would be changing it, so this is its own sentence, now said in two places.
   *
   * The early return cannot hide the new number: `found === 0` means the loop that learns descents
   * never ran a step, so `descentsLearned` is zero whenever this branch is taken.
   */
  if (report.found === 0 && report.imported === 0) {
    // "nothing found" while the panel below lists what was found and rejected would be the
    // summary contradicting its own detail.
    return report.skipped.length > 0
      ? 'nothing new to adopt — see below'
      : "nothing found in any profile's folder"
  }
  const parts = [`${report.adopted} adopted`]
  if (report.alreadyKnown > 0) parts.push(`${report.alreadyKnown} already known`)
  // Importing happens to sessions we already had, so it is worth saying separately: a scan that
  // adopts nothing can still have done real work.
  if (report.imported > 0) parts.push(`${report.imported} transcript(s) imported`)
  // ⚑ And the one this task added — the reason the button is on Sessions at all.
  if (report.descentsLearned > 0)
    parts.push(
      `${report.descentsLearned} descent${report.descentsLearned === 1 ? '' : 's'} recorded`,
    )
  // ⚑ 727 · R87 — a conversation this app started, which a reopen can reach again.
  if (report.named > 0)
    parts.push(
      `${report.named} conversation${report.named === 1 ? '' : 's'} this app started can be reopened again`,
    )
  return parts.join(', ')
}
