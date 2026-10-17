import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'
import { scene } from '../capture'

/**
 * 🎨 **The new-conversation form** — the front door: what to ask, who answers and where, with a
 * prompt half written. ⚑ Fake data only: change DRAFT for another.
 */
const DRAFT =
  'Plan the bakery website with the team: a header, the menu page and a contact form, in the brand colours.'

scene('new-conversation', async (stage) => {
  window.api = {
    runtime: {
      checkProviderAuth: async () => ({
        state: 'usable',
        account: 'someone@example.com',
        login: 'account',
        plan: 'max',
        expiresAt: null,
      }),
      reprovisionProviderAuth: async () => 'unchanged',
      signInProvider: async () => ({ success: true, state: null, detail: null }),
      cancelProviderSignIn: async () => undefined,
      listResumable: async () => [],
      listUnresumable: async () => [],
    },
    pathForDroppedFile: () => '',
  } as never
  stage.mount(NewConversation, {
    busy: false,
    error: null,
    debug: false,
    draft: DRAFT,
    defaultProvider: 'claude',
    defaultApprovalMode: 'ask',
    capabilities: CAPABILITY_FIXTURE,
    choices: NO_LAUNCH_CHOICES,
    handing: createAttachmentBook().handing(NEW_CONVERSATION),
  })
  await new Promise((done) => setTimeout(done, 50))
})
