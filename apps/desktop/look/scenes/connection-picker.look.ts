import { defineComponent, h } from 'vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import type { ModelList, Provider } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'
import { compatibilityConnections } from '../../test/provider-connection-fixture'
import { scene } from '../capture'
import { settle } from '../fixtures/window'
import { wearReadabilityTheme } from '../fixtures/readability-themes'

// The real launcher and picker, over fictional metadata and catalogues only.
scene('connection-picker', async (stage) => {
  const env = import.meta.env as Record<string, string | undefined>
  wearReadabilityTheme(env.LOOK_PICKER_THEME === 'crew-night' ? 'crew-night' : 'classic')
  const six = env.LOOK_PICKER_STATE === 'open-six'
  const rows = compatibilityConnections()
  if (six)
    for (const [index, name] of ['Bedrock', 'Vertex', 'Gateway', 'Local'].entries()) {
      rows.push({ ...rows[0]!, id: `fictional-disabled-${index}`, name, enabled: false })
    }
  const listOf = (provider: Provider): ModelList => ({
    provider,
    notAsked: null,
    standIn: null,
    lastPicked: null,
    startsOn: null,
    models: ['Fictional small', 'Fictional standard', 'Fictional large'].map((label, index) => ({
      id: `fictional-${index}`,
      label,
      addedBy: 'the-provider',
      efforts: [
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
      ],
      defaultEffort: 'medium',
      ...(index === 0 ? { isDefault: true as const } : {}),
    })),
  })
  const runtime = {
    providerConnections: async () => rows,
    modelList: async ({ provider }: { provider: Provider }) => listOf(provider),
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
    checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
    listResumable: async () => [],
    listUnresumable: async () => [],
  }
  window.api = { runtime, pathForDroppedFile: () => '' } as never
  const lists = createModelLists(() => runtime)
  const preview = defineComponent({
    setup: () => () =>
      h(
        'div',
        {
          style: 'display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg)',
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
      ),
  })
  const m = stage.mount(preview, {})
  await settle()
  if (env.LOOK_PICKER_STATE !== 'closed') {
    m.host.querySelector<HTMLButtonElement>('[data-cy="model-picker-face"]')!.click()
    await settle()
  }
  const caption = document.createElement('p')
  caption.textContent = six
    ? 'Fictional preview; extra connections are switched off.'
    : 'Preview · fictional connections and models'
  caption.style.cssText =
    'position:fixed;bottom:8px;left:16px;right:16px;text-align:center;margin:0;padding:6px;border-radius:8px;background:var(--panel);color:var(--text);font:12px sans-serif;z-index:99999'
  document.body.append(caption)
})
