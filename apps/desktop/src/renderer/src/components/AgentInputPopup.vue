<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Provider } from '../../../shared/runtime-ipc'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { WhatThisAgentWasGiven } from '../../../shared/what-this-agent-was-given'
import type { ProviderSnapshot } from '../../../shared/provider-snapshots'
import {
  argumentsOf,
  AUTHOR,
  launchWords,
  messagesOf,
  wrappersOf,
  NOT_YET,
  PLACEMENT_WORDS,
  shareWords,
  sizeWords,
} from '../lib/agent-inputs'
import { requestTabs, SKILL_CUT, skillsNotShown, TRUST, type ReaderRow } from '../lib/request-order'
import { MODE_DIFFERS, modeDiffersFromCopy, settingRows } from '../lib/launch-settings'
import { fullTime } from '../lib/clock'
import { groupTokens } from '../lib/context-meter'
import { readableError } from '../lib/session-record'
import type { TranscriptState } from '../lib/transcript'
import WhatTheModelGot from './WhatTheModelGot.vue'

/**
 * "What this agent receives": Overview, then one tab per position in the provider's request, in
 * the order the agent got it. Each tab is one reader whose parts fold in place, each with who
 * wrote it and where its text came from (`lib/request-order.ts`). ⛔ A part the app does not record
 * yet is shown, saying so — never filled in.
 *
 * ⚑ One read, `whatThisAgentWasGiven`, made when it opens and on "Read again", never on a timer;
 * the messages come from this window's transcript.
 */
const props = defineProps<{
  sessionId: string
  provider: Provider
  who: string
  profile: string | null
  /** This window's transcript of the conversation, for the messages. */
  state: TranscriptState | null
  /** Whether that transcript holds the conversation's start, so its first message is the first. */
  startLoaded: boolean
}>()

const emit = defineEmits<{ close: [] }>()

/** `0` is Overview; the rest are the request's positions, in order. */
const tab = ref(0)

function onTabKey(event: KeyboardEvent): void {
  const last = labels.value.length - 1
  const next =
    event.key === 'ArrowRight'
      ? (tab.value + 1) % (last + 1)
      : event.key === 'ArrowLeft'
        ? (tab.value + last) % (last + 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (next === null) return
  event.preventDefault()
  const strip = event.currentTarget as HTMLElement
  tab.value = next
  // ⚑ After the tabs re-render, so the strip scrolls to the tab that is now selected and focused.
  void nextTick(() => {
    const chosen = strip.querySelector<HTMLElement>(`[data-cy="input-tab-${String(next)}"]`)
    chosen?.focus()
    chosen?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

/* the read */
const given = ref<WhatThisAgentWasGiven | null>(null)
const givenWhy = ref<string | null>('Reading…')
/** ⚑ The press made last wins, not the read that answers last. */
let asked = 0
async function read(): Promise<void> {
  const runtime = (window as Partial<Window>).api?.runtime
  if (runtime?.whatThisAgentWasGiven === undefined) {
    givenWhy.value = 'This window cannot read what the agent was given.'
    return
  }
  const mine = (asked += 1)
  givenWhy.value = given.value === null ? 'Reading…' : null
  try {
    const answer = await runtime.whatThisAgentWasGiven(props.sessionId)
    if (mine !== asked) return
    given.value = answer
    givenWhy.value = null
  } catch (error) {
    if (mine !== asked) return
    given.value = null
    givenWhy.value = `Couldn’t read what it was given: ${readableError(error)} Try Read again.`
  }
}
onMounted(() => void read())

const when = (at: number): string => fullTime(at)

const messages = computed(() => messagesOf(props.state))
/** BroBot’s words around the messages, in tokens as the totals count them. */
const wrapperTokens = computed(() => Math.round(wrappersOf(messages.value) / 4))

const tabs = computed(() =>
  given.value === null ? [] : requestTabs(given.value, messages.value, props.startLoaded, when),
)
/** Overview, then the request's positions once the read says how its request is laid out. */
const labels = computed(() => ['Overview', ...tabs.value.map((one) => one.label)])
const shown = computed(() => (tab.value === 0 ? null : (tabs.value[tab.value - 1] ?? null)))

/* each row folds in place; "Open all" opens every row of the tab */
const opened = ref<ReadonlyMap<string, boolean>>(new Map())
watch(tab, () => {
  opened.value = new Map()
})
const isOpen = (row: ReaderRow): boolean => opened.value.get(row.key) ?? row.open
function setOpen(row: ReaderRow, open: boolean): void {
  if (isOpen(row) === open) return
  opened.value = new Map(opened.value).set(row.key, open)
}
const rowsShown = computed(() =>
  (shown.value?.items ?? []).filter((one): one is ReaderRow => one.kind === 'row'),
)
const allOpen = computed(
  () => rowsShown.value.length > 0 && rowsShown.value.every((row) => isOpen(row)),
)
const stream = ref<HTMLElement | null>(null)
/** Opens or folds every row, and on opening every fold inside them too, so the tab reads through. */
async function openAll(): Promise<void> {
  const open = !allOpen.value
  opened.value = new Map(rowsShown.value.map((row) => [row.key, open]))
  if (!open) return
  await nextTick()
  for (const inner of stream.value?.querySelectorAll<HTMLDetailsElement>('details.nested') ?? [])
    inner.open = true
}

/* the provider's stored copy */
const snapshot = computed<ProviderSnapshot | null>(
  () => given.value?.providerParts.snapshot ?? null,
)
const copyNotice = computed(() =>
  snapshot.value
    ? `Provider text is a stored copy from ${PROVIDER_NAME[props.provider]} ${snapshot.value.version}, captured on a stand-in account that asks first. It is not a record of this launch.${given.value && modeDiffersFromCopy(given.value) ? ` ${MODE_DIFFERS}` : ''}`
    : null,
)
/** The launch's settings in words, as the host recorded them. */
const settings = computed(() => settingRows(given.value?.launchSettings))
const SHAPE_WORDS: Readonly<Record<ProviderSnapshot['shape'], string>> = {
  messages: 'Sent as messages, with the tools beside them.',
  functions: 'Its tools go as functions, and its prompt as the request’s instructions.',
  exec: 'Every tool is declared as code inside one exec tool, and its prompt goes as a developer message.',
}

const versionLine = computed(() => {
  const version = given.value?.providerParts.version ?? null
  const name = PROVIDER_NAME[props.provider]
  return version === null ? `${name}, version not read` : `${name} ${version}`
})
</script>

<template>
  <!-- ⚑ The host is the dialog (`OverlayHost`'s `role="dialog"`); this is a labelled region in it. -->
  <section class="input-popup" aria-labelledby="input-popup-title" data-cy="input-popup">
    <header class="popup-head">
      <div class="popup-title">
        <h2 id="input-popup-title" class="bb-title">Instructions, memory and tools</h2>
        <p class="popup-who">
          <span data-cy="input-popup-who">{{ props.who }}</span>
          <span v-if="props.profile" class="bb-chip bb-chip--accent">{{ props.profile }}</span>
          <span class="popup-version" data-cy="input-popup-version">{{ versionLine }}</span>
        </p>
        <p class="popup-intro">
          Read left to right through the tabs, then top to bottom. Each part stays where it is sent.
        </p>
      </div>
      <div class="popup-acts">
        <button
          type="button"
          class="bb-button bb-button--quiet"
          data-cy="input-popup-refresh"
          @click="read"
        >
          Read again
        </button>
        <button
          class="bb-button bb-button--icon"
          type="button"
          aria-label="Close"
          data-cy="close-overlay"
          @click="emit('close')"
        >
          <svg class="icon"><use href="#i-x" /></svg>
        </button>
      </div>
    </header>

    <div
      class="bb-tabs popup-tabs"
      role="tablist"
      aria-label="What it receives, in the order it gets it"
      @keydown="onTabKey"
    >
      <button
        v-for="(label, index) in labels"
        :key="label"
        class="bb-tab"
        type="button"
        role="tab"
        :aria-selected="tab === index"
        :tabindex="tab === index ? 0 : -1"
        :data-cy="`input-tab-${String(index)}`"
        @click="tab = index"
      >
        <span v-if="index > 0" class="tab-number">{{ index }}</span>
        {{ label }}
      </button>
    </div>

    <div class="popup-body" role="tabpanel" data-cy="input-popup-body">
      <p v-if="given === null" class="not-yet" data-cy="input-popup-why">{{ givenWhy }}</p>

      <!-- Overview -->
      <template v-else-if="tab === 0">
        <p class="launch" data-cy="input-launch">
          {{ launchWords(given.launch, when) }} {{ PLACEMENT_WORDS[given.placement] }}
        </p>
        <div class="intro">
          <div>
            <h3 class="bb-heading">The context behind a reply</h3>
            <p class="bb-muted">
              Sizes stay grouped by author here. Open a numbered tab to read the text in place.
            </p>
          </div>
        </div>
        <div class="totals" data-cy="input-totals">
          <div class="bb-card total">
            <strong>≈{{ groupTokens(given.size.brobot.tokens) }}</strong
            ><span>BroCrew’s words</span>
          </div>
          <div class="bb-card total" data-cy="input-total-wrappers">
            <strong>≈{{ groupTokens(wrapperTokens) }}</strong
            ><span>This app’s words in messages</span>
          </div>
          <div class="bb-card total">
            <strong>≈{{ groupTokens(given.size.otherFiles.tokens) }}</strong
            ><span>Other files</span>
          </div>
          <!-- ⚑ W4.184 · the tools as the total counts them; their whole definitions beside. -->
          <div class="bb-card total" data-cy="input-total-tools">
            <strong>≈{{ groupTokens(given.size.toolsInEveryRequest.tokens) }}</strong
            ><span>BroCrew’s tools</span>
            <span
              v-if="given.size.toolsInEveryRequest.tokens !== given.size.tools.tokens"
              class="bb-caption bb-muted"
              data-cy="input-total-tools-note"
              >Their names only, ≈{{ groupTokens(given.size.tools.tokens) }} in full: the provider
              loads each definition when the agent asks for it.</span
            >
          </div>
          <div class="bb-card total" data-cy="input-total-other-tools">
            <strong>{{
              given.size.otherServersToolsInEveryRequest === null
                ? '—'
                : `≈${groupTokens(given.size.otherServersToolsInEveryRequest.tokens)}`
            }}</strong
            ><span>Other servers’ tools</span>
            <span
              v-if="given.size.otherServersToolsWhy"
              class="bb-caption bb-muted"
              data-cy="input-total-other-tools-why"
              >{{ given.size.otherServersToolsWhy }}</span
            >
          </div>
          <div class="bb-card total">
            <strong>≈{{ groupTokens(given.size.memoryInEveryRequest.tokens) }}</strong
            ><span>Memory in every request</span>
          </div>
          <div class="bb-card total">
            <strong>{{
              given.size.provider === null ? '—' : `≈${groupTokens(given.size.provider.tokens)}`
            }}</strong
            ><span>The provider’s own</span>
          </div>
        </div>
        <div class="bb-card share" data-cy="input-share">
          <p class="share-head">
            <strong>All of it: ≈{{ groupTokens(given.size.total.tokens) }} tokens</strong>
            <span class="bb-muted" data-cy="input-share-words">{{
              given.size.contextWindow === null
                ? given.size.contextWindowWhy
                : `${shareWords(given.size.contextWindow.share)} of a ${groupTokens(given.size.contextWindow.tokens)}-token window`
            }}</span>
          </p>
          <div v-if="given.size.contextWindow" class="bb-meter">
            <span
              :style="{
                width: `${Math.min(100, given.size.contextWindow.share * 100).toFixed(2)}%`,
              }"
            ></span>
          </div>
          <p class="bb-caption bb-muted">
            {{ sizeWords(given.size.total) }}. Tokens are an estimate: characters ÷ 4. How the
            provider hands BroCrew’s tools over: {{ given.tools.deferral.says }}
            {{
              given.size.provider === null ? 'The provider’s own parts are not counted yet.' : ''
            }}
          </p>
        </div>
        <details class="bb-disclosure nested" open data-cy="input-settings">
          <summary><strong>Settings that change the provider’s text</strong></summary>
          <div class="bb-disclosure-body settings">
            <div class="setting" data-cy="input-own-instructions">
              <strong>Own instructions</strong>
              <span v-if="given.ownInstructions.used" data-cy="input-own-used">
                {{ given.launch.recorded ? 'This launch used' : 'Its next start would use' }}
                version {{ given.ownInstructions.used.version }}:
                {{ given.ownInstructions.used.whoWroteItMeans }},
                {{ when(given.ownInstructions.used.writtenAt) }}.
                <template v-if="given.ownInstructions.changedSinceLaunch">
                  Changed since: version {{ given.ownInstructions.newest?.version }} was saved after
                  this launch. The next start uses it.</template
                >
              </span>
              <span v-else>{{
                given.launch.recorded
                  ? 'This launch used no own instructions.'
                  : 'Its next start would use no own instructions: none are saved.'
              }}</span>
            </div>
            <div
              v-if="given.ownNotesVersion != null"
              class="setting"
              data-cy="input-own-notes-version"
            >
              <strong>Own notes version</strong>
              <span>{{ given.ownNotesVersion }}</span>
            </div>
            <div class="setting" data-cy="input-memory-at-launch">
              <strong>Memory</strong>
              <span v-if="given.memory.atLaunch.length === 0">{{
                given.launch.recorded
                  ? 'There was no memory file at its launch.'
                  : 'Its launch kept no record, so what was there then is not known.'
              }}</span>
              <span v-else
                >The launch keeps each file by name and size, not its words: those are the agent’s.
                <span v-for="one in given.memory.atLaunch" :key="one.path" class="launch-memory"
                  ><span class="bb-mono">{{ one.path }}</span>
                  <span class="bb-muted">{{ groupTokens(one.bytes) }} bytes</span></span
                ></span
              >
            </div>
            <div
              v-for="one in settings"
              :key="one.key"
              class="setting"
              data-cy="input-setting"
              :data-key="one.key"
            >
              <strong>{{ one.label }}</strong>
              <span>
                {{ one.words }}
                <span v-for="line in one.lines" :key="line" class="bb-mono setting-line">{{
                  line
                }}</span>
              </span>
            </div>
            <div v-if="settings.length === 0" class="setting" data-cy="input-setting">
              <strong>Launch settings</strong>
              <span class="bb-muted">{{ TRUST.notRecorded }}</span>
            </div>
          </div>
        </details>
        <p v-if="copyNotice" class="note" data-cy="input-copy-notice">{{ copyNotice }}</p>
        <p v-if="given.providerParts.why" class="not-yet" data-cy="input-provider-why">
          {{ given.providerParts.why }}
        </p>
        <details v-if="snapshot" class="bb-disclosure nested" data-cy="input-provider-about">
          <summary><strong>About the stored copy</strong></summary>
          <div class="bb-disclosure-body about">
            <p class="bb-caption bb-muted" data-cy="input-provider-version">
              {{ `${snapshot.label}, captured with ${snapshot.model}.` }}
            </p>
            <p v-for="note in snapshot.notes" :key="note" data-cy="input-provider-note">
              {{ note }}
            </p>
            <p class="bb-caption bb-muted" data-cy="input-provider-shape">
              {{ SHAPE_WORDS[snapshot.shape] }} Together, before the agent asks for anything:
              {{ groupTokens(snapshot.chars) }} characters · {{ groupTokens(snapshot.words) }} words
              · ≈{{ groupTokens(snapshot.approxTokens) }}
              tokens.
            </p>
            <p class="bb-caption bb-muted">
              ⟨Like this⟩ marks what changes from one conversation to the next, and where BroCrew’s
              own parts sat.
            </p>
          </div>
        </details>
      </template>

      <!-- A position in the request: one reader, its parts in the order they were sent -->
      <template v-else-if="shown">
        <div class="intro">
          <div>
            <h3 class="bb-heading" data-cy="input-tab-heading">
              {{ shown.number }} · {{ shown.label }}
            </h3>
            <p class="bb-muted">{{ shown.intro }}</p>
          </div>
          <button
            v-if="rowsShown.length > 0"
            type="button"
            class="bb-button bb-button--quiet"
            data-cy="input-open-all"
            @click="openAll"
          >
            {{ allOpen ? 'Fold all' : 'Open all' }}
          </button>
        </div>
        <template v-if="shown.copyNotice">
          <p v-if="copyNotice" class="note">{{ copyNotice }}</p>
          <template v-else>
            <p v-if="given.providerParts.why" class="not-yet">{{ given.providerParts.why }}</p>
            <p class="not-yet" data-cy="input-provider-prompt">
              Its system prompt, context and built-in tools: {{ NOT_YET.toLowerCase() }}
            </p>
          </template>
        </template>
        <p v-if="shown.items.length === 0" class="not-yet" data-cy="input-tab-empty">
          No message has reached it in this window yet.
        </p>
        <div v-else ref="stream" class="stream" data-cy="input-stream">
          <template v-for="item in shown.items" :key="item.key">
            <div v-if="item.kind === 'join'" class="join" data-cy="input-join">{{ item.text }}</div>
            <div v-else-if="item.kind === 'boundary'" class="boundary" data-cy="input-boundary">
              {{ item.text }}
            </div>
            <details
              v-else-if="item.kind === 'row'"
              class="part"
              :open="isOpen(item)"
              data-cy="input-part"
              :data-key="item.key"
              @toggle="setOpen(item, ($event.target as HTMLDetailsElement).open)"
            >
              <summary>
                <span class="chev" aria-hidden="true">›</span>
                <span class="index">{{ item.index }}</span>
                <span class="title" data-cy="input-part-title">{{ item.title }}</span>
                <span class="labels">
                  <span v-if="item.author" class="who" data-cy="input-part-author">{{
                    item.author
                  }}</span>
                  <span class="trust" data-cy="input-part-trust">{{ item.trust }}</span>
                </span>
              </summary>
              <div v-if="isOpen(item)" class="part-body">
                <template v-for="(piece, at) in item.pieces" :key="at">
                  <pre v-if="piece.kind === 'text'" class="reader">{{ piece.text }}</pre>
                  <div v-else-if="piece.kind === 'join'" class="join inner">{{ piece.text }}</div>
                  <div v-else-if="piece.kind === 'boundary'" class="boundary inner">
                    {{ piece.text }}
                  </div>
                  <p v-else-if="piece.kind === 'label'" class="piece-label">
                    <span class="who">{{ piece.author }}</span>
                    <span class="trust">{{ piece.trust }}</span>
                  </p>
                  <p v-else-if="piece.kind === 'missing'" class="missing">{{ piece.text }}</p>
                  <pre
                    v-else-if="piece.kind === 'namespace'"
                    class="reader"
                    data-cy="input-tools-namespace"
                    >{{ piece.text }}</pre>
                  <p
                    v-else-if="piece.kind === 'varies'"
                    class="varies"
                    data-cy="input-provider-varies"
                  >
                    Differs from one agent to another: {{ piece.text }}
                  </p>
                  <p v-else-if="piece.kind === 'notice'" class="bb-notice" :data-cy="piece.cy">
                    {{ piece.text }}
                  </p>
                  <template v-else-if="piece.kind === 'tools'">
                    <details
                      v-for="one in piece.tools"
                      :key="one.name"
                      class="bb-disclosure nested"
                      data-cy="input-provider-tool"
                    >
                      <summary>
                        <strong class="bb-mono">{{ one.name }}</strong>
                      </summary>
                      <div class="bb-disclosure-body">
                        <pre class="reader">{{ one.text }}</pre>
                      </div>
                    </details>
                  </template>
                  <details
                    v-else-if="piece.kind === 'whole'"
                    class="bb-disclosure nested"
                    data-cy="input-part-whole"
                  >
                    <summary>
                      <strong>{{ piece.title }}</strong>
                    </summary>
                    <div class="bb-disclosure-body">
                      <pre class="reader">{{ piece.text }}</pre>
                    </div>
                  </details>
                  <div v-else-if="piece.kind === 'section'" class="section" data-cy="input-section">
                    <p class="section-head">
                      <strong>{{ piece.heading }}</strong>
                      <span class="bb-chip" data-cy="input-section-how">{{ piece.how }}</span>
                      <span
                        v-if="piece.author"
                        class="bb-caption bb-muted"
                        data-cy="input-section-author"
                        >{{ piece.author }}</span
                      >
                    </p>
                    <pre class="reader">{{ piece.text }}</pre>
                  </div>
                  <template v-else-if="piece.kind === 'brobot-tools'">
                    <p class="bb-caption bb-muted" data-cy="input-tools-deferral">
                      {{ given.tools.deferral.says }}
                    </p>
                    <p
                      v-if="given.tools.changedSinceLaunch"
                      class="bb-notice"
                      data-cy="input-tools-changed"
                    >
                      These tools have changed since its launch: this is the list as this build has
                      it.
                    </p>
                    <details
                      v-for="one in given.tools.list"
                      :key="one.name"
                      class="bb-disclosure nested"
                      data-cy="input-tool"
                    >
                      <summary>
                        <strong class="bb-mono">{{ one.name }}</strong>
                        <span class="bb-caption bb-muted"
                          >≈{{ groupTokens(one.size.tokens) }} tokens</span
                        >
                      </summary>
                      <div class="bb-disclosure-body">
                        <pre class="reader">{{ one.description }}</pre>
                        <table v-if="argumentsOf(one.parameters)?.length" class="params">
                          <thead>
                            <tr>
                              <th>Argument</th>
                              <th>Type</th>
                              <th>Needed</th>
                              <th>What it is</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="param in argumentsOf(one.parameters)" :key="param.name">
                              <td class="bb-mono">{{ param.name }}</td>
                              <td class="bb-mono">{{ param.valueType }}</td>
                              <td>{{ param.required ? 'yes' : 'no' }}</td>
                              <td>{{ param.description }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </template>
                  <div v-else-if="piece.kind === 'skills'" class="skills" data-cy="input-skills">
                    <p class="skills-head">
                      <strong>{{ piece.heading ?? 'Skills it has' }}</strong>
                      <span class="labels">
                        <span class="who">{{ piece.author ?? AUTHOR.provider }}</span>
                        <span class="trust">{{ piece.listedBy }}</span>
                      </span>
                    </p>
                    <p class="bb-caption bb-muted">In every request.</p>
                    <p v-if="piece.none" class="not-yet" data-cy="input-skills-none">
                      {{ piece.none }}
                    </p>
                    <div
                      v-for="skill in piece.skills"
                      :key="skill.path ?? skill.name"
                      class="skill"
                      data-cy="input-skill"
                    >
                      <p class="skill-head">
                        <strong class="bb-mono">{{ skill.name }}</strong>
                        <span v-if="skill.scope" class="bb-chip">{{ skill.scope }}</span>
                      </p>
                      <p v-if="skill.description" class="skill-description">
                        {{ skill.description }}
                      </p>
                      <p v-if="skill.descriptionMayBeCut" class="bb-caption bb-muted">
                        {{ SKILL_CUT }}
                      </p>
                      <p v-if="skill.path" class="bb-caption skill-path">
                        <span class="bb-mono">{{ skill.path }}</span>
                        <span class="bb-muted">Only when opened.</span>
                      </p>
                    </div>
                    <p v-if="piece.dropped > 0" class="not-yet" data-cy="input-skills-dropped">
                      {{ skillsNotShown(piece.dropped) }}
                    </p>
                  </div>
                  <template v-else-if="piece.kind === 'servers'">
                    <div
                      v-for="server in given.externalServers"
                      :key="server.name"
                      class="bb-card server"
                      data-cy="input-tools-server"
                    >
                      <p class="bb-label">{{ server.name }}</p>
                      <p class="bb-caption bb-muted">{{ server.deferral.says }}</p>
                      <p v-if="server.tools" class="bb-caption bb-mono">
                        {{ server.tools.join(' · ') }}
                      </p>
                      <p v-else class="not-yet">The provider reported no tool names for it.</p>
                      <p class="not-yet">Their descriptions: {{ NOT_YET.toLowerCase() }}</p>
                    </div>
                  </template>
                  <WhatTheModelGot
                    v-else-if="piece.kind === 'message'"
                    :words="piece.message.words"
                    :sent="piece.message.sent"
                    :attached="piece.message.attached"
                    :together="piece.message.together"
                    :why="piece.message.why"
                    :ordinal="piece.message.ordinal"
                    :go-ahead="piece.message.goAhead"
                  />
                </template>
              </div>
            </details>
          </template>
        </div>
        <p v-for="line in shown.foot" :key="line" class="note" data-cy="input-tab-foot">
          {{ line }}
        </p>
      </template>
    </div>

    <footer class="popup-foot bb-caption bb-muted">
      <span>Author labels and section titles are for you. They are not sent.</span>
      <span>Esc to close</span>
    </footer>
  </section>
</template>

<style scoped>
.input-popup {
  display: flex;
  /* ⚑ Clear of the stop lane, which sits in the left corner only (`OverlayHost`'s
     `.overlay-corner`): the left margin keeps it clear and the reader takes the rest of the width,
     centred in what is left. */
  width: min(var(--dialog-w), calc(100% - var(--lane-clear) - var(--space-5)));
  margin-right: var(--space-5);
  margin-left: var(--lane-clear);
  /* ⚑ Never taller than the window: the body scrolls, the head, tabs and foot stay. */
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
  container: agent-input / inline-size;
}

.popup-head,
.popup-tabs,
.popup-foot {
  flex: none;
}

.popup-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--control-gap);
}

.popup-who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-small);
  gap: var(--space-3);
}

.popup-intro {
  margin-top: var(--space-3);
  color: var(--muted);
  font-size: var(--type-small);
}

.popup-acts {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.popup-version {
  color: var(--muted);
}

.popup-tabs {
  margin: var(--space-5) var(--dialog-padding) 0;
  /* One strip of tabs at every width: a narrow popup scrolls it sideways rather than stacking it. */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}

.popup-tabs .bb-tab,
.popup-acts .bb-button,
.intro .bb-button {
  white-space: nowrap;
}

.tab-number {
  margin-right: var(--space-2);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.popup-body {
  display: grid;
  min-height: 0;
  flex: 1;
  padding: var(--dialog-padding);
  overflow: auto;
  gap: var(--space-4);
  align-content: start;
  font-size: var(--type-body);
  /* ⚑ F100 · each row as tall as its content, however many there are: the body scrolls instead. */
  grid-auto-rows: max-content;
}

.input-popup :where(h2, h3, p, pre) {
  margin: 0;
}

.launch {
  color: var(--text-soft);
  font-size: var(--type-small);
}

.intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--control-gap);
}

.intro .bb-muted {
  margin-top: var(--space-2);
  max-width: 64ch;
}

.note {
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  color: var(--text-soft);
  font-size: var(--type-small);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--metric-min), 1fr));
  gap: var(--control-gap);
}

.total {
  display: grid;
  gap: var(--space-1);
}

.total strong {
  font-size: var(--type-heading);
}

.share {
  display: grid;
  gap: var(--space-3);
}

.share-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-3);
}

.settings,
.about {
  display: grid;
  gap: var(--space-3);
  font-size: var(--type-small);
}

.setting {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 3fr);
  gap: var(--space-5);
  overflow-wrap: anywhere;
}

.setting-line {
  display: block;
  margin-top: var(--space-1);
  overflow-wrap: anywhere;
}

.launch-memory {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: var(--space-2);
  gap: var(--space-3);
}

/* One reader: the parts sit on one surface, a hairline apart, in the order they were sent. */
.stream {
  /* Where a row's text starts: past its fold mark and its number. */
  --reader-inset: calc(var(--space-6) + 1ch + 3ch + 2 * var(--space-4));

  overflow: clip;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.part + .part,
.join + .part,
.boundary + .part,
.part + .join,
.part + .boundary {
  border-top: var(--border-width) solid var(--line);
}

.part > summary {
  display: flex;
  align-items: center;
  padding: var(--space-5) var(--space-6);
  gap: var(--space-4);
  cursor: pointer;
  list-style: none;
}

.part > summary::-webkit-details-marker {
  display: none;
}

.chev {
  width: 1ch;
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-out);
}

.part[open] > summary .chev {
  transform: rotate(90deg);
}

.index {
  min-width: 3ch;
  color: var(--muted);
  font-size: var(--type-caption);
  font-variant-numeric: tabular-nums;
}

.title {
  min-width: 0;
  flex: 1;
  font-weight: var(--fw-bold);
  overflow-wrap: anywhere;
}

.labels {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  column-gap: var(--space-4);
}

.who {
  flex: none;
  color: var(--accent-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.trust {
  min-width: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  text-align: right;
}

.part-body {
  display: grid;
  padding: 0 var(--space-6) var(--space-6) var(--reader-inset);
  gap: var(--space-4);
}

/* Where this app's text joins the provider's: a marked line, never a new reader. Between rows it
   starts where a row's text does. */
.join {
  padding: var(--space-4) var(--space-6) var(--space-4) var(--reader-inset);
  border-left: var(--border-edge-width) solid var(--accent);
  background: var(--accent-fill-strong);
  color: var(--accent-text);
  font-size: var(--type-small);
}

.boundary {
  padding: var(--space-4) var(--space-6) var(--space-4) var(--reader-inset);
  background: var(--wash-1);
  color: var(--muted);
  font-size: var(--type-caption);
}

.join.inner,
.boundary.inner {
  padding-left: var(--space-6);
  border-radius: var(--radius-sm);
}

.varies {
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.skills,
.skill {
  display: grid;
  gap: var(--space-2);
}

.skills {
  gap: var(--space-4);
}

.skills-head,
.skill-head,
.skill-path {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.skill-description,
.skill-path {
  overflow-wrap: anywhere;
}

.skill-description {
  color: var(--text-soft);
  font-size: var(--type-small);
}

.piece-label {
  display: flex;
  gap: var(--space-3);
}

.missing {
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--faint);
  font-size: var(--type-small);
}

.nested > summary {
  padding: var(--space-4) var(--space-5);
}

.section {
  display: grid;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.server {
  display: grid;
  gap: var(--space-3);
}

.reader {
  /* No height of its own: the tab is one continuous reader, and the popup's body scrolls. */
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--text-soft);
  font: var(--type-small) / var(--leading-reading) var(--font-mono);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.not-yet {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-small);
}

.params {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--type-small);
}

.params th,
.params td {
  padding: var(--space-2) var(--space-3);
  overflow-wrap: anywhere;
  border-bottom: var(--border-width) solid var(--line);
  text-align: left;
  vertical-align: top;
}

/* ⚑ After the base rules it narrows: same specificity, so the later rule wins. */
@container agent-input (max-width: 640px) {
  .setting {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-1);
  }

  .part > summary {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  .title {
    flex-basis: calc(100% - 6ch);
  }

  /* Who wrote it and where it came from drop under the title, starting where the title does. */
  .labels {
    flex-basis: 100%;
    justify-content: flex-start;
    padding-left: calc(var(--reader-inset) - var(--space-6));
  }

  .trust {
    text-align: left;
  }

  .skills-head .labels {
    padding-left: 0;
  }

  /* The tab's intro and its Open all stack, so neither is squeezed. */
  .intro {
    flex-direction: column;
  }

  .popup-tabs .bb-tab {
    padding-inline: var(--space-4);
  }
}

.popup-foot {
  display: flex;
  justify-content: space-between;
  padding: var(--space-4) var(--dialog-padding);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-4);
}
</style>
