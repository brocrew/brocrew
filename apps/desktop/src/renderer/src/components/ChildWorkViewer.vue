<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { absenceUnreadSays } from '../lib/rows-unread'
import type {
  ChildSendResult,
  ChildStateResult,
  ChildTalkRefusal,
  ChildWorkResult,
  TranscriptEvent,
} from '../../../shared/runtime-ipc'
import { appClosing } from '../lib/app-closing'
import { applyEvent, createTranscript, markReadOnly } from '../lib/transcript'
import DocumentBody from './DocumentBody.vue'
import TranscriptView from './TranscriptView.vue'

/**
 * Display the provider files recording what a sub-agent did.
 *
 * ## It is a conversation, so it is drawn as one
 *
 * A child's `.jsonl` is an ordinary Claude transcript, so it folds through the same `applyEvent`
 * and renders through the same components as any other conversation in this app — 036's rule, and
 * the reason this whole feature is small. Rendering it as markdown prose would have meant a second,
 * worse renderer for something already drawn well.
 *
 * ⚠️ **The toggle is Transcript/Raw rather than Markdown/Raw**, and the standing rule is kept, not
 * bent: paper, and never a rendering you cannot get behind. The left segment names what is actually
 * in the left pane. `WorkflowOutputViewer` makes the same call in the other direction — a `.jsonl`
 * journal opens on Raw, because rendering it as markdown produces one unreadable paragraph — and
 * the journal and the script still take {@link DocumentBody} whole, because they ARE documents.
 *
 * ## What it honestly cannot show
 *
 * ⛔ **No chain of thought** (109's rule, not optional). Claude's thinking blocks in these files are
 * empty strings with a signature — the model's reasoning is not in the file, and a viewer that
 * implied otherwise would be promising something no byte on disk contains. So the count is stated
 * and the absence is said out loud, rather than drawn as an empty card the reader is left to
 * interpret.
 *
 * ## ⚑ It FOLLOWS, since 296 — and that half is not provider-specific
 *
 * This was a one-read snapshot for four dispatches. It now re-reads while it is open, which took no
 * new parser and no new channel: both providers write a child's record as the child works, so a
 * second read of the same file is simply a longer one. ⚠️ **Measured rather than assumed** — 173
 * polls of a live Claude child's `.jsonl` across two runs saw 173 growths, **zero** reads that
 * caught a half-written line, and **zero** that did not end on a newline. That is why the refresh is
 * a plain re-read and not an offset reader: `items` below rebuilds the whole fold from scratch every
 * time, so a longer file cannot double anything.
 *
 * ⛔ **The one thing following cannot do is outlive the byte ceiling.** A child that writes more than
 * `MAX_CHILD_WORK_BYTES` is read as its first megabyte for ever, so the screen stops changing while
 * the child does not — {@link outgrown} says so out loud rather than letting a frozen view read as a
 * finished one.
 *
 * ## ⚠️ Read-only was BY CONSTRUCTION, and 296 moved it deliberately
 *
 * The four-part answer is still here for the RECORD: `TranscriptView` gets no `@decide` and no
 * `@respond`, and the items go through {@link markReadOnly} first, so a permission card the child
 * answered in its own conversation cannot be answered again from this window. ⛔ **What changed is
 * that the channel is no longer one-directional.** `295` measured a Codex child accepting a new
 * turn while its parent was still running, so this viewer now has a composer — and 109 item 7's
 * ruling that *"a generic resume would be false for both providers"* is honoured by not writing a
 * generic one: the composer is drawn from what the provider ANSWERS about this child, not from a
 * capability flag and never from which provider it is.
 *
 * ⛔ **And it refuses while the child is working.** See `packages/runtime/src/child-conversation.ts`
 * for the seven-line wire trace that ruling comes from.
 */
const props = defineProps<{
  result: ChildWorkResult
  /** Who this is — the agent's own label, or the run's name for a journal or a script. */
  label: string
  /**
   * The child this is, when it is a child (296).
   *
   * ⚠️ **Null for a journal and for a script**, which belong to a RUN and not to an agent — the same
   * split `ChildWorkInput` makes, carried one layer further so this component cannot offer a
   * composer for something that is nobody's conversation.
   */
  agent?: string | null
  /** Re-read the record. Absent means this mount does not follow — the pre-296 behaviour. */
  onRefresh?: () => Promise<void>
  /** Ask the provider what this child is doing. Absent means nothing here asks. */
  onReadState?: (agentId: string) => Promise<ChildStateResult>
  /** Offer the child a message. Absent means this mount cannot send, whatever the provider allows. */
  onSend?: (agentId: string, text: string) => Promise<ChildSendResult>
}>()

const emit = defineEmits<{ close: [] }>()

const view = ref<'transcript' | 'raw'>('transcript')

/**
 * ⚠️ **Two seconds, and the number is chosen against a measurement rather than a feeling.** A live
 * child was writing roughly a kilobyte a second in the runs above, so this is about two kilobytes of
 * new conversation per refresh — small enough that a reader never watches a still screen, large
 * enough that a megabyte-capped file is not re-read fifty times a second. It is also the poll for
 * the child's STATE, which is what the composer is drawn from.
 */
const FOLLOW_EVERY_MS = 2_000

/** What the provider last said about this child, or null until it has been asked. */
const childState = ref<ChildStateResult | null>(null)
/** What the last send produced. Cleared the moment the box is typed in again. */
const sent = ref<ChildSendResult | null>(null)
const draft = ref('')
const sending = ref(false)
/**
 * Whether the state poll is still worth making. See {@link refresh} — a refusal that cannot change
 * while this window is open stops the asking, and `unreachable` is the only one that can.
 */
const keepAsking = ref(true)

/**
 * Whether this mount can offer a composer at all — before the provider has said anything.
 *
 * ⛔ **Three facts, and not one of them is which provider this is** (039's rule, and
 * `provider-neutrality.test.ts` enforces it): there has to be a child, a channel to ask on, and a
 * channel to send on. What the PROVIDER allows arrives later, as an answer.
 */
const addressable = computed(
  () =>
    props.result.ok &&
    props.result.part === 'transcript' &&
    typeof props.agent === 'string' &&
    props.agent.length > 0 &&
    props.onReadState !== undefined &&
    props.onSend !== undefined,
)

/**
 * ⛔ **The file outgrew what BroBot follows.** Distinct from the plain `truncated` banner because the
 * consequence is different: a snapshot of the first megabyte is an honest snapshot, while a FOLLOW
 * that has stopped moving looks exactly like a child that has stopped working.
 *
 * ⚠️ **`part === 'transcript'` is load-bearing and was missing from the first version.** The
 * adversarial pass found it and then found the file that proves it: there is a **1,107,296-byte**
 * workflow journal on this machine, and `readChildWork` applies the same `MAX_CHILD_WORK_BYTES` cap
 * to all three parts — so opening that run's journal printed *"This child has written more than
 * BroBot follows"* under a heading naming a workflow RUN. A journal is nobody's child, and
 * `refreshChildWork` returns immediately for one, so the sentence named a thing that did not exist
 * and a follow that had never started.
 */
const outgrown = computed(
  () =>
    props.onRefresh !== undefined &&
    props.result.ok &&
    props.result.part === 'transcript' &&
    props.result.truncated,
)

/**
 * What this transcript is, said on its face — the same shape `ReadingPane`'s note has.
 *
 * ⚠️ **It does not claim the child has FINISHED.** Review caught the first wording doing exactly
 * that: a running agent's file is readable and growing, so "this sub-agent has finished" would have
 * been a confident statement about a child still working. What is true of every one of them is that
 * this is a record.
 *
 * ⛔ **The second half stopped being true in 296 and the sentence changed with it.** It used to end
 * *"and nothing here can answer"*, which was the whole truth while the channel had one direction.
 * With a composer on screen it would be a sentence contradicted by the box beneath it — so the note
 * now says the precise thing that is still true: the CARDS in this record were settled elsewhere.
 */
const readOnlyNote = computed(() =>
  addressable.value
    ? 'This is a sub-agent’s own record — anything it was asked here was answered in its own ' +
      'conversation, not in this window. The box below sends it something new.'
    : 'This is a sub-agent’s own record — read-only, and nothing here can answer.',
)

/**
 * The one sentence for each way a child cannot be spoken to (296).
 *
 * ⛔ **One table, because there is one vocabulary** — `ChildTalkRefusal` is shared by the read and
 * the send precisely so this map is exhaustive and a reader meets the same word twice rather than
 * two paraphrases of it. ⚠️ **No provider is named in any of them**, and that is 039's rule rather
 * than vagueness: what a person needs is what they can do next.
 */
const TALK_REFUSAL: Record<ChildTalkRefusal, string> = {
  'unknown-agent':
    'This conversation has no record of that agent, so there is nothing to speak to. The child is found from the run this app recorded — not by searching the disk.',
  unsupported:
    'This agent cannot be spoken to. Its provider writes down what a sub-agent did and offers no way back into one, so this record is the whole of what there is.',
  'not-live': 'Send this conversation a message first — a sub-agent is spoken to through it.',
  // ⛔ **This said "Nothing was sent" and that was a promise this path cannot keep** (adversarial
  // pass). One word serves both verbs, and on the SEND side the request may already be on the wire:
  // `withDeadline` releases the awaiter and its own docblock says in as many words that it does not
  // cancel the work. `session-store.ts` documents the same uncertainty for a failed bridge — *"may
  // or may not have reached the app-server, and this app has no way to tell which"* — so the
  // sentence at the surface was contradicting the comment two layers under it.
  unreachable:
    'The agent was asked and did not answer inside the time BroCrew waits. This says nothing about what the child is doing, and if a message was being sent, BroCrew cannot tell whether it arrived.',
  // ⛔ **This ended "It will send once the child is idle" and NOTHING queues it** (adversarial pass).
  // `send()` keeps the draft and stops; there is no retry, no queue, and `session-store.ts` says so
  // by name. A person who read that sentence and walked away had a message that was never going to
  // be delivered — which is the same class of false statement the ruling itself is about, made by
  // the sentence that explains the ruling.
  working:
    'The child is still working, so BroCrew will not send this now. A message that arrives mid-turn does not start a new one — it joins the turn already running and ends it early, while the command that turn started keeps going. Your message is still in the box; send it again once the child is idle.',
  'not-accepting':
    'The child is idle and its provider still will not take direct input for it. That is the provider’s answer about this thread, not a rule of this app.',
  unloaded:
    'The provider is not holding this child open, so there is nothing listening. Its record is still here to read.',
  error: 'The provider reports this child in an error state, so nothing will reach it.',
}

/** What the state read produced, as one sentence — the line the composer is labelled with. */
const stateNote = computed(() => {
  const answer = childState.value
  if (answer === null) return null
  if (!answer.ok) return TALK_REFUSAL[answer.reason]
  const refusal = refusalOf(answer)
  if (refusal !== null) return TALK_REFUSAL[refusal]
  return 'This child is idle and will take a message.'
})

/**
 * ⚠️ **The composer's own copy of the rule, and it is the ONLY one in the renderer** (169 §1).
 *
 * It deliberately does not import `childInputRefusal` from the runtime: this predicate answers *"may
 * I draw a live box"*, and the authority on *"may this be written"* is the main process, which asks
 * the real one immediately before the wire write. ⛔ **They can disagree for one poll interval and
 * that is by design** — a child that starts working between the draw and the press is refused by the
 * host, and the refusal it returns is what the box then says.
 */
function refusalOf(answer: Extract<ChildStateResult, { ok: true }>): ChildTalkRefusal | null {
  if (answer.state.status === 'working') return 'working'
  if (answer.state.status === 'unloaded') return 'unloaded'
  if (answer.state.status === 'error') return 'error'
  if (answer.state.acceptsInput === false) return 'not-accepting'
  return null
}

/** Whether the box may be typed in and pressed right now. */
const canSend = computed(
  () =>
    addressable.value &&
    !sending.value &&
    childState.value?.ok === true &&
    refusalOf(childState.value) === null &&
    draft.value.trim().length > 0,
)

/**
 * ⛔ **Three reasons a tick does nothing, and all three came out of the adversarial pass.**
 *
 * 1. **In flight.** `refresh` is not instant — for a Codex child the record read copies the
 *    provider's state database before it opens the rollout. Without this, a read slower than two
 *    seconds stacks a second one on top of it, then a third, and the queue never drains.
 * 2. **Closing.** ⚠️ `DURING_A_QUIT` refuses both of these commands, so a viewer left open during a
 *    quit was throwing an unhandled rejection every two seconds while the app tore itself down —
 *    the class `273` §1 is about, arriving through a timer nobody had thought about.
 * 3. **Outgrown.** A record already past `MAX_CHILD_WORK_BYTES` reads back byte-identical for ever.
 *    Re-reading it is the most expensive tick this component can make and the only one that is
 *    guaranteed to change nothing. ⚑ The STATE poll continues — the child is still doing something,
 *    and the composer is still drawn from what it says.
 */
let inFlight = false

async function refresh(): Promise<void> {
  if (inFlight || appClosing.value) return
  inFlight = true
  try {
    await readOnce()
  } finally {
    inFlight = false
  }
}

async function readOnce(): Promise<void> {
  const agent = props.agent
  const ask = props.onReadState
  // ⚠️ Both awaited together rather than raced: the record and the state are two halves of one
  // answer, and a screen that updated one of them a tick before the other would show a finished
  // transcript beside "still working" for exactly as long as anybody was looking at it.
  await Promise.all([
    // ⛔ Not `props.onRefresh?.()` unconditionally: see reason 3 above.
    outgrown.value ? undefined : props.onRefresh?.(),
    ask && typeof agent === 'string' && agent.length > 0 && keepAsking.value
      ? ask(agent).then((answer) => {
          childState.value = answer
          // ⛔ A refusal that will not change on the next tick stops the asking. `unreachable` is
          // the one that CAN change, so it alone keeps the poll alive — the other three are facts
          // about the provider, the session or the ledger, and none of them moves while a viewer is
          // open. Polling them would be a request per two seconds that cannot produce news.
          if (!answer.ok && answer.reason !== 'unreachable') keepAsking.value = false
        })
      : undefined,
  ])
}

let following: ReturnType<typeof setInterval> | undefined

/**
 * ⚠️ **`onMounted`, and not the top level of `<script setup>`.** The `desktop` project renders these
 * components with `renderToString` in a Node environment with no `document` and no timers to speak
 * of; a `setInterval` at module scope would run during SSR and would break every render test that
 * imports this file, which is the failure `ssr-setup.render.test.ts` exists for.
 */
onMounted(() => {
  if (props.onRefresh === undefined && props.onReadState === undefined) return
  void refresh()
  following = setInterval(() => void refresh(), FOLLOW_EVERY_MS)
})

onBeforeUnmount(() => {
  if (following !== undefined) clearInterval(following)
})

/**
 * ⛔ **The press re-asks the host rather than trusting {@link canSend}.** The button is drawn from a
 * state that is up to two seconds old; the answer that decides is the one the main process gets when
 * it looks. So a refusal here is normal, it is shown, and the draft is KEPT — a message refused
 * because the child got busy is a message the person still wants to send.
 */
async function send(): Promise<void> {
  const agent = props.agent
  const offer = props.onSend
  if (!offer || typeof agent !== 'string' || agent.length === 0) return
  const text = draft.value
  if (text.trim().length === 0) return
  sending.value = true
  try {
    const answer = await offer(agent, text)
    sent.value = answer
    // Cleared only on the way through: a refused message stays in the box.
    if (answer.ok) draft.value = ''
    // The child is working now if it took it, and its own record will say so within one refresh.
    await refresh()
  } finally {
    sending.value = false
  }
}

/** The child's conversation, folded exactly as a live one is. */
const items = computed(() => {
  if (!props.result.ok || props.result.entries === undefined) return []
  const state = createTranscript()
  for (const event of props.result.entries as TranscriptEvent[]) applyEvent(state, event)
  markReadOnly(state, readOnlyNote.value)
  return state.items
})

/**
 * ⚠️ **Thinking, counted rather than described** — and counted in the MAIN process, off the records
 * themselves, because it cannot be counted here.
 *
 * Measured: every thinking block in every child file on this machine has an empty body and a
 * signature, and `importClaudeTranscript` therefore drops it — so `items` below contains none of
 * them however many the file held. Saying "3 thinking blocks were recorded with no body" is the
 * true sentence; drawing three empty cards would claim more, and silence would read as a child that
 * did not think.
 */
const thinkingBlocks = computed(() => (props.result.ok ? (props.result.thinkingBlocks ?? 0) : 0))

const NO_RECORD = 'This conversation has no record of that agent'
const FOUND_FROM_THE_RUN =
  'The transcript is found from the run this app recorded — not by searching the disk.'

const REFUSAL: Record<string, string> = {
  'unknown-agent': `${NO_RECORD}, so there is nothing to open. ${FOUND_FROM_THE_RUN}`,
  // ⚑ 115: a Codex child now opens its own rollout. What is left here is the artefact that does not
  // exist rather than the one we cannot read — a thread belongs to no run, so it has no journal and
  // no script to open.
  unsupported:
    'This child is a thread of its own rather than part of a workflow run, so there is no journal and no script to open.',
  // ⚠️ Two causes, one sentence, and it names both — review found the first version asserting the
  // second about an agent that had simply not written anything yet.
  gone: "There is no file for that yet. A child writes its record as it works, in the provider's home beside its parent's — so this is either an agent that has not started, or a home that has since been cleaned.",
  // ⚑ 731 · refused only when this viewer cannot draw it as text (a binary, UTF-16, a folder, a
  // fifo, a socket) — no longer for its name: until `731` a Codex child's rollout had to end
  // `.jsonl`, and this read *"That path is not something this app will open."*
  'not-readable': 'That file cannot be shown as text here.',
  unreadable: 'The file is there, and could not be read.',
}

/**
 * 🔴 **712 · `697` H-a — *no record of that agent* is true of the rows this app could READ.**
 * ⛔ Since `697` a torn `sub_agent`/`workflow_run` row is skipped rather than raised, so beside
 * `rowsUnread` above 0 the agent may be reported in a row nobody could parse; ⚑ the sentence then
 * says so, and by how many rows. ⚠️ Only beside `unknown-agent`: the other reasons are about a file
 * or a kind the read DID find.
 *
 * ⛔ **Not the talk note's *"…nothing to speak to"*** (`TALK_REFUSAL`), which is the live channel's:
 * `ChildStateResult`/`ChildSendResult` carry no count (`697`: *"warned, not counted"*), and borrowing
 * this read's count for that read would be a number about a different walk — reported as a GAP.
 */
const refusal = computed(() => {
  if (props.result.ok) return null
  const unread =
    props.result.reason === 'unknown-agent' ? absenceUnreadSays(props.result.rowsUnread) : null
  if (unread !== null)
    return `${NO_RECORD} ${unread}. There is nothing to open. ${FOUND_FROM_THE_RUN}`
  return REFUSAL[props.result.reason] ?? 'That could not be opened.'
})

const PART_WORD: Record<string, string> = {
  transcript: 'transcript',
  journal: 'journal',
  script: 'script',
}
</script>

<template>
  <div class="child-work" data-cy="child-work-viewer">
    <header class="viewer-head">
      <!-- ⚠️ **Hooked since 115**: this is who the reader thinks they opened, and it was the one
           thing on this header no test in the repo could even select. The label travels with the
           request from the card that raised it, and an empty one is a heading that says nothing. -->
      <strong class="name" data-cy="child-work-label">{{ label }}</strong>
      <span v-if="result.ok" class="file" data-cy="child-work-name">{{ result.name }}</span>
      <!-- The run it belongs to, when it belongs to one. A plain Task child is in no run and this
           says nothing rather than inventing a name for the absence (086/104). -->
      <span v-if="result.ok && result.runId" class="file" data-cy="child-work-run">
        {{ result.runId }}
      </span>
      <span v-if="result.ok" class="part" data-cy="child-work-part">
        {{ PART_WORD[result.part] ?? result.part }}
      </span>
      <!-- ⚑ **What the sidecar knew and the card could not say** (115): the dispatch's own
           description, and the tool-use that made it. Only a plain `Task` child's `.meta.json`
           carries either — a workflow agent's says only that it is a workflow agent — so both are
           conditional, and their absence is silence rather than a blank. -->
      <span v-if="result.ok && result.title" class="asked" data-cy="child-work-title">
        {{ result.title }}
      </span>
      <span v-if="result.ok && result.parentToolCallId" class="file" data-cy="child-work-parent">
        from {{ result.parentToolCallId }}
      </span>
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

    <!-- Stated, never silent (092's rule). -->
    <p v-if="result.ok && result.truncated" class="cut" data-cy="child-work-truncated">
      Showing the first part of a {{ Math.round(result.bytes / 1024) }} KB file.
    </p>
    <p v-if="result.ok && result.unreadable" class="cut" data-cy="child-work-unreadable">
      {{ result.unreadable }}
      {{ result.unreadable === 1 ? 'line' : 'lines' }} in this file could not be parsed.
    </p>

    <!-- ⛔ **The follow has hit the ceiling** (296). Louder than the `truncated` line above and
         beside it rather than instead of it: that one says how big the file is, this one says the
         thing a reader would otherwise get wrong — that a screen which has stopped changing is not
         a child that has stopped working. -->
    <p v-if="outgrown" class="cut" data-cy="child-work-outgrown">
      This child has written more than BroCrew follows, so what is on screen has stopped changing
      whether or not the child has.
    </p>

    <!-- A CHILD'S TRANSCRIPT: the conversation, with the bytes behind it. -->
    <template v-if="result.ok && result.part === 'transcript'">
      <div class="seg-bar">
        <span class="seg-group">
          <button
            class="seg"
            :class="{ on: view === 'transcript' }"
            type="button"
            data-cy="child-view-transcript"
            @click="view = 'transcript'"
          >
            Transcript
          </button>
          <button
            class="seg"
            :class="{ on: view === 'raw' }"
            type="button"
            data-cy="child-view-raw"
            @click="view = 'raw'"
          >
            Raw
          </button>
        </span>
      </div>
      <div class="stage" :data-view="view">
        <!-- Use `data-on-white` for the paper transcript so text uses readable ink even under a dark ambient theme. `--paper-bg` stays white; the ambient dark conversation ramp is too light for it.

             Use `data-on-white` instead of claiming a light chat theme. This white surface is independent of the reader's chat setting and must not add a second `data-chat-theme` carrier. -->
        <div class="paper" data-on-white data-cy="child-work-paper">
          <p v-if="thinkingBlocks" class="note" data-cy="child-work-thinking-note">
            {{ thinkingBlocks }} thinking
            {{ thinkingBlocks === 1 ? 'block was' : 'blocks were' }} recorded with no body — the
            provider keeps a signature, not the reasoning.
          </p>
          <p v-if="items.length === 0" class="note" data-cy="child-work-empty">
            This file holds no conversation this app could read.
          </p>
          <!-- ⛔ No `@decide`, no `@respond`, no composer: there is nothing here that can send. -->
          <TranscriptView
            v-if="view === 'transcript'"
            :items="items"
            mode="normal"
            who="sub-agent"
          />
          <pre v-else class="view-raw" data-cy="child-work-raw">{{ result.text }}</pre>
        </div>
      </div>

      <!-- ⛔ **The composer** (296), and it is drawn from what the provider said about THIS child —
           never from which provider it is (039's rule, `provider-neutrality.test.ts`). The whole
           block is absent when this mount has no channel at all; when it has one, the sentence is
           always present, because a dark box with no explanation is the thing 169 was about. -->
      <div v-if="addressable" class="talk" data-cy="child-talk">
        <p class="talk-note" data-cy="child-talk-note">
          {{ stateNote ?? 'Asking the agent what this child is doing…' }}
        </p>
        <textarea
          v-model="draft"
          class="talk-box"
          data-cy="child-talk-input"
          rows="2"
          :placeholder="`Say something to ${label}`"
          :aria-label="`Say something to ${label}`"
          @input="sent = null"
        ></textarea>
        <div class="talk-row">
          <!-- ⚠️ **`disabled` and not merely dimmed**, so the keyboard reaches exactly what the
               mouse does — 223's rule about never promising a gesture the mount has switched off. -->
          <button
            class="talk-send"
            type="button"
            data-cy="child-talk-send"
            :disabled="!canSend"
            @click="send()"
          >
            {{ sending ? 'Sending…' : 'Send' }}
          </button>
          <span v-if="sent && sent.ok" class="talk-said" data-cy="child-talk-sent">
            Sent. The child's own record will show it on the next refresh.
          </span>
          <span v-else-if="sent" class="talk-said" data-cy="child-talk-refused">
            {{ TALK_REFUSAL[sent.reason] }}
          </span>
        </div>
      </div>
    </template>

    <!-- A JOURNAL or a SCRIPT: genuinely documents, so they take the document body whole — paper,
         and the Markdown/Raw toggle, opened on Raw because neither is prose. -->
    <div v-else-if="result.ok" class="stage">
      <DocumentBody :source="result.text" :filename="result.name" :raw="true" />
    </div>

    <p v-else class="refusal" data-cy="child-work-refusal">
      {{ refusal }}
    </p>
  </div>
</template>

<style scoped>
/*
 * Use a declared opaque surface token for the panel. An undefined `--surface-1` made the background declaration invalid, leaving the panel transparent over the overlay backdrop.

   `--drawer-solid`, because it already means exactly this and already has both values: *"the
   drawer's opaque fill when it floats over the transcript"*. This panel floats over the transcript
   too, and it is inside the conversation's `data-chat-theme` scope — so the token follows the
   theme, near-black on dark chrome and white on paper, which is what every other token in this
   block already does. ⚠️ **`--panel` (the house modal fill) had no light value when this was
   written and would have painted #0d1118 on a light page; 344 gave it one, so the argument against
   it is now the weaker "it means a different thing" rather than "it is a dark island".**
   `--paper-bg` still has no dark value and would put this header's near-white `--text-soft` on
   white — the trap 091 caught with `--panel-3`, in the other direction. */
.child-work {
  display: flex;
  max-width: min(900px, 92vw);
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
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.file {
  color: var(--faint);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.part {
  color: var(--accent-2-text);
  font-size: var(--type-caption);
}

/* What it was asked to do. It clips rather than wrapping: the header is one line, and a long
   description must not push the close button off the row. */
.asked {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  margin-left: auto;
}

.cut,
.note {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: var(--type-caption);
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

/* ⛔ **This said `var(--badge-ink)` — `#ffffff` in both themes — on `--accent`, which in dark is
   the pale `#7dbbff`: white on pale blue, 2.01:1** (126). `--accent-ink` is the token that MEANS
   "ink on a solid accent fill", and it is the one `DocumentBody`'s identical segmented control has
   used all along: near-black on dark's pale accent (9.43:1), white on light's `#2563eb` (5.17:1).
   Same control, same two shipped values, one token apart. `--badge-ink` is the plate's own white
   disc and belongs to `AgentState`. */
.seg.on {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.stage {
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

/* The paper, which is the standing rule for anything read as a document (092/107). The child's own
   conversation sits on it for the same reason the run's output does: it is a thing to be read. */
.paper {
  padding: var(--space-6);
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-paper);
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
  color: var(--paper-ink);
}

.paper .note {
  border-bottom: var(--border-width) solid var(--paper-line);
  color: var(--paper-muted);
}

.view-raw {
  margin: 0;
  color: var(--paper-ink2);
  font: var(--type-small) / 1.65 var(--font-mono);
  white-space: pre-wrap;
}

.refusal {
  margin: 0;
  padding: var(--space-6) var(--space-5);
  color: var(--muted);
  font-size: var(--type-caption);
}

/* The composer (296). ⚠️ **Outside `.paper`, deliberately.** The paper is the child's own record —
   a white island whatever the theme, for the reason 126 gives above — and this is not part of that
   record: it is this window speaking. Putting it on the paper would draw a message that has not been
   sent as though it were already in the transcript. So it sits on the panel's own chrome, in the
   ambient theme, exactly where a composer sits everywhere else in this app. */
.talk {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-3);
}

.talk-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.talk-box {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-field-legacy);
  background: var(--wash-2);
  color: var(--text);
  font: var(--type-small) / 1.5 inherit;
  resize: vertical;
}

.talk-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.talk-send {
  height: 26px;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-xs);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

/* ⛔ `--accent-ink` on `--accent` above, and NOT `--badge-ink`: the identical trap the segmented
   control's own comment records, one control over and in the same file. */
.talk-send:disabled {
  background: var(--wash-2);
  color: var(--faint);
}

.talk-said {
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
