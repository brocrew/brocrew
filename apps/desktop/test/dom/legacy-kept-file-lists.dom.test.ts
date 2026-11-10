import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import type { WorkSearchResult } from '../../src/shared/work-search'
import { drawnReady } from './drawn'
import { META, mount, unmountAll } from './harness'

// Every negative below is paired with a reading of the same surface.
afterEach(async () => {
  unmountAll()
  await page.viewport(1200, 808)
})

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('legacy kept-file list helpers and work search', () => {
  it('search reads only on a gesture, keeps partial reads visible and opens the existing work', async () => {
    const hit = {
      kind: 'piece' as const,
      piece: 'work_hit',
      label: 'W1.1',
      title: 'Review',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: { outcome: 'done' as const, summary: 'Reviewed.' },
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    const search = vi.fn().mockResolvedValue({
      ok: true,
      page: {
        hits: [hit],
        searched: 2,
        rows_unread: 1,
        ledgers_skipped: 0,
        complete: false,
        next_cursor: 'next',
      },
    })
    const opened = vi.fn()
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: true, onOpenWork: opened },
      { width: 900, height: 700 },
    )
    await drawnReady()
    expect(search).not.toHaveBeenCalled()
    expect(m.all('work-search-empty')).toHaveLength(0)
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(search).toHaveBeenCalledWith({ scope: 'this-conversation', words: '', limit: 20 })
    expect(read(m.q('work-search-unread'))).toBe('Some work could not be read.')
    expect(read(m.q('work-search-older'))).toBe('Older work has not been searched yet.')
    m.q('work-search-more').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search.mock.calls[1]?.[0]).toMatchObject({ cursor: 'next', scope: 'this-conversation' })
    m.all('work-search-hit')[0]!.click()
    expect(opened).toHaveBeenCalledWith(hit)
  })
  it('keeps hits readable without drawing a press when no work opener is available', async () => {
    await page.viewport(400, 700)
    const hit = {
      kind: 'piece' as const,
      piece: 'work_readonly',
      label: 'W1.2',
      title: 'Read-only hit',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: null,
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    const search = vi.fn().mockResolvedValue({
      ok: true,
      page: {
        hits: [hit],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    const opened = vi.fn()
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: false, onOpenWork: opened },
      { width: 380, height: 650 },
    )
    await drawnReady()
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(m.q('work-search-hit').tagName).toBe('DIV')
    expect(read(m.q('work-search-hit'))).toContain('Read-only hit')
    m.q('work-search-hit').click()
    expect(opened).not.toHaveBeenCalled()
    expect(m.q('work-search').scrollWidth).toBeLessThanOrEqual(m.q('work-search').clientWidth)
  })
  it('ignores a search response after the query changes', async () => {
    let answer: ((value: WorkSearchResult) => void) | undefined
    const search = vi.fn(
      () =>
        new Promise<WorkSearchResult>((resolve) => {
          answer = resolve
        }),
    )
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: false },
      { width: 900, height: 700 },
    )
    await drawnReady()
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const input = m.q('work-search-words') as HTMLInputElement
    input.value = 'new words'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    answer!({
      ok: true,
      page: {
        hits: [],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    await nextTick()
    expect(m.all('work-search-empty')).toHaveLength(0)
    expect(m.all('work-search-hits')).toHaveLength(0)
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    const fresh = {
      kind: 'piece' as const,
      piece: 'work_fresh',
      label: 'W1.3',
      title: 'Fresh result',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: null,
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    answer!({
      ok: true,
      page: {
        hits: [fresh],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(m.q('work-search-hit').textContent).toContain('Fresh result')
  })
})
