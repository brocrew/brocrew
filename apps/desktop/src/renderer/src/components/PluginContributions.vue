<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  PluginHostClient,
  PluginHostSnapshot,
  PluginHostUiRequest,
  PluginContributionView,
} from '../../../shared/plugin-host'

const props = defineProps<{ client?: PluginHostClient; surface: 'composer' | 'settings' }>()
const client = props.client ?? (typeof window === 'undefined' ? undefined : window.api?.pluginHost)
const snapshot = ref<PluginHostSnapshot>({ contributions: [], notifications: [] })
const error = ref('')
const pending = ref(new Set<string>())
let alive = true,
  revision = 0,
  stop = () => {}
async function refresh() {
  const own = ++revision
  try {
    const result = await client?.request({ kind: 'snapshot' })
    if (alive && own === revision && result && 'value' in result)
      snapshot.value = result.value as PluginHostSnapshot
  } catch {
    if (alive && !error.value) error.value = 'Could not load plugin contributions.'
  }
}
async function act(input: PluginHostUiRequest, handle: string) {
  if (!client || pending.value.has(handle)) return
  pending.value.add(handle)
  error.value = ''
  try {
    const answer = await client.request(input)
    if (!alive) return
    if ('error' in answer)
      error.value = answer.error.message ?? 'The plugin operation is unavailable.'
    else if (
      answer.value &&
      typeof answer.value === 'object' &&
      'isError' in answer.value &&
      answer.value.isError === true
    )
      error.value = 'The plugin reported an error.'
    await refresh()
  } catch {
    if (alive) error.value = 'The plugin operation failed.'
  } finally {
    pending.value.delete(handle)
  }
}
function setTitles(item: PluginContributionView, event: Event) {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  input.checked = item.titlesEnabled
  void act({ kind: 'titles-enabled', pluginId: item.pluginId, enabled }, item.handle)
}
function setEnabled(plugin: NonNullable<PluginHostSnapshot['plugins']>[number], event: Event) {
  const input = event.target as HTMLInputElement,
    enabled = input.checked
  input.checked = plugin.enabled
  void act({ kind: 'enabled', pluginId: plugin.pluginId, enabled }, `plugin:${plugin.pluginId}`)
}
const buttons = computed(() =>
  snapshot.value.contributions.filter(
    (item) =>
      item.kind === 'ui.button' &&
      item.state === 'active' &&
      item.definition.slot === 'composer.accessory',
  ),
)
const settings = computed(() =>
  snapshot.value.contributions.filter(
    (item) => item.kind !== 'ui.button' || item.state === 'unsupported',
  ),
)
const title = (definition: Record<string, unknown>) =>
  String(definition.title ?? definition.label ?? '')
const view = (definition: Record<string, unknown>) =>
  definition.view as {
    label: string
    icon?: string
    tooltip?: string
    disabled?: boolean
    busy?: boolean
  }
onMounted(() => {
  stop =
    client?.onChanged(() => {
      void refresh()
    }) ?? stop
  void refresh()
})
onUnmounted(() => {
  alive = false
  revision++
  stop()
})
</script>

<template>
  <div v-if="client" class="plugin-contributions" data-cy="plugin-contributions">
    <template v-if="surface === 'composer'">
      <div v-if="buttons.length" class="plugin-buttons">
        <button
          v-for="item in buttons"
          :key="item.handle"
          type="button"
          class="bb-button"
          data-cy="plugin-contribution-button"
          :title="view(item.definition).tooltip"
          :disabled="
            view(item.definition).disabled || view(item.definition).busy || pending.has(item.handle)
          "
          :aria-busy="view(item.definition).busy || pending.has(item.handle)"
          @click="act({ kind: 'activate', handle: item.handle }, item.handle)"
        >
          <span v-if="view(item.definition).icon" aria-hidden="true">{{
            view(item.definition).icon
          }}</span>
          {{ view(item.definition).label }}
        </button>
      </div>
      <article
        v-for="notice in snapshot.notifications"
        :key="notice.handle"
        class="plugin-notification"
        :data-level="notice.level"
        role="status"
        data-cy="plugin-notification"
      >
        <strong>{{ notice.title }}</strong>
        <p>{{ notice.text }}</p>
        <div class="plugin-buttons">
          <button
            v-for="action in notice.actions"
            :key="action.id"
            class="bb-button"
            type="button"
            data-cy="plugin-notification-action"
            :disabled="pending.has(notice.handle)"
            @click="
              act(
                { kind: 'notification-action', handle: notice.handle, actionId: action.id },
                notice.handle,
              )
            "
          >
            {{ action.label }}
          </button>
          <button
            class="bb-button"
            type="button"
            :aria-label="`Dismiss ${notice.title}`"
            @click="act({ kind: 'notification-dismiss', handle: notice.handle }, notice.handle)"
          >
            Dismiss
          </button>
        </div>
      </article>
    </template>
    <template v-else>
      <label
        v-for="plugin in snapshot.plugins ?? []"
        :key="plugin.pluginId"
        class="plugin-settings-contribution"
      >
        <input
          type="checkbox"
          data-cy="plugin-workspace-enabled"
          :checked="plugin.enabled"
          :disabled="pending.has(`plugin:${plugin.pluginId}`)"
          @change="setEnabled(plugin, $event)"
        />
        Enable {{ plugin.name }} in this workspace
      </label>
      <div v-for="item in settings" :key="item.handle" class="plugin-settings-contribution">
        <p v-if="item.state === 'unsupported'">
          {{ title(item.definition) || item.kind }} is unavailable in this app.
        </p>
        <button
          v-else-if="item.kind === 'settings.page'"
          class="bb-button"
          type="button"
          :disabled="item.state !== 'active' || pending.has(item.handle)"
          data-cy="plugin-settings-open"
          @click="act({ kind: 'settings-open', handle: item.handle }, item.handle)"
        >
          Configure {{ title(item.definition) }}
        </button>
        <label v-else-if="item.kind === 'turn.context.titles'">
          <input
            type="checkbox"
            data-cy="plugin-titles-enabled"
            :checked="item.titlesEnabled"
            :disabled="item.state !== 'active' || pending.has(item.handle)"
            @change="setTitles(item, $event)"
          />
          Let {{ item.pluginId }} suggest file titles before a turn
        </label>
      </div>
    </template>
    <p v-if="error" role="status" class="plugin-error" data-cy="plugin-contribution-error">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.plugin-contributions {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.plugin-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.plugin-buttons button,
.plugin-settings-contribution button {
  white-space: normal;
  overflow-wrap: anywhere;
}
.plugin-notification {
  padding: 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  color: var(--text);
  overflow-wrap: anywhere;
}
.plugin-notification p {
  margin: 4px 0 8px;
  white-space: pre-wrap;
}
.plugin-settings-contribution label {
  display: flex;
  align-items: start;
  gap: 6px;
}
.plugin-error {
  color: var(--danger);
  margin: 0;
}
</style>
