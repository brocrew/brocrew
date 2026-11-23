import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { createDraftBook, draftKey } from '../../src/renderer/src/lib/drafts'
import type { SendIntent } from '../../src/renderer/src/lib/session-store'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'

afterEach(unmountAll)

async function open() {
  if (import.meta.env.VITE_COMPOSER_CAPTURE) {
    await page.viewport(1400, 900)
    mount(IconSprite, {}, { width: 0, height: 0 })
  }
  const shown = ref(true)
  const launching = ref(false)
  const busy = ref(false)
  const book = createDraftBook()
  const key = draftKey('sess_A')
  book.write(key, 'Please inspect this')
  book.paths.write(key, [{ path: '/fictional/notes.md', kind: 'file', outsideCwd: false }])
  let answer!: (accepted: boolean) => void
  let calls = 0
  let stops = 0
  let finished: Promise<void> | undefined
  const accepted = new Promise<boolean>((resolve) => {
    answer = resolve
  })
  const Host = defineComponent({
    setup() {
      return () =>
        shown.value
          ? h(ConversationPane as Component, {
              ...paneProps({
                record: record([{ type: 'status', state: busy.value ? 'busy' : 'idle' }] as never),
              }),
              launching: launching.value,
              awaitingSend: book.awaitingSend(key),
              onInterrupt: () => {
                stops += 1
                if (launching.value) {
                  launching.value = false
                  answer(false)
                }
              },
              draft: book.read(key),
              handing: book.paths.handing(key),
              'onUpdate:draft': (text: string) => book.write(key, text),
              submit: async (_text: string, intent: SendIntent) => {
                finished = book.send(
                  key,
                  () => {
                    calls += 1
                    return accepted
                  },
                  intent === 'queue',
                )
                await finished
              },
            })
          : null
    },
  })
  const view = mount(Host, {})
  return {
    book,
    key,
    view,
    answer,
    shown,
    busy,
    launching,
    calls: () => calls,
    stops: () => stops,
    settled: () => finished,
  }
}

function pressSendAgain(view: Mounted) {
  const box = view.q('prompt-input') as HTMLTextAreaElement
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }),
  )
}

function expectWaiting(view: Mounted) {
  expect(view.q('composer-hint').textContent?.trim()).toBe('Sending…')
  for (const action of ['send-prompt', 'queue-prompt', 'interrupt-send-prompt']) {
    expect(view.all(action)).toHaveLength(0)
  }
  expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('Please inspect this')
  expect(view.q('attached-file').textContent?.trim()).toBe('notes.md')
}

async function capture(view: Mounted, phase: string) {
  const folder = import.meta.env.VITE_COMPOSER_CAPTURE
  if (folder)
    await page.screenshot({
      element: view.host.querySelector<HTMLElement>('.composer-wrap')!,
      path: `${folder}/composer-${phase}.png`,
    })
}

it('keeps a live Send visible while busy arrives before acknowledgement and after refusal', async () => {
  const { book, key, view, answer, busy, calls, stops, settled } = await open()
  await capture(view, 'idle')
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(1)
  expectWaiting(view)
  expect(view.all('interrupt-session')).toHaveLength(0)
  busy.value = true
  await nextTick()
  expectWaiting(view)
  await capture(view, 'waiting')
  pressSendAgain(view)
  view.q('interrupt-session').click()
  expect(stops()).toBe(1)
  expect(calls()).toBe(1)
  answer(false)
  await settled()
  await nextTick()
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(1)
  expect(view.q('queue-prompt').checkVisibility()).toBe(true)
  expect(view.q('interrupt-send-prompt').checkVisibility()).toBe(true)
})

it.each([true, false])('keeps the deliberate Queue transfer (accepted: %s)', async (accepted) => {
  const { book, key, view, answer, busy, calls, settled } = await open()
  busy.value = true
  await nextTick()
  view.q('queue-prompt').click()
  await nextTick()

  const box = view.q('prompt-input') as HTMLTextAreaElement
  expect(box.value).toBe('')
  expect(view.all('attached-file')).toHaveLength(0)
  expect(view.q('composer-hint').textContent).not.toContain('Sending…')
  expect(book.saved()).toMatchObject([
    { slot: key, text: 'Please inspect this', attached: [{ path: '/fictional/notes.md' }] },
  ])

  box.value = 'My next thought'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(view.q('queue-prompt').checkVisibility()).toBe(true)
  answer(accepted)
  await settled()
  await nextTick()
  expect(calls()).toBe(1)
  expect(box.value).toBe(accepted ? 'My next thought' : 'Please inspect this\n\nMy next thought')
  expect(view.all('attached-file')).toHaveLength(accepted ? 0 : 1)
})

it('clears the accepted draft and its earlier picker refusal', async () => {
  const { book, key, view, answer, busy, settled } = await open()
  book.paths.handing(key).refuse('Earlier picker failure')
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  expect(book.read(key)).toBe('Please inspect this')
  busy.value = true
  await nextTick()
  expectWaiting(view)
  answer(true)
  await settled()
  await nextTick()
  expect(view.q('composer-hint').textContent).not.toContain('Sending…')
  expect(view.q('interrupt-session').checkVisibility()).toBe(true)
  await capture(view, 'accepted')
  expect(book.read(key)).toBe('')
  expect(book.paths.read(key)).toEqual([])
  expect(book.paths.handing(key).refusal).toBeNull()
})

it('keeps the draft when Stop cancels a recorded launch before acknowledgement', async () => {
  const { book, key, view, launching, calls, stops, settled } = await open()
  view.q('send-prompt').click()
  launching.value = true
  await nextTick()
  expectWaiting(view)
  view.q('interrupt-session').click()
  await settled()
  await nextTick()
  expect(calls()).toBe(1)
  expect(stops()).toBe(1)
  expect(book.read(key)).toBe('Please inspect this')
  expect(book.paths.read(key)).toHaveLength(1)
  expect(view.q('send-prompt').checkVisibility()).toBe(true)
  expect(view.q('composer-hint').textContent).not.toContain('Sending…')
})

it('acceptance preserves newer typing and attachments, including after leaving the pane', async () => {
  const { book, key, view, answer, settled } = await open()
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
  const { book, key, view, answer, settled } = await open()
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
  const { book, key, view, answer, settled } = await open()
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
  const { book, key, view, answer, shown, calls, settled } = await open()
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
  const { book, key, view, answer, shown, calls, settled } = await open()
  ;(view.q('send-prompt') as HTMLButtonElement).click()
  await nextTick()
  shown.value = false
  await nextTick()
  shown.value = true
  await nextTick()
  expectWaiting(view)
  pressSendAgain(view)
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
