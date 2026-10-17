import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import CardSection from '../../src/renderer/src/components/CardSection.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import type { KeptFile } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * The agent card's Current task and Files sections fold: a chevron where the section's icon was,
 * the heading a button that says whether the content is shown, the All tasks / View all action
 * beside it and separate. Folding hides the content alone. Each section remembers its fold on this
 * computer. No other section folds.
 */

/** This file's own storage: the dom project runs files side by side on one origin. */
const memoryStorage = (): Storage => {
  const kept = new Map<string, string>()
  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  useWhoCalledWhom().cardFiles.value = null
})

const FILE: KeptFile = {
  resourceId: 'res_results',
  title: 'Results',
  name: 'results.md',
  form: 'markdown',
  bytes: 2_048,
  role: 'made',
  keptAt: new Date(2026, 8, 30, 19, 30).getTime(),
  sha256: 'a'.repeat(64),
  addedBy: { conversation: META.sessionId, name: 'Ali', identity: 'ali' },
  piece: 'work_3',
  label: 'W1.3',
  pieceTitle: 'Test the tree after the reset',
}

function card(): Mounted {
  useWhoCalledWhom().cardFiles.value = {
    conversation: META.sessionId,
    files: [FILE],
    answered: true,
  }
  return mount(SessionDrawer as never, drawerProps({ canOpenDocument: true }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
}

const foldOf = (section: HTMLElement): HTMLButtonElement | null =>
  section.querySelector<HTMLButtonElement>('.head > button[aria-expanded]')

describe('Current task and Files fold; nothing else does', () => {
  it('🔴 a chevron and a heading button on the two sections, and none on a section that does not fold', async () => {
    const m = card()
    await nextTick()
    for (const cy of ['card-task', 'card-files']) {
      const section = m.q(cy)
      const fold = foldOf(section)
      expect(fold, `${cy} has no fold`).not.toBeNull()
      expect(fold!.querySelector('use')!.getAttribute('href')).toBe('#i-chevron')
      expect(fold!.getAttribute('aria-expanded')).toBe('true')
      // The button names the content it shows, and that content is this section's.
      const body = document.getElementById(fold!.getAttribute('aria-controls')!)
      expect(body).not.toBeNull()
      expect(section.contains(body)).toBe(true)
    }
    // ⛔ The control: a section given no fold keeps its icon and has no button.
    const plain = mount(
      CardSection,
      { icon: '#i-image', count: 2 },
      { width: DRAWER_W_MIN, height: 120 },
    )
    plain.host.querySelector('section')!.dataset['cy'] = 'plain'
    await nextTick()
    const section = plain.q('plain')
    expect(foldOf(section)).toBeNull()
    expect(section.querySelector('.head use')!.getAttribute('href')).toBe('#i-image')
    // …and in the card, every other section is the same.
    const others = [...m.host.querySelectorAll<HTMLElement>('.card-section')].filter(
      (one) => !['card-task', 'card-files'].includes(one.dataset['cy'] ?? ''),
    )
    for (const one of others) expect(foldOf(one)).toBeNull()
  })

  it('🔴 folding hides the content alone: the heading, its count and View all stay', async () => {
    const m = card()
    await nextTick()
    const files = m.q('card-files')
    const fold = foldOf(files)!
    const headHeight = files.querySelector('.head')!.getBoundingClientRect().height
    expect(m.all('card-file').filter(visible)).toHaveLength(1)

    fold.click()
    await nextTick()
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(m.all('card-file').filter(visible)).toHaveLength(0)
    expect(m.all('card-files-caption').filter(visible)).toHaveLength(0)
    expect(visible(files.querySelector('.title')!)).toBe(true)
    expect(files.querySelector('.count')!.textContent).toBe('(1)')
    expect(visible(m.q('card-files-all'))).toBe(true)
    // ⚑ The heading keeps its height, folded or not.
    expect(files.querySelector('.head')!.getBoundingClientRect().height).toBeCloseTo(headHeight, 1)
    // ⛔ The control: the other section did not fold with it.
    expect(foldOf(m.q('card-task'))!.getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('card-task').querySelector<HTMLElement>('.body > *')!)).toBe(true)
  })

  it('🔴 the keyboard folds it: Tab to the heading, Enter folds, Space unfolds', async () => {
    const m = card()
    await nextTick()
    const fold = foldOf(m.q('card-task'))!
    fold.focus()
    expect(document.activeElement).toBe(fold)
    await userEvent.keyboard('{Enter}')
    await nextTick()
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    await userEvent.keyboard(' ')
    await nextTick()
    expect(fold.getAttribute('aria-expanded')).toBe('true')
  })

  it('⚑ View all stays its own control, outside the heading button', async () => {
    const m = card()
    await nextTick()
    const all = m.q('card-files-all')
    const fold = foldOf(m.q('card-files'))!
    expect(fold.contains(all)).toBe(false)
    all.click()
    await nextTick()
    // ⛔ Pressing it did not fold the section.
    expect(fold.getAttribute('aria-expanded')).toBe('true')
  })

  it('🔴 each fold is remembered across a remount, one key per section', async () => {
    const first = card()
    await nextTick()
    foldOf(first.q('card-files'))!.click()
    await nextTick()
    first.unmount()

    const again = card()
    await nextTick()
    expect(foldOf(again.q('card-files'))!.getAttribute('aria-expanded')).toBe('false')
    // ⛔ The control: the section left open is still open, so the key is the section's own.
    expect(foldOf(again.q('card-task'))!.getAttribute('aria-expanded')).toBe('true')
    expect(storage.getItem('brobot2.cardFilesFolded')).toBe('true')
    expect(storage.getItem('brobot2.cardTaskFolded')).toBeNull()
  })

  it('⚑ a folding section’s heading is as tall as one that does not fold', async () => {
    const m = card()
    await nextTick()
    const plain = mount(
      CardSection,
      { icon: '#i-file', count: 1 },
      { width: DRAWER_W_MIN, height: 120 },
    )
    await nextTick()
    const folding = m.q('card-files').querySelector('.head')!.getBoundingClientRect().height
    const fixed = plain.host.querySelector('.head')!.getBoundingClientRect().height
    expect(folding).toBeCloseTo(fixed, 1)
  })
})
