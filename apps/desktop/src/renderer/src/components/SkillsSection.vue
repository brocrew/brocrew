<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SharedSkill, SkillsWindow } from '../../../shared/skills-window'

const props = defineProps<{ bridge?: SkillsWindow }>()
const items = ref<readonly SharedSkill[]>([])
const loaded = ref(false)
const loading = ref(true)
const saving = ref(false)
const status = ref('')
let alive = true
let serial = 0
let timer: ReturnType<typeof setInterval> | undefined
const groups = computed(() => [
  { name: 'Built in', items: items.value.filter((one) => one.builtIn) },
  { name: 'Shared', items: items.value.filter((one) => !one.builtIn) },
])
const textOf = (skill: SharedSkill) =>
  skill.body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()
function callSkills(): SkillsWindow {
  const call = props.bridge ?? window.api?.runtime?.skills
  if (!call) throw new Error('Skills could not be read.')
  return call
}
async function refresh(): Promise<void> {
  const turn = ++serial
  loading.value = true
  try {
    const reply = await callSkills()({ operation: 'shared-list' })
    if (!alive || turn !== serial) return
    if (reply.operation !== 'shared-list') throw new Error('Skills could not be read.')
    items.value = reply.skills
    loaded.value = true
    status.value = ''
  } catch {
    if (alive && turn === serial) status.value = 'Skills could not be read.'
  } finally {
    if (alive && turn === serial) loading.value = false
  }
}
async function toggle(skill: SharedSkill): Promise<void> {
  if (saving.value || loading.value) return
  saving.value = true
  status.value = ''
  ++serial
  try {
    const reply = await callSkills()({
      operation: 'shared-toggle',
      folder: skill.folder,
      enabled: !skill.enabled,
    })
    if (!alive) return
    if (reply.operation !== 'shared-toggle') throw new Error('The skill was not saved.')
    await refresh()
  } catch {
    if (alive) status.value = 'The skill was not saved.'
  } finally {
    if (alive) saving.value = false
  }
}
function onFocus(): void {
  if (!loading.value && !saving.value) void refresh()
}
onMounted(() => {
  void refresh()
  window.addEventListener('focus', onFocus)
  timer = setInterval(onFocus, 5000)
})
onBeforeUnmount(() => {
  alive = false
  ++serial
  clearInterval(timer)
  window.removeEventListener('focus', onFocus)
})
</script>

<template>
  <section class="skills-section" data-cy="skills-section">
    <h2>Skills</h2>
    <p class="skills-intro">Every agent can use these skills, and add or edit them.</p>
    <p v-if="loading" role="status" data-cy="skills-loading">Reading skills…</p>
    <p v-if="saving" role="status">Saving…</p>
    <p v-if="status" role="alert" data-cy="skills-status">{{ status }}</p>
    <p v-if="loaded && items.length === 0" data-cy="skills-empty">No skills yet.</p>
    <div class="skills-list" aria-label="Available skills">
      <section v-for="group in groups" :key="group.name" class="skill-group">
        <h3>{{ group.name }}</h3>
        <article
          v-for="skill in group.items"
          :key="`${skill.builtIn}:${skill.enabled}:${skill.folder}`"
          class="skill-row bb-card"
          data-cy="skill-row"
        >
          <header>
            <div>
              <h4>{{ skill.name }}</h4>
              <p>{{ skill.description }}</p>
              <p v-if="!skill.builtIn && skill.folder !== skill.name">{{ skill.folder }}</p>
            </div>
            <button
              v-if="!skill.builtIn"
              type="button"
              class="bb-button"
              data-cy="skill-toggle"
              :disabled="saving || loading"
              :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`"
              @click="toggle(skill)"
            >
              {{ skill.enabled ? 'Turn off' : 'Turn on' }}
            </button>
          </header>
          <details data-cy="skill-detail">
            <summary>Skill text</summary>
            <pre class="skill-source" data-cy="skill-source">{{ textOf(skill) }}</pre>
          </details>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.skills-section,
.skills-list,
.skill-group,
.skill-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}
.skills-section {
  color: var(--text);
}
.skills-list {
  gap: var(--space-8);
}
.skill-group {
  gap: var(--space-3);
}
h2,
h3,
h4,
p {
  margin: 0;
}
p {
  line-height: var(--leading-relaxed);
  color: var(--text-soft);
}
.skill-row {
  padding: var(--space-6);
}
.skill-row header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--space-5);
  flex-wrap: wrap;
}
.skill-row header div {
  flex: 1 1 15rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  color: var(--text-soft);
}
.skill-source {
  margin: var(--space-4) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: var(--leading-relaxed);
}
</style>
