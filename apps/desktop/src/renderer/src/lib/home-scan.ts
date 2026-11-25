import { ref, type Ref } from 'vue'
import type { AdoptionReport } from '../../../shared/runtime-ipc'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import { readableError } from './session-record'

/** Scan agent folders and refresh the Library after the scan completes. */
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

/** Concurrent callers of the same sessions capability share an in-flight scan. */
type HomeScanClient = Pick<ClientSessionApi, 'adoptSessions'>
const inFlight = new WeakMap<HomeScanClient, Promise<AdoptionReport>>()

export function useHomeScan(sessions: HomeScanClient | undefined): HomeScan {
  const adoptSessions = sessions?.adoptSessions
  const scanning = ref(false)
  const lastScan = ref<AdoptionReport | null>(null)
  const scannedAt = ref<number | null>(null)

  // Keep the button busy until the Library has refreshed.
  async function scan(
    after?: () => Promise<void>,
  ): Promise<{ report: AdoptionReport } | { error: string } | null> {
    if (scanning.value) return null
    scanning.value = true
    try {
      if (!sessions || !adoptSessions) throw new Error('Session adoption is unavailable')
      let mine = inFlight.get(sessions)
      if (!mine) {
        mine = adoptSessions.call(sessions)
        inFlight.set(sessions, mine)
      }
      try {
        const report = await mine
        lastScan.value = report
        scannedAt.value = Date.now()
        await after?.()
        return { report }
      } finally {
        // Only the run that started it may retire it — a joiner clearing the slot would let a
        // third press start a second concurrent pass.
        if (inFlight.get(sessions) === mine) inFlight.delete(sessions)
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
