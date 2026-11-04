import { defineComponent, h } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  ModelList,
  Provider,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'
import { compatibilityConnections } from '../../test/provider-connection-fixture'
import { scene } from '../capture'
import { settle } from '../fixtures/window'
import { wearReadabilityTheme } from '../fixtures/readability-themes'

// Integrate into look/scenes without altering these imports. Every bridge answer is fictional.
// LOOK_POLISH_STATE: agent-closed | agent-open | new-open. LOOK_PICKER_THEME: classic | crew-night.
scene('agent-dialog-polish', async (stage) => {
  const env = import.meta.env as Record<string, string | undefined>
  const state = env.LOOK_POLISH_STATE ?? 'agent-closed'
  if (!['agent-closed', 'agent-open', 'new-open'].includes(state))
    throw new Error(`Unknown fictional capture state: ${state}`)
  wearReadabilityTheme(env.LOOK_PICKER_THEME === 'crew-night' ? 'crew-night' : 'classic')
  const slug = 'fictional-baker'
  const roster = {
    identities: [
      {
        id: 'fictional-agent-row',
        slug,
        displayName: 'Robin',
        role: null,
        createdAt: 1_700_000_000_000,
        createdBy: null,
        provider: 'claude',
        connectionId: 'claude:sign-in',
        externalMcpServerIds: [],
        capabilities: DEFAULT_CAPABILITIES,
        chosen: Object.fromEntries(
          Object.keys(DEFAULT_CAPABILITIES).map((key) => [key, 'default']),
        ),
      },
    ],
    foldersWithoutARow: [],
    use: [
      {
        slug,
        conversations: 0,
        thisAppMintsIt: false,
        isLaunching: false,
        isStarting: false,
        runsOn: { provider: 'claude', from: 'saved' },
      },
    ],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  } as unknown as AgentIdentities
  const listOf = (provider: Provider): ModelList => ({
    provider,
    notAsked: null,
    standIn: 'brobot',
    lastPicked: null,
    startsOn: null,
    models: [
      'Fictional small',
      'Fictional standard',
      'Fictional large',
      'Fictional swift',
      'Fictional careful',
      'Fictional broad',
    ].map((label, index) => ({
      id: `fictional-${index}`,
      label,
      addedBy: 'the-provider',
      description: 'An illustrative model description for the fictional bakery planning task.',
      efforts: [
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
      ],
      defaultEffort: 'medium',
      ...(index === 0 ? { isDefault: true as const } : {}),
    })),
  })
  const runtime = {
    providerConnections: async () => compatibilityConnections(),
    agentIdentities: async () => roster,
    profiles: async () => [slug],
    agentModelAndEffort: async () => ({
      provider: 'claude',
      connectionId: 'claude:sign-in',
      model: 'fictional-1',
      effort: 'medium',
    }),
    agentInstructions: async () => ({
      own: { identity: slug, versions: [] },
      waiting: [],
      readAt: 1_700_000_000_000,
    }),
    agentRulesUnread: async () => null,
    onChanged: () => () => {},
    modelList: async ({ provider }: { provider: Provider }) => listOf(provider),
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
    checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
    listResumable: async () => [],
    listUnresumable: async () => [],
  } as unknown as RuntimeBridge
  window.api = { runtime, pathForDroppedFile: () => '' } as never
  const lists = createModelLists(() => runtime)
  const store = createAgentStore(runtime)
  await store.load()
  const preview = defineComponent({
    setup: () => () =>
      state === 'new-open'
        ? h(
            'div',
            {
              style:
                'display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg)',
            },
            [
              h(AppTitleBar, { info: null, error: null }),
              h(NewConversation, {
                busy: false,
                error: null,
                debug: false,
                draft: 'Plan the fictional bakery website.',
                defaultProvider: 'claude',
                defaultApprovalMode: 'ask',
                capabilities: CAPABILITY_FIXTURE,
                choices: NO_LAUNCH_CHOICES,
                handing: createAttachmentBook().handing(NEW_CONVERSATION),
                lists,
              }),
            ],
          )
        : h(
            'div',
            {
              'data-chat-theme': 'light',
              style:
                'display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:var(--overlay-backdrop);color:var(--text)',
            },
            [
              h(CapabilitiesSheet, {
                profileSlug: slug,
                runsOn: 'claude',
                store,
                lists,
                capabilities: CAPABILITY_FIXTURE,
              }),
            ],
          ),
  })
  const mounted = stage.mount(preview, {})
  await settle()
  const face = mounted.host.querySelector<HTMLButtonElement>('[data-cy="model-picker-face"]')
  if (!face) throw new Error('Fictional surface did not render its model picker face')
  if (state !== 'agent-closed') {
    face.click()
    await settle()
    if (mounted.host.querySelectorAll('[data-cy="model-picker-row"]').length !== 6)
      throw new Error('Fictional picker did not render all six model rows')
  }
  const caption = document.createElement('p')
  caption.textContent = 'Preview · fictional agent, connections and models'
  caption.style.cssText =
    'position:fixed;bottom:8px;left:16px;right:16px;text-align:center;margin:0;padding:6px;border-radius:8px;background:var(--panel);color:var(--text);font:12px sans-serif;z-index:99999'
  document.body.append(caption)
})
