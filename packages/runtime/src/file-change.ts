/**
 * 096 · **What the agent did to your working tree**, lifted out of a diff string into records.
 *
 * ## Why this parses a string instead of reading a typed notification
 *
 * 092 designed the Changes pane on Codex's `item/fileChange/patchUpdated` —
 * `FileUpdateChange = { path, kind, diff }`, per-file, *"the richest source we have and we drop it"*
 * — and 096 repeated it. That is what the generated protocol says. It is not what arrives.
 *
 * **Measured** (`packages/runtime/smoke/file-change-probe.smoke.ts`, three runs against the codex the
 * app ships, plus every event and wire frame in the app's own 2.5 GB database):
 *
 * | signal | in 458,200 recorded frames | in a live turn that edited four files |
 * |---|---|---|
 * | `item/fileChange/patchUpdated` | **0** | **0** |
 * | `turn/diff/updated` | 8 | 3–5, identical, one full snapshot each |
 *
 * So the per-file source is the aggregate, and the aggregate is a **git-format unified diff** —
 * which splits per file perfectly well. 092 read it as *"one blob, no per-file split"*; it is one
 * blob that is made of per-file sections, which is a different thing.
 *
 * ## The one shape a types-only reading gets wrong
 *
 * Both design docs describe renames as arriving *"via `move_path`"*. `move_path` is a field on
 * `PatchChangeKind`, which belongs to the notification that never comes. In the aggregate a rename
 * is a header with two different paths:
 *
 * ```
 * diff --git a/movable.txt b/moved.txt
 * ```
 *
 * with **no `rename from`, no `rename to`, no `similarity index`** — measured, and asserted by the
 * probe. So {@link parseUnifiedDiff} reads the header. It also reads git's own `rename from` line
 * when one is present, because a diff from anywhere else carries it and the two agree. (`rename to`
 * is deliberately NOT read: it repeats the header's b-path, and a second source for one fact is a
 * second thing to disagree. Review flagged the comment for claiming otherwise, and it was the
 * comment that was wrong.)
 */

/**
 * One file the agent touched, as metadata — **the diff body is deliberately separate.**
 *
 * 092 §4: the collapsed pane is the real state and it must be bounded by *distinct files*, not by
 * turns and not by content. So this record is what a row draws from, and `diff` is the one field a
 * row never reads: it is present so the ledger holds the observation, and the pane reads it only for
 * the single file a reader expanded.
 */
export interface FileChange {
  /** Path as the provider reported it — repo-relative for Codex, absolute for Claude. Never invented. */
  readonly path: string
  /**
   * What happened to it — and **`touched` is not a rounding of the other four.**
   *
   * Codex sends a diff, so its rows are `added` / `modified` / `deleted` / `renamed` read straight
   * off git's own markers. Claude sends the *tool it used*: an `Edit` proves the file existed and now
   * differs, so that is honestly `modified`; a `Write` may have created the file or overwritten one,
   * and the SDK does not say which. Calling that `modified` would be a claim about a file we never
   * saw before, and calling it `added` would be worse. `touched` is the true statement: the agent
   * wrote this file, and we were not told how.
   */
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'touched'
  /** Where a renamed file came from. Present only for `renamed`. */
  readonly oldPath?: string
  /**
   * Lines added / removed, when the source is a diff we can count.
   *
   * ⚠️ **Absent is not zero, and this is the field where that matters most.** Claude reports which
   * files it touched and not what changed in them (measured — see `claude/normalize.ts`), so its
   * rows carry no counts at all. A `+0 −0` there would be a number we made up about a file we know
   * changed; the pane draws nothing where these are absent, and `net unchanged` only where a diff
   * was actually read and actually came to zero.
   */
  readonly added?: number
  readonly removed?: number
  /** The per-file unified diff, when the provider gave one and it fit. See {@link MAX_FILE_DIFF_BYTES}. */
  readonly diff?: string
  /** True when THIS file's diff was over {@link MAX_FILE_DIFF_BYTES} — the row stubs to "open in editor". */
  readonly oversize?: boolean
  /**
   * True when this file's diff would have fit but the EVENT's budget was already spent.
   *
   * ⚠️ Deliberately not the same field as {@link oversize}, because they are not the same sentence: a
   * reader told "this diff is too large" about a 10 KiB diff has been told something false. This one
   * says the report was long, not that the file was.
   */
  readonly crowdedOut?: boolean
}

/**
 * The per-file diff body ceiling, in bytes (092 §4's *"large diff — open in editor"* backstop).
 *
 * 32 KiB is half of 052's `unknown{raw}` bound and chosen against the same hazard from the other
 * end: this payload is emitted **three to five times per turn** (measured), so a bound that is
 * generous per event is spendthrift per turn. Above it the body is dropped and `oversize` is set —
 * the counts survive, because they are computed while scanning and cost nothing to keep.
 */
export const MAX_FILE_DIFF_BYTES = 32 * 1024

/**
 * The most files one `file_change` event will carry rows for.
 *
 * Rows are cheap (a path and four small fields); bodies are not. So this cap is high, the body
 * budget below is what actually binds, and anything past it is REPORTED as `dropped` on the event
 * rather than vanishing — 092: *"any dropped rows are `log()`-ed, never silently truncated."* A count
 * the pane can render beats a log line nobody reads.
 */
export const MAX_CHANGED_FILES = 500

/**
 * The total diff-body budget for one event.
 *
 * Without it, 500 files × 32 KiB is a 16 MB event, five times a turn. Bodies are kept in the order
 * the diff listed them until the budget is gone; the rest keep their metadata and set `oversize`.
 */
export const MAX_EVENT_DIFF_BYTES = 256 * 1024

/** What {@link parseUnifiedDiff} found, including what it had to leave out. */
export interface ParsedDiff {
  readonly changes: FileChange[]
  /** Files past {@link MAX_CHANGED_FILES}. Zero normally; non-zero is a fact the pane states. */
  readonly dropped: number
}

/** `"a/x" "b/y"` quoted-path form, which git uses when a path contains spaces or non-ASCII. */
const QUOTED_HEADER = /^diff --git "a\/(.+?)" "b\/(.+)"$/

const PREFIX = 'diff --git a/'

/**
 * The two paths in a `diff --git` header.
 *
 * ⚠️ **The obvious regex is wrong and review caught it.** `/^diff --git a\/(.+?) b\/(.+)$/` splits at
 * the FIRST ` b/` in the line, so a repo with a directory called `a b` turns
 * `diff --git a/src/a b/lib.ts b/src/a b/lib.ts` into `old="src/a"`, `now="lib.ts b/src/a b/lib.ts"`
 * — two paths that differ, which the caller then reports as a **rename**, with three fabricated
 * fields, on every turn that touches that tree. Git quotes such paths, but nothing measured says
 * Codex does, and a parser that is only correct when the provider is polite is not correct.
 *
 * So the header is used for what it can settle on its own — where a section STARTS, and the
 * same-path case, whose split is fully determined because both halves are equal. When the two paths
 * differ, the header alone is genuinely ambiguous (`a/X b/Y` where either contains ` b/` has more
 * than one reading), and the answer comes from the `--- a/X` / `+++ b/Y` lines instead, which name
 * one path each and cannot be misread. Codex sends them — four of each in the measured payload.
 */
function headerPaths(line: string): { old: string; now: string } | null {
  const quoted = QUOTED_HEADER.exec(line)
  if (quoted) return { old: quoted[1]!, now: quoted[2]! }
  if (!line.startsWith(PREFIX)) return null
  const rest = line.slice(PREFIX.length)
  // The same-path split: `a/X b/X` means `rest` is `X b/X`, so the midpoint is fully determined.
  if (rest.length % 2 === 1) {
    const half = (rest.length - 3) / 2
    const old = rest.slice(0, half)
    if (rest === `${old} b/${old}` && old) return { old, now: old }
  }
  // Ambiguous: `--- a/` and `+++ b/` settle it if they come. Until then, the last ` b/` is the best
  // available guess, and it is only ever wrong for a rename in a tree with a ` b/` in its paths.
  const cut = rest.lastIndexOf(' b/')
  if (cut <= 0) return null
  return { old: rest.slice(0, cut), now: rest.slice(cut + 3) }
}

/**
 * Split a git-format unified diff into one record per file.
 *
 * Returns `{ changes: [], dropped: 0 }` for anything that is not one — an empty string, prose, a
 * payload from a provider that changed its mind. The caller treats that as "no reading", never as
 * "no changes": the two are different and only one of them is a claim.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n')
  const changes: FileChange[] = []
  let dropped = 0
  let budget = MAX_EVENT_DIFF_BYTES

  /** Fields accumulated for the section currently being scanned. */
  let paths: { old: string; now: string } | null = null
  let body: string[] = []
  let added = 0
  let removed = 0
  let isNew = false
  let isGone = false
  let renamedFrom: string | null = null
  let sawHunk = false
  /** The unambiguous paths, when the section carries them. See {@link headerPaths}. */
  let statedOld: string | null = null
  let statedNow: string | null = null

  const flush = (): void => {
    if (!paths) return
    // `--- a/X` / `+++ b/Y` beat the header, which cannot always split itself; `rename from` beats
    // both, since it is the only line that says where a file CAME from rather than what it is now.
    const now = statedNow ?? paths.now
    const was = statedOld ?? paths.old
    const from = renamedFrom ?? was
    const status: FileChange['status'] = isNew
      ? 'added'
      : isGone
        ? 'deleted'
        : from !== now
          ? 'renamed'
          : 'modified'
    // A deleted file's surviving path is the one it had; b/ is `/dev/null` in every other reading of
    // the diff, but git still writes the real path in the header, so `now` is right for all four.
    const path = now
    if (changes.length >= MAX_CHANGED_FILES) {
      dropped += 1
    } else {
      // ⚠️ **`.join` on a body that ends in the split's trailing empty string adds a byte that was
      // never in the diff** (review). Every real payload ends with a newline, so `split('\n')` leaves
      // a final `''`, and inside a hunk it lands in `body`. The reconstruction then measured one byte
      // more than the source and STORED a trailing newline the provider did not send — invisible
      // except at the exact ceiling, where a body that fits was reported `oversize`.
      while (body.length && body[body.length - 1] === '') body.pop()
      const text = body.join('\n')
      const bytes = Buffer.byteLength(text, 'utf8')
      const tooBig = bytes > MAX_FILE_DIFF_BYTES
      const noRoom = bytes > budget
      const carry = sawHunk && !tooBig && !noRoom
      if (carry) budget -= bytes
      changes.push({
        path,
        status,
        ...(status === 'renamed' ? { oldPath: from } : {}),
        ...(sawHunk ? { added, removed } : {}),
        ...(carry ? { diff: text } : {}),
        // ⚠️ **Two different facts, and review caught them collapsed into one word.** `oversize` used
        // to be set whenever the body was dropped — including when this file's diff was perfectly
        // ordinary and the EVENT budget had simply been spent by the nine files ahead of it. The pane
        // then told the reader a 10 KiB diff was "too large to show", which is false about the file
        // and true about the queue. They are named apart now, and the row says which.
        ...(sawHunk && tooBig ? { oversize: true } : {}),
        ...(sawHunk && !tooBig && noRoom ? { crowdedOut: true } : {}),
      })
    }
    paths = null
    body = []
    added = 0
    removed = 0
    isNew = false
    isGone = false
    renamedFrom = null
    sawHunk = false
    statedOld = null
    statedNow = null
  }

  for (const line of lines) {
    const next = headerPaths(line)
    if (next) {
      flush()
      paths = next
      continue
    }
    if (!paths) continue // preamble before the first section — not ours to interpret
    if (line.startsWith('new file mode ')) {
      isNew = true
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      isGone = true
      continue
    }
    // ⚠️ **A deletion does not always announce a mode** (review). `git diff` writes `deleted file
    // mode` for a tracked file, but a diff generated with `--no-index`, or by anything that is not
    // git — which Codex's `apply_patch` demonstrably is not — can mark the deletion only by sending
    // the new side to `/dev/null`. Read as `modified`, such a row would show a deleted file with a
    // live chevron and no "nothing on disk to revert to" banner.
    if (line === '+++ /dev/null') {
      isGone = true
      continue
    }
    // The two lines that name one path each, unambiguously — see {@link headerPaths}.
    if (line.startsWith('--- a/')) {
      statedOld = line.slice('--- a/'.length)
      continue
    }
    if (line.startsWith('+++ b/')) {
      statedNow = line.slice('+++ b/'.length)
      continue
    }
    if (line.startsWith('rename from ')) {
      renamedFrom = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('@@')) {
      sawHunk = true
      body.push(line)
      continue
    }
    // ⚠️ Order matters: `+++`/`---` are the file headers, not content, and counting them would add
    // one phantom insertion and one phantom deletion to every single file in the set.
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!sawHunk) continue // `index`, `similarity index`, `Binary files … differ`, mode changes
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
    body.push(line)
  }
  flush()
  return { changes, dropped }
}

/**
 * Fold a stream of per-file records down to **one row per distinct path** — the pane's whole unit.
 *
 * Later records win, because each `turn/diff/updated` is a full snapshot of the turn rather than a
 * delta (measured: three payloads, byte-identical, one turn). Where two different SCOPES report the
 * same file — turn 1 modified it, turn 4 modified it again — the later one is also the right answer,
 * since the aggregate is cumulative against the same worktree.
 *
 * ⚠️ **A file that came back to where it started is kept, not dropped.** 092, from 074: *"the agent
 * wrote the file (mtime, side effects); the net diff is empty… don't claim what you didn't observe
 * and don't hide what you did."* That row is exactly `added === 0 && removed === 0` with a diff that
 * was read — which is why {@link FileChange.added} being ABSENT and being ZERO must stay different.
 */
export function foldChanges(batches: readonly (readonly FileChange[])[]): FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const batch of batches) for (const change of batch) byPath.set(change.path, change)
  return [...byPath.values()]
}

/** True when a diff was read for this file and it came to nothing — 092's `net unchanged` tag. */
export function isNetUnchanged(change: FileChange): boolean {
  return change.added === 0 && change.removed === 0
}
