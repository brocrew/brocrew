import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo, RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import { agentName } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
vi.mock('../../src/shared/runtime-ipc', { spy: true })
const conversationNamesRead = () =>
  vi.mocked(agentName).mock.calls.filter(([profile]) => profile === 'synthetic-worker').length

it('updates nine states without deriving the details of 1960 conversations again', async () => {
  let folder = '/synthetic/workspace'
  const conversations: ResumableSessionInfo[] = Array.from({ length: 1960 }, (_, i) => ({
    sessionId: `conversation-${i}`,
    provider: 'claude',
    cwd: folder,
    profileId: 'synthetic-worker',
    status: 'idle',
    state: { is: 'idle' },
    named: null,
    approvalMode: 'ask',
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    child: null,
    lastEnding: 'completed',
    updatedAt: 10000 - i,
    running: 'not-running',
    ref: { provider: 'claude', sessionId: `thread-${i}`, cwd: folder, rotation: 0 },
    resumeRefusal: null,
  }))
  const beforeApi = window.api
  window.api = {
    runtime: {
      listResumable: async () => conversations.map((row) => ({ ...row, cwd: folder })),
      listUnresumable: async () => [],
    },
  } as unknown as typeof window.api
  try {
    const mounted = mount(
      SideRail,
      { open: [], activeId: null, place: null, onSelect: () => undefined },
      { width: 252, height: 900 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(mounted.host.querySelectorAll('[data-session-id]')).toHaveLength(1960)
    expect(conversationNamesRead()).toBe(1960)
    const order = () =>
      [...mounted.host.querySelectorAll('[data-session-id]')].map((row) =>
        row.getAttribute('data-session-id'),
      )
    const before = order()
    vi.mocked(agentName).mockClear()
    const moved = Array.from({ length: 9 }, (_, i) => ({
      conversation: `conversation-${i}`,
      state: { is: 'active' as const },
    }))
    ;(mounted.vm.hearStates as (message: RuntimeStatesMessage) => void)({ moved, kept: [] })
    await nextTick()
    expect(mounted.host.querySelectorAll('small[data-standing="working"]')).toHaveLength(9)
    expect(mounted.host.querySelectorAll('small[data-standing="idle"]')).toHaveLength(1951)
    expect(order()).toEqual(before)
    expect(conversationNamesRead(), 'a state notice must not derive unchanged names').toBe(0)

    folder = '/synthetic/renamed-folder'
    await (mounted.vm.refreshResumable as () => Promise<void>)()
    await nextTick()
    expect(conversationNamesRead()).toBe(1960)
    expect(mounted.q('open-session-conversation-0').textContent).toContain('renamed-folder')
    expect(mounted.host.querySelectorAll('small[data-standing="idle"]')).toHaveLength(1960)
  } finally {
    window.api = beforeApi
  }
})
