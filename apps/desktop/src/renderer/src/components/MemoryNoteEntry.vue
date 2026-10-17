<script setup lang="ts">
import { clockTime } from '../../../shared/clock'
import { pathTail as basename } from '../../../shared/path-tail'
import { fullTime } from '../lib/clock'
import type { MemoryNoteItem, TranscriptItem } from '../lib/transcript'

/**
 * 🔴 **A memory the agent was asked to keep, said where it happened** (318 §2.1, friction F4/F5).
 *
 * The pinned provider emits no item for this memory call even when a note is saved. This row comes from directory listings taken at turn start and end, showing the saved file rather than inventing a tool event.
 *
 * ## ⛔ The sentence, and why it is worded the way it is
 *
 * *"seen on disk — not reported as a tool call"*. Every word of that is load-bearing:
 *
 *  - **seen on disk** — we looked at a directory. We did not watch anything happen, and a row that
 *    read as a reported call would be inventing a wire fact (009's rule, 305's defect).
 *  - **this profile's** — a profile IS the shared-memory boundary (085), so the store belongs to the
 *    profile and any session in it can write this file. Saying *"the agent wrote"* would attribute
 *    to the conversation on screen something only the PROFILE can be held to.
 *  - **while this turn ran** — the two listings bracket the turn, so this is the strongest true
 *    statement about WHEN, and it is not *"because of this turn"*.
 *
 * ⚠️ **It is not a {@link ToolEntry} and not a `NoticeEntry`.** See {@link MemoryNoteItem}: a tool
 * row would claim a call, and an `info` notice is dropped by the reading view — which is the mode in
 * which this went missing in the first place.
 *
 * ## ⚠️ The text is QUOTED here and rendered as a document over there
 *
 * The repo's document-viewer standard (Markdown/Raw on white paper) is what the instructions panel
 * gives these files, and this row deliberately does not repeat it. A note is 23 or 108 bytes in the
 * measured cases and the content is the whole point — so it is quoted inline, the way a short thing
 * is quoted — and the link at the foot goes to the panel, where the whole store opens as documents.
 * ⛔ Opening a paper per note inside the conversation would duplicate that surface and bury the row.
 */
const props = withDefaults(
  defineProps<{
    item: MemoryNoteItem & Pick<TranscriptItem, 'at'>
    /**
     * ⛔ **Whether anything on screen can act on the link** (found reviewing this diff).
     *
     * `ReadingPane` renders the same transcript for an IMPORTED conversation and has no drawer to
     * open, so the button it inherited was a control that did nothing when pressed — `106`'s rule
     * broken by a component that never asked for it. ⚠️ **Default `false`**, so a new mount is
     * silent rather than broken, and the one surface that CAN open the drawer says so explicitly.
     */
    canOpenStore?: boolean
  }>(),
  { canOpenStore: false },
)

/**
 * ⚠️ **The affordance 318 §2.3 asks for, and the ONLY new one.** The store this row names is three
 * clicks away in a drawer whose tab hint did not mention memory — which is why a person who had the
 * answer did not find it. The link is here rather than standing on the conversation surface because
 * this is the moment a reader is asking the question.
 */
const emit = defineEmits<{ (event: 'openInstructions'): void }>()

/** The same two-band form the instructions panel uses, so one file reads the same in both places. */
function bytesLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * ⛔ **Why a note's text is not here — the READER's reason, never a guess** (found reviewing this
 * diff).
 *
 * The row said *"this row does not follow links into the store"* for every unreadable note. That is
 * true of exactly one of the six reasons the reader can give, and for the other five it sends a
 * person looking for a symlink that is not there — `086` in the direction that costs a search.
 *
 * ⚠️ **An unknown reason falls through to the raw word**, exactly as the instructions panel's own
 * refusal map does: a main process that grows a seventh reason before this map does must still say
 * something true.
 */
const UNREAD_WORDS: Record<string, string> = {
  // ⚠️ **`733` · the row follows links now**, so this word arrives on a row written before it —
  // when the row refused every link — or for a loop of links, which has no file at its end. It
  // said *"this row does not follow one into the store"*, true of the first and false of the
  // second; these words are true of both.
  symlink: 'a link this row did not follow to a file',
  // 🔴 **733** — a link whose far end is gone, in the instructions panel's own words (314 §3).
  'dangling-link': 'a link with nothing at the other end',
  'not-a-regular-file': 'not a regular file',
  'too-large': 'larger than a note this row will carry',
  'not-utf8': 'not readable as text',
  unreadable: 'this app could not read it',
  absent: 'gone again before it could be read',
}

function unreadWords(reason: string): string {
  return UNREAD_WORDS[reason] ?? reason
}
</script>

<template>
  <div class="memory-note" data-cy="memory-note">
    <div class="mn-head">
      <svg class="icon"><use href="#i-file" /></svg>
      <strong data-cy="memory-note-heading">
        {{
          props.item.notes.length === 1
            ? 'A note appeared in this profile’s memory store'
            : `${props.item.notes.length} notes appeared in this profile’s memory store`
        }}
      </strong>
      <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
    </div>

    <!-- ⛔ **The distinction the whole row exists to survive**, stated before the content rather than
         as a footnote: we read a directory, and nothing told us a tool ran. -->
    <p class="mn-sub" data-cy="memory-note-provenance">
      Seen on disk between the start and the end of this turn — not reported as a tool call.
    </p>

    <div
      v-for="note in props.item.notes"
      :key="note.path"
      class="mn-note"
      data-cy="memory-note-row"
    >
      <div class="mn-name">
        <span class="mn-file">{{ basename(note.path) }}</span>
        <!-- ⛔ **No size where none was measured** (074). A note that is not a regular file, or a
             link to nothing, has no size to print. (Since `733` a linked note's size is the file
             it leads to, as its text is.) -->
        <span v-if="note.bytes !== undefined" class="mn-bytes">{{ bytesLabel(note.bytes) }}</span>
      </div>
      <!-- Selectable, like every other path in this app: these exist to be pasted into a terminal. -->
      <div class="mn-path">{{ note.path }}</div>
      <!-- ⚑ **The content, because the content is the whole point** (318 §2.1). -->
      <pre v-if="note.text !== undefined" class="mn-text" data-cy="memory-note-text">{{
        note.text
      }}</pre>
      <!-- ⛔ **An absence with the READER'S OWN reason, never a blank and never a guess** (074,
           086). The file appeared; its bytes are not here; and the row says which of the six
           reasons applied rather than naming one of them for all six. -->
      <p v-else class="mn-absent" data-cy="memory-note-unread">
        Its text is not shown here — {{ unreadWords(note.unread ?? 'unreadable') }}.
      </p>
      <p v-if="note.truncated" class="mn-absent" data-cy="memory-note-truncated">
        Cut at the size limit — this much of it is shown here.
      </p>
    </div>

    <!-- A cap that can never be silent (092 §4). -->
    <p v-if="props.item.dropped" class="mn-absent" data-cy="memory-note-dropped">
      {{ props.item.dropped }} more {{ props.item.dropped === 1 ? 'note' : 'notes' }} appeared and
      {{ props.item.dropped === 1 ? 'is' : 'are' }} not listed here.
    </p>

    <!-- ⚠️ **Only where something can act on it** — see {@link canOpenStore}. And the words are
         about the STORE rather than about this file: the panel it opens lists what the store held
         when the conversation was opened, so *"see this note there"* would be a promise the panel's
         own launch-time semantic cannot keep. -->
    <button
      v-if="props.canOpenStore"
      class="mn-link"
      type="button"
      data-cy="memory-note-open-store"
      @click="emit('openInstructions')"
    >
      Where this profile keeps its memory
      <svg class="icon arrow"><use href="#i-arrow" /></svg>
    </button>
  </div>
</template>

<style scoped>
/* Heavier than a `NoticeEntry` hairline and lighter than a card, exactly as `CompactionEntry` is:
   this is a durable fact about the conversation, and it is not asking for anything. */
.memory-note {
  max-width: var(--measure-message);
  margin: var(--space-9) 0;
  padding: var(--space-5) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
}

.mn-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.mn-head .icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--muted);
}

.mn-head strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.mn-head .time {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.mn-sub {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.mn-note {
  margin-top: var(--space-5);
}

.mn-name {
  display: flex;
  align-items: baseline;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.mn-bytes {
  color: var(--muted);
}

.mn-path {
  color: var(--faint);
  cursor: text;
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  user-select: all;
}

/* Bounded rather than unbounded: the wire cap is 4 KiB and a note that reaches it must not push the
   rest of the conversation off the screen. It scrolls in place, the way every other long body in
   this app does. */
.mn-text {
  max-height: 200px;
  margin: var(--space-3) 0 0;
  padding: var(--space-4);
  overflow: auto;
  border-left: var(--border-accent-width) solid var(--line-strong);
  background: var(--wash-1);
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* The same italic register `SessionInstructions` uses for a file it would not read. */
.mn-absent {
  margin: var(--space-3) 0 0;
  color: var(--waiting);
  font-size: var(--type-caption);
  font-style: italic;
  line-height: 1.5;
}

.mn-link {
  display: inline-flex;
  align-items: center;
  margin-top: var(--space-5);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text-soft);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
}

.mn-link:hover {
  text-decoration: underline;
}

.mn-link .arrow {
  width: 11px;
  height: 11px;
  color: var(--accent);
}
</style>
