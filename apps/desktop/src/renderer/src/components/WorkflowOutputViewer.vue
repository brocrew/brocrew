<script setup lang="ts">
import { computed } from 'vue'
import type { WorkflowOutputResult } from '../../../shared/runtime-ipc'
import { textViewFor } from '../../../shared/documents'
import { absenceUnreadSays } from '../lib/rows-unread'
import DocumentBody from './DocumentBody.vue'
import DocumentViewerFrame from './DocumentViewerFrame.vue'

/**
 * What a dynamic workflow wrote, read in full (108, ruled in 107 §4).
 *
 * ⚠️ **It borrows the paper AND the toggle**, which is the ruling rather than a styling choice. A
 * workflow returns prose to be read, so it is genuinely a document and takes {@link DocumentBody}
 * whole — Markdown to read, Raw to check what was actually written. This is the distinction 092
 * drew for the diff, which borrows the paper and gets Unified/Split instead because file content is
 * not a document.
 */
const props = defineProps<{ result: WorkflowOutputResult; workflow: string }>()

const emit = defineEmits<{ close: [] }>()

/**
 * Raw by default for a non-prose artefact — 107: *"a `.jsonl` journal → Raw view, same standard, no
 * special case."* It is the same viewer either way; only which pane opens first differs, because
 * rendering a JSONL journal as markdown produces one long unreadable paragraph.
 *
 * ⚑ **731 · asked of prose rather than of four non-prose names** ({@link textViewFor}): since the
 * extension list went, any text file can arrive here, and only prose opens on Markdown.
 */
const view = computed(() =>
  props.result.ok ? textViewFor(props.result.name) : { raw: false, sourceOnly: false },
)

/**
 * Why there is nothing to show.
 *
 * ⚠️ **Four causes, four sentences.** `gone` is the ordinary one and it says what actually happened
 * rather than "not found": workflow outputs are written under the OS temp directory, so an old
 * conversation's output has usually been reaped, and that is not a fault of the app or the run.
 */
const NO_OUTPUT = 'This run did not report an output file'

const REFUSAL: Record<string, string> = {
  'no-output': `${NO_OUTPUT}.`,
  gone: 'Output file is gone.',
  // ⚑ 731 · the only file refused as such now is one this viewer cannot draw as text (a binary,
  // UTF-16, a folder, a fifo, a socket). Until `731` a short list of extensions was the rule, and
  // this read as a policy: *"That path is not something this app will open."*
  'not-readable': 'That file cannot be shown as text here.',
  unreadable: 'The output file is there, and could not be read.',
}

/**
 * 🔴 **712 · `697` H-a — *no output* is true of the rows this app could READ.** ⛔ Since `697` a torn
 * `workflow_run` row is skipped rather than raised, so *"did not report an output file"* beside
 * `rowsUnread` above 0 may be a report in a row nobody could parse; ⚑ the sentence then says so, and
 * by how many rows. ⚠️ Only beside `no-output`: the other three name a file the read DID find.
 */
const refusal = computed(() => {
  if (props.result.ok) return null
  const unread =
    props.result.reason === 'no-output' ? absenceUnreadSays(props.result.rowsUnread) : null
  const text =
    unread !== null
      ? `${NO_OUTPUT} ${unread}.`
      : (REFUSAL[props.result.reason] ?? 'The output file could not be opened.')
  return { text, cy: 'workflow-output-refusal' }
})

/** A document cut at the ceiling says so, or it would read as a run that produced less. */
const notes = computed(() =>
  props.result.ok && props.result.truncated
    ? [
        {
          text: `Showing the first part of a ${Math.round(props.result.bytes / 1024)} KB file.`,
          cy: 'workflow-output-truncated',
        },
      ]
    : [],
)
</script>

<template>
  <DocumentViewerFrame
    data-cy="workflow-output-viewer"
    :notes="notes"
    :refusal="refusal"
    @close="emit('close')"
  >
    <template #head>
      <strong class="name">{{ workflow }}</strong>
      <span v-if="result.ok" class="file" data-cy="workflow-output-name">{{ result.name }}</span>
    </template>

    <div v-if="result.ok" class="stage">
      <DocumentBody
        :source="result.text"
        :filename="result.name"
        :raw="view.raw"
        :source-only="view.sourceOnly"
      />
    </div>
  </DocumentViewerFrame>
</template>
