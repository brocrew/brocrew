<script setup lang="ts">
import { onMounted, ref, shallowRef, useId, watch } from 'vue'
import type { KeptRules, Provider } from '../../../shared/runtime-ipc'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { grantRulesSaid } from '../lib/permission-offer'
import { readableError } from '../lib/session-record'
import { usePersistentToggle } from '../composables/usePersistentToggle'

/**
 * The rules an *Always allow* kept beyond its conversation, per provider and file by file, each with
 * a Remove. ⚑ Read when the page opens and again after each removal; a removal edits only the file
 * the rule is kept in, and main checks the rule is still there first.
 */
const props = defineProps<{
  providers: readonly Provider[]
  names?: Readonly<Partial<Record<Provider, string>>>
}>()

const kept = shallowRef<KeptRules | null>(null)
const unread = ref<string | null>(null)
const refused = ref<string | null>(null)
const removing = ref(false)
/** How many reads have failed and removals been refused, so each one is news, even repeated. */
const failures = ref(0)

async function read(): Promise<void> {
  try {
    kept.value = await window.api.runtime.keptRules()
    unread.value = null
  } catch (error) {
    unread.value = readableError(error)
    failures.value += 1
  }
}

async function remove(provider: Provider, file: string, rule: string): Promise<void> {
  removing.value = true
  refused.value = null
  try {
    const done = await window.api.runtime.removeKeptRule({ provider, file, kept: rule })
    if (!done.removed) {
      refused.value = done.why
      failures.value += 1
    }
  } catch (error) {
    refused.value = readableError(error)
    failures.value += 1
  } finally {
    removing.value = false
    await read()
  }
}

onMounted(read)

/** Whether the section is open, remembered on this computer; open the first time. */
const open = usePersistentToggle('brobot2.providers.open.kept-rules', true)
const bodyId = useId()

// A refused removal or a failed read opens the section, though it was folded: its words are inside.
watch(failures, () => (open.value = true))
</script>

<template>
  <section class="kept-rules" data-cy="kept-rules">
    <span class="kept-icon" aria-hidden="true"
      ><svg class="icon"><use href="#i-sliders" /></svg
    ></span>
    <h2>
      <button
        type="button"
        class="fold"
        :aria-expanded="open"
        :aria-controls="bodyId"
        data-cy="kept-rules-fold"
        @click="open = !open"
      >
        Kept rules<svg class="icon chevron" :class="{ folded: !open }" aria-hidden="true">
          <use href="#i-chevron" />
        </svg>
      </button>
    </h2>
    <div v-show="open" :id="bodyId" class="kept-body">
      <p class="about">
        Actions you chose “Always allow” for. They apply to every conversation that uses this
        provider, not to other providers. If you remove one, agents will ask again the next time a
        conversation starts.
      </p>
      <p v-if="unread !== null" class="note" data-cy="kept-rules-unread">
        They could not be read just now: {{ unread }}
      </p>
      <p v-if="refused !== null" class="note" data-cy="kept-rules-refused">
        Not removed: {{ refused }}
      </p>
      <div
        v-for="provider in props.providers"
        :key="provider"
        class="provider"
        data-cy="kept-rules-provider"
        :data-provider="provider"
      >
        <h3>{{ props.names?.[provider] ?? PROVIDER_NAME[provider] ?? provider }}</h3>
        <p
          v-if="kept !== null && (kept[provider]?.length ?? 0) === 0"
          class="none"
          data-cy="kept-rules-none"
        >
          None kept.
        </p>
        <div v-for="file in kept?.[provider] ?? []" :key="file.file" class="file">
          <p class="path" data-cy="kept-rules-file">{{ file.file }}</p>
          <p v-if="file.unreadable !== undefined" class="note" data-cy="kept-rules-unreadable">
            It could not be read: {{ file.unreadable }}.
          </p>
          <p v-if="file.notEditedHere !== undefined" class="note" data-cy="kept-rules-not-here">
            Remove a rule from this file yourself: {{ file.notEditedHere }}.
          </p>
          <ul>
            <li v-for="one in file.rules" :key="one.kept" data-cy="kept-rule">
              <span class="rule">{{ grantRulesSaid([one.rule]) }}</span>
              <button
                v-if="file.notEditedHere === undefined"
                type="button"
                class="remove danger"
                data-cy="kept-rule-remove"
                :aria-label="`Remove ${grantRulesSaid([one.rule])}`"
                :disabled="removing"
                @click="remove(provider, file.file, one.kept)"
              >
                Remove
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.kept-rules {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-7) var(--space-8) var(--space-7) calc(var(--space-24) + var(--space-16));
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  gap: var(--space-3);
}
.kept-icon {
  position: absolute;
  top: var(--space-6);
  left: var(--space-6);
  display: grid;
  width: var(--space-24);
  height: var(--space-24);
  place-items: center;
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-card);
  background: var(--accent-fill);
  color: var(--accent);
}
.kept-icon .icon {
  width: var(--space-16);
  height: var(--space-16);
  fill: none;
  stroke: currentColor;
}
h2 {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}
/* The heading itself, unstyled: its word and the chevron, pressable. */
.fold {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  gap: var(--space-2);
}
/* Down while open, right while folded. */
.chevron {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
  transform: rotate(90deg);
}
.chevron.folded {
  transform: none;
}
/* The content lays out as the section's own children, folded or not. */
.kept-body {
  display: contents;
}
h3 {
  margin: var(--space-4) 0 0;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}
.about,
.note,
.none {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.path {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}
ul {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  gap: var(--space-2);
  list-style: none;
}
li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-5);
}
.rule {
  color: var(--text);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
}
.remove {
  flex: none;
}
.remove.danger {
  color: var(--danger);
}
</style>
