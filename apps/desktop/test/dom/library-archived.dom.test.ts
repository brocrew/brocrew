import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { calendarDay } from '../../src/renderer/src/lib/clock'
import type { ArchiveOutcome } from '../../src/shared/conversation-archive'
import type { LibraryEntry, LibraryPage } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * Archived conversations on All conversations: they are listed and marked with the day they were
 * archived, a filter narrows the rows to them, Restore brings one back or says why it could not,
 * and Delete asks for its confirmation. A row that is not archived is the control throughout.
 */

const ARCHIVED_AT = new Date(2026, 8, 30, 19, 30).getTime()

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'th_kept',
  provider: 'claude',
  providerSessionId: 'th_kept',
  recordId: 'sess_kept',
  cwd: '/work/alpha',
  title: 'Still in the lists',
  preview: 'hello',
  createdAt: Date.now() - 7_200_000,
  updatedAt: Date.now() - 3_600_000,
  bytes: null,
  origin: 'ours',
  onDisk: false,
  readable: true,
  derived: null,
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
  ...over,
})

const KEPT = entry()
const AWAY = entry({
  id: 'th_away',
  providerSessionId: 'th_away',
  recordId: 'sess_away',
  title: 'Put away last month',
  archivedAt: ARCHIVED_AT,
})
const FOUND = entry({
  id: 'th_found',
  providerSessionId: 'th_found',
  recordId: null,
  readable: false,
  origin: 'user-home',
  onDisk: true,
  title: 'Only in the provider folder',
})

const page = (entries: LibraryEntry[], matched = entries.length): LibraryPage =>
  ({
    entries,
    matched,
    counts: {
      total: matched,
      ours: entries.length,
      userHome: 0,
      restored: 0,
      imported: 0,
      notImported: 0,
      onlyHere: 0,
      providers: [{ provider: 'claude', total: matched }],
    },
    skipped: [],
    skippedTotal: 0,
  }) as unknown as LibraryPage

type Api = {
  runtime: {
    listLibrary: (input?: { filters?: { archived?: string } }) => Promise<LibraryPage>
    restoreConversation: (input: { sessionId: string }) => Promise<ArchiveOutcome>
    archiveConversation: (input: { sessionId: string }) => Promise<ArchiveOutcome>
  }
}
const stubbed = (): { api?: Api } => window as unknown as { api?: Api }

let restores: { sessionId: string }[] = []
let archives: { sessionId: string }[] = []
let reads = 0
/** What each read asked main for, by its archived filter. */
let asked: (string | undefined)[] = []

/** Each read hands back the next page, so a test can see the list read again after a restore. */
function stub(pages: LibraryPage[], answer: ArchiveOutcome): void {
  restores = []
  archives = []
  reads = 0
  asked = []
  stubbed().api = {
    runtime: {
      listLibrary: (input) => {
        asked.push(input?.filters?.archived)
        const next = pages[Math.min(reads, pages.length - 1)]!
        reads += 1
        return Promise.resolve(next)
      },
      restoreConversation: (input) => {
        restores.push(input)
        return Promise.resolve(answer)
      },
      archiveConversation: (input) => {
        archives.push(input)
        return Promise.resolve(answer)
      },
    },
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await nextTick()
}

async function open(
  pages: LibraryPage[] = [page([KEPT, AWAY, FOUND])],
  answer: ArchiveOutcome = { done: true, conversations: ['sess_away'] },
): Promise<{ m: Mounted; deletes: string[]; left: string[][] }> {
  stub(pages, answer)
  const deletes: string[] = []
  const left: string[][] = []
  const m = mount(
    SessionLibrary,
    {
      onDelete: (sessionId: string) => deletes.push(sessionId),
      onArchived: (conversations: readonly string[]) => left.push([...conversations]),
    },
    { width: 1100, height: 900 },
  )
  await settle()
  return { m, deletes, left }
}

async function tickArchived(m: Mounted, on: boolean): Promise<void> {
  const box = m.q('library-facet-archived') as HTMLInputElement
  box.checked = on
  box.dispatchEvent(new Event('change'))
  await nextTick()
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

describe('an archived conversation is listed, and marked', () => {
  it('the default view shows it, with the day it was archived in the app’s own words', async () => {
    const { m } = await open()
    const badge = m.q('library-archived-th_away')
    expect(visible(badge)).toBe(true)
    expect(badge.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `Archived ${calendarDay(ARCHIVED_AT)}`,
    )
    expect(calendarDay(ARCHIVED_AT)).not.toBe('')
  })

  it('a conversation that is not archived carries no such mark and no Restore', async () => {
    const { m } = await open()
    expect(m.all('library-row-th_kept')).toHaveLength(1)
    expect(m.all('library-archived-th_kept')).toHaveLength(0)
    expect(m.all('library-restore-th_kept')).toHaveLength(0)
    // The control, on the same page: the archived row has both.
    expect(m.all('library-archived-th_away')).toHaveLength(1)
    expect(m.all('library-restore-th_away')).toHaveLength(1)
  })
})

describe('the Archived filter', () => {
  /** The filter's read is debounced like every facet's. */
  const afterTheRead = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 320))
    await settle()
  }

  it('asks main for the archived ones alone, so it reaches the whole library; off again asks for all', async () => {
    const { m } = await open([page([KEPT, AWAY, FOUND]), page([AWAY]), page([KEPT, AWAY, FOUND])])
    expect(asked).toEqual([undefined])
    expect(m.all('library-row-th_kept')).toHaveLength(1)

    await tickArchived(m, true)
    await afterTheRead()
    expect(asked.at(-1)).toBe('only')
    expect(m.all('library-row-th_away')).toHaveLength(1)
    expect(m.all('library-row-th_kept')).toHaveLength(0)
    expect(
      (m.q('library-facet-archived').closest('.facet') as HTMLElement).classList.contains('on'),
    ).toBe(true)

    await tickArchived(m, false)
    await afterTheRead()
    expect(asked.at(-1)).toBeUndefined()
    expect(m.all('library-row-th_kept')).toHaveLength(1)
    expect(m.all('library-row-th_away')).toHaveLength(1)
  })

  it('draws what main answered, and narrows nothing itself', async () => {
    // Main's answer to "archived only" is drawn whole, a row with no archive mark included: the
    // window does not filter the rows a second time.
    const { m } = await open([page([KEPT, AWAY]), page([KEPT, AWAY])])
    await tickArchived(m, true)
    await afterTheRead()
    expect(m.all('library-row-th_kept')).toHaveLength(1)
    expect(m.all('library-row-th_away')).toHaveLength(1)
  })

  it('says nothing about looking only at the rows listed, bounded list or not', async () => {
    const { m } = await open([page([KEPT, AWAY], 500), page([AWAY], 500)])
    await tickArchived(m, true)
    await afterTheRead()
    expect(m.all('library-archived-note')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('This looks only at the conversations listed here')
    // The paired positive: the filter really was on, and its answer drawn.
    expect(asked.at(-1)).toBe('only')
    expect(m.all('library-row-th_away')).toHaveLength(1)
  })
})

describe('Restore', () => {
  it('asks main to restore that conversation, and the list is read again', async () => {
    const back = entry({ ...AWAY, archivedAt: undefined })
    const { m } = await open([page([KEPT, AWAY]), page([KEPT, back])])
    expect(m.q('library-restore-th_away').textContent?.trim()).toBe('Restore')

    m.q('library-restore-th_away').click()
    await settle()

    expect(restores).toEqual([{ sessionId: 'sess_away' }])
    expect(reads).toBe(2)
    expect(m.all('library-archived-th_away')).toHaveLength(0)
    expect(m.all('library-restore-th_away')).toHaveLength(0)
    expect(m.all('library-row-th_away')).toHaveLength(1)
  })

  it('a refusal is shown on its row as main wrote it, and the row stays archived', async () => {
    const refusal = 'This conversation is being archived. Restore it once that is done.'
    const { m } = await open([page([KEPT, AWAY])], { done: false, refusal })
    expect(m.all('library-restore-refused-th_away')).toHaveLength(0)

    m.q('library-restore-th_away').click()
    await settle()

    expect(restores).toEqual([{ sessionId: 'sess_away' }])
    const said = m.q('library-restore-refused-th_away')
    expect(said.textContent?.trim()).toBe(refusal)
    expect(said.getAttribute('role')).toBe('alert')
    expect(reads).toBe(1)
    expect(m.all('library-archived-th_away')).toHaveLength(1)
    // Pressing Restore opened nothing: the press belongs to the button, not the row.
    expect((m.q('library-restore-th_away') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Delete on a row', () => {
  it('asks for the confirmation of that conversation, and asks main for nothing', async () => {
    const { m, deletes } = await open()
    m.q('library-delete-th_away').click()
    m.q('library-delete-th_kept').click()
    await nextTick()
    expect(deletes).toEqual(['sess_away', 'sess_kept'])
    expect(restores).toEqual([])
    expect(reads).toBe(1)
  })

  it('a conversation this app holds no record of offers no Delete', async () => {
    const { m } = await open()
    expect(m.all('library-row-th_found')).toHaveLength(1)
    expect(m.all('library-delete-th_found')).toHaveLength(0)
  })
})

describe('the page can be told to read again', () => {
  it('`reread` asks main for the rows once more', async () => {
    const { m } = await open()
    expect(reads).toBe(1)
    ;(m.vm.reread as () => void)()
    await settle()
    expect(reads).toBe(2)
  })
})

describe('a conversation is archived from its row', () => {
  it('asks main to archive that conversation, says who left, and reads the list again', async () => {
    const { m, left } = await open([page([KEPT, AWAY, FOUND]), page([AWAY, FOUND])], {
      done: true,
      conversations: ['sess_kept', 'sess_kept_helper'],
    })
    const before = reads
    ;(m.q('library-archive-th_kept') as HTMLButtonElement).click()
    await settle()
    expect(archives).toEqual([{ sessionId: 'sess_kept' }])
    expect(left).toEqual([['sess_kept', 'sess_kept_helper']])
    expect(reads).toBe(before + 1)
  })

  it('a refusal is shown on its row as main wrote it, and nobody is said to have left', async () => {
    const refusal = 'This conversation is being archived already.'
    const { m, left } = await open([page([KEPT, AWAY, FOUND])], { done: false, refusal })
    ;(m.q('library-archive-th_kept') as HTMLButtonElement).click()
    await settle()
    expect(m.q('library-archive-refused-th_kept').textContent?.trim()).toBe(refusal)
    expect(left).toEqual([])
    expect(visible(m.q('library-archive-th_kept'))).toBe(true)
  })

  it('an archived row offers Restore and no Archive; a row this app holds no record of offers neither', async () => {
    const { m } = await open()
    expect(m.all('library-archive-th_away')).toHaveLength(0)
    expect(m.all('library-restore-th_away')).toHaveLength(1)
    expect(m.all('library-archive-th_found')).toHaveLength(0)
    // The control: the row that can be archived has the button.
    expect(m.all('library-archive-th_kept')).toHaveLength(1)
  })
})
