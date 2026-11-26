<script lang="ts">
import type { Provider } from '@brobot2/shared'
import { providerName, type LibraryOrigin } from '../../../shared/runtime-ipc'

/** Where a conversation came from, in one chip. */
interface OriginChip {
  kind: 'ours' | 'imported' | 'home' | 'only' | 'restored'
  label: string
}

/**
 * **The five provenance phrases, collapsed into one chip** (104) — from the same three fields
 * `provenance()` reads, in the same order, so the two can never disagree about one row.
 *
 * `only here` is the one worth emphasis and it is **not** a warning: it means the provider has
 * already deleted its copy and ours is the last one. That is the sweep's whole value, said quietly.
 */
export function originChipOf(
  entry: {
    provider: Provider
    origin: LibraryOrigin
    recordId: string | null
    onDisk: boolean
  },
  suppliedName?: string | null,
): OriginChip {
  if (entry.origin === 'ours') return { kind: 'ours', label: 'ours' }
  // ⛔ **Named for the gesture that produced it** (214 §1). A restored bundle is the one row whose
  // provider has no copy on this machine at all, so `imported` — which means *"the file is still in
  // the provider's folder and we archived it"* — would be false about it in both halves.
  if (entry.origin === 'restored') return { kind: 'restored', label: 'restored from a bundle' }
  // 169 §2 · whose folder, not which layer of ours. The row already knows, and *"in provider home"*
  // was the shortest sentence in the app that only made sense to someone who had read the source.
  if (entry.recordId === null) {
    const name =
      suppliedName === undefined ? providerName(entry.provider) : (suppliedName ?? 'the provider')
    return { kind: 'home', label: `in ${name}'s folder` }
  }
  return entry.onDisk
    ? { kind: 'imported', label: 'imported' }
    : { kind: 'only', label: 'only here' }
}
</script>

<script setup lang="ts">
import type {
  ExportedSession,
  ImportedFromHome,
  ImportedRecording,
  LibraryEntry,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import { computed } from 'vue'
import { childLabel } from '../lib/child-descent'
import { calendarDay } from '../lib/clock'
import { describeDerived } from '../lib/derived-state'
import { endingLabel } from '../lib/ending'
import {
  libraryConversationTitle as label,
  type ConversationRowView,
} from '../lib/conversation-row'
import ConversationRow from './ConversationRow.vue'

const props = defineProps<{
  entry: LibraryEntry
  providerLabel: string | null
  updatedAgo: string
  outcome?: ImportedFromHome['outcome']
  outcomeNote?: string
  rebuilding?: boolean
  importing?: boolean
  bringingBack?: boolean
  archiving?: boolean
  restoreRefused?: string
  archiveRefused?: string
  recording?: ResumableSessionInfo
  unavailable?: UnresumableSessionInfo
  exportResult?: ExportedSession | string
  exporting?: boolean
  messagesResult?: ImportedRecording | string
  importingMessages?: boolean
}>()

const emit = defineEmits<{
  read: [entry: LibraryEntry]
  rebuild: [entry: LibraryEntry]
  import: [entry: LibraryEntry]
  archive: [entry: LibraryEntry]
  restore: [entry: LibraryEntry]
  delete: [entry: LibraryEntry]
  export: [sessionId: string, kind: 'native' | 'bundle']
  importMessages: [sessionId: string]
}>()

/**
 * What a row's transcript is missing, in the reader's terms — or null when nothing is (065).
 *
 * ⚠️ **`readable` could never have said this.** It answers whether there is a conversation to open,
 * and the row that needs this sentence has one: it is real, it is incomplete, and until the store
 * carried a completeness contract the library had no way to tell the two apart. 061 finding 6, at
 * the surface where it is finally visible. The words are shared with the reading pane — see
 * {@link describeDerived}.
 */
function behind(entry: LibraryEntry): string | null {
  return describeDerived(entry.derived)
}

/**
 * Whether a rebuild would do anything. `rebuilding` is the answer already happening (104). An
 * imported conversation whose file is still in its provider's folder may have grown since it was
 * read, so it is offered too.
 */
function canRebuild(entry: LibraryEntry): boolean {
  if (entry.derived === 'stale' || entry.derived === 'failed') return true
  return entry.derived === 'current' && entry.onDisk
}

/** Whether these bytes are still only the provider's. The one row where Import is the whole point. */
function canImport(entry: LibraryEntry): boolean {
  return (
    entry.providerSessionId !== null &&
    (entry.recordId === null || (entry.origin === 'user-home' && entry.onDisk && !entry.readable))
  )
}

const continuationReason = computed(() => {
  if (props.recording?.resumeRefusal) return props.recording.resumeRefusal
  const { entry, unavailable } = props
  if (entry.recordId === null) return canImport(entry) ? null : entry.unresumableReason
  if (unavailable?.reason !== entry.unresumableReason) return entry.unresumableReason
  // A file discovered in a personal folder can still be an app recording with a separate refusal.
  if (
    entry.origin === 'user-home' &&
    unavailable?.foundInUserHome &&
    !unavailable.restoredFromBundle
  )
    return null
  if (entry.origin === 'restored' && unavailable?.restoredFromBundle && entry.readable) return null
  return entry.unresumableReason
})

const lastTurn = computed(() => endingLabel(props.entry.lastEnding)?.sentence)
const adoptedFromAgent = computed(() => {
  const { recording, unavailable } = props
  return (
    (recording?.adoptedAt ?? unavailable?.adoptedAt) != null &&
    !unavailable?.foundInUserHome &&
    !unavailable?.restoredFromBundle
  )
})

/**
 * **The row is the target** (104) — read is safe, read-only and the common case, so it does not
 * deserve a button competing with the one control that changes something.
 *
 * Two refusals, both of them things a click on a whole row gets wrong by default. A click that
 * landed on a control belongs to the control: `Rebuild` sits INSIDE the row and pressing it must
 * not also open the conversation. And a click that ends a text selection is somebody copying a
 * working directory, not asking to navigate — the `cwd` is mono and copyable on purpose, and a row
 * that opened itself every time you selected the path would make it un-copyable in practice.
 *
 * ⚠️ **The copy-guard is TRIMMED and SCOPED, and it was neither** (105 review). `getSelection()` is
 * a property of the window, not of this row, so the bare check refused a click for two reasons that
 * have nothing to do with the row under the cursor: a selection left anywhere else on the page
 * disabled the whole list, and a selection resolving to pure whitespace — a stray drag across the
 * gap between the chip and the clock — is invisible on screen while still being a non-empty string.
 * Either way the row silently did nothing and said nothing about why. `containsNode(row, true)`
 * asks the only question that matters: is the text you highlighted in THIS row.
 */
function rowClick(entry: LibraryEntry, event: MouseEvent): void {
  if (!entry.readable) return
  const row = (event.currentTarget ?? event.target) as HTMLElement | null
  if ((event.target as HTMLElement | null)?.closest('button') !== null) return
  const selection = window.getSelection()
  const selecting =
    selection !== null && selection.toString().trim() !== '' && row !== null
      ? selection.containsNode(row, true)
      : false
  if (selecting) return
  emit('read', entry)
}

/** What the row draws, in the shared row's terms: no plate, as a library entry has no live state. */
function rowView(entry: LibraryEntry): ConversationRowView {
  const origin = originChipOf(entry, props.providerLabel)
  return {
    id: entry.id,
    facets: null,
    plateLabel: label(entry),
    head: 'plain',
    title: label(entry),
    marks: [
      ...(entry.child
        ? [
            {
              key: 'child',
              text: childLabel(entry.child),
              tone: 'child',
              cy: `library-child-${entry.id}`,
            },
          ]
        : []),
      adoptedFromAgent.value
        ? {
            key: 'origin',
            text: 'adopted',
            tone: 'imported',
            hint: "Found in an agent's folder",
            cy: 'resumable-adopted',
          }
        : { key: 'origin', text: origin.label, tone: origin.kind },
      ...(entry.archivedAt !== undefined
        ? [
            {
              key: 'archived',
              text: `Archived ${calendarDay(entry.archivedAt)}`,
              tone: 'archived',
              cy: `library-archived-${entry.id}`,
            },
          ]
        : []),
    ],
    status: {
      provider: entry.provider,
      place: entry.cwd,
      tail: [
        ...(entry.bytes !== null ? [size(entry.bytes)] : []),
        ...(canImport(entry) ? [provenance()] : []),
      ],
    },
  }
}

/** An unread user-home file remains importable even after an unfinished attempt gave it a row. */
function provenance(): string {
  return `in ${props.providerLabel ?? 'the provider'}'s own folder, not imported`
}

function size(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <li
    class="row"
    :class="{ readable: entry.readable }"
    :data-origin="entry.origin"
    :data-session-id="entry.recordId"
    :data-recorded-status="recording?.status"
    :data-adopted="adoptedFromAgent ? '' : undefined"
    :data-cy="`library-row-${entry.id}`"
    tabindex="-1"
    @click="rowClick(entry, $event)"
  >
    <div class="row-body">
      <ConversationRow
        :row="rowView(entry)"
        :star-target="entry"
        :cy="{ provider: `library-provider-${entry.id}` }"
      >
        <template #aside>
          <span class="r-when">{{ updatedAgo }}</span>
        </template>
      </ConversationRow>

      <p v-if="entry.preview" class="r-preview">{{ entry.preview }}</p>

      <div
        v-if="behind(entry) || canRebuild(entry)"
        class="behind"
        :data-derived="entry.derived"
        :data-cy="`library-behind-${entry.id}`"
      >
        <span v-if="entry.derived === 'rebuilding'" class="spin" aria-hidden="true"></span>
        <span v-if="behind(entry)" class="txt">{{ behind(entry) }}</span>

        <button
          v-if="canRebuild(entry)"
          type="button"
          class="rebuild"
          :disabled="rebuilding"
          :data-cy="`library-rebuild-${entry.id}`"
          @click="emit('rebuild', entry)"
        >
          {{ rebuilding ? 'Rebuilding…' : entry.derived === 'failed' ? 'Try again' : 'Rebuild' }}
        </button>
      </div>

      <p
        v-if="outcome"
        class="outcome"
        :data-outcome="outcome"
        :data-cy="`library-outcome-${entry.id}`"
      >
        {{ outcomeNote }}
      </p>

      <p v-if="continuationReason" class="why" :data-cy="`library-why-${entry.id}`">
        Can't be carried on: {{ continuationReason }}
      </p>

      <p
        v-if="messagesResult"
        class="outcome"
        :data-outcome="typeof messagesResult === 'string' ? 'unreadable' : messagesResult.outcome"
        :data-cy="`import-result-${entry.recordId}`"
      >
        {{ typeof messagesResult === 'string' ? messagesResult : messagesResult.note }}
      </p>

      <p
        v-if="exportResult"
        class="outcome exported"
        :data-outcome="typeof exportResult === 'string' ? 'unreadable' : undefined"
        data-cy="export-result"
      >
        <template v-if="typeof exportResult === 'string'">{{ exportResult }}</template>
        <template v-else>
          {{ exportResult.path }} ·
          {{
            exportResult.resumable ? 'a provider can resume this' : 'a copy, not a restored session'
          }}
          — {{ exportResult.note }}
        </template>
      </p>

      <p
        v-if="restoreRefused"
        class="outcome"
        data-outcome="unreadable"
        role="alert"
        :data-cy="`library-restore-refused-${entry.id}`"
      >
        {{ restoreRefused }}
      </p>

      <p
        v-if="archiveRefused"
        class="outcome"
        data-outcome="unreadable"
        role="alert"
        :data-cy="`library-archive-refused-${entry.id}`"
      >
        {{ archiveRefused }}
      </p>
    </div>

    <div v-if="entry.readable || canImport(entry) || entry.recordId !== null" class="row-act">
      <template v-if="recording">
        <button
          type="button"
          class="read-cue"
          :disabled="exporting"
          :data-cy="`export-native-${recording.sessionId}`"
          @click="emit('export', recording.sessionId, 'native')"
        >
          export file
        </button>
        <button
          type="button"
          class="read-cue"
          :disabled="exporting"
          :data-cy="`export-bundle-${recording.sessionId}`"
          @click="emit('export', recording.sessionId, 'bundle')"
        >
          export bundle
        </button>
        <button
          v-if="recording.adoptedAt && !recording.hasTranscript"
          type="button"
          class="read-cue"
          :disabled="importingMessages"
          :data-cy="`import-messages-${recording.sessionId}`"
          title="Copy its messages into BroCrew"
          @click="emit('importMessages', recording.sessionId)"
        >
          {{ importingMessages ? 'importing…' : 'import messages' }}
        </button>
      </template>

      <button
        v-if="entry.recordId !== null && entry.archivedAt !== undefined"
        type="button"
        class="bring-back"
        :disabled="bringingBack"
        :data-cy="`library-restore-${entry.id}`"
        @click="emit('restore', entry)"
      >
        {{ bringingBack ? 'Restoring…' : 'Restore' }}
      </button>

      <button
        v-if="entry.recordId !== null && entry.archivedAt === undefined"
        type="button"
        class="read-cue"
        :disabled="archiving"
        :aria-label="`Archive ${label(entry)}`"
        :data-cy="`library-archive-${entry.id}`"
        @click="emit('archive', entry)"
      >
        {{ archiving ? 'Archiving…' : 'Archive' }}
      </button>

      <button
        v-if="entry.recordId !== null"
        type="button"
        class="read-cue"
        :aria-label="`Delete ${label(entry)}`"
        :data-cy="`library-delete-${entry.id}`"
        @click="emit('delete', entry)"
      >
        Delete…
      </button>

      <button
        v-if="canImport(entry)"
        type="button"
        class="import"
        :disabled="importing"
        :data-cy="`library-import-${entry.id}`"
        @click="emit('import', entry)"
      >
        {{ importing ? 'Importing…' : 'Import' }}
      </button>

      <button
        v-if="entry.readable || entry.recordId !== null"
        type="button"
        class="read-cue"
        :aria-label="`${entry.recordId ? 'Open' : 'Read'} ${label(entry)}`"
        :aria-description="lastTurn"
        :title="lastTurn"
        :data-cy="entry.readable ? `library-read-${entry.id}` : `sessions-open-${entry.recordId}`"
        @click="emit('read', entry)"
      >
        {{ entry.recordId ? 'Open' : 'Read' }}
        <span v-if="entry.readable" aria-hidden="true">›</span>
      </button>
    </div>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  gap: var(--space-5);
}

.row.readable {
  cursor: pointer;
}

.row.readable:hover {
  border-color: var(--line-strong);
  background: var(--panel-3);
}

.row.readable:hover .read-cue {
  opacity: 1;
}

.row-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

.r-when {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
}

/* One line, clamped (104): the preview is a caption, and a first message somebody pasted a document
   into must not be allowed to become the row. */
.r-preview {
  margin: var(--space-1) 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- states on a row */

/**
 * ⚠️ **`--warning` was never defined** (104, verified again here). This block and `.outcome` below
 * wrote `var(--warning, var(--text-soft))`, and `--warning` is in no stylesheet in this repo — so
 * both fell through to the fallback and every caution on this surface has shipped in ordinary body
 * colour since 065. The fix is 104's: the real `--waiting` ramp, which exists, is the app's amber
 * everywhere else, and has a light value. **This changes how the surface looks** — the "behind"
 * line and the two warning outcomes go from grey to amber. Said out loud rather than slipped in.
 */
.behind {
  display: flex;
  align-items: center;
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xs);
  background: var(--waiting-bg);
  gap: var(--space-5);
}

.behind .txt {
  min-width: 0;
  flex: 1;
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* A rebuild in flight is not a warning — it is the answer to one, already happening. */
.behind[data-derived='rebuilding'] {
  background: var(--wash-2);
}

.behind[data-derived='rebuilding'] .txt {
  color: var(--text-soft);
}

.behind .rebuild {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--waiting-text-label);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.behind .rebuild:hover {
  background: var(--waiting-bg);
}

.behind .rebuild:disabled {
  cursor: default;
  opacity: 0.6;
}

.spin {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border: 1.6px solid var(--line-strong); /* raw: glyph stroke, drawn at its own width */
  border-top-color: var(--muted);
  border-radius: var(--radius-pill);
  animation: library-spin 0.8s linear infinite;
}

@keyframes library-spin {
  to {
    transform: rotate(360deg);
  }
}

.outcome {
  margin: var(--space-3) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/**
 * A refusal reads differently from a success, without either being an error colour.
 *
 * ⚠️ **Every import ending that means "it did not happen" is here** (105 review). `rebuildEntry`
 * maps its outcomes into three tones deliberately, but `importEntry` stores
 * `ImportedFromHome.outcome` verbatim — so an ending missing here falls through to the neutral
 * colour that `up-to-date` uses, and "you already have this" and "nothing was taken" are opposite
 * answers.
 */
.outcome[data-outcome='unreadable'],
.outcome[data-outcome='missing'],
.outcome[data-outcome='nothing-readable'],
.outcome[data-outcome='still-writing'],
.outcome[data-outcome='stopped'] {
  color: var(--waiting-text-label);
}

.outcome[data-outcome='imported'] {
  color: var(--success-text);
}

.exported {
  overflow-wrap: anywhere;
}

.why {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* ---------------------------------------------------------------- the one control */

.row-act {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  align-self: center;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* The row action stays readable before hover or focus. */
.read-cue {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
  white-space: nowrap;
  gap: var(--space-2);
}

.read-cue:hover,
.read-cue:focus-visible {
  color: var(--text-soft);
  opacity: 1;
}

.import {
  height: 26px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-sm);
  background: var(--accent-fill);
  color: var(--accent-text);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.import:hover {
  background: var(--accent-fill-strong);
}

.bring-back {
  height: 26px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.bring-back:hover {
  background: var(--wash-3);
}

.bring-back:disabled {
  cursor: default;
  opacity: 0.6;
}

.import:disabled {
  cursor: default;
  opacity: 0.6;
}

.row {
  padding: var(--space-7);
  background: var(--panel);
  border-radius: var(--radius-card);
}
.behind {
  flex-wrap: wrap;
}
/* Where the row has no room beside its words, its actions go on a line of their own under them. */
@container (max-width: 480px) {
  .row {
    flex-wrap: wrap;
  }
  .row-act {
    flex: 1 0 100%;
  }
}
</style>
