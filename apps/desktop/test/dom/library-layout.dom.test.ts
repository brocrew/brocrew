import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { ALL_PROVIDER_FOLDERS } from '../../src/shared/runtime-ipc'
import SessionLibrary, {
  originChipOf,
  recencyOf,
  windowNoteShows,
} from '../../src/renderer/src/components/SessionLibrary.vue'
import type {
  ImportedFromHome,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  RebuiltLedger,
} from '../../src/shared/runtime-ipc'
import {
  luminance,
  mount,
  over,
  paintedBackground,
  parseColor,
  unmountAll,
  type Mounted,
} from './harness'

/**
 * **The session library, rebuilt to 104's design** (105).
 *
 * ⚠️ **Why this is a browser test and not a `*.render.test.ts`.** Four of this task's criteria are
 * about things an SSR string cannot answer, and 083 is the file that established the distinction:
 *
 *  - *"the surface cannot overflow horizontally"* — a rendered string has no layout, so
 *    `scrollWidth` does not exist for it to be compared against anything.
 *  - *"a readable row has no button and THE ROW is the target"* — the claim is about what a click
 *    at a point on the page reaches, which needs a hit-testable document.
 *  - *"the surface is legible in light"* — 091 caught the original defect by COMPOSITED contrast:
 *    the library declared `data-chat-theme` and painted no page of its own, so paper ink landed on
 *    the dark app frame. No element's own declarations were wrong; what was wrong was what showed
 *    through them, which only a real cascade can report.
 *  - *"every state renders, both themes, three widths"* — the widths are the point.
 *
 * ⚠️ **`overflowing` below is a second copy of `launcher-layout.dom.test.ts`'s**, and that is named
 * rather than hidden. Sharing it needs hoisting it into `harness.ts`, and the harness is deliberately
 * about mounting and paint rather than about any one surface's layout rules. Two copies can drift;
 * if they do, these two files will disagree about what "too wide" means, and this comment is where
 * to look.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()
const HOUR = 3_600_000
const DAY = 24 * HOUR
/**
 * ⛔ **An instant that is the same CALENDAR DAY as `NOW`, whatever time the suite runs** (305).
 *
 * `recencyOf` bands by calendar day on purpose — *"a conversation from 9pm yesterday is not today
 * at 10am"* — so `NOW - 60_000` is yesterday for the sixty seconds after midnight, and the recency
 * test below failed exactly once, at **00:00:44**, then passed at 00:01:28. A test that is wrong for
 * one minute in every day is wrong; it just does not say so most of the time.
 *
 * Midnight rather than a fixed date, so it stays in the past and on the same day as the real clock,
 * which is what the rest of this file's fixtures are measured against.
 */
const TODAY = new Date(NOW).setHours(0, 0, 0, 0)

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'p::thread-1',
  provider: 'claude',
  providerSessionId: 'thread-1',
  recordId: 'sess_1',
  cwd: '/work/project-alpha',
  title: 'Refactor the authentication module',
  preview: 'Can you help me refactor the authentication module?',
  createdAt: NOW - 2 * HOUR,
  updatedAt: NOW - HOUR,
  bytes: 1_048_576,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  derived: null,
  /**
   * ⚠️ **Not null, because in production it almost never is on a row of this shape** (105 review).
   * A conversation adopted out of a user home is `readable` AND unresumable — the store fills
   * `unresumableReason` with the sentence 151 rewrote, below. With the fixture defaulting to null, `offersNothing`'s `!entry.readable` clause was
   * covered by nothing: every row was already suppressed by the third clause alone, so deleting the
   * first would have shipped a spurious "Can't be carried on" onto the most common row there is.
   */
  lastEnding: 'completed',
  unresumableReason:
    "one of your own Claude conversations, found in Claude's own folder — BroBot can read it " +
    "here, but a reopen would start Claude in BroCrew's own folder, where this conversation is not",
  child: null,
  ...over,
})

/** One of every row kind the design names, so no negative below can pass over an absent list. */
const ZOO: LibraryEntry[] = [
  // Ours and reopenable, so the store has no reason to give: the null case, kept alongside the
  // populated default above so both halves of the field are on the page at once.
  entry({
    id: 'ours::current',
    origin: 'ours',
    derived: 'current',
    title: 'Ours, complete',
    unresumableReason: null,
    child: null,
  }),
  entry({
    id: 'ours::null',
    origin: 'ours',
    derived: null,
    title: 'Ours, nothing projected',
    unresumableReason: null,
    child: null,
  }),
  entry({ id: 'home::stale', derived: 'stale', title: 'Imported and behind its archive' }),
  entry({ id: 'home::rebuilding', derived: 'rebuilding', title: 'Rebuild in flight' }),
  entry({ id: 'home::failed', derived: 'failed', title: 'The last rebuild did not land' }),
  entry({
    id: 'home::unimported',
    recordId: null,
    readable: false,
    derived: null,
    title: 'Never imported, still over there',
    unresumableReason: 'it has not been imported yet — import it to read it here',
    child: null,
  }),
  entry({
    id: 'only::here',
    onDisk: false,
    bytes: null,
    derived: 'current',
    title: 'The provider deleted its copy',
  }),
  entry({
    id: 'ours::nothing',
    origin: 'ours',
    recordId: 'sess_nothing',
    providerSessionId: null,
    readable: false,
    bytes: null,
    derived: null,
    title: 'Recorded, and there is nothing to open',
    unresumableReason: 'no turn was ever taken in this one, so there is nothing to reopen',
    child: null,
  }),
]

const page = (over: Partial<LibraryPage> = {}): LibraryPage => ({
  entries: ZOO,
  matched: ZOO.length,
  counts: {
    total: ZOO.length,
    ours: 3,
    userHome: 5,
    restored: 0,
    imported: 4,
    notImported: 1,
    onlyHere: 1,
    // ⚠️ **Two providers, and the Provider facet is built from exactly this** (121). The renderer
    // may not name one (039), so its menu options are the backend's tally — a fixture with one
    // provider in it would leave the facet with a single option and prove nothing about a choice.
    providers: [
      { provider: 'claude', total: 6 },
      { provider: 'codex', total: 2 },
    ],
  },
  skipped: [{ provider: 'claude', path: '/homes/p/sessions/bad.jsonl', reason: 'unexpected EOF' }],
  skippedTotal: 2,
  ...over,
})

/**
 * ⚠️ **The stub's shape matches the declared global, and the cast goes through `unknown`** — the
 * same constraint `surface-boundaries.dom.test.ts` documents. A narrower `listLibrary()` is not
 * comparable to the declared one and `vue-tsc` says so, which is the type system pointing out that
 * the fake and the thing it stands in for have drifted.
 */
type LibraryApi = {
  runtime: {
    listLibrary: (input: LibraryQuery) => Promise<LibraryPage>
    importUserHomeSession: () => Promise<ImportedFromHome>
    rebuildLedger: () => Promise<RebuiltLedger>
  }
}

const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

/** Every read this component makes, so a test can see that a keystroke reached the main process. */
let reads: LibraryQuery[] = []

function stub(answer: (query: string) => LibraryPage): void {
  reads = []
  stubbed().api = {
    runtime: {
      listLibrary: (input) => {
        reads.push(input)
        return Promise.resolve(answer(input.query ?? ''))
      },
      importUserHomeSession: () =>
        Promise.resolve({ outcome: 'imported', sessionId: 'sess_new', readable: true, note: 'ok' }),
      rebuildLedger: () =>
        Promise.resolve({ outcome: 'imported', status: { present: true } } as RebuiltLedger),
    },
  }
}

interface Opened extends Mounted {
  /** Every entry the surface asked to read, in order. */
  readonly opened: LibraryEntry[]
}

/**
 * ⚠️ **`theme` sets the carrier after mount; it was a `chatLight` prop until 344.** The library
 * renders `data-chat-theme="light"` unconditionally now, so a test that wants the dark ramp — and
 * exactly one below does, to prove the page really moves — has to say so on the element that owns
 * the scope.
 */
async function open(
  answer: LibraryPage | ((query: string) => LibraryPage),
  box: { width?: number; theme?: 'light' | 'dark' } = {},
): Promise<Opened> {
  stub(typeof answer === 'function' ? answer : () => answer)
  const opened: LibraryEntry[] = []
  const m = mount(
    SessionLibrary,
    { onRead: (e: LibraryEntry) => opened.push(e) },
    { width: box.width ?? 1100, height: 900 },
  )
  if (box.theme) m.q('session-library').setAttribute('data-chat-theme', box.theme)
  // Two ticks: one for the resolved `listLibrary` promise, one for the render it schedules.
  await nextTick()
  await nextTick()
  return Object.assign(m, { opened })
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Type into the search box and let the 180ms debounce and its re-read land. */
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

const named = (el: Element): string => {
  const cy = el.getAttribute('data-cy')
  if (cy) return `[data-cy=${cy}]`
  const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
}

/**
 * Everything under the surface that sticks out sideways past the box it is in.
 *
 * `scrollWidth > clientWidth` is the browser's own answer to "is there more here than fits", which
 * is the same question a horizontal scrollbar asks. Read on every element rather than only the
 * root: a root that fits while a row three levels down does not is the shape the defect takes.
 *
 * ⚠️ **Two exclusions, and both are the difference between "too wide" and "handled".** An element
 * whose `overflow-x` is `hidden`/`clip` contains its own overflow visibly — that is what an
 * ellipsis IS, and the title and the `cwd` are supposed to end in one. `auto` and `scroll` are
 * deliberately NOT excluded: those produce the scrollbar, which is the defect itself. Form fields
 * scroll their VALUE inside a fixed box by design and move nothing on the page.
 */
function overflowing(m: Mounted): string[] {
  const contained = (el: Element): boolean => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
    const overflowX = getComputedStyle(el).overflowX
    return overflowX === 'hidden' || overflowX === 'clip'
  }
  const root = m.q('session-library')
  return [root, ...root.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !contained(el))
    .map((el) => `${named(el)} — ${el.scrollWidth}px of content in ${el.clientWidth}px`)
}

/* ------------------------------------------------------------------ 1 · the window note */

describe('the list says when it is a window, and only then (104 §1)', () => {
  it('is silent when nothing is truncated — and the list it is silent about is real', () => {
    // The pairing 103's review asked for: an absence asserted on a surface where the thing could
    // not have appeared is an absence about nothing. The rows are the positive.
    expect(windowNoteShows({ shown: 179, matched: 179 })).toBe(false)
    expect(windowNoteShows({ shown: 0, matched: 0 })).toBe(false)
  })

  it('speaks the moment the cap bites, and names both numbers', () => {
    expect(windowNoteShows({ shown: 200, matched: 201 })).toBe(true)
    expect(windowNoteShows({ shown: 200, matched: 2041 })).toBe(true)
  })

  it('rendered: silent at 8 of 8', async () => {
    const m = await open(page())
    m.q('library-rows')
    expect(m.all('library-window-note')).toEqual([])
  })

  it('rendered: spoken at 8 of 2041, in the words that name search as the way past it', async () => {
    const m = await open(page({ matched: 2041 }))
    const note = m.q('library-window-note').textContent ?? ''
    // Both numbers, because "showing the most recent" without them is a shrug, and the number that
    // matters is `matched` — what the query actually found — not `counts.total`.
    expect(note).toContain('8')
    expect(note).toContain('2041')
    expect(note.toLowerCase()).toContain('search')
    // And the list is still there: a truncation note that replaced the rows would be a worse lie
    // than the silence it fixes.
    expect(m.q('library-rows').querySelectorAll('.row').length).toBe(ZOO.length)
  })

  it('and once you are already in the box, it stops telling you to use the box', async () => {
    // 105 review: "Search to reach the rest", read by somebody who has just searched and is still
    // capped, is advice to do the thing they did. From there the remedy is a narrower term.
    const m = await open(() => page({ matched: 2041 }))
    expect(m.q('library-window-note').textContent).toContain('Search to reach the rest')
    await search(m, 'parser')
    expect(m.q('library-window-note').textContent).toContain('Narrow the search to reach the rest')
  })

  it('the note reads `matched`, not `counts.total` — a narrowed search is not a truncation', async () => {
    // 4 of 4 matched, out of a library of 900. `counts` is the whole library and never moves with
    // the query, so a note built on it would fire on every search that narrowed anything.
    const four = ZOO.slice(0, 4)
    const m = await open(
      page({ entries: four, matched: four.length, counts: { ...page().counts, total: 900 } }),
    )
    expect(m.q('library-counts').textContent).toContain('900')
    expect(m.all('library-window-note')).toEqual([])
  })
})

/* ------------------------------------------------------------------ 2 · the row */

describe('a readable row is the target, and carries no action-column button (104 §2)', () => {
  const rowOf = (m: Mounted, id: string): HTMLElement => m.q(`library-row-${id}`)

  it('a current file can be rebuilt, archived or deleted, and the row is the read target', async () => {
    const m = await open(page())
    const row = rowOf(m, 'ours::current')
    const buttons = [...row.querySelectorAll('button')]
    // A conversation this app records also offers Archive, and Delete, which opens a confirmation.
    expect(buttons.map(named)).toEqual([
      '[data-cy=library-rebuild-ours::current]',
      '[data-cy=library-archive-ours::current]',
      '[data-cy=library-delete-ours::current]',
      '[data-cy=library-read-ours::current]',
    ])

    // Rebuild is an action button; the controls for looking at a row remain flat.
    const rebuild = m.q('library-rebuild-ours::current')
    expect(getComputedStyle(rebuild).borderTopWidth).toBe('1px')
    for (const button of buttons.filter((button) => button !== rebuild)) {
      const style = getComputedStyle(button)
      expect(style.borderTopWidth).toBe('0px')
      expect(parseColor(style.backgroundColor)?.[3] ?? 0).toBe(0)
    }
  })

  it('clicking the row body opens it — the row is the target, not the cue', async () => {
    const m = await open(page())
    const row = rowOf(m, 'ours::current')
    // The title, which is as far from the cue as this row gets.
    ;(row.querySelector('.r-title') as HTMLElement).click()
    expect(m.opened.map((e) => e.id)).toEqual(['ours::current'])
  })

  it('a row with nothing to read is not a target, and its column offers nothing to open', async () => {
    const m = await open(page())
    const row = rowOf(m, 'ours::nothing')
    // It is recorded here, so it can be archived or deleted; nothing to read, so no read cue.
    expect([...row.querySelectorAll('.row-act button')].map(named)).toEqual([
      '[data-cy=library-archive-ours::nothing]',
      '[data-cy=library-delete-ours::nothing]',
    ])
    ;(row.querySelector('.r-title') as HTMLElement).click()
    expect(m.opened).toEqual([])
    // The control: a row this app holds no record of offers no Delete.
    expect(m.all('library-delete-home::unimported')).toEqual([])
  })

  it('a click that lands on a control belongs to the control, not to the row', async () => {
    const m = await open(page())
    // Rebuild sits INSIDE a readable row. Pressing it must not also open the conversation.
    m.q('library-rebuild-home::stale').click()
    await nextTick()
    expect(m.opened).toEqual([])

    /**
     * ⚠️ **And the cue is where that guard is actually observable — the Rebuild press is not.**
     * Measured while mutation-testing this file: with the `closest('button')` guard deleted, the
     * Rebuild press STILL does not open the row. `rebuildEntry` mutates reactive state before the
     * event has finished bubbling, Vue re-patches the row's own click invoker during the flush,
     * and its invoker then declines an event whose `timeStamp` predates the attachment. That is a
     * property of the framework, not of this surface, and a guard "covered" by it is not covered.
     *
     * The read cue has no such accident: its handler emits and touches no state, so without the
     * guard the row's handler runs too and ONE press opens the conversation TWICE. That is the
     * user-visible shape of the defect, so that is what is asserted.
     */
    m.q('library-read-ours::current').click()
    await nextTick()
    expect(
      m.opened.map((e) => e.id),
      'one press, one open',
    ).toEqual(['ours::current'])
  })

  it('a click that ends a text selection is a copy, not a navigation', async () => {
    const m = await open(page())
    const cwd = rowOf(m, 'ours::current').querySelector('.r-cwd') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(cwd)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(selection.toString().trim()).not.toBe('')

    cwd.click()
    expect(m.opened).toEqual([])

    // Paired positive — with the selection dropped, the same click opens it. Without this the test
    // above passes for any reason at all, including the row never having been a target.
    selection.removeAllRanges()
    cwd.click()
    expect(m.opened.map((e) => e.id)).toEqual(['ours::current'])

    /**
     * ⚠️ **…and a selection in a DIFFERENT row does not disable this one** (105 review). The guard
     * reads `window.getSelection()`, which is a property of the page and not of the row under the
     * cursor, so the unscoped version refused every click on the whole list while any text anywhere
     * stayed highlighted — silently, with nothing on screen to explain it.
     */
    const elsewhere = document.createRange()
    elsewhere.selectNodeContents(rowOf(m, 'home::stale').querySelector('.r-cwd')!)
    selection.removeAllRanges()
    selection.addRange(elsewhere)
    expect(selection.toString().trim()).not.toBe('')

    cwd.click()
    expect(
      m.opened.map((e) => e.id),
      'a selection in another row must not disable this one',
    ).toEqual(['ours::current', 'ours::current'])
    selection.removeAllRanges()
  })

  it('Import is the lone accent CTA, and only where nothing is readable yet', async () => {
    const m = await open(page())
    const row = rowOf(m, 'home::unimported')
    expect([...row.querySelectorAll('button')].map(named)).toEqual([
      '[data-cy=library-import-home::unimported]',
    ])
    // It is the one control on this surface painted in the accent ramp.
    const bg = parseColor(getComputedStyle(m.q('library-import-home::unimported')).backgroundColor)
    expect(bg?.[3] ?? 0).toBeGreaterThan(0)
    // And no readable row anywhere offers one.
    for (const id of ['ours::current', 'home::stale', 'only::here']) {
      expect(m.all(`library-import-${id}`)).toEqual([])
    }
  })

  it('⛔ …and `recordId === null` is what "nothing readable yet" MEANS (119)', async () => {
    /**
     * ⚠️ **The negatives above are all confounded by `readable`**, so none of them could have
     * caught the condition being widened. `119` was asked whether `canImport`'s `recordId === null`
     * should be relaxed to cover an adopted row whose transcript we do not hold — a row we HAVE and
     * hold nothing of — and the answer is no: this Import gives a file in the user's home a row
     * here, and that row already has one. Widening it would import a second copy of a conversation
     * we already hold. That row's import lives on the closed-conversations row instead, as its own
     * command, and this asserts the condition it was not allowed to weaken to get there.
     */
    const held = entry({
      id: 'ours::empty',
      recordId: 'sess_held',
      origin: 'ours',
      readable: false,
      onDisk: false,
      bytes: null,
      derived: null,
      title: 'Adopted, and we hold none of its messages',
      unresumableReason: 'a sub-agent conversation — another agent drove it',
      child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing', role: null },
    })
    const m = await open(page({ entries: [held, ...ZOO], matched: ZOO.length + 1 }))

    // Not readable, and still no Import — because we already hold the row.
    expect(m.all('library-import-ours::empty')).toEqual([])
    // ⚑ **The paired positive on the same page, through the same render**: the row that genuinely
    // has no record of ours does offer it. Without this the assertion above would be satisfied by a
    // library that had stopped drawing Import anywhere.
    expect(m.all('library-import-home::unimported')).toHaveLength(1)
  })

  it('an import that took nothing is not painted like an import that had nothing to do', async () => {
    /**
     * ⚠️ **Endings that took nothing fell through to the benign colour** (105 review).
     * `rebuildEntry` maps its outcomes into three tones on purpose; `importEntry` stores the host's
     * word verbatim, so an ending the CSS did not know rendered in exactly the ink of
     * `up-to-date`, which means "you already have all of it". Opposite answers, one colour.
     */
    stub(() => page())
    stubbed().api!.runtime.importUserHomeSession = () =>
      Promise.resolve({
        outcome: 'nothing-readable',
        sessionId: null,
        readable: false,
        note: 'Its file holds no readable conversation.',
      })
    const m = mount(SessionLibrary, {}, { width: 1095, height: 900 })
    await nextTick()
    await nextTick()

    m.q('library-import-home::unimported').click()
    await nextTick()
    await nextTick()
    await nextTick()

    const line = m.q('library-outcome-home::unimported')
    expect(line.dataset.outcome).toBe('nothing-readable')
    const warned = parseColor(getComputedStyle(line).color)!
    // Warmer than it is cool — the amber register, not the neutral one.
    expect(warned[0]! - warned[2]!).toBeGreaterThan(20)
  })

  it('the one surviving provenance phrase is on the one row that earns it', async () => {
    // Four of `provenance()`'s five branches were unreachable and are gone (105 review). This is
    // the one that is reachable, and it is only reachable where Import is offered.
    //
    // ⚠️ **169 §2 · it names the program now.** *"your provider home"* was this app's word for
    // `~/.claude`, on the one row whose whole point is that the conversation is over there.
    const m = await open(page())
    expect(rowOf(m, 'home::unimported').textContent).toContain(
      "in Claude's own folder, not imported",
    )
    expect(rowOf(m, 'home::unimported').textContent).not.toContain('provider home')
    for (const id of ['ours::current', 'home::stale', 'only::here']) {
      expect(rowOf(m, id).textContent).not.toContain('not imported')
    }
  })

  it('the origin chip says which of the four a row is, from the same fields the phrase reads', () => {
    const chip = (e: Omit<Parameters<typeof originChipOf>[0], 'provider'>): string =>
      originChipOf({ provider: 'claude', ...e }).label
    expect(chip({ origin: 'ours', recordId: 'r', onDisk: false })).toBe('ours')
    // 169 §2 · the chip reads the row's own provider rather than naming the layer it lives in.
    expect(chip({ origin: 'user-home', recordId: null, onDisk: true })).toBe("in Claude's folder")
    expect(
      originChipOf({ provider: 'codex', origin: 'user-home', recordId: null, onDisk: true }).label,
    ).toBe("in Codex's folder")
    expect(chip({ origin: 'user-home', recordId: 'r', onDisk: true })).toBe('imported')
    // The one the sweep exists for: we hold it and the provider does not.
    expect(chip({ origin: 'user-home', recordId: 'r', onDisk: false })).toBe('only here')
  })

  it('the chip is rendered, once per row, and “only here” is not painted as a caution', async () => {
    const m = await open(page())
    for (const e of ZOO) {
      expect(rowOf(m, e.id).querySelectorAll('.chip')).toHaveLength(1)
    }
    expect(rowOf(m, 'only::here').querySelector('.chip')!.textContent!.trim()).toBe('only here')
    // 104's rule: it is the sweep's value, not a warning. The amber ramp is reserved for `behind`.
    const amber = getComputedStyle(m.q('library-behind-home::stale').querySelector('.txt')!).color
    expect(getComputedStyle(rowOf(m, 'only::here').querySelector('.chip')!).color).not.toBe(amber)
  })

  it('the row that offers nothing says why it cannot be carried on — and no other row does', async () => {
    const m = await open(page())
    expect(m.q('library-why-ours::nothing').textContent).toContain('no turn was ever taken')
    // Not on the un-imported row: the Import button beside it already says it, louder.
    expect(m.all('library-why-home::unimported')).toEqual([])
    expect(m.all('library-why-ours::current')).toEqual([])

    /**
     * ⚠️ **The clause that had nothing covering it: `!entry.readable`** (105 review, and the first
     * fix for it picked the wrong row.) The witness has to fail EVERY other clause: readable, ours
     * to read (so no Import), `current` (so no Rebuild), and carrying a reason. `only::here` is
     * exactly that — and it is what a conversation adopted out of a user home actually looks like,
     * since the store fills the reason on every one of them. `home::stale` is not a witness: its
     * `stale` derived state suppresses the line through `!canRebuild` regardless.
     *
     * Delete `!entry.readable` and this row grows "Can't be carried on" under a working Read cue.
     */
    const witness = ZOO.find((e) => e.id === 'only::here')!
    expect({
      readable: witness.readable,
      importable: witness.recordId === null,
      rebuildable: witness.derived === 'stale' || witness.derived === 'failed',
      hasReason: witness.unresumableReason !== null,
    }).toEqual({ readable: true, importable: false, rebuildable: false, hasReason: true })
    expect(m.all('library-why-only::here')).toEqual([])
  })

  it('…and a row that can still be rebuilt is not a row that offers nothing', async () => {
    /**
     * The other missing clause (105 review). The store reaches `failed` off the failure column
     * BEFORE it looks at whether anything is present, so unreadable-and-failed is a real row — and
     * it was drawing "Can't be carried on" directly above a live **Try again**. The sentence is not
     * false there; its justification is, because the row plainly does offer something.
     */
    const stuck = entry({
      id: 'ours::retryable',
      origin: 'ours',
      providerSessionId: null,
      readable: false,
      bytes: null,
      derived: 'failed',
      title: 'Unreadable, and the last rebuild failed',
      unresumableReason:
        'we can no longer read where this conversation lives, so it cannot be reopened',
      child: null,
    })
    const m = await open(page({ entries: [stuck], matched: 1 }))
    m.q('library-rebuild-ours::retryable')
    expect(m.all('library-why-ours::retryable')).toEqual([])
  })
})

/* ------------------------------------------------------------------ 3 · derived */

describe('a row with nothing wrong says nothing about completeness (065, 104 §2)', () => {
  it('current files offer Rebuild without a completeness warning; recorded rows have neither', async () => {
    const m = await open(page())

    // The negatives — and they are asserted in the SAME mount as the positives below, so neither
    // can pass over an empty list.
    for (const id of ['ours::null', 'only::here']) {
      expect(m.all(`library-behind-${id}`), `${id} claimed something about completeness`).toEqual(
        [],
      )
      expect(m.all(`library-rebuild-${id}`)).toEqual([])
    }
    expect(m.q('library-rebuild-ours::current').textContent!.trim()).toBe('Rebuild')
    expect(m.q('library-behind-ours::current').querySelectorAll('.txt')).toHaveLength(0)

    // The positives, with their own words and their own control.
    expect(m.q('library-behind-home::stale').textContent).toContain(
      'Read by an older version of BroCrew.',
    )
    expect(m.q('library-rebuild-home::stale').textContent!.trim()).toBe('Rebuild')

    expect(m.q('library-behind-home::failed').textContent).toContain('did not finish')
    expect(m.q('library-rebuild-home::failed').textContent!.trim()).toBe('Try again')

    // A rebuild in flight is the answer already happening: a line, a spinner, and no second press.
    const flight = m.q('library-behind-home::rebuilding')
    expect(flight.textContent).toContain('Rebuilding its transcript')
    expect(flight.querySelectorAll('.spin')).toHaveLength(1)
    expect(m.all('library-rebuild-home::rebuilding')).toEqual([])
  })

  it('Rebuild is docked INSIDE the line that explains it, not in an action column (104)', async () => {
    const m = await open(page())
    const button = m.q('library-rebuild-home::stale')
    expect(button.closest('[data-cy="library-behind-home::stale"]')).not.toBeNull()
    expect(button.closest('.row-act')).toBeNull()
    // Docked means side by side, on one line — not stacked under the sentence.
    const line = m.q('library-behind-home::stale').getBoundingClientRect()
    const text = m.q('library-behind-home::stale').querySelector('.txt')!.getBoundingClientRect()
    expect(button.getBoundingClientRect().left).toBeGreaterThan(text.right - 1)
    expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(line.top - 1)
  })

  it('the caution register is the real amber ramp, not a token that resolves to nothing (105)', async () => {
    const m = await open(page())
    const behind = m.q('library-behind-home::stale')
    const ink = parseColor(getComputedStyle(behind.querySelector('.txt')!).color)!

    /**
     * ⚠️ **Compared against `--text-soft`, which is what the removed bug ACTUALLY produced** (105
     * review). This first read the ROW's own `color`, which inherits `--text` from `.library` — so
     * reinstating `var(--warning, var(--text-soft))` still left the two unequal and this assertion
     * green, and only the warmth heuristic below was doing any work. The right comparison is the
     * fallback's own value, and the `rebuilding` row paints exactly it, one row away: its caution
     * is deliberately neutral `--text-soft`. If the amber ever collapses back to the fallback, the
     * two `.txt` inks become the same colour and this fires.
     */
    const neutral = parseColor(
      getComputedStyle(m.q('library-behind-home::rebuilding').querySelector('.txt')!).color,
    )!
    expect(ink.slice(0, 3)).not.toEqual(neutral.slice(0, 3))
    // Amber, specifically: warmer than it is cool, in a theme whose body ink is not.
    expect(ink[0]! - ink[2]!).toBeGreaterThan(20)
    // And the line is washed, so the sentence sits on something rather than floating.
    expect(paintedBackground(behind)).not.toEqual(paintedBackground(m.q('library-rows')))
  })
})

/* ------------------------------------------------------------------ 4 · every state */

/** The six the mock's switcher offers, each with the element that proves it is the one on screen. */
const STATES = [
  { what: 'the list', evidence: 'library-rows' },
  { what: 'the 200-row truth', evidence: 'library-window-note' },
  { what: 'first run', evidence: 'library-first-run' },
  { what: 'no match', evidence: 'library-no-match' },
  { what: 'the read failed', evidence: 'library-error' },
  { what: 'skipped, opened', evidence: 'library-skipped' },
] as const

async function openState(
  what: (typeof STATES)[number]['what'],
  box: { width: number; theme?: 'light' | 'dark' },
): Promise<Mounted> {
  if (what === 'no match') {
    const m = await open(
      (query) => (query === '' ? page() : page({ entries: [], matched: 0 })),
      box,
    )
    await search(m, 'adyen refund webhook')
    return m
  }
  if (what === 'first run') {
    const empty = page({ entries: [], matched: 0 })
    return open(
      { ...empty, counts: { ...empty.counts, total: 0 }, skipped: [], skippedTotal: 0 },
      box,
    )
  }
  if (what === 'the read failed') {
    // The only way this surface produces its banner: the read itself throws.
    stub(() => page())
    stubbed().api!.runtime.listLibrary = () =>
      Promise.reject(new Error('EACCES: permission denied'))
    const m = mount(SessionLibrary, {}, { width: box.width, height: 900 })
    await nextTick()
    await nextTick()
    return m
  }
  const m = await open(what === 'the 200-row truth' ? page({ matched: 2041 }) : page(), box)
  if (what === 'skipped, opened') (m.q('library-skipped') as HTMLDetailsElement).open = true
  return m
}

describe('every state the design draws renders, at three widths (104 §3)', () => {
  // The app at 1360 / 1120 / 900 with its ~265px rail beside it — the mock's own three widths,
  // measured as what the library column actually gets.
  const WIDTHS = [1095, 855, 635]

  /**
   * ⚠️ **The theme axis is gone; the width axis is the one that was ever measuring anything** (344).
   * This matrix ran twelve mounts where six would do: nothing in `overflowing()` reads a colour, so
   * the `dark` half asserted the same geometry a second time under a different label. The surface
   * now renders one scheme and the attribute is checked as a VALUE rather than echoed back from the
   * input — an echo is satisfied by whatever the component happens to render, which is exactly the
   * assertion that stops being worth anything once there is a single right answer.
   */
  for (const state of STATES) {
    it(`${state.what}`, async () => {
      for (const width of WIDTHS) {
        const m = await openState(state.what, { width })
        // The state is genuinely on screen — `q` throws if it is not, so the width sweep below
        // can never be a walk over a banner.
        m.q(state.evidence)
        expect(m.q('session-library').getAttribute('data-chat-theme')).toBe('light')
        const wide = overflowing(m)
        expect(wide, `${state.what} at ${width}px:\n  ${wide.join('\n  ')}`).toEqual([])
        m.unmount()
      }
    })
  }

  it('first run and no match are two states, not one — each excludes the other', async () => {
    const empty = page({ entries: [], matched: 0 })
    const fresh = await open(
      { ...empty, counts: { ...empty.counts, total: 0 }, skipped: [], skippedTotal: 0 },
      {},
    )
    expect(fresh.q('library-first-run').textContent).toContain('Nothing swept yet')
    // 169 §2 · what it says it is waiting for, in words that name the two programs. Composed from
    // `PROVIDER_NAME`, so this is also the assertion that the phrase reaches the template at all.
    expect(fresh.q('library-first-run').parentElement?.textContent).toContain(ALL_PROVIDER_FOLDERS)
    expect(fresh.q('session-library').textContent).not.toContain('provider home')
    expect(fresh.all('library-no-match')).toEqual([])
    fresh.unmount()

    const miss = await open((query) => (query === '' ? page() : page({ entries: [], matched: 0 })))
    await search(miss, 'adyen refund webhook')
    // It names what was typed, which is the whole difference between the two.
    expect(miss.q('library-no-match').textContent).toContain('adyen refund webhook')
    expect(miss.all('library-first-run')).toEqual([])
    // And the search really reached the main process rather than filtering the page in hand.
    expect(reads.at(-1)?.query).toBe('adyen refund webhook')
  })

  it('🔴 a search miss does not sit above an unsearched list pretending to be results', async () => {
    /**
     * **HO-002 §5 acceptance #7** — found by `302` while using the app, fixed in `301`.
     *
     * ⛔ A unique query produced *"Nothing matches `Q302_NO_MATCH_9f73e6a1`"* over *"No title,
     * first message or working directory across your 2 603 conversations contains that"* — **and
     * the page went on rendering a long, clickable REOPEN A CLOSED CONVERSATION list directly
     * underneath it.** Two opposite claims on one screen, both rendered from real state.
     *
     * ⚑ **The band is not searched and cannot be** — its rows come from a different read, and
     * matching them here would be a second, weaker search answering in the first one's voice. So
     * the page says which question the band answers, whenever the list above is narrowed.
     */
    const m = await open((query) => (query === '' ? page() : page({ entries: [], matched: 0 })))
    // ⚑ The negative's pair, and it comes first: with no query the band says nothing extra,
    // which is what makes the presence below mean "you are searching" rather than "always there".
    expect(m.all('library-reopen'), 'the reopen band is on this page at all').toHaveLength(1)
    expect(m.all('library-reopen-scope')).toEqual([])

    await search(m, 'Q302_NO_MATCH_9f73e6a1')
    expect(m.q('library-no-match').textContent).toContain('Q302_NO_MATCH_9f73e6a1')
    const scope = m.q('library-reopen-scope').textContent ?? ''
    expect(scope).toContain('Not narrowed by the search or filters above')
    // It is INSIDE the band it is about — a sentence beside the miss would be describing a
    // different part of the page from the one a reader is looking at when they see the rows.
    expect(m.q('library-reopen').contains(m.q('library-reopen-scope'))).toBe(true)

    // …and it goes away with the query, so it never becomes furniture (106's other direction).
    await search(m, '')
    expect(m.all('library-no-match')).toEqual([])
    expect(m.all('library-reopen-scope')).toEqual([])
  })

  it('a read that failed gets the banner and NOTHING ELSE — no invented empty state', async () => {
    /**
     * ⚠️ **Three of the review's seven angles found this independently, and the state matrix above
     * did not** (105 review). The matrix asserts `library-error` is present; it never asked what
     * else was. `load()`'s catch leaves `page` null on purpose, so `counts` was null, `firstRun`
     * computed true off the `?? 0`, and the surface printed the reassuring "Nothing swept yet —
     * start a conversation" directly beneath "Couldn't read your provider homes: EACCES". One of
     * those two sentences was invented, and it was the calm one.
     */
    const m = await openState('the read failed', { width: 1095 })
    expect(m.q('library-error').textContent).toContain('EACCES')
    // 169 §2 · and the head above it names whose folders could not be read, rather than ours.
    expect(m.q('session-library').textContent).toContain(`Couldn't read ${ALL_PROVIDER_FOLDERS}`)
    expect(m.q('session-library').textContent).not.toContain('provider home')
    expect(m.all('library-empty'), 'no empty state describes a failed read').toEqual([])
    expect(m.all('library-first-run')).toEqual([])
    expect(m.all('library-no-match')).toEqual([])
    // …and it does not claim a list it does not have.
    expect(m.q('session-library').textContent).not.toContain('The list below')

    // The paired positive: when a read DOES land, the empty state is exactly what appears.
    m.unmount()
    const empty = page({ entries: [], matched: 0 })
    const fresh = await open({
      ...empty,
      counts: { ...empty.counts, total: 0 },
      skipped: [],
      skippedTotal: 0,
    })
    fresh.q('library-first-run')
  })

  it('while a keystroke is still settling the surface says "reading", not a stale answer', async () => {
    /**
     * ⚠️ **Two review findings, one cause.** `loading` used to be set inside `load()`, 180ms after
     * the keystroke, so for that whole window the page in hand belonged to the PREVIOUS query:
     * backspacing from a zero-match term printed *Nothing matches "<the new term>"* about the old
     * term's result, and clearing the box entirely fell through to "No conversations to show" while
     * the counts line above still said eight.
     */
    const m = await open((query) => (query === '' ? page() : page({ entries: [], matched: 0 })))
    await search(m, 'zzzznomatch')
    m.q('library-no-match')

    // Now clear it. Synchronously — before the debounce fires — nothing may claim an answer.
    const box = m.q('library-search') as HTMLInputElement
    box.value = ''
    box.dispatchEvent(new Event('input'))
    await nextTick()
    expect(m.all('library-empty'), 'a query in flight has no answer to show').toEqual([])
    expect(m.q('session-library').textContent).toContain('Reading')

    // …and once it lands, the list is back. Without this the assertion above would be satisfied by
    // a surface that had simply stopped rendering.
    await sleep(260)
    await nextTick()
    await nextTick()
    expect(m.q('library-rows').querySelectorAll('.row').length).toBe(ZOO.length)
  })

  it('the skipped foot reports the TOTAL, and says how many it did not list', async () => {
    const m = await open(page({ skippedTotal: 51 }))
    const skipped = m.q('library-skipped')
    expect(skipped.querySelector('summary')!.textContent).toContain('51')
    expect(skipped.textContent).toContain('50 more')
  })

  it('the head does not scroll away from under a long list (104 §6.7)', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      entry({ id: `row-${i}`, updatedAt: NOW - i * DAY }),
    )
    const m = await open(page({ entries: many, matched: many.length }))
    const scroller = m.q('session-library').querySelector('.lib-scroll') as HTMLElement
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)

    const search = m.q('library-search').getBoundingClientRect().top
    const firstRow = m.q('library-rows').getBoundingClientRect().top
    scroller.scrollTop = scroller.scrollHeight

    // ⚠️ **That the scroll HAPPENED is half the assertion, and without it the test passes on a
    // surface that cannot scroll at all** — found by deleting `overflow-y` and watching this stay
    // green, because an unscrollable box pins `scrollTop` at 0 and the head trivially "stays put".
    expect(scroller.scrollTop, 'the list must actually have scrolled').toBeGreaterThan(0)
    await nextTick()
    expect(m.q('library-rows').getBoundingClientRect().top, 'the list moved').toBeLessThan(firstRow)
    expect(m.q('library-search').getBoundingClientRect().top, 'the search did not').toBe(search)
  })

  it('…and it still holds where the row runs out of room, which is where it stopped holding', async () => {
    /**
     * ⚠️ **300px, and the number is measured rather than picked.** With `flex-wrap` deleted from
     * the two row lines this list is SILENT at 400 and at 320 — `min-width: 0` lets the title and
     * the `cwd` ellipsise, so the row absorbs the first two steps down — and it only reports at
     * **300px**, where the size and the provenance phrase (both `flex: 0 0 auto`, both unshrinkable)
     * finally have nowhere to go: 205px of content in a 199px line. 103 found the same shape and
     * this is the second time it has been the difference between a real assertion and a decorative
     * one, so the width that bites is written down instead of a rounder number that does not.
     */
    for (const width of [400, 320, 300]) {
      const m = await open(page({ matched: 2041 }), { width })
      const wide = overflowing(m)
      expect(wide, `at ${width}px:\n  ${wide.join('\n  ')}`).toEqual([])
      m.unmount()
    }
  })

  it('…because the row lines WRAP rather than shrink past legibility', async () => {
    // The property, stated positively — the sweep above says "nothing sticks out", which a row that
    // had simply been deleted would also satisfy. At 300px the second line's last part sits BELOW
    // its first; at 1095 they are on one line. Both halves, so neither can pass alone.
    // ⚠️ Bands, not `top` values. The line mixes a monospace `cwd` with sans asides and sits on a
    // shared BASELINE, so three parts of one visual line legitimately have three different `top`s.
    // "Wrapped" is the only unambiguous reading: the last part starts below the first part ends.
    const measure = async (width: number): Promise<{ wrapped: boolean; count: number }> => {
      const m = await open(page(), { width })
      const line = m.q('library-row-home::unimported').querySelector('.r-line2')!
      const parts = [...line.children] as HTMLElement[]
      const first = parts[0]!.getBoundingClientRect()
      const last = parts.at(-1)!.getBoundingClientRect()
      const out = { wrapped: last.top >= first.bottom, count: parts.length }
      m.unmount()
      return out
    }
    const narrow = await measure(300)
    const wide = await measure(1095)
    expect(narrow.count, 'the line under test has to have parts to wrap').toBeGreaterThan(2)
    expect(wide.wrapped, 'at 1095px the whole line fits on one row').toBe(false)
    expect(narrow.wrapped, 'at 300px it must break onto a second row').toBe(true)
  })

  it('…and the width sweep fires — a row that cannot wrap is named, and removing it is silent', async () => {
    // Non-vacuity for every `toEqual([])` above. Without this, `overflowing` returning nothing is
    // equally consistent with "nothing overflows" and "the walk stepped over everything".
    const m = await open(page(), { width: 400 })
    const stiff = document.createElement('div')
    stiff.dataset.cy = 'stiff'
    stiff.style.cssText = 'display:flex;flex-wrap:nowrap'
    stiff.innerHTML = '<span style="flex:0 0 900px">wider than the column</span>'
    m.q('library-rows').append(stiff)

    expect(overflowing(m).join('\n')).toContain('[data-cy=stiff]')
    stiff.remove()
    expect(overflowing(m)).toEqual([])
  })

  it('the recency bands are drawn from `updatedAt`, and an empty band is not drawn at all', async () => {
    expect(recencyOf(TODAY, NOW)).toBe('today')
    expect(recencyOf(NOW - 3 * DAY, NOW)).toBe('week')
    expect(recencyOf(NOW - 40 * DAY, NOW)).toBe('older')

    const m = await open(
      page({
        entries: [
          entry({ id: 'a', updatedAt: TODAY }),
          entry({ id: 'b', updatedAt: NOW - 40 * DAY }),
        ],
        matched: 2,
      }),
    )
    m.q('library-band-today')
    m.q('library-band-older')
    expect(m.all('library-band-week')).toEqual([])
  })
})

/* ------------------------------------------------------------------ 5 · legibility */

/** What one element's ink actually reads as against what is actually behind it. */
function contrastOf(el: Element): number {
  const fg = parseColor(getComputedStyle(el).color)
  if (fg === null) return Infinity
  const bg = paintedBackground(el)
  const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Every element that draws its own words, and how legible each one is where it sits.
 *
 * Only elements with a TEXT NODE of their own — a wrapper inherits a colour it does not paint, and
 * counting it would report the same pair many times. Only elements with a box: a `<summary>`'s
 * hidden children have no layout and no contrast to have.
 */
function unreadable(m: Mounted, floor: number, seen = 40): string[] {
  const root = m.q('session-library')
  const out: string[] = []
  let walked = 0
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const own = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
    if (!own || el.getClientRects().length === 0) continue
    walked++
    const ratio = contrastOf(el)
    if (ratio < floor) out.push(`${named(el)} — ${ratio.toFixed(2)}:1`)
  }
  // ⚠️ **The floor is asserted INSIDE the walk, so `toEqual([])` cannot pass over an empty one.**
  // Every filter above is a way for this to see nothing — a `getClientRects` that returns empty
  // because the surface never mounted would report a clean sweep having looked at zero elements,
  // which is the vacuous pass this whole file is written against. Measured: 70.
  expect(
    walked,
    `the contrast walk covered only ${walked} elements — it saw nothing`,
  ).toBeGreaterThanOrEqual(seen)
  return out
}

describe('the surface is legible on paper as well as on chrome (091, 083 §5.1)', () => {
  /**
   * ⚠️ **3.0, and it is measured rather than chosen.** The floor is not 4.5 because this surface
   * deliberately runs part of its type at `--faint`, which the APPROVED DARK DESIGN already ships
   * below 4.5 — `chat-theme.test.ts` says so in as many words and holds light to "no worse than
   * dark" for exactly that ramp. 3.0 is the WCAG large-text bar and is what separates "quiet" from
   * "unreadable"; the defect 091 found measured 1.50.
   *
   * Measured across 70 elements at six widths: the worst in dark is the row's clock at **3.24**
   * (`--faint` on `--panel-2`) and the worst in light is the counts line at **4.34**. So the floor
   * has 0.24 of headroom in its tightest case, and it is honest about which case that is.
   */
  const FLOOR = 3.0

  // ⚠️ **Both ramps still run** (344). The surface ships `light`, so `dark` is set on the carrier —
  // and it is still a real question, because `:root` is what the titlebar, the rail and every
  // overlay read, and a row that is unreadable there is unreadable somewhere a person looks.
  for (const theme of ['dark', 'light'] as const) {
    it(`nothing in the list is unreadable in ${theme}`, async () => {
      const m = await open(page({ matched: 2041 }), { theme })
      ;(m.q('library-skipped') as HTMLDetailsElement).open = true
      await nextTick()
      const bad = unreadable(m, FLOOR)
      expect(bad, `below ${FLOOR}:1 in ${theme}:\n  ${bad.join('\n  ')}`).toEqual([])
    })
  }

  for (const theme of ['dark', 'light'] as const) {
    it(`the danger banner is legible in ${theme} too`, async () => {
      /**
       * ⚠️ **The sweep above never mounted this state, and one of its pairings is measured by
       * nothing else in the repo** (105 review). `.b-foot` is `--muted` on `--danger-bg`, a pair
       * `chat-theme.test.ts`'s `PAIRS` list does not carry — it checks the three `--danger-text-*`
       * inks against that background and no other. So the banner's quietest line had no floor
       * anywhere. It has one now, and it is measured on the composited page rather than on tokens.
       */
      const m = await openState('the read failed', { width: 1095, theme })
      // The banner is genuinely on screen — otherwise this walks over an empty surface.
      m.q('library-error')
      const bad = unreadable(m, FLOOR, 3)
      expect(bad, `below ${FLOOR}:1 on the banner:\n  ${bad.join('\n  ')}`).toEqual([])
    })
  }

  it('…and the detector fires — an invisible line is named, and removing it restores silence', async () => {
    const m = await open(page())
    const ghost = document.createElement('p')
    ghost.dataset.cy = 'ghost'
    // Ink the exact colour of the page it sits on: contrast 1.00, the defect in its purest form.
    ghost.style.color = getComputedStyle(m.q('session-library')).backgroundColor
    ghost.textContent = 'you cannot read this'
    m.q('library-rows').append(ghost)

    expect(unreadable(m, FLOOR).join('\n')).toContain('[data-cy=ghost]')
    ghost.remove()
    expect(unreadable(m, FLOOR)).toEqual([])
  })

  it('light really is a different page, not the same one relabelled', async () => {
    // Without this the runs above could all be measuring the dark theme — which is precisely what
    // 091 found shipping: the attribute was there and the page never changed.
    //
    // ⚠️ **The two mounts are the same mount since 344**, differing only in the carrier's value: the
    // surface ships `light`, so `dark` is what has to be asked for. That inversion is the claim —
    // the shipped page is the paper one — and it is stronger than the old pair, which could have
    // been satisfied by a prop that happened to work while the shipped default was the other value.
    const paper = await open(page())
    const paperBg = paintedBackground(paper.q('session-library'))
    paper.unmount()
    const dark = await open(page(), { theme: 'dark' })
    expect(luminance(paperBg)).toBeGreaterThan(
      luminance(paintedBackground(dark.q('session-library'))) + 0.5,
    )
  })
})
