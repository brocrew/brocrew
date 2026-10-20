<script setup lang="ts">
import type { ProviderLimitDisplay } from '../lib/provider-limit-status'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import {
  YOLO_LABEL,
  type CreatedSession,
  type ProviderCapabilityMap,
  type SessionStatus,
} from '../../../shared/runtime-ipc'
import {
  PIECE_TITLE_CHARS,
  theWorkThatNamesItSaid,
  type WorkThatNamesIt,
} from '../../../shared/piece-called'
import { clockTime } from '../../../shared/clock'
import {
  activityWords,
  standingOf,
  STANDING_LABEL,
  STANDING_TONE,
  type ActivityLine,
  type AgentFacets,
} from '../lib/agent-state'
import { fullTime } from '../lib/clock'
import { handBackOffer } from '../lib/handing-it-back'
import { basenameOf } from '../lib/paths'
import { inventoryAsOf, inventorySummary, readInventory } from '../lib/tool-inventory'
import { LIFECYCLE_TOGGLE_TITLE } from '../lib/transcript-mode'
import { stillThinkingSays } from '../lib/still-thinking'
import type { ToolRegistry } from '../lib/transcript'
import AgentState from './AgentState.vue'

/**
 * What this conversation is, and what it is doing right now.
 *
 * The same header serves a running conversation and a thread that has not started yet, because
 * they are the same place at two moments — `session` is null for the second, and everything that
 * would be a claim about a session that does not exist is simply absent rather than blank.
 *
 * State effective conversation settings in the header and request changes on the agent card
 * in the drawer's Open tab. Label both so a request cannot look like an applied change.
 *
 * ⚑ **D-017b · there is no End.** A conversation is never ended — a stop is not an ending, and a
 * message continues it — so the bar offers no press that would say otherwise.
 *
 * 🔴 **`578` · three facts left this bar, and one rule replaced their treatment** (`EXT-010` §1).
 *
 * ⛔ **What left, and where it went.** Model and reasoning effort left the chip and plan mode left
 * its pill; all three are the Agent panel's now, which is `EXT-010` §1.1's *"pick one"*.
 * ⚠️ **The chip keeps `provider`**, which no other surface on the conversation states.
 *
 * ⛔ **And the rule, which is `EXT-010` §2.1's rail made into a treatment:** *a state word may not
 * be styled as a control, and a control may not be styled as state.* ⚑ **So on this bar STATE IS
 * TEXT and CONTROLS ARE BOXES**, with no exceptions — `not planning`, `YOLO · …` and `Idle` were
 * three bordered, filled, 24px pills sitting in a row with three bordered, filled, 30px buttons,
 * and the PO read the row as a toolbar because it looks like one. ⚠️ **The title is neither**: it
 * is the conversation's identity, not a state and not one of the acts, and since D-016 · commit 7
 * (R4) pressing it edits it in place — so it stays drawn as the title ({@link renamable}).
 *
 * 🔴 **`§1.4` is the one thing that may not give.** *"Whether an agent is working, waiting or done
 * is the most consequential fact on this screen and it currently has the least emphasis on it."*
 * ⚑ So the standing is the only thing on this bar drawn at `--text-md`, it sits beside the title
 * rather than at the end of a queue of chips, and it is `flex: 0 0 auto` — **the acts never shrink
 * and neither does it; everything between them is what gives way.** ⛔ That is `§1.2` as well: an
 * act's word was clipped to three letters because a fixed run of pills was winning a fight the
 * layout never told it to have.
 */
const props = withDefaults(
  defineProps<{
    /** The running session, or null for a thread that has not been started. */
    session: CreatedSession | null
    status: SessionStatus | null
    /** Whether lifecycle notices are shown inline in the conversation (079 §3). */
    debug: boolean
    /**
     * Whether the drawer is showing (080). Optional, and the launcher passes neither this nor
     * `waiting`: there is no conversation yet, so the button that would toggle it is not rendered
     * at all rather than rendered dead.
     */
    drawerOpen?: boolean
    /**
     * How many things in this conversation are blocked on the user, from the control projection
     * (064) — the same one the drawer's Open tab renders. It is on the button so that closing the
     * drawer hides the LIST and never the fact, which is what makes a shut default defensible at
     * all (080 §1). When the drawer is shut and this is above zero the button also goes amber:
     * a number is a reading, a colour is a summons.
     */
    waiting?: number
    /** The provider a new conversation would start on, when there is no session yet. */
    defaultProvider?: string
    /**
     * Every provider's declared capabilities (039), for the one sentence in {@link yoloTitle} that
     * differs between them. Optional and read defensively: the launcher renders this header with no
     * session at all, and `RuntimeScreen` leaves the map null when the capabilities fetch fails —
     * in both cases the tooltip loses a sentence rather than the mark losing its state.
     */
    capabilities?: ProviderCapabilityMap | null
    /**
     * What the agent is doing, is, and needs (082) — **derived by the pane and handed down, never
     * worked out here.**
     *
     * Two of the three facets need fields this component does not have (`activity` and
     * `streamingId` live on the control projection) and the third needs the panel's own counts. A
     * header that computed what it could and guessed the rest would be a second opinion about the
     * session standing next to the pills that state the first — which is the drift 074 spent a
     * whole task removing.
     *
     * ⚠️ **Required, though every field on it is optional.** It defaulted to `{}` at first, which
     * TypeScript accepts and which draws a faceless plate under no line — a component that looks
     * broken, with no diagnostic. A future surface that forgets it now fails to compile instead.
     * The launcher passes a real `unstarted` answer, built by the same function (see
     * `NewConversation.LAUNCHER_FACETS`).
     */
    facets: AgentFacets
    providerLimit?: ProviderLimitDisplay | null
    /**
     * While a piece this conversation gave waits on purpose: whom it waits on and why, said in
     * place of the wait's own word (`says`), and with the status line whole on its title.
     */
    waitsOnPurpose?: { readonly says: string; readonly whole: string } | null
    /**
     * Whether the conversation this bar is titling is being OPENED right now (101 §9, 103).
     *
     * Only meaningful with no `session` — it is the launcher's own read, and while it is true the
     * plate-and-chip cluster is replaced by a single "Starting…" rather than having a third thing
     * added beside them. The Cancel is deliberately NOT up here: 101 asked for *"one slot, not
     * two"*, and the slot is the composer foot, where the launch was pressed.
     */
    starting?: boolean
    /**
     * 🔴 **What tools this conversation has** (358) — the fold's registry, handed down for the one
     * button that opens the sheet and for the count on it.
     *
     * ⚠️ **Optional, and absent means the button is not drawn at all.** The launcher renders this
     * header with no session; a tools button there would open a sheet about a conversation that
     * does not exist, which is `106`'s rule — a control that cannot act is not offered.
     */
    tools?: ToolRegistry
    /**
     * 🔴 **D-016 · commit 7 · R2 — the work that names this conversation**, off the host's list
     * (`SideRail.listedOf`): the title is `W1 · Bakery website` where it was the folder, and the
     * folder moves to the hover. ⚑ `null` for the launcher and for a conversation the one list does
     * not name, which keep today's title; the agent's name is on the Agent panel.
     */
    named?: WorkThatNamesIt | null
    /**
     * ⚑ **R4 — a person renames that work**, present only where the door would accept it (a root:
     * `RuntimeScreen`'s rule), so an absent one draws the title and no press (`106`). Resolves
     * `null` once renamed and re-listed, or the words that refused it.
     */
    retitle?: (title: string) => Promise<string | null>
    /**
     * Archive this conversation: resolves `null` once it is archived, or the words that refused
     * it, drawn under the bar as they are. Absent draws neither Archive nor Delete, as on the
     * launcher, where there is no conversation to act on.
     */
    archive?: () => Promise<string | null>
    /**
     * {@link activityLine}'s answer, for the end of the status line. `null` draws nothing: the
     * standing beside the plate already says the agent is idle. Never `control.activity`, which
     * outlives its turn.
     */
    activity?: ActivityLine | null
    /**
     * The newest recorded event's own time, a stamp and not a freshness claim: a clock time, with
     * the whole instant on hover. `null` draws nothing.
     */
    lastReportAt?: number | null
    /**
     * Whether the small plate is drawn beside the standing. The pane passes `false` while the
     * right panel sits beside the conversation showing its card, whose large plate says who it is.
     */
    plate?: boolean
  }>(),
  {
    plate: true,
    drawerOpen: false,
    waiting: 0,
    defaultProvider: undefined,
    starting: false,
    tools: undefined,
    named: null,
    retitle: undefined,
    archive: undefined,
    activity: null,
    lastReportAt: null,
  },
)

const emit = defineEmits<{
  /** 523 · give this conversation back to nobody — see `handing-it-back.ts`. */
  handBack: []
  /** Open the confirmation that lists what deleting this conversation would remove. */
  delete: []
  toggleDebug: []
  toggleDrawer: []
  openTools: []
}>()

/**
 * 🔴 **The tools read, for the button's tooltip and its count** (358).
 *
 * ⛔ **The SAME function the sheet uses**, not a second summary written for a header. `169` §1: one
 * rule spelled in two places drifts, and here a drift would be a button promising a number the
 * sheet behind it does not show.
 *
 * ⚠️ `null` where there is no session or no registry — the button is not rendered then.
 */
/**
 * 🔴 **Whether this conversation can be handed back** (523).
 *
 * ⛔ **`handBackOffer` and no second opinion.** The decision is `CreatedSession.mayHandItBack` —
 * `RuntimeHost.mayHandBack`'s own answer, carried on the hand-over — so the button a person sees and
 * the door the press goes through read one rule. ⚠️ A header that derived it from
 * `startedWithoutAWindow` and whatever it knows about ownership would be `169` §1's two spellings,
 * and the one that drifts decides whether a control is on screen.
 */
const handBack = computed(() => handBackOffer(props.session))

const toolsRead = computed(() => (props.session && props.tools ? readInventory(props.tools) : null))

/**
 * The count on the button — BroBot's own tools, and nothing else.
 *
 * ⛔ **Not the published total.** 37 is what a Claude child publishes and 32 of them are the
 * provider's own built-ins; a `37` on this button would answer a question nobody asked and bury the
 * five that this app put there. The built-ins are counted inside the sheet, where there is room to
 * say which is which.
 *
 * ⚠️ **Absent, never `0`, when nothing has been reported** — the `changes` tab's rule (092 §2),
 * because a `0` here would say this conversation has no tools while the registry is still `null`.
 */
const toolCount = computed(() => toolsRead.value?.own?.tools.length ?? null)

/**
 * 🔴 **The badge's hover, and it says WHEN as well as how many** (444 relay 1).
 *
 * ⛔ **A count with no moment is a count a person cannot read.** A conversation started before
 * `441` showed 15 and a new one showed 16; both were true, and this bar was one of the places that
 * would not say of what instant. ⚑ **The number in the chip stays bare** — a timestamp in a 20px
 * badge is not readable — and the moment goes here, which is where every other read-only fact
 * about the conversation already lives.
 *
 * ⚠️ **Composed by `inventoryAsOf`, not spelled here.** {@link inventorySummary}'s own docblock is
 * the rule: one fact spelled in two places drifts, and the workbench draws the same moment.
 */
const toolsTitle = computed(() => {
  const read = toolsRead.value
  if (read === null) return ''
  const asOf = inventoryAsOf(read)
  const head = `The tools this conversation has — ${inventorySummary(read)}`
  return asOf === null ? head : `${head} · ${asOf}`
})

const title = computed(() => {
  if (!props.session) return 'New conversation'
  // ⚑ F033 · with its marks; the rename field below edits `named.title` alone, never a mark.
  if (props.named !== null) return theWorkThatNamesItSaid(props.named)
  return basenameOf(props.session.cwd) || props.session.sessionId
})

/**
 * 🔴 **D-016 · commit 7 · R4 — the work a press on the title renames**, or `null` where the title is
 * no press: the launcher, a title that is not the work's, and work the door would refuse
 * ({@link retitle} absent).
 *
 * ⚑ **The rename happens in place.** A press turns the title into its field, the label kept before
 * it; **Enter** saves, and **Escape** or leaving the field drops the draft and sends nothing — a
 * title is never written by a click somewhere else. ⛔ A refusal keeps the field open, with the
 * door's own words under it; nobody is told of a rename, and the title reads the newest.
 */
const renamable = computed(() =>
  props.session !== null && props.retitle !== undefined ? props.named : null,
)
const renaming = ref(false)
const draft = ref('')
const saving = ref(false)
const refused = ref<string | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)

function startRenaming(): void {
  draft.value = renamable.value?.title ?? ''
  refused.value = null
  renaming.value = true
  void nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}

function stopRenaming(): void {
  renaming.value = false
  refused.value = null
}

/** ⚑ Leaving the field cancels, except while Enter's save is in flight (the field is disabled). */
function stopRenamingUnlessSaving(): void {
  if (!saving.value) stopRenaming()
}

async function save(): Promise<void> {
  if (props.retitle === undefined) return
  saving.value = true
  refused.value = await props.retitle(draft.value)
  saving.value = false
  if (refused.value === null) renaming.value = false
  else void nextTick(() => titleInput.value?.focus())
}

// ⚑ Another conversation on screen — or its work no longer renamable here — leaves the field.
watch(() => renamable.value?.label, stopRenaming)

/** An archive in flight, and main's words when it refused one. */
const archiving = ref(false)
const archiveRefused = ref<string | null>(null)

async function archiveIt(): Promise<void> {
  if (props.archive === undefined || archiving.value) return
  archiving.value = true
  archiveRefused.value = null
  try {
    archiveRefused.value = await props.archive()
  } finally {
    archiving.value = false
  }
}

// A refusal is about the conversation it was pressed on, and leaves with it.
watch(
  () => props.session?.sessionId,
  () => (archiveRefused.value = null),
)

/**
 * 🔴 **Which provider this conversation runs on. One word, and since `578` only one word.**
 *
 * ⛔ **It used to be `provider · model · reasoning`, joined from rows the HOST composed** — a
 * summary of details another surface states (`EXT-010` §1.1). The model and the effort are the
 * Agent panel's run strip now.
 *
 * ⚠️ **`provider` stays because no other surface states it.** It is the one fact of the three
 * that was stated ONCE, and `101 §9` needs it on the launcher, where there is no shelf at all and
 * this is the only thing that can say which provider a new conversation would start on.
 *
 * ⛔ **{@link providerDetail} is unchanged and still carries all three** on the hover, where the
 * full row is `resume-live-smoke.mjs`' own reading of *"what the app says this conversation is
 * running"*. ⚑ A tooltip is not the strip; `EXT-010` §1.1 is about two answers a person meets in
 * one glance.
 */
const providerChip = computed(() => {
  // Not started yet: the only thing that can be said is which provider it WOULD start on, and
  // that name is handed in — naming one here would put provider knowledge in the view (072/076).
  //
  // ⚠️ **The `· not started` suffix was dropped in 103, and it is a de-duplication rather than a
  // loss.** 101 measured the launcher saying "not started" three times — this suffix, the plate's
  // own aria, and the status pill — and ruled: *"the fix de-dupes the WORD, keeps the plate."* The
  // plate is the single lifecycle signal, and the page's own "New conversation" heading says the
  // rest. What is left here is the one fact the plate cannot carry: which provider it would be.
  if (!props.session) return props.defaultProvider ?? ''
  return props.session.provider
})

/** No session yet — this bar is titling the launcher rather than a conversation (101 §9). */
const unstarted = computed(() => props.session === null)

const providerDetail = computed(() => {
  if (!props.session) return 'the provider a new conversation starts on'
  const rows = props.session.liveness.agent ?? []
  return [`provider: ${props.session.provider}`, ...rows.map((r) => `${r.label}: ${r.value}`)].join(
    ' · ',
  )
})

/**
 * A change that has been asked for and has not landed — 079 §1 #11, and the one place I kept a
 * marker up top rather than sending it wholesale to Controls.
 *
 * ⚠️ **Without it the chip silently disagrees with the control.** You pick `max` in Controls, the
 * chip goes on saying `thinking` — correctly, because the running turn IS still thinking — and the
 * bar looks like it ignored you. The marker is what makes the disagreement legible instead of
 * suspicious. It is deliberately NOT drawn in the colour of the value being requested: until the
 * next turn starts, the old one is what is true (034).
 *
 * Approvals are in here too, though 079 only named model and effort. A queued approval change is
 * the same kind of fact and the most safety-relevant of the four; leaving it as the one pending
 * thing with nowhere to show would be 074's defect — the UI stating less than it knows.
 */
/* Plan mode is the Agent panel's: this bar states none of it. */

/**
 * 🔴 **What yolo does on THIS provider, on the pill that announces it** (367, HO-011 §3.2).
 *
 * ⛔ **The differing half is DECLARED by the adapter and rendered blind here.** The first draft of that sentence — written on
 * this bar, when the plan pill was still here — read `props.session.provider === 'claude'` and the
 * neutrality census caught it; indexing the declared map BY the provider is not the same thing as
 * recognising one, and no provider name appears here.
 *
 * ⚠️ **The pill's own words carry the half that is true of BOTH and this carries the rest.** `364`
 * measured that the two modes differ in kind — one drops an OS sandbox, the other never had one and
 * drops the card — so a title that said one thing to both would be false for at least one of them.
 *
 * ⚑ **A title, and the pill text is what actually changed.** §2 of `367` is explicit that a tooltip
 * is not a disclosure; the reach clause is IN the pill, and this is the sentence for the person who
 * hovers it after reading that clause.
 */
const yoloTitle = computed(() => {
  const session = props.session
  const status = session ? props.capabilities?.[session.provider]?.approvals : undefined
  const declared = status?.state === 'available' ? status.note : undefined
  return `Yolo — the CLIs’ --dangerously-skip-permissions and --yolo. This session runs commands and edits files without asking, except what the provider’s own plan mode asks while it plans, and nothing this app configures confines them. ${declared ?? ''} Change it in the drawer’s Open tab.`.replace(
    /\s+/g,
    ' ',
  )
})

const pendingMarker = computed(() => {
  const session = props.session
  if (!session) return null
  const settings = session.settings
  const named = (pending: { value: string | undefined } | null): string | null =>
    pending === null ? null : (pending.value ?? 'provider default')

  const parts = [
    named(settings.pendingModel),
    named(settings.pendingReasoningEffort),
    settings.pendingPlanMode === null
      ? null
      : settings.pendingPlanMode
        ? 'plan mode'
        : 'plan mode off',
    session.pendingApprovalMode === null
      ? null
      : session.pendingApprovalMode === 'auto'
        ? 'approvals off'
        : 'approvals on',
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : `${parts.join(' · ')} requested`
})

/**
 * ⚠️ **This component decides NOTHING about what the session is doing** (099) — the same sentence
 * `ActivityPill` carries, for the same reason, one component further round the bar.
 *
 * Derive the status pill through {@link standingOf} from the same `facets` object as the plate. A separate status-to-word map can disagree with the plate during updates.
 *
 * ⚠️ **`props.status` is still a prop, and still on `data-status`.** It is the host's raw word,
 * which is what three live smokes read the attribute for and what a diagnostic should say; the
 * LABEL is the app's one answer. Do not re-introduce a visible string derived from it.
 */
const standing = computed(() => standingOf(props.facets))
const onPurpose = computed(() =>
  standing.value === 'elsewhere' ? (props.waitsOnPurpose ?? null) : null,
)
const statusLabel = computed(() =>
  props.facets.being === 'starting'
    ? 'Starting'
    : (props.providerLimit?.word ?? onPurpose.value?.says ?? STANDING_LABEL[standing.value]),
)
const statusDetail = computed(() => props.providerLimit?.detail ?? onPurpose.value?.whole)
const statusTone = computed(() => STANDING_TONE[standing.value])

/**
 * Provider liveness. The state is decided host-side; all the renderer does is show it and count
 * the seconds off `since`, so "silent 40s" keeps climbing instead of freezing at whatever it was
 * when the message was sent. The `pid` moved to the Info tab (079 §1 #5): the state is a
 * glance-state, the process is something you copy.
 */
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onScopeDispose(() => clearInterval(ticker))

const liveness = computed(() => props.session?.liveness ?? null)
const silentFor = computed(() =>
  liveness.value ? Math.max(0, Math.round((now.value - liveness.value.since) / 1000)) : 0,
)
/**
 * ⚑ **D-017b · only the silence is said** — *"silent 40s"*: a turn said it was working and nothing
 * has arrived since. ⛔ *provider live*, *ended* and *errored* were whether a process runs (`05` rule
 * 5), so the pill is drawn only while the provider is silent. The amber is a condition, not an error.
 */
const providerSilent = computed(() => liveness.value?.state === 'silent')
/** Why the provider is quiet: how long the model has been thinking, counted here, or the host's line. */
const livenessDetail = computed(() => {
  const said = liveness.value
  if (said === null) return null
  if (said.state === 'silent' && said.thinking === true) {
    return stillThinkingSays(now.value - said.since)
  }
  return said.detail ?? null
})

/** The pill's rule: the word, and the tool's name when there is one. */
const activityText = computed(() => {
  const line = props.activity
  return line ? activityWords(line) : null
})

const reportedAt = computed(() => clockTime(props.lastReportAt ?? undefined))
const reportedAtFull = computed(() => fullTime(props.lastReportAt ?? undefined))

/** Something is waiting and the drawer is shut — the state the toggle has to shout in (079 §5). */
const urgent = computed(() => props.waiting > 0 && !props.drawerOpen)

/** The toggle's name: its action, then the waiting count the badge draws. Stable across open and
 *  shut, since the pressed state already says which. */
const panelToggleName = computed(() =>
  props.waiting > 0
    ? `Show or hide the panel, ${props.waiting} waiting on you`
    : 'Show or hide the panel',
)
</script>

<template>
  <header class="session-header" data-cy="session-header">
    <div class="header-title">
      <h1 :title="props.session?.cwd ?? ''" data-cy="conversation-title">
        <template v-if="renamable && renaming"
          >{{ renamable.label }} ·
          <input
            ref="titleInput"
            v-model="draft"
            class="title-input"
            data-cy="conversation-title-input"
            :maxlength="PIECE_TITLE_CHARS"
            :disabled="saving"
            :aria-label="`Title of ${renamable.label}`"
            @keydown.enter.prevent="save"
            @keydown.esc.stop.prevent="stopRenaming"
            @blur="stopRenamingUnlessSaving"
        /></template>
        <button
          v-else-if="renamable"
          type="button"
          class="title-press"
          data-cy="conversation-title-rename"
          :aria-label="`Rename ${title}`"
          @click="startRenaming"
        >
          {{ title }}
        </button>
        <template v-else>{{ title }}</template>
      </h1>
      <!-- ⚑ **R4 · the door's own words, under the field they are about** — one line, cut with the
           whole sentence on its hover, so the bar keeps its height. -->
      <small
        v-if="renaming && refused"
        class="title-refused"
        role="alert"
        data-cy="conversation-title-refused"
        :title="refused"
        >{{ refused }}</small
      >
    </div>

    <!-- 🔴 **THE most consequential fact on this screen, drawn as though it were** (`578`,
         `EXT-010` §1.4). ⛔ *"`Idle` is the only thing telling a person the turn has finished —
         same size, same weight, same treatment as `not planning`."*

         ⚑ **Three things carry the priority and each is measurable.** It is the only text on this
         bar at `--text-md`; it is the SECOND thing read rather than the last of a run of chips;
         and it is `flex: 0 0 auto`, so when the bar runs out of room this and the acts are the two
         things that do not give. ⛔ **Never a box**: a state word styled as a control is the mirror
         of `EXT-010` §2.2's control styled as a bullet, and this dispatch is fixing that rule's
         other half.

         ⚠️ **The plate came with it, and that is not a second opinion.** `AgentState` and
         {@link standing} are drawn from ONE `facets` object (099) — the pill cannot contradict the
         plate whatever the fold does next — so putting them in one lockup draws what was already
         one derivation as one thing.

         ⛔ **`v-if` on the launch, not on the session.** While a launch is in flight the plate is
         gone (101 §9, one read in place of the cluster), and an empty lockup would leave a gap
         where the loudest thing on the bar sits. -->
    <div v-if="!(unstarted && props.starting)" class="agent-standing" data-cy="agent-standing">
      <!-- The agent itself (082). It marks exactly the two facts the word beside it spells out —
           what it is DOING and what it IS — plus what it needs from you, which nothing up here
           could say before. The pills it stood among therefore lost their own dots: a dot and a
           plate saying the same thing in the same breath is the drift 074 removed six places of,
           and the plate says more.
           ⚠️ `silent-seconds` is the header's OWN counter, handed over. The component does not
           tick; if it did there would be two clocks up here that could disagree by a second. -->
      <AgentState
        v-if="props.plate"
        size="compact"
        v-bind="props.facets"
        :label="title"
        :silent-seconds="liveness?.state === 'silent' ? silentFor : undefined"
      />

      <!-- ⚠️ **Not on the launcher** (101 §9). `STANDING_LABEL.unstarted` is the literal word "Not
           started", and on a page already headed "New conversation", beside a faceless plate that
           means the same thing, it was the third of three. On a real conversation it is the app's
           one answer about what the session is doing and it stays exactly as 099 left it —
           including `data-status`, which three live smokes read. -->
      <span
        v-if="!unstarted"
        class="standing-word"
        :class="statusTone"
        data-cy="session-status"
        :title="statusDetail"
        :aria-description="statusDetail"
        :tabindex="statusDetail ? 0 : undefined"
        :data-status="props.status ?? ''"
        :data-standing="standing"
      >
        {{ statusLabel }}
      </span>
    </div>

    <p
      v-if="props.providerLimit?.history"
      class="provider-history"
      data-cy="provider-limit-history"
    >
      {{ props.providerLimit.history }}
    </p>

    <div class="header-spacer"></div>

    <!-- ⚑ **Everything that GIVES WAY.** ⛔ `min-width: 0` and `flex: 0 1 auto` are the whole of
         `EXT-010` §1.2's structural repair: the bar had one flat run of items, so the button a
         person reaches for shrank at the same rate as a pill nobody presses, and an act lost its
         word to three letters on a window that is not narrow. Three groups now, and the priority
         is in the flex rather than in a comment. -->
    <div class="header-state">
      <!-- One read while a launch is in flight, in place of the cluster rather than beside it (101
         §9). No Cancel up here: the slot is the composer foot, and two would be two. -->
      <!-- `role="status"` (implicit `aria-live="polite"`) because this is the only announcement a
         launch makes: the plate and chip it replaces simply vanish, and a user who is not reading
         the header would otherwise be told nothing at all. Same reason `cwd-refusal` is an alert. -->
      <span
        v-if="unstarted && props.starting"
        class="starting-read"
        role="status"
        data-cy="session-starting"
      >
        <span class="spin"></span>Starting…
      </span>

      <!-- Rendered only when there is a name to render: with no session and no default handed in
         there is nothing true to say, and an empty chip is a control that looks broken. -->
      <span
        v-else-if="providerChip !== ''"
        class="provider-chip"
        :title="providerDetail"
        data-cy="provider-chip"
      >
        <span class="dot"></span>{{ providerChip }}
      </span>

      <!-- Requested, not in effect. Dashed and grey on purpose — see the computed above. -->
      <span
        v-if="pendingMarker"
        class="pending-tag"
        data-cy="live-settings-pending"
        :title="`You asked for ${pendingMarker.replace(' requested', '')}. It applies from your next message — the turn now running keeps what it started with. Requested in the drawer's Open tab.`"
      >
        <svg class="icon"><use href="#i-refresh" /></svg>{{ pendingMarker }}
      </span>

      <!-- ⚠️ **Two axes, and only ONE of them is the standing** (076). What the conversation is
         doing is the lockup beside the title; this is whether the provider is still with us. They
         agree most of the time and disagree exactly when it matters — a turn that is "working"
         while the provider has gone silent is the stuck-turn case. ⛔ Quiet, because a permanent
         `provider live` on every conversation is furniture, and §1.4 says what the loud thing is.
         -->
      <span
        v-if="liveness && providerSilent"
        class="liveness waiting"
        :title="livenessDetail ?? ''"
        data-cy="session-liveness"
        :data-state="liveness.state"
      >
        silent {{ silentFor }}s
      </span>

      <!-- Show the compact YOLO marker only in automatic approval mode. Changes belong on the
           agent card; `data-mode` retains the enum read by live checks. Keep the marker to
           {@link YOLO_LABEL} without extra reach or confirmation clauses.

           ⚑ **What the clauses said, and where each fact is now.** *"Nothing is asked"* is `171`'s
           and is about the PROMPT; *"nothing is confined"* is `367`'s and is about REACH — `364`
           measured it on both providers and it is the same answer in this mode, no sandbox and the
           login's own scope, which is why it was provider-blind. ⛔ **Both survive in
           {@link yoloTitle} in plain words** — *"runs commands and edits files without asking, and
           nothing this app configures confines them"* — together with the half the ADAPTER declares.

           🔴 **And the argument that makes this more than obedience.** `171 §3`'s own rule is that
           the consequence must be said **where the mode is CHOSEN** — and this pill is not that
           place. ⚑ The two surfaces where a person chooses it, the front door's `launch-approval`
           and the agent card's `CardApproval`, both render the whole of `YOLO_MEANS` plus the adapter's note,
           visibly and unfolded, and `a-mode-that-says-what-it-does.dom.test.ts` §3 still pins them.
           ⛔ **What is left here is a REMINDER of a mode you set deliberately**, on the one bar
           `EXT-010` §1.2 says is fighting for horizontal space.

           ⚠️ **What this costs, stated plainly:** the reach is no longer readable at a glance — it
           takes a hover. ⚑ **What it buys:** 185px back on the bar, and the mark reads as a state
           word rather than as a sentence competing with the standing.
           ⚑ **Both live smoke steps read this pill with `/YOLO/`**, a regex over the trimmed text,
           so the shorter mark does not move them. -->
      <span
        v-if="session && session.approvalMode === 'auto'"
        class="liveness auto yolo-mark"
        data-cy="session-approval-indicator"
        :data-mode="session.approvalMode"
        :data-pending="session.pendingApprovalMode ?? ''"
        :title="yoloTitle"
      >
        <span class="dot"></span>{{ YOLO_LABEL }}
      </span>

      <!-- What the agent is doing and when it last reported, at the end of the line. It takes
           the room left on the line and cuts the activity there, so the bar never grows a row. -->
      <span v-if="activityText !== null || reportedAt !== ''" class="now" data-cy="shelf-now">
        <span v-if="activityText !== null" class="now-dot"></span>
        <span
          v-if="activityText !== null"
          class="now-copy"
          data-cy="shelf-activity"
          :data-doing="props.activity?.doing ?? ''"
          :data-tone="props.activity?.tone ?? ''"
          :title="activityText"
          >{{ activityText }}</span
        >
        <span v-if="reportedAt !== ''" class="now-dot"></span>
        <span v-if="reportedAt !== ''" class="now-at" data-cy="shelf-last-report"
          >last report
          <time :datetime="String(props.lastReportAt)" :title="reportedAtFull">{{
            reportedAt
          }}</time></span
        >
      </span>
    </div>

    <span class="sep"></span>

    <!-- ⛔ **Everything that NEVER gives** (`578`, `EXT-010` §1.2). `flex: 0 0 auto` on the group,
         so the acts keep their words at every width the app can be and the state beside them is
         what yields. ⚠️ The order inside is unchanged and its argument is unchanged with it. -->
    <div class="header-acts">
      <!-- 🔴 **Hand it back** (523 — `519` item 3, HO-045 §1) — the press that undoes *Take it over
         and open it*, so a look at a conversation costs nothing permanent.
         ⛔ **FIRST in the act cluster**, right after `.sep` — this bar's states-versus-acts
         boundary.
         ⚑ **One press, no confirmation, on purpose.** This app's only confirmation idiom is
         `spawn-safety.ts`'s press-then-press-again, and it guards the act that cannot be undone. A
         door in front of a reversible act teaches a person the two acts weigh the same.
         ⛔ **Drawn only where the host says the press would be allowed** — `handBackOffer` reads
         `CreatedSession.mayHandItBack`, which is `RuntimeHost.mayHandBack`'s own answer. A
         conversation this window STARTED offers nothing here (`106`: a control that cannot act is
         not offered), and the host refuses the same call `started-here` if anything sends it. -->
      <button
        v-if="handBack"
        class="ghost-button"
        type="button"
        data-cy="hand-it-back"
        @click="emit('handBack')"
      >
        <svg class="icon"><use href="#i-revert" /></svg>{{ handBack.action }}
      </button>

      <!-- Archive is the everyday way to put a conversation away: it keeps everything. Delete
           opens a confirmation that lists what it would remove, and removes nothing by itself. -->
      <button
        v-if="session && props.archive"
        class="ghost-button"
        type="button"
        :disabled="archiving"
        title="Stop it and take it out of the lists. Everything is kept; All conversations brings it back."
        data-cy="archive-conversation"
        @click="archiveIt"
      >
        <svg class="icon"><use href="#i-archive" /></svg>Archive
      </button>
      <button
        v-if="session && props.archive"
        class="ghost-button"
        type="button"
        title="See what deleting this conversation would remove, and choose"
        data-cy="delete-conversation"
        @click="emit('delete')"
      >
        Delete…
      </button>

      <!-- Expose the MCP tool inventory and its count in the header. Launch-time tools need not appear in `config.toml`, and a count hidden behind a drawer tab is hard to discover. The strip has no room for another tab at its minimum width. When unknown, omit the count rather than show zero; see {@link toolCount}. -->
      <button
        v-if="session && toolCount !== null"
        class="icon-button badged"
        type="button"
        :title="toolsTitle"
        data-cy="open-session-tools"
        :data-count="toolCount"
        @click="emit('openTools')"
      >
        <svg class="icon"><use href="#i-tool" /></svg>
        <span class="count" data-cy="session-tools-count">{{ toolCount }}</span>
      </button>

      <!-- One meaning since 079 §3: lifecycle notices INLINE in the conversation. It no longer opens
         anything — the event stream is a tab you open on its own — and the glyph changed with the
         meaning, from an eye ("reveal the machinery") to marks on a timeline, which is what
         lifecycle events are.

         ⛔ **This tooltip is unchanged by 211 §4 and that is the finding.** It has named those three
         things since 079; the FILTER behind it went on showing everything, so turning it on in a
         Codex planning conversation added 208 `item/plan/delta` markers and made the plan harder to
         read. `transcript-mode.ts` is what moved. The tooltip is quoted verbatim in
         `lifecycle-toggle.test.ts`, against the filter, so the two cannot drift again in silence. -->
      <button
        class="icon-button"
        :class="{ on: debug }"
        type="button"
        :data-on="debug"
        :aria-pressed="debug"
        :title="`${LIFECYCLE_TOGGLE_TITLE} (${debug ? 'on' : 'off'})`"
        data-cy="toggle-debug-mode"
        @click="emit('toggleDebug')"
      >
        <svg class="icon"><use href="#i-lifecycle" /></svg>
      </button>

      <!-- The drawer, and the badge that is the point of it. Attention trace #1: it is OUTSIDE the
         drawer, so a shut drawer hides the list and never the fact. -->
      <button
        v-if="session"
        class="icon-button badged"
        :class="{ on: props.drawerOpen, urgent }"
        type="button"
        :data-on="props.drawerOpen"
        :data-waiting="props.waiting"
        :data-urgent="urgent"
        :aria-pressed="props.drawerOpen"
        :title="
          props.waiting > 0
            ? `${props.waiting} waiting on you — open questions, permissions, agents and todos`
            : `The agent and its settings, events and what is open in this conversation (${props.drawerOpen ? 'on' : 'off'})`
        "
        :aria-label="panelToggleName"
        data-cy="toggle-session-panel"
        @click="emit('toggleDrawer')"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span
          v-if="props.waiting > 0"
          class="badge"
          data-cy="session-panel-badge"
          aria-hidden="true"
        >
          {{ props.waiting }}
        </span>
      </button>
    </div>
  </header>

  <p v-if="livenessDetail && liveness?.state !== 'live'" class="liveness-detail">
    {{ livenessDetail }}
  </p>

  <!-- Main's own words for an archive it refused, whole: a refusal says what to do next. -->
  <p v-if="archiveRefused" class="act-refused" role="alert" data-cy="archive-refused">
    {{ archiveRefused }}
  </p>
</template>

<style scoped>
.session-header {
  display: grid;
  height: auto;
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-10) var(--space-12) var(--space-8);
  border-bottom: 0;
  background: var(--panel);
  gap: var(--space-4) var(--space-6);
  min-height: var(--surface-header-h);
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.header-title {
  min-width: 0;
  grid-column: 1 / 3;
  grid-row: 1;
}

h1 {
  overflow: visible;
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-style: var(--font-style-display, normal);
  font-weight: var(--fw-display, var(--fw-heavy));
  letter-spacing: var(--tracking-display, var(--tracking-tight));
  line-height: var(--leading-tight);
  white-space: normal;
  overflow-wrap: anywhere;
}

.title-press {
  display: block;
  overflow: visible;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: text;
  letter-spacing: inherit;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  font: inherit;
}

.title-press:focus-visible,
.title-input:focus {
  outline-offset: calc(-1 * var(--focus-ring-width));
}

.title-input {
  width: 28ch;
  max-width: 100%;
  padding: 0 var(--space-3);
  letter-spacing: inherit;
}

.title-refused {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--danger-text);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-spacer {
  flex: 1;
  display: none;
}

/* Keeps the compact plate's height (its 24px circle, 9% gap and 3px underline) when the plate is
   left out, so the header does not move as the panel opens, closes or changes tab. */
.agent-standing {
  display: flex;
  min-height: calc(24px * 1.09 + 3px);
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-4);
  grid-column: 1;
  grid-row: 2;
}

.header-state {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-3) var(--space-6);
  grid-column: 2;
  grid-row: 2;
  flex-wrap: wrap;
}

.header-acts {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
  grid-column: 3;
  grid-row: 1 / 3;
}

/* A wait on purpose is a sentence: it is cut at this width, and its whole is on its title. */
.standing-word {
  overflow: hidden;
  max-width: 56ch;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-history {
  min-width: 0;
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
}

.standing-word.live {
  color: var(--accent-text-pale);
}

.standing-word.waiting {
  color: var(--waiting-text-label);
}

.provider-chip {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  font: var(--fw-medium) var(--type-caption) / 1 var(--font-mono);
  gap: var(--space-3);
  white-space: nowrap;
}

.provider-chip .dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--accent-2);
}

.starting-read {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-sm);
  background: var(--accent-fill);
  color: var(--accent-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
  white-space: nowrap;
}

.starting-read .spin {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--accent-border); /* raw: glyph stroke, drawn at its own width */
  border-radius: var(--radius-pill);
  border-top-color: var(--accent-text);
  animation: launch-spin 0.8s linear infinite;
}

@keyframes launch-spin {
  to {
    transform: rotate(360deg);
  }
}

.pending-tag {
  display: inline-flex;
  overflow: hidden;
  min-width: 0;
  height: 22px;
  flex: 0 1 auto;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-tag .icon {
  width: 10px;
  height: 10px;
}

.liveness {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
  white-space: nowrap;
}

.liveness .dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--muted);
}

.liveness.waiting {
  color: var(--waiting-text-label);
}

.yolo-mark {
  flex: 0 0 auto;
  font-size: var(--type-caption);
}

.yolo-mark .dot {
  width: 5px;
  height: 5px;
}

.liveness.auto {
  color: var(--waiting);
}

/* A zero basis keeps it on the line it starts on; it grows into what is left and cuts there. */
.now {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  white-space: nowrap;
}

.now-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--muted);
}

.now-dot:not(:first-child) {
  margin-left: var(--space-3);
}

.now-copy {
  overflow: hidden;
  min-width: 0;
  flex: 0 1 auto;
  color: var(--text-soft);
  text-overflow: ellipsis;
}

.now-at {
  flex: 0 0 auto;
}

.liveness.auto .dot {
  background: var(--waiting);
}

.sep {
  width: var(--border-width);
  height: 26px;
  flex: 0 0 auto;
  background: var(--line);
  display: none;
}

.icon-button {
  display: grid;
  width: var(--control-icon);
  height: var(--control-icon);
  flex: 0 0 auto;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.icon-button:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.icon-button.on {
  border-color: var(--accent-border);
  background: var(--accent-fill);
  color: var(--accent-text);
}

.badged {
  position: relative;
  overflow: visible;
}

.icon-button.urgent {
  border-color: var(--waiting-pill-border);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
  animation: attn 1.8s ease-in-out infinite;
}

@keyframes attn {
  0%,
  100% {
    box-shadow: 0 0 0 0 transparent;
  }

  50% {
    box-shadow: var(--waiting-glow-wide);
  }
}

.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-pill);
  /* The waiting wash over the header's own panel: opaque, so the corner of the button it sits on
     doesn't show through the count. */
  background: linear-gradient(var(--waiting-bg), var(--waiting-bg)), var(--panel);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  line-height: 13px;
  text-align: center;
}

.count {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  line-height: 12px;
  text-align: center;
}

.ghost-button {
  display: inline-flex;
  height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.ghost-button:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.liveness-detail {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-3) var(--space-12);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: var(--type-caption);
}

.ghost-button:disabled {
  cursor: default;
  opacity: 0.6;
}

.act-refused {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-3) var(--space-12);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--danger-text);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}
</style>
