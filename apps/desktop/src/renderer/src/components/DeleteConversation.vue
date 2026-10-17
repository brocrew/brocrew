<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { DeleteOutcome, DeleteVerdict } from '../../../shared/conversation-archive'
import {
  archiveConversation,
  checkDelete,
  deleteTicked,
  partsSaid,
  pointsToArchive,
  recordsWent,
  theTreeOf,
  tickedAtFirst,
  whatItCannotRemove,
  type ArchiveBridge,
} from '../lib/archive-and-delete'
import { sizeWords } from '../lib/files-kept'

/**
 * The confirmation a person meets before a conversation is deleted.
 *
 * Main reads what a delete would remove first. A refusal is shown as main wrote it, with Archive
 * offered where the refusal names it. Otherwise each part is a checkbox, and only the ticked parts
 * are sent. What the delete ends, what stays and what it cannot remove are listed under the ticks,
 * the recovery copies on a line of their own.
 */
const props = defineProps<{ sessionId: string }>()

const emit = defineEmits<{
  close: []
  /** The conversations an Archive pressed here took out of the lists. */
  archived: [conversations: readonly string[]]
  /** The conversations whose records a delete removed. */
  deleted: [conversations: readonly string[]]
}>()

const bridge = (): ArchiveBridge => window.api.runtime

/** Main's answer to the check, or null while it is being read. Held whole, never proxied. */
const verdict = shallowRef<DeleteVerdict | null>(null)
const ticked = ref<readonly string[]>([])
const outcome = shallowRef<DeleteOutcome | null>(null)
const busy = ref(false)
const archiveRefused = ref<string | null>(null)

const listed = computed(() => {
  const read = verdict.value
  return read !== null && read.ok ? read : null
})
const refused = computed(() => {
  const read = verdict.value
  return read !== null && !read.ok ? read.refusal : null
})
const done = computed(() => {
  const did = outcome.value
  return did !== null && did.done ? did : null
})
const notDone = computed(() => {
  const did = outcome.value
  return did !== null && !did.done ? did.refusal : null
})
const cannot = computed(() => whatItCannotRemove(listed.value?.cannot ?? []))
const went = computed(() => {
  const asked = listed.value
  const did = done.value
  return asked !== null && did !== null ? partsSaid(asked.parts, did.removed) : []
})

const title = computed(() => {
  const asked = listed.value
  if (asked === null) return 'Delete a conversation'
  return done.value === null ? `Delete ${asked.name}?` : `What deleting ${asked.name} did`
})

async function read(): Promise<void> {
  if (busy.value) return
  busy.value = true
  outcome.value = null
  archiveRefused.value = null
  try {
    const answer = await checkDelete(bridge(), props.sessionId)
    verdict.value = answer
    ticked.value = answer.ok ? tickedAtFirst(answer.parts) : []
  } finally {
    busy.value = false
  }
}

function tick(id: string, on: boolean): void {
  const without = ticked.value.filter((one) => one !== id)
  ticked.value = on ? [...without, id] : without
}

async function confirm(): Promise<void> {
  const asked = listed.value
  if (asked === null || busy.value || ticked.value.length === 0) return
  busy.value = true
  try {
    const did = await deleteTicked(bridge(), props.sessionId, asked.parts, new Set(ticked.value))
    outcome.value = did
    if (recordsWent(did)) emit('deleted', theTreeOf(asked))
  } finally {
    busy.value = false
  }
}

async function archiveInstead(): Promise<void> {
  if (busy.value) return
  busy.value = true
  archiveRefused.value = null
  try {
    const answer = await archiveConversation(bridge(), props.sessionId)
    if (!answer.done) {
      archiveRefused.value = answer.refusal
      return
    }
    emit('archived', answer.conversations)
    emit('close')
  } finally {
    busy.value = false
  }
}

onMounted(() => void read())
</script>

<template>
  <section
    class="delete-dialog"
    aria-labelledby="delete-conversation-title"
    data-cy="delete-conversation"
  >
    <header class="head">
      <h2 id="delete-conversation-title" class="bb-title" data-cy="delete-title">{{ title }}</h2>
      <button
        class="bb-button bb-button--icon"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>

    <div class="body">
      <p v-if="verdict === null" class="quiet" role="status" data-cy="delete-reading">
        Reading what a delete would remove…
      </p>

      <template v-else-if="refused !== null">
        <p class="refusal" role="alert" data-cy="delete-refusal">{{ refused }}</p>
        <p v-if="archiveRefused" class="refusal" role="alert" data-cy="delete-archive-refused">
          {{ archiveRefused }}
        </p>
        <div class="actions">
          <button
            v-if="pointsToArchive(refused)"
            type="button"
            class="bb-button bb-button--primary"
            :disabled="busy"
            data-cy="delete-archive-instead"
            @click="archiveInstead"
          >
            Archive
          </button>
          <button type="button" class="bb-button" data-cy="delete-close" @click="emit('close')">
            Close
          </button>
        </div>
      </template>

      <template v-else-if="notDone !== null">
        <p class="refusal" role="alert" data-cy="delete-not-done">{{ notDone }}</p>
        <p class="quiet" data-cy="delete-nothing-removed">Nothing was removed.</p>
        <div class="actions">
          <button
            type="button"
            class="bb-button bb-button--primary"
            :disabled="busy"
            data-cy="delete-read-again"
            @click="read"
          >
            Read it again
          </button>
          <button type="button" class="bb-button" data-cy="delete-close" @click="emit('close')">
            Close
          </button>
        </div>
      </template>

      <template v-else-if="listed !== null && done !== null">
        <section class="facts" data-cy="delete-removed">
          <h3>Deleted</h3>
          <ul v-if="went.length > 0">
            <li v-for="line in went" :key="line">{{ line }}</li>
          </ul>
          <p v-else class="quiet">Nothing was deleted.</p>
        </section>
        <p
          v-if="done.recordsKept !== null"
          class="refusal"
          role="alert"
          data-cy="delete-records-kept"
        >
          {{ done.recordsKept }}
        </p>
        <section v-if="done.left.length > 0" class="facts" data-cy="delete-left">
          <h3>Left where it was</h3>
          <ul>
            <li v-for="one in done.left" :key="one.path">
              <span class="bb-mono">{{ one.path }}</span> — {{ one.why }}
            </li>
          </ul>
        </section>
        <div class="actions">
          <button type="button" class="bb-button" data-cy="delete-close" @click="emit('close')">
            Close
          </button>
        </div>
      </template>

      <template v-else-if="listed !== null">
        <p class="quiet">
          Tick what to delete. Only the ticked parts go, and a delete can’t be undone.
        </p>
        <ul class="parts" data-cy="delete-parts">
          <li
            v-for="part in listed.parts"
            :key="part.id"
            class="part"
            data-cy="delete-part"
            :data-part="part.id"
            :data-kind="part.kind"
          >
            <label class="tick">
              <input
                type="checkbox"
                :checked="ticked.includes(part.id)"
                :disabled="busy"
                data-cy="delete-tick"
                @change="tick(part.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="says"
                >{{ part.says
                }}<template v-if="part.kind === 'provider-files' && part.bytes !== null">
                  · <span data-cy="delete-size">{{ sizeWords(part.bytes) }}</span></template
                ></span
              >
            </label>
            <details
              v-if="part.kind === 'provider-files' && part.paths.length > 0"
              class="paths"
              data-cy="delete-paths"
            >
              <summary>
                {{ part.paths.length }} {{ part.paths.length === 1 ? 'path' : 'paths' }}
              </summary>
              <ul>
                <li v-for="path in part.paths" :key="path" class="bb-mono">{{ path }}</li>
              </ul>
            </details>
          </li>
        </ul>

        <section v-if="listed.ends.length > 0" class="facts" data-cy="delete-ends">
          <h3>What it ends</h3>
          <ul>
            <li v-for="line in listed.ends" :key="line">{{ line }}</li>
          </ul>
        </section>
        <section v-if="listed.stays.length > 0" class="facts" data-cy="delete-stays">
          <h3>What stays</h3>
          <ul>
            <li v-for="line in listed.stays" :key="line">{{ line }}</li>
          </ul>
        </section>
        <section class="facts" data-cy="delete-cannot">
          <h3>What it can’t remove</h3>
          <p
            v-for="line in cannot.recoveryCopies"
            :key="line"
            class="recovery"
            data-cy="delete-recovery-copies"
          >
            {{ line }}
          </p>
          <ul v-if="cannot.rest.length > 0">
            <li v-for="line in cannot.rest" :key="line">{{ line }}</li>
          </ul>
        </section>

        <div class="actions">
          <button type="button" class="bb-button" data-cy="delete-cancel" @click="emit('close')">
            Cancel
          </button>
          <button
            type="button"
            class="bb-button danger"
            :disabled="busy || ticked.length === 0"
            data-cy="delete-confirm"
            @click="confirm"
          >
            {{ busy ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.delete-dialog {
  display: flex;
  width: min(560px, calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}

.head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--control-gap);
}

.head h2 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.body {
  display: grid;
  min-height: 0;
  padding: var(--dialog-padding);
  overflow: auto;
  align-content: start;
  font-size: var(--type-small);
  gap: var(--space-5);
  grid-auto-rows: max-content;
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.body p,
.body ul {
  margin: 0;
}

.quiet {
  color: var(--muted);
}

.refusal {
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger-text);
}

.parts {
  display: grid;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}

.part {
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
}

.tick {
  display: flex;
  align-items: flex-start;
  cursor: pointer;
  gap: var(--space-4);
}

.tick input {
  flex: none;
  margin-top: var(--space-1);
}

.says {
  min-width: 0;
  color: var(--text);
}

.paths {
  margin-top: var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
}

.paths summary {
  cursor: pointer;
}

.paths ul {
  display: grid;
  margin-top: var(--space-2);
  padding-left: var(--space-6);
  gap: var(--space-1);
}

.facts h3 {
  margin: 0 0 var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.facts ul {
  display: grid;
  padding-left: var(--space-6);
  color: var(--muted);
  gap: var(--space-1);
}

/* The recovery copies, on a line of their own: the one thing here a person may not expect. */
.recovery {
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-sm);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
}

.recovery + ul {
  margin-top: var(--space-3);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-4);
}

.danger {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text);
  font-weight: var(--fw-semibold);
}

.danger:hover:not(:disabled) {
  border-color: var(--danger-border);
  background: var(--danger-fill-hover);
}

.bb-button:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
