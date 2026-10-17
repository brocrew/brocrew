import type { FileChange } from '../file-change'

/**
 * 096 · **What Claude gives us about the files it changes** — established by measurement, as the
 * dispatch required, because nothing in our source established it and the SDK types do not settle it.
 *
 * ## What was measured
 *
 * Against the app's own database (2.5 GB, 458,200 wire frames, every event ever normalized):
 *
 * | signal | count | what it carries |
 * |---|---|---|
 * | `tool_call` named `Edit` | 14,840 | `file_path` (summarized), `old_string`, `new_string` |
 * | `tool_call` named `Write` | 2,578 | `file_path` (summarized), `content` |
 * | `unknown{label:'file-history-snapshot'}` | 7,989 | `{ messageId, isSnapshotUpdate, snapshot:{ messageId, timestamp, trackedFileBackups } }` |
 * | `unknown{label:'file-history-delta'}` | 168 | `{ messageId, snapshotMessageId, timestamp, trackingPath, backup:{ backupFileName, backupTime, realParentDir, version } }` |
 *
 * **There is no consolidated diff anywhere in it.** Claude reports which files it touched; it does
 * not report what changed inside them. That is the finding, and the pane says so rather than
 * inventing a common unit with Codex.
 *
 * ## Why the file-history stream is NOT the source used here
 *
 * `file-history-delta` looked like the answer — per-file, a real `trackingPath`, a backup record. It
 * is not: **168 of them against 17,418 file-edit tool calls**, a hundredfold gap, so it fires under
 * conditions we do not control and a pane built on it would silently miss ninety-nine edits in a
 * hundred. `file-history-snapshot` is worse for a different reason — it carries the *whole* tracked
 * map every time, and **1,882 of its 7,989 events were already over 052's 64 KiB bound and
 * discarded** before this task existed. Neither is a foundation. The tool call is: it is emitted for
 * every edit, by definition.
 *
 * ## Why this needs state at all
 *
 * A `tool_use` block is a *request*. The edit may fail — a bad `old_string`, a permission refusal, a
 * read-only file — and a pane that recorded the request would list a change that never happened.
 * So a path is remembered when the call goes out and only becomes a `FileChange` when its
 * `tool_result` comes back **`ok`**. That spans two SDK messages, which is exactly why this is a
 * small object handed to `normalizeMessage` rather than something it could decide alone — the same
 * shape, and the same reason, as `SubAgentTasks`.
 */
export class FileEdits {
  /** tool_use id → what that call would change, held until its result says whether it did. */
  private readonly pending = new Map<
    string,
    { path: string; status: FileChange['status']; tool: string }
  >()

  /**
   * The tools that change a file, and the status each one PROVES.
   *
   * `Edit`/`MultiEdit` replace a string inside a file that must already exist, so `modified` is a
   * fact rather than a guess. `Write` may create or overwrite and the SDK never says which, so it is
   * `touched` — see {@link FileChange.status}. `NotebookEdit` edits cells in an existing notebook.
   *
   * ⚠️ **Claude cannot report a deletion here and this app does not pretend otherwise.** It deletes
   * by running `rm` through `Bash`, and reading intent out of a shell command is exactly the kind of
   * inference that produces a confident wrong answer. A file Claude deleted simply does not appear.
   */
  private static readonly TOOLS: ReadonlyMap<string, FileChange['status']> = new Map([
    ['Edit', 'modified'],
    ['MultiEdit', 'modified'],
    ['NotebookEdit', 'modified'],
    ['Write', 'touched'],
  ])

  /**
   * The most calls held at once.
   *
   * ⚠️ **A `tool_use` whose `tool_result` never arrives is never settled, and review found it**: an
   * interrupted turn, a session torn down mid-edit, a provider that simply stops. Each leaves an
   * entry that nothing removes for the life of the session, and a long-running conversation is
   * exactly where this app runs. The oldest is evicted rather than the newest refused, because a
   * result that does come back comes back soon: the entries that age out are the ones already
   * abandoned. 256 is far above any real in-flight count (a turn issues a handful of edits) and far
   * below anything that matters for memory.
   */
  private static readonly MAX_PENDING = 256

  /** Remember a file-edit call. Anything else is ignored — this is not a general tool ledger. */
  called(toolUseId: string, name: string, input: unknown): void {
    const status = FileEdits.TOOLS.get(name)
    if (!status) return
    const path = pathOf(input)
    if (!path) return
    this.pending.set(toolUseId, { path, status, tool: name })
    // Map iteration is insertion-ordered, so the first key is the oldest unsettled call.
    while (this.pending.size > FileEdits.MAX_PENDING) {
      const oldest = this.pending.keys().next().value
      if (oldest === undefined) break
      this.pending.delete(oldest)
    }
  }

  /**
   * Settle a call. Returns the change and the tool that made it when the edit was a file edit AND it
   * succeeded; `null` otherwise — including for a FAILED edit, which is the whole point of waiting.
   *
   * The tool name becomes the event's `source`, the same way `turn/diff/updated` is Codex's: it is
   * the wire fact the row came from, and it is what lets the pane say *"claude reported the file, not
   * the change"* from the data instead of from a hardcoded provider check.
   */
  settled(toolUseId: string, ok: boolean): { change: FileChange; tool: string } | null {
    const pending = this.pending.get(toolUseId)
    if (!pending) return null
    this.pending.delete(toolUseId)
    if (!ok) return null
    // ⚠️ No `added`/`removed`. Claude does not report line counts and neither do we: an `Edit`'s
    // `old_string`/`new_string` line totals are NOT what a diff would count (three lines replaced by
    // three lines with one word changed is `+1 −1` to git and `+3 −3` to that arithmetic), and a
    // number that is wrong in the common case is worse than an honest blank.
    return { change: { path: pending.path, status: pending.status }, tool: pending.tool }
  }
}

/**
 * The path a file-edit tool names.
 *
 * The three keys are the SDK's own, verified in the vendored `sdk-tools.d.ts` at our pin
 * (`FileEditInput.file_path`, `FileWriteInput.file_path`, `NotebookEditInput.notebook_path`) — and
 * they are the same three `claude-runtime.ts:290` already reads to build a permission scope, so a
 * path this app is willing to gate on is a path it is willing to list.
 */
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}
