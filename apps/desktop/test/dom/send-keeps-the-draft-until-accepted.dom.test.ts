import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createDraftBook, draftKey } from '../../src/renderer/src/lib/drafts'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)

function open() {
  const shown = ref(true)
  const book = createDraftBook()
  const key = draftKey('sess_A')
  book.write(key, 'Please inspect this')
  book.paths.write(key, [{ path: '/fictional/notes.md', kind: 'file', outsideCwd: false }])
  let answer!: (accepted: boolean) => void
  let calls = 0
  let finished: Promise<void> | undefined
  const accepted = new Promise<boolean>((resolve) => {
    answer = resolve
  })
  const Host = defineComponent({
    setup() {
      return () =>
        shown.value
          ? h(ConversationPane as Component, {
              ...paneProps({ record: record([{ type: 'status', state: 'idle' }] as never) }),
              draft: book.read(key),
              handing: book.paths.handing(key),
              'onUpdate:draft': (text: string) => book.write(key, text),
              submit: async () => {
                finished = book.send(key, () => {
                  calls += 1
                  return accepted
                })
                await finished
              },
            })
          : null
    },
  })
  const view = mount(Host, {})
  return { book, key, view, answer, shown, calls: () => calls, settled: () => finished }
}

it('keeps text and attachments during pending validation and after refusal', async () => {
  const { book, key, view, answer, calls, settled } = open()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(1)
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(calls()).toBe(1)
  answer(false)
  await settled()
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(1)
})

it('clears the accepted draft and its earlier picker refusal', async () => {
  const { book, key, view, answer, settled } = open()
  book.paths.handing(key).refuse('Earlier picker failure')
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(book.read(key)).toBe('Please inspect this')
  answer(true)
  await settled()
  expect(book.read(key)).toBe('')
  expect(book.paths.read(key)).toEqual([])
  expect(book.paths.handing(key).refusal).toBeNull()
})

it('acceptance preserves newer typing and attachments, including after leaving the pane', async () => {
  const { book, key, view, answer, settled } = open()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  const box = view.q('prompt-input') as HTMLTextAreaElement
  box.value = 'My next thought'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  book.paths.handing(key).stage([{ path: '/fictional/new.md', kind: 'file', outsideCwd: false }])
  book.paths.handing(key).refuse('New picker failure')
  await nextTick()
  unmountAll()
  answer(true)
  await settled()
  expect(book.read(key)).toBe('My next thought')
  expect(book.paths.read(key).map((path) => path.path)).toEqual(['/fictional/new.md'])
  expect(book.paths.handing(key).refusal).toBe('New picker failure')
})

it('keeps an attachment-only refused draft', async () => {
  const { book, key, view, answer, settled } = open()
  book.write(key, '')
  await nextTick()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(book.paths.read(key)).toHaveLength(1)
  answer(false)
  await settled()
  expect(book.paths.read(key)).toHaveLength(1)
})

it('acceptance clears the original slot after navigation without changing another conversation', async () => {
  const { book, key, view, answer, settled } = open()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  unmountAll()
  book.write(draftKey('sess_B'), 'Another conversation')
  answer(true)
  await settled()
  expect(book.read(key)).toBe('')
  expect(book.paths.read(key)).toEqual([])
  expect(book.read(draftKey('sess_B'))).toBe('Another conversation')
})

it('abandons an attachment wait when the composer is unmounted before submission', async () => {
  const { book, key, view, answer, shown, calls, settled } = open()
  book.write(draftKey('sess_B'), 'B stays here')
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  const acquisition = book.paths.handing(key).acquire(async () => {
    await ready
    return [{ handed: { path: '/fictional/pending.md', kind: 'file', outsideCwd: false } }]
  })
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  shown.value = false
  await nextTick()
  release()
  await acquisition
  // Drain the abandoned composer's queued continuation before attempting a remount.
  await new Promise((resolve) => setTimeout(resolve, 0))
  answer(false)
  await settled()
  expect(calls()).toBe(0)
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(2)
  expect(book.read(draftKey('sess_B'))).toBe('B stays here')
  shown.value = true
  await nextTick()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  await settled()
  expect(calls()).toBe(1)
})

it('returning to the same submitted draft does not submit it twice', async () => {
  const { book, key, view, answer, shown, calls, settled } = open()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  shown.value = false
  await nextTick()
  shown.value = true
  await nextTick()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  answer(false)
  await settled()
  expect(calls()).toBe(1)
  expect(book.read(key)).toBe('Please inspect this')
  // The next user gesture follows the composer's own completion, not just the book's promise.
  await new Promise((resolve) => setTimeout(resolve, 0))
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  await settled()
  expect(calls()).toBe(2)
})
