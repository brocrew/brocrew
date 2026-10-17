<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { MemoryRecallItem, TranscriptItem } from '../lib/transcript'

/**
 * 🔴 **What the agent said it read out of its memory, said where it happened** (319 §1, friction F5).
 *
 * Memory recall appears as a field on the message item rather than a separate memory tool type. Render its file, line range and usage note from that field.
 *
 * ## ⛔ The sentence, and why every clause is load-bearing
 *
 * *"The provider reported this with the reply — the agent's own account of what it used, not a tool
 * call."*
 *
 *  - **The provider reported this** — the opposite provenance from {@link MemoryNoteEntry}, which
 *    had to say *"seen on disk"* because nothing on any wire told BroBot a note had been written.
 *    This one really was published, on `agentMessage.memoryCitation`, and saying so is the stronger
 *    claim 318's careful wording left room for (319 §1.4).
 *  - **the agent's own account** — ⚠️ **and this is the clause that keeps it honest.** What the
 *    app-server structured is the model's own citation block, parsed out of the end of its reply.
 *    Nothing watched a file being opened. `009`'s rule is that a disclosure must not say we saw what
 *    we were only told, so the verb on screen is *cited* and never *read*.
 *  - **not a tool call** — there is none, and 316 stands on that half. A row that read as a reported
 *    call would be inventing a wire fact, which is `305`'s defect.
 *
 * ## ⚠️ The paths are DRAWN and never opened
 *
 * Every string in this row was written by the model, in prose. The provider instructs it to cite
 * *"file paths relative to the memory base path"* and never workspace files — an instruction, which
 * is a thing a model can get wrong. ⛔ So there is no button here, nothing resolves a path against a
 * home, and nothing reads one. The affordance for *"where does this profile keep its memory"* is the
 * instructions panel, which 317 built and 318 linked from the row next door.
 *
 * ## ⚑ Deliberately the same icon and weight as its neighbour
 *
 * 319 §1.4 asks that the two memory rows sit together rather than compete. They are the write and
 * the read of one store, so the family is drawn once and the DIFFERENCE is carried in words — which
 * is the half a reader can actually check.
 */
const props = defineProps<{
  item: MemoryRecallItem & Pick<TranscriptItem, 'at'>
}>()

/**
 * ⛔ **Both numbers or no range** (074). The wire already refuses a half range and a reversed one,
 * so this is the second gate rather than the first — and it is here because a REPLAYED row from a
 * build whose rules differed reaches this component without passing the adapter again.
 */
function lines(entry: MemoryRecallItem['entries'][number]): string | null {
  if (entry.lineStart === undefined || entry.lineEnd === undefined) return null
  return entry.lineStart === entry.lineEnd
    ? `line ${entry.lineStart}`
    : `lines ${entry.lineStart}–${entry.lineEnd}`
}

/**
 * ⚠️ **A COUNT, never the ids** — 319 §1.2, and the count is the whole of what can be said.
 *
 * These are ids of earlier Codex sessions the model transcribed out of its own memory files. The
 * provider's instruction calls the entries above *"for rendering"* and calls this list *"for us to
 * track"*; the ids are copied by the model rather than minted by the app-server, so a mistyped one
 * is indistinguishable from a real one; and nothing in this app can turn one into a conversation a
 * person would recognise — that means reading the profile's `sessions/` store, which is a capability
 * and a separate dispatch. ⛔ A raw UUID on screen would be `106`: something that looks like a handle
 * and that nothing can open.
 */
const earlier = computed(
  () => (props.item.threadIds?.length ?? 0) + (props.item.threadsDropped ?? 0),
)
</script>

<template>
  <div class="memory-recall" data-cy="memory-recall">
    <div class="mr-head">
      <svg class="icon"><use href="#i-file" /></svg>
      <strong data-cy="memory-recall-heading">
        {{
          props.item.entries.length === 1
            ? 'The agent cited a memory file for this answer'
            : `The agent cited ${props.item.entries.length} memory files for this answer`
        }}
      </strong>
      <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
    </div>

    <!-- ⛔ **The provenance, stated before the content** — the mirror of the line its neighbour
         draws, and deliberately a different one. See the component note for every clause. -->
    <p class="mr-sub" data-cy="memory-recall-provenance">
      The provider reported this with the reply — the agent’s own account of what it used, not a
      tool call.
    </p>

    <!-- ⚠️ **Keyed by INDEX, and that is a ruling rather than laziness** (found reviewing this
         diff). The obvious key is the path and its range — and the provider does not forbid the
         model citing one file twice, so two identical keys are reachable from a real reply and Vue
         patches the wrong node for them. This list is built once per event and never reordered or
         filtered, which is exactly the case an index key is correct for. -->
    <div
      v-for="(entry, index) in props.item.entries"
      :key="index"
      class="mr-entry"
      data-cy="memory-recall-row"
    >
      <div class="mr-name">
        <!-- Selectable, like every path in this app. ⚠️ It is RELATIVE to the profile's memory base
             path — the provider's own convention — so it is shown as the agent wrote it and is not
             joined to a home this row would have to guess at. -->
        <span class="mr-file">{{ entry.path }}</span>
        <!-- ⛔ No range where the provider gave no usable one (074). -->
        <span v-if="lines(entry)" class="mr-lines" data-cy="memory-recall-lines">{{
          lines(entry)
        }}</span>
      </div>
      <!-- ⚑ **The note is the part that makes the row worth drawing** (319 §1.1): a row saying only
           *"the agent used memory"* throws away the reason a person cares. It is the model's own
           words, quoted rather than paraphrased. -->
      <p v-if="entry.note" class="mr-note" data-cy="memory-recall-note">“{{ entry.note }}”</p>
    </div>

    <!-- A cap that can never be silent (092 §4), the same wording its neighbour uses. -->
    <p v-if="props.item.dropped" class="mr-aside" data-cy="memory-recall-dropped">
      {{ props.item.dropped }} more {{ props.item.dropped === 1 ? 'file was' : 'files were' }} cited
      and {{ props.item.dropped === 1 ? 'is' : 'are' }} not listed here.
    </p>

    <!-- ⚠️ **The count, and the reason it is only a count** — see {@link earlier}. It says what was
         named and says plainly that this app cannot name it, which is the honest ceiling on a list
         the provider itself does not offer for rendering. -->
    <p v-if="earlier > 0" class="mr-aside" data-cy="memory-recall-earlier">
      It also named {{ earlier }} earlier {{ earlier === 1 ? 'session' : 'sessions' }} of its own —
      BroCrew does not read those, so it cannot say which.
    </p>
  </div>
</template>

<style scoped>
/* The same register as `MemoryNoteEntry`: heavier than a notice hairline, lighter than a card. The
   two memory rows are a pair and a reader should recognise the second from having seen the first. */
.memory-recall {
  max-width: var(--measure-message);
  margin: var(--space-9) 0;
  padding: var(--space-5) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
}

.mr-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.mr-head .icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--muted);
}

.mr-head strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.mr-head .time {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.mr-sub {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.mr-entry {
  margin-top: var(--space-5);
}

.mr-name {
  display: flex;
  align-items: baseline;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.mr-file {
  cursor: text;
  overflow-wrap: anywhere;
  user-select: all;
}

.mr-lines {
  color: var(--muted);
  flex: none;
}

.mr-note {
  margin: var(--space-3) 0 0;
  padding-left: var(--space-4);
  border-left: var(--border-accent-width) solid var(--line-strong);
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* The same italic register `MemoryNoteEntry` uses for what it is NOT showing. */
.mr-aside {
  margin: var(--space-3) 0 0;
  color: var(--waiting);
  font-size: var(--type-caption);
  font-style: italic;
  line-height: 1.5;
}
</style>
