import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { PROFILE_OWNS } from '../../src/renderer/src/lib/profile-words'
import type { Provider } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

// The approved short launcher removes the credential disclosure. Capability wording
// remains covered by profile-credential.test.ts, where its surviving helper is used.
function open(over: { defaultProvider?: Provider } = {}): Mounted {
  const words = ref('go')
  const book = createAttachmentBook()
  const Frame = defineComponent({
    setup: () => () =>
      h(NewConversation as Component, {
        busy: false,
        error: null,
        debug: false,
        draft: words.value,
        handing: book.handing(NEW_CONVERSATION),
        defaultProvider: over.defaultProvider ?? 'codex',
        models: null,
        choices: NO_LAUNCH_CHOICES,
        defaultApprovalMode: 'ask',
        approvalDefaultChosen: true,
        capabilities: allProviderCapabilities(),
        'onUpdate:draft': (text: string) => (words.value = text),
      }),
  })
  return mount(Frame, {}, { width: 1000, height: 900 })
}

afterEach(unmountAll)
describe('the shortened launcher', () => {
  it.each(['claude', 'codex'] as const)(
    'does not restore the removed %s credential explanation',
    async (provider) => {
      const m = open({ defaultProvider: provider })
      await nextTick()
      expect(m.all('launcher-why-credential')).toHaveLength(0)
      expect(m.all('profile-credential')).toHaveLength(0)
      expect(visible(m.q('prompt-input'))).toBe(true)
      expect(visible(m.q('model-picker-face'))).toBe(true)
    },
  )
  it('the surviving profile description does not promise a provider sign-in', () => {
    expect(PROFILE_OWNS.toLowerCase()).toContain('its own instruction file')
    expect(PROFILE_OWNS.toLowerCase()).not.toContain('sign-in')
  })
})
