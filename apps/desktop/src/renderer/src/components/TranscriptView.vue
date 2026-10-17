<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref } from 'vue'
import type {
  AgentIdentity,
  CapabilityStatus,
  ChildWorkInput,
  CommandTail,
  HandedPath,
  PermissionDecision,
  Provider,
  UserInputResponse,
} from '../../../shared/runtime-ipc'
import type { WorkEdge } from '../../../shared/who-called-whom'
import { useOlderHistory } from '../composables/useOlderHistory'
import { useStickToBottom } from '../composables/useStickToBottom'
import type { RequestDraft, TakenWithoutThisWindow } from '../lib/session-record'
import { repliedAfter } from '../lib/asked-without-waiting'
import { isAwaitingAnswer, itemKey, type ImageItem, type TranscriptItem } from '../lib/transcript'
import { drawsAsACard } from '../lib/draws-as-a-card'
import { visibleItems, type TranscriptMode } from '../lib/transcript-mode'
import { takenBackGoAheadsThatMayCarryOn } from '../lib/plan-mode'
import { rowKey, transcriptRows, type TranscriptRow } from '../lib/tool-runs'
import { everyResourceAReportNames } from '../lib/the-document-a-report-names'
import AssistantMessage from './AssistantMessage.vue'
import CompactionEntry from './CompactionEntry.vue'
import ContinuationEntry from './ContinuationEntry.vue'
import AppNoticeEntry from './AppNoticeEntry.vue'
import AnsweredQuestionEntry from './AnsweredQuestionEntry.vue'
import { answerIn, questionItemIn } from '../lib/answered-question'
import RelayedEntry from './RelayedEntry.vue'
import WorkReportEntry from './WorkReportEntry.vue'
import ConversationResetEntry from './ConversationResetEntry.vue'
import ImageEntry from './ImageEntry.vue'
import MemoryLoadedEntry from './MemoryLoadedEntry.vue'
import MemoryNoteEntry from './MemoryNoteEntry.vue'
import MemoryRecallEntry from './MemoryRecallEntry.vue'
import NoticeEntry from './NoticeEntry.vue'
import PlanEntry from './PlanEntry.vue'
import { workingLine } from '../lib/working-line'
import ThinkingEntry from './ThinkingEntry.vue'
import SubAgentEntry from './SubAgentEntry.vue'
import PermissionCard from './PermissionCard.vue'
import ToolEntry from './ToolEntry.vue'
import OutgoingEntry from './OutgoingEntry.vue'
import ToolRun from './ToolRun.vue'
import UnknownEntry from './UnknownEntry.vue'
import UserInputCard from './UserInputCard.vue'
import UserMessage from './UserMessage.vue'
import QueuedMessage from './QueuedMessage.vue'
import { filesOnScreen } from '../lib/files-kept'
import type { KeptFile } from '../../../shared/runtime-ipc'
import type { PathsHere } from '../composables/useMessagePaths'

/**
 * The conversation itself — one component per item kind, dispatched on the discriminant. It holds
 * no state and interprets nothing: the fold from events to items already happened upstream, and
 * `mode` only decides which of those items are shown.
 */
const props = withDefaults(
  defineProps<{
    queuedDisclosures?:
      readonly import('../../../shared/runtime-ipc').QueuedMessageDisclosure[] | null
    limitNow?: number
    items: TranscriptItem[]
    mode?: TranscriptMode
    /**
     * Who the assistant is — the heading of this conversation's own rows. ⚠️ A NAME on a live
     * conversation, and the provider or *sub-agent* where the surface has no name.
     */
    who?: string
    /**
     * 🔴 **667 · this conversation's own agent, by NAME, or `null`** — what a card's heading puts
     * after *"to"* (and before it, on an outgoing card). ⛔ **Not {@link who}**, which a recording
     * fills with the provider and a sub-agent's viewer with *sub-agent*: neither is a name, and a
     * card headed *"Ada to claude"* was `658`'s G4. ⚑ `null` is drawn as *this conversation*.
     * ⚑ **725 · R44** — and the name the permission and grant cards draw the MODEL's own words
     * under (`agentReason`); `null` there says *the agent*.
     */
    ownAgent?: string | null
    /**
     * 🔴 **725 · R73 — this conversation's provider, or `null`**, so a permission card labels a
     * policy's rule as that provider's (`inItsRulesWords`). ⚑ Absent where the surface does not
     * know it; the card then says *the provider*. ⚑ **730** — and so R80's card says who asks
     * (`mcpToolAsker`) and R83's notice names who has not answered the stop (`NoticeEntry`); every
     * pane that knows its conversation's provider hands it (the conversation and reading panes).
     */
    provider?: Provider | null
    /**
     * 🔴 **The identity roster, so a RELAYED row can name the conversation that relayed it** (545)
     * — see `lib/relayed-turn.ts`.
     *
     * ⛔ **Passed straight through**: nothing in this component reads it, and every entry handed it
     * — the relay, the held row, the work report, the outgoing card, and since `667` the notice that
     * names a lost reply's parent (and, since `712`, both identities of an ask about an identity's
     * rules) — asks the app's one naming function rather than deciding anything of their own.
     * ⚠️ **`null`/absent is a state and not a shortcut** — the roster read is asynchronous, and until
     * it lands an identity draws under its slug.
     */
    identities?: readonly AgentIdentity[] | null
    /**
     * 🔴 **The conversations THIS WINDOW is running** (506) — `store.open`'s ids, so a work report
     * can offer a way into the conversation it names. See `lib/where-the-work-is.ts`.
     *
     * ⛔ **Absent rather than empty for a surface with no runtime**, which is `canOpenStore`'s
     * default one prop down and the same rule: `ReadingPane` and `ChildWorkViewer` render this
     * list over a recording, and a press there would reach nothing. ⚠️ An EMPTY array is a
     * different claim — *this window holds nothing* — and it draws the take-over words on every
     * row, which is right for a window that genuinely holds none.
     *
     * ⚑ **An array and not a `Set`**: the caller already has the list, and the one `Set` this
     * component needs is built once here rather than per row.
     */
    held?: readonly string[]
    /**
     * ⚑ **The work this conversation gave out, as the cast last read it** — where a give's card finds
     * the conversation its piece went to (`outgoing-card.ts`). ⛔ Absent on a surface with no
     * reading of THIS conversation's, and a give's card there draws no press.
     */
    gaveOut?: readonly WorkEdge[] | null
    /**
     * ⚑ **UI-002 · the work this conversation was given**, as the cast last read it — when each
     * piece was given, so a brief lists the inputs handed over with it. `null`: not read.
     */
    takenIn?: readonly WorkEdge[] | null
    /**
     * Whatever is rendered BELOW this list and shares its space — today the activity pill (027).
     * Nothing here draws it; the string only has to change when its height might, because a
     * sibling appearing outside the scroll container still shrinks the scroll container.
     */
    footprint?: string
    /**
     * Whether the ledger holds anything before what is loaded (054). Drives the row at the top of
     * the stream; absent means "everything there is", which is what a short conversation has.
     */
    hasOlder?: boolean
    /**
     * Whether the loaded page begins at a turn boundary. False means the event ceiling cut
     * mid-turn, and the first thing on screen is the middle of somebody's work rather than a
     * prompt. Said out loud, because a reader cannot tell those apart by looking.
     */
    turnAligned?: boolean
    /**
     * Fetch and prepend the page before this one (054).
     *
     * A callback rather than an emit, and the reason is the scroll restore. Keeping a reader in
     * place across a prepend needs `scrollHeight` from BEFORE the fetch and from after it, and this
     * component is the only one that has the scroll element — an emit would put the fetch in the
     * container and the measurement here, with no moment either of them could take both readings.
     */
    loadOlder?: () => Promise<void>
    /** Takes a piece back from the service it is on, as a person, and answers in words. */
    takeBack?: (piece: string) => Promise<string>
    /**
     * 🔴 **Whether the window still holds the newest recorded event** (313, friction log F3).
     *
     * ⛔ **One of the two ways the newest message leaves the reader's view, and the only one a
     * scroll cannot undo** — which makes it a gate on the way back, never the count of what arrived
     * while the window was away. 313 found the bar gated on that count (`window.behind`): on an idle
     * session nothing new ever arrives, the count stays 0 for ever, the bar was never rendered, and
     * a window that had left the tail had no way back at all. Measured on a real 5,015-event
     * conversation: one backward gesture put the window on ordinals 0…3749 and eleven hours of it —
     * turns 5 to 12, 23:29 to 23:55 — became unreachable in the UI while sitting on disk.
     * `session-store.jumpToLatest` has always gated on this field (`record.window.atTail`), so the
     * store was right and only the affordance was wrong.
     *
     * 🔴 **UI-010 (F053) · and the count is not the label either.** It counts EVENTS — every
     * thinking delta, status and activity event — so the bar read *"36 new messages"* and climbed
     * as an agent thought. ⚑ The bar says *Jump to latest*, and the other way the newest message
     * leaves the view — the reader scrolled up a window that still holds it — is
     * `useStickToBottom`'s `endInView`.
     *
     * ⛔ **Defaults to `true` — "we hold the end" — which is `createWindow()`'s own value** and the
     * only safe default: a surface that does not know is a surface with no tail to have left. Every
     * caller that passes {@link jumpToLatest} must pass this too, and
     * `tail-escape-is-gated-on-the-tail.test.ts` is what makes that true of the NEXT caller rather
     * than of this one.
     */
    atTail?: boolean
    /** Re-read the newest page. The way back; absent means there is no way back to offer. */
    jumpToLatest?: () => Promise<void>
    /**
     * Where a card's own state lives, by request id (064).
     *
     * A function rather than a map, because the draft is made on first sight and the record it is
     * made on belongs to the caller. Absent for a surface with no session behind it — the read-only
     * pane, and a test mounting one card — where the card keeps its own and nothing outlives it.
     */
    draftFor?: (requestId: string) => RequestDraft
    /**
     * What each followed command has printed (300), by tool-call id.
     *
     * ⚠️ **A function rather than a map, for `draftFor`'s reason one prop up**: the tails belong to
     * the pane, which owns the one timer that fills them, and handing the map itself would let a row
     * hold a reference that outlives the conversation it came from. Absent for a surface with no
     * session — the read-only pane and a test mounting one card — where nothing is following
     * anything and every card reads `null`.
     */
    tailFor?: (callId: string) => CommandTail | null
    /** Whether THIS session's handle can be asked at all — `canReadCommandOutput`. */
    canWatchCommands?: boolean
    /**
     * ⛔ **Whether this conversation can be asked what its tools answered** (462) — one boolean for
     * every row, because `SessionLiveness.canReadToolAnswer` is a property of the conversation's
     * handle rather than of any one call.
     *
     * ⚠️ **A plain prop and not a `tailFor`-shaped function**, and the asymmetry with its neighbour
     * is the point: a tail is polled per call while a card is open, so the pane has to be asked per
     * call; an answer is read ONCE, when a person presses a button, so nothing here needs a lookup.
     */
    canReadToolAnswers?: boolean
    /**
     * ⛔ **Whether this surface can open the drawer on the memory store** (318 §2.3).
     *
     * ⚠️ **Default `false`, and that default is the ruling.** `ReadingPane` renders the same
     * transcript for an imported conversation and has nowhere to send the request, so a control
     * rendered there would do nothing when pressed — which `106` forbids. The one pane that CAN
     * handle it passes `true`; every other mount is silent by default rather than broken.
     */
    canOpenStore?: boolean
    /**
     * 🔴 **Whether this surface can read a kept file's bytes** (510; a resource since D-016).
     *
     * ⛔ **Default `false`, and the default is the ruling** — {@link canOpenStore}'s, one prop up,
     * and for the same measured reason: `ReadingPane` and `ChildWorkViewer` render this same
     * transcript with no reader behind them, and a control rendered there would do nothing when
     * pressed. ⚑ The one pane that CAN fetch passes `true`.
     */
    canOpenDocument?: boolean
    /**
     * ⚑ **UI-002 · the files kept on this conversation's tree**, so the cards where files change
     * hands draw one row per file. ⛔ Absent or `null`: not read, and every card draws as before.
     */
    files?: readonly KeptFile[] | null
    /** This provider's `commandOutput` standing, so a card can say why there is nothing to show. */
    outputCapability?: CapabilityStatus | null
    /**
     * ⚑ **Whether a choice under an agent's message may be sent as a message now** (provider
     * follow-ups 1) — the conversation can take a message AND no card is waiting on a specific answer
     * (the composer's own rule, 063). Absent or false: no choices are drawn.
     */
    canSendAnswers?: boolean
    /** …and its `backgroundCommandOutput` standing, for a card whose command went to the background. */
    backgroundOutputCapability?: CapabilityStatus | null
    /** Whether one command can be stopped — the same gate `BackgroundBar` reads (094's one gate). */
    canStopCommands?: boolean
    /**
     * Which CALLS have a stop in flight, so the pressed card reads `Stopping…` and the others do
     * not. ⚠️ Keyed by call and not by the provider's key: that one is recyclable, and a latch on it
     * cannot tell one command from the next one born with its number.
     */
    stoppingCall?: (callId: string) => boolean
    /**
     * 🔴 **696 · `688` L1 — whether this conversation can take a message now** — the pane's own
     * composer state, not `ended`. ⚑ Read by one question: whether a taken-back go-ahead may still
     * say *type your next message to carry on* (`takenBackGoAheadsThatMayCarryOn`).
     *
     * ⛔ **Default `false`, and the default is the ruling** — {@link canOpenDocument}'s: a surface
     * that does not hand down what its composer can do says only the half that is a fact about the
     * past. ⚠️ `ReadingPane` has no composer; `ChildWorkViewer` has one of its own (a person talking
     * to a child), and it hands nothing down — so its rows say the fact alone, which is never
     * false.
     */
    canTakeAMessage?: boolean
    /**
     * ⚑ **D-017b · the conversation is drawn from its ledger** (`recorded`): a held row offers no
     * Cancel — only a conversation this window is fed takes one back — and goes with its next
     * message, unless {@link takenWithoutThisWindow} says a window takes its turns. ⛔ Default
     * `false` — a surface that does not know says what a live conversation says.
     */
    recorded?: boolean
    /**
     * ⚑ **D-017b · its turns are taken without this window** (`turnsTakenWithoutThisWindow`), or
     * `null`: a provider's card is then answered by the window that holds it — read-only here, with
     * the press that takes it where no window does — and a held row goes when its turn ends.
     */
    takenWithoutThisWindow?: TakenWithoutThisWindow | null
    /**
     * ⚑ **UI-009 · a question this conversation asked of a person is answered on its card here**
     * (F052) — the conversation's own pane. ⛔ Absent: a read-only surface (a recording, a child's
     * work) draws its options as chips, as before.
     */
    canAnswerQuestions?: boolean
    /**
     * Whether this surface serves the `brobot-asset:` pictures a row names. Off, no picture is
     * requested and its row says it can't be shown here. Default `true`, like the four below: every
     * pane that existed before them draws these controls, and a surface turns them off explicitly.
     */
    canReadImages?: boolean
    /** Whether a picture opens full-size ({@link openImage}). Off, the picture is not a button. */
    canOpenImages?: boolean
    /**
     * Whether a sub-agent's transcript, or a workflow's agents, journal and script, open
     * ({@link openChildWork}). Off, those buttons are not drawn, nested cards included.
     */
    canOpenChildWork?: boolean
    /** Whether a workflow's output file opens ({@link openWorkflowOutput}). Off, its name is shown. */
    canOpenWorkflowOutput?: boolean
    /** Whether an ended held message can go back to a composer ({@link restoreQueued}). */
    canRestoreQueued?: boolean
    /**
     * This conversation's paths, so a path a message names can be opened or shown. Absent or null:
     * every path stays plain text.
     */
    paths?: PathsHere | null
    /** Whether a turn is running, whatever started it: the quiet line at the end says so. */
    turnRunning?: boolean
    /** "Still thinking (N min)." while the model thinks in silence; the line at the end says it. */
    stillThinking?: string | null
    /** Whether the running turn can be stopped, so a held stop word can stop it in one press. */
    canStopTurn?: boolean
  }>(),
  {
    mode: 'debug',
    who: 'Assistant',
    footprint: '',
    held: undefined,
    hasOlder: false,
    turnAligned: true,
    loadOlder: undefined,
    atTail: true,
    jumpToLatest: undefined,
    draftFor: undefined,
    tailFor: undefined,
    canWatchCommands: false,
    canReadToolAnswers: false,
    canOpenStore: false,
    canOpenDocument: false,
    outputCapability: null,
    backgroundOutputCapability: null,
    canSendAnswers: false,
    canStopCommands: false,
    stoppingCall: undefined,
    canTakeAMessage: false,
    recorded: false,
    takenWithoutThisWindow: null,
    canAnswerQuestions: false,
    canReadImages: true,
    canOpenImages: true,
    canOpenChildWork: true,
    canOpenWorkflowOutput: true,
    canRestoreQueued: true,
    paths: null,
  },
)

const shown = computed(() => visibleItems(props.mode, props.items))

/** The quiet line at the end while a turn runs ({@link workingLine}). */
const working = computed(() => workingLine(props.turnRunning, shown.value))

/**
 * 🔴 **696 · the taken-back go-aheads that may still say *carry on*** — over `props.items`, every
 * item and not the mode's list, for {@link heldIds}' neighbour's reason: what came after a row is a
 * fact about the conversation, and flipping the transcript mode must not change it.
 */
const mayCarryOn = computed(() =>
  takenBackGoAheadsThatMayCarryOn(props.items, props.canTakeAMessage),
)

/**
 * 🔴 **587 · what the list DRAWS, which is no longer one row per item** — see `tool-runs.ts`.
 *
 * ⚠️ **Folded from {@link shown} and not from `props.items`, so the mode decides first.** A run is a
 * span of CONSECUTIVE members, and `debug` shows rows `normal` hides (a superseded `TaskCreate`,
 * `028`) — so folding before the filter would group calls a reader cannot see between calls they
 * can, and the two modes would disagree about what is next to what.
 */
const rows = computed<readonly TranscriptRow[]>(() => transcriptRows(shown.value))

/**
 * ⚑ **Assistant messages a person has already replied after** (provider follow-ups 1) — a message of
 * theirs, sent or held, follows it. Read from the TRANSCRIPT rather than kept on the card, so a
 * re-render, a switch away and back, or a reopen cannot offer a question's choices again
 * (`061`'s rule: no submitted state in a component ref). See {@link repliedAfter}.
 */
const answeredAssistantIds = computed(() => repliedAfter(shown.value))

/**
 * ⚑ **506 · the held ids as a set, built once per fold rather than once per row.**
 *
 * ⛔ **`null` and not an empty set when the prop is absent**, because the two answer different
 * questions — see {@link held}. `where-the-work-is.ts` is the one place that difference is read.
 */
const queueById = computed(
  () => new Map((props.queuedDisclosures ?? []).map((one) => [one.id, one])),
)
const heldIds = computed<ReadonlySet<string> | null>(() =>
  props.held === undefined ? null : new Set(props.held),
)

/**
 * 🔴 **562 · every document this transcript was HANDED, so a sentence naming one can open it** —
 * see `the-document-a-report-names.ts`, where the roster and the work report's own press are the
 * same predicate.
 *
 * ## ⛔ `props.items` and NOT {@link shown}, which is the mode's list
 *
 * ⚠️ **`visibleItems` hides rows in `normal`**, and a roster built from it would make a control in
 * a reply appear and disappear as a person flips the transcript mode — a fact about a document
 * answered by a display setting. ⛔ The window is the bound that belongs here and it is stated
 * where the roster is built.
 */
/** ⚑ **UI-002 · the tree's files, looked up by the cards** — `null` while nothing has been read. */
const kept = computed(() => filesOnScreen(props.files ?? null))

const documentsNamed = computed<readonly string[]>(() =>
  everyResourceAReportNames(props.items, props.canOpenDocument),
)

/**
 * How many rows sit above the newest compaction boundary — the **summarised-out** region (087).
 *
 * Everything before the last boundary is context the model no longer sees verbatim, and it reads
 * that way: `--faint` and reduced opacity. Quiet rather than struck through, because those turns
 * still happened and are still worth reading; they are just no longer in the agent's head.
 *
 * ⚠️ **Computed over `shown`, not `items`.** The class lands on rendered rows, so the boundary it
 * counts from has to be a rendered one. Using `items` would put the fade on the wrong rows the
 * moment normal mode hid anything between them — and `compaction` is exempt from that filter
 * (`transcript-mode.ts`), so the newest boundary is always in `shown` when it is in `items`.
 *
 * `-1` when there is none, which makes every `index < faded` false and costs no second branch.
 */
const faded = computed(() => {
  for (let index = shown.value.length - 1; index >= 0; index -= 1) {
    if (shown.value[index]?.kind === 'compaction') return index
  }
  return -1
})

/**
 * What each row is keyed on. `itemKey` rather than `item.id`, so a card is the SAME component
 * across a re-fold instead of a new one that has forgotten what was typed into it (064) — the rule
 * itself, and why, is in `lib/transcript.ts`.
 */
/**
 * Whether this row reads as summarised-out — **and a card still waiting on you never does.**
 *
 * ⚠️ **Review finding 3, and it is the inverse of the rule 087 was written to protect.** 063 exists
 * because a question that fails to reach the user is a defect we paid to fix, and 080 built five
 * traces so one can never hide. Compaction can happen while a permission is still open — nothing
 * stops it — and the unguarded fade then rendered that card at 50% opacity: the traces still fired,
 * but the one affordance for ANSWERING it looked exactly like settled history. This feature was not
 * allowed to raise the attention channel; it was even less allowed to lower it.
 */
/**
 * ⚠️ **Takes the ROW and reads its own index** (587), where it took an item and the `v-for`'s.
 *
 * ⛔ **A run cannot be the exception this makes.** `isAwaitingAnswer` is about a card holding a
 * question open across a compaction, and no tool row has ever been one — so the guard is asked only
 * of the arm that can answer it, rather than of a shape that would always say no.
 */
const dimmed = (row: TranscriptRow): boolean =>
  row.at < faded.value && !(row.kind === 'item' && isAwaitingAnswer(row.item))

const keyOf = itemKey

defineEmits<{
  decide: [requestId: string, decision: PermissionDecision]
  move: [requestId: string, decision: 'move' | 'here']
  respond: [requestId: string, response: UserInputResponse]
  /** ⚑ **D-017b · a card's *Take it over to answer here*** — raised, never handled here. */
  takeItOver: []
  /** Show this image full-size. Raised, never handled here — the overlay is the pane's (067). */
  openImage: [item: ImageItem]
  /** Read a workflow's output (108). Raised for the same reason, and carries no path — see
   *  `WorkflowEntry.vue`. */
  openWorkflowOutput: [taskId: string, workflow: string]
  /** What one sub-agent did (112). Raised for the same reason, and carries no path either. */
  openChildWork: [what: ChildWorkInput, label: string]
  /**
   * Take back the message waiting to be sent (077). Raised for the same reason: no state here.
   * ⚑ **688 · naming the row that was pressed** — see `QueuedMessage`'s `cancel`.
   */
  cancelQueued: [messageId: string]
  /** Take back a held stop word and stop the turn. */
  stopQueued: [messageId: string]
  /** Put an unsent message's text back in the composer, where it can be sent or edited (077). */
  restoreQueued: [text: string, attachments: HandedPath[]]
  /** ⚑ A choice picked on a question asked without waiting — to send as an ordinary message. */
  sendAnswer: [text: string]
  /** A card wants following, or has stopped wanting it (300). Raised: the timer is the pane's. */
  watchCommand: [callId: string, on: boolean]
  /** Stop ONE command (300). Raised for the same reason the queue's controls are: no state here. */
  stopCommand: [callId: string, key: string]
  /** Show everything one tool answered (462). Raised: the overlay is the pane's, like the two above. */
  openToolAnswer: [callId: string, name: string]
  /**
   * Open the drawer on the tab that lists this profile's memory store (318 §2.3).
   *
   * ⚠️ **Raised, never handled here**, exactly as every control above is: opening the drawer and
   * choosing its tab are the screen's state, two components up, and a transcript that reached in to
   * set them would be the second writer of a value `RuntimeScreen` persists.
   */
  openInstructions: []
  /**
   * Open the conversation named by this work report.
   *
   * ⚠️ **Raised, never handled here**, like every control above it. ⛔ And the handler is not new:
   * `RuntimeScreen.goToQuestion` already claims-if-needed and then navigates, over the same
   * population — *"mostly conversations nobody is holding"* — for the person's queue.
   * ⚑ **UI-011 · `briefOf`** — a give card's cut note asks for its piece's brief to be brought
   * into view there (`OutgoingEntry`).
   */
  openConversation: [sessionId: string, briefOf?: string]
  /** ⚑ **510 · a file a work report names, passed up to the pane that owns the panel.** */
  openDocument: [resourceId: string]
}>()

// Follow both a new item and a growing streamed one, without watching the whole list deeply — a
// turn can push hundreds of deltas through here. Keyed off what is actually SHOWN, so in `normal`
// a burst of hidden chatter does not yank the view.
//
// Switching mode also re-anchors to the newest item, deliberately: the list the user was
// positioned in no longer exists, and holding a stale offset into a different list is more
// disorienting than landing on the latest content. Scrolling up still releases the follow.
//
// `footprint` is in the signal because the activity pill is a SIBLING of this scroll container, not
// a child: when it appears, this element loses ~28px of height while `scrollTop` stays put, and a
// reader pinned to the bottom silently loses the last line to the fold. No item changed, so nothing
// else here would fire. Claude's `requesting` status arrives as an activity event with no content
// beside it, so that gap lasts until the first delta rather than a frame.
const {
  el,
  onScroll: followBottom,
  release: releaseFollow,
  endInView,
} = useStickToBottom(() => {
  const last = shown.value.at(-1)
  return `${shown.value.length}:${last && 'text' in last ? last.text.length : 0}:${props.footprint}`
})

/**
 * Paging backwards (054), on the SAME element the follow uses.
 *
 * The two are opposite ends of one gesture and there is exactly one scroll listener, so they are
 * composed here rather than each binding their own: two `@scroll` handlers on one element would run
 * in declaration order and the ordering would be invisible in the template.
 */
const older = useOlderHistory({
  el,
  hasOlder: () => props.hasOlder,
  load: async () => {
    await props.loadOlder?.()
  },
  // ⛔ **Asking for older messages IS releasing the follow** (299 §2, from 297 4b). Both write
  // `node.scrollTop` after their own `nextTick` and nothing ordered them; on the BUTTON path
  // `stuck` can still be true — the control is inside this container and a short filtered window
  // makes it clickable without a scroll ever happening — and the follow then threw the reader to
  // the newest line on the one gesture that means the opposite.
  releaseFollow,
})

function onScroll(): void {
  followBottom()
  // Only when a container actually gave us something to call. A transcript with no paging behind
  // it — a live session that has never been reopened — must not run a fetch that does nothing.
  //
  // 🔴 **UI-010 (F053) · and never for a reader whose newest line is on screen.** The fetch band is
  // the top 400px, and `scroll` also fires for the follow's OWN write: in a conversation whose drawn
  // content overflows the box by less than the band — a page of mostly thinking deltas and status
  // events draws a few rows — every line the follow pinned asked for older history. On a busy
  // conversation one page back passes the window's cap (a full page, the live events since, and
  // another page), the cap releases the newest end, and the window let go of the tail with nobody
  // having scrolled: the reply it was cut in stayed drawn as *streaming*, frozen, under the bar.
  // ⚑ A reader at the end is not asking for the beginning; *Load earlier messages* still is.
  if (props.loadOlder && !endInView.value) older.onScroll()
}

/**
 * Back to the newest page, then to the bottom of it.
 *
 * The scroll is set explicitly rather than left to the follow, because the follow only re-anchors
 * for a reader who was ALREADY at the bottom — and someone pressing this is, by definition, not.
 *
 * ## ⚠️ Where this sits in the `scrollTop` write order (313, on 299 §2)
 *
 * ⛔ **Four things in this component move the scroll** — {@link useStickToBottom}'s follow,
 * {@link useOlderHistory}'s anchor restore, this line, and {@link focusItem}'s smooth
 * `scrollIntoView`. ⚠️ **This said *three*, and *313 adds no fourth*** (`704` H-6): `focusItem` is
 * `037`'s and was already the fourth when 313 counted — it moves the box without assigning
 * `scrollTop`, which is how a count by that property missed it. 299 ordered
 * the first two by having `loadOlder` call `releaseFollow()` before anything else, because they
 * wanted OPPOSITE things: the anchor wanted to stay put and the follow wanted the newest line.
 *
 * ⚑ **`focusItem` releases nothing either.** Its smooth scroll dispatches `scroll` frame by frame,
 * so `onScroll` releases the follow once the box leaves the bottom. ⚑ **UI-011 · on the first
 * frame, while `stuck` is still true, the follow's own same-value write cancelled it** (the mount's
 * pin and the resize observer's first call); the follow now writes only where the box is not at
 * its end, so a press lands where it pressed.
 *
 * ⚑ **This one deliberately does NOT release, and the reason is that it is not in that conflict.**
 * Both writers here want the same end state — the bottom — so whichever lands last lands on
 * `scrollHeight` either way. The two cases in full:
 *
 *  - the ordinary one: the reader scrolled up, so `stuck` is already false, the watcher returns at
 *    its own guard, and this is the only writer. ⚑ **UI-010** — and on a window that still holds
 *    the tail, the store returns at its own `atTail` guard, nothing is re-read, and this line is
 *    the whole press.
 *  - the one 313 makes reachable for the first time: a window off the tail whose filtered content
 *    does not fill the viewport, so no scroll ever happened and `stuck` is still true. The watcher
 *    fires on the swapped items and writes `scrollHeight`; this writes `scrollHeight`. They agree.
 *
 * ⚠️ **And the follow re-arms itself, which is why nothing here has to re-arm it.** Assigning
 * `scrollTop` dispatches a `scroll` event, `useStickToBottom.onScroll` recomputes `stuck` from the
 * position it just landed on, and a reader who pressed *jump to latest* is following the tail again
 * — which is what they asked for.
 *
 * ⚑ **Measured rather than assumed, and it is a FRAME and not a tick.** In the dom project's real
 * Chromium the event had not fired after `await nextTick()` and had fired after one
 * `requestAnimationFrame`. So the follow is re-armed on the next frame, and for that one frame a
 * live event would not be followed.
 *
 * ⚠️ **And only when the assignment CHANGES the value** — a scroll event is not dispatched for a
 * write that moves nothing. The case that reaches is a newest page whose filtered content does not
 * fill the viewport: `scrollTop` is 0 before and after, no event fires, and `stuck` stays false
 * until the reader touches the box. ⛔ **Not worth another writer**: the cost is that a live event
 * does not auto-follow on a screen with no scrollbar, where nothing is hidden by not following, and
 * closing it by reaching into `useStickToBottom` from here would put back exactly the unordered
 * pair 299 spent a dispatch removing.
 */
const jumping = ref(false)

async function jumpBack(): Promise<void> {
  // ⛔ **One at a time, for the reason `useOlderHistory` has a `loading` ref** (313, review finding).
  // The store's own guard is `if (!record || record.window.atTail) return`, read BEFORE it awaits
  // `bridge.latestHistory` — so it cannot deduplicate a second press during the read. Two presses
  // meant two 2,500-event reads and two re-folds, and a fold is quadratic in its own length
  // (`transcript-window.ts`: 172 ms at 400 turns, 2,646 ms at 1,600). ⚠️ This bar is a permanent
  // fixture on an idle session since 313, where it used to be transient, so the second press is now
  // easy rather than theoretical.
  if (jumping.value) return
  jumping.value = true
  try {
    await props.jumpToLatest?.()
    await nextTick()
    // ⛔ **Only if it actually worked** (313, review finding). `session-store.jumpToLatest` returns
    // `Promise<void>` and swallows its own outcome — a refused IPC during a quit, or a record with
    // no meta, leaves the window exactly as it was. Scrolling anyway threw the reader to the bottom
    // of the STALE window: not where they were reading, not the latest, and with the bar still
    // there because `atTail` never moved. `atTail` is the receipt, and it is already a prop.
    if (props.atTail) {
      const node = el.value
      if (node) node.scrollTop = node.scrollHeight
    }
  } finally {
    jumping.value = false
  }
}

/**
 * Bring one entry into view and mark which one it was (037) — how the session panel gets you back
 * to the thing it is telling you about.
 *
 * Returns whether it found it, and the caller is expected to care. The panel only ever asks for
 * items it can see in this same list, so `false` means the view moved underneath it (a mode change,
 * a page released) between the render and the click — and scrolling somewhere arbitrary would be
 * worse than not moving.
 *
 * The item ids this matches on are the fold's own `prefix_N`, so they need no escaping inside a
 * quoted attribute selector; nothing user-supplied ever reaches here.
 */
function focusAnsweredQuestion(itemId: string): void {
  // Start the jump after opening the notice has changed the stream's layout.
  releaseFollow()
  void nextTick(() => {
    releaseFollow()
    focusItem(itemId, 'instant')
  })
}

function focusItem(itemId: string, behavior: ScrollBehavior = 'smooth'): boolean {
  const node = el.value?.querySelector<HTMLElement>(`.entry[data-item="${itemId}"]`)
  if (!node) return false
  // Centred rather than top-aligned: a permission card is usually a reply to something just above
  // it, and landing with that context on screen is the difference between "here it is" and "here
  // is a card, scroll up to find out why".
  const toggle = node.querySelector<HTMLButtonElement>('[data-cy="exchange-toggle"]')
  if (toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click()
    void nextTick(() => node.scrollIntoView({ block: 'center', behavior }))
  } else node.scrollIntoView({ block: 'center', behavior })
  // Scrolling ALONE does not answer "which one" when three cards are on screen at once. The mark
  // is removed on a timer rather than left to the next click, so it never accumulates.
  window.clearTimeout(flashTimer)
  el.value?.querySelectorAll('.entry.flash').forEach((marked) => marked.classList.remove('flash'))
  // Reading a layout property between the remove and the add is what makes the animation RESTART
  // when the same row is pressed twice. Without it the browser coalesces both class changes into
  // one style recalculation, sees no transition of the animation-name, and lets the ring carry on
  // fading from wherever it had got to — so the second press looks like nothing happened, on the
  // one control whose whole job is to answer "which one".
  void node.offsetWidth
  node.classList.add('flash')
  flashTimer = window.setTimeout(() => node.classList.remove('flash'), 1600)
  return true
}

let flashTimer = 0
onScopeDispose(() => window.clearTimeout(flashTimer))

defineExpose({ focusItem })
</script>

<template>
  <section ref="el" class="stream" data-cy="transcript" :data-mode="mode" @scroll="onScroll">
    <!-- INSIDE the scroll container, and first, so it moves with the content it belongs to: a
         "load earlier" pinned outside would sit still while the conversation slid under it.
         Rendered only when there IS something older — an always-present control that does nothing
         at the start of a conversation is the shape this codebase keeps removing. -->
    <div v-if="props.hasOlder" class="older" data-cy="transcript-older">
      <button
        type="button"
        class="load-older"
        data-cy="load-older"
        :disabled="older.loading.value"
        @click="older.loadOlder()"
      >
        {{ older.loading.value ? 'Loading earlier messages…' : 'Load earlier messages' }}
      </button>
      <!-- The claim a reader cannot make for themselves. Without it the first line on screen reads
           as the start of the conversation, when it is really the middle of a turn the event
           ceiling cut. -->
      <p v-if="!props.turnAligned" class="older-note" data-cy="older-partial">
        This page starts part-way through a turn.
      </p>
      <p v-if="older.error.value" class="older-error" data-cy="older-error">
        {{ older.error.value }}
      </p>
    </div>

    <!-- One wrapper per ROW, carrying an item id (037). It is what {@link focusItem} scrolls to,
         and it is a wrapper rather than an attribute passed to each component because attribute
         fallthrough would depend on all ten of them keeping a single root element — a rule nothing
         here enforces and one that would fail silently, in the one place where failing silently
         means a control that does nothing when pressed.

         ⚠️ **And since `587` a row is not always an item**: a run of settled tool calls is one
         wrapper over several of them (`tool-runs.ts`), so the id it carries is its FIRST call's.
         ⛔ Nothing navigates to the others, because `session-panel.ts` only ever emits a tool id
         for a sub-agent home or a workflow home and `joinsARun` excludes both.

         ⛔ **`data-ordinal` is the ledger's own number for the event that built the row** (299 §2).
         `data-item` is a per-fold counter and a prepend renumbers every one of them, so it cannot
         identify a row across the very gesture that needs one identified — which is what
         `useOlderHistory` anchors on. Absent on a row folded without an ordinal, and its selector
         skips those. -->
    <template v-for="row in rows" :key="rowKey(row, keyOf)">
      <!-- 🔴 **587 · a run of settled tool calls is ONE quiet line** (`EXT-013` §3.1).

           ⛔ **Its own `.entry`, not a branch inside the one below**, and that is what keeps the
           chain's narrowing honest: `row.item` exists on one arm of the union and nowhere else, and
           a `v-if` sharing a wrapper with forty `v-else-if`s would be asking the compiler to carry
           that narrowing the length of the file.

           ⚠️ **`data-item` names the run's FIRST member and `data-ordinal` its LAST, and they differ on
           purpose.** `focusItem` addresses a row by `data-item`, so the run answers to the call it
           starts at; `useOlderHistory` re-finds its scroll anchor by `data-ordinal` AFTER a prepend,
           and a prepend is the one gesture that can give a run a new first member — the last member
           is the end that a prepend cannot move. -->
      <div
        v-if="row.kind === 'run'"
        class="entry"
        :class="{ 'summarised-out': dimmed(row) }"
        :data-item="row.members[0]?.id"
        :data-ordinal="row.members[row.members.length - 1]?.ordinal"
        :data-summarised="dimmed(row)"
      >
        <ToolRun
          :members="row.members"
          :can-read-answer="props.canReadToolAnswers"
          @open-answer="(callId, name) => $emit('openToolAnswer', callId, name)"
        />
      </div>
      <div
        v-else
        class="entry"
        :class="{ 'summarised-out': dimmed(row) }"
        :data-item="row.item.id"
        :data-ordinal="row.item.ordinal"
        :data-summarised="dimmed(row)"
      >
        <UserMessage
          v-if="row.item.kind === 'user'"
          :item="row.item"
          :paths="props.paths"
          @open-conversation="(id) => $emit('openConversation', id)"
        />
        <!-- 🔴 Sent, but not by the person (278 §1). Its own component for the same reason the one
           below is: a message BroBot wrote and a message somebody typed must not be told apart by a
           footnote. It sits in the conversation because it really went to the provider and really
           started the turn under it — 276 measured the mode switch alone doing 0/2 of that. -->
        <ContinuationEntry v-else-if="row.item.kind === 'continuation'" :item="row.item" />
        <!-- 🔴 The app's OWN report of something it observed (624, `HO-095` §6.1). Its own
           component rather than the one above for the reason that one is its own: the AUTHORSHIP
           is the same and the SUBJECT is not, and "sent for you" is false of a row nobody pressed
           anything for. ⛔ Until this dispatch a decision and a person's answer reached the entry
           above and inherited a caption about a plan button. -->
        <AnsweredQuestionEntry
          v-else-if="
            (row.item.kind === 'appNotice' ||
              row.item.kind === 'relayed' ||
              row.item.kind === 'queued') &&
            answerIn(row.item)
          "
          :item="row.item"
          :answer="answerIn(row.item)!"
          :question-item="questionItemIn(shown, answerIn(row.item)!.requestId)"
          :hold-disclosure="
            row.item.kind === 'queued' && row.item.messageId
              ? queueById.get(row.item.messageId)
              : undefined
          "
          :limit-now="props.limitNow"
          :kept="kept"
          :can-open-document="props.canOpenDocument"
          :taken-in="props.takenIn ?? null"
          :identities="props.identities ?? null"
          :own-agent="props.ownAgent ?? null"
          :held="heldIds"
          :recorded="props.recorded"
          :with-its-next-message="props.recorded && props.takenWithoutThisWindow === null"
          @focus-item="focusAnsweredQuestion"
          @open-document="(id) => $emit('openDocument', id)"
          @open-conversation="(id) => $emit('openConversation', id)"
        />
        <AppNoticeEntry v-else-if="row.item.kind === 'appNotice'" :item="row.item" />
        <!-- 🔴 Also BroBot's words, and about something else entirely (406). Work this conversation
           gave out came back — a reply, or the notice that nothing is driving it — and until this
           entry both were drawn as the person's own bubble. Its own component rather than the one
           above for the reason that one is its own: the AUTHORSHIP is the same and the SUBJECT is
           not, and "sent for you" is false of every report. -->
        <WorkReportEntry
          v-else-if="row.item.kind === 'workReport'"
          :item="row.item"
          :held="heldIds"
          :identities="props.identities ?? null"
          :own-agent="props.ownAgent ?? null"
          :can-open-document="props.canOpenDocument"
          :kept="kept"
          @open-conversation="(sessionId) => $emit('openConversation', sessionId)"
          @open-document="(resourceId) => $emit('openDocument', resourceId)"
        />
        <!-- 🔴 Words another conversation wrote, carried here (413). Its own component rather than
           either of the two above for the reason they are each other's: the AUTHORSHIP is the same
           and the SUBJECT is not, and "sent for you" is the opposite of true here — nobody pressed
           anything and the words are not being sent on the reader's behalf. This is how work is
           handed over, so it is also the commonest of the three. -->
        <!-- ⚑ **658 · and to WHOM** — `ownAgent` since `667`: the name this conversation's own rows
             are headed with where there is one, so *"Ada to BroBot"* cannot name the recipient
             differently from the agent's replies, and *this conversation* where there is none. -->
        <RelayedEntry
          v-else-if="row.item.kind === 'relayed'"
          :item="row.item"
          :identities="props.identities ?? null"
          :own-agent="props.ownAgent ?? null"
          :kept="kept"
          :can-open-document="props.canOpenDocument"
          :taken-in="props.takenIn ?? null"
          :held="heldIds"
          @open-conversation="(sessionId) => $emit('openConversation', sessionId)"
          @open-document="(resourceId) => $emit('openDocument', resourceId)"
        />
        <!-- Typed but not sent (077). Its own component, never a variant of the bubble above: the
           two must not be confusable at a glance, which is the transcript half of the dispatch's
           "must not show a message as sent before it was". -->
        <QueuedMessage
          v-else-if="row.item.kind === 'queued'"
          :item="row.item"
          :hold-disclosure="row.item.messageId ? queueById.get(row.item.messageId) : undefined"
          :limit-now="props.limitNow"
          :identities="props.identities ?? null"
          :own-agent="props.ownAgent ?? null"
          :may-carry-on="mayCarryOn.has(row.item.id)"
          :recorded="props.recorded"
          :with-its-next-message="props.recorded && props.takenWithoutThisWindow === null"
          :can-restore="props.canRestoreQueued"
          :held="heldIds"
          @open-conversation="(sessionId) => $emit('openConversation', sessionId)"
          :can-stop="props.canStopTurn"
          @cancel="(messageId) => $emit('cancelQueued', messageId)"
          @stop="(messageId) => $emit('stopQueued', messageId)"
          @restore="(text, handed) => $emit('restoreQueued', text, handed)"
        />
        <AssistantMessage
          v-else-if="row.item.kind === 'assistant'"
          :item="row.item"
          :who="props.who"
          :documents="documentsNamed"
          :paths="props.paths"
          :can-answer="props.canSendAnswers && !answeredAssistantIds.has(row.item.id)"
          @open-document="(resourceId) => $emit('openDocument', resourceId)"
          @answer="(text) => $emit('sendAnswer', text)"
        />
        <!-- Render calls that speak to another conversation as outgoing cards, as classified by the fold. Questions on those cards use the same `respond` action as other question cards. -->
        <OutgoingEntry
          v-else-if="
            row.item.kind === 'tool' && row.item.outgoing !== undefined && drawsAsACard(row.item)
          "
          :item="row.item"
          :words="row.item.outgoing"
          :own-agent="props.ownAgent ?? null"
          :identities="props.identities ?? null"
          :held="heldIds"
          :gave-out="props.gaveOut ?? null"
          :can-open-document="props.canOpenDocument"
          :kept="kept"
          :draft-for="props.draftFor"
          :can-answer="props.canAnswerQuestions"
          :paths="props.paths"
          :can-read-answer="props.canReadToolAnswers"
          :take-back="props.takeBack"
          @open-conversation="(sessionId, briefOf) => $emit('openConversation', sessionId, briefOf)"
          @open-document="(resourceId) => $emit('openDocument', resourceId)"
          @respond="(id, response) => $emit('respond', id, response)"
          @move="(id, decision) => $emit('move', id, decision)"
          @open-answer="(callId, name) => $emit('openToolAnswer', callId, name)"
        />
        <ToolEntry
          v-else-if="row.item.kind === 'tool'"
          :item="row.item"
          :tail="props.tailFor?.(row.item.callId) ?? null"
          :can-watch="props.canWatchCommands"
          :output-capability="props.outputCapability"
          :background-output-capability="props.backgroundOutputCapability"
          :can-stop="props.canStopCommands"
          :stopping="props.stoppingCall?.(row.item.callId) ?? false"
          :can-read-answer="props.canReadToolAnswers"
          :can-open-child="props.canOpenChildWork"
          :can-open-output="props.canOpenWorkflowOutput"
          @open-output="(taskId, workflow) => $emit('openWorkflowOutput', taskId, workflow)"
          @open-child="(what, label) => $emit('openChildWork', what, label)"
          @watch="(callId, on) => $emit('watchCommand', callId, on)"
          @stop="(callId, key) => $emit('stopCommand', callId, key)"
          @open-answer="(callId, name) => $emit('openToolAnswer', callId, name)"
        />
        <PermissionCard
          v-else-if="row.item.kind === 'permission'"
          :item="row.item"
          :draft="props.draftFor?.(row.item.request.id)"
          :own-agent="props.ownAgent ?? null"
          :provider="props.provider ?? null"
          :taken-without-this-window="props.takenWithoutThisWindow"
          :paths="props.paths"
          @decide="(id, decision) => $emit('decide', id, decision)"
          @take-it-over="$emit('takeItOver')"
        />
        <UserInputCard
          v-else-if="row.item.kind === 'userInput'"
          :item="row.item"
          :draft="props.draftFor?.(row.item.request.id)"
          :own-agent="props.ownAgent ?? null"
          :taken-without-this-window="props.takenWithoutThisWindow"
          :paths="props.paths"
          @respond="(id, response) => $emit('respond', id, response)"
          @take-it-over="$emit('takeItOver')"
        />
        <ThinkingEntry v-else-if="row.item.kind === 'thinking'" :item="row.item" />
        <PlanEntry v-else-if="row.item.kind === 'plan'" :item="row.item" />
        <!-- A sub-agent whose dispatching row is not on screen. Nested cards never come through
           here — ToolEntry renders those inside the row they belong to. It is a transcript entry
           like any other and is styled as one (034): same measure, same trailing space. -->
        <SubAgentEntry
          v-else-if="row.item.kind === 'subAgent'"
          :card="row.item.card"
          placement="transcript"
          :can-read-answer="props.canReadToolAnswers"
          :can-open-transcript="props.canOpenChildWork"
          :paths="props.paths"
          @open-child="(what, label) => $emit('openChildWork', what, label)"
          @open-answer="(callId, name) => $emit('openToolAnswer', callId, name)"
        />
        <NoticeEntry
          v-else-if="row.item.kind === 'notice'"
          :item="row.item"
          :identities="props.identities ?? null"
          :provider="props.provider"
        />
        <!-- The one durable fact a compaction leaves (087). Above it, the conversation fades — see
           `faded`. It renders in BOTH modes: the toggle is for whispers, and this is the reason the
           agent will not remember what it was told an hour ago. -->
        <CompactionEntry
          v-else-if="row.item.kind === 'compaction'"
          :item="row.item"
          :who="props.who"
        />
        <!-- The harsher sibling of the row above (199): the model did not summarize what is above
           this line, it lost it, and the provider is answering from a different conversation. Both
           modes, for the same reason the compaction boundary is in both. -->
        <ConversationResetEntry
          v-else-if="row.item.kind === 'reset'"
          :item="row.item"
          :who="props.who"
        />
        <!-- The picture, where it was made (067). The click travels up rather than opening anything
           here: this component holds no state, and an overlay is state. -->
        <ImageEntry
          v-else-if="row.item.kind === 'image'"
          :item="row.item"
          :can-read="props.canReadImages"
          :can-open="props.canOpenImages"
          @open="() => $emit('openImage', row.item as ImageItem)"
        />
        <!-- ⛔ **A file that appeared in the memory store, not a call anybody reported** (318 §2.1).
           Both modes, for the reason the two rows above are in both: it is the one place the
           conversation says a memory was kept, and 316 measured that nothing else ever will. -->
        <MemoryNoteEntry
          v-else-if="row.item.kind === 'memoryNote'"
          :item="row.item"
          :can-open-store="props.canOpenStore"
          @open-instructions="$emit('openInstructions')"
        />
        <!-- ⛔ **What the agent said it READ** (319 §1) — the other half of the row above, and the one
           friction log F5 actually asked for. Both modes, for its neighbour's reason: a row only a
           debug toggle reveals is a row the person who filed F5 would still not see. ⚠️ No
           `can-open-store` and no events: nothing in this row is clickable, because every path in it
           was written by the model and this app does not resolve one. -->
        <MemoryRecallEntry v-else-if="row.item.kind === 'memoryRecall'" :item="row.item" />
        <!-- ⛔ **How the conversation OPENED** (332) — the third memory row, and the only one that is
           about a moment before the first turn. Both modes, for its two neighbours' reason. ⚠️ It
           takes `can-open-store` like the first of them and for the same reason: `ReadingPane` has
           no drawer, and a button that does nothing when pressed is `106`. -->
        <MemoryLoadedEntry
          v-else-if="row.item.kind === 'memoryLoaded'"
          :item="row.item"
          :can-open-store="props.canOpenStore"
          @open-instructions="$emit('openInstructions')"
        />
        <UnknownEntry v-else :item="row.item" />
      </div>
    </template>

    <!-- A turn at work says so where its reply will appear. Only the constant word is announced,
         once; the tool's name beside it changes without a word read aloud each time. -->
    <!-- The model thinking in silence: one line whose count moves, gone when the silence ends. -->
    <p v-if="props.stillThinking" class="working" data-cy="transcript-still-thinking">
      <span class="working-dot" aria-hidden="true"></span>
      <span role="status">{{ props.stillThinking }}</span>
    </p>
    <p v-else-if="working" class="working" data-cy="transcript-working">
      <span class="working-dot" aria-hidden="true"></span>
      <span role="status">working…</span>
      <span v-if="working.tool" class="working-tool" data-cy="transcript-working-tool">
        running {{ working.tool }}
      </span>
    </p>

    <!-- An empty body has two very different causes, and saying which one is the difference
         between "nothing has happened" and "things happened, this view hides them" — a user who
         cannot tell those apart cannot tell a quiet start from a stuck one. -->
    <!-- STICKY at the bottom of the scroll container rather than a sibling below it: it has to stay
         visible while the reader is scrolled anywhere, and putting it outside would change the
         container's height and quietly break the follow-the-bottom signal, which measures exactly
         that. Rendered only when the newest message is out of the reader's view. -->
    <!-- 🔴 **UI-010 (F053) · gated on where the newest message IS, and the two ways it leaves the
         view.** The window let go of the end (`!atTail`, 313: the escape must exist whether or not
         anything arrives, or an idle session strands its reader), or the reader scrolled up a
         window that still holds it (`endInView`). ⛔ Never on the window's count of arrivals, which
         counts events — every thinking delta among them — and has nothing to say about the screen.
         See the `atTail` prop. -->
    <div
      v-if="props.jumpToLatest && (!props.atTail || !endInView)"
      class="behind"
      data-cy="transcript-behind"
    >
      <button
        type="button"
        class="jump-latest"
        data-cy="jump-to-latest"
        :disabled="jumping"
        @click="jumpBack()"
      >
        Jump to latest
      </button>
    </div>

    <p v-if="shown.length === 0" class="empty" data-cy="transcript-empty">
      {{
        items.length === 0
          ? 'No messages yet — say something below.'
          : 'Nothing to show yet — this view hides lifecycle events and provider chatter.'
      }}
    </p>
  </section>
</template>

<style scoped>
/* Break long paths and identifiers inside the transcript, not the whole window. */
.stream {
  min-height: 0;
  flex: 1;
  padding: var(--space-12);
  overflow: auto;
  overflow-wrap: anywhere;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.entry {
  position: relative;
}

.entry.summarised-out {
  opacity: var(--summarised-fade);
}

.entry.flash::after {
  position: absolute;
  max-width: calc(var(--measure-message) + 16px);
  margin: 0 auto;
  border: var(--border-width) solid var(--accent);
  border-radius: var(--radius);
  animation: entry-flash 1.6s ease-out forwards;
  content: '';
  inset: 0;
  pointer-events: none;
}

@keyframes entry-flash {
  0%,
  55% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}

.empty {
  max-width: var(--measure-message);
  margin: 0 auto;
  color: var(--faint);
  font-size: var(--type-small);
  text-align: center;
}

.older {
  display: flex;
  max-width: var(--measure-message);
  flex-direction: column;
  align-items: center;
  margin: 0 auto var(--space-8);
  gap: var(--space-2);
}

.load-older {
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
}

.load-older:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--text-soft);
}

.load-older:disabled {
  cursor: default;
  opacity: 0.6;
}

.older-note {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
}

.older-error {
  margin: 0;
  color: var(--danger, var(--faint));
  font-size: var(--type-caption);
}

.behind {
  position: sticky;
  z-index: 1;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding-top: var(--space-4);
}

.jump-latest {
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--panel-2);
  color: var(--text-soft);
  box-shadow: var(--shadow-float);
  cursor: pointer;
  font-size: var(--type-caption);
}

.jump-latest:hover {
  border-color: var(--accent, var(--line-strong));
}

.working {
  display: flex;
  max-width: var(--measure-message);
  align-items: center;
  margin: 0 auto var(--space-6);
  padding-left: calc(var(--avatar-small) + var(--space-6));
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.working-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  animation: working-pulse 1.4s ease-in-out infinite;
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.working-tool {
  color: var(--muted);
}

@keyframes working-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .working-dot {
    animation: none;
  }
}
</style>
