import type { FileChange } from '../file-change'

/**
 * What Claude reports about the files it changes: which files it touched, not what changed inside
 * them, so there is no common diff unit with Codex and the pane says so. The source is the
 * `Edit`/`Write`/`MultiEdit`/`NotebookEdit` tool calls, not the `file-history-delta` and
 * `file-history-snapshot` frames: the deltas fire for only a small fraction of edits and the
 * snapshots carry the whole tracked map and often exceed the event size bound.
 *
 * A `tool_use` is only a request (a bad `old_string` or a permission refusal makes it fail), so the
 * path is remembered when the call goes out and becomes a `FileChange` only when its `tool_result`
 * comes back `ok`. That spans two SDK messages, hence a small object handed to `normalizeMessage`,
 * like `SubAgentTasks`.
 */
export class FileEdits {
  /** tool_use id → what that call would change, held until its result says whether it did. */
  private readonly pending = new Map<
    string,
    { path: string; status: FileChange['status']; tool: string }
  >()

  /**
   * The tools that change a file, and the status each proves. `Edit`/`MultiEdit` replace a string in
   * a file that must already exist, so `modified` is a fact. `Write` may create or overwrite and the
   * SDK never says which, so it is `touched` (see {@link FileChange.status}). `NotebookEdit` edits
   * cells in an existing notebook. Deletions are not reported: Claude deletes by running `rm` through
   * `Bash`, and inferring intent from a shell command would be a confident wrong answer.
   */
  private static readonly TOOLS: ReadonlyMap<string, FileChange['status']> = new Map([
    ['Edit', 'modified'],
    ['MultiEdit', 'modified'],
    ['NotebookEdit', 'modified'],
    ['Write', 'touched'],
  ])

  /**
   * The most calls held at once. A `tool_use` whose `tool_result` never arrives (an interrupted turn,
   * a torn-down session) would otherwise stay for the life of the session, so the oldest is evicted:
   * a result that does come back comes back soon. 256 is far above any real in-flight count.
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
   * Settle a call. Returns the change and the tool that made it when the call was a file edit and it
   * succeeded; `null` otherwise, including a failed edit. The tool name becomes the event's `source`,
   * so the pane can say "claude reported the file, not the change" from the data.
   */
  settled(toolUseId: string, ok: boolean): { change: FileChange; tool: string } | null {
    const pending = this.pending.get(toolUseId)
    if (!pending) return null
    this.pending.delete(toolUseId)
    if (!ok) return null
    // No `added`/`removed`: Claude reports no line counts, and `old_string`/`new_string` line totals
    // are not what a diff counts (one word changed in three lines is `+1 -1` to git, `+3 -3` here).
    return { change: { path: pending.path, status: pending.status }, tool: pending.tool }
  }
}

/**
 * The path a file-edit tool names: the SDK's own keys (`file_path` for edit and write,
 * `notebook_path` for notebooks), the same ones the permission scope in `claude-runtime.ts` reads, so
 * a path this app will gate on is a path it will list.
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
