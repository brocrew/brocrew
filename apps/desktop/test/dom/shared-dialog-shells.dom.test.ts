import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { page } from 'vitest/browser'
import SheetShell from '../../src/renderer/src/components/SheetShell.vue'
import AllFilesDialog from '../../src/renderer/src/components/AllFilesDialog.vue'
import AllTasksDialog from '../../src/renderer/src/components/AllTasksDialog.vue'
import AppNoticeEntry from '../../src/renderer/src/components/AppNoticeEntry.vue'
import ContinuationEntry from '../../src/renderer/src/components/ContinuationEntry.vue'
import { mount, unmountAll } from './harness'

const original = { width: innerWidth, height: innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(original.width, original.height)
})

function element(host: HTMLElement, selector: string): HTMLElement {
  const node = host.querySelector<HTMLElement>(selector)
  expect(node, selector).not.toBeNull()
  return node!
}

describe('Shared dialog and system-entry frames', () => {
  it('files keep accessible search, slotted control styling, pressed state, empty result and one close', async () => {
    const close = vi.fn()
    const m = mount(AllFilesDialog, { files: [], canOpen: true, onClose: close })
    expect(m.q('all-files-dialog').tagName).toBe('SECTION')
    expect(m.q('all-files-dialog').getAttribute('aria-labelledby')).toBe('all-files-title')
    expect(element(m.host, '#all-files-title').textContent).toBe('All files')
    const input = m.q('all-files-search') as HTMLInputElement
    expect(input.closest('label')?.classList.contains('list-search')).toBe(true)
    expect(getComputedStyle(input).flexGrow).toBe('1')
    expect(getComputedStyle(input).borderTopWidth).toBe('0px')
    expect(getComputedStyle(m.q('all-files-filter-image')).display).toBe('flex')
    expect(getComputedStyle(element(m.host, '.list-body')).gridAutoRows).toBe('max-content')
    m.q('all-files-filter-image').click()
    await nextTick()
    expect(m.q('all-files-filter-image').getAttribute('aria-pressed')).toBe('true')
    expect(m.q('all-files-filter-all').getAttribute('aria-pressed')).toBe('false')
    input.value = 'fictional missing file'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(m.q('all-files-count').textContent?.trim()).toBe('0 files')
    expect(m.q('all-files-empty').textContent).toContain('No file matches')
    m.q('close-overlay').click()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('tasks keep accessible search, slotted filters, status count and empty result', async () => {
    const m = mount(AllTasksDialog, { tasks: [], root: null, canOpen: false, state: { items: [] } })
    expect(m.q('all-tasks-dialog').getAttribute('aria-labelledby')).toBe('all-tasks-title')
    expect(element(m.host, '#all-tasks-title').textContent).toBe('All tasks')
    expect(getComputedStyle(m.q('all-tasks-search')).flexGrow).toBe('1')
    expect(getComputedStyle(m.q('all-tasks-filter-active')).display).toBe('flex')
    m.q('all-tasks-filter-active').click()
    await nextTick()
    expect(m.q('all-tasks-filter-active').getAttribute('aria-pressed')).toBe('true')
    expect(m.q('all-tasks-count').getAttribute('role')).toBe('status')
    expect(m.q('all-tasks-count').textContent?.trim()).toBe('0 tasks')
    expect(m.q('all-tasks-empty').textContent).toContain('No task matches')
  })

  it('sheet attrs and keydown reach the section and Close emits once', () => {
    const close = vi.fn()
    const key = vi.fn()
    const click = vi.fn()
    const Consumer = defineComponent({
      setup: () => () =>
        h(
          SheetShell,
          {
            glyph: 'F',
            id: 'fictional-sheet',
            class: 'fictional-consumer',
            'data-cy': 'probe-sheet',
            onClose: close,
            onKeydown: key,
            onClick: click,
          },
          {
            header: () => [h('strong', 'Fictional title'), h('small', 'Fictional subtitle')],
            body: () => h('input', { 'data-cy': 'probe-input' }),
            actions: () => h('button', { type: 'button' }, 'Save'),
          },
        ),
    })
    const m = mount(Consumer, {})
    const root = m.q('probe-sheet')
    expect(root.tagName).toBe('SECTION')
    expect(root.id).toBe('fictional-sheet')
    expect(root.classList.contains('fictional-consumer')).toBe(true)
    expect(getComputedStyle(element(m.host, '.sheet-header-copy strong')).display).toBe('block')
    m.q('probe-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    )
    expect(key).toHaveBeenCalledTimes(1)
    m.q('close-overlay').click()
    expect(close).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('absent slots leave no body or action frame, then appear and disappear together', async () => {
    const visible = ref(false)
    const Consumer = defineComponent({
      setup: () => () =>
        h(
          SheetShell,
          { glyph: 'F' },
          {
            header: () => h('strong', 'Fictional title'),
            state: () => (visible.value ? null : h('p', { 'data-cy': 'loading' }, 'Reading')),
            ...(visible.value
              ? { body: () => h('input'), actions: () => h('button', 'Save') }
              : {}),
          },
        ),
    })
    const m = mount(Consumer, {})
    expect(m.host.querySelector('.sheet-body')).toBeNull()
    expect(m.host.querySelector('.sheet-actions')).toBeNull()
    visible.value = true
    await nextTick()
    expect(m.host.querySelector('.sheet-body input')).not.toBeNull()
    expect(m.host.querySelector('.sheet-actions button')).not.toBeNull()
    visible.value = false
    await nextTick()
    expect(m.host.querySelector('.sheet-body')).toBeNull()
    expect(m.host.querySelector('.sheet-actions')).toBeNull()
  })

  it.each([560, 620, 660])(
    'width %s and short-window scroll keep actions visible',
    async (width) => {
      await page.viewport(900, 500)
      const Consumer = defineComponent({
        setup: () => () =>
          h(
            SheetShell,
            {
              glyph: 'F',
              style: `--sheet-width: ${width}px`,
            },
            {
              header: () => h('strong', 'Fictional title'),
              body: () => h('div', { style: 'height:1400px; flex:none' }, 'Long fictional body'),
              actions: () => h('button', { 'data-cy': 'save', type: 'button' }, 'Save'),
            },
          ),
      })
      const m = mount(Consumer, {})
      m.host.style.alignItems = 'flex-start'
      await nextTick()
      const root = element(m.host, '.sheet-shell')
      const body = element(m.host, '.sheet-body')
      expect(Math.round(root.getBoundingClientRect().width)).toBe(width)
      expect(root.getBoundingClientRect().height).toBeLessThanOrEqual(440.1)
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
      expect(getComputedStyle(body).overflowY).toBe('auto')
      expect(m.q('save').getBoundingClientRect().bottom).toBeLessThanOrEqual(
        root.getBoundingClientRect().bottom,
      )
      body.scrollTop = body.scrollHeight
      expect(body.scrollTop).toBeGreaterThan(0)
    },
  )

  it.each([
    ['notice', AppNoticeEntry, 'app-notice', 'reporting what happened', false],
    ['continuation', ContinuationEntry, 'continuation', 'sent for you', true],
  ] as const)(
    '%s keeps frame styling and its own attribution outside the words',
    async (_name, component, cy, mark, hasWhy) => {
      const text = 'Fictional message.\nA second line.'
      const m = mount(component, {
        item: {
          id: 'fictional',
          kind: cy === 'continuation' ? 'continuation' : 'appNotice',
          notice: 'unknown-historical-notice',
          text,
          at: 1800000,
        },
      })
      expect(m.q(cy).tagName).toBe('ARTICLE')
      expect(getComputedStyle(element(m.host, '.msg-avatar')).borderTopStyle).toBe('dashed')
      expect(getComputedStyle(element(m.host, '.msg-meta strong')).fontWeight).not.toBe('400')
      expect(m.q(`${cy}-mark`).textContent).toBe(mark)
      const body = m.q(`${cy}-message`)
      expect(body.textContent?.trim()).toBe(text)
      expect(getComputedStyle(body).whiteSpace).toBe('pre-wrap')
      expect(body.contains(element(m.host, '.time'))).toBe(false)
      expect(m.all(`${cy}-why`).length).toBe(hasWhy ? 1 : 0)
      m.q('model-got-switch').click()
      await nextTick()
      expect(m.q('what-the-model-got')).toBeDefined()
      expect(body.textContent?.trim()).toBe(text)
      expect(body.contains(m.q('what-the-model-got'))).toBe(false)
    },
  )
})
