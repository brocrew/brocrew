import { basename } from 'node:path'
import { readTextFile, realPathOf } from './read-text-file'

/**
 * Read a workflow output as a document. The renderer names the session and task; the caller
 * resolves the provider-reported path from the conversation's workflow event ledger.
 * Filename, extension and location do not limit the read. {@link readTextFile} handles file kind,
 * content decoding and reported truncation.
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
 * Separate an unreported output, a missing file, content that cannot be shown as text, and a read
 * failure so the viewer can give the corresponding explanation. Temporary outputs can disappear
 * between visits to a conversation.
 */
export type WorkflowOutputRefusal = 'no-output' | 'gone' | 'not-readable' | 'unreadable'

/**
 * Read the output path supplied by the caller, without an Electron or database dependency.
 */
export function readWorkflowOutput(path: string): WorkflowOutput | WorkflowOutputRefusal {
  // Follow symlinks and use the target's name for the viewer title.
  const resolved = realPathOf(path)
  if (!resolved.ok) return resolved.reason
  const real = resolved.path

  const read = readTextFile(real, MAX_OUTPUT_BYTES)
  if (typeof read === 'string') return read
  return { name: basename(real), ...read }
}
