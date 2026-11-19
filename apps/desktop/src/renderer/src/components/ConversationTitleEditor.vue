<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  CONVERSATION_TITLE_CHARS,
  type ConversationIdentity,
  type ConversationRenameInput,
  type ConversationRenameResult,
} from '../../../shared/conversation-title'
import { theWorkThatNamesItSaid, type WorkThatNamesIt } from '../../../shared/piece-called'
import type { CreatedSession } from '../../../shared/runtime-ipc'
import { basenameOf } from '../lib/paths'
import { readableError } from '../lib/session-record'

const props = defineProps<{
  session: Pick<CreatedSession, 'sessionId' | 'cwd'> | null
  named: WorkThatNamesIt | null
  identity?: ConversationIdentity | null
  openTask?: () => void
  rename?: (input: ConversationRenameInput) => Promise<ConversationRenameResult>
}>()

const conversation = computed(() => props.session?.sessionId)
const renamable = computed(() => (props.rename === undefined ? undefined : conversation.value))
const identity = computed(() =>
  props.identity?.conversation === conversation.value ? (props.identity ?? null) : null,
)
const task = computed(() => (props.named === null ? null : theWorkThatNamesItSaid(props.named)))
const title = computed(() => {
  if (!props.session) return 'New conversation'
  return (
    identity.value?.title ??
    task.value ??
    (basenameOf(props.session.cwd) || props.session.sessionId)
  )
})

const renaming = ref(false)
const draft = ref('')
const saving = ref(false)
const refused = ref<string | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
let edit = 0

function startRenaming(): void {
  draft.value = identity.value?.title ?? props.named?.title ?? title.value
  refused.value = null
  renaming.value = true
  void nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}

function stopRenaming(): void {
  edit += 1
  renaming.value = false
  saving.value = false
  refused.value = null
}

function stopRenamingUnlessSaving(): void {
  if (!saving.value) stopRenaming()
}

async function save(): Promise<void> {
  const id = renamable.value
  if (id === undefined || props.rename === undefined || saving.value) return
  const currentEdit = edit
  saving.value = true
  refused.value = null
  try {
    const result = await props.rename({ conversation: id, title: draft.value })
    if (currentEdit !== edit) return
    if (result.ok) stopRenaming()
    else refused.value = result.reason
  } catch (cause) {
    if (currentEdit === edit) refused.value = readableError(cause)
  } finally {
    if (currentEdit === edit) {
      saving.value = false
      void nextTick(() => titleInput.value?.focus())
    }
  }
}

watch(renamable, stopRenaming, { flush: 'sync' })
</script>

<template>
  <div class="header-title">
    <h1 :title="props.session?.cwd ?? ''" data-cy="conversation-title">
      <template v-if="renamable && renaming">
        <input
          ref="titleInput"
          v-model="draft"
          class="title-input"
          data-cy="conversation-title-input"
          :maxlength="CONVERSATION_TITLE_CHARS"
          :disabled="saving"
          aria-label="Conversation title"
          aria-describedby="conversation-title-help"
          @keydown.enter.prevent="save"
          @keydown.esc.stop.prevent="stopRenaming"
          @blur="stopRenamingUnlessSaving"
        />
      </template>
      <button
        v-else-if="renamable"
        type="button"
        class="title-press"
        data-cy="conversation-title-rename"
        :aria-label="`Rename ${title}`"
        @click="startRenaming"
      >
        {{ title }}<span class="title-edit-mark" aria-hidden="true"></span>
      </button>
      <template v-else>{{ title }}</template>
    </h1>
    <small v-if="identity || (renaming && task)" class="title-detail">
      <template v-if="identity">
        <template v-if="identity.author?.kind === 'person'">Named by you · </template>
        <span data-cy="conversation-address">Conversation {{ identity.address }}</span>
      </template>
      <template v-if="task">
        <template v-if="identity"> · </template>
        <button
          v-if="props.openTask"
          class="title-task"
          type="button"
          data-cy="conversation-linked-task"
          @click="props.openTask"
        >
          Task {{ task }}
        </button>
        <span v-else data-cy="conversation-linked-task">Task {{ task }}</span>
      </template>
    </small>
    <small v-if="renaming" id="conversation-title-help" class="title-detail title-help">
      Name it after the job. Renaming keeps its address.
    </small>
    <small
      v-if="renaming && refused"
      class="title-refused"
      role="alert"
      data-cy="conversation-title-refused"
      :title="refused"
      >{{ refused }}</small
    >
  </div>
</template>

<style scoped>
.header-title {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-6);
  grid-column: 1 / 3;
  grid-row: 1;
}

h1 {
  overflow: visible;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-style: var(--font-style-display, normal);
  font-weight: var(--fw-display, var(--fw-heavy));
  letter-spacing: var(--tracking-display, var(--tracking-tight));
  line-height: var(--leading-tight);
  white-space: normal;
  overflow-wrap: anywhere;
}

.title-press {
  display: block;
  overflow: visible;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  letter-spacing: inherit;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  font: inherit;
}

.title-edit-mark::before {
  margin-inline-start: var(--space-4);
  color: var(--muted);
  content: '✎';
  font-size: var(--type-caption);
}

.title-press:focus-visible,
.title-input:focus {
  outline-offset: calc(-1 * var(--focus-ring-width));
}

.title-input {
  width: 28ch;
  max-width: 100%;
  padding: 0 var(--space-3);
  letter-spacing: inherit;
}

.title-detail {
  display: block;
  min-width: 0;
  max-width: 100%;
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.title-task {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  cursor: pointer;
  font: inherit;
  overflow-wrap: anywhere;
  text-align: start;
  text-decoration: underline;
}

.title-help,
.title-refused {
  flex-basis: 100%;
}

.title-refused {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--danger-text);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
