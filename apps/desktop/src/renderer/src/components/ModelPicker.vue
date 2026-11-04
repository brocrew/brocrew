<script lang="ts">
/**
 * ⚑ **How many pickers this page has made** — each one's panel id and anchor name, unique across
 * every app on the page. ⚠️ Not `useId()`: that is unique within ONE app, and two mounts side by side
 * (a test's, or a second app) would point both faces at the first panel.
 */
let made = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  CapabilityStatus,
  ModelList,
  Provider,
  ProviderCapabilityMap,
  ReportedModel,
} from '../../../shared/runtime-ipc'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { ProviderConnection } from '@brobot2/shared'
import { MODEL_CHOICE_SAID, sameModel, theListedRow } from '../../../shared/model-choice'
import { modelField } from '../lib/model-field'
import { providerReady } from '../lib/provider-models'
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
    preferredProvider?: Provider
    connectionId?: string
    lockedConnection?: boolean
    /** Injectable metadata for fictional previews; the bridge is authoritative otherwise. */
    connections?: readonly ProviderConnection[]
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
    /** Information from the catalogue of the currently selected connection. */
    listNote?: (list: ModelList | null) => string | null
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
    preferredProvider: undefined,
    connectionId: undefined,
    lockedConnection: false,
    connections: undefined,
    readiness: null,
    setUp: undefined,
    empty: 'Nothing chosen',
    reported: null,
    drafted: null,
    reaches: undefined,
    note: null,
    listNote: undefined,
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
const draft = ref<{ provider: Provider; model: string; connectionId?: string } | null>(null)
/** The effort a person last named in this panel (or the shown one) — the host's rule keeps it. */
const chosenEffort = ref<string | null>(null)
/** The provider whose add field is open. */
const selectedProvider = ref<Provider | null>(null)
const selectedConnectionId = ref<string | null>(null)
const connectionRows = ref<readonly ProviderConnection[]>([])
const metadataLoading = ref(true)
const metadataError = ref<string | null>(null)
let metadataRead: Promise<void> | null = null
let metadataTicket = 0
let alive = true
const selectedConnection = computed(
  () => connectionRows.value.find((row) => row.id === selectedConnectionId.value) ?? null,
)

function seedConnection(): void {
  const requested = props.connectionId ?? startsOn.value?.connectionId
  if (requested !== undefined) {
    selectedConnectionId.value = requested
    selectedProvider.value =
      connectionRows.value.find((row) => row.id === requested)?.provider ??
      startsOn.value?.provider ??
      props.preferredProvider ??
      null
    return
  }
  const preferred = startsOn.value?.provider ?? props.preferredProvider ?? props.providers[0]
  const available = connectionRows.value.filter((row) => row.enabled && row.provider === preferred)
  const chosen = available.find((row) => row.authMethod === 'api-key') ?? available[0] ?? null
  selectedConnectionId.value = chosen?.id ?? null
  selectedProvider.value = chosen?.provider ?? null
}

async function loadConnections(): Promise<void> {
  if (metadataRead !== null) return metadataRead
  const ticket = ++metadataTicket
  metadataLoading.value = true
  metadataError.value = null
  const pending = (async () => {
    try {
      const rows = props.connections ?? (await window.api.runtime.providerConnections())
      if (!alive || ticket !== metadataTicket) return
      connectionRows.value = rows.filter((row) => props.providers.includes(row.provider))
      seedConnection()
    } catch {
      if (!alive || ticket !== metadataTicket) return
      connectionRows.value = []
      selectedConnectionId.value = null
      selectedProvider.value = null
      metadataError.value = 'Connections could not be read.'
    } finally {
      if (alive && ticket === metadataTicket) metadataLoading.value = false
    }
  })()
  metadataRead = pending
  try {
    await pending
  } finally {
    if (metadataRead === pending) metadataRead = null
  }
}

onMounted(() => {
  void loadConnections()
})

const routingConnectionId = computed(() =>
  props.lockedConnection &&
  props.connectionId === undefined &&
  startsOn.value?.connectionId === undefined
    ? undefined
    : (selectedConnectionId.value ?? undefined),
)

function readSelected(): Promise<void> {
  const row = selectedConnection.value
  if (
    !alive ||
    !isOpen.value ||
    metadataLoading.value ||
    row === null ||
    !row.enabled ||
    !props.providers.includes(row.provider) ||
    metadataError.value !== null
  )
    return Promise.resolve()
  return store.value.read(row.provider, props.profileId, {
    connectionId: routingConnectionId.value,
  })
}

function selectConnection(id: string): void {
  if (props.lockedConnection) return
  const row = connectionRows.value.find((one) => one.id === id && one.enabled)
  if (row === undefined) return
  selectedConnectionId.value = row.id
  selectedProvider.value = row.provider
  draft.value = null
  chosenEffort.value = null
  adding.value = null
  refusal.value = null
  void readSelected()
}

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
  const id = selectedProvider.value === provider ? routingConnectionId.value : undefined
  const held = store.value.held(provider, props.profileId, id)
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
  const recorded = shown?.connectionId ?? props.connectionId
  const provider = shown?.provider ?? props.preferredProvider ?? props.providers[0]
  const pool = connectionRows.value.filter((one) => one.provider === provider && one.enabled)
  const row =
    recorded === undefined
      ? (pool.find((one) => one.authMethod === 'api-key') ?? pool[0])
      : connectionRows.value.find((one) => one.id === recorded && one.provider === provider)
  if (shown === null)
    return row === undefined
      ? props.empty
      : `${PROVIDER_NAME[row.provider]} · ${row.name} · ${props.empty}`
  const who =
    row !== undefined
      ? `${PROVIDER_NAME[row.provider]} · ${row.name} · `
      : props.providers.length > 1
        ? `${PROVIDER_NAME[shown.provider]} · `
        : ''
  const model = inTheListsSpelling(listOf(shown.provider), shown.model)
  const pair = shown.effort === null ? model : `${model} · ${shown.effort}`
  return `${who}${pair}${reportedSays.value === null ? '' : ' (selected)'}`
})

/* ------------------------------------------------------------------ the panel */

const sections = computed(() =>
  props.providers
    .filter(
      (provider) =>
        selectedConnection.value?.enabled === true &&
        selectedConnection.value.provider === provider,
    )
    .map((provider) => {
      const held = store.value.held(provider, props.profileId, routingConnectionId.value)
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
      const current = carriesOnSelectedRoute(startsOn.value) ? startsOn.value!.model : null
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

function requestSetup(provider: Provider): void {
  hide()
  props.setUp?.(provider)
}

async function retry(provider: Provider): Promise<void> {
  await store.value.read(provider, props.profileId, {
    connectionId: routingConnectionId.value,
  })
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
  selectedConnection.value?.enabled !== true ||
  draftList.value === null ||
  draftEffort.value === undefined ||
  sections.value.find((section) => section.provider === draft.value?.provider)?.ready !== true
    ? null
    : { ...draft.value, effort: draftEffort.value },
)

const levels = computed(() => (offered.value?.known === true ? offered.value.levels : []))
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
function refreshSelection(): void {
  metadataTicket++
  metadataRead = null
  connectionRows.value = []
  selectedConnectionId.value = null
  selectedProvider.value = null
  draft.value = null
  chosenEffort.value = null
  const pending = loadConnections()
  const ticket = metadataTicket
  void pending.then(() => {
    if (!alive || !isOpen.value || ticket !== metadataTicket) return
    seed()
    void readSelected()
  })
}

watch(
  () =>
    [
      props.providers.join('\u0000'),
      props.profileId ?? '',
      props.connectionId ?? '',
      props.preferredProvider ?? '',
    ].join('\u0001'),
  refreshSelection,
)
watch(() => props.connections, refreshSelection)

watch(
  () => (draft.value === null ? null : listOf(draft.value.provider)),
  (list) => {
    const drafted = draft.value
    if (drafted === null || list === null) return
    const spelled = inTheListsSpelling(list, drafted.model)
    if (spelled !== drafted.model) draft.value = { ...drafted, model: spelled }
  },
)

function carriesOnSelectedRoute(pick: PickedModel | null): boolean {
  const row = selectedConnection.value
  if (pick === null || row === null || pick.provider !== row.provider) return false
  const pool = connectionRows.value.filter((one) => one.enabled && one.provider === pick.provider)
  const original =
    pick.connectionId ??
    props.connectionId ??
    (pool.find((one) => one.authMethod === 'api-key') ?? pool[0])?.id
  return original === row.id
}

/** ⚑ The draft starts on what the face shows. */
function seed(): void {
  const row = selectedConnection.value
  const starts = startsOn.value
  const sameRoute = starts !== null && row !== null && carriesOnSelectedRoute(starts)
  draft.value =
    !sameRoute || !row.enabled
      ? null
      : {
          provider: row.provider,
          ...(routingConnectionId.value === undefined
            ? {}
            : { connectionId: routingConnectionId.value }),
          model: inTheListsSpelling(listOf(row.provider), starts.model),
        }
  chosenEffort.value = sameRoute ? starts.effort : null
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
  const pending = loadConnections()
  const ticket = metadataTicket
  await pending
  if (!alive || !isOpen.value || ticket !== metadataTicket) return
  seed()
  const reads = [readSelected()]
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
  } else if (alive && isOpen.value) {
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
  alive = false
  isOpen.value = false
  metadataTicket++
  window.removeEventListener('keydown', onEscape, { capture: true })
  opener?.style.removeProperty('anchor-name')
})

defineExpose({ panelId, isOpen, openedFrom })

function draftModel(provider: Provider, model: string): void {
  if (sections.value.find((section) => section.provider === provider)?.ready !== true) return
  draft.value = {
    provider,
    model,
    ...(routingConnectionId.value === undefined ? {} : { connectionId: routingConnectionId.value }),
  }
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
      starts === null || !carriesOnSelectedRoute(starts)
        ? null
        : {
            provider,
            model: inTheListsSpelling(listOf(provider), starts.model),
            ...(routingConnectionId.value === undefined
              ? {}
              : { connectionId: routingConnectionId.value }),
          }
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
      aria-label="Choose connection, model and effort"
      data-cy="model-picker-panel"
      :style="{ positionAnchor: anchor }"
      @beforetoggle="onBeforeToggle"
      @toggle="onToggle"
    >
      <div v-if="isOpen" class="inside">
        <p v-if="metadataLoading" class="said">Reading…</p>
        <template v-else>
          <label class="connection-choice">
            <span>Connection</span>
            <select
              data-cy="model-picker-connection"
              :value="selectedConnectionId ?? ''"
              :size="Math.max(1, Math.min(connectionRows.length, 6))"
              :disabled="
                props.lockedConnection ||
                metadataLoading ||
                metadataError !== null ||
                connectionRows.length === 0
              "
              @change="selectConnection(($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="row in connectionRows"
                :key="row.id"
                :value="row.id"
                :disabled="!row.enabled"
              >
                {{ PROVIDER_NAME[row.provider] }} · {{ row.name }}
              </option>
            </select>
          </label>
          <p v-if="metadataError" class="said warn">{{ metadataError }}</p>
          <p v-else-if="connectionRows.length === 0" class="said">No connections available.</p>
          <p
            v-else-if="selectedConnection === null || !selectedConnection.enabled"
            class="said warn"
          >
            The selected connection is unavailable
          </p>
        </template>

        <section
          v-for="section in visibleSections"
          :key="section.provider"
          class="provider"
          data-cy="model-picker-provider"
          :data-provider="section.provider"
        >
          <h4>{{ section.name }}</h4>
          <p
            v-if="section.field.message && section.field.state !== 'no-profile'"
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
            v-if="section.ready === false && props.setUp"
            type="button"
            class="add-open"
            :data-cy="`model-picker-setup-${section.provider}`"
            @click="requestSetup(section.provider)"
          >
            Set up in Settings
          </button>
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
          v-if="
            draft !== null &&
            selectedProvider === draft.provider &&
            (levels.length > 0 || effortWanted)
          "
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
          <p v-if="effortWanted" class="said warn" data-cy="model-picker-effort-wanted">
            {{ effortWanted }}
          </p>
        </fieldset>

        <div class="foot">
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

.connection-choice {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  font-size: var(--type-small);
}
.connection-choice select {
  min-width: 0;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  color: var(--text);
  background: var(--panel);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  font: inherit;
}
</style>
