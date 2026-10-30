<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { UpdateState, WhatARestartWouldStopIn } from '../../../shared/updates'
import { clockTime } from '../../../shared/clock'
import { useUpdates } from '../composables/useUpdates'
import { readableError } from '../lib/session-record'

/**
 * 🔴 **B2 · the menu the rail's footer opens: this BroBot's version, and its updates.**
 *
 * ⚑ What `main/updates.ts` says, in plain words (`shared/updates.ts`):
 *  - **the version** — *BroBot 0.1.0*;
 *  - **where an update stands** — up to date, checking, one offered and its Download, its progress,
 *    then on Windows *Restart to update* (it waits until nothing is running, and lists what still
 *    is, with Cancel), and on the Mac the opened image with what to do next;
 *  - **two switches** — check automatically, and get beta updates.
 *
 * ⛔ **A build that never checks says so in one line and offers nothing**: a development build or
 * one with no release to read (`not-here`).
 *
 * ⚑ Esc closes it; focus goes back to the footer, which is `SideRail`'s to hold.
 */
const props = defineProps<{
  /** This BroBot's version where the app said it before the updates answer — `AppInfo.version`. */
  version?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const updates = useUpdates()
const snapshot = updates.snapshot
const panel = ref<HTMLElement | null>(null)
/** ⚑ What the last press could not do, said once — the answer's own words. */
const refused = ref<string | null>(null)
const busy = ref(false)

const version = computed(() => snapshot.value?.version ?? props.version ?? null)
const state = computed((): UpdateState | null => snapshot.value?.state ?? null)
const notesVersion = computed(() => {
  const current = state.value
  return current && 'version' in current ? current.version : null
})

// ⚑ A press is answered when its work is done — a whole download — but the app tells every move on
// the way: a new state frees the menu at once, so the next step's button is not held back.
watch(
  () => state.value?.kind,
  () => {
    busy.value = false
  },
)

async function press(act: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  refused.value = null
  try {
    await act()
  } catch (error) {
    refused.value = readableError(error)
  } finally {
    busy.value = false
  }
}

/** ⚑ One conversation a restart waits on, in words: *Ada: a turn is running, 2 held messages*. */
function stopsSays(one: WhatARestartWouldStopIn): string {
  const parts = [
    ...(one.turnRunning ? ['a turn is running'] : []),
    ...(one.waitingOnAPerson ? ['waiting on a person'] : []),
    ...(one.heldMessages > 0
      ? [`${one.heldMessages} held ${one.heldMessages === 1 ? 'message' : 'messages'}`]
      : []),
    ...(one.inTheBackground > 0 ? [`${one.inTheBackground} running in the background`] : []),
  ]
  return parts.length === 0 ? one.name : `${one.name}: ${parts.join(', ')}`
}

function otherBrobotsSay(count: number | null): string | null {
  if (count === null)
    return 'Whether another copy of BroCrew is open is checked once nothing here is running.'
  if (count === 0) return null
  return count === 1
    ? 'Another copy of BroCrew is open on this computer: quit it to let this one restart.'
    : `${count} other copies of BroCrew are open on this computer: quit them to let this one restart.`
}

const NOT_HERE: Readonly<Record<'a-development-build' | 'no-release-feed', string>> = {
  'a-development-build':
    'This is a development build. Updates come with the downloadable version of BroCrew.',
  'no-release-feed':
    'This version of BroCrew was built without a place to check for updates. Updates come with the downloadable version of BroCrew.',
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}

/** ⚑ A switch the app refused goes back to what the snapshot says: nothing else would move it. */
async function flip(event: Event, change: Parameters<typeof updates.set>[0]): Promise<void> {
  const box = event.target as HTMLInputElement
  await press(() => updates.set(change))
  box.checked =
    'checkAutomatically' in change
      ? (snapshot.value?.checkAutomatically ?? false)
      : snapshot.value?.channel === 'beta'
}

// ⚑ Focus moves in as it opens — to its first control, or to the menu itself where it has none (a
// development build), so Esc and the keys reach it either way. A read that never answered is asked
// again.
onMounted(async () => {
  if (snapshot.value === null) void updates.refresh()
  await nextTick()
  ;(
    panel.value?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)') ??
    panel.value
  )?.focus()
})
</script>

<template>
  <div
    ref="panel"
    class="updates-menu"
    data-on-white
    role="dialog"
    aria-label="BroCrew updates"
    tabindex="-1"
    data-cy="updates-menu"
    @keydown="onKey"
  >
    <p class="version" data-cy="updates-version">
      {{ version === null ? 'BroCrew' : `BroCrew ${version}` }}
    </p>

    <a
      v-if="notesVersion"
      :href="`https://github.com/brocrew/brocrew/releases/tag/v${encodeURIComponent(notesVersion)}`"
      target="_blank"
      rel="noopener noreferrer"
      class="release-notes"
      data-cy="updates-notes"
      >What’s new</a
    >
    <template v-if="state === null" />
    <p v-else-if="state.kind === 'not-here'" class="said" data-cy="updates-not-here">
      {{ NOT_HERE[state.why] }}
    </p>
    <template v-else>
      <div class="where" :data-state="state.kind" data-cy="updates-state">
        <template v-if="state.kind === 'idle'">
          <p class="said" data-cy="updates-said">
            {{
              state.checkedAt === null
                ? 'Not checked yet.'
                : state.upToDate
                  ? `Up to date · checked at ${clockTime(state.checkedAt)}`
                  : `Checked at ${clockTime(state.checkedAt)}`
            }}
          </p>
          <button
            type="button"
            :disabled="busy"
            data-cy="updates-check"
            @click="press(updates.checkNow)"
          >
            Check for updates
          </button>
        </template>

        <p v-else-if="state.kind === 'checking'" class="said" data-cy="updates-said">Checking…</p>

        <template v-else-if="state.kind === 'available'">
          <p class="said" data-cy="updates-said">BroCrew {{ state.version }} is available.</p>
          <button
            type="button"
            class="go"
            :disabled="busy"
            data-cy="updates-download"
            @click="press(updates.download)"
          >
            Download
          </button>
        </template>

        <template v-else-if="state.kind === 'downloading'">
          <p class="said" data-cy="updates-said">
            Downloading BroCrew {{ state.version }} · {{ Math.round(state.percent) }}%
          </p>
          <progress
            class="progress"
            max="100"
            :value="state.percent"
            :aria-label="`Downloading BroCrew ${state.version}`"
            data-cy="updates-progress"
          />
        </template>

        <template v-else-if="state.kind === 'ready' && state.how === 'restart'">
          <p class="said" data-cy="updates-said">BroCrew {{ state.version }} is ready.</p>
          <button
            type="button"
            class="go"
            :disabled="busy"
            data-cy="updates-restart"
            @click="press(updates.restartWhenQuiet)"
          >
            Restart to update
          </button>
          <p class="aside">It restarts once nothing is running.</p>
        </template>

        <template v-else-if="state.kind === 'ready'">
          <p class="said" data-cy="updates-said">
            BroCrew {{ state.version }} is downloaded and opened. Quit every open copy of BroCrew,
            then drag the new one into Applications.
          </p>
          <button
            type="button"
            :disabled="busy"
            data-cy="updates-open-again"
            @click="press(updates.download)"
          >
            Download again
          </button>
        </template>

        <template v-else-if="state.kind === 'waiting-to-restart'">
          <p class="said" data-cy="updates-said">
            BroCrew restarts to update to {{ state.version }} once nothing is running.
          </p>
          <ul v-if="state.stops.conversations.length > 0" class="stops" data-cy="updates-stops">
            <li v-for="one in state.stops.conversations" :key="one.conversation">
              {{ stopsSays(one) }}
            </li>
          </ul>
          <p
            v-if="otherBrobotsSay(state.stops.otherWorkspaces)"
            class="aside"
            data-cy="updates-others"
          >
            {{ otherBrobotsSay(state.stops.otherWorkspaces) }}
          </p>
          <button
            type="button"
            :disabled="busy"
            data-cy="updates-cancel"
            @click="press(updates.cancelRestart)"
          >
            Cancel
          </button>
        </template>

        <template v-else-if="state.kind === 'error'">
          <p class="said warn" data-cy="updates-said">{{ state.message }}</p>
          <button
            type="button"
            :disabled="busy"
            data-cy="updates-check"
            @click="press(updates.checkNow)"
          >
            Check again
          </button>
        </template>
      </div>

      <p v-if="refused" class="said warn" role="alert" data-cy="updates-refused">{{ refused }}</p>

      <div v-if="snapshot" class="switches">
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            :checked="snapshot.checkAutomatically"
            data-cy="updates-automatically"
            @change="flip($event, { checkAutomatically: !snapshot!.checkAutomatically })"
          />
          <span>Check automatically</span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            :checked="snapshot.channel === 'beta'"
            data-cy="updates-beta"
            @change="flip($event, { channel: snapshot!.channel === 'beta' ? 'stable' : 'beta' })"
          />
          <span>Get beta updates</span>
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.updates-menu {
  display: grid;
  width: var(--rail-menu-w);
  max-height: calc(100dvh - var(--space-24));
  overflow-y: auto;
  padding: var(--space-8);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-menu);
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-6);
}

.release-notes {
  color: var(--accent-text);
  font-size: var(--type-caption);
}

.version {
  margin: 0;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.where {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.said {
  margin: 0;
  color: var(--muted);
  line-height: var(--leading-relaxed);
}

.said.warn {
  color: var(--danger-text-notice);
}

.aside {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
}

.progress {
  width: 100%;
}

.stops {
  display: grid;
  margin: 0;
  padding-left: var(--space-5);
  color: var(--text-soft);
  gap: var(--space-1);
}

button {
  min-height: var(--control-h);
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
}

button:hover:not(:disabled) {
  background: var(--wash-5);
}

button.go {
  border-color: var(--accent);
  color: var(--text);
}

.updates-menu :deep(.acts) {
  display: grid;
  gap: var(--space-4);
}

.updates-menu :deep(.acts .small) {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
}

.switches {
  display: grid;
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-3);
}

.switch {
  display: flex;
  align-items: center;
  cursor: pointer;
  gap: var(--space-3);
}
</style>
