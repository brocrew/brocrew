import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import type { ClientComposerApi } from '../../src/shared/client-composer-api'
import type { ChosenAttachment, DroppedPathVerdict } from '../../src/shared/runtime-ipc'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

function screen(composer?: ClientComposerApi) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Injected composer must not reach desktop globals')
    },
  })
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    undefined,
    undefined,
    () => composer,
  )
  const book = createAttachmentBook()
  const identity = ref('first')
  const draft = ref('Inspect this')
  const send = vi.fn()
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () =>
          h(PromptComposer, {
            state: 'idle',
            draft: draft.value,
            cwd: '/fictional',
            canAttach: true,
            handing: book.handing(identity.value),
            onSend: send,
            'onUpdate:draft': (value: string) => {
              draft.value = value
            },
          })
      },
    }),
    {},
  )
  return { view, book, identity, send }
}

function operations(): ClientComposerApi {
  return {
    chooseAttachment: async () => null,
    pathForDroppedFile: () => '',
    handDroppedPaths: async () => [],
    pasteImage: async () => ({ refusal: 'Fictional clipboard is empty' }),
  }
}

function gesture(kind: 'drop' | 'paste', files: File[], text = '') {
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  if (text) transfer.setData('text/plain', text)
  return kind === 'drop'
    ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    : new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
}

it('keeps a delayed picker with its original draft and preserves cancellation and refusal', async () => {
  let finish!: (answer: ChosenAttachment) => void
  const composer = operations()
  composer.chooseAttachment = vi.fn(function (
    this: ClientComposerApi,
    input: { cwd?: string } | undefined,
  ) {
    expect(this).toBe(composer)
    expect(input).toEqual({ cwd: '/fictional' })
    return new Promise<ChosenAttachment>((resolve) => {
      finish = resolve
    })
  })
  const c = screen(composer)
  c.view.q('attach-path').click()
  await nextTick()
  expect(c.view.all('composer-acquiring')).toHaveLength(1)
  c.identity.value = 'second'
  await nextTick()
  finish({ handed: { path: '/fictional/first.txt', kind: 'file', outsideCwd: false } })
  await vi.waitFor(() => expect(c.book.read('first')).toHaveLength(1))
  expect(c.book.read('second')).toEqual([])
  expect(c.view.all('attached-file')).toHaveLength(0)
  c.book.handing('second').refuse('Keep the previous refusal')
  composer.chooseAttachment = async () => null
  c.view.q('attach-path').click()
  await c.book.handing('second').settle()
  await nextTick()
  expect(c.view.all('composer-acquiring')).toHaveLength(0)
  expect(c.book.read('second')).toEqual([])
  expect(c.book.handing('second').refusal).toBe('Keep the previous refusal')
  composer.chooseAttachment = async () => ({ refusal: 'Fictional picker refused' })
  c.view.q('attach-path').click()
  await vi.waitFor(() =>
    expect(c.view.q('composer-notice').textContent).toContain('Fictional picker refused'),
  )
})

it('resolves the original dropped File synchronously and stages the supplied verdict', async () => {
  const composer = operations()
  const file = new File(['fictional'], 'fern.txt')
  let dispatching = true
  composer.pathForDroppedFile = function (each) {
    expect(this).toBe(composer)
    expect(each).toBe(file)
    expect(dispatching).toBe(true)
    return '/fictional/fern.txt'
  }
  composer.handDroppedPaths = vi.fn(async function (
    this: ClientComposerApi,
    input: { paths: string[]; cwd?: string },
  ): Promise<DroppedPathVerdict[]> {
    expect(this).toBe(composer)
    expect(input).toEqual({ paths: ['/fictional/fern.txt'], cwd: '/fictional' })
    return [{ handed: { path: '/fictional/fern.txt', kind: 'file', outsideCwd: false } }]
  })
  const c = screen(composer)
  c.view.q('prompt-input').dispatchEvent(gesture('drop', [file]))
  dispatching = false
  await vi.waitFor(() => expect(c.view.q('attached-file').textContent).toContain('fern.txt'))
  expect(composer.handDroppedPaths).toHaveBeenCalledOnce()
})

it('requests a pathless paste during dispatch, leaves text paste alone, and shows refusal', async () => {
  const composer = operations()
  let dispatching = true
  composer.pasteImage = vi.fn(function (
    this: ClientComposerApi,
    input: { cwd?: string } | undefined,
  ) {
    expect(this).toBe(composer)
    expect(dispatching).toBe(true)
    expect(input).toEqual({ cwd: '/fictional' })
    return Promise.resolve<DroppedPathVerdict>({ refusal: 'Fictional clipboard is empty' })
  })
  const c = screen(composer)
  const file = new File(['fictional'], 'image.png', { type: 'image/png' })
  const text = gesture('paste', [file], 'Words to keep')
  c.view.q('prompt-input').dispatchEvent(text)
  expect(text.defaultPrevented).toBe(false)
  expect(composer.pasteImage).not.toHaveBeenCalled()
  const image = gesture('paste', [file])
  c.view.q('prompt-input').dispatchEvent(image)
  dispatching = false
  expect(image.defaultPrevented).toBe(false)
  await vi.waitFor(() =>
    expect(c.view.q('composer-notice').textContent).toContain('Fictional clipboard is empty'),
  )
  expect(composer.pasteImage).toHaveBeenCalledOnce()
})

it('withholds attachment and voice controls when the supplied capability is absent', async () => {
  const c = screen()
  expect((c.view.q('attach-path') as HTMLButtonElement).disabled).toBe(true)
  expect(c.view.all('voice-mic')).toHaveLength(0)
  const file = new File(['fictional'], 'fern.txt')
  c.view.q('prompt-input').dispatchEvent(gesture('drop', [file]))
  c.view.q('prompt-input').dispatchEvent(gesture('paste', [file]))
  await nextTick()
  expect(c.book.read('first')).toEqual([])
  c.view.q('send-prompt').click()
  await vi.waitFor(() => expect(c.send).toHaveBeenCalledOnce())
})
