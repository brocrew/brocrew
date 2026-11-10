<script lang="ts">
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { CreateSessionInput } from '../../../shared/runtime-ipc'

/** The shared launch reports opening/refusal synchronously at their original points. */
export type SheetStart = (
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[],
  told: { opened?(): void; refused?(sentence: string): void },
) => Promise<void>
</script>

<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { DEFAULT_CONVERSATION_PROVIDER } from '@brobot2/shared/providers'
import { agentName, type Provider, type ProviderCapabilityMap } from '../../../shared/runtime-ipc'
import type { SettingsTab } from './SettingsScreen.vue'
import { useAgentStore } from '../composables/useAgentStore'
import { useSessionStore } from '../composables/useSessionStore'
import { providerForALaunch } from '../lib/agent-store'
import { afterAPlacedLaunch } from '../lib/placed-launch'
import { conversationsToReopen, type AConversationToReopen } from '../lib/reopening'
import { useOverlays, type Overlay } from '../lib/overlay-store'
import OverlayHost from './OverlayHost.vue'
import NewAgent from './NewAgent.vue'
import ExternalMcpRegistry from './ExternalMcpRegistry.vue'
import AgentSectionsSheet from './AgentSectionsSheet.vue'
import CapabilitiesSheet from './CapabilitiesSheet.vue'
import StartAsAgent from './StartAsAgent.vue'
import DeleteConversation from './DeleteConversation.vue'

const props = defineProps<{
  capabilities: ProviderCapabilityMap | null
  defaultApprovalMode: 'ask' | 'auto' | null
  start: SheetStart
}>()
const emit = defineEmits<{
  settings: [tab: SettingsTab]
  reopen: [sessionId: string]
  archived: [conversations: readonly string[]]
  deleted: [conversations: readonly string[]]
}>()

// RuntimeScreen initializes these window singletons before this always-mounted child is created.
// Acquiring them here does not load, attach or subscribe a second time.
const overlays = useOverlays()
const agentStore = useAgentStore()
const store = useSessionStore()
const DEFAULT_PROVIDER: Provider = DEFAULT_CONVERSATION_PROVIDER

/** Resolve the sheet's provider from the live roster, using the same rule as the front door. */
function providerForAgent(profileSlug: string): Provider {
  return providerForALaunch(agentStore.identities.value, profileSlug, DEFAULT_PROVIDER)
}

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
function startPlaced(
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[],
): void {
  const sheet = overlays.overlay.value
  placedFrom.value = sheet
  const stillThere = (): boolean => sheet !== null && overlays.overlay.value === sheet
  let refusal: string | null = null
  void props
    .start(input, firstMessage, attachments, {
      opened: () => {
        if (afterAPlacedLaunch({ kind: 'opened' }, stillThere()).close) overlays.close()
      },
      refused: (sentence) => {
        refusal = sentence
      },
    })
    .then(() => {
      if (refusal === null) return
      const { notice } = afterAPlacedLaunch({ kind: 'refused', sentence: refusal }, stillThere())
      if (notice !== null) overlays.notify(notice)
    })
}
/** Busy/error belong to the overlay object that pressed Start, not just to an agent slug. */
const placedFrom = shallowRef<unknown>(null)
const placedHere = computed(
  () => placedFrom.value !== null && placedFrom.value === overlays.overlay.value,
)

/** Closing the current sheet cancels its pending launch; a launch that opened first wins the race. */
function closeOverlay(): void {
  if (placedHere.value && store.isPlacing()) void store.cancelPlaced()
  overlays.close()
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
/**
 * Only this window's held conversations are offered for reopening. Keep the fold lazy: no grant
 * sheet means no walk through live transcripts, and no new dependency on them for other overlays.
 */
const openAsForSheet = computed<readonly AConversationToReopen[]>(() => {
  const overlay = overlays.overlay.value
  if (overlay === null || overlay.kind !== 'agentCapabilities') return []
  // ⚑ **678 · no longer which of them is the selected one** — R26: every draft survives the reopen.
  return conversationsToReopen(store.live.value, overlay.profileSlug)
})
</script>

<template>
  <OverlayHost
    v-if="overlays.overlay.value"
    :label="overlayLabel(overlays.overlay.value)"
    @close="closeOverlay()"
  >
    <NewAgent v-if="overlays.overlay.value.kind === 'newAgent'" @close="overlays.close()" />
    <!-- Edit the external_mcp_server rows resolved at launch. Agent grants are configured
         separately on CapabilitiesSheet. -->
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
    <CapabilitiesSheet
      v-else-if="overlays.overlay.value.kind === 'agentCapabilities'"
      :profile-slug="overlays.overlay.value.profileSlug"
      :runs-on="providerForAgent(overlays.overlay.value.profileSlug)"
      :capabilities="props.capabilities"
      :open-as="openAsForSheet"
      @close="overlays.close()"
      @start-conversation="(slug) => overlays.open({ kind: 'startAsAgent', profileSlug: slug })"
      @reopen="(sessionId) => emit('reopen', sessionId)"
    />
    <StartAsAgent
      v-else-if="overlays.overlay.value.kind === 'startAsAgent'"
      :profile-slug="overlays.overlay.value.profileSlug"
      :provider="providerForAgent(overlays.overlay.value.profileSlug)"
      :default-approval-mode="props.defaultApprovalMode"
      :capabilities="props.capabilities"
      :busy="placedHere && store.isPlacing()"
      :error="placedHere ? store.placedError.value : null"
      @start="startPlaced"
      @cancel="void store.cancelPlaced()"
      @close="closeOverlay()"
    />
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
