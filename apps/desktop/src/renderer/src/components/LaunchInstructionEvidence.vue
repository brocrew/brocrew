<script setup lang="ts">
import { computed } from 'vue'
import type { SessionInstructions } from '../../../shared/instruction-contracts'
import { pathTail } from '../../../shared/path-tail'
import { WHOSE_WORDS, type WhoseText } from '../../../shared/whose-text'
import { refusalWords } from '../lib/refusal-words'
import { type ToldBlock, whoseGroups } from '../lib/whose-groups'
import DocumentBody from './DocumentBody.vue'

const props = defineProps<{
  instructions: SessionInstructions
  relaunched?: boolean
}>()

const FILE_OWNER: Partial<Record<WhoseText, string>> = {
  factory: 'Written by BroCrew',
  configured: 'Standing rules',
  dynamic: 'Composed for this launch',
  'the-place': 'Working folder',
  learned: 'Agent memory',
}

function ownerOf(file: ToldBlock): string {
  switch (file.kind) {
    case 'repository-conventions':
      return 'Shared repository conventions, read by BroCrew'
    case 'workspace-instructions':
      return 'Workspace instructions, written by BroCrew'
    case 'profile-memory':
      return 'Profile memory written by the agent'
    case 'agent-memory':
      return 'Written by the agent, loaded by the provider'
    case 'agent-memory-note':
      return 'A note the agent was asked to write'
    case 'agent-memory-topic':
      return 'A memory filed by the agent'
    default:
      return FILE_OWNER[file.whose] ?? WHOSE_WORDS[file.whose].heading
  }
}

function isProviderMemory(file: ToldBlock): boolean {
  return file.kind.startsWith('agent-memory')
}

const evidence = computed(() => whoseGroups(props.instructions, []))
const blocks = computed(() => evidence.value.groups.flatMap((group) => group.blocks))
const hasMemory = computed(() => blocks.value.some(isProviderMemory))
</script>

<template>
  <details class="bb-disclosure" data-cy="input-launch-evidence">
    <summary><strong>Launch record</strong></summary>
    <div class="bb-disclosure-body">
      <p v-if="instructions.note" class="bb-muted" data-cy="instructions-note">
        {{ instructions.note }}
      </p>
      <p v-if="relaunched" class="bb-muted" data-cy="told-earlier">
        Earlier launch text unavailable.
      </p>
      <details class="bb-disclosure nested" data-cy="told-composition">
        <summary>BroCrew’s text as sent</summary>
        <div class="bb-disclosure-body">
          <p class="bb-muted" data-cy="told-composition-launch">From the most recent launch.</p>
          <DocumentBody
            v-if="typeof instructions.composed === 'string'"
            :source="instructions.composed"
            filename="as sent"
            compact
          />
          <p v-else-if="instructions.composed === null" data-cy="told-appended-nothing">
            BroCrew sent no composed text.
          </p>
          <p v-else data-cy="told-composition-unavailable">No composed text recorded.</p>
        </div>
      </details>
      <details v-if="evidence.unsplit" class="bb-disclosure nested" data-cy="told-unsplit">
        <summary>Instructions without a source breakdown</summary>
        <div class="bb-disclosure-body">
          <p v-if="evidence.unsplit.block.path" class="bb-mono">
            {{ evidence.unsplit.block.path }}
          </p>
          <p v-if="evidence.unsplit.block.truncated">Only part of the file was kept.</p>
          <DocumentBody :source="evidence.unsplit.block.text" filename="Instructions" compact />
        </div>
      </details>
      <details
        v-for="file in blocks"
        :key="file.key"
        class="bb-disclosure nested"
        :data-cy="isProviderMemory(file) ? 'input-launch-memory-file' : 'input-launch-source'"
        :data-whose="file.whose"
        :data-kind="file.kind"
        :data-reach="file.reach"
      >
        <summary>
          {{ file.name }}
          <template v-if="file.reach">
            · {{ file.reach === 'prompt' ? 'In the prompt' : 'Available on request' }}
          </template>
        </summary>
        <div class="bb-disclosure-body">
          <p class="bb-muted" data-cy="told-block-label">{{ ownerOf(file) }}</p>
          <p v-if="file.path" class="bb-mono" data-cy="told-block-path">{{ file.path }}</p>
          <p v-if="file.link" class="bb-mono" data-cy="told-block-link">
            Read from {{ file.link }}
          </p>
          <p v-if="file.truncated" data-cy="told-block-truncated-says">
            Only part of the file was kept.
          </p>
          <DocumentBody
            :source="file.text"
            :filename="file.path ? pathTail(file.path) : file.name"
            compact
          />
        </div>
      </details>
      <p v-if="hasMemory" class="bb-muted" data-cy="memory-store-not-a-reading">
        Stored files don’t show which ones the agent opened.
        <span v-if="instructions.recallsReported" data-cy="memory-store-recall-is-shown">
          Recalls appear in the conversation.
        </span>
        <span v-if="instructions.writesReported" data-cy="memory-store-write-is-shown">
          Writes appear in the conversation.
        </span>
      </p>
      <p v-else class="bb-muted" data-cy="told-remembers-nothing">
        No provider memory files recorded.
      </p>
      <details v-if="instructions.refused.length" class="bb-disclosure nested">
        <summary data-cy="left-out-files">Files left out</summary>
        <ul>
          <li v-for="file in instructions.refused" :key="file.path" data-cy="refused-instruction">
            <span class="bb-mono" data-cy="told-block-path">{{ file.path }}</span> ·
            {{ refusalWords(file.reason) }}
            <span v-if="file.link" class="bb-mono"> → {{ file.link }}</span>
          </li>
        </ul>
      </details>
    </div>
  </details>
</template>
