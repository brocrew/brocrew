import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import OwnInstructions from '../../src/renderer/src/components/OwnInstructions.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type {
  AgentInstructionsReading,
  OwnInstructionsVersion,
} from '../../src/shared/own-instructions'
import { mount, unmountAll } from './harness'

const originalViewport = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(originalViewport.width, originalViewport.height)
})

const version = (
  number: number,
  text: string,
  fields: Partial<OwnInstructionsVersion> = {},
): OwnInstructionsVersion => ({
  version: number,
  text,
  whoWroteIt: 'a-person',
  by: { who: 'a-person' },
  conversation: null,
  said: null,
  broughtBack: null,
  writtenAt: 1_700_000_000_000 + number,
  ...fields,
})

function parts(direct = false, empty = false) {
  let reading: AgentInstructionsReading = {
    own: {
      identity: 'quill',
      versions: empty
        ? []
        : [
            version(
              2,
              'Current rules',
              direct
                ? {
                    whoWroteIt: 'an-agent-direct',
                    author: { profile: 'planner', name: 'Planner' },
                    said: 'Keep the checklist current.',
                  }
                : {},
            ),
            version(1, 'Previous rules'),
          ],
    },
    waiting: [],
    readAt: 1_700_000_000_002,
  }
  const writes: unknown[][] = []
  const undos: unknown[] = []
  const marks: unknown[] = []
  let writeResult: string | null = null
  let seenThrough = direct ? 1 : 2
  let newestDirectVersion = direct ? 2 : 0
  let changeAfterRead = false
  const store = {
    instructionsFor: async () => {
      const snapshot = reading
      if (changeAfterRead) {
        changeAfterRead = false
        newestDirectVersion = 3
        reading = {
          ...reading,
          own: {
            ...reading.own,
            versions: [version(3, 'Newer direct change'), ...reading.own.versions],
          },
        }
      }
      return snapshot
    },
    instruct: async (...input: unknown[]) => {
      writes.push(input)
      return writeResult
    },
    decideInstruction: async () => null,
  } as unknown as AgentStore
  const bridge = {
    agentRulesUnread: async () => ({
      seenThrough,
      newestDirectVersion,
      unread: newestDirectVersion > seenThrough,
    }),
    undoAgentRules: async (input: unknown) => {
      undos.push(input)
      reading = {
        ...reading,
        own: { ...reading.own, versions: [version(3, 'Previous rules'), ...reading.own.versions] },
      }
      return reading
    },
    markAgentRulesSeen: async (input: { profileId: string; throughVersion: number }) => {
      marks.push(input)
      seenThrough = Math.max(seenThrough, input.throughVersion)
      return true
    },
  }
  return {
    store,
    bridge,
    writes,
    undos,
    marks,
    refuseWrite(next: AgentInstructionsReading) {
      reading = next
      writeResult = 'The rules changed. Review the latest version.'
    },
    changeAfterNextRead() {
      changeAfterRead = true
    },
  }
}

async function open(fixture = parts()) {
  await page.viewport(900, 1000)
  const view = mount(
    OwnInstructions,
    {
      profileSlug: 'quill',
      store: fixture.store,
      bridge: fixture.bridge,
    },
    { width: 780, height: 950 },
  )
  await nextTick()
  await nextTick()
  return { view, ...fixture }
}

async function edit(view: Awaited<ReturnType<typeof open>>['view'], text: string) {
  const input = view.q('own-instructions-text') as HTMLTextAreaElement
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('standing rule changes in the book', () => {
  it('saves against the exact version and text displayed', async () => {
    const { view, writes } = await open()
    await page.screenshot({
      element: view.host,
      path: '__screenshots__/standing-rules-preview.png',
    })
    await edit(view, 'The person’s new rules')
    view.q('own-instructions-save').click()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual([
      'quill',
      'The person’s new rules',
      undefined,
      {
        expectedVersion: 2,
        currentText: 'Current rules',
      },
    ])
  })

  it('sends a version-zero baseline for an agent with no saved rules', async () => {
    const { view, writes } = await open(parts(false, true))
    await edit(view, 'First rules')
    view.q('own-instructions-save').click()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual([
      'quill',
      'First rules',
      undefined,
      {
        expectedVersion: 0,
        currentText: '',
      },
    ])
  })

  it('undoes the latest version by its displayed number', async () => {
    const { view, undos } = await open()
    view.q('own-instructions-undo').click()
    await vi.waitFor(() => expect(undos).toEqual([{ profileId: 'quill', expectedVersion: 2 }]))
    await vi.waitFor(() =>
      expect((view.q('own-instructions-text') as HTMLTextAreaElement).value).toBe('Previous rules'),
    )
  })

  it('asks before taking rules away and keeps their displayed baseline', async () => {
    const { view, writes } = await open()
    view.q('own-instructions-clear').click()
    await nextTick()
    expect(writes).toEqual([])
    expect(view.q('own-instructions-clear-preview').textContent).toContain('Current rules')
    view.q('own-instructions-clear-confirm').click()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual([
      'quill',
      '',
      undefined,
      { expectedVersion: 2, currentText: 'Current rules' },
    ])
  })

  it('shows the before and after before restoring an older version', async () => {
    const { view, writes } = await open()
    view.q('own-instructions-restore-1').click()
    await nextTick()
    expect(writes).toEqual([])
    expect(view.q('own-instructions-restore-preview').textContent).toContain('Current rules')
    expect(view.q('own-instructions-restore-preview').textContent).toContain('Previous rules')
    view.q('own-instructions-restore-confirm').click()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual([
      'quill',
      'Previous rules',
      1,
      { expectedVersion: 2, currentText: 'Current rules' },
    ])
  })

  it('acknowledges only the direct change whose author, reason and diff were opened', async () => {
    const { view, marks } = await open(parts(true))
    expect(marks).toEqual([])
    view.q('own-instructions-change-review').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-change-summary"]')).not.toBeNull(),
    )
    const shown = view.q('own-instructions-change-summary')
    expect(shown.textContent).toContain('Planner changed this')
    expect(shown.textContent).toContain('Keep the checklist current.')
    expect(shown.textContent).toContain('Previous rules')
    expect(shown.textContent).toContain('Current rules')
    await vi.waitFor(() => expect(marks).toEqual([{ profileId: 'quill', throughVersion: 2 }]))
    await page.screenshot({
      element: view.host,
      path: '__screenshots__/standing-rules-change-preview.png',
    })
  })

  it('keeps a newer change unread when an older displayed change is acknowledged', async () => {
    const fixture = parts(true)
    const { view, marks } = await open(fixture)
    fixture.changeAfterNextRead()
    view.q('own-instructions-change-review').click()
    await vi.waitFor(() => expect(marks).toHaveLength(1))
    expect(marks[0]).toEqual({ profileId: 'quill', throughVersion: 2 })
    expect(view.q('own-instructions-unread').textContent).toContain('change')
  })

  it('waits until the end of the change review is visible before acknowledging it', async () => {
    const { view, marks } = await open(parts(true))
    view.host.style.height = '170px'
    view.host.style.overflow = 'auto'
    view.q('own-instructions-change-review').click()
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-instructions-change-end"]')).not.toBeNull(),
    )
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    expect(marks).toEqual([])
    view.q('own-instructions-change-end').scrollIntoView({ block: 'end' })
    await vi.waitFor(() => expect(marks).toEqual([{ profileId: 'quill', throughVersion: 2 }]))
  })

  it('keeps the person’s unsaved draft when the baseline was refused', async () => {
    const fixture = parts()
    const { view } = await open(fixture)
    await edit(view, 'Keep this draft')
    fixture.refuseWrite({
      own: { identity: 'quill', versions: [version(3, 'Newer saved rules')] },
      waiting: [],
      readAt: 1_700_000_000_003,
    })
    view.q('own-instructions-save').click()
    await vi.waitFor(() =>
      expect(view.q('own-instructions-refusal').textContent).toContain('Review'),
    )
    await vi.waitFor(() =>
      expect(view.q('own-instructions-versions').textContent).toContain('Newer saved rules'),
    )
    expect((view.q('own-instructions-text') as HTMLTextAreaElement).value).toBe('Keep this draft')
    expect((view.q('own-instructions-save') as HTMLButtonElement).disabled).toBe(true)
    view.q('own-instructions-reload').click()
    await vi.waitFor(() =>
      expect((view.q('own-instructions-text') as HTMLTextAreaElement).value).toBe(
        'Newer saved rules',
      ),
    )
  })
})
