<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { renderChatMarkdown } from '../lib/markdown'
import {
  answerFor,
  questionsWithChoices,
  goesAsAMessage,
  SENT_AS_A_MESSAGE,
  type AskedWithoutWaiting,
} from '../lib/asked-without-waiting'
import { documentClicked, documentsNamedIn } from '../lib/the-documents-a-reply-names'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import type { AssistantItem, TranscriptItem } from '../lib/transcript'

/**
 * Streamed text while deltas land, then the authoritative message replaces it. The live tag and
 * the caret are the signal that this block is still growing — both come off `streaming`, which
 * the fold sets from the stream itself, so they can never say "live" about a settled block.
 *
 * A SETTLED block renders as Markdown (017) — agents speak in fences, lists and links, and
 * showing the literal backticks made every code block unreadable. The renderer is the same
 * `lib/markdown.ts` the document viewer uses (`html:false`, so a `<script>` in a reply is text,
 * not markup), in its chat preset — one markdown stack, restyled here for the dark chat instead
 * of the white paper. A rendered link cannot navigate this window: the main process refuses that
 * and hands http(s) to the real browser, which is what makes a model's URL safe to render.
 *
 * While it STREAMS it stays plain text. Deltas can end mid-syntax — a half-open fence, half a
 * list — and re-parsing the whole message on every delta would restyle text already on screen
 * each time the syntax closed. Plain text never lies about unfinished markdown, and it keeps the
 * caret literally at the end of the text, which no block-level rendering can.
 *
 * The swap is USUALLY the authoritative message replacing the streamed text. It is not always:
 * `closeStreaming` also settles a block on a tool call, on the end of a turn, and on an interrupt
 * (transcript.ts), and such a block is delta text no authoritative message ever confirmed. Cut off
 * inside a fence, it settles with that fence still open — markdown-it then renders the remainder
 * as a code block, which is both what the text was and the least surprising way to show a reply
 * that stopped mid-code. Nothing is dropped either way; only the styling of the tail differs.
 */
const props = defineProps<{
  item: AssistantItem & Pick<TranscriptItem, 'at'>
  /** Who is speaking — the provider's own name, as the header shows it. */
  who?: string
  /**
   * Paths of files handed to this transcript, used to make their links clickable.
   *
   * ⛔ **Optional, and an absent roster draws no controls at all.** ⚑ `TranscriptView` builds it
   * from `everyResourceAReportNames`, which is the SAME predicate the work report's own press reads,
   * so a surface with no reader behind it yields an empty roster rather than a control that cannot
   * act.
   *
   * ⚠️ **It is the app's own minted ids and never a shape matched out of the words.** `548` §Q4:
   * *"Do not regex every code span into a button."* See `the-documents-a-reply-names.ts`.
   */
  documents?: readonly string[]
  /**
   * ⚑ **Whether this conversation can take a message** — `ConversationPane`'s `canTakeAMessage`.
   * ⛔ Absent or false: the choices of a question asked without waiting are not drawn at all, so no
   * surface shows a button with nothing behind it (the message text still lists them).
   */
  canAnswer?: boolean
  /** This conversation's paths. Absent: a path in the reply stays plain text. */
  paths?: PathsHere | null
}>()

const emit = defineEmits<{
  /**
   * ⛔ **562 · emitted, never performed** — `WorkReportEntry`'s own ruling for its twin: the fetch
   * and the panel both live in `ConversationPane`, and a surface that read the bytes itself would
   * be a second route into a door `095` spent a dispatch collecting into one place.
   *
   * ⚑ **It is `TranscriptView`'s EXISTING `openDocument` event** (510), so this control and the
   * work report's button arrive at the pane through one channel and open one panel.
   */
  openDocument: [resourceId: string]
  /**
   * ⚑ **A choice picked on a question asked without waiting** (provider follow-ups 1) — the words to
   * send as an ordinary message to this conversation. Raised, never sent here: the pane owns the
   * send, and its `now` already holds a message while the conversation is busy.
   */
  answer: [text: string]
}>()

const choices = computed(() =>
  props.item.streaming ? [] : questionsWithChoices(props.item.questions),
)
/**
 * ⚠️ **Only the moment between a press and the message showing up below.** Whether the choices are
 * spent is the transcript's to say (`TranscriptView`'s `repliedAfter` turns `canAnswer` off once a
 * message of the person's follows) — this ref only stops a second press in that moment, and says
 * what the press DID, never that anything was sent.
 */
const pressed = ref<string | null>(null)

function choose(question: AskedWithoutWaiting, option: string): void {
  if (pressed.value !== null) return
  const text = answerFor(choices.value, question, option)
  pressed.value = text
  emit('answer', text)
}

/** Distinct per message, so each choice group names the note that explains it. */
const noteId = computed(() => `asked-note-${props.item.id}`)

const markdown = computed(() => (props.item.streaming ? '' : renderChatMarkdown(props.item.text)))

/** Paths are asked about only once the reply has settled. */
const paths = usePathsIn(
  () => props.paths,
  () => (props.item.streaming ? [] : [markdown.value]),
)

/**
 * ⛔ **Markdown first, then the roster** — see `lib/named-in-a-reply.ts`. ⚠️ The order is the whole
 * of why the `html: false` invariant below still holds: markdown-it escapes everything the reply
 * wrote, and the only markup added afterwards is this app's own, built from a value it read from its
 * own data — a resource id one of its own work reports carried, or a path main said it found,
 * escaped on the way in.
 */
const rendered = computed(() => {
  if (props.item.streaming) return ''
  return paths.mark(documentsNamedIn(markdown.value, props.documents ?? []))
})

/**
 * ⛔ **A named file, pressed — raised, never opened here** (see {@link emit}).
 *
 * ⚠️ **Delegated on the container**, because `v-html` content has no components to bind handlers to.
 */
function openANamedDocument(event: MouseEvent): void {
  const resourceId = documentClicked(event.target)
  if (resourceId === null) return paths.clicked(event)
  event.preventDefault()
  emit('openDocument', resourceId)
}
</script>

<template>
  <article class="msg assistant" :class="{ 'human-final': item.humanFinal }" :data-human-final="item.humanFinal ? 'true' : undefined">
    <div class="msg-avatar">
      <svg class="icon"><use href="#i-bot" /></svg>
    </div>
    <div class="msg-column">
      <div class="msg-meta">
        <strong data-cy="assistant-author">{{ who || 'Assistant' }}</strong>
        <span v-if="item.humanFinal" class="final-label">Answer to you</span>
        <span v-if="item.streaming" class="live-tag" data-cy="streaming-tag">
          <span class="dot"></span>streaming
        </span>
        <!-- No clock while it is still being written: a time on an unfinished block reads as if
             the message had already landed. -->
        <span v-else class="time">{{ clockTime(item.at) }}</span>
      </div>
      <div
        class="msg-body"
        data-cy="assistant-message"
        :data-streaming="item.streaming ? 'true' : 'false'"
        :data-at="item.streaming ? '' : clockTime(item.at)"
        :title="item.streaming ? '' : fullTime(item.at)"
      >
        <template v-if="item.streaming"
          >{{ item.text }}<span class="stream-caret" aria-hidden="true"></span
        ></template>
        <!-- eslint-disable-next-line vue/no-v-html -- markdown-it runs with `html: false`, so this
             string cannot contain markup from the reply; see lib/markdown.ts. -->
        <div
          v-else
          class="md-chat"
          data-cy="assistant-markdown"
          v-html="rendered"
          @click="openANamedDocument"
        ></div>
      </div>
      <p
        v-if="paths.failure.value"
        class="message-path-failure"
        role="status"
        data-cy="message-path-failure"
      >
        {{ paths.failure.value }}
      </p>
      <!-- Questions asked without waiting, as choices (provider follow-ups 1). The message above
           already says them; this only makes them pressable, and says what a press does. -->
      <div
        v-if="props.canAnswer === true && choices.length > 0"
        class="asked"
        data-cy="asked-without-waiting"
      >
        <p :id="noteId" class="asked-note" data-cy="asked-note">{{ SENT_AS_A_MESSAGE }}</p>
        <div
          v-for="(question, at) in choices"
          :key="at"
          class="asked-question"
          role="group"
          :aria-label="question.title"
          :aria-describedby="noteId"
        >
          <span v-if="choices.length > 1 || item.text.trim() === ''" class="asked-title">{{ question.title }}</span>
          <button
            v-for="(option, index) in question.options"
            :key="index"
            type="button"
            class="asked-choice"
            data-cy="asked-choice"
            title="Sends this as a message"
            :disabled="pressed !== null"
            @click="choose(question, option)"
          >
            {{ option }}
          </button>
        </div>
        <p v-if="pressed !== null" class="asked-sent" data-cy="asked-pressed" aria-live="polite">
          {{ goesAsAMessage(pressed) }}
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.msg-body :deep(.open-the-document) {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.msg-body :deep(.open-the-document:hover),
.msg-body :deep(.open-the-document:focus-visible) {
  color: var(--accent-text-soft);
}

.msg {
  display: grid;
  max-width: var(--measure-message);
  margin: 0 auto var(--space-12);
  gap: var(--space-6);
  grid-template-columns: var(--avatar-small) minmax(0, 1fr);
}

.msg-column {
  min-width: 0;
}

.asked {
  margin-top: var(--space-5);
}
.asked-note,
.asked-sent {
  color: var(--muted);
  font-size: var(--type-caption);
}
.asked-question {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-5);
  gap: var(--space-5);
  align-items: center;
}
.asked-title {
  color: var(--text-soft);
  font-size: var(--type-caption);
}
.asked-choice {
  padding: var(--space-1) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: none;
  color: inherit;
  font: inherit;
  font-size: var(--type-small);
  cursor: pointer;
}
.asked-choice:hover:not(:disabled),
.asked-choice:focus-visible {
  border-color: var(--accent);
}
.asked-choice:disabled {
  cursor: default;
  opacity: 0.6;
}

.msg-avatar {
  display: grid;
  width: var(--avatar-small);
  height: var(--avatar-small);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius);
  background: var(--accent-fill);
  color: var(--accent-text);
  place-items: center;
}

.msg-avatar .icon {
  width: var(--icon);
  height: var(--icon);
}

.msg-meta {
  display: flex;
  height: auto;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3) var(--space-6);
  min-height: var(--space-10);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.msg-meta strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.time {
  margin-left: 0;
  color: var(--faint);
  font: var(--type-caption) / var(--leading-normal) var(--font-sans);
  opacity: 1;
  transition: opacity var(--dur-fast) ease;
}

.msg:hover .time {
  opacity: 1;
}

.live-tag {
  display: inline-flex;
  align-items: center;
  color: var(--accent-text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.live-tag .dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  animation: pulse 1.4s ease-in-out infinite;
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.msg-body {
  padding-top: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  overflow-wrap: anywhere;
}

.human-final .msg-column {
  border-inline-start: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--panel));
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.final-label {
  color: var(--text);
  font-size: var(--type-small);
}

/* Preserve streamed newlines without adding whitespace to rendered Markdown. */
.msg-body[data-streaming='true'] {
  white-space: pre-wrap;
}

.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 1px;
  animation: blink 1s steps(1) infinite;
  background: var(--accent);
  vertical-align: -2px;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
