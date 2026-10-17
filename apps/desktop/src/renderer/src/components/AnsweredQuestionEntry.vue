<script setup lang="ts">
import { computed } from 'vue'
import type {
  AgentIdentity,
  AnsweredQuestion,
  QueuedMessageDisclosure,
} from '../../../shared/runtime-ipc'
import type { AnswerItem } from '../lib/answered-question'
import type { FilesOnScreen } from '../lib/files-kept'
import type { WorkEdge } from '../../../shared/who-called-whom'
import { relayedSender } from '../lib/relayed-turn'
import { messageLimitDisplay } from '../lib/provider-limit-status'
import { BODY_WAS_CUT } from '../lib/outgoing-card'
import OutsideCard from './OutsideCard.vue'
import AppNoticeEntry from './AppNoticeEntry.vue'
import RelayedEntry from './RelayedEntry.vue'
import QueuedMessage from './QueuedMessage.vue'

const props = defineProps<{
  item: AnswerItem
  answer: AnsweredQuestion
  questionItem?: string
  holdDisclosure?: QueuedMessageDisclosure | null
  limitNow?: number
  ownAgent?: string | null
  identities?: readonly AgentIdentity[] | null
  held?: ReadonlySet<string> | null
  recorded?: boolean
  withItsNextMessage?: boolean
  kept?: FilesOnScreen | null
  canOpenDocument?: boolean
  takenIn?: readonly WorkEdge[] | null
}>()
const emit = defineEmits<{
  focusItem: [id: string]
  openConversation: [id: string]
  openDocument: [id: string]
}>()
const sender = computed(() =>
  props.answer.answeredBy === null
    ? 'A person'
    : relayedSender(
        props.item.kind === 'appNotice' ? undefined : props.item.relayedFromProfile,
        props.identities ?? null,
      ),
)
const providerHold = computed(() =>
  props.item.kind === 'queued' && props.item.outcome === null
    ? messageLimitDisplay(props.holdDisclosure, props.limitNow ?? Date.now())
    : null,
)
const stateDetail = computed(() =>
  providerHold.value
    ? [props.answer.clipped ? BODY_WAS_CUT : null, providerHold.value.detail]
        .filter(Boolean)
        .join(' · ')
    : undefined,
)
const holdState = computed(() =>
  providerHold.value
    ? props.item.kind === 'queued' && props.item.label
      ? `on its list · words held · ${providerHold.value.heldShort}`
      : providerHold.value.short
    : null,
)
</script>

<template>
  <OutsideCard
    data-cy="answered-question"
    :shifted="false"
    :held="item.kind === 'queued'"
    :exchange="{
      from: sender,
      to: ownAgent ?? 'this conversation',
      kind: answer.cannotAnswer ? 'cannot answer' : 'answer',
      text: answer.answer,
      at: item.at,
      question: questionItem,
      state:
        [answer.clipped ? (providerHold ? 'Text cut' : BODY_WAS_CUT) : null, holdState]
          .filter(Boolean)
          .join(' · ') || null,
      stateDetail,
    }"
    @focus-item="(id) => emit('focusItem', id)"
  >
    <p v-if="answer.clipped && providerHold" class="bb-caption" data-cy="answer-body-cut">
      {{ BODY_WAS_CUT }}
    </p>
    <AppNoticeEntry v-if="item.kind === 'appNotice'" :item="item" />
    <RelayedEntry
      v-else-if="item.kind === 'relayed'"
      :item="item"
      within-answer
      :identities="identities"
      :own-agent="props.ownAgent ?? null"
      :held="held"
      :kept="kept"
      :can-open-document="canOpenDocument"
      :taken-in="takenIn"
      @open-conversation="(id) => emit('openConversation', id)"
      @open-document="(id) => emit('openDocument', id)"
    />
    <QueuedMessage
      v-else
      :item="item"
      within-answer
      :hold-disclosure="holdDisclosure"
      :limit-now="limitNow"
      :identities="identities"
      :own-agent="props.ownAgent ?? null"
      :held="held"
      :recorded="recorded"
      :with-its-next-message="withItsNextMessage"
      @open-conversation="(id) => emit('openConversation', id)"
    />
  </OutsideCard>
</template>
