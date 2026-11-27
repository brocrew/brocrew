<script setup lang="ts">
import { vButtonKeys } from '../lib/button-keys'
import { useClientApi } from '../client-provider/injection'
import { useProviderNames } from '../composables/useProviderNames'
import { useProviderLabel } from '../composables/useProviderLabel'
import { providerNamesIn } from '../lib/front-door-words'
import type { WhatEachConversationIsWaitingOn } from '../../../shared/task-contracts'

import { chordKeys, chordSaid, platformHere } from '../lib/this-computer'
import crewMark from '../assets/brocrew-mark.svg'
import { computed, ref } from 'vue'
import { NEEDS_YOU } from '../lib/agent-state'
import {
  conversationTitle,
  workerDescription,
  type ListedConversation,
} from '../lib/conversation-list'
import { RECENT_CONVERSATION_PAGE_SIZE } from '../../../shared/listing-published'
import {
  type ConversationIdentity,
  type ConversationIdentityBatchInput,
} from '../../../shared/conversation-title'
import type { WorkSearchQuery, WorkSearchResult } from '../../../shared/work-search'
import type { PaletteAgent, PaletteNavigation } from '../lib/command-palette'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
import { liveSignalView } from '../lib/live-signal'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'

import type { ProviderLimitsView } from '../lib/persons-queue'
import type { ProviderBlockStore } from '../lib/provider-limit-facts'
import { useMinuteClock } from '../composables/useMinuteClock'
import type { RailSays } from '../composables/useWhoCalledWhom'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import type { AppInfo } from '@brobot2/shared'
import type { SessionRecord } from '../lib/session-record'
import ConversationRow from './ConversationRow.vue'
import CommandPalette from './CommandPalette.vue'
import UpdatesMenu from './UpdatesMenu.vue'
import WorkspacesSection from './WorkspacesSection.vue'
import VersionButton from './VersionButton.vue'
import { COLLAPSE_THE_MENU, EXPAND_THE_MENU } from '../lib/rail-fold'
import { useRailFooter } from '../composables/useRailFooter'
import { useRailRows } from '../composables/useRailRows'
import { useRailRowViews } from '../composables/useRailRowViews'
import { useRailSections, type RailSectionKey } from '../composables/useRailSections'

/**
 * The rail holds destinations, the conversation list, one live signal and the stop switch.
 * Tools, agents and projects keep their counts and actions on their own pages.
 * Conversations are split by whether they need you; the stop switch stays in reach.
 */
const client = useClientApi()
const nameOfProvider = useProviderNames(client)
const providerLabel = useProviderLabel()
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
    librarySearchCaller?: string | null
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
const {
  updatesOpen,
  footerBox,
  footerButton,
  workspacesOpen,
  workspaceDialog,
  versionButton,
  footerName,
  toggleWorkspaces,
  toggleUpdates,
  closeUpdates,
  renamedTo,
  workspaceName,
  workspaceInitial,
} = useRailFooter(props)

const liveSignal = computed(() =>
  liveSignalView(props.workspace, props.limits, railMinute.value, providerNamesIn(nameOfProvider)),
)

const {
  hostResumable,
  coverageComplete,
  initialRecent,
  looked,
  listError,
  hearStates,
  refreshListed,
  listed,
  workByHolder,
  rows,
  waitsShort,
} = useRailRows(props, client, railMinute)

/* ---------------------------------------------------------------------------
   The command palette (249) — hosted HERE, and the reason is the constraint.
   --------------------------------------------------------------------------- */

const palette = ref<InstanceType<typeof CommandPalette> | null>(null)
/** Only a conversation surface has an on-screen identity; destinations keep activeId too. */
const onScreenId = computed(() => (props.place === null ? props.activeId : null))
const paletteSearchCaller = computed(
  () =>
    listed.value.find((row) => row.sessionId === onScreenId.value)?.sessionId ??
    listed.value[0]?.sessionId ??
    props.librarySearchCaller,
)

const { sectionOpen, recentLimit, rowsIdOf, waitingRows, sections, moreRecent } = useRailSections(
  props,
  rows,
  onScreenId,
  coverageComplete,
  initialRecent,
)

const { identityOf, rowTitle, railView, railCy } = useRailRowViews(
  props,
  sections,
  railMinute,
  workByHolder,
  providerLabel,
)

function fold(key: RailSectionKey): void {
  sectionOpen[key].value = !sectionOpen[key].value
}

/** Palette actions use the present control fold, not a transcript scrolled into old history. */
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

/** The palette uses the same navigation events as the rail. */
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

           The signal stays outside `.rail-scroll` so it remains visible with a long list.
           It is a child of `.rail-primary-action`, which is
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
      <div class="rail-section rail-destinations" style="margin-top: 0">
        <!-- The complete Waiting on you queue and the windowed Recent activity stay separate. -->
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

        <button
          v-if="paletteSearchCaller && props.searchConversations"
          class="rail-item"
          type="button"
          data-cy="rail-find-destination"
          :title="props.collapsed ? 'Find a conversation' : undefined"
          @click="palette?.toggle()"
        >
          <svg class="icon"><use href="#i-search" /></svg>
          <span class="rail-copy"><strong>Find a conversation</strong></span>
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
          <p
            v-if="section.key === (waitingRows.length ? 'needs-you' : 'recent')"
            class="section-label rail-other-heading"
            data-cy="rail-other-conversations"
          >
            Other conversations
          </p>
          <!-- A folded section still shows its count and marks the selected conversation. -->
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
            <span
              v-else-if="section.count !== null"
              class="count"
              :data-cy="`rail-count-${section.key}`"
              >{{ section.count }}</span
            >
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
              <div
                class="rail-item"
                :class="{ active: row.sessionId === onScreenId }"
                :data-worker="row.worker ? true : undefined"
                role="button"
                tabindex="0"
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
                    identityOf(row)?.address,
                    !row.worker && row.named && identityOf(row)
                      ? conversationTitle(row.label, row.named)
                      : null,
                    identityOf(row)?.author?.kind === 'person' ? 'Named by you' : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                "
                :aria-describedby="
                  !row.brobot && row.opening && !identityOf(row)
                    ? `rail-opening-${row.sessionId} rail-state-${row.sessionId}`
                    : `rail-state-${row.sessionId}`
                "
                :title="
                  props.collapsed
                    ? [
                        row.worker && row.named ? row.label : null,
                        rowTitle(row),
                        !row.brobot ? identityOf(row)?.address : null,
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
                v-button-keys
              >
                <ConversationRow
                  :row="railView(row)"
                  :minute="railMinute"
                  id-prefix="rail"
                  layout="contents"
                  :cy="railCy(row)"
                >
                  <template #lead>
                    <span
                      v-if="props.collapsed && row.named"
                      class="work-label"
                      aria-hidden="true"
                      :data-cy="`rail-work-label-${row.sessionId}`"
                      >{{ row.named.label }}</span
                    >
                  </template>
                </ConversationRow>
              </div>
            </template>
          </div>
          <button
            v-if="section.key === 'recent' && section.open && moreRecent > 0"
            class="rail-item rail-show-more"
            type="button"
            data-cy="rail-show-more"
            :aria-label="`Show ${moreRecent} more recent conversations`"
            :title="props.collapsed ? `Show ${moreRecent} more` : undefined"
            @click="recentLimit += RECENT_CONVERSATION_PAGE_SIZE"
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
          <svg class="icon"><use href="#i-search" /></svg>
          <span class="rail-copy"><strong>Find a conversation</strong></span>
        </button>
      </div>
    </div>
    <div class="rail-bottom">
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

<style scoped src="./SideRail.css"></style>
