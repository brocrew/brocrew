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
import type { RequestDraft, TakenWithoutThisWindow } from '../lib/session-record'
import type { TranscriptItem, UserInputItem } from '../lib/transcript'
import { inTheAgentsWords } from '../lib/permission-offer'
import { escaped } from '../lib/named-in-a-reply'
import {
  ANSWERED_IN_THE_OTHER_WINDOW,
  ANSWERED_ONCE_A_WINDOW_TAKES_IT,
  TAKE_IT_OVER_TO_ANSWER_HERE,
} from '../lib/taking-over'
import {
  WHAT_COMES_AFTER_IS_NOT_OURS,
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
} from '../lib/user-input-offer'
import { BODY_WAS_CUT } from '../lib/outgoing-card'
import {
  ADDED_BESIDE,
  ANSWER_EACH_PART,
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
  providerQuestion,
  setTyped,
  typedOf,
  type QuestionCardReading,
  type QuestionPart,
  type QuestionState,
} from '../lib/question-card'
import { useClientMessagePaths, usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import PathsInText from './PathsInText.vue'
import MarkdownWords from './MarkdownWords.vue'
import FileRows from './FileRows.vue'

const props = defineProps<{
  reading?: QuestionCardReading
  item?: UserInputItem & Partial<Pick<TranscriptItem, 'at'>>
  ownAgent?: string | null
  takenWithoutThisWindow?: TakenWithoutThisWindow | null
  compact?: boolean
  choicesOnly?: boolean
  queueOffers?: readonly AttentionDecision[]
  queueSent?: boolean
  readOnly?: boolean
  /** The outer exchange heading already names the recipient. */
  withoutRecipient?: boolean
  withoutFiles?: boolean
  canOpenDocument?: boolean
  /**
   * ⚑ **Where the typed words and the in-flight mark live** — the session record's draft in the
   * conversation (`TranscriptView.draftFor`), so they outlive a remount. Absent: the card keeps its own.
   */
  draft?: RequestDraft
  /** ⚑ **Fold the words after a few lines, with *more*** — the queue, where rows sit side by side. */
  fold?: boolean
  /** The conversation's path context, when supplied by its frame. */
  paths?: PathsHere | null
  /** Queue cards resolve paths in their asking conversation. */
  pathSessionId?: string
  addedContext?: string | null
  inlineQueueChoices?: boolean
  hideChoiceEffects?: boolean
}>()

const queuePaths = useClientMessagePaths(
  () => props.pathSessionId ?? null,
  () => !props.paths && !!props.pathSessionId,
)

const emit = defineEmits<{
  /** Emitted through the existing door for each answering surface. */
  respond: [requestId: string, response: UserInputResponse]
  takeItOver: []
  answer: [response: UserInputResponse]
  move: [decision: 'move' | 'here']
  openConversation: [sessionId: string]
  openDocument: [resourceId: string]
}>()

const ownDraft = reactive<RequestDraft>({
  answers: new Map(),
  sent: false,
  answered: false,
  open: false,
})
const draft = computed(() => props.draft ?? ownDraft)

/** ⚑ How it stands — the record's in-flight mark makes an open question *answer sent*. */
const reading = computed(
  () =>
    props.reading ?? {
      ...providerQuestion(props.item!, props.ownAgent ?? null, !props.readOnly),
      context: props.addedContext ?? null,
    },
)
const waitingElsewhere = computed(
  () =>
    props.item !== undefined &&
    props.takenWithoutThisWindow != null &&
    reading.value.state === 'open',
)
const offer = computed(() => props.item && userInputOffer(props.item.request))
const shortcuts = computed(() => props.queueOffers !== undefined)
const rejectsHere = computed(
  () => props.queueOffers?.some((decision) => decision.kind === 'reject') ?? true,
)
const grant = computed(() => props.item?.request.permission)
const grantPaths = usePathsIn(
  () => props.paths ?? queuePaths.value,
  () => [grant.value?.cwd ?? '', ...(grant.value?.paths ?? [])].map(escaped),
)
const agentSays = computed(() => {
  const reason = grant.value?.agentReason
  return reason ? inTheAgentsWords(props.ownAgent ?? null, reason) : null
})
const verdict = computed(() => {
  if (reading.value.state === 'answered') return 'Answered'
  if (reading.value.state === 'declined') return 'Rejected'
  return reading.value.state === 'closed' ? 'Not answered' : 'Needs your answer'
})
const moving = ref(false)
const state = computed<QuestionState>(() =>
  reading.value.state === 'open' &&
  ((shortcuts.value ? props.queueSent : draft.value.sent) || moving.value)
    ? 'sending'
    : reading.value.state,
)
/** ⚑ The presses and the box are drawn — answerable here, and not closed. */
const live = computed(
  () =>
    reading.value.answerable &&
    !waitingElsewhere.value &&
    (state.value === 'open' || state.value === 'sending'),
)
/** ⚑ …and live — nothing is on its way. */
const open = computed(() => live.value && state.value === 'open')
const combinesChoiceAndWords = computed(() => {
  const parts = reading.value.parts
  return !props.item && !props.choicesOnly && answersAtOnePress(parts) && parts[0]?.typed === true
})
const onePress = computed(
  () =>
    !combinesChoiceAndWords.value &&
    (!props.item || shortcuts.value) &&
    answersAtOnePress(reading.value.parts),
)
const quickChoices = computed(
  () =>
    props.inlineQueueChoices === true &&
    onePress.value &&
    props.queueOffers?.some((decision) => decision.kind === 'answer') === true,
)
const response = computed<UserInputResponse | null>(() =>
  props.item && reading.value.parts.length === 0
    ? { kind: 'answer', answers: {} }
    : answerOf(reading.value.parts, draft.value.answers, props.item !== undefined),
)
const complete = computed(() => response.value !== null)
/** ⚑ *Send* — always beside several parts or choices; beside a one-press question once words are typed. */
const showSend = computed(() => {
  if (reading.value.move !== undefined || !live.value || props.choicesOnly) return false
  if (shortcuts.value)
    return props.queueOffers?.some((decision) => decision.kind === 'approve') ?? false
  return !onePress.value || complete.value
})
/** ⚑ **Why *Send* is off**, while it is — each of several parts, or one pick of several. */
const hint = computed(() => {
  if (!open.value || complete.value) return null
  if (reading.value.parts.length > 1) return ANSWER_EACH_PART
  return reading.value.parts[0]?.multiSelect === true ? PICK_AT_LEAST_ONE : null
})

/** Ids this card's labels hang on; one card to a page can share part ids with another. */
const idBase = useId()
const wordsId = `${idBase}-words`
const askId = (index: number): string => `${idBase}-ask-${index}`
/** The ask line is drawn when the part has a header, a prompt, or says it takes several. */
function asks(part: QuestionPart): boolean {
  return Boolean(part.header || part.prompt || (live.value && part.multiSelect))
}

function describesReadOnlyPart(part: QuestionPart): string {
  return [
    part.multiSelect ? 'takes several answers' : '',
    part.typed
      ? part.options.length === 0
        ? 'takes a typed answer'
        : 'also takes an answer of your own'
      : '',
    part.secret ? 'the answer is hidden' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
/** What names a part's own box: its ask line, else the question's words it shares them with. */
function boxLabel(part: QuestionPart, index: number): string | undefined {
  if (asks(part)) return askId(index)
  return reading.value.words !== null && !reading.value.wordsMissing ? wordsId : undefined
}

/** ⚑ Lit by a press only — words typed in the box are the box's, whatever they spell. */
function chosen(part: QuestionPart, label: string): boolean {
  return pickedOf(part, draft.value.answers).includes(label)
}

function queuedChoice(part: QuestionPart, label: string): AttentionDecision | undefined {
  return props.queueOffers?.find(
    (decision) =>
      decision.kind === 'answer' && decision.questionId === part.id && decision.option === label,
  )
}

function move(decision: 'move' | 'here'): void {
  if (!open.value) return
  moving.value = true
  emit('move', decision)
}
watch(
  () => [reading.value.state, reading.value.refused, draft.value.sent] as const,
  ([state, refused, sent], [, previousRefusal, wasSent]) => {
    if (
      state !== 'open' ||
      (refused !== null && refused !== previousRefusal) ||
      (wasSent && !sent)
    ) {
      moving.value = false
    }
  },
)

function submit(response: UserInputResponse): void {
  if (props.item) {
    if (!shortcuts.value) draft.value.sent = true
    emit('respond', props.item.request.id, response)
  } else {
    emit('answer', response)
  }
}

const boxHook = (part: QuestionPart): string =>
  !props.item
    ? 'question-box'
    : part.options.length > 0
      ? `user-input-other-${part.id}`
      : `user-input-answer-${part.id}`

function press(part: QuestionPart, label: string): void {
  if (!open.value || (shortcuts.value && !queuedChoice(part, label))) return
  if (onePress.value) {
    submit(props.item ? { kind: 'answer', answers: { [part.id]: label } } : oneAnswer(part, label))
    return
  }
  pick(part, draft.value.answers, label, combinesChoiceAndWords.value)
}

function type(part: QuestionPart, text: string): void {
  setTyped(part, draft.value.answers, text, combinesChoiceAndWords.value)
}

function send(): void {
  if (!open.value) return
  if (response.value !== null) submit(response.value)
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
    props.fold === true && (unfolded.value || overflows.value || reading.value.context !== null),
)
function measure(): void {
  const el = wordsEl.value?.querySelector<HTMLElement>('.md-chat')
  if (!folded.value || !el) return
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
  () => reading.value.words,
  () => void nextTick(measure),
)
</script>

<template>
  <section
    class="question-card"
    :class="{
      'queue-question': props.fold,
      compact,
      'choices-only': choicesOnly,
      'quick-choices': quickChoices,
      'provider-question': item && !fold,
    }"
    data-question-card
    :data-cy="item ? 'user-input-card' : 'question-card'"
    :data-verdict="item ? verdict : undefined"
    :data-state="state"
    :data-request-id="reading.requestId ?? undefined"
  >
    <header
      v-if="!choicesOnly && !shortcuts && !(compact && readOnly)"
      class="question-head"
      data-cy="question-head"
    >
      <svg class="icon" aria-hidden="true"><use href="#i-question" /></svg>
      <strong v-if="item" data-cy="user-input-verdict">{{ verdict }}</strong>
      <strong v-else class="who"
        ><span data-cy="question-asker">{{ reading.asker }}</span>
        <template v-if="!withoutRecipient"
          >{{ ' ' + reading.verb + ' ' }}
          <span data-cy="question-asked-of">{{ reading.askedOf }}</span></template
        ></strong
      >
      <strong v-if="reading.piece" class="piece" data-cy="question-piece">{{
        reading.piece
      }}</strong>
      <span
        v-if="!item && QUESTION_STATE_WORD[state]"
        class="state"
        :class="{ failed: state === 'failed' }"
        data-cy="question-state"
        >{{ QUESTION_STATE_WORD[state] }}</span
      >
      <span v-if="!item && reading.answeredBy" class="state" data-cy="question-answered">{{
        reading.answeredBy
      }}</span>
      <span v-if="reading.at" class="time" :title="reading.atTitle ?? undefined">{{
        reading.at
      }}</span>
    </header>
    <p v-if="reading.via" class="via" data-cy="question-via">{{ reading.via }}</p>

    <p v-if="reading.wordsMissing" class="not-here" data-cy="question-not-here">
      {{ WORDS_NOT_FOUND }}
    </p>
    <div
      v-else-if="reading.words !== null"
      :id="wordsId"
      ref="wordsEl"
      class="words"
      :class="{ folded }"
      :data-cy="
        item ? 'user-input-prompt' : choicesOnly ? 'structured-question-text' : 'question-words'
      "
      :data-folded="String(folded)"
    >
      <MarkdownWords :text="reading.words" :paths="props.paths ?? queuePaths" />
    </div>
    <p
      v-if="grantPaths.failure.value"
      class="message-path-failure"
      role="status"
      data-cy="message-path-failure"
    >
      {{ grantPaths.failure.value }}
    </p>
    <MarkdownWords
      v-if="agentSays"
      class="aside"
      data-cy="user-input-agent-reason"
      :text="agentSays"
      :paths="props.paths ?? queuePaths"
    />
    <div v-if="grant" class="grant" data-cy="user-input-permission" @click="grantPaths.clicked">
      <MarkdownWords v-if="grant.reason" :text="grant.reason" :paths="props.paths ?? queuePaths" />
      <div v-if="grant.cwd">cwd: <PathsInText :text="grant.cwd" :found="grantPaths" /></div>
      <div v-for="path in grant.paths" :key="path">
        <PathsInText :text="path" :found="grantPaths" />
      </div>
      <div v-if="grant.network">network access requested</div>
    </div>
    <FileRows
      v-if="!withoutFiles && !item"
      :files="reading.files ?? []"
      :can-open="canOpenDocument ?? false"
      :paths="props.paths ?? queuePaths"
      @open-document="emit('openDocument', $event)"
    />
    <!-- ⛔ A cut body SAYS it was cut, in words and outside the words' box (`678`). -->
    <p v-if="reading.wordsAreCut" class="aside" data-cy="question-cut">{{ BODY_WAS_CUT }}</p>
    <!-- ⚑ What the conversation that passed it up added — beside the words, never instead. -->
    <div v-if="reading.context && !folded" class="aside" data-cy="question-context">
      <MarkdownWords
        :text="reading.context"
        :lead="ADDED_BESIDE"
        :paths="props.paths ?? queuePaths"
      />
    </div>
    <button
      v-if="foldable"
      class="more"
      type="button"
      data-cy="question-more"
      :aria-expanded="!folded"
      @click="toggle"
    >
      {{ folded ? 'Read full question' : 'Show less' }}
    </button>

    <p v-if="reading.move && !reading.movedTo" data-cy="move-offer">
      This fits {{ reading.move.destinationName }}. Move it there, or do it here?
    </p>
    <div v-if="reading.move && live" class="options" data-cy="move-actions">
      <button type="button" data-cy="move-it" :disabled="!open" @click="move('move')">
        {{ moving ? 'Moving…' : MOVE_IT }}
      </button>
      <button type="button" data-cy="do-it-here" :disabled="!open" @click="move('here')">
        {{ DO_IT_HERE }}
      </button>
    </div>
    <MarkdownWords
      v-if="reading.movedTo?.receiptLine"
      :text="reading.movedTo.receiptLine"
      data-cy="moved-to"
    />
    <button
      v-else-if="reading.movedTo"
      type="button"
      data-cy="moved-to"
      @click="emit('openConversation', reading.movedTo.sessionId)"
    >
      Moved to {{ reading.move?.destinationName }}.
    </button>
    <template v-for="(part, index) in reading.move ? [] : reading.parts" :key="index">
      <!-- ⚑ A part with nothing to show — its words are the question's, and it offers no choice and
           no box here — draws nothing, so a one-part free-form question says its words once. -->
      <div
        v-if="
          part.header || part.prompt || part.options.length > 0 || ((live || item) && part.typed)
        "
        class="part"
        :data-cy="
          item
            ? `user-input-question-${part.id}`
            : readOnly
              ? 'persons-queue-asked-part'
              : `question-part-${part.id}`
        "
        :data-multi-select="item ? String(part.multiSelect) : undefined"
      >
        <div v-if="asks(part)" :id="askId(index)" class="ask">
          <span
            v-if="part.header"
            class="header"
            :data-cy="item ? `user-input-header-${part.id}` : undefined"
            >{{ part.header }}</span
          >{{ ' '
          }}<MarkdownWords
            v-if="part.prompt"
            :text="part.prompt"
            :paths="props.paths ?? queuePaths"
          />{{ ' '
          }}<span
            v-if="(item || live) && part.multiSelect"
            class="mode"
            :data-cy="item ? `user-input-mode-${part.id}` : undefined"
            >{{ PICK_SEVERAL }}</span
          >
        </div>
        <div
          v-if="
            (live || item || choicesOnly) &&
            part.options.length > 0 &&
            (!shortcuts || part.options.some((option) => queuedChoice(part, option.label)))
          "
          class="options"
          :class="{ described: part.options.some((option) => option.description) }"
        >
          <div
            v-for="option in part.options"
            :key="option.label"
            class="option"
            :class="{ selected: !onePress && chosen(part, option.label) }"
            @click="press(part, option.label)"
          >
            <button
              class="option-label label"
              type="button"
              :disabled="!open || (shortcuts && !queuedChoice(part, option.label))"
              :aria-pressed="part.multiSelect || !onePress ? chosen(part, option.label) : undefined"
              :data-cy="
                item
                  ? `user-input-choice-${part.id}`
                  : choicesOnly
                    ? 'asked-choice'
                    : 'question-option'
              "
              :title="
                choicesOnly
                  ? 'Sends this as a message'
                  : quickChoices && !hideChoiceEffects && queuedChoice(part, option.label)
                    ? whatThisAnswerDoes(queuedChoice(part, option.label)!)
                    : undefined
              "
              :data-option="option.label"
              @click.stop="press(part, option.label)"
            >
              <!-- A staged pick is marked by a tick as well as by colour. -->
              <svg
                v-if="(!item || part.multiSelect) && !onePress && chosen(part, option.label)"
                class="icon tick"
                aria-hidden="true"
                data-cy="question-option-tick"
              >
                <use href="#i-check" />
              </svg>
              {{ option.label }}
            </button>
            <MarkdownWords
              v-if="option.description"
              class="describe"
              :text="option.description"
              :paths="props.paths ?? queuePaths"
            />
            <small v-if="!hideChoiceEffects && queuedChoice(part, option.label)" class="describe">{{
              whatThisAnswerDoes(queuedChoice(part, option.label)!)
            }}</small>
          </div>
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
            <MarkdownWords
              v-if="readOnly && option.description"
              :text="option.description"
              :paths="props.paths ?? queuePaths"
            />
          </li>
        </ul>
        <p v-if="readOnly && describesReadOnlyPart(part)" class="aside">
          {{ describesReadOnlyPart(part) }}
        </p>
        <template v-if="(live || item) && part.typed && !shortcuts">
          <!-- ⚑ A secret part's words are masked as they are typed, and never echoed. -->
          <input
            v-if="part.secret || item"
            class="box"
            :type="part.secret ? 'password' : 'text'"
            :data-cy="boxHook(part)"
            :aria-labelledby="boxLabel(part, index)"
            :value="typedOf(part, draft.answers)"
            :disabled="!open"
            :placeholder="
              item
                ? part.options.length > 0
                  ? 'Other — type your own answer'
                  : ''
                : part.options.length > 0
                  ? TYPE_YOUR_OWN
                  : TYPE_YOUR_ANSWER
            "
            @input="type(part, ($event.target as HTMLInputElement).value)"
            @keydown="!item && onKey($event)"
          />
          <textarea
            v-else
            class="box"
            rows="1"
            data-cy="question-box"
            :aria-labelledby="boxLabel(part, index)"
            :value="typedOf(part, draft.answers)"
            :disabled="!open"
            :placeholder="
              part.options.length > 0 && !combinesChoiceAndWords ? TYPE_YOUR_OWN : TYPE_YOUR_ANSWER
            "
            @input="type(part, ($event.target as HTMLTextAreaElement).value)"
            @keydown="onKey"
          ></textarea>
        </template>
        <p
          v-if="
            item &&
            open &&
            part.multiSelect &&
            pickedOf(part, draft.answers).length === 0 &&
            typedOf(part, draft.answers).trim() === ''
          "
          class="aside"
          :data-cy="`user-input-empty-${part.id}`"
        >
          Nothing chosen yet — Answer stays off until you pick at least one.
        </p>
      </div>
    </template>

    <p v-if="!item && hint !== null" class="aside" data-cy="question-hint">{{ hint }}</p>
    <!-- ⛔ **The answer bounced and the question is still there** — the host's words, above the
         presses that are live again. -->
    <p
      v-if="reading.refused && open"
      class="aside"
      :data-cy="item ? 'user-input-refused' : 'question-refused'"
    >
      {{ reading.refused }}
    </p>
    <div v-if="waitingElsewhere" class="aside" data-cy="user-input-answered-elsewhere">
      <p>
        {{
          takenWithoutThisWindow === 'by-no-window'
            ? ANSWERED_ONCE_A_WINDOW_TAKES_IT
            : ANSWERED_IN_THE_OTHER_WINDOW
        }}
      </p>
      <button
        v-if="takenWithoutThisWindow === 'by-no-window'"
        class="send"
        type="button"
        data-cy="user-input-take-it-over"
        @click="emit('takeItOver')"
      >
        {{ TAKE_IT_OVER_TO_ANSWER_HERE }}
      </button>
    </div>
    <div
      v-if="item && (state === 'answered' || state === 'declined' || state === 'closed')"
      class="aside"
      data-cy="user-input-answered"
    >
      <span v-if="item.answered">{{ item.answered }}</span>
      <span v-if="reading.answeredBy" data-cy="user-input-answered-by">
        {{ reading.answeredBy }}</span
      >
      <span v-if="reading.note"> {{ reading.note }}</span>
    </div>
    <div
      v-if="offer && live && (!shortcuts || queueOffers?.length)"
      class="options provider-actions"
    >
      <button
        v-if="showSend"
        class="send"
        type="button"
        data-cy="user-input-answer"
        :disabled="!open || !complete"
        @click="send"
      >
        <strong>{{ offer.positive }}</strong>
        <small data-cy="user-input-answer-does">{{ offer.positiveDoes }}</small>
      </button>
      <button
        v-if="rejectsHere"
        class="option"
        type="button"
        data-cy="user-input-reject"
        :title="quickChoices && !hideChoiceEffects ? offer.rejectDoes : undefined"
        :disabled="!open"
        @click="open && submit({ kind: 'reject' })"
      >
        <strong>Reject</strong>
        <small v-if="!hideChoiceEffects" data-cy="user-input-reject-does">{{
          offer.rejectDoes
        }}</small>
      </button>
      <component :is="shortcuts ? 'details' : 'div'" class="aside">
        <summary v-if="shortcuts">Details</summary>
        <p data-cy="user-input-after">{{ WHAT_COMES_AFTER_IS_NOT_OURS }}</p>
      </component>
    </div>
    <div v-else-if="showSend" class="question-foot">
      <button
        class="send"
        type="button"
        data-cy="question-send"
        :disabled="!open || !complete"
        @click="send"
      >
        {{ SEND }}
      </button>
      <span class="foot-spacer"></span>
      <!-- The page's way to the conversation, on the same line as Send. -->
      <slot name="door" />
    </div>
    <div
      v-if="$slots.door && (!showSend || (offer && live && (!shortcuts || queueOffers?.length)))"
      class="question-foot"
    >
      <span class="foot-spacer"></span>
      <slot name="door" />
    </div>
    <p v-if="!item && reading.note" class="aside" data-cy="question-note">{{ reading.note }}</p>
    <p
      v-if="reading.receipt !== null"
      class="aside"
      :class="{ failed: state === 'failed' }"
      data-cy="question-receipt"
    >
      {{ reading.receipt }}
    </p>
    <button
      v-if="reading.where"
      class="press"
      type="button"
      data-cy="question-where"
      :data-held="String(reading.where.held)"
      @click="emit('openConversation', reading.where.conversation)"
    >
      {{ reading.where.action }}
    </button>
  </section>
</template>

<style scoped src="./QuestionCard.css"></style>
