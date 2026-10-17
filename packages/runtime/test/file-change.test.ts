import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  MAX_CHANGED_FILES,
  MAX_FILE_DIFF_BYTES,
  foldChanges,
  isNetUnchanged,
  parseUnifiedDiff,
  runtimeEventSchema,
  type FileChange,
  type RuntimeEvent,
} from '../src/index'
import { FileEdits } from '../src/claude/file-edits'
import { normalizeMessage } from '../src/claude/normalize'
import { normalizeNotification } from '../src/codex/normalize'

/**
 * 096 · **What the agent did to the working tree.**
 *
 * The fixtures below are not invented. `GIT` is verbatim `git diff --cached -M` output over a repo
 * built for the purpose — git is the authority on the format, and it is what produces the
 * `rename from`/`rename to` pair. The Codex rename form inside the rename test is the shape the LIVE
 * probe measured on the wire, which is **not** the same thing: git declined to call that same move a
 * rename at all. Both are here because both occur.
 */

/** Real `git diff --cached -M` output: an add, a binary, a delete, a modify, and a rename. */
const GIT = [
  'diff --git a/added.txt b/added.txt',
  'new file mode 100644',
  'index 0000000..ce01362',
  '--- /dev/null',
  '+++ b/added.txt',
  '@@ -0,0 +1 @@',
  '+hello',
  'diff --git a/blob.bin b/blob.bin',
  'index 57ac8df..dcd66ab 100644',
  'Binary files a/blob.bin and b/blob.bin differ',
  'diff --git a/doomed.txt b/doomed.txt',
  'deleted file mode 100644',
  'index 2d030d7..0000000',
  '--- a/doomed.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-delete me',
  'diff --git a/keep.txt b/keep.txt',
  'index 85c3040..e50310a 100644',
  '--- a/keep.txt',
  '+++ b/keep.txt',
  '@@ -1,3 +1,3 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
  'diff --git a/movable.txt b/moved.txt',
  'similarity index 91%',
  'rename from movable.txt',
  'rename to moved.txt',
  'index e8823e1..6bbe250 100644',
  '--- a/movable.txt',
  '+++ b/moved.txt',
  '@@ -27,4 +27,4 @@',
  ' 27',
  ' 28',
  ' 29',
  '-30',
  '+thirty',
  '',
].join('\n')

const by = (changes: readonly FileChange[], path: string): FileChange =>
  changes.find((change) => change.path === path)!

describe('a git-format diff splits per file (096, from the wire)', () => {
  it('one record per file, with git’s own markers read rather than guessed', () => {
    const { changes, dropped } = parseUnifiedDiff(GIT)
    expect(changes.map((change) => change.path)).toEqual([
      'added.txt',
      'blob.bin',
      'doomed.txt',
      'keep.txt',
      'moved.txt',
    ])
    expect(dropped).toBe(0)
    expect(by(changes, 'added.txt').status).toBe('added')
    expect(by(changes, 'doomed.txt').status).toBe('deleted')
    expect(by(changes, 'keep.txt').status).toBe('modified')
    expect(by(changes, 'moved.txt').status).toBe('renamed')
    // ⚠️ **092 read this payload as "one aggregated string… no per-file split".** It is one string
    // made of per-file sections, which is a different thing, and the difference is the whole pane.
    expect(changes.length).toBeGreaterThan(1)
  })

  it('counts the content lines and NOT the `---`/`+++` file headers', () => {
    // The bug this exists for: `+++ b/keep.txt` starts with `+` and `--- a/keep.txt` with `-`, so a
    // naive counter adds one phantom insertion and one phantom deletion to every file in the set —
    // a wrong number on every row, of exactly the kind this surface is built to refuse.
    const { changes } = parseUnifiedDiff(GIT)
    expect(by(changes, 'keep.txt').added).toBe(1)
    expect(by(changes, 'keep.txt').removed).toBe(1)
    expect(by(changes, 'added.txt').added).toBe(1)
    expect(by(changes, 'added.txt').removed).toBe(0)
    expect(by(changes, 'doomed.txt').added).toBe(0)
    expect(by(changes, 'doomed.txt').removed).toBe(1)
  })

  it('a binary file keeps its row and gets NO counts and NO body', () => {
    // `Binary files … differ` has no hunk. Absent counts are the honest answer; `+0 −0` would say
    // the file did not change, and it did.
    const blob = by(parseUnifiedDiff(GIT).changes, 'blob.bin')
    expect(blob.status).toBe('modified')
    expect(blob.added).toBeUndefined()
    expect(blob.removed).toBeUndefined()
    expect(blob.diff).toBeUndefined()
    expect(blob.oversize).toBeUndefined()
  })

  it('the carried body is the hunks, and only this file’s', () => {
    const keep = by(parseUnifiedDiff(GIT).changes, 'keep.txt')
    expect(keep.diff).toBe('@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma')
    expect(keep.diff).not.toContain('movable')
    expect(keep.diff).not.toContain('diff --git')
  })
})

describe('a rename, in both of the two forms that actually occur', () => {
  it('git’s form: `rename from` names where it came from', () => {
    const moved = by(parseUnifiedDiff(GIT).changes, 'moved.txt')
    expect(moved.status).toBe('renamed')
    expect(moved.oldPath).toBe('movable.txt')
  })

  it('and CODEX’s form, which carries no `rename from` at all', () => {
    // ⚠️ **The shape a types-only reading gets wrong, and both design docs did.** 092 and 096
    // describe renames as arriving *"via `move_path`"* — a field on `PatchChangeKind`, which belongs
    // to `item/fileChange/patchUpdated`, the notification that has never arrived. What the live probe
    // measured is this: two different paths in the header, and **no `rename from`, no `rename to`, no
    // `similarity index`**. Codex's diff is not git's — asked to move a 1-line file whose contents
    // also changed, git declines to call it a rename at all and emits delete+add, while Codex writes
    // the two-path header, because `apply_patch` knows it moved the file.
    //
    // (An `expect(codex).not.toContain('rename from')` used to sit below the fixture. Review called
    // it correctly: it asserted a property of a string the test had just written, and would have
    // passed with `parseUnifiedDiff` deleted. The fixture speaks for itself.)
    const codex = [
      'diff --git a/movable.txt b/moved.txt',
      '--- a/movable.txt',
      '+++ b/moved.txt',
      '@@ -1 +1 @@',
      '-move me',
      '+moved',
      '',
    ].join('\n')
    const { changes } = parseUnifiedDiff(codex)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.status).toBe('renamed')
    expect(changes[0]!.path).toBe('moved.txt')
    expect(changes[0]!.oldPath).toBe('movable.txt')
  })

  it('…and the same header with the SAME path on both sides is not a rename', () => {
    // NON-VACUITY for the test above: the discriminator must be the paths DIFFERING, not the header
    // existing. Identical shape, one character apart.
    const same = 'diff --git a/keep.txt b/keep.txt\n@@ -1 +1 @@\n-a\n+b\n'
    const { changes } = parseUnifiedDiff(same)
    expect(changes[0]!.status).toBe('modified')
    expect(changes[0]!.oldPath).toBeUndefined()
  })
})

describe('the bounds, and what a bound is allowed to hide', () => {
  it('a body over the per-file ceiling is dropped — the row and its COUNTS survive', () => {
    const body = Array.from({ length: 4000 }, (_, index) => `+line ${index} ${'x'.repeat(20)}`)
    const big = ['diff --git a/big.ts b/big.ts', '@@ -0,0 +1,4000 @@', ...body, ''].join('\n')
    expect(big.length).toBeGreaterThan(MAX_FILE_DIFF_BYTES)
    const change = parseUnifiedDiff(big).changes[0]!
    expect(change.diff, 'the megabytes do not ride along').toBeUndefined()
    expect(
      change.oversize,
      'and the row says so rather than looking like a file with no diff',
    ).toBe(true)
    expect(change.added, 'counting happens while scanning, so it costs nothing to keep').toBe(4000)
  })

  it('files past the cap are COUNTED, never silently dropped', () => {
    const many = Array.from(
      { length: MAX_CHANGED_FILES + 7 },
      (_, index) => `diff --git a/f${index}.ts b/f${index}.ts\n@@ -1 +1 @@\n-a\n+b`,
    ).join('\n')
    const { changes, dropped } = parseUnifiedDiff(many)
    expect(changes).toHaveLength(MAX_CHANGED_FILES)
    // 092 §4: *"any dropped rows are `log()`-ed, never silently truncated."* A number the pane can
    // render beats a log line nobody reads — a truncated list that looks complete is the failure.
    expect(dropped).toBe(7)
  })

  it('anything that is not a diff yields NO changes rather than zero changes', () => {
    // These two are different claims. `[]` here means "no reading", and the adapter turns that into
    // `unrecognized` — loud — rather than into a pane that says the agent changed nothing.
    expect(parseUnifiedDiff('').changes).toEqual([])
    expect(parseUnifiedDiff('I did not change any files.').changes).toEqual([])
    expect(parseUnifiedDiff('{"not":"a diff"}').changes).toEqual([])
  })
})

describe('folding, and the difference between absent and zero', () => {
  it('later wins per path, and a file touched twice is ONE row', () => {
    const first: FileChange[] = [{ path: 'a.ts', status: 'modified', added: 1, removed: 0 }]
    const second: FileChange[] = [
      { path: 'a.ts', status: 'modified', added: 9, removed: 2 },
      { path: 'b.ts', status: 'added', added: 4, removed: 0 },
    ]
    const folded = foldChanges([first, second])
    expect(folded).toHaveLength(2)
    expect(by(folded, 'a.ts').added).toBe(9)
  })

  it('written and then reverted is `net unchanged`, and a file nobody counted is NOT', () => {
    // ⚠️ 074, quoted by 092: don't claim what you didn't observe **and** don't hide what you did.
    // The left case is a diff that was read and came to nothing. The right is Claude, which reports
    // which file it touched and never what changed in it. Collapsing them would put `net unchanged`
    // on every Claude row in the app.
    expect(isNetUnchanged({ path: 'a.ts', status: 'modified', added: 0, removed: 0 })).toBe(true)
    expect(isNetUnchanged({ path: 'a.ts', status: 'touched' })).toBe(false)
  })
})

describe('codex: the signal that actually arrives becomes the event', () => {
  const notify = (diff: unknown): RuntimeEvent[] =>
    normalizeNotification('turn/diff/updated', { threadId: 'th', turnId: 'tn', diff })

  it('`turn/diff/updated` is a first-class `file_change`, not lifecycle chatter', () => {
    const [event] = notify(GIT)
    expect(event?.type).toBe('file_change')
    if (event?.type !== 'file_change') throw new Error('not a file_change')
    expect(event.source).toBe('turn/diff/updated')
    expect(event.changes.map((change) => change.status).sort()).toEqual([
      'added',
      'deleted',
      'modified',
      'modified',
      'renamed',
    ])
  })

  it('…and it used to be chatter, which is what this replaced', () => {
    // NON-VACUITY, in the shape 095 established: the rule this supersedes, run verbatim. Before 096
    // `turn/diff/updated` sat in `generatedNotificationCategory`'s lifecycle list and normalized to
    // `unknown{category:'lifecycle'}` — a payload carrying every file the turn changed, filed as
    // housekeeping. If the promotion is ever reverted, THIS is the assertion that goes red.
    const [event] = notify(GIT)
    expect(event?.type).not.toBe('unknown')
    // The sibling method that is still chatter, so "not unknown" above is a property of this one.
    const [sibling] = normalizeNotification('thread/settings/updated', { threadId: 'th' })
    expect(sibling?.type).toBe('unknown')
  })

  it('a payload we cannot read stays LOUD — never a report of no changes', () => {
    // The same ruling `thread/tokenUsage/updated` makes one case up: a first-class method arriving
    // malformed is a fact about the provider worth seeing. A pane receiving nothing looks exactly
    // like an agent that changed nothing, and those must never render the same.
    for (const payload of [undefined, 42, '', 'not a diff at all']) {
      const [event] = notify(payload)
      expect(event?.type, JSON.stringify(payload)).toBe('unknown')
      if (event?.type !== 'unknown') throw new Error('not unknown')
      expect(event.category).toBe('unrecognized')
    }
  })
})

describe('claude: which file, established by measurement — and not what changed in it', () => {
  const assistant = (id: string, name: string, input: unknown): SDKMessage =>
    ({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    }) as unknown as SDKMessage
  const result = (id: string, isError = false): SDKMessage =>
    ({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }],
      },
    }) as unknown as SDKMessage

  const run = (messages: SDKMessage[]): RuntimeEvent[] => {
    const edits = new FileEdits()
    const out: RuntimeEvent[] = []
    for (const message of messages) out.push(...normalizeMessage(message, undefined, edits))
    return out
  }
  const fileChanges = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'file_change' }>[] =>
    events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'file_change' }> => e.type === 'file_change',
    )

  it('an Edit that SUCCEEDS reports the file — with no counts, because Claude reports none', () => {
    const events = run([
      assistant('t1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }),
      result('t1'),
    ])
    const [change] = fileChanges(events)
    expect(change?.changes).toEqual([{ path: '/repo/src/a.ts', status: 'modified' }])
    expect(change?.source, 'the wire fact the row came from').toBe('Edit')
    // ⚠️ The arithmetic that was NOT done: `old_string`/`new_string` line totals are not what a diff
    // counts. Three lines replaced by three with one word changed is `+1 −1` to git and `+3 −3` to
    // that sum — wrong in the common case, which is worse than an honest blank.
    expect(change?.changes[0]).not.toHaveProperty('added')
  })

  it('an Edit that FAILS reports nothing at all', () => {
    // The reason this needs state across two messages: a `tool_use` block is a REQUEST. A bad
    // `old_string`, a refused permission, a read-only file — and a pane that recorded the request
    // would list a change that never happened.
    const events = run([
      assistant('t1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }),
      result('t1', true),
    ])
    expect(fileChanges(events)).toEqual([])
    expect(events.some((e) => e.type === 'tool_result')).toBe(true) // …and the result still lands
  })

  it('a Write is `touched`, not `modified` — the SDK never says which it was', () => {
    const events = run([
      assistant('t2', 'Write', { file_path: '/repo/new.ts', content: 'x' }),
      result('t2'),
    ])
    expect(fileChanges(events)[0]?.changes[0]?.status).toBe('touched')
  })

  it('a tool that does not change files reports nothing', () => {
    // NON-VACUITY for all three above: the trigger is the TOOL, not "any successful call".
    const events = run([assistant('t3', 'Bash', { command: 'ls' }), result('t3')])
    expect(fileChanges(events)).toEqual([])
  })

  it('a NotebookEdit is recognized by its own path key', () => {
    const events = run([
      assistant('t4', 'NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: 'x' }),
      result('t4'),
    ])
    expect(fileChanges(events)[0]?.changes[0]?.path).toBe('/repo/n.ipynb')
  })
})

describe('what review found, kept red-until-fixed', () => {
  it('a directory called `a b` is not read as a rename', () => {
    // ⚠️ The lazy `(.+?) b\/` split stopped at the FIRST ` b/` in the line, so this header became
    // old="src/a", now="lib.ts b/src/a b/lib.ts" — two differing paths, reported as a rename, with
    // three fabricated fields, on every turn that touched such a tree.
    const header = 'diff --git a/src/a b/lib.ts b/src/a b/lib.ts'
    const { changes } = parseUnifiedDiff(`${header}\n@@ -1 +1 @@\n-x\n+y\n`)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.path).toBe('src/a b/lib.ts')
    expect(changes[0]!.status, 'the same file on both sides is a modification').toBe('modified')
    expect(changes[0]!.oldPath).toBeUndefined()
  })

  it('…and a REAL rename in a tree like that still reads as one', () => {
    // NON-VACUITY for the test above: the fix must not be "never a rename". Same awkward directory,
    // genuinely different paths — and resolved by the `---`/`+++` lines, because the HEADER ALONE
    // cannot be: `a/X b/Y` where either path contains ` b/` has more than one valid reading, and no
    // amount of cleverness makes one of them true. The two lines that name one path each do.
    const { changes } = parseUnifiedDiff(
      [
        'diff --git a/src/a b/old.ts b/src/a b/new.ts',
        '--- a/src/a b/old.ts',
        '+++ b/src/a b/new.ts',
        '@@ -1 +1 @@',
        '-x',
        '+y',
        '',
      ].join('\n'),
    )
    expect(changes[0]!.status).toBe('renamed')
    expect(changes[0]!.oldPath).toBe('src/a b/old.ts')
    expect(changes[0]!.path).toBe('src/a b/new.ts')
  })

  it('…and the same rename with NO `---`/`+++` is best-effort, and says so here', () => {
    // ⚠️ **The limit, stated rather than papered over.** A rename header whose paths both contain
    // ` b/` and which carries no `---`/`+++` lines is genuinely ambiguous. The parser takes the last
    // ` b/`, which is a guess; what it must NOT do is crash, drop the file, or claim a status it
    // cannot support. This pins the actual behaviour so a future reader knows it is a guess.
    const { changes } = parseUnifiedDiff(
      'diff --git a/src/a b/old.ts b/src/a b/new.ts\n@@ -1 +1 @@\n-x\n+y\n',
    )
    expect(changes, 'the file is still reported').toHaveLength(1)
    expect(changes[0]!.status, 'and still as a rename, which it is').toBe('renamed')
    expect(changes[0]!.path, 'the tail is the part the guess gets right').toBe('new.ts')
  })

  it('the stored body is the provider’s bytes — no newline the diff did not send', () => {
    // Every real payload ends with '\n', so `split` left a trailing '' that `join` turned back into
    // a newline: one byte the source never had, measured against the ceiling and stored on the row.
    const { changes } = parseUnifiedDiff('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\n')
    expect(changes[0]!.diff).toBe('@@ -1 +1 @@\n-a\n+b')
    expect(changes[0]!.diff!.endsWith('\n')).toBe(false)
  })

  it('a diff dropped because the REPORT was long says so, not that the file was large', () => {
    // ⚠️ Two facts, one word. `oversize` meant both "this file's diff is over 32 KiB" and "the event
    // budget was spent by the files ahead of it" — so the pane told a reader a 10 KiB diff was too
    // large to show, which is false about the file and true about the queue.
    const hunk = (n: number): string =>
      `diff --git a/f${n}.ts b/f${n}.ts\n@@ -1 +1 @@\n${`+${'x'.repeat(200)}\n`.repeat(150)}`
    const many = Array.from({ length: 12 }, (_, index) => hunk(index)).join('')
    const { changes } = parseUnifiedDiff(many)
    const carried = changes.filter((change) => change.diff !== undefined)
    const crowded = changes.filter((change) => change.crowdedOut)
    expect(carried.length, 'the early files keep their bodies').toBeGreaterThan(0)
    expect(crowded.length, 'the late ones are crowded out, not oversize').toBeGreaterThan(0)
    for (const change of crowded) {
      expect(change.oversize, 'a 30 KiB diff is not "too large"').toBeUndefined()
      expect(change.added, 'and it keeps its counts either way').toBe(150)
    }
  })

  it('…and a genuinely huge single file is still `oversize`', () => {
    // NON-VACUITY: the two reasons must stay tellable apart in BOTH directions.
    const body = `+${'x'.repeat(80)}\n`.repeat(500)
    const { changes } = parseUnifiedDiff(`diff --git a/big.ts b/big.ts\n@@ -1 +1 @@\n${body}`)
    expect(changes[0]!.oversize).toBe(true)
    expect(changes[0]!.crowdedOut).toBeUndefined()
  })

  it('a deletion marked only by `+++ /dev/null` is a deletion', () => {
    // `deleted file mode` is git's marker for a TRACKED file. Codex's apply_patch is not git, and a
    // `--no-index` diff omits it too. Read as `modified`, the row would offer a live chevron and no
    // "nothing on disk to revert to" banner for a file that is gone.
    const { changes } = parseUnifiedDiff(
      'diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n',
    )
    expect(changes[0]!.status).toBe('deleted')
  })

  it('…and `--- /dev/null` on the OLD side is still an addition, not a deletion', () => {
    // NON-VACUITY: the marker is directional, and reading either side the same way would turn every
    // newly created file into a deletion.
    const { changes } = parseUnifiedDiff(
      'diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+x\n',
    )
    expect(changes[0]!.status).not.toBe('deleted')
  })

  it('a turn that changed only BINARY files still reports them', () => {
    // The guard treats "parsed nothing" as "not a diff" and stays loud. An all-binary payload parses
    // to real rows with no counts and no bodies, and must reach the pane rather than trip the guard.
    const binary = [
      'diff --git a/a.png b/a.png',
      'index 57ac8df..dcd66ab 100644',
      'Binary files a/a.png and b/a.png differ',
      'diff --git a/b.png b/b.png',
      'index 11ac8df..22d66ab 100644',
      'Binary files a/b.png and b/b.png differ',
      '',
    ].join('\n')
    const [event] = normalizeNotification('turn/diff/updated', {
      threadId: 'th',
      turnId: 'tn',
      diff: binary,
    })
    expect(event?.type).toBe('file_change')
    if (event?.type !== 'file_change') throw new Error('not a file_change')
    expect(event.changes.map((change) => change.path)).toEqual(['a.png', 'b.png'])
    expect(event.changes.every((change) => change.added === undefined)).toBe(true)
  })

  it('the diff bound is BYTES, and the schema agrees with the parser', () => {
    // ⚠️ `z.string().max(n)` counts UTF-16 code units; `MAX_FILE_DIFF_BYTES` is named and documented
    // in bytes. For ASCII they agree, which is why nothing live was wrong — for CJK they differ by
    // three, and an IMPORTED bundle passes through the schema and nothing else.
    const cjk = '漢'.repeat(MAX_FILE_DIFF_BYTES / 2)
    expect(cjk.length, 'well under the code-unit reading').toBeLessThan(MAX_FILE_DIFF_BYTES)
    expect(Buffer.byteLength(cjk, 'utf8'), 'and well over the byte one').toBeGreaterThan(
      MAX_FILE_DIFF_BYTES,
    )
    const event = {
      type: 'file_change',
      changes: [{ path: 'a.ts', status: 'modified', diff: cjk }],
      source: 'imported',
    }
    expect(runtimeEventSchema.safeParse(event).success, 'rejected on bytes').toBe(false)
    // NON-VACUITY: the same event with an ASCII diff of the same character count is accepted.
    const ascii = {
      ...event,
      changes: [{ path: 'a.ts', status: 'modified', diff: 'x'.repeat(cjk.length) }],
    }
    expect(runtimeEventSchema.safeParse(ascii).success).toBe(true)
  })
})
