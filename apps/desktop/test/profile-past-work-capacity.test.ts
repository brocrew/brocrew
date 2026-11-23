import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  pastWorkRecentStart,
  pastWorkStart,
  type PastWorkRecentPoint,
  type PastWorkSearchResult,
} from '../src/shared/past-work-search'
import { searchPastWork } from '../src/main/db/past-work-search'

const words = 'capacityquartz capacityfern'
const scope = {}
const largeMessage = words + ' ' + 'filler '.repeat(570)

function cappedSearch() {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-transcript-capacity-'))
  const db = openDatabase(join(directory, 'records.sqlite'))
  applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db, () => 1_800_000_000_000)
  const pragma = Database.prototype.pragma
  const cap = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
    this: Database.Database,
    source,
    options,
  ) {
    return pragma.call(
      this,
      source.startsWith('max_page_count = ') ? 'max_page_count = 32' : source,
      options,
    )
  })
  const create = (id: string) =>
    store.create({
      id,
      provider: 'codex',
      profileId: 'fictional-reader',
      cwd: directory,
      approvalMode: 'ask',
    })
  const close = () => {
    cap.mockRestore()
    store.closePastWorkSearch()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
  return { db, store, create, close }
}

it.each(['full', 'recent'] as const)(
  'returns partial %s transcript hits at the SQLite page cap and resumes at the first unread turn',
  (order) => {
    const { db, store, create, close } = cappedSearch()
    try {
      const caller = 'capacity-caller'
      create(caller)
      const count = 64
      for (let ordinal = 0; ordinal < count; ordinal++) {
        store.append(
          caller,
          ordinal,
          { type: 'assistant_message', text: largeMessage },
          1_800_000_000_000 + ordinal,
        )
      }

      let cursor: string | undefined
      let after: PastWorkRecentPoint | null = null
      let first = 0
      while (first < count) {
        const page: PastWorkSearchResult =
          order === 'recent'
            ? searchPastWork(db, store, caller, words, {
                ...store.pastWorkSearchSource(caller, undefined, undefined, { after })!,
                transcript: scope,
              })
            : store.searchPastWork(caller, words, undefined, cursor, scope)
        expect(page).toMatchObject({
          ok: true,
          hits: [{ conversation: caller, turn: { ordinal: expect.any(Number) } }],
        })
        if (!page.ok) throw new Error('expected partial hits')
        const match = page.hits[0]?.turn?.ordinal
        if (order === 'recent') {
          after =
            page.next_cursor === null
              ? null
              : (pastWorkRecentStart(page.next_cursor, words, null, scope) ?? null)
        }
        const pending =
          order === 'recent'
            ? after
            : pastWorkStart(words, null, page.next_cursor ?? undefined, scope)
        if (first === 0) expect(pending).not.toBeNull()
        if (pending === null) {
          expect(page.complete).toBe(true)
          expect(match).toBe(count - 1)
          break
        }
        expect(page.complete).toBe(false)
        expect(pending).toMatchObject({ id: caller, position: { kind: 'event', part: 0 } })
        if (typeof pending !== 'object' || pending.position?.kind !== 'event')
          throw new Error('expected an event cursor')
        const next = pending.position.ordinal
        expect(next).toBeGreaterThan(first)
        expect(next).toBeLessThan(count)
        expect(match).toBe(next - 1)
        first = next
        cursor = page.next_cursor ?? undefined
      }
    } finally {
      close()
    }
  },
)

it('counts completed conversations when the transcript preview fills partway through the sixth hit', () => {
  const { db, store, create, close } = cappedSearch()
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    const conversations = Array.from({ length: 6 }, (_, index) => `capacity-${index}`)
    const oldest = conversations[5]!
    for (const [index, conversation] of conversations.entries()) {
      create(conversation)
      const count = conversation === oldest ? 64 : 1
      for (let ordinal = 0; ordinal < count; ordinal++) {
        store.append(
          conversation,
          ordinal,
          { type: 'assistant_message', text: conversation === oldest ? largeMessage : words },
          1_800_000_000_000 + ordinal,
        )
      }
      db.prepare('UPDATE provider_session SET updated_at = ? WHERE id = ?').run(
        100 - index,
        conversation,
      )
    }

    const caller = conversations[0]!
    const first = searchPastWork(db, store, caller, words, {
      ...store.pastWorkSearchSource(caller, undefined, undefined, { after: null, preview: true })!,
      transcript: scope,
    })
    expect(first).toMatchObject({
      ok: true,
      complete: false,
      preview_counts: { scanned: 5, total: 6 },
      hits: conversations.slice(0, 5).map((conversation) => ({ conversation })),
    })
    if (!first.ok || first.next_cursor === null) throw new Error('expected a preview cursor')
    const after = pastWorkRecentStart(first.next_cursor, words, null, scope)
    expect(after).toEqual({ id: conversations[4], at: 96 })
    const resumed = searchPastWork(db, store, caller, words, {
      ...store.pastWorkSearchSource(caller, undefined, undefined, { after: after ?? null })!,
      transcript: scope,
    })
    expect(resumed).toMatchObject({ ok: true, hits: [{ conversation: oldest }] })
  } finally {
    clock.mockRestore()
    close()
  }
})
