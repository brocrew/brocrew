<script setup lang="ts">
import { useClientApi } from '../client-provider/injection'
import { useRecoveredConversationList } from '../composables/useConversationListRecovery'
import { useModalDepth } from './OverlayHost.vue'
import { useProviderNames } from '../composables/useProviderNames'
import { providerNamesIn } from '../lib/front-door-words'
import type { WhatEachConversationIsWaitingOn } from '../../../shared/task-contracts'

import { chordKeys, chordSaid, platformHere } from '../lib/this-computer'
import crewMark from '../assets/brocrew-mark.svg'
import { computed, onBeforeUnmount, onMounted, nextTick, ref, useId, watch, watchEffect } from 'vue'
import { agentStateWords } from '../../../shared/agent-state'
import {
  facetsOfState,
  NEEDS_YOU,
  recordFacets,
  standingOf,
  standingWord,
  stateHere,
  stateForRecord,
  type AgentFacets,
  type Standing,
} from '../lib/agent-state'
import {
  conversationList,
  withConversationStates,
  conversationTitle,
  groupWorkers,
  workerLabel,
  workerState,
  workerSubtitles,
  workerDescription,
  workerName,
  onPurposeSaid,
  type ListedConversation,
} from '../lib/conversation-list'
import { OPEN_IN_ANOTHER_WINDOW } from '../lib/taking-over'
import { agoWords, fullTime } from '../lib/clock'
import {
  CONVERSATION_IDENTITY_BATCH_SIZE,
  type ConversationIdentity,
  type ConversationIdentityBatchInput,
} from '../../../shared/conversation-title'
import type { WorkSearchQuery, WorkSearchResult } from '../../../shared/work-search'
import type { PaletteAgent, PaletteNavigation, PaletteOpenRow } from '../lib/command-palette'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
import { liveSignalView } from '../lib/live-signal'
// 🔴 **636 · the one wait each row is in, out of the reading that covers every conversation** —
// see {@link SideRail.waiting}, and {@link theWaitIn} for the three absences it narrows.
import {
  theWaitIn,
  whoItOwesIn,
  theWorkIn,
  whatTheWaitsCouldNotRead,
  whoseAnswerIn,
  whoseWorkIn,
  stoppedWorkIn,
} from '../lib/conversation-waits'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'

import type { ProviderLimitsView } from '../lib/persons-queue'
import { providerLimitDisplay } from '../lib/provider-limit-status'
import type { ProviderBlockStore } from '../lib/provider-limit-facts'
import { useMinuteClock } from '../composables/useMinuteClock'
import { railFacts, useWhoCalledWhom, type RailSays } from '../composables/useWhoCalledWhom'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import { workByConversation } from '../lib/working-together'
import type { AppInfo } from '@brobot2/shared'
import { whereItWorks } from '../lib/session-record'
import { agentName } from '../../../shared/runtime-ipc'
import type { SessionRecord } from '../lib/session-record'
import { useSpawnSafety } from '../lib/spawn-safety'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import AgentState from './AgentState.vue'
import CommandPalette from './CommandPalette.vue'
import UpdatesMenu from './UpdatesMenu.vue'
import WorkspacesSection from './WorkspacesSection.vue'
import VersionButton from './VersionButton.vue'
import { COLLAPSE_THE_MENU, EXPAND_THE_MENU } from '../lib/rail-fold'

/**
 * The rail holds destinations, the conversation list, one live signal and the stop switch.
 * Tools, agents and projects keep their counts and actions on their own pages.
 * Conversations are split by whether they need you; the stop switch stays in reach.
 */
const client = useClientApi()
const nameOfProvider = useProviderNames(client)
const props = withDefaults(
  defineProps<{
    /** The conversations this window is fed — `SessionStore.live`. */
    open: readonly Readonly<SessionRecord>[]
    providerBlocks?: ProviderBlockStore
    activeId: string | null
    /**
     * ⚑ **D-017b · the record the screen is drawing**, or `null` — a recorded one is held only while
     * it is on screen, so it is handed in beside {@link open}: the palette asks it what its agent
     * answers to, and its row says it is opening. ⛔ Its row is the host's: a recorded record is
     * never drawn as a row of its own, so a conversation the list does not name (one found in a
     * person's own folder, or restored from a bundle) never reaches the rail by being on screen.
     */
    onScreen?: SessionRecord | null
    /** Which non-conversation destination is showing: a place, or null. */
    place: string | null
    /**
     * ⛔ **How many things need the user** — `homeAttention(...).total`, what *Waiting on you*
     * lists (305 §1).
     *
     * Passed in rather than derived here, for the reason 099 made expensive: this rail already
     * computes one `facets` call per conversation, and a second derivation of the same fact two
     * components apart is how the rail and the pane came to disagree about one session.
     */
    needsYou?: number
    /**
     * 🔴 **The agent identities** (355) — **and since `570` this rail draws no list of them.**
     *
     * ⛔ **Rows.** These are the `agent_identity` rows a grant can name and a give can be refused
     * against; the launcher's profile menu is a `readdir` and is a different list.
     *
     * ## ⚠️ Why the prop stays after `EXT-008` §4.4 took the AGENTS section out
     *
     * Keep the roster prop for conversation naming through `who()` and for `conversation-list.ts`, which the palette also reads. Removing the old roster section must not revert conversation names to cwd basenames; `the-screen-nothing-reaches.test.ts` covers both readers.
     *
     * ⚠️ **Null before the read lands and on a host with no database.** ⛔ That state is SPOKEN
     * now by `TeamWorkspace`'s *Reading identities…* line rather than by a rail section drawing
     * nothing; here it only means the rows fall back to `profileLabel`.
     */
    agents?: AgentIdentities | null
    /**
     * 🔴 **How much needs a person, as of one stated moment** (571) —
     * `567`'s `readWorkspace`, and the rail's one live signal (`EXT-008` §4.3).
     *
     * ⛔ **Passed IN and never derived here**, for {@link SideRail.needsYou}'s reason and one
     * stronger: this rail HOLDS two of the facts a reader might be tempted to build it from —
     * `props.open` is what this WINDOW is running and {@link SideRail.needsYou} is *Waiting on
     * you*'s wider total — and neither is what `EXT-008` §4.3 asked for. ⚠️ **A workspace count composed from
     * a window's own lists would be the renderer sum `564` measured and refused:** *"a renderer
     * sum would race the separate reads."*
     *
     * ⚑ **Null before the first reading lands and on a host with no database**, which the line
     * says by not being drawn — see `liveSignalView`, where that refusal is argued.
     */
    workspace?: WorkspaceReading | null
    /**
     * 🔴 **A0 · the workspace this window runs on** (`AppInfo.workspace`): its name, drawn in the
     * footer with its first letter as the avatar, and its folder, on hover. ⛔ Never a person's name.
     * `null` until the app has said.
     */
    workspaceFolder?: AppInfo['workspace'] | null
    /** ⚑ B2 · this BroBot's version (`AppInfo.version`), for the menu before updates answer. */
    appVersion?: string | null
    /**
     * 🔴 **What the queue's band says about the PROVIDERS** (617, `HO-080` §4) — the same
     * `ProviderLimitsView` `PersonsQueue.vue` draws, supplied here so the rail is a second PLACE
     * for the fact and never a second answer about it.
     *
     * > ⚑ **The PO:** *"That signal exists to answer* is anything happening. *A wall is the one
     * > condition where the answer changes from* yes *to* no *and nothing else on screen says
     * > so."*
     *
     * ⛔ **Passed IN like {@link SideRail.workspace}, and for a second reason of its own**:
     * `usePersonsQueue()` is a module singleton this component could simply call, and reaching for
     * it would make the rail's one line unmountable without supplying a whole queue — which is the
     * shape `the-counts-nobody-can-see.dom.test.ts` measures the line at 208px with.
     *
     * ⚠️ **`null` is *nobody has looked for a wall*, and the line MARKS it** rather than reading it
     * as an all-clear — see `stoppedOnTheLine`, and `533` §0, which is this app having said
     * nothing while both providers had walled.
     */
    limits?: ProviderLimitsView | null
    /**
     * 🔴 **What every conversation this app is RUNNING is waiting on** (636, `621` §5.1 ·
     * `HO-095` §5.1 · `HO-096` §4) — `store.whatEachConversationIsWaitingOn()`, the door `621`
     * built and left with no reader.
     *
     * ## ⛔ Why the rail cannot derive it and a poll has to hand it over
     *
     * ⚠️ **`recordFacets` reads five facets off `record.control`, which is THIS window's fold of
     * each conversation's own ledger.** ⛔ A child's `work_replied` is written into the CHILD's
     * ledger, so — `RuntimeScreen`'s own note — *"the conversation that gave the work is told
     * nothing at all when the work moves."* ⚑ **No window can derive this from its own stream**,
     * which is `621` §4's measurement and the reason this is a reading rather than a fold.
     *
     * ## ⚑ Passed IN, exactly like {@link SideRail.workspace} and {@link SideRail.limits}
     *
     * ⛔ **`617`'s shape, copied rather than re-invented** (the brief's own instruction): the
     * cadence lives in `RuntimeScreen` beside the queue's and the live signal's, and reaching for
     * a store here would make the rail unmountable without one — which is the constraint
     * `the-counts-nobody-can-see.dom.test.ts` measures this column at 208px under.
     *
     * ## ⚠️ `null` is *nobody has looked*, and it is NOT *nothing is waiting*
     *
     * ⛔ **Three absences reach a row and {@link theWaitIn} is the only place they are collapsed**
     * — see {@link WaitReading}. ⚑ A row whose wait was not read draws the word its five live
     * facets were already producing; **the absence never becomes `idle`**, because `idle` is what
     * the DOING says and the DOING is a fact this app holds.
     */
    waiting?: WhatEachConversationIsWaitingOn | null
    /** Collapsed to its icons, and each conversation to its avatar and work label. */
    collapsed?: boolean
    readIdentities?: (
      input: ConversationIdentityBatchInput,
    ) => Promise<readonly ConversationIdentity[]>
    identityRevision?: number
    searchConversations?: (
      conversation: string,
      query: WorkSearchQuery,
    ) => Promise<WorkSearchResult>
  }>(),
  {
    collapsed: false,
    onScreen: null,
    needsYou: 0,
    agents: null,
    workspace: null,
    workspaceFolder: null,
    appVersion: null,
    limits: null,
    waiting: null,
  },
)

const emit = defineEmits<{
  /**
   * ⚑ **D-017b · open a conversation in its one full view** — every row's press, whatever the
   * conversation is doing. The screen owns which surface is showing, so it owns the look too.
   */
  select: [sessionId: string]
  readConversation: [sessionId: string]
  /** Show the new-conversation surface. Starting it happens there, where the thread begins. */
  newConversation: []
  /**
   * ⛔ **A destination the rail names, as a literal union and not `string`** — so a third one
   * cannot arrive without this line, `useSurface.RESERVED_PLACES` and `command-palette.ts`'s own
   * arm all moving together. The palette still names Tools and Providers; the screen opens their
   * tabs inside Settings.
   *
   * ⚠️ **The dependency runs one way.** `command-palette.ts`'s own `place` union must be a SUBSET
   * of this one — {@link fromPalette} hands its value straight to this emit — so widening the
   * palette without widening this line is a type error and the reverse merely compiles.
   */
  go: [place: 'waiting' | 'away' | 'sessions' | 'tools' | 'team' | 'providers' | 'settings']
  /** A person pressed the toggle that collapses or expands the menu. */
  fold: []
}>()

/**
 * 🔴 **The global spawning switch — the WINDOW's, not this rail's** (390).
 *
 * ⚠️ **It used to be `props.agents.spawningEnabled` and a `setSpawning` emit**, which was right
 * while the rail was the only place it was drawn. `388` found the half that made it wrong: every
 * `OverlayHost` covers this rail, so the one control that stops agents creating conversations was
 * unreachable — by mouse and by Tab — whenever any modal was open. ⛔ **The stop is now drawn twice
 * and supplied once**, from `lib/spawn-safety.ts`, so no press and no read can put the two surfaces
 * in different states. ⚠️ **The identities SECTION that used to read {@link SideRail.agents} is
 * gone** — `EXT-008` §4.4 took it out of the navigation column at `570` — and the prop stays for
 * the two readers named on it, neither of which is a list.
 *
 * ⚑ **In the rail rather than inside a sheet, and that is still the whole of "fast"** (355 §1). A
 * kill switch you have to open something to reach is one you reach after the thing you wanted to
 * stop.
 */
const safety = useSpawnSafety()

/**
 * ⛔ **The *Waiting on you* badge counts what that page calls WORK** — the two REAL populations
 * (468).
 *
 * 205 made it live-only and was right to: it had been the demo seed's number, on a button whose own
 * chip said "soon" — and 195 H3 is what that cost, a real conversation frozen on a permission for
 * 63 seconds with nothing on screen counting it.
 *
 * ⚑ **The number is `homeAttention(...).total`, computed by the screen from the same call *Waiting
 * on you* makes**, so the badge and the screen it opens cannot come to different numbers. The
 * badge on each conversations section below (BroBot's, the other agents') counts CONVERSATIONS,
 * because that is what its section lists.
 *
 * ⚑ **`EXT-008` §3 split Home in two at `606`**, and this count belongs to the half that is
 * COMPLETE regardless of age — ⛔ **never to the windowed one**.
 */
const waitingCount = computed(() => props.needsYou)

/**
 * 🔴 **606 · why there is no second count here, written down so it is a decision and not an
 * omission.**
 *
 * ⛔ **`EXT-008` §5:** ⚑ ***"Destinations only… No counts, no `+`, no lists, no explanatory
 * sentences."*** ⚠️ **The mockup is more specific still** — it badges *Waiting on you* and draws
 * nothing at all on *While you were away*.
 *
 * ⚑ **The windowed count IS drawn**, as the *Changed* stat inside `WhileYouWereAway` itself.
 * 🔴 **Which makes `HO-025` §2 structural rather than a convention**: the COMPLETE count and the
 * WINDOWED count are never on one surface, so nothing can sum them by accident — and `304`'s
 * shape has one fewer place to happen rather than one more.
 *
 * ⛔ **And it is what keeps the digest's poll gated to its own screen.** A badge here is drawn
 * wherever a person is, so it would have to be FRESH wherever a person is — one synchronous store
 * walk every thirty seconds, for somebody reading a conversation.
 */

/**
 * 🔴 **571 · the rail's one live signal** — `EXT-008` §4.3's *"Not a list. One line."*
 *
 * ⚑ **A ticking clock and not `Date.now()` at render**, because the only thing on this line that
 * moves without a new reading is how OLD the reading is: a computed that re-evaluated only when
 * `props.workspace` changed would report an age of zero for ever and go quiet exactly when the
 * re-reads stopped. ⚠️ `WorkingTogether`'s supply to `workingTogetherView`, one surface over.
 */
const railMinute = useMinuteClock()
/**
 * 🔴 **B2 · the footer's menu** — this BroBot's version and its updates ({@link UpdatesMenu}).
 * ⚑ Closed by Esc, a second press, or a press anywhere else; focus goes back to the footer.
 */
const updatesOpen = ref(false)
const modalDepth = useModalDepth()
const footerBox = ref<HTMLElement | null>(null)
const footerButton = ref<HTMLButtonElement | null>(null)
const workspacesOpen = ref(false)
const workspaceDialog = ref<HTMLElement | null>(null)
const versionButton = ref<InstanceType<typeof VersionButton> | null>(null)
const footerName = computed(() => `${workspaceName.value ?? 'Local workspace'}, choose a workspace`)

/** ⚑ Esc closes it from anywhere while it is open, wherever focus went after a press. */
function escapeCloses(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || modalDepth.value > 0) return
  if (updatesOpen.value) closeUpdates()
  else if (workspacesOpen.value) {
    workspacesOpen.value = false
    footerButton.value?.focus()
  }
}

function toggleWorkspaces(): void {
  workspacesOpen.value = !workspacesOpen.value
  updatesOpen.value = false
  if (workspacesOpen.value) {
    void nextTick(() => {
      const target =
        workspaceDialog.value?.querySelector<HTMLElement>('button:not(:disabled)') ??
        workspaceDialog.value
      target?.focus()
    })
  }
}

function toggleUpdates(): void {
  updatesOpen.value = !updatesOpen.value
  workspacesOpen.value = false
}

function closeUpdates(): void {
  updatesOpen.value = false
  versionButton.value?.focus()
}

function pressElsewhere(event: PointerEvent): void {
  if (modalDepth.value > 0) return
  if (footerBox.value !== null && !footerBox.value.contains(event.target as Node)) {
    updatesOpen.value = false
    workspacesOpen.value = false
  }
}

watch([updatesOpen, workspacesOpen], ([update, workspace]) => {
  if (update || workspace) {
    document.addEventListener('pointerdown', pressElsewhere)
    document.addEventListener('keydown', escapeCloses)
  } else {
    document.removeEventListener('pointerdown', pressElsewhere)
    document.removeEventListener('keydown', escapeCloses)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', pressElsewhere)
  document.removeEventListener('keydown', escapeCloses)
})

/** ⚑ A3 · a rename made from the menu, said at once; `AppInfo.workspace` is read at launch. */
const renamedTo = ref<string | null>(null)
const workspaceName = computed(() => renamedTo.value ?? props.workspaceFolder?.name ?? null)

/** ⚑ A0 · the workspace name's first letter, by code point, for the footer's avatar. */
const workspaceInitial = computed(
  () => [...(workspaceName.value?.trim() ?? '')][0]?.toUpperCase() ?? '',
)

const liveSignal = computed(() =>
  liveSignalView(props.workspace, props.limits, railMinute.value, providerNamesIn(nameOfProvider)),
)

/* ---------------------------------------------------------------------------
   ⚑ D-017b · the ONE list — the host's two reads, folded by `conversation-list.ts`,
   with the conversations this window holds drawn from their own records beside it.
   --------------------------------------------------------------------------- */

const lists = railFacts()
onBeforeUnmount(() => lists.clear())

const {
  hostResumable,
  hostUnresumable,
  coverageComplete,
  looked,
  listError,
  said,
  providerBlocks,
  hearStates,
  refreshListed,
} = useRecoveredConversationList(
  () => props.workspaceFolder?.path ?? null,
  () => client.sessions,
  () => props.providerBlocks,
)

const readList = computed(() =>
  conversationList({
    resumable: hostResumable.value,
    unresumable: hostUnresumable.value,
    identities: props.agents?.identities ?? null,
    providerSaid: providerBlocks.value.snapshot(),
  }),
)
const listed = computed(() =>
  withConversationStates(
    readList.value,
    new Map([...said.value].map(([conversation, heard]) => [conversation, heard.state])),
  ),
)
const cast = useWhoCalledWhom()
// Index the forest once per reading, rather than walking it for every row on every render.
const workByHolder = computed(() => workByConversation(cast.forest.value))
watchEffect(() => {
  lists.update({ listedConversations: looked.value ? listed.value : null })
  if (!looked.value) {
    lists.update({ runningConversations: null })
    return
  }
  const live = new Map(
    [...hostResumable.value, ...hostUnresumable.value]
      .filter((row) => row.running !== 'not-running')
      .map((row) => [row.sessionId, row.provider]),
  )
  lists.update({
    runningConversations: listed.value.flatMap(({ sessionId, state }) => {
      const provider = live.get(sessionId)
      return provider === undefined ? [] : [{ sessionId, provider, state }]
    }),
  })
})

onMounted(refreshListed)

/**
 * Name the agent in this conversation.
 *
 * > *"in the left conversation list panel, can we actually show the role? now it shows
 * > `brobot-workspace` and that is not a relevant information."*
 *
 * ⛔ **It returned `basenameOf(cwd)` until 449**, and with `424` running BroBot's own conversation
 * in `<userData>/brobot-workspace` that is the one thing every conversation started there shares.
 * ⚑ **The identity was on the record the whole time** — `meta.profileId`, resolved by the host and
 * never echoed from a request — and {@link agentName} is what `TeamWorkspace`'s roster names it
 * by too, one surface over since `EXT-008` §4.4 moved that list off this rail.
 *
 * ⚑ **It is NOT `identity.displayName ?? identity.slug` written a second time**, which is what the
 * AGENTS section carried before `449`: `a-row-that-says-who-is-in-it.test.ts` §3 greps this file,
 * prose stripped, for exactly that expression — and this sentence is its planted control, so a
 * stripper that stopped stripping fails there rather than passing by accident. ⚠️ **The control
 * was TWO plants and is one**, because the second was in the evicted section's own comment; the
 * second plant is in `team-roster.ts`'s docblock now, where the fourth list of identities lives.
 *
 * ⚠️ **The id is still the answer when there is no `meta`**, which is a record this window has made
 * and the host has not answered for yet. ⛔ Naming it BroBot on the strength of a null would be
 * inventing an identity, which is exactly what `profileLabel`'s own note forbids one null from
 * doing — and this is the other one.
 *
 * ⚑ **667 · asked in the one spelling** the pane and the cards beside it use — which `agentName`
 * folds itself since `671` (`678` dropped the renderer's second fold).
 */
function who(record: SessionRecord): string {
  const meta = record.meta
  if (!meta) return record.sessionId
  return identityName(meta)
}

function identityName(meta: { readonly profileId: string }): string {
  return agentName(meta.profileId, props.agents?.identities ?? null)
}

/**
 * ⛔ **WHERE it is working** (449) — the folder, which is what {@link who} replaced on the row.
 *
 * ⚠️ **`placeOf` and not `place`**: this component already has a `place` PROP — which non-conversation
 * destination is showing — and a helper of that name is a `vue/no-dupe-keys` error rather than a
 * style question, because both reach one template scope.
 *
 * ⚑ **It is kept, and keeping it is the whole negative of this change.** `211 §3` exists because
 * *"both rail rows read exactly `workspace-a / codex · idle`"*; dropping the folder for the
 * identity would have rebuilt that defect with the axes swapped — two conversations of one agent
 * in two folders reading as one conversation. ⚠️ `null` when this app holds no path, so the row
 * says one fewer thing rather than an empty separator.
 */
function placeOf(record: SessionRecord): string | null {
  // ⚑ **470 · the rule moved to `lib/session-record.ts` and the FALLBACK stayed here**, which is
  // `449`'s own point: this row says one fewer thing rather than drawing an empty separator, and
  // the two other readers fall back to the session id instead.
  return whereItWorks(record)
}

/** ⚑ **D-017b · one row of the one list** — the same markup and the same press, whatever it is doing. */
interface RailRow extends PaletteOpenRow {
  readonly activityAt?: number
  readonly worker?: ListedConversation['worker']
  readonly facets: AgentFacets
  readonly detail?: string
  readonly standing: Standing
  /** ⚑ Another window has it open — said on the row, because a message from here is refused. */
  readonly elsewhere: boolean
}

/** Local records supply live state. Other rows and activity order come from the host listing. */
const rows = computed<RailRow[]>(() => {
  const byHost = new Map(listed.value.map((row) => [row.sessionId, row]))
  const shown = props.onScreen
  const drawn = new Map<string, { row: RailRow; at: number }>()
  // ⚑ **Fed here** — the fold is the present.
  for (const record of props.open) {
    const host = byHost.get(record.sessionId)
    const worker = host?.worker
    // 🔴 **636 · the sixth facet, and it is the one this record cannot hold** — see
    // {@link SideRail.waiting}. 🔴 **D-006 · and where the work it holds stands**, off the same
    // reading. ⚑ **D-017 · R19 — the wait carries who owes it the next move, as the host read it.**
    const facets = recordFacets(
      record,
      theWaitIn(props.waiting, record.sessionId),
      theWorkIn(props.waiting, record.sessionId),
      // ⚑ **F036 · who waits on its answer** — the host's own state of it, pushed to its listed row.
      whoItOwesIn(host?.state),
    )
    const currentState = stateForRecord(record, () =>
      stateHere(
        record,
        facets,
        whoseAnswerIn(props.waiting, record.sessionId),
        whoseWorkIn(props.waiting, record.sessionId),
        {},
        stoppedWorkIn(props.waiting, record.sessionId),
      ),
    )
    const limit = providerLimitDisplay(
      providerBlocks.value.get(record.sessionId) ?? record.meta,
      currentState,
      railMinute.value,
    )
    const standing = standingOf(facets)
    // An idle conversation holding a piece waiting on purpose says that wait, and its status line.
    const purpose = onPurposeSaid(standing === 'idle', host?.waitingOnPurpose)
    drawn.set(record.sessionId, {
      at: host?.updatedAt ?? Number.POSITIVE_INFINITY,
      row: {
        ...(worker ? { worker } : {}),
        sessionId: record.sessionId,
        activityAt: host?.updatedAt,
        provider: record.meta?.provider ?? null,
        facets,
        standing,
        ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
        word: limit?.short ?? purpose?.word ?? standingWord(facets, currentState),
        label: workerLabel(who(record), worker, host?.named),
        // 🔴 **D-016 · commit 7 · R2 — the work that names it is the host's**, off the row already
        // looked up for its order: a record this window is fed holds no tree.
        named: host?.named ?? null,
        // ⛔ **449 · the second of the two facts a row needs**, and the palette takes it too.
        place: placeOf(record),
        // ⛔ **The one fact that tells two rows apart** (211 §3), read off the record.
        opening: record.opening,
        elsewhere: false,
      },
    })
  }
  // ⚑ **Every other one — the host's word**, the one on screen included when it is drawn from its
  // ledger.
  for (const host of listed.value) {
    if (drawn.has(host.sessionId)) continue
    const facets = facetsOfState(host.state)
    const limit = providerLimitDisplay(
      providerBlocks.value.get(host.sessionId),
      host.state,
      railMinute.value,
    )
    const shownHere = shown?.sessionId === host.sessionId ? shown : null
    const purpose = onPurposeSaid(host.state.is === 'idle', host.waitingOnPurpose)
    drawn.set(host.sessionId, {
      at: host.updatedAt,
      row: {
        ...(host.worker ? { worker: host.worker } : {}),
        sessionId: host.sessionId,
        activityAt: host.updatedAt,
        provider: host.provider,
        facets,
        standing: standingOf(facets),
        word: limit?.short ?? purpose?.word ?? agentStateWords(host.state),
        ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
        label: workerLabel(host.label, host.worker, host.named),
        named: host.named,
        place: host.place,
        opening: shownHere?.opening ?? null,
        elsewhere: host.inAnotherWindow,
      },
    })
  }
  return [...drawn.values()].sort((one, other) => other.at - one.at).map(({ row }) => row)
})

/**
 * 🔴 **685 · the waits reading's unread rows, said once under the rows it qualifies** (`676`
 * F-R18a) — see {@link whatTheWaitsCouldNotRead}. ⚑ `props.open` is the population the rows
 * are drawn from, and each of them reads its wait from {@link SideRail.waiting}.
 */
const waitsShort = computed(() =>
  whatTheWaitsCouldNotRead(
    props.waiting ?? null,
    props.open.map((record) => record.sessionId),
  ),
)

/* ---------------------------------------------------------------------------
   The command palette (249) — hosted HERE, and the reason is the constraint.
   --------------------------------------------------------------------------- */

const palette = ref<InstanceType<typeof CommandPalette> | null>(null)

/**
 * ⛔ **The conversation that is ON SCREEN — one derivation, three consumers.**
 *
 * ⚠️ **`activeId` alone is not it.** `useSurface` is explicit that `activeId` is *"the conversation
 * the surface is about, whether or not it is the thing being drawn"* — so on a destination, on the
 * Sessions page or on the launcher it still names a conversation nobody is looking at. The rail already knew
 * that: its row's `active` class has always been `sessionId === activeId && place === null`.
 *
 * ⚑ **249 gave that expression a third reader and therefore a name.** The palette's *This
 * conversation* band would otherwise offer *"Export this conversation"* while the reader is on the
 * Sessions page, naming a conversation that is not on screen — `104`'s control describing a state it
 * is not in. Written once here, the highlighted row and the palette's band cannot come to disagree
 * about which conversation "this" is.
 */
const onScreenId = computed(() => (props.place === null ? props.activeId : null))
const paletteSearchCaller = computed(
  () =>
    listed.value.find((row) => row.sessionId === onScreenId.value)?.sessionId ??
    listed.value[0]?.sessionId ??
    null,
)

const RAIL_PAGE_SIZE = 15
const sectionNames = { 'needs-you': 'Needs you', recent: 'Recent' } as const
type RailSectionKey = keyof typeof sectionNames

const sectionOpen = {
  'needs-you': usePersistentToggle('brobot2.railNeedsYouOpen', true),
  recent: usePersistentToggle('brobot2.railRecentOpen', true),
}
const recentLimit = ref(RAIL_PAGE_SIZE)
watch(
  () => props.workspaceFolder?.path,
  () => (recentLimit.value = RAIL_PAGE_SIZE),
)
const sectionIdBase = useId()
const rowsIdOf = (key: RailSectionKey): string => `${sectionIdBase}-rows-${key}`

const waitingRows = computed(() => rows.value.filter((row) => row.standing === 'waiting'))
const recentRows = computed(() => rows.value.filter((row) => row.standing !== 'waiting'))

function railSection(key: RailSectionKey, eligible: readonly RailRow[], shown: readonly RailRow[]) {
  const groups = groupWorkers(shown, (row) => row.sessionId)
  const workerHeads = new Map(
    groups.flatMap(({ worker, rows }) =>
      worker
        ? [
            [
              rows[0]!.sessionId,
              {
                identity: worker.identity,
                giver: worker.giver,
                label: workerName(worker, props.agents?.identities ?? null),
              },
            ] as const,
          ]
        : [],
    ),
  )
  const open = sectionOpen[key].value
  const selected = eligible.some((row) => row.sessionId === onScreenId.value)
  const recentTotal = key === 'recent' && coverageComplete.value ? eligible.length : null
  return {
    key,
    heading: sectionNames[key],
    rows: groups.flatMap((group) => group.rows),
    workerHeads,
    open,
    holdsTheOneOnScreen:
      selected && (!open || !shown.some((row) => row.sessionId === onScreenId.value)),
    count:
      key === 'needs-you'
        ? String(eligible.length)
        : recentTotal === null
          ? open
            ? `${shown.length} shown`
            : null
          : open
            ? `${shown.length} of ${recentTotal}`
            : String(recentTotal),
  }
}

const sections = computed(() => {
  const waiting = waitingRows.value
  const recent = recentRows.value
  return [
    ...(waiting.length ? [railSection('needs-you', waiting, waiting)] : []),
    ...(recent.length ? [railSection('recent', recent, recent.slice(0, recentLimit.value))] : []),
  ]
})

const moreRecent = computed(() =>
  Math.min(RAIL_PAGE_SIZE, recentRows.value.length - recentLimit.value),
)

const identityIds = computed((previous?: string[]) => {
  const ids = sections.value
    .filter((section) => section.open)
    .flatMap((section) => section.rows.map((row) => row.sessionId))
    .sort()
  return previous?.length === ids.length && previous.every((id, i) => id === ids[i])
    ? previous
    : ids
})
const identities = ref(new Map<string, ConversationIdentity | null>())
let acceptedIdentityRevision: number | undefined
watch(
  [identityIds, () => props.workspaceFolder?.path, () => props.identityRevision],
  async ([ids, workspace, revision], [, previousWorkspace], invalidate) => {
    if (workspace !== previousWorkspace) identities.value = new Map()
    const read = props.readIdentities
    if (!read) return
    let current = true
    invalidate(() => (current = false))
    const before = identities.value
    const unread = revision !== acceptedIdentityRevision ? ids : ids.filter((id) => !before.has(id))
    const batches: ConversationIdentityBatchInput[] = []
    for (let i = 0; i < unread.length; i += CONVERSATION_IDENTITY_BATCH_SIZE) {
      const sessionIds = unread.slice(i, i + CONVERSATION_IDENTITY_BATCH_SIZE)
      batches.push({ sessionIds })
    }
    try {
      const answers = await Promise.all(batches.map((batch) => read(batch)))
      if (current) {
        const merged = new Map(ids.map((id) => [id, before.get(id) ?? null]))
        for (const id of unread) merged.set(id, null)
        for (const [i, batch] of answers.entries()) {
          for (const item of batch) {
            if (batches[i]?.sessionIds.includes(item.conversation)) {
              merged.set(item.conversation, item)
            }
          }
        }
        acceptedIdentityRevision = revision
        identities.value = merged
      }
    } catch {
      // Keep the last identities for this workspace when a read fails.
    }
  },
  { immediate: true },
)

function rowTitle(row: RailRow): string {
  return identities.value.get(row.sessionId)?.title ?? conversationTitle(row.label, row.named)
}

function fold(key: RailSectionKey): void {
  sectionOpen[key].value = !sectionOpen[key].value
}

/**
 * ⛔ **What the conversation on screen's own agent will answer to** (279) — the palette's fourth
 * consumer of {@link onScreenId}.
 *
 * ⚠️ **`control`, not `transcript`, and 064 is why.** They are the same object for every ordinary
 * moment of a conversation and part when a reader pages back far enough to release the newest
 * events. `transcript` is then a fold of OLD HISTORY; the command list is a statement about what the
 * agent can do RIGHT NOW, which is exactly what `control` is for — *"the fold that says what this
 * session IS"*. A palette reading the reading-window would go quiet about a live agent's commands
 * because somebody scrolled up.
 *
 * ⚑ **`provider` comes from the session's own `meta` and is PRINTED, never compared.** `039`'s rule
 * forbids the renderer branching on which provider a session runs; a heading that says the name is
 * not a branch, and `provider-neutrality.test.ts` is what keeps that honest.
 *
 * ⛔ **`null` when there is no conversation on screen, and that is a different null from
 * `agent.set === null`** — see `PaletteInput.agent`. The record's own registry supplies the second
 * one and this supplies the first, so neither has to stand in for the other.
 */
const paletteAgent = computed<PaletteAgent | null>(() => {
  const id = onScreenId.value
  if (id === null) return null
  const record =
    props.open.find((each) => each.sessionId === id) ??
    (props.onScreen?.sessionId === id ? props.onScreen : undefined)
  if (!record?.meta) return null
  return {
    provider: record.meta.provider,
    set: record.control.commands.set,
    dropped: record.control.commands.dropped,
  }
})

/**
 * ⛔ **Where a palette row's navigation LANDS, and why it lands through this component** — every case
 * below is an event this rail already emits and `RuntimeScreen` already handles: `place` and
 * `activeId` live on the one `useSurface` inside `RuntimeScreen`, and the palette borrows the rail's
 * voice rather than growing a second route into the routing `095` collected into one place.
 * ⚑ **D-017b** — a conversation row is one press whatever it is doing: `select`.
 */
function fromPalette(action: PaletteNavigation): void {
  if (action.kind === 'select') return emit('select', action.sessionId)
  if (action.kind === 'read-conversation') return emit('readConversation', action.sessionId)
  if (action.kind === 'go') return emit('go', action.place)
  emit('newConversation')
}

defineExpose({
  /**
   * 🔴 **Ask the list again** (151) — and since `534` the screen calls this because the HOST said
   * something moved, not only because this window did something. ⚑ D-017b · resolves once the list
   * has answered, so the screen can ask whether the conversation it is drawing moved.
   */
  refreshResumable: (): Promise<void> => refreshListed(),
  /**
   * 🔴 **D-019 · what main says an agent is doing, the moment it moves** — see {@link hearStates}.
   * ⚑ The screen owns the subscription, as it owns `runtime:changed`'s; the rail folds the message.
   */
  hearStates,
  /**
   * ⚑ **D-017b · every conversation the one list names** — the screen keeps their drafts
   * (`sweepDrafts`): a stop ends nothing, so a conversation's words last as long as it is listed.
   */
  listedIds: computed(() => rows.value.map((row) => row.sessionId)),
  /**
   * ⚑ **D-017b · the host's row for one conversation**, or `null` when it lists none — when it last
   * moved, whether another window has it open, and its one state: what the screen compares a
   * recorded view against, and the state that view's plate draws, so the view and its row here say
   * one thing. ⚑ **D-016 · commit 7 · R2** — and the work that names it, which the header titles
   * the conversation with, as its row here does.
   */
  listedOf: (sessionId: string): ListedConversation | null =>
    listed.value.find((row) => row.sessionId === sessionId) ?? null,
  /**
   * ⚑ **D-016 · every conversation the host lists, or `null` before the list has answered** — the
   * Team page draws each agent's conversations from it, so an agent's shelf and this rail are one
   * list. ⛔ `null` is *not read yet*, never *none*.
   */
  theOneList: computed(() => (looked.value ? listed.value : null)),
  /**
   * ⚑ **UI-001 · each row's plate and word, by conversation** — what the right panel draws for an
   * agent under the strip, so a card and its row here cannot say two things.
   */
  says: computed((): ReadonlyMap<string, RailSays> => {
    // ⚑ W4.162 · and the model and effort the host's row names, for the agent panel's cards.
    const host = new Map(hostResumable.value.map((one) => [one.sessionId, one]))
    return new Map(
      rows.value.map((row) => {
        const one = host.get(row.sessionId)
        const model = one?.reported?.model ?? one?.model ?? null
        const effort = one?.reported?.effort ?? one?.reasoningEffort ?? null
        return [
          row.sessionId,
          {
            facets: row.facets,
            word: row.word,
            ...(row.detail ? { detail: row.detail } : {}),
            ...(model === null ? {} : { model }),
            ...(effort === null ? {} : { effort }),
          },
        ]
      }),
    )
  }),
})

const platform = platformHere()
</script>

<template>
  <aside class="rail" data-cy="side-rail" :data-collapsed="props.collapsed">
    <!-- Brand. It names the app, and — since 249 — the button beside it opens a palette that
         exists. ⛔ **`title` no longer says "not wired yet"**, which is the whole ticket: a control
         that announces it does nothing is `106`, and this one had announced it for months. -->
    <div class="brand-row">
      <!-- The crew mark: three circles, the name beside it says what it is. -->
      <div class="brand-mark">
        <img class="crew-mark" :src="crewMark" alt="" data-cy="brand-crew-mark" />
      </div>
      <div class="brand-copy" title="BroCrew · Control room">
        <strong>BroCrew</strong><span>Control room</span>
      </div>
      <!-- ⚠️ **The title names the SURFACE, not a list of verbs** (found in this dispatch's own
           review). It read *"jump to a conversation, reopen one, or export this one"* — three
           promises, each false in a state the app is often in: no conversation on screen means no
           export rows, and a rail with nothing closed offers no reopen. A tooltip enumerating
           controls that are absent is `106` in the prose (`223`: *"naming a gesture a mount has
           switched off is 106 one layer down"*). What is true in every state is that the palette
           lists what is reachable, and the palette's own foot says what it searched.
           ⚠️ **The button and the key run the SAME function**, through the palette's own exposed
           `toggle` — not two callers that each decide what "open" means. `169`'s finding was a
           button and a chord disagreeing about one gesture; the fix there was one predicate, and
           this is the same shape one layer up. ⚑ The label and the `N` hint below it name the
           modifier this computer has, from one helper, so the two cannot disagree. -->
      <button
        class="command-button"
        type="button"
        :title="`Command palette (${chordSaid(platform, 'K')}) — everything you can reach from here, by name`"
        data-cy="command-palette"
        @click="palette?.toggle()"
      >
        {{ chordKeys(platform, 'K') }}
      </button>
      <button
        class="fold-button"
        type="button"
        data-cy="rail-fold"
        :aria-expanded="!props.collapsed"
        :aria-label="props.collapsed ? EXPAND_THE_MENU : COLLAPSE_THE_MENU"
        :title="props.collapsed ? EXPAND_THE_MENU : COLLAPSE_THE_MENU"
        @click="emit('fold')"
      >
        <svg class="icon" :class="{ out: props.collapsed }" aria-hidden="true">
          <use href="#i-chevron" />
        </svg>
      </button>
    </div>

    <!-- ⚠️ **Always mounted, and drawing nothing until ⌘K asks.** The palette owns a window-level
         keydown listener for its whole lifetime — a `v-if` here would mean the key only worked
         once something else had already opened the thing the key exists to open. -->
    <CommandPalette
      ref="palette"
      :conversations="rows"
      :looked="looked"
      :list-error="listError"
      :active-id="onScreenId"
      :agent="paletteAgent"
      :search-caller="paletteSearchCaller"
      :search-conversations="props.searchConversations"
      :profiles="props.agents?.identities"
      @navigate="fromPalette"
    />

    <!-- WIRED — opens the surface a conversation actually starts on. -->
    <div class="rail-primary-action">
      <button
        class="new-conversation-button"
        :class="{ active: props.place === 'new' }"
        type="button"
        data-cy="new-conversation"
        :title="props.collapsed ? 'New conversation' : undefined"
        @click="emit('newConversation')"
      >
        <svg class="icon"><use href="#i-chat" /></svg>
        New conversation
        <span>{{ chordKeys(platform, 'N') }}</span>
      </button>
      <!-- 🔴 **571 · the one live signal** (`EXT-008` §4.3). ⚑ Two sentences, quoted as the two
           they are: *"Not a list. One line: 2 working · 1 needs you."* and *"This is a product
           whose premise is that agents work while he is elsewhere, and neither the mockup nor the
           app tells him from the rail whether anything is happening."*

           ⛔ **Here, and OUTSIDE `.rail-scroll`.** `385 §3` moved the kill switch out of the
           scroller because *"the direction that stops things happening must never be slower than
           the thing it stops"*; a signal that says whether anything IS happening has the same
           claim on being unscrollable, and a workspace with a dozen threads is exactly the state
           that would push it off the top. ⚑ **A second child of `.rail-primary-action`**, which is
           already `flex-direction: column` with a gap — so this joins an existing layout rather
           than declaring one, `421`'s rule for new rows.

           ⚠️ **It counts what needs a person, and not `working` or `open`** — ⚑ D-017b: *open*
           was a status every stop writes, so after a restart it said *nothing open* above the one
           list. The argument is in `live-signal.ts`, where the words are decided.

           ⛔ **What it REPLACES is `EXT-008` §2's fourth sentence** — *"Nothing running. Start one
           above, or reopen one below."* — which was a claim about whether a process runs (`05`
           rule 5). ⚑ New conversation is directly above this line, and every conversation is in
           the one list below.

           🔴 **617 · and a CONDITION, when a provider has stopped** — `HO-080` §4: *"that signal
           exists to answer* is anything happening. *A wall is the one condition where the answer
           changes from* yes *to* no *and nothing else on screen says so."* ⛔ **Two nodes and not
           one string**, because the clause is drawn in the band's own summons register and the
           counts are not — see `.rail-live-stopped`. ⚑ **Neither node composes a word**:
           `liveSignal.counted` and `liveSignal.stopped.drawn` are both `live-signal.ts`', and the
           dom file asserts this element's `textContent` IS `liveSignal.line`, which is the only
           thing keeping what a person sees and what the `title` says one derivation.

           ⚠️ **It WRAPS rather than ellipsizing, and the headroom is MEASURED rather than
           assumed** (`531`). ⛔ **The first version of this comment said the quiet line does not
           fit, and that was a guess** — it was measured then with two counts on the line, and
           D-017b took one away. 🔴 **617 · a condition can still make it wrap** (a wall, two
           walls, or the unread mark), measured by `the-counts-nobody-can-see.dom.test.ts`.
           ⚑ **Nothing is CUT in any of them**, which is the claim this rail's missing
           `text-overflow` exists to make: a second line rather than an ellipsis, the class `530`
           F1 measured `textContent` being blind to. -->
      <p
        v-if="liveSignal"
        class="rail-live"
        data-cy="rail-live-signal"
        :title="liveSignal.said"
        :data-as-of="liveSignal.asOf ?? undefined"
      >
        {{ liveSignal.counted
        }}<span v-if="liveSignal.stopped" class="rail-live-stopped" data-cy="rail-live-stopped">{{
          liveSignal.stopped.drawn
        }}</span>
      </p>
    </div>

    <div class="rail-scroll">
      <div class="rail-section" style="margin-top: 0">
        <!-- 🔴 **606 · `EXT-008` §3's split, and the rule is older than the mockup.**

             ⛔ ***"Waiting on you and While you were away are separate destinations. Those are not
             two views of one thing — one is what he owes, one is what changed — and that split was
             ruled in `HO-025` §2."*** ⚑ **`HO-025` §2 is the rule underneath:** *a digest is
             WINDOWED; the queue is COMPLETE regardless of age.*

             ⚠️ **Which is why they cannot share a count.** ⛔ A single badge over a complete queue
             and a windowed reading is bounded by neither — `304`'s contradiction. ⚑ **Here that is
             settled by there being one badge and not two** — see {@link waitingCount}'s neighbour
             for why the windowed count is drawn on its own page instead.

             ⚑ **Two rows, first, in `EXT-008` §5's order** — *New conversation · Waiting on you ·
             While you were away · … · Agents · Tools · History*. ⚠️ **The rest of that order is not
             re-opened here**; `566` and `570` each placed their own row and the remaining inversion
             is theirs.

             ⛔ **`#i-bang` and `#i-activity` are both already in `IconSprite`** — the first was
             DEFINED and drawn nowhere, the second is the digest's own glyph. ⚑ Reusing them keeps
             the sprite's count where it is, which is `570`'s argument for `#i-bot`. -->
        <button
          class="rail-item"
          :class="{ active: props.place === 'waiting' }"
          type="button"
          data-wired="true"
          data-cy="rail-waiting"
          :title="props.collapsed ? 'Waiting on you' : undefined"
          @click="emit('go', 'waiting')"
        >
          <svg class="icon"><use href="#i-bang" /></svg>
          <span class="rail-copy">
            <strong>Waiting on you</strong>
          </span>
          <!-- ⛔ **The COMPLETE count** — see {@link waitingCount}. ⚑ Absent at zero, and absent
               entirely on a fresh install, where the honest count is no badge at all. -->
          <span v-if="waitingCount > 0" class="count badge" data-cy="waiting-badge">
            {{ waitingCount }}
          </span>
        </button>

        <button
          class="rail-item"
          :class="{ active: props.place === 'away' }"
          type="button"
          data-wired="true"
          data-cy="rail-away"
          :title="props.collapsed ? 'Recent activity' : undefined"
          @click="emit('go', 'away')"
        >
          <svg class="icon"><use href="#i-activity" /></svg>
          <span class="rail-copy">
            <strong>Recent activity</strong>
          </span>
        </button>

        <!-- WIRED (047) — everything this app knows about, ours and the user's own provider homes
             merged: the list behind it is read from the database and from the real homes, and
             every row it shows is a conversation that exists. -->
        <button
          class="rail-item"
          :class="{ active: props.place === 'sessions' }"
          type="button"
          data-wired="true"
          data-cy="rail-sessions"
          :title="props.collapsed ? 'All conversations' : undefined"
          @click="emit('go', 'sessions')"
        >
          <svg class="icon"><use href="#i-archive" /></svg>
          <span class="rail-copy">
            <!-- Use All conversations because `session-library.ts` includes both `user-home` and `ours` origins. Origin is a filter, not the page's name. Match the rail's conversation vocabulary so one population does not appear to be two different things. -->
            <strong>All conversations</strong>
            <!-- ⛔ Not "your provider homes" (153). This is the FIRST place a user meets that
                 phrase, and 151 spent a ticket proving it means nothing to one: it is a term for
                 a directory layout, on a line whose job is to say what is behind the link. Same
                 register as 151's three rewritten refusals — name the two programs, and call the
                 thing a folder. -->
            <small class="says" title="Includes chats from Claude and Codex on this computer."
              >Includes chats from Claude and Codex on this computer.</small
            >
          </span>
        </button>

        <!-- 🔴 **570 · the Team destination**, and the section that used to sit lower in this file
             is gone in the same commit — `EXT-008` §4.4: *"The rail says zero and then names three
             agents… the Agents page is where it gets explained, not the rail."*

             ⛔ **One commit, both halves, because either alone is a worse app than today.** Take
             the section out first and a person loses the only thing in the product that names
             their agents; route the page first and leave the section and the app says two
             different things about one subject on one screen. ⚑ The property is written down and
             asserted: *at no commit does a window exist with neither surface.*

             ⚠️ **The noun is `Team` and it was DECIDED, not preferred.** `561` §1 put *Team versus
             Agents* to the designer and refused to pick; v2.10's changelog §7 answered — *"I kept
             Team. It names the durable collection of specialists, including those never run… The
             individual noun stays agent."* ⛔ So this row, the palette row and the page's own `h1`
             all say **Team**, which is `154`'s one-noun rule, and every gesture inside the page
             still says *agent*.

             ⚑ **`#i-bot` is the app's own glyph for an agent** — `AssistantMessage`, `DigestCard`
             and the titlebar draw it for exactly that — and reusing it keeps `IconSprite`'s count
             where it is. ⛔ **No `small.says` sub-line**, for the reason `566` wrote beside the
             row above: `EXT-008` §5 is *"no counts, no `+`, no lists, no explanatory sentences"*,
             and trading a deleted sentence for a new one is not a removal. -->
        <button
          class="rail-item"
          :class="{ active: props.place === 'team' }"
          type="button"
          data-wired="true"
          data-cy="rail-team"
          :title="props.collapsed ? 'Team' : undefined"
          @click="emit('go', 'team')"
        >
          <svg class="icon"><use href="#i-bot" /></svg>
          <span class="rail-copy">
            <strong>Team</strong>
          </span>
        </button>

        <button
          class="rail-item"
          :class="{ active: props.place === 'settings' }"
          type="button"
          data-wired="true"
          data-cy="rail-settings"
          :title="props.collapsed ? 'Settings' : undefined"
          @click="emit('go', 'settings')"
        >
          <svg class="icon"><use href="#i-gear" /></svg>
          <span class="rail-copy">
            <strong>Settings</strong>
          </span>
        </button>
      </div>

      <!-- Work needing you stays above the paged Recent list. -->
      <div class="rail-section rail-conversations" data-wired="true" data-cy="rail-conversations">
        <p
          v-if="!looked && !listError"
          class="rail-empty"
          role="status"
          data-cy="conversations-loading"
        >
          Loading conversations…
        </p>
        <p v-if="listError" class="rail-empty err" data-cy="conversations-error">
          Could not read the conversations: {{ listError }}
        </p>
        <section
          v-for="section in sections"
          :key="section.key"
          class="rail-group"
          :data-cy="`rail-section-${section.key}`"
        >
          <!-- ⚑ **The header is the fold** — a real button, so a key reaches it. ⛔ **A folded
               section is never traceless**: its count and its badge stay, and when it holds the
               conversation on screen it is marked as the row would be. -->
          <button
            class="section-label section-toggle"
            :class="{ active: section.holdsTheOneOnScreen }"
            type="button"
            :data-cy="`rail-toggle-${section.key}`"
            :data-active="section.holdsTheOneOnScreen"
            :aria-expanded="section.open"
            :aria-controls="section.open ? rowsIdOf(section.key) : undefined"
            :title="
              section.holdsTheOneOnScreen ? 'The conversation on screen is in here' : undefined
            "
            @click="fold(section.key)"
          >
            <svg class="icon chev" :class="{ down: section.open }" aria-hidden="true">
              <use href="#i-chevron" />
            </svg>
            <span class="section-name" :title="section.heading">{{ section.heading }}</span>
            <span
              v-if="section.key === 'needs-you'"
              class="count badge"
              data-cy="rail-needs-you"
              :title="`${NEEDS_YOU}: ${section.count}`"
              >{{ section.count }}</span
            >
            <span v-else-if="section.count !== null" class="count" data-cy="rail-count-recent">{{
              section.count
            }}</span>
          </button>
          <div
            v-if="section.open"
            :id="rowsIdOf(section.key)"
            class="rail-group-rows"
            :data-cy="`rail-rows-${section.key}`"
          >
            <template v-for="row in section.rows" :key="row.sessionId">
              <p
                v-if="section.workerHeads.has(row.sessionId)"
                class="rail-worker-heading"
                data-cy="rail-worker-heading"
                :data-identity="section.workerHeads.get(row.sessionId)?.identity"
                :data-giver="section.workerHeads.get(row.sessionId)?.giver"
                :title="section.workerHeads.get(row.sessionId)?.label"
              >
                {{ section.workerHeads.get(row.sessionId)?.label }}
              </p>
              <button
                class="rail-item"
                :class="{ active: row.sessionId === onScreenId }"
                :data-worker="row.worker ? true : undefined"
                type="button"
                :data-cy="`open-session-${row.sessionId}`"
                :data-session-id="row.sessionId"
                :data-active="row.sessionId === onScreenId"
                :aria-label="rowTitle(row)"
                :aria-description="
                  [
                    row.worker
                      ? workerDescription(row.worker, props.agents?.identities ?? null)
                      : null,
                    row.detail,
                    identities.get(row.sessionId)?.address,
                    !row.worker && row.named && identities.get(row.sessionId)
                      ? conversationTitle(row.label, row.named)
                      : null,
                    identities.get(row.sessionId)?.author?.kind === 'person'
                      ? 'Named by you'
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                "
                :aria-describedby="
                  row.opening
                    ? `rail-opening-${row.sessionId} rail-state-${row.sessionId}`
                    : `rail-state-${row.sessionId}`
                "
                :title="
                  props.collapsed
                    ? [
                        row.worker && row.named ? row.label : null,
                        rowTitle(row),
                        identities.get(row.sessionId)?.address,
                        row.worker
                          ? workerDescription(row.worker, props.agents?.identities ?? null)
                          : null,
                      ]
                        .filter(Boolean)
                        .join('\n')
                    : row.worker
                      ? workerDescription(row.worker, props.agents?.identities ?? null)
                      : undefined
                "
                @click="emit('select', row.sessionId)"
              >
                <AgentState size="compact" v-bind="row.facets" :label="row.label" />
                <span
                  v-if="props.collapsed && row.named"
                  class="work-label"
                  aria-hidden="true"
                  :data-cy="`rail-work-label-${row.sessionId}`"
                  >{{ row.named.label }}</span
                >
                <span
                  class="rail-copy"
                  :class="{ 'rail-worker-top': row.worker && !identities.get(row.sessionId) }"
                >
                  <!-- The full title remains available on hover and as the button’s name. -->
                  <strong
                    :data-cy="row.worker ? `rail-worker-name-${row.sessionId}` : undefined"
                    :title="
                      row.worker && !identities.get(row.sessionId)
                        ? [row.label, row.named?.title].filter(Boolean).join(' · ')
                        : rowTitle(row)
                    "
                    >{{
                      row.worker && !identities.get(row.sessionId) ? row.label : rowTitle(row)
                    }}</strong
                  >
                  <span
                    v-if="row.worker && !identities.get(row.sessionId)"
                    class="rail-worker-state"
                    :title="row.detail ?? workerState(row.word, row.named)"
                    :data-cy="`rail-state-word-${row.sessionId}`"
                    >{{ workerState(row.word, row.named) }}</span
                  >
                  <small
                    :id="`rail-state-${row.sessionId}`"
                    :data-standing="row.standing"
                    :aria-description="row.detail"
                    :data-needing="row.facets.needing"
                    :data-place="row.place ?? undefined"
                    :title="
                      [
                        row.named ? row.label : null,
                        row.provider,
                        row.detail ?? row.word,
                        row.elsewhere ? OPEN_IN_ANOTHER_WINDOW : null,
                        row.place,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    "
                    ><template v-if="identities.get(row.sessionId) || (row.named && !row.worker)"
                      ><span>{{ row.label }}</span></template
                    ><template v-if="!identities.get(row.sessionId) && row.provider">
                      <template v-if="row.named && !row.worker"> · </template
                      >{{ row.provider }} </template
                    ><template v-if="!row.worker || identities.get(row.sessionId)">
                      <template v-if="row.provider || row.named || identities.get(row.sessionId)">
                        ·
                      </template>
                      <span :data-cy="`rail-state-word-${row.sessionId}`">
                        {{ row.worker ? workerState(row.word, row.named) : row.word }}
                      </span></template
                    ><template v-if="row.activityAt !== undefined">
                      ·
                      <time :title="fullTime(row.activityAt)">{{
                        agoWords(row.activityAt, railMinute)
                      }}</time> </template
                    ><template v-if="row.elsewhere"> · {{ OPEN_IN_ANOTHER_WINDOW }}</template
                    ><template v-if="row.place"> · {{ row.place }}</template></small
                  >
                  <small
                    v-if="identities.get(row.sessionId)"
                    :title="
                      [identities.get(row.sessionId)?.address, row.provider]
                        .filter(Boolean)
                        .join(' · ')
                    "
                    >Conversation
                    <span :data-cy="`rail-address-${row.sessionId}`">{{
                      identities.get(row.sessionId)?.address
                    }}</span>
                    <template v-if="row.provider"> · {{ row.provider }}</template>
                    <template v-if="identities.get(row.sessionId)?.author?.kind === 'person'">
                      · Named by you</template
                    >
                  </small>
                  <small
                    v-if="!row.worker && row.named && identities.get(row.sessionId)"
                    :title="conversationTitle(row.label, row.named)"
                    >{{ conversationTitle(row.label, row.named) }}</small
                  >
                  <template v-if="row.worker">
                    <small
                      v-for="piece in workerSubtitles(
                        row.sessionId,
                        row.named,
                        workByHolder.get(row.sessionId) ?? [],
                      )"
                      :key="piece.key"
                      class="rail-worker-piece"
                      :title="piece.text"
                      >{{ piece.text }}</small
                    >
                  </template>
                  <small
                    v-if="row.opening"
                    :id="`rail-opening-${row.sessionId}`"
                    class="opening"
                    :title="row.opening"
                    :data-cy="`session-opening-${row.sessionId}`"
                    >{{ row.opening }}</small
                  >
                </span>
              </button>
            </template>
          </div>
          <button
            v-if="section.key === 'recent' && section.open && moreRecent > 0"
            class="rail-item rail-show-more"
            type="button"
            data-cy="rail-show-more"
            :aria-label="`Show ${moreRecent} more recent conversations`"
            :title="props.collapsed ? `Show ${moreRecent} more` : undefined"
            @click="recentLimit += RAIL_PAGE_SIZE"
          >
            <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
            <span class="rail-copy">Show {{ moreRecent }} more</span>
          </button>
        </section>
        <!-- 🔴 **685 · the waits reading could not read every row** (`676` F-R18a) — so a row above
             reading *idle* may be waiting. ⚑ Once, under the rows it qualifies, and only when one
             of them was drawn from that reading; ⛔ not a `.rail-section` and no heading. -->
        <p v-if="waitsShort" class="rail-unread" data-cy="rail-waits-unread">
          <strong>{{ ROWS_UNREAD_LEAD }}</strong> {{ waitsShort }}
        </p>
        <button
          v-if="paletteSearchCaller && props.searchConversations && !props.collapsed"
          class="rail-item rail-find"
          type="button"
          data-cy="rail-find-conversation"
          @click="palette?.toggle()"
        >
          Find a conversation
        </button>
      </div>
    </div>

    <!-- ⚑ **The anchored end of the rail** (385 §3) — v2.3's `.sidebar-bottom`: cards that never
         scroll, above the user card, outside the `flex: 1` scroller.

         ⛔ **Two slots in the mock and ONE of them has real material.** v2.3 anchors a safety card
         and a context card; the safety card is this app's spawning switch, which is a global state
         with a real control behind it. The context card is v2.3's ONE current project, and this
         build has no projects — so the slot is left empty and named rather than filled with a
         guess. -->
    <div class="rail-bottom">
      <!-- 🔴 **The kill switch, ANCHORED since 385 §3 — and its own docblock is why.** It has said
           since `340` that it is *"in the rail so it is reachable without opening anything"*, and
           that was false the moment the rail scrolled: it sat below the conversation lists and
           the destinations, inside `.rail-scroll`, and a workspace with a dozen threads
           pushed it off the bottom. ⚠️ **The direction that stops things happening must never be
           slower than the thing it stops** — a control you have to scroll to find is slower.
           ⚑ **Turning it OFF is one press; turning it back ON asks once** (340's ruling, one layer
           up: a widening is opt-in at the gesture). -->
      <!-- ⚠️ **The words come from `spawn-safety.ts` and are composed nowhere else** (390). The
           overlay layer draws this same control, and a second copy of these three sentences is
           exactly how the rail and a modal header would come to say different things about one
           switch. -->
      <button
        v-if="safety.view.value"
        class="rail-item spawn-switch rail-safety"
        :class="{ off: !safety.view.value.on }"
        type="button"
        data-cy="rail-spawning"
        :title="props.collapsed ? safety.view.value.heading : undefined"
        :aria-pressed="safety.view.value.on"
        @click="safety.press()"
      >
        <span class="switch-dot" :class="{ on: safety.view.value.on }"></span>
        <span class="rail-copy">
          <strong :title="safety.view.value.heading" data-cy="rail-spawning-state">{{
            safety.view.value.heading
          }}</strong>
          <!-- 🔴 **`531` · the sentence that says what this switch just did, and 2/3 of it was
               never on screen.** ⛔ *Agents may create conversations. Press to stop that.* wanted
               236 px of ink in a 131 px column and ellipsized after *Agents may create conv…*, so
               the half a person could read named the state and not the gesture — on the one
               control in this app whose whole job is to be pressed in a hurry. ⚑ `514` F1's shape:
               a caveat a person cannot read in time is a caveat that was not given. -->
          <small class="says" data-cy="rail-spawning-line" :title="safety.view.value.line">{{
            safety.view.value.line
          }}</small>
        </span>
      </button>

      <!-- Workspace actions and app updates have separate controls. -->
      <div ref="footerBox" class="rail-footer-box">
        <div class="rail-footer-controls">
          <button
            ref="footerButton"
            type="button"
            class="rail-footer"
            :title="props.workspaceFolder?.path"
            :aria-label="footerName"
            :aria-expanded="workspacesOpen"
            aria-haspopup="dialog"
            data-cy="rail-workspace"
            @click="toggleWorkspaces"
          >
            <span class="avatar" aria-hidden="true" data-cy="rail-workspace-initial">
              {{ workspaceInitial }}
            </span>
            <span v-if="workspaceName" class="who">
              <strong data-cy="rail-workspace-name">{{ workspaceName }}</strong>
            </span>
          </button>
          <VersionButton
            ref="versionButton"
            :version="props.appVersion"
            :open="updatesOpen"
            :collapsed="props.collapsed"
            @toggle="toggleUpdates"
          />
        </div>
        <div
          v-if="workspacesOpen"
          ref="workspaceDialog"
          class="rail-workspaces"
          data-on-white
          role="dialog"
          aria-label="Workspaces"
          tabindex="-1"
          data-cy="workspace-menu"
        >
          <WorkspacesSection @renamed="(name) => (renamedTo = name)" />
        </div>
        <UpdatesMenu
          v-if="updatesOpen"
          class="rail-updates"
          :version="props.appVersion"
          @close="closeUpdates"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.rail-show-more,
.rail-find {
  color: var(--accent-text);
  font: inherit;
}

.rail-show-more .icon {
  transform: rotate(90deg);
}

.rail-worker-heading {
  margin: var(--space-4) var(--space-6) var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  overflow-wrap: anywhere;
}
.rail-conversations .rail-item[data-worker] {
  padding-left: calc(var(--space-6) + var(--space-4));
}
.rail[data-collapsed='true'] .rail-worker-heading {
  display: none;
}
.rail[data-collapsed='true'] .rail-conversations .rail-item[data-worker] {
  padding-left: 0;
}

.rail {
  position: relative;
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: var(--border-width) solid var(--line);
  background-color: var(--rail-bg-color, var(--rail));
  background-image: var(--rail-bg-image, var(--rail-art));
  background-position: var(--rail-bg-position, var(--rail-art-position));
  background-repeat: var(--rail-bg-repeat, repeat);
  background-size: var(--rail-bg-size, var(--rail-art-size));
  image-rendering: var(--rail-bg-rendering, auto);
}

.rail > * {
  image-rendering: auto;
}

/* A theme's strip down the menu's right edge, drawn inside it over the rows. Clear unless set. */
.rail::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--rail-edge-w);
  background-color: var(--rail-edge-color, transparent);
  background-image: var(--rail-edge-image, none);
  background-position: var(--rail-edge-position, 0% 0%);
  background-repeat: var(--rail-edge-repeat, repeat);
  background-size: var(--rail-edge-size, auto);
  content: '';
  image-rendering: var(--rail-edge-rendering, auto);
  pointer-events: none;
}

.brand-row {
  display: flex;
  height: auto;
  align-items: center;
  padding: var(--space-8) var(--space-6);
  border-bottom: 0;
  gap: var(--space-4);
  min-height: var(--space-24);
}

.brand-mark {
  display: grid;
  width: var(--avatar-small);
  height: var(--avatar-small);
  border: var(--border-width) solid var(--brand-mark-edge, var(--brand-mark-border));
  border-radius: var(--radius);
  background-color: var(--brand-mark-color, transparent);
  background-image: var(--brand-mark-image, none);
  background-position: var(--brand-mark-position, center);
  background-repeat: var(--brand-mark-repeat, no-repeat);
  background-size: var(--brand-mark-size, contain);
  image-rendering: var(--brand-mark-rendering, auto);
  box-shadow: var(--sheen);
  color: var(--brand-mark-fg);
  place-items: center;
  flex: none;
}

.brand-mark .crew-mark {
  width: 28px;
  height: 28px;
  grid-area: 1 / 1;
  visibility: var(--brand-mark-figure, visible);
}

/* The same mark, drawn in a theme's logo ink. Clear unless the theme gives one. */
.brand-mark::after {
  width: 28px;
  height: 28px;
  background-color: var(--brand-mark-ink, transparent);
  content: '';
  grid-area: 1 / 1;
  mask: url('../assets/brocrew-mark.svg') center / contain no-repeat;
}

.brand-copy {
  min-width: 0;
  /* Takes the row's free space and asks for none, so the name never widens the menu. */
  flex: 1 1 0;
  contain: inline-size;
  font-family: var(--font-brand);
  font-style: var(--font-style-brand, normal);
  font-weight: var(--fw-brand, var(--fw-heavy));
  letter-spacing: var(--tracking-brand, -0.01em);
}

/* One line each, cut at the end when the row is short, never wrapped: the whole name is on the
   block's title. */
.brand-copy strong,
.brand-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-copy strong {
  display: block;
  font-size: var(--type-reading);
  /* The name is a strong: a step bolder than the line under it, unless a theme sets its weight. */
  font-weight: var(--fw-brand, bolder);
  letter-spacing: var(--tracking-brand, -0.01em);
  line-height: var(--leading-tight);
}

.brand-copy span {
  display: block;
  margin-top: var(--space-1);
  color: var(--muted);
  font-size: var(--type-caption);
}

.command-button {
  height: 26px;
  flex: none;
  min-width: var(--space-16);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  margin-left: auto;
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.command-button:hover {
  background: var(--wash-5);
  color: var(--text);
}

.rail-primary-action {
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-6) var(--space-6);
  gap: var(--space-4);
}

.new-conversation-button {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-md);
  background: var(--accent-fill-weak);
  color: var(--accent-text);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-2);
  text-align: left;
}

.new-conversation-button:hover,
.new-conversation-button.active {
  border-color: var(--accent-border-hover);
  background: var(--accent-fill-strong);
}

.new-conversation-button .icon {
  width: 14px;
  height: 14px;
}

.new-conversation-button span:last-child {
  flex: none;
  margin-left: auto;
  white-space: nowrap;
  color: var(--accent-text-weak);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.count.badge {
  display: inline-flex;
  min-width: 18px;
  height: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-pill);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-heavy);
}

.rail-scroll {
  min-height: 0;
  flex: 1;
  padding: var(--space-7) var(--space-6) var(--space-6);
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.rail-section {
  margin: var(--space-10) 0 0;
}

.rail-section:first-child {
  margin-top: 0;
}

.section-label {
  display: flex;
  height: auto;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  margin-bottom: var(--space-4);
  color: var(--faint);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-normal);
  text-transform: none;
  min-height: var(--space-10);
}

.rail-group + .rail-group {
  margin-top: var(--space-6);
}

.section-toggle {
  position: relative;
  width: 100%;
  justify-content: flex-start;
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  gap: var(--space-2);
  text-align: left;
}

.section-toggle:hover {
  background: var(--wash-4);
  color: var(--text-soft);
}

.section-toggle .section-name {
  overflow: hidden;
  min-width: 0;
  margin-right: auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-toggle .chev {
  width: 9px;
  height: 9px;
  transition: transform var(--dur-fast) var(--ease-out);
}

.section-toggle .chev.down {
  transform: rotate(90deg);
}

.section-toggle.active {
  border-color: var(--accent-border-weak);
  background: var(--accent-fill);
  color: var(--text);
}

.section-toggle.active::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: -1px;
  width: 2px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  content: '';
}

.rail-item {
  position: relative;
  display: grid;
  width: 100%;
  min-height: var(--control-h);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-soft);
  gap: var(--space-4);
  grid-template-columns: 18px minmax(0, 1fr) auto;
  text-align: left;
}

.rail-item + .rail-item {
  margin-top: var(--space-1);
}

.rail-item:hover {
  --row-muted: var(--rail-item-hover-ink, var(--muted));
  background: var(--rail-item-hover-bg, var(--wash-4));
  color: var(--rail-item-hover-ink, var(--text-soft));
}

/* A row a theme gives an ink draws all its text in it: the name and the lines under it. */
.rail-item.active {
  --row-muted: var(--rail-item-active-ink, var(--text));
  border-color: var(--accent-border);
  background: var(--rail-item-active-bg, var(--chrome-selection));
  color: var(--rail-item-active-ink, var(--text));
}

.rail-item.active::before {
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  left: -1px;
  width: var(--border-accent-width);
  border-radius: var(--radius-pill);
  background: var(--accent);
  content: '';
}

.rail-item .icon {
  width: 15px;
  height: 15px;
}

.rail-conversations .rail-item {
  grid-template-columns: var(--space-12) minmax(0, 1fr) auto;
}

.rail-copy small.opening {
  color: var(--row-muted, var(--muted));
}

.rail-copy {
  min-width: 0;
}

.rail-copy strong {
  display: block;
  overflow: hidden;
  color: inherit;
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  line-height: var(--leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-scroll > .rail-section:not(.rail-conversations) .rail-copy strong {
  font-weight: var(--fw-normal);
}

.rail-copy small {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--row-muted, var(--muted));
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Explanatory copy is bounded; its title retains the complete sentence. */
.rail-copy small.says {
  display: -webkit-box;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}

.rail-live {
  margin: 0;
  padding: 0 var(--space-3);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
}

.rail-live-stopped {
  color: var(--waiting-text-label);
  font-weight: var(--fw-heavy);
}

.rail-unread {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-4);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
}

.rail-unread strong {
  display: block;
  color: var(--muted);
}

.rail-empty {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-4);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
}

.rail-empty.err {
  color: var(--danger);
}

.rail-bottom {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-6) 0;
  background: linear-gradient(0deg, var(--rail-bg-color, var(--rail)), transparent);
}

.rail-safety .rail-copy strong {
  display: -webkit-box;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.rail-safety {
  border-color: var(--line-strong);
  margin-bottom: var(--space-3);
  background: var(--wash-2);
}

.rail-footer-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  min-height: 62px;
}
.rail-footer-controls .rail-footer {
  flex: 1;
  min-width: 0;
  width: auto;
  border-top: 0;
  gap: var(--space-3);
}
.rail-footer-controls .avatar {
  width: 30px;
  height: 34px;
}
.rail-workspaces {
  position: absolute;
  z-index: 25;
  bottom: calc(100% + var(--space-2));
  left: 0;
  width: var(--rail-menu-w);
  padding: var(--space-8);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-menu);
  color: var(--text-soft);
}
.rail[data-collapsed='true'] .rail-footer-controls {
  flex-direction: column;
  padding-top: var(--space-3);
}
.rail-footer-box {
  position: relative;
  flex: 0 0 auto;
}

.rail-footer {
  display: flex;
  width: 100%;
  height: auto;
  align-items: center;
  padding: var(--space-6) 0;
  border: 0;
  border-top: var(--border-width) solid var(--line);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  gap: var(--space-5);
  text-align: left;
  min-height: var(--space-28);
}

.rail-footer:hover .avatar {
  border-color: var(--faint);
}

.rail-footer .who {
  min-width: 0;
}

.rail-updates {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + var(--space-2));
  left: 0;
}

.update-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border: var(--border-width) solid var(--rail-bg);
  border-radius: 50%;
  background: var(--accent);
}

.avatar {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  width: var(--avatar-small);
  height: var(--avatar-small);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--panel-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  place-items: center;
}

.rail-footer strong {
  display: block;
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.rail-footer small {
  display: block;
  margin-top: var(--space-1);
  color: var(--faint);
  font-size: var(--type-caption);
}

.spawn-switch {
  align-items: flex-start;
}

.switch-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  margin-top: 5px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: 50%;
  background: var(--danger);
}

.switch-dot.on {
  border-color: transparent;
  background: var(--success);
}

/* The toggle beside the palette's button: its chevron points the way the menu will go. */
.fold-button {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.fold-button:hover {
  background: var(--wash-5);
  color: var(--text);
}

.fold-button .icon {
  width: 12px;
  height: 12px;
  transform: rotate(180deg);
}

.fold-button .icon.out {
  transform: none;
}

/* Collapsed: icons and avatars in one column; the words are on each press's hover and name. */
.rail[data-collapsed='true'] .brand-row {
  flex-direction: column;
  padding: var(--space-6) 0;
  gap: var(--space-3);
}

.rail[data-collapsed='true'] .command-button {
  margin-left: 0;
}

.rail[data-collapsed='true'] .brand-copy,
.rail[data-collapsed='true'] .rail-live,
.rail[data-collapsed='true'] .rail-copy,
.rail[data-collapsed='true'] .section-name,
.rail[data-collapsed='true'] .count:not(.badge),
.rail[data-collapsed='true'] .rail-unread,
.rail[data-collapsed='true'] .rail-empty,
.rail[data-collapsed='true'] .rail-footer .who {
  display: none;
}

.rail[data-collapsed='true'] .rail-primary-action,
.rail[data-collapsed='true'] .rail-bottom {
  padding-right: var(--space-4);
  padding-left: var(--space-4);
}

.rail[data-collapsed='true'] .rail-scroll {
  padding-right: var(--space-4);
  padding-left: var(--space-4);
}

.rail[data-collapsed='true'] .new-conversation-button {
  justify-content: center;
  padding: 0;
  font-size: 0;
}

.rail[data-collapsed='true'] .new-conversation-button span:last-child {
  display: none;
}

.rail[data-collapsed='true'] .rail-item {
  justify-items: center;
  padding-right: 0;
  padding-left: 0;
  grid-template-columns: minmax(0, 1fr);
}

/* A badge sits on the corner of the icon it counts. */
.rail[data-collapsed='true'] .rail-item .count.badge,
.rail[data-collapsed='true'] .section-toggle .count.badge {
  position: absolute;
  top: 0;
  right: 0;
}

.rail[data-collapsed='true'] .section-toggle {
  justify-content: center;
  padding: 0;
}

.rail[data-collapsed='true'] .rail-conversations .rail-item {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
  gap: var(--space-1);
  grid-template-columns: minmax(0, 1fr);
}

.work-label {
  overflow: hidden;
  max-width: 100%;
  color: var(--row-muted, var(--muted));
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail[data-collapsed='true'] .rail-item.active .work-label {
  color: var(--rail-item-active-ink, var(--text));
}

.rail[data-collapsed='true'] .rail-footer {
  justify-content: center;
}
.rail-worker-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
}
.rail-worker-top > small {
  grid-column: 1 / -1;
}
.rail-worker-top strong {
  min-width: 0;
  white-space: nowrap;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-worker-state {
  flex: none;
  font-size: var(--type-caption);
  color: var(--muted);
  white-space: nowrap;
}
.rail-copy .rail-worker-piece {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
