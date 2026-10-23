/**
 * 🔴 **D-024 · R1 — the one line above this conversation's own text** — it names who composed it,
 * for whom and when, as a file's `Contents of <path> (<scope>):` names where its text came from.
 */
export const THIS_CONVERSATION_HEADER = 'Composed by BroCrew for this conversation at this launch:'

/**
 * 🔴 **W4.179 — what a Codex thread already holds of this conversation's own text, and what a new
 * life of it still owes.**
 *
 * ⚑ **Why.** On Codex, BroBot's text about this conversation (`## The brobot tools`, `## This
 * conversation`, `## What you have been granted`) rides in front of the first message of every life
 * (`HostedSession.firstTurnLead`), and a Codex thread keeps its whole history. So every reopen, idle
 * stop and app restart added another 2.5–2.7k characters, and the old copies stayed: measured, five
 * lives of one thread held five copies, 12,763 characters.
 *
 * ⚑ **The rule.** A life whose thread already holds the lead sends nothing again when it is the
 * same, and only the sections that changed when it is not — under a line that says they replace the
 * ones of the same name ({@link WHAT_CHANGED_HEADER}). A thread that holds none, or whose history a
 * compaction rewrote, gets the whole of it, as before. ⚠️ What a thread holds is read back from the
 * conversation's own record ({@link LeadRow}): each launch's text (`launched.given`, R2) and which
 * messages carried it (`user_turn.lead`, or for a row from before this, `sent` opening with the
 * launch's whole block). ⛔ A record that cannot say is read as holding nothing, so the whole lead
 * goes: redundant at worst, never missing.
 */

/** ⚑ The line above the sections of this conversation's text that changed since the thread got it. */
export const WHAT_CHANGED_HEADER =
  'Composed by BroCrew for this conversation at this launch. These sections replace the ones of the same name you were given earlier in this conversation:'

/** The heading the profile's saved methods are given under, on both providers. */
export const SAVED_METHODS_HEADING = 'Saved methods'
