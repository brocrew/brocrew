<script setup lang="ts">
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { TranscriptItem, UserItem } from '../lib/transcript'
import { noSentBecause } from '../lib/agent-inputs'
import ModelGotSwitch from './ModelGotSwitch.vue'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import { escaped } from '../lib/named-in-a-reply'
import PersonWords from './PersonWords.vue'
import AttachmentChips from './AttachmentChips.vue'

const props = defineProps<{
  item: UserItem & Pick<TranscriptItem, 'at' | 'ordinal'>
  /** This conversation's paths. Absent: a path in the message stays plain text. */
  paths?: PathsHere | null
}>()

const emit = defineEmits<{ openConversation: [sessionId: string] }>()
const paths = usePathsIn(
  () => props.paths,
  () => [escaped(props.item.text)],
)
</script>

<template>
  <article class="msg user">
    <div class="msg-avatar">
      <svg class="icon"><use href="#i-user" /></svg>
    </div>
    <div class="msg-column">
      <div class="msg-meta">
        <strong>You</strong>
        <!-- Imported turns use provider attribution in the metadata row. -->
        <span
          v-if="item.attribution === 'provider_transcript'"
          class="attributed"
          data-cy="user-attributed"
          title="From the provider's own transcript file. This app did not watch it being typed."
          >(per the transcript)</span
        >
        <!-- Keep time outside the body so copying and searching return the person's words. -->
        <span class="time">{{ clockTime(item.at) }}</span>
      </div>
      <button
        v-if="item.movedFrom"
        type="button"
        data-cy="moved-from"
        @click="emit('openConversation', item.movedFrom.sessionId)"
      >
        Moved from {{ item.movedFrom.name }}.
      </button>
      <div
        class="msg-body"
        data-cy="user-message"
        :data-at="clockTime(item.at)"
        :title="fullTime(item.at)"
        @click="paths.clicked"
      >
        <PersonWords :text="item.text" :found="paths" />
      </div>
      <p
        v-if="paths.failure.value"
        class="message-path-failure"
        role="status"
        data-cy="message-path-failure"
      >
        {{ paths.failure.value }}
      </p>
      <!-- Keep app-supplied attachments outside the person's message text. -->
      <AttachmentChips
        v-if="item.attachments?.length"
        :attachments="item.attachments"
        :paths="props.paths"
      />
      <ModelGotSwitch
        :words="item.text"
        :sent="item.sent"
        :ordinal="item.ordinal"
        :together="item.sentWithOthers === true"
        :why="noSentBecause(item)"
        :attached="item.attachments?.map((handed) => handed.path)"
      />
    </div>
  </article>
</template>

<style scoped src="./message-presentation.css"></style>

<style scoped>
.attributed {
  color: var(--faint);
  font-size: var(--type-caption);
}

.msg-body {
  padding-top: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: var(--space-8);
  background: var(--accent-fill);
  border: var(--border-width) solid var(--accent-border-weak);
  border-inline-start: var(--border-edge-width) solid var(--accent);
  border-radius: var(--radius-card);
}
</style>
