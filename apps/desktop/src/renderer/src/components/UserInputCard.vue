<script setup lang="ts">
import { computed, reactive, useId } from 'vue'
import type { UserInputQuestion, UserInputResponse } from '../../../shared/runtime-ipc'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { inTheAgentsWords } from '../lib/permission-offer'
import type { RequestDraft, TakenWithoutThisWindow } from '../lib/session-record'
import {
  ANSWERED_IN_THE_OTHER_WINDOW,
  ANSWERED_ONCE_A_WINDOW_TAKES_IT,
  TAKE_IT_OVER_TO_ANSWER_HERE,
} from '../lib/taking-over'
import type { TranscriptItem, UserInputItem } from '../lib/transcript'
import { WHAT_COMES_AFTER_IS_NOT_OURS, userInputOffer } from '../lib/user-input-offer'
import { whoAnsweredIt } from '../../../shared/who-did-it'
import { escaped } from '../lib/named-in-a-reply'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import PathsInText from './PathsInText.vue'

/**
 * A server-initiated question (or a permission-profile grant). Every question must be answered for
 * the answer to be forwarded — a partial answer is failed closed by the adapter — so Answer stays
 * disabled until they all have a value. Reject is always available: it is the protocol-safe
 * response that cannot hang the provider.
 *
 * Read `multiSelect` from the neutral question. Use toggles rather than radios when several answers are allowed: another choice adds to the selection and the response is a `string[]`.
 *
 * ⚑ **A single-select question is untouched by all of it.** Same chips, same one-of-n behaviour,
 * same plain-string answer — asserted, because the failure mode of a change like this is to make
 * every question a little bit multi-select.
 */
const props = defineProps<{
  item: UserInputItem & Pick<TranscriptItem, 'at'>
  /**
   * Where this card's state lives (064, 061 finding 8).
   *
   * ⚠️ **It used to be two `ref`s in here, and that made it state of a COMPONENT INSTANCE.** Every
   * re-fold of the transcript renumbers the item ids, Vue rebuilds the rows, and a half-typed answer
   * went with the instance that held it. Owned by the session record instead, keyed by the request
   * id, it survives a prepend, a release and the card leaving the screen entirely.
   *
   * `sent` is written by the STORE, not here — see below.
   *
   * Absent where there is no session to own one: the read-only pane, and a test mounting this card
   * on its own. Then it keeps its own, which lives exactly as long as it used to.
   */
  draft?: RequestDraft
  /**
   * 🔴 **725 · R44 — this conversation's own agent, by NAME, or `null`** (`TranscriptView.ownAgent`):
   * whose words a grant's `permission.agentReason` is drawn as. ⚑ Absent or `null` says *the agent*.
   */
  ownAgent?: string | null
  /** ⚑ **D-017b** — see `PermissionCard.takenWithoutThisWindow`: read-only here, the same way. */
  takenWithoutThisWindow?: TakenWithoutThisWindow | null
  /** This conversation's paths. Absent: a path on the card stays plain text. */
  paths?: PathsHere | null
}>()
const emit = defineEmits<{
  respond: [requestId: string, response: UserInputResponse]
  /** ⚑ **D-017b** — *Take it over to answer here*, raised; the screen takes it. */
  takeItOver: []
}>()

// A `Map` for the same reason `requestDraft` uses one (146): the keys are question ids the PROVIDER
// chose, `__proto__` is a legal one on both wires, and Vue will not track that key on an object.
const ownDraft = reactive<RequestDraft>({
  answers: new Map(),
  sent: false,
  // ⚑ **468 · false, because a card with no record behind it has answered nothing.** This
  // draft exists only when the parent hands none — the card's own fallback — and nothing
  // reads `answered` off it: `answeredFromHere` walks `record.requests`, never a component.
  answered: false,
  open: false,
})
const draft = computed(() => props.draft ?? ownDraft)

const questions = computed(() => props.item.request.questions)
const grantCwd = computed(() => props.item.request.permission?.cwd ?? '')

/**
 * The words on the card that may name a path. An option's description is not among them: it sits
 * inside the option's button, and a control cannot hold another.
 */
const paths = usePathsIn(
  () => props.paths,
  () =>
    [
      props.item.request.prompt,
      grantCwd.value,
      ...(props.item.request.permission?.paths ?? []),
      ...questions.value.map((question) => question.prompt),
    ].map(escaped),
)

/** Ids this card's field labels hang on; every card on a page shares provider question ids. */
const idBase = useId()
const promptId = `${idBase}-prompt`
const askId = (index: number): string => `${idBase}-ask-${index}`
/** What names a question's field: its own ask line, else the card's prompt when it has no words. */
function fieldLabel(question: UserInputQuestion, index: number): string {
  return question.prompt.trim() !== '' || question.header ? askId(index) : promptId
}

/**
 * ⛔ **What this request can be answered with — the SAME call *Waiting on you* makes** (214 §3).
 *
 * `positive`, `positiveDoes` and `rejectDoes` are read here: this card has the whole form, so it
 * can answer a multi-select or a typed question that a one-click row cannot, and
 * `offer.decisions`/`offer.limit` are that row's business. What must never differ between the two
 * is whether a request is approvable at all, and that is now one predicate in one file.
 *
 * 🔴 **And what the press DOES is read off the same object** (482, from `478` F3 — *"`UserInputCard`'s
 * Approve says nothing at all"*). ⛔ **Not composed here and not fetched by a second call**: the
 * zero-question branch of `userInputOffer` hands back `whatThisAnswerDoes` of the very `approve`
 * decision it puts in `decisions`, so the sentence under this card's button and the sentence under
 * the queue's are one call's output. ⚠️ A card that built its own decision to ask about would be
 * `473`'s second producer, on the sentence instead of on the payload.
 */
const offer = computed(() => userInputOffer(props.item.request))

/**
 * 🔴 **725 · R44 — the model's own words about the access it asks for, as its agent's**
 * (`permission.agentReason`, carried by `709`), or `null`. ⛔ Never read off `permission.reason`: a
 * row from before `709` carries the same words there with no author, and is drawn as it was.
 */
const agentSays = computed(() => {
  const words = props.item.request.permission?.agentReason
  return words ? inTheAgentsWords(props.ownAgent ?? null, words) : null
})

/**
 * What is chosen for a question, ALWAYS as a list — the one shape both modes are read in.
 *
 * ⚠️ **The draft holds a string for a single-select question and an array for a multi-select one**
 * (139), because that is what each of them sends. Reading them through one function is what keeps
 * `complete`, the chip's selected state and the payload from each deciding "is this answered"
 * separately — three predicates over two shapes is how a control ends up disagreeing with the button
 * beside it.
 */
function chosen(question: UserInputQuestion): string[] {
  // ⛔ **`Map.get`, and the TYPE checked rather than assumed** (146, from 145 HIGH 2). A
  // provider-chosen question id of `constructor` used to return the inherited function from the
  // plain object this used to be, and `.trim()` on it threw DURING RENDER — a card that crashed
  // before anyone could answer it, from an id both pinned protocols accept. A `Map` has no
  // prototype chain to read through; the type check stays because a stored draft can be older than
  // this code and because emptiness is decided here for both shapes.
  const value = draft.value.answers.get(question.id)
  if (Array.isArray(value)) return value.filter((member) => typeof member === 'string')
  if (typeof value !== 'string') return []
  return value.trim() === '' ? [] : [value]
}

/**
 * Whether a value is one of the labels this question offers — **the same test the adapter makes**.
 *
 * ⚠️ **Exact equality, and 146 is when the two sides actually became one rule.** The adapter used to
 * match on the trimmed value, so an offered label padded with NBSP, typed plainly into `Other`, was
 * free-form here and a chosen label there — the user saw one kind of answer and the provider got
 * the other (145 MEDIUM 2). `answerToForward` is the other copy of this line, and
 * `permission.ts`'s `isOfferedLabel` says why it is a copy: the renderer takes types from the
 * runtime and no values, so this is pinned by a test rather than shared.
 */
function isLabel(question: UserInputQuestion, value: string): boolean {
  return question.options.some((option) => option.label === value)
}

/**
 * The free-form field's own value — **the chosen value that is not one of the labels** (143).
 *
 * ⚠️ **Derived rather than stored, and that is what keeps it from desyncing.** A question can now
 * offer options AND a free-text escape, so the card needs to know which of the two the user used.
 * Holding the typed text in a second map beside `answers` would make "what is selected" and "what is
 * typed" two facts that can disagree — the exact shape of 139's own defect one layer up. There is
 * one fact: the answer. A member that matches no label IS the `Other` answer, which is also the rule
 * `answerToForward` applies on the way out, so the card and the adapter cannot draw the line
 * differently.
 *
 * ⚑ **A question with no options has no labels, so every value misses and this returns it** —
 * the pure free-form field, behaving exactly as it did before 143.
 */
function typed(question: UserInputQuestion): string {
  return chosen(question).find((value) => !isLabel(question, value)) ?? ''
}

/** Whether this question shows a free-text field at all: no options, or an explicit escape. */
function offersOther(question: UserInputQuestion): boolean {
  return question.options.length === 0 || question.allowOther === true
}

/**
 * Pick an option: one-of-n for an ordinary question, add-or-remove for a multi-select one.
 *
 * ⚑ **Stored in the QUESTION's order, not the click order.** Rebuilding the list by filtering
 * `question.options` means the answer reads the way the question was asked however it was clicked,
 * and two clicks on the same chip cannot leave it in twice.
 *
 * ⚠️ **A typed `Other` answer survives the rebuild on a multi-select question, and is REPLACED on a
 * single-select one** (143) — because that is what each mode means. Filtering `question.options`
 * alone would have silently dropped the user's own words the moment they also ticked a box.
 */
function pick(question: UserInputQuestion, label: string): void {
  if (!question.multiSelect) {
    draft.value.answers.set(question.id, label)
    return
  }
  const current = chosen(question)
  const other = current.filter((value) => !isLabel(question, value))
  const next = new Set(current.filter((value) => isLabel(question, value)))
  if (next.has(label)) next.delete(label)
  else next.add(label)
  draft.value.answers.set(question.id, [
    ...question.options.map((option) => option.label).filter((l) => next.has(l)),
    ...other,
  ])
}

/**
 * Type an `Other` answer: it replaces the selection on a single-select question and joins it on a
 * multi-select one — the mirror of {@link pick}, and the reason both write through one shape.
 *
 * An emptied field removes the member rather than storing `''`, so "typed nothing" and "typed and
 * cleared" are the same state and neither can satisfy `complete`.
 */
function setOther(question: UserInputQuestion, text: string): void {
  if (!question.multiSelect) {
    draft.value.answers.set(question.id, text)
    return
  }
  const labels = chosen(question).filter((value) => isLabel(question, value))
  draft.value.answers.set(question.id, text.trim() === '' ? labels : [...labels, text])
}

const complete = computed(() => questions.value.every((question) => chosen(question).length > 0))
/**
 * This card is no longer actionable — for ANY of the reasons it can stop being actionable.
 *
 * ⚠️ **It was called `answered`, and that name was the defect** (074, from 069 §2.1). It is true for
 * a card the user answered AND for one that was never answered at all — `settlePending` sets `note`
 * on teardown, `markRequestFailed` sets it when the host refuses a response — and the header read
 * the word "Answered" straight off it. So a question nobody answered, including an `ExitPlanMode`
 * plan the user never approved, sat in the transcript headed **Answered**: the app stating a human
 * decision that was never made. 063 refused to auto-continue a question for exactly this reason.
 *
 * Renamed rather than merely worked around, because every use below is correct on the combined
 * fact — the inputs must go dead, the actions must go away, the settled line must appear — and the
 * only thing that was ever wrong was the word. A name that says "settled" cannot be misread into a
 * claim about who settled it.
 */
const settled = computed(() => props.item.answered !== null || props.item.note !== null)

/** ⚑ **D-017b · waiting, and answered by another window than this one** — nothing is sent here. */
const answeredElsewhere = computed(
  () => !settled.value && (props.takenWithoutThisWindow ?? null) !== null,
)

/**
 * Who settled it, and how — read from `item.answered` ALONE.
 *
 * The sibling card has said this all along, and its comment is the rule this one now follows
 * (`PermissionCard.vue`): *"`null` outcome with a note is a card that stopped being actionable
 * without ever being answered (teardown) — which is neither an approval nor a refusal and must not
 * be dressed as one."* Same data shape, same three states, so: same answer.
 *
 * `Rejected` is its own word rather than folded into "Answered" for the same reason — a refusal is
 * not an answer, and the transcript is where someone goes to find out what they agreed to.
 */
const verdict = computed(() => {
  switch (props.item.answered) {
    case 'answered':
      return 'Answered'
    case 'rejected':
      return 'Rejected'
    default:
      return settled.value ? 'Not answered' : 'Needs your answer'
  }
})

/**
 * 🔴 **Who answered it** (503, HO-037 §2) — `UserDecisionEvent.by`, carried onto the item by the
 * fold and read from nowhere else.
 *
 * ⛔ **Keyed on `item.answered` and never on {@link settled}**, which is the same distinction
 * `074` made about the word *Answered* and the reason this component renamed that flag. `settled`
 * is true of a card a teardown killed and of one the host refused a response for — ⚠️ **neither
 * has an answerer, and neither has a gap in the ledger to report**, so both arms of
 * {@link whoAnsweredIt} would be false of them. ⚑ `item.answered` is written by
 * `markUserInputAnswered` alone, so it is exactly *a decision row was folded*.
 *
 * ⚑ **This is where the PO's distinction becomes visible.** A permission can only ever have been
 * answered by a person; a QUESTION can have been answered by a parent agent — `answerQuestion` is
 * that door — so this card is the one whose actor genuinely varies.
 */
const answeredBy = computed(() =>
  props.item.answered === null ? null : whoAnsweredIt(props.item.by),
)

/**
 * A response is on its way, so nothing may be offered again.
 *
 * ⚠️ **Set by whoever observes the act, and by BOTH of them on purpose.** The card sets it because
 * a click has happened and nothing may be offered again from this instant; the store sets it too,
 * on the record, which is what makes the guard outlive the re-fold that used to reset it (061
 * finding 8). Written in one place only it would be wrong in one of two ways: on the card, lost to
 * a remount; in the store alone, absent for any surface that renders a card without wiring a draft
 * owner — which a review found is exactly what the fallback above is.
 */
const sent = computed(() => draft.value.sent)

/**
 * ⚑ **A multi-select question answers with a LIST; everything else answers with the string it always
 * did** (139). The neutral contract has allowed both since 033 (`string | string[]`) and nothing
 * could produce the second until the question could say it wanted one — so this is the only line in
 * the app that had to learn a new shape, and it learns it per QUESTION rather than per card.
 *
 * ⛔ **It no longer trims, and that is one fix in two places** (146, from 145 LOW 1 / MEDIUM 2).
 * `answerToForward`'s contract says in as many words that typed text is never trimmed — and this
 * function was trimming it before that contract ever saw it, so a path or a masked secret with
 * meaningful surrounding space went to the provider altered, while a programmatic caller's did not:
 * two entry paths, one contract, two behaviours. The adapter then compensated by matching labels on
 * the trimmed value, which is what let a padded label typed as free-form arrive as a chosen one.
 * Sending what was actually chosen removes the need for both halves.
 *
 * ⚑ **Nothing is filtered either, and a whitespace-only OPTION LABEL is why it matters.** Such a
 * label is legal in both pinned types, this card counts it chosen, and it is the one answer the
 * adapter refuses — `not-usable`, with the request left pending. Sending it as chosen is what makes
 * that refusal land on a card that is still answerable rather than being quietly rewritten into an
 * empty answer here. Emptiness is decided once, where the refusal is.
 */
function answer(): void {
  if (sent.value) return
  draft.value.sent = true
  // Null prototype: `question.id` is the provider's string, and `payload['__proto__'] = …` on an
  // ordinary object sets the prototype and sends nothing (146).
  const payload: Record<string, string | string[]> = Object.create(null)
  for (const question of questions.value) {
    const picked = chosen(question)
    payload[question.id] = question.multiSelect ? picked : (picked[0] ?? '')
  }
  emit('respond', props.item.request.id, { kind: 'answer', answers: payload })
}

function reject(): void {
  if (sent.value) return
  draft.value.sent = true
  emit('respond', props.item.request.id, { kind: 'reject' })
}
</script>

<template>
  <article
    class="input-card"
    :class="{ 'is-settled': settled }"
    data-cy="user-input-card"
    :data-request-id="item.request.id"
    :data-verdict="verdict"
  >
    <div class="input-top">
      <!-- `#i-question` — the same glyph the agent's NEEDING badge wears for a question (082), and
           not the `i-help` that was never in the sprite and painted nothing (089). One card, one
           mark, wherever it is drawn. -->
      <svg class="icon"><use href="#i-question" /></svg>
      <span data-cy="user-input-verdict">{{ verdict }}</span>
      <span class="time" :title="fullTime(item.at)">{{ clockTime(item.at) }}</span>
    </div>

    <div class="input-body" @click="paths.clicked">
      <!-- ⚑ **605 · a hook, because the paragraph carries a claim that can be measured.** The
           prompt may hold breaks the provider wrote — see `.input-body > p`'s `white-space` —
           and a test that asserts they SURVIVE has to be able to find this element. -->
      <p :id="promptId" data-cy="user-input-prompt">
        <PathsInText :text="item.request.prompt" :found="paths" />
      </p>
      <p
        v-if="paths.failure.value"
        class="message-path-failure"
        role="status"
        data-cy="message-path-failure"
      >
        {{ paths.failure.value }}
      </p>
      <!-- 🔴 725 · R44 — what the model wrote about the access it asks for, under its agent's name:
           outside the grant block, because it is never a scope line. -->
      <p v-if="agentSays" data-cy="user-input-agent-reason">{{ agentSays }}</p>

      <div v-if="item.request.permission" class="grant" data-cy="user-input-permission">
        <div v-if="item.request.permission.reason">{{ item.request.permission.reason }}</div>
        <div v-if="grantCwd">cwd: <PathsInText :text="grantCwd" :found="paths" /></div>
        <div v-for="path in item.request.permission.paths" :key="path">
          <PathsInText :text="path" :found="paths" />
        </div>
        <div v-if="item.request.permission.network">network access requested</div>
      </div>

      <div
        v-for="(question, index) in questions"
        :key="question.id"
        class="question"
        :data-cy="`user-input-question-${question.id}`"
        :data-multi-select="question.multiSelect ? 'true' : 'false'"
      >
        <p :id="askId(index)" class="ask">
          <!-- ⚑ **The label both providers designed for this card** (143). Claude declares it
               required — *"Very short label displayed as a chip/tag (max 12 chars)"* — and so does
               Codex; BroBot read neither, so the compact summary the model wrote for exactly this
               surface was thrown away and the full sentence was all there was. Rendered only when
               there is one (086): a question with no header shows no chip, not an empty one. -->
          <span
            v-if="question.header"
            class="header"
            :data-cy="`user-input-header-${question.id}`"
            >{{ question.header }}</span
          >{{ ' ' }}<PathsInText :text="question.prompt" :found="paths" />{{
            ' '
          }}<!-- State multiple-selection mode before interaction; chips alone can look like a single-choice control. Use muted text so the question itself retains the attention signal. -->
          <span
            v-if="question.multiSelect"
            class="mode"
            :data-cy="`user-input-mode-${question.id}`"
          >
            pick as many as you like
          </span>
        </p>
        <!-- Choice chips when the provider gave options, and a field alongside them whenever an
             answer off the list is allowed. Both write into the same answer map, so what is sent
             does not depend on how it was asked. -->
        <div
          v-if="question.options.length > 0"
          class="input-choices"
          :class="{ described: question.options.some((option) => option.description) }"
        >
          <button
            v-for="option in question.options"
            :key="option.label"
            class="choice"
            :class="{ selected: chosen(question).includes(option.label) }"
            type="button"
            :disabled="settled || sent || answeredElsewhere"
            :aria-pressed="chosen(question).includes(option.label)"
            :data-cy="`user-input-choice-${question.id}`"
            :data-option="option.label"
            @click="pick(question, option.label)"
          >
            <span class="label">
              <!-- `#i-check` is in the sprite (089's rule: a glyph that paints nothing is worse
                   than no glyph), and only a multi-select chip wears one — on a one-of-n row a tick
                   beside the single lit chip says nothing the lighting did not. -->
              <svg
                v-if="question.multiSelect && chosen(question).includes(option.label)"
                class="icon tick"
              >
                <use href="#i-check" />
              </svg>
              {{ option.label }}
            </span>
            <!-- ⛔ **Nothing at all where the model gave no reason** (086). Both providers declare
                 `description` required, so an absent one is a producer that did not follow its own
                 schema — and "no description" must not render as a blank line that reads like an
                 empty answer. -->
            <span v-if="option.description" class="describe">{{ option.description }}</span>
          </button>
        </div>
        <!-- ⛔ **The answer both providers promise the user can give** (143). Codex forces
             `is_other = true` on every ordinary question and Claude tells the model Other "will be
             provided automatically" — while this field used to appear only when the option list was
             empty, which both normalizers forbid. So it is no longer an `v-else`: a question can
             have options AND this. -->
        <div v-if="offersOther(question)" class="input-field">
          <!-- ⚠️ `:value` + `@input` rather than `v-model`, because the draft holds
               `string | string[]` since 139 and a field can only ever be the first of those.
               `typed()` is the narrowing, in one place.
               ⚑ `secret` masks what is typed and nothing else (141 §3.1) — options are labels the
               model wrote, and there is no secret in picking one. -->
          <input
            :value="typed(question)"
            :type="question.secret ? 'password' : 'text'"
            :aria-labelledby="fieldLabel(question, index)"
            :disabled="settled || sent || answeredElsewhere"
            :placeholder="question.options.length > 0 ? 'Other — type your own answer' : ''"
            :data-cy="
              question.options.length > 0
                ? `user-input-other-${question.id}`
                : `user-input-answer-${question.id}`
            "
            @input="setOther(question, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <!-- ⛔ **Why the button is off, in words** (086: *an honest refusal beats a disabled button
             with no reason*). Only for a multi-select question, and that asymmetry is the point:
             an unchosen row of one-of-n chips reads as unfinished, while "none of them" is a thing
             a person can genuinely MEAN of a checkbox list — and it is the one answer this card
             cannot send, because an empty answer forwarded as an answer is a decision nobody made
             (064, and the adapter fails it closed for the same reason). -->
        <p
          v-if="question.multiSelect && !settled && chosen(question).length === 0"
          class="hint"
          :data-cy="`user-input-empty-${question.id}`"
        >
          Nothing chosen yet — Answer stays off until you pick at least one.
        </p>
      </div>

      <!-- ⛔ **The answer bounced and the question is STILL THERE** (146). Deliberately not in the
           `settled` block below and deliberately not `item.note`: a note is an ending, and writing
           one here is what used to take Answer and Reject away from a card the provider was still
           waiting on. This is the same sentence with the opposite consequence — say what went wrong,
           change nothing else. Muted like every other explanation on this card, never `--waiting`
           (080): the card is already wearing the attention colour for being a question at all. -->
      <p v-if="!settled && item.refused" class="refused" data-cy="user-input-refused">
        {{ item.refused }}
      </p>
      <div v-if="settled" class="settled" data-cy="user-input-answered">
        <span v-if="item.answered">{{ item.answered }}</span>
        <!-- 🔴 **Who answered it** (503) — and on this card the answer is not always a person:
             a parent agent settles a routed question through `answerQuestion`. Present only where
             a decision exists; a card a teardown settled has no answerer to name. -->
        <span v-if="answeredBy" class="who" data-cy="user-input-answered-by">{{ answeredBy }}</span>
        <span v-if="item.note" class="note">{{ item.note }}</span>
      </div>
      <!-- ⚑ **D-017b · read-only where another window, or none, holds the conversation** —
           `PermissionCard`'s own arm, the same words and the same press. -->
      <div v-else-if="answeredElsewhere" class="actions" data-cy="user-input-answered-elsewhere">
        <p class="after">
          {{
            takenWithoutThisWindow === 'by-no-window'
              ? ANSWERED_ONCE_A_WINDOW_TAKES_IT
              : ANSWERED_IN_THE_OTHER_WINDOW
          }}
        </p>
        <button
          v-if="takenWithoutThisWindow === 'by-no-window'"
          class="btn"
          type="button"
          data-cy="user-input-take-it-over"
          @click="emit('takeItOver')"
        >
          <strong>{{ TAKE_IT_OVER_TO_ANSWER_HERE }}</strong>
        </button>
      </div>
      <div v-else class="actions">
        <!-- ⛔ **The word comes from `userInputOffer`, which is also what *Waiting on you* reads** (214 §3). It
             used to be `questions.length > 0 ? 'Answer' : 'Approve'` written out here — correct, and
             the only copy of a rule the overview held differently, which is how Home came to say a
             plan could not be approved while this button approved it.

             🔴 **And so does the line under it** (482). ⛔ The word alone was criterion 20's third
             clause absent on the surface that actually answers: the queue said what Approve does
             and the card, one click away, said nothing. ⚠️ **Two lines on one control rather than
             a legend beside the row** — `PersonsQueue`'s shape, reused rather than re-invented, so
             a reader who learned to look under the word on one surface finds it under the word on
             this one. -->
        <button
          class="btn primary"
          :disabled="!complete || sent"
          data-cy="user-input-answer"
          @click="answer"
        >
          <strong>{{ offer.positive }}</strong>
          <small data-cy="user-input-answer-does">{{ offer.positiveDoes }}</small>
        </button>
        <button class="btn" :disabled="sent" data-cy="user-input-reject" @click="reject">
          <strong>Reject</strong>
          <small data-cy="user-input-reject-does">{{ offer.rejectDoes }}</small>
        </button>
        <!-- 🔴 **The gap, once for the pair** (434, HO-024 §5.3) — the same sentence in the same
             place the queue draws it, because it is the same unknown about both presses. -->
        <p class="after" data-cy="user-input-after">{{ WHAT_COMES_AFTER_IS_NOT_OURS }}</p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.input-card {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
  border: var(--border-width) solid var(--line-strong);
  border-left: var(--border-accent-width) solid var(--waiting);
  border-radius: var(--radius);
  background: var(--input-card-bg);
  overflow: hidden;
}

/* The spine and the label are the "waiting on you" colour, and a card that is no longer waiting must
   not keep wearing it (074) — the word above is the disclosure, and colour contradicting it is the
   same defect one layer down. `is-settled` rather than `settled`: the body below already owns that
   class, and one name for two elements is how a flex rule ends up on the card. */
.input-card.is-settled {
  border-left-color: var(--line-strong);
}

.input-card.is-settled .input-top {
  color: var(--muted);
}

.input-top {
  display: flex;
  min-height: 34px;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-4);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.input-top .icon {
  width: 13px;
  height: 13px;
}

.input-top .time {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-weight: var(--fw-normal);
  letter-spacing: 0;
  text-transform: none;
}

.input-body {
  padding: var(--space-6);
}

.input-body > p {
  margin: 0 0 var(--space-5);
  color: var(--text-soft);
  font-size: var(--type-body);
  line-height: var(--leading-normal);
  /* 🔴 **605 · a break the PROVIDER put in the prompt is drawn** — found in this dispatch's own
     photograph (rule 17.2), which is the only reason anybody looked. ⛔ The Codex elicitation card
     writes two paragraphs: this app's admission that it cannot name the call, then the server's
     own words. HTML collapsed the blank line between them and the two ran together into a wall,
     with the admission hidden inside it — which is `HO-090` §1.2's *visibly* failing on a
     whitespace rule.
     ⚑ **`pre-line` and not `pre`**: runs of spaces still collapse and the text still WRAPS, so a
     long prompt behaves exactly as it did. ⚠️ It applies to every card because the fact is
     general — a prompt whose author wrote a paragraph break meant one — and the sibling surface
     already behaves this way: `PermissionCard`'s `detail` honours them. */
  white-space: pre-line;
}

.grant {
  margin: 0 0 var(--space-5);
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-mono);
}

.ask {
  margin: 0 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-small);
}

/* The mode, and the reason the button is off. Both are `--faint` on the card's own surface: they
   are what the question does not say about itself, not a second thing wanting attention (080). */
.mode,
.hint {
  color: var(--faint);
  font-size: var(--type-caption);
}

.mode {
  margin-left: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

/* The provider's own short label for the question (143). The same faint, letter-spaced treatment as
   `.mode` on the other side of the prompt: it is a tag ON the question, and a tag that outshouted
   the question would be the 080 defect in miniature. No new token — `--faint` and `--line` are what
   the two existing labels on this card already use (107/125). */
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

.hint {
  margin: calc(-1 * var(--space-3)) 0 var(--space-5);
}

.choice .tick {
  width: 11px;
  height: 11px;
  margin-right: var(--space-2);
  vertical-align: -1px;
}

.input-choices {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
  gap: var(--space-4);
}

.choice {
  height: 28px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.choice:hover:not(:disabled),
.choice.selected {
  border-color: var(--accent);
  background: var(--accent-fill);
  color: var(--accent-text);
}

/* ⚠️ **A described option is not a 28px pill, and the measurement is why** (143). 142 reassembled
   seven real descriptions from the `input_json_delta` frames of `sess_71a5b654` and measured
   105–177 characters, mean 142.7, reaching 101 across that session's other calls — so the question
   was never "can a chip hold this" but "what does the control become". It becomes the same control:
   same class, same `data-cy`, same click, grown a second line and full width. A question whose
   options carry no description keeps the compact wrapping chip row it has always had, which is what
   every pre-143 ledger row and every permission card still renders as. */
.input-choices.described {
  flex-direction: column;
  align-items: stretch;
}

.input-choices.described .choice {
  height: auto;
  padding: var(--space-4) var(--space-6);
  text-align: left;
}

.input-choices.described .label {
  font-weight: var(--fw-semibold);
}

.choice .label {
  display: block;
}

.choice .describe {
  display: block;
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* On a lit option the muted grey would be sitting on the accent fill, which is a contrast question
   nobody asked — the accent's own text colour is already vetted against that background by the
   label above it, so the description takes it too and stays distinguishable by size alone. */
.choice.selected .describe,
.choice:hover:not(:disabled) .describe {
  color: var(--accent-text);
}

.input-field input {
  width: 100%;
  height: 34px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  font-size: var(--type-caption);
}

/* ⚠️ **A COLUMN since 482, and the sentence is why.** The row was two words wide; it is now two
   controls that each carry a line of prose, and side by side those would either wrap into each
   other or push the card past the pane. Stacked is also what `PersonsQueue` does with the same
   pair of facts, so the two surfaces read the same way. */
.actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.btn {
  display: inline-flex;
  min-height: 31px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-2) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: 1px;
  text-align: left;
}

/* ⛔ **`inherit`, never `--muted`** (482). The primary button is filled with `--accent` and writes
   in `--accent-ink`; a muted grey is a token picked for a PANEL, and putting it on an accent fill
   is the class of defect `an-alpha-fill-in-a-light-scope-is-not-a-light-surface` names — a colour
   that is quiet on the surface it was chosen for and unreadable on the one it lands on. Inheriting
   the button's own ink is quiet on every variant by construction. It keeps that ink at full
   strength and is set apart by its size and weight alone: faded, it read under 4.5:1 on the fill. */
.btn small {
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
  line-height: var(--leading-tight);
  white-space: normal;
}

.btn strong {
  font-weight: var(--fw-semibold);
}

/* The same weight and the same colour the rest of this card's explanations wear (080): the card
   already spends the attention channel on being a question. */
.after {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.btn:hover:not(:disabled) {
  background: var(--wash-5);
}

.btn:disabled {
  opacity: 0.6;
}

.btn.primary {
  border-color: var(--accent);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

/* Under the pointer the primary button keeps its solid fill, as the content's other solid buttons
   do: its ink is written for that fill alone. This outranks both the card's own hover wash above
   and base.css's `button.primary:hover`, either of which would put that ink on a pale fill. */
.btn.primary:hover:not(:disabled) {
  background: var(--accent-solid-bg);
}

.settled {
  display: flex;
  align-items: baseline;
  color: var(--text-soft);
  font-size: var(--type-small);
  gap: var(--space-4);
}

/* Who answered it (503) — quiet beside the verdict, in the note's own weight, because it is a
   fact about the decision rather than a second state for the card to be in. */
.settled .who {
  color: var(--muted);
  font-size: var(--type-caption);
}

.settled .note {
  color: var(--muted);
  font-size: var(--type-caption);
}

/* The bounced answer, sitting where it happened — directly above the buttons that are still live. */
.refused {
  margin: 0 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}
</style>
