<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import type {
  MethodBody,
  MethodChangeResult,
  MethodChangeSummary,
  MethodDeleteSelection,
  MethodLibrary,
  MethodLibraryItem,
  MethodProblem,
} from '../../../shared/saved-method-library'
import { fullTime } from '../lib/clock'

type MethodsBridge = Pick<
  RuntimeBridge,
  | 'agentMethods'
  | 'agentMethodBody'
  | 'agentMethodChanges'
  | 'removeAgentMethod'
  | 'undoAgentMethod'
  | 'checkInterruptedAgentMethods'
>
const props = defineProps<{ profileSlug: string; bridge?: MethodsBridge }>()
const bridge = computed(
  () => props.bridge ?? (typeof window === 'undefined' ? undefined : window.api?.runtime),
)
const PAGE = 20
const library = ref<MethodLibrary | null>(null)
const inventoryLoading = ref(false)
const inventoryError = ref<string | null>(null)
const offset = ref(0)
const historyOffset = ref(0)
const history = ref<readonly MethodChangeSummary[]>([])
const historyLoading = ref(false)
const historyError = ref<string | null>(null)
const historyNext = ref(false)
const selected = ref<{
  profileId: string
  item: MethodLibraryItem
  indexState: MethodLibrary['indexState']
  indexFingerprint: string | null
  truncated: boolean
} | null>(null)
const body = ref<MethodBody | null>(null)
const bodyLoading = ref(false)
const bodyError = ref<string | null>(null)
type Preview =
  | {
      kind: 'delete'
      profileId: string
      name: string
      itemKind: MethodLibraryItem['kind']
      text: string | null
      selection: MethodDeleteSelection
    }
  | { kind: 'undo'; profileId: string; change: MethodChangeSummary }
  | { kind: 'check'; profileId: string }
const preview = ref<Preview | null>(null)
const previewRefused = ref(false)
const busy = ref(false)
const message = ref<string | null>(null)
let epoch = 0
let activeProfile = props.profileSlug
let inventorySequence = 0
let historySequence = 0
let bodySequence = 0

const problems: Record<MethodProblem, string> = {
  missing: 'The file is missing.',
  link: 'This is a link. It is read-only here.',
  'not-a-file': "This isn't a regular file. It is read-only here.",
  'too-large': 'This file is too large to read here.',
  unreadable: "BroCrew couldn't read this file.",
}
const refusals: Record<string, string> = {
  'changed-or-unreadable':
    "The files changed or couldn't be read. Cancel this preview and read them again.",
  'not-latest-change':
    'A newer change prevents this Undo. Cancel this preview and read the history again.',
  'nothing-to-restore': "This change can't be undone against the current files.",
  'unfinished-change': 'An interrupted change needs to be checked first.',
  'history-unreadable':
    "BroCrew couldn't read the change history. Read it again before trying a change.",
  'no-interrupted-change': 'There is no interrupted change to check.',
  'settlement-pending': "The observation couldn't be recorded. Read the history again.",
  'confirmation-required': 'Confirm the preview before making this change.',
  'person-required': 'Only a person can make this change.',
  'no-such-agent': 'This agent is no longer available.',
  'unsafe-name': "This file can't be changed here.",
  'change-not-started': "The change couldn't be started. Read the files and history again.",
  'bad-pagination': "This page couldn't be read. Return to the first page.",
}
function refusal(reason: string): string {
  return (
    refusals[reason] ?? "BroCrew couldn't complete this action. Read the files and history again."
  )
}
function sourceDate(change: MethodChangeSummary): string | null {
  const source = history.value.find((one) => one.id === change.sourceId)
  return source ? fullTime(source.createdAt) : null
}
function status(change: MethodChangeSummary): string {
  if (change.noEffect) return 'No change'
  if (change.outcome === 'pending') return 'Needs checking.'
  if (change.outcome === 'partial') return 'Only partly finished.'
  return 'Done'
}
function observer(change: MethodChangeSummary): string {
  if (change.settlement?.by.who === 'a-person')
    return 'Recorded after a person asked BroCrew to check the files.'
  if (change.settlement?.by.who === 'the-app-itself')
    return 'Recorded by BroCrew from what it found in the files.'
  return change.outcome === 'pending'
    ? 'No observation recorded yet.'
    : 'Not known who checked this.'
}
const canDelete = computed(() => {
  const one = selected.value
  if (
    !one ||
    one.profileId !== props.profileSlug ||
    !one.item.canDelete ||
    one.truncated ||
    one.indexState === 'problem'
  )
    return false
  if (one.item.kind === 'missing-reference')
    return one.item.fingerprint === null && one.item.problem === 'missing'
  return (
    !one.item.problem &&
    body.value?.ok === true &&
    body.value.key === one.item.key &&
    body.value.fingerprint === one.item.fingerprint
  )
})
const staleBody = computed(
  () =>
    selected.value &&
    body.value?.ok &&
    (body.value.key !== selected.value.item.key ||
      body.value.fingerprint !== selected.value.item.fingerprint),
)

async function readInventory(): Promise<void> {
  const api = bridge.value
  const generation = epoch
  const sequence = ++inventorySequence
  const profileId = props.profileSlug
  const pageOffset = offset.value
  inventoryLoading.value = true
  inventoryError.value = null
  try {
    const answer = api
      ? await api.agentMethods({ profileId, offset: pageOffset, limit: PAGE })
      : null
    if (generation !== epoch || sequence !== inventorySequence) return
    library.value = answer
    if (!answer) inventoryError.value = "Saved methods aren't available for this agent."
  } catch {
    if (generation !== epoch || sequence !== inventorySequence) return
    library.value = null
    inventoryError.value = "BroCrew couldn't read the saved methods. Read them again."
  } finally {
    if (generation === epoch && sequence === inventorySequence) inventoryLoading.value = false
  }
}
async function readHistory(): Promise<void> {
  const api = bridge.value
  const generation = epoch
  const sequence = ++historySequence
  const profileId = props.profileSlug
  const pageOffset = historyOffset.value
  historyLoading.value = true
  historyError.value = null
  try {
    const answer = api
      ? await api.agentMethodChanges({ profileId, offset: pageOffset, limit: PAGE + 1 })
      : null
    if (generation !== epoch || sequence !== historySequence) return
    history.value = answer?.ok ? answer.changes.slice(0, PAGE) : []
    historyNext.value = answer?.ok === true && answer.changes.length > PAGE
    if (!answer?.ok)
      historyError.value = answer
        ? refusal(answer.reason)
        : "Change history isn't available for this agent."
  } catch {
    if (generation !== epoch || sequence !== historySequence) return
    history.value = []
    historyNext.value = false
    historyError.value = "BroCrew couldn't read the change history. Read it again."
  } finally {
    if (generation === epoch && sequence === historySequence) historyLoading.value = false
  }
}
function clearSelection(): void {
  bodySequence++
  selected.value = null
  body.value = null
  bodyError.value = null
  bodyLoading.value = false
}
function refresh(): void {
  if (busy.value) return
  if (!preview.value) clearSelection()
  void readInventory()
  void readHistory()
}
async function select(item: MethodLibraryItem): Promise<void> {
  const api = bridge.value
  const reading = library.value
  if (
    !reading ||
    activeProfile !== props.profileSlug ||
    busy.value ||
    preview.value ||
    inventoryLoading.value
  )
    return
  clearSelection()
  const generation = epoch
  const sequence = ++bodySequence
  const profileId = props.profileSlug
  selected.value = {
    profileId,
    item: { ...item, references: item.references.map((one) => ({ ...one })) },
    indexState: reading.indexState,
    indexFingerprint: reading.indexFingerprint,
    truncated: reading.truncated,
  }
  if (item.problem) return
  bodyLoading.value = true
  try {
    const answer = api ? await api.agentMethodBody({ profileId, key: item.key }) : null
    if (generation !== epoch || sequence !== bodySequence) return
    body.value = answer
    if (!answer) bodyError.value = "BroCrew couldn't read this method. Read the files again."
    else if (!answer.ok) bodyError.value = problems[answer.problem]
    if (!answer?.ok || answer.key !== item.key || answer.fingerprint !== item.fingerprint) {
      void readInventory()
      void readHistory()
    }
  } catch {
    if (generation !== epoch || sequence !== bodySequence) return
    bodyError.value = "BroCrew couldn't read this method. Read the files again."
    void readInventory()
    void readHistory()
  } finally {
    if (generation === epoch && sequence === bodySequence) bodyLoading.value = false
  }
}
function previewDelete(): void {
  const one = selected.value
  if (!one || !canDelete.value || busy.value || preview.value) return
  previewRefused.value = false
  message.value = null
  preview.value = {
    kind: 'delete',
    profileId: one.profileId,
    name: one.item.name,
    itemKind: one.item.kind,
    text: body.value?.ok ? body.value.text : null,
    selection: {
      confirmed: true,
      key: one.item.key,
      fingerprint: one.item.fingerprint,
      indexState: one.indexState,
      indexFingerprint: one.indexFingerprint,
    },
  }
}
function previewUndo(change: MethodChangeSummary): void {
  if (activeProfile !== props.profileSlug || !change.canUndo || busy.value || preview.value) return
  previewRefused.value = false
  message.value = null
  preview.value = { kind: 'undo', profileId: props.profileSlug, change: { ...change } }
}
function previewCheck(): void {
  if (activeProfile !== props.profileSlug || busy.value || preview.value) return
  previewRefused.value = false
  message.value = null
  preview.value = { kind: 'check', profileId: props.profileSlug }
}
function cancel(): void {
  if (busy.value) return
  preview.value = null
  previewRefused.value = false
  message.value = null
  clearSelection()
  refresh()
}
async function confirm(): Promise<void> {
  const api = bridge.value
  const captured = preview.value
  if (
    !api ||
    !captured ||
    captured.profileId !== props.profileSlug ||
    busy.value ||
    previewRefused.value
  )
    return
  const generation = epoch
  busy.value = true
  message.value = null
  try {
    let result: MethodChangeResult
    if (captured.kind === 'delete')
      result = await api.removeAgentMethod({
        profileId: captured.profileId,
        selection: { ...captured.selection },
      })
    else if (captured.kind === 'undo')
      result = await api.undoAgentMethod({
        profileId: captured.profileId,
        changeId: captured.change.id,
      })
    else
      result = await api.checkInterruptedAgentMethods({
        profileId: captured.profileId,
        confirmed: true,
      })
    if (generation !== epoch) return
    if (!result.ok) {
      message.value = refusal(result.reason)
      previewRefused.value = true
    } else {
      message.value =
        captured.kind === 'check'
          ? `Check recorded. ${status(result.change)}`
          : status(result.change)
      preview.value = null
      clearSelection()
      historyOffset.value = 0
    }
  } catch {
    if (generation !== epoch) return
    previewRefused.value = true
    message.value =
      "BroCrew couldn't confirm the result. Read the files and history before trying again."
  } finally {
    if (generation === epoch) {
      busy.value = false
      void readInventory()
      void readHistory()
    }
  }
}
watch(
  () => [props.profileSlug, props.bridge] as const,
  () => {
    epoch++
    activeProfile = props.profileSlug
    clearSelection()
    library.value = null
    history.value = []
    historyNext.value = false
    offset.value = 0
    historyOffset.value = 0
    preview.value = null
    previewRefused.value = false
    busy.value = false
    message.value = null
    void readInventory()
    void readHistory()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  epoch++
  inventorySequence++
  historySequence++
  bodySequence++
})
function inventoryPage(next: number): void {
  if (busy.value || preview.value || inventoryLoading.value) return
  offset.value = next
  clearSelection()
  void readInventory()
}
function historyPage(next: number): void {
  if (busy.value || preview.value || historyLoading.value) return
  historyOffset.value = next
  void readHistory()
}
</script>

<template>
  <section class="saved-methods" data-cy="saved-methods" aria-label="Saved methods">
    <div class="controls">
      <h3>Saved methods</h3>
      <button
        type="button"
        data-cy="methods-refresh"
        :disabled="busy || inventoryLoading || historyLoading"
        @click="refresh"
      >
        Read again
      </button>
    </div>
    <p v-if="message" role="status" data-cy="methods-message">{{ message }}</p>
    <p v-if="inventoryLoading" class="note" role="status" data-cy="methods-loading">
      Reading saved methods…
    </p>
    <p v-if="inventoryError" role="alert" data-cy="methods-error">{{ inventoryError }}</p>
    <template v-if="library && !inventoryLoading">
      <p class="note">Read {{ fullTime(library.readAt) }}.</p>
      <p v-if="library.state === 'missing'" data-cy="methods-missing">
        The saved methods folder hasn't been created yet.
      </p>
      <p v-else-if="library.state === 'unavailable'" role="alert" data-cy="methods-unavailable">
        Saved methods couldn't be read. {{ library.problem ? problems[library.problem] : '' }}
      </p>
      <template v-else>
        <p v-if="library.indexState === 'absent'" class="note" data-cy="methods-index-absent">
          There is no index file.
        </p>
        <p v-if="library.indexState === 'problem'" role="alert" data-cy="methods-index-problem">
          The index couldn't be read.
          {{ library.indexProblem ? problems[library.indexProblem] : '' }} You can't delete anything
          until it can.
        </p>
        <p v-if="library.truncated" role="alert" data-cy="methods-truncated">
          This list is incomplete, so you can't delete from it.
        </p>
        <p v-if="library.malformedLines" class="note">
          Index lines BroCrew couldn't understand: {{ library.malformedLines }}.
        </p>
        <p v-if="library.total === 0" class="note" data-cy="methods-empty">
          No saved methods were found.
        </p>
        <ul class="items" data-cy="methods-items">
          <li v-for="item in library.items" :key="item.key" data-cy="methods-item">
            <button
              type="button"
              data-cy="method-open"
              :aria-pressed="selected?.item.key === item.key"
              :disabled="busy || !!preview"
              @click="select(item)"
            >
              {{ item.name }}
            </button>
            <p class="note">
              {{
                item.kind === 'index'
                  ? 'Index file'
                  : item.kind === 'missing-reference'
                    ? 'Missing referenced file'
                    : item.references.length
                      ? 'Indexed method'
                      : 'Unindexed method'
              }}
            </p>
            <p v-for="(reference, i) in item.references" :key="i" class="note">
              {{ reference.title }} · {{ reference.when }} · verified {{ reference.verified }}
            </p>
            <p v-if="item.problem" class="note">{{ problems[item.problem] }}</p>
          </li>
        </ul>
        <nav class="controls" aria-label="Saved method pages">
          <button
            type="button"
            data-cy="methods-previous"
            :disabled="busy || !!preview || offset === 0"
            @click="inventoryPage(Math.max(0, offset - PAGE))"
          >
            Previous methods
          </button>
          <span class="note"
            >{{ library.total ? library.offset + 1 : 0 }}–{{
              library.offset + library.items.length
            }}
            of {{ library.total }}</span
          >
          <button
            type="button"
            data-cy="methods-next"
            :disabled="busy || !!preview || library.nextOffset === null"
            @click="inventoryPage(library.nextOffset ?? offset)"
          >
            Next methods
          </button>
        </nav>
      </template>
    </template>
    <section
      v-if="selected"
      class="card"
      data-cy="method-reading"
      aria-label="Selected saved method"
    >
      <h4>{{ selected.item.name }}</h4>
      <p v-if="bodyLoading" class="note" role="status">Reading method…</p>
      <p v-if="bodyError" role="alert" data-cy="method-body-error">{{ bodyError }}</p>
      <p v-if="selected.item.problem" class="note">{{ problems[selected.item.problem] }}</p>
      <pre
        v-if="body?.ok"
        class="method-text"
        data-cy="method-body"
        tabindex="0"
        aria-label="Method text"
        >{{ body.text }}</pre>
      <p v-if="staleBody" role="alert" data-cy="method-stale">
        The file changed since the list was read. Read the files again before deleting.
      </p>
      <button
        v-if="selected.item.canDelete && !selected.truncated"
        type="button"
        data-cy="method-delete"
        :disabled="busy || !!preview || !canDelete"
        @click="previewDelete"
      >
        Delete…
      </button>
    </section>

    <section
      v-if="preview"
      class="card"
      data-cy="method-confirmation"
      aria-label="Confirm saved method action"
    >
      <template v-if="preview.kind === 'delete'">
        <h4>Delete {{ preview.name }}?</h4>
        <pre
          v-if="preview.text !== null"
          class="method-text"
          tabindex="0"
          aria-label="Text selected for deletion"
          >{{ preview.text }}</pre>
        <p v-if="preview.itemKind === 'index'" data-cy="method-index-warning">
          This deletes the index, so new conversations aren't told about any saved method. The
          method files stay.
        </p>
        <p v-else-if="preview.itemKind === 'missing-reference'">
          This removes the index references to this missing file.
        </p>
        <p v-else>This deletes this method file and removes its index references.</p>
        <p class="note">You can undo this as long as the files haven't changed since.</p>
      </template>
      <template v-else-if="preview.kind === 'undo'">
        <h4>Undo the change to {{ preview.change.target }}?</h4>
        <p class="note">
          {{ fullTime(preview.change.createdAt) }} ·
          {{ preview.change.operation === 'delete' ? 'Delete' : 'Undo' }} · by a person
        </p>
        <p>BroCrew puts the files back as they were, if they haven't changed since.</p>
      </template>
      <template v-else>
        <h4>Check the interrupted change?</h4>
        <p>This records what's in the files now. It doesn't restore anything.</p>
      </template>
      <p v-if="previewRefused" class="note">
        Something changed since this preview. Cancel it, read again, then try again.
      </p>
      <div class="controls">
        <button
          type="button"
          data-cy="method-confirm"
          :disabled="busy || previewRefused"
          @click="confirm"
        >
          {{
            busy
              ? 'Working…'
              : preview.kind === 'delete'
                ? 'Delete this item'
                : preview.kind === 'undo'
                  ? 'Undo this change'
                  : 'Check and record'
          }}
        </button>
        <button type="button" data-cy="method-cancel" :disabled="busy" @click="cancel">
          Cancel
        </button>
      </div>
    </section>

    <section class="history" aria-label="Saved method change history" data-cy="methods-history">
      <h3>Change history</h3>
      <p v-if="historyLoading" class="note" role="status">Reading change history…</p>
      <p v-if="historyError" role="alert" data-cy="methods-history-error">{{ historyError }}</p>
      <template v-if="!historyLoading && !historyError">
        <p v-if="history.length === 0" class="note">No changes on this page.</p>
        <button
          v-if="history.some((one) => one.outcome === 'pending')"
          type="button"
          data-cy="methods-check"
          :disabled="busy || !!preview"
          @click="previewCheck"
        >
          Check interrupted change…
        </button>
        <ol class="items">
          <li v-for="change in history" :key="change.id" class="card" data-cy="method-change">
            <p>
              {{ change.operation === 'delete' ? 'Delete' : 'Undo' }} · {{ change.target }} ·
              {{ fullTime(change.createdAt) }}
            </p>
            <p class="note">Done by a person.</p>
            <p data-cy="method-change-status">{{ status(change) }}</p>
            <p class="note">
              {{ observer(change)
              }}<template v-if="change.settlement"> {{ fullTime(change.settlement.at) }}.</template>
            </p>
            <p v-if="change.sourceId" class="note">
              {{
                sourceDate(change)
                  ? `Undoes the change of ${sourceDate(change)}.`
                  : 'Undoes an earlier change.'
              }}
            </p>
            <button
              v-if="change.canUndo"
              type="button"
              data-cy="method-undo"
              :disabled="busy || !!preview"
              @click="previewUndo(change)"
            >
              Undo…
            </button>
          </li>
        </ol>
      </template>
      <nav class="controls" aria-label="Change history pages">
        <button
          type="button"
          data-cy="history-previous"
          :disabled="busy || !!preview || historyLoading || historyOffset === 0"
          @click="historyPage(Math.max(0, historyOffset - PAGE))"
        >
          Previous changes
        </button>
        <button
          type="button"
          data-cy="history-next"
          :disabled="busy || !!preview || historyLoading || !!historyError || !historyNext"
          @click="historyPage(historyOffset + PAGE)"
        >
          Next changes
        </button>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.saved-methods,
.history,
.card,
.items {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.saved-methods {
  width: 100%;
}
.saved-methods h3,
.saved-methods h4,
.saved-methods p {
  margin: 0;
  overflow-wrap: anywhere;
}
.saved-methods h4 {
  font-size: inherit;
}
.note {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}
[role='alert'] {
  color: var(--danger);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
}
.items > li,
.card {
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
}
.card {
  background: var(--panel-2);
}
.method-text {
  margin: 0;
  padding: var(--space-3);
  max-height: 240px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font: inherit;
  background: var(--code-bg);
  border-radius: var(--radius-sm);
}
</style>
