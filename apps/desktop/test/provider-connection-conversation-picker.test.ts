import { expect, it, vi } from 'vitest'
import { useConversationModelPick } from '../src/renderer/src/composables/useConversationModelPick'
import type { CreatedSession } from '../src/shared/runtime-ipc'

for (const provider of ['claude', 'codex'] as const) {
  for (const bound of [false, true]) {
    it(`${provider}: ${bound ? 'bound' : 'legacy NULL'} conversation picker is locked to its own route`, () => {
      const session = {
        sessionId: 'fictional-conversation',
        provider,
        profileId: 'fern',
        ...(bound ? { connectionId: `${provider}:sign-in` } : {}),
        settings: {
          model: 'fictional-small',
          reasoningEffort: 'medium',
          pendingModel: null,
          pendingReasoningEffort: null,
          reported: null,
        },
      } as unknown as CreatedSession
      const pick = useConversationModelPick({
        session: () => session,
        pickModel: () => vi.fn(async () => null),
        fixed: () => false,
        capabilities: () => null,
      })
      expect(pick.picker.value).toMatchObject({
        lockedConnection: true,
        preferredProvider: provider,
      })
      if (bound) {
        expect(pick.picker.value).toHaveProperty('connectionId', `${provider}:sign-in`)
        expect(pick.picker.value?.shown).toHaveProperty('connectionId', `${provider}:sign-in`)
      } else {
        expect(pick.picker.value?.shown).not.toHaveProperty('connectionId')
      }
    })
  }
}
