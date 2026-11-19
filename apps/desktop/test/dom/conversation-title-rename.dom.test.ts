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
  const sessionId = 'fictional-conversation'
  const address = 'W1.1'
  const task = { label: 'W1.4', title: 'Review the launch list', more: 2 }
  window.api.runtime.listResumable = async () => [
    {
      sessionId,
      provider: 'claude',
      ref: {
        provider: 'claude',
        sessionId: 'fictional-provider-record',
        cwd: META.cwd,
        rotation: 0,
      },
      cwd: META.cwd,
      status: 'idle',
      running: 'unwatched',
      state: { is: 'idle' },
      named: task,
      approvalMode: 'ask',
      profileId: META.profileId,
      reasoningEffort: null,
      model: null,
      planMode: null,
      adoptedAt: null,
      hasTranscript: true,
      lastEnding: null,
      child: null,
      resumeRefusal: null,
      updatedAt: 1,
    },
  ]
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
    address,
    title: input.title.trim(),
    author: { kind: 'person' },
    previousTitle: task.title,
    previousAuthor: null,
  }))
  const retitle = vi.fn<RuntimeBridge['retitleWork']>()
  window.api.runtime.renameConversation = rename
  window.api.runtime.retitleWork = retitle
  await sessions.attachOpen()

  const m = mount(RuntimeScreen, {})
  await expect
    .poll(() => m.all('conversation-title-rename')[0]?.textContent?.trim())
    .toBe('W1.4 · Review the launch list (and 2 more)')
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
  expect(m.q('conversation-address').textContent?.trim()).toBe('Conversation W1.1')
  expect(m.q('conversation-linked-task').textContent?.trim()).toBe(
    'Task W1.4 · Review the launch list (and 2 more)',
  )
})
