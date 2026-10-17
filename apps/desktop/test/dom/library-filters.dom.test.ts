import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import SessionLibrary, {
  narrowingDeclaredBy,
  windowNoteCta,
} from '../../src/renderer/src/components/SessionLibrary.vue'
import type {
  AdoptionReport,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
} from '../../src/shared/runtime-ipc'
import { scanSummary } from '../../src/renderer/src/lib/home-scan'
import { mount, parseColor, unmountAll, type Mounted } from './harness'

/**
 * **The filters on Sessions** (121, to `120`'s design) — in a real browser, because every claim
 * `120` makes is about what is on screen while the list is narrowed.
 *
 * ⛔ **The one that decides the feature is that the filter is a ROUND TRIP.** `SessionLibrary.vue`
 * says why in its own words: *"filtering here would search the first 200 entries of two thousand and
 * quietly call it a result."* So the fixtures below hand the surface a page whose `matched` is
 * larger than its `entries`, and — sharper — a page containing a row that does NOT satisfy the
 * active filter. Main-side is the authority; this surface renders what it was given. A component
 * that filtered its own rows would drop that row and fail.
 *
 * ⚠️ **Why here and not in a `*.render.test.ts`.** Three of this task's criteria are about a real
 * cascade and a real layout: that the facet row does not scroll away from under a two-thousand row
 * list, that no part of the filter surface is painted in the attention channel's amber (080), and
 * that a disclosure opening over the list does not make the page scroll sideways. An SSR string has
 * no `getBoundingClientRect` and no computed colour.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'claude:thread-1',
  provider: 'claude',
  providerSessionId: 'thread-1',
  recordId: 'sess_1',
  cwd: '/work/alpha',
  title: 'Refactor the authentication module',
  preview: 'Can you help me refactor the authentication module?',
  createdAt: NOW - 7_200_000,
  updatedAt: NOW - 3_600_000,
  bytes: 1_048_576,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  derived: null,
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
  ...over,
})

/**
 * Five rows, and the mix matters.
 *
 * `codex-behind` is the one row with something to say about completeness — it is the paired
 * positive for "no amber in the filter surface", because it proves the amber ramp still works on
 * this page while the facet row is on screen and filtered.
 *
 * ⚠️ **`claude-nickname` carries a nickname and NO role, because the role form is effectively
 * dead** (§5.1, measured in `114`/`115`): 16 of 827 children carry one, every one written before
 * 2026-07-20, and the provider writes the field explicitly null now. 808 of 827 are nicknamed. A
 * fixture teaching the `(role)` shape would be teaching a shape nothing new will ever take.
 */
const ROWS: LibraryEntry[] = [
  // ⚠️ **An `ours` row as `recordedEntry` actually builds one** (review): no home offered it, so
  // there is no title, no preview, no size and no file on disk. The first version inherited all
  // four from the default and was a shape main-side cannot produce — inert here, but a fixture
  // that teaches a wrong shape is how the next test comes to assert one.
  entry({
    id: 'claude:a',
    title: '',
    preview: '',
    bytes: null,
    onDisk: false,
    origin: 'ours',
    derived: 'current',
  }),
  entry({
    id: 'codex:behind',
    provider: 'codex',
    title: 'Imported and behind its archive',
    derived: 'stale',
  }),
  entry({
    id: 'codex:nickname',
    provider: 'codex',
    title: 'A conversation another agent drove',
    child: { parentSessionId: 'thread-parent', depth: 1, nickname: 'Turing', role: null },
    unresumableReason: 'a sub-agent conversation — another agent drove it',
  }),
  entry({
    id: 'claude:unimported',
    recordId: null,
    readable: false,
    title: 'Never imported, still over there',
    unresumableReason: 'it has not been imported yet — import it to read it here',
  }),
  entry({ id: 'claude:only', onDisk: false, bytes: null, title: 'The provider deleted its copy' }),
]

const page = (over: Partial<LibraryPage> = {}): LibraryPage => ({
  entries: ROWS,
  matched: ROWS.length,
  counts: {
    total: 2027,
    ours: 231,
    userHome: 1796,
    restored: 0,
    imported: 1674,
    notImported: 122,
    onlyHere: 14,
    // The Provider facet's options — the backend's tally, because the renderer may not know a
    // provider's name (039). Two of them, so the menu is a real choice.
    providers: [
      { provider: 'codex', total: 1060 },
      { provider: 'claude', total: 967 },
    ],
  },
  skipped: [],
  skippedTotal: 0,
  ...over,
})

type LibraryApi = {
  runtime: {
    listLibrary: (input: LibraryQuery) => Promise<LibraryPage>
    adoptSessions: () => Promise<AdoptionReport>
    listResumable: () => Promise<never[]>
    listUnresumable: () => Promise<never[]>
    importUserHomeSession: () => Promise<never>
    rebuildLedger: () => Promise<never>
  }
}

const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

/** Every read the surface made, in order — how a test sees that a click reached the main process. */
let reads: LibraryQuery[] = []
/** How many times the shared scan was actually run. */
let scans = 0

const REPORT: AdoptionReport = {
  found: 9,
  adopted: 1,
  alreadyKnown: 8,
  imported: 0,
  descentsLearned: 8,
  named: 0,
  skipped: [],
}

function stub(answer: (query: LibraryQuery) => LibraryPage = () => page()): void {
  reads = []
  scans = 0
  stubbed().api = {
    runtime: {
      listLibrary: (input) => {
        /**
         * ⚠️ **`structuredClone`, deliberately — it is the algorithm the real wire uses.**
         * `ipcRenderer.invoke` clones its payload, and a Vue reactive proxy is not cloneable, so a
         * stub that merely stored the reference would have accepted an argument Electron refuses.
         * That is exactly what it caught: the surface was sending `filters.value` — a proxy — and
         * every filter press would have failed at the boundary with "an object could not be
         * cloned", showing the read-failed banner about a read it never made.
         */
        reads.push(structuredClone(input))
        return Promise.resolve(answer(input))
      },
      adoptSessions: () => {
        scans++
        return Promise.resolve(REPORT)
      },
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
      importUserHomeSession: () => Promise.reject(new Error('not used here')),
      rebuildLedger: () => Promise.reject(new Error('not used here')),
    },
  }
}

async function open(
  answer: (query: LibraryQuery) => LibraryPage = () => page(),
  box: { width?: number; light?: boolean } = {},
): Promise<Mounted> {
  stub(answer)
  const m = mount(SessionLibrary, {}, { width: box.width ?? 1100, height: 900 })
  await nextTick()
  await nextTick()
  return m
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Let the 180ms debounce and the re-read it schedules land. */
async function settle(): Promise<void> {
  await sleep(260)
  await nextTick()
  await nextTick()
}

/** Choose a facet option the way a person does, and wait for the round trip. */
async function choose(m: Mounted, facet: string, value: string): Promise<void> {
  const select = m.q(`library-facet-${facet}`) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
  await settle()
}

async function type(m: Mounted, text: string): Promise<void> {
  const box = m.q('library-search') as HTMLInputElement
  box.value = text
  box.dispatchEvent(new Event('input'))
  await settle()
}

/** Turn one of the five state toggles on or off. */
async function toggle(m: Mounted, key: string): Promise<void> {
  const box = m.q(`library-state-${key}`) as HTMLInputElement
  box.checked = !box.checked
  box.dispatchEvent(new Event('change'))
  await settle()
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

/* ------------------------------------------------------------------ 1 · the round trip */

describe('⛔ a filter is a round trip, never a predicate over the page (120 §0)', () => {
  it('every facet change re-reads main-side, carrying the filter', async () => {
    const m = await open()
    expect(reads).toHaveLength(1)
    expect(reads[0]?.filters).toEqual({})

    await choose(m, 'provider', 'codex')
    expect(reads).toHaveLength(2)
    expect(reads[1]?.filters).toEqual({ provider: 'codex' })

    await toggle(m, 'behind')
    expect(reads.at(-1)?.filters).toEqual({ provider: 'codex', behind: true })

    // All eight dimensions reach the wire, not just the three that are always visible.
    await choose(m, 'kind', 'sub')
    await choose(m, 'origin', 'user-home')
    expect(reads.at(-1)?.filters).toEqual({
      provider: 'codex',
      origin: 'user-home',
      kind: 'sub',
      behind: true,
    })
  })

  it('⛔ arrives narrowed by NOTHING, and Origin least of all (154 §2b)', async () => {
    /**
     * ⛔ **The PM's ruling, in the ticket that renamed this page:** *"Do NOT default the Origin
     * facet to `user-home`."* The rail stopped showing conversations found in the user's own
     * folder, and the obvious-looking follow-up — open the page on those rows, since it is now the
     * only way to reach them — is a different bug. ⚑ **`121`'s own rule: the empty option is not a
     * value, it means "do not narrow by this."** A page that silently hides rows on arrival is
     * lying about what it holds, whichever way the filter points.
     */
    const m = await open()
    const origin = m.q('library-facet-origin') as HTMLSelectElement
    expect(origin.value, 'the empty option, which is not a value').toBe('')
    expect(
      origin.closest('.facet')!.classList.contains('on'),
      'and the facet is not painted as narrowing',
    ).toBe(false)
    // The wire, not just the control: the first read carries no `origin` key at all.
    expect(reads).toHaveLength(1)
    expect(reads[0]?.filters?.origin).toBeUndefined()
    expect(reads[0]?.filters).toEqual({})
    // ⚑ **The paired positive** — every row the answer carried is on screen, so "nothing was
    // narrowed" is a statement about a list with rows in it. The fixture holds both origins.
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(ROWS.length)
    expect(ROWS.some((entry) => entry.origin === 'user-home')).toBe(true)
    expect(ROWS.some((entry) => entry.origin === 'ours')).toBe(true)
  })

  it('⛔ …and the surface renders what main sent it, including a row the filter excludes', async () => {
    /**
     * **The assertion a client-side implementation cannot pass.** The page below is answered with a
     * Claude row while the Provider facet says Codex — a state main-side would never produce, and
     * that is the point: it can only be observed if this surface does no filtering of its own.
     * `entries.filter(...)` anywhere in the component drops this row and this test fails.
     */
    const m = await open()
    await choose(m, 'provider', 'codex')
    expect(m.all('library-row-claude:a')).toHaveLength(1)
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(ROWS.length)
  })

  it('the matching set is larger than the window, and the count says so', async () => {
    // 200 rows of 1,063 matching, out of a library of 2,027 — the shape `120` §6 designed for.
    const m = await open(() => page({ matched: 1063 }))
    await choose(m, 'provider', 'codex')
    const note = m.q('library-window-note').textContent ?? ''
    // ⛔ `matched`, never `entries.length`: "5 of 5" over a filtered library of two thousand is the
    // lie the brief feared, and it cannot be said because the number does not come from the page.
    expect(note).toContain('1063')
    expect(m.q('library-filter-count').textContent).toContain('1,063')
    expect(m.q('library-counts').textContent, 'the header counts stay whole-library').toContain(
      '2027',
    )
  })

  it('⛔ the count goes QUIET while its answer is in flight — it never carries over', async () => {
    /**
     * **The defect three reviewers found and no test could see** (121 review). `filters` changes on
     * the `change` event; `page.matched` changes a debounce and a round trip later. Built from the
     * live filters and the page in hand, the sticky badge read *"2,027 match · Clear all"* and the
     * note read *"of 2,027 matching conversations · Codex"* for the whole wait — `086`'s fabricated
     * number, inside the control `120` §3 added to prevent it.
     *
     * ⚠️ **This test deliberately asserts BEFORE `settle()`**, which is exactly why the others
     * missed it: every one of them sleeps 260 ms past the debounce first.
     */
    const m = await open(() => page({ matched: 2027 }))
    expect(m.q('library-window-note').textContent).toContain('2027')

    const select = m.q('library-facet-provider') as HTMLSelectElement
    select.value = 'codex'
    select.dispatchEvent(new Event('change'))
    await nextTick()

    // The row declares the narrowing immediately — that half must not wait.
    const pinned = m.q('library-filter-count')
    expect(pinned.textContent).toContain('Clear all')
    // ⛔ …and it does NOT put a number on it, because the number it has belongs to the last read.
    expect(pinned.textContent).not.toContain('2,027')
    expect(pinned.textContent).not.toContain('2027')
    expect(pinned.textContent).toContain('—')
    // Nor does the note label the old count with the new filter.
    expect(m.all('library-note-constraints')).toEqual([])

    // …and once the answer lands, both speak. Without this the assertions above are satisfied by a
    // surface that had stopped counting altogether.
    await settle()
    expect(m.q('library-filter-count').textContent).toContain('2,027')
    expect(m.q('library-note-constraints').textContent).toContain('Codex')
  })

  it('⛔ a read already in flight cannot land on a question that has changed', async () => {
    /**
     * `issued` used to move only when a read STARTED, so a read still walking the provider homes
     * when a facet changed still satisfied `mine === issued` on arrival: it wrote its page and
     * cleared `loading`, leaving the surface settled and silent on the previous question. `105`
     * fixed this shape for keystrokes; the guard it added was never reached by the slow read.
     */
    // ⚠️ The first read has to land before a facet can be pressed at all: the Provider menu is
    // built from `counts.providers`, so before an answer arrives its only option is "All". That is
    // correct — you cannot pick a provider nobody has said exists — and it is why the interleaving
    // below is staged on the SECOND read rather than the first.
    const m = await open()
    let release: ((value: LibraryPage) => void) | undefined
    stubbed().api!.runtime.listLibrary = (input) => {
      reads.push(structuredClone(input))
      if (release === undefined)
        return new Promise<LibraryPage>((resolve) => {
          release = resolve
        })
      return Promise.resolve(page({ entries: [ROWS[0]!], matched: 1 }))
    }

    // Provider → Codex. Its read starts and never answers.
    await choose(m, 'provider', 'codex')
    expect(reads.at(-1)?.filters).toEqual({ provider: 'codex' })

    /**
     * Now the question changes again while that read is still out — and the slow read lands
     * INSIDE the debounce window, before the next read has started.
     *
     * ⚠️ **That timing is the whole test** (found by mutation). Wait for the debounce first and the
     * next `load()` has already bumped `issued`, so the stale read is turned away by the ordinary
     * guard and the watcher's own bump proves nothing. The hole is exactly the 180 ms in which no
     * new read exists to out-rank it.
     */
    const box = m.q('library-search') as HTMLInputElement
    box.value = 'refund'
    box.dispatchEvent(new Event('input'))
    await nextTick()

    release!(page({ entries: ROWS, matched: 2027 }))
    await nextTick()
    await nextTick()

    // ⛔ It wrote nothing — not its rows, and not its count — and it did NOT clear `loading`.
    // Before the fix it did all three, leaving the surface settled and silent on somebody else's
    // answer for the rest of the debounce.
    // The page on screen is still the one from BEFORE the facet was pressed — five rows — and the
    // slow read's 2,027 reached nothing.
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(ROWS.length)
    expect(m.q('library-filter-count').textContent).not.toContain('2,027')
    expect(m.all('library-window-note'), 'a retired read must not write its truncation').toEqual([])
    // ⚠️ No assertion on the "Reading…" hint: it is drawn only when the list is EMPTY, and the
    // list here is deliberately the previous page. What the retired read would have changed is
    // exactly the two lines above — it carried `{ provider: 'codex' }`, so landing would have made
    // `applied` agree with the controls and put its 2,027 into both.

    // …and the read that WAS asked for lands, and is the one on screen — the paired positive.
    await settle()
    expect(reads.at(-1)).toMatchObject({ query: 'refund', filters: { provider: 'codex' } })
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(1)
  })

  it('a filter change goes through the same debounce as a keystroke', async () => {
    /**
     * Three changes inside one debounce window are one read, not three — so a person walking the
     * menus does not fire a scan of both provider homes per step.
     *
     * ⚠️ **SEPARATED BY REAL TIME, and the first version was not** (review, by mutation). Three
     * synchronous writes are coalesced by Vue's own `flush: 'pre'` watcher batching regardless of
     * any debounce, so with `setTimeout(…, 180)` replaced by a bare `load()` the old version still
     * counted two reads. It was measuring the framework. 60 ms apart, three writes are three
     * watcher callbacks, and only the debounce can make them one read.
     */
    const m = await open()
    for (const value of ['codex', 'claude', '']) {
      const select = m.q('library-facet-provider') as HTMLSelectElement
      select.value = value
      select.dispatchEvent(new Event('change'))
      await sleep(60)
    }
    await settle()
    expect(reads).toHaveLength(2)
    expect(reads[1]?.filters).toEqual({})
  })
})

/* ------------------------------------------------------------------ 2 · the four note states */

describe('what the surface says while it is narrowed (120 §6)', () => {
  it('unfiltered and complete: nothing is claimed, and there is a list to claim nothing about', async () => {
    const m = await open()
    expect(m.all('library-window-note')).toEqual([])
    expect(m.all('library-filter-count')).toEqual([])
    // The paired positive — the silence is about a real, whole list.
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(ROWS.length)
  })

  it('unfiltered and bounded: the note speaks and names no filter', async () => {
    const m = await open(() => page({ matched: 2027 }))
    const note = m.q('library-window-note')
    expect(note.textContent).toContain('2027')
    expect(note.textContent).toContain('Search to reach the rest')
    expect(m.all('library-note-constraints')).toEqual([])
    expect(m.all('library-filter-count')).toEqual([])
  })

  it('⛔ filtered and bounded: the note names the filter it counted', async () => {
    const m = await open(() => page({ matched: 1063 }))
    await choose(m, 'provider', 'codex')
    const note = m.q('library-window-note').textContent ?? ''
    expect(note).toContain('1063')
    // Which 1,063. Without this the number is true and unreadable: the reader cannot tell whether
    // it is about the library or about their filter.
    expect(m.q('library-note-constraints').textContent).toContain('Codex')
    expect(note).toContain('Narrow the filters to reach the rest')

    // …and with a query too, both axes are named in the advice.
    await type(m, 'refund')
    expect(m.q('library-window-note').textContent).toContain(
      'Narrow the filters or search to reach the rest',
    )
  })

  it('⛔ filtered and complete: the note is silent and the sticky count carries the fact', async () => {
    const m = await open()
    await choose(m, 'kind', 'sub')
    // Nothing is truncated, so the note has nothing to report…
    expect(m.all('library-window-note')).toEqual([])
    // …and the list is still declared narrowed, which is the half that makes the silence safe.
    expect(m.q('library-filter-count').textContent).toContain('5')
    expect(m.q('library-clear-all')).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ 3 · two axes */

describe('search and filters compose, and clear separately (120 §4)', () => {
  it('both go main-side together, ANDed', async () => {
    const m = await open()
    await choose(m, 'provider', 'codex')
    await type(m, 'refund webhook')
    expect(reads.at(-1)).toMatchObject({
      query: 'refund webhook',
      filters: { provider: 'codex' },
    })
  })

  it('⛔ clearing the search does NOT clear the filters', async () => {
    const m = await open()
    await choose(m, 'provider', 'codex')
    await type(m, 'refund')
    m.q('library-clear-search').click()
    await settle()
    expect(reads.at(-1)).toMatchObject({ query: '', filters: { provider: 'codex' } })
    // …and the facet is still visibly on, not merely still on the wire.
    expect((m.q('library-facet-provider') as HTMLSelectElement).value).toBe('codex')
    expect(m.all('library-filter-count')).toHaveLength(1)
  })

  it('⛔ …and clearing the filters does NOT clear the search', async () => {
    const m = await open()
    await choose(m, 'provider', 'codex')
    await toggle(m, 'unresumable')
    await type(m, 'refund')
    // The facet row's own clear is `Clear all`; the filters-only clear lives on the empty state,
    // which is where a person meets it. Here the chip's × does the same job for one axis.
    m.q('library-clear-all').click()
    await settle()
    // `Clear all` is the one control that does both — that is what its name says.
    expect(reads.at(-1)).toMatchObject({ query: '', filters: {} })
    expect(m.all('library-filter-count')).toEqual([])
  })

  it('the search’s Clear appears only when there is a search to clear (106)', async () => {
    const m = await open()
    expect(m.all('library-clear-search')).toEqual([])
    await type(m, 'refund')
    expect(m.all('library-clear-search')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ 4 · the empty state */

describe('the filtered-empty screen names every constraint (120 §5)', () => {
  /** Two facets, one toggle and a query at once — a partial implementation cannot pass this. */
  async function emptied(): Promise<Mounted> {
    const m = await open((input) =>
      Object.keys(input.filters ?? {}).length === 0 && !input.query
        ? page()
        : page({ entries: [], matched: 0 }),
    )
    await choose(m, 'provider', 'claude')
    await choose(m, 'kind', 'sub')
    await toggle(m, 'unresumable')
    await type(m, 'refund webhook')
    return m
  }

  it('one chip per active constraint, and it is a different state from the other two', async () => {
    const m = await emptied()
    m.q('library-filtered-empty')
    // ⚠️ **The COUNT, not just "some chips"** — a positive assertion, so an implementation that
    // rendered the facets and forgot the toggle (or the query) fails rather than passing quietly.
    const chips = [...m.q('library-constraints').children]
    expect(chips).toHaveLength(4)
    expect(chips.map((chip) => chip.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Provider: Claude ×',
      'Kind: Sub-agents ×',
      'Unresumable ×',
      '“refund webhook” ×',
    ])
    // Not the search miss and not first run: each of the three describes a different situation.
    expect(m.all('library-no-match')).toEqual([])
    expect(m.all('library-first-run')).toEqual([])
  })

  it('the two hatches are separate, and each relaxes only its own axis', async () => {
    const m = await emptied()
    m.q('library-clear-filters').click()
    await settle()
    // Filters gone, query kept — which is the whole reason they are two buttons.
    expect(reads.at(-1)).toMatchObject({ query: 'refund webhook', filters: {} })
  })

  it('a chip’s × is a real control that drops exactly one constraint', async () => {
    // 106: a chip drawn with an × that does nothing is an unwired control at chip scale.
    const m = await emptied()
    m.q('library-constraint-kind').click()
    await settle()
    expect(reads.at(-1)?.filters).toEqual({ provider: 'claude', unresumable: true })
    expect(reads.at(-1)?.query).toBe('refund webhook')

    // …and the query chip belongs to the other axis: it clears the box, not a filter.
    m.q('library-constraint-query').click()
    await settle()
    expect(reads.at(-1)?.query).toBe('')
    expect(reads.at(-1)?.filters).toEqual({ provider: 'claude', unresumable: true })
  })

  it('a search miss with NO filter is still the search miss', async () => {
    // The paired negative. Without it, "the filtered-empty state renders" is equally consistent
    // with a chain that had swallowed the other two empty states entirely.
    const m = await open((input) => (input.query ? page({ entries: [], matched: 0 }) : page()))
    await type(m, 'zzzznothing')
    m.q('library-no-match')
    expect(m.all('library-filtered-empty')).toEqual([])
    // And there is no "Clear filters" offered for filters nobody set.
    expect(m.all('library-clear-filters')).toEqual([])
  })
})

/* ------------------------------------------------------------------ 5 · it stays visible */

describe('an active filter is visible from anywhere in the list (120 §3)', () => {
  it('the facet row does not scroll away, and the pinned count rides with it', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      entry({ id: `row-${i}`, updatedAt: NOW - i * 86_400_000 }),
    )
    const m = await open(() => page({ entries: many, matched: many.length }))
    await choose(m, 'provider', 'codex')

    const scroller = m.q('session-library').querySelector('.lib-scroll') as HTMLElement
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    const facetsTop = m.q('library-facets').getBoundingClientRect().top
    const firstRow = m.q('library-rows').getBoundingClientRect().top

    scroller.scrollTop = scroller.scrollHeight
    // ⚠️ That the scroll HAPPENED is half the assertion — an unscrollable box pins `scrollTop` at
    // 0 and the head trivially "stays put".
    expect(scroller.scrollTop, 'the list must actually have scrolled').toBeGreaterThan(0)
    await nextTick()

    expect(m.q('library-rows').getBoundingClientRect().top, 'the list moved').toBeLessThan(firstRow)
    expect(m.q('library-facets').getBoundingClientRect().top, 'the facets did not').toBe(facetsTop)
    // …and the declaration that this list is filtered is still on screen with them.
    expect(m.q('library-filter-count').textContent).toContain('match')
  })

  it('an active facet takes an accent FILL, not a quiet pressed state', async () => {
    const m = await open()
    const chip = (): HTMLElement => m.q('library-facet-provider').closest('.facet') as HTMLElement
    const off = parseColor(getComputedStyle(chip()).backgroundColor)!
    await choose(m, 'provider', 'codex')
    const on = parseColor(getComputedStyle(chip()).backgroundColor)!
    // It changed, and it changed towards blue — `120` §3 asks for a fill rather than a border
    // nobody notices from across the room.
    expect(on).not.toEqual(off)
    expect(on[2]! - on[0]!, 'an active facet reads blue').toBeGreaterThan(0)
  })

  it('a state toggle declares itself with the disclosure CLOSED', async () => {
    // The five live behind a popover, so the badge is the only thing standing between "filtered"
    // and "looks unfiltered" when it is shut.
    const m = await open()
    expect(m.all('library-state-count')).toEqual([])
    await toggle(m, 'offDisk')
    const disclosure = m.q('library-facet-state') as HTMLDetailsElement
    disclosure.open = false
    await nextTick()
    expect(m.q('library-state-count').textContent?.trim()).toBe('1')
    expect(disclosure.className).toContain('on')
  })
})

/* ------------------------------------------------------------------ 6 · never amber */

describe('⛔ the filter surface is never amber (080)', () => {
  /** Warmer than it is cool — the amber register, in the same terms `105` measured it. */
  const warm = (colour: string): boolean => {
    const rgba = parseColor(colour)
    return rgba !== null && rgba[3]! > 0 && rgba[0]! - rgba[2]! > 20
  }

  for (const light of [false, true]) {
    it(`no ink or fill in the facet row is amber in ${light ? 'light' : 'dark'}`, async () => {
      const m = await open(() => page(), { light })
      await choose(m, 'provider', 'codex')
      await toggle(m, 'behind')

      const row = m.q('library-facets')
      const amber: string[] = []
      let walked = 0
      for (const el of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
        walked++
        const style = getComputedStyle(el)
        if (warm(style.color)) amber.push(`${el.className || el.tagName} colour`)
        if (warm(style.backgroundColor)) amber.push(`${el.className || el.tagName} fill`)
      }
      // The walk saw something — otherwise `toEqual([])` is a sweep over nothing.
      expect(walked, 'the amber walk covered nothing').toBeGreaterThan(10)
      expect(amber, `amber in the filter surface:\n  ${amber.join('\n  ')}`).toEqual([])

      /**
       * ⚠️ **The paired positive, in the SAME document.** Amber is the attention channel and it is
       * still spent — on a row asking to be rebuilt, which is `120` §8's ruling and unchanged since
       * 104. Without this, "no amber in the facet row" is equally satisfied by a page where the
       * amber ramp had collapsed to grey everywhere.
       */
      const behind = m.q('library-behind-codex:behind').querySelector('.txt')!
      expect(warm(getComputedStyle(behind).color), 'the attention channel still works').toBe(true)
    })
  }

  it('…and the empty state’s chips are blue too', async () => {
    const m = await open((input) =>
      Object.keys(input.filters ?? {}).length === 0 ? page() : page({ entries: [], matched: 0 }),
    )
    await choose(m, 'provider', 'claude')
    const chip = m.q('library-constraint-provider')
    expect(warm(getComputedStyle(chip).color)).toBe(false)
    expect(warm(getComputedStyle(chip).backgroundColor)).toBe(false)
  })
})

/* ------------------------------------------------------------------ 7 · layout */

describe('the row fits, and the disclosure does not push the page sideways', () => {
  const overflowing = (m: Mounted): string[] => {
    const contained = (el: Element): boolean => {
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return true
      const overflowX = getComputedStyle(el).overflowX
      return overflowX === 'hidden' || overflowX === 'clip'
    }
    const root = m.q('session-library')
    return [root, ...root.querySelectorAll('*')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !contained(el))
      .map((el) => `${el.getAttribute('data-cy') ?? el.className} — ${el.scrollWidth}px`)
  }

  for (const width of [1095, 855, 635, 400, 300]) {
    it(`nothing sticks out at ${width}px, filtered, with the State popover open`, async () => {
      const m = await open(() => page({ matched: 1063 }), { width })
      await choose(m, 'provider', 'codex')
      ;(m.q('library-facet-state') as HTMLDetailsElement).open = true
      await nextTick()
      // ⚠️ **A BOX, not a node** (review). `m.q` asserts presence only, and a closed `<details>`
      // keeps its children in the DOM — so the first version of this guard was satisfied by a
      // disclosure that had never opened, which is exactly the sweep it claims to prevent.
      expect(
        m.q('library-state-behind').getBoundingClientRect().height,
        'the popover is not laid out — this width sweep would be over a closed disclosure',
      ).toBeGreaterThan(0)
      const wide = overflowing(m)
      expect(wide, `at ${width}px:\n  ${wide.join('\n  ')}`).toEqual([])
    })
  }

  it('…and the sweep fires — a stiff element is named, and removing it restores silence', async () => {
    // Non-vacuity for every `toEqual([])` above.
    const m = await open(() => page(), { width: 400 })
    const stiff = document.createElement('div')
    stiff.dataset.cy = 'stiff'
    // ⚠️ **Its own width is pinned**, because `.facets` wraps: an unpinned item is given a whole
    // line of its own and reports the overflow on its PARENT instead of on itself, which made the
    // first version of this assertion look like the detector had missed it.
    stiff.style.cssText = 'display:flex;flex-wrap:nowrap;flex:0 0 120px;width:120px'
    stiff.innerHTML = '<span style="flex:0 0 900px">wider than the column</span>'
    m.q('library-facets').append(stiff)
    expect(overflowing(m).join('\n')).toContain('stiff')
    stiff.remove()
    expect(overflowing(m)).toEqual([])
  })
})

/* ------------------------------------------------------------------ 7b · the rules themselves */

/**
 * ⚠️ **The pure halves, here rather than in the node project, and that is the tiering rather
 * than a preference.** `windowNoteCta` and `narrowingDeclaredBy` are exported from an SFC and
 * `scanSummary` lives beside a composable that reads `window.api` — both of which put them in
 * the projects that have a DOM. They are asserted as FUNCTIONS as well as through the render
 * above, because each is a claim `120` makes in words, and a claim reachable only by mounting
 * something is a claim tested through everything that could hide it.
 */
describe('what the window note says, and when it says nothing (120 §6)', () => {
  it('⛔ silence is safe only when the list is unfiltered AND complete', () => {
    // The four states of 120's table, as three answers. Exactly one of them is silence.
    expect(narrowingDeclaredBy({ shown: 179, matched: 179, filtered: false })).toBe(
      'nothing-to-declare',
    )
    expect(narrowingDeclaredBy({ shown: 200, matched: 2027, filtered: false })).toBe('window-note')
    expect(narrowingDeclaredBy({ shown: 200, matched: 1063, filtered: true })).toBe('window-note')
    // Filtered and complete: the note has nothing to report — nothing is truncated — so the sticky
    // count on the facet row carries the fact instead. A filtered list is never silent.
    expect(narrowingDeclaredBy({ shown: 43, matched: 43, filtered: true })).toBe('pinned-count')
  })

  it('the way past the window is the one that would actually help', () => {
    // Four combinations, four sentences. "Search to reach the rest", read by somebody who has just
    // searched, is advice to do the thing they did; "Narrow the search", read by somebody who has
    // narrowed by facet and typed nothing, names a box they are not using.
    expect(windowNoteCta({ searching: false, filtered: false })).toBe('Search')
    expect(windowNoteCta({ searching: true, filtered: false })).toBe('Narrow the search')
    expect(windowNoteCta({ searching: false, filtered: true })).toBe('Narrow the filters')
    expect(windowNoteCta({ searching: true, filtered: true })).toBe('Narrow the filters or search')
  })
})

describe('one scan, surfaced twice (120 §7)', () => {
  const report = (over: Partial<AdoptionReport> = {}): AdoptionReport => ({
    found: 0,
    adopted: 0,
    alreadyKnown: 0,
    imported: 0,
    descentsLearned: 0,
    named: 0,
    skipped: [],
    ...over,
  })

  it('says what the scan did, including the number this task made real', () => {
    expect(scanSummary(report({ found: 3, adopted: 1, alreadyKnown: 2 }))).toBe(
      '1 adopted, 2 already known',
    )
    // ⚑ The clause 121 added. `120`'s mock draws "153 descents back-filled" and the report carried
    // no such field, so the caption would have had to invent one (106).
    expect(scanSummary(report({ found: 9, adopted: 0, alreadyKnown: 9, descentsLearned: 8 }))).toBe(
      '0 adopted, 9 already known, 8 descents recorded',
    )
    // One is one.
    expect(scanSummary(report({ found: 1, alreadyKnown: 1, descentsLearned: 1 }))).toContain(
      '1 descent recorded',
    )
    // …and zero of them is silence rather than "0 descents recorded", which would be a phrase
    // about work that did not happen on every ordinary scan.
    expect(scanSummary(report({ found: 3, adopted: 1, alreadyKnown: 2 }))).not.toContain('descent')
    // ⚑ 727 · R87 — a conversation of this app's that the scan gave back its ref is said, and none
    // is silence.
    expect(scanSummary(report({ found: 2, adopted: 0, alreadyKnown: 2, named: 1 }))).toBe(
      '0 adopted, 2 already known, 1 conversation this app started can be reopened again',
    )
    expect(scanSummary(report({ found: 2, alreadyKnown: 2, named: 2 }))).toContain(
      '2 conversations this app started can be reopened again',
    )
    expect(scanSummary(report({ found: 3, adopted: 1, alreadyKnown: 2 }))).not.toContain('reopened')
  })

  it('distinguishes the two ways a scan can find nothing', () => {
    // 169 §2 · the scan reads the homes THIS APP provisions — one per profile — so that is what it
    // names. The user's own `~/.claude` is a different sweep with a different button (046).
    expect(scanSummary(report())).toBe("nothing found in any profile's folder")
    // "nothing found" while the panel below lists what was found and rejected would be the summary
    // contradicting its own detail.
    expect(
      scanSummary(
        report({ skipped: [{ provider: 'claude', path: '/homes/x.jsonl', reason: 'unreadable' }] }),
      ),
    ).toBe('nothing new to adopt — see below')
    // No scan has been run: no result, not a result of zero.
    expect(scanSummary(null)).toBeNull()
  })
})

/* ------------------------------------------------------------------ 8 · one scan */

describe('⛔ Check homes is the SAME operation the rail runs (120 §7)', () => {
  it('Sessions runs it, and re-reads the list the scan just changed', async () => {
    const m = await open()
    expect(scans).toBe(0)
    m.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(scans).toBe(1)
    // It re-reads: the scan back-fills the descent the Kind facet reads, so a page left as it was
    // would be showing the answer to the question asked before the scan.
    expect(reads.length).toBeGreaterThan(1)
    // …and it reports what it did, in the sentence the rail uses. Including the number that made
    // putting this button here worth doing.
    expect(m.q('library-scan-note').textContent).toContain('8 descents recorded')
  })

  it('…and the rail runs the same one, and says the same thing about it', async () => {
    // The behavioural half of "one operation, surfaced twice". The structural half — that there is
    // exactly ONE call site in the whole renderer — is `library-filters.test.ts`.
    stub()
    const rail = mount(ResumableSessions, {}, { width: 300, height: 600 })
    await nextTick()
    await nextTick()
    rail.q('scan-sessions').click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(scans).toBe(1)
    const railText = rail.q('scan-summary').textContent?.trim() ?? ''
    expect(railText).toContain('8 descents recorded')

    // ⛔ **Word for word, and COMPARED** (review). Two `toContain`s over different substrings of
    // one sentence do not assert that it is one sentence, which is the whole of "never forked".
    rail.unmount()
    const library = await open()
    library.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()
    // The library's line prefixes the summary with its own freshness stamp, so the summary is the
    // tail — and the tail has to be identical, not merely overlapping.
    const libraryText = library.q('library-scan-note').textContent?.trim() ?? ''
    expect(libraryText).toContain('1 adopted, 8 already known')
    expect(libraryText.endsWith(railText), `"${libraryText}" does not end with "${railText}"`).toBe(
      true,
    )
  })

  it('⛔ a scan that fails says so WITHOUT claiming the list is partial', async () => {
    /**
     * Two operations, two consequences. The first version of this routed the scan's failure into
     * `error`, which draws *"Couldn't read your provider homes"* over the list — and, wherever
     * there are rows, *"The list below is only what could be reached."* That sentence would have
     * been false: the rows came from a read that succeeded, and what failed was a scan.
     */
    const m = await open()
    stubbed().api!.runtime.adoptSessions = () =>
      Promise.reject(new Error('EACCES: /Users/x/.codex'))
    m.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()

    expect(m.q('library-scan-error').textContent).toContain('EACCES')
    // ⛔ Not the read's banner, and not the sentence that qualifies the list.
    expect(m.all('library-error')).toEqual([])
    expect(m.q('session-library').textContent).not.toContain('The list below')
    // …and the list it did not qualify is still there — the paired positive, without which this
    // passes on a surface that had blanked itself.
    expect(m.q('library-rows').querySelectorAll('.row')).toHaveLength(ROWS.length)
  })

  it('a second press on the SAME surface does not queue a second follow-up', async () => {
    /**
     * ⚠️ **Asserted on the follow-up, not on the scan count** (found by mutation). Once the run in
     * flight is shared, two presses coalesce into one `adoptSessions()` whichever guard is in
     * place — so `scans === 1` was true with the per-surface guard deleted, and said nothing. What
     * that guard still prevents is this surface running its own re-read twice for one scan.
     */
    const m = await open()
    const before = reads.length
    m.q('library-check-homes').click()
    m.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(scans).toBe(1)
    expect(reads.length - before, 'one press, one re-read').toBe(1)
  })

  it('⛔ the State disclosure can be got out of, by key and by pointer', async () => {
    /**
     * A native `<details>` closes on neither Escape nor an outside click, and the argument for
     * using one was that a hand-written popover is a focus map somebody has to get right. That is
     * true of opening it and says nothing about leaving: a keyboard user who tabbed in had only
     * Shift+Tab, and a mouse user clicking a row underneath hit the panel and got nothing.
     */
    const m = await open()
    const box = m.q('library-facet-state') as HTMLDetailsElement
    box.open = true
    box.dispatchEvent(new Event('toggle'))
    await nextTick()
    expect(m.q('library-state-behind').getBoundingClientRect().height).toBeGreaterThan(0)

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(box.open, 'Escape did not close the disclosure').toBe(false)
    // …and focus came back to the control that opens it, rather than being left nowhere.
    expect(document.activeElement).toBe(box.querySelector('summary'))

    // A press anywhere else closes it too.
    box.open = true
    box.dispatchEvent(new Event('toggle'))
    await nextTick()
    m.q('library-rows').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(box.open, 'a press outside did not close the disclosure').toBe(false)

    // …and a press INSIDE it does not — the paired positive, without which "closes" could mean
    // "closes on every interaction", which would make the five toggles unusable.
    box.open = true
    box.dispatchEvent(new Event('toggle'))
    await nextTick()
    m.q('library-state-behind').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(box.open).toBe(true)
  })

  it('⛔ …and a press on the OTHER surface joins that run rather than starting a second', async () => {
    /**
     * **The concurrency hole 121 opened by adding the second button** (review). The busy flag is
     * per-surface — deliberately, so each reports its own press — and both surfaces are mounted at
     * once: `SideRail` keeps `ResumableSessions` under a `v-show`. So two `adoptSessions()` passes
     * could interleave over the same homes, and that pass adopts by asking the store first, which
     * is a check-then-write. The run in flight is now shared; a second press joins it.
     */
    let release: ((value: AdoptionReport) => void) | undefined
    stub()
    stubbed().api!.runtime.adoptSessions = () => {
      scans++
      return new Promise<AdoptionReport>((resolve) => {
        release = resolve
      })
    }
    const library = mount(SessionLibrary, {}, { width: 1100, height: 900 })
    const rail = mount(ResumableSessions, {}, { width: 300, height: 600 })
    await nextTick()
    await nextTick()

    library.q('library-check-homes').click()
    await nextTick()
    rail.q('scan-sessions').click()
    await nextTick()

    // ⛔ ONE pass over the homes, not two.
    expect(scans).toBe(1)

    // …and both surfaces get the answer, which is why joining beats refusing.
    release!(REPORT)
    await nextTick()
    await nextTick()
    await nextTick()
    expect(library.q('library-scan-note').textContent).toContain('8 descents recorded')
    expect(rail.q('scan-summary').textContent).toContain('8 descents recorded')
  })

  it('⛔ the freshness line has a clock, so it does not read "0m ago" for ever', async () => {
    /**
     * `ago()` reads the wall clock, which is not a reactive dependency — so `lastChecked` was a
     * `computed` that re-evaluated only when another scan landed, and the note froze at the moment
     * of the press (review). Its own doc comment says a line saying "just now" for ever is exactly
     * what it must not be.
     *
     * ⚠️ **Asserted on the timer rather than by waiting a minute**, and it is the timer that was
     * missing: there was no interval at all. The clock's effect is covered by `ago()` taking the
     * `now` it is given, which is a plain function of its arguments.
     */
    const real = window.setInterval.bind(window)
    const periods: number[] = []
    const cleared: number[] = []
    const realClear = window.clearInterval.bind(window)
    window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      periods.push(ms ?? 0)
      return real(fn, ms, ...rest)
    }) as typeof window.setInterval
    window.clearInterval = ((id?: number) => {
      if (id !== undefined) cleared.push(id)
      realClear(id)
    }) as typeof window.clearInterval
    try {
      const m = await open()
      // ⛔ No scan has been run, so there is nothing to age and no clock to run.
      expect(periods).toEqual([])

      m.q('library-check-homes').click()
      await nextTick()
      await nextTick()
      await nextTick()
      m.q('library-scan-note')
      expect(periods, 'the freshness line was left without a clock').toContain(60_000)

      // …and it is stopped when the surface goes, rather than waking a component that is gone.
      const before = cleared.length
      m.unmount()
      expect(cleared.length).toBeGreaterThan(before)
    } finally {
      window.setInterval = real as typeof window.setInterval
      window.clearInterval = realClear as typeof window.clearInterval
    }
  })

  it('the sentence that says "see below" has something below it', async () => {
    // `scanSummary` is the rail's, word for word, and the rail renders the report's rejects under
    // it. Saying it here with nothing beneath would be 106 by omission.
    stub()
    stubbed().api!.runtime.adoptSessions = () =>
      Promise.resolve({
        ...REPORT,
        found: 0,
        adopted: 0,
        alreadyKnown: 0,
        descentsLearned: 0,
        named: 0,
        skipped: [{ provider: 'codex', path: '/homes/x.jsonl', reason: 'archived in Codex' }],
      })
    const m = mount(SessionLibrary, {}, { width: 1100, height: 900 })
    await nextTick()
    await nextTick()
    m.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()

    expect(m.q('library-scan-note').textContent).toContain('see below')
    const panel = m.q('library-scan-skipped')
    expect(panel.textContent).toContain('archived in Codex')
    expect(panel.textContent).toContain('/homes/x.jsonl')
  })

  it('…and it is not drawn when the scan refused nothing', async () => {
    // The paired negative: a disclosure reading "0 found but not adopted" on every clean scan is
    // furniture, and it would make the assertion above pass for the wrong reason.
    const m = await open()
    m.q('library-check-homes').click()
    await nextTick()
    await nextTick()
    await nextTick()
    m.q('library-scan-note')
    expect(m.all('library-scan-skipped')).toEqual([])
  })
})
