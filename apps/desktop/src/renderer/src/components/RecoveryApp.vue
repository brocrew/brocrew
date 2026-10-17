<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { providerName } from '../../../shared/runtime-ipc'
import type { HistoryConversation, RecoveryBridge, StartupVerdict } from '../../../shared/recovery'
import {
  copyDate,
  dateWords,
  NO_BRIDGE_WORDS,
  recoveryWords,
  type RecoveryAction,
} from '../lib/recovery-words'
import { readableError } from '../lib/session-record'
import { applyEvent, createTranscript, markReadOnly, type TranscriptState } from '../lib/transcript'
import TranscriptView from './TranscriptView.vue'
import IconSprite from './IconSprite.vue'
import MessageLinks from './MessageLinks.vue'
import type { ResolvedMessageLink } from '../lib/message-links'
import { useMessagePaths } from '../composables/useMessagePaths'

/**
 * The recovery window: what a person sees when this build meets data it can't open normally.
 * It reads the verdict from main, and each one main pushes after, and draws the refusal, the
 * read-only history, or the failure.
 *
 * Nothing here can write. The only calls are the bridge's, and the bridge is all this window's
 * preload exposes. The history is read-only the way `ReadingPane` is: the events are folded and
 * passed through `markReadOnly`, and `TranscriptView` is told every capability is off, so it draws
 * no control that would need a handler here. Pictures, documents and attachments are not read,
 * since this window has no reader for them and the copy may not hold them.
 */
const props = defineProps<{
  /** The bridge; `null` when the page was opened outside BroBot. Defaults to `window.recovery`. */
  bridge?: RecoveryBridge | null
}>()

const bridge = computed(() =>
  props.bridge === undefined ? (window.recovery ?? null) : props.bridge,
)

/** The recovery copy has no navigation bridge to the running workspace. */
async function resolveSavedLink(): Promise<ResolvedMessageLink> {
  throw new Error('No navigation bridge in recovery')
}
const openSavedLink = async (): Promise<boolean> => false

const verdict = shallowRef<StartupVerdict | null>(null)
/** What is running: drawn as a progress line, and every press waits for it. */
const busy = ref<string | null>(null)
const progress = ref<{ done: number; total: number } | null>(null)
/** A call that threw instead of answering a verdict. */
const trouble = ref<string | null>(null)

const words = computed(() => (verdict.value ? recoveryWords(verdict.value) : null))

const percent = computed(() => {
  const at = progress.value
  if (!at || at.total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((at.done / at.total) * 100)))
})

/** The heading of whichever screen is drawn; a new screen puts the cursor here to be read from the top. */
const heading = ref<HTMLElement | null>(null)
function focusHeading(): void {
  void nextTick(() => heading.value?.focus())
}

/** The dialog's body text, by id, so the dialog is described by what it says under its heading. */
const describedBy = computed(() => {
  const at = words.value
  if (!at) return undefined
  const ids = at.body.map((_, index) => `recovery-body-${index}`)
  if (at.detail) ids.push('recovery-detail')
  return ids.join(' ') || undefined
})

const stopListening: (() => void)[] = []

/** Bumped whenever the verdict changes, so a history read for an older one is dropped on arrival. */
let generation = 0

onMounted(async () => {
  const recovery = bridge.value
  if (!recovery) return
  try {
    stopListening.push(
      recovery.onProgress((done, total) => {
        progress.value = { done, total }
      }),
    )
    stopListening.push(recovery.onVerdict((next) => show(next)))
    const before = generation
    const first = await recovery.verdict()
    // A verdict main pushed while this one was on its way is newer, so it stays.
    if (generation === before) show(first)
  } catch (error) {
    trouble.value = readableError(error)
    focusHeading()
  }
})

onBeforeUnmount(() => stopListening.forEach((stop) => stop()))

function show(next: StartupVerdict): void {
  generation += 1
  verdict.value = next
  conversations.value = null
  listTrouble.value = null
  chosen.value = null
  if (next.kind === 'history-only') void loadConversations()
  focusHeading()
}

/** Runs one call that answers a verdict, with progress drawn while it runs. */
async function run(label: string, call: () => Promise<StartupVerdict>): Promise<void> {
  busy.value = label
  progress.value = null
  trouble.value = null
  try {
    show(await call())
  } catch (error) {
    trouble.value = readableError(error)
    focusHeading()
  } finally {
    busy.value = null
    progress.value = null
  }
}

async function act(action: RecoveryAction): Promise<void> {
  const recovery = bridge.value
  if (!recovery || busy.value !== null) return
  switch (action.kind) {
    case 'close':
      await recovery.quit()
      return
    case 'restore': {
      const offered = verdict.value?.kind === 'newer' ? verdict.value.offers : null
      const date = offered ? copyDate(offered.createdAt) : null
      await run(date ? `Restoring the copy from ${date}…` : 'Restoring the copy…', () =>
        recovery.restore(action.checkpointId),
      )
      return
    }
    case 'return':
      await run('Returning to the newer data…', () => recovery.returnToNewer())
      return
    case 'retry':
      await run('Trying again…', () => recovery.retry())
      return
  }
}

/* The history: the copy's conversations, and the one being read. */

const conversations = shallowRef<readonly HistoryConversation[] | null>(null)
const listTrouble = ref<string | null>(null)
const chosen = shallowRef<{
  conversation: HistoryConversation
  transcript: TranscriptState | null
  trouble: string | null
} | null>(null)

async function loadConversations(): Promise<void> {
  const recovery = bridge.value
  if (!recovery) return
  const asked = generation
  try {
    const rows = await recovery.history.conversations()
    if (asked === generation) conversations.value = rows
  } catch (error) {
    if (asked === generation) listTrouble.value = readableError(error)
  }
}

/** The words that settle a card left waiting in the copy. */
const READ_ONLY_NOTE = 'This is history from a copy. Agents are stopped, so nothing can answer.'

async function choose(conversation: HistoryConversation): Promise<void> {
  const recovery = bridge.value
  // No new read while the data is being moved, and none outside the history view.
  if (!recovery || busy.value !== null || verdict.value?.kind !== 'history-only') return
  const asked = generation
  chosen.value = { conversation, transcript: null, trouble: null }
  try {
    const events = await recovery.history.transcript(conversation.id)
    const state = createTranscript()
    for (const { event, at } of events) applyEvent(state, event, at)
    markReadOnly(state, READ_ONLY_NOTE)
    // A later choice, or a later verdict, wins: an answer for either is dropped.
    if (asked === generation && chosen.value?.conversation.id === conversation.id) {
      chosen.value = { conversation, transcript: state, trouble: null }
    }
  } catch (error) {
    if (asked === generation && chosen.value?.conversation.id === conversation.id) {
      chosen.value = { conversation, transcript: null, trouble: readableError(error) }
    }
  }
}

function titleOf(conversation: HistoryConversation): string {
  return conversation.title?.trim() || 'Untitled conversation'
}

/**
 * The agent's name as the copy recorded it, or the provider's name for a conversation this app ran
 * as nobody: the same answer the live pane and a recording give.
 */
function whoOf(conversation: HistoryConversation): string {
  return conversation.agent ?? providerName(conversation.provider)
}

/** The conversation being read: its agent's name or `null`, and the heading over its replies. */
const ownAgent = computed(() => chosen.value?.conversation.agent ?? null)
const who = computed(() => (chosen.value ? whoOf(chosen.value.conversation) : ''))

/**
 * Paths in the history are shown in Finder or Explorer and never opened: this window is read-only.
 * Main answers them only while the copy is read as history, so nothing is asked otherwise.
 */
const messagePaths = useMessagePaths(
  () => chosen.value?.conversation.id ?? null,
  () => {
    const recovery = bridge.value
    if (!recovery || verdict.value?.kind !== 'history-only') return null
    return {
      resolve: (ask) => recovery.resolveMessagePaths(ask),
      reveal: (target) => recovery.revealMessagePath(target),
      open: null,
    }
  },
)
</script>

<template>
  <MessageLinks :resolve="resolveSavedLink" :open="openSavedLink">
    <main
      class="recovery"
      data-chat-theme="light"
      data-cy="recovery"
      :data-verdict="verdict?.kind ?? null"
    >
      <!-- The window's own icons: it is a separate entry, so nothing else mounts them. -->
      <IconSprite />
      <section v-if="!bridge" class="dialog" data-cy="recovery-no-bridge">
        <p class="lone">{{ NO_BRIDGE_WORDS }}</p>
      </section>

      <section
        v-else-if="verdict?.kind === 'history-only' && words"
        class="history"
        data-cy="recovery-history"
      >
        <header class="banner" role="status" data-cy="recovery-banner">
          <div class="banner-words">
            <h1 ref="heading" tabindex="-1" class="bb-heading" data-cy="recovery-heading">
              {{ words.heading }}
            </h1>
            <p v-for="(line, index) in words.body" :key="index" data-cy="recovery-body">
              {{ line }}
            </p>
          </div>
          <div class="banner-side">
            <div class="actions">
              <button
                v-for="action in words.actions"
                :key="action.kind"
                type="button"
                class="bb-button"
                :class="{ 'bb-button--primary': action.kind !== 'close' }"
                :disabled="busy !== null"
                :data-cy="`recovery-${action.kind}`"
                @click="act(action)"
              >
                {{ action.label }}
              </button>
            </div>
            <div v-if="busy" class="progress" data-cy="recovery-progress">
              <span>{{ busy }}</span>
              <div
                class="bb-meter"
                role="progressbar"
                :aria-label="busy ?? undefined"
                :aria-valuenow="percent ?? undefined"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: `${percent ?? 0}%` }"></span>
              </div>
            </div>
            <p v-if="trouble" class="trouble" data-cy="recovery-trouble">
              That didn't finish. Close BroCrew and open it again.
              <span class="detail">{{ trouble }}</span>
            </p>
          </div>
        </header>

        <div class="history-body">
          <nav class="list" aria-label="Conversations in the copy" data-cy="recovery-conversations">
            <p v-if="listTrouble" class="quiet" data-cy="recovery-list-trouble">
              BroCrew couldn't read the conversations in this copy.
              <span class="detail">{{ listTrouble }}</span>
            </p>
            <p v-else-if="conversations === null" class="quiet">Reading the copy…</p>
            <p v-else-if="conversations.length === 0" class="quiet" data-cy="recovery-list-empty">
              This copy holds no conversations.
            </p>
            <button
              v-for="conversation in conversations ?? []"
              :key="conversation.id"
              type="button"
              class="row"
              :aria-current="chosen?.conversation.id === conversation.id ? 'true' : undefined"
              :disabled="busy !== null"
              data-cy="recovery-conversation"
              @click="choose(conversation)"
            >
              <strong class="row-title" :title="titleOf(conversation)">{{
                titleOf(conversation)
              }}</strong>
              <span class="row-meta">
                {{ whoOf(conversation) }} · {{ dateWords(conversation.updatedAt) }}
              </span>
            </button>
          </nav>

          <section class="reader" data-cy="recovery-reader" data-read-only="true">
            <template v-if="chosen">
              <header class="reader-head">
                <strong data-cy="recovery-reader-title" :title="titleOf(chosen.conversation)">{{
                  titleOf(chosen.conversation)
                }}</strong>
                <span class="row-meta">{{ who }}</span>
              </header>
              <p v-if="chosen.trouble" class="quiet" data-cy="recovery-reader-trouble">
                BroCrew couldn't read this conversation from the copy.
                <span class="detail">{{ chosen.trouble }}</span>
              </p>
              <p v-else-if="chosen.transcript === null" class="quiet">Reading…</p>
              <p
                v-else-if="chosen.transcript.items.length === 0"
                class="quiet"
                data-cy="recovery-reader-empty"
              >
                This conversation has nothing to show.
              </p>
              <!-- No listeners, and every capability off: a control with nowhere to send its press
                 is not drawn. The `can-*` props left out already default to off. -->
              <TranscriptView
                v-else
                :items="chosen.transcript.items"
                mode="normal"
                :who="who"
                :provider="chosen.conversation.provider"
                :own-agent="ownAgent"
                :recorded="true"
                :can-read-images="false"
                :can-open-images="false"
                :can-open-child-work="false"
                :can-open-workflow-output="false"
                :can-restore-queued="false"
                :paths="messagePaths"
                data-cy="recovery-transcript"
              />
            </template>
            <p v-else class="quiet pick">Choose a conversation to read it.</p>
          </section>
        </div>
      </section>

      <section
        v-else-if="words"
        class="dialog"
        role="alertdialog"
        aria-labelledby="recovery-heading"
        :aria-describedby="describedBy"
        data-cy="recovery-dialog"
      >
        <div class="dialog-body">
          <h1
            id="recovery-heading"
            ref="heading"
            tabindex="-1"
            class="bb-title"
            data-cy="recovery-heading"
          >
            {{ words.heading }}
          </h1>
          <p
            v-for="(line, index) in words.body"
            :id="`recovery-body-${index}`"
            :key="index"
            data-cy="recovery-body"
          >
            {{ line }}
          </p>
          <p v-if="words.detail" id="recovery-detail" class="detail" data-cy="recovery-detail">
            {{ words.detail }}
          </p>
          <div
            v-if="busy || verdict?.kind === 'working'"
            class="progress"
            data-cy="recovery-progress"
          >
            <span v-if="busy">{{ busy }}</span>
            <div
              class="bb-meter"
              role="progressbar"
              :aria-label="busy ?? words.heading"
              :aria-valuenow="percent ?? undefined"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${percent ?? 0}%` }"></span>
            </div>
          </div>
          <p v-if="trouble" class="trouble" data-cy="recovery-trouble">
            That didn't finish. Close BroCrew and open it again.
            <span class="detail">{{ trouble }}</span>
          </p>
        </div>
        <footer class="dialog-foot">
          <button
            v-for="action in words.actions"
            :key="action.kind"
            type="button"
            class="bb-button"
            :class="{ 'bb-button--primary': action.kind !== 'close' }"
            :disabled="busy !== null"
            :data-cy="`recovery-${action.kind}`"
            @click="act(action)"
          >
            {{ action.label }}
          </button>
        </footer>
      </section>

      <section v-else-if="trouble" class="dialog" data-cy="recovery-dialog">
        <div class="dialog-body">
          <h1 ref="heading" tabindex="-1" class="bb-title" data-cy="recovery-heading">
            BroCrew couldn't check this workspace
          </h1>
          <p>Close BroCrew and open it again.</p>
          <p class="detail" data-cy="recovery-detail">{{ trouble }}</p>
        </div>
        <footer class="dialog-foot">
          <button type="button" class="bb-button" data-cy="recovery-close" @click="bridge?.quit()">
            Close
          </button>
        </footer>
      </section>

      <section v-else class="dialog" role="status" data-cy="recovery-pending">
        <p class="lone">Checking this workspace’s data…</p>
      </section>
    </main>
  </MessageLinks>
</template>

<style scoped>
.recovery {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.recovery > * {
  image-rendering: auto;
}

/* The refusal and failure screens: one card in the middle of the paper. */
.dialog {
  display: flex;
  width: min(560px, calc(100% - 2 * var(--dialog-gutter)));
  margin: auto;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}

.dialog-body {
  display: grid;
  padding: var(--dialog-padding);
  gap: var(--space-5);
}

.dialog-body h1 {
  margin: 0 0 var(--space-2);
}

.dialog-body p,
.banner p {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-reading);
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-4);
  padding: var(--space-6) var(--dialog-padding);
  border-top: var(--border-width) solid var(--line);
  background: var(--panel-2);
}

.lone {
  margin: 0;
  padding: var(--dialog-padding);
  color: var(--text-soft);
  font-size: var(--type-small);
}

/* The coordinator's own sentence: small, and selectable so it can be quoted. */
.detail {
  display: block;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  user-select: text;
}

.dialog-body .detail {
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--muted);
  font-size: var(--type-caption);
}

.progress {
  display: grid;
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.trouble {
  display: grid;
  gap: var(--space-2);
}

.dialog-body .trouble,
.banner .trouble {
  color: var(--danger-text);
}

/* The history window: a banner that stays, then the list and the conversation being read. */
.history {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.banner {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-9);
  padding: var(--space-7) var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--waiting-card-border);
  background: var(--waiting-card-bg);
}

.banner h1 {
  margin: 0 0 var(--space-3);
  color: var(--text);
}

.banner-words {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.banner-side {
  display: grid;
  flex: none;
  justify-items: end;
  gap: var(--space-4);
  max-width: 420px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-4);
}

.banner .progress {
  width: 280px;
}

.history-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 300px minmax(0, 1fr);
}

.list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  padding: var(--space-4);
  border-right: var(--border-width) solid var(--line);
  background: var(--panel-2);
  gap: var(--space-1);
}

.row {
  display: grid;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  gap: var(--space-1);
  text-align: left;
}

.row:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--panel);
}

.row[aria-current='true'] {
  border-color: var(--accent-border);
  background: var(--accent-fill);
}

.row-title {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  color: var(--muted);
  font-size: var(--type-caption);
}

.reader {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.reader-head {
  display: flex;
  flex: none;
  align-items: baseline;
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-5);
}

.reader-head strong {
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quiet {
  margin: 0;
  padding: var(--space-6);
  color: var(--muted);
  font-size: var(--type-small);
}

.pick {
  margin: auto;
}
</style>
