<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useUsageCells } from '../composables/useUsageCells'
import { useClientProviders } from '../client-provider/injection'
import { useProviderConnections } from '../composables/useProviderConnections'
import { useProviderNames } from '../composables/useProviderNames'
import { providerNamesIn } from '../lib/front-door-words'
import UsageCards from './UsageCards.vue'

const client = useClientProviders()
const nameOfProvider = useProviderNames(client)
const connections = useProviderConnections()
let open = true
const { cells, variants, description } = useUsageCells(
  () => providerNamesIn(nameOfProvider),
  () => connections.value,
)
const button = ref<HTMLButtonElement | null>(null)
const measure = ref<HTMLElement | null>(null)
const chosen = ref(0)
const line = computed(() => variants.value[chosen.value] ?? variants.value[0])
let observer: ResizeObserver | undefined
function fit(): void {
  const press = button.value
  const probe = measure.value
  const parent = press?.parentElement
  if (!press || !probe || !parent) return
  const style = getComputedStyle(press)
  // Its left edge includes the preceding controls' widths, gaps and margins without measuring its own text.
  const room =
    parent.getBoundingClientRect().right -
    press.getBoundingClientRect().left -
    Number.parseFloat(getComputedStyle(parent).paddingRight) -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight) -
    Number.parseFloat(style.borderLeftWidth) -
    Number.parseFloat(style.borderRightWidth)
  let index = variants.value.length - 1
  for (const [candidate, words] of variants.value.entries()) {
    probe.textContent = words
    if (probe.getBoundingClientRect().width <= room) {
      index = candidate
      break
    }
  }
  chosen.value = index
}
watch(
  variants,
  () =>
    void nextTick().then(() => {
      if (open) fit()
    }),
  { flush: 'post' },
)
onMounted(() => {
  observer = new ResizeObserver(fit)
  if (button.value?.parentElement) observer.observe(button.value.parentElement)
  fit()
  void document.fonts.ready.then(() => {
    if (open) fit()
  })
})
onBeforeUnmount(() => {
  open = false
  observer?.disconnect()
})
const cardsId = `title-usage-${useId()}`
</script>

<template>
  <button
    ref="button"
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
  <span ref="measure" class="title-usage-measure" aria-hidden="true" />
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
.title-usage,
.title-usage-measure {
  font: var(--fw-medium) var(--type-caption) / 1 var(--font-sans);
  font-variant-numeric: tabular-nums;
  text-rendering: inherit;
}
.title-usage-measure {
  position: fixed;
  top: -10000px;
  left: 0;
  visibility: hidden;
  white-space: nowrap;
  pointer-events: none;
}
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
