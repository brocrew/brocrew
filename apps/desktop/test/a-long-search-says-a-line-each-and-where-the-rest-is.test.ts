import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolset } from '@brobot2/runtime'
import { answerCodexToolCall } from '../../../packages/runtime/src/codex/agent-tools'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { FoundFile, FoundFiles } from '../src/main/runtime/kept-file-search'
import {
  HOW_TO_GO_ON_IS_IN_THE_FILE,
  SHORT_REPLY_CHARACTERS,
} from '../src/main/runtime/tool-families/long-replies'
import type { PastWorkHit, PastWorkSearchResult } from '../src/shared/past-work-search'
import type { ConversationSearchHit, WorkSearchPage } from '../src/shared/work-search'
import { aGiverAndHelper, type AServiceWorld } from './helpers/a-service-world'
import { answerOn } from './helpers/call-tool'
import { fullReplyPath, splitFullReply, toolTextViaClaude } from './lib/full-reply'

/**
 * 🔴 **555 · a long search says a line a result, and where the rest is.**
 *
 * Majid, 25 Nov: a long result goes to a file, and the reply always names its path. card 484 did
 * this for the list tools and card 485 for read_transcript; search_past_work, search_work and
 * find_files answer the same way here. Each search's own reading is stubbed with fictional rows,
 * so what is tested is the reply the tool makes of them: whole when short; when long, a count, a
 * line a result and every line that says how to go on, then `Full reply: <path>`, the same through
 * the Claude MCP server and the Codex tool-call answer.
 */

const AT = Date.parse('2026-11-25T08:00:00Z')

const textOf = async (tools: AgentToolset, name: ToolName, args: Record<string, unknown>) =>
  (await answerOn(tools, name, args)).text

/** The lines of a short form that are one result each. */
const itemLines = (short: string) => short.split('\n').filter((line) => line.startsWith('- '))

const aConversation = (n: number): ConversationSearchHit => ({
  conversation: `sess_fictional_${String(n)}`,
  address: `W9.${String(n)}`,
  title: `Fictional venue survey ${String(n)}`,
  line: `conversation W9.${String(n)} · Fictional venue survey ${String(n)} — measuring rooms, chairs and the light in each hall`,
  profile: 'fictional-surveyor',
  last_active_at: AT + n,
  status: `Room ${String(n)} measured; ${'the chairs are counted and the light is noted. '.repeat(3)}`,
  matched_tasks: [
    {
      piece: `work_fictional_${String(n)}`,
      label: `W9.${String(n)}.1`,
      title: `Survey hall ${String(n)}`,
    } as unknown as ConversationSearchHit['matched_tasks'][number],
  ],
  tasks_omitted: 0,
})

const aWorkPage = (count: number, nextCursor: string | null): WorkSearchPage => ({
  hits: Array.from({ length: count }, (_, n) => aConversation(n + 1)),
  searched: count,
  rows_unread: 0,
  ledgers_skipped: 0,
  complete: nextCursor === null,
  next_cursor: nextCursor,
})

const aPastHit = (n: number): PastWorkHit => ({
  conversation: `sess_fictional_${String(n)}`,
  piece: null,
  line: `conversation W9.${String(n)} · Fictional venue survey ${String(n)} · fictional-surveyor`,
  label: `W9.${String(n)}`,
  link: `brocrew://conversation/sess_fictional_${String(n)}`,
  title: null,
  state: 'idle',
  last_active: '2026-11-25T08:00:00.000Z',
  archived: false,
  matched_field: 'agent reply',
  snippet: `… the hall ${String(n)} holds ${'forty chairs by the windows, and the light is good in the morning '.repeat(3)}…`,
  turn: {
    id: `turn_fictional_${String(n)}`,
    at: '2026-11-25T08:00:00.000Z',
    generation: 0,
    ordinal: n,
  },
})

const aFile = (n: number, excerpt: string | null): FoundFile => ({
  file: {
    resourceId: `res_fictional${String(n).padStart(4, '0')}`,
    title: `Fictional survey of hall ${String(n)}`,
    name: `hall-${String(n)}-survey.md`,
    form: 'markdown',
    bytes: 1000,
    role: 'made',
    keptAt: AT + n,
    sha256: '0'.repeat(64),
    addedBy: {
      conversation: 'sess_fictional',
      name: 'Fictional Surveyor',
      identity: 'fictional-surveyor',
    },
    piece: `work_fictional_${String(n)}`,
    label: `W9.${String(n)}`,
    pieceTitle: `Survey hall ${String(n)}`,
  },
  foundIn: excerpt === null ? [] : ['text'],
  excerpt,
})

const someFiles = (count: number, goOnFrom: string | null): FoundFiles => ({
  ok: true,
  files: Array.from({ length: count }, (_, n) =>
    aFile(n + 1, `the hall holds ${'forty chairs by the windows and a long table '.repeat(2)}`),
  ),
  looked: count,
  older: goOnFrom === null ? 0 : 12,
  goOnFrom,
  textUnread: 0,
  readAt: AT + 100,
})

describe('555 · a long search is a short form and a file; a short one is unchanged', () => {
  let made: { world: AServiceWorld; host: RuntimeHost; giver: string }
  beforeEach(async () => {
    made = await aGiverAndHelper()
  })
  afterEach(async () => {
    await made.world.cleanUp()
    vi.restoreAllMocks()
  })
  const tools = () => agentToolsFor(made.host, made.giver)

  const pastWork = (result: PastWorkSearchResult) =>
    vi.spyOn(made.host, 'searchPastWork').mockResolvedValue(result)
  const work = (page: WorkSearchPage) =>
    vi.spyOn(made.host, 'searchWork').mockResolvedValue({ ok: true, page })
  const files = (found: FoundFiles) => vi.spyOn(made.host, 'findKeptFiles').mockResolvedValue(found)

  describe('search_past_work', () => {
    const CURSOR = 'fictional-cursor-for-the-next-page'
    const TRANSCRIPT_CURSOR = 'fictional-cursor-for-the-transcripts'

    it('a page of one match is answered whole, with no file', async () => {
      pastWork({ ok: true, hits: [aPastHit(1)], complete: true, next_cursor: null })
      const text = await textOf(tools(), 'search_past_work', { words: 'hall' })
      expect(fullReplyPath(text)).toBeNull()
      expect(text).toContain('Matched agent reply')
      expect(text).toContain('End of this search.')
    })

    it('a long page keeps a line a match and every way on, and the whole page is in the file', async () => {
      pastWork({
        ok: true,
        hits: Array.from({ length: 10 }, (_, n) => aPastHit(n + 1)),
        complete: false,
        next_cursor: CURSOR,
        transcript_next_cursor: TRANSCRIPT_CURSOR,
        preview_counts: { scanned: 40, total: 900 },
      })
      const text = await textOf(tools(), 'search_past_work', { words: 'hall' })
      const { short, full } = splitFullReply(text)
      expect(text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
      expect(short).toMatch(/^10 matches on this page(; the first \d+)?, each cut short:/)
      const items = itemLines(short)
      expect(items.length).toBeGreaterThan(0)
      for (const line of items) expect([...line].length).toBeLessThanOrEqual(162)
      expect(items[0]).toContain('conversation W9.1 · Fictional venue survey 1')
      // ⛔ Both ways on stay whole: the stopped-early transcript search, and the page cursor.
      expect(short).toContain(
        `Stopped after 40 of 900 conversations; continue with search_past_work(`,
      )
      expect(short).toContain(TRANSCRIPT_CURSOR)
      expect(short).toContain(`Continue with cursor: ${JSON.stringify(CURSOR)}`)
      // The file holds the page as it reads whole: each match's turn and its whole excerpt.
      expect(full).toContain('Recorded 2026-11-25T08:00:00.000Z · turn_fictional_10')
      expect(full.length).toBeGreaterThan(short.length)
    })

    it('a page whose ways on alone are long says where they are, and the file holds them', async () => {
      // Valid cursors carry the query, so a long query makes them long; no hits on this page.
      const long = (seed: string) => `${seed}-${'q'.repeat(1_000)}`
      pastWork({
        ok: true,
        hits: [],
        complete: false,
        next_cursor: long('page'),
        transcript_next_cursor: long('transcripts'),
        preview_counts: { scanned: 40, total: 900 },
      })
      const text = await textOf(tools(), 'search_past_work', { words: 'hall' })
      const { short, full } = splitFullReply(text)
      expect(text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
      expect(short).toContain('No matches on this page.')
      expect(short).toContain(HOW_TO_GO_ON_IS_IN_THE_FILE)
      expect(short).not.toContain(long('page'))
      expect(full).toContain(`Continue with cursor: ${JSON.stringify(long('page'))}`)
      expect(full).toContain(long('transcripts'))
    })

    it('Claude and Codex send the same short form, and their files hold the same reply', async () => {
      pastWork({
        ok: true,
        hits: Array.from({ length: 10 }, (_, n) => aPastHit(n + 1)),
        complete: false,
        next_cursor: CURSOR,
      })
      const toolset = tools()
      const viaCodex = await answerCodexToolCall(toolset, {
        tool: 'search_past_work',
        namespace: toolset.server,
        arguments: { words: 'hall' },
      })
      expect(viaCodex.success).toBe(true)
      const codex = splitFullReply(
        (viaCodex.contentItems as { text: string }[]).map((one) => one.text).join('\n'),
      )
      const claude = splitFullReply(
        await toolTextViaClaude(toolset, 'search_past_work', { words: 'hall' }),
      )
      expect(claude.short).toBe(codex.short)
      expect(claude.full).toBe(codex.full)
      expect(claude.path).not.toBe(codex.path)
    })
  })

  describe('search_work', () => {
    it('a page of one conversation is answered whole, with no file', async () => {
      work(aWorkPage(1, null))
      const text = await textOf(tools(), 'search_work', { words: 'venue' })
      expect(fullReplyPath(text)).toBeNull()
      expect(text).toContain('Status: Room 1 measured')
    })

    it('a long page keeps a line a conversation and its cursor, and the whole page is in the file', async () => {
      work(aWorkPage(15, 'fictional-work-cursor'))
      const text = await textOf(tools(), 'search_work', { words: 'venue' })
      const { short, full } = splitFullReply(text)
      expect(text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
      expect(short).toMatch(/^15 conversations match(; the first \d+)?, each cut short:/)
      const items = itemLines(short)
      expect(items.length).toBeGreaterThan(0)
      for (const line of items) expect([...line].length).toBeLessThanOrEqual(162)
      expect(items[0]).toContain('conversation W9.1 · Fictional venue survey 1')
      expect(short).toContain('Searched: 15; rows_unread: 0; ledgers_skipped: 0; complete: false.')
      expect(short).toContain('next_cursor: fictional-work-cursor')
      expect(short).not.toContain('Status: ')
      expect(full).toContain('Status: Room 15 measured')
      expect(full).toContain('Task W9.15.1 · Survey hall 15')
    })
  })

  describe('find_files', () => {
    it('a short list is answered whole, with no file', async () => {
      files(someFiles(1, null))
      const text = await textOf(tools(), 'find_files', {})
      expect(fullReplyPath(text)).toBeNull()
      expect(text).toContain('hall-1-survey.md')
    })

    it('a long list keeps a line a file and how to go on, and the whole list is in the file', async () => {
      files(someFiles(20, 'res_fictional0020'))
      const text = await textOf(tools(), 'find_files', { words: 'hall' })
      const { short, full } = splitFullReply(text)
      expect(text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
      expect(short).toMatch(/\n20 files(; the first \d+)?, each cut short:/)
      const items = itemLines(short)
      expect(items.length).toBeGreaterThan(0)
      for (const line of items) expect([...line].length).toBeLessThanOrEqual(162)
      expect(items[0]).toContain('hall-1-survey.md')
      expect(short).toContain('older_than: res_fictional0020')
      expect(short).toContain('read_document')
      // The excerpts are in the file, not inline.
      expect(short).not.toContain('forty chairs')
      expect(full).toContain('forty chairs')
      expect(full).toContain('hall-20-survey.md')
    })
  })
})
