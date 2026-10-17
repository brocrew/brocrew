import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionLibrary, {
  searchScopeNote,
} from '../../src/renderer/src/components/SessionLibrary.vue'
import {
  ALL_PROVIDER_FOLDERS,
  type ImportedFromHome,
  type LibraryEntry,
  type LibraryPage,
  type LibraryQuery,
  type RebuiltLedger,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 329 §4.3/§4.4 · **The library says when it reads the machine, and stops overclaiming what it
 * searched.**
 *
 * ## Two defects, one page
 *
 * ⛔ **Opening this page reads the user's own `~/.claude` and `~/.codex` — every time, unasked.**
 * `328` opened it in a fresh app and 2,696 conversations from the machine's history appeared with
 * nothing pressed. Nothing on the page said so. ⚠️ **And the visible button is not that act**: the
 * automatic read walks the user's folders, while `Check homes` (`adoptSessions`) walks only the
 * folders this app provisioned and never opens the user's at all. So the fix is not a reworded
 * button — it is a page that stops being silent about the read it already performs.
 *
 * ⛔ **A miss claimed completeness over records it could not open.** *"No title, first message or
 * working directory across your N conversations contains that"* sat above *"67 could not be read"*.
 * The two numbers never contradicted each other — `counts.total` excludes the skipped — which is
 * precisely why the sentence needed the qualification: a reader has no way to know that.
 *
 * ⚠️ **In the DOM project because the search is a gesture** and because the two states this is about
 * are only reachable by typing into the box and waiting out the 180ms debounce.
 */

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'claude::one',
  provider: 'claude',
  providerSessionId: 'one',
  recordId: null,
  cwd: '/work/repo',
  title: 'A conversation',
  preview: 'hello',
  createdAt: 1,
  updatedAt: 2,
  bytes: 10,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  derived: null,
  lastEnding: null,
  unresumableReason: null,
  child: null,
  ...over,
})

const ROWS = [entry(), entry({ id: 'codex::two', provider: 'codex', title: 'Another' })]

const page = (over: Partial<LibraryPage> = {}): LibraryPage => ({
  entries: ROWS,
  matched: ROWS.length,
  counts: {
    total: 8,
    ours: 1,
    userHome: 7,
    restored: 0,
    imported: 3,
    notImported: 4,
    onlyHere: 0,
    providers: [
      { provider: 'claude', total: 6 },
      { provider: 'codex', total: 2 },
    ],
  },
  skipped: [{ provider: 'claude', path: '/home/bad.jsonl', reason: 'unexpected EOF' }],
  skippedTotal: 67,
  ...over,
})

type LibraryApi = {
  runtime: {
    listLibrary: (input: LibraryQuery) => Promise<LibraryPage>
    importUserHomeSession: () => Promise<ImportedFromHome>
    rebuildLedger: () => Promise<RebuiltLedger>
  }
}

const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

function stub(answer: (input: LibraryQuery) => LibraryPage): void {
  stubbed().api = {
    runtime: {
      listLibrary: (input) => Promise.resolve(answer(input)),
      importUserHomeSession: () =>
        Promise.resolve({ outcome: 'imported', sessionId: 's', readable: true, note: 'ok' }),
      rebuildLedger: () =>
        Promise.resolve({ outcome: 'imported', status: { present: true } } as RebuiltLedger),
    },
  }
}

async function open(
  answer: LibraryPage | ((input: LibraryQuery) => LibraryPage),
): Promise<Mounted> {
  stub(typeof answer === 'function' ? answer : () => answer)
  const m = mount(SessionLibrary, {}, { width: 1100, height: 900 })
  await nextTick()
  await nextTick()
  return m
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

async function search(m: Mounted, text: string): Promise<void> {
  const box = m.q('library-search') as HTMLInputElement
  box.value = text
  box.dispatchEvent(new Event('input'))
  await sleep(260)
  await nextTick()
  await nextTick()
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

describe('329 §4.3 · the page says when it reads the machine', () => {
  it('🔴 says it in the HEAD, where the list is, before anything is pressed', async () => {
    const m = await open(page())
    const said = m.q('library-reads')
    expect(visible(said), 'a disclosure nobody can see is not one').toBe(true)
    expect(said.getBoundingClientRect().height).toBeGreaterThan(0)
    const text = said.textContent ?? ''
    // ⚑ The two programs, named by the shared phrase and never typed here — 039/169 §2.
    expect(text).toContain(ALL_PROVIDER_FOLDERS)
    expect(text, 'the read is not waiting on a press').toMatch(/every time this list loads/i)
    // ⛔ And the promise the read actually keeps: it changes nothing in them.
    expect(text).toMatch(/nothing in them is changed/i)
  })

  it('⛔ …and says the visible button is a DIFFERENT act, in the button’s own words', async () => {
    const m = await open(page())
    const label = (m.q('library-check-homes').textContent ?? '').trim()
    // The sentence must name the control by the label the control actually wears — one string, so a
    // renamed button cannot leave a sentence behind pointing at something that is not there.
    expect(label.length, 'the button is on this page').toBeGreaterThan(0)
    expect(m.q('library-reads').textContent).toContain(label)
    expect(m.q('library-reads').textContent).toMatch(/different act/i)
    // ⛔ **The correction to the brief.** `adoptSessions` reads only the folders this app
    // provisioned, so the page must NOT tell a reader that pressing it is how the machine is read.
    expect(m.q('library-reads').textContent).toMatch(/own profile folders/i)
  })

  it('⚠️ the head sentence is there on a library with rows — where the first-run copy can never be', async () => {
    // 🔴 The reason it is in the head and not in `library-first-run`: that state needs
    // `counts.total === 0`, and the total counts the merged host rows. On the machine this defect
    // was found on, the one sentence naming those folders was unreachable by the reader who had
    // 2,696 of them. Paired positive first, so the absence below is about a page that rendered.
    const m = await open(page())
    expect(m.all('library-rows'), 'the page drew a list').toHaveLength(1)
    expect(m.all('library-first-run'), 'so the first-run copy is not on screen').toEqual([])
    expect(m.all('library-reads'), 'and the disclosure is').toHaveLength(1)
  })
})

describe('329 §4.4 · a miss does not claim what it could not look at', () => {
  it('🔴 the search miss names the unread set, beside the claim about what it searched', async () => {
    const m = await open((input) =>
      (input.query ?? '') === '' ? page() : page({ entries: [], matched: 0 }),
    )
    // ⚑ The pair, and it comes first: with no query there is no claim to qualify, so no scope note.
    expect(m.all('library-search-scope')).toEqual([])

    await search(m, 'Q329_NO_MATCH')
    expect(m.q('library-no-match').textContent).toContain('Q329_NO_MATCH')
    const scope = m.q('library-search-scope').textContent ?? ''
    expect(scope).toContain('67')
    expect(scope).toMatch(/could not be read/i)
    expect(scope, 'and what that means for the search').toMatch(/was searched/i)

    // ⛔ It uses the number the page ALREADY shows, so the two can never disagree.
    expect(m.q('library-skipped').querySelector('summary')?.textContent).toContain('67')

    // 🔴 **COUNTED, not listed — and this fixture is exactly why** (found reviewing 329's own diff).
    // The wire caps the enumeration at `MAX_SKIPPED_REPORTED = 50` while `skippedTotal` is uncapped,
    // so with 67 skips the foot lists ONE row here and prints "…and 66 more not listed here". A
    // sentence promising the reader a complete list at the foot would have been the same overclaim
    // this whole branch exists to remove, contradicted four elements lower on the same screen.
    expect(scope, 'it may not promise an enumeration the page caps').not.toMatch(/listed/i)
    expect(scope).toMatch(/counted at the foot of this page/i)
    // …and the pair: the thing it points at really does carry the whole number, uncapped.
    expect(m.q('library-skipped').textContent, 'the foot says it does not list them all').toMatch(
      /more not listed here/i,
    )

    // …and it goes with the query, so it never becomes furniture (106's other direction).
    await search(m, '')
    expect(m.all('library-search-scope')).toEqual([])
  })

  it('⚠️ the miss also names the FOURTH field it searches, which it never did', async () => {
    const m = await open((input) =>
      (input.query ?? '') === '' ? page() : page({ entries: [], matched: 0 }),
    )
    await search(m, 'Q329_NO_MATCH')
    const body = m.q('library-empty').textContent ?? ''
    // `matches()` has tested `entry.provider` since the merge was written and nothing tested it, so
    // the sentence understated the search while the paragraph below it overstated its reach.
    expect(body).toMatch(/provider name/i)
    expect(body, 'and the three it always named are still there').toMatch(
      /title, first message, working directory/i,
    )
  })

  it('🔴 the FILTERED miss carries the same qualification — it is the same overclaim', async () => {
    // ⚠️ **The stub answers off the FILTERS, not off the query**, which is what makes this the
    // filtered branch and not the search one: `filtered` wins over `searching` in the component, so
    // a test that reached this state by typing would be asserting on the wrong template arm.
    const m = await open((input) =>
      input.filters?.provider ? page({ entries: [], matched: 0 }) : page(),
    )
    // ⚑ The pair, first: an unfiltered library qualifies nothing.
    expect(m.all('library-filtered-scope')).toEqual([])

    // A facet press narrows main-side exactly as a query does, over exactly the same array. Reaching
    // the branch through the real control keeps this about the screen and not about a prop.
    const facet = m.q('library-facet-provider') as HTMLSelectElement
    facet.value = 'codex'
    facet.dispatchEvent(new Event('change'))
    await sleep(260)
    await nextTick()
    await nextTick()

    expect(
      m.all('library-filtered-empty'),
      'the filtered branch is the one on screen',
    ).toHaveLength(1)
    expect(m.all('library-no-match'), 'and NOT the search one').toEqual([])
    expect(m.q('library-filtered-scope').textContent).toContain('67')
    // ⚠️ **NOT "was searched" — nothing was searched here** (found reviewing 329's own diff).
    // `filtered` wins over `searching`, and with an empty box `matches(entry, '')` short-circuits,
    // so this screen is produced by a facet press alone. One sentence reused across two gestures
    // would report the outcome of an operation that did not run.
    expect(m.q('library-filtered-scope').textContent).toMatch(/narrowed by these filters/i)
    expect(m.q('library-filtered-scope').textContent).not.toMatch(/was searched/i)
  })

  it('⛔ silent when the read reached everything — a disclaimer about a hazard that is not there', async () => {
    const clean = (over: Partial<LibraryPage> = {}): LibraryPage =>
      page({ skipped: [], skippedTotal: 0, ...over })
    const m = await open((input) =>
      (input.query ?? '') === '' ? clean() : clean({ entries: [], matched: 0 }),
    )
    await search(m, 'Q329_NO_MATCH')
    // Positive first: the miss really is on screen, so the absence below is about a rendered state.
    expect(m.all('library-no-match')).toHaveLength(1)
    expect(m.all('library-search-scope')).toEqual([])
    expect(m.all('library-skipped'), 'and there is nothing to point at').toEqual([])
  })
})

describe('the rule itself', () => {
  const SEARCHED = { searching: true }
  const FILTERED = { searching: false }

  it('⛔ makes no arithmetic claim — the two counts are not disjoint', () => {
    const said = searchScopeNote({ skippedTotal: 67 }, SEARCHED) ?? ''
    expect(said).toContain('67')
    // 🔴 A row we recorded earlier whose provider file is now skipped is counted in BOTH
    // `counts.total` and `skippedTotal`, so "another 67" / "67 more" would be a false addition.
    expect(said).not.toMatch(/\banother\b|\b67 more\b|\bin addition\b/i)
    // …and it does not recast a count of SKIP RECORDS into a count of conversations: one record can
    // stand for a whole folder whose state database would not open.
    expect(said).not.toMatch(/67 conversations/i)
    // ⛔ …and it promises no enumeration, whatever the count: the list at the foot is capped at 50.
    expect(said).not.toMatch(/listed/i)
  })

  it('⚠️ the verb follows the gesture, because only one of them is a search', () => {
    const searched = searchScopeNote({ skippedTotal: 4 }, SEARCHED) ?? ''
    const filtered = searchScopeNote({ skippedTotal: 4 }, FILTERED) ?? ''
    expect(searched).not.toBe(filtered)
    expect(searched).toMatch(/was searched/i)
    expect(filtered).not.toMatch(/was searched/i)
    // Both still name the set and its count — the difference is the verb, not the disclosure.
    for (const said of [searched, filtered]) {
      expect(said).toContain('4')
      expect(said).toMatch(/could not be read/i)
      expect(said).toMatch(/counted at the foot of this page/i)
    }
  })

  it('silent on a null page and on a clean read', () => {
    expect(searchScopeNote(null, SEARCHED)).toBeNull()
    expect(searchScopeNote({ skippedTotal: 0 }, SEARCHED)).toBeNull()
    // The pair: it is not silent whenever asked, which would make the two above prove nothing.
    expect(searchScopeNote({ skippedTotal: 1 }, SEARCHED)).not.toBeNull()
  })
})
