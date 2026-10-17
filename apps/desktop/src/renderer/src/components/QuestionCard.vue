<script setup lang="ts">
import { MOVE_IT, DO_IT_HERE } from '../../../shared/move-request'
/**
 * # 🔴 UI-009 · A question this app asked, as a card a person answers
 *
 * Show question details and answer controls both in the queue and where the question appears in the conversation.
 *
 * ⚑ **One card, two frames** — the conversation draws it on the call that asked (`OutgoingEntry`),
 * *Waiting on you* on the question's row (`PersonsQueue`). ⛔ It owns no frame and decides no word:
 * `question-card.ts` reads the question; this draws the reading and hands an answer up.
 *
 * - **A press answers** a one-part question with choices; anything else (several parts, several
 *   choices, or none) is chosen and typed, then sent with one *Send*.
 * - **The box** takes a person's own words wherever the part takes them — a question asked with no
 *   options, or one whose asker allows an answer off the list. Enter sends; Shift+Enter is a new line.
 * - ⛔ **Nothing blank is sent** (`answerOf`), and nothing is offered twice: the presses go quiet the
 *   moment one is pressed, and come back only with the host's words for why it did not land.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import type { UserInputResponse } from '../../../shared/runtime-ipc'
import type { RequestDraft } from '../lib/session-record'
import { BODY_WAS_CUT } from '../lib/outgoing-card'
import {
  ADDED_BESIDE,
  ANSWER_EACH_PART,
  LESS,
  MORE,
  PICK_AT_LEAST_ONE,
  PICK_SEVERAL,
  QUESTION_STATE_WORD,
  SEND,
  TYPE_YOUR_ANSWER,
  TYPE_YOUR_OWN,
  WORDS_NOT_FOUND,
  answerOf,
  answersAtOnePress,
  oneAnswer,
  pick,
  pickedOf,
  setTyped,
  typedOf,
  type QuestionCardReading,
  type QuestionPart,
  type QuestionState,
} from '../lib/question-card'
import { escaped } from '../lib/named-in-a-reply'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import PathsInText from './PathsInText.vue'
import MarkdownWords from './MarkdownWords.vue'

const props = defineProps<{
  reading: QuestionCardReading
  markdown?: boolean
  /** The outer exchange heading already names the recipient. */
  withoutRecipient?: boolean
  /**
   * ⚑ **Where the typed words and the in-flight mark live** — the session record's draft in the
   * conversation (`TranscriptView.draftFor`), so they outlive a remount. Absent: the card keeps its own.
   */
  draft?: RequestDraft
  /** ⚑ **Fold the words after a few lines, with *more*** — the queue, where rows sit side by side. */
  fold?: boolean
  /** The asking conversation's paths. Absent: a path in the question stays plain text. */
  paths?: PathsHere | null
}>()

/** The question's words and each part's prompt; an option's words sit inside its button. */
const paths = usePathsIn(
  () => props.paths,
  () =>
    [props.reading.words ?? '', ...props.reading.parts.map((part) => part.prompt ?? '')].map(
      escaped,
    ),
)

const emit = defineEmits<{
  /** ⛔ Emitted, never performed — the frame's surface sends it. */
  answer: [response: UserInputResponse]
  move: [decision: 'move' | 'here']
  openConversation: [sessionId: string]
}>()

const ownDraft = reactive<RequestDraft>({
  answers: new Map(),
  sent: false,
  answered: false,
  open: false,
})
const draft = computed(() => props.draft ?? ownDraft)

/** ⚑ How it stands — the record's in-flight mark makes an open question *answer sent*. */
const moving = ref(false)
const state = computed<QuestionState>(() =>
  props.reading.state === 'open' && (draft.value.sent || moving.value)
    ? 'sending'
    : props.reading.state,
)
/** ⚑ The presses and the box are drawn — answerable here, and not closed. */
const live = computed(
  () => props.reading.answerable && (state.value === 'open' || state.value === 'sending'),
)
/** ⚑ …and live — nothing is on its way. */
const open = computed(() => live.value && state.value === 'open')
const onePress = computed(() => answersAtOnePress(props.reading.parts))
const complete = computed(() => answerOf(props.reading.parts, draft.value.answers) !== null)
/** ⚑ *Send* — always beside several parts or choices; beside a one-press question once words are typed. */
const showSend = computed(
  () => props.reading.move === undefined && live.value && (!onePress.value || complete.value),
)
/** ⚑ **Why *Send* is off**, while it is — each of several parts, or one pick of several. */
const hint = computed(() => {
  if (!open.value || complete.value) return null
  if (props.reading.parts.length > 1) return ANSWER_EACH_PART
  return props.reading.parts[0]?.multiSelect === true ? PICK_AT_LEAST_ONE : null
})

/** Ids this card's labels hang on; one card to a page can share part ids with another. */
const idBase = useId()
const wordsId = `${idBase}-words`
const askId = (index: number): string => `${idBase}-ask-${index}`
/** The ask line is drawn when the part has a header, a prompt, or says it takes several. */
function asks(part: QuestionPart): boolean {
  return Boolean(part.header || part.prompt || (live.value && part.multiSelect))
}
/** What names a part's own box: its ask line, else the question's words it shares them with. */
function boxLabel(part: QuestionPart, index: number): string | undefined {
  if (asks(part)) return askId(index)
  return props.reading.words !== null && !props.reading.wordsMissing ? wordsId : undefined
}

/** ⚑ Lit by a press only — words typed in the box are the box's, whatever they spell. */
function chosen(part: QuestionPart, label: string): boolean {
  return pickedOf(part, draft.value.answers).includes(label)
}

function move(decision: 'move' | 'here'): void {
  if (!open.value) return
  moving.value = true
  emit('move', decision)
}
watch(
  () => [props.reading.state, props.reading.refused, draft.value.sent] as const,
  ([state, refused, sent], [, , wasSent]) => {
    if (state !== 'open' || refused !== null || (wasSent && !sent)) moving.value = false
  },
)

function press(part: QuestionPart, label: string): void {
  if (!open.value) return
  if (onePress.value) {
    emit('answer', oneAnswer(part, label))
    return
  }
  pick(part, draft.value.answers, label)
}

function type(part: QuestionPart, text: string): void {
  setTyped(part, draft.value.answers, text)
}

function send(): void {
  if (!open.value) return
  // ⚑ Built at the press, from the draft's own strings — never a proxied list.
  const response = answerOf(props.reading.parts, draft.value.answers)
  if (response !== null) emit('answer', response)
}

/** ⚑ Enter sends what is ready; Shift+Enter is a new line. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  send()
}

/* ⚑ **The fold** — the words clamp to four lines, and *more* is drawn only when they overflow or
   something was added beside them; the options and the box are never folded. */
const wordsEl = ref<HTMLElement | null>(null)
const unfolded = ref(false)
const overflows = ref(false)
const folded = computed(() => props.fold === true && !unfolded.value)
const foldable = computed(
  () =>
    props.fold === true && (unfolded.value || overflows.value || props.reading.context !== null),
)
function measure(): void {
  const el = wordsEl.value
  if (!folded.value || el === null) return
  overflows.value = el.scrollHeight > el.clientHeight + 1
}
function toggle(): void {
  unfolded.value = !unfolded.value
  if (!unfolded.value) void nextTick(measure)
}
let watcher: ResizeObserver | null = null
// ⚑ **Watched whenever the words appear, not only at mount** — a queue row can draw *its words are
// in its conversation* first and the words a look later, and a narrowing after that must still
// bring *more* (F4).
watch(
  wordsEl,
  (el) => {
    watcher?.disconnect()
    watcher = null
    if (props.fold !== true || el === null) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    watcher = new ResizeObserver(measure)
    watcher.observe(el)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => watcher?.disconnect())
watch(
  () => props.reading.words,
  () => void nextTick(measure),
)
</script>

<template>
  <section
    class="question-card"
    data-cy="question-card"
    :data-state="state"
    :data-request-id="props.reading.requestId ?? undefined"
    @click="paths.clicked"
  >
    <header class="question-head" data-cy="question-head">
      <svg class="icon" aria-hidden="true"><use href="#i-question" /></svg>
      <strong class="who"
        ><span data-cy="question-asker">{{ props.reading.asker }}</span>
        <template v-if="!withoutRecipient"
          >{{ ' ' + props.reading.verb + ' ' }}
          <span data-cy="question-asked-of">{{ props.reading.askedOf }}</span></template
        ></strong
      >
      <strong v-if="props.reading.piece" class="piece" data-cy="question-piece">{{
        props.reading.piece
      }}</strong>
      <span
        v-if="QUESTION_STATE_WORD[state]"
        class="state"
        :class="{ failed: state === 'failed' }"
        data-cy="question-state"
        >{{ QUESTION_STATE_WORD[state] }}</span
      >
      <span v-if="props.reading.answeredBy" class="state" data-cy="question-answered">{{
        props.reading.answeredBy
      }}</span>
      <span v-if="props.reading.at" class="time" :title="props.reading.atTitle ?? undefined">{{
        props.reading.at
      }}</span>
    </header>
    <p v-if="props.reading.via" class="via" data-cy="question-via">{{ props.reading.via }}</p>

    <p v-if="props.reading.wordsMissing" class="not-here" data-cy="question-not-here">
      {{ WORDS_NOT_FOUND }}
    </p>
    <div
      v-else-if="props.reading.words !== null"
      :id="wordsId"
      ref="wordsEl"
      class="words"
      :class="{ folded }"
      data-cy="question-words"
      :data-folded="String(folded)"
    >
      <MarkdownWords v-if="markdown" :text="props.reading.words" :found="paths" />
      <PathsInText v-else :text="props.reading.words" :found="paths" />
    </div>
    <p
      v-if="paths.failure.value"
      class="message-path-failure"
      role="status"
      data-cy="message-path-failure"
    >
      {{ paths.failure.value }}
    </p>
    <!-- ⛔ A cut body SAYS it was cut, in words and outside the words' box (`678`). -->
    <p v-if="props.reading.wordsAreCut" class="aside" data-cy="question-cut">{{ BODY_WAS_CUT }}</p>
    <!-- ⚑ What the conversation that passed it up added — beside the words, never instead. -->
    <component
      :is="markdown ? 'div' : 'p'"
      v-if="props.reading.context && !folded"
      class="aside"
      data-cy="question-context"
    >
      <span class="lead">{{ ADDED_BESIDE }}</span
      >{{ ' ' }}
      <MarkdownWords v-if="markdown" :text="props.reading.context" />
      <template v-else>{{ props.reading.context }}</template>
    </component>
    <button
      v-if="foldable"
      class="more"
      type="button"
      data-cy="question-more"
      :aria-expanded="!folded"
      @click="toggle"
    >
      {{ folded ? MORE : LESS }}
    </button>

    <p v-if="props.reading.move && !props.reading.movedTo" data-cy="move-offer">
      This fits {{ props.reading.move.destinationName }}. Move it there, or do it here?
    </p>
    <div v-if="props.reading.move && live" class="options" data-cy="move-actions">
      <button type="button" data-cy="move-it" :disabled="!open" @click="move('move')">
        {{ moving ? 'Moving…' : MOVE_IT }}
      </button>
      <button type="button" data-cy="do-it-here" :disabled="!open" @click="move('here')">
        {{ DO_IT_HERE }}
      </button>
    </div>
    <MarkdownWords
      v-if="props.reading.movedTo?.receiptLine"
      :text="props.reading.movedTo.receiptLine"
      data-cy="moved-to"
    />
    <button
      v-else-if="props.reading.movedTo"
      type="button"
      data-cy="moved-to"
      @click="emit('openConversation', props.reading.movedTo.sessionId)"
    >
      Moved to {{ props.reading.move?.destinationName }}.
    </button>
    <template v-for="(part, index) in props.reading.move ? [] : props.reading.parts" :key="index">
      <!-- ⚑ A part with nothing to show — its words are the question's, and it offers no choice and
           no box here — draws nothing, so a one-part free-form question says its words once. -->
      <div
        v-if="part.header || part.prompt || part.options.length > 0 || (live && part.typed)"
        class="part"
        :data-cy="`question-part-${part.id}`"
      >
        <component :is="markdown ? 'div' : 'p'" v-if="asks(part)" :id="askId(index)" class="ask">
          <span v-if="part.header" class="header">{{ part.header }}</span
          >{{ ' '
          }}<MarkdownWords v-if="markdown && part.prompt" :text="part.prompt" :found="paths" />
          <PathsInText v-else :text="part.prompt ?? ''" :found="paths" />{{ ' '
          }}<span v-if="live && part.multiSelect" class="mode">{{ PICK_SEVERAL }}</span>
        </component>
        <div
          v-if="live && part.options.length > 0"
          class="options"
          :class="{ described: part.options.some((option) => option.description) }"
        >
          <button
            v-for="option in part.options"
            :key="option.label"
            class="option"
            :class="{ selected: !onePress && chosen(part, option.label) }"
            type="button"
            :disabled="!open"
            :aria-pressed="part.multiSelect || !onePress ? chosen(part, option.label) : undefined"
            data-cy="question-option"
            :data-option="option.label"
            @click="press(part, option.label)"
          >
            <span class="label">
              <!-- A staged pick is marked by a tick as well as by colour. -->
              <svg
                v-if="!onePress && chosen(part, option.label)"
                class="icon tick"
                aria-hidden="true"
                data-cy="question-option-tick"
              >
                <use href="#i-check" />
              </svg>
              {{ option.label }}
            </span>
            <span v-if="option.description" class="describe">{{ option.description }}</span>
          </button>
        </div>
        <!-- ⚑ **Chips a person reads, not presses** — a question this surface does not answer, or one
           that is over. -->
        <ul v-else-if="part.options.length > 0" class="chips">
          <li
            v-for="option in part.options"
            :key="option.label"
            class="chip"
            data-cy="question-option"
            :data-option="option.label"
          >
            {{ option.label }}
          </li>
        </ul>
        <template v-if="live && part.typed">
          <!-- ⚑ A secret part's words are masked as they are typed, and never echoed. -->
          <input
            v-if="part.secret"
            class="box"
            type="password"
            data-cy="question-box"
            :aria-labelledby="boxLabel(part, index)"
            :value="typedOf(part, draft.answers)"
            :disabled="!open"
            :placeholder="part.options.length > 0 ? TYPE_YOUR_OWN : TYPE_YOUR_ANSWER"
            @input="type(part, ($event.target as HTMLInputElement).value)"
            @keydown="onKey"
          />
          <textarea
            v-else
            class="box"
            rows="1"
            data-cy="question-box"
            :aria-labelledby="boxLabel(part, index)"
            :value="typedOf(part, draft.answers)"
            :disabled="!open"
            :placeholder="part.options.length > 0 ? TYPE_YOUR_OWN : TYPE_YOUR_ANSWER"
            @input="type(part, ($event.target as HTMLTextAreaElement).value)"
            @keydown="onKey"
          ></textarea>
        </template>
      </div>
    </template>

    <p v-if="hint !== null" class="aside" data-cy="question-hint">{{ hint }}</p>
    <!-- ⛔ **The answer bounced and the question is still there** — the host's words, above the
         presses that are live again. -->
    <p v-if="props.reading.refused && open" class="aside" data-cy="question-refused">
      {{ props.reading.refused }}
    </p>
    <button
      v-if="showSend"
      class="send"
      type="button"
      data-cy="question-send"
      :disabled="!open || !complete"
      @click="send"
    >
      {{ SEND }}
    </button>
    <p v-if="props.reading.note" class="aside" data-cy="question-note">
      {{ props.reading.note }}
    </p>
    <p
      v-if="props.reading.receipt !== null"
      class="aside"
      :class="{ failed: state === 'failed' }"
      data-cy="question-receipt"
    >
      {{ props.reading.receipt }}
    </p>
    <button
      v-if="props.reading.where"
      class="press"
      type="button"
      data-cy="question-where"
      :data-held="String(props.reading.where.held)"
      @click="emit('openConversation', props.reading.where.conversation)"
    >
      {{ props.reading.where.action }}
    </button>
  </section>
</template>

<style scoped>
.question-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-6);
}

.question-head {
  display: flex;
  min-height: 20px;
  flex-wrap: wrap;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2) var(--space-4);
}

.question-head .icon {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
}

.who {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.piece {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.state {
  color: var(--faint);
  font-size: var(--type-caption);
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
}

.via,
.aside,
.not-here {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}

.lead {
  font-weight: var(--fw-bold);
}

.words {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.words.folded {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.more,
.press {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--type-caption);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.more:hover,
.more:focus-visible,
.press:hover,
.press:focus-visible {
  color: var(--text-soft);
  text-decoration-style: solid;
}

.part {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ask {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  white-space: pre-wrap;
}

.header {
  margin-right: var(--space-3);
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.mode {
  margin-left: var(--space-3);
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.option {
  min-height: var(--control-h);
  padding: var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  text-align: left;
}

.option:hover:not(:disabled),
.option.selected {
  border-color: var(--accent);
  background: var(--accent-fill);
  color: var(--accent-text);
}

.option:disabled {
  opacity: 0.6;
}

.options.described {
  flex-direction: column;
  align-items: stretch;
}

.option .label {
  display: block;
}

.option .tick {
  width: 11px;
  height: 11px;
  margin-right: var(--space-2);
  vertical-align: -1px;
}

.options.described .label {
  font-weight: var(--fw-semibold);
}

.option .describe {
  display: block;
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.option.selected .describe,
.option:hover:not(:disabled) .describe {
  color: var(--accent-text);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  padding: 0;
  margin: 0;
  gap: var(--space-2);
  list-style: none;
}

.chip {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.box {
  width: 100%;
  min-height: var(--control-h);
  max-height: calc(6 * var(--leading-normal) * 1em + 2 * var(--space-3));
  box-sizing: border-box;
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  field-sizing: content;
  font: inherit;
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
  resize: none;
}

.box:focus-visible {
  border-color: var(--accent);
}

.send {
  align-self: flex-start;
  min-height: var(--control-h);
  padding: var(--space-2) var(--space-6);
  border: var(--border-width) solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.send:disabled {
  opacity: 0.6;
}

.aside.failed,
.state.failed {
  color: var(--danger);
}
</style>
