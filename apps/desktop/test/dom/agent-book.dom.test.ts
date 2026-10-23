import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { page } from 'vitest/browser'
import AgentBookSheet from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import AgentBookButton from '../../src/renderer/src/components/AgentBookButton.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

const original = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(original.width, original.height)
})
function parts(initialUnread = false) {
  let unread = initialUnread
  let notify: ((change: { what: 'agents' }) => void) | undefined
  const stop = vi.fn()
  const bridge = {
    agentRulesUnread: async () => ({ unread, seenThrough: unread ? 1 : 2, newestDirectVersion: 2 }),
    markAgentRulesSeen: async () => true,
    undoAgentRules: async () => null,
    agentMethods: async () => ({
      state: 'missing',
      items: [],
      total: 0,
      offset: 0,
      nextOffset: null,
      indexState: 'absent',
      indexFingerprint: null,
      malformedLines: 0,
      truncated: false,
      readAt: 1700000000000,
    }),
    agentMethodChanges: async () => ({ ok: true, changes: [] }),
    agentMemory: async (input: { profileId: string }) => ({
      profileId: input.profileId,
      stores: [],
      amendments: [],
      readAt: 1700000000000,
    }),
    onChanged: (listener: typeof notify) => {
      notify = listener
      return stop
    },
  } as unknown as RuntimeBridge
  const store = {
    instructionsFor: async () => ({
      own: { identity: 'quill', versions: [] },
      waiting: [],
      readAt: 1700000000000,
    }),
    instruct: async () => null,
  } as unknown as AgentStore
  return {
    bridge,
    store,
    stop,
    seen() {
      unread = false
      notify?.({ what: 'agents' })
    },
  }
}
describe('the shared agent book', () => {
  it('keeps the conversation-rules pointer below Standing rules without adding an action', async () => {
    await page.viewport(1200, 1100)
    const fixture = parts()
    const view = mount(AgentBookSheet, {
      profileSlug: 'quill',
      agentName: 'Quill',
      bridge: fixture.bridge,
      store: fixture.store,
    })
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-text"]')).not.toBeNull(),
    )
    const editor = view.q('own-instructions')
    const rules = editor.closest<HTMLElement>('[role="tabpanel"]')!
    const pointer = Array.from(rules.querySelectorAll('p')).find(
      (paragraph) =>
        paragraph.textContent?.trim() ===
        'Read the rules for a conversation inside that conversation.',
    )
    expect(pointer, 'the profile book lost its conversation-rules pointer').toBeDefined()
    if (pointer === undefined) return
    expect(pointer.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(editor.contains(pointer)).toBe(false)
    expect(editor.compareDocumentPosition(pointer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pointer.querySelector('a, button, [role="button"], [tabindex]')).toBeNull()
    expect(pointer.hasAttribute('tabindex')).toBe(false)
    view.q('agent-book-tab-memory').click()
    await vi.waitFor(() => expect(pointer.getClientRects()).toHaveLength(0))
    view.q('agent-book-tab-rules').click()
    await vi.waitFor(() => expect(pointer.getBoundingClientRect().height).toBeGreaterThan(0))
  })
  it('keeps an unsaved rules draft while moving between independently loaded sections', async () => {
    await page.viewport(1200, 1100)
    const fixture = parts()
    const wrapper = defineComponent({
      setup: () => () => [
        h(IconSprite),
        h(AgentBookSheet, {
          profileSlug: 'quill',
          agentName: 'Quill',
          bridge: fixture.bridge,
          store: fixture.store,
        }),
      ],
    })
    const view = mount(wrapper, {}, { width: 1000, height: 1000 })
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-text"]')).not.toBeNull(),
    )
    const input = view.q('own-instructions-text') as HTMLTextAreaElement
    input.value = 'Keep this unsaved draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    view.q('agent-book-tab-memory').click()
    await vi.waitFor(() =>
      expect(view.q('agent-book-tab-memory').getAttribute('aria-selected')).toBe('true'),
    )
    expect(view.host.querySelector('[data-cy="memory-book"]')).not.toBeNull()
    view.q('agent-book-tab-rules').click()
    await vi.waitFor(() =>
      expect(view.q('agent-book-tab-rules').getAttribute('aria-selected')).toBe('true'),
    )
    expect((view.q('own-instructions-text') as HTMLTextAreaElement).value).toBe(
      'Keep this unsaved draft',
    )
    await page.screenshot({ element: view.host, path: '__screenshots__/agent-book-preview.png' })
  })
  it('shows persisted unread status and refreshes it after an acknowledgement announcement', async () => {
    const fixture = parts(true)
    const opened: string[] = []
    const view = mount(AgentBookButton, {
      profileSlug: 'quill',
      bridge: fixture.bridge,
      onOpen: (profile: string) => opened.push(profile),
    })
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="agent-book-unread"]')).not.toBeNull(),
    )
    view.q('agent-book-button').click()
    expect(opened).toEqual(['quill'])
    fixture.seen()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="agent-book-unread"]')).toBeNull(),
    )
    view.unmount()
    expect(fixture.stop).toHaveBeenCalledOnce()
  })
  it('ignores an old profile’s delayed unread reply', async () => {
    let resolve!: (value: {
      unread: boolean
      seenThrough: number
      newestDirectVersion: number
    }) => void
    const profile = ref('quill')
    const bridge = {
      agentRulesUnread: async (input: { profileId: string }) =>
        input.profileId === 'quill'
          ? new Promise((done) => {
              resolve = done
            })
          : { unread: false, seenThrough: 0, newestDirectVersion: 0 },
    }
    const wrapper = defineComponent({
      setup: () => () =>
        h(AgentBookButton, {
          profileSlug: profile.value,
          bridge: bridge as Pick<RuntimeBridge, 'agentRulesUnread'>,
        }),
    })
    const view = mount(wrapper, {})
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    profile.value = 'other'
    await vi.waitFor(() =>
      expect(view.q('agent-book-button').getAttribute('aria-label')).toBe('Open agent knowledge'),
    )
    resolve({ unread: true, seenThrough: 1, newestDirectVersion: 2 })
    await new Promise((done) => setTimeout(done, 30))
    expect(view.host.querySelector('[data-cy="agent-book-unread"]')).toBeNull()
  })
  it('uses keyboard tab navigation without destroying another section’s state', async () => {
    const fixture = parts()
    const view = mount(AgentBookSheet, {
      profileSlug: 'quill',
      bridge: fixture.bridge,
      store: fixture.store,
    })
    const tab = view.q('agent-book-tab-rules')
    tab.focus()
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await vi.waitFor(() =>
      expect(view.q('agent-book-tab-methods').getAttribute('aria-selected')).toBe('true'),
    )
    expect(document.activeElement).toBe(view.q('agent-book-tab-methods'))
  })
})
