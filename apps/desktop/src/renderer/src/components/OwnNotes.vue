<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ownNotesTextFits,
  type OwnNotesReading,
  type OwnNotesVersion,
} from '../../../shared/own-notes'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import { fullTime } from '../lib/clock'

const props = defineProps<{ profileSlug: string; active: boolean; bridge?: RuntimeBridge }>()
const api = computed(() => props.bridge ?? window.api?.runtime)
const reading = ref<OwnNotesReading | null>(null)
const incoming = ref<OwnNotesReading | null>(null)
const loading = ref(false)
const unreadable = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
const draft = ref('')
const why = ref('')
const baseline = ref({ expectedVersion: 0, currentText: '' })
const showIncoming = ref(false)
const editor = ref<HTMLTextAreaElement | null>(null)
const latestPreview = ref<HTMLElement | null>(null)
const current = computed(() => reading.value?.versions[0] ?? null)
const latest = computed(() => incoming.value?.versions[0] ?? null)
const dirty = computed(() => draft.value !== baseline.value.currentText || why.value !== '')
const changedElsewhere = computed(
  () => incoming.value !== null && (latest.value?.version ?? 0) !== baseline.value.expectedVersion,
)
const characters = computed(() => [...draft.value].length.toLocaleString('en-US'))
const canSave = computed(
  () =>
    reading.value !== null &&
    !unreadable.value &&
    !busy.value &&
    !changedElsewhere.value &&
    draft.value !== baseline.value.currentText &&
    ownNotesTextFits(draft.value) &&
    why.value.trim() !== '' &&
    ownNotesTextFits(why.value),
)
let epoch = 0
let sequence = 0
let stopChanges: (() => void) | undefined
let seenObserver: IntersectionObserver | null = null
let seenThrough = 0
let seeing = new Set<number>()

function adopt(answer: OwnNotesReading) {
  seenObserver?.disconnect()
  seenObserver = null
  reading.value = answer
  baseline.value = {
    expectedVersion: answer.versions[0]?.version ?? 0,
    currentText: answer.versions[0]?.text ?? '',
  }
  draft.value = baseline.value.currentText
  why.value = ''
  incoming.value = null
  showIncoming.value = false
}
async function acknowledge(
  version: number,
  generation: number,
  part: 'editor' | 'incoming' = 'editor',
) {
  await nextTick()
  const isShown = () =>
    (part === 'incoming' ? latest.value?.version : current.value?.version) === version
  const target = part === 'incoming' ? latestPreview.value : editor.value
  if (
    generation !== epoch ||
    !props.active ||
    version === 0 ||
    !target ||
    !isShown() ||
    version <= seenThrough ||
    [...seeing].some((pending) => pending >= version)
  )
    return
  seenObserver?.disconnect()
  const profileId = props.profileSlug
  const observer = new IntersectionObserver((entries) => {
    if (
      generation !== epoch ||
      !props.active ||
      !isShown() ||
      document.visibilityState !== 'visible' ||
      !entries.some((entry) => entry.isIntersecting)
    )
      return
    observer.disconnect()
    if (seenObserver === observer) seenObserver = null
    if (version <= seenThrough || [...seeing].some((pending) => pending >= version)) return
    const apiAtRead = api.value,
      pending = seeing
    if (!apiAtRead) return
    pending.add(version)
    void apiAtRead
      .markOwnNotesSeen({ profileId, throughVersion: version })
      .then((marked) => {
        if (generation === epoch && marked) seenThrough = Math.max(seenThrough, version)
      })
      .catch(() => {
        /* Keep the unread notice; a later visible reading can retry. */
      })
      .finally(() => {
        pending.delete(version)
      })
  })
  seenObserver = observer
  observer.observe(target)
}
async function read(preserveDraft = dirty.value, reveal = false) {
  if (!props.active) return
  const generation = epoch,
    request = ++sequence,
    profileId = props.profileSlug
  loading.value = reading.value === null
  try {
    const answer = await api.value?.agentOwnNotes({ profileId })
    if (generation !== epoch || request !== sequence) return
    if (answer == null || answer.profile !== profileId) throw new Error('Notes reading unavailable')
    unreadable.value = false
    if ((preserveDraft || dirty.value) && reading.value !== null) {
      seenObserver?.disconnect()
      seenObserver = null
      incoming.value = answer
      showIncoming.value = reveal
      if (reveal) await acknowledge(answer.versions[0]?.version ?? 0, generation, 'incoming')
      else await acknowledge(current.value?.version ?? 0, generation)
    } else {
      adopt(answer)
      await acknowledge(answer.versions[0]?.version ?? 0, generation)
    }
  } catch {
    if (generation === epoch && request === sequence) unreadable.value = true
  } finally {
    if (generation === epoch && request === sequence) loading.value = false
  }
}
function replaceDraft() {
  if (incoming.value === null) return
  adopt(incoming.value)
  error.value = null
  void acknowledge(current.value?.version ?? 0, epoch)
}
async function save() {
  if (!canSave.value) return
  const generation = epoch,
    profileId = props.profileSlug
  sequence++
  busy.value = true
  error.value = null
  try {
    const result = await api.value?.saveOwnNotes({
      profileId,
      text: draft.value,
      why: why.value,
      ...baseline.value,
    })
    if (generation !== epoch) return
    if (result == null || result.profile !== profileId) throw new Error('Notes not saved')
    adopt(result)
    await acknowledge(current.value?.version ?? 0, generation)
  } catch {
    if (generation === epoch) {
      error.value =
        'This app could not save these notes. Your draft is still here. Read the latest version, then try again.'
      await read(true)
    }
  } finally {
    if (generation === epoch) busy.value = false
  }
}
async function undo() {
  if (
    busy.value ||
    unreadable.value ||
    dirty.value ||
    current.value === null ||
    changedElsewhere.value
  )
    return
  const generation = epoch,
    profileId = props.profileSlug,
    expectedVersion = current.value.version
  sequence++
  busy.value = true
  error.value = null
  try {
    const result = await api.value?.undoOwnNotes({ profileId, expectedVersion })
    if (generation !== epoch) return
    if (result == null || result.profile !== profileId) throw new Error('Notes not restored')
    adopt(result)
    await acknowledge(current.value?.version ?? 0, generation)
  } catch {
    if (generation === epoch) {
      error.value = 'This app could not undo this change. Read the latest version, then try again.'
      await read(true)
    }
  } finally {
    if (generation === epoch) busy.value = false
  }
}
function author(version: OwnNotesVersion) {
  return version.by.who === 'a-person'
    ? 'You'
    : version.author?.name || version.author?.profile || props.profileSlug
}
function visibleAgain() {
  if (props.active && document.visibilityState === 'visible') {
    if (showIncoming.value && changedElsewhere.value)
      void acknowledge(latest.value?.version ?? 0, epoch, 'incoming')
    else void acknowledge(current.value?.version ?? 0, epoch)
  }
}
watch(
  () => props.profileSlug,
  () => {
    epoch++
    sequence++
    seenObserver?.disconnect()
    seenObserver = null
    seenThrough = 0
    seeing = new Set()
    reading.value = null
    incoming.value = null
    draft.value = ''
    why.value = ''
    baseline.value = { expectedVersion: 0, currentText: '' }
    unreadable.value = false
    error.value = null
    busy.value = false
    loading.value = false
    showIncoming.value = false
    if (props.active) void read(false)
  },
)
watch(
  () => props.active,
  (active) => {
    if (active) void read()
    else {
      seenObserver?.disconnect()
      seenObserver = null
    }
  },
  { immediate: true },
)
onMounted(() => {
  stopChanges = api.value?.onChanged?.((change) => {
    if (change.what === 'agents' && props.active && !busy.value) void read()
  })
  document.addEventListener('visibilitychange', visibleAgain)
})
onBeforeUnmount(() => {
  epoch++
  sequence++
  seenObserver?.disconnect()
  stopChanges?.()
  document.removeEventListener('visibilitychange', visibleAgain)
})
</script>

<template>
  <div class="own-notes" data-cy="own-notes">
    <h3>Own notes</h3>
    <p class="muted">
      Notes this agent keeps for itself. It reads them at every start, after its standing rules.
    </p>
    <p v-if="loading" role="status">Reading…</p>
    <p v-if="unreadable" class="error" role="alert" data-cy="own-notes-unreadable">
      This app could not read these notes. Close and open this again.
    </p>
    <template v-if="reading !== null">
      <div v-if="changedElsewhere" class="notice">
        <p>The saved notes changed while you were editing. Your draft is still here.</p>
        <button type="button" :disabled="busy" @click="read(true, true)">
          Read latest version
        </button>
        <template v-if="showIncoming">
          <strong>Latest saved notes · version {{ latest?.version ?? 0 }}</strong>
          <pre ref="latestPreview">{{ latest?.text ?? '' }}</pre>
          <button type="button" :disabled="busy" @click="replaceDraft">
            Replace my draft with the latest notes
          </button>
        </template>
      </div>
      <p v-if="reading.versions.length === 0" class="muted" data-cy="own-notes-empty">
        Nothing here yet.
      </p>
      <label class="field"
        >Own notes<textarea
          ref="editor"
          v-model="draft"
          :disabled="busy"
          rows="7"
          data-cy="own-notes-text"
        />
      </label>
      <p class="counter">{{ characters }} of 4,000 characters</p>
      <label class="field"
        >Why<textarea v-model="why" :disabled="busy" rows="2" data-cy="own-notes-why" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" :disabled="!canSave" data-cy="own-notes-save" @click="save">
          Save as version {{ baseline.expectedVersion + 1 }}
        </button>
        <button
          v-if="current !== null"
          type="button"
          :disabled="busy || unreadable || dirty || changedElsewhere"
          data-cy="own-notes-undo"
          @click="undo"
        >
          Undo latest change
        </button>
        <button
          v-if="error && !changedElsewhere"
          type="button"
          :disabled="busy"
          @click="read(true, true)"
        >
          Read latest version
        </button>
      </div>
      <div class="history">
        <article
          v-for="version in reading.versions"
          :key="version.version"
          :data-cy="`own-notes-version-${version.version}`"
        >
          <strong>Version {{ version.version }} · {{ author(version) }}</strong>
          <time>{{ fullTime(version.writtenAt) }}</time>
          <p>{{ version.reason }}</p>
          <pre>{{ version.text }}</pre>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.own-notes {
  display: grid;
  gap: var(--space-4);
}
.muted,
.counter,
time {
  color: var(--muted);
  font-size: var(--type-small);
}
p {
  margin: 0;
  line-height: var(--leading-relaxed);
}
.field {
  display: grid;
  gap: var(--space-2);
}
textarea {
  width: 100%;
  resize: vertical;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
button {
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.notice,
article {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
.history {
  display: grid;
  gap: var(--space-4);
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
.error {
  color: var(--danger);
}
</style>
