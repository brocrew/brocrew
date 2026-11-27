<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  CURRENT_RULES_CHARS,
  type CurrentRules,
  type CurrentRulesResult,
} from '../../../shared/conversation-title'
import { agoWords } from '../lib/clock'
import { readableError } from '../lib/session-record'
import { useMinuteClock } from '../composables/useMinuteClock'
import CardSection from './CardSection.vue'

/**
 * A conversation's current rules on its agent card: the text every turn's footer carries, its size
 * against the bound, and who changed it last. Where `save` is handed, the person can edit the text
 * or delete it; each save is one more record, and the newest stands.
 */
const props = defineProps<{
  rules: CurrentRules
  save?: (text: string) => Promise<CurrentRulesResult>
}>()

const minute = useMinuteClock()
const editing = ref(false)
const deleting = ref(false)
const draft = ref('')
const busy = ref(false)
const refused = ref<string | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

const limit = CURRENT_RULES_CHARS.toLocaleString('en-US')
const size = computed(() =>
  (editing.value ? draft.value.trim() : props.rules.text).length.toLocaleString('en-US'),
)
const changed = computed(
  () =>
    `Set by ${props.rules.by === 'person' ? 'you' : 'the agent'} · ${agoWords(props.rules.at, minute.value)}`,
)

function startEditing(): void {
  draft.value = props.rules.text
  refused.value = null
  deleting.value = false
  editing.value = true
  void nextTick(() => input.value?.focus())
}

function stop(): void {
  editing.value = false
  deleting.value = false
  refused.value = null
}

async function send(text: string): Promise<void> {
  if (props.save === undefined || busy.value) return
  busy.value = true
  refused.value = null
  try {
    const result = await props.save(text)
    if (result.ok) stop()
    else refused.value = result.reason
  } catch (cause) {
    refused.value = readableError(cause)
  } finally {
    busy.value = false
  }
}

// Another write, by the agent or another window, closes an open edit rather than saving over it.
watch([() => props.rules.text, () => props.rules.at], () => {
  if (!busy.value) stop()
})
</script>

<template>
  <CardSection
    class="card-rules"
    icon="#i-list"
    accent
    aria-label="Current rules"
    data-cy="card-rules"
  >
    <template #title>
      Current rules
      <span class="rules-size" data-cy="card-rules-size"
        >· sent with every turn ({{ size }}/{{ limit }})</span
      >
    </template>
    <template v-if="props.save && !editing && !deleting" #action>
      <button
        type="button"
        class="bb-link rules-link"
        data-cy="card-rules-edit"
        @click="startEditing"
      >
        Edit
      </button>
      <button
        type="button"
        class="bb-link rules-link"
        data-cy="card-rules-delete"
        @click="deleting = true"
      >
        Delete
      </button>
    </template>
    <template v-if="editing">
      <textarea
        ref="input"
        v-model="draft"
        class="bb-input rules-input"
        data-cy="card-rules-input"
        rows="5"
        :maxlength="CURRENT_RULES_CHARS"
        :disabled="busy"
        aria-label="Current rules"
        @keydown.esc.stop.prevent="stop"
      ></textarea>
      <p class="rules-acts">
        <button
          type="button"
          class="bb-button bb-button--primary"
          data-cy="card-rules-save"
          :disabled="busy || draft.trim() === ''"
          @click="send(draft)"
        >
          Save
        </button>
        <button type="button" class="bb-button" :disabled="busy" @click="stop">Cancel</button>
      </p>
    </template>
    <p v-else class="rules-text" data-cy="card-rules-text">{{ props.rules.text }}</p>
    <div
      v-if="deleting"
      role="alertdialog"
      aria-label="Delete current rules"
      class="rules-acts"
      data-cy="card-rules-delete-confirmation"
      @keydown.esc.stop="stop"
    >
      <span>Delete these rules?</span>
      <button
        type="button"
        class="bb-button"
        data-cy="card-rules-delete-confirm"
        :disabled="busy"
        @click="send('')"
      >
        Delete
      </button>
      <button type="button" class="bb-button" :disabled="busy" @click="stop">Cancel</button>
    </div>
    <p v-if="refused" class="bb-caption rules-refused" role="alert" data-cy="card-rules-refused">
      {{ refused }}
    </p>
    <p class="bb-caption rules-changed" data-cy="card-rules-changed">{{ changed }}</p>
  </CardSection>
</template>

<style scoped>
.card-rules {
  margin: 0 var(--space-5) var(--space-5);
}

.rules-size {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: normal;
}

.rules-link + .rules-link {
  margin-left: var(--space-5);
}

.rules-text {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-body);
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.rules-input {
  resize: vertical;
  font: inherit;
  line-height: 1.5;
}

.rules-acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  gap: var(--space-4);
}

.rules-changed,
.rules-refused {
  margin: 0;
}

.rules-refused {
  color: var(--danger-text);
}
</style>
