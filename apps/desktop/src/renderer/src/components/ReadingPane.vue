<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  AgentIdentity,
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  LibraryEntry,
  WorkflowOutputResult,
} from '../../../shared/runtime-ipc'
import { agentName } from '../../../shared/runtime-ipc'
import { describeDerived } from '../lib/derived-state'
import { markReadOnly } from '../lib/transcript'
import { foldWindow, type WindowState } from '../lib/transcript-window'
import type { TranscriptMode } from '../lib/transcript-mode'
import { basenameOf } from '../lib/paths'
import { fullTime } from '../lib/clock'
import {
  aSurfaceMayOpenADocument,
  type ResourceDrawer,
  type ResourceReader,
  type ResourceRevealer,
} from '../lib/opening-a-document'
import TranscriptView from './TranscriptView.vue'
import OverlayHost from './OverlayHost.vue'
import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'
import WorkflowOutputViewer from './WorkflowOutputViewer.vue'
import ChildWorkViewer from './ChildWorkViewer.vue'

/**
 * A conversation being READ (047) — one we recorded, or one the sweep rescued out of a provider
 * home, folded through the same `applyEvent` a live session uses and rendered by the same components.
 *
 * ## Why this is a container and not a mode on ConversationPane
 *
 * ConversationPane takes a `SessionRecord`, and a recording has none: no `meta`, no handle, no
 * `sessionId` to send into. Threading a `readOnly` flag through it would have meant every control
 * inside growing a reason to be absent — and the failure mode of that shape is a control that
 * forgets, which here means a button that talks to a session that does not exist. Nothing in this
 * component can send anything, because there is nothing here to send with.
 *
 * ## How it is read-only
 *
 * Four ways, and they are independent so no single mistake removes all of them:
 *
 *  1. **No composer.** PromptComposer is not imported. There is no field to type in.
 *  2. **No approval controls.** TranscriptView is given no `@decide` or `@respond` listener, and the
 *     transcript is passed through {@link markReadOnly} first, so a request left unanswered when the
 *     session died renders as settled with a reason rather than as live buttons.
 *  3. **No resume.** Deliberately absent rather than disabled. 036 mapped what resuming an imported
 *     session would need and it is still out of scope; a Resume button that failed would read as
 *     data loss for a conversation whose bytes we are in fact holding.
 *  4. **It says so**, on its face, with the reason from the host rather than one composed here.
 */
const props = defineProps<{
  entry: LibraryEntry
  /**
   * 🔴 **667 · the identity roster, so a card in a recording names the OTHER agent as a person
   * named it** — *"Ada"* rather than the slug `ada`. ⚠️ `null`/absent draws the slug.
   *
   * ⚑ **678 · and THIS side too** — `671` put {@link LibraryEntry.profileId} on the entry (`667`'s
   * gap, closed), so a recording of ours names its own agent the way a live pane does
   * ({@link ownAgent}). ⚠️ **This said *"a LibraryEntry carries no `profileId`"***, which was true
   * until `671`. ⛔ **Still never borrowed from the rail's list** (`readRecorded`'s rule): the id is
   * the recording's own read, and only the roster that turns it into a name is shared.
   */
  identities?: readonly AgentIdentity[] | null
  /**
   * The loaded slice of the ledger, in order (054). Empty is a state this renders, not an error —
   * and so is a slice with `hasOlder`, which is the ordinary case for a long recording.
   *
   * The SAME {@link WindowState} a live conversation uses, deliberately: a recording and a live
   * session page back through the same ledger, and a second window type here would be a second set
   * of rules about what a page is, free to drift from the one that gets exercised more.
   */
  history: WindowState
  mode: TranscriptMode
  /**
   * Fetch and prepend the page before the one on screen (054). Absent for a caller that has no
   * paging behind it — a render test, or a conversation held entirely in one page.
   */
  onLoadOlder?: () => Promise<void>
  /**
   * Read a workflow run's output file (108). Same shape and same reason as `onLoadOlder`: a fetch
   * this pane shows the result of and does not own the bridge for.
   *
   * ⚠️ **A recording's workflow output is readable, and that is not an accident of wiring.** The
   * path lives in the ledger this app persisted, so the read is the same query for a live session
   * and a recording — which is what makes "Open output →" mean the same thing on both. Left absent
   * and the footer's button is a dead control, which is what the first version of this shipped
   * (108 review).
   */
  onReadWorkflowOutput?: (taskId: string) => Promise<WorkflowOutputResult>
  /**
   * 🔴 **Read the resource a work report names** (510; a resource since D-016). Same shape and same
   * reason as the line above, and the argument for wiring it HERE is stronger than that one's: the
   * read takes no session at all — a resource id is a primary key in main's own table — so a
   * recording answers it identically to a live conversation.
   *
   * ⛔ **Left absent, the row draws no press**, which is `118` rather than the dead control `108`'s
   * review found. ⚑ But the answer exists, so the honest wiring is the one that offers it.
   */
  onReadResource?: ResourceReader
  /**
   * 🔴 **D-032 · the doors that draw a kept picture or PDF, and show a kept file in Finder** — fetches,
   * for {@link onReadResource}'s reason. ⛔ Absent, the file is told about and no button is drawn.
   */
  onDrawResource?: ResourceDrawer
  onRevealResource?: ResourceRevealer
  /**
   * Read what one sub-agent did (112). Same shape and same reason as the line above — and the same
   * argument for it being wired here at all: the child's file is found from the session's own
   * provider home and the run this app's ledger recorded, both of which a recording still has.
   */
  onReadChildWork?: (what: ChildWorkInput) => Promise<ChildWorkResult>
  /**
   * Ask about, and speak to, a child of the session being READ (296).
   *
   * ⚠️ **Wired here as well, and the answer it usually gives is a refusal — which is the point.** A
   * recording has no app-server behind it, so `readChildState` returns `not-live` and the viewer
   * prints a sentence saying which conversation to reopen. Leaving the props off instead would have
   * produced a viewer with no composer and no explanation, which is the dead-control shape 108's
   * review found on this exact pane.
   */
  onReadChildState?: (agentId: string) => Promise<ChildStateResult>
  onSendToChild?: (agentId: string, text: string) => Promise<ChildSendResult>
}>()

/**
 * The workflow output being read (108) — the same overlay the live pane opens, so there is one
 * answer to "what does Open output do" whichever surface you are on.
 */
const readingOutput = ref<{ workflow: string; result: WorkflowOutputResult } | null>(null)

async function openWorkflowOutput(taskId: string, workflow: string): Promise<void> {
  const read = props.onReadWorkflowOutput
  if (!read) return
  readingOutput.value = { workflow, result: await read(taskId) }
}

/**
 * ⚑ **510 · the resource a work report names, in a recording** — the same panel the live pane
 * opens, so there is one answer to *what does opening a kept file do* whichever surface you are
 * on. ⛔ **640 · and it is now literally the same component**,
 * {@link CanonicalDocumentOverlay}, rather than the same panel mounted a second time.
 *
 * ⚠️ **No `scope` here, unlike `ConversationPane`'s mount**: this pane draws exactly one recording
 * for its whole life and is keyed by the entry, so there is no second conversation for a panel to
 * float over.
 */
const documentOverlay = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)

/**
 * ⚑ **640 · may this surface open a document — ASKED, not decided here.**
 * {@link aSurfaceMayOpenADocument} holds the rule for the whole app; before the fold each of the
 * three surfaces spelled it out for itself, and the room spelled it four times in one element.
 */
const mayOpenADocument = computed(() => aSurfaceMayOpenADocument(props.onReadResource))

async function openResource(resourceId: string): Promise<void> {
  await documentOverlay.value?.open(resourceId)
}

/** What a sub-agent did (112) — the same overlay the live pane opens, for the same reason. */
const readingChild = ref<{ label: string; agentId: string | null; result: ChildWorkResult } | null>(
  null,
)

async function openChildWork(what: ChildWorkInput, label: string): Promise<void> {
  const read = props.onReadChildWork
  if (!read) return
  readingChild.value = {
    label,
    agentId: what.part === 'transcript' ? what.agentId : null,
    result: await read(what),
  }
}

/**
 * Re-read the open child's record (296) — the follow, on a RECORDING.
 *
 * ⚑ **It follows here too, and that is a deliberate answer rather than a copy.** A recording's
 * conversation is over; a CHILD of it may not be, because this pane also opens the library entry of
 * a session that is still running elsewhere, and because a file on disk is the only thing either
 * pane ever read. ⛔ What this pane cannot do is SPEAK — `readChildState` answers `not-live` without
 * a session behind it, and the viewer prints that sentence rather than a dark box.
 */
async function refreshChildWork(): Promise<void> {
  const read = props.onReadChildWork
  const open = readingChild.value
  if (!read || !open || open.agentId === null) return
  const result = await read({ part: 'transcript', agentId: open.agentId })
  const still = readingChild.value
  if (!still || still.agentId !== open.agentId) return
  readingChild.value = { ...still, result }
}

const emit = defineEmits<{
  back: []
}>()

/**
 * The fold, run fresh whenever the history changes.
 *
 * A computed rather than a ref mutated on mount: reading a different conversation hands this
 * component a different `history`, and a state carried across that would show one transcript's
 * items under another's heading.
 */
/**
 * 🔴 **678 · the agent this conversation ran as, named** (`671` G4a) — `null` where the entry names
 * nobody: a conversation found in the person's own provider home, or one restored from another
 * machine, which this app did not run as anybody (`LibraryEntry.profileId`'s own note).
 *
 * ⚑ **The live pane's derivation exactly** — {@link agentName} over the id and the roster, which
 * folds the directory spelling since `671` — so one agent is not named two ways by how its
 * conversation was opened. ⛔ `null` is drawn as *this conversation* on a card and as the provider
 * on a row, never as a name this pane made up.
 */
const ownAgent = computed((): string | null =>
  props.entry.profileId === undefined
    ? null
    : agentName(props.entry.profileId, props.identities ?? null),
)
/**
 * ⚑ **678 · the heading over the agent's own replies** — `ConversationPane.who`'s shape: the name
 * where there is one, so a card and a reply cannot name one agent two ways. ⚠️ **The provider where
 * there is none** — a recording this app did not run as anybody has no identity to read, and the
 * provider is what this pane headed it with before (`two-rows-that-say-the-wrong-thing` §3).
 */
const who = computed(() => ownAgent.value ?? props.entry.provider)

const transcript = computed(() => {
  const state = foldWindow(props.history.entries)
  markReadOnly(state, READ_ONLY_NOTE)
  return state
})

/**
 * Fetch the page before the one on screen (054).
 *
 * Passed straight through from the screen, which owns `history` for the same reason it owns which
 * entry is being read: a pane that fetched into its own copy would let the two disagree about which
 * conversation is on screen.
 *
 * A PROP rather than an emit, deliberately. The natural-looking alternative — emit an event with a
 * `done` callback — resolves only if the parent remembers to call it, which is a latch: forget once
 * and the button says "Loading earlier messages…" for the rest of the session. That is the exact
 * defect 053's review found in the memory watchdog's in-flight guard, and it is not worth building
 * a second one.
 *
 * `undefined` when there is nothing older, so the control is absent rather than present and inert —
 * the rule 047 built this whole surface around.
 */
const loadOlder = computed(() => (props.history.hasOlder ? props.onLoadOlder : undefined))

/**
 * What a card that can no longer be answered says. One sentence, and it names why.
 *
 * 154 §2b · one noun. *"the session that asked"* was this repo's word for the thing the rest of
 * this pane calls a conversation, in the one sentence a reader meets on a card they cannot answer.
 */
const READ_ONLY_NOTE =
  'This is a recording — the conversation that asked is gone, so nothing can answer.'

const title = computed(() => props.entry.title || basenameOf(props.entry.cwd) || props.entry.cwd)

/**
 * Why this cannot be carried on. The host's words, not ours — the store composes the reason a row
 * cannot be reopened, and re-phrasing it here would let two parts of the app explain the same row
 * differently.
 */
const why = computed(() => props.entry.unresumableReason)

/**
 * Whether our reading of this recording is behind the bytes we hold (065, 061 finding 6), in the
 * words the library uses for the same fact. Null — and nothing rendered — when it is not.
 */
const behind = computed(() => describeDerived(props.entry.derived))

const when = computed(() => fullTime(props.entry.updatedAt))
</script>

<template>
  <section
    class="reading-pane"
    data-cy="reading-pane"
    data-read-only="true"
    data-chat-theme="light"
  >
    <header class="reading-header">
      <button type="button" class="back" data-cy="reading-back" @click="emit('back')">
        ← Library
      </button>
      <div class="what">
        <strong data-cy="reading-title">{{ title }}</strong>
        <!-- Pass-through, never a lookup: the provider name is a value on the entry, so this view
             has no opinion about which providers exist (047 AC5). -->
        <span class="meta mono">{{ props.entry.provider }} · {{ props.entry.cwd }}</span>
      </div>
      <span class="when">{{ when }}</span>
    </header>

    <!-- The claim this whole component exists to make, on its face and not in a tooltip. -->
    <p class="read-only-banner" data-cy="read-only-banner">
      <strong>Read-only.</strong>
      <span v-if="why"> {{ why }}</span>
      <span v-else> This is a recording of a conversation, not the conversation itself.</span>
    </p>

    <!-- ⚠️ **Read-only is not the same claim as complete** (065, 061 finding 6). The banner above
         says nobody can change this; this one says our reading of it may stop short of the bytes we
         hold. Before the contract existed there was no way to say the second thing, so a reader who
         had been told the first assumed both. Absent when there is nothing to say. -->
    <p
      v-if="behind"
      class="behind-banner"
      :data-derived="props.entry.derived"
      data-cy="reading-behind"
    >
      {{ behind }}
    </p>

    <TranscriptView
      :items="transcript.items"
      :mode="props.mode"
      :who="who"
      :provider="props.entry.provider"
      :own-agent="ownAgent"
      :identities="props.identities ?? null"
      :has-older="props.history.hasOlder"
      :turn-aligned="props.history.turnAligned"
      :load-older="loadOlder"
      :can-open-document="mayOpenADocument"
      data-cy="reading-transcript"
      @open-document="(resourceId) => void openResource(resourceId)"
      @open-workflow-output="openWorkflowOutput"
      @open-child-work="openChildWork"
    />

    <!-- What a workflow wrote, in a recording (108). Same viewer, same rules. -->
    <OverlayHost v-if="readingOutput" label="Workflow output" @close="readingOutput = null">
      <WorkflowOutputViewer
        :result="readingOutput.result"
        :workflow="readingOutput.workflow"
        @close="readingOutput = null"
      />
    </OverlayHost>

    <!-- ⚑ **510 · the resource a work report names, in a recording.** Same viewer, same rules —
         and the read is the same query, because it takes no session. ⛔ **640 · one component**,
         with no `scope`: a recording is one conversation for this pane's whole life. -->
    <CanonicalDocumentOverlay
      ref="documentOverlay"
      :read="props.onReadResource"
      :draw="props.onDrawResource"
      :reveal="props.onRevealResource"
    />

    <!-- What a sub-agent did, in a recording (112). Same viewer, same rules. -->
    <OverlayHost v-if="readingChild" label="What a sub-agent did" @close="readingChild = null">
      <ChildWorkViewer
        :result="readingChild.result"
        :label="readingChild.label"
        :agent="readingChild.agentId"
        :on-refresh="refreshChildWork"
        :on-read-state="onReadChildState"
        :on-send="onSendToChild"
        @close="readingChild = null"
      />
    </OverlayHost>

    <!-- An import that produced no conversation is a real outcome and says so here, rather than
         leaving an empty pane that reads like a bug. -->
    <p v-if="props.history.entries.length === 0" class="nothing" data-cy="reading-empty">
      Nothing has been imported for this conversation yet.
    </p>
  </section>
</template>

<style scoped>
.reading-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  /* ⚑ **384 §1.3** — the ground, not a fill. `--chat-bg` stays a COLOUR (`chat-theme.test.ts`
     resolves it as the page for every contrast pair); the wash is the image on top of it. */
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.reading-pane > * {
  image-rendering: auto;
}

.reading-header {
  display: flex;
  align-items: center;
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-5);
}

.back {
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-small);
}

.back:hover {
  border-color: var(--line-strong);
  color: var(--text-soft);
}

.what {
  display: flex;
  min-width: 0;
  flex-direction: column;
  flex: 1;
  gap: var(--space-1);
}

.what strong {
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  overflow: hidden;
  color: var(--faint);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when {
  color: var(--faint);
  font-size: var(--type-caption);
  white-space: nowrap;
}

/* Deliberately loud enough to be unmissable and quiet enough not to look like an error: this is
   the normal state of a recording, not something going wrong. */
.read-only-banner {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: var(--type-small);
}

.read-only-banner strong {
  color: var(--text-soft);
}

/**
 * Beneath the read-only banner and quieter than it, because it qualifies that claim rather than
 * competing with it. Warning-coloured, not danger: nothing is lost, the reading is behind.
 *
 * ⚠️ **This line changes colour, and it is a deliberate change to a surface 104 did not design**
 * (105). It said `var(--warning, var(--muted))`, and `--warning` is defined in no stylesheet in
 * this repo — so what shipped was the fallback, and this banner has been plain grey since 065
 * while its comment claimed it was warning-coloured. Two ways out, and the third was forbidden:
 *
 *  - Leaving it grey would put the SAME SENTENCE in two registers. `describeDerived` is one
 *    wording deliberately shared by this pane and the library row (065), and the library moves to
 *    amber here; one function's output reading as a caution in one place and as body copy in the
 *    other is the drift that function exists to prevent.
 *  - Defining `--warning` globally would repaint every consumer at once, including surfaces
 *    nobody has looked at. That is a product change wearing a token fix.
 *
 * So: the real `--waiting` ramp, named directly, on both surfaces. **The appearance changes** —
 * grey to amber — and `rebuilding` stays neutral below, which is the same rule the library keeps.
 */
.behind-banner {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--panel-2);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
}

.behind-banner[data-derived='rebuilding'] {
  color: var(--muted);
}

.nothing {
  margin: 0;
  padding: var(--space-7);
  color: var(--faint);
  font-size: var(--type-small);
  text-align: center;
}
</style>
