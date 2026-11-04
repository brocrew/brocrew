<script lang="ts">
/**
 * ⚑ **How many pickers this page has made** — each one's panel id and anchor name, unique across
 * every app on the page. ⚠️ Not `useId()`: that is unique within ONE app, and two mounts side by side
 * (a test's, or a second app) would point both faces at the first panel.
 */
let made = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type {
  CapabilityStatus,
  ModelList,
  Provider,
  ProviderCapabilityMap,
  ReportedModel,
} from '../../../shared/runtime-ipc'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { MODEL_CHOICE_SAID, sameModel, theListedRow } from '../../../shared/model-choice'
import { modelField } from '../lib/model-field'
import { defaultModel, providerReady } from '../lib/provider-models'
import {
  inTheListsSpelling,
  isNoLongerListed,
  NO_LONGER_LISTED,
  theDraftEffort,
  theEffortsOffered,
  thePickerRows,
  type ModelLists,
  type PickedModel,
} from '../lib/model-lists'
import { readableError } from '../lib/session-record'
import { ROLE_PROPERTIES } from '../lib/text-roles'
import { useModelLists } from '../composables/useModelLists'

/**
 * The shared model picker.
 *
 * > *"we need a new component, contains the available models list, those auto loaded from
 * > codex/claude, and also those added manually. the component shows as a popover when we want to
 * > change the model."*
 *
 * ⚑ **One component, mounted wherever a model is chosen** — the new-conversation form, a
 * conversation's settings and an agent's sheet. A **face** shows the pair; pressing it opens a
 * **panel**: each provider's list (the provider's own rows, then the person's, with *+ Add* and ✕
 * on their own), and the drafted model's own effort levels. ⛔ **Nothing is sent until Take** —
 * arrows move the draft, and the place that mounts this decides what Take does ({@link commit}).
 *
 * ## ⚑ The browser's own popover, as `FacetBar` argues for its `<details>`
 *
 * A native top-layer popover: it escapes every scroll container the three hosts put it in, light
 * dismiss and focus return are the browser's, and it stays a DOM child of the host, so the theme's
 * tokens still reach it. ⚠️ **Escape is handled here and stopped**: the sheet's host closes the whole
 * sheet on a window Escape, and the conversation interrupts a running turn on one.
 *
 * ⚠️ **The panel's contents exist only while it is open**, so a closed picker is its face — and
 * nothing reads a list until a person opens it.
 *
 * ⛔ **No provider is named here**: every name is `PROVIDER_NAME`'s, and providers are iterated,
 * never compared to a literal (`provider-neutrality.test.ts`).
 */
const props = withDefaults(
  defineProps<{
    /** Whose models it lists — a conversation's one provider, the sheet's, or both on the form. */
    providers: readonly Provider[]
    readiness?: Readonly<Partial<Record<Provider, boolean | null>>> | null
    setUp?: (provider: Provider) => void
    /** Whose list to read — absent is BroBot's, the door's own default. */
    profileId?: string
    /** What the face shows, and what the draft starts on unless {@link drafted} says otherwise. */
    shown: PickedModel | null
    /** ⚑ What the draft starts on where it is not the face — a conversation's queued pair. */
    drafted?: PickedModel | null
    /** The face's words when nothing is shown. */
    empty?: string
    /** ⚑ D-042 · R5 — what the provider reports running; drawn only where it differs. */
    reported?: ReportedModel | null
    /** The take button's words — what it does in this place. */
    takeWords: string
    /** ⛔ Commits the draft: answers the door's refusal, verbatim, or `null`. */
    take: (pick: PickedModel) => Promise<string | null>
    /** What this pick will do here — the sentence above the take button. */
    reaches?: ((pick: PickedModel, list: ModelList | null) => string | null) | undefined
    /** One line at the top of the panel. */
    note?: string | null
    /** ⚑ D-017b · a statement: the face does not open. */
    fixed?: boolean
    /**
     * No face of its own: the place that mounts it draws its own buttons, each pointing at
     * {@link panelId} and telling {@link openedFrom} which one was pressed.
     */
    faceless?: boolean
    /** Read only for a refused list's remedy (`model-field.ts`). */
    capabilities?: ProviderCapabilityMap | null
    /** Injectable for tests; the window's one holder otherwise. */
    lists?: ModelLists
  }>(),
  {
    profileId: undefined,
    readiness: null,
    setUp: undefined,
    empty: 'Nothing chosen',
    reported: null,
    drafted: null,
    reaches: undefined,
    note: null,
    fixed: false,
    faceless: false,
    capabilities: null,
    lists: undefined,
  },
)

const store = computed(() => props.lists ?? useModelLists())

made += 1
const panelId = `model-picker-${made}`
/** ⚑ The anchor the panel is placed by — one per instance. */
const anchor = `--${panelId}`

const face = ref<HTMLElement | null>(null)
/** The button that opened the panel, where it is not the face — focus goes back to it. */
let opener: HTMLElement | null = null
/** Which part of the panel a press asked for: its model rows, or the drafted model's efforts. */
let openAt: 'model' | 'effort' = 'model'
const panel = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const busy = ref(false)
/** The take's refusal, verbatim. */
const refusal = ref<string | null>(null)
/** ⚑ The draft: a model picked in the panel — nothing is sent until Take. */
const draft = ref<{ provider: Provider; model: string } | null>(null)
/** The effort a person last named in this panel (or the shown one) — the host's rule keeps it. */
const chosenEffort = ref<string | null>(null)
/** The provider whose add field is open. */
const selectedProvider = ref<Provider | null>(null)
const adding = ref<Provider | null>(null)
const addName = ref('')
/** What a provider's list door last said — a refusal, or an id already listed. */
const listSaid = ref<Partial<Record<Provider, string>>>({})

const PENDING: CapabilityStatus = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
}

/** The pair the draft starts on, and the one a deleted draft falls back to. */
const startsOn = computed(() => props.drafted ?? props.shown)

function listOf(provider: Provider): ModelList | null {
  const held = store.value.held(provider, props.profileId)
  return held?.state === 'answered' ? held.list : null
}

/* ------------------------------------------------------------------ the face */

/** ⚑ `09` §4 — the model the provider reports, beside the selected one, only where they differ. */
const reportedSays = computed(() => {
  const reported = props.reported
  if (reported == null) return null
  const shown = props.shown
  const effortDiffers = reported.effort !== undefined && reported.effort !== shown?.effort
  if (shown !== null && sameModel(reported.model, shown.model) && !effortDiffers) return null
  const provider = shown?.provider ?? props.providers[0]
  if (provider === undefined) return null
  return `· ${PROVIDER_NAME[provider]} reports ${reported.model}${reported.effort === undefined ? '' : ` at ${reported.effort}`}`
})

const faceWords = computed(() => {
  const shown = props.shown
  if (shown === null) return props.empty
  const who = props.providers.length > 1 ? `${PROVIDER_NAME[shown.provider]} · ` : ''
  const model = inTheListsSpelling(listOf(shown.provider), shown.model)
  const pair = shown.effort === null ? model : `${model} · ${shown.effort}`
  return `${who}${pair}${reportedSays.value === null ? '' : ' (selected)'}`
})

/* ------------------------------------------------------------------ the panel */

const sections = computed(() =>
  props.providers.map((provider) => {
    const held = store.value.held(provider, props.profileId)
    const list = held?.state === 'answered' ? held.list : null
    const name = PROVIDER_NAME[provider]
    const ready =
      props.readiness !== null && provider in props.readiness
        ? props.readiness[provider]
        : providerReady(held)
    const field =
      held?.state === 'unread'
        ? {
            message:
              ready === false
                ? `${name} isn't set up. Set it up in Settings → Providers.`
                : `${name} didn't answer. Try again.`,
            tone: 'warn' as const,
            remedy: null,
            detail: held.why,
            retry: ready !== false,
            notSetUp: ready === false,
          }
        : modelField({
            catalogue:
              list === null
                ? null
                : (list.notAsked ?? {
                    ok: true,
                    models: list.models.filter((row) => row.addedBy === 'the-provider'),
                  }),
            ready,
            profileExists: true,
            provider: name,
            signIn: props.capabilities?.[provider]?.signIn ?? PENDING,
            reprovision: props.capabilities?.[provider]?.reprovisionAuth ?? PENDING,
          })
    const current = startsOn.value?.provider === provider ? startsOn.value.model : null
    return {
      provider,
      ready,
      name,
      list,
      field,
      rows: thePickerRows(list, current).map((one) => ({
        ...one,
        mark: one.row === null && isNoLongerListed(list, one.id) ? NO_LONGER_LISTED : null,
      })),
    }
  }),
)

const visibleSections = computed(() =>
  props.providers.length > 1
    ? sections.value.filter((section) => section.provider === selectedProvider.value)
    : sections.value,
)

function selectProvider(provider: Provider): void {
  if (sections.value.find((section) => section.provider === provider)?.ready !== true) return
  selectedProvider.value = provider
  adding.value = null
  const starts =
    startsOn.value?.provider === provider ? startsOn.value : defaultModel(listOf(provider))
  draft.value = starts == null ? null : { provider, model: starts.model }
  chosenEffort.value = starts?.effort ?? null
  refusal.value = null
}

function requestSetup(provider: Provider): void {
  hide()
  props.setUp?.(provider)
}

async function retry(provider: Provider): Promise<void> {
  await store.value.read(provider, props.profileId)
}

const draftList = computed(() => (draft.value === null ? null : listOf(draft.value.provider)))
const offered = computed(() =>
  draft.value === null ? null : theEffortsOffered(draftList.value, draft.value.model),
)
const draftEffort = computed(() =>
  draft.value === null
    ? undefined
    : theDraftEffort(draftList.value, draft.value.model, chosenEffort.value),
)
/** ⚑ The pick Take would send — `null` while no model is drafted, or no effort is named. */
const pick = computed<PickedModel | null>(() =>
  draft.value === null ||
  draftEffort.value === undefined ||
  sections.value.find((section) => section.provider === draft.value?.provider)?.ready !== true
    ? null
    : { ...draft.value, effort: draftEffort.value },
)

const levels = computed(() => (offered.value?.known === true ? offered.value.levels : []))
/** ⚑ The provider's own words about the level drafted (076 §2). */
const effortDescription = computed(
  () => levels.value.find((level) => level.id === draftEffort.value)?.description ?? null,
)
/** ⚑ Why there is no level to pick, in one sentence — or `null` when there are levels. */
const effortSilence = computed(() => {
  const drafted = draft.value
  if (drafted === null || offered.value === null) return null
  if (!offered.value.known) {
    return `${PROVIDER_NAME[drafted.provider]} could not be asked which efforts “${drafted.model}” offers.`
  }
  if (offered.value.levels.length === 0) return `“${drafted.model}” has no effort levels.`
  return null
})
/** ⛔ Levels offered and none named: the door's own sentence, and Take waits for a pick. */
const effortWanted = computed(() =>
  draft.value !== null && draftEffort.value === undefined
    ? MODEL_CHOICE_SAID['effort-not-offered']({
        profileId: props.profileId ?? '',
        model: draft.value.model,
        offered: levels.value.map((level) => level.id),
      })
    : null,
)
const reachesSays = computed(() =>
  pick.value === null || props.reaches === undefined
    ? null
    : props.reaches(pick.value, draftList.value),
)

function hide(): void {
  const element = panel.value
  if (element !== null && element.matches(':popover-open')) element.hidePopover()
}

/**
 * A host's own button was pressed: the panel is placed by it, opens at the part it named, and
 * gives focus back to it. Called from that button's click, before the browser toggles the panel.
 */
function openedFrom(button: HTMLElement, at: 'model' | 'effort'): void {
  if (opener !== button) opener?.style.removeProperty('anchor-name')
  opener = button
  openAt = at
  button.style.setProperty('anchor-name', anchor)
}

function giveFocusBack(): void {
  ;(opener ?? face.value)?.focus()
}

/** The checked effort level, or the first one offered. */
function anEffort(): HTMLElement | null {
  const efforts = panel.value?.querySelector('[data-cy="model-picker-efforts"]')
  return (
    efforts?.querySelector<HTMLElement>('input:checked') ??
    efforts?.querySelector<HTMLElement>('input') ??
    null
  )
}

/**
 * ⚑ **The providers it lists moved while it was open** — the sheet's *Runs on*, under an agent with
 * no provider of its own: the draft named the other provider's rows, so it starts again from what
 * the face now shows, and the new list is asked for.
 */
watch(
  () => props.providers.join('\u0000'),
  () => {
    if (!isOpen.value) return
    seed()
    for (const provider of props.providers) void store.value.read(provider, props.profileId)
  },
)

/**
 * ⚑ **The list arrived after the draft was seeded** (a first open): the draft takes the list's own
 * spelling of the model it names, as a seed with the list already held would have.
 */
watch(
  () => (draft.value === null ? null : listOf(draft.value.provider)),
  (list) => {
    const drafted = draft.value
    if (drafted === null || list === null) return
    const spelled = inTheListsSpelling(list, drafted.model)
    if (spelled !== drafted.model) draft.value = { ...drafted, model: spelled }
  },
)

watch(
  () => sections.value.map((section) => `${section.provider}:${section.ready}`).join(','),
  () => {
    if (
      isOpen.value &&
      (selectedProvider.value === null ||
        sections.value.find((section) => section.provider === selectedProvider.value)?.ready !==
          true)
    )
      seed()
  },
)

watch(
  () => (selectedProvider.value === null ? null : listOf(selectedProvider.value)),
  (list) => {
    if (
      props.providers.length > 1 &&
      isOpen.value &&
      draft.value === null &&
      list !== null &&
      selectedProvider.value !== null
    )
      selectProvider(selectedProvider.value)
  },
)

/** ⚑ The draft starts on what the face shows. */
function seed(): void {
  const preferred = startsOn.value?.provider
  const available = sections.value.filter((section) => section.ready === true)
  const provider =
    available.find((section) => section.provider === preferred)?.provider ??
    available[0]?.provider ??
    null
  selectedProvider.value = provider
  const starts =
    props.providers.length === 1 || provider === preferred
      ? startsOn.value
      : provider === null
        ? null
        : defaultModel(listOf(provider))
  draft.value =
    starts === null || provider === null
      ? null
      : {
          provider,
          model: inTheListsSpelling(listOf(provider), starts.model),
        }
  chosenEffort.value = starts?.effort ?? null
}

function onBeforeToggle(event: Event): void {
  if ((event as ToggleEvent).newState === 'open') void open()
}

function onToggle(event: Event): void {
  if ((event as ToggleEvent).newState === 'closed') close()
}

/** ⚑ The one moment the picker asks for its lists — a person's press. */
async function open(): Promise<void> {
  isOpen.value = true
  refusal.value = null
  listSaid.value = {}
  adding.value = null
  addName.value = ''
  seed()
  const reads = props.providers.map((provider) => store.value.read(provider, props.profileId))
  await nextTick()
  const within = panel.value
  const aRow = () =>
    within?.querySelector<HTMLElement>('[data-cy="model-picker-row"] input:checked') ??
    within?.querySelector<HTMLElement>('[data-cy="model-picker-row"] input') ??
    within?.querySelector<HTMLElement>('[data-cy="model-picker-add-open"]')
  const first = openAt === 'effort' ? (anEffort() ?? aRow()) : aRow()
  first?.focus()
  if (first != null && (openAt !== 'effort' || anEffort() !== null)) return
  const focusWhileWaiting = document.activeElement
  await Promise.allSettled(reads)
  await nextTick()
  const arrived = openAt === 'effort' ? (anEffort() ?? aRow()) : aRow()
  if (isOpen.value && arrived != null && document.activeElement === focusWhileWaiting)
    arrived.focus()
}

/** ⚑ Closed by any means: the draft and a half-typed name go with it. */
function close(): void {
  isOpen.value = false
  openAt = 'model'
  draft.value = null
  adding.value = null
  addName.value = ''
  refusal.value = null
}

/**
 * ⛔ **Escape is ours while the panel is open** — the add field first, then the panel — and stopped,
 * so the sheet around it stays open and a running turn is not interrupted. ⚠️ **Caught on the
 * window, before anyone else**, and not on this element: focus is on `<body>` after a press on the
 * panel's plain text, and an Escape from there would pass the picker by. Closed, it is not listened.
 */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (adding.value !== null) {
    void closeAdd(adding.value)
  } else if (isOpen.value) {
    hide()
    giveFocusBack()
  } else {
    return
  }
  event.stopPropagation()
  event.preventDefault()
}

watch(isOpen, (now) => {
  if (now) window.addEventListener('keydown', onEscape, { capture: true })
  else window.removeEventListener('keydown', onEscape, { capture: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscape, { capture: true })
  opener?.style.removeProperty('anchor-name')
})

defineExpose({ panelId, isOpen, openedFrom })

function draftModel(provider: Provider, model: string): void {
  if (sections.value.find((section) => section.provider === provider)?.ready !== true) return
  draft.value = { provider, model }
  refusal.value = null
}

function draftAnEffort(effort: string): void {
  chosenEffort.value = effort
  refusal.value = null
}

async function commit(): Promise<void> {
  const chosen = pick.value
  if (
    chosen === null ||
    busy.value ||
    sections.value.find((section) => section.provider === chosen.provider)?.ready !== true
  )
    return
  busy.value = true
  refusal.value = null
  try {
    refusal.value = await props.take(chosen)
  } catch (error) {
    refusal.value = readableError(error)
  } finally {
    busy.value = false
  }
  if (refusal.value === null) {
    hide()
    giveFocusBack()
  }
}

/* ------------------------------------------------------------------ a person's own models */

async function openAdd(provider: Provider): Promise<void> {
  if (sections.value.find((section) => section.provider === provider)?.ready !== true) return
  adding.value = provider
  addName.value = ''
  listSaid.value = { ...listSaid.value, [provider]: undefined }
  await nextTick()
  panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-add-name"]')?.focus()
}

/**
 * ⚑ **`09` §6 — added, never checked**: no test call, nothing spent. ⚠️ An id the list already
 * holds is not sent — the list would hide it — so its row is drafted and the panel says so. ⚑ A new
 * one is drafted once added: that is why it was added.
 */
async function add(provider: Provider): Promise<void> {
  const id = addName.value.trim()
  if (
    id === '' ||
    busy.value ||
    sections.value.find((section) => section.provider === provider)?.ready !== true
  )
    return
  const name = PROVIDER_NAME[provider]
  const list = listOf(provider)
  const listed = list === null ? undefined : theListedRow(list.models, id)
  if (listed !== undefined) {
    void closeAdd(provider)
    draftModel(provider, listed.id)
    listSaid.value = {
      ...listSaid.value,
      [provider]: `“${id}” is already in ${name}’s list — selected it.`,
    }
    return
  }
  busy.value = true
  const refused = await store.value.add(provider, id).finally(() => {
    busy.value = false
  })
  if (refused !== null) {
    listSaid.value = { ...listSaid.value, [provider]: refused }
    return
  }
  listSaid.value = { ...listSaid.value, [provider]: undefined }
  void closeAdd(provider)
  draftModel(provider, id)
}

/**
 * ⚑ **✕ deletes in one press** — undone by adding it again. ⚠️ A conversation or a default already
 * on it keeps it, and the picker then shows it as no longer listed.
 */
async function remove(provider: Provider, id: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  const refused = await store.value.remove(provider, id).finally(() => {
    busy.value = false
  })
  if (refused !== null) {
    listSaid.value = { ...listSaid.value, [provider]: refused }
    return
  }
  const starts = startsOn.value
  if (draft.value?.provider === provider && sameModel(draft.value.model, id)) {
    draft.value =
      starts === null || starts.provider !== provider
        ? null
        : { provider, model: inTheListsSpelling(listOf(provider), starts.model) }
  }
  await focusAddOpen(provider)
}

/** ⚑ **The add field closes onto its own *+ Add*, never onto `<body>`** — the keyboard stays here. */
async function closeAdd(provider: Provider): Promise<void> {
  adding.value = null
  await focusAddOpen(provider)
}

async function focusAddOpen(provider: Provider): Promise<void> {
  await nextTick()
  panel.value
    ?.querySelector<HTMLElement>(
      `[data-cy="model-picker-provider"][data-provider="${provider}"] [data-cy="model-picker-add-open"]`,
    )
    ?.focus()
}
</script>

<template>
  <div class="model-picker" data-cy="model-picker" :style="ROLE_PROPERTIES">
    <template v-if="props.faceless" />
    <span v-else-if="props.fixed" class="face fixed" data-cy="model-picker-face"
      ><span>{{ faceWords }}</span></span
    >
    <button
      v-else
      ref="face"
      class="face"
      type="button"
      data-cy="model-picker-face"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :popovertarget="panelId"
      :title="
        props.shown === null
          ? undefined
          : inTheListsSpelling(listOf(props.shown.provider), props.shown.model)
      "
      :style="{ anchorName: anchor }"
    >
      <span>{{ faceWords }}</span>
      <svg class="icon chev" aria-hidden="true"><use href="#i-chevron" /></svg>
    </button>
    <span v-if="reportedSays && !props.faceless" class="reported" data-cy="model-picker-reported">{{
      reportedSays
    }}</span>

    <div
      v-if="!props.fixed"
      :id="panelId"
      ref="panel"
      class="panel"
      popover="auto"
      role="dialog"
      aria-label="Choose a model and its effort"
      data-cy="model-picker-panel"
      :style="{ positionAnchor: anchor }"
      @beforetoggle="onBeforeToggle"
      @toggle="onToggle"
    >
      <div v-if="isOpen" class="inside">
        <p v-if="props.note" class="said" data-cy="model-picker-note">{{ props.note }}</p>

        <fieldset
          v-if="props.providers.length > 1"
          class="provider-choices"
          data-cy="model-picker-providers"
        >
          <legend>Provider</legend>
          <div v-for="section in sections" :key="section.provider" class="provider-choice">
            <label class="pick">
              <input
                type="radio"
                :name="`${panelId}-provider`"
                :value="section.provider"
                :data-cy="`model-picker-choose-${section.provider}`"
                :checked="selectedProvider === section.provider"
                :disabled="section.ready !== true"
                @change="selectProvider(section.provider)"
              />
              <span
                >{{ section.name
                }}{{
                  section.ready === false
                    ? ' · Not set up'
                    : section.ready !== true
                      ? ' · Checking…'
                      : ' · Ready'
                }}</span
              >
            </label>
            <button
              v-if="section.ready === false && props.setUp"
              type="button"
              class="add-open"
              :data-cy="`model-picker-setup-${section.provider}`"
              @click="requestSetup(section.provider)"
            >
              Set up in Settings
            </button>
            <span
              v-if="section.ready !== true && section.field.retry"
              class="said"
              data-cy="model-picker-said"
              :title="section.field.detail"
              >{{ section.field.message }}</span
            >
            <button
              v-if="section.ready !== true && section.field.retry"
              type="button"
              class="add-open"
              data-cy="model-picker-retry"
              @click="retry(section.provider)"
            >
              Try again
            </button>
          </div>
        </fieldset>

        <section
          v-for="section in visibleSections"
          :key="section.provider"
          class="provider"
          data-cy="model-picker-provider"
          :data-provider="section.provider"
        >
          <h4>{{ section.name }}</h4>
          <p
            v-if="section.field.message"
            class="said"
            :class="{ warn: section.field.tone === 'warn' }"
            data-cy="model-picker-said"
            :title="section.field.detail"
          >
            {{ section.field.message }}
            <strong v-if="section.field.remedy" data-cy="model-picker-remedy">{{
              section.field.remedy
            }}</strong>
          </p>
          <button
            v-if="section.field.retry"
            type="button"
            class="add-open"
            data-cy="model-picker-retry"
            @click="retry(section.provider)"
          >
            Try again
          </button>

          <div
            v-for="one in section.ready === true ? section.rows : []"
            :key="one.id"
            class="row"
            data-cy="model-picker-row"
            :data-model="one.id"
            :data-added-by="one.row?.addedBy ?? 'nobody'"
            :title="one.id"
          >
            <label class="pick">
              <input
                type="radio"
                :name="`${panelId}-model`"
                :value="`${section.provider}:${one.id}`"
                :checked="draft?.provider === section.provider && sameModel(draft.model, one.id)"
                @change="draftModel(section.provider, one.id)"
                @keydown.enter.prevent="commit"
              />
              <span class="words">
                <span class="label">{{ one.row?.label ?? one.id }}</span>
                <span v-if="one.row?.resolvesTo" class="to">→ {{ one.row.resolvesTo }}</span>
                <span v-if="one.row?.isDefault" class="tag">default</span>
                <span v-if="one.row?.note" class="warn" :title="one.row.note">⚠</span>
                <span v-if="one.mark" class="tag">{{ one.mark }}</span>
                <span v-if="one.row?.addedBy === 'a-person'" class="tag">added by you</span>
                <span v-if="one.row?.description" class="description">{{
                  one.row.description
                }}</span>
              </span>
            </label>
            <button
              v-if="one.row?.addedBy === 'a-person'"
              class="delete"
              type="button"
              data-cy="model-picker-delete"
              :aria-label="`Delete ${one.id} from your ${section.name} models`"
              :disabled="busy"
              @click="remove(section.provider, one.id)"
            >
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </div>

          <div v-if="adding === section.provider" class="adding">
            <input
              v-model="addName"
              type="text"
              spellcheck="false"
              data-cy="model-picker-add-name"
              :placeholder="`its id, exactly as ${section.name} names it`"
              @keydown.enter.prevent="add(section.provider)"
            />
            <button
              type="button"
              data-cy="model-picker-add"
              :disabled="busy || addName.trim() === ''"
              @click="add(section.provider)"
            >
              Add
            </button>
            <button
              type="button"
              data-cy="model-picker-add-cancel"
              @click="closeAdd(section.provider)"
            >
              Cancel
            </button>
          </div>
          <button
            v-else-if="section.ready === true"
            class="add-open"
            type="button"
            data-cy="model-picker-add-open"
            @click="openAdd(section.provider)"
          >
            + Add a {{ section.name }} model…
          </button>
          <p
            v-if="listSaid[section.provider]"
            class="said"
            data-cy="model-picker-add-said"
            role="status"
          >
            {{ listSaid[section.provider] }}
          </p>
        </section>

        <fieldset
          v-if="draft !== null && selectedProvider === draft.provider"
          class="efforts"
          data-cy="model-picker-efforts"
        >
          <legend>Effort</legend>
          <label
            v-for="level in levels"
            :key="level.id"
            class="pick"
            data-cy="model-picker-effort"
            :data-effort="level.id"
            :title="level.description ?? ''"
          >
            <input
              type="radio"
              :name="`${panelId}-effort`"
              :value="level.id"
              :checked="draftEffort === level.id"
              @change="draftAnEffort(level.id)"
              @keydown.enter.prevent="commit"
            />
            <span class="label">{{ level.label }}</span>
            <span
              v-if="theListedRow(draftList?.models ?? [], draft.model)?.defaultEffort === level.id"
              class="tag"
              >default</span
            >
          </label>
          <p v-if="effortSilence" class="said" data-cy="model-picker-effort-none">
            {{ effortSilence }}
          </p>
          <p v-else-if="effortWanted" class="said warn" data-cy="model-picker-effort-wanted">
            {{ effortWanted }}
          </p>
          <p v-else-if="effortDescription" class="said" data-cy="model-picker-effort-said">
            {{ effortDescription }}
          </p>
        </fieldset>

        <div class="foot">
          <p v-if="reachesSays" class="said" data-cy="model-picker-reaches">{{ reachesSays }}</p>
          <p v-if="refusal" class="said refused" data-cy="model-picker-refusal" role="alert">
            {{ refusal }}
          </p>
          <div class="buttons">
            <button type="button" data-cy="model-picker-cancel" @click="hide">Cancel</button>
            <button
              class="take"
              type="button"
              data-cy="model-picker-take"
              :disabled="busy || pick === null"
              @click="commit"
            >
              {{ props.takeWords }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.provider-choices {
  border: 0;
  border-bottom: var(--border-width) solid var(--line);
  margin: 0 0 var(--space-3);
  padding: 0 0 var(--space-3);
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.provider-choices legend {
  font-size: var(--type-caption);
  color: var(--muted);
  margin-bottom: var(--space-2);
}
.provider-choice {
  display: grid;
  gap: var(--space-1);
}
.provider-choice .add-open {
  margin-left: var(--space-5);
}
.model-picker {
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}

/* ⚑ **The host's own register** — `font: inherit`, so the face reads at the row's role size. ⛔ No
   ellipsis anywhere: an id wraps rather than being cut, which keeps this out of the clipped-text
   ledger's category. */
.face {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-1);
  color: var(--text-soft);
  cursor: pointer;
  font: inherit;
  gap: var(--space-2);
  overflow-wrap: anywhere;
  text-align: left;
}

.face.fixed {
  border-color: transparent;
  background: none;
  cursor: default;
}

.chev {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  transform: rotate(90deg);
}

.reported {
  min-width: 0;
  color: var(--faint);
  font-size: var(--role-meta);
  overflow-wrap: anywhere;
}

/* ⚑ **Placed by its face, in the top layer** — anchor positioning, flipping above or inward where
   there is no room. ⚠️ The browser's own `[popover]` rules centre it (`inset: 0; margin: auto`) and
   hide it when closed (`display: none`), so this sets no `display` of its own. */
.panel {
  position: fixed;
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(70vh, 32rem);
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  margin: 0;
  background: var(--panel-3);
  box-shadow: var(--shadow);
  color: var(--text-soft);
  font-size: var(--type-caption);
  inset: auto;
  overflow-y: auto;
  position-area: block-end span-inline-end;
  position-try-fallbacks: flip-block, flip-inline;
}

.inside {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-4) 0;
  gap: var(--space-4);
}

.provider {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h4 {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.pick {
  display: flex;
  min-width: 0;
  align-items: baseline;
  cursor: pointer;
  gap: var(--space-3);
}

.words {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.label {
  color: var(--text);
  overflow-wrap: anywhere;
}

.to,
.tag {
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.description {
  width: 100%;
  color: var(--faint);
  font-size: var(--type-caption);
}

.warn {
  color: var(--waiting);
}

.delete,
.add-open {
  padding: 0 var(--space-2);
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
}

.add-open {
  align-self: flex-start;
  padding: 0;
  color: var(--accent-text);
}

.delete .icon {
  width: 10px;
  height: 10px;
}

.adding {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.adding input {
  min-width: 0;
  flex: 1 1 10rem;
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-1);
  color: var(--text-soft);
  font: inherit;
}

.efforts {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  padding: var(--space-3) 0 0;
  border: none;
  border-top: var(--border-width) solid var(--line);
  margin: 0;
  gap: var(--space-2) var(--space-5);
}

legend {
  float: left;
  width: 100%;
  margin: 0 0 var(--space-2);
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.said {
  width: 100%;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.said.refused {
  color: var(--danger);
}

/* ⚑ **The take row stays at the panel's foot**, so a long list scrolls inside the panel and never
   takes the button off the window. */
.foot {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-3) 0 var(--space-4);
  border-top: var(--border-width) solid var(--line);
  background: var(--panel-3);
  gap: var(--space-2);
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.take {
  color: var(--accent-text);
}
</style>
