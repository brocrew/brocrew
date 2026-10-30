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
        <!-- Mark imported user turns with `provider_transcript` attribution. The provider file is the only source and the app cannot verify who wrote its contents; live turns are recorded when the app sends them. Different labels let the reader distinguish those origins.

             In the META row, never the body, for the reason the next comment gives. -->
        <span
          v-if="item.attribution === 'provider_transcript'"
          class="attributed"
          data-cy="user-attributed"
          title="From the provider's own transcript file. This app did not watch it being typed."
          >(per the transcript)</span
        >
        <!-- The time sits in the META row, never inside the body: `textContent` of the message has
             to be what the person actually said, which is what a copy, a search or an assertion
             gets. Putting it in the body once turned "PINGPONG" into "PINGPONG00:55" (001). -->
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
      <!-- Show app-supplied attachments outside `user-message` and label them as BroBot's. Keep the message body's text exactly as typed so copying and searching do not conflate injected paths with the person's words. -->
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

<style scoped>
.msg {
  display: grid;
  max-width: var(--measure-message);
  margin: 0 auto var(--space-12);
  gap: var(--space-6);
  grid-template-columns: var(--avatar-small) minmax(0, 1fr);
}

.msg-column {
  min-width: 0;
}

.msg-avatar {
  display: grid;
  width: var(--avatar-small);
  height: var(--avatar-small);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius);
  background: var(--accent-fill);
  color: var(--accent-text);
  place-items: center;
}

.msg-avatar .icon {
  width: var(--icon);
  height: var(--icon);
}

.msg-meta {
  display: flex;
  height: auto;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3) var(--space-6);
  min-height: var(--space-10);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.msg-meta strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.attributed {
  color: var(--faint);
  font-size: var(--type-caption);
}

.time {
  margin-left: 0;
  color: var(--faint);
  font: var(--type-caption) / var(--leading-normal) var(--font-sans);
  opacity: 1;
  transition: opacity var(--dur-fast) ease;
}

.msg:hover .time {
  opacity: 1;
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
  border-radius: var(--radius-card);
}
</style>
