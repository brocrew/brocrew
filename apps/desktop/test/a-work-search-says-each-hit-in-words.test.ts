import { describe, expect, it } from 'vitest'
import type {
  ConversationSearchHit,
  WorkSearchHit,
  WorkSearchPage,
} from '../src/shared/work-search'
import { WORK_SEARCH_WORDS, workSearchInWords } from '../src/shared/work-search-words'
import { workSearchPalettePage } from '../src/renderer/src/lib/work-search-palette'

function aTask(over: Partial<WorkSearchHit> = {}): WorkSearchHit {
  return {
    kind: 'piece',
    piece: 'fictional-piece',
    label: 'W9.1',
    title: 'Fictional work',
    given_at: 1,
    state: 'working',
    owner: { conversation: 'fictional-owner', name: 'Fictional Owner', profile: 'fictional' },
    giver: null,
    result: null,
    status: null,
    resource_ids: { brief: [], result: [], attachments: [], working: [] },
    clipped: { title: false, result: false, status: false },
    resources_omitted: 0,
    ...over,
  }
}

function aRow(over: Partial<ConversationSearchHit> = {}): ConversationSearchHit {
  return {
    conversation: 'fictional-owner',
    address: 'W9.1',
    title: 'Fictional job',
    line: 'conversation W9.1 · Fictional job',
    profile: 'fictional',
    last_active_at: 1,
    status: 'Current status',
    matched_tasks: [aTask()],
    tasks_omitted: 0,
    ...over,
  }
}

function aPage(hits: ConversationSearchHit[], over: Partial<WorkSearchPage> = {}): WorkSearchPage {
  return {
    hits,
    searched: hits.length,
    rows_unread: 0,
    ledgers_skipped: 0,
    complete: true,
    next_cursor: null,
    ...over,
  }
}

describe('one work search result serves the conversation tool and task palette', () => {
  it('names a conversation once and lists its matched tasks', () => {
    const page = aPage([
      aRow({
        matched_tasks: [
          aTask({ state: 'answered', result: { outcome: 'done', summary: 'Completed task' } }),
          aTask({ piece: 'fictional-newer', label: 'W9.2', title: 'Newer work', given_at: 2 }),
        ],
      }),
    ])
    expect(workSearchInWords(page).split('\n\n')[0]?.split('\n')).toEqual([
      'conversation W9.1 · Fictional job · fictional · last active 1970-01-01T00:00:00.001Z',
      'Status: Current status',
      'Task W9.1 · Fictional work',
      'Task W9.2 · Newer work',
    ])
    const palette = workSearchPalettePage(page)
    expect(palette.hits.map((task) => task.label)).toEqual(['W9.2', 'W9.1'])
    expect(palette.hits[1]).toMatchObject({
      state: 'answered',
      result: { outcome: 'done', summary: 'Completed task' },
    })
  })

  it('keeps the conversation on the tool’s page when its title matched on its own', () => {
    const page = aPage([aRow({ matched_tasks: [] })])
    expect(workSearchInWords(page)).toContain('conversation W9.1 · Fictional job')
    expect(workSearchPalettePage(page).hits).toEqual([])
  })

  it('points to transcript search after zero or one work match', () => {
    const hint = 'To search what was said in conversations, use search_past_work.'
    expect(workSearchInWords(aPage([]))).toContain(hint)
    expect(workSearchInWords(aPage([aRow()]))).toContain(hint)
    const two = aPage([aRow(), aRow({ conversation: 'fictional-second' })])
    expect(workSearchInWords(two)).not.toContain(hint)
  })

  it('carries search continuation and unread facts through the palette unchanged', () => {
    const page = aPage([], { searched: 7, rows_unread: 1, complete: false, next_cursor: 'c1' })
    expect(workSearchInWords(page)).toContain(WORK_SEARCH_WORDS.empty)
    expect(workSearchInWords(page)).toContain('rows_unread: 1')
    expect(workSearchInWords(page)).toContain('next_cursor: c1')
    expect(workSearchPalettePage(page)).toEqual(page)
  })

  it('keeps accumulated task hits in given order when a later conversation page has newer tasks', () => {
    const older = aTask({ given_at: 2 })
    const oldest = aTask({ piece: 'fictional-oldest', given_at: 1 })
    const newer = aTask({ piece: 'fictional-newer', given_at: 3 })
    const first = workSearchPalettePage(
      aPage([aRow({ last_active_at: 30, matched_tasks: [oldest, older] })], {
        complete: false,
        next_cursor: 'another-page',
      }),
    )
    const next = aPage([
      aRow({ conversation: 'fictional-next', last_active_at: 5, matched_tasks: [newer] }),
    ])
    expect(workSearchPalettePage(next, first).hits).toEqual([newer, older, oldest])
  })
})
