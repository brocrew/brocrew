<script setup lang="ts">
import { computed } from 'vue'
import type { ProviderInstruction } from '../../../shared/instruction-contracts'
import type { ProviderSnapshot } from '../../../shared/provider-snapshots'
import type {
  InstructionSourceResult,
  RevealResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import type { GivenProviderParts } from '../../../shared/what-this-agent-was-given'
import { groupTokens } from '../lib/context-meter'
import ReportedInstructionFiles from './ReportedInstructionFiles.vue'

const props = defineProps<{
  reportedFiles?: readonly ProviderInstruction[]
  providerParts?: GivenProviderParts
  copyNotice: string | null
  onReadInstruction?: (index: number) => Promise<InstructionSourceResult>
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
}>()

const snapshot = computed(() => props.providerParts?.snapshot ?? null)

const SHAPE_WORDS: Readonly<Record<ProviderSnapshot['shape'], string>> = {
  messages: 'Sent as messages, with the tools beside them.',
  functions: 'Its tools go as functions, and its prompt as the request’s instructions.',
  exec: 'Tools sent as code.',
}
</script>

<template>
  <section class="input-disclosures">
    <details v-if="reportedFiles" data-cy="input-reported-files">
      <summary>Files reported by the provider</summary>
      <ReportedInstructionFiles
        v-if="reportedFiles.length"
        :files="reportedFiles"
        :on-read-instruction="onReadInstruction"
        :on-reveal-path="onRevealPath"
      />
      <p v-else class="bb-muted">No files reported.</p>
    </details>
    <details v-if="providerParts" data-cy="input-provider-about">
      <summary>
        {{
          snapshot
            ? 'Stored provider text · captured on a separate run'
            : 'Stored provider text unavailable'
        }}
      </summary>
      <div class="about">
        <p v-if="copyNotice" class="input-copy-notice" data-cy="input-copy-notice">
          {{ copyNotice }}
        </p>
        <p v-if="providerParts.why" class="input-provider-why" data-cy="input-provider-why">
          {{ providerParts.why }}
        </p>
        <template v-if="snapshot">
          <p class="bb-caption bb-muted" data-cy="input-provider-version">
            {{ `${snapshot.label}, captured with ${snapshot.model}.` }}
          </p>
          <p v-for="note in snapshot.notes" :key="note" data-cy="input-provider-note">
            {{ note }}
          </p>
          <p class="bb-caption bb-muted" data-cy="input-provider-shape">
            {{ SHAPE_WORDS[snapshot.shape] }} ≈{{ groupTokens(snapshot.approxTokens) }} tokens
            total.
          </p>
          <p class="bb-caption bb-muted">⟨ ⟩ marks what changes</p>
        </template>
      </div>
    </details>
  </section>
</template>

<style scoped>
.input-disclosures {
  font-size: var(--type-caption);
  line-height: 1.3;
}

.input-disclosures p {
  margin: 0;
}

.about {
  display: grid;
  gap: var(--space-3);
  font-size: var(--type-small);
}
</style>
