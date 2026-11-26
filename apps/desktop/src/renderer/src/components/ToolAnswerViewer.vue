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
import type { ToolItem, TranscriptItem } from '../lib/transcript'
import ToolEntry from './ToolEntry.vue'
import DocumentViewerFrame from './DocumentViewerFrame.vue'
import SegmentedControl from './SegmentedControl.vue'
import PaperSheet from './PaperSheet.vue'
import MarkdownWords from './MarkdownWords.vue'
import type { PathsHere } from '../composables/useMessagePaths'

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
 * Prose uses the conversation’s `MarkdownWords` formatter. JSON keeps its indentation, and the
 * Raw view keeps the exact receipt one press away — see {@link asPrettyJson}.
 */
const props = defineProps<{
  /** The tool's own name, as the row shows it. */
  name: string
  /** Reuse the conversation’s existing path resolutions and open actions. */
  paths?: PathsHere | null
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
  /**
   * The call itself, drawn by `ToolEntry` with this answer in its `answer` slot. `null` for a call
   * with no tool row (one drawn as a card), where the panel shows the answer under the name alone.
   */
  call?: (ToolItem & Pick<TranscriptItem, 'at'>) | null
}>()

const emit = defineEmits<{ close: [] }>()

const absence = computed(() => answerAbsence(props.answer, props.canAsk))
const parts = computed(() => props.answer?.parts ?? [])
const view = ref<'readable' | 'raw'>('readable')
const VIEWS = [
  { value: 'readable', label: 'Readable', cy: 'tool-answer-view-readable' },
  { value: 'raw', label: 'Raw', cy: 'tool-answer-view-raw' },
] as const

/**
 * ⚠️ **Computed per part rather than per render**, and the `null` is what decides the FACE the part
 * is drawn in: monospace for characters that parse as JSON, the reading face for characters that do
 * not. ⛔ That is a statement about the bytes and never about which half of the answer a part is —
 * see {@link partHeading}, where the ordering makes that claim and nothing else does.
 */
const pretty = computed(() => parts.value.map((part) => asPrettyJson(part.text)))
const raw = computed(() => (props.answer === null ? '' : rawAnswer(props.answer)))

/** The call's own card with the answer in its `answer` slot, or the answer alone. */
const frame = computed(() =>
  props.call
    ? {
        is: ToolEntry,
        slot: 'answer',
        props: {
          item: props.call,
          paths: props.paths,
          opened: true,
          canOpenChild: false,
          canOpenOutput: false,
        },
      }
    : { is: 'div', slot: 'default', props: {} },
)
</script>

<template>
  <DocumentViewerFrame fill data-cy="tool-answer-viewer" @close="emit('close')">
    <template #head>
      <span class="what">what it answered</span>
    </template>

    <!-- ⛔ **The gap, DRAWN** (462 §2.2). These answers are memory held by a live adapter and
         nothing persists them, so a conversation reopened from the ledger has every row and none of
         what its tools said. ⚠️ A panel that showed an empty frame here would let a person believe
         they were seeing everything, which is the one outcome the brief rules out. -->
    <div class="stage">
      <component :is="frame.is" v-bind="frame.props">
        <template #[frame.slot]>
          <!-- A call with no tool row has no card to name it, so the answer says whose it is. -->
          <strong v-if="!props.call" class="name" data-cy="tool-answer-name">{{ name }}</strong>
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
            <MarkdownWords class="short-form-body" :text="props.shortForm" :paths="props.paths" />
          </section>

          <template v-if="!absence">
            <div class="seg-bar">
              <SegmentedControl v-model="view" :options="VIEWS" />
            </div>
            <!-- `data-on-white` for `DocumentBody`'s reason, in its own words: a white island whatever the
                 theme, and deliberately NOT a second `data-chat-theme` carrier (091). -->
            <div class="view" :data-view="view">
              <PaperSheet data-cy="tool-answer-paper">
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
                    <!-- JSON stays data; prose uses the same Markdown component as the conversation. -->
                    <pre
                      v-if="pretty[index] !== null"
                      class="part-body json"
                      :data-cy="`tool-answer-body-${index}`"
                      >{{ pretty[index] }}</pre>
                    <MarkdownWords
                      v-else
                      class="part-body words"
                      :data-cy="`tool-answer-body-${index}`"
                      :text="part.text"
                      :paths="props.paths"
                    />
                    <!-- ⛔ **A COUNT, never an ellipsis** (092) — and it says the END is missing, which is
                         the opposite end from a command's tail and is stated rather than left to guess. -->
                    <p
                      v-if="part.dropped > 0"
                      class="cut"
                      :data-cy="`tool-answer-dropped-${index}`"
                    >
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
              </PaperSheet>
            </div>
          </template>
        </template>
      </component>
    </div>
  </DocumentViewerFrame>
</template>

<style scoped>
.name {
  display: block;
  margin-bottom: var(--space-4);
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

.seg-bar {
  display: flex;
  justify-content: flex-end;
}

.stage > .tool-entry {
  max-width: none;
  margin: 0;
}

.view {
  padding: var(--space-4) 0 0;
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
