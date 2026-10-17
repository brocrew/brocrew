<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { MemoryLoadedItem, TranscriptItem } from '../lib/transcript'

/**
 * 🔴 **How this conversation opened: with the profile's memory already in the prompt** (332,
 * friction F15).
 *
 * The provider can load `MEMORY.md` into the system prompt before the first token. Answering from that prompt causes no memory tool call, so disclose loaded memory at launch as well as listing the store in the drawer.
 *
 * ## ⛔ The sentence, and why every clause of it is load-bearing
 *
 * *"This conversation opened with this profile's memory index in the prompt."*
 *
 *  - **This conversation opened** — it is a launch fact and the row is published once, at ordinal 0,
 *    above the first message. ⚠️ *"N memories loaded"* was the obvious wording and it is the trap:
 *    it invites *"loaded them for this answer"*, which is a recall, which is exactly what
 *    319 §3 forbids this provider from claiming. Nothing here happened for an answer.
 *  - **this profile's** — a profile IS the shared-memory boundary (085), the same subject
 *    {@link MemoryNoteEntry} uses. The store belongs to the profile, not to the agent on screen.
 *  - **memory index** — the index, not the memories. The distinction the whole surface turns on:
 *    ⚑ the index is what enters the prompt, and the memories beside it are read **only if the agent
 *    chooses to**. That is 322's wording on the panel rows, kept word-for-word rather than restated,
 *    because a second vocabulary for one fact is how a reader ends up believing there are two.
 *
 * ## ⚠️ What is ours and what is measured, said out loud
 *
 * ⛔ **This app did the reading, and says so** — {@link MemoryNoteEntry} is the precedent
 * (*"seen on disk … not reported as a tool call"*) and this matches its honesty rather than
 * borrowing the provider's voice. ⚑ That the index reaches the prompt is **312's measurement of a
 * real child**, carried today by `InjectedInstruction.reach` and stated on the panel in these words;
 * this row does not re-decide it, so the panel and the conversation cannot come apart.
 *
 * ⛔ **It claims no reading, anywhere.** There is no verb here the agent is the subject of, except
 * the one that says it *may* choose to read something.
 *
 * ## 🔴 601 · WHO loaded it, and the half this row cannot reach
 *
 * ⛔ **Running a real project, BroBot reported a context block quoting a `MEMORY.md` with two
 * entries, listed that directory mid-session and found it EMPTY** — both files were written
 * afterwards. ⚠️ **That block is the PROVIDER's own auto-memory, in the CLI's system prompt before
 * any of this app's code runs**, and `170` §2 has already ruled out refusing it: *"refusing it here
 * removed the row from the drawer and removed nothing from the prompt: NO VISIBILITY AND NO
 * PROTECTION, which is strictly worse than either."* ⚑ The standing ruling is **BroBot follows what
 * the provider follows, and says that it did**; this row is the *says that it did* half.
 *
 * ⚑ **So the provider's act is stated FIRST and at the row's own weight**, and this app's is stated
 * beside it as a different act with a different subject — `HO-087` §3: *a claim about a behaviour
 * names whose behaviour it is: ours, the provider's, or the model's.* ⛔ Both used to be one faint
 * sentence, ours leading, theirs a clause in the middle of it.
 *
 * ## ⚠️ What this does NOT fix, preserved because the PO said it plainly
 *
 * > ⛔ ***"It fixes what a PERSON sees, and the phantom BroBot hit was in the MODEL's prompt.
 * > Nothing we build reaches that."*** (`HO-087` §2)
 *
 * ⛔ **No sentence here may imply this app verified, checked or bounded what the provider loaded.**
 * ⚑ **It reports. That is the whole claim** — which is why the provider line ends by saying this
 * app does not see the prompt at all, rather than leaving a reader to assume it does.
 *
 * ## ⛔ And the clock this row still does not have — `601` §4.2, NOT built here
 *
 * ⚠️ **`MemoryLoadedEvent` carries no moment, and {@link TranscriptItem.at} is not one.** ⛔ That
 * stamp is taken in `RuntimeHost.recordOurs` — `const at = stamped ?? this.now()`, reached from
 * `publishOurs`, which passes no `stamped` for this row — when the row is APPENDED inside
 * `onRegistered`. ⚑ **The look happens far earlier**, in `readClaudeAgentMemory` during
 * `readSessionInstructions`, and **`await this.awaitLaunch(…)` sits between them**: a provider
 * spawn whose wait is `deps.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS`, 15 s by default and
 * injectable, with the ledger write after it unbounded. ⚠️ **`prepareProviderHome` is NOT in this
 * interval** — it runs above the read, so the *"can legitimately be slow on a first run"* note at
 * the `awaitLaunch` call is about a different span (checked, because it would have widened this
 * one).
 *
 * 🔴 **So the only number this row can reach is the time a THIRD act finished, and labelling it
 * *when we looked* would be the very error `HO-087` §3 names.** ⛔ **And the number is already
 * DRAWN**, unlabelled, in the header strip — which is why no sentence on this row may name a
 * MOMENT: a reader binds the phrase to the digits. ⚑ **A WINDOW that contains both is what this
 * row can honestly say**, and *as this session was launched* is that window —
 * {@link MemoryNoteEntry}'s *"between the start and the end of this turn"*, which is the same
 * device for the same reason. ⚠️ The number itself needs a field on the event, which is a runtime
 * seat's job (`601` §7).
 */
const props = withDefaults(
  defineProps<{
    item: MemoryLoadedItem & Pick<TranscriptItem, 'at'>
    /**
     * ⛔ **Whether anything on screen can act on the link** — {@link MemoryNoteEntry}'s field, for
     * its reason: `ReadingPane` renders the same transcript for an IMPORTED conversation and has no
     * drawer to open, so an inherited button would be a control that does nothing when pressed
     * (`106`). ⚠️ Default `false`, so a new mount is silent rather than broken.
     */
    canOpenStore?: boolean
  }>(),
  { canOpenStore: false },
)

/**
 * ⚑ **The door 332 §2.3 asks for, and it is the one that already exists.** The store this row names
 * is listed in the drawer (322) and `TranscriptView` already raises this event for
 * {@link MemoryNoteEntry}. Cutting a second way in would be two affordances for one destination.
 */
const emit = defineEmits<{ (event: 'openInstructions'): void }>()

/** The last path segment. Never the identity — the whole path is shown, and is selectable. */
const indexName = computed(
  () => props.item.index.split('/').filter(Boolean).slice(-1)[0] ?? props.item.index,
)

/**
 * The store: the directory the index sits in, or **empty when the path names no directory**.
 *
 * ⚠️ **Derived from the one path this row carries rather than carried beside it.** Two spellings of
 * one location is how they come to disagree — and the event's own doc says the path IS the claim, so
 * a second field would be a second claim about the same thing.
 *
 * ⛔ **Empty rather than the path itself** (074, found reviewing this diff). It returned
 * `props.item.index` when there was no `/`, so a replayed row carrying a bare `MEMORY.md` drew
 * *"MEMORY.md in MEMORY.md"* — a sentence claiming a directory that is a file. The clause is
 * withheld instead; the whole path is one line down either way.
 */
const store = computed(() => {
  const cut = props.item.index.lastIndexOf('/')
  return cut <= 0 ? '' : props.item.index.slice(0, cut)
})
</script>

<template>
  <div class="memory-loaded" data-cy="memory-loaded">
    <div class="ml-head">
      <svg class="icon"><use href="#i-file" /></svg>
      <strong data-cy="memory-loaded-heading">
        This conversation opened with this profile’s memory index in the prompt
      </strong>
      <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
    </div>

    <!-- 🔴 **WHOSE act put this file in front of the model, said first and at the row's own
         weight** (601 §4.1). ⛔ It used to be a clause in the middle of the faint line below, which
         is a footnote — and `593` measured what a footnote on a desktop app is worth. ⚠️ **The two
         acts are separated because they have different subjects**: `HO-087` §3's rule is that a
         claim about a behaviour names whose behaviour it is, and these are the provider's and
         ours. ⛔ **The second sentence is the LIMIT**, not a disclaimer: this app cannot see the
         prompt, so nothing on this row may read as having checked it (601 §5).
         ⚠️ **`in front of the model` is the PANEL's phrase and is kept word for word** — the
         docblock's *"this row does not re-decide it, so the panel and the conversation cannot come
         apart"* is a promise about VOCABULARY too, and `601` broke it for one commit by saying
         *loaded this file into the model's prompt*. ⛔ A second wording for one fact is how a
         reader comes to believe there are two. -->
    <p class="ml-by" data-cy="memory-loaded-by">
      The provider puts this file in front of the model itself, before the first message. This app
      did not put it there and does not see the prompt the provider builds.
    </p>

    <!-- ⛔ **Ours, labelled as ours, and deliberately BELOW the line above** — the note about the
         row, in the colour a note belongs in. ⚠️ It used to call itself *"not a footnote"*; since
         `601` split the two acts apart it IS the footnote, by construction, and the line above is
         the content.
         ⚑ **It names BOTH acts, because the row depends on both**: the index was READ (that is how
         the path is known) and the store was LISTED (that is where `beside` comes from) — the
         contract's *"this app looked at a directory and says so"* had no visible sentence left
         after `601`'s first pass.
         ⛔ **A WINDOW, never an instant.** `MemoryNoteEntry`'s *"between the start and the end of
         this turn"* is the precedent: the row draws `props.item.at` in its header, that stamp is
         the APPEND (see the docblock), and a phrase naming a moment would hand a reader the wrong
         number to bind it to. *As this session was launched* contains both the look and the stamp.
         ⚑ **`599`'s asymmetry, from this side**: that dispatch stamps a read time on every file
         this app APPENDS and deliberately leaves it off these, because a number here would date
         our display read and be read as the provider's. -->
    <p class="ml-sub" data-cy="memory-loaded-provenance">
      This app looked at that store as this session was launched — it read this index and listed
      what sits beside it, so this row could name them. Nothing here is a tool call.
    </p>

    <!-- ⚑ **The readable half — filename first, then where it lives.** Its own hook, because the
         full path one line down also contains the directory: an assertion about "the row names the
         store" is satisfied by the record alone, and a test that could not tell them apart was a
         survivor in this dispatch's own table (M22). -->
    <div class="ml-name" data-cy="memory-loaded-name">
      <span class="ml-file">{{ indexName }}</span>
      <span v-if="store" class="ml-in">in {{ store }}</span>
    </div>
    <!-- Selectable, like every other path in this app: these exist to be pasted into a terminal. -->
    <div class="ml-path" data-cy="memory-loaded-path">{{ props.item.index }}</div>

    <!-- ⛔ **No clause at zero** (317, and 332 §2.4). A store with an index and nothing beside it is
         a true launch fact and the row above says it; *"0 memories"* is an empty state rendered as
         news. ⚑ And the sentence is 322's, word for word — the agent MAY read one. -->
    <p v-if="props.item.beside > 0" class="ml-beside" data-cy="memory-loaded-beside">
      {{ props.item.beside }} {{ props.item.beside === 1 ? 'memory sat' : 'memories sat' }} beside
      it in this store as this session was launched — which the agent reads only if it chooses to.
    </p>

    <!-- ⚠️ **Only where something can act on it** — see {@link canOpenStore}. -->
    <button
      v-if="props.canOpenStore"
      class="ml-link"
      type="button"
      data-cy="memory-loaded-open-store"
      @click="emit('openInstructions')"
    >
      Where this profile keeps its memory
      <svg class="icon arrow"><use href="#i-arrow" /></svg>
    </button>
  </div>
</template>

<style scoped>
/* The same register as its two neighbours (`MemoryNoteEntry`, `MemoryRecallEntry`): heavier than a
   notice hairline, lighter than a card. This is a durable fact about the conversation and it is not
   asking for anything. */
.memory-loaded {
  max-width: var(--measure-message);
  margin: var(--space-9) 0;
  padding: var(--space-5) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
}

.ml-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.ml-head .icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--muted);
}

.ml-head strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.ml-head .time {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

/* ⛔ **The row's own weight, not the margin's** (601 §4.1). `--text-soft` is what `.ml-beside`
   below uses — the colour this row states facts in — while `.ml-sub` stays `--faint`, which is
   where a note ABOUT the row belongs. The two lines are the same size; what separates them is
   which one is content. */
.ml-by {
  margin: var(--space-4) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-sub {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-name {
  display: flex;
  align-items: baseline;
  margin-top: var(--space-5);
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.ml-in {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.ml-path {
  color: var(--faint);
  cursor: text;
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  user-select: all;
}

.ml-beside {
  margin: var(--space-4) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-link {
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

.ml-link:hover {
  text-decoration: underline;
}

.ml-link .arrow {
  width: 11px;
  height: 11px;
  color: var(--accent);
}
</style>
