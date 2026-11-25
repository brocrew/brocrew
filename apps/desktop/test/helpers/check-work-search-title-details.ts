import { expect } from 'vitest'
import { archivedConversationsIn } from '../../src/main/archived-file'
import type { openDatabase } from '../../src/main/db/connection'
import type { createSessionStore } from '../../src/main/db/session-store'
import { WorkSearchEngine } from '../../src/main/db/work-search-engine'
import { workSearchInWords } from '../../src/shared/work-search-words'
import { WORK_SEARCH_BOUNDS, type WorkSearchResult } from '../../src/shared/work-search'

export function checkWorkSearchTitleDetails(
  db: ReturnType<typeof openDatabase>,
  file: string,
  store: ReturnType<typeof createSessionStore>,
): void {
  const caller = 'fictional_0'
  const owner = 'fictional_14'
  const newer = 'fictional_15'
  const parent = store.rootOf(caller)!
  const number = store.numberUnder(parent.piece)
  const given = {
    type: 'work_given' as const,
    piece: 'work_meter_title',
    label: `${parent.label}.${String(number)}`,
    parent: parent.piece,
    givenBy: caller,
    title: 'Obsolete measurement title',
    brief: 'Record the reading.',
  }
  const at = Date.parse('2030-01-01')
  store.recordGive(
    { ...given, number, owner, folder: null, inputs: [] },
    store.nextOrdinal(owner),
    given,
    at,
  )
  store.append(
    owner,
    store.nextOrdinal(owner),
    {
      type: 'work_retitled',
      piece: given.piece,
      title: 'Archived meter protocol index',
      by: owner,
    },
    at + 1,
  )
  store.titleConversation(
    newer,
    store.nextOrdinal(newer),
    { type: 'titled', title: 'Meter protocol index release', author: { kind: 'person' } },
    at + 2,
  )
  const newerRoot = store.rootOf(newer)!
  store.append(
    newer,
    store.nextOrdinal(newer),
    { type: 'work_status_set', piece: newerRoot.piece, line: 'Waiting to measure', by: newer },
    at + 2,
  )
  store.append(
    newer,
    store.nextOrdinal(newer),
    { type: 'work_status_set', piece: newerRoot.piece, line: 'Ready to compare', by: newer },
    at + 3,
  )
  archivedConversationsIn(db).add([owner], at + 4)

  let clock = at
  let cutInsideDetails = false
  let detailClockChecks = 0
  const engine = new WorkSearchEngine(file, () =>
    cutInsideDetails && ++detailClockChecks >= 3 ? at + WORK_SEARCH_BOUNDS.workerMs : clock,
  )
  try {
    const titlesOnly = engine.read(
      caller,
      { words: 'archived meter protocol index', includeConversationMetadata: true },
      (progress) => {
        if (progress.ok && progress.page.hits.length > 0) clock += WORK_SEARCH_BOUNDS.pageMs + 1
      },
    )
    expect(titlesOnly).toMatchObject({
      ok: true,
      page: {
        hits: [
          {
            conversation: owner,
            matched_tasks: [{ label: given.label }],
            metadata: { provider: 'codex', archived_at: at + 4, title_author: null },
          },
        ],
        complete: false,
        title_details_unread: 1,
      },
    })
    clock = at
    const stale = engine.read(caller, { words: given.title }, (progress) => {
      if (progress.ok && progress.page.searched > 0) clock += WORK_SEARCH_BOUNDS.pageMs + 1
    })
    expect(stale).toMatchObject({ ok: true, page: { hits: [] } })
    clock = at
    const query = { words: 'meter protocol index', limit: 2 }
    const replaceGiven = db.prepare(
      "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'work_given'",
    )
    replaceGiven.run(
      JSON.stringify({ ...given, brief: 'x'.repeat(WORK_SEARCH_BOUNDS.cellBytes) }),
      owner,
    )
    try {
      const head = engine.read(caller, query)
      expect(head).toMatchObject({
        ok: true,
        page: {
          title_details_pending: true,
          title_details_unread: 2,
          ledgers_skipped: 0,
          hits: [
            { conversation: newer, status: 'Ready to compare' },
            { conversation: owner, status: null, matched_tasks: [{ label: given.label }] },
          ],
        },
      })
      if (!head.ok || head.page.next_cursor === null) throw new Error('expected title details')
      expect(workSearchInWords(head.page)).toContain('Continue for title details.')
      expect(workSearchInWords(head.page)).not.toContain('Use list_tasks.')
      const details = engine.read(
        caller,
        { ...query, cursor: head.page.next_cursor },
        (progress) => {
          if (progress.ok && progress.page.hits.length > 0) cutInsideDetails = true
        },
      )
      expect(detailClockChecks).toBeGreaterThanOrEqual(3)
      expect(details).toMatchObject({
        ok: true,
        page: {
          title_details_pending: true,
          hits: [{ conversation: newer, status: 'Ready to compare' }],
        },
      })
      if (!details.ok || details.page.next_cursor === null)
        throw new Error('expected the remaining title details')
      cutInsideDetails = false
      const pending = engine.read(caller, { ...query, cursor: details.page.next_cursor })
      expect(pending).toMatchObject({
        ok: true,
        page: {
          complete: false,
          candidates_too_large: 1,
          title_details_unread: 1,
          hits: [
            {
              conversation: owner,
              matched_tasks: [{ label: given.label, title: 'Archived meter protocol index' }],
            },
          ],
        },
      })
      if (!pending.ok || pending.page.next_cursor === null) throw new Error('expected more work')
      expect(workSearchInWords(pending.page)).toContain('1 conversation was too large to search.')
      expect(workSearchInWords(pending.page)).toContain('Use list_tasks.')
      const rest = engine.read(
        caller,
        { ...query, cursor: pending.page.next_cursor },
        (progress) => {
          if (progress.ok && progress.page.searched > 0) clock += WORK_SEARCH_BOUNDS.pageMs + 1
        },
      )
      expect(rest).toMatchObject({ ok: true, page: { hits: [] } })
    } finally {
      replaceGiven.run(JSON.stringify(given), owner)
    }
    const ownerRoot = store.rootOf(owner)!
    store.append(
      owner,
      store.nextOrdinal(owner),
      { type: 'work_status_set', piece: ownerRoot.piece, line: 'Measurement started', by: owner },
      at + 5,
    )
    store.append(
      owner,
      store.nextOrdinal(owner),
      { type: 'work_status_set', piece: given.piece, line: 'Child measurement started', by: owner },
      at + 6,
    )
    store.append(
      owner,
      store.nextOrdinal(owner),
      {
        type: 'work_replied',
        piece: given.piece,
        outcome: 'done',
        summary: 'Child measurement recorded',
        resources: [],
      },
      at + 7,
    )
    clock = at
    const childQuery = { words: 'archived meter protocol index', limit: 1 }
    const child = engine.read(caller, childQuery)
    const childStatus = { conversation: owner, status: 'Child measurement recorded' }
    expect(child).toMatchObject({
      ok: true,
      page: { title_details_pending: true, title_details_unread: 1, hits: [childStatus] },
    })
    if (!child.ok || child.page.next_cursor === null) throw new Error('expected child details')
    const childDetails = engine.read(caller, { ...childQuery, cursor: child.page.next_cursor })
    expect(childDetails).toMatchObject({
      ok: true,
      page: { hits: [childStatus] },
    })
    if (childDetails.ok) expect(childDetails.page.title_details_unread).toBeUndefined()

    const exhaustedQuery = { ...childQuery, limit: 2 }
    const pageRows = WORK_SEARCH_BOUNDS.pageRows
    let exhausted: WorkSearchResult
    Object.defineProperty(WORK_SEARCH_BOUNDS, 'pageRows', { value: 1 })
    try {
      exhausted = engine.read(caller, exhaustedQuery)
    } finally {
      Object.defineProperty(WORK_SEARCH_BOUNDS, 'pageRows', { value: pageRows })
    }
    expect(exhausted).toMatchObject({
      ok: true,
      page: {
        complete: false,
        searched: 0,
        title_details_pending: true,
        title_details_unread: 1,
        hits: [{ conversation: owner, status: null }],
      },
    })
    if (!exhausted.ok || exhausted.page.next_cursor === null)
      throw new Error('expected deferred title details after budget exhaustion')
    expect(
      engine.read(caller, { ...exhaustedQuery, cursor: exhausted.page.next_cursor }),
    ).toMatchObject({
      ok: true,
      page: { hits: [childStatus] },
    })
  } finally {
    engine.close()
  }
}
