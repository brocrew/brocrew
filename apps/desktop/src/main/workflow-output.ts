import { basename } from 'node:path'
import { readTextFile, realPathOf } from './read-text-file'

/**
 * **Reading the file a dynamic workflow wrote** (108) — a door exactly one file wide.
 *
 * 107 ruled that a workflow's `output_file` is a *document*: it borrows the paper AND the
 * Markdown/Raw toggle, because a workflow returns prose to be read. Nothing in this app could read a
 * file for the renderer, so this is new.
 *
 * ## What it will open
 *
 * ⚠️ **The renderer never supplies a path.** It names a `sessionId` and a `taskId`; the path comes
 * out of THIS app's own event ledger, from the `workflow_run` event the provider sent. That is the
 * whole difference from the image case, where the URL was renderer-authored and a markdown link was
 * one hole away from an arbitrary-file reader. Here the set of readable paths is *"the output files
 * the provider reported for runs in this conversation"* — an allowlist of, in every measured
 * session, exactly one string.
 *
 * Read the output path the provider reports without requiring a task-derived filename or a particular location. A readable file such as the provider's `~/.claude.json` can be opened regardless of its name.
 *
 * 🔴 **731 · …nor its extension.** Until `731` it also had to be one of eight text extensions, and
 * the list's own words were *"the point of the list is that a private key is not on it"*. The PM,
 * ruling on `726` §9: *"A type allow-list whose purpose is keeping credentials out goes."* What is
 * left is **{@link readTextFile}'s rules** — `O_NOFOLLOW` against a swap, `O_NONBLOCK` so a fifo
 * refuses instead of hanging, a regular-file check on the DESCRIPTOR, a binary refused because it
 * cannot be drawn as text, and a byte ceiling reported rather than silent.
 */

/** How much of an output file is read. Beyond this the reader is told, and told the real size. */
export const MAX_OUTPUT_BYTES = 1024 * 1024

/** What the renderer gets back. `text` is what to show; the rest is what to say about it. */
export interface WorkflowOutput {
  /** The file's own name — the viewer's title. */
  name: string
  text: string
  /** True when the file was longer than {@link MAX_OUTPUT_BYTES} and `text` is the head of it. */
  truncated: boolean
  /** The file's real size in bytes, so a truncation can say what it left out. */
  bytes: number
}

/**
 * Why a read produced nothing.
 *
 * ⚠️ **These are separate values rather than one `null`**, because the four causes are four
 * different sentences to a reader: the run reported no output (in any row this app could read —
 * `697`'s `rowsUnread` says how many it could not), the file has been cleaned up
 * (workflow outputs live under the OS temp directory, so this is ORDINARY rather than exceptional),
 * it cannot be drawn as text (`731`: a binary, UTF-16, a folder, a fifo, a socket), or it was there
 * and could not be read. A viewer that says
 * "not found" for all four teaches the user to distrust it.
 */
export type WorkflowOutputRefusal = 'no-output' | 'gone' | 'not-readable' | 'unreadable'

/**
 * Read `path`, or say why not.
 *
 * No Electron and no database — the caller resolves the path from the ledger and this decides
 * whether to open it, so the whole boundary is one function a test can drive with real files, real
 * symlinks and a real fifo.
 */
export function readWorkflowOutput(path: string): WorkflowOutput | WorkflowOutputRefusal {
  // Read at the REAL path: a symlink is followed, and it is the resolved file that is read. A path
  // that does not resolve is `gone` — workflow outputs live in a temp directory the OS reaps, so a
  // reader coming back to an old conversation hits that on the ordinary path, not the exceptional one.
  const resolved = realPathOf(path)
  if (!resolved.ok) return resolved.reason
  const real = resolved.path

  const read = readTextFile(real, MAX_OUTPUT_BYTES)
  if (typeof read === 'string') return read
  return { name: basename(real), ...read }
}
