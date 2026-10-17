/**
 * ⚑ **Why a file was not read or not sent, in plain words** — one table for every surface that
 * lists a refused instruction file: the Info tab's instructions and "What this agent receives".
 */

/**
 * ⛔ **`over-budget` is not "not read" and must not be printed as if it were** (187 §2).
 *
 * Every other reason on this list is the reader refusing a file it could not read — a loop of
 * links, a FIFO, invalid bytes. This one is a file that was read, was fine, and did not fit: the total cap
 * ran out before it. Rendering `· not read: over-budget` would report a refusal for something the
 * app chose not to SEND, and the fix a user would go looking for is a different fix.
 *
 * ⚠️ **Unknown reasons fall through to the raw word.** A main process that grows a new refusal
 * before this map does must still say something true; a blank row would be the silence the block
 * exists to remove.
 */
const REFUSAL_WORDS: Record<string, string> = {
  'over-budget': 'read, but not sent — the instruction budget ran out before this file',
  // 🔴 **Somebody else's file is at the name BroBot publishes its instructions under** (377).
  //
  // ⛔ **This is HO-016's *"the refusal is SURFACED TO A PERSON, not only logged"*, and the sentence
  // has to carry what to DO.** *"Someone put that file there on purpose; the app disagreeing with
  // them silently is the failure mode"* — so it says whose file won, what the agent therefore did
  // not get, and that moving the file is what changes it. ⚠️ Nothing failed and nothing was
  // overwritten: the launch went ahead.
  //
  // ⛔ **485 · the comment used to add *"and the provider read their file"*, and that is only true
  // on Codex.** Claude is never told this leaf exists, so their file reaches nobody either. ⚑ The
  // SENTENCE below was already right — *the agent did not get them* — and says the half that holds
  // on both providers, which is why it did not move.
  'unmanaged-override':
    'left alone — this file was not written by BroCrew, so its own instructions for this profile ' +
    'were not published and the agent did not get them. Move or rename it to hand the name back.',
  // ⛔ **Also not "not read"** (314 §3). Nothing declined anything: this path is a link and the far
  // end of it is gone, which is what a `/tmp` target looks like after a reboot. The sentence says
  // what happened rather than naming a reader that did not act.
  'dangling-link': 'a link with nothing at the other end — whatever was here is gone',
  // ⚑ **733 · one file, sent once** (HO-075 §1): a second name for a file already on the list.
  'same-file': 'read, but not sent again — it is a link to a file already sent above',
}

export function refusalWords(reason: string): string {
  return REFUSAL_WORDS[reason] ?? `not read: ${reason}`
}
