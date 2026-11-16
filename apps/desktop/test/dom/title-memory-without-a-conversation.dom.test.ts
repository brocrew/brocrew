import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  runtime,
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
} from './runtime-screen-fixture'
import {
  railFacts,
  screenFacts,
  useWhoCalledWhom,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import { mount } from './harness'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(() => {
  installRuntimeScreenFixture()
  screenFacts().update({ forest: null, processMemory: new Map(), memoryUnmeasured: null })
})
afterEach(() => {
  disposeRuntimeScreenFixture()
  vi.restoreAllMocks()
  runtime.processMemory.mockResolvedValue({ conversations: [] })
})

it('reads memory on arrival and focus while no conversation or graph is open', async () => {
  const MB = 1024 ** 2
  runtime.processMemory.mockResolvedValue({
    conversations: [{ conversation: 'fictional-worker', bytes: 240 * MB }],
  })
  const screen = mount(RuntimeScreen, {})
  await expect.poll(() => runtime.processMemory.mock.calls.length).toBeGreaterThan(0)
  railFacts().update({
    runningConversations: [
      { sessionId: 'fictional-worker', provider: 'codex', state: { is: 'active' } },
    ],
  })
  await expect.poll(() => screen.q('app-usage').textContent).toContain('240 MB')
  expect(useWhoCalledWhom().forest.value).toBeNull()
  expect(runtime.forestReading).not.toHaveBeenCalled()

  runtime.processMemory.mockResolvedValue({
    conversations: [{ conversation: 'fictional-worker', bytes: 360 * MB }],
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  await nextTick()
  await expect.poll(() => screen.q('app-usage').textContent).toContain('360 MB')
  expect(runtime.forestReading).not.toHaveBeenCalled()
})
