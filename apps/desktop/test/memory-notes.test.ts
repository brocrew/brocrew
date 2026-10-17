import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  codexAdHocNotesDir,
  codexMemoryIndex,
  codexMemorySummary,
  SUPPORTED_PROVIDERS,
} from '@brobot2/runtime'
import { memoryNoteDir, noteNamesIn, notesThatAppeared } from '../src/main/runtime/memory-notes'
import { AGENT_MEMORY_NOTES_SHOWN } from '../src/main/runtime/instructions'
import { MEMORY_NOTES_PER_EVENT, MEMORY_NOTE_TEXT_CAP } from '../src/shared/runtime-ipc'

/**
 * 🔴 **318 · what the conversation shows when a note is written — measured on a real directory.**
 *
 * ⛔ **Every fixture here is planted with the app's OWN path helper** (`codexAdHocNotesDir`), which
 * is the function the observer derives from. That is deliberate and it is also this file's honest
 * bound: a test that plants and finds through one derivation proves the reader, never the address.
 * ⚑ The address is proved somewhere else and by something else — `codex-memory-store.smoke.ts`
 * plants at `codexMemorySummary()` and reads the oracle off a real child's own outbound request.
 * This file is about the DIFF; that one is about the path.
 */
describe('318 · a note that appeared while the turn ran', () => {
  let root: string
  let home: string
  let notes: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-memory-notes-'))
    home = join(root, 'provider-homes', 'default', 'default', 'codex')
    notes = codexAdHocNotesDir(home)
    mkdirSync(notes, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const note = (name: string, text: string): string => {
    const path = join(notes, name)
    writeFileSync(path, text)
    return path
  }

  /**
   * ⛔ **`noteNamesIn` answers `null` for a store it could not list**, and that third state is the
   * subject of two tests below. Everywhere the store IS readable, this asserts the read succeeded
   * rather than silently substituting an empty set — which is the very confusion the API removed.
   */
  const seen = (dir: string = notes): ReadonlySet<string> => {
    const listed = noteNamesIn(dir)
    expect(listed, 'the fixture store could not be listed').not.toBeNull()
    return listed!
  }

  const NAME_A = '2026-09-04T00-00-00-user-name.md'
  const NAME_B = '2026-09-04T00-01-00-user-full-name.md'

  it('says nothing at all when nothing appeared', () => {
    note(NAME_A, "The user's name is Bob.\n")
    const before = seen()
    // ⚑ The non-vacuous half: the store is NOT empty, and the diff is still silent.
    expect(before.size, 'the fixture never landed').toBe(1)
    expect(notesThatAppeared(notes, before).event).toBeNull()
  })

  it('reports the note the turn wrote, with its bytes and its text', () => {
    const before = seen()
    expect(before.size).toBe(0)
    note(NAME_A, "The user's name is Bob.")

    const { event, names } = notesThatAppeared(notes, before)
    expect(event, 'a note appeared and nothing was published').not.toBeNull()
    expect(event!.notes).toHaveLength(1)
    expect(event!.notes[0]!.path).toBe(join(notes, NAME_A))
    expect(event!.notes[0]!.text).toBe("The user's name is Bob.")
    expect(event!.notes[0]!.bytes).toBe(23)
    expect(event!.notes[0]!.truncated).toBeUndefined()
    // ⛔ The snapshot comes back, so the next turn does not report the same note again.
    expect([...names]).toEqual([NAME_A])
    expect(notesThatAppeared(notes, names).event).toBeNull()
  })

  it('reports several, newest name first', () => {
    const before = seen()
    note(NAME_A, 'first')
    note(NAME_B, 'second')
    const { event } = notesThatAppeared(notes, before)
    expect(event!.notes.map((each) => each.path)).toEqual([
      join(notes, NAME_B),
      join(notes, NAME_A),
    ])
  })

  /**
   * ⛔ **The trap 318 §2.1 names, as an assertion.** The background pipeline rewrites these four
   * asynchronously and, 312 measured, after a LATER session's turn — so a change to one of them is
   * not this turn's agent remembering something.
   */
  it('ignores every file the pipeline writes, and the store files beside them', () => {
    const before = seen()
    mkdirSync(join(home, 'memories', 'rollout_summaries'), { recursive: true })
    writeFileSync(codexMemoryIndex(home), '# handbook\n')
    writeFileSync(codexMemorySummary(home), 'summary\n')
    writeFileSync(join(home, 'memories', 'raw_memories.md'), 'raw\n')
    writeFileSync(join(home, 'memories', 'rollout_summaries', '2026-09-04T00-00-00-x.md'), 'roll\n')

    expect(
      notesThatAppeared(notes, before).event,
      'the pipeline was reported as a memory',
    ).toBeNull()
    // 193's rule: the negative above passes over a broken observer unless this one passes too.
    note(NAME_A, 'the one that counts')
    expect(notesThatAppeared(notes, before).event!.notes).toHaveLength(1)
  })

  /**
   * 🔴 **733 · a note that is a LINK is followed** (`731` F-3, R93: *"remove old guards"*).
   *
   * ⛔ This test was *"keeps the row for a note it will not read, and does not follow the link"*,
   * and it asserted the target's bytes and size stayed out of the ledger — for the credential a
   * linked note might point at. The PM: *"Follow links as the CLIs do."* ⚑ The panel's reader has
   * followed since 170 §2; the row now reads the same file the same way.
   */
  it('🔴 733 · a note that is a link is FOLLOWED: its row carries the text and size of its target', () => {
    const target = join(root, 'kept-elsewhere.md')
    writeFileSync(target, 'A NOTE KEPT ELSEWHERE')
    const before = seen()
    symlinkSync(target, join(notes, NAME_A))

    const { event } = notesThatAppeared(notes, before)
    const row = event!.notes[0]!
    expect(row.path, 'a linked note lost its row').toBe(join(notes, NAME_A))
    // ⛔ On `main`: no text, no size, and `unread: 'symlink'`.
    expect(row.text).toBe('A NOTE KEPT ELSEWHERE')
    expect(row.bytes, "the size is the target's, as the text is").toBe(21)
    expect(row.unread).toBeUndefined()
  })

  it('⚑ THE CONTROL, kept · a LOOP of links still has a row and no text — nothing is at the end of it', () => {
    // ⚑ The PM: *"Keep any link rule whose reason is NOT a credential (a loop, a missing target)"*.
    const before = seen()
    symlinkSync(join(notes, NAME_A), join(notes, NAME_A))

    const row = notesThatAppeared(notes, before).event!.notes[0]!
    expect(row.path).toBe(join(notes, NAME_A))
    expect(row.text).toBeUndefined()
    expect(row.bytes).toBeUndefined()
    expect(row.unread).toBe('symlink')
  })

  it('🔴 733 · …and a link to NOTHING says so, rather than that the note vanished', () => {
    // ⛔ Following, the reader makes a link to nothing `absent` — which the row words as a note gone
    // between the listing and the read. It did not go anywhere; its far end is gone (314 §3).
    // On `main` this said `symlink`, which was true while the row refused every link.
    const before = seen()
    symlinkSync(join(root, 'never-existed.md'), join(notes, NAME_A))

    const row = notesThatAppeared(notes, before).event!.notes[0]!
    expect(row.path).toBe(join(notes, NAME_A))
    expect(row.text).toBeUndefined()
    expect(row.unread).toBe('dangling-link')
  })

  it('cuts a long note and says that it cut it', () => {
    const before = seen()
    const long = 'x'.repeat(MEMORY_NOTE_TEXT_CAP + 500)
    note(NAME_A, long)
    const row = notesThatAppeared(notes, before).event!.notes[0]!
    expect(row.truncated).toBe(true)
    expect(row.text!.length).toBe(MEMORY_NOTE_TEXT_CAP)
    // ⚑ The pair that makes truncation legible: what was shown, and how big it really is.
    expect(row.bytes).toBe(MEMORY_NOTE_TEXT_CAP + 500)
  })

  it('counts what it did not list, rather than showing a short list as a whole one', () => {
    const before = seen()
    for (let index = 0; index < MEMORY_NOTES_PER_EVENT + 3; index += 1) {
      note(`2026-09-04T00-00-${String(index).padStart(2, '0')}-n.md`, `note ${index}`)
    }
    const { event } = notesThatAppeared(notes, before)
    expect(event!.notes).toHaveLength(MEMORY_NOTES_PER_EVENT)
    expect(event!.dropped).toBe(3)
  })

  it('drops a note that left the store from the snapshot, so a rewrite is reported again', () => {
    const before = seen()
    const path = note(NAME_A, 'first')
    const first = notesThatAppeared(notes, before)
    expect(first.event).not.toBeNull()
    rmSync(path)
    const gone = notesThatAppeared(notes, first.names)
    expect(gone.event).toBeNull()
    expect([...gone.names]).toEqual([])
    note(NAME_A, 'again')
    expect(notesThatAppeared(notes, gone.names).event!.notes).toHaveLength(1)
  })

  it('says nothing, and does not throw, when the store cannot be read', () => {
    const missing = join(root, 'no-such-home', 'memories', 'extensions', 'ad_hoc', 'notes')
    expect(noteNamesIn(missing), 'an absent store is empty, not a refusal').not.toBeNull()
    expect(notesThatAppeared(missing, new Set()).event).toBeNull()
    // ⛔ A file where the directory should be is a REFUSAL, not an empty store — `null`, so the
    // caller keeps the snapshot it had rather than reporting the next successful listing as news.
    const asFile = join(root, 'as-file')
    writeFileSync(asFile, 'not a directory')
    expect(noteNamesIn(asFile)).toBeNull()
    const held = new Set(['something-we-already-knew.md'])
    const refused = notesThatAppeared(asFile, held)
    expect(refused.event).toBeNull()
    expect(refused.names, 'a refusal wiped the snapshot').toBe(held)
  })
})

/**
 * ⛔ **The gate 318 §3 asks to be measured rather than assumed** — and it is the reason this
 * dispatch's row is narrower than the brief expected.
 */
describe('318 · which providers this app watches at all', () => {
  it('watches the one whose memory writes are reported nowhere, and only that one', () => {
    expect(memoryNoteDir('codex', '/homes/codex')).toBe(codexAdHocNotesDir('/homes/codex'))
    // ⛔ The other provider writes its memory with `Write`/`Edit`, which `claude/normalize.ts` turns
    // into a `tool_call` whose summary is the file path plus a `file_change` row. A disk observation
    // beside a reported call would be one act claimed twice.
    expect(memoryNoteDir('claude', '/homes/claude')).toBeNull()
    // Non-vacuity: the two assertions above are about the whole set, not a sample of it.
    expect([...SUPPORTED_PROVIDERS].sort()).toEqual(['claude', 'codex'])
  })

  it('nothing is watched, and nothing is read, for an unwatched provider', () => {
    expect(noteNamesIn(null)!.size).toBe(0)
    const { event, names } = notesThatAppeared(null, new Set(['anything']))
    expect(event).toBeNull()
    expect(names.size).toBe(0)
  })
})

/**
 * ⚑ **The relationship the wire constant CLAIMS, asserted** — the only thing that turns the comment
 * on `MEMORY_NOTES_PER_EVENT` into a fact. The two live in different layers on purpose (the shared
 * wire module may not reach into the main process's reader), and a comment saying *"the same
 * number"* is worth nothing the day one of them moves.
 */
describe('318 · the two note caps are one judgement', () => {
  it('the wire cap and the panel cap are the same number', () => {
    expect(MEMORY_NOTES_PER_EVENT).toBe(AGENT_MEMORY_NOTES_SHOWN)
  })
})
