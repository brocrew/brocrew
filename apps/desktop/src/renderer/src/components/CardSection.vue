<script setup lang="ts">
import { useId } from 'vue'
import { usePersistentToggle } from '../composables/usePersistentToggle'

/**
 * Frame an agent-card section with an icon, title and an optional count, such as Current task, Images or Sub-agents.
 *
 * ⚠️ **The title is a slot, not a prop**: a caller's hook on the words (`cast-taken-heading`) is
 * written where the caller writes it, so the censuses that read hooks off each file find it there.
 *
 * A section given `fold` folds: a chevron takes the icon's place, the heading is the button, and
 * folding hides the content alone, keeping the heading, the count and the action. Whether it is
 * folded is remembered on this computer under the `fold` key.
 */
const props = defineProps<{
  /** ⚑ A sprite symbol, `#i-…`. */
  icon: string
  /** ⚑ How many the section holds, drawn after the title — absent where it counts nothing. */
  count?: number
  /** ⚑ The title in the accent, for the section a person looks at first. */
  accent?: boolean
  /** The storage key that remembers whether this section is folded; absent, it does not fold. */
  fold?: string
}>()

const folded = usePersistentToggle(props.fold ?? '', false, props.fold ? undefined : null)
const bodyId = useId()
</script>

<template>
  <section class="card-section" :data-folded="props.fold ? folded : undefined">
    <p class="head">
      <button
        v-if="props.fold"
        type="button"
        class="fold"
        :aria-expanded="!folded"
        :aria-controls="bodyId"
        @click="folded = !folded"
      >
        <svg class="icon chevron" :class="{ accent, folded }" aria-hidden="true">
          <use href="#i-chevron" />
        </svg>
        <span class="title" :class="{ accent }"><slot name="title" /></span>
        <span v-if="count !== undefined" class="count">({{ count }})</span>
      </button>
      <template v-else>
        <svg class="icon" :class="{ accent }" aria-hidden="true"><use :href="icon" /></svg>
        <span class="title" :class="{ accent }"><slot name="title" /></span>
        <span v-if="count !== undefined" class="count">({{ count }})</span>
      </template>
      <!-- ⚑ W4.183 · one act on the heading's right, as v3's "View all". -->
      <span v-if="$slots.action" class="action"><slot name="action" /></span>
    </p>
    <div v-if="props.fold" v-show="!folded" :id="bodyId" class="body">
      <slot />
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.card-section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-5) var(--space-6) var(--space-6);
  border: var(--border-width) solid var(--drawer-card-line, var(--line));
  border-radius: var(--radius-lg);
  background: var(--drawer-card-bg, var(--panel));
  color: var(--drawer-card-ink, inherit);
  gap: var(--space-5);
}

.head {
  display: flex;
  min-width: 0;
  align-items: center;
  margin: 0;
  gap: var(--space-3);
}

/* The heading itself, unstyled: the same row of icon, title and count, pressable. */
.fold {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  gap: var(--space-3);
  text-align: left;
}

/* The content lays out as the section's own children, folded or not. */
.body {
  display: contents;
}

.icon {
  width: 15px;
  height: 15px;
  color: var(--muted);
}

.icon.accent {
  color: var(--accent);
}

/* Down while open, right while folded. */
.chevron {
  flex: none;
  transform: rotate(90deg);
}

.chevron.folded {
  transform: none;
}

.title {
  overflow: hidden;
  min-width: 0;
  color: var(--drawer-card-ink, var(--text));
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title.accent {
  color: var(--drawer-card-ink, var(--accent-text-soft));
}

.action {
  margin-left: auto;
}

.count {
  flex: none;
  color: var(--drawer-card-ink, var(--muted));
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}
</style>
