import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import type { SavedDrafts } from '../../src/shared/saved-drafts'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import { createDraftBook, draftKey } from '../../src/renderer/src/lib/drafts'
import {
  draftsToSave,
  keepDraftsOnDisk,
  restoreDrafts,
} from '../../src/renderer/src/lib/kept-drafts'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)

const TEXT = 'Please inspect the queue'
const FILE = { path: '/fictional/notes.md', kind: 'file' as const, outsideCwd: false }

function openQueue() {
  let hear!: (event: RuntimeEventMessage) => void
  let accept!: () => void
  let refuse!: (error: Error) => void
  const reply = new Promise<void>((resolve, reject) => {
    accept = resolve
    refuse = reject
  })
  const queue = vi.fn(() => reply)
  const store = createSessionStore({
    attachOpen: async () => [],
    onEvent: (listener: Parameters<ClientSessionApi['onEvent']>[0]) => {
      hear = listener
      return () => {}
    },
    onLiveness: () => () => {},
    queueMessage: queue,
  } as unknown as ClientSessionApi)
  hear({ sessionId: 'sess_A', ordinal: 0, at: 1, event: { type: 'status', state: 'working' } })
  const session = store.get('sess_A')!
  Object.assign(session, record([]))
  Object.assign(session, { sessionId: 'sess_A', phase: 'open' })
  hear({ sessionId: 'sess_A', ordinal: 0, at: 1, event: { type: 'status', state: 'working' } })
  const book = createDraftBook()
  const key = draftKey('sess_A')
  book.write(key, TEXT)
  book.paths.write(key, [FILE])
  let finished: Promise<void> | undefined
  const view = mount(
    defineComponent({
      setup: () => () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: session }),
          draft: book.read(key),
          handing: book.paths.handing(key),
          'onUpdate:draft': (text: string) => book.write(key, text),
          submit: (text: string, intent: 'now' | 'queue' | 'interrupt', paths: (typeof FILE)[]) => {
            finished = book.send(
              key,
              () => store.send('sess_A', text, intent, paths),
              intent === 'queue',
            )
            return finished
          },
        }),
    }),
    {},
  )
  return {
    book,
    key,
    view,
    queue,
    accept,
    refuse,
    settled: () => finished,
    queued: () =>
      hear({
        sessionId: 'sess_A',
        ordinal: 1,
        at: 2,
        event: {
          type: 'message_queued',
          messageId: 'q_A',
          kind: 'work',
          text: TEXT,
          attachments: [FILE],
        },
      }),
    stop: () => store.dispose(),
  }
}

for (const gesture of ['button', 'shortcut']) {
  it(`${gesture}: one queued row and an empty composer before the queue reply`, async () => {
    const q = openQueue()
    try {
      const input = q.view.q('prompt-input') as HTMLTextAreaElement
      if (gesture === 'button') q.view.q('queue-prompt').click()
      else
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
        )
      await nextTick()
      q.queued()
      await nextTick()
      expect(q.view.all('queued-entry')).toHaveLength(1)
      expect((q.view.q('prompt-input') as HTMLTextAreaElement).value).toBe('')
      expect(q.view.all('composer-attachments')).toHaveLength(0)
      expect(q.queue).toHaveBeenCalledOnce()
      q.accept()
      await q.settled()
      expect(draftsToSave(q.book).drafts).toEqual([])
    } finally {
      q.accept()
      await q.settled()
      q.stop()
    }
  })
}

it('keeps a crash-restorable snapshot and restores the original on refusal', async () => {
  const q = openQueue()
  const save = vi.fn<(saved: SavedDrafts) => void>()
  const keeper = keepDraftsOnDisk(q.book, save, { closing: () => false })
  try {
    keeper.flush()
    q.view.q('queue-prompt').click()
    await nextTick()
    keeper.flush()
    const saved = save.mock.calls.at(-1)![0]
    expect(saved.drafts).toEqual([{ slot: q.key, text: TEXT, attached: [FILE] }])
    expect(save.mock.calls.every(([packet]) => !packet.cleared?.includes(q.key))).toBe(true)
    const restarted = createDraftBook()
    restoreDrafts(restarted, saved)
    expect(restarted.read(q.key)).toBe(TEXT)
    expect(restarted.paths.read(q.key)).toEqual([FILE])
    q.refuse(new Error('Fictional queue refusal'))
    await q.settled()
    await nextTick()
    expect((q.view.q('prompt-input') as HTMLTextAreaElement).value).toBe(TEXT)
    expect(q.book.paths.read(q.key)).toEqual([FILE])
  } finally {
    keeper.stop()
    q.accept()
    await q.settled()
    q.stop()
  }
})

for (const accepted of [true, false]) {
  it(`keeps newer edits and coalesces another press when accepted=${accepted}`, async () => {
    const q = openQueue()
    try {
      q.view.q('queue-prompt').click()
      await nextTick()
      const input = q.view.q('prompt-input') as HTMLTextAreaElement
      input.value = 'My next thought'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      q.book.paths.handing(q.key).stage([{ ...FILE, path: '/fictional/new.md' }])
      await nextTick()
      q.view.q('queue-prompt').click()
      await nextTick()
      expect(q.queue).toHaveBeenCalledOnce()
      expect(draftsToSave(q.book).drafts[0]!.text).toContain(TEXT)
      expect(draftsToSave(q.book).drafts[0]!.text).toContain('My next thought')
      if (accepted) q.accept()
      else q.refuse(new Error('Fictional refusal with newer edits'))
      await q.settled()
      expect(q.book.read(q.key)).toContain('My next thought')
      expect(q.book.read(q.key).includes(TEXT)).toBe(!accepted)
      expect(q.book.paths.read(q.key).some((path) => path.path === '/fictional/new.md')).toBe(true)
      expect(q.book.paths.read(q.key).some((path) => path.path === FILE.path)).toBe(!accepted)
    } finally {
      q.accept()
      await q.settled()
      q.stop()
    }
  })
}
