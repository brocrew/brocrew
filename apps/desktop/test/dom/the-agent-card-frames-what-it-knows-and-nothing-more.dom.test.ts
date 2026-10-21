import { afterEach, describe, expect, it } from 'vitest'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import {
  useWhoCalledWhom,
  type RailSays,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import { plateWord } from '../../src/renderer/src/lib/agent-state'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { assertClippedButTold, assertDrawn, cutsOf, drawnReady } from './drawn'
import { META, allTasks, drawerProps, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ The agent card frames what it knows, and nothing more
 *
 * Check the bubble’s press and title; a turn with no words, fence, or clock; the dot before
 * the state word and on every chip; profile and folder details shown only when present; the
 * Current task box for the newest open piece; each section’s frame; and an Images tile’s
 * picture, press, and truncated name.
 *
 * ⚑ **Moved on `ui` since this file was written** — the right panel became this agent's card alone
 * (`f1fa1e2e`), and a press on an agent anywhere SELECTS it (UI-006, F045):
 * - a chip is a button only where a conversation can be opened, so the chips are found by their
 *   conversation, whatever element draws them;
 * - ⛔ *the open agent's own chips* went with the open agent's card, and then with the chosen
 *   agent's card (`70aaa954`, withdrawn by UI-006): a selected agent's chips are the card's own;
 * - ⛔ **the frame around the open agent's card went with that card** (`f1fa1e2e`: *"only the card
 *   of the parent"*). What it drew moved to the Graph tab's cards.
 *
 * ⛔ **Every negative in this file is paired with the reading that shows the same mount drew the
 * thing it is not drawing** — a bubble that is a plain paragraph beside the same words as a button,
 * a card with no clock beside one that has it, a finished piece beside the open one. A `not drawn`
 * read on its own passes on a card that drew nothing at all.
 *
 * ⚠️ **Colours are read where a person sees them**: a probe painted with the token, appended to the
 * mount's own host so it sits in the same cascade as the box it is compared with, and the two
 * `getComputedStyle` answers compared. A constant cannot pass, because the cases below expect
 * different tokens and the file checks that the tokens differ.
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The channel is a window-level singleton**, so a reading left behind would be the next
  // test's premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.railSays.value = null
  cast.forest.value = null
})

const NOW = Date.now()

/* ------------------------------------------------------------------ the conversation on screen */

function stateOf(events: TranscriptEvent[], at: number) {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event, at)
  return state
}

const said = (text: string): TranscriptEvent =>
  ({ type: 'assistant_message', text }) as unknown as TranscriptEvent

/** ⚑ What a person reads: the element's words, whitespace collapsed. */
const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The card of the conversation on screen, mounted where the panel is — 380px wide. */
const panel = (
  state: ReturnType<typeof createTranscript>,
  over: Record<string, unknown> = {},
  height = 700,
): Mounted =>
  mount(
    SessionPanel,
    {
      state,
      mode: 'normal',
      facets: { doing: 'idle', being: 'live' },
      who: 'BroBot',
      profile: 'brobot',
      ...over,
    },
    { width: 380, height },
  )

/**
 * ⚑ **A picture the agent made**, with the prompt it was made from only where one is given — a tile
 * with no prompt is the case the title's other arm is for.
 */
const made = (...files: { path: string; prompt?: string }[]) => {
  const state = createTranscript()
  files.forEach((file, index) => {
    applyEvent(state, {
      type: 'image',
      imageId: `img_${String(index)}`,
      path: file.path,
      ...(file.prompt === undefined ? {} : { prompt: file.prompt }),
    } as unknown as TranscriptEvent)
  })
  return state
}

/* ------------------------------------------------------------------ the right panel */

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

const spawn = (conversation: string, over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation,
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

const edge = (over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece: 'work_63',
  label: 'W63',
  title: 'Inspect the window states',
  from: 'sess_parent',
  fromIdentity: 'brobot',
  to: META.sessionId,
  toIdentity: 'inspector',
  state: 'working',
  givenAt: NOW - 120_000,
  endedAt: null,
  ...over,
})

const taken = (...edges: WorkEdge[]) =>
  walk<WorkEdge>(edges, 'every-piece-of-work-this-one-was-given')

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

/** ⚑ The piece's brief, arrived in this conversation as the turn that opened it. */
const briefed = (brief: string, label = 'W63', piece = 'work_63') => {
  const state = createTranscript()
  const events = [
    {
      type: 'work_given',
      piece,
      label,
      parent: 'work_1',
      givenBy: 'sess_parent',
      title: 'Inspect the window states',
      brief,
    },
    {
      type: 'user_turn',
      text: brief,
      relayedFrom: 'sess_parent',
      relayedFromProfile: 'brobot',
      piece,
      label,
    },
  ] as unknown as TranscriptEvent[]
  for (const event of events) applyEvent(state, event, NOW)
  return state
}

/** ⚑ The drawer, with the reading of who called whom above it and (where given) the rail's rows. */
function show(
  read: WhoCalledWhom,
  state = createTranscript(),
  rail: ReadonlyMap<string, RailSays> | null = null,
  over: Record<string, unknown> = {},
): Mounted {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: META.sessionId, read, answered: true, atWork: null }
  cast.railSays.value = rail
  return mount(
    SessionDrawer as never,
    drawerProps({ state, shown: state, identities: null, ...over }),
    { width: DRAWER_W_MIN, height: 900 },
  )
}

/** ⚑ One rail row, as the rail draws a conversation. */
const railRow = (facets: RailSays['facets'], word: string): RailSays => ({ facets, word })

/* ------------------------------------------------------------------ colour, read where it is drawn */

/**
 * ⚑ **A probe painted with a token, read back** — appended inside `within`, so it sits in the same
 * cascade as the box it is compared with, and removed before anything else runs.
 */
function probe<T>(within: HTMLElement, css: string, reading: (style: CSSStyleDeclaration) => T): T {
  const one = document.createElement('div')
  one.style.cssText = css
  within.append(one)
  try {
    return reading(getComputedStyle(one))
  } finally {
    one.remove()
  }
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** The colour a token paints — and it has to paint one, or two unpainted things would agree. */
function fillOf(within: HTMLElement, token: string): string {
  const colour = probe(within, `background: var(${token})`, (style) => style.backgroundColor)
  expect(colour, `${token} painted nothing, so it cannot be compared with`).not.toBe(TRANSPARENT)
  return colour
}

function lineOf(within: HTMLElement): string {
  const colour = probe(within, 'border: 1px solid var(--line)', (style) => style.borderTopColor)
  expect(colour, '--line painted nothing, so it cannot be compared with').not.toBe(TRANSPARENT)
  return colour
}

function cornersOf(within: HTMLElement): string {
  const radius = probe(
    within,
    'border-radius: var(--radius-lg)',
    (style) => style.borderTopLeftRadius,
  )
  expect(radius, '--radius-lg drew square corners, so it cannot be compared with').not.toBe('0px')
  return radius
}

const paintedBy = (el: Element): string => getComputedStyle(el).backgroundColor

/* ------------------------------------------------------------------ the bubble */

describe('the bubble beside the plate says what the agent last said, and no more', () => {
  it('⛔ a message that is not on screen draws a plain bubble with no press — the same message on screen is a button that shows it', () => {
    const state = stateOf([said('Checking the window states now.')], Date.now())

    // ⚑ Off screen: the conversation shows an empty fold, so there is nowhere to scroll to.
    const away: string[] = []
    const off = panel(state, {
      shown: createTranscript(),
      onNavigate: (itemId: string) => away.push(itemId),
    })
    const plain = off.q('card-latest')
    expect(visible(plain)).toBe(true)
    expect(read(off.q('card-latest-words'))).toBe('Checking the window states now.')
    expect(plain.tagName).toBe('P')
    expect(plain.classList.contains('pressable')).toBe(false)
    plain.click()
    expect(away, 'a bubble with nowhere to go still navigated').toEqual([])
    off.unmount()

    // ⚑ THE PAIR — the same message, on screen: a button, and a press shows it.
    const here: string[] = []
    const on = panel(state, { shown: state, onNavigate: (itemId: string) => here.push(itemId) })
    const button = on.q('card-latest')
    expect(read(on.q('card-latest-words'))).toBe('Checking the window states now.')
    expect(button.tagName).toBe('BUTTON')
    expect(button.classList.contains('pressable')).toBe(true)
    button.click()
    expect(here).toEqual([button.dataset.item])
    expect(state.items.find((item) => item.id === here[0])?.kind).toBe('assistant')
  })

  it('🔴 a turn with no words is passed over — the bubble says what the agent last SAID', () => {
    const state = stateOf([said('The words that were said.')], Date.now())
    const spoken = state.items[0]
    expect(spoken?.kind, 'the first item is the message that was said').toBe('assistant')
    // ⚑ A turn that only ran tools: an assistant item, newest of all, with nothing in it.
    state.items.push({
      kind: 'assistant',
      id: 'assistant_tool_only',
      text: '',
      streaming: false,
    })

    const m = panel(state)
    const bubble = m.q('card-latest')
    expect(visible(bubble)).toBe(true)
    expect(read(m.q('card-latest-words'))).toBe('The words that were said.')
    expect(bubble.dataset.item).toBe(spoken!.id)
    expect(bubble.dataset.item).not.toBe('assistant_tool_only')
  })

  it('🔴 a code fence is not read out — the bubble’s words leave its marks off and keep its lines', () => {
    const m = panel(
      stateOf([said('Run this:\n```ts\nconst x = 1\n```\nThen tell me.')], Date.now()),
    )
    const words = m.q('card-latest-words')
    expect(visible(words)).toBe(true)
    // ⚑ The lines the fence held are kept; the fence's own lines are not.
    expect(words.textContent).toBe('Run this: const x = 1 Then tell me.')
    expect(words.textContent).not.toContain('```')
    // ⚑ The title is the same paragraph — what the code sets it to.
    expect(m.q('card-latest').title).toBe('Run this: const x = 1 Then tell me.')
  })

  it('🔴 a long message is cut at three lines, and the whole of it is on the bubble’s title', async () => {
    const LONG =
      'I went through every window state you asked about, one after the other, and took a picture of ' +
      'each of them before touching anything else. Most of them look exactly as they did yesterday, ' +
      'but the third one draws its header a few pixels lower than the mock does, and the fifth one ' +
      'has lost its border entirely, so I have written both down for the team to read tomorrow.'
    const long = panel(stateOf([said(LONG)], Date.now()))
    await drawnReady()
    const words = long.q('card-latest-words')
    // ⚑ The card holds every word — it is the drawing that stops at three lines.
    expect(read(words)).toBe(LONG)
    assertClippedButTold(words, 'the bubble’s words', long.host)
    // ⚠️ Not `lineCount`: it counts the lines the clamp cut away too.
    const lineHeight = parseFloat(getComputedStyle(words).lineHeight)
    expect(lineHeight).toBeGreaterThan(0)
    expect(Math.round(words.getBoundingClientRect().height / lineHeight)).toBe(3)
    expect(long.q('card-latest').title.replace(/\s+/g, ' ')).toBe(LONG)
    long.unmount()

    // ⚑ THE PAIR — a short sentence in the same bubble: not cut, one line, the title its own words.
    const short = panel(stateOf([said('All tasks are on track.')], Date.now()))
    await drawnReady()
    const brief = short.q('card-latest-words')
    expect(read(brief)).toBe('All tasks are on track.')
    expect(cutsOf(brief, short.host)).toEqual([])
    expect(Math.round(brief.getBoundingClientRect().height / lineHeight)).toBe(1)
    expect(short.q('card-latest').title).toBe('All tasks are on track.')
  })

  it('⛔ a message the fold gave no time draws its words and no “ago” — with a time it says how long', () => {
    // ⚑ No clock: the fold is handed no third argument, so the message has no time.
    const clockless = createTranscript()
    applyEvent(clockless, said('All tasks are on track.'))
    const without = panel(clockless)
    expect(visible(without.q('card-latest-words'))).toBe(true)
    expect(read(without.q('card-latest-words'))).toBe('All tasks are on track.')
    expect(without.all('card-latest-ago')).toHaveLength(0)
    without.unmount()

    // ⚑ THE PAIR — the same message with a time says how long ago.
    const withClock = panel(stateOf([said('All tasks are on track.')], Date.now() - 5 * 60_000))
    expect(read(withClock.q('card-latest-words'))).toBe('All tasks are on track.')
    expect(read(withClock.q('card-latest-ago'))).toBe('5m ago')
  })
})

/* ------------------------------------------------------------------ the plate's words */

describe('the dot and the words beside the plate are the agent’s own', () => {
  it('🔴 the dot before the word is the colour of the plate’s own priority, one token per state', () => {
    const cases = [
      { name: 'idle and live', facets: { doing: 'idle', being: 'live' }, token: '--accent' },
      {
        name: 'live and needing a permission',
        facets: { needing: 'permission', being: 'live' },
        token: '--waiting',
      },
      { name: 'errored', facets: { being: 'errored' }, token: '--danger' },
    ] as const

    const drawn: string[] = []
    for (const one of cases) {
      const m = panel(createTranscript(), { facets: one.facets })
      const dot = m.q('session-bot').querySelector<HTMLElement>('.bot-dot')
      expect(dot, `${one.name} drew no dot`).not.toBeNull()
      expect(visible(dot!), `${one.name}’s dot was not drawn`).toBe(true)
      const box = dot!.getBoundingClientRect()
      expect([box.width, box.height]).toEqual([7, 7])
      const colour = paintedBy(dot!)
      expect(colour, `${one.name}’s dot`).toBe(fillOf(m.host, one.token))
      // ⚑ The reading beside the dot: the word it colours is the plate's own word for that state.
      expect(m.q('session-bot-word').textContent?.trim(), `${one.name}’s word`).toBe(
        plateWord(one.facets),
      )
      drawn.push(colour)
      m.unmount()
    }
    // ⚑ Three states, three colours: a dot of one fixed colour could not pass all three.
    expect(new Set(drawn).size).toBe(3)
  })

  it('⛔ an agent with no profile draws no pill — one with a profile draws it, then the dot and the word in order', () => {
    // The folder appears in “Workspace ⌄” below the avatar. The state line contains only the
    // dot and word.
    const facets = { doing: 'idle', being: 'live' }
    const bare = panel(createTranscript(), { facets, profile: null })
    expect(visible(bare.q('session-bot-word'))).toBe(true)
    expect(read(bare.q('session-bot-word'))).not.toBe('')
    expect(bare.all('session-bot-profile')).toHaveLength(0)
    bare.unmount()

    // ⚑ THE PAIR — the same card with a profile: the pill, and the dot before the word.
    const full = panel(createTranscript(), { facets, profile: 'brobot' })
    const profile = full.q('session-bot-profile')
    const dot = full.host.querySelector<HTMLElement>('.bot-dot')
    const word = full.q('session-bot-word')
    expect(dot, 'the dot before the word was not drawn').not.toBeNull()
    expect(read(profile)).toBe('brobot')
    for (const drawn of [profile, word, dot!]) expect(visible(drawn)).toBe(true)
    expect(dot!.getBoundingClientRect().right).toBeLessThanOrEqual(
      word.getBoundingClientRect().left,
    )
    expect(full.all('session-bot-place')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ the current task */

describe('the Current task box belongs to the newest piece still open', () => {
  it('⛔ work that is all finished still draws the quiet box — a piece still open draws none', async () => {
    const finished = show(
      answer({
        workTakenIn: taken(edge({ state: 'answered', endedAt: NOW - 30_000 })),
      }),
    )
    await drawnReady()
    const empty = finished.q('card-task-empty')
    // ⚑ W4.183 · v3 draws the current piece alone; the finished one is behind "All tasks".
    expect(finished.all('cast-taken-work')).toHaveLength(0)
    expect(visible(empty)).toBe(true)
    expect(read(empty.querySelector('.says')!)).toBe('No current task')
    // ⚑ The finished piece is in "All tasks" — it is only not the current one.
    const all = await allTasks(finished)
    expect(all.all('cast-taken-work')).toHaveLength(1)
    expect(all.host.querySelector('.task.current')).toBeNull()
    expect(all.host.querySelector('.tword')).toBeNull()
    finished.unmount()

    // ⚑ THE PAIR — the same piece still open: no quiet box, a current well, the state in words.
    const open = show(answer({ workTakenIn: taken(edge({ state: 'working' })) }))
    await drawnReady()
    expect(open.all('card-task-empty')).toHaveLength(0)
    const current = open.q('card-task').querySelectorAll<HTMLElement>('.task.current')
    expect(current).toHaveLength(1)
    const word = current[0]!.querySelector<HTMLElement>('.tword')
    expect(word, 'the current piece said no state in words').not.toBeNull()
    expect(visible(word!)).toBe(true)
    expect(read(word!)).toBe('being worked on')
  })

  it('🔴 the current piece is the newest one still OPEN — a newer finished piece does not take its place', async () => {
    const m = show(
      answer({
        workTakenIn: taken(
          edge({ piece: 'work_63', label: 'W63', state: 'working', givenAt: NOW - 120_000 }),
          edge({
            piece: 'work_64',
            label: 'W64',
            title: 'Write it up',
            state: 'answered',
            givenAt: NOW - 60_000,
            endedAt: NOW - 30_000,
          }),
        ),
      }),
      briefed('Check the header.'),
    )
    await drawnReady()
    const current = m.q('card-task').querySelectorAll<HTMLElement>('.task.current')
    expect(current).toHaveLength(1)
    expect(read(current[0]!)).toContain('W63')
    expect(read(current[0]!.querySelector('.tword')!)).toBe('being worked on')
    const brief = m.q('cast-work-brief')
    expect(visible(brief)).toBe(true)
    expect(read(brief)).toBe('Check the header.')
    expect(current[0]!.contains(brief)).toBe(true)
    // ⚑ The newer, finished piece keeps its one line behind "All tasks" (W4.183) — and none of the
    // well, the word or the brief.
    const all = await allTasks(m)
    const newer = [...all.host.querySelectorAll<HTMLElement>('li.task')].find((li) =>
      read(li).includes('W64'),
    )!
    expect(newer, 'no line for W64 in All tasks').toBeDefined()
    expect(newer.classList.contains('current')).toBe(false)
    expect(newer.querySelector('.tword')).toBeNull()
    expect(read(newer)).toContain('Write it up')
    m.unmount()

    // ⚑ THE PAIR — with both still open the newest is the current one, and it has no brief.
    const both = show(
      answer({
        workTakenIn: taken(
          edge({ piece: 'work_63', label: 'W63', state: 'working', givenAt: NOW - 120_000 }),
          edge({
            piece: 'work_64',
            label: 'W64',
            title: 'Write it up',
            state: 'working',
            givenAt: NOW - 60_000,
          }),
        ),
      }),
      briefed('Check the header.'),
    )
    await drawnReady()
    const now = both.q('card-task').querySelectorAll<HTMLElement>('.task.current')
    expect(now).toHaveLength(1)
    expect(read(now[0]!)).toContain('W64')
    expect(both.all('cast-work-brief')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ the chips */

describe('every chip wears the dot of the plate beside it', () => {
  it('🔴 each chip’s dot is the colour of the plate beside it — the rail’s reading, not the band’s own', async () => {
    const m = show(
      answer({
        children: walk([spawn('sess_a'), spawn('sess_b')], 'every-conversation-this-one-spawned'),
      }),
      createTranscript(),
      new Map([
        ['sess_a', railRow({ needing: 'permission', being: 'live' }, 'Waiting')],
        ['sess_b', railRow({ doing: 'idle', being: 'live' }, 'Idle')],
      ]),
    )
    await drawnReady()
    // ⚑ With no screen above the drawer a chip is no button (`f1fa1e2e`): found by its conversation.
    const dotOf = (conversation: string): HTMLElement => {
      const dot = m
        .q('cast-children-strip')
        .querySelector<HTMLElement>(`.agent-chip[data-conversation="${conversation}"] .chip-dot`)
      expect(dot, `no dot on ${conversation}'s chip`).not.toBeNull()
      expect(visible(dot!)).toBe(true)
      return dot!
    }
    const a = paintedBy(dotOf('sess_a'))
    const b = paintedBy(dotOf('sess_b'))
    expect(a).toBe(fillOf(m.host, '--waiting'))
    expect(b).toBe(fillOf(m.host, '--accent'))
    // ⚑ Two chips, two colours: a dot that ignored the rail would give both the same one.
    expect(a).not.toBe(b)
  })

  it('🔴 every section of a card is a framed box — Current task, Sub agents and Images draw the same line, corners and fill', async () => {
    const m = show(
      answer({
        children: walk([spawn('sess_a'), spawn('sess_b')], 'every-conversation-this-one-spawned'),
      }),
      made({ path: '/work/shots/state-a.png', prompt: 'picture 0' }),
    )
    await drawnReady()

    const sections = [
      { cy: 'card-task', title: 'Current task' },
      { cy: 'cast-sub-agents', title: 'Started here' },
      { cy: 'panel-assets', title: 'Images' },
    ]
    for (const one of sections) {
      const box = m.q(one.cy)
      // ⚑ A drawn section — its title is read first, so the frame below belongs to it.
      expect(read(box.querySelector('.title')!), `${one.cy}’s title`).toBe(one.title)
      expect(visible(box)).toBe(true)
      const style = getComputedStyle(box)
      expect(style.borderTopWidth, `${one.cy}’s line`).toBe('1px')
      expect(style.borderTopColor, `${one.cy}’s line colour`).toBe(lineOf(m.host))
      expect(style.borderTopLeftRadius, `${one.cy}’s corners`).toBe(cornersOf(m.host))
      expect(style.backgroundColor, `${one.cy}’s fill`).toBe(fillOf(m.host, '--panel'))
    }
  })
})

/* ------------------------------------------------------------------ the Images tiles */

describe('an Images tile draws its picture at 4:3, and tells what a press does', () => {
  it('🔴 a tile draws its picture at 4:3, says what a press does with no prompt, and tells its cut name on a title', async () => {
    const NAME = 'the-screenshot-of-the-state-that-looked-wrong-first-in-the-morning.png'
    const m = panel(
      made({ path: `/work/shots/${NAME}` }, { path: '/work/shots/short.png', prompt: 'picture 1' }),
      { who: 'Ana' },
      900,
    )
    const tiles = m.all('panel-asset')
    expect(tiles).toHaveLength(2)
    const [long, short] = tiles as [HTMLElement, HTMLElement]
    // ⚑ Neither file exists: wait for both to draw the image mark, so the thumbnails are settled.
    for (const tile of tiles) {
      await expect
        .poll(() => tile.querySelector('.thumb')?.querySelector('svg.icon') !== null)
        .toBe(true)
    }
    await drawnReady()

    // ⚑ (a) No prompt: the press says only what it does — and the thumbnail is 4:3.
    expect(long.getAttribute('title')).toBe('Open this image')
    const thumb = long.querySelector<HTMLElement>('.thumb')!
    const box = thumb.getBoundingClientRect()
    expect(box.height).toBeGreaterThan(0)
    expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.02)
    // ⚑ …and the name is cut to one line, with the whole of it on its title.
    const name = long.querySelector<HTMLElement>('.tile-name')!
    expect(read(name)).toBe(NAME)
    assertClippedButTold(name, 'the tile’s file name', m.host)
    expect(name.title).toBe(NAME)

    // ⚑ THE PAIR — (b) a short name and a prompt: drawn in full, and the prompt on the press.
    expect(short.getAttribute('title')).toBe('Open this image — picture 1')
    const shortName = short.querySelector<HTMLElement>('.tile-name')!
    expect(read(shortName)).toBe('short.png')
    assertDrawn(shortName, 'the short tile’s file name', m.host)
    expect(cutsOf(shortName, m.host)).toEqual([])
  })
})
