import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { META, mount } from './harness'
import {
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
  sessions,
} from './runtime-screen-fixture'
import { givenAnswer } from './what-this-agent-was-given.fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

const sessionId = 'instructions-session'
const path = '/work/bakery/AGENTS.md'
const composed = 'Keep the launch record intact.'
const diskText = 'The file now has different text.'
const events: TranscriptEvent[] = [
  { type: 'memory_loaded', index: '/work/profile/memory/MEMORY.md', beside: 1 },
  { type: 'user_turn', text: 'Show the instructions for this conversation.' },
  {
    type: 'memory_note',
    notes: [{ path: '/work/profile/memory/note.md', bytes: 4, text: 'Note' }],
  },
]

it.each(['told-index', 'card-open-inputs', 'memory-loaded-open-store', 'memory-note-open-store'])(
  'opens the shared instructions reader through %s',
  async (entry) => {
    const read = vi.fn<RuntimeBridge['readInstructionSource']>(async () => ({
      ok: true,
      name: 'AGENTS.md',
      path,
      text: diskText,
      bytes: diskText.length,
      truncated: false,
    }))
    const reveal = vi.fn<RuntimeBridge['revealPath']>(async () => ({ ok: true, path }))
    Object.assign(window.api.runtime, {
      whatThisAgentWasGiven: async () => givenAnswer({ sessionId }),
      readInstructionSource: read,
      revealPath: reveal,
    })
    runtime.attachOpen.mockResolvedValueOnce([
      {
        ...META,
        sessionId,
        instructions: {
          ...META.instructions,
          composed,
          provider: [{ path, scope: 'project' }],
        },
        handover: 'attached',
        history: {
          entries: events.map((event, ordinal) => ({ ordinal, at: ordinal + 1, event })),
          from: 0,
          hasOlder: false,
          turnAligned: true,
        },
      },
    ])
    expect(await sessions.attachOpen()).toEqual([sessionId])
    const view = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
    await expect.poll(() => view.all('reading-surface').length).toBe(1)
    const transcript = view.q('reading-surface')

    if (entry === 'told-index' || entry === 'card-open-inputs') {
      if (!view.all('session-drawer').length) view.q('toggle-session-panel').click()
      await nextTick()
      view.q(entry === 'told-index' ? 'drawer-tab-info' : 'drawer-tab-open').click()
    } else {
      view.q(entry).click()
    }
    await nextTick()
    const door = view.q(entry === 'card-open-inputs' ? entry : 'told-index')
    door.focus()
    door.click()
    await expect.poll(() => view.all('input-popup').length).toBe(1)
    await expect.poll(() => view.all('input-provider-about').length).toBe(1)
    expect(view.all('agent-sheet')).toHaveLength(0)
    expect(view.q('reading-surface')).toBe(transcript)
    expect(view.q('overlay-host').contains(view.q('input-popup'))).toBe(true)

    const reported = view.q('input-reported-files') as HTMLDetailsElement
    expect(reported.open).toBe(false)
    expect((view.q('input-provider-about') as HTMLDetailsElement).open).toBe(false)
    reported.open = true
    view.q('provider-open').click()
    await expect.poll(() => view.all('provider-read').length).toBe(1)
    expect(read).toHaveBeenCalledWith({ sessionId, index: 0 })
    expect(view.q('provider-read').textContent).toContain('Read from disk now.')
    expect(view.q('provider-read').textContent).toContain(diskText)
    view.q('provider-reveal').click()
    await expect.poll(() => reveal.mock.calls.length).toBe(1)
    expect(reveal).toHaveBeenCalledWith({
      sessionId,
      target: { of: 'instruction-source', index: 0 },
    })

    view.q('input-tab-1').click()
    await nextTick()
    expect(view.q('told-composition').textContent).toContain(composed)

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await expect.poll(() => view.all('input-popup').length).toBe(0)
    expect(document.activeElement).toBe(door)
  },
)
