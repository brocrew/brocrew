<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Provider } from '@brobot2/shared'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import {
  AMENDMENT_MEANS,
  MEMORY_STORE_IS,
  REFUSAL_MEANS,
  type AgentMemoryEntry,
  type AgentMemoryReading,
  type AgentMemoryAmended,
  type MemoryAmendment,
  type MemoryChecked,
} from '../../../shared/agent-memory'
import { fullTime } from '../lib/clock'
import { didIt } from '../../../shared/who-did-it'

type MemoryBridge = Pick<
  RuntimeBridge,
  'agentMemory' | 'amendAgentMemory' | 'undoAgentMemory' | 'checkInterruptedMemory'
>
const props = defineProps<{ profileSlug: string; bridge?: MemoryBridge }>()
const api = computed(() => props.bridge ?? window.api?.runtime)
const reading = ref<AgentMemoryReading | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const offsets = ref<Partial<Record<Provider, number>>>({})
const storeReadAt = ref<Partial<Record<Provider, number>>>({})
const replacement = ref('')
const replacementBytes = computed(() => new TextEncoder().encode(replacement.value).byteLength)
type Preview =
  | {
      kind: 'removed' | 'corrected'
      profile: string
      provider: Provider
      entry: string
      before: string
    }
  | { kind: 'undo'; profile: string; source: MemoryAmendment }
  | { kind: 'check'; profile: string }
const preview = ref<Preview | null>(null)
let epoch = 0
let request = 0
const blocked = computed(
  () =>
    loading.value ||
    busy.value ||
    error.value !== null ||
    reading.value?.changing === true ||
    reading.value?.needsChecking === true,
)

function accept(value: AgentMemoryReading) {
  reading.value = value
  offsets.value = {}
  storeReadAt.value = Object.fromEntries(
    value.stores.map((store) => [store.provider, value.readAt]),
  )
}
async function read(provider?: Provider, offset = 0) {
  const generation = epoch
  const sequence = ++request
  const profileId = props.profileSlug
  loading.value = true
  error.value = null
  try {
    const value = await api.value?.agentMemory({ profileId, offset, limit: 20 })
    if (generation !== epoch || sequence !== request) return
    if (!value || value.profileId !== profileId) throw new Error('reading unavailable')
    if (provider && reading.value) {
      const selected = value.stores.find((store) => store.provider === provider)
      if (!selected) throw new Error('store unavailable')
      reading.value = {
        ...value,
        stores: reading.value.stores.map((store) =>
          store.provider === provider ? selected : store,
        ),
      }
      offsets.value = { ...offsets.value, [provider]: offset }
      storeReadAt.value = { ...storeReadAt.value, [provider]: value.readAt }
    } else accept(value)
  } catch {
    if (generation === epoch && sequence === request)
      error.value = "Memory couldn't be read. Try again."
  } finally {
    if (generation === epoch && sequence === request) loading.value = false
  }
}
watch(
  () => props.profileSlug,
  () => {
    epoch++
    request++
    reading.value = null
    storeReadAt.value = {}
    offsets.value = {}
    preview.value = null
    replacement.value = ''
    busy.value = false
    void read()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  epoch++
  request++
})

function edit(provider: Provider, entry: AgentMemoryEntry, kind: 'removed' | 'corrected') {
  if (blocked.value || !entry.amendable || entry.truncated || entry.bytes > 65536) return
  preview.value = {
    kind,
    profile: props.profileSlug,
    provider,
    entry: entry.path,
    before: entry.text,
  }
  replacement.value = entry.text
}
function latest(one: MemoryAmendment) {
  return (
    reading.value?.amendments.find(
      (row) =>
        row.provider === one.provider &&
        row.entry === one.entry &&
        row.outcome !== 'pending' &&
        row.outcome !== 'unchanged',
    )?.id === one.id
  )
}
function canUndo(one: MemoryAmendment) {
  return (
    !blocked.value &&
    latest(one) &&
    one.outcome !== 'pending' &&
    one.outcome !== 'unchanged' &&
    !one.actual?.unreadable &&
    !(one.outcome === 'partial' && one.actual === undefined)
  )
}
function undo(one: MemoryAmendment) {
  if (!canUndo(one)) return
  preview.value = { kind: 'undo', profile: props.profileSlug, source: { ...one } }
}
function check() {
  if (busy.value || loading.value) return
  preview.value = { kind: 'check', profile: props.profileSlug }
}
async function confirm() {
  const chosen = preview.value
  const bridge = api.value
  if (!chosen || !bridge || busy.value || chosen.profile !== props.profileSlug) return
  const generation = epoch
  // Capture the displayed draft before the asynchronous digest; never substitute a later reading.
  const after = replacement.value
  busy.value = true
  error.value = null
  try {
    let result: AgentMemoryAmended | MemoryChecked | null
    if (chosen.kind === 'removed' || chosen.kind === 'corrected') {
      const bytes = new TextEncoder().encode(chosen.before)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      if (generation !== epoch || preview.value !== chosen) return
      const fingerprint = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      result = await bridge.amendAgentMemory({
        profileId: chosen.profile,
        provider: chosen.provider,
        entry: chosen.entry,
        act: chosen.kind,
        text: chosen.kind === 'removed' ? '' : after,
        fingerprint,
        confirmed: true,
      })
    } else if (chosen.kind === 'undo') {
      result = await bridge.undoAgentMemory({
        profileId: chosen.profile,
        sourceId: chosen.source.id,
        confirmed: true,
      })
    } else
      result = await bridge.checkInterruptedMemory({ profileId: chosen.profile, confirmed: true })
    if (generation !== epoch) return
    preview.value = null
    if (!result) {
      error.value = REFUSAL_MEANS['change-incomplete']
      return
    }
    accept(result.reading)
    if (!result.done) error.value = REFUSAL_MEANS[result.refused]
  } catch {
    if (generation === epoch) {
      preview.value = null
      error.value = REFUSAL_MEANS['change-incomplete']
    }
  } finally {
    if (generation === epoch) busy.value = false
  }
}
function action(one: MemoryAmendment) {
  if (one.by.who === 'a-person') return AMENDMENT_MEANS[one.act]
  const labels: Record<MemoryAmendment['act'], string> = {
    removed: 'Entry removed',
    corrected: 'Entry replaced',
    restored: 'Entry restored',
  }
  return labels[one.act]
}
function outcome(one: MemoryAmendment) {
  if (one.outcome === undefined) return 'Completed; no observation was kept.'
  return {
    pending: 'This change needs checking.',
    done: 'Completed.',
    partial: 'This change only partly finished.',
    unchanged: 'Nothing changed.',
  }[one.outcome]
}
</script>

<template>
  <section class="memory-book" data-cy="memory-book">
    <div class="actions">
      <h3>Memory</h3>
      <button type="button" :disabled="busy || loading" data-cy="memory-reload" @click="read()">
        Read again
      </button>
    </div>
    <p class="note">
      These are this agent’s saved entries now. A running conversation keeps the memory it last
      loaded.
    </p>
    <p v-if="loading" role="status">Reading memory…</p>
    <p v-if="error" role="alert" data-cy="memory-error">{{ error }}</p>
    <template v-if="reading">
      <p v-if="reading.changing" role="status">A change to this memory is still running.</p>
      <div v-if="reading.needsChecking" class="notice" data-cy="memory-needs-checking">
        <p>A change to this memory did not finish and needs checking.</p>
        <button
          type="button"
          :disabled="busy || loading || reading.changing"
          data-cy="memory-check"
          @click="check"
        >
          Check interrupted change
        </button>
      </div>
      <section
        v-for="store in reading.stores"
        :key="store.provider"
        :data-cy="`memory-store-${store.provider}`"
        class="store"
      >
        <h4>{{ store.provider }}</h4>
        <p class="note">{{ MEMORY_STORE_IS[store.state] }}</p>
        <p v-if="storeReadAt[store.provider] !== undefined" class="note">
          Read {{ fullTime(storeReadAt[store.provider]!) }}
        </p>
        <p v-if="store.dir" class="path">{{ store.dir }}</p>
        <p v-if="store.total !== undefined" class="note">
          {{ store.entries.length }} shown of {{ store.total }} entries
        </p>
        <article v-for="entry in store.entries" :key="entry.path" data-cy="memory-entry">
          <h5 class="path">{{ entry.path }}</h5>
          <pre data-cy="memory-text">{{ entry.text }}</pre>
          <p v-if="entry.truncated || entry.bytes > 65536" class="note">
            This entry is incomplete or too large to change here.
          </p>
          <p v-else-if="!entry.amendable" class="note">This entry can only be read here.</p>
          <div v-else class="actions">
            <button
              type="button"
              :disabled="blocked"
              data-cy="memory-correct"
              @click="edit(store.provider, entry, 'corrected')"
            >
              Correct
            </button>
            <button
              type="button"
              :disabled="blocked"
              data-cy="memory-remove"
              @click="edit(store.provider, entry, 'removed')"
            >
              Remove
            </button>
          </div>
        </article>
        <p v-for="(refused, i) in store.refused" :key="i" class="note">
          {{ refused.path }} · {{ refused.reason }}
        </p>
        <div class="actions">
          <button
            v-if="(offsets[store.provider] ?? 0) > 0"
            type="button"
            :disabled="busy || loading || preview !== null"
            :data-cy="`memory-first-${store.provider}`"
            @click="read(store.provider, 0)"
          >
            First page
          </button>
          <button
            v-if="store.nextOffset !== undefined && store.nextOffset !== null"
            type="button"
            :disabled="busy || loading || preview !== null"
            :data-cy="`memory-next-${store.provider}`"
            @click="read(store.provider, store.nextOffset!)"
          >
            Next page
          </button>
        </div>
      </section>
      <section v-if="reading.amendments.length" class="history" data-cy="memory-history">
        <h4>Change history</h4>
        <article v-for="row in reading.amendments" :key="row.id" data-cy="memory-history-row">
          <p>{{ action(row) }} · {{ fullTime(row.at) }}</p>
          <p class="note">Done by: {{ didIt(row.by) }}</p>
          <p class="path">{{ row.provider }} · {{ row.entry }}</p>
          <p>{{ outcome(row) }}</p>
          <p v-if="row.settlement?.by.who === 'the-app-itself'">
            The app recorded what it found after an interruption.
          </p>
          <p v-else-if="row.settlement">A person recorded what was found.</p>
          <p v-else-if="row.outcome !== 'pending'">Not known who recorded this.</p>
          <details>
            <summary>Saved before and after</summary>
            <strong>Before</strong>
            <pre>{{ row.textBefore ?? 'No entry' }}</pre>
            <strong>Planned change</strong>
            <pre>{{ row.textAfter ?? 'No entry' }}</pre>
          </details>
          <button v-if="canUndo(row)" type="button" data-cy="memory-undo" @click="undo(row)">
            Undo this change
          </button>
        </article>
      </section>
    </template>
    <section v-if="preview" class="confirmation" data-cy="memory-confirmation">
      <template v-if="preview.kind === 'removed' || preview.kind === 'corrected'">
        <h4>{{ preview.kind === 'removed' ? 'Remove this entry?' : 'Replace this entry?' }}</h4>
        <p class="path">{{ preview.provider }} · {{ preview.entry }}</p>
        <strong>Before</strong>
        <pre data-cy="memory-confirm-before">{{ preview.before }}</pre>
        <template v-if="preview.kind === 'corrected'"
          ><label for="memory-replacement">Your replacement</label
          ><textarea
            id="memory-replacement"
            v-model="replacement"
            :disabled="busy"
            data-cy="memory-replacement"
            rows="8"
          ></textarea>
          <p class="note">{{ replacementBytes }} of 65536 bytes</p></template
        >
        <p>
          The saved text stays in the history so the change can be undone while the entry still
          matches.
        </p>
      </template>
      <template v-else-if="preview.kind === 'undo'"
        ><h4>Undo this change?</h4>
        <p class="path">{{ preview.source.entry }}</p>
        <strong>Restore this saved text</strong>
        <pre>{{ preview.source.textBefore ?? 'No entry' }}</pre>
        <p v-if="preview.source.textBefore !== null && preview.source.textAfter === null">
          Only your user account on this computer can read a file brought back from the history.
        </p></template
      >
      <template v-else
        ><h4>Check interrupted change?</h4>
        <p>This records what's there now. It doesn't restore or remove anything.</p></template
      >
      <div class="actions">
        <button
          type="button"
          :disabled="
            busy ||
            (preview.kind === 'corrected' &&
              (replacement === preview.before || replacementBytes > 65536))
          "
          data-cy="memory-confirm"
          @click="confirm"
        >
          {{
            preview.kind === 'corrected'
              ? 'Replace'
              : preview.kind === 'removed'
                ? 'Remove'
                : preview.kind === 'undo'
                  ? 'Undo'
                  : 'Record'
          }}</button
        ><button type="button" :disabled="busy" data-cy="memory-cancel" @click="preview = null">
          Cancel
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.memory-book {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-5);
}
h3,
h4,
h5,
p {
  margin: 0;
}
h4 {
  font-size: var(--type-body);
}
h5 {
  font-size: var(--type-small);
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.actions h3 {
  flex: 1;
}
.store,
article,
.history,
.confirmation {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}
.store,
.history,
.confirmation {
  padding-top: var(--space-5);
  border-top: var(--border-width) solid var(--line);
}
article {
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
}
.note {
  color: var(--muted);
  font-size: var(--type-small);
}
.path {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--type-small);
}
pre,
textarea {
  max-width: 100%;
  min-width: 0;
  padding: var(--space-4);
  background: var(--panel-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-small);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre {
  max-height: 360px;
  overflow-y: auto;
  margin: 0;
}
textarea {
  width: 100%;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
button {
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
