import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import type {
  PaletteAgent,
  PaletteNavigation,
  PaletteOpenRow,
} from '../../src/renderer/src/lib/command-palette'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { mount, unmountAll } from './harness'

/**
 * # 279 · the agent's own commands, in an engine that can actually be pressed
 *
 * ⛔ **This file exists because `279` §3's ruling is about a KEYSTROKE.** The dispatch permits the
 * palette to list a command it cannot run *"as long as it says so"* — and the way this build says so
 * is that Enter can never reach one of those rows. That is not a claim `desktop` can check: SSR
 * renders once and cannot press a key, cannot walk a cursor, and cannot click. Every assertion in
 * `agent-commands.test.ts` is about the rule; every assertion here is about the gesture.
 *
 * ## ⚠️ The two failures this file is built to catch
 *
 *  1. **Enter running something it should not.** A cursor that could land on `/compact` would make
 *     the palette appear to offer a command it will never send — `106` with a heading.
 *  2. ⛔ **The no-match state drawn OVER a full band.** `shown` and `drawn` were one list until this
 *     dispatch split them, and a query matching only the agent's commands is exactly where they
 *     part: nothing is runnable, everything is visible. Getting it wrong renders *"Nothing matches"*
 *     above 44 results AND makes Enter navigate away from them.
 *
 * ⚠️ **Every negative assertion is paired**, as in `command-palette.dom.test.ts`: a test asserting
 * *"Enter did not navigate"* would pass over a palette that never opened, so each one also fires a
 * gesture that MUST work and checks that it did.
 */

const openRow = (sessionId: string, label: string): PaletteOpenRow => ({
  sessionId,
  provider: 'claude',
  label,
  // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece: titled by its label.
  named: null,
  word: 'idle',
  opening: null,
  // ⚑ **449 · `null` is a real state on this fixture**: these rows exist to press keys against, and
  // a folder would add a fact no assertion here reads.
  place: null,
})

const CLAUDE: PaletteAgent = {
  provider: 'claude',
  set: {
    prefix: '/',
    commands: [
      {
        name: 'compact',
        description: 'Free up context by summarizing the conversation so far',
        argumentHint: '<optional custom summarization instructions>',
      },
      { name: 'usage', description: 'Show session cost and plan usage', aliases: ['stats'] },
    ],
  },
  dropped: 0,
}

interface Harness {
  navigations: PaletteNavigation[]
}

function palette(agent: PaletteAgent | null, over: Record<string, unknown> = {}): Harness {
  const navigations: PaletteNavigation[] = []
  mount(
    CommandPalette,
    {
      // ⚑ **D-017b · the rail's one list.**
      conversations: [openRow('sess_a', 'workspace-a'), openRow('sess_b', 'other-place')],
      looked: true,
      listError: null,
      activeId: 'sess_a',
      agent,
      onNavigate: (action: PaletteNavigation) => navigations.push(action),
      ...over,
    },
    { width: 1200 },
  )
  return { navigations }
}

/** As `command-palette.dom.test.ts`: dispatched at the FOCUSED element, which is the app's own path. */
const key = (init: KeyboardEventInit): void => {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

const cmdK = (): void => key({ key: 'k', metaKey: true })
const find = (cy: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
const need = (cy: string): HTMLElement => {
  const el = find(cy)
  expect(el, `nothing with data-cy="${cy}" is in the document`).not.toBeNull()
  return el!
}
const rowIds = (): string[] =>
  [...document.body.querySelectorAll('[data-cy^="palette-row-"]')].map(
    (el) => el.getAttribute('data-cy') ?? '',
  )
const currentRow = (): string =>
  document.body.querySelector('[data-current="true"]')?.getAttribute('data-cy') ?? ''

async function type(text: string): Promise<void> {
  const box = need('palette-search') as HTMLInputElement
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function open(
  agent: PaletteAgent | null,
  over: Record<string, unknown> = {},
): Promise<Harness> {
  const harness = palette(agent, over)
  cmdK()
  await nextTick()
  return harness
}

afterEach(() => {
  unmountAll()
  useOverlays().overlay.value = null
  useOverlays().toasts.value = []
})

describe('279 · the band is on screen and says whose it is', () => {
  it('⛔ draws the agent’s commands, written the way the provider writes them', async () => {
    await open(CLAUDE)
    const band = need('palette-band-agent')
    expect(band.textContent).toContain("Claude's own commands")
    expect(rowIds()).toContain('palette-row-agent-compact')
    expect(need('palette-row-agent-compact').textContent).toContain('/compact')
    // The hint travels: 17 of the 44 live rows carry one and it is most of what a person needs.
    expect(need('palette-row-agent-compact').textContent).toContain('takes <optional custom')
    // ⛔ **And the whole detail is REACHABLE, not merely carried.** `.palette-row small` clips to one
    // line, so a 500-character description would otherwise cross the wire and be shown to nobody —
    // which would make `MAX_COMMAND_TEXT`'s own argument for 500 rather than 200 self-defeating.
    expect(need('palette-row-agent-compact').getAttribute('title')).toContain('Free up context')
    // …and BroBot's own rows are unchanged: this is the agent band's affordance, not a new one for
    // the whole palette. ⚑ D-016 · the destination row this file presses was *Home* until Home was
    // deleted; *Team* is one of the go rows that remain.
    expect(need('palette-row-go-team').getAttribute('title')).toBeNull()
  })

  it('⛔ …and BroBot’s own rows are still there, above it', async () => {
    await open(CLAUDE)
    const ids = rowIds()
    // ⚑ **The pairing for every "the agent band is separate" claim in this file.** A palette that
    // rendered ONLY the agent band would satisfy the heading assertions above.
    expect(ids).toContain('palette-row-go-team')
    expect(ids).toContain('palette-row-open-sess_b')
    expect(
      ids.indexOf('palette-row-go-team'),
      'and the agent band is drawn after them',
    ).toBeLessThan(ids.indexOf('palette-row-agent-compact'))
  })

  it('⛔ says it lists them and does not run them — §3’s disclosure, on screen', async () => {
    await open(CLAUDE)
    const said = need('palette-agent-note').textContent ?? ''
    expect(said).toContain('2 commands')
    expect(said).toContain('does not run them')
    // …and the palette's own "what did I search" sentence is still beside it, unchanged — ⚑ D-017b:
    // it counts the one list.
    expect(need('palette-searched').textContent).toContain('2 conversations')
  })
})

describe('279 · listed, not run — the gesture half', () => {
  it('⛔ the cursor cannot LAND on an agent row, however far you arrow down', async () => {
    await open(CLAUDE)
    const runnableRows = rowIds().filter((id) => !id.startsWith('palette-row-agent-'))
    expect(runnableRows.length, 'there are runnable rows to walk').toBeGreaterThan(0)
    const landed = new Set<string>()
    // One full lap and one more, so a wrap cannot hide a row the cursor only reaches on the way back.
    for (let step = 0; step < runnableRows.length * 2 + 4; step++) {
      key({ key: 'ArrowDown' })
      await nextTick()
      landed.add(currentRow())
    }
    expect([...landed].filter((id) => id.startsWith('palette-row-agent-'))).toEqual([])
    // ⛔ **Paired**: the walk really did move, so the emptiness above is about agent rows and not
    // about a cursor that never went anywhere.
    expect(landed.size).toBe(runnableRows.length)
  })

  it('⛔ Enter over a query that matches ONLY agent rows does nothing — and shows them', async () => {
    const h = await open(CLAUDE)
    await type('compact')
    // The rows are on screen…
    expect(rowIds()).toEqual(['palette-row-agent-compact'])
    // ⛔ **…and the no-match state is NOT**, which is the `shown`/`drawn` split. Before it, this
    // query rendered "Nothing matches “compact”" above a visible result.
    expect(find('palette-no-match'), 'a full band is not a search miss').toBeNull()

    key({ key: 'Enter' })
    await nextTick()
    expect(h.navigations, 'Enter neither ran it nor escaped to the library').toEqual([])
    expect(find('palette-panel'), 'and the palette is still open over the list').not.toBeNull()
  })

  it('⛔ …while Enter on a REAL miss still takes the one way out', async () => {
    // The pairing for the test above. `zzz` matches nothing at all, so the escape hatch is the only
    // thing offered and the key everything else uses has to reach it (`169`'s finding).
    const h = await open(CLAUDE)
    await type('zzzqqq')
    expect(rowIds()).toEqual([])
    // ⛔ **556: the miss is READ, not counted.** `not.toBeNull()` passes over an empty panel, and
    // the one thing this state owes a person is the heading naming what they searched for
    // (`noMatchHeading`, and `238`'s *"quoting, in its own heading, a string nobody had searched"*
    // is why it must be THIS query).
    expect(find('palette-no-match')?.textContent).toContain('zzzqqq')
    key({ key: 'Enter' })
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'go', place: 'sessions' }])
  })

  it('⛔ clicking a listed row navigates nowhere and does not close the palette', async () => {
    const h = await open(CLAUDE)
    need('palette-row-agent-compact').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(h.navigations).toEqual([])
    // ⚠️ **Still open, deliberately.** A person reading the agent's commands who brushes one must
    // not have the panel close under them, taking the list with it.
    // ⛔ **556: and *still open* is about a list still being READABLE.** The row that was brushed
    // is named, so a panel left standing with its rows gone would no longer pass this.
    expect(find('palette-panel')).not.toBeNull()
    expect(need('palette-row-agent-compact').textContent).toContain('compact')

    // ⛔ **Paired**: the same gesture on a runnable row DOES act and DOES close, so the two lines
    // above are about the row and not about a mousedown handler that stopped working.
    need('palette-row-go-team').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'go', place: 'team' }])
    expect(find('palette-panel')).toBeNull()
  })

  it('⛔ an agent row never wears the highlight, and never announces itself as an option', async () => {
    await open(CLAUDE)
    const listed = need('palette-row-agent-compact')
    expect(listed.getAttribute('data-listed')).toBe('true')
    // `role="option"` is a promise to a screen reader that Enter acts on this row (`223`'s rule:
    // naming a gesture a mount has switched off is `106` one layer down).
    expect(listed.getAttribute('role')).toBe('presentation')
    expect(listed.getAttribute('aria-selected')).toBeNull()
    // Paired with a row that IS one, so this is not an assertion over markup nothing sets.
    const real = need('palette-row-go-team')
    expect(real.getAttribute('role')).toBe('option')
    expect(real.getAttribute('data-listed')).toBe('false')
  })
})

describe('279 · a session nobody has told us about (§2)', () => {
  it('⛔ shows NO band and says why — never an empty section', async () => {
    await open({ provider: 'claude', set: null, dropped: 0 })
    expect(find('palette-band-agent'), 'no empty section is drawn').toBeNull()
    expect(rowIds().filter((id) => id.startsWith('palette-row-agent-'))).toEqual([])
    // ⛔ **The half that makes the absence honest rather than silent.**
    expect(need('palette-agent-note').textContent).toContain('has not been told')
    // …and the rest of the palette is untouched, which is the pairing.
    expect(rowIds()).toContain('palette-row-go-team')
  })

  it('⛔ a provider that answered with NOTHING reads differently from one that never answered', async () => {
    await open({ provider: 'claude', set: { prefix: '/', commands: [] }, dropped: 0 })
    const said = need('palette-agent-note').textContent ?? ''
    expect(said).toContain('reports no commands of its own')
    expect(said).not.toContain('has not been told')
    expect(find('palette-band-agent')).toBeNull()
  })

  it('⛔ with no conversation on screen the palette says nothing about an agent at all', async () => {
    await open(null, { activeId: null })
    expect(find('palette-agent-note')).toBeNull()
    expect(find('palette-band-agent')).toBeNull()
    // Paired: the palette is genuinely open and still doing its job.
    expect(need('palette-searched').textContent).toContain('Searched')
    expect(rowIds()).toContain('palette-row-go-team')
  })
})
