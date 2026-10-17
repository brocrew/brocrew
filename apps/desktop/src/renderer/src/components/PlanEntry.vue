<script setup lang="ts">
import { computed } from 'vue'
import DocumentBody from './DocumentBody.vue'
import type { PlanItem } from '../lib/transcript'

/**
 * The agent's working checklist (028) — what it set out to do, and how far through it is.
 *
 * **It updates in place and never accumulates.** The fold hands this component the complete list on
 * every revision, so there is nothing here to merge and no history to keep: a step that turns green
 * is the same row changing, not a new one appended. That is the whole reason the neutral event
 * REPLACES rather than appends — Claude's todo tools are incremental on the wire, and if that
 * incrementality reached this far the list would flicker down to a single row on every change.
 *
 * The state-colour grammar is the same one the rest of the app uses: pending quiet, active accent,
 * done green. The marks are not colour alone — a done step is ticked and struck through, an active
 * one pulses — because two of those three colours are a red-green-blind reader's identical dot.
 *
 * The `v-for` keys on INDEX, which is usually the wrong instinct — but a step has no identity to
 * key on. The neutral event carries `{text, status}` and nothing else, deliberately: Codex's plan
 * has no per-step ids either, so inventing one here would mean inventing it in the adapter. Keying
 * on the text was worse: a step removed from the middle (Claude's `deleted`) shifts every step
 * below it, so every key changed, and Vue destroyed and recreated rows that had not changed —
 * restarting the active row's pulse animation mid-cycle. With the index, the DOM node persists and
 * only its content and class change, which is exactly what a list that is replaced wholesale wants.
 */
const props = defineProps<{ item: PlanItem }>()

const done = computed(() => props.item.steps.filter((step) => step.status === 'done').length)

/**
 * "2 of 5" is the honest headline; the plan being empty is a different statement entirely — and
 * since 030 there is a third case, because a plan DOCUMENT arrives with no checklist at all. Saying
 * "plan cleared" over a freshly proposed plan would be precisely backwards.
 */
const heading = computed(() => {
  if (props.item.steps.length > 0) return `plan · ${done.value} of ${props.item.steps.length}`
  return props.item.body ? 'the plan' : 'plan cleared'
})
</script>

<template>
  <section class="plan" data-cy="plan-entry" :data-steps="item.steps.length" :data-done="done">
    <header class="plan-head">
      <svg class="icon"><use href="#i-check" /></svg>
      <span class="title" data-cy="plan-heading">{{ heading }}</span>
    </header>

    <ol v-if="item.steps.length" class="steps">
      <li
        v-for="(step, index) in item.steps"
        :key="index"
        class="step"
        :class="step.status"
        :data-cy="'plan-step'"
        :data-status="step.status"
      >
        <span class="mark" aria-hidden="true">{{ step.status === 'done' ? '✓' : '' }}</span>
        <span class="text">{{ step.text }}</span>
      </li>
    </ol>

    <!-- Codex's `explanation`: a sentence ABOUT the plan, which is why it sits under the list
         rather than inside it. Null while the plan is being worked, set when it completes. -->
    <p v-if="item.note" class="note" data-cy="plan-note">{{ item.note }}</p>

    <!-- The plan itself (030). A DOCUMENT, so it goes through the one document viewer — white
         paper, Markdown/Raw — rather than being re-rendered as chat prose here. That is the
         standing rule and it is not decoration: a document you cannot see the raw of is a rendering
         you have to take on trust, and this is the thing the user is being asked to approve. -->
    <div v-if="item.body" class="body" data-cy="plan-body">
      <DocumentBody :source="item.body" filename="plan.md" compact />
    </div>
  </section>
</template>

<style scoped>
.plan {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-6);
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--wash-1);
}

.plan-head {
  display: flex;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.plan-head .icon {
  width: 11px;
  height: 11px;
}

.steps {
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.step {
  display: grid;
  align-items: baseline;
  padding: var(--space-1) 0;
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-4);
  grid-template-columns: 12px minmax(0, 1fr);
  line-height: var(--leading-relaxed);
}

/* The mark carries the state as a SHAPE, so the colours below are reinforcement and never the
   only signal: an empty ring pending, a filled pulsing dot active, a tick done. */
.mark {
  display: grid;
  width: 12px;
  height: 12px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  font-size: var(--type-caption);
  place-items: center;
  transform: translateY(1px);
}

.step.active {
  color: var(--text-soft);
}

.step.active .mark {
  animation: pulse 1.4s ease-in-out infinite;
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.step.done {
  color: var(--faint);
}

/* Struck through as well as ticked — the second, non-colour way of saying "finished". */
.step.done .text {
  text-decoration: line-through;
}

.step.done .mark {
  border-color: var(--success);
  color: var(--success);
}

.note {
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

/* The wrapper only positions the paper — every rule about how a document LOOKS belongs to
   `DocumentBody`, or the plan here and the same plan in the drawer would drift apart (030). The
   type and colour rules that used to live here went with the chat rendering they were for. */
.body {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-width) solid var(--line);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
