import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import PromptComposer from '../../src/renderer/src/components/PromptComposer.vue'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import type { PaletteNavigation, PaletteOpenRow } from '../../src/renderer/src/lib/command-palette'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { channelGap, mount, paintedBackground, parseColor, unmountAll, visible } from './harness'

/**
 * # 249 · ⌘K, in an engine that can actually be pressed
 *
 * ⛔ **This file exists because the thing being shipped is a KEY**, and because the key it claims
 * was already answered by two window listeners this dispatch may not edit:
 *
 *  - `RuntimeScreen.vue`'s `onKey`, the `event.key === 'k'` branch → `say('Command palette — not
 *    wired yet.')`
 *  - `ConversationPane.vue:652-658` → **interrupt the running turn**
 *
 * ⚠️ **The second is the dangerous one.** A palette is the first surface in this app that can be
 * open over a live conversation pane, and the pane's own comment says why that matters: *"Escape
 * belongs to it… interrupting the turn as well would make one key do two unrelated things at
 * once."* Every overlay the pane can raise is named in its guard; this one cannot be, so the claim
 * has to hold from the outside. **That is what the `bubbleSpy` below stands in for** — it is a
 * bubble-phase `window` keydown listener, which is exactly what both of those are.
 *
 * ⚠️ **Every "the listener saw nothing" assertion is a DELTA, never an absolute**, and the reason is
 * written down in `send-gate.dom.test.ts:273-275`: window listeners from earlier mounts in the same
 * file are still attached. Each test reads the spy before and after.
 *
 * ⚠️ **And every claim is paired with its opposite.** A listener that saw nothing because the key
 * never fired proves nothing at all, so each suppression test also fires a chord the palette does
 * NOT claim and asserts the same listener receives it.
 */

type Api = { runtime: { exportSession: (input: unknown) => Promise<unknown> } }
const stubbed = (): { api?: Api } => window as unknown as { api?: Api }

/** ⚑ **D-017b · one row of the rail's one list** — the same shape whatever the conversation is doing. */
const openRow = (
  sessionId: string,
  label: string,
  over: Partial<PaletteOpenRow> = {},
): PaletteOpenRow => ({
  sessionId,
  provider: 'codex',
  label,
  // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece: titled by its label, as every
  // press below reads it.
  named: null,
  word: 'idle',
  opening: null,
  place: null,
  ...over,
})

interface Harness {
  navigations: PaletteNavigation[]
  /** How many keydowns a BUBBLE-phase window listener has seen — the stand-in for both stubs. */
  seen: () => number
  unbind: () => void
}

function palette(over: Record<string, unknown> = {}): Harness {
  const navigations: PaletteNavigation[] = []
  let count = 0
  const bubbleSpy = (): void => void (count += 1)
  // Bubble phase, no options — byte for byte what `RuntimeScreen`'s and `ConversationPane`'s own
  // `onMounted(() => window.addEventListener('keydown', onKey))` register.
  window.addEventListener('keydown', bubbleSpy)
  mount(
    CommandPalette,
    {
      // ⚑ **D-017b · the one list** — `sess_closed` is a conversation nothing runs, and it is a row
      // like the other two (it was the *Closed conversations* band's until then).
      conversations: [
        openRow('sess_a', 'workspace-a'),
        openRow('sess_b', 'other-place'),
        openRow('sess_closed', 'checkout', { provider: 'claude' }),
      ],
      looked: true,
      listError: null,
      activeId: 'sess_a',
      // 279 — stated rather than left off. `null` here is *"no agent to talk about"*, which is what
      // every test in this file that predates the band means; the band's own tests are in
      // `agent-commands.dom.test.ts` and pass a set.
      agent: null,
      onNavigate: (action: PaletteNavigation) => navigations.push(action),
      ...over,
    },
    { width: 1200 },
  )
  return {
    navigations,
    seen: () => count,
    unbind: () => window.removeEventListener('keydown', bubbleSpy),
  }
}

/**
 * ⛔ **Dispatched at the FOCUSED ELEMENT, not at `window`, and the difference is the whole test.**
 *
 * ⚠️ **Measured, after the first version of this file failed on all five suppression assertions.**
 * `window.dispatchEvent(…)` makes `window` the event's own target, so every listener on it —
 * capture and bubble alike — runs in the AT_TARGET phase, in REGISTRATION order. A capture listener
 * registered second therefore fires second, and `stopImmediatePropagation` stops nothing that was
 * already bound. That is not how a keystroke reaches this app: a real one targets whatever has
 * focus, `window` is the outermost ancestor, and its capture listeners genuinely run first.
 *
 * ⚑ **So the harness that would have been simpler is the harness that would have lied** — in the
 * safe direction here (it reported the claim failing when it does not), but a test whose event path
 * is not the app's event path can just as easily report a claim holding when it does not. Other
 * files in this directory dispatch at `window` because they assert that a listener RAN; this one
 * asserts that one did not, which is a question only the real path can answer.
 */
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

const bound: (() => void)[] = []
afterEach(() => {
  unmountAll()
  while (bound.length) bound.pop()!()
  useOverlays().overlay.value = null
  useOverlays().toasts.value = []
  delete stubbed().api
})

function open(over: Record<string, unknown> = {}): Harness {
  const h = palette(over)
  bound.push(h.unbind)
  return h
}

/**
 * ⛔ **The palette OVER a real composer, with a real draft in it** (292 §4, from `288` M1).
 *
 * ⚠️ **A separate harness rather than a change to {@link palette}, on purpose.** Every other test
 * in this file measures a window listener, and adding a second component to their mount would put
 * an unrelated surface inside every one of those measurements. This one measures a SEND, which is
 * the only thing that can tell a chord that reached the composer from a chord that reached
 * `window` on its way past it — and `288` M1 is precisely the difference between those two.
 */
function paletteOverComposer(draft: string): { sent: string[] } {
  const sent: string[] = []
  const Host = defineComponent({
    name: 'PaletteOverComposer',
    setup: () => () => [
      h(PromptComposer as never, {
        state: 'idle',
        draft,
        cwd: '/work/alpha',
        handing: createAttachmentBook().handing('session:alpha'),
        onSend: (text: string) => sent.push(text),
      }),
      h(CommandPalette as never, {
        conversations: [openRow('sess_a', 'workspace-a')],
        looked: true,
        listError: null,
        activeId: 'sess_a',
      }),
    ],
  })
  mount(Host, {}, { width: 1200 })
  return { sent }
}

/**
 * A mount whose `open` rows can CHANGE — which the plain harness cannot give, because it hands the
 * component a fixed props object.
 *
 * ⚠️ **The one hazard in this component that only moving props can reach**: the palette is open over
 * a live app, so a conversation can end, or a provider can go quiet, while a person is reading the
 * list. `send-gate.dom.test.ts` uses the same wrapper trick for the same reason.
 */
function openLive(rows: PaletteOpenRow[]): {
  rows: Ref<PaletteOpenRow[]>
  seenDelta: () => number
} {
  const live = ref<PaletteOpenRow[]>(rows)
  let count = 0
  const bubbleSpy = (): void => void (count += 1)
  window.addEventListener('keydown', bubbleSpy)
  bound.push(() => window.removeEventListener('keydown', bubbleSpy))
  const Wrapper = defineComponent({
    setup: () => () =>
      h(CommandPalette, {
        conversations: live.value,
        looked: true,
        listError: null,
        activeId: null,
        agent: null, // 279 — as in `palette()` above.
      }),
  })
  mount(Wrapper, {}, { width: 1200 })
  return { rows: live, seenDelta: () => count }
}

describe('249 · ⌘K claims its key, and only its key', () => {
  it('⛔ opens on ⌘K — and the bubble listener that would have said "not wired yet" never runs', async () => {
    const h = open()
    expect(find('palette-panel')).toBeNull()

    const before = h.seen()
    cmdK()
    await nextTick()
    expect(visible(need('palette-panel'))).toBe(true)
    expect(h.seen() - before, '⌘K reached a bubble-phase window listener').toBe(0)

    // ⚠️ **The paired positive.** A chord the palette does not claim must still get through, or
    // this test would pass over a listener that had simply stopped being called.
    const mid = h.seen()
    key({ key: 'j', metaKey: true })
    expect(h.seen() - mid).toBe(1)
  })

  it('⛔ Escape closes it WITHOUT reaching the listener that interrupts the turn', async () => {
    const h = open()
    cmdK()
    await nextTick()

    const before = h.seen()
    key({ key: 'Escape' })
    await nextTick()
    expect(find('palette-panel')).toBeNull()
    expect(h.seen() - before, 'Escape reached the pane, which would stop the running turn').toBe(0)

    // ⚠️ **…and it is given straight back the moment the palette closes**, which is the half that
    // makes the claim narrow: Escape belongs to the conversation whenever this panel is not up.
    const after = h.seen()
    key({ key: 'Escape' })
    expect(h.seen() - after).toBe(1)
  })

  /**
   * # 🔴 ⌘↵ with the palette open sends NOTHING, and says so (292 §4, from `288` M1)
   *
   * ## ⛔ What this test asserted before, and why that was worth nothing
   *
   * It read *"⌘↵ and ⇧⌘↵ stay the composer's, even with the palette open"* and proved it by
   * counting the bubble-phase `window` spy: the chords reached `window`, so the palette had not
   * swallowed them. ⚠️ **That was TRUE and it was not the claim.** Reaching `window` is not
   * reaching the composer — the send handler is `@keydown.enter` on the textarea, and an event
   * dispatched at the palette's input bubbles UPWARD, never sideways into a sibling. `288` M1
   * named this file's test as the reason the defect survived: no composer was mounted, so nothing
   * could observe that no send happened.
   *
   * ⚑ **So the composer is mounted, and the outcome counted is the SEND.** Both halves are here:
   * the chord does not send while the palette is up, and it does send the moment the palette is
   * closed by the key the refusal names — without which "no send" would be satisfied by a composer
   * that had simply stopped working.
   */
  it('🔴 ⌘↵ with the palette open sends NOTHING, and the palette says why', async () => {
    const { sent } = paletteOverComposer('redirect this')
    await nextTick()
    // ⚠️ Focus the composer first, exactly as a person typing a message would have it — so the
    // chord below starts where a real one starts and `key()` dispatches at the right target.
    need('prompt-input').focus()
    cmdK()
    await nextTick()

    key({ key: 'Enter', metaKey: true })
    key({ key: 'Enter', metaKey: true, shiftKey: true })
    await nextTick()

    // ⛔ **The outcome, not a listener count.** Neither chord reached the conversation.
    expect(sent, 'a send happened from inside the palette').toEqual([])
    // ⛔ …and it was not a silent no-op either, which is the whole finding.
    const refusal = need('palette-chord-refused')
    expect(visible(refusal)).toBe(true)
    expect(refusal.textContent).toContain('Esc')
    expect(refusal.getAttribute('role')).toBe('alert')
    // …and the panel is still up — the chords were not treated as "run this row".
    expect(visible(need('palette-panel'))).toBe(true)

    // ⛔ **…and the refusal is an answer to a gesture, not a state.** Typing moves on, so it goes;
    // a sentence about a chord still on screen three searches later would be the app answering
    // something nobody did.
    await type('work')
    expect(find('palette-chord-refused')).toBeNull()

    // ⚑ **THE PAIRED POSITIVE.** Take the way out the refusal names, then press the same chord.
    key({ key: 'Enter', metaKey: true })
    await nextTick()
    expect(need('palette-chord-refused'), 'the refusal stopped being raised at all').not.toBeNull()
    key({ key: 'Escape' })
    await nextTick()
    expect(find('palette-panel')).toBeNull()
    // …and it does not come back with the panel: Esc was the remedy, and it worked.
    cmdK()
    await nextTick()
    expect(find('palette-chord-refused')).toBeNull()
    key({ key: 'Escape' })
    await nextTick()
    need('prompt-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
    )
    await nextTick()
    expect(sent, 'the composer stopped sending altogether — the negative above is vacuous').toEqual(
      ['redirect this'],
    )
  })

  it('⚠️ ⌘N gets out of the way rather than being taken', async () => {
    const h = open()
    cmdK()
    await nextTick()

    const before = h.seen()
    key({ key: 'n', metaKey: true })
    await nextTick()
    expect(find('palette-panel'), 'the palette stayed up over the launcher ⌘N opened').toBeNull()
    expect(
      h.seen() - before,
      'the palette swallowed ⌘N instead of letting RuntimeScreen have it',
    ).toBe(1)
  })

  it('⚑ ⌘K again closes it — one chord, one gesture, both directions', async () => {
    open()
    cmdK()
    await nextTick()
    expect(find('palette-panel')).not.toBeNull()
    cmdK()
    await nextTick()
    expect(find('palette-panel')).toBeNull()
  })
})

describe('249 · what is on it, and what Enter does', () => {
  it('⛔ every band the rail can fill is drawn, in band order', async () => {
    open()
    cmdK()
    await nextTick()
    expect(need('palette-band-this').textContent).toContain('This conversation')
    expect(rowIds()).toEqual([
      'palette-row-this-export-native',
      'palette-row-this-export-bundle',
      'palette-row-open-sess_a',
      'palette-row-open-sess_b',
      // ⚑ **D-017b · a conversation nothing runs is in the one band**, beside the others.
      'palette-row-open-sess_closed',
      'palette-row-go-new',
      'palette-row-go-sessions',
      // ⚑ **606 · the two destinations `EXT-008` §3 split Home into**, in the rail's own order —
      // *New conversation · Waiting on you · While you were away · Projects · Agents · Tools ·
      // History*. ⚑ **D-016 took Home and Projects out**, and `go-home` and `go-projects` went
      // with the places they opened.
      'palette-row-go-waiting',
      'palette-row-go-away',
      // ⚑ **566 · the Tools destination joined the band**, which is what makes the palette's own
      // `toEqual` over `buildCommands` the gate every new place has to pass through.
      'palette-row-go-tools',
      // ⚑ **570 · and Team, on the same gate.** ⛔ It is the one destination whose SCREEN existed
      // before its row did — `568` built the page and nothing in the app reached it — so this
      // line and the rail row beside it are the whole of what made it a place.
      'palette-row-go-team',
      'palette-row-go-providers',
    ])
  })

  it('⛔ typing narrows it, arrows walk it, and Enter runs the row under the cursor', async () => {
    const h = open()
    cmdK()
    await nextTick()
    expect(currentRow()).toBe('palette-row-this-export-native')

    await type('place')
    expect(rowIds()).toEqual(['palette-row-open-sess_b'])
    expect(currentRow()).toBe('palette-row-open-sess_b')

    key({ key: 'Enter' })
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'select', sessionId: 'sess_b' }])
    expect(find('palette-panel'), 'the palette outlived its own answer').toBeNull()
  })

  it('⚠️ the arrows move the cursor and wrap, and the highlight follows', async () => {
    open()
    cmdK()
    await nextTick()
    // ⚑ Three, not one: the two export rows name the conversation they act on in their own second
    // line, so a folder name finds the conversation AND what can be done with it. That is the
    // `detail` rank in `score`, and it is the behaviour worth having.
    await type('workspace')
    expect(rowIds()).toEqual([
      'palette-row-open-sess_a',
      'palette-row-this-export-native',
      'palette-row-this-export-bundle',
    ])

    await type('')
    expect(currentRow()).toBe('palette-row-this-export-native')
    key({ key: 'ArrowDown' })
    await nextTick()
    expect(currentRow()).toBe('palette-row-this-export-bundle')
    key({ key: 'ArrowUp' })
    key({ key: 'ArrowUp' })
    await nextTick()
    // Wrapped past the top to the last row, rather than sticking at the first.
    // ⚠️ **The LAST row, whatever it is** — `566` appended `go-tools` after `go-home`, `570`
    // appended `go-team` after that, and `go-providers` after that. A wrap assertion naming a
    // row is a claim about the row order too.
    expect(currentRow()).toBe('palette-row-go-providers')
  })

  it('⛔ a conversation nothing runs leaves as the one press — the rail routes it, the palette starts nothing', async () => {
    // ⚑ **D-017b · re-aimed from *"a reopen leaves as a reopen"*.** There is no reopen any more: a
    // conversation opens in its full view whatever it is doing, so its palette row leaves through
    // the rail's `select`, exactly as a running one does — and the palette itself resumes nothing.
    const h = open()
    cmdK()
    await nextTick()
    await type('checkout')
    expect(rowIds()).toEqual(['palette-row-open-sess_closed'])
    key({ key: 'Enter' })
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'select', sessionId: 'sess_closed' }])
  })

  it('⛔ a search miss says so, quotes the query, and offers the page that holds the rest', async () => {
    const h = open()
    cmdK()
    await nextTick()
    await type('zzz-nothing-here')
    expect(rowIds()).toEqual([])
    expect(need('palette-no-match').textContent).toContain('Nothing matches “zzz-nothing-here”')
    expect(need('palette-no-match').textContent).toContain('All conversations')

    // ⛔ `239`: the workaround is discoverable because it is stated in the refusal — and it works.
    need('palette-open-library').click()
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'go', place: 'sessions' }])
  })

  it('⛔ …and SPACE activates it, not only Enter and the mouse', async () => {
    // ⚠️ **`@click`, not `@mousedown.prevent`** (found in this dispatch's own review). With
    // mousedown alone the button answered the mouse and — by accident, through the window handler's
    // no-match branch — Enter, while Space, the other half of every button's keyboard contract,
    // reached the focused element and found nothing listening. A control that answers one of the
    // two standard activation keys is `106` for whoever presses the other.
    const h = open()
    cmdK()
    await nextTick()
    await type('zzz-nothing-here')
    key({ key: 'Tab' })
    await nextTick()
    expect(document.activeElement).toBe(need('palette-open-library'))

    // Space on a focused button is a native click; the palette must not have swallowed the key.
    ;(document.activeElement as HTMLElement).click()
    await nextTick()
    expect(h.navigations).toEqual([{ kind: 'go', place: 'sessions' }])
  })

  it('⛔ …and Enter takes that one offer, rather than running whatever was selected before', async () => {
    const h = open()
    cmdK()
    await nextTick()
    // Walk the cursor off the first row FIRST, so a stale `current` would be visible in the result.
    key({ key: 'ArrowDown' })
    key({ key: 'ArrowDown' })
    await nextTick()
    await type('zzz-nothing-here')
    key({ key: 'Enter' })
    await nextTick()
    // The escape hatch, not row 3 of the list that no longer matches.
    expect(h.navigations).toEqual([{ kind: 'go', place: 'sessions' }])
    expect(find('palette-panel')).toBeNull()
  })

  it('⛔ the one control on a miss is reachable by Tab, not only by mouse', async () => {
    open()
    cmdK()
    await nextTick()
    await type('zzz-nothing-here')
    expect(document.activeElement).toBe(need('palette-search'))

    key({ key: 'Tab' })
    await nextTick()
    expect(document.activeElement, 'a keyboard-only user cannot reach the way out').toBe(
      need('palette-open-library'),
    )
    // …and it cycles back rather than escaping into the surface behind.
    key({ key: 'Tab' })
    await nextTick()
    expect(document.activeElement).toBe(need('palette-search'))
    key({ key: 'Tab', shiftKey: true })
    await nextTick()
    expect(document.activeElement).toBe(need('palette-open-library'))
  })

  it('⚠️ the list is only announced as a list when there is one', async () => {
    open()
    cmdK()
    await nextTick()
    const box = need('palette-search')
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(box.getAttribute('aria-controls')).toBe('palette-rows')
    expect(document.getElementById('palette-rows')).not.toBeNull()

    await type('zzz-nothing-here')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    expect(box.getAttribute('aria-controls')).toBeNull()
    expect(document.getElementById('palette-rows')).toBeNull()
  })
})

describe('249 · the list moving underneath a reader', () => {
  it('⛔ when conversations end while the palette is open, the highlight stays on a REAL row', async () => {
    const live = openLive(
      Array.from({ length: 6 }, (_, at) => openRow(`sess_${at}`, `folder-${at}`)),
    )
    cmdK()
    await nextTick()
    for (let step = 0; step < 7; step += 1) key({ key: 'ArrowDown' })
    await nextTick()
    // 6 conversations + 5 destinations = 11 rows (no `this` band: nothing is on screen). Seven
    // downs from index 0 lands on index 7, which is the second destination.
    expect(currentRow()).toBe('palette-row-go-sessions')

    // Five of the six conversations end. The cursor's old index is now past the end.
    live.rows.value = [openRow('sess_0', 'folder-0')]
    await nextTick()
    await nextTick()

    const highlighted = currentRow()
    expect(highlighted, 'the highlight vanished — Enter would run nothing').not.toBe('')
    // ⛔ The real claim: `aria-activedescendant` names an element that EXISTS. A cursor left past
    // the end points the screen reader at an id nothing in the document carries.
    const named = need('palette-search').getAttribute('aria-activedescendant')
    expect(named).not.toBeNull()
    expect(
      document.getElementById(named!),
      'aria-activedescendant names a row that is gone',
    ).not.toBeNull()
    expect(highlighted).toBe(`palette-row-${named}`)
  })
})

describe('249 · the palette says what it searched', () => {
  it('⛔ it names the set it looked at, and its size', async () => {
    // ⚑ **D-017b · one list, so one count** — it named open and closed apart until then.
    open()
    cmdK()
    await nextTick()
    const said = need('palette-searched').textContent ?? ''
    expect(said).toContain('3 conversations')
    expect(said).toContain('ids')
    expect(said).not.toContain('has not answered yet')
  })

  it('⛔ before the list answers it says so, rather than claiming it searched everything', async () => {
    open({ looked: false })
    cmdK()
    await nextTick()
    const said = need('palette-searched').textContent ?? ''
    expect(said).toContain('has not answered yet')
    expect(said).not.toContain('could not be read')
    // Paired positive: what it did search is still counted, so the sentence is not a blanket apology.
    expect(said).toContain('3 conversations')
  })
})

describe('249 · focus, chrome and the one question at a time', () => {
  it('⛔ focus goes to the box and comes back to whatever opened it', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    open()
    cmdK()
    await nextTick()
    expect(document.activeElement).toBe(need('palette-search'))

    key({ key: 'Escape' })
    await nextTick()
    expect(document.activeElement, 'a keyboard user was left nowhere').toBe(opener)
    opener.remove()
  })

  it('⚠️ Tab pulls focus BACK into the panel when it has escaped', async () => {
    // ⚠️ The first version pressed Tab while the box already had focus and asserted the box had
    // focus — true before the key, and green with the whole trap deleted (found in this dispatch's
    // own review). This starts from focus OUTSIDE the panel, which only the trap can recover from.
    const outside = document.createElement('button')
    document.body.append(outside)
    const h = open()
    cmdK()
    await nextTick()
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const before = h.seen()
    key({ key: 'Tab' })
    await nextTick()
    expect(document.activeElement, 'Tab walked out of the palette').toBe(need('palette-search'))
    expect(h.seen() - before).toBe(0)
    outside.remove()
  })

  it('⛔ closing on a backdrop press gives focus back too', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    open()
    cmdK()
    await nextTick()
    need('palette-scrim').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(find('palette-panel')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('⚠️ …and an opener that has gone away is survived rather than thrown over', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    open()
    cmdK()
    await nextTick()
    opener.remove()
    expect(() => key({ key: 'Escape' })).not.toThrow()
    await nextTick()
    expect(find('palette-panel')).toBeNull()
  })

  it('⛔ the highlighted row is brought back into view when the arrows walk past the fold', async () => {
    // Enough conversations to overflow the 66vh panel several times over.
    const many = Array.from({ length: 40 }, (_, at) => openRow(`sess_${at}`, `folder-${at}`))
    open({ conversations: many, activeId: null })
    cmdK()
    await nextTick()

    for (let step = 0; step < 25; step += 1) key({ key: 'ArrowDown' })
    await nextTick()
    await nextTick()

    const list = need('palette-rows-scroll').getBoundingClientRect()
    const row = document.body.querySelector('[data-current="true"]')!.getBoundingClientRect()
    expect(row.top, 'the row Enter would run has scrolled off the top').toBeGreaterThanOrEqual(
      list.top - 1,
    )
    expect(row.bottom, 'the row Enter would run has scrolled off the bottom').toBeLessThanOrEqual(
      list.bottom + 1,
    )
    // Paired positive: the list really did scroll, so this is not passing over a short list.
    expect(need('palette-rows-scroll').scrollTop).toBeGreaterThan(0)
  })

  it("⛔ the panel is OPAQUE — 125's defect is a resolved colour, not a named token", async () => {
    open()
    cmdK()
    await nextTick()
    /**
     * ⚠️ **`getComputedStyle`, not `paintedBackground`** (found in this dispatch's own review, and
     * the sharpest thing that pass caught). `paintedBackground` composites down to the first opaque
     * ancestor and hard-codes `1` into the alpha of everything it returns — it is STRUCTURALLY
     * incapable of answering anything else. The first version asserted `painted[3] === 1` and would
     * have stayed green with `background: var(--panel)` deleted from `.palette`, which is exactly
     * the `125` defect this test names. `overlay-panel.dom.test.ts:119` already had the right
     * sensor: the element's OWN declared fill.
     */
    const own = getComputedStyle(need('palette-panel')).backgroundColor
    const rgba = parseColor(own)
    expect(rgba, `unparseable background-color "${own}"`).not.toBeNull()
    expect(rgba![3], 'the panel paints through to the conversation behind it').toBe(1)

    // ⚑ The paired positive, and it proves the sensor can answer something other than 1 on this
    // very page: the scrim under the panel is deliberately translucent.
    const scrim = parseColor(getComputedStyle(need('palette-scrim')).backgroundColor)
    expect(scrim![3]).toBeLessThan(1)
    // …and the two read as different surfaces rather than one flat sheet.
    const gap = channelGap(
      paintedBackground(need('palette-panel')),
      paintedBackground(need('palette-scrim')),
    )
    expect(gap).toBeGreaterThan(4)
  })

  it('⛔ it will not open over a REAL dialog — and says why instead of doing nothing', async () => {
    /**
     * ⛔ **A real `OverlayHost`, not the overlay STORE** (found in this dispatch's own review).
     *
     * ⚠️ The first version set `overlays.overlay.value` and passed — while the three modals
     * `ConversationPane` raises (the image viewer, the workflow-output reader, the child-work
     * reader) never touch that store at all. So the test asserted the guard on the one family of
     * dialogs that was never the risk, and the palette really did open on top of the others. The
     * guard now counts mounted hosts, and this mounts one.
     */
    const overlays = useOverlays()
    mount(OverlayHost, { label: 'A sheet' }, { width: 1200 })
    await nextTick()
    const h = open()

    const before = h.seen()
    cmdK()
    await nextTick()
    expect(find('palette-panel')).toBeNull()
    // ⛔ The key is STILL claimed — otherwise `RuntimeScreen`'s stub would answer this press with
    // "not wired yet", which is the exact sentence this dispatch removed.
    expect(h.seen() - before).toBe(0)
    const said = overlays.toasts.value.at(-1)?.text ?? ''
    expect(said).toContain('Close what is open first')
    // ⛔ **It says CLOSE, not "answer"** (found in this dispatch's own review): two of the four
    // overlay kinds are readers with nothing to answer, and closing is the one remedy every one of
    // them has on screen — the ✕, Escape, or the backdrop (`239`'s rule).
    expect(said).not.toContain('Answer')

    // ⚑ The paired positive: the host goes, the palette opens. Without it this would pass over a
    // component that had simply stopped opening at all.
    unmountAll()
    const second = open()
    cmdK()
    await nextTick()
    expect(visible(need('palette-panel'))).toBe(true)
    expect(second.navigations).toEqual([])
  })
})

describe('249 · export is the one verb the palette performs itself', () => {
  it("⛔ it asks the bridge, and reports the HOST's sentence rather than one of its own", async () => {
    const asked: unknown[] = []
    stubbed().api = {
      runtime: {
        exportSession: async (input: unknown) => {
          asked.push(input)
          return {
            kind: 'bundle',
            path: '/exports/sess_a.json',
            frames: 3,
            ledgerEntries: 9,
            resumable: false,
            note: 'A self-contained copy.',
          }
        },
      },
    }
    const overlays = useOverlays()
    open()
    cmdK()
    await nextTick()
    await type('bundle')
    key({ key: 'Enter' })
    await nextTick()
    await nextTick()

    expect(asked).toEqual([{ sessionId: 'sess_a', exportKind: 'bundle' }])
    expect(overlays.toasts.value.at(-1)?.text).toBe('/exports/sess_a.json — A self-contained copy.')
  })

  it('⛔ …and a refusal is SAID, not swallowed', async () => {
    stubbed().api = {
      runtime: {
        exportSession: async () => {
          throw new Error(
            "Claude's file for this conversation is gone, so there is nothing to export.",
          )
        },
      },
    }
    const overlays = useOverlays()
    open()
    cmdK()
    await nextTick()
    await type('provider file')
    key({ key: 'Enter' })
    await nextTick()
    await nextTick()

    expect(overlays.toasts.value.at(-1)?.text).toContain('Nothing was exported')
    expect(overlays.toasts.value.at(-1)?.text).toContain(
      "Claude's file for this conversation is gone",
    )
  })
})
