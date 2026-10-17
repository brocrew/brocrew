<script setup lang="ts">
import { chordKeys, chordSaid, platformHere } from '../lib/this-computer'
import crewMark from '../assets/brocrew-mark.svg'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
  watchEffect,
  type Ref,
} from 'vue'
import type {
  ResumableSessionInfo,
  RuntimeStatesMessage,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import { agentStateWords, type AgentState as OneState } from '../../../shared/agent-state'
import {
  facetsOfState,
  NEEDS_YOU,
  recordFacets,
  standingOf,
  standingWord,
  stateHere,
  type AgentFacets,
  type Standing,
} from '../lib/agent-state'
import { appClosing } from '../lib/app-closing'
import {
  conversationList,
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
import type { WhatEachConversationIsWaitingOn } from '../../../shared/tasks'
import type { ProviderLimitsView } from '../lib/persons-queue'
import { providerLimitDisplay } from '../lib/provider-limit-status'
import { createProviderBlockStore, type ProviderBlockStore } from '../lib/provider-limit-facts'
import { useMinuteClock } from '../composables/useMinuteClock'
import { useWhoCalledWhom, type RailSays } from '../composables/useWhoCalledWhom'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import type { AppInfo } from '@brobot2/shared'
import { profileItRunsAs, whereItWorks } from '../lib/session-record'
import { agentName } from '../../../shared/runtime-ipc'
import { readableError, type SessionRecord } from '../lib/session-record'
import { useSpawnSafety } from '../lib/spawn-safety'
import {
  RAIL_SECTION_REMEMBERED,
  RAIL_SECTIONS,
  railSectionHeading,
  railSectionOf,
  type RailSectionKey,
} from '../lib/rail-sections'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import AgentState from './AgentState.vue'
import CommandPalette from './CommandPalette.vue'
import UpdatesMenu from './UpdatesMenu.vue'
import { useUpdates } from '../composables/useUpdates'
import { COLLAPSE_THE_MENU, EXPAND_THE_MENU } from '../lib/rail-fold'

/**
 * The left rail: everything you can navigate to, in the order the design fixes.
 *
 * ## 🔴 **It is destinations, one live signal and a kill switch** — `EXT-008` §5, finished at `572`
 *
 * ⛔ **`EXT-008` §1 measured this column doing three jobs at once** — navigation, live state and
 * configuration lists — ⚑ and the three lists left one at a time: **External tools at `566`**,
 * **Agents at `570`**, **Projects at `572`**. ⚠️ Each took its count, its `+`, its rows and its
 * sentences to the page a person is already looking for that subject on; each left a destination
 * row with none of the four.
 *
 * ⚑ **What remains that is not a destination is named and small:** ⚑ **D-017b · one list of
 * conversations** — every conversation, whatever it is doing, and a press opens it; since
 * 2026-10-01 in two folding sections, BroBot's and the other agents' — `571`'s one
 * live signal, and the spawning switch — 🔴 *"a kill switch
 * that lives two clicks away is not one"*, which is §5's own exception.
 */
const props = withDefaults(
  defineProps<{
    /** The conversations this window is fed — `SessionStore.live`. */
    open: SessionRecord[]
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
const footerBox = ref<HTMLElement | null>(null)
const footerButton = ref<HTMLButtonElement | null>(null)
const updates = useUpdates()
/** ⚑ An update offered, on its way or waiting to restart: the avatar carries a dot. */
const updateOffered = computed(() => {
  const kind = updates.snapshot.value?.state.kind
  return (
    kind === 'available' ||
    kind === 'downloading' ||
    kind === 'ready' ||
    kind === 'waiting-to-restart'
  )
})

/** ⚑ What a screen reader hears for the footer: the workspace, what a press opens, and any update. */
const footerName = computed(() => {
  const kind = updates.snapshot.value?.state.kind
  const update =
    kind === 'available'
      ? ', an update is available'
      : updateOffered.value
        ? ', an update is in progress'
        : ''
  const name = workspaceName.value
  return `${name ? `${name}, ` : ''}Local workspace — BroCrew’s version and updates${update}`
})

/** ⚑ Esc closes it from anywhere while it is open, wherever focus went after a press. */
function escapeCloses(event: KeyboardEvent): void {
  if (event.key === 'Escape' && updatesOpen.value) closeUpdates()
}

function closeUpdates(): void {
  updatesOpen.value = false
  footerButton.value?.focus()
}

function pressElsewhere(event: PointerEvent): void {
  if (footerBox.value !== null && !footerBox.value.contains(event.target as Node)) {
    updatesOpen.value = false
  }
}

watch(updatesOpen, (open) => {
  if (open) {
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

const liveSignal = computed(() => liveSignalView(props.workspace, props.limits, railMinute.value))

/* ---------------------------------------------------------------------------
   ⚑ D-017b · the ONE list — the host's two reads, folded by `conversation-list.ts`,
   with the conversations this window holds drawn from their own records beside it.
   --------------------------------------------------------------------------- */

const hostResumable = ref<ResumableSessionInfo[]>([])
const hostUnresumable = ref<UnresumableSessionInfo[]>([])
/** Whether the list has ever looked. Until it has, it has no count to give — not a count of 0. */
const looked = ref(false)
const listError = ref<string | null>(null)

/**
 * 🔴 **D-019 · what main said an agent is doing since the list was asked** — each conversation's
 * last state on `runtime:states` ({@link hearStates}), with the list read it arrived after. The
 * list's rows draw it over their own `state`, so every surface drawing the host's state — these
 * rows, the cards under the strip, the palette, the Team shelf and the plate of a view drawn from
 * its ledger — changes the moment the push lands, and nothing is asked.
 *
 * ⛔ **A pushed state gives way only to a list read ASKED AFTER IT ARRIVED.** Main derives a read's
 * answer when the read reaches it, so a push that arrived before the read was asked is older than
 * that answer and the read wins; one that arrived while the read was in flight may be newer than
 * the half of the answer it raced (`listResumable` and `listUnresumable` are two replies), so it
 * stands until a later read lands.
 */
const said = shallowRef<ReadonlyMap<string, { readonly state: OneState; readonly after: number }>>(
  new Map(),
)
const localProviderBlocks = createProviderBlockStore()
const providerBlocks = computed(() => props.providerBlocks ?? localProviderBlocks)
/**
 * ⚑ How many list reads this rail has begun — the number {@link said} dates each push by. ⚠️ A
 * read the quit stops is counted too, which moves nothing: main pushes nothing once a quit begins.
 */
let readsAsked = 0

/**
 * ⚑ **D-019 · main said what some agents are doing now** — the screen hands every message on
 * `runtime:states` here. ⚠️ A conversation the list does not name yet is kept too, because the read
 * already in flight may name it; a read asked after it names it in its own answer.
 *
 * ⚑ **D-026 · a message that moved no state leaves the list as it was** — files kept, alone: the
 * rail draws no files, and a copy of what it heard would redraw every row for nothing.
 */
function hearStates(message: RuntimeStatesMessage): void {
  if (message.moved.length === 0) return
  const next = new Map(said.value)
  for (const moved of message.moved) {
    next.set(moved.conversation, { state: moved.state, after: readsAsked })
  }
  said.value = next
  if (!props.providerBlocks) localProviderBlocks.acceptMany(message.moved)
}

/** Every conversation the host lists, newest first — see {@link conversationList}. */
const listed = computed(() =>
  conversationList({
    resumable: hostResumable.value,
    unresumable: hostUnresumable.value,
    // ⚑ **449 · the same roster `TeamWorkspace` draws from**, so one identity is named once in this
    // window. ⛔ `null` before the read lands is a real state and the fold says less rather than
    // something else.
    identities: props.agents?.identities ?? null,
    // 🔴 **D-019 · and what main said of each since** — see {@link said}.
    said: new Map([...said.value].map(([conversation, heard]) => [conversation, heard.state])),
    providerSaid: providerBlocks.value.snapshot(),
  }),
)

const cast = useWhoCalledWhom()
watchEffect(() => {
  cast.listedConversations.value = looked.value ? listed.value : null
  if (!looked.value) {
    cast.runningConversations.value = null
    return
  }
  const live = new Map(
    [...hostResumable.value, ...hostUnresumable.value]
      .filter((row) => row.running !== 'not-running')
      .map((row) => [row.sessionId, row.provider]),
  )
  cast.runningConversations.value = listed.value.flatMap(({ sessionId, state }) => {
    const provider = live.get(sessionId)
    return provider === undefined ? [] : [{ sessionId, provider, state }]
  })
})
onBeforeUnmount(() => {
  cast.listedConversations.value = null
  cast.runningConversations.value = null
})

async function refreshListed(): Promise<void> {
  // ⚑ **D-019 · numbered before either half is asked** — see {@link said}.
  readsAsked += 1
  const asked = readsAsked
  const providerReadAt = providerBlocks.value.beginRead()
  // 🔴 **Not while the app is closing** (273 §2, from `272` finding 1). The quit ends every
  // conversation and each ending announces; `272` measured these re-reads landing on a database the
  // quit had already shut. ⚑ Main refuses them too; this is the half that means an ordinary quit
  // prints nothing at all. ⚠️ **Leaves the list exactly as it was**: there is nobody to report to.
  if (appClosing.value) return
  listError.value = null
  try {
    const [resumable, unresumable] = await Promise.all([
      window.api.runtime.listResumable(),
      window.api.runtime.listUnresumable(),
    ])
    if (asked !== readsAsked) return
    providerBlocks.value.acceptListed([...resumable, ...unresumable], providerReadAt)
    hostResumable.value = resumable
    hostUnresumable.value = unresumable
    // ⛔ **D-019 · every push that arrived before this read was asked gives way to its answer.**
    said.value = new Map([...said.value].filter(([, heard]) => heard.after >= asked))
    looked.value = true
  } catch (cause) {
    if (asked !== readsAsked) return
    listError.value = readableError(cause)
  }
}

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
  readonly worker?: ListedConversation['worker']
  readonly facets: AgentFacets
  readonly detail?: string
  readonly standing: Standing
  /** ⚑ Another window has it open — said on the row, because a message from here is refused. */
  readonly elsewhere: boolean
  /**
   * ⚑ **2026-10-01 · which section draws it** — BroBot's or the other agents' — decided once, here,
   * by {@link railSectionOf} off the profile the conversation runs as.
   */
  readonly section: RailSectionKey
}

/**
 * ⚑ **D-017b · every conversation, described ONCE per render, newest first** — the ones this window
 * is fed from their own records, every other from the host's list (the one on screen included,
 * when it is drawn from its ledger: the host's row is what the list admits).
 *
 * ⚠️ **A row held here keeps its record's derivation** (099): the mark and the word come from ONE
 * `facets` call — the mark takes the object, the word takes {@link standingWord} of it — so the row
 * is one answer in two registers. ⚑ **Every other row draws the one state the host says of it**
 * ({@link facetsOfState}, {@link agentStateWords}) — the same state `list_agents` says. ⛔ No row
 * says whether a process runs (`05` rule 5); ⚑ it says `open in another window` where that is true,
 * because a message from here is refused there.
 *
 * ⚑ **Order**: newest activity first, by the host's row; a conversation the host has not listed yet
 * (a launch whose row is being written) goes first.
 */
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
    const limit = providerLimitDisplay(
      providerBlocks.value.get(record.sessionId) ?? record.meta,
      stateHere(
        record,
        facets,
        whoseAnswerIn(props.waiting, record.sessionId),
        whoseWorkIn(props.waiting, record.sessionId),
        {},
        stoppedWorkIn(props.waiting, record.sessionId),
      ),
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
        provider: record.meta?.provider ?? null,
        facets,
        standing,
        // ⛔ **The word the row SHOWS** (203) — ⚑ D-017 · R11: in the ONE state's words
        // (`stateHere`), whose answer it waits on (R19) and who holds the work it gave out
        // (D-036) — the plate's own.
        ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
        word:
          limit?.short ??
          purpose?.word ??
          standingWord(
            facets,
            stateHere(
              record,
              facets,
              whoseAnswerIn(props.waiting, record.sessionId),
              whoseWorkIn(props.waiting, record.sessionId),
              {},
              stoppedWorkIn(props.waiting, record.sessionId),
            ),
          ),
        label: workerLabel(who(record), worker, host?.named),
        // 🔴 **D-016 · commit 7 · R2 — the work that names it is the host's**, off the row already
        // looked up for its order: a record this window is fed holds no tree.
        named: host?.named ?? null,
        // ⛔ **449 · the second of the two facts a row needs**, and the palette takes it too.
        place: placeOf(record),
        // ⛔ **The one fact that tells two rows apart** (211 §3), read off the record.
        opening: record.opening,
        elsewhere: false,
        // ⛔ **The profile it RUNS as** — `null` for one this app ran as nobody, whose `meta`
        // carries BroBot's id only for the type's sake.
        section: railSectionOf(profileItRunsAs(record.meta)),
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
        // ⚑ The slug its label was named from — a person's own conversations never reach this list.
        section: railSectionOf(host.identity),
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

/**
 * ⛔ **How many open conversations are waiting on YOU, live** (203, from 195 H3).
 *
 * ⚠️ **`standingOf`, not `needing`, and the difference is a decision the design already made.** A
 * plan go-ahead is a `needing` and is deliberately NOT a `waiting` standing — *"a go-ahead blocks
 * nothing and can be pressed whenever"* — so counting every badge would put a number on the rail
 * that does not agree with the rows under it. This counts exactly the rows that say `waiting`.
 *
 * ⚑ **2026-10-01 · per section** — each section's header counts its own rows, so the two badges
 * add up to what the one badge said.
 */
function needingCount(of: readonly RailRow[]): number {
  return of.filter((row) => row.standing === 'waiting').length
}

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

/* ---------------------------------------------------------------------------
   ⚑ 2026-10-01 · the one list in two sections — BroBot's, then the other agents'.
   --------------------------------------------------------------------------- */

/**
 * ⚑ **Whether each section is open — per viewer, remembered across a reload**, as the drawer
 * remembers its own. Both open until a person folds one.
 */
const sectionOpen: Readonly<Record<RailSectionKey, Ref<boolean>>> = {
  brobot: usePersistentToggle(RAIL_SECTION_REMEMBERED.brobot, true),
  agents: usePersistentToggle(RAIL_SECTION_REMEMBERED.agents, true),
}

/** ⚑ The id each section's rows are drawn under — what its header's `aria-controls` names. */
const sectionIdBase = useId()
const rowsIdOf = (key: RailSectionKey): string => `${sectionIdBase}-rows-${key}`

/** ⚑ One section, as its header and its rows draw it. */
interface RailSection {
  readonly key: RailSectionKey
  readonly heading: string
  /** Worker pools keep durable number order within the newest-first list. */
  readonly rows: readonly RailRow[]
  readonly workerHeads: ReadonlyMap<
    string,
    { readonly identity: string; readonly giver: string; readonly label: string }
  >
  /** How many of them wait on a person — see {@link needingCount}. */
  readonly needing: number
  readonly open: boolean
  /**
   * ⛔ **Folded, and the conversation on screen is one of its rows** — so its header carries the
   * selection the hidden row cannot. ⚑ Never true while the section is open: the row says it.
   */
  readonly holdsTheOneOnScreen: boolean
}

/**
 * ⚑ **The sections with rows in them, BroBot's first.** ⛔ A section with no rows is not drawn, and a
 * folded one keeps its count, its badge and — when it holds the conversation on screen — the mark.
 */
const sections = computed<RailSection[]>(() =>
  RAIL_SECTIONS.flatMap((key) => {
    const inIt = rows.value.filter((row) => row.section === key)
    if (inIt.length === 0) return []
    const open = sectionOpen[key].value
    const groups = groupWorkers(inIt, (row) => row.sessionId)
    const workerHeads = new Map(
      groups.flatMap((group) =>
        group.worker
          ? [
              [
                group.rows[0]!.sessionId,
                {
                  identity: group.worker.identity,
                  giver: group.worker.giver,
                  label: workerName(group.worker, props.agents?.identities ?? null),
                },
              ] as const,
            ]
          : [],
      ),
    )
    return [
      {
        key,
        heading: railSectionHeading(key, props.agents?.identities ?? null),
        rows: groups.flatMap((group) => group.rows),
        workerHeads,
        needing: needingCount(inIt),
        open,
        holdsTheOneOnScreen: !open && inIt.some((row) => row.sessionId === onScreenId.value),
      },
    ]
  }),
)

/** ⚑ A press on a section's header folds it, or unfolds it. */
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
            <small
              class="says"
              title="Conversations from here, and from Claude's and Codex's own folders"
              >Conversations from here, and from Claude's and Codex's own folders</small
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

      <!-- Opening any row shows its full conversation, and sending a message there continues it. Group the same ordered rows into collapsible BroBot and other-agent sections, BroBot first. Omit empty sections rather than split by open or closed state. -->
      <div class="rail-section rail-conversations" data-wired="true" data-cy="rail-conversations">
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
            <!-- ⛔ **A LIVE attention count** (203, from 195 H3). It renders only when there is
                 something to say, so a quiet rail is quiet — the same rule the *Waiting on you*
                 badge follows and the reason a fresh install shows no zero. -->
            <span
              v-if="section.needing > 0"
              class="count badge"
              :data-cy="`rail-needs-you-${section.key}`"
              :title="`${NEEDS_YOU}: ${section.needing}`"
              >{{ section.needing }}</span
            >
            <span class="count" :data-cy="`rail-count-${section.key}`">{{
              section.rows.length
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
                :aria-label="conversationTitle(row.label, row.named)"
                :aria-description="
                  [
                    row.worker
                      ? workerDescription(row.worker, props.agents?.identities ?? null)
                      : null,
                    row.detail,
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
                        conversationTitle(row.label, row.named),
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
                <span class="rail-copy" :class="{ 'rail-worker-top': row.worker }">
                  <!-- The full title remains available on hover and as the button’s name. -->
                  <strong
                    :data-cy="row.worker ? `rail-worker-name-${row.sessionId}` : undefined"
                    :title="
                      row.worker
                        ? [row.label, row.named?.title].filter(Boolean).join(' · ')
                        : conversationTitle(row.label, row.named)
                    "
                    >{{ row.worker ? row.label : conversationTitle(row.label, row.named) }}</strong
                  >
                  <span
                    v-if="row.worker"
                    class="rail-worker-state"
                    :title="row.detail ?? workerState(row.word, row.named)"
                    :data-cy="`rail-state-word-${row.sessionId}`"
                    >{{ workerState(row.word, row.named) }}</span
                  >
                  <template v-if="row.worker">
                    <small
                      v-for="piece in workerSubtitles(
                        row.sessionId,
                        row.named,
                        cast.forest.value?.nodes.rows.flatMap((node) =>
                          node.node === 'a-task' ? [node.work] : [],
                        ) ?? [],
                      )"
                      :key="piece.key"
                      class="rail-worker-piece"
                      :title="piece.text"
                      >{{ piece.text }}</small
                    >
                  </template>
                  <!-- ⛔ **What this conversation was opened with** (211 §3, from 210 finding 4). ⚠️
                     **Absent, not blank, when the app does not know it** — a row that made one up
                     out of the oldest message it happens to hold would look exactly like a row that
                     knows. -->
                  <small
                    v-if="row.opening"
                    :id="`rail-opening-${row.sessionId}`"
                    class="opening"
                    :title="row.opening"
                    :data-cy="`session-opening-${row.sessionId}`"
                    >{{ row.opening }}</small
                  >
                  <!-- ⛔ **`row.word`, not `row.standing`** (203, from 195 H3): the word names WHICH
                     wait, and `data-standing` keeps the coarse word cross-surface tests read (099).
                     ⛔ **449 · WHERE it is working, last**: the rail is a 200px column, so whatever
                     is last is what ellipsizes, and a folder a person can recover from the hover is
                     a better thing to lose than the word that says whether the conversation is
                     waiting on them. ⚑ **D-016 · commit 7 · R2 — the agent's name, first, when the
                     work titles the row.** -->
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
                    ><template v-if="row.named && !row.worker"
                      ><span>{{ row.label }}</span> · </template
                    >{{ row.provider
                    }}<template v-if="!row.worker">
                      ·
                      <span :data-cy="`rail-state-word-${row.sessionId}`">{{
                        row.word
                      }}</span></template
                    ><template v-if="row.elsewhere"> · {{ OPEN_IN_ANOTHER_WINDOW }}</template
                    ><template v-if="row.place"> · {{ row.place }}</template></small
                  >
                </span>
              </button>
            </template>
          </div>
        </section>
        <!-- 🔴 **685 · the waits reading could not read every row** (`676` F-R18a) — so a row above
             reading *idle* may be waiting. ⚑ Once, under the rows it qualifies, and only when one
             of them was drawn from that reading; ⛔ not a `.rail-section` and no heading. -->
        <p v-if="waitsShort" class="rail-unread" data-cy="rail-waits-unread">
          <strong>{{ ROWS_UNREAD_LEAD }}</strong> {{ waitsShort }}
        </p>
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
          <strong data-cy="rail-spawning-state">{{ safety.view.value.heading }}</strong>
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

      <!-- Static chrome: who this workspace belongs to. The design reads "Local workspace · synced";
           nothing in this app syncs anywhere, so the claim is dropped rather than printed. -->
      <!-- 🔴 A0 · the workspace's own name and folder (`AppInfo.workspace`), never a person's.
           ⚑ B2 · a press opens this BroBot's version and its updates; a dot on the avatar while
           an update is offered. -->
      <div ref="footerBox" class="rail-footer-box">
        <button
          ref="footerButton"
          type="button"
          class="rail-footer"
          :title="props.workspaceFolder?.path"
          :aria-label="footerName"
          :aria-expanded="updatesOpen"
          aria-haspopup="dialog"
          data-cy="rail-workspace"
          @click="updatesOpen = !updatesOpen"
        >
          <span class="avatar" aria-hidden="true" data-cy="rail-workspace-initial">
            {{ workspaceInitial }}
            <span v-if="updateOffered" class="update-dot" data-cy="rail-update-dot"></span>
          </span>
          <span class="who">
            <strong v-if="workspaceName" data-cy="rail-workspace-name">{{ workspaceName }}</strong
            ><small>Local workspace</small>
          </span>
        </button>
        <UpdatesMenu
          v-if="updatesOpen"
          class="rail-updates"
          :version="props.appVersion"
          @close="closeUpdates"
          @renamed="(name) => (renamedTo = name)"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
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
  --row-muted: var(--rail-item-active-ink, var(--muted));
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

.rail-safety {
  border-color: var(--line-strong);
  margin-bottom: var(--space-3);
  background: var(--wash-2);
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
