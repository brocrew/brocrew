<script setup lang="ts">
import { useId } from 'vue'
import type { Provider } from '../../../shared/runtime-ipc'
import { useUsageCells } from '../composables/useUsageCells'
import UsageCards from './UsageCards.vue'

/**
 * The window's usage on one line in the title bar — each provider's windows, the agents running and
 * their memory — for every screen at once. A press opens the usage cards under it; Escape or a
 * press outside closes them. The line opts out of the title bar's drag region, so it can be pressed.
 */
const props = withDefaults(
  defineProps<{ readiness?: Readonly<Partial<Record<Provider, boolean | null>>> | null }>(),
  { readiness: null },
)
const { cells, line, description } = useUsageCells(() => props.readiness)
const cardsId = `title-usage-${useId()}`
</script>

<template>
  <button
    type="button"
    class="title-usage"
    data-cy="app-usage"
    :popovertarget="cardsId"
    aria-haspopup="dialog"
    :aria-label="description"
    :title="description"
    :style="{ anchorName: `--${cardsId}` }"
  >
    {{ line }}
  </button>
  <div
    :id="cardsId"
    class="title-usage-cards"
    popover="auto"
    role="dialog"
    aria-label="Usage and agents"
    data-cy="app-usage-cards"
    data-chat-theme="light"
    :style="{ positionAnchor: `--${cardsId}` }"
  >
    <UsageCards :cells="cells" />
  </div>
</template>

<style scoped>
.title-usage {
  overflow: hidden;
  min-width: 0;
  max-width: 100%;
  height: 22px;
  padding: 0 var(--space-1);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--titlebar-ink, var(--chrome-text));
  font: var(--fw-medium) var(--type-caption) / 1 var(--font-sans);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.title-usage:hover {
  border-color: var(--line-strong);
  background: var(--wash-4);
}

/* Under the line, as wide as the cards want and never wider than the window. */
.title-usage-cards {
  position: fixed;
  width: min(900px, calc(100vw - 2rem));
  padding: var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  margin: 0;
  background: var(--panel);
  box-shadow: var(--shadow-menu);
  color: var(--text);
  inset: auto;
  position-area: block-end span-inline-end;
  position-try-fallbacks: flip-inline;
  -webkit-app-region: no-drag;
}
</style>
