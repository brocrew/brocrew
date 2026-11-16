<script setup lang="ts">
import { useClientProviders } from '../client-provider/injection'
import { onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import SheetShell from './SheetShell.vue'
import OverlayHost from './OverlayHost.vue'
import { compatibilityConnectionId, type Provider, type ProviderConnection } from '@brobot2/shared'
import { localFormat } from '../../../shared/local-time'
import type { ApiKeyStatus, AuthState } from '../../../shared/runtime-ipc'

const props = defineProps<{
  provider: Provider
  name: string
  keyAuth: AuthState | null
  signInAuth: AuthState | null
  keyStatus: ApiKeyStatus | null
  loginMoved: number
  keepControls?: boolean
}>()
const client = useClientProviders()
const heading = useId()
const reading = shallowRef<readonly ProviderConnection[] | null>(null)
const failed = shallowRef(false)
const pending = shallowRef(true)
let ticket = 0
let open = true
let stopListening: (() => void) | undefined
const editing = shallowRef<ProviderConnection | null>(null)
const nameDraft = ref('')
const descriptionDraft = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const formId = useId()
const nameField = useId()
const descriptionField = useId()

function edit(row: ProviderConnection): void {
  editing.value = row
  nameDraft.value = row.name
  descriptionDraft.value = row.description ?? ''
  saveError.value = null
}
function cancel(): void {
  if (!saving.value) editing.value = null
}
async function save(): Promise<void> {
  const selected = editing.value
  if (!selected || saving.value || !nameDraft.value.trim()) return
  saving.value = true
  saveError.value = null
  try {
    const changed = await client.updateProviderConnection({
      provider: selected.provider,
      connectionId: selected.id,
      name: nameDraft.value.trim(),
      description: descriptionDraft.value.trim() || null,
    })
    if (open && editing.value === selected) {
      reading.value = reading.value?.map((row) => (row.id === changed.id ? changed : row)) ?? null
      editing.value = null
    }
  } catch (error) {
    if (open && editing.value === selected)
      saveError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (open && (editing.value === selected || editing.value === null)) saving.value = false
  }
}

async function read(): Promise<void> {
  const mine = ++ticket
  pending.value = true
  failed.value = false
  try {
    const rows = await client.providerConnections()
    if (open && mine === ticket && (reading.value === null || !props.keepControls))
      reading.value = rows.filter((row) => row.provider === props.provider)
  } catch {
    if (open && mine === ticket) failed.value = true
  } finally {
    if (open && mine === ticket) pending.value = false
  }
}
watch(
  [
    () => props.provider,
    () => props.loginMoved,
    () => props.keyStatus?.set,
    () => props.keyStatus?.setAt,
  ],
  (next, before) => {
    if (before?.[0] !== next[0]) {
      reading.value = null
      editing.value = null
      saving.value = false
    }
    void read()
  },
  { immediate: true },
)
watch(
  () => props.keepControls,
  (active, before) => {
    if (before && !active) void read()
  },
)
onMounted(() => {
  stopListening = client.onProvidersChanged((message) => {
    if (message.what === 'connections' && message.provider === props.provider) void read()
  })
})
onBeforeUnmount(() => {
  open = false
  ticket++
  stopListening?.()
})

function hasGlobalControls(row: ProviderConnection): boolean {
  return row.id === compatibilityConnectionId(row.provider, row.authMethod)
}
const savedOn = localFormat({ day: 'numeric', month: 'short' })
function method(row: ProviderConnection): string {
  if (!hasGlobalControls(row))
    return `${row.authMethod === 'api-key' ? 'API key' : 'Sign-in'} · ${row.baseUrl ?? 'Standard address'}`
  if (row.authMethod === 'api-key') {
    return props.keyStatus?.set
      ? `API key · saved${props.keyStatus.setAt === null ? '' : ` ${savedOn(props.keyStatus.setAt)}`} ••••`
      : 'API key · Standard address'
  }
  const plan = props.signInAuth?.state === 'usable' ? props.signInAuth.plan : undefined
  return plan
    ? `Sign-in · ${plan[0]!.toUpperCase()}${plan.slice(1)} plan`
    : 'Sign-in · Standard address'
}
function status(row: ProviderConnection): string {
  if (!hasGlobalControls(row)) return 'Not checked'
  if (row.authMethod === 'api-key' && props.keyStatus?.set !== true) return 'Not checked'
  const auth = row.authMethod === 'api-key' ? props.keyAuth : props.signInAuth
  if (
    row.authMethod === 'api-key' &&
    (props.keyStatus?.readState === 'unreadable' ||
      props.keyStatus?.refusedForBilling !== undefined)
  )
    return 'API key needs attention'
  if (
    auth?.state === 'usable' &&
    auth.login === (row.authMethod === 'api-key' ? 'api-key' : 'account')
  )
    return 'Ready'
  if (auth?.state === 'absent' || auth?.state === 'stale')
    return row.authMethod === 'api-key' ? 'API key needs attention' : 'Needs sign-in'
  return 'Not checked'
}
</script>

<template>
  <section
    class="connections"
    data-cy="provider-connections"
    :aria-labelledby="heading"
    :aria-busy="pending"
  >
    <h3 :id="heading">Connections</h3>
    <p v-if="failed" class="note" role="status">Connections could not be read.</p>
    <p v-else-if="pending" class="note" role="status">Reading…</p>
    <p v-else-if="reading?.length === 0" class="note">No connections available.</p>
    <template v-if="reading && reading.length > 0">
      <ul class="entries">
        <li v-for="row in reading" :key="row.id" class="entry" data-cy="provider-connection">
          <div class="entry-title">
            <strong>{{ props.name }} · {{ row.name }}</strong>
            <span
              class="standing"
              :class="{ ready: status(row) === 'Ready' }"
              data-cy="connection-status"
              >{{ status(row) }}</span
            >
            <button
              v-if="hasGlobalControls(row)"
              type="button"
              data-cy="connection-edit"
              :disabled="props.keepControls || saving"
              @click="edit(row)"
            >
              Edit
            </button>
          </div>
          <p class="meta">{{ method(row) }}</p>
          <p v-if="row.description" class="meta">{{ row.description }}</p>
          <template v-if="hasGlobalControls(row)">
            <slot v-if="row.authMethod === 'sign-in'" name="sign-in" />
            <slot v-else name="api-key" />
          </template>
        </li>
      </ul>
    </template>
    <OverlayHost v-if="editing" label="Edit connection" @close="cancel">
      <SheetShell glyph="C" data-cy="connection-editor" @close="cancel">
        <template #header
          ><strong>Edit connection</strong
          ><small>{{ props.name }} · {{ editing.name }}</small></template
        >
        <template #body>
          <form :id="formId" @submit.prevent="save" @keydown.esc.prevent="cancel">
            <label :for="nameField">Name</label>
            <input
              :id="nameField"
              v-model="nameDraft"
              data-cy="connection-name"
              :disabled="saving"
              autocomplete="off"
            />
            <label :for="descriptionField">Description</label>
            <textarea
              :id="descriptionField"
              v-model="descriptionDraft"
              data-cy="connection-description"
              :disabled="saving"
              rows="3"
            />
            <p class="note">
              {{ editing.authMethod === 'api-key' ? 'API key' : 'Sign-in' }} · Standard address
            </p>
            <p v-if="saveError" class="note" role="alert" data-cy="connection-error">
              {{ saveError }}
            </p>
          </form>
        </template>
        <template #actions>
          <button type="button" data-cy="connection-cancel" :disabled="saving" @click="cancel">
            Cancel
          </button>
          <button
            type="submit"
            :form="formId"
            data-cy="connection-save"
            :disabled="saving || !nameDraft.trim()"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </template>
      </SheetShell>
    </OverlayHost>
    <slot
      v-if="!reading?.some((row) => hasGlobalControls(row) && row.authMethod === 'sign-in')"
      name="unlisted"
    />
  </section>
</template>

<style scoped>
form {
  display: grid;
  gap: var(--space-3);
}
input,
textarea {
  width: 100%;
  box-sizing: border-box;
}
.connections {
  margin-top: var(--space-5);
  padding-bottom: var(--space-5);
  color: var(--text);
}
h3 {
  margin: 0 0 var(--space-4);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}
.entries {
  display: grid;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.entry {
  min-width: 0;
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
}
.entry-title {
  display: flex;
  align-items: start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.standing {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: var(--type-caption);
}
.standing.ready {
  color: var(--success-text);
  border-color: var(--success-border);
  background: var(--success-bg);
}
strong {
  min-width: 0;
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  overflow-wrap: anywhere;
}
.meta,
.note {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}
.note {
  margin-top: var(--space-4);
}
</style>
