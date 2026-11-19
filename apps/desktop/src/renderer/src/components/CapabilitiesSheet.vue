<script setup lang="ts">
import SheetShell from './SheetShell.vue'
import type { AgentModelChoice as HeldModelChoice } from '../../../shared/model-choice-contracts'

import { computed, ref, watch } from 'vue'
import { RULE_WRITING_POLICY, SPAWN_RAIL_MEANS } from '../../../shared/capabilities'
import {
  EXTERNAL_MCP_EVERYONES,
  EXTERNAL_MCP_REACH_IS_FIXED,
  EXTERNAL_MCP_TAKES_EFFECT,
} from '../../../shared/external-mcp'
import type {
  AgentIdentity,
  CapabilityStatus,
  Provider,
  ProviderCapabilityMap,
} from '../../../shared/runtime-ipc'
import { PROVIDER_NAME, agentName } from '../../../shared/runtime-ipc'
import { identityIn, runsOnIn, type AgentStore } from '../lib/agent-store'
import { calendarDay } from '../lib/clock'
import {
  whatAProviderPressWouldClear,
  whatTheProviderPressCleared,
} from '../lib/agent-model-choice'

import type { ModelLists } from '../lib/model-lists'
import {
  aProviderNotChosenSays,
  noProviderSavedSays,
  providerTakesEffectNextTime,
  providerNamesIn,
} from '../lib/front-door-words'
import { useClientProviders } from '../client-provider/injection'
import { useProviderNames } from '../composables/useProviderNames'
import { WHERE_AGENTS_ARE_CREATED } from '../lib/where-agents-are-created'
import { spawnSafetyView } from '../lib/spawn-safety'
import { useAgentStore } from '../composables/useAgentStore'
import OwnInstructions from './OwnInstructions.vue'
import AgentModelChoice from './AgentModelChoice.vue'

/**
 * One agent identity's sheet: its provider, its standing rules and model choice, and which
 * restricted external MCP servers it may use. Standing rules follow one fixed policy, shown here.
 */
const props = withDefaults(
  defineProps<{
    profileSlug: string
    /**
     * 🔴 **What a conversation a PERSON starts as this identity WOULD run on today** (433) —
     * resolved by the screen, never by this sheet. ⚠️ **696 · a person's**: an agent-started launch
     * resolves differently (`admitGive`'s order; a model choice in force holds its provider).
     *
     * ⛔ **A prop and not a computation here, because there must be ONE derivation of it.**
     * `RuntimeScreen.providerForAgent` already answers this for the second launch door, over
     * `providerForALaunch(identities, slug, DEFAULT_PROVIDER)`; a sheet that re-derived it would be
     * a third reader of the app's fallback and the two surfaces could then disagree about what
     * *nobody has said* resolves to. ⚑ `433` relay 1 asks for exactly this: *"one derivation, or the
     * two doors drift"*.
     *
     * ⚠️ **It is the RESOLVED answer and not the column.** The column can say *nobody has said*,
     * which is not a thing to print in a sentence about what will happen — see
     * {@link providerTakesEffectNextTime}.
     */
    runsOn: Provider
    /**
     * 🔴 **516 · what each provider declares it can do** — the map the screen already holds.
     *
     * ⛔ **A capability declaration and NEVER a provider name.** `039`'s rule, which
     * `provider-neutrality.test.ts` enforces on every file the renderer can reach: *"the renderer
     * must not branch on which provider a session is running. It asks what the session SUPPORTS."*
     * ⚑ `RuntimeHost.externalMcpContext` reads the same entry, so the control a person meets and
     * the launch they then make cannot disagree.
     *
     * ⚠️ **Null until the read lands, and null is HELD BACK** — see {@link externalMcpHeldBack}:
     * *we have not asked what this provider supports* is not *it is supported*.
     */
    capabilities?: ProviderCapabilityMap | null
    /** Injectable for tests; the window's one store otherwise. */
    store?: AgentStore
    /** ⚑ **UI-012** — injectable for tests; the window's one holder of the model lists otherwise. */
    lists?: ModelLists
  }>(),
  {
    store: undefined,
    lists: undefined,
    capabilities: null,
  },
)

const emit = defineEmits<{
  close: []
  /**
   * 🔴 **Open a conversation AS this identity** (423 relay 1) — the screen owns the overlay layer,
   * so it owns this too.
   *
   * ⛔ **Here rather than on the rail's row**, and the reason is markup: an agent row IS a
   * `<button>`, so a second control inside it would be a button inside a button. ⚑ This sheet is
   * the identity's own surface, it is already reached from the Agents section in one press, and it
   * already names the identity the conversation would open as.
   */
  startConversation: [profileSlug: string]
}>()

const store = props.store ?? useAgentStore()
/**
 * ⚑ **678 · the switch, by the words ON it** — `spawnSafetyView`'s own heading for *off*, the one
 * derivation both surfaces that draw the switch ask (`390` §2), so this sentence cannot name it
 * differently from the control it sends a person to.
 */
const switchIsCalled = computed(() => spawnSafetyView(store.identities.value, false)?.heading ?? '')

/**
 * 🔴 **712 · R41 (`707` GAP-5) — the identity this sheet is about, NAMED** (`agentName`, over the
 * roster this sheet already reads). ⛔ The title was `displayName ?? slug` — an inline copy of the
 * rule that parts from `agentName` on BroBot's slug with no display name (`profileLabel`) — and four
 * sentences below printed the slug bare. ⚑ The slug stays where it is the KEY: the *Slug* row, *no
 * agent identity called*, and the
 * glyph (`538`/`584`: one derivation, two sheets).
 */
const called = computed(() =>
  agentName(props.profileSlug, store.identities.value?.identities ?? null),
)

/** ⛔ The identity this sheet was OPENED for, or null — 339's rule, and for its reason. */
/** The provider this agent runs on and what says so, as the host resolves it. */
const runsOnNow = computed(() => runsOnIn(store.identities.value, props.profileSlug))

const identity = computed<AgentIdentity | null>(() =>
  identityIn(store.identities.value, props.profileSlug),
)
const isService = computed(
  () => store.identities.value?.services?.includes(props.profileSlug) === true,
)

/**
 * ⚠️ **Declared above the watch, because the watch clears one of them on its immediate run** — a
 * `const` read before its initialiser is a TDZ error and the sheet renders nothing at all. Found by
 * `capabilities-sheet.dom.test.ts` on its first run, which is what a real engine is for.
 */
const saving = ref(false)
/** The refusal the last save came back with, or null. Cleared when anything is edited. */
const saveRefusal = ref<string | null>(null)
/**
 * 🔴 **What the control SHOWS, held locally — because the row does not move until the write lands.**
 *
 * ⛔ **Bound straight to `identity.provider` it visibly snapped back.** `choosingProvider` is set
 * before the `await`, so Vue re-renders while the IPC is still in flight; and Vue force-patches a
 * `<select>`'s `value` on every update — `value` is the one property it never skips when the new
 * value equals the old DOM one. ⚠️ So the disabled control showed the PREVIOUS provider for the
 * whole round trip and then jumped, which reads as *my change was rejected* at the exact moment a
 * person is waiting to learn whether it was. Found in this dispatch's own review.
 *
 * ⚑ **It follows the row when the row changes**, which is how a refusal puts it back: `save`'s
 * re-read replaces the identity, the watch below re-seeds this, and a write that never landed
 * leaves the old word on screen because that is what the database still says.
 */
const shownProvider = ref<string>('')

function touched(): void {
  saveRefusal.value = null
}

/**
 * 🔴 **516 · which registered external servers this identity is GRANTED, as the sheet holds them.**
 *
 * ⛔ **A plain array of ids and NOT a `set`/`value` pair like the capability fields.** Those two refs
 * exist because a capability column can be NULL — *nobody has chosen* — and the sheet has to tell
 * that from a value. ⚑ A grant here has no such state: **row presence IS the grant** (`HO-042` §6),
 * so there are exactly two answers per server and one ref says both.
 *
 * ⚠️ **Seeded by the same watch the controls are**, so a save that answers a fresh row re-seeds this
 * too and an edit made while the row is on screen is not overwritten under the person's cursor.
 */
const grantedServers = ref<string[]>([])

/** Every registered server, as the last read answered it — the list this block draws. */
const registry = computed(() => store.identities.value?.externalMcpServers ?? [])

/**
 * 🔴 **524 · the servers this identity may use WITHOUT a grant** (`HO-048` §1).
 *
 * ⛔ **Drawn, and not as a ticked box.** A checked control a person cannot uncheck is a control that
 * lies about what it is; a row here is not a grant and there is nothing on it to change. ⚠️ **And
 * not hidden either** — a sheet listing only the tickable servers would under-report what this
 * identity may use, which is the one thing this block exists to say.
 *
 * ⚑ **It reads `reach` and never recomputes it.** The word arrives folded from the store, so a row
 * this build cannot read has already become `'restricted'` before it reaches this line — and a
 * restricted row draws a tick-box, which is the narrow direction.
 */
const everyonesServers = computed(() => registry.value.filter((one) => one.reach === 'everyone'))

/**
 * ⛔ **The ones a person actually chooses on this sheet** — `516`'s grant table, unelaborated
 * (`HO-048` §1.1). ⚠️ Nobody has needed one yet, so this list is normally empty and the block above
 * it is the whole of what this identity may use.
 */
const grantableServers = computed(() => registry.value.filter((one) => one.reach !== 'everyone'))

/**
 * 🔴 **How many servers this identity may use — counted off the ROWS, never off the two lengths.**
 *
 * ⛔ **`everyonesServers.length + grantedServers.length` is the wrong sum and `0033` is why.** The
 * migration backfilled every server registered under `516` to `'everyone'`, and the identities that
 * had been GRANTED one still carry its id — so that expression counts a server twice, and the number
 * disagrees with the list drawn underneath it. ⚑ **A stale grant row is not a defect** (a person did
 * grant it, and `save` sends it back unchanged), which is exactly why the count has to be derived
 * from what is drawn rather than from what is held.
 */
const usableCount = computed(
  () =>
    everyonesServers.value.length +
    grantableServers.value.filter((one) => grantedServers.value.includes(one.id)).length,
)

/**
 * ⛔ **516 · what the provider this identity would start on declares about external servers**
 * (`HO-090` §1, `HO-037` §1 — ⚠️ **`HO-042` §3 stood here until `605` withdrew it**).
 *
 * ⚑ **Indexed by {@link runsOn}, which is the RESOLVED provider the screen already derives** — not
 * by `identity.provider`, which can say *nobody has said*. `433` ruled there must be one derivation
 * of *what would this identity start on today*, and a sheet that re-derived it could disagree with
 * the launch door beside it.
 *
 * ⛔ **No provider is NAMED here.** `039`'s rule: the renderer asks what the session supports.
 */
const externalMcpStatus = computed<CapabilityStatus | null>(
  () => props.capabilities?.[props.runsOn]?.externalMcpServers ?? null,
)

/**
 * ⛔ **Anything but `available` holds the control back — including *we have not asked yet***.
 *
 * ⚠️ **Fail closed, and null is the third state.** A sheet that treated an unread capability map as
 * permission would offer a grant it cannot say anything about, which is the *"nothing unwired
 * implies a working state"* rule (acceptance #7) on a control that writes.
 *
 * ⚑ **It disables the controls and destroys nothing.** The grants an identity already holds stay on
 * the row and are sent back unchanged by {@link save} — a person who granted while this identity ran
 * on a provider that supports it has not lost anything by moving it, and moving it back returns the
 * grant. That is `HO-037` §1's *tell, don't clamp*: it withholds nothing they could otherwise have.
 */
const externalMcpIsHeldBack = computed(() => externalMcpStatus.value?.state !== 'available')

/**
 * 🔴 **524 · why the block is answering for a provider nobody chose** (`HO-048` §3).
 *
 * ⛔ **The PO asked whether resolving the EFFECTIVE provider is cheap. It was already done** —
 * {@link runsOn} is `providerForALaunch(identities, slug, DEFAULT_PROVIDER)` and has been since
 * `433`, so this block has never asked *what does this identity's provider support*. ⚠️ **What the
 * measurement found instead was that resolving it did not make the held-back state disappear**:
 * the app's own fallback was, then, the provider whose `externalMcpServers` entry was `unwired`,
 * so an identity that had chosen nothing resolved to it and was held back with ITS sentence.
 *
 * 🔴 **`605` moved that entry to `available`, so the fallback no longer produces a held-back
 * state.** ⛔ **The paragraph stays and its condition is unchanged**, because what it adds is
 * *which provider answered* — still the question a person who has chosen none has, and still
 * asked whenever anything holds the grant back, including the not-read-yet arm.
 *
 * ⚑ **So what was missing was never the resolution — it was saying that a resolution happened.**
 * *"An inert control with no explanation is the thing that cost him the trip, more than the setting
 * did."* ⛔ This says nothing the row does not carry and names no provider (`039`), and it points at
 * the control that already draws the answer rather than restating it.
 *
 * ⚠️ **Null when the identity HAS chosen**, because then there is no resolution to explain — the
 * reason beside it is about a provider a person picked.
 */
const externalMcpAnswersForTheFallback = computed<string | null>(() =>
  externalMcpIsHeldBack.value && identity.value !== null && runsOnNow.value?.provider == null
    ? 'This identity has not said which provider to start on, so this answers for the one BroCrew ' +
      'falls back to — Runs on, above, names it.'
    : null,
)

/** The provider's OWN sentence for why — never one this file composed (`423` §2). */
const externalMcpHeldBackBecause = computed<string | null>(() => {
  const held = externalMcpStatus.value
  if (held === null) {
    return 'BroCrew has not read what this provider supports yet, so this grant is held back rather than offered as one that might do nothing.'
  }
  return held.state === 'available' ? null : held.reason
})

function toggleServer(serverId: string, on: boolean): void {
  const held = new Set(grantedServers.value)
  if (on) held.add(serverId)
  else held.delete(serverId)
  grantedServers.value = [...held].sort()
  touched()
}

/**
 * ⚠️ **Fill from the row, and DO NOT re-fill while it is being edited.** The watch keys on the row's identity, not its contents: a save answers a fresh object, and a watch
 * on the object would reset the controls under the person's cursor every time anything wrote.
 */
watch(
  () => identity.value?.id ?? null,
  () => {
    const row = identity.value
    // ⚑ 433 · what the provider control shows, re-seeded from the row every time it changes.
    shownProvider.value = row?.provider ?? ''
    // ⚑ 516 · and the servers this identity holds, from the same row in the same pass.
    grantedServers.value = [...(row?.externalMcpServerIds ?? [])].sort()
    saveRefusal.value = null
  },
  { immediate: true },
)

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  const submitted = grantedServers.value
  saveRefusal.value = await store.saveExternalMcpServers(props.profileSlug, submitted)
  saving.value = false
  // ⛔ **Closes only on success**: a sheet that closed over a refusal would take the sentence away
  // with it, and the sentence is the only place the reason is named.
  if (saveRefusal.value !== null) return
  const current = grantedServers.value
  // Keep any unsaved selection visible for the next save.
  if (current.length !== submitted.length || current.some((id, index) => id !== submitted[index]))
    return
  emit('close')
}

/* ------------------------------------------------------- what it runs on, which is not a rail */

/** Provider values stay in their existing order; names come from the selected catalogue. */
const providers = computed<Provider[]>(() => Object.keys(PROVIDER_NAME) as Provider[])
const nameOf = useProviderNames(useClientProviders())
const names = computed(() => providerNamesIn(nameOf))

/** In flight, so a second change cannot race the first — {@link saving}'s shape, one gesture over. */
const choosingProvider = ref(false)

/** The refusal the last provider change came back with, or null. */
const providerRefusal = ref<string | null>(null)
/** Keep the door's cleared choice so its notice follows the current supplied names. */
const providerCleared = ref<{ choice: HeldModelChoice; nowOn: Provider } | null>(null)

/**
 * 🔴 **712 · R56 — the model choice the control below HOLDS, as it last said** (`AgentModelChoice`'s
 * `held`), or `undefined` before it has said: *not known*, which draws nothing.
 *
 * ⚑ **Its read, not a second one** (R56, on `696` L2: *"The held choice lives in `AgentModelChoice`;
 * read it there."*), so the sentence above the model and the model itself cannot name two choices. ⛔ Forgotten
 * when the sheet is pointed at another identity, so one agent's choice is never warned about on
 * another's row.
 */
const heldChoice = ref<HeldModelChoice | null | undefined>(undefined)
watch(
  () => props.profileSlug,
  () => (heldChoice.value = undefined),
)
/** ⚑ **712 · R56 — what a press would clear, said before it** — see {@link whatAProviderPressWouldClear}. */
const providerWillClear = computed(() =>
  heldChoice.value === undefined
    ? null
    : whatAProviderPressWouldClear(heldChoice.value, names.value),
)

/**
 * 🔴 **Its OWN gesture, and deliberately not part of Save** (433).
 *
 * ⛔ **Provider is not a capability** — no rail reads it, `419` §3 — so it is not on
 * {@link CapabilityGrant} and it is not written by {@link save}. ⚠️ **The stronger reason is what a
 * combined Save would have to report**: two commands behind one button can half-succeed, and the
 * sheet would then have to draw a state that is neither saved nor unsaved. ⚑ So this writes on
 * change, answers its own sentence, and the Save button goes on meaning *the capabilities*.
 *
 * ⚠️ **The picked word is FOLDED against the table rather than cast.** An option value this app does
 * not know becomes `null` — *use the app's default* — which is the narrow direction and the value
 * that changes nothing, exactly as `parseProvider` folds one layer down.
 */
async function onProviderChange(event: Event): Promise<void> {
  const picked = (event.target as HTMLSelectElement).value
  const chosen = providers.value.find((one) => one === picked) ?? null
  // ⚑ **The screen follows the gesture immediately**; the row catches up when the write lands, and
  // the watch puts this back to whatever the database says either way.
  shownProvider.value = chosen ?? ''
  choosingProvider.value = true
  providerCleared.value = null
  const answer = await store.chooseProviderFor(props.profileSlug, chosen)
  choosingProvider.value = false
  providerRefusal.value = answer.ok ? null : answer.reason
  // ⚑ **`696` · only a provider can clear a choice** — the door keeps it on a move to *nobody has
  // said* — so `chosen` is a provider whenever `cleared` is set; the guard narrows the type.
  if (answer.ok && answer.cleared !== null && chosen !== null) {
    providerCleared.value = { choice: answer.cleared, nowOn: chosen }
    // ⚑ **712 · the door's answer says nothing is held now** — so the warning goes with the choice
    // at once, rather than one read later beside the line saying it was cleared.
    heldChoice.value = null
  }
  // ⛔ **A refusal puts the control back to what the database says**, because the row did not move
  // and a control left showing a choice that did not take is a surface claiming a write. ⚠️ The
  // watch above cannot do this: it keys on the identity's ID, which does not change when a column
  // does — the *"do not re-fill while it is being edited"* rule above, whose cost is that the one
  // place a re-fill IS wanted has to ask for it.
  if (providerRefusal.value !== null) shownProvider.value = identity.value?.provider ?? ''
}

/** `Mod+Enter` saves, the way every other confirming surface in this app does. */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !saving.value) void save()
}
</script>

<template>
  <SheetShell
    :glyph="profileSlug.slice(0, 1).toUpperCase()"
    style="--sheet-width: 660px; --sheet-body-min-height: auto"
    class="capabilities-sheet"
    data-cy="capabilities-sheet"
    @keydown="onKey"
    @close="emit('close')"
  >
    <template #header>
      <strong data-cy="capabilities-title">{{ called }}</strong>
    </template>

    <template #state>
      <p v-if="!store.loaded.value" class="sheet-state" data-cy="capabilities-loading">
        Reading the agent identities…
      </p>
      <p
        v-else-if="store.loadError.value"
        class="sheet-state err"
        data-cy="capabilities-load-error"
        role="alert"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ store.loadError.value }}</span>
      </p>
      <!-- ⛔ **A profile with no row is a REAL state and this is what the surface does with it** (§4).
         It is not an error and it is not an empty form: there is nothing to configure, because
         `setExternalMcpServers` refuses to create the row that would make it configurable. ⚠️ Opening this
         sheet does not bring one into being. -->
      <!-- ⚠️ **678 · re-worded (rule 8.1).** It said *"…in this project yet. An identity exists once a
         conversation has actually run as it"* — false since `419` (an identity is created with New
         agent, before any conversation) and never scoped to a project — and it named the spawn
         *rails*, a word this app shows a person nowhere else. ⚑ Now `agent-store.ts`' refusal, in
         the same words, rendered from the Team page's own button label. -->
      <p v-else-if="!identity" class="sheet-state" data-cy="capabilities-no-row">
        There is no agent identity called <code>{{ profileSlug }}</code
        >, so there is nothing to configure — opening this sheet does not create one. Create it
        {{ WHERE_AGENTS_ARE_CREATED }}, or one appears once a conversation has run as it.
      </p>
    </template>

    <template v-if="identity && store.loaded.value && !store.loadError.value" #body>
      <div class="identity" data-cy="capabilities-identity">
        <div class="fact">
          <span>Slug</span><strong data-cy="capabilities-slug">{{ identity.slug }}</strong>
        </div>
        <div class="fact">
          <span>Row id</span>
          <strong class="mono" data-cy="capabilities-row-id">{{ identity.id }}</strong>
        </div>
        <div class="fact">
          <span>Exists since</span>
          <strong data-cy="capabilities-created">
            {{ calendarDay(identity.createdAt) }}
          </strong>
        </div>
      </div>

      <!-- 🔴 **What a conversation a person starts as this identity runs on** (433, HO-024 §2.1;
           696 scoped the note to that launch — `providerTakesEffectNextTime`).
           ⛔ **ABOVE the rails and outside them, because it is not one.** Nothing below enforces
           anything about this: no rail reads `provider`, it refuses nothing, and the header's
           *"every rail below"* is a sentence about the controls under `spawn-rail-means`.
           ⚠️ **Its own gesture rather than a field on Save** — see {@link onProviderChange}. -->
      <div class="provider-choice" data-cy="capabilities-provider">
        <label class="provider-row">
          <span>Default provider</span>
          <select
            data-cy="capabilities-provider-select"
            :value="shownProvider"
            :disabled="choosingProvider"
            @change="onProviderChange"
          >
            <!-- ⚑ **`NewAgent`'s own words for the same empty state**, so the door that creates an
                 identity and the door that changes one do not name one fact two ways. -->
            <option value="">{{ noProviderSavedSays(runsOnNow, names) }}</option>
            <option v-for="(each, index) in providers" :key="each" :value="each">
              {{ nameOf(each) ?? `Provider ${index + 1} (name not read)` }}
            </option>
          </select>
        </label>
        <!-- 🔴 **HO-025, through `433` relay 1:** *"changing it means a new conversation, and the
             app should SAY that rather than offer a control that silently relaunches."* ⚑ The
             sentence lives beside `417`'s front-door one, in `front-door-words.ts`, and is rendered
             from the RESOLVED provider so that *nobody has said* is never what a person reads. -->
        <!-- ⚑ An agent whose conversations ran on both, with none saved: no agent can start a
             conversation with it until a person chooses here, so the sheet says so first. -->
        <p
          v-if="runsOnNow?.from === 'its-conversations-differ'"
          class="identity-note not-chosen"
          data-cy="capabilities-provider-not-chosen"
          role="status"
        >
          {{ aProviderNotChosenSays(null, runsOnNow.startedOn, names) }}
        </p>
        <p v-else class="identity-note" data-cy="capabilities-provider-note">
          {{ providerTakesEffectNextTime(props.runsOn, true, isService, names) }}
        </p>
        <!-- 🔴 **712 · R56 — what the press WOULD take, before it** — see `providerWillClear`.
             ⚑ Beside the select it is about, and gone while a press is in flight. -->
        <p
          v-if="providerWillClear && !choosingProvider"
          class="identity-note"
          data-cy="capabilities-provider-will-clear"
        >
          {{ providerWillClear }}
        </p>
        <!-- 🔴 **`696` · what the press took, in the door's answer** — see `providerCleared`. -->
        <p
          v-if="providerCleared"
          class="identity-note"
          data-cy="capabilities-provider-cleared"
          role="status"
        >
          {{ whatTheProviderPressCleared(providerCleared.choice, providerCleared.nowOn, names) }}
        </p>
        <p
          v-if="providerRefusal"
          class="sheet-state err"
          data-cy="capabilities-provider-error"
          role="alert"
        >
          <svg class="icon"><use href="#i-alert" /></svg>
          <span>{{ providerRefusal }}</span>
        </p>
      </div>

      <!-- 🔴 **685 · the model and effort this agent runs on when ANOTHER agent starts it
           — a spawn, or its message** (`677`, `R25`). ⚑ **Beside the provider choice, because a model belongs to a
           provider** (`R25` §1.2) and the menus are the one *Runs on* resolves — ⚠️ or, since
           `696`, a no-provider agent's CHOICE's provider (`theMenusAreFor`). ⛔ **Its own
           component and its own gesture**, for the reason the provider row and `OwnInstructions`
           give: this sheet's Save means *the capabilities*. -->
      <AgentModelChoice
        :profile-slug="profileSlug"
        :runs-on="props.runsOn"
        :its-provider="runsOnNow?.provider ?? null"
        :capabilities="props.capabilities"
        :store="props.store"
        :lists="props.lists"
        :names="names"
        @held="(choice) => (heldChoice = choice)"
      />

      <!-- 🔴 **582 · the `configured` layer's editor** (`HO-063` gap 4, `HO-009` §2.2).
           ⛔ **Its own component with its own gesture**, for the provider choice's reason directly
           above: this sheet has one Save button and a second write behind it could half-succeed.
           ⚠️ **ABOVE the rails and outside them, because it is not one.** Nothing a person writes
           here refuses anything — it is text an agent reads, not a gate — and putting it under
           `spawn-rail-means` would make the header's *"every rail below"* false. -->
      <p class="identity-note" data-cy="rules-fixed-policy">{{ RULE_WRITING_POLICY }}</p>
      <OwnInstructions :profile-slug="profileSlug" :store="props.store" />

      <!-- 🔴 **What granting any of this buys, and where it stops** (368, HO-012 §2).
           ⛔ **ABOVE the first control and not at the foot**, which is `367` §2's rule applied one
           surface along: a person is told what a thing does *before* they choose it, not in a
           footnote under the checkbox they already ticked.
           ⚑ **Here and nowhere else, because this is the only screen where *an agent created it* is
           a certainty rather than an inference** — see {@link SPAWN_RAIL_MEANS} for what the wire
           does and does not carry.
           ⚠️ **`identity-note` and not `note`**: this sheet's `.note` is `display: flex` with an
           icon as its first item, and an alert glyph on this sentence would make a disclosure read
           as an objection — `approval-mode.ts`'s rule, and `367` M18's trap in the same breath. -->
      <p class="identity-note" data-cy="spawn-rail-means">{{ SPAWN_RAIL_MEANS }}</p>

      <!-- ⚠️ **No agent starts a conversation while the switch is off, so the sheet says so** — the
           other grants still apply to conversations already running — and it does
           NOT offer the switch, because the switch is app-wide and is drawn beside this sheet
           already (`SpawnStopLane`, in the overlay) as well as at the foot of the sidebar.
           ⚠️ **678 · *"The switch is in the rail"* named it by a word nothing is labelled** (`110`'s
           finding) — ⚑ it now names the control by the words ON it, `spawn-safety.ts`' off heading,
           ⚠️ and says the second press: turning spawning back ON asks once (`355`), so one press
           alone leaves this sentence true. -->
      <p
        v-if="store.identities.value && !store.identities.value.spawningEnabled"
        class="note err block"
        data-cy="capabilities-spawning-off"
        role="status"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>
          Spawning is switched off for the whole app, so no agent can start a conversation. Press
          “{{ switchIsCalled }}”, then confirm, to switch it back on.
        </span>
      </p>

      <!-- 🔴 **516 · the external MCP servers this identity may use** (HO-040 §4.2, `HO-042` §6).
           ⛔ **Presence is the grant, so there is no *Use the default* here.** A restricted server is
           ticked or it is not; there is no *nobody has chosen* state for a row to be in, which is
           exactly what `HO-042` §6 endorsed — *"no nullable boolean, no role-derived default"*.
           🔴 **524 · and it is now TWO lists, because the answer stopped being one question**
           (`HO-048` §1). ⚠️ **The block used to be entirely tick-boxes and its own heading called it
           a grant**, which was true under the withdrawn model; an available-to-all server is used
           with nothing ticked, so it is drawn above the boxes and carries no control — see
           {@link everyonesServers}. -->
      <div class="field capability" data-cy="capability-external-mcp">
        <span class="lbl">
          May also use these external tool servers
          <!-- 🔴 **524 · it counts what this identity may USE, which is no longer what it was granted.**
            ⛔ `grantedServers.length` alone would have read *None granted* on an identity that can
            call every server in the app, which is the same sentence the withdrawn model made true
            and this ruling makes a lie. ⚑ It counts the drawn rows, so the number and the list
            cannot disagree. -->
          <em class="stored" data-cy="external-mcp-state">
            {{ usableCount === 0 ? 'None' : `${usableCount} usable` }}
          </em>
        </span>

        <!-- 🔴 **524 · the sentence had to move, because it described the withdrawn model** (`HO-048`
             §1). ⛔ It read *"Tick the servers … may call tools on"*, which since this dispatch is
             true of the EXCEPTION and false of the common case: a server registered as everyone's
             has no box and is used all the same. ⚑ Standing rule 19's corollary — a repair that
             changes behaviour a sentence describes corrects the sentence in the same commit. -->
        <p class="identity-note" data-cy="external-mcp-direction">
          A server registered as everyone’s is used by {{ called }} with nothing to tick. Tick a
          restricted one to give {{ called }} that one; it writes {{ called }}’s row and changes
          nothing about any other identity.
        </p>

        <!-- 🔴 **The refusal, drawn with the PROVIDER's own reason** (brief §2).
             ⛔ **The sentence is `HO-037` §1's *tell, don't clamp*** — it withholds nothing a person
             could otherwise have had, because a grant a provider cannot act on would mean BroBot
             saying `ask` and then not asking. ⚠️ **It does not destroy a grant this row already
             holds**: the boxes are disabled, Save sends them back unchanged, and moving the
             identity back returns them.
             ⚑ **The words come from `ProviderCapabilities`**, so this file names no provider and
             the day an entry moves to `available` this block disappears with it — `039`'s whole
             mechanism.
             🔴 **`605` · that day came for Codex, and not one line of this block changed to meet
             it.** Both providers are `available`, so no provider draws this today — ⛔ **and it
             stays, because the state it describes is *any entry that is not available*, which
             still includes the one this sheet meets before the capability read has landed** (see
             {@link externalMcpHeldBackBecause}'s null arm). ⚠️ **The hook is no longer named after
             a provider**, for the reason `039` gives: `external-mcp-not-on-codex` hard-coded a
             verdict into a selector, and three tests keyed off it. -->
        <p
          v-if="externalMcpIsHeldBack"
          class="note err block"
          data-cy="external-mcp-held-back"
          role="status"
        >
          <svg class="icon"><use href="#i-alert" /></svg>
          <span>{{ externalMcpHeldBackBecause }}</span>
        </p>
        <!-- ⚑ **524 · the half `HO-048` §3 said was owed *whichever way it goes*** — see
             {@link externalMcpAnswersForTheFallback}. ⛔ Its own paragraph and NOT appended to the
             provider's sentence: that string belongs to `ProviderCapabilities` and this app does not
             own it, so growing it here would be composing a second refusal (`423` §2). -->
        <p
          v-if="externalMcpAnswersForTheFallback"
          class="identity-note"
          data-cy="external-mcp-answers-for-the-fallback"
        >
          {{ externalMcpAnswersForTheFallback }}
        </p>

        <!-- 🔴 **524 · the servers this identity may use without being granted anything** (`HO-048` §1).
             ⛔ **No `<input>` at all, rather than a ticked one that is `disabled`.** A checkbox is a
             control, and one drawn checked-and-frozen makes a person hunt for the state that would
             unfreeze it; there is no such state, so there is no control. ⚑ `EXTERNAL_MCP_REACH_IS_FIXED`
             below says where the answer does live, which is `106`'s rule for exactly this shape. -->
        <div v-if="everyonesServers.length > 0" class="grants" data-cy="external-mcp-everyones">
          <p
            v-for="server in everyonesServers"
            :key="server.id"
            class="grant reads"
            :data-cy="`external-mcp-everyones-${server.name}`"
          >
            <span>{{ server.name }}</span>
            <em>{{ server.url }}</em>
            <em class="stored">{{ EXTERNAL_MCP_EVERYONES }}</em>
          </p>
          <p class="identity-note" data-cy="external-mcp-reach-fixed">
            {{ EXTERNAL_MCP_REACH_IS_FIXED }}
          </p>
        </div>

        <!-- ⛔ **The narrow half, unelaborated** (`HO-048` §1.1) — `516`'s grant table exactly as it
             shipped, now drawing only the rows a person restricted. ⚠️ Nobody has needed one yet. -->
        <div v-if="grantableServers.length > 0" class="grants" data-cy="external-mcp-grants">
          <label
            v-for="server in grantableServers"
            :key="server.id"
            class="grant"
            :data-cy="`external-mcp-grant-${server.name}`"
          >
            <input
              type="checkbox"
              :checked="grantedServers.includes(server.id)"
              :disabled="externalMcpIsHeldBack"
              @change="toggleServer(server.id, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ server.name }}</span>
            <em>{{ server.url }}</em>
          </label>
        </div>
        <!-- ⛔ **An empty registry is a real state and this is what the surface does with it** — the
             no-row paragraph's rule, one grant over. It is not an error and it is not an empty form:
             there is nothing to tick, and the sentence says where the thing that would fill it
             lives, because *a disabled control must say what would let it* (`106`). -->
        <!-- ⛔ **`v-if` on the WHOLE registry, and it stopped being a `v-else` at 524.** ⚠️ Chained to
             the block above it, this paragraph would have claimed *nothing is registered* whenever
             no server happened to be RESTRICTED — which after this ruling is the normal state.
             ⚑ An empty registry is a real state and this is what the surface does with it: not an
             error, not an empty form, and it says where the thing that would fill it lives, because
             *a disabled control must say what would let it* (`106`). -->
        <!-- The empty-state pointer names the Settings row and its Tools tab. -->
        <p v-if="registry.length === 0" class="note" data-cy="external-mcp-empty">
          No external MCP servers are registered yet. Add one from Settings → Tools — a local
          address, registered once for the whole app.
        </p>

        <p class="identity-note" data-cy="external-mcp-when">{{ EXTERNAL_MCP_TAKES_EFFECT }}</p>
      </div>

      <p v-if="saveRefusal" class="note err block" data-cy="capabilities-save-refusal" role="alert">
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ saveRefusal }}</span>
      </p>
    </template>

    <!-- ⛔ **The SAME condition the body is drawn under** (review). It was `v-if="identity"` alone, so
         a failed re-read drew the error line, no controls at all, and a live Save button — which
         would have written every field of a row nobody could see. -->
    <template v-if="identity && store.loaded.value && !store.loadError.value" #actions>
      <!-- 🔴 **The other door HO-023 §2 promised** (423 relay 1). ⛔ **It does not save first**:
           this sheet's Save is its own gesture and a control that quietly committed an edit on
           the way past would be doing work nobody asked for — the grants a conversation reads are
           whatever the database holds when it asks. -->
      <button
        type="button"
        data-cy="capabilities-start-conversation"
        @click="emit('startConversation', props.profileSlug)"
      >
        New conversation…
      </button>
      <span class="spacer"></span>
      <button type="button" data-cy="capabilities-cancel" @click="emit('close')">Cancel</button>
      <button
        class="primary"
        type="button"
        :disabled="saving"
        data-cy="capabilities-save"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </template>
  </SheetShell>
</template>

<style scoped>
.icon {
  width: 14px;
  height: 14px;
}

.sheet-state {
  display: flex;
  align-items: center;
  padding: var(--space-9);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  line-height: 1.5;
}

.sheet-state.err {
  color: var(--danger);
}

/* An agent no other agent can start a conversation with until a person chooses: the summons ink. */
.identity-note.not-chosen {
  color: var(--waiting-text-label);
  font-weight: var(--fw-semibold);
}

.identity {
  display: grid;
  padding: var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  gap: var(--space-6);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fact {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.fact span {
  color: var(--muted);
  font-size: var(--type-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.fact strong {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--font-mono);
}

.identity-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

/* ⚑ 433 · the identity's provider — a `.field` in every way but the border, because the rails below
   are separated from each other and this one is separated FROM them. */
.provider-choice {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.provider-row {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-4);
}

.provider-row > span {
  color: var(--muted);
  font-size: var(--type-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ⛔ The select takes the space that is left rather than its own content width, so a provider name
   of any length cannot push the row past the sheet — `capabilities-sheet-fits.dom.test.ts`'s rule. */
.provider-row > select {
  min-width: 0;
  flex: 1 1 auto;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.capability {
  padding-bottom: var(--space-6);
  border-bottom: var(--border-width) solid var(--line);
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

.stored {
  color: var(--muted);
  font-size: var(--type-caption);
  font-style: normal;
  letter-spacing: 0;
  opacity: 0.8;
  text-transform: none;
}

.grants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

/* 🔴 **524 · a row that is not a control.** ⛔ Same chip as a grant, because it says the same kind
   of thing and sitting in the same list; what it does NOT have is the `<input>`, which is the whole
   difference between *you may change this* and *this is how it is*. */
.grant.reads {
  margin: 0;
  cursor: default;
}

.grant {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.grant em {
  color: var(--muted);
  font-size: var(--type-caption);
  font-style: normal;
}

.note {
  display: flex;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: 1.5;
}

.note.err {
  color: var(--danger);
}

.note .icon {
  flex: 0 0 auto;
  margin-top: 1px;
}
</style>
