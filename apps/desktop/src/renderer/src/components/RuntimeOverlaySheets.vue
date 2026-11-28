<script lang="ts">
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { CreateSessionInput, LaunchRefusal } from '../../../shared/runtime-ipc'

/** The shared launch reports opening/refusal synchronously at their original points. */
export type SheetStart = (
  input: CreateSessionInput & { profileId: string },
  firstMessage: string,
  attachments: HandedPath[],
  told: { opened?(): void; refused?(sentence: string, reason: LaunchRefusal | null): void },
) => Promise<void>
</script>

<script setup lang="ts">
import { computed, shallowRef, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import {
  agentName,
  PROVIDER_NAME,
  type Provider,
  type ProviderCapabilityMap,
  type ProviderProgram,
} from '../../../shared/runtime-ipc'
import type { SettingsTab } from './SettingsScreen.vue'
import { useAgentStore } from '../composables/useAgentStore'
import { useSessionStore } from '../composables/useSessionStore'
import { useModelLists } from '../composables/useModelLists'
import { useClientProviders } from '../client-provider/injection'
import { readableError } from '../lib/session-record'
import { afterAPlacedLaunch } from '../lib/placed-launch'
import type { ListedConversation } from '../lib/conversation-list'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../lib/launch-choices'
import type { DraftBook } from '../lib/drafts'
import { newAgentDraftSlot } from '../../../shared/saved-drafts'
import { useOverlays, type Overlay } from '../lib/overlay-store'
import OverlayHost from './OverlayHost.vue'
import NewAgent from './NewAgent.vue'
import ExternalMcpRegistry from './ExternalMcpRegistry.vue'
import AgentSectionsSheet from './AgentSectionsSheet.vue'
import CapabilitiesSheet from './CapabilitiesSheet.vue'
import NewConversation from './NewConversation.vue'
import SheetShell from './SheetShell.vue'
import DeleteConversation from './DeleteConversation.vue'

const props = defineProps<{
  capabilities: ProviderCapabilityMap | null
  defaultApprovalMode: 'ask' | 'auto' | null
  start: SheetStart
  drafts: DraftBook
  recent?: readonly ListedConversation[] | null
  programs?: Readonly<Partial<Record<Provider, ProviderProgram>>> | null
}>()
const emit = defineEmits<{
  settings: [tab: SettingsTab]
  open: [sessionId: string]
  providers: [provider?: Provider]
  authChanged: [profileId: string]
  archived: [conversations: readonly string[]]
  deleted: [conversations: readonly string[]]
}>()

// RuntimeScreen initializes these window singletons before this always-mounted child is created.
// Acquiring them here does not load, attach or subscribe a second time.
const overlays = useOverlays()
const agentStore = useAgentStore()
const store = useSessionStore()
const modelLists = useModelLists(useClientProviders())

const launchChoices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
const placement = computed(() => {
  const overlay = overlays.overlay.value
  return overlay?.kind === 'startAsAgent'
    ? { profileId: overlay.profileSlug, name: agentHeadingFor(overlay.profileSlug) }
    : null
})
const placementProvider = computed(() => launchChoices.value.provider ?? overlayProvider.value)
const placementReadiness = computed(() => {
  const profile = placement.value
  if (profile === null) return null
  return Object.fromEntries(
    (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => {
      const check = modelLists.readiness(provider, profile.profileId)
      const ready =
        props.programs?.[provider]?.standing === 'missing'
          ? false
          : check.state === 'settled'
            ? check.ready
            : null
      return [provider, ready]
    }),
  )
})

function readPlacementReadiness(): void {
  const profile = placement.value
  const provider = placementProvider.value
  if (profile && provider) void modelLists.read(provider, profile.profileId)
}

function placementAuthChanged(profileId: string): void {
  emit('authChanged', profileId)
  readPlacementReadiness()
}

// A provider answer belongs to the exact overlay request, including a same-profile reopening.
const overlayProvider = ref<Provider | null>(null)
const overlayProviderLoading = ref(false)
const overlayProviderError = ref<string | null>(null)
const overlayProviderStatus = ref<HTMLElement | null>(null)
const overlayProviderBody = ref<HTMLElement | null>(null)
let providerOverlay: Overlay | null = null
let overlayProviderRead = 0
let overlayProviderAlive = true
async function resolveOverlayProvider(): Promise<void> {
  const overlay = overlays.overlay.value
  const ours = ++overlayProviderRead
  if (overlay !== providerOverlay) {
    overlayProvider.value = null
    launchChoices.value = { ...NO_LAUNCH_CHOICES }
  }
  providerOverlay = overlay
  overlayProviderError.value = null
  if (overlay?.kind !== 'agentCapabilities' && overlay?.kind !== 'startAsAgent') {
    overlayProviderLoading.value = false
    return
  }
  const focused = document.activeElement as HTMLElement | null
  const wasInside = focused !== null && overlayProviderBody.value?.contains(focused)
  let focusArrivedSheet = false
  let answered = false
  overlayProviderLoading.value = true
  const ownsAnswer = () =>
    overlayProviderAlive && ours === overlayProviderRead && overlays.overlay.value === overlay
  try {
    const answer = await modelLists.resolve({
      profileId: overlay.profileSlug,
      askedProvider: null,
      providers: [],
    })
    if (ownsAnswer()) {
      focusArrivedSheet = overlayProviderStatus.value?.contains(document.activeElement) === true
      overlayProvider.value = answer.provider
      answered = true
    }
  } catch (error) {
    if (ownsAnswer()) overlayProviderError.value = readableError(error)
  } finally {
    if (ownsAnswer()) overlayProviderLoading.value = false
  }
  if (!answered) return
  await nextTick()
  if (!ownsAnswer()) return
  if (focusArrivedSheet)
    overlayProviderBody.value?.querySelector<HTMLElement>('[data-cy="close-overlay"]')?.focus()
  else if (wasInside && focused?.isConnected && document.activeElement === document.body)
    focused.focus()
}
watch(
  [() => overlays.overlay.value, () => agentStore.identities.value],
  () => void resolveOverlayProvider(),
  { immediate: true, flush: 'sync' },
)
watch([placementProvider, () => placement.value?.profileId], readPlacementReadiness)
onBeforeUnmount(() => {
  overlayProviderAlive = false
  overlayProviderRead++
})

/** The Team card's name, read live rather than snapshotted onto the overlay. */
function agentHeadingFor(profileSlug: string): string {
  return agentName(profileSlug, agentStore.identities.value?.identities ?? null)
}

/**
 * Keep a placed launch's sheet open until the conversation opens, with refusals beside its words.
 * Capture the overlay object: a replacement, even for the same agent, is not the sheet that asked.
 * A refusal after replacement goes through the window-wide notice above the modal layer.
 * The parent still owns creating the conversation, navigating and sending the first message.
 */
async function startPlaced(
  input: CreateSessionInput & { profileId: string },
  firstMessage: string,
  attachments: HandedPath[],
): Promise<void> {
  const sheet = overlays.overlay.value
  placedFrom.value = sheet
  placedRefusedAs.value = null
  const stillThere = (): boolean => sheet !== null && overlays.overlay.value === sheet
  let refusal: string | null = null
  await props.start(input, firstMessage, attachments, {
    opened: () => {
      if (afterAPlacedLaunch({ kind: 'opened' }, stillThere()).close) overlays.close()
    },
    refused: (sentence, reason) => {
      if (stillThere()) placedRefusedAs.value = reason
      refusal = sentence
    },
  })
  if (refusal !== null) {
    const { notice } = afterAPlacedLaunch({ kind: 'refused', sentence: refusal }, stillThere())
    if (notice !== null) overlays.notify(notice)
  }
}

/** Busy/error belong to the overlay object that pressed Start, not just to an agent slug. */
const placedFrom = shallowRef<unknown>(null)
const placedRefusedAs = ref<LaunchRefusal | null>(null)
const placedHere = computed(
  () => placedFrom.value !== null && placedFrom.value === overlays.overlay.value,
)

/** Closing the current sheet cancels its pending launch; a launch that opened first wins the race. */
function closeOverlay(): void {
  if (placedHere.value && store.isPlacing()) void store.cancelPlaced()
  overlays.close()
}

function openRecent(sessionId: string): void {
  closeOverlay()
  emit('open', sessionId)
}

function openProviders(provider?: Provider): void {
  closeOverlay()
  emit('providers', provider)
}

/** What a screen reader calls the open sheet: the words its own title shows. */
function overlayLabel(overlay: Overlay): string {
  switch (overlay.kind) {
    case 'newAgent':
      return 'New agent'
    case 'externalMcpServers':
      return 'External tools'
    case 'agentSections':
      return 'Agent knowledge'
    case 'agentCapabilities':
      return agentHeadingFor(overlay.profileSlug)
    case 'startAsAgent':
      return `New conversation as ${agentHeadingFor(overlay.profileSlug)}`
    case 'deleteConversation':
      return 'Delete a conversation'
  }
}
</script>

<template>
  <OverlayHost
    v-if="overlays.overlay.value"
    :label="overlayLabel(overlays.overlay.value)"
    @close="closeOverlay()"
  >
    <NewAgent v-if="overlays.overlay.value.kind === 'newAgent'" @close="overlays.close()" />
    <!-- Edit the external_mcp_server rows resolved at launch. Which restricted ones an agent may
         use is set on CapabilitiesSheet. -->
    <ExternalMcpRegistry
      v-else-if="overlays.overlay.value.kind === 'externalMcpServers'"
      @close="overlays.close()"
    />
    <AgentSectionsSheet
      v-else-if="overlays.overlay.value.kind === 'agentSections'"
      :profile-slug="overlays.overlay.value.profileSlug"
      :agent-name="agentHeadingFor(overlays.overlay.value.profileSlug)"
      :store="agentStore"
      @close="overlays.close()"
      @settings="
        () => {
          overlays.close()
          emit('settings', 'skills')
        }
      "
    />
    <div
      v-else-if="
        overlays.overlay.value.kind === 'agentCapabilities' ||
        overlays.overlay.value.kind === 'startAsAgent'
      "
      style="display: flex; flex-direction: column; align-items: center"
    >
      <div
        v-if="overlayProviderLoading || overlayProviderError"
        ref="overlayProviderStatus"
        role="status"
        data-cy="overlay-provider-status"
      >
        <p v-if="overlayProviderLoading">Reading launch choices…</p>
        <template v-else>
          <p>{{ overlayProviderError }}</p>
          <button type="button" data-cy="overlay-provider-retry" @click="resolveOverlayProvider">
            Try again
          </button>
        </template>
        <button type="button" data-cy="overlay-provider-close" @click="closeOverlay()">
          Close
        </button>
      </div>
      <div
        v-if="overlayProvider !== null"
        ref="overlayProviderBody"
        :key="overlays.overlay.value.profileSlug"
        :inert="overlayProviderLoading || overlayProviderError !== null"
        style="display: contents"
      >
        <CapabilitiesSheet
          v-if="overlays.overlay.value.kind === 'agentCapabilities'"
          :profile-slug="overlays.overlay.value.profileSlug"
          :runs-on="overlayProvider"
          :capabilities="props.capabilities"
          @close="overlays.close()"
          @start-conversation="(slug) => overlays.open({ kind: 'startAsAgent', profileSlug: slug })"
        />
        <SheetShell
          v-else-if="placement && placementProvider"
          :glyph="placement.profileId.slice(0, 1).toUpperCase()"
          class="start-as-agent"
          style="--sheet-width: 620px; --sheet-body-padding: var(--space-8) var(--space-9)"
          data-cy="start-as-agent"
          @close="closeOverlay"
        >
          <template #header>
            <strong data-cy="start-as-agent-title">New conversation as {{ placement.name }}</strong>
          </template>
          <template #body>
            <NewConversation
              :team="placement"
              :default-provider="placementProvider"
              :provider-readiness="placementReadiness"
              :default-approval-mode="props.defaultApprovalMode"
              :capabilities="props.capabilities"
              :programs="props.programs"
              :lists="modelLists"
              :recent="props.recent"
              :choices="launchChoices"
              :busy="placedHere && store.isPlacing()"
              :error="placedHere ? store.placedError.value : null"
              :refused-as="placedHere ? placedRefusedAs : null"
              :draft="props.drafts.read(newAgentDraftSlot(placement.profileId))"
              :handing="props.drafts.paths.handing(newAgentDraftSlot(placement.profileId))"
              :submit="startPlaced"
              @update:choices="(choices) => (launchChoices = choices)"
              @update:draft="
                (text) =>
                  placement && props.drafts.write(newAgentDraftSlot(placement.profileId), text)
              "
              @auth-changed="placementAuthChanged"
              @open-providers="openProviders"
              @open="openRecent"
              @cancel="void store.cancelPlaced()"
            />
          </template>
        </SheetShell>
      </div>
    </div>
    <!-- The confirmation before a delete: it reads what would go, and a person ticks each part. -->
    <DeleteConversation
      v-else-if="overlays.overlay.value.kind === 'deleteConversation'"
      :key="overlays.overlay.value.sessionId"
      :session-id="overlays.overlay.value.sessionId"
      @close="closeOverlay()"
      @archived="(conversations) => emit('archived', conversations)"
      @deleted="(conversations) => emit('deleted', conversations)"
    />
  </OverlayHost>
</template>
