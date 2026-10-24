<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import type { ProfileSkillMetadata } from '../../../shared/skills-window'

const props = defineProps<{ profileSlug: string; active: boolean; bridge?: RuntimeBridge }>()
const emit = defineEmits<{ settings: ['skills'] }>()
const items = ref<readonly ProfileSkillMetadata[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref(false)
const nextOffset = ref<number | null>(null)
let epoch = 0
let sequence = 0

async function read(offset = 0): Promise<void> {
  if (!props.active || loading.value) return
  const profile = props.profileSlug
  const generation = epoch
  const request = ++sequence
  loading.value = true
  error.value = false
  try {
    const runtime = props.bridge ?? window.api.runtime
    const reply = await runtime.skills({
      operation: 'profile-list',
      profileId: profile,
      ...(offset === 0 ? {} : { offset }),
    })
    if (generation !== epoch || request !== sequence || !props.active) return
    if (reply.operation !== 'profile-list') throw new Error('Skills could not be read.')
    items.value = offset === 0 ? reply.skills : [...items.value, ...reply.skills]
    nextOffset.value = reply.nextOffset ?? null
    loaded.value = true
  } catch {
    if (generation === epoch && request === sequence && props.active) error.value = true
  } finally {
    if (generation === epoch && request === sequence) loading.value = false
  }
}

watch(
  () => props.profileSlug,
  () => {
    epoch++
    sequence++
    items.value = []
    loaded.value = false
    loading.value = false
    error.value = false
    nextOffset.value = null
    if (props.active) void read()
  },
  { immediate: true },
)
watch(
  () => props.active,
  (active) => {
    if (active) void read()
    else {
      sequence++
      loading.value = false
    }
  },
)
onBeforeUnmount(() => {
  epoch++
  sequence++
})
</script>

<template>
  <div class="profile-skills" data-cy="agent-skills">
    <h3>Skills</h3>
    <p class="muted">The skills this agent receives.</p>
    <p v-if="loading" role="status">Reading…</p>
    <p v-if="error" class="error" role="alert" data-cy="agent-skills-error">
      This app could not read the skills.
    </p>
    <p v-if="loaded && !loading && !error && items.length === 0" data-cy="agent-skills-empty">
      No skills found.
    </p>
    <article
      v-for="skill in items"
      :key="`${skill.builtIn ? 'built-in' : 'shared'}/${skill.folder}`"
      data-cy="agent-skill"
    >
      <strong>{{ skill.name }}</strong>
      <p>{{ skill.description }}</p>
      <div class="muted">
        <span>{{ skill.builtIn ? 'Built-in' : 'Shared' }}</span>
        <span>{{
          skill.builtIn && !skill.given ? 'Not given to this agent' : skill.enabled ? 'On' : 'Off'
        }}</span>
      </div>
    </article>
    <div class="actions">
      <button
        v-if="nextOffset !== null"
        type="button"
        :disabled="loading"
        @click="read(nextOffset)"
      >
        Load more
      </button>
      <button type="button" data-cy="agent-skills-settings" @click="emit('settings', 'skills')">
        <span>Change in Settings → Skills</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.profile-skills {
  display: grid;
  gap: var(--space-4);
}
p {
  margin: 0;
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}
.muted {
  color: var(--muted);
  font-size: var(--type-small);
}
article {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
article strong {
  overflow-wrap: anywhere;
}
article .muted,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
button {
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.error {
  color: var(--danger);
}
</style>
