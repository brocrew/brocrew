import { defineComponent, h, ref } from 'vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'
import { scene } from '../capture'

scene('new-conversation-recent', async (stage) => {
  const sample = (import.meta.env as Record<string, string>).LOOK_NEW_STATE
  const titles = [
    'Release notes review',
    'Contact form validation',
    'Café menu planning',
    'Landing page header',
    'Photo library cleanup',
    'Newsletter draft',
  ]
  const recent: ListedConversation[] = titles.map((title, i) => ({
    sessionId: `sample-${i}`,
    label: 'BroBot',
    identity: DEFAULT_PROFILE_ID,
    provider: 'claude',
    place: null,
    state: i === 1 ? { is: 'active' } : i === 2 ? { is: 'needs-you' } : { is: 'idle' },
    named: { label: 'Notes', title },
    inAnotherWindow: false,
    updatedAt: Date.UTC(2026, 9, 6, 10, 30) - i * 3_600_000,
  }))
  window.api = {
    runtime: {
      checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
      listResumable: async () => [],
      listUnresumable: async () => [],
    },
    pathForDroppedFile: () => '',
  } as never
  const draft = ref(sample === 'match' ? 'cafe menu' : '')
  const handing = createAttachmentBook().handing(NEW_CONVERSATION)
  stage.mount(
    defineComponent({
      setup: () => () =>
        h(NewConversation, {
          busy: false,
          error: null,
          debug: false,
          draft: draft.value,
          handing,
          recent: sample === 'empty' ? [] : recent,
          programs:
            sample === 'blocked'
              ? {
                  claude: {
                    standing: 'missing',
                    from: null,
                    path: null,
                    version: null,
                    tested: { oldest: '2.1.257', newest: '2.1.290' },
                    others: [],
                    updatedFrom: null,
                    update: null,
                    said: 'BroCrew found no Claude Code where its installers put it, so no Claude conversation can start. Install it, then try again.',
                    help: {
                      label: 'How to install Claude Code',
                      url: 'https://code.claude.com/docs/en/setup',
                    },
                  },
                }
              : null,
          defaultProvider: 'claude',
          defaultApprovalMode: 'ask',
          capabilities: CAPABILITY_FIXTURE,
          choices: NO_LAUNCH_CHOICES,
          'onUpdate:draft': (s: string) => {
            draft.value = s
          },
        }),
    }),
    {},
  )
})
