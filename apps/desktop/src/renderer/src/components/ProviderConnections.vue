<script setup lang="ts">
import { useClientProviders } from '../client-provider/injection'
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ApiKeyStatus, AuthState } from '../../../shared/runtime-ipc'

const props = defineProps<{
  provider: Provider
  name: string
  auth: AuthState | null
  keyStatus: ApiKeyStatus | null
  loginMoved: number
  modelsKnown: boolean
}>()
const client = useClientProviders()
const heading = useId()
const reading = shallowRef<readonly ProviderConnection[] | null>(null)
const failed = shallowRef(false)
let ticket = 0
let open = true

async function read(): Promise<void> {
  const mine = ++ticket
  reading.value = null
  failed.value = false
  try {
    const rows = await client.providerConnections()
    if (open && mine === ticket)
      reading.value = rows.filter((row) => row.provider === props.provider)
  } catch {
    if (open && mine === ticket) failed.value = true
  }
}
watch(
  [
    () => props.provider,
    () => props.loginMoved,
    () => props.keyStatus?.set,
    () => props.keyStatus?.setAt,
  ],
  () => {
    void read()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  open = false
  ticket++
})

const selected = computed(() =>
  props.keyStatus === null ? null : props.keyStatus.set ? 'api-key' : 'sign-in',
)
function status(row: ProviderConnection): string {
  if (row.authMethod !== selected.value) return 'Not checked'
  const auth = props.auth
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
    :aria-busy="reading === null && !failed"
  >
    <h3 :id="heading">Connections</h3>
    <p v-if="failed" class="note" role="status">Connections could not be read.</p>
    <p v-else-if="reading === null" class="note" role="status">Reading…</p>
    <p v-else-if="reading.length === 0" class="note">No connections available.</p>
    <template v-else>
      <ul class="entries">
        <li v-for="row in reading" :key="row.id" class="entry" data-cy="provider-connection">
          <div class="entry-title">
            <strong>{{ props.name }} · {{ row.name }}</strong>
            <span
              v-if="row.authMethod === selected && status(row) === 'Ready'"
              class="bb-chip bb-chip--pill"
              >In use</span
            >
          </div>
          <p class="meta">
            {{ row.authMethod === 'api-key' ? 'API key' : 'Sign-in' }} · {{ status(row) }}
          </p>
          <p class="meta">Standard address</p>
          <p class="meta">
            {{
              row.authMethod === selected && props.modelsKnown && status(row) === 'Ready'
                ? 'Models are shown below.'
                : 'Models not checked.'
            }}
          </p>
        </li>
      </ul>
      <p class="note">Usage and cost per connection aren't shown yet.</p>
    </template>
  </section>
</template>

<style scoped>
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
