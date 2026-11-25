<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InstructionScope, ProviderInstruction } from '../../../shared/instruction-contracts'
import type {
  InstructionSourceResult,
  RevealResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import { fileManagerHere } from '../lib/this-computer'
import DiskFilePreview from './DiskFilePreview.vue'

const props = defineProps<{
  files: readonly ProviderInstruction[]
  onReadInstruction?: (index: number) => Promise<InstructionSourceResult>
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
}>()

const fileManager = fileManagerHere()
const SCOPE_WORDS: Record<InstructionScope, string> = {
  profile: 'this profile',
  project: 'this project',
  unknown: 'elsewhere',
}

const noProfileLayer = computed(
  () => props.files.length > 0 && !props.files.some((item) => item.scope === 'profile'),
)

const reading = ref<{ index: number; result: InstructionSourceResult } | null>(null)

let pressed = 0

const READ_REFUSALS: Record<string, string> = {
  'no-source': 'this conversation does not report that file',
  gone: 'there is nothing there any more',
  'not-readable': 'it cannot be shown as text here',
  unreadable: 'it is there, and it could not be read',
}

async function readProvider(index: number): Promise<void> {
  const ask = props.onReadInstruction
  if (!ask) return
  if (reading.value?.index === index) {
    reading.value = null
    return
  }
  reading.value = null
  // Ignore a read that finishes after a new row is selected.
  const token = (pressed += 1)
  const result = await ask(index)
  if (token === pressed) reading.value = { index, result }
}

const revealRefusal = ref<{ index: number; reason: string } | null>(null)

const REVEAL_WORDS: Record<string, string> = {
  'no-path': 'this conversation does not report that file',
  gone: 'there is nothing there any more',
}

async function revealProvider(index: number): Promise<void> {
  const ask = props.onRevealPath
  if (!ask) return
  revealRefusal.value = null
  const said = await ask({ of: 'instruction-source', index })
  if (!said.ok) revealRefusal.value = { index, reason: said.reason }
}

watch(
  () => props.files,
  () => {
    pressed++
    reading.value = null
    revealRefusal.value = null
  },
)
</script>

<template>
  <div>
    <div class="muted lead" data-cy="provider-instructions-lead">Reported by the provider.</div>
    <div
      v-for="(item, index) in props.files"
      :key="item.path"
      class="item flat"
      data-cy="provider-instruction"
    >
      <div class="line">
        <span class="path">{{ item.path }}</span>
        <span class="scope" data-cy="provider-scope" :data-scope="item.scope">
          {{ SCOPE_WORDS[item.scope] }}
        </span>
      </div>
      <div v-if="props.onReadInstruction || props.onRevealPath" class="acts">
        <button
          v-if="props.onReadInstruction"
          class="act"
          type="button"
          :aria-expanded="reading?.index === index"
          data-cy="provider-open"
          @click="readProvider(index)"
        >
          <svg class="icon"><use href="#i-eye" /></svg>
          Open
        </button>
        <button
          v-if="props.onRevealPath"
          class="act"
          type="button"
          data-cy="provider-reveal"
          @click="revealProvider(index)"
        >
          <svg class="icon"><use href="#i-folder" /></svg>
          {{ fileManager }}
        </button>
      </div>
      <div v-if="reading?.index === index" class="read" data-cy="provider-read">
        <template v-if="reading.result.ok">
          <div class="muted">Read from disk now.</div>
          <DiskFilePreview :file="reading.result" />
        </template>
        <div v-else class="refused">
          {{ READ_REFUSALS[reading.result.reason] ?? reading.result.reason }}
        </div>
      </div>
      <div v-if="revealRefusal?.index === index" class="refused" data-cy="provider-refusal">
        {{ REVEAL_WORDS[revealRefusal.reason] ?? revealRefusal.reason }}
      </div>
    </div>
    <div v-if="noProfileLayer" class="muted absent" data-cy="provider-instructions-absent">
      Nothing above is this profile's own — every file the provider named belongs to the project or
      to somewhere else.
    </div>
  </div>
</template>

<style scoped>
.item {
  margin-bottom: var(--space-3);
}

.item:last-of-type {
  margin-bottom: 0;
}

.path {
  cursor: text;
  font-family: var(--font-mono);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
  user-select: all;
}

.muted {
  color: var(--muted);
}

.lead {
  margin-top: var(--space-4);
}

.flat {
  padding-left: calc(9px + var(--space-3));
}

.refused {
  color: var(--waiting);
  font-style: italic;
}

.line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
}

.scope {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-2xs);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.acts {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-3);
  gap: var(--space-3);
}

.act {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-3);
}

.act:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.act .icon {
  width: 11px;
  height: 11px;
}

.read {
  margin-top: var(--space-3);
}

.read .muted {
  margin-bottom: var(--space-3);
  font-size: var(--type-small);
}

.absent {
  font-style: italic;
}
</style>
