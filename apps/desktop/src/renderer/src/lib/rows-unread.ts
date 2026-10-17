/**
 * # 🔴 678 · F-R18 — one count, one sentence, true for what the count now means
 *
 * ⚑ **`671` made every ledger walk COUNT a row it could not read instead of raising** (`R18`), and
 * put that count — `rowsUnread` — on the payload of each walk. ⛔ **What the count means grew with
 * it**: a torn row can hide a piece of work, AND — since the walks compose a task's state from
 * several rows (its assignment, its reply, the wait read on its holder) — it can leave a task that
 * IS drawn in the wrong state. ⚠️ **Main's own tool sentence says both** (`list_tasks`: *"a piece of
 * work may be missing from the lists above, or its state may be wrong"*); every surface here said
 * only the first half, each in its own words — *"a task may be absent"*, *"work … may be missing
 * from it"* — and two surfaces drew nothing at all (the band's two work lists, the stalled band).
 *
 * ⚑ **So the sentence lives here, once, and every surface that draws the count asks for it.**
 * ⛔ **A module of its own and importing nothing** — `piece-called.ts`' shape: the person's queue and
 * the band both need it, and a value import from `shared/` costs the renderer 135 kB
 * (`a-value-import-from-shared-costs-the-renderer-135kb`).
 *
 * ⚠️ **What it is NOT for.** `childList.short` counts half-written SPAWN rows — no work and no state
 * is derived from those — and it is the one exception the census in `what-main-now-hands-you.test.ts`
 * §3 names. ⚑ The queue's `rowsDropped` is not in that census's population at all: it is a boolean
 * over overlapping walks whose noun is a REQUEST, and it spells no count.
 */

/** ⚑ The lead every such line opens with — true of both halves: a thing missing, or a thing wrong. */
export const ROWS_UNREAD_LEAD = 'This may not be accurate'

/**
 * ⚑ **The sentence for `count` unread rows**, or `null` when there are none — so a surface draws it
 * exactly when there is something to say. ⛔ A count that is not a positive number is none: the
 * wire is a trust boundary, and a line claiming *NaN rows* would be a claim nobody made.
 */
export function rowsUnreadSays(count: number): string | null {
  if (!(count > 0)) return null
  return `${rowsOfTheRecord(count)} could not be read, so a piece of work may be missing here, or its state may be wrong.`
}

/** ⚑ **685 · the count, spelled once** — both sentences below open with it. */
function rowsOfTheRecord(count: number): string {
  return `${String(count)} ${count === 1 ? 'row' : 'rows'} of this app’s record`
}

/** ⚑ **D-017 · R8 — the conversations whose whole record a read skipped, spelled once.** */
function recordsOf(count: number): string {
  return count === 1 ? '1 conversation’s record' : `${String(count)} conversations’ records`
}

/**
 * 🔴 **D-017 · R8 — {@link rowsUnreadSays}, and its own sentence for the records a read skipped
 * WHOLE** — `null` when neither has anything to say. ⛔ Never one count: a whole record is not a
 * row, and counting it as one would understate it.
 */
export function unreadSays(rows: number, ledgersSkipped: number | undefined): string | null {
  const said = [
    rowsUnreadSays(rows),
    ledgersSkipped !== undefined && ledgersSkipped > 0
      ? `${recordsOf(ledgersSkipped)} could not be read, so a piece of work may be missing here, or its state may be wrong.`
      : null,
  ].filter((one) => one !== null)
  return said.length === 0 ? null : said.join(' ')
}

/**
 * 🔴 **685 · the sentence for the WAITS reading's unread rows** (`676` F-R18a) — or `null` at none.
 *
 * ⛔ **Not {@link rowsUnreadSays}, and `685`'s review is why.** That sentence's first half — *a piece
 * of work may be missing here* — is false of this count: no row the rail or the forest draws comes
 * from the waits reading; it supplies only the *waiting* word of a plate already drawn. ⚑ So a torn
 * row there can do one thing — leave a conversation reading *idle* while it waits — and that is
 * what this says. ⚠️ And it keeps the two lines on the Team page from reading as one count twice.
 */
export function waitsUnreadSays(count: number): string | null {
  return count > 0
    ? `${rowsOfTheRecord(count)} could not be read, so a conversation shown here may be waiting without saying so.`
    : null
}

/** ⚑ **D-017 · R8 — {@link waitsUnreadSays}, and its own sentence for records skipped whole.** */
export function waitsNotReadSays(rows: number, ledgersSkipped: number | undefined): string | null {
  const said = [
    waitsUnreadSays(rows),
    ledgersSkipped !== undefined && ledgersSkipped > 0
      ? `${recordsOf(ledgersSkipped)} could not be read, so a conversation shown here may be waiting without saying so.`
      : null,
  ].filter((one) => one !== null)
  return said.length === 0 ? null : said.join(' ')
}

/**
 * 🔴 **712 · `697` H-a — the clause for a sentence that says something is ABSENT**, or `null` at none.
 *
 * ⛔ **Neither sentence above, because an absence is a third claim.** *"This run did not report an
 * output file"* and *"no record of that agent"* are each read off the rows a walk could parse, and a
 * torn row may be the one that held it — so the absence is true of what was READ, not of the ledger
 * (`LedgerRowsUnread`: *"an answer may be older, or narrower, than the ledger's truth"*). ⚑ This
 * scopes the claim to the read and says how much the read missed; the viewers keep their sentence.
 *
 * ⚑ `undefined` is none: a renderer's own fallback carries no count because no read happened.
 */
export function absenceUnreadSays(count: number | undefined): string | null {
  if (count === undefined || !(count > 0)) return null
  return `in the rows this app could read; ${rowsOfTheRecord(count)} could not be read`
}
