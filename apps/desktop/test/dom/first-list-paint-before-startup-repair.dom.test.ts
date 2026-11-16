import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import { useRecoveredConversationList } from '../../src/renderer/src/composables/useConversationListRecovery'
import { mount, unmountAll } from './harness'
import { appClosing } from '../../src/renderer/src/lib/app-closing'

vi.mock('../../src/renderer/src/lib/app-closing', async () => {
  const { ref } = await import('vue')
  return { appClosing: ref(false) }
})

const closing = appClosing as Ref<boolean>

afterEach(() => {
  unmountAll()
  closing.value = false
  vi.restoreAllMocks()
})

it.each(['current', 'unmounted', 'closing', 'workspace'] as const)(
  'acknowledges the painted list only while its lifetime remains current: %s',
  async (lifetime) => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const painted = vi.fn(async () => {})
    const client = {
      listResumable: async () => [],
      listUnresumable: async () => [],
      firstListPainted: painted,
    } as unknown as ClientSessionApi
    const workspace = ref('/fictional')
    let refreshed!: Promise<void>
    const view = mount(
      defineComponent({
        setup() {
          const list = useRecoveredConversationList(
            () => workspace.value,
            () => client,
            () => undefined,
          )
          refreshed = list.refreshListed()
          return () => h('div', { 'data-cy': 'list' }, list.looked.value ? 'List ready' : 'Loading')
        },
      }),
      {},
    )
    for (let n = 0; n < 6; n++) await Promise.resolve()
    await nextTick()
    expect(view.q('list').textContent).toBe('List ready')
    expect(painted).not.toHaveBeenCalled()
    frames.shift()!(0)
    expect(painted).not.toHaveBeenCalled()
    const secondFrame = frames.shift()!
    if (lifetime === 'unmounted') view.unmount()
    if (lifetime === 'closing') closing.value = true
    if (lifetime === 'workspace') workspace.value = '/another-fictional-workspace'
    secondFrame(16)
    await refreshed
    if (lifetime === 'current') expect(painted).toHaveBeenCalledOnce()
    else expect(painted).not.toHaveBeenCalled()
    if (lifetime === 'workspace') {
      for (let n = 0; n < 6; n++) await Promise.resolve()
      await nextTick()
      frames.shift()!(32)
      expect(painted).not.toHaveBeenCalled()
      frames.shift()!(48)
      for (let n = 0; n < 6; n++) await Promise.resolve()
      expect(painted).toHaveBeenCalledOnce()
    }
  },
)
