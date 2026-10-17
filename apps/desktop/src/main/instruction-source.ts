import { basename } from 'node:path'
import { readTextFile, realPathOf } from './read-text-file'

/**
 * **Reading one instruction file the provider said it loaded** (356 §2) — a door as wide as one
 * conversation's own reported list, and no wider.
 *
 * 356 §2 asks that `AGENTS.md` open *in the app's own document viewer*, on the same paper every
 * other document opens on. For the files BroBot itself read that is free — their bytes are already
 * on the wire. For the provider's own list it is not: `SessionInstructions.provider` is paths with
 * no text, **deliberately**, because *"showing bytes we fetched separately would present our read as
 * its read"*. So this is a new read, and everything about it has to say so.
 *
 * ## 🔴 What this changes about the panel's claim, and why the wording had to move
 *
 * ⛔ The panel used to say *"BroBot did not read them and does not hold their text"* — a sentence
 * that goes false the first time somebody presses Open. 357 had already found it overreaching for a
 * second reason: it is a claim about the whole app, and the only thing the oracle supports is a
 * claim about **this list**. The panel now says what is true of both: the provider reported these
 * paths, BroBot did not fetch them to build the list, and a read on request is a read **now**.
 *
 * ## What it will open
 *
 * ⚠️ **The renderer never supplies a path.** It names a session and an INDEX into the list that
 * session's provider reported; the caller resolves the string off the live handle.
 *
 * 🔴 **731 · and that is the only check about WHICH file.** Until `731` it also had to be a Markdown
 * file, and the reason given was a credential: *"a provider that named an `auth.json` would be asking
 * this door to draw a credential in a window"*, so `auth.json`, `config.toml`, `.claude.json` and
 * `settings.json` were *"excluded by name"*. The PM, ruling on `726` §9: *"A type allow-list whose
 * purpose is keeping credentials out goes: a text viewer opens any readable text file a person
 * names, `auth.json` included."* What is left is {@link readTextFile}'s rules — a regular file, not a
 * binary (which cannot be drawn as text), within a ceiling it reports.
 *
 * ⚠️ **So the readable set is *"text files this session's provider said it put in this
 * conversation's prompt"*.** Showing the user a file the provider showed the model is not an
 * escalation — it is 009's rule, that what shaped a conversation must be visible in it, applied to
 * the one list where it was not.
 */

/**
 * How much of an instruction file is read.
 *
 * ⚠️ Smaller than a workflow output's megabyte on purpose: an instruction file is prose a person
 * wrote for a model, and both providers cap what they will load far below this. A cut is reported
 * with the real size rather than hidden, so a file that IS enormous says so instead of arriving
 * silently shortened.
 */
export const MAX_INSTRUCTION_BYTES = 512 * 1024

/** What one instruction file reads as, or why it did not. */
export type InstructionSourceResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-source' | 'gone' | 'not-readable' | 'unreadable' }

/**
 * Read the `index`th file of the list this session's provider reported, or say why not.
 *
 * No Electron, no database, no session — the caller supplies the provider's own list and this
 * decides whether to open one of them, so the whole boundary is one function a test can drive with
 * real files, real symlinks and a real fifo.
 */
export function readInstructionSource(
  /** ⛔ **The confinement.** Exactly what this conversation's provider said it loaded, in its order. */
  reported: readonly string[],
  index: number,
): InstructionSourceResult {
  // ⛔ **One guard, and it is the only one that can be wrong.** An index past the end, a negative
  // one, a fractional one and `NaN` all read `undefined` off a real array — so a range check beside
  // this line could never be the thing that refused, and 356's own table found it: the row written
  // against it SURVIVED, because every input it was supposed to catch was already caught here. A
  // line no mutation can make red is a line carrying no rule.
  //
  // ⚠️ **The empty string is the case that is NOT `undefined` and still names no file**, which is
  // why the second clause is here and is separately killable.
  const path = reported[index]
  if (typeof path !== 'string' || path === '') return { ok: false, reason: 'no-source' }

  // Read at the REAL path: a link is followed, and it is where it lands that is read.
  const resolved = realPathOf(path)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  const read = readTextFile(resolved.path, MAX_INSTRUCTION_BYTES)
  if (typeof read === 'string') return { ok: false, reason: read }
  // ⚠️ **The path reported back is the one the PROVIDER named, not the resolved one.** That is the
  // row the user pressed, and it is what the viewer's toolbar has to agree with; where a link landed
  // is a different fact and this door does not claim to disclose it.
  return { ok: true, path, name: basename(path), ...read }
}
