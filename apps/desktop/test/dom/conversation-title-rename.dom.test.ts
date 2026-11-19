import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { META, mount } from './harness'
import {
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
  sessions,
} from './runtime-screen-fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

it('renames the open conversation through the conversation command without retitling work', async () => {
  const sessionId = 'fictional-service'
  runtime.attachOpen.mockResolvedValueOnce([
    {
      ...META,
      sessionId,
      handover: 'attached',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    },
  ])
  const rename = vi.fn<RuntimeBridge['renameConversation']>(async (input) => ({
    ok: true,
    conversation: input.conversation,
    address: sessionId,
    title: input.title.trim(),
    author: { kind: 'person' },
    previousTitle: 'Editorial service',
    previousAuthor: null,
  }))
  const retitle = vi.fn<RuntimeBridge['retitleWork']>()
  window.api.runtime.renameConversation = rename
  window.api.runtime.retitleWork = retitle
  await sessions.attachOpen()

  const m = mount(RuntimeScreen, {})
  await expect.poll(() => m.all('conversation-title-rename').length).toBe(1)
  m.q('conversation-title-rename').click()
  await expect.poll(() => m.all('conversation-title-input').length).toBe(1)
  const input = m.q('conversation-title-input') as HTMLInputElement
  input.value = ' Edit launch notes '
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  await expect.poll(() => m.q('conversation-title').textContent?.trim()).toBe('Edit launch notes')
  expect(rename).toHaveBeenCalledExactlyOnceWith({
    conversation: sessionId,
    title: ' Edit launch notes ',
  })
  expect(retitle).not.toHaveBeenCalled()
  expect(m.q('conversation-address').textContent?.trim()).toBe('Conversation fictional-service')
})
