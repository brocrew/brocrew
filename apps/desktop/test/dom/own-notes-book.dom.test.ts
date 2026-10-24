import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AgentBook from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import AgentBookButton from '../../src/renderer/src/components/AgentBookButton.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { OwnNotesVersion } from '../../src/shared/own-notes'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

function agentVersion(version = 2, text = 'Keep the agreed scope.'): OwnNotesVersion {
  return {
    version,
    text,
    by: { who: 'an-agent', agent: 'writer-session' },
    author: { profile: 'quill', name: 'Quill' },
    reason: 'The person asked me to retain this convention.',
    restoredFromVersion: null,
    writtenAt: 1700000000000 + version,
  }
}

function fixture() {
  let versions: OwnNotesVersion[] = [agentVersion()]
  const changes = new Set<(change: { what: 'agents' }) => void>()
  const agentOwnNotes = vi.fn(async ({ profileId }: { profileId: string }) => ({
    profile: profileId,
    versions,
  }))
  const markOwnNotesSeen = vi.fn(async () => true)
  const markAgentRulesSeen = vi.fn(async () => true)
  const saveOwnNotes = vi.fn<RuntimeBridge['saveOwnNotes']>().mockResolvedValue(null)
  const undoOwnNotes = vi.fn<RuntimeBridge['undoOwnNotes']>().mockResolvedValue(null)
  const bridge = {
    agentOwnNotes,
    markOwnNotesSeen,
    saveOwnNotes,
    undoOwnNotes,
    markAgentRulesSeen,
    agentOwnNotesUnread: async () => ({
      unread: true,
      seenThrough: 0,
      newestAgentVersion: versions[0]?.version ?? 0,
    }),
    agentRulesUnread: async () => ({ unread: false, seenThrough: 0, newestDirectVersion: 0 }),
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
    onChanged: (listener: (change: { what: 'agents' }) => void) => {
      changes.add(listener)
      return () => changes.delete(listener)
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
    agentOwnNotes,
    markOwnNotesSeen,
    markAgentRulesSeen,
    saveOwnNotes,
    undoOwnNotes,
    publish(next: OwnNotesVersion[]) {
      versions = next
      for (const listener of changes) listener({ what: 'agents' })
    },
  }
}

async function input(element: HTMLElement, value: string) {
  ;(element as HTMLTextAreaElement).value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('Own notes in the agent book', () => {
  it('reads and acknowledges notes only when their tab is visible, independently of rules', async () => {
    const f = fixture()
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(
      view.host.querySelector('[data-cy="agent-book-tab-notes"]'),
      'the book needs an Own notes tab',
    ).not.toBeNull()
    expect(f.agentOwnNotes).not.toHaveBeenCalled()
    expect(f.markOwnNotesSeen).not.toHaveBeenCalled()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() => expect(view.q('own-notes-text')).toBeDefined())
    await vi.waitFor(() =>
      expect(f.markOwnNotesSeen).toHaveBeenCalledWith({ profileId: 'quill', throughVersion: 2 }),
    )
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Keep the agreed scope.')
    expect(view.q('own-notes').textContent).toContain(
      'Notes this agent keeps for itself. It reads them at every start, after its standing rules.',
    )
    expect(view.q('own-notes').textContent).toContain('Quill')
    expect(view.q('own-notes').textContent).toContain(
      'The person asked me to retain this convention.',
    )
    expect(f.markAgentRulesSeen).not.toHaveBeenCalled()
    view.q('agent-book-tab-memory').click()
    f.markOwnNotesSeen.mockClear()
    f.publish([agentVersion(3, 'New hidden notes.')])
    await new Promise((done) => setTimeout(done, 30))
    expect(f.markOwnNotesSeen).not.toHaveBeenCalled()
  })

  it('preserves an unsaved draft across tab changes and sends its exact baseline and reason', async () => {
    const f = fixture()
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-text"]')).not.toBeNull(),
    )
    await input(view.q('own-notes-text'), '  Keep this exact new wish.\n')
    await input(view.q('own-notes-why'), 'Correct the standing convention.')
    view.q('agent-book-tab-memory').click()
    await nextTick()
    view.q('agent-book-tab-notes').click()
    await nextTick()
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe(
      '  Keep this exact new wish.\n',
    )
    view.q('own-notes-save').click()
    await vi.waitFor(() =>
      expect(f.saveOwnNotes).toHaveBeenCalledWith({
        profileId: 'quill',
        text: '  Keep this exact new wish.\n',
        why: 'Correct the standing convention.',
        expectedVersion: 2,
        currentText: 'Keep the agreed scope.',
      }),
    )
    expect(f.undoOwnNotes).not.toHaveBeenCalled()
  })

  it('keeps a dirty old draft and leaves a newer agent version unread', async () => {
    const f = fixture()
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() => expect(f.markOwnNotesSeen).toHaveBeenCalled())
    await input(view.q('own-notes-text'), 'My unfinished edit.')
    f.markOwnNotesSeen.mockClear()
    f.publish([agentVersion(3, 'Arrived elsewhere.'), agentVersion()])
    await new Promise((done) => setTimeout(done, 30))
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('My unfinished edit.')
    expect(f.markOwnNotesSeen.mock.calls).not.toContainEqual([
      { profileId: 'quill', throughVersion: 3 },
    ])
  })

  it('counts code points, accepts 4000 emoji, and refuses an over-limit save in the window', async () => {
    const f = fixture()
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-text"]')).not.toBeNull(),
    )
    await input(view.q('own-notes-why'), 'Keep the full page.')
    await input(view.q('own-notes-text'), '😀'.repeat(4000))
    expect(view.q('own-notes').textContent).toContain('4,000 of 4,000 characters')
    expect((view.q('own-notes-save') as HTMLButtonElement).disabled).toBe(false)
    await input(view.q('own-notes-text'), '😀'.repeat(4001))
    expect((view.q('own-notes-save') as HTMLButtonElement).disabled).toBe(true)
    expect(f.saveOwnNotes).not.toHaveBeenCalled()
  })

  it('asks Undo against the visible latest version without sending a replacement or actor', async () => {
    const f = fixture()
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-undo"]')).not.toBeNull(),
    )
    view.q('own-notes-undo').click()
    await vi.waitFor(() =>
      expect(f.undoOwnNotes).toHaveBeenCalledWith({ profileId: 'quill', expectedVersion: 2 }),
    )
    expect(f.saveOwnNotes).not.toHaveBeenCalled()
  })

  it('shows notes unread even when standing rules have no unread changes', async () => {
    const f = fixture()
    const view = mount(AgentBookButton, { profileSlug: 'quill', bridge: f.bridge })
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="agent-book-unread"]')).not.toBeNull(),
    )
    expect(f.markOwnNotesSeen).not.toHaveBeenCalled()
    expect(f.markAgentRulesSeen).not.toHaveBeenCalled()
  })

  it('shows a successful person edit as You and keeps the earlier agent attribution and reasons', async () => {
    const f = fixture()
    const edited: OwnNotesVersion = {
      ...agentVersion(3, 'The corrected standing wish.'),
      by: { who: 'a-person' },
      author: null,
      reason: 'A person corrected this wish.',
    }
    f.saveOwnNotes.mockImplementation(async () => {
      f.publish([edited, agentVersion()])
      return { profile: 'quill', versions: [edited, agentVersion()] }
    })
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-text"]')).not.toBeNull(),
    )
    await input(view.q('own-notes-text'), edited.text)
    await input(view.q('own-notes-why'), edited.reason)
    view.q('own-notes-save').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-version-3"]')).not.toBeNull(),
    )
    const latest = view.q('own-notes-version-3')
    expect(latest.textContent).toContain('You')
    expect(latest.textContent).toContain(edited.reason)
    expect(latest.textContent).toContain(edited.text)
    expect(latest.textContent).not.toContain('Quill')
    expect(view.q('own-notes-version-2').textContent).toContain('Quill')
    expect(view.q('own-notes-version-2').textContent).toContain(agentVersion().reason)
    expect(f.markAgentRulesSeen).not.toHaveBeenCalled()
  })

  it('leaves notes unread when reading fails and does not present that failure as an empty page', async () => {
    const f = fixture()
    f.agentOwnNotes.mockRejectedValue(new Error('Fictional interrupted reading.'))
    const view = mount(AgentBook, { profileSlug: 'quill', bridge: f.bridge, store: f.store })
    expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
    view.q('agent-book-tab-notes').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-unreadable"]')).not.toBeNull(),
    )
    expect(view.q('own-notes-unreadable').textContent).toContain(
      'This app could not read these notes. Close and open this again.',
    )
    expect(view.host.querySelector('[data-cy="own-notes-empty"]')).toBeNull()
    expect(f.markOwnNotesSeen).not.toHaveBeenCalled()
    expect(f.saveOwnNotes).not.toHaveBeenCalled()
  })

  it('ignores an old profile read, including an A to B to A response race', async () => {
    const f = fixture()
    const pending: ((value: { profile: string; versions: OwnNotesVersion[] }) => void)[] = []
    f.agentOwnNotes.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const profile = ref('quill')
    const wrapper = defineComponent({
      setup: () => () =>
        h(AgentBook, { profileSlug: profile.value, bridge: f.bridge, store: f.store }),
    })
    const view = mount(wrapper, {})
    const open = () => {
      expect(view.host.querySelector('[data-cy="agent-book-tab-notes"]')).not.toBeNull()
      view.q('agent-book-tab-notes').click()
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
    pending[2]!({ profile: 'quill', versions: [agentVersion(3, 'Current reply.')] })
    await vi.waitFor(() =>
      expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Current reply.'),
    )
    pending[0]!({ profile: 'quill', versions: [agentVersion(2, 'Old same-profile reply.')] })
    pending[1]!({ profile: 'wren', versions: [agentVersion(4, 'Other profile reply.')] })
    await new Promise((done) => setTimeout(done, 30))
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Current reply.')
    expect(f.markOwnNotesSeen.mock.calls).not.toContainEqual([
      { profileId: 'quill', throughVersion: 2 },
    ])
  })
})
