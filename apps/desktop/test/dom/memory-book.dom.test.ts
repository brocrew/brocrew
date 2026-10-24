import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { page } from 'vitest/browser'
import MemoryBook from '../../src/renderer/src/components/MemoryBook.vue'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { AgentMemoryReading, MemoryAmendment } from '../../src/shared/agent-memory'
import { mount, unmountAll } from './harness'

const entry = {
  kind: 'profile-memory' as const,
  path: '/managed/quill/note.md',
  text: 'Original note',
  bytes: 13,
  truncated: false,
  amendable: true,
}
const removed: MemoryAmendment = {
  id: 'memory-1',
  seq: 1,
  provider: 'claude',
  entry: entry.path,
  act: 'removed',
  by: { who: 'a-person' },
  textBefore: entry.text,
  textAfter: null,
  at: 1700000000000,
  outcome: 'done',
  actual: { fingerprint: null },
  settlement: { by: { who: 'the-app-itself' }, at: 1700000000001 },
}
const initial = (): AgentMemoryReading => ({
  profileId: 'quill',
  readAt: 1700000000000,
  amendments: [],
  stores: [
    {
      provider: 'claude',
      state: 'read',
      dir: '/managed/quill',
      entries: [{ ...entry }],
      refused: [],
      total: 21,
      nextOffset: 20,
    },
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
function fixture(value = initial()) {
  const reads: unknown[] = []
  const edits: unknown[] = []
  const undos: unknown[] = []
  const checks: unknown[] = []
  let refusal = false
  const bridge = {
    agentMemory: async (input: { profileId: string; offset?: number }) => {
      reads.push(input)
      return input.offset
        ? {
            ...value,
            profileId: input.profileId,
            stores: value.stores.map((store) =>
              store.provider === 'claude'
                ? {
                    ...store,
                    entries: [{ ...entry, path: '/managed/quill/later.md', text: 'Later note' }],
                    nextOffset: null,
                  }
                : { ...store, state: 'no-home' as const },
            ),
          }
        : { ...value, profileId: input.profileId }
    },
    amendAgentMemory: async (input: unknown) => {
      edits.push(input)
      return refusal
        ? { done: false, refused: 'changed-or-unreadable', reading: value }
        : { done: true, amendment: removed, reading: value }
    },
    undoAgentMemory: async (input: unknown) => {
      undos.push(input)
      return { done: true, amendment: removed, reading: value }
    },
    checkInterruptedMemory: async (input: unknown) => {
      checks.push(input)
      return { done: true, reading: { ...value, needsChecking: undefined } }
    },
  } as unknown as Pick<
    RuntimeBridge,
    'agentMemory' | 'amendAgentMemory' | 'undoAgentMemory' | 'checkInterruptedMemory'
  >
  return {
    bridge,
    reads,
    edits,
    undos,
    checks,
    refuse() {
      refusal = true
    },
  }
}
const original = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  vi.restoreAllMocks()
  unmountAll()
  await page.viewport(original.width, original.height)
})
async function open(value = initial()) {
  await page.viewport(1000, 1100)
  const parts = fixture(value)
  const profile = ref('quill')
  const wrapper = defineComponent({
    setup: () => () => h(MemoryBook, { profileSlug: profile.value, bridge: parts.bridge }),
  })
  const view = mount(wrapper, {}, { width: 780, height: 1000 })
  await vi.waitFor(() => expect(view.host.querySelector('[data-cy="memory-text"]')).not.toBeNull())
  return { ...parts, view, profile }
}

describe('memory in the agent book', () => {
  it('keeps same-named notes in separate labelled stores and names the selected provider on an amendment', async () => {
    const reading = initial()
    const codex = reading.stores.find((store) => store.provider === 'codex')!
    const { view, edits } = await open({
      ...reading,
      stores: reading.stores.map((store) =>
        store === codex
          ? {
              ...store,
              state: 'read',
              entries: [
                { ...entry, path: '/managed/quill-codex/note.md', text: 'Codex note', bytes: 10 },
              ],
              total: 1,
            }
          : store,
      ),
    })
    expect(view.q('memory-store-claude').textContent).toContain('Claude')
    expect(view.q('memory-store-claude').textContent).toContain('Original note')
    expect(view.q('memory-store-codex').textContent).toContain('Codex')
    expect(view.q('memory-store-codex').textContent).toContain('Codex note')
    view
      .q('memory-store-codex')
      .querySelector<HTMLButtonElement>('[data-cy="memory-remove"]')!
      .click()
    await vi.waitFor(() => expect(view.q('memory-confirm-before').textContent).toBe('Codex note'))
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(edits).toHaveLength(1))
    expect(edits[0]).toMatchObject({
      profileId: 'quill',
      provider: 'codex',
      entry: '/managed/quill-codex/note.md',
      act: 'removed',
      confirmed: true,
    })
    expect(view.q('memory-store-claude').textContent).toContain('Original note')
  })

  it('confirms a deletion with the hash of the exact displayed text', async () => {
    const { view, edits } = await open()
    expect(view.q('memory-store-claude').querySelector('h4')?.textContent).toBe('Claude')
    expect(view.q('memory-store-codex').querySelector('h4')?.textContent).toBe('Codex')
    expect(view.q('memory-store-claude').querySelector('.note')?.textContent?.trim()).toBe(
      'What this agent has written down',
    )
    view.q('memory-remove').click()
    expect(edits).toEqual([])
    await vi.waitFor(() =>
      expect(view.q('memory-confirm-before').textContent).toBe('Original note'),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(edits).toHaveLength(1))
    expect(edits[0]).toEqual({
      profileId: 'quill',
      provider: 'claude',
      entry: entry.path,
      act: 'removed',
      text: '',
      fingerprint: '77328f09798883317ce2f7988f7f4a1f62e4c3c75da5c2cbfedc56df2776fdde',
      confirmed: true,
    })
  })
  it('shows the old text while a person writes a replacement and asks before saving', async () => {
    const { view, edits } = await open()
    view.q('memory-correct').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-replacement"]')).not.toBeNull(),
    )
    const input = view.q('memory-replacement') as HTMLTextAreaElement
    input.value = 'The person’s replacement'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(edits).toEqual([])
    await vi.waitFor(() =>
      expect((view.q('memory-confirm') as HTMLButtonElement).disabled).toBe(false),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(edits).toHaveLength(1))
    expect(edits[0]).toMatchObject({
      text: 'The person’s replacement',
      fingerprint: '77328f09798883317ce2f7988f7f4a1f62e4c3c75da5c2cbfedc56df2776fdde',
      confirmed: true,
    })
  })
  it('does not send a mutation after the profile changes during hashing', async () => {
    const { view, edits, profile } = await open()
    let release!: (value: ArrayBuffer) => void
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve
        }),
    )
    view.q('memory-remove').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirm"]')).not.toBeNull(),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    profile.value = 'other'
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirmation"]')).toBeNull(),
    )
    release(new ArrayBuffer(32))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(edits).toEqual([])
  })
  it('does not send a mutation after the book closes during hashing', async () => {
    const { view, edits } = await open()
    let release!: (value: ArrayBuffer) => void
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve
        }),
    )
    view.q('memory-remove').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirm"]')).not.toBeNull(),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    view.unmount()
    release(new ArrayBuffer(32))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(edits).toEqual([])
  })
  it('does not infer that the identity disappeared from an unavailable mutation result', async () => {
    const parts = fixture()
    parts.bridge.amendAgentMemory = async () => null
    const view = mount(MemoryBook, { profileSlug: 'quill', bridge: parts.bridge })
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-text"]')).not.toBeNull(),
    )
    view.q('memory-remove').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirm"]')).not.toBeNull(),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-error"]')).not.toBeNull(),
    )
    expect(view.q('memory-error').textContent).not.toContain("isn't here")
    expect(view.q('memory-error').textContent).toBe(
      "BroCrew couldn't confirm the change finished. Look at the entry and its history.",
    )
    expect((view.q('memory-remove') as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not attribute an old app-recorded change to a person', async () => {
    const value = {
      ...initial(),
      amendments: [{ ...removed, by: { who: 'the-app-itself' as const } }],
    }
    const { view } = await open(value)
    const row = view.q('memory-history-row').textContent
    expect(row).toContain('Entry removed')
    expect(row).not.toContain('a person took this entry')
    expect(row).toContain('Done by:')
  })
  it('uses only the saved source id for Undo and identifies app observation', async () => {
    const value = { ...initial(), amendments: [removed] }
    const { view, undos } = await open(value)
    expect(view.q('memory-history').textContent).toContain('The app recorded what it found')
    view.q('memory-undo').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirm"]')).not.toBeNull(),
    )
    expect(undos).toEqual([])
    view.q('memory-confirm').click()
    await vi.waitFor(() =>
      expect(undos).toEqual([{ profileId: 'quill', sourceId: 'memory-1', confirmed: true }]),
    )
  })
  it('checks a pending change without offering ordinary memory writes', async () => {
    const value = {
      ...initial(),
      needsChecking: true as const,
      amendments: [
        { ...removed, outcome: 'pending' as const, actual: undefined, settlement: undefined },
      ],
    }
    const { view, checks } = await open(value)
    expect((view.q('memory-remove') as HTMLButtonElement).disabled).toBe(true)
    expect(view.host.querySelector('[data-cy="memory-undo"]')).toBeNull()
    view.q('memory-check').click()
    await vi.waitFor(() =>
      expect(view.q('memory-confirmation').textContent).toContain("It doesn't restore or remove"),
    )
    expect(checks).toEqual([])
    view.q('memory-confirm').click()
    await vi.waitFor(() => expect(checks).toEqual([{ profileId: 'quill', confirmed: true }]))
  })
  it('keeps the other provider’s page when a later memory page is read', async () => {
    const { view, reads } = await open()
    const before = view.q('memory-store-codex').textContent
    view.q('memory-next-claude').click()
    await vi.waitFor(() =>
      expect(view.q('memory-store-claude').textContent).toContain('Later note'),
    )
    expect(reads.at(-1)).toEqual({ profileId: 'quill', offset: 20, limit: 20 })
    expect(view.q('memory-store-codex').textContent).toBe(before)
  })
  it('shows an external change refusal instead of reporting a deletion', async () => {
    const { view, edits, refuse } = await open()
    refuse()
    view.q('memory-remove').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="memory-confirm"]')).not.toBeNull(),
    )
    view.q('memory-confirm').click()
    await vi.waitFor(() =>
      expect(view.q('memory-error').textContent).toContain("changed or couldn't be read"),
    )
    expect(edits).toHaveLength(1)
    expect(view.q('memory-text').textContent).toBe(entry.text)
  })
  it('keeps truncated entries read-only', async () => {
    const source = initial()
    const value = {
      ...source,
      stores: source.stores.map((store) => ({
        ...store,
        entries: store.entries.map((one) => ({ ...one, truncated: true })),
      })),
    }
    const { view } = await open(value)
    expect(view.host.querySelector('[data-cy="memory-remove"]')).toBeNull()
    expect(view.host.querySelector('[data-cy="memory-correct"]')).toBeNull()
    await page.screenshot({ element: view.host, path: '__screenshots__/memory-book-preview.png' })
  })
})
