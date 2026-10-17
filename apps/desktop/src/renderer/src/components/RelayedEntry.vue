<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { pieceSays, RELAYED_MARK, relayedSender } from '../lib/relayed-turn'
import { fromOutside, THIS_CONVERSATION } from '../lib/from-outside'
import { MESSAGE_KIND_WORD } from '../lib/outgoing-card'
import { jsonInWords } from '../lib/words-with-json'
import OutsideCard from './OutsideCard.vue'
import MarkdownWords from './MarkdownWords.vue'
import { workIsWith } from '../lib/where-the-work-is'
import WordsViews from './WordsViews.vue'
import ReadableWords from './ReadableWords.vue'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import type { RelayedItem, TranscriptItem } from '../lib/transcript'
import type { FilesOnScreen } from '../lib/files-kept'
import type { WorkEdge } from '../../../shared/who-called-whom'
import FileRows from './FileRows.vue'
import ModelGotSwitch from './ModelGotSwitch.vue'

/**
 * 🔴 **Words another conversation wrote, drawn as somebody else's** (413, HO-020 §5.3).
 *
 * ## ⛔ What this row was until this dispatch, on both providers, measured
 *
 * ⚠️ **`410` counted it live** — *"1 unattributed turn on Codex, 2 on Claude, on the project
 * manager"* — and the producer behind the one that fires on BOTH is `message_agent`, which was how
 * every piece of work in this product was handed over until D-016 made that `give_work`'s. ⛔ **A
 * task one agent gave another was drawn under `<strong>You</strong>`, with the person's own
 * avatar.** `214` removed 12,646 messages of
 * exactly that shape; `278` built `ContinuationEntry.vue` so the go-ahead would not be one more;
 * `406` built `WorkReportEntry.vue` for the two paths after that. ⚑ This is the fourth and the
 * fifth, and unlike the others it is not an occasional notice — it is the product's main verb.
 *
 * ## 🔴 Why it is not `ContinuationEntry`, which is the reason `406` left one producer unmarked
 *
 * ⛔ **That entry says *sent for you*.** It is true of the go-ahead and it is the OPPOSITE of what
 * is true here: nobody pressed anything, and the words are not being sent on the reader's
 * behalf — they are being shown to them. ⚑ `406`'s own note: *"Marking it without building its
 * entry would render a child's question under the go-ahead's authorship line, which is false."*
 * This is that entry.
 *
 * ## ⚠️ It names the relayer since `545` — see `relayed-turn.ts`, and `HO-054` §3
 *
 * ⛔ **No invented actor, and that clause is untouched.** The CONVERSATION is on the ledger row and
 * never on this bubble: a `sess_…` handle dressed as a sender is an actor invented out of an id.
 * ⚑ **What moved is that the row now holds the relaying conversation's IDENTITY** — `449` made one
 * resolvable and `545` put it on the event — so the heading is {@link relayedSender}, the app's one
 * naming function, and reads *project-manager* where it used to read *BroBot*.
 *
 * ⚠️ **On a row this app cannot name — every row written before `545` — the heading is
 * `AN_UNNAMED_RELAYER`**, which says what it can rather than inventing a name. ⛔ The fact a person
 * needs is still the one they did not have: **they did not write this.**
 *
 * ## ⛔ A MARK, never a re-hue — `406`'s rule, still standing
 *
 * ⚠️ **Nothing here spends the `--waiting` ramp**, opens a live region or adds a row to any queue.
 * Amber means frozen, waiting for a human; a task arriving is neither.
 *
 * ## 🔴 658 · a card, shifted — and the frame ruling this row carried is REVERSED, on purpose
 *
 * Use {@link OutsideCard}, shifted right with no participant avatar, so a relayed sender does not appear to be present in this conversation or able to read its input. Name the sender through {@link relayedSender} and the recipient through `ownAgent`, falling back to this conversation. Ask `fromOutside` whether to shift; relayed turns are outside by kind.
 */
const props = defineProps<{
  withinAnswer?: boolean
  item: RelayedItem & Pick<TranscriptItem, 'at' | 'ordinal'>
  /**
   * ⚑ **The identity roster, so the heading can say the name a person gave the relayer** (449's
   * {@link agentName}, through {@link relayedSender}).
   *
   * ⛔ **Optional and `null`-tolerant for `ConversationPane`'s reason**: the read is asynchronous
   * and can fail, so *the roster has not landed* is a state this row has to draw — and it draws the
   * slug, which is the word every other surface uses for an identity nobody has named.
   */
  identities?: readonly AgentIdentity[] | null
  /**
   * 🔴 **658 · the RECIPIENT — this conversation's own agent, as the pane names it.**
   *
   * ⛔ **The same string the conversation's own rows are headed with** (`ConversationPane`'s `who`
   * is derived FROM it), never a second derivation — so *"Ada to BroBot"* and the agent's own
   * replies cannot name one agent two ways.
   *
   * ⚠️ **667 · and `null` where nothing names it** — a recording headed its replies *claude* and a
   * sub-agent's work *sub-agent*, and both reached this heading as names. ⛔ `null` is drawn as
   * {@link THIS_CONVERSATION}, never as a provider.
   */
  ownAgent: string | null
  /**
   * ⚑ **UI-002 · the files this conversation's tree has read** — the inputs kept on the piece these
   * words give are drawn as rows under them. ⛔ Absent or `null`: none drawn, as before.
   */
  kept?: FilesOnScreen | null
  /** ⚑ `true` where a reader can open a file, so each row is a press. */
  canOpenDocument?: boolean
  /**
   * ⚑ **The work this conversation was given, as the cast last read it** — when each piece was
   * given, so a brief lists the inputs kept by then and not the ones its giver added later.
   */
  takenIn?: readonly WorkEdge[] | null
  held?: ReadonlySet<string> | null
}>()

const emit = defineEmits<{
  /** ⛔ Emitted, never performed — `WorkReportEntry`'s rule. */
  openDocument: [resourceId: string]
  openConversation: [sessionId: string]
}>()

/** ⚑ **545 · one derivation**, asked here and in `QueuedMessage` — see {@link relayedSender}. */
const sender = computed(() =>
  relayedSender(props.item.relayedFromProfile, props.identities ?? null),
)
const outside = computed(() => fromOutside(props.item))
const recipient = computed(() => props.ownAgent ?? THIS_CONVERSATION)
/**
 * 🔴 **678 · the piece these words give, or give a new brief** — `null` when they name none. See
 * {@link pieceSays}.
 */
const opened = computed(() => pieceSays(props.item.opened))

/**
 * 🔴 **UI-002 · the inputs handed over with these words** (`07` §2 item 1) — kept on the piece they
 * give, by its label. ⛔ None where they give no piece.
 */
const inputs = computed(() => {
  const label = props.item.opened?.label
  if (label === undefined) return []
  // ⚑ The inputs as they stood at this brief: the give's own (kept when it was given), and for a
  // new brief later, those added by then. ⛔ No edge read: every input on the piece, as before.
  const edge = props.takenIn?.find((one) => one.label === label)
  const until = edge === undefined ? undefined : Math.max(edge.givenAt, props.item.at ?? 0)
  return props.kept?.inputsOn(label, until) ?? []
})

/**
 * ⚑ **Readable | Raw, when the words carry JSON** — the sender's card's two views, one end over
 * (`lib/words-with-json.ts`). ⛔ Raw is this body exactly as it went to the provider (`001`).
 */
const jsonParts = computed(() => jsonInWords(props.item.text))
const view = ref<'readable' | 'raw'>('readable')
</script>

<template>
  <component
    :is="withinAnswer ? 'div' : OutsideCard"
    class="relayed"
    :shifted="outside !== null"
    data-cy="relayed"
    :exchange="
      withinAnswer
        ? undefined
        : {
            from: sender,
            to: recipient,
            kind: item.opened ? 'work' : item.says ? MESSAGE_KIND_WORD[item.says] : 'message',
            label: item.opened?.label,
            text: item.text,
            at: item.at,
            where: workIsWith({ owner: item.relayedFrom }, props.held ?? null),
          }
    "
    @open-conversation="(id: string) => emit('openConversation', id)"
  >
    <div class="msg-meta">
      <!-- The recipient is already in the card's heading. -->
      <strong class="heading" data-cy="relayed-heading"
        ><span data-cy="relayed-sender">{{ sender }}</span></strong
      >
      <!-- 🔴 **678 · the words arrived as WORK** — the piece they give, or give a new brief, in the
           position and the ink the outgoing reply card draws its piece in, so both ends of an
           exchange read alike. -->
      <strong v-if="opened !== null" class="task" data-cy="relayed-task">{{ opened }}</strong>
      <!-- 🔴 **688 · what the SENDER said these words are** (`687` H1) — the word the sender's own
           card draws in its mark position, so both ends of one exchange read alike. ⛔ Nothing when
           it is not recorded: never *question* by default. -->
      <span v-if="item.says" class="about" data-cy="relayed-says">{{
        MESSAGE_KIND_WORD[item.says]
      }}</span>
      <span class="about" data-cy="relayed-mark">{{ RELAYED_MARK }}</span>
      <!-- In the META row, never inside the body — 001's rule: the message's `textContent` has to
           be exactly what went to the provider, which is what a copy, a search or an assertion
           gets. Putting the clock in the body once turned "PINGPONG" into "PINGPONG00:55". -->
      <WordsViews v-if="jsonParts" v-model="view" class="views" />
      <span class="time" :class="{ beside: jsonParts }">{{ clockTime(item.at) }}</span>
    </div>
    <ReadableWords
      v-if="jsonParts && view === 'readable'"
      class="msg-body"
      data-cy="relayed-readable"
      :parts="jsonParts"
      :markdown="true"
      :title="fullTime(item.at)"
    />
    <div
      v-else
      class="msg-body"
      data-cy="relayed-message"
      :data-at="clockTime(item.at)"
      :title="fullTime(item.at)"
    >
      <MarkdownWords v-if="view === 'readable'" :text="item.text" />
      <template v-else>{{ item.text }}</template>
    </div>
    <FileRows
      :files="inputs"
      :can-open="props.canOpenDocument ?? false"
      @open-document="(resourceId) => emit('openDocument', resourceId)"
    />
    <ModelGotSwitch
      :words="item.text"
      :sent="item.sent"
      :together="item.sentWithOthers === true"
      :ordinal="item.ordinal"
    />
  </component>
</template>

<style scoped>
/* ⛔ **658 · no `.msg` grid and no avatar any more** — the frame is `OutsideCard`'s, a card shifted
   right, because the person's frame is what made another agent look like a participant. */
.msg-meta {
  display: flex;
  min-height: 20px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

/* ⚑ Discreet: the heading is quieter than a participant's name — muted ink, one step smaller. */
.heading {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.task {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.about {
  color: var(--faint);
  font-size: var(--type-caption);
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

/* ⚑ The views ride the meta row's right edge, just before the clock. */
.views {
  margin-left: auto;
}

.time.beside {
  margin-left: 0;
}

.relayed:hover .time {
  opacity: 1;
}

.msg-body {
  padding-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}
</style>
