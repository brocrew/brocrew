<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolAnswer } from '../../../shared/runtime-ipc'
import {
  answerAbsence,
  asPrettyJson,
  partDroppedNote,
  partHeading,
  partSizeNote,
  partsDroppedNote,
  rawAnswer,
  SHORT_FORM_KEPT,
} from '../lib/tool-answer'

/**
 * Show the complete tool answer the agent received.
 *
 * ## ⛔ Why this is a SECOND surface and not a longer row
 *
 * ⚠️ **`457` closed the "raise the bound" door with numbers rather than with an opinion.** The row's
 * summary is cut at `TOOL_SUMMARY_MAX` (200); a real list answer measured at `457` was **353
 * characters of prose and 3 691 of payload**, so the row carries the covers-sentence and not one
 * line of the list — which is `448`'s ruling working exactly as designed. ⛔ A bound big enough to carry
 * the payload *"puts a 4 KB blob on every tool row in the transcript, writes it to the ledger, and
 * clones it across IPC for the life of the session — and it still is not readable."*
 *
 * 🔴 **So the decision `462` §2.1 asks for is this: an OVERLAY, raised from the row, owned by the
 * pane** — and the argument is the one thing a person does with a tool answer, which is *read a list
 * and pick a row out of it*.
 *
 * | shape | why not |
 * |---|---|
 * | expanded in place | the transcript is `255`-virtualized and `--measure-message` wide; 150 lines of JSON inside a scroller inside a scroller is where a row goes to be unreadable, and every neighbouring row moves when it opens |
 * | a drawer tab | a drawer is about the CONVERSATION — its documents, its settings. This is about one row, and it has to be able to open from a row twelve screens back without becoming a place |
 * | `DocumentBody` whole | it renders MARKDOWN in its left view, and markdown-rendering a JSON payload mangles exactly the structure this exists to show |
 *
 * ⚑ **And the overlay was already the pane's answer to this question.** `ToolEntry` raises
 * `openOutput` and `openChild` rather than owning a viewer, with the reason written beside them —
 * *"an overlay is the pane's state"* — and `108`/`112` are the two surfaces that took it. This is
 * the third, and it borrows `ChildWorkViewer`'s chrome to the token.
 *
 * ## ⚠️ Readable/Raw, and the standing rule is kept rather than bent
 *
 * ⛔ **Every document viewer in this app is paper plus two views** — *"rendered to read, raw to
 * check what was actually written, and never a rendering you cannot get behind."* ⚑ `ChildWorkViewer`
 * already established that the LEFT segment names what is actually in the left pane rather than
 * always saying *Markdown*: it says `Transcript`, because that is what it draws. This says
 * `Readable`, because what it draws is the same characters with the indentation a person needs.
 *
 * ⚠️ **Nothing is hidden behind the formatter.** A part that is not JSON is shown exactly as it
 * arrived in BOTH views, and the Raw view is always one press away — see {@link asPrettyJson}.
 */
const props = defineProps<{
  /** The tool's own name, as the row shows it. */
  name: string
  /** What this app is holding for that call — `null` is a fact, and `absence` says which one. */
  answer: ToolAnswer | null
  /**
   * ⛔ **Whether this conversation could be asked at all** — `SessionLiveness.canReadToolAnswer`.
   *
   * ⚠️ It is a PROP rather than a second reading of `answer`, because `null` covers four states and
   * only one of them is *"this conversation is not running"* — which is the hole `462` §2.2 names
   * and the one a person most needs said out loud.
   */
  canAsk: boolean
  /**
   * ⚑ **685 · the row's own short form** — its receipt as the ledger kept it, or `null` when the row
   * has none. ⚠️ Drawn only under *not holding it*: where the whole answer is on screen, the short
   * form is a second, shorter copy of it.
   */
  shortForm?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const absence = computed(() => answerAbsence(props.answer, props.canAsk))
const parts = computed(() => props.answer?.parts ?? [])
const view = ref<'readable' | 'raw'>('readable')

/**
 * ⚠️ **Computed per part rather than per render**, and the `null` is what decides the FACE the part
 * is drawn in: monospace for characters that parse as JSON, the reading face for characters that do
 * not. ⛔ That is a statement about the bytes and never about which half of the answer a part is —
 * see {@link partHeading}, where the ordering makes that claim and nothing else does.
 */
const pretty = computed(() => parts.value.map((part) => asPrettyJson(part.text)))
const raw = computed(() => (props.answer === null ? '' : rawAnswer(props.answer)))
</script>

<template>
  <div class="tool-answer" data-cy="tool-answer-viewer">
    <header class="viewer-head">
      <strong class="name" data-cy="tool-answer-name">{{ name }}</strong>
      <span class="what">what it answered</span>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>

    <!-- ⛔ **The gap, DRAWN** (462 §2.2). These answers are memory held by a live adapter and
         nothing persists them, so a conversation reopened from the ledger has every row and none of
         what its tools said. ⚠️ A panel that showed an empty frame here would let a person believe
         they were seeing everything, which is the one outcome the brief rules out. -->
    <p v-if="absence" class="refusal" data-cy="tool-answer-absence">{{ absence }}</p>
    <!-- 🔴 **685 · …and what this app DOES still have for it** — see `SHORT_FORM_KEPT`. ⛔ Only under
         *not holding it* — `answer === null` where the conversation could be asked, the reopened
         case — and never under *the receipt carried no words*, whose row holds a placeholder word
         and not the receipt's (`685`'s review). A conversation that is not running never opens
         this panel (its row draws `ANSWER_NOT_HELD` instead). ⚠️ Outside the paper. -->
    <section
      v-if="props.answer === null && props.canAsk && props.shortForm"
      class="short-form"
      data-cy="tool-answer-short-form"
    >
      <p class="short-form-head">{{ SHORT_FORM_KEPT }}</p>
      <p class="short-form-body">{{ props.shortForm }}</p>
    </section>

    <template v-if="!absence">
      <div class="seg-bar">
        <span class="seg-group">
          <button
            class="seg"
            :class="{ on: view === 'readable' }"
            type="button"
            data-cy="tool-answer-view-readable"
            @click="view = 'readable'"
          >
            Readable
          </button>
          <button
            class="seg"
            :class="{ on: view === 'raw' }"
            type="button"
            data-cy="tool-answer-view-raw"
            @click="view = 'raw'"
          >
            Raw
          </button>
        </span>
      </div>
      <!-- `data-on-white` for `DocumentBody`'s reason, in its own words: a white island whatever the
           theme, and deliberately NOT a second `data-chat-theme` carrier (091). -->
      <div class="stage" :data-view="view">
        <div class="paper" data-on-white data-cy="tool-answer-paper">
          <template v-if="view === 'readable'">
            <section
              v-for="(part, index) in parts"
              :key="index"
              class="part"
              :data-cy="`tool-answer-part-${index}`"
            >
              <p class="part-head">
                <span :data-cy="`tool-answer-heading-${index}`">{{
                  partHeading(index, parts.length)
                }}</span>
                <span class="size" :data-cy="`tool-answer-size-${index}`">{{
                  partSizeNote(part)
                }}</span>
              </p>
              <!-- ⚠️ Two faces, one rule: characters that parse as JSON get the monospace block and
                   the indentation, everything else gets the reading face and its own line breaks. -->
              <pre
                v-if="pretty[index] !== null"
                class="part-body json"
                :data-cy="`tool-answer-body-${index}`"
                >{{ pretty[index] }}</pre>
              <pre v-else class="part-body words" :data-cy="`tool-answer-body-${index}`">{{
                part.text
              }}</pre>
              <!-- ⛔ **A COUNT, never an ellipsis** (092) — and it says the END is missing, which is
                   the opposite end from a command's tail and is stated rather than left to guess. -->
              <p v-if="part.dropped > 0" class="cut" :data-cy="`tool-answer-dropped-${index}`">
                {{ partDroppedNote(part.dropped) }}
              </p>
            </section>
            <p
              v-if="answer && answer.partsDropped > 0"
              class="cut"
              data-cy="tool-answer-parts-dropped"
            >
              {{ partsDroppedNote(answer.partsDropped) }}
            </p>
          </template>
          <!-- ⚠️ **"as the receipt carried them", and not "what the model received"** — `457`
               measured the two to be the same string on ONE provider, and `675` measured the other
               handing its model two blocks where this draws one joined string (685, `675` F-e); a
               claim true on one provider printed on a surface that draws both is 039's undisclosed
               asymmetry. -->
          <template v-else>
            <p class="part-head">
              <span data-cy="tool-answer-raw-heading">As the receipt carried it</span>
            </p>
            <pre class="part-body json" data-cy="tool-answer-raw">{{ raw }}</pre>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* `--drawer-solid` rather than `--panel` or `--paper-bg`, on `ChildWorkViewer`'s measured ruling:
   it already means "the opaque fill when something floats over the transcript", it has both theme
   values, and `--paper-bg` has no dark value and would put near-white header ink on white. */
/* ⛔ **`width` and not `max-width`, and that is a MEASUREMENT rather than a preference** (462, found
   by this dispatch's own dom test). `ChildWorkViewer` next door writes `max-width` and fills the
   room anyway, because a transcript's content is wide. This panel's content is a `<pre>` with
   `overflow-wrap: anywhere`, whose max-content width is its longest LINE — and
   `JSON.stringify(…, 2)` produces short lines. ⚠️ Measured inside `OverlayHost`'s flex centring at a
   1200 px viewport: **400 px**, against the 900 it is allowed. A panel that shrink-wraps to 400 px
   is the row's problem again in a bigger box, so the width is stated. */
.tool-answer {
  display: flex;
  width: min(900px, 92vw);
  max-height: 88vh;
  flex-direction: column;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--drawer-solid);
}

.viewer-head {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.name {
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.what {
  color: var(--faint);
  font-size: var(--type-caption);
}

.icon-button {
  margin-left: auto;
}

.seg-bar {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
}

.seg-group {
  display: inline-flex;
  padding: var(--space-1);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-seg-group);
  background: var(--wash-2);
}

.seg {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-seg);
  background: transparent;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.seg:hover {
  color: var(--text-soft);
}

/* `--accent-ink` on `--accent`, and NOT `--badge-ink` — the trap `DocumentBody`'s identical control
   records: this is ink on a solid accent fill, not a badge. */
.seg.on {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

/* ⛔ **The stage is the ONE scroller** (462, measured while building it). An answer is a document a
   person scrolls; two nested scrollers make the wheel land on whichever one the pointer happens to
   be over, which is the thing `255` already costs this app one level up. The paper grows and this
   clips it. */
.stage {
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.paper {
  padding: var(--space-6);
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-paper);
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
  color: var(--paper-ink);
  /* `scrollbar-color` inherits as an ALREADY-SUBSTITUTED value, so an ancestor's dark thumb would
     ride onto white paper — `DocumentBody` records the measurement. Re-declared inside the island so
     the var resolves here, and inherited by the wide `pre` below, which is what actually scrolls. */
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.part + .part {
  margin-top: var(--space-7);
  padding-top: var(--space-6);
  border-top: var(--border-width) solid var(--paper-line);
}

.part-head {
  display: flex;
  margin: 0 0 var(--space-4);
  color: var(--paper-muted);
  font: var(--fw-heavy) var(--type-caption) / 1 var(--font-mono);
  gap: var(--space-4);
  letter-spacing: var(--tracking-label);
}

.size {
  margin-left: auto;
  font-weight: var(--fw-semibold);
}

.part-body {
  margin: 0;
  color: var(--paper-ink2);
  white-space: pre-wrap;
}

/* ⛔ **`overflow-wrap: anywhere` and not `overflow-x: auto`.** A payload's long values are URLs and
   slugs with no break opportunity in them; a horizontal scroller inside the one the stage already
   owns is the second scroller the stage's own note refuses. Wrapping keeps every character
   reachable with the wheel a person is already using. */
.part-body.json {
  font: var(--type-caption) / 1.6 var(--font-mono);
  overflow-wrap: anywhere;
}

/* The words a tool wrote for a person, in the face a person reads — `.tool-body.ended`'s own split
   one surface over, for the same reason: prose about what happened is not output. */
.part-body.words {
  font: var(--type-small) / 1.65 var(--font-sans);
}

.cut {
  margin: var(--space-4) 0 0;
  color: var(--paper-muted);
  font-size: var(--type-caption);
}

.refusal {
  margin: 0;
  padding: var(--space-6) var(--space-5);
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚑ **685 · the row's short form, in the panel's own register and OFF the paper** — the paper is
   where a whole answer is drawn, and this is not one. */
.short-form {
  padding: 0 var(--space-5) var(--space-6);
}

.short-form-head {
  margin: 0 0 var(--space-3);
  color: var(--muted);
  font: var(--fw-heavy) var(--type-caption) / 1 var(--font-mono);
  letter-spacing: var(--tracking-label);
}

.short-form-body {
  margin: 0;
  color: var(--text);
  font-size: var(--type-caption);
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
