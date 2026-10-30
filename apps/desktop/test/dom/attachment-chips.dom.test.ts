import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import {
  runtimePathCalls,
  useMessagePaths,
} from '../../src/renderer/src/composables/useMessagePaths'
import { assetUrl } from '../../src/shared/asset-url'
import type { HandedPath, MessagePathTarget } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

const files: HandedPath[] = [
  { path: '/Users/river/project/header.png', kind: 'file', outsideCwd: false },
  { path: '/Users/river/Documents/brief.pdf', kind: 'file', outsideCwd: true },
  { path: 'C:\\Work\\design\\reference', kind: 'directory', outsideCwd: false },
]
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await nextTick()
}

function bubble(attachments = files, failed = false, width = 800) {
  const opened: MessagePathTarget[] = []
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      resolveMessagePaths: async () => [],
      openMessagePath: async (target: MessagePathTarget) => {
        opened.push(target)
        return failed ? { ok: false, reason: 'gone' } : { ok: true, did: 'opened' }
      },
      revealMessagePath: async () => ({ ok: true, path: '/Users/river/project' }),
    },
  }
  const Host = defineComponent({
    setup() {
      const paths = useMessagePaths(() => 'conversation-one', runtimePathCalls)
      return () =>
        h(UserMessage, {
          paths: paths.value,
          item: {
            kind: 'user',
            id: 'user-one',
            ordinal: 1,
            at: 1700000000000,
            text: 'Compare these files.',
            attachments,
          },
        })
    },
  })
  return { view: mount(Host, {}, { width }), opened }
}

it('shows compact filenames with a thumbnail, file and folder glyphs; keeps metadata in tooltips', () => {
  const { view } = bubble()
  expect(view.q('user-message').textContent).toBe('Compare these files.')
  const attached = view.q('user-attachments')
  expect(attached.textContent).toContain('This app attached')
  expect(attached.textContent).toContain('header.png')
  expect(attached.textContent).toContain('brief.pdf')
  expect(attached.textContent).toContain('reference')
  expect(attached.textContent).not.toContain('/Users/')
  expect(attached.textContent).not.toContain('outside this')
  const open = view.all('attachment-open')
  expect(open[1]!.title).toBe(`${files[1]!.path}\nOutside this conversation’s folder`)
  expect(open[0]!.title).toBe(files[0]!.path)
  const img = attached.querySelector('img')!
  expect(img.getAttribute('src')).toBe(assetUrl(files[0]!.path))
  expect(img.getAttribute('loading')).toBe('lazy')
  expect(img.getBoundingClientRect().width).toBeLessThanOrEqual(40)
  expect(open[1]!.querySelector('use')!.getAttribute('href')).toBe('#i-file')
  expect(open[2]!.querySelector('use')!.getAttribute('href')).toBe('#i-folder')
})

it('opens the exact attachment in its conversation and copies its absolute path without opening', async () => {
  const { view, opened } = bubble()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  view.all('attachment-open')[1]!.click()
  await settle()
  expect(opened).toEqual([{ sessionId: 'conversation-one', text: files[1]!.path }])
  view
    .all('attachment-copy')[1]!
    .querySelector('svg')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await settle()
  expect(copy).toHaveBeenCalledExactlyOnceWith(files[1]!.path)
  expect(opened).toHaveLength(1)
  expect(view.all('attachment-copy')[1]!.getAttribute('aria-label')).toBe('Copied')
})

it('falls back to an image glyph when a thumbnail cannot load, without losing Open or Copy', async () => {
  const { view, opened } = bubble()
  view.q('user-attachments').querySelector('img')!.dispatchEvent(new Event('error'))
  await settle()
  expect(view.q('user-attachments').querySelector('img')).toBeNull()
  expect(view.all('attachment-open')[0]!.querySelector('use')!.getAttribute('href')).toBe(
    '#i-image',
  )
  view.all('attachment-open')[0]!.click()
  await settle()
  expect(opened[0]!.text).toBe(files[0]!.path)
  expect(view.all('attachment-copy')).toHaveLength(3)
})

it('reports missing files and clipboard failure beside the attachments', async () => {
  const { view } = bubble(files, true)
  view.all('attachment-open')[1]!.click()
  await settle()
  expect(view.q('attachment-failure').textContent).toContain("isn't there any more")
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard unavailable'))
  view.all('attachment-copy')[0]!.click()
  await settle()
  expect(view.q('attachment-failure').textContent).toContain("didn't copy")
})

it('wraps chips in a narrow column and keeps long names within it', () => {
  const { view } = bubble(
    [...files, { path: `/work/${'long-'.repeat(60)}.pdf`, kind: 'file', outsideCwd: false }],
    false,
    360,
  )
  const list = view.q('user-attachments').getBoundingClientRect()
  for (const chip of view.all('attachment-chip')) {
    expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(list.right + 1)
    expect(chip.getBoundingClientRect().height).toBeLessThanOrEqual(50)
  }
  expect(view.host.scrollWidth).toBeLessThanOrEqual(360)
})

it('does not treat folders or SVG documents as thumbnails', () => {
  const { view } = bubble([
    { path: '/work/folder.png', kind: 'directory', outsideCwd: false },
    { path: '/work/drawing.svg', kind: 'file', outsideCwd: false },
  ])
  expect(view.q('user-attachments').querySelector('img')).toBeNull()
})
