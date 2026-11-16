<script lang="ts">
let made = 0
</script>

<script setup lang="ts">
import type { ModelList } from '../../../shared/model-choice-contracts'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Provider } from '../../../shared/runtime-ipc'
import { sameModel, theListedRow } from '../../../shared/model-choice'
import {
  modelPickerSection,
  modelPickerWords,
  modelPickerDefaults,
  type ModelPickerProps,
} from '../lib/model-picker-section'
import {
  inTheListsSpelling,
  theDraftEffort,
  theEffortsOffered,
  type PickedModel,
} from '../lib/model-lists'
import { readableError } from '../lib/session-record'
import { ROLE_PROPERTIES } from '../lib/text-roles'
import { useClientProviders } from '../client-provider/injection'
import { useProviderNames } from '../composables/useProviderNames'
import { useModelLists } from '../composables/useModelLists'

const props = withDefaults(defineProps<ModelPickerProps>(), modelPickerDefaults)
const providerName = useProviderNames(useClientProviders())
const words = modelPickerWords(providerName)
const store = computed(() => props.lists ?? useModelLists())
made += 1
const panelId = `model-picker-${made}`
const anchor = `--${panelId}`
const face = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
let openAt: 'model' | 'effort' = 'model'
const panel = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const busy = ref(false)
const refusal = ref<string | null>(null)
const draft = ref<{ provider: Provider; model: string } | null>(null)
const chosenEffort = ref<string | null>(null)
const selectedProvider = ref<Provider | null>(null)
const selectedConnectionId = ref<string | undefined>()
const adding = ref<Provider | null>(null)
const addName = ref('')
const listSaid = ref<Partial<Record<Provider, string>>>({})
const startsOn = computed(() => props.drafted ?? props.shown)
function shownConnection(provider: Provider): string | undefined {
  return provider === (props.shown?.provider ?? props.providers[0])
    ? (props.connectionId ?? props.shown?.connectionId)
    : undefined
}
function readConnection(provider: Provider): string | undefined {
  return isOpen.value && selectedProvider.value === provider
    ? selectedConnectionId.value
    : shownConnection(provider)
}
function listOf(provider: Provider, forFace = false): ModelList | null {
  const connectionId = forFace ? shownConnection(provider) : readConnection(provider)
  const held = store.value.held(provider, props.profileId, connectionId)
  return held?.state === 'answered' ? held.list : null
}
const reportedSays = computed(() => words.reported(props.reported, props.shown, props.providers))
const faceWords = computed(() =>
  words.face(props, (provider) => listOf(provider, true), store.value, props.profileId),
)

let selectionRead = 0
let selectionPublished = 0
let draftEdit = 0
let opening = 0
let focusWhileWaiting: Element | null | undefined
const resolvedReadiness = ref<Readonly<Partial<Record<Provider, boolean | null>>> | null>(null)
function suppliedReady(provider: Provider): boolean | null {
  const connectionId = readConnection(provider)
  if (connectionId !== undefined)
    return store.value.choices(provider, props.profileId, connectionId)?.ready ?? null
  return props.readiness !== null && provider in props.readiness
    ? (props.readiness[provider] ?? null)
    : (store.value.choices(provider, props.profileId)?.ready ?? null)
}
const sections = computed(() =>
  props.providers.map((provider) =>
    modelPickerSection(
      store.value,
      provider,
      props.profileId,
      readConnection(provider) === undefined &&
        resolvedReadiness.value !== null &&
        provider in resolvedReadiness.value
        ? (resolvedReadiness.value[provider] ?? null)
        : suppliedReady(provider),
      (!props.chooseConnection && startsOn.value?.connectionId === undefined) ||
        startsOn.value?.connectionId === readConnection(provider)
        ? startsOn.value
        : null,
      props.capabilities,
      providerName(provider),
      props.chooseConnection && selectedProvider.value === provider
        ? selectedConnectionId.value
        : undefined,
      readConnection(provider),
    ),
  ),
)
const showsConnections = computed(
  () => props.chooseConnection && sections.value.some((section) => section.connections.length > 0),
)
const visibleSections = computed(() =>
  props.providers.length > 1
    ? sections.value.filter((section) => section.provider === selectedProvider.value)
    : sections.value,
)

const unlistedConnection = computed(() =>
  words.unlistedConnection(props, visibleSections.value, selectedConnectionId.value),
)

async function selectProvider(
  provider: Provider,
  edited = true,
  connectionId?: string,
  keepEmpty = false,
): Promise<void> {
  if (
    edited &&
    !props.chooseConnection &&
    connectionId === undefined &&
    suppliedReady(provider) !== true
  )
    return
  if (edited) draftEdit++
  const edit = draftEdit
  const read = selectionRead
  selectedProvider.value = provider
  selectedConnectionId.value = connectionId
  adding.value = null
  draft.value = null
  chosenEffort.value = null
  refusal.value = null
  if (edited && props.chooseConnection && connectionId === undefined) {
    await store.value.read(provider, props.profileId, { once: true })
    if (!isOpen.value || read !== selectionRead || edit !== draftEdit) return
    connectionId = store.value.choices(provider, props.profileId)?.defaultConnectionId
    selectedConnectionId.value = connectionId
  }
  await store.value.read(provider, props.profileId, { once: !edited, connectionId })
  if (
    !isOpen.value ||
    read !== selectionRead ||
    edit !== draftEdit ||
    selectedProvider.value !== provider ||
    selectedConnectionId.value !== connectionId
  )
    return
  if (keepEmpty) return
  const list = listOf(provider)
  const shown = startsOn.value?.provider === provider ? startsOn.value : null
  const starts =
    shown !== null &&
    ((!props.chooseConnection && shown.connectionId === undefined) ||
      shown.connectionId === connectionId ||
      (list !== null && theListedRow(list.models, shown.model) !== undefined))
      ? shown
      : (store.value.choices(provider, props.profileId, connectionId)?.defaultModel ?? null)
  draft.value = starts === null ? null : { provider, model: inTheListsSpelling(list, starts.model) }
  chosenEffort.value = starts?.effort ?? null
}
function requestSetup(provider: Provider): void {
  hide()
  props.setUp?.(provider)
}
async function retry(provider: Provider): Promise<void> {
  await store.value.read(provider, props.profileId, { connectionId: readConnection(provider) })
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
const pick = computed<PickedModel | null>(() =>
  draft.value === null ||
  draftEffort.value === undefined ||
  sections.value.find((section) => section.provider === draft.value?.provider)?.selectable !== true
    ? null
    : {
        ...draft.value,
        effort: draftEffort.value,
        ...(!props.chooseConnection || selectedConnectionId.value === undefined
          ? {}
          : { connectionId: selectedConnectionId.value }),
      },
)
const levels = computed(() => (offered.value?.known === true ? offered.value.levels : []))
const effortWords = computed(() =>
  words.effort(draft.value, offered.value, draftEffort.value, props.profileId),
)
const effortDescription = computed(() => effortWords.value.description)
const effortSilence = computed(() => effortWords.value.silence)
const effortWanted = computed(() => effortWords.value.wanted)
const reachesSays = computed(() =>
  props.recordedConnection
    ? null
    : pick.value === null || props.reaches === undefined
      ? null
      : props.reaches(pick.value, draftList.value),
)
function hide(): void {
  const element = panel.value
  if (element !== null && element.matches(':popover-open')) element.hidePopover()
}

function openedFrom(button: HTMLElement, at: 'model' | 'effort'): void {
  if (opener !== button) opener?.style.removeProperty('anchor-name')
  opener = button
  openAt = at
  button.style.setProperty('anchor-name', anchor)
}

function giveFocusBack(): void {
  ;(opener ?? face.value)?.focus()
}

function anEffort(): HTMLElement | null {
  const efforts = panel.value?.querySelector('[data-cy="model-picker-efforts"]')
  return (
    efforts?.querySelector<HTMLElement>('input:checked') ??
    efforts?.querySelector<HTMLElement>('input') ??
    null
  )
}

watch(
  () => props.providers.join('\u0000'),
  () => {
    if (!isOpen.value) return
    void seed()
    for (const provider of props.providers)
      void store.value.read(provider, props.profileId, { connectionId: readConnection(provider) })
  },
)
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
  () => props.providers.map((provider) => `${provider}:${suppliedReady(provider)}`).join(','),
  () => {
    if (
      isOpen.value &&
      selectedConnectionId.value === undefined &&
      (!props.chooseConnection || draftEdit === 0)
    )
      void seed(true)
  },
)
watch(
  () => props.programs,
  () => {
    if (isOpen.value) void seed(true)
  },
)

async function seed(keepDraft = false): Promise<void> {
  const ours = ++selectionRead
  const edit = draftEdit
  const preferred = (keepDraft ? selectedProvider.value : null) ?? startsOn.value?.provider ?? null
  const requestedConnection = props.chooseConnection
    ? ((keepDraft ? selectedConnectionId.value : undefined) ??
      startsOn.value?.connectionId ??
      shownConnection(preferred ?? props.providers[0]!))
    : shownConnection(preferred ?? props.providers[0]!)
  if (!keepDraft) {
    resolvedReadiness.value = null
    draft.value = null
    chosenEffort.value = null
    selectedProvider.value = preferred
    selectedConnectionId.value = requestedConnection
  }
  try {
    const answer = await store.value.resolve({
      profileId: props.profileId,
      askedProvider: preferred,
      ...(requestedConnection === undefined ? {} : { askedConnectionId: requestedConnection }),
      providers: props.providers.map((provider) => {
        const program = props.programs?.[provider]
        return {
          provider,
          ready: suppliedReady(provider),
          program: program === undefined ? null : { standing: program.standing },
        }
      }),
    })
    if (!isOpen.value || ours !== selectionRead) return
    selectionPublished = ours
    resolvedReadiness.value = Object.fromEntries(
      answer.readiness.map(({ provider, ready }) => [provider, ready]),
    )
    if (edit !== draftEdit) return
    const provider = answer.pickerProvider
    const keepEmpty =
      startsOn.value === null && (props.providers.length === 1 || provider === preferred)
    const connectionId =
      props.recordedConnection && requestedConnection === undefined
        ? undefined
        : props.chooseConnection
          ? (answer.connectionId ?? requestedConnection)
          : requestedConnection
    if (!(
      keepDraft &&
      provider === selectedProvider.value &&
      connectionId === selectedConnectionId.value &&
      draft.value !== null
    )) {
      if (provider === null) {
        selectedProvider.value = null
        selectedConnectionId.value = undefined
        draft.value = null
        chosenEffort.value = null
      } else await selectProvider(provider, false, connectionId, keepEmpty)
    }
    await focusArrived(ours)
  } catch (error) {
    if (isOpen.value && ours === selectionRead) refusal.value = readableError(error)
  }
}

watch(
  [
    () => props.shown?.provider ?? props.providers[0],
    () => shownConnection(props.shown?.provider ?? props.providers[0]!),
    () => props.profileId,
    () => props.readOnly,
  ],
  (next, before) => {
    if (next[2] !== before[2]) draftEdit = 0
    const provider = props.shown?.provider ?? props.providers[0]
    if (!props.readOnly && provider !== undefined && shownConnection(provider) !== undefined)
      void store.value.read(provider, props.profileId, {
        once: true,
        connectionId: shownConnection(provider),
      })
    if (isOpen.value && (!props.chooseConnection || draftEdit === 0)) void seed()
  },
  { immediate: true },
)

function onBeforeToggle(event: Event): void {
  if ((event as ToggleEvent).newState === 'open') void open()
}
function onToggle(event: Event): void {
  if ((event as ToggleEvent).newState === 'closed') close()
}
function rowToFocus(): HTMLElement | null {
  const row =
    panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-connection"] input:checked') ??
    panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-row"] input:checked') ??
    panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-row"] input') ??
    panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-add-open"]') ??
    null
  return openAt === 'effort' ? (anEffort() ?? row) : row
}
async function focusArrived(read = selectionRead): Promise<void> {
  await nextTick()
  if (
    !isOpen.value ||
    read !== selectionRead ||
    selectionPublished !== read ||
    focusWhileWaiting === undefined
  )
    return
  if (document.activeElement !== focusWhileWaiting) {
    focusWhileWaiting = undefined
    return
  }
  const arrived = rowToFocus()
  if (arrived !== null) {
    focusWhileWaiting = undefined
    arrived.focus()
  }
}

async function open(): Promise<void> {
  const ours = ++opening
  draftEdit = 0
  focusWhileWaiting = undefined
  isOpen.value = true
  resolvedReadiness.value = null
  refusal.value = null
  listSaid.value = {}
  adding.value = null
  addName.value = ''
  void seed()
  const reads = props.providers.map((provider) =>
    store.value.read(provider, props.profileId, { connectionId: readConnection(provider) }),
  )
  await nextTick()
  if (!isOpen.value || ours !== opening) return
  const first = rowToFocus()
  first?.focus()
  if (first != null && (openAt !== 'effort' || anEffort() !== null)) return
  focusWhileWaiting = document.activeElement
  await Promise.allSettled(reads)
  if (ours === opening) await focusArrived()
}

function close(): void {
  selectionRead++
  opening++
  focusWhileWaiting = undefined
  isOpen.value = false
  openAt = 'model'
  draft.value = null
  adding.value = null
  addName.value = ''
  refusal.value = null
}

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
  selectionRead++
  opening++
  focusWhileWaiting = undefined
  window.removeEventListener('keydown', onEscape, { capture: true })
  opener?.style.removeProperty('anchor-name')
})

defineExpose({ panelId, isOpen, openedFrom, faceWords, reportedSays })

function draftModel(provider: Provider, model: string): void {
  if (sections.value.find((section) => section.provider === provider)?.selectable !== true) return
  draftEdit++
  draft.value = { provider, model }
  refusal.value = null
}

function draftAnEffort(effort: string): void {
  draftEdit++
  chosenEffort.value = effort
  refusal.value = null
}

async function commit(): Promise<void> {
  const chosen = pick.value
  if (
    chosen === null ||
    props.readOnly ||
    busy.value ||
    sections.value.find((section) => section.provider === chosen.provider)?.selectable !== true
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

async function openAdd(provider: Provider): Promise<void> {
  if (
    props.readOnly ||
    sections.value.find((section) => section.provider === provider)?.ready !== true
  )
    return
  adding.value = provider
  addName.value = ''
  listSaid.value = { ...listSaid.value, [provider]: undefined }
  await nextTick()
  panel.value?.querySelector<HTMLElement>('[data-cy="model-picker-add-name"]')?.focus()
}

async function add(provider: Provider): Promise<void> {
  const id = addName.value.trim()
  if (
    id === '' ||
    props.readOnly ||
    busy.value ||
    sections.value.find((section) => section.provider === provider)?.ready !== true
  )
    return
  const name = providerName(provider) ?? 'this provider'
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

async function remove(provider: Provider, id: string): Promise<void> {
  if (props.readOnly || busy.value) return
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
                :disabled="!props.chooseConnection && section.ready !== true"
                @change="selectProvider(section.provider)"
              />
              <span>{{ section.name }}{{ props.chooseConnection ? '' : section.readyWords }}</span>
            </label>
            <button
              v-if="!props.chooseConnection && section.ready === false && props.setUp"
              type="button"
              class="add-open"
              :data-cy="`model-picker-setup-${section.provider}`"
              @click="requestSetup(section.provider)"
            >
              Set up in Settings
            </button>
            <span
              v-if="!props.chooseConnection && section.ready !== true && section.field.retry"
              class="said"
              data-cy="model-picker-said"
              :title="section.field.detail"
              >{{ section.field.message }}</span
            >
            <button
              v-if="!props.chooseConnection && section.ready !== true && section.field.retry"
              type="button"
              class="add-open"
              data-cy="model-picker-retry"
              @click="retry(section.provider)"
            >
              Try again
            </button>
          </div>
        </fieldset>

        <fieldset v-if="showsConnections" class="provider-choices connection-choices">
          <legend>Connection</legend>
          <p v-if="unlistedConnection" class="said" data-cy="model-picker-recorded-connection">
            {{ unlistedConnection }}
          </p>
          <template v-for="section in visibleSections" :key="section.provider">
            <label
              v-for="connection in section.connections"
              :key="connection.id"
              class="pick"
              data-cy="model-picker-connection"
              :data-connection="connection.id"
            >
              <input
                type="radio"
                :name="`${panelId}-connection`"
                :checked="selectedConnectionId === connection.id"
                @change="selectProvider(section.provider, true, connection.id)"
              />
              <span>{{
                connection.id === props.connectionId && props.connectionName !== undefined
                  ? props.connectionName
                  : connection.name
              }}</span>
            </label>
          </template>
        </fieldset>

        <section
          v-for="section in visibleSections"
          :key="section.provider"
          class="provider"
          data-cy="model-picker-provider"
          :data-provider="section.provider"
        >
          <h4>{{ showsConnections || props.recordedConnection ? 'Model' : section.name }}</h4>
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
            v-for="one in section.selectable ? section.rows : []"
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
                :disabled="props.readOnly"
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
                <span
                  v-if="
                    one.row?.description &&
                    draft?.provider === section.provider &&
                    sameModel(draft.model, one.id)
                  "
                  class="description"
                  >{{ one.row.description }}</span
                >
              </span>
            </label>
            <button
              v-if="!props.readOnly && one.row?.addedBy === 'a-person'"
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

          <div v-if="!props.readOnly && adding === section.provider" class="adding">
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
            v-else-if="!props.readOnly && section.ready === true"
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
              :disabled="props.readOnly"
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
              :disabled="props.readOnly || busy || pick === null"
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
.provider-choices.connection-choices {
  display: grid;
}
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

.panel {
  position: fixed;
  width: min(24rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  margin: 0;
  background: var(--panel-3);
  box-shadow: var(--shadow);
  color: var(--text-soft);
  font-size: var(--type-caption);
  inset: auto;
  overflow: hidden;
  position-area: span-all span-inline-end;
  position-try-fallbacks: flip-inline;
}

.panel:popover-open {
  display: flex;
}

.inside {
  display: flex;
  min-height: 0;
  max-height: inherit;
  box-sizing: border-box;
  flex-direction: column;
  padding: var(--space-2) var(--space-4) 0;
  gap: var(--space-4);
}

.inside > :not(.provider) {
  flex-shrink: 0;
}

.provider {
  display: flex;
  min-height: 4rem;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
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

/* Only the model section scrolls; effort and the buttons remain in view. */
.foot {
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
