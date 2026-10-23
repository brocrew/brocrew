import type { FileEdits } from '@brobot2/runtime'
import type { TranscriptEvent } from '../../shared/runtime-ipc'

/** One rebuilt entry, and when the provider says it happened. */
export interface ImportedEntry {
  /** Epoch ms, parsed from the record's own ISO-8601 `timestamp`. */
  at: number
  event: TranscriptEvent
}

export interface ImportedTranscript {
  entries: ImportedEntry[]
  /** Lines that were not JSON at all, reported rather than silently skipped. */
  unreadable: number
  /**
   * The last time this batch saw, which is what the NEXT batch must date its first undated record
   * to (046). Returned rather than kept private because a derive parses a multi-gigabyte file in
   * batches, and without carrying this forward each batch would restart from `fallbackAt` — dating
   * the middle of a conversation to its beginning. Equals `fallbackAt` when nothing named a time.
   */
  lastAt: number
  /**
   * The file edits still waiting on a result, which the NEXT batch must be handed (096).
   *
   * ⚠️ **The same reason `lastAt` is here.** A `file_change` is emitted when a `tool_use` in one
   * record is settled by a `tool_result` in another, so it is the first thing in this importer that
   * is not line-local — and a derive parses a multi-gigabyte file a batch at a time. Without carrying this, the batched parse dropped every
   * file change and `parsing in batches is parsing in one call` went red, which is exactly the
   * invariant it was written to protect.
   */
  edits: FileEdits
}

/** Whether an imported entry is CONVERSATION, as opposed to the file's own bookkeeping. */
export function isConversation(event: TranscriptEvent): boolean {
  return (
    event.type === 'user_turn' ||
    event.type === 'assistant_message' ||
    event.type === 'assistant_delta' ||
    event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    // A picture the model made is the most literal thing a turn can produce (065). It is here so
    // this list and the store's `CONTENT_EVENTS` — which added `image` in 067 for the same reason —
    // cannot disagree about whether a generated image counts as something happening. Neither is
    // exhaustiveness-checked, so the only thing keeping them in step is saying so.
    event.type === 'image'
  )
}

/**
 * The same 200-character cap every tool summary already uses. Exported so the Codex importer bounds
 * a provider string the same way rather than growing a fourth copy of two lines (065).
 */
export function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Turn one generated image's own claim into a path this app is willing to serve, or null (065).
 *
 * ⚠️ **Injected rather than done here, because this module parses lines and touches no file.**
 * `saved_path` arrives from a process running model-authored code, and 067 established that such a
 * path is *input*: it may only propose a file, and the proposal is checked — an absolute, regular
 * file of an image type (`726` · R92: no longer one inside the provider home the session ran in). So
 * a caller that can check supplies the check, and a caller that does not supplies nothing — in which
 * case no image event carries a path at all, which reads as "the picture is not here" and is the
 * truthful answer.
 *
 * Passing the provider's string straight through would be the other choice, and it is the wrong one:
 * `image.path` means *"resolved and checked by whoever emitted this"* everywhere else in the app,
 * and one importer quietly writing an unchecked absolute path into that field would make the
 * guarantee false without making anything fail.
 */
export type ResolveImagePath = (claim: {
  /** The item's own id — Codex names the file after it. */
  imageId: string
  /** `saved_path` from the rollout, verbatim and untrusted, when the line carried one. */
  savedPath?: string
}) => string | null
