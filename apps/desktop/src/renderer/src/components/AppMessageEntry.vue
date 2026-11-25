<script setup lang="ts">
import { computed } from 'vue'
import SystemTranscriptEntryFrame from './SystemTranscriptEntryFrame.vue'
import ModelGotSwitch from './ModelGotSwitch.vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { APP_NOTICE_MARK, THE_APP_IS_THE_AUTHOR } from '../../../shared/app-notice'
import { GO_AHEAD_AUTHORSHIP, GO_AHEAD_SENDER } from '../lib/plan-mode'
import type { AppNoticeItem, ContinuationItem, TranscriptItem } from '../lib/transcript'

const props = defineProps<{
  item: (AppNoticeItem | ContinuationItem) & Pick<TranscriptItem, 'at' | 'ordinal'>
}>()

const goAhead = computed(() => props.item.kind === 'continuation')
const rowHook = computed(() => (goAhead.value ? 'continuation' : 'app-notice'))
</script>

<template>
  <SystemTranscriptEntryFrame :data-cy="rowHook">
    <template #meta>
      <strong :data-cy="`${rowHook}-sender`">
        {{ goAhead ? GO_AHEAD_SENDER : THE_APP_IS_THE_AUTHOR }}
      </strong>
      <span
        :class="[goAhead ? 'on-your-behalf' : 'about', 'system-entry-mark']"
        :data-cy="`${rowHook}-mark`"
      >
        {{ goAhead ? 'sent for you' : APP_NOTICE_MARK }}
      </span>
      <span class="time">{{ clockTime(item.at) }}</span>
    </template>
    <div
      class="msg-body"
      :data-cy="`${rowHook}-message`"
      :data-at="clockTime(item.at)"
      :title="fullTime(item.at)"
    >
      {{ item.text }}
    </div>
    <ModelGotSwitch
      :words="item.text"
      :sent="goAhead ? (item.sent ?? item.text) : item.sent"
      :together="item.sentWithOthers === true"
      :go-ahead="goAhead"
      :ordinal="item.ordinal"
    />
    <p v-if="goAhead" class="why" data-cy="continuation-why">{{ GO_AHEAD_AUTHORSHIP }}</p>
  </SystemTranscriptEntryFrame>
</template>

<style scoped>
.why {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}
</style>
