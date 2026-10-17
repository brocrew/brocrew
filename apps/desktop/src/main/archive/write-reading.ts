import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_READING_BYTES } from '../../shared/runtime-ipc'

/**
 * 🔴 **Write a readable export — bytes the RENDERER composed, and nothing else** (633).
 *
 * ## ⛔ Why this module writes and does not compose
 *
 * ⚠️ **"The same as what the UI shows" is `TranscriptItem[]`**, and that fold lives in
 * `renderer/src/lib/transcript.ts`. ⛔ **A second fold here would be `HO-095` §4's *never two
 * sources of truth*** — *"if one surface can show a decision as open while the other shows it
 * settled, that is a defect"* — and a transcript is exactly the artefact where that would not be
 * noticed until somebody read both.
 *
 * ⚑ **So the renderer composes and this writes.** `writeBundleExport` and `writeNativeExport` are
 * the two neighbours that DO compose, and they may: their sources are the archive and the ledger,
 * which are main's, and neither has a second reading on screen.
 *
 * ## ⚠️ What it refuses, and it says the size
 *
 * ⛔ **`read-bundle.ts`' discipline, copied by instruction** (`633` §2.1): *"Nothing is silently
 * truncated: past this size the answer is `no`, with the size in it."* ⚑ A conversation whose
 * Markdown is past {@link MAX_READING_BYTES} is refused with its own size named — never cut, and
 * never written half.
 *
 * ## ⛔ It is ONE write, and that is deliberate
 *
 * ⚠️ **Its two neighbours STREAM**, because they assemble from windows that can be arbitrarily
 * large and `053` measured a whole-string join throwing past ~512 MB. ⛔ **This one cannot stream
 * what it did not build**: the bytes arrive whole, over the wire, already bounded there. ⚑ **So the
 * bound is the streaming**, and it is named on the wire where it bites rather than here where it
 * would be a second copy of the same number.
 */
export interface ReadingWritten {
  readonly path: string
  readonly bytes: number
}

export type ReadingOutcome =
  | { readonly ok: true; readonly written: ReadingWritten }
  | { readonly ok: false; readonly reason: string }

export async function writeReadingExport(path: string, body: string): Promise<ReadingOutcome> {
  // ⚑ **Measured in BYTES, not characters**, because that is what the bound is about and what a
  // filesystem holds — an export full of accented prose is longer than its length.
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes === 0) return { ok: false, reason: 'there was nothing to write' }
  if (bytes > MAX_READING_BYTES) {
    return {
      ok: false,
      reason:
        `that conversation composes to ${String(Math.round(bytes / 1024 / 1024))} MB of Markdown, ` +
        `and BroCrew writes a readable export up to ${String(MAX_READING_BYTES / 1024 / 1024)} MB ` +
        'in one piece',
    }
  }
  // ⚠️ **The directory is made here rather than assumed**, which is `writeBundleExport`'s own
  // posture: `exports/` exists on every install that has ever exported and on no other.
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body, 'utf8')
  return { ok: true, written: { path, bytes } }
}
