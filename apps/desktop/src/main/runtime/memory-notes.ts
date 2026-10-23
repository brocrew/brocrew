import { lstatSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import {
  MEMORY_NOTES_PER_EVENT,
  MEMORY_NOTE_TEXT_CAP,
  type MemoryNoteEvent,
  type MemoryNoteSeen,
} from '../../shared/runtime-ipc'
import { newestMemoryNotes as adHocNotes, readInstructionFile } from '../providers/instruction-io'
import { providerKnowledge } from '../providers/knowledge-definitions'

/**
 * 🔴 **A memory the agent was asked to keep, observed where it happened** (318 §2.1, friction F5).
 *
 * ## ⛔ What is being observed, and what is not
 *
 * The provider reports nothing when its agent writes a memory. 316 measured fifteen config arms on a
 * real `0.146.0` child: the memory tools are declared inside the code-mode `exec` surface and the
 * app-server publishes no `item/*` for a nested call, so an ordinary turn carries the user and
 * assistant messages and nothing else. ⛔ **There is no event to render and no amount of parsing
 * gets one** — that was settled with its costs measured, and this module does not reopen it.
 *
 * ⚑ **What there is, is a directory.** The instructions panel already reads it (317), and the ledger
 * already delimits a turn — so *"this name is in the store now and was not when this turn began"* is
 * an observation this app can make and stand behind. That is all this module does.
 *
 * ## ⚠️ The three claims it refuses to make, and where each is enforced
 *
 * 1. **Not a tool call.** Nothing here reads a wire. {@link MemoryNoteSeen} says the row is a file
 *    that appeared, and `MemoryNoteEntry.vue` says so on screen in those words.
 * 2. **Not the pipeline's writing.** `MEMORY.md`, `memory_summary.md`, `raw_memories.md` and
 *    `rollout_summaries/` are rewritten by the background extractor **after a LATER session's turn**
 *    — 312 measured 14 s and 51 s. ⛔ Attributing one of those to the conversation on screen would
 *    be a fabricated causal link, so {@link NOTE_SOURCES} points at the ad-hoc notes directory and
 *    at nothing else. 317 already ruled which files are the agent's decisions and which are the
 *    pipeline's working material, and this follows that ruling rather than making a second one.
 * 3. **Not "the agent in front of you".** A profile IS the shared-memory boundary (085): two
 *    sessions in one profile share one home and one store. So the honest subject is the PROFILE, and
 *    the row says *this profile's memory store*. Snapshotting at the START of each turn is what
 *    keeps even that bounded — the window in which another session could be credited to this one is
 *    the turn itself, not the whole session.
 *
 * ## ⛔ Why this is provider-shaped, measured rather than assumed
 *
 * The other provider has no memory tool at all: it writes `MEMORY.md` and its topic files with
 * `Write`/`Edit`, which `claude/normalize.ts` turns into a `tool_call` whose summary is the file
 * path — **untruncated** — plus a `file_change` row beside it. A disk observation published next to
 * a reported call would be a second and weaker claim about one act, in a surface that already shows
 * the stronger one two rows up. ⚑ That is 035's duplicate and 318 §2.1's misattribution arriving
 * from the opposite side, so {@link NOTE_SOURCES} is `null` there and no event is ever published.
 *
 * ## ⛔ …and the RULING held while its reasoning was half wrong (330, corrected in place per 142)
 *
 * An untruncated event can still be unreadable in its rendered row: `ToolEntry` uses one line with ellipsis, and a long provider-home prefix can hide the informative memory filename. Keep the event intact while giving memory activity a recognizable presentation.
 *
 * ⚠️ **Nothing on those rows said *memory*.** The stronger claim really was two rows up, and it was
 * unreadable, which is `086` rather than `035`: a surface that shows a thing without naming it has
 * not shown it. ⚑ 330 fixed the row instead of publishing a second one — `tool_call.memoryPath`,
 * derived from the store the provider names on its own wire — so this module's decision is now
 * standing on a row that says what it is.
 *
 * ## ⚠️ The cost, said out loud
 *
 * **Two `readdir`s per turn** on one directory, plus one `stat`+`read` per note that is actually
 * new — nothing at all on a turn that wrote none, and nothing on a session whose provider is not
 * watched. ⛔ **No watcher**, deliberately: `fs.watch` fails silently on network volumes and after a
 * directory is replaced, and a watcher whose failure mode is silence would make an absent row
 * indistinguishable from an absent note. Every function here returns *no notes* when the disk
 * refuses it, and the panel — which reads the whole store on demand — remains the truth.
 */

/** Where a provider's asked-for notes land, or `null` when this app must not publish rows for it. */

/**
 * The directory to watch for this session, or `null` when there is nothing to watch.
 *
 * ⚠️ **Derived once per session and held**, because it cannot change: a session's provider home is
 * fixed at launch and the layout is a constant of the provider.
 */
export function memoryNoteDir(provider: Provider, providerHome: string): string | null {
  return providerKnowledge[provider].memory.noteDirectory(providerHome)
}

/**
 * The note names in the store right now, or **`null` when the store could not be listed**.
 *
 * ⛔ **A refusal is NOT an empty store, and collapsing the two was a defect found reviewing this
 * diff.** `adHocNotes` answers `names: []` with a `refused` reason for a directory that is a link,
 * is not a directory, or threw — and read as *"there are no notes"* that empty snapshot makes the
 * NEXT successful listing report the profile's entire pre-existing store as having appeared during
 * one turn. A transient `EMFILE` would have published a year of memory into one conversation.
 *
 * ⚠️ **So the caller is told, and the caller keeps the snapshot it already had.** Not looking is a
 * third state beside *"nothing"* and *"something"*, exactly as `074` says of every other absence in
 * this app, and the instructions panel — which reports the refusal WITH its reason — stays the
 * surface that explains it.
 */
export function noteNamesIn(dir: string | null): ReadonlySet<string> | null {
  if (dir === null) return new Set()
  const listed = adHocNotes(dir)
  if (listed.refused !== null) return null
  return new Set(listed.names)
}

/**
 * What appeared since {@link noteNamesIn} was last taken, as an event and the new snapshot.
 *
 * ⛔ **The snapshot comes back even when the event does not.** A caller that only stored the names
 * on the turns that produced a row would re-report every note it had already reported as soon as one
 * more arrived.
 *
 * ⚠️ **`names` is the WHOLE listing, not the union of the old set and the new notes.** A note the
 * agent deleted has to leave the snapshot, or the day it is written again nothing would be said.
 */
export function notesThatAppeared(
  dir: string | null,
  before: ReadonlySet<string>,
): { event: MemoryNoteEvent | null; names: ReadonlySet<string> } {
  if (dir === null) return { event: null, names: new Set() }
  const read = adHocNotes(dir)
  // ⛔ **A store we could not list changes nothing** — not the row, and not the snapshot. See
  // {@link noteNamesIn}: an empty listing kept as a snapshot is how a transient refusal turns into
  // a burst of rows about files written days ago.
  if (read.refused !== null) return { event: null, names: before }
  const listed = read.names
  const names = new Set(listed)
  // Already newest-first out of `adHocNotes`, and the filter keeps that order: the note a person
  // just asked for is the one they are looking for.
  const fresh = listed.filter((name) => !before.has(name))
  if (fresh.length === 0) return { event: null, names }
  const shown = fresh.slice(0, MEMORY_NOTES_PER_EVENT)
  const dropped = fresh.length - shown.length
  const notes = shown.map((name) => readNote(join(dir, name)))
  return {
    // Spread so an ordinary event carries no `dropped` key at all — the same absent-is-a-fact
    // shape `file_change` and `provider_commands` use for their own caps.
    event: { type: 'memory_note', notes, ...(dropped > 0 ? { dropped } : {}) },
    names,
  }
}

/**
 * One row's worth of a note.
 *
 * Follow linked memory notes with `readInstructionFile`, matching the memory panel's read. The ledger row and panel should describe the same file.
 *
 * ⚠️ **A note with no text still gets a row, with its path** — 074's rule, and the reason
 * {@link MemoryNoteSeen.text} is optional: a note that is too large, not UTF-8, a link that loops
 * or points at nothing, or not a regular file.
 */
function readNote(path: string): MemoryNoteSeen {
  const read = readInstructionFile(path, MEMORY_NOTE_TEXT_CAP)
  // ⛔ **The reader's own reason, carried rather than guessed** — the row says which of the six
  // applied. A single sentence blaming a link was false for five of them.
  //
  // 🔴 **733 · …except where the reader's word is `absent` and the name is a LINK.** Following, a
  // link to nothing is ENOENT, which reads as a note that vanished between the listing and the
  // read; it did not — its far end is gone. ⚑ So it says so, in 314 §3's word. (Until `733` it
  // said `symlink`, which was true while this row refused every link.)
  if (!read.ok) {
    const unread = read.reason === 'absent' && isALink(path) ? 'dangling-link' : read.reason
    return { path, ...size(path), unread }
  }
  // ⚠️ **The SIZE is asked for separately and is allowed to be absent**, because `read.bytes` is
  // what was read and the cap may have cut it — a row has to be able to say a note is bigger than
  // what it shows. When the file really is short the two agree, and `size` is the one that is true
  // of the file rather than of the read.
  return {
    path,
    ...size(path),
    text: read.text,
    ...(read.truncated ? { truncated: true } : {}),
  }
}

/** Is the entry itself a link — asked of the entry, never of where it leads. */
function isALink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * The note's size — the file it IS, a link followed — or nothing.
 *
 * ⛔ **`stat`, and that is the same ruling {@link readNote} makes about the text** (`733`): the
 * text is the link's target's, so the size is too — a link's own `lstat` size is the length of its
 * target path, a true number about the wrong thing. ⚠️ And a non-regular target gets no size at
 * all.
 */
function size(path: string): { bytes?: number } {
  try {
    const seen = statSync(path)
    return seen.isFile() ? { bytes: seen.size } : {}
  } catch {
    return {}
  }
}
