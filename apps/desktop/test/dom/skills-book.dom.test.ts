import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { page } from 'vitest/browser'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import AgentBook from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

const originalViewport = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(originalViewport.width, originalViewport.height)
})

const inventory = [
  {
    folder: 'remember',
    name: 'remember',
    description: 'Keep tested lessons.',
    builtIn: true,
    enabled: true,
    given: true,
  },
  {
    folder: 'build-a-team',
    name: 'build-a-team',
    description: 'Choose fitting helpers.',
    builtIn: true,
    enabled: true,
    given: false,
  },
  {
    folder: 'recipe-check',
    name: 'recipe-check',
    description: 'Check a fictional recipe.',
    builtIn: false,
    enabled: false,
    given: false,
  },
]
function fixture() {
  const skills = vi.fn(async () => ({ operation: 'profile-list', skills: inventory }))
  const bridge = {
    skills,
    agentRulesUnread: async () => ({ unread: false, seenThrough: 0, newestDirectVersion: 0 }),
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
    agentMemory: async ({ profileId }: { profileId: string }) => ({
      profileId,
      stores: [],
      amendments: [],
      readAt: 1700000000000,
    }),
  } as unknown as RuntimeBridge
  const store = {
    instructionsFor: async () => ({
      own: { identity: 'quill', versions: [] },
      waiting: [],
      readAt: 1700000000000,
    }),
    instruct: async () => null,
  } as unknown as AgentStore
  return { skills, bridge, store }
}

describe('the read-only Skills page in the agent book', () => {
  it('asks only for the visible profile metadata, and distinguishes global off from a profile gate', async () => {
    await page.viewport(1200, 1100)
    const f = fixture()
    const view = mount(
      defineComponent({
        setup: () => () => [
          h(IconSprite),
          h(AgentBook, {
            profileSlug: 'quill',
            agentName: 'Quill',
            bridge: f.bridge,
            store: f.store,
          }),
        ],
      }),
      {},
      { width: 1000, height: 1100 },
    )
    expect(
      view.host.querySelector('[data-cy="agent-book-tab-skills"]'),
      'the book needs a Skills tab',
    ).not.toBeNull()
    expect(f.skills).not.toHaveBeenCalled()
    view.q('agent-book-tab-skills').click()
    await vi.waitFor(() =>
      expect(f.skills).toHaveBeenCalledWith({ operation: 'profile-list', profileId: 'quill' }),
    )
    await vi.waitFor(() =>
      expect(view.q('agent-skills').textContent).toContain('Check a fictional recipe.'),
    )
    const rows = view.all('agent-skill')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('Built-in')
    expect(rows[0]?.textContent).toContain('On')
    expect(rows[1]?.textContent).toContain('Not given to this agent')
    expect(rows[2]?.textContent).toContain('Shared')
    expect(rows[2]?.textContent).toContain('Off')
    expect(rows[1]?.textContent).not.toMatch(/\bOn\b/)
    expect(rows[1]?.textContent).not.toContain('Off')
    expect(rows[2]?.textContent).not.toMatch(/\bOn\b/)
    expect(rows[2]?.textContent).not.toContain('Not given to this agent')
    expect(view.q('agent-skills').textContent).toContain('The skills this agent receives.')
    expect(
      view.q('agent-skills').querySelector('textarea, input, select, [role="switch"]'),
    ).toBeNull()
    await document.fonts.ready
    await page.screenshot({
      element: view.q('agent-sections-sheet'),
      path: '__screenshots__/agent-skills-preview.png',
    })
    view.q('agent-book-tab-memory').click()
    await nextTick()
    expect(f.skills).toHaveBeenCalledTimes(1)
  })

  it('emits a Settings navigation intent and never sends a skill mutation', async () => {
    const f = fixture()
    const openSettings = vi.fn()
    const view = mount(AgentBook, {
      profileSlug: 'quill',
      bridge: f.bridge,
      store: f.store,
      onSettings: openSettings,
    })
    expect(view.host.querySelector('[data-cy="agent-book-tab-skills"]')).not.toBeNull()
    view.q('agent-book-tab-skills').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="agent-skills-settings"]')).not.toBeNull(),
    )
    expect(view.q('agent-skills-settings').textContent).toBe('Change in Settings → Skills')
    view.q('agent-skills-settings').click()
    expect(openSettings).toHaveBeenCalledWith('skills')
    expect(f.skills.mock.calls).toEqual([[{ operation: 'profile-list', profileId: 'quill' }]])
    expect(view.q('agent-skills').querySelectorAll('button')).toHaveLength(1)
  })

  it('does not turn a failed reading into an empty inventory', async () => {
    const f = fixture()
    f.skills.mockRejectedValue(new Error('Fictional unavailable metadata.'))
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-skills"]')).not.toBeNull()
    view.q('agent-book-tab-skills').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="agent-skills-error"]')).not.toBeNull(),
    )
    expect(view.q('agent-skills-error').textContent).toContain(
      'This app could not read the skills.',
    )
    expect(view.host.querySelector('[data-cy="agent-skills-empty"]')).toBeNull()
    expect(view.all('agent-skill')).toHaveLength(0)
  })

  it('ignores a delayed old profile reading after A to B to A navigation', async () => {
    const f = fixture()
    const pending: ((value: { operation: string; skills: typeof inventory }) => void)[] = []
    f.skills.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const profile = ref('quill')
    const wrapper = defineComponent({
      setup: () => () =>
        h(AgentBook, { profileSlug: profile.value, bridge: f.bridge, store: f.store }),
    })
    const view = mount(wrapper, {})
    const open = () => {
      expect(view.host.querySelector('[data-cy="agent-book-tab-skills"]')).not.toBeNull()
      view.q('agent-book-tab-skills').click()
    }
    open()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    profile.value = 'wren'
    await vi.waitFor(() =>
      expect(view.q('agent-book-tab-rules').getAttribute('aria-selected')).toBe('true'),
    )
    open()
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    profile.value = 'quill'
    await vi.waitFor(() =>
      expect(view.q('agent-book-tab-rules').getAttribute('aria-selected')).toBe('true'),
    )
    open()
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2]!({
      operation: 'profile-list',
      skills: [{ ...inventory[0]!, description: 'The current reading.' }],
    })
    await vi.waitFor(() =>
      expect(view.q('agent-skills').textContent).toContain('The current reading.'),
    )
    pending[0]!({
      operation: 'profile-list',
      skills: [{ ...inventory[0]!, description: 'An old A reading.' }],
    })
    pending[1]!({
      operation: 'profile-list',
      skills: [{ ...inventory[0]!, description: 'A different profile reading.' }],
    })
    await new Promise((done) => setTimeout(done, 30))
    expect(view.q('agent-skills').textContent).toContain('The current reading.')
    expect(view.q('agent-skills').textContent).not.toContain('An old A reading.')
    expect(view.q('agent-skills').textContent).not.toContain('A different profile reading.')
  })
})
