import { describe, expect, it } from 'vitest'
import type { WorkSearchHit, WorkSearchPage } from '../src/shared/work-search'
import { WORK_SEARCH_WORDS, workSearchInWords } from '../src/shared/work-search-words'

const NONE = { brief: [], result: [], attachments: [], working: [] }

function aHit(over: Partial<WorkSearchHit> = {}): WorkSearchHit {
  return {
    kind: 'piece',
    piece: 'fictional-piece',
    label: 'W9.1',
    title: 'Fictional work',
    state: 'working',
    owner: { conversation: 'fictional-owner', name: 'Fictional Owner', profile: 'fictional' },
    giver: null,
    result: null,
    status: null,
    resource_ids: NONE,
    clipped: { title: false, result: false, status: false },
    resources_omitted: 0,
    ...over,
  }
}

function aPage(hits: WorkSearchHit[], over: Partial<WorkSearchPage> = {}): WorkSearchPage {
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

/** The first block of the words: the hit itself, before the page's footer. */
const firstBlock = (page: WorkSearchPage): string => workSearchInWords(page).split('\n\n')[0]!

describe('a work search says each hit in words', () => {
  it('says a hit with its label, title, state and owner on one line', () => {
    expect(firstBlock(aPage([aHit()]))).toBe(
      'W9.1 · Fictional work · being worked on · Fictional Owner',
    )
  })

  it('leaves out a title the hit does not have, and marks a clipped one', () => {
    expect(firstBlock(aPage([aHit({ title: null })]))).toBe(
      'W9.1 · being worked on · Fictional Owner',
    )
    expect(
      firstBlock(aPage([aHit({ clipped: { title: true, result: false, status: false } })])),
    ).toBe('W9.1 · Fictional work (clipped) · being worked on · Fictional Owner')
  })

  it('says a conversation’s own state for a root with no work state, or unknown', () => {
    expect(
      firstBlock(aPage([aHit({ kind: 'root', state: null, conversation_state: 'idle' })])),
    ).toBe('W9.1 · Fictional work · conversation: idle · Fictional Owner')
    expect(firstBlock(aPage([aHit({ kind: 'root', state: null })]))).toBe(
      'W9.1 · Fictional work · conversation: unknown · Fictional Owner',
    )
  })

  it('names the owner by profile when it has no name, and says so when it has neither', () => {
    const owner = { conversation: 'fictional-owner', name: null, profile: 'fictional-profile' }
    expect(firstBlock(aPage([aHit({ owner })]))).toBe(
      'W9.1 · Fictional work · being worked on · fictional-profile',
    )
    expect(firstBlock(aPage([aHit({ owner: { ...owner, profile: null } })]))).toBe(
      'W9.1 · Fictional work · being worked on · an agent this app cannot name',
    )
  })

  it('says a done condition that was never recorded as not recorded', () => {
    expect(firstBlock(aPage([aHit({ definition_of_done: null })])).split('\n')[1]).toBe(
      'Done when: Not recorded',
    )
  })

  it('marks a clipped status and a clipped result, and leaves out a result with no summary', () => {
    const lines = firstBlock(
      aPage([
        aHit({
          status: 'Fictional status',
          result: { outcome: 'done', summary: null },
          clipped: { title: false, result: true, status: true },
        }),
      ]),
    ).split('\n')
    expect(lines.slice(1)).toEqual(['Status: Fictional status (clipped)', 'Result: done (clipped)'])
    expect(
      firstBlock(
        aPage([aHit({ status: 'Fictional status', result: { outcome: 'done', summary: 'Ok.' } })]),
      )
        .split('\n')
        .slice(1),
    ).toEqual(['Status: Fictional status', 'Result: done · Ok.'])
  })

  it('says no matches, then how much was searched and what was left unread', () => {
    expect(
      workSearchInWords(
        aPage([], { searched: 7, rows_unread: 1, complete: false, next_cursor: 'c1' }),
      ).split('\n\n'),
    ).toEqual([
      WORK_SEARCH_WORDS.empty,
      'Searched: 7; rows_unread: 1; ledgers_skipped: 0; complete: false.',
      WORK_SEARCH_WORDS.unread,
      `${WORK_SEARCH_WORDS.older} next_cursor: c1`,
      WORK_SEARCH_WORDS.changing,
    ])
  })
})
