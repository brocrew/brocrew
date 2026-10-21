// The approved plain words replace the former labels; the state and gesture checks remain.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
} from '../../src/renderer/src/lib/session-record'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { mount, unmountAll, type Mounted } from './harness'
import {
  assertDrawn,
  clipsOf,
  cutsOf,
  notDrawn,
  describeCarrier,
  describeClip,
  drawnReady,
  inkRects,
  lineCount,
  sweep,
  titleRecovers,
  type Carrier,
} from './drawn'

/**
 * Measure every clipped string at both shipped widths. Intentional cuts must recover their
 * full text; a repaired cut must leave the roster. The rhythm suite checks the wide breakpoint.
 */
const WIDE_RAIL_W = 266.2

/* ------------------------------------------------------------------ the fixture */

const NOW = 1_700_000_000_000

const conversation = (id: string, where: string, said: string | null): unknown => {
  const record = createSessionRecord(id)
  record.meta = {
    sessionId: id,
    provider: 'codex',
    cwd: where,
    profileId: 'default',
    ref: { provider: 'codex', sessionId: 'live', cwd: where, rotation: 0 },
    approvalMode: 'ask',
    liveness: { state: 'live', since: NOW },
  } as never
  openWindow(record, { entries: [], from: 0, hasOlder: false, turnAligned: true } as never)
  if (said !== null) {
    acceptEvent(record, {
      sessionId: id,
      ordinal: 0,
      at: NOW,
      event: { type: 'user_turn', text: said },
    } as never)
  }
  return record
}

const identity = (slug: string): unknown => ({
  id: `agp:default:${slug}`,
  slug,
  displayName: null,
  createdAt: NOW,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

/**
 * ⚑ **One long folder name, on purpose.** It is the control for the whole roster
 * (`a-positive-assertion-must-differ-from-the-default`): *nothing else is cut* is only a
 * measurement if something in the same mount IS, and this sensor says which.
 */
const A_FOLDER_NO_COLUMN_COULD_HOLD = '/Users/m/dev/a-very-long-directory-name-that-will-not-fit'

/** A piece title long enough that two lines of either rail width cannot hold it. */
const A_TITLE_LONGER_THAN_TWO_LINES =
  'Rebuild the conversation rail so every row says which conversation it is, where it runs, ' +
  'and whether it is waiting on you'

/**
 * ⚑ **D-017b · a conversation another window has open, as the host lists it** — the rail's one list
 * draws it beside the two this window holds, and it is the one row whose line says where it is.
 * ⚠️ Only the fields the one list reads (`conversation-list.ts`): the stub is typed `unknown`.
 */
const RECORDED = [
  {
    sessionId: 'sess_openable',
    provider: 'claude',
    profileId: 'default',
    cwd: '/x/brobot-2',
    running: 'in-a-window',
    state: { is: 'idle' },
    // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so its row is titled by its agent.
    named: null,
    updatedAt: NOW - 240_000,
  },
  {
    // Titled by the piece it holds, and the title is longer than two lines of the column, so the
    // title clamp has something to cut.
    sessionId: 'sess_named',
    provider: 'claude',
    profileId: 'default',
    cwd: '/x/brobot-2',
    running: 'not-running',
    state: { is: 'idle' },
    named: { label: 'W1', title: A_TITLE_LONGER_THAN_TWO_LINES },
    updatedAt: NOW - 300_000,
  },
]

const safety = useSpawnSafety()

async function rail(width: number): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve(RECORDED),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const agents = {
    identities: [identity('default'), identity('project-manager'), identity('worker')],
    foldersWithoutARow: [],
    use: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    externalMcpServers: [],
  }
  safety.supply(agents as never, () => {})
  const m = mount(
    SideRail,
    {
      open: [
        conversation('sess_a', '/Users/m/dev/workspace-a', 'Fix the line count in summarize.mjs'),
        conversation('sess_long', A_FOLDER_NO_COLUMN_COULD_HOLD, null),
      ],
      activeId: null,
      place: null,
      agents,
    },
    { width, height: 1400 },
  )
  // Two macrotask hops: the one list's two reads are a `Promise.all` inside a `try`, and the number
  // of microtask hops before the first painted row is not this file's to own.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
  return m
}

afterEach(() => {
  unmountAll()
  safety.supply(null, () => {})
})

/* ------------------------------------------------------------------ the sweep */

/* ------------------------------------------------------------------ the two lists */

interface Cut {
  /** The `data-cy` the cut is reported under — the element's own, or its nearest hooked ancestor. */
  readonly cy: string
  /** Enough of the string to tell one row's line from another's. */
  readonly starts: string
  /** Why this one is allowed to be short, or who owns the repair. */
  readonly because: string
  readonly widths?: readonly number[]
}

/**
 * ⚑ **Cut, and the whole of it still reachable.** Each of these asserts {@link titleRecovers}, so
 * an entry cannot be parked here by writing a sentence about it.
 */
const SHORTENED_ON_PURPOSE: readonly Cut[] = [
  {
    cy: 'open-session-sess_named',
    starts: 'W1 · Rebuild the conversation rail',
    because:
      'A conversation title is shortened to one line so one long title cannot make its row tower ' +
      'over the rest; the whole title is on the `:title` and is the row’s accessible name.',
  },
  {
    cy: 'session-opening-sess_a',
    starts: 'Fix the line count',
    because: 'The opening excerpt stays on one line, with its full excerpt on hover.',
  },
  {
    cy: 'open-session-sess_long',
    starts: 'codex · ',
    because: 'The long folder cannot expand the status line; the full text remains on hover.',
  },
  {
    cy: 'open-session-sess_openable',
    starts: 'claude · ',
    because: 'The full status, other-window notice and folder remain on hover.',
  },
  {
    cy: 'open-session-sess_named',
    starts: 'default · ',
    // Linux's Inter metrics clip the final glyph even at the wider rail width.
    widths: /linux/i.test(navigator.platform) ? [251.68, WIDE_RAIL_W] : [251.68],
    because: 'The full agent, provider, status and folder remain on hover.',
  },
]

/**
 * 🔴 **Cut, with nothing that recovers it.** Each entry would be a defect naming who owns the
 * repair. Empty: shortened titles and subtitles have hover recovery, and a
 * clipped line that is not declared here turns §1 red.
 */
const CUT_AND_NOT_REPAIRED_HERE: readonly Cut[] = []

const CUTS = [...SHORTENED_ON_PURPOSE, ...CUT_AND_NOT_REPAIRED_HERE]

const appliesAt = (d: Cut, width: number): boolean => !d.widths || d.widths.includes(width)

const declaredFor = (c: Carrier, width: number): Cut | undefined =>
  CUTS.find((d) => appliesAt(d, width) && d.cy === c.cy && c.text.startsWith(d.starts))

/* ------------------------------------------------------------------ §0 · the sensor */

describe('§0 · the sensor, before anything is measured with it', () => {
  // ⚠️ **A list and not one handle.** Two tests here plant twice, and a single `let box` left the
  // first box in `document.body` for every later test in the file — a sized div is an ancestor
  // the next walk climbs. Found in review.
  const planted: HTMLElement[] = []

  beforeAll(async () => {
    await drawnReady()
  })

  afterEach(() => {
    while (planted.length) planted.pop()!.remove()
  })

  const plant = (css: string, inner: string): HTMLElement => {
    const box = document.createElement('div')
    box.setAttribute('style', css)
    box.innerHTML = inner
    document.body.append(box)
    planted.push(box)
    return box
  }

  it('🔴 a line that runs past a `hidden` box is a `cut` that is reachable `never`', () => {
    const el = plant(
      'width: 60px; overflow: hidden; white-space: nowrap; font: 10px Inter',
      'a string far wider than sixty pixels could ever hold',
    )
    const [clip] = cutsOf(el)
    expect(clip, 'the sensor found nothing where a browser cut a string').toBeDefined()
    expect(clip!.kind).toBe('cut')
    expect(clip!.reach).toBe('never')
    expect(clip!.overflowPx).toBeGreaterThan(100)
  })

  it('⚠️ …and `scrollWidth > clientWidth` alone answers NOTHING on the inline element', () => {
    // ⛔ **The reason this module exists rather than a line copied into each suite.** `clientWidth`
    // is 0 on a non-replaced inline, so the usual shape reports `0 > 0` — *not clipped* — for the
    // commonest element in a rail row. ⚑ The range sees it.
    const box_ = plant(
      'width: 60px; overflow: hidden; white-space: nowrap; font: 10px Inter',
      '<span id="inline">a string far wider than sixty pixels could ever hold</span>',
    )
    const inline = box_.querySelector<HTMLElement>('#inline')!
    expect(inline.clientWidth, 'an inline element has grown a client box').toBe(0)
    expect(inline.scrollWidth - inline.clientWidth).toBe(0)
    expect(inkRects(inline).length).toBeGreaterThan(0)
    expect(cutsOf(inline), 'the range did not see what the scroll pair could not').not.toEqual([])
  })

  it('⛔ half-leading is not a cut — one of the three separations', () => {
    // A `line-height` under about 1.2 leaves the inline box taller than the content box, so every
    // `--leading-tight` heading in this app overflows its own `overflow: hidden` by about a pixel
    // and loses not one glyph.
    const el = plant(
      'width: 400px; overflow: hidden; white-space: nowrap; font: 15px Inter; line-height: 1',
      'a short title',
    )
    expect(el.scrollHeight, 'the box is not overflowing, so nothing is measured').toBeGreaterThan(
      el.clientHeight,
    )
    expect(cutsOf(el)).toEqual([])
    // ⚑ The paired positive: a real clamp on the same axis IS found.
    const clamped = plant(
      'width: 80px; height: 14px; overflow: hidden; font: 10px Inter',
      'one two three four five six seven eight nine ten eleven twelve',
    )
    expect(cutsOf(clamped).map((c) => c.axis)).toContain('y')

    // ⛔ **And the floor is BOUNDED ABOVE, which the pair above does not establish.** The clamp
    // hides whole lines, so it would be found by a tolerance of almost any size; this one hides
    // a third of one line and must still be found. ⚑ Without it `Y_TOLERANCE_OF_A_LINE` could be
    // raised by an order of magnitude and every test here would stay green. Found in review.
    const line = plant(
      'width: 400px; height: 8px; overflow: hidden; font: 10px Inter; line-height: 12px',
      'a single line, a third of which is below the edge',
    )
    const [cut] = cutsOf(line)
    expect(cut, 'a third of a line off the bottom was not reported').toBeDefined()
    expect(cut!.axis).toBe('y')
    expect(cut!.overflowPx).toBeGreaterThan(2)
    expect(cut!.overflowPx).toBeLessThan(8)
  })

  it('⛔ an inner scroller beats an outer `hidden` — the second separation', () => {
    const el = plant(
      'width: 200px; height: 20px; overflow: hidden',
      '<div id="scroll" style="height: 20px; overflow-y: auto">' +
        '<p id="text" style="font: 10px Inter; margin: 0">' +
        'one<br />two<br />three<br />four<br />five<br />six</p></div>',
    )
    const text = el.querySelector<HTMLElement>('#text')!
    const [clip] = clipsOf(text).filter((c) => c.axis === 'y')
    expect(clip, 'nothing reported on the axis that overflows').toBeDefined()
    expect(clip!.by.id, 'the verdict came from the outer box, not the scroller').toBe('scroll')
    expect(clip!.reach).toBe('by-scrolling')
    expect(cutsOf(text), 'text a person can scroll to was reported as lost').toEqual([])
  })

  it('⛔ a box one pixel across is an accessible name, not a clipped string', () => {
    // ⚠️ **One arm at a time.** `.only-for-a-reader` carries BOTH `width: 1px` and
    // `clip-path: inset(50%)`, so a single plant copied from the app satisfies the whole
    // predicate and measures neither half — `a-rule-measured-only-where-both-readings-agree`.
    // Found in review.
    const tiny = plant(
      'position: absolute; width: 1px; height: 1px; overflow: hidden; white-space: nowrap; ' +
        'font: 10px Inter',
      '1 question waiting on you.',
    )
    expect(
      clipsOf(tiny).map((c) => c.kind),
      'the 1px arm',
    ).toContain('for-a-reader-only')
    expect(cutsOf(tiny)).toEqual([])

    const masked = plant(
      'width: 60px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; font: 10px Inter',
      'a string far wider than sixty pixels could ever hold',
    )
    expect(
      clipsOf(masked).map((c) => c.kind),
      'the clip-path arm',
    ).toContain('for-a-reader-only')
    expect(cutsOf(masked)).toEqual([])

    // ⛔ And the control: the SAME box with neither is an ordinary cut.
    const ordinary = plant(
      'width: 60px; overflow: hidden; white-space: nowrap; font: 10px Inter',
      'a string far wider than sixty pixels could ever hold',
    )
    expect(clipsOf(ordinary).map((c) => c.kind)).toEqual(['cut'])
  })

  it('🔴 a string of which NOTHING is drawn is not "drawn in full"', () => {
    // ⛔ **The hole `cutsOf` alone leaves**, and `531`'s own repair walked into it: push a row out
    // of a fixed-height box and the sensor says `out-of-view`, which is true and is not a cut.
    // ⚑ `notDrawn` is the union, and `assertDrawn` is built on it. Found in review.
    const box = plant('width: 200px; height: 12px; overflow: hidden; font: 10px Inter', '')
    const first = document.createElement('div')
    first.textContent = 'the line a person can see'
    const second = document.createElement('div')
    second.textContent = 'the line a person cannot'
    box.append(first, second)
    expect(cutsOf(second), 'nothing of it overlaps the box, so it is not a CUT').toEqual([])
    expect(
      notDrawn(second).map((c) => c.kind),
      'and it is still not drawn',
    ).toEqual(['out-of-view'])
    expect(() => assertDrawn(second, 'the second line')).toThrow()
    // ⚑ The paired positive: the line that IS on screen passes both.
    expect(notDrawn(first)).toEqual([])
  })

  it('⚠️ and it refuses to answer at all before Inter has loaded', () => {
    // ⛔ **The guard that makes limit 7 loud.** Every width here is the fallback's until the face
    // arrives, so the module throws rather than returning a number that is wrong by a few px.
    const el = plant('width: 60px; overflow: hidden', 'anything')
    const real = document.fonts.check.bind(document.fonts)
    document.fonts.check = (): boolean => false
    try {
      expect(() => cutsOf(el)).toThrow(/Inter has not loaded/)
    } finally {
      document.fonts.check = real
    }
    expect(() => cutsOf(el), 'the guard did not come back off').not.toThrow()
  })
})

/* ------------------------------------------------------------------ §1 · the roster */

describe('§1 · the roster, at both shipped widths', () => {
  for (const width of [251.68, WIDE_RAIL_W]) {
    it(`🔴 ${width}px · every cut in this rail is one of the ${CUTS.filter((d) => appliesAt(d, width)).length} declared`, async () => {
      const m = await rail(width)
      // ⛔ **The width is the file's headline claim and nothing was checking it.** A mount box is
      // not a rendered width: a rail that ignored it, or a stylesheet that pinned `--rail-w`
      // over it, would make every number below about another column. Found in review.
      const aside = m.host.querySelector<HTMLElement>('.rail') ?? m.host.firstElementChild
      expect(
        (aside as HTMLElement).getBoundingClientRect().width,
        `the rail did not render at ${width}px`,
      ).toBeCloseTo(width, 1)
      const found = sweep(m.host).filter((c) => c.cut !== null)
      expect(
        found.length,
        'the sweep found nothing at all — the fixture drew no rail',
      ).toBeGreaterThan(0)
      expect(found.filter((c) => !declaredFor(c, width)).map(describeCarrier)).toEqual([])
    })

    it(`⛔ ${width}px · and every declared cut is still cut, so the list cannot go quiet`, async () => {
      const m = await rail(width)
      const found = sweep(m.host).filter((c) => c.cut !== null)
      const missing = CUTS.filter(
        (d) =>
          appliesAt(d, width) && !found.some((c) => c.cy === d.cy && c.text.startsWith(d.starts)),
      )
      for (const declared of CUTS.filter((d) => !appliesAt(d, width))) {
        const carrier = sweep(m.host).find(
          (c) => c.cy === declared.cy && c.text.startsWith(declared.starts),
        )
        expect(carrier, 'the previously shortened status is missing').toBeDefined()
      }
      expect(
        missing.map((d) => `${d.cy} :: ${d.starts}`),
        'declared as cut and drawn in full — repaired? delete the entry',
      ).toEqual([])
    })

    it(`${width}px · the short status fits in full`, async () => {
      const m = await rail(width)
      const status = m.q('open-session-sess_a').querySelector<HTMLElement>('small[data-standing]')!
      assertDrawn(status, 'the short status is drawn in full')
    })

    it(`⚠️ ${width}px · a cut declared recoverable really is recoverable`, async () => {
      const m = await rail(width)
      for (const declared of SHORTENED_ON_PURPOSE) {
        const carrier = sweep(m.host).find(
          (c) => c.cy === declared.cy && c.text.startsWith(declared.starts),
        )
        expect(carrier, `${declared.cy} was not drawn at all`).toBeDefined()
        expect(carrier!.recovered, `${declared.cy} is cut and no title recovers it`).toBe(true)
      }
    })
  }

  it('266.2px · the named status fits in full with the Mac’s Inter metrics', async (ctx) => {
    // This one glyph fits with Mac font metrics; Linux's complete roster declares its cut.
    ctx.skip(!/mac/i.test(navigator.platform))
    const m = await rail(WIDE_RAIL_W)
    const status = m
      .q('open-session-sess_named')
      .querySelector<HTMLElement>('small[data-standing]')!
    assertDrawn(status, 'the named status fits at the wider rail width on the Mac')
  })
})

/* ------------------------------------------------------------------ §2 · the repairs */

describe('§2 · the three sentences 531 repaired, by name', () => {
  // 🔴 **634 · Home's sentence is not repaired any more — it is GONE** (`HO-095` §7). ⛔ It read
  // *Dashboard across active projects*, and `606` moved that job to the two rows drawn
  // immediately above it, so `531` was keeping a sentence legible that had stopped being true.
  // ⚑ **Removed from this list and REPLACED by a negative**, which is the assertion the list
  // cannot carry: `531`'s subject was *is it drawn whole*, and a row that draws no sentence needs
  // *is it drawn at all* instead (`invert-a-defect-assertion-never-delete-it`). ⚑ **D-016 deleted
  // the Home row itself**, and that negative went with the row it was about.
  const REPAIRED: readonly [string, string][] = [
    ['rail-sessions', 'Includes chats from Claude and Codex on this computer.'],
    // ⚑ D-016 · ruling 12 — the switch names the START it refuses (`spawnSafetyView`).
    ['rail-spawning-line', 'Click to prevent new conversations. Current work will continue.'],
  ]

  for (const width of [251.68, WIDE_RAIL_W]) {
    for (const [cy, sentence] of REPAIRED) {
      it(`🔴 ${width}px · “${sentence.slice(0, 34)}…” is drawn whole`, async () => {
        const m = await rail(width)
        const host = m.q(cy)
        // ⛔ **No `?? host` fallback.** A missing `.says` would silently re-aim the assertion at
        // the whole row, whose own box is not clipped — so the repair could be deleted and this
        // test would still pass. Found in review.
        const el = host.tagName === 'SMALL' ? host : host.querySelector<HTMLElement>('small.says')
        expect(el, `${cy} has no small.says — the repair is gone`).not.toBeNull()
        expect(el!.textContent?.replace(/\s+/g, ' ').trim()).toBe(sentence)
        // ⛔ **The assertion the app did not have.** Every read of this string was green while a
        // person saw *Dashboard across active pro…*; this one is about what the engine painted.
        expect(notDrawn(el!, m.host).map(describeClip), `“${sentence}” is still cut`).toEqual([])
        // ⚑ And the clamp's own escape hatch is wired, for the frame where somebody lengthens it.
        expect(titleRecovers(el!, m.host), `${cy} has no title to fall back on`).toBe(true)
      })
    }
  }

  it('⚠️ the clamp is real — four lines, and a fifth would not be drawn', async () => {
    const m = await rail(251.68)
    const el = m.q('rail-sessions').querySelector<HTMLElement>('small.says')!
    // Four is the smallest clamp that draws the longest of the three sentences whole at the 12 px
    // floor in this column; the clamp stops a sentence lengthened later from growing the rail.
    expect(getComputedStyle(el).webkitLineClamp).toBe('4')
    // The line box is the computed leading, which is taller than the glyphs' ink.
    const line = Number.parseFloat(getComputedStyle(el).lineHeight)
    expect(line, 'the line height did not resolve to pixels').toBeGreaterThan(0)
    expect(lineCount(el), 'the sentence stopped wrapping').toBeGreaterThan(1)
    expect(el.clientHeight).toBeLessThanOrEqual(Math.ceil(line * 4) + 1)
  })

  it('⛔ …and a sentence three times as long cannot grow the row — what the clamp is FOR', async () => {
    // 🔴 **The rule the clamp carries, and nothing was asserting it.** ⛔ Removing
    // `display: -webkit-box` leaves `-webkit-line-clamp` bound to nothing and every sentence that
    // ships still draws whole — so two mutations on this block survived every test in this file
    // until this one existed (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ What the
    // clamp is for is the sentence somebody writes NEXT, so that is what gets planted.
    const m = await rail(251.68)
    const row = m.q('rail-spawning')
    const el = m.q('rail-spawning-line')
    const line = Number.parseFloat(getComputedStyle(el).lineHeight)
    expect(line, 'the line height did not resolve to pixels').toBeGreaterThan(0)
    el.textContent = `${'a sentence somebody lengthened later '.repeat(6)}and then some`
    await nextTick()
    // The shipped sentence may be shorter than the clamp, so the row may grow up to four lines.
    expect(el.clientHeight, 'the clamp let the sentence past four lines').toBeLessThanOrEqual(
      Math.ceil(line * 4) + 1,
    )
    const before = row.getBoundingClientRect().height

    // ⚑ **The control, and it is what makes the line above a measurement**: with the box gone the
    // clamp binds to nothing, and the same text moves the row. ⛔ Restored on the element, not the
    // stylesheet, so nothing survives into the next test.
    el.style.display = 'block'
    await nextTick()
    expect(
      row.getBoundingClientRect().height,
      'the planted sentence does not move this row at all, so nothing above was measured',
    ).toBeGreaterThan(before)
  })

  it('keeps a long status on one line with complete hover recovery', async () => {
    const m = await rail(251.68)
    const status = m
      .q('open-session-sess_long')
      .querySelector<HTMLElement>('.rail-copy small:last-of-type')!
    expect(getComputedStyle(status).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(status).textOverflow).toBe('ellipsis')
    expect(status.getBoundingClientRect().height).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(status).lineHeight) + 1,
    )
    expect(status.scrollWidth).toBeGreaterThan(status.clientWidth)
    expect(titleRecovers(status, m.host)).toBe(true)
    expect(status.title).toBe(status.textContent?.trim())
    const row = m.q('open-session-sess_long').getBoundingClientRect()
    expect(status.getBoundingClientRect().bottom).toBeLessThanOrEqual(row.bottom + 1)
  })
})

/* ------------------------------------------------------------------ §3 · the widths */

describe('§3 · the widths this file measures at are the ones the app draws', () => {
  it('🔴 251.68px is the token, not a number typed here', async () => {
    const m = await rail(251.68)
    expect(m.host.isConnected).toBe(true)
    const declared = getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim()
    expect(declared, '--rail-w is not declared where this page can read it').toMatch(
      /^\d+(?:\.\d+)?px$/,
    )
    expect(Number.parseFloat(declared)).toBe(251.68)
  })

  it('⚠️ 266.2px is the ≥1400px width, and rail-rhythm is what pins it', () => {
    // ⛔ This page is 1200 px, so the media query does not match here and the token cannot be read
    // for the wide case. `rail-rhythm.dom.test.ts` drives a real viewport across the step; this is
    // the pointer to it, so a change to 266.2 fails there and is explained here.
    expect(WIDE_RAIL_W).toBe(266.2)
  })
})
