<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UnknownItem } from '../lib/transcript'

/**
 * A provider payload the adapter did not map to a first-class event.
 *
 * Two very different things used to look identical here (049). Now the runtime CLASSIFIES them
 * and this component switches on that neutral `category` alone — never on Codex/Claude specifics:
 *
 *  - `unrecognized` — genuinely novel or malformed. Stays a **prominent** foldable card: the whole
 *    point of the variant is that a surprise surfaces instead of crashing the screen.
 *  - everything else — recognized chatter (reasoning, plan, lifecycle, activity, echo). Rendered
 *    as a **quiet** one-liner so it stops drowning the real signal. The payload is still carried
 *    and still inspectable, so nothing is lost.
 */
const props = defineProps<{ item: UnknownItem }>()

const isUnrecognized = computed(() => props.item.category === 'unrecognized')
const folded = ref(true)

/**
 * `category · label` when the adapter named the kind, else the category alone (072).
 *
 * `label` is an OPAQUE string the runtime stamped — the renderer never learns where it came from.
 * That is the whole point: the kind lives at a different path inside `raw` for each provider, so
 * reading it here would force a Codex/Claude branch and break provider-agnosticism.
 */
const summary = computed(() =>
  props.item.label ? `${props.item.category} · ${props.item.label}` : props.item.category,
)

const raw = computed(() => {
  try {
    return JSON.stringify(props.item.raw, null, 2) ?? String(props.item.raw)
  } catch {
    return String(props.item.raw)
  }
})
</script>

<template>
  <div
    v-if="isUnrecognized"
    class="unknown-entry"
    :class="{ folded }"
    data-cy="unknown-entry"
    :data-category="item.category"
  >
    <button class="unknown-head" type="button" @click="folded = !folded">
      <span class="tag">unknown</span>
      <span>Unmodeled event</span>
      <span class="type">{{ item.provider }}{{ item.label ? ` · ${item.label}` : '' }}</span>
      <svg class="icon chevron"><use href="#i-chevron" /></svg>
    </button>
    <pre class="unknown-body">{{ raw }}</pre>
  </div>

  <details v-else class="chatter" data-cy="chatter-entry" :data-category="item.category">
    <summary>{{ summary }}</summary>
    <pre>{{ raw }}</pre>
  </details>
</template>

<style scoped>
.unknown-entry {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-6);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--ready-bg);
  overflow: hidden;
}

.unknown-head {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border: 0;
  background: transparent;
  color: var(--ready);
  font-size: var(--type-caption);
  gap: var(--space-4);
  text-align: left;
}

.tag {
  padding: 1px var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  color: var(--neutral-glyph);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.type {
  overflow: hidden;
  color: var(--muted);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  width: 14px;
  height: 14px;
  margin-left: auto;
  flex: 0 0 auto;
  transition: transform var(--dur-fast) ease;
}

.unknown-entry.folded .unknown-body {
  display: none;
}

.unknown-entry.folded .chevron {
  transform: rotate(90deg);
}

.unknown-body {
  max-height: 220px;
  margin: 0;
  padding: var(--space-5) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  background: var(--code-bg-weak);
  color: var(--code-text-quiet);
  font: var(--type-caption) / 1.5 var(--font-mono);
  overflow: auto;
  white-space: pre-wrap;
}

/* Recognized chatter: dim, compact, out of the way — but still expandable. */
.chatter {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-3);
  color: var(--faint);
  font: var(--type-caption) / 1.5 var(--font-mono);
}

.chatter > summary {
  cursor: pointer;
  opacity: 0.75;
}

.chatter pre {
  max-height: 220px;
  margin: var(--space-4) 0 0;
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--code-bg-weak);
  overflow: auto;
  white-space: pre-wrap;
}
</style>
