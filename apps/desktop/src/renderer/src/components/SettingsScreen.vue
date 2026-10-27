<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useTranscriptRetention } from '../composables/useTranscriptRetention'
import {
  TRANSCRIPT_RETENTION_CHOICES,
  isTranscriptRetention,
} from '../../../shared/transcript-retention'
import type { Provider, ProviderCapabilityMap } from '../../../shared/runtime-ipc'
import type { ProviderLimitsView } from '../lib/persons-queue'
import type { ModelLists } from '../lib/model-lists'
import type { AgentStore } from '../lib/agent-store'
import { useAttentionSignals } from '../composables/useAttentionSignals'
import { useDebugMode } from '../composables/useDebugMode'
import { useDockLabel } from '../composables/useDockLabel'
import {
  DOCK_LABEL_COLOURS,
  DOCK_LABEL_MAX,
  type DockLabelColour,
} from '../../../shared/dock-label'
import { platformHere } from '../lib/this-computer'
import ProvidersScreen from './ProvidersScreen.vue'
import ToolsRegister from './ToolsRegister.vue'
import ThemesSection from './ThemesSection.vue'
import SkillsSection from './SkillsSection.vue'
import PluginsSection from './PluginsSection.vue'
import RecoveryCopiesSection from './RecoveryCopiesSection.vue'
import type { PluginsClient } from '../../../shared/plugin-settings'

export type SettingsTab = 'providers' | 'tools' | 'skills' | 'plugins' | 'themes' | 'general'

const props = withDefaults(
  defineProps<{
    setupProvider?: Provider | null
    tab?: SettingsTab
    capabilities: ProviderCapabilityMap | null
    warnings: ProviderLimitsView | null
    clock: number
    lists?: ModelLists
    store?: AgentStore
    toolsNow?: number
    plugins?: PluginsClient
  }>(),
  { tab: 'providers', lists: undefined, store: undefined, toolsNow: undefined },
)

const emit = defineEmits<{
  'update:tab': [tab: SettingsTab]
  authChanged: [profileId: string]
  usageMoved: []
  startConversation: []
  addServer: []
}>()

const pluginEnabled = ref(Boolean(props.plugins))
let live = true
onUnmounted(() => {
  live = false
})
onMounted(async () => {
  if (props.plugins) return
  try {
    const answer = await window.api?.plugins?.request({ kind: 'availability' })
    if (live) pluginEnabled.value = Boolean(answer?.ok && answer.available)
  } catch {
    /* keep the unavailable feature hidden */
  }
})
const activeTab = computed(() =>
  props.tab === 'plugins' && !pluginEnabled.value ? 'providers' : props.tab,
)
const allTabs: readonly { id: SettingsTab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'themes', label: 'Themes' },
  { id: 'general', label: 'General' },
]
const tabs = computed(() => allTabs.filter((tab) => tab.id !== 'plugins' || pluginEnabled.value))
const attentionSignals = useAttentionSignals()
const debugMode = useDebugMode()
const approvalSaving = ref(false)
const approvalError = ref<string | null>(null)
async function saveApprovalDefault(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!props.store || approvalSaving.value) return
  const requested = input.checked ? 'auto' : 'ask'
  input.checked = props.store.identities.value?.defaultApprovalMode === 'auto'
  approvalSaving.value = true
  approvalError.value = null
  try {
    approvalError.value = await props.store.setApprovalDefault(requested)
  } finally {
    approvalSaving.value = false
    input.checked = props.store.identities.value?.defaultApprovalMode === 'auto'
  }
}

const transcripts = useTranscriptRetention()
async function keepTranscripts(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const next = select.value === 'forever' ? 'forever' : Number(select.value)
  if (isTranscriptRetention(next)) await transcripts.save(next)
  select.value = String(transcripts.period.value ?? 90)
}
// The Dock label is the Mac's for now: no other desktop shows it.
const dockLabelHere = /mac/i.test(platformHere())
const dockLabel = useDockLabel()

function typeDockLabel(event: Event): void {
  const input = event.target as HTMLInputElement
  input.value = dockLabel.enter(input.value)
}

/** The switch shows the saved value again when a save fails and nothing changed. */
async function dockLabelSwitch(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await dockLabel.turn(input.checked)
  input.checked = dockLabel.label.value?.on ?? true
}

async function dockLabelKey(event: KeyboardEvent, colour: DockLabelColour): Promise<void> {
  const by =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0
  if (by === 0) return
  event.preventDefault()
  const next = dockLabel.step(colour, by)
  // Focus moves at once, as the keys ask, never after the save: a person may have moved on by then.
  const group = (event.currentTarget as HTMLElement).parentElement
  group?.querySelector<HTMLButtonElement>(`[data-colour="${next}"]`)?.focus()
  await dockLabel.choose(next)
}
const attentionHelp = /win/i.test(platformHere())
  ? 'When BroCrew is in the background, flash the taskbar button and show the count.'
  : /mac/i.test(platformHere())
    ? 'When BroCrew is in the background, bounce the Dock icon once and show the count.'
    : 'When BroCrew is in the background, show the count on its icon where your desktop supports it.'

async function tabKey(event: KeyboardEvent, current: SettingsTab): Promise<void> {
  const at = tabs.value.findIndex((item) => item.id === current)
  const next =
    event.key === 'ArrowRight'
      ? (at + 1) % tabs.value.length
      : event.key === 'ArrowLeft'
        ? (at + tabs.value.length - 1) % tabs.value.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.value.length - 1
            : -1
  if (next < 0) return
  event.preventDefault()
  const parent = (event.currentTarget as HTMLElement).parentElement
  emit('update:tab', tabs.value[next]!.id)
  await nextTick()
  parent?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
</script>

<template>
  <section class="settings-surface" data-cy="settings-screen" data-chat-theme="light">
    <header class="settings-heading">
      <span class="settings-icon" aria-hidden="true"
        ><svg class="icon"><use href="#i-gear" /></svg
      ></span>
      <h1>Settings</h1>
    </header>
    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      <button
        v-for="item in tabs"
        :key="item.id"
        :id="`settings-tab-${item.id}`"
        type="button"
        role="tab"
        :aria-selected="activeTab === item.id"
        :aria-controls="`settings-panel-${item.id}`"
        :tabindex="activeTab === item.id ? 0 : -1"
        :data-cy="`settings-tab-${item.id}`"
        @click="emit('update:tab', item.id)"
        @keydown="tabKey($event, item.id)"
      >
        {{ item.label }}
      </button>
    </div>
    <div
      v-if="activeTab === 'providers'"
      id="settings-panel-providers"
      class="settings-content"
      role="tabpanel"
      aria-labelledby="settings-tab-providers"
    >
      <ProvidersScreen
        embedded
        :setup-provider="props.setupProvider"
        :capabilities="props.capabilities"
        :warnings="props.warnings"
        :clock="props.clock"
        :lists="props.lists"
        @auth-changed="(profileId) => emit('authChanged', profileId)"
        @usage-moved="emit('usageMoved')"
        @start-conversation="emit('startConversation')"
      />
    </div>
    <div
      v-else-if="activeTab === 'tools'"
      id="settings-panel-tools"
      class="settings-content"
      role="tabpanel"
      aria-labelledby="settings-tab-tools"
    >
      <ToolsRegister
        embedded
        :store="props.store"
        :capabilities="props.capabilities"
        :now="props.toolsNow"
        @add-server="emit('addServer')"
      />
    </div>
    <div
      v-else-if="activeTab === 'skills'"
      id="settings-panel-skills"
      class="settings-content settings-simple"
      role="tabpanel"
      aria-labelledby="settings-tab-skills"
    >
      <SkillsSection />
    </div>
    <div
      v-else-if="activeTab === 'plugins'"
      id="settings-panel-plugins"
      class="settings-content settings-simple"
      role="tabpanel"
      aria-labelledby="settings-tab-plugins"
    >
      <PluginsSection :client="props.plugins" />
    </div>
    <div
      v-else-if="activeTab === 'themes'"
      id="settings-panel-themes"
      class="settings-content settings-simple"
      role="tabpanel"
      aria-labelledby="settings-tab-themes"
    >
      <ThemesSection />
    </div>
    <div
      v-else
      id="settings-panel-general"
      class="settings-content settings-simple general-panel"
      role="tabpanel"
      aria-labelledby="settings-tab-general"
    >
      <section v-if="props.store" class="setting-card" data-cy="settings-approval-default">
        <div class="setting-copy">
          <h2 id="settings-approval-label">New conversations</h2>
          <p>
            {{
              props.store.identities.value?.defaultApprovalMode === 'auto'
                ? 'Runs without asking. Use it only where you trust the agent with your files.'
                : 'Asks when an action needs permission.'
            }}
          </p>
          <p v-if="approvalError" role="alert">{{ approvalError }}</p>
        </div>
        <span>Ask</span
        ><input
          type="checkbox"
          role="switch"
          aria-label="Auto for new conversations"
          data-cy="settings-approval-switch"
          :checked="props.store.identities.value?.defaultApprovalMode === 'auto'"
          :disabled="approvalSaving || !props.store.identities.value"
          @change="saveApprovalDefault"
        /><span>Auto</span>
      </section>
      <RecoveryCopiesSection />
      <section class="setting-card" data-cy="transcript-retention">
        <span class="setting-icon" aria-hidden="true"
          ><svg class="icon"><use href="#i-clock" /></svg
        ></span>
        <div class="setting-copy">
          <h2 id="settings-transcript-retention-label">Keep agents' transcripts</h2>
          <p>
            A conversation unused for this long has its transcript deleted to save space. It stays
            here, but its agent can't pick it up again.
          </p>
          <p v-if="transcripts.status.value" role="status">{{ transcripts.status.value }}</p>
        </div>
        <select
          aria-labelledby="settings-transcript-retention-label"
          data-cy="transcript-retention-period"
          :value="String(transcripts.period.value ?? 90)"
          :disabled="transcripts.period.value === null || transcripts.saving.value"
          @change="keepTranscripts"
        >
          <option
            v-for="choice in TRANSCRIPT_RETENTION_CHOICES"
            :key="choice.value"
            :value="String(choice.value)"
          >
            {{ choice.label }}
          </option>
        </select>
      </section>
      <section class="setting-card" data-cy="attention-signals">
        <span class="setting-icon" aria-hidden="true"
          ><svg class="icon"><use href="#i-bang" /></svg
        ></span>
        <div class="setting-copy">
          <h2 id="settings-attention-label">Show when something needs you</h2>
          <p id="settings-attention-help">{{ attentionHelp }}</p>
        </div>
        <input
          v-model="attentionSignals"
          type="checkbox"
          role="switch"
          data-cy="attention-signals-switch"
          aria-labelledby="settings-attention-label"
          aria-describedby="settings-attention-help"
        />
      </section>
      <section v-if="dockLabelHere" class="setting-card dock-label-card" data-cy="dock-label">
        <div class="dock-label-head">
          <span class="setting-icon" aria-hidden="true"
            ><svg class="icon"><use href="#i-square" /></svg
          ></span>
          <div class="setting-copy">
            <h2 id="settings-dock-label-label">Dock label</h2>
            <p id="settings-dock-label-help">
              A short name and colour on the Dock icon, to tell workspaces apart.
            </p>
          </div>
          <input
            :checked="dockLabel.label.value?.on ?? true"
            :disabled="!dockLabel.label.value"
            type="checkbox"
            role="switch"
            data-cy="dock-label-switch"
            aria-labelledby="settings-dock-label-label"
            aria-describedby="settings-dock-label-help"
            @change="dockLabelSwitch"
          />
        </div>
        <p class="dock-label-status" role="status" data-cy="dock-label-status">
          {{ dockLabel.statusLine.value }}
        </p>
        <div v-if="dockLabel.label.value?.on" class="dock-label-choices">
          <input
            :value="dockLabel.typed.value"
            class="dock-label-name"
            type="text"
            :maxlength="DOCK_LABEL_MAX"
            :placeholder="dockLabel.label.value.defaults.name"
            spellcheck="false"
            autocomplete="off"
            data-cy="dock-label-name"
            aria-labelledby="settings-dock-label-label"
            @input="typeDockLabel"
            @change="dockLabel.saveName()"
            @keydown.enter="dockLabel.saveName()"
          />
          <div
            class="dock-label-swatches"
            role="radiogroup"
            aria-labelledby="settings-dock-label-label"
            data-cy="dock-label-colours"
          >
            <button
              v-for="colour in DOCK_LABEL_COLOURS"
              :key="colour.id"
              type="button"
              role="radio"
              class="dock-label-swatch"
              :data-colour="colour.id"
              :data-cy="`dock-label-colour-${colour.id}`"
              :aria-label="colour.name"
              :aria-checked="dockLabel.label.value.colour === colour.id"
              :tabindex="dockLabel.label.value.colour === colour.id ? 0 : -1"
              :style="{ backgroundColor: colour.hex }"
              @click="dockLabel.choose(colour.id)"
              @keydown="dockLabelKey($event, colour.id)"
            />
          </div>
        </div>
      </section>
      <section class="setting-card" data-cy="debug-mode">
        <span class="setting-icon" aria-hidden="true"
          ><svg class="icon"><use href="#i-terminal" /></svg
        ></span>
        <div class="setting-copy">
          <h2 id="settings-debug-label">Debug mode</h2>
          <p id="settings-debug-help">
            Show the Events tab in a conversation’s side panel: the raw event list, for chasing
            bugs.
          </p>
        </div>
        <input
          v-model="debugMode"
          type="checkbox"
          role="switch"
          data-cy="debug-mode-switch"
          aria-labelledby="settings-debug-label"
          aria-describedby="settings-debug-help"
        />
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-surface {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--text);
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
}
.settings-heading {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-24) var(--space-10);
}
.settings-heading h1 {
  margin: 0;
  font-size: var(--type-display);
  font-weight: var(--fw-bold);
}
.settings-icon,
.setting-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--space-28);
  height: var(--space-28);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-card);
  background: var(--accent-fill);
  color: var(--accent);
}
.settings-icon .icon,
.setting-icon .icon {
  width: var(--icon-display);
  height: var(--icon-display);
}
.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  flex: none;
  gap: var(--space-12);
  margin: 0 var(--space-24);
  border-bottom: var(--border-width) solid var(--line);
}
.settings-tabs button {
  min-height: 40px;
  margin-bottom: calc(-1 * var(--border-width));
  padding: 0 var(--space-3);
  border: 0;
  border-bottom: var(--border-accent-width) solid transparent;
  background: transparent;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}
.settings-tabs button[aria-selected='true'] {
  border-color: var(--accent);
  color: var(--accent-text);
}
.settings-tabs button:focus-visible {
  outline: var(--border-accent-width) solid var(--accent);
  outline-offset: var(--space-1);
}
.settings-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.settings-simple {
  overflow-y: auto;
  padding: var(--space-12) var(--space-24);
}
#settings-panel-plugins {
  padding-inline: var(--space-12);
}
.general-panel {
  gap: var(--space-8);
}
.setting-card {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-10);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.setting-copy {
  flex: 1;
  min-width: 0;
}
.setting-copy h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}
.setting-copy p {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.setting-card input[role='switch'] {
  width: 36px;
  height: 22px;
  flex: none;
  margin: 0;
  appearance: none;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--panel-2);
  background-image: radial-gradient(circle, var(--muted) 0 7px, transparent 7.5px);
  background-position: left 2px center;
  background-repeat: no-repeat;
  background-size: 18px 18px;
  cursor: pointer;
}
.setting-card input[role='switch']:checked {
  border-color: var(--accent);
  background-color: var(--accent);
  background-image: radial-gradient(circle, var(--panel) 0 7px, transparent 7.5px);
  background-position: right 2px center;
}
.setting-card input[role='switch']:focus-visible {
  outline: var(--border-accent-width) solid var(--accent);
  outline-offset: var(--space-1);
}
.dock-label-card {
  flex-direction: column;
  align-items: stretch;
}
.dock-label-head {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}
.dock-label-status {
  margin: 0;
  padding-left: calc(var(--space-28) + var(--space-8));
  color: var(--muted);
  font-size: var(--type-small);
}
.dock-label-status:empty {
  display: none;
}
.dock-label-choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  padding-left: calc(var(--space-28) + var(--space-8));
}
.dock-label-name {
  width: 11ch;
  min-height: 32px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-weight: var(--fw-semibold);
  letter-spacing: 0.06em;
}
.dock-label-name:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.dock-label-swatches {
  display: flex;
  gap: var(--space-4);
}
.dock-label-swatch {
  width: 24px;
  height: 24px;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.dock-label-swatch[aria-checked='true'] {
  border-color: var(--text);
  box-shadow: inset 0 0 0 var(--space-1) var(--panel);
}
.dock-label-swatch:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.settings-content :deep(.providers-surface),
.settings-content :deep(.tools-surface) {
  background: transparent;
}
.settings-content :deep(.providers-surface .page),
.settings-content :deep(.tools-surface .page) {
  padding-top: var(--space-12);
}
.settings-content :deep(.providers-surface .page-head) {
  padding-left: 0;
  min-height: 0;
}
</style>
