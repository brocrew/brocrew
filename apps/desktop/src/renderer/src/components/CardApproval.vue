<script lang="ts">
/** Each panel's id and anchor name, unique across every app on the page (see `ModelPicker`). */
let made = 0
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { YOLO_MEANS, YOLO_MEANS_FOR_AGENTS_IT_STARTS } from '../lib/approval-mode'
import { FIXED_SAYS, type ApprovalControl } from '../composables/useConversationControls'
import { ROLE_PROPERTIES } from '../lib/text-roles'

/**
 * The approval mode beside the agent's plate. A press opens what the mode means, in the words the
 * launch doors use, before anything is changed; the change itself is the panel's confirm. A
 * conversation whose settings are fixed opens the same panel with no confirm.
 */
const props = defineProps<{ approval: ApprovalControl }>()
const emit = defineEmits<{ choose: [mode: 'ask' | 'auto'] }>()

made += 1
const panelId = `card-approval-${made}`
const anchor = `--${panelId}`

const face = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const isOpen = ref(false)

function hide(): void {
  const element = panel.value
  if (element !== null && element.matches(':popover-open')) element.hidePopover()
}

function close(): void {
  hide()
  face.value?.focus()
}

// Before the browser shows or hides the panel, so its contents are there as it opens.
function onBeforeToggle(event: Event): void {
  isOpen.value = (event as ToggleEvent).newState === 'open'
}

// Focus goes to the panel itself rather than to the confirm, so the meaning is read before a key
// can change the mode.
async function onToggle(event: Event): Promise<void> {
  if ((event as ToggleEvent).newState !== 'open') return
  await nextTick()
  panel.value?.focus()
}

function confirm(): void {
  emit('choose', props.approval.next)
  close()
}

// Escape is ours while the panel is open, and stopped: the conversation interrupts a running turn
// on a window Escape.
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isOpen.value) return
  close()
  event.stopPropagation()
  event.preventDefault()
}

watch(isOpen, (now) => {
  if (now) window.addEventListener('keydown', onEscape, { capture: true })
  else window.removeEventListener('keydown', onEscape, { capture: true })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape, { capture: true }))
</script>

<template>
  <span class="card-approval">
    <button
      ref="face"
      type="button"
      class="bb-button bb-button--quiet approval-face"
      data-cy="card-approval"
      :data-mode="props.approval.mode"
      :data-pending="props.approval.pending ?? ''"
      :data-changeable="props.approval.changeable"
      :popovertarget="panelId"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :aria-label="props.approval.label"
      :style="{ anchorName: anchor }"
    >
      {{ props.approval.word }}
    </button>
    <div
      :id="panelId"
      ref="panel"
      class="approval-panel"
      popover="auto"
      role="dialog"
      aria-label="Approval mode"
      tabindex="-1"
      data-cy="card-approval-panel"
      :style="[ROLE_PROPERTIES, { positionAnchor: anchor }]"
      @beforetoggle="onBeforeToggle"
      @toggle="onToggle"
    >
      <template v-if="isOpen">
        <p class="approval-now" data-cy="card-approval-now">{{ props.approval.now }}</p>
        <p class="approval-note" data-cy="card-approval-note">{{ props.approval.note }}</p>
        <!-- The launch doors' disclosure, the same constants: shown before a change is confirmed,
             and for a mode that is or will be yolo. -->
        <p
          v-if="
            props.approval.changeable || (props.approval.pending ?? props.approval.mode) === 'auto'
          "
          class="approval-means"
          data-cy="yolo-means"
        >
          {{ YOLO_MEANS }}
          <span v-if="props.approval.reach" data-cy="yolo-reach">{{ props.approval.reach }}</span>
          {{ ' ' }}
          <span data-cy="yolo-means-descendants">{{ YOLO_MEANS_FOR_AGENTS_IT_STARTS }}</span>
        </p>
        <p v-if="!props.approval.changeable" class="approval-note" data-cy="card-approval-fixed">
          {{ FIXED_SAYS }}
        </p>
        <div class="approval-acts">
          <button
            v-if="props.approval.changeable"
            type="button"
            class="bb-button bb-button--primary"
            data-cy="card-approval-confirm"
            :data-next="props.approval.next"
            @click="confirm"
          >
            {{ props.approval.confirmWords }}
          </button>
          <button
            type="button"
            class="bb-button bb-button--quiet"
            data-cy="card-approval-close"
            @click="close"
          >
            Close
          </button>
        </div>
      </template>
    </div>
  </span>
</template>

<style scoped>
.card-approval {
  display: inline-flex;
  flex: none;
  margin-left: auto;
}

/* Small enough to sit in the name's row without changing its height. */
.approval-face {
  min-height: 24px;
  height: 24px;
  padding: 0 var(--space-3);
  font-size: var(--type-caption);
  white-space: nowrap;
}

/* Placed by its face, in the top layer, as the model picker's panel is. */
.approval-panel {
  position: fixed;
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(70vh, 32rem);
  padding: var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  margin: 0;
  background: var(--panel-3);
  box-shadow: var(--shadow);
  color: var(--text-soft);
  /* What the mode does is read before it is chosen, so it is set as reading text. */
  font-size: var(--role-prose);
  inset: auto;
  overflow-y: auto;
  position-area: block-end span-inline-start;
  position-try-fallbacks: flip-block, flip-inline;
}

.approval-panel:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.approval-now,
.approval-note,
.approval-means {
  margin: 0 0 var(--space-3);
  line-height: var(--leading-relaxed);
}

.approval-note,
.approval-means {
  color: var(--muted);
}

.approval-acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
</style>
