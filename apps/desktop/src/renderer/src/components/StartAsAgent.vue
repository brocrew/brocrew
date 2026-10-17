<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  agentName,
  providerName,
  type CreateSessionInput,
  type HandedPath,
  type Provider,
  type ProviderCapabilityMap,
} from '../../../shared/runtime-ipc'
import { useAgentStore } from '../composables/useAgentStore'
import type { AgentStore } from '../lib/agent-store'
import { YOLO_MEANS } from '../lib/approval-mode'
import { shouldRestoreDraft } from './NewConversation.vue'
import PromptComposer from './PromptComposer.vue'

/**
 * 🔴 **The other door HO-023 §2 promised existed** (423 relay 1) — *"a new conversation is with
 * BroBot; every other session is placed somewhere."* This is *somewhere*.
 *
 * ## ⛔ Why this exists at all, and why creation was not enough
 *
 * HO-023 §3 makes the front door's merge conditional on **both** halves: after `417` merges a
 * person must still be able to **(a)** bring an identity into existence and **(b)** point a
 * conversation at a repository. ⚑ `423`'s creation form is (a). ⛔ **`424` measured that nothing
 * delivers (b)**: BroBot's own conversation now runs in `<userData>/brobot-workspace`, a spawn is
 * bounded by its parent's folder and the bound is monotone (HO-010 ruling 4), and `417`'s front
 * door sends `profileId: DEFAULT_PROFILE_ID` on every launch — so **once `417` merges, every
 * conversation a person can open is BroBot's, in the workspace, and so is everything it spawns.**
 *
 * 🔴 **This surface is the answer, and it is one `createSession` with two fields the front door
 * does not send:** the identity, and the folder it runs in.
 *
 * ## ⛔ What it is NOT
 *
 * ⛔ **Not a required folder.** ⚑ **D-016 · no folder chosen is a legal answer, not an error to
 * prevent** — the conversation then runs in the app's own workspace, exactly as the front door's
 * does, and the row below says so rather than refusing the press. A folder a person chooses is
 * checked by the host's own rule (`checkSessionCwd`) at the picker, and again at launch.
 *
 * ⛔ **Not the front door.** That one still asks nothing and still opens BroBot. The two doors
 * differ in exactly the two fields above and in nothing else: both send the approval mode the
 * PERSON set, both take their provider from the identity they open, and both make the first message
 * the conversation.
 *
 * ⚠️ **That clause said *"both send `approvalMode: 'ask'`"* until `500`**, and `HO-036` §3.1 made it
 * false in the direction that matters: *"a person sets their approval mode once, and every
 * conversation they start begins there"* — and this sheet starts one. ⚑ **The two doors still agree,
 * which is what the sentence was about**; what they agree on is a value rather than a constant.
 *
 * ⛔ **Not a picker put back on the launcher.** `417`'s ruling is that the FRONT DOOR asks nothing;
 * it is not that the app may never ask. This is the surface HO-022 §2 named: *"start a conversation
 * as another identity"*, from the roster.
 *
 * ## ⚑ One start path, still (013)
 *
 * The composer below is the SAME component the front door and every conversation use, and the
 * first message IS the conversation's first turn — so a session is never created empty. ⚠️ **The
 * screen owns the launch**, exactly as it owns the front door's: this sheet emits what it built and
 * `RuntimeScreen.start` is the one function that calls `store.create`.
 */
const props = defineProps<{
  /** The identity this conversation opens as — folded, and already a row. */
  profileSlug: string
  /**
   * ⚑ **Injectable for tests; the window's one store otherwise** (538) — `CapabilitiesSheet`'s
   * shape exactly, and for its reason.
   *
   * ⛔ **Nothing passes it in the product**, which is why it is optional: the singleton IS the
   * answer on a running window, and a prop the screen had to remember to pass would be a second
   * way for this sheet to be wrong. ⚠️ It exists because a roster that has not been READ cannot be
   * told apart from one that has no name in it, and `a-positive-assertion-must-differ-from-the-
   * default` is what that costs a test.
   */
  agents?: AgentStore
  /**
   * 🔴 **What it will run on, RESOLVED by the screen** (423 §3) — *this identity's provider, or the
   * app frame's fallback when it has not said*.
   *
   * ⛔ **Passed in rather than computed here**, so the sentence this sheet shows and the value the
   * launch sends are one value and cannot come apart — the same rule the front door's
   * `defaultProvider` follows, for the same reason.
   */
  provider: Provider
  /**
   * 🔴 **The mode this conversation will begin in, because a person set it once** (500,
   * HO-036 §3.1) — *"every conversation they start begins there"*, and this is the second door a
   * person starts one from.
   *
   * ⛔ **Resolved by the screen and passed in, exactly as {@link provider} is**, and for that
   * prop's own reason: the sentence this sheet shows and the value the launch sends are one value
   * and cannot come apart. ⚠️ **`null` is *the row has not been read yet***, and the launch sends
   * `'ask'` in that window — the safe word, and the only one this sheet is entitled to invent.
   *
   * ⚑ **There is no control here.** The setting is set once, at the front door; this sheet reads
   * it and DISCLOSES it, because a door that can begin unattended and says nothing is exactly the
   * gap `367` closed at the other two.
   */
  defaultApprovalMode: 'ask' | 'auto' | null
  /**
   * What each provider declares it can do (039) — **passed through only so this sheet can render
   * the adapter's own half of the yolo disclosure** for the provider it is about to launch on.
   *
   * ⚠️ Nothing here branches on it: the provider is a KEY, which is `039`'s rule and the shape
   * `a-mode-that-says-what-it-does.test.ts` §2 pins at every surface that reads the note.
   */
  capabilities: ProviderCapabilityMap | null
  /**
   * 🔴 **718 · `710` F-9 — whether THIS sheet's launch is running** (`SessionStore.isPlacing`,
   * scoped by the screen to the sheet that pressed). ⚑ The sheet stays up while it runs, in the
   * composer's own `starting` state with its Cancel — the launcher's shape (101 §8), at the second
   * door. ⚠️ Optional so a mount that has no launch to report reads as the idle sheet it always was.
   */
  busy?: boolean
  /**
   * 🔴 **718 · `710` F-9 — why THIS sheet's launch was refused**, or `null` — the host's own sentence
   * (`store.placedError`). ⛔ Until `718` a refusal from here was drawn only on the launcher, which
   * is not on screen when a person starts from a Team card: it showed nowhere.
   */
  error?: string | null
}>()

const emit = defineEmits<{
  /** Start it, with this first message and the paths handed to it (217). */
  start: [input: CreateSessionInput, firstMessage: string, attachments: HandedPath[]]
  /** ⚑ **718** — stop the launch this sheet is running (the composer's Cancel while `starting`). */
  cancel: []
  close: []
}>()

/**
 * 🔴 **538 · this door names the identity through the app's ONE naming function** (`537` F6, and
 * `449` before it).
 *
 * ## ⛔ What it said, and why that was a defect rather than a shortcut
 *
 * ⚠️ **It read `profileLabel(props.profileSlug)` in the header and `props.profileSlug` twice more
 * below** — the composer's `who` and its placeholder. ⛔ **So an identity somebody NAMED read one
 * way here and another way everywhere else**, which is `537`'s own defect arriving through a door
 * that dispatch could not reach: *"neither component is handed the roster"*.
 *
 * ## ⚑ It was never the roster that was missing
 *
 * ⛔ **The agent store is a window-scoped singleton**, so asking for it costs no prop, no parent
 * change and nothing `535` is drawing. ⚠️ **That is the correction to `537` F6's stated reason**:
 * the blocker was named as *threading a roster through*, and a singleton had already answered that
 * question.
 *
 * ## ⚠️ A roster that has not landed is today's behaviour exactly
 *
 * ⛔ **`agentName(slug, null)` IS `profileLabel(slug)`** — the older function, by construction
 * (`449`) — so a sheet opened before the read lands draws precisely the word this line used to
 * draw, and never a blank or a placeholder. ⚑ **The glyph is deliberately left on the SLUG**: it
 * is the same letter `SideRail`'s agent row derives, and two surfaces disagreeing about one
 * initial is the whole shape this dispatch is closing.
 */
const agents = props.agents ?? useAgentStore()
const who = computed(() =>
  agentName(props.profileSlug, agents.identities.value?.identities ?? null),
)

/**
 * ⚑ **D-016 · where it runs — a folder a person chose, or `null` for the app's own workspace**,
 * which is where the front door's conversations run and so where this one runs when nothing is
 * chosen: this sheet's silence means what the other door's does.
 */
const folder = ref<string | null>(null)

/**
 * ⛔ **Why the folder last chosen cannot be used** — `checkSessionCwd`'s own sentence, which names
 * the path — or `null`. ⚠️ A refused folder is never the one sent: {@link folder} keeps what it was.
 */
const folderRefusal = ref<string | null>(null)

async function chooseFolder(): Promise<void> {
  const chosen = await window.api.chooseCwd()
  // ⚑ **A cancel is a changed mind** (`ChosenCwd`), and it changes nothing here.
  if (chosen === null) return
  folderRefusal.value = chosen.refusal ?? null
  if (chosen.refusal === undefined) folder.value = chosen.path
}

/**
 * 🔴 **The adapter's own half of the yolo disclosure, for the provider this launch runs on** (500,
 * from 367). ⚑ **The same expression `useConversationControls` and the front door use** — indexed, never
 * recognised — because it is the same disclosure at a third moment of choice.
 */
const yoloReach = computed(() => {
  const status = props.capabilities?.[props.provider]?.approvals
  return status?.state === 'available' ? (status.note ?? '') : ''
})

const words = ref('')
const handed = ref<HandedPath[]>([])

/**
 * ⚑ **718 · what was last sent from here, so a refusal can hand it back** — the launcher's
 * `lastTried`, and {@link shouldRestoreDraft} is ITS rule, imported rather than restated: on a
 * falling edge, only on failure, only with something to give, and never over newer typing.
 */
let lastTried = ''

/**
 * 🔴 **718 · a Cancel pressed HERE owes the words back too** (`718`'s review). ⛔ A cancelled launch
 * sets no error — `102`: a Cancel is not a failure — so {@link shouldRestoreDraft} alone said nothing
 * and the words went with it, which is `015`'s *"a cancelled launch ate the message"* at the second
 * door. ⚑ The launcher gets its words back for a cancel through `firstMessageBelongsTo`'s `launcher`
 * arm; this sheet keeps its own, so it remembers that the press was its own.
 */
let cancelledHere = false

function cancel(): void {
  cancelledHere = true
  emit('cancel')
}

watch(
  () => props.busy ?? false,
  (busy, wasBusy) => {
    const error = props.error ?? null
    const settled = wasBusy && !busy
    const cancelledWithWords = settled && cancelledHere && lastTried !== '' && words.value === ''
    if (
      shouldRestoreDraft({ busy, wasBusy, error, lastTried, current: words.value }) ||
      cancelledWithWords
    ) {
      words.value = lastTried
    }
    // ⚑ Consumed once the attempt settles, however it ended — a later refusal never hands back an
    // earlier message.
    if (settled) {
      lastTried = ''
      cancelledHere = false
    }
  },
)

function startWith(text: string, _intent?: unknown, attachments: HandedPath[] = []): void {
  handed.value = attachments
  lastTried = text
  emit(
    'start',
    {
      provider: props.provider,
      profileId: props.profileSlug,
      // ⚑ **D-016 · omitted for the workspace**, which is what the host resolves an absent `cwd` to.
      ...(folder.value === null ? {} : { cwd: folder.value }),
      // 🔴 **The mode the PERSON set, like the other door** (500, HO-036 §3.1). ⛔ **This line used
      // to read `'ask'` with the note that `417`'s ruling *"is about every launch, not only the
      // front door's"* — and that is still true, which is exactly why it moved here too.**
      // HO-036 §3.1 is about every conversation a person starts, and this sheet starts one.
      // ⚠️ **`?? 'ask'` because `null` is *the row has not been read***, and a launch may only ever
      // send a word; the safe word is the one that keeps somebody being asked.
      approvalMode: props.defaultApprovalMode ?? 'ask',
    },
    text,
    attachments,
  )
}
</script>

<template>
  <section class="start-as-agent" data-cy="start-as-agent">
    <div class="sheet-header">
      <div class="sheet-glyph">{{ props.profileSlug.slice(0, 1).toUpperCase() }}</div>
      <div class="sheet-header-copy">
        <strong data-cy="start-as-agent-title">New conversation as {{ who }}</strong>
        <small>It will run on {{ providerName(props.provider) }}, in the folder below.</small>
      </div>
      <span class="spacer"></span>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </div>

    <div class="sheet-body">
      <div class="field">
        <span class="lbl">Folder</span>
        <!-- ⚑ **D-016 · the app's own workspace unless a person chooses a folder** — the front
             door's default, said rather than left blank. ⚑ The picker asks the host's own rule, so
             a folder that cannot be used is refused where it was chosen, with the host's sentence. -->
        <p v-if="folder" class="note mono" data-cy="start-as-agent-folder">{{ folder }}</p>
        <p v-else class="note" data-cy="start-as-agent-no-folder">
          The app's own workspace, unless you choose a folder.
        </p>
        <p v-if="folderRefusal" class="note refused" data-cy="start-as-agent-folder-refused">
          {{ folderRefusal }}
        </p>
        <div class="folder-acts">
          <button type="button" data-cy="start-as-agent-choose-folder" @click="chooseFolder">
            Choose a folder…
          </button>
          <button
            v-if="folder"
            type="button"
            data-cy="start-as-agent-use-workspace"
            @click="folder = null"
          >
            Use the workspace
          </button>
        </div>
      </div>

      <!-- 🔴 **What this conversation will do without asking, BEFORE the first message** (500, from
           367 / 329's *"before, not after"*). ⛔ **This door can now begin unattended**, because a
           person set the default once at the front door — so the sentence `417` removed from the
           launcher with its checkbox is owed here too, at the moment of choosing rather than after
           it. ⚑ **The same constant the other two surfaces render**, plus the ADAPTER's own note
           for the provider named in the header above: two halves, which `design-v2-map.ts` rules
           may not be split. ⚠️ **No control**: the setting is set once, at the front door, and a
           second place to press it would be two answers to one question. -->
      <p v-if="props.defaultApprovalMode === 'auto'" class="note warn" data-cy="yolo-means">
        {{ YOLO_MEANS }}
        <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span>
      </p>
    </div>

    <!-- ⛔ **The SAME composer the front door uses** (013, 217 §1). Not a second implementation:
         one `canSend`, one chip list, one picker call — and the first message IS the conversation,
         so this sheet can never create an empty one. -->
    <!-- 🔴 **718 · `710` F-9 — the refusal, where the press was made.** ⚑ The launcher's own box —
         its words, its register — because it is the same failure at the second door. ⚠️ The
         `data-cy` is on the SENTENCE, as the launcher's is, so a reader of it reads the host's words
         and nothing else. -->
    <div v-if="props.error" class="blocker" data-cy="start-as-agent-refused">
      <p class="b-head">
        <svg class="icon"><use href="#i-alert" /></svg>The launch didn’t start
      </p>
      <p class="b-body" data-cy="start-as-agent-error">{{ props.error }}</p>
    </div>

    <PromptComposer
      :state="props.busy ? 'starting' : 'idle'"
      :who="who"
      :placeholder="`Tell ${who} what this conversation is about…`"
      :draft="words"
      :can-attach="false"
      @send="startWith"
      @interrupt="cancel"
      @update:draft="(text: string) => (words = text)"
    />
  </section>
</template>

<style scoped>
/* ⚠️ **A consequence, so the amber register** (171 §3) — the launcher's own tone for the same
   sentence, declared here rather than borrowed as a class name: `scoped` styles are per-component,
   so a shared name shares nothing. */
.note.warn {
  color: var(--text-soft);
}

/* The sheet shell — declarations, never borrowed class names: `scoped` styles are per-component,
   so a name shared with another file shares nothing. */
.start-as-agent {
  display: flex;
  width: min(620px, 92vw);
  max-height: 88vh;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}

.sheet-header {
  display: flex;
  min-height: var(--surface-header-h);
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-5) var(--space-7) var(--space-5) var(--space-9);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-6);
}

.sheet-glyph {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--muted);
  font: var(--fw-bold) var(--type-caption) / 1 var(--font-mono);
  place-items: center;
}

.sheet-header-copy strong {
  display: block;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-bold);
}

.sheet-header-copy small {
  display: block;
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}

.spacer {
  flex: 1;
}

.icon-button {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.icon {
  width: 14px;
  height: 14px;
}

.sheet-body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: var(--space-8) var(--space-9) var(--space-6);
  overflow-y: auto;
  gap: var(--space-7);
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.lbl {
  display: flex;
  align-items: baseline;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.folder-acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.folder-acts button {
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--type-caption);
}

/* ⛔ **A refusal is the danger register**, the launcher's box's ink, because nothing can run
   there. */
.note.refused {
  color: var(--danger-text);
}

.note {
  display: flex;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: 1.5;
}

.note.mono {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

/* ⚑ **718 · the launcher's refusal box, as declarations** — `NewConversation`'s `.blocker`, copied
   rather than borrowed as a class name for this file's standing reason: `scoped` styles are
   per-component, so a shared name shares nothing. */
.blocker {
  margin: 0 var(--space-9) var(--space-6);
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  text-align: left;
}

.blocker .b-head {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--danger-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
}

.blocker .b-head .icon {
  width: 13px;
  height: 13px;
  color: var(--danger);
}

.blocker .b-body {
  margin: var(--space-2) 0 0;
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}
</style>
