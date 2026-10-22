import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import AgentSectionsSheet from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { AgentMemoryReading } from '../../src/shared/agent-memory'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll } from './harness'

const original = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(original.width, original.height)
})
const memory = (): AgentMemoryReading => ({
  profileId: 'quill',
  readAt: 1700000000000,
  amendments: [],
  stores: [
    { provider: 'claude', state: 'no-home', dir: null, entries: [], refused: [] },
    {
      provider: 'codex',
      state: 'nothing-written',
      dir: '/managed/quill-codex',
      entries: [],
      refused: [],
      total: 0,
      nextOffset: null,
    },
  ],
})
function fixture() {
  const bridge = {
    agentInstructions: vi.fn(async () => ({
      own: { identity: 'quill', versions: [] },
      waiting: [],
      readAt: 1700000000000,
    })),
    agentRulesUnread: vi.fn(async () => ({
      unread: false,
      seenThrough: 0,
      newestDirectVersion: 0,
    })),
    markAgentRulesSeen: vi.fn(async () => true),
    agentMethods: vi.fn(async () => ({
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
    })),
    agentMethodChanges: vi.fn(async () => ({ ok: true, changes: [] })),
    agentMemory: vi.fn(async () => memory()),
    whatThisAgentWasGiven: vi.fn(),
  }
  return bridge
}
async function open(bridge = fixture()) {
  await page.viewport(1200, 1000)
  const api = bridge as unknown as RuntimeBridge
  const view = mount(
    AgentSectionsSheet,
    { profileSlug: 'quill', agentName: 'Quill', store: createAgentStore(api), bridge: api },
    { width: 1100, height: 950 },
  )
  return { view, bridge }
}

describe('the agent book from the profile door', () => {
  it('accounts for every book section and reuses the rules editor', async () => {
    const { view } = await open()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-empty"]')).not.toBeNull(),
    )
    const tabs = [...view.host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Standing rules',
      'Saved methods',
      'Memory',
    ])
    for (const tab of tabs) {
      const controlled = tab.getAttribute('aria-controls')
      expect(controlled).toBeTruthy()
      expect(view.host.querySelector(`[id="${controlled}"]`)?.getAttribute('role')).toBe('tabpanel')
    }
    await drawnReady()
    assertDrawn(view.q('own-instructions-text'), 'the reused rules editor')
    expect(view.host.textContent).toContain('Quill')
  })
  it('can read both providers without opening a conversation and distinguishes their empty states', async () => {
    const { view, bridge } = await open()
    view.q('agent-book-tab-memory').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-store-codex"]')).not.toBeNull(),
    )
    expect(view.q('memory-store-claude').textContent).toContain('never run on this provider')
    expect(view.q('memory-store-codex').textContent).toContain('hasn’t written anything down yet')
    expect(bridge.whatThisAgentWasGiven).not.toHaveBeenCalled()
    await drawnReady()
    assertDrawn(view.q('memory-store-claude'), 'the Claude store state')
    assertDrawn(view.q('memory-store-codex'), 'the Codex store state')
  })
  it('shows missing saved methods as a missing folder rather than a blank section', async () => {
    const { view } = await open()
    view.q('agent-book-tab-methods').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="methods-missing"]')).not.toBeNull(),
    )
    expect(view.q('methods-missing').textContent).toContain("hasn't been created yet")
    expect(view.host.querySelector('[data-cy="methods-empty"]')).toBeNull()
  })
  it('keeps saved methods readable when the rules read fails', async () => {
    const parts = fixture()
    parts.agentInstructions.mockRejectedValue(new Error('unreadable'))
    const { view } = await open(parts)
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-unreadable"]')).not.toBeNull(),
    )
    view.q('agent-book-tab-methods').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="methods-missing"]')).not.toBeNull(),
    )
    expect(view.q('methods-missing').textContent).toContain('folder')
  })
  it('keeps rules readable when the memory read fails', async () => {
    const parts = fixture()
    parts.agentMemory.mockRejectedValue(new Error('unreadable'))
    const { view } = await open(parts)
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-empty"]')).not.toBeNull(),
    )
    view.q('agent-book-tab-memory').click()
    await vi.waitFor(() => expect(view.q('memory-error').textContent).toContain("couldn't be read"))
    view.q('agent-book-tab-rules').click()
    expect(view.host.querySelector('[data-cy="own-instructions-text"]')).not.toBeNull()
  })
  it('does not hold another section behind a slow rules read', async () => {
    const parts = fixture()
    let resolve!: (value: Awaited<ReturnType<typeof parts.agentInstructions>>) => void
    parts.agentInstructions.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { view } = await open(parts)
    view.q('agent-book-tab-methods').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="methods-missing"]')).not.toBeNull(),
    )
    expect(view.host.querySelector('[data-cy="own-instructions-empty"]')).toBeNull()
    resolve({ own: { identity: 'quill', versions: [] }, waiting: [], readAt: 1700000000000 })
    view.q('agent-book-tab-rules').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-empty"]')).not.toBeNull(),
    )
  })
})
