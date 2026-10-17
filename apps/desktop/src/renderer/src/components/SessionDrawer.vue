<script setup lang="ts">
import type { ProviderLimitDisplay } from '../lib/provider-limit-status'
import { profileItRunsAs, whoIsIn } from '../lib/session-record'
import { computed, ref, useId } from 'vue'
import type {
  AgentIdentity,
  CreatedSession,
  ProviderCapabilityMap,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
  SessionRef,
  SessionStatus,
  SetSessionSettingInput,
  WhatAPickBecame,
} from '../../../shared/runtime-ipc'
import type { AgentState } from '../../../shared/agent-state'
import type { PickedModel } from '../lib/model-lists'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { AgentFacets } from '../lib/agent-state'
import { workGivenOutView } from '../lib/work-given-out'
import { changeSet, tabCount } from '../lib/changes'
import {
  attentionTraces,
  DRAWER_TABS,
  RESERVED_TABS,
  type DrawerFit,
  type DrawerTab,
} from '../lib/drawer'
import type { CompactionFacts } from '../lib/compaction-offer'
import type { PanelAsset } from '../lib/session-panel'
import type { TranscriptState } from '../lib/transcript'
import type { TranscriptMode } from '../lib/transcript-mode'
import type { WindowState } from '../lib/transcript-window'
import type { WorkGivenOutReading } from '../lib/work-given-out'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import EventStream from './EventStream.vue'
import SessionChanges from './SessionChanges.vue'
import SessionInfo from './SessionInfo.vue'
import { keptInThisConversation } from '../lib/standing-grants'
import SessionPanel from './SessionPanel.vue'
import SessionWork from './SessionWork.vue'

/**
 * One drawer beside the conversation, with tabs (079/080).
 *
 * Use one drawer with one width and one close toggle for the conversation's auxiliary views, rather than independent columns that can be opened together.
 *
 * The drawer shares the conversation body's light scope so adjacent panels, overlays and image chrome use a coherent surface. Documents inside a tab retain their own paper body and Markdown/Raw views.
 */
const props = defineProps<{
  session: CreatedSession
  /** What is OPEN — the session's control projection (064), never the fold on screen. */
  state: TranscriptState
  /** The fold the transcript is rendering, when that is a different one. Reachability only. */
  shown: TranscriptState
  mode: TranscriptMode
  /**
   * The raw stream, for the Events tab — **the window, not its entries** (237 §1).
   *
   * ⛔ **`230` H1 is why this is the whole window.** It was `RuntimeEventMessage[]`, and that array
   * is `record.window.entries` — bounded, released at 5,001 events, and frozen while the reader is
   * off the tail — while the tab it feeds promised *"you always see everything"*. Handing over the
   * entries alone made the fact about them unavailable at the only place that draws them.
   */
  window: WindowState
  sessionRef: SessionRef | null
  status: SessionStatus | null
  /**
   * Nothing set here would reach the conversation (`CreatedSession.settingsFixed`): the agent
   * panel's model, effort, plan and approval mode are statements.
   */
  fixed: boolean
  /** Drawn from its ledger: its next start takes the model and effort, and never planning. */
  recorded: boolean
  /** A person's model pick, carried out by the screen; absent, the model is a statement. */
  pickModel?: ((pick: PickedModel) => Promise<WhatAPickBecame | null | undefined>) | undefined
  /** Every provider's declaration (039). Null while the read has not arrived, or if it failed. */
  capabilities: ProviderCapabilityMap | null
  /** How many things are blocked on the user — the same count the toggle's badge carries. */
  waiting: number
  tab: DrawerTab
  /** ⚑ **W4.13 · tabs not offered** — the developer views while debug mode is off. Absent: none. */
  hiddenTabs?: readonly DrawerTab[]
  /** How the column sits in the width it was given. `overlay` floats it over the transcript. */
  fit: DrawerFit
  /**
   * What the agent is doing, is and needs (082) — forwarded to the Open tab, which pins it to its
   * top (090). Derived once by the pane; nothing between here and there re-reads the session.
   *
   * ⚠️ Note that this component already holds **both** of `SessionBot`'s inputs — this and, since
   * `537`, {@link who} rather than `session.provider`. That is deliberate and it is the whole cost
   * of 090's *"might move it away later"*: drawing the block above `.drawer-tabs` instead needs no
   * new data, only the element.
   */
  facets: AgentFacets
  providerLimit?: ProviderLimitDisplay | null
  /** ⚑ **D-017 · R11 — its ONE state** (`stateHere`), derived once by the pane beside the facets. */
  agentState?: AgentState
  /**
   * ⚑ **UI-008 · the work that names this conversation** (the pane's `named`), handed through to
   * the card, whose *Current task* draws the root a person gave it. Absent or `null` draws none.
   */
  named?: WorkThatNamesIt | null
  /** Show one of this session's paths in the file manager (356 §1). Optional for the same reason. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /** 🔴 733 · read one config file onto the app's paper — the Info panel's Open. Optional likewise. */
  onReadConfigFile?: (name: string) => Promise<ConfigFileResult>
  /**
   * Pass the pane's `ConversationPane.canStopBackgroundWork` gate and stop action to the card's running sub-agents. Reuse the gate read by the bar above the composer.
   */
  canStopBackgroundWork?: boolean
  onStopBackgroundWork?: (id: string) => Promise<boolean>
  /**
   * 🔴 **The work this conversation gave out** (508) — the Work tab's whole input.
   *
   * ⛔ **Polled by `RuntimeScreen` and handed down, like every other read that feeds a surface it
   * mounts.** ⚠️ The cadence is not here and must not be: `RuntimeScreen` owns the queue's, the
   * digest's, the roster's and now this one, keeps the last good answer on a refusal, and hands
   * the result down — a second poller inside a drawer that remounts on every tab change would ask
   * again on every click.
   *
   * ⚑ **`null` is *nothing has been read for this conversation yet*** and is not an empty list.
   */
  work: WorkGivenOutReading | null
  /**
   * ⚑ **The identity roster, so a Work row can say WHO the work went to** (449's `agentName`).
   *
   * ⚠️ `null` before the read lands is a real state: every row then reads as `profileLabel` does,
   * which is less rather than something else.
   */
  identities: readonly AgentIdentity[] | null
  /**
   * 🔴 **718 · `R60` — the conversation's send facts, for the Open tab's "Compact now…"**
   * (`compaction-offer.ts`). ⚠️ Optional: a drawer mounted without a conversation behind it —
   * every render test that mounts this alone — offers nothing, and the Context popup says so.
   */
  compaction?: CompactionFacts | null
  /**
   * ⚑ **UI-002 · a reader can open a kept file** — the pane's own gate
   * (`aSurfaceMayOpenADocument`), so the card's file rows are presses only where one opens.
   */
  canOpenDocument?: boolean
}>()

const emit = defineEmits<{
  'update:tab': [tab: DrawerTab]
  navigate: [itemId: string]
  /** ⚑ **718 · `R60`** — the Open tab's confirmed press, passed straight up to the pane. */
  compactNow: [intent: 'now' | 'queue']
  openAsset: [asset: PanelAsset]
  refreshConfig: []
  /**
   * ⚑ **Passed straight up** (`527` §3.3). The Info tab's index entry opens the agent's side wide,
   * and the layer it opens on is `ConversationPane`'s — see `SessionInfo`'s own note on why the
   * host is not raised here.
   */
  openInstructions: []
  /** ⚑ **F093 · open "What this agent receives"** — raised by the pane, like the sheet above. */
  openInputs: []
  setApprovalMode: [mode: 'ask' | 'auto']
  setSessionSetting: [body: SetSessionSettingInput['body']]
  /** ⚑ **UI-002 · show this file** — passed straight up to the pane's viewer. */
  openDocument: [resourceId: string]
}>()

const tabs = computed(() =>
  DRAWER_TABS.filter((entry) => !(props.hiddenTabs ?? []).includes(entry.id)),
)
/** 🔴 739 · `736` F-1 — the grants *Always allow* kept in this conversation, for Info's own row. */
const kept = computed(() => keptInThisConversation(props.state.items))
const reserved = RESERVED_TABS

/**
 * The attention signals this component owns — the per-tab dot and the cross-tab bar (079 §5).
 *
 * The other two live OUTSIDE it, on the top bar, and that is the entire design: a drawer can hide
 * the LIST of what is waiting; it must never be able to hide the FACT. See `lib/drawer.ts`.
 */
const traces = computed(() =>
  attentionTraces({
    waiting: props.waiting,
    status: props.status,
    drawerOpen: true,
    tab: props.tab,
  }),
)

/**
 * ⚠️ **079 §2's label-dropping is GONE, and this is where it was** (088).
 *
 * Draw text only for the active tab and icons for the rest. The single active label fits at the drawer's narrow minimum width, so a second breakpoint-based label-hiding mechanism is unnecessary.
 *
 * `fit` still reaches this component and still matters — it is what makes the drawer float instead
 * of crushing the transcript. It just no longer has an opinion about labels.
 */

/**
 * The Changes tab's quiet count — the ONE thing 092 §2 lets that feature put on the strip.
 *
 * ⚠️ **A file changing is not a question**, so this is not an attention trace and is deliberately
 * not in {@link attentionTraces} either: 063/080 built five traces for *"something is waiting on
 * you"*, and a diff is never that. It is `--muted`, never amber, never animated, and it is
 * `null` — absent, not `0` — when nothing has changed (081's rule).
 */
const changed = computed(() => tabCount(changeSet(props.state)))

/**
 * 🔴 **The Work tab's quiet count — the ONE thing 508 lets that tab put on the strip** (092 §2's
 * rule, inherited one tab over).
 *
 * ⚠️ **Work being open is not a question**, so this is not an attention trace and is deliberately
 * not in {@link attentionTraces}: 063/080 built five traces for *"something is waiting on you"*,
 * and a piece of work an agent is getting on with is never that. It is `--muted`, never amber,
 * never animated, and it is **absent, not `0`**, when nothing is open — `081`'s rule, and the
 * fourth rule of `scheduled-work.ts` read on a strip that has no room for a caveat.
 *
 * ⛔ **Read off the fold and not recomputed here** — see `WorkGivenOutView.openCount`.
 */
/**
 * ⛔ **The fold, read ONCE for the two things the drawer itself asks of it** (508) — the tally on
 * the strip and the boolean the Open tab reads.
 *
 * ⚑ **The READING's own instant, and it costs nothing here.** Neither answer this component takes
 * off the view has an age in it — {@link WorkGivenOutView.openCount} and `rows.length` — and the
 * TAB BODY runs its own minute clock for the ages it draws. ⛔ A clock on the strip would re-render
 * seven buttons a minute to change nothing.
 *
 * ⚠️ **`reading.at` and not `0`, and the first draft was `0`.** Every age the fold computes is
 * `now - at`, so a zero instant makes them all negative — `agoWords` floors at `0s ago`, so nothing
 * throws and nothing is drawn, which is exactly the kind of value that is wrong for a year. ⚑ Read
 * *as of the read*, the ages this component discards are at least true.
 *
 * ⚠️ **`SessionWork` folds again rather than being handed this**, and that is deliberate: the two
 * calls are pure over the same reading, so they cannot disagree, and the tab body is then testable
 * with no drawer around it. ⛔ What must never be duplicated is the WORDS, and those are
 * `work-given-out.ts`'s either way.
 */
const workView = computed(() =>
  workGivenOutView({
    reading: props.work,
    forConversation: props.session.sessionId,
    identities: props.identities,
    now: props.work?.at ?? 0,
  }),
)

/**
 * 🔴 **537 · WHO this conversation is, for the plate at the top of the Open tab.**
 *
 * ⛔ **It was `session.provider`, so the plate read `claude`** while the rail row, the PROFILE
 * field and the AGENTS list eight rows below it all read `project-manager` — the second of the two
 * surfaces `537` corrects, and the same correction. ⚑ {@link agentName} is the app's one naming
 * function (`449`) and this component already holds the roster it needs, for the Work tab.
 *
 * ⚠️ **No null to fold here.** This drawer is mounted only behind `props.record.meta`, so unlike
 * `ConversationPane.who` there is no un-answered record to name — and the provider stays legible
 * on this same screen in `SessionHeader`'s chip.
 */
// ⚑ **667 · in the one spelling** the pane that mounts this drawer uses — `agentName`'s own fold
// since `671`.
// ⚑ **D-017b · {@link whoIsIn}** — a conversation this app ran as nobody is its provider's.
const who = computed(() => whoIsIn(props.session, props.identities))

/**
 * 🔴 **547 · who called whom — the window's one answer, read here rather than handed down.**
 *
 * ⛔ **Every other reading this drawer draws arrives as a PROP**, and this one would too if it
 * could: the poll is `RuntimeScreen`'s, beside the queue's, the digest's, the roster's and the Work
 * tab's. ⚠️ **What is missing is the hop.** `ConversationPane.vue` is the only file between that
 * screen and this component, and `547` §1.1 puts it out of bounds while `545` is in flight on the
 * rows inside it — so the value travels through a window-level ref instead of through three lines
 * of that file. ⚑ **547 F5**, and it is a transport rather than a second authority: nothing here
 * asks anybody anything.
 *
 * ⚠️ **`goTo` is `null` in every render test**, because no screen mounted the drawer — so the band
 * draws its cards and offers no press, which is `118`'s rule rather than a test affordance.
 */
const cast = useWhoCalledWhom()

/**
 * ⚑ **UI-002 · the files of the agent the card draws** — the screen reads them for the conversation
 * on screen, the selected agent (`TheCast.cardFiles`). ⛔ Only while they are ITS files: a read
 * taken for the last one, or not taken yet, draws nothing.
 */
const cardFilesRead = computed(() => {
  const read = cast.cardFiles.value
  return read !== null && read.conversation === props.session.sessionId ? read : null
})

const working = computed(() => workView.value?.openCount ?? null)

const waitingLabel = computed(() =>
  props.waiting === 1 ? '1 waiting on you' : `${props.waiting} waiting on you`,
)

/** Ids that pair each tab with the one panel, minted per mount so two drawers never share one. */
const idBase = useId()
const panelId = `${idBase}-panel`
const tabDomId = (id: DrawerTab): string => `${idBase}-tab-${id}`

/** The tab that holds the strip's one Tab stop: the selected one, or the first when it is hidden. */
const stop = computed<DrawerTab | null>(
  () => tabs.value.find((entry) => entry.id === props.tab)?.id ?? tabs.value[0]?.id ?? null,
)

/** What a person hears for a tab: its name, plus the count or the waiting mark drawn on it. */
function tabName(id: DrawerTab, label: string): string {
  if (id === 'open' && traces.value.tabDot) return `${label}, waiting on you`
  if (id === 'changes' && changed.value) {
    return `${label}, ${changed.value} ${changed.value === 1 ? 'file' : 'files'}`
  }
  if (id === 'work' && working.value) return `${label}, ${working.value} open`
  return label
}

const strip = ref<HTMLElement | null>(null)

/**
 * The tab an arrow, Home or End key moves to, with focus moved to it; `null` for any other key.
 * The template raises the change, so only a person's gesture ever selects a tab.
 */
function steer(event: KeyboardEvent, at: number): DrawerTab | null {
  const last = tabs.value.length - 1
  const to =
    event.key === 'ArrowRight'
      ? at === last
        ? 0
        : at + 1
      : event.key === 'ArrowLeft'
        ? at === 0
          ? last
          : at - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : -1
  const next = tabs.value[to]
  if (!next) return null
  event.preventDefault()
  strip.value?.querySelector<HTMLElement>(`[data-cy="drawer-tab-${next.id}"]`)?.focus()
  return next.id
}
</script>

<template>
  <!-- The scrim, and only when the drawer is FLOATING. Docked, this is a column with the transcript
       beside it and there is nothing to dim; floating, it is over running text, and a panel with
       nothing behind it to dim reads as a rendering fault rather than as a layer.
       A sibling of the panel rather than a child so it can sit UNDER it, and rendered here rather
       than by the pane because it is the drawer's own behaviour — the pane should not have to know
       that this column sometimes stops being one. -->
  <div v-if="props.fit === 'overlay'" class="drawer-scrim" aria-hidden="true"></div>

  <aside
    class="session-drawer"
    :class="[`fit-${props.fit}`]"
    data-cy="session-drawer"
    :data-tab="props.tab"
    :data-fit="props.fit"
    :data-waiting="props.waiting"
  >
    <!-- One row, never scrolling, never spilling into a "more" menu — a tab behind an overflow is
         an attention signal you cannot see. Only the ACTIVE tab carries its label (088), which is
         what keeps all six on one row at every width without anything having to decide. -->
    <div ref="strip" class="drawer-tabs" role="tablist" data-cy="drawer-tabs">
      <button
        v-for="(entry, at) in tabs"
        :key="entry.id"
        class="tab"
        :class="{ active: props.tab === entry.id }"
        type="button"
        role="tab"
        :id="tabDomId(entry.id)"
        :aria-selected="props.tab === entry.id"
        :aria-controls="panelId"
        :aria-label="tabName(entry.id, entry.label)"
        :tabindex="stop === entry.id ? 0 : -1"
        :data-cy="`drawer-tab-${entry.id}`"
        :data-active="props.tab === entry.id"
        :title="entry.hint"
        @click="emit('update:tab', entry.id)"
        @keydown="
          (event: KeyboardEvent) => {
            const next = steer(event, at)
            if (next) emit('update:tab', next)
          }
        "
      >
        <svg class="icon"><use :href="entry.icon" /></svg>
        <!-- The active tab alone has a label; brighter `.tab.active` ink reinforces that marker. An underline would repeat the same state. -->
        <span v-if="props.tab === entry.id" class="tab-label">{{ entry.label }}</span>
        <!-- The dot rides the ICON, and since 088 that is not a precaution but the ordinary case:
             five of the six tabs have no label at all, so a label-borne signal would be invisible
             on every tab except the one you are already looking at. -->
        <span
          v-if="entry.id === 'open' && traces.tabDot"
          class="tab-attn"
          data-cy="drawer-tab-attention"
          aria-hidden="true"
        ></span>
        <!-- ⚠️ **The maximum the Changes tab may put on the strip** (092 §2): a `--muted` count of
             touched files on its OWN icon. Inline after the label when this tab is active, a corner
             badge on `#i-diff` otherwise — which is the whole point, since 088 made every non-active
             tab icon-only, so the count has to ride the icon to survive. Absent, never `0`. -->
        <span
          v-if="entry.id === 'changes' && changed"
          class="tab-count"
          data-cy="drawer-tab-count"
          aria-hidden="true"
          >{{ changed }}</span
        >

        <!-- ⚠️ **The maximum the Work tab may put on the strip** (508 §2, inheriting 092 and 086):
             a `--muted` count of OPEN work on its OWN icon, and nothing else. It may not light the
             drawer toggle badge, raise the attention bar, dot any tab, animate, or touch the top
             bar. Absent, never `0`.
             ⛔ **Its own hook, and not `drawer-tab-count`.** That one is the Changes tab's and four
             instruments address it; a second element wearing it would make every one of them read
             whichever tab the query found first. -->
        <span
          v-if="entry.id === 'work' && working"
          class="tab-count"
          data-cy="drawer-tab-work-count"
          aria-hidden="true"
          >{{ working }}</span
        >
      </button>

      <!-- Reserved (078). Dimmed and disabled: the strip that gets laid out is the six-tab one. -->
      <button
        v-for="slot in reserved"
        :key="slot.id"
        class="tab reserved"
        type="button"
        disabled
        :data-cy="`drawer-tab-${slot.id}`"
        :title="`${slot.label} — ${slot.hint}. Reserved; not built yet.`"
      >
        <svg class="icon"><use :href="slot.icon" /></svg>
      </button>
    </div>

    <!-- A waiting card is never MERELY a dot. On any tab that is not where it lives, the drawer
         says what is waiting and offers one click to it — and never moves you there itself. -->
    <div v-if="traces.crossTab" class="attn-bar" data-cy="drawer-attention-bar">
      <svg class="icon"><use href="#i-alert" /></svg>
      <span>{{ waitingLabel }}</span>
      <button
        type="button"
        class="jump"
        data-cy="drawer-show-open"
        @click="emit('update:tab', 'open')"
      >
        Show in Open
        <svg class="icon arrow"><use href="#i-arrow" /></svg>
      </button>
    </div>

    <div
      :id="panelId"
      class="drawer-body"
      role="tabpanel"
      :aria-labelledby="stop ? tabDomId(stop) : undefined"
    >
      <SessionPanel
        v-if="props.tab === 'open'"
        :state="props.state"
        :shown="props.shown"
        :mode="props.mode"
        :facets="props.facets"
        :agent-state="props.agentState"
        :provider-limit="props.providerLimit"
        :named="props.named ?? null"
        :who="who"
        :profile="profileItRunsAs(props.session)"
        :session="props.session"
        :pick-model="props.pickModel"
        :capabilities="props.capabilities"
        :fixed="props.fixed"
        :recorded="props.recorded"
        :on-reveal-path="props.onRevealPath"
        :cast="cast.reading.value"
        :conversation="props.session.sessionId"
        :identities="props.identities"
        :can-open-conversation="cast.goTo.value !== null"
        :can-stop-background-work="props.canStopBackgroundWork ?? false"
        :on-stop-background-work="props.onStopBackgroundWork"
        @navigate="(itemId) => emit('navigate', itemId)"
        @open-asset="(asset) => emit('openAsset', asset)"
        :files="cardFilesRead?.files"
        :files-stale="cardFilesRead !== null && !cardFilesRead.answered"
        :can-open-document="props.canOpenDocument ?? false"
        can-open-inputs
        :compact-capability="
          props.capabilities?.[props.session.provider]?.requestCompaction ?? null
        "
        :compaction="props.compaction ?? null"
        :sign-in-capability="props.capabilities?.[props.session.provider]?.signIn ?? null"
        :reprovision-capability="
          props.capabilities?.[props.session.provider]?.reprovisionAuth ?? null
        "
        @compact-now="(intent) => emit('compactNow', intent)"
        @open-conversation="(conversation) => cast.goTo.value?.(conversation)"
        @open-document="(resourceId) => emit('openDocument', resourceId)"
        @open-inputs="emit('openInputs')"
        @set-approval-mode="(mode) => emit('setApprovalMode', mode)"
        @set-session-setting="(body) => emit('setSessionSetting', body)"
      />

      <!-- 🔴 **The work this conversation gave out** (508). ⛔ **Mounted only when its tab is
           selected**, like every other body in this drawer: the reading is polled by
           `RuntimeScreen` either way, so what lazy mounting saves here is the rendering rather than
           the read — and what it BUYS is that the tab's minute clock only ticks while somebody is
           looking at it. -->
      <SessionWork
        v-else-if="props.tab === 'work'"
        :conversation="props.session.sessionId"
        :reading="props.work"
        :identities="props.identities"
      />

      <!-- ⛔ **KEYED by conversation** (292 §4, from `288` M2). This drawer is reused when the
           active conversation changes — `RuntimeScreen` renders `ConversationPane` without a
           session key — so `EventStream` kept A's scroll offset, A's released follow, and A's
           virtualized slice indices for B. ⚠️ **The follow is the one that costs something**: a
           person who scrolled up in A and then opened B watched B's new events stop arriving at the
           bottom without ever having released follow in B, and `useStickToBottom` closes over a
           plain `let stuck` with no way to reset it.
           ⚑ **Keyed rather than reset field by field**, because "what has to be forgotten" is every
           piece of state in that component and its composable — the offset, `first`/`last`, the
           measured row height and `stuck` — and a list of four is a list that grows one short. A
           rebuild is what the pane already does to the composer, for the same class of reason. -->
      <EventStream
        v-else-if="props.tab === 'events' && !(props.hiddenTabs ?? []).includes('events')"
        :key="props.session.sessionId"
        :window="props.window"
      />

      <!-- What the agent did to the working tree (096). `state` is the control projection for the
           same reason the Context popup takes it: this is a statement about the session as it is, not
           about where the reader has scrolled. `capability` supplies the deferred foot's reason and
           never enables it — see `SessionChanges.vue`. -->
      <SessionChanges
        v-else-if="props.tab === 'changes'"
        :state="props.state"
        :capability="props.capabilities?.[props.session.provider]?.rewind ?? null"
      />

      <SessionInfo
        v-else
        :session="props.session"
        :session-ref="props.sessionRef"
        :on-reveal-path="props.onRevealPath"
        :on-read-config-file="props.onReadConfigFile"
        :kept="kept"
        :identities="props.identities"
        @refresh-config="emit('refreshConfig')"
        @open-instructions="emit('openInstructions')"
      />
    </div>
  </aside>
</template>

<style scoped>
.drawer-scrim {
  position: absolute;
  z-index: 5;
  background: var(--overlay-backdrop);
  inset: 0;
}

.session-drawer {
  display: flex;
  /* ⚑ W4.183 · it fills its track: the agent card inside sizes against it (an inline-size
     container), so the drawer cannot take its width from its content. */
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: var(--border-width) solid var(--line);
  background-color: var(--drawer-panel-bg-color, var(--drawer-bg));
  background-image: var(--drawer-panel-bg-image, none);
  background-position: var(--drawer-panel-bg-position, 0% 0%);
  background-repeat: var(--drawer-panel-bg-repeat, repeat);
  background-size: var(--drawer-panel-bg-size, auto);
  image-rendering: var(--drawer-panel-bg-rendering, auto);
}

.session-drawer > * {
  image-rendering: auto;
}

/* The breaking point (079 §4): rather than take the transcript below its floor, the drawer stops
   being a column and floats. Opaque, because a translucent panel over running text is unreadable;
   the scrim is the pane's, so the transcript keeps its full width underneath. A theme's panel
   colour may let what is under it through, so the panel stands on the page's own colours — the
   conversation's background over its paper — and never on the transcript it floats over. */
.session-drawer.fit-overlay {
  position: absolute;
  z-index: 6;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(var(--drawer-w-min), 100%);
  background-color: var(--chat-bg);
  background-image:
    var(--drawer-panel-bg-image, none),
    linear-gradient(
      var(--drawer-panel-bg-color, var(--drawer-solid)),
      var(--drawer-panel-bg-color, var(--drawer-solid))
    ),
    linear-gradient(
      var(--conversation-bg-color, transparent),
      var(--conversation-bg-color, transparent)
    );
  background-origin: padding-box, border-box, border-box;
  background-position:
    var(--drawer-panel-bg-position, 0% 0%),
    0 0,
    0 0;
  background-repeat: var(--drawer-panel-bg-repeat, repeat), no-repeat, no-repeat;
  background-size:
    var(--drawer-panel-bg-size, auto),
    100% 100%,
    100% 100%;
  box-shadow: var(--shadow);
}

.drawer-tabs {
  display: flex;
  height: var(--tab-h);
  flex: 0 0 auto;
  align-items: stretch;
  padding: 0 var(--space-4);
  border-bottom: var(--border-width) solid var(--line);
  background-color: var(--drawer-tabs-bg-color, var(--wash-1));
  background-image: var(--drawer-tabs-bg-image, none);
  background-position: var(--drawer-tabs-bg-position, 0% 0%);
  background-repeat: var(--drawer-tabs-bg-repeat, repeat);
  background-size: var(--drawer-tabs-bg-size, auto);
  image-rendering: var(--drawer-tabs-bg-rendering, auto);
  gap: var(--space-1);
}

.drawer-tabs > * {
  image-rendering: auto;
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-5);
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  gap: var(--space-4);
  white-space: nowrap;
}

.tab:hover:not(:disabled) {
  color: var(--text-soft);
}

/*
 * Mark the active tab with its visible label, full text color and bold weight. No underline or reserved underline border is needed.
 */
.tab.active {
  color: var(--text);
  font-weight: var(--fw-bold);
}

.tab .icon {
  width: 15px;
  height: 15px;
}

.tab:disabled {
  color: var(--faint);
  opacity: 0.5;
}

.tab.reserved {
  padding: 0 var(--space-4);
}

.tab-attn {
  position: absolute;
  top: 7px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--waiting);
  /* A ring in the raised-fill token, so the dot reads as sitting ON the tab rather than merging
     with the glyph behind it. `--panel-2` because it is opaque in BOTH themes — the tab strip's own
     `--wash-1` is translucent and would let the icon show straight through the ring. */
  box-shadow: 0 0 0 2px var(--panel-2); /* raw: ring that separates a dot from what is under it */
}

/*
 * The Changes count (092 §2). `--muted` on a neutral chip, never `--waiting`: this is a tally, and
 * the amber attention channel stays the attention channel's alone. On the ACTIVE tab it sits inline after the label; on any other it is a
 * corner badge on the icon, because 088 left non-active tabs with no label to sit after.
 */
.tab-count {
  position: absolute;
  top: 3px;
  right: 2px;
  display: inline-flex;
  min-width: 14px;
  height: 13px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--drawer-bg);
  color: var(--muted);
  font: var(--fw-bold) var(--type-caption) / 1 var(--font-mono);
}

.tab.active .tab-count {
  position: static;
  margin-left: 1px;
  background: var(--wash-2);
}

.attn-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border-bottom: var(--border-width) solid var(--waiting-card-line);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-4);
}

.attn-bar .icon {
  width: 14px;
  height: 14px;
  color: var(--waiting);
}

.jump {
  display: inline-flex;
  height: 22px;
  align-items: center;
  margin-left: auto;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
}

.jump:hover {
  background: var(--waiting-card-line);
}

.jump .arrow {
  width: 11px;
  height: 11px;
}

.drawer-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}
</style>
