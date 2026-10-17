import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { WorkReport } from '../../src/shared/tasks'
import type { ResourceReading, TranscriptEvent } from '../../src/shared/runtime-ipc'
import {
  channelGap,
  contrast,
  mount,
  paintedBackground,
  META,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
  visible,
  type Mounted,
  type Rgba,
  openWorkReports,
} from './harness'

/**
 * 🔴 **406 · finished, and finished with a question — measured where a person would see it.**
 *
 * ## ⛔ Why this is a DOM file and not a render one
 *
 * ⚠️ **Every claim here is about paint at a real viewport.** *"At a glance and without reading"*
 * is not assertable over a rendered string: the questions are whether two rows differ, whether the
 * mark is the amber the status grammar reserves for *frozen, waiting for a human*. ⚑ It also asked
 * whether it read as the dashed grey the app used for *not built yet* — `SoonChip`, which D-016
 * deleted with the seed-only overlays, so that comparison went with it. ⛔ SSR has no layout, no
 * cascade and no computed styles — `080` §11's two escapes went through a green suite exactly there.
 *
 * ⚑ **And the scope matters.** `ConversationPane` carries `data-chat-theme="light"`, in which
 * `--waiting` resolves to `#784f10` — a near-black that reads as ink rather than as a summons —
 * so a token read off `documentElement` would be answering about a different palette. Every
 * comparison below reads the token INSIDE the scope that redeclares it.
 *
 * ⚠️ **The viewport is shared across this whole directory**, so it is captured before the first
 * resize and restored after every test.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const NOW = 1_700_000_000_000

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.3',
  state: 'answered',
  outcome: 'done',
  ...over,
})

/** A turn the app put there about work — the event the parent's ledger actually holds. */
const reported = (text: string, work: WorkReport): TranscriptEvent => ({
  type: 'user_turn',
  text,
  attribution: 'app_authored',
  work,
})

/**
 * ⛔ **The pair HO-019 §2 names, in ONE mount** — two `done` reports, one of which said a person
 * must act. ⚑ Both on screen at once is what makes every "they differ" below a statement about
 * the treatment rather than about two separate renders.
 */
const THE_PAIR: TranscriptEvent[] = [
  { type: 'user_turn', text: 'give the worker something to do' },
  reported(
    'W1.3 · the migration was answered by sess_worker: done.\n\nI wrote the migration.',
    report(),
  ),
  reported(
    'W1.4 · the second migration was answered by sess_worker: done.\n\nI wrote the second migration.',
    report({ piece: 'work_2', label: 'W1.4', needsUserAction: true }),
  ),
]

async function pane(events: TranscriptEvent[], width = 1200, height = 808): Promise<Mounted> {
  await page.viewport(width, height)
  const m = mount(ConversationPane, paneProps({ record: record(events) }), { width, height })
  await openWorkReports(m)
  return m
}

/** Every painted colour a mark or a badge is made of, in one read. */
function paintsOf(el: HTMLElement): { bg: Rgba; ink: Rgba; border: Rgba } {
  const style = getComputedStyle(el)
  return {
    bg: paintedBackground(el),
    ink: parseColor(style.color) ?? [0, 0, 0, 1],
    border: parseColor(style.borderTopColor) ?? [0, 0, 0, 1],
  }
}

describe('406 · the work report, on a real screen', () => {
  beforeAll(() => {
    expect(ORIGINAL.width).toBeGreaterThan(0)
  })

  afterEach(async () => {
    unmountAll()
    await page.viewport(ORIGINAL.width, ORIGINAL.height)
  })

  it('addresses the person as you when the work waits for their next words', async () => {
    const m = await pane([
      reported(
        'Fictional work waiting for a reply.',
        report({ state: 'waiting-on-the-person-who-wrote', outcome: undefined }),
      ),
    ])
    const word = m.q('work-report-word')
    expect(visible(word)).toBe(true)
    expect(word.textContent?.trim()).toBe('waiting on you')
    expect(word.textContent).not.toContain('waiting on the person')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the pair — the whole property, in one sample
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · two `done` rows, side by side', () => {
    it('🔴 both are on screen, and only one carries the mark', async () => {
      const m = await pane(THE_PAIR)
      const rows = m.all('work-report')
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(visible(row)).toBe(true)
      // ⛔ **The hazard is ON the path**: a `done` row with the flag TRUE beside a `done` row with
      // it FALSE, in one sample, differing.
      expect(m.all('work-report-outcome')).toHaveLength(2)
      expect(m.all('work-report-mark')).toHaveLength(1)
      expect(rows[1]?.contains(m.q('work-report-mark'))).toBe(true)
      expect(m.q('work-report-mark').textContent?.trim()).toBe('a person has to act')
      // 🔴 **The glyph, and it is the half that is *without reading*.** ⚠️ The row verifier killed
      // nothing when the icon was deleted — four words beside another four-word pill, with the
      // whole property resting on a reader telling them apart by text. ⛔ `#i-user` because the
      // mark's subject is a PERSON, and it is deliberately not the attention channel's
      // `#i-alert` / `#i-lock` / `#i-question`.
      const glyph = m.q('work-report-mark').querySelector('svg.icon use')
      expect(glyph, 'the mark has no glyph').not.toBeNull()
      expect(glyph?.getAttribute('href')).toBe('#i-user')
      expect(
        (m.q('work-report-mark').querySelector('svg.icon') as SVGElement).getBoundingClientRect()
          .width,
      ).toBeGreaterThan(8)
    })

    it('⛔ the OUTCOME is identical on both, so the difference is a mark and not a re-hue', async () => {
      // 🔴 **`StateBadge`'s own rule**: *"a caller may rename a state, never re-hue it."* ⚠️ A
      // treatment that had tinted the finished badge would pass "the rows differ" and would have
      // spent the state-colour grammar on a second axis.
      const m = await pane(THE_PAIR)
      // ⚠️ **The PILL, not the slot around it** — `state-taskOutcome` is `StateBadge`'s own
      // handle and is where the token and the paint live.
      const badges = m.all('state-taskOutcome')
      expect(badges).toHaveLength(2)
      const [quiet, loud] = badges.map((badge) => paintsOf(badge as HTMLElement))
      expect(quiet).toEqual(loud)
      expect(badges[0]?.getAttribute('data-token')).toBe('--success')
      expect(badges[1]?.getAttribute('data-token')).toBe('--success')
      expect(badges[0]?.textContent?.trim()).toBe('Done')
    })

    it('⛔ the mark rides the same line and does not make the row taller', async () => {
      // ⚑ `AgentState`'s contract, one surface over: *a facet arriving must not make the row
      // taller.* ⚠️ Measured as the FACTS line, because that is the element the mark joins.
      const m = await pane(THE_PAIR)
      const [quiet, loud] = m.all('work-facts')
      expect(quiet).toBeDefined()
      expect(loud).toBeDefined()
      const quietBox = (quiet as HTMLElement).getBoundingClientRect()
      const loudBox = (loud as HTMLElement).getBoundingClientRect()
      expect(loudBox.height).toBe(quietBox.height)
      // ⚑ And the mark really is on that line rather than under it.
      const mark = m.q('work-report-mark').getBoundingClientRect()
      const badge = (m.all('work-report-outcome')[1] as HTMLElement).getBoundingClientRect()
      expect(Math.round(mark.top)).toBe(Math.round(badge.top))
      expect(Math.round(mark.height)).toBe(Math.round(badge.height))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the paired negative — it is NOT the attention treatment
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the grammar, kept', () => {
    it('🔴 no painted surface of the mark is any colour in the `--waiting` ramp', async () => {
      // ⛔ **The status grammar: amber means frozen, waiting for a human.** A finished task that
      // raised a decision is neither, and `401`/`403` own that channel.
      //
      // ⚠️ **Read INSIDE the scope that redeclares them** — `ConversationPane` carries
      // `data-chat-theme="light"`, where `--waiting` is `#784f10`, and a read off
      // `documentElement` would be comparing against the dark chrome's `#f2b865`.
      const m = await pane(THE_PAIR)
      const mark = m.q('work-report-mark')
      const scope = getComputedStyle(mark)
      const amber = ['--waiting', '--waiting-bg', '--waiting-pill-border', '--waiting-text-label']
        .map((token) => parseColor(scope.getPropertyValue(token).trim()))
        .filter((colour): colour is Rgba => colour !== null)
      expect(amber, 'no amber token resolved in this scope').toHaveLength(4)
      // ⚑ The scope really is the light one, which is what makes the four values above the ones a
      // person sees rather than the chrome's.
      expect(scope.getPropertyValue('--waiting').trim()).not.toBe(
        getComputedStyle(document.documentElement).getPropertyValue('--waiting').trim(),
      )
      // ⛔ **BOTH neutral pills, not just the mark.** The stall's word pill is the same grammar
      // one report over, and a sweep that looked at one of them measured where the two agree.
      const stalled = await pane([
        reported('a stall', {
          piece: 'work_9',
          label: 'W1.9',
          state: 'stalled',
          stalledBecause: 'app_restarted',
        }),
      ])
      for (const pill of [mark, stalled.q('work-report-word')]) {
        const painted = paintsOf(pill)
        for (const [where, colour] of Object.entries(painted)) {
          for (const one of amber) {
            expect(
              channelGap(colour, one),
              `a pill's ${where} is ${show(colour)}, and the amber ramp holds ${show(one)}`,
            ).toBeGreaterThan(8)
          }
        }
      }
    })

    it('⛔ and the card itself is not painted amber either', async () => {
      // ⛔ **Re-aimed by `658`** (standing rule 26): `data-cy="work-report"` falls through to
      // `OutsideCard`'s LANE, which paints nothing, so this read the wrapper once the report moved
      // into a card. ⚑ It reads the CARD now — the surface a tint would land on.
      const m = await pane(THE_PAIR)
      const cardOf = (i: number): HTMLElement =>
        (m.all('work-report')[i] as HTMLElement).querySelector(
          '[data-cy="outside-card"]',
        ) as HTMLElement
      const scope = getComputedStyle(cardOf(1))
      const amberCard = parseColor(scope.getPropertyValue('--waiting-card-border').trim())
      expect(amberCard).not.toBeNull()
      expect(channelGap(paintedBackground(cardOf(1)), amberCard as Rgba)).toBeGreaterThan(8)
      // ⚑ The two cards sit on the same ground — the one whose report says a person must act is
      // not tinted differently from the one that does not.
      expect(paintedBackground(cardOf(1))).toEqual(paintedBackground(cardOf(0)))
    })

    it('⛔ nothing on this row announces itself', async () => {
      const m = await pane(THE_PAIR)
      const row = m.all('work-report')[1] as HTMLElement
      expect(row.querySelectorAll('[role="alert"], [role="status"], [aria-live]')).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · it reads, and it is not the person's
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · what a reader gets', () => {
    it('🔴 the mark reads at 4.5:1 or better on the ground it is painted on', async () => {
      const m = await pane(THE_PAIR)
      const mark = m.q('work-report-mark')
      // ⚠️ **`visible` FIRST** — `paintedInk` cannot see `visibility: hidden`, so a contrast number
      // on an invisible element is a number about nothing.
      expect(visible(mark)).toBe(true)
      const painted = paintsOf(mark)
      const ratio = contrast(painted.ink, painted.bg)
      expect(ratio, `the mark reads at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      // ⛔ **The planted control**: the same ink on the app's dark chrome would NOT read, which is
      // what says this number is about the light scope the pane actually paints.
      expect(contrast(painted.ink, [17, 19, 24, 1])).toBeLessThan(4.5)
    })

    it('⛔ the row is BroBot’s and says so, and the person’s own turn is untouched', async () => {
      // 🔴 **`214` removed 12,646 messages that rendered injected material as *"You"*.** The first
      // event in the fixture is a person's turn and the two after it are not.
      const m = await pane(THE_PAIR)
      expect(m.all('user-message')).toHaveLength(1)
      // ⚠️ `user-message` is the BODY; the heading is its sibling, so the row is reached through
      // the article — which is also what makes the negative below about the same kind of element.
      expect(m.q('user-message').closest('article')?.textContent).toContain('You')
      // ⛔ **The HEADING, not the row's whole text** — found writing this, when the row still
      // carried a `.why` paragraph reading *"You did not write it"*: a substring test over the
      // article was satisfied by the very sentence saying the row is not yours. The paragraph is
      // gone and the lesson is not — the claim is about ATTRIBUTION, so it is asserted where the
      // attribution is.
      for (const heading of m.all('work-report-heading')) {
        expect(heading.textContent?.trim()).toMatch(/^W\d+(\.\d+)+$/)
      }
      // ⛔ **And they are not user bubbles at all** — the class the person's row carries is absent
      // from both, which is `278`'s ruling: its own component, never that one with a badge.
      expect(document.querySelectorAll('.msg.user')).toHaveLength(1)
      expect(m.q('work-report-about').textContent?.trim()).toBe('This app · work you gave out')
      expect(m.q('work-report-heading').textContent?.trim()).toBe('W1.3')
      // A work report is a bordered card with no avatar, distinguishing it from the person at
      // a glance. Draw the person’s ordinary row on the same page as the paired positive.
      const report = m.all('work-report')[0] as HTMLElement
      expect(report.querySelector('.msg-avatar'), 'a work report still draws an avatar').toBeNull()
      const card = report.querySelector('[data-cy="outside-card"]') as HTMLElement
      expect(getComputedStyle(card).borderTopStyle).toBe('solid')
      const mine = m.q('user-message').closest('article') as HTMLElement
      expect(getComputedStyle(mine).borderTopStyle).toBe('none')
      // ⚠️ **Not shifted**: these reports carry no relayer — the app's own account of work the
      // reader gave out, not a message from outside (`from-outside.ts`).
      expect(card.dataset['shifted']).toBe('false')
    })

    it('⛔ the words the provider was given are on the row, verbatim', async () => {
      // Display injected prompt text or system hints. Structured facts appear beside the
      // sentence and never replace it.
      const m = await pane(THE_PAIR)
      expect(m.all('work-report-message')[1]?.textContent).toContain(
        'I wrote the second migration.',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the other shapes a report can take
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the rest of the vocabulary, drawn', () => {
    it('⛔ `blocked` is a different badge from `done`, and both differ from the mark', async () => {
      // ⚑ **The paired positive** `dispatch-route` learned the hard way: a "not equal" against one
      // neighbour can be satisfied by a component that fell back to a third look. Three
      // comparisons, all of them stated.
      const m = await pane([
        reported('done one', report()),
        reported(
          'blocked one',
          report({ piece: 'work_2', label: 'W1.4', outcome: 'blocked', needsUserAction: true }),
        ),
      ])
      const badges = m.all('state-taskOutcome')
      expect(badges[0]?.getAttribute('data-token')).toBe('--success')
      expect(badges[1]?.getAttribute('data-token')).toBe('--danger')
      const green = paintsOf(badges[0] as HTMLElement)
      const red = paintsOf(badges[1] as HTMLElement)
      expect(channelGap(green.ink, red.ink)).toBeGreaterThan(32)
      expect(channelGap(paintsOf(m.q('work-report-mark')).ink, red.ink)).toBeGreaterThan(32)
      expect(channelGap(paintsOf(m.q('work-report-mark')).ink, green.ink)).toBeGreaterThan(32)
    })

    it('⛔ a stall draws its state word and its cause, and no outcome badge', async () => {
      const m = await pane([
        reported('W1.3 … is not being worked on: the app restarted while it was open.', {
          piece: 'work_1',
          label: 'W1.3',
          state: 'stalled',
          stalledBecause: 'app_restarted',
        }),
      ])
      expect(m.all('work-report-outcome')).toHaveLength(0)
      // 🔴 **The CAUSE is the pill** — the photograph's ruling: a pill may restate what the prose
      // says, and a second prose line above the body saying the same words may not.
      expect(m.q('work-report-word').textContent?.trim()).toBe(
        'the app restarted while it was open',
      )
      expect(m.all('work-report-because')).toHaveLength(0)
      // ⛔ **And NO mark.** An absent claim on a report that is not `answered` means *nobody has
      // said* — a mark here would put a claim in a worker's mouth.
      expect(m.all('work-report-mark')).toHaveLength(0)
    })

    it('🔴 a reply HELD behind a running turn shows the same facts, under the piece’s label', async () => {
      // ⛔ **The window a person is actually watching.** A parent with two children is busy exactly
      // when one of them finishes, and until `406` the held row said *"You"* with a cancel button
      // offering to take back words nobody wrote.
      const m = await pane([
        {
          type: 'message_queued',
          messageId: 'msg_1',
          kind: 'work',
          text: 'W1.3 … was answered by sess_worker: done.',
          work: report({ needsUserAction: true }),
        },
      ])
      expect(m.q('queued-sender').textContent?.trim()).toBe('W1.3')
      // ⚑ **The SAME mark the flushed row carries** (from the review): the two rows are one row a
      // few seconds apart, and the first version named the author on one of them and not the
      // other — so while a reply was held nothing on it said who wrote it.
      expect(m.q('queued-about').textContent?.trim()).toBe('This app · work you gave out')
      expect(m.q('queued-about').textContent?.trim()).toBe(
        (await pane(THE_PAIR)).q('work-report-about').textContent?.trim(),
      )
      expect(m.q('work-report-mark').textContent?.trim()).toBe('a person has to act')
      expect(m.q('state-taskOutcome').getAttribute('data-token')).toBe('--success')
      // 🔴 **And NEITHER person-only control is offered on it** (from the review). ⛔ *Cancel it*
      // would destroy a child's already-recorded reply on its way to the parent — and for an
      // undriven-work notice it would suppress it PERMANENTLY, because `workReportedTo` withdraws
      // `404`'s receipt on `abandoned` and never on `cancelled`. ⚠️ *Put it back in the composer*
      // is worse in kind: it loads BroBot's words into the person's draft to be sent under their
      // name — `214`'s defect manufactured by the row built to remove it.
      expect(m.all('cancel-queued')).toHaveLength(0)
      expect(m.all('restore-queued')).toHaveLength(0)

      // ⚑ The control: an ordinary queued message is still the person's, and still offers both.
      const mine = await pane([
        { type: 'message_queued', messageId: 'msg_2', kind: 'work', text: 'I typed this' },
      ])
      expect(mine.q('queued-sender').textContent?.trim()).toBe('You')
      expect(mine.all('work-facts')).toHaveLength(0)
      expect(mine.all('cancel-queued')).toHaveLength(1)

      // ⛔ **The ENDED halves too** — a cancelled or abandoned report must not offer its words
      // back to a composer, and a person's own message still must.
      const ended = await pane([
        {
          type: 'message_unqueued',
          messageId: 'msg_3',
          reason: 'abandoned',
          text: 'W1.3 …',
          work: report(),
        },
        { type: 'message_unqueued', messageId: 'msg_4', reason: 'abandoned', text: 'mine' },
      ])
      expect(ended.all('queued-entry')).toHaveLength(2)
      expect(ended.all('restore-queued')).toHaveLength(1)
      expect(ended.all('work-facts')).toHaveLength(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the narrow window
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · at the width the app actually opens at', () => {
    it('⛔ the facts line stays on one row at the app’s minimum width', async () => {
      // ⚠️ `--app-min-w` is 1180 and the window opens at 1200; a mark that fell under its badge at
      // the narrow end would be a second line a reader has to find.
      const m = await pane(THE_PAIR, 1180, 808)
      const badge = (m.all('work-report-outcome')[1] as HTMLElement).getBoundingClientRect()
      const mark = m.q('work-report-mark').getBoundingClientRect()
      expect(Math.round(mark.top)).toBe(Math.round(badge.top))
      expect(mark.left).toBeGreaterThan(badge.right - 1)
      // ⛔ And nothing overflows the reading column.
      const column = (m.all('work-report')[1] as HTMLElement).getBoundingClientRect()
      expect(mark.right).toBeLessThanOrEqual(column.right)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · 506 · the press that takes a person to the conversation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · 506 · the way in, on the row that names it', () => {
    /** The pair, with the conversation on the report — what a ledger written since `506` holds. */
    const NAMED: TranscriptEvent[] = [
      { type: 'user_turn', text: 'give the worker something to do' },
      reported(
        'W1.3 · the migration was answered by sess_worker: done.\n\nI wrote the migration.',
        {
          ...report(),
          owner: 'sess_worker',
        },
      ),
    ]

    it('🔴 the press is on the row, reads as a destination, and shares the meta row’s line', async () => {
      // ⛔ **The whole reason it is not a `<button>` with a border**: the meta row is 22px and a
      // form control would grow it, moving every entry under it. ⚠️ Measured rather than argued —
      // the press sits on the SAME baseline as the heading it follows.
      const m = await mount(
        ConversationPane,
        paneProps({ record: record(NAMED), held: ['sess_other'] }),
        { width: 1200, height: 808 },
      )
      await openWorkReports(m)
      const press = m.q('work-report-where')
      expect(visible(press)).toBe(true)
      // ⚑ **D-017b · the one press's words** — a conversation this window does not hold opens in
      // its full view like any other, so the row no longer says *Take it over and open it*.
      expect(press.textContent?.trim()).toBe('Open the conversation')
      const heading = m.q('work-report-heading').getBoundingClientRect()
      const box = press.getBoundingClientRect()
      // ⚠️ **CENTRES and not tops**, which is what `align-items: center` actually guarantees: the
      // heading is `--text-sm` and this is `--text-3xs`, so two boxes of different heights sharing
      // one line have different tops by construction. A `top` equality would have been an
      // assertion about the font sizes wearing a layout claim's clothes.
      //
      // ⚠️ **Within half a pixel, and not two `Math.round`s compared.** The centres agree to a
      // layout unit (1/64 px), and two rounded values still split whenever that shared centre
      // lands on a `.5` — which the 14px conversation text above this row put it on under CI's
      // Linux fonts. A row that lost `align-items: center` is still a whole pixel out.
      expect(box.top + box.height / 2).toBeCloseTo(heading.top + heading.height / 2, 0)
      expect(box.height).toBeLessThanOrEqual(22)
      // ⚑ **Underlined, because that is the affordance every other in-text destination here
      // uses** — `places.ts`'s `.go-to-project`, to the declaration.
      expect(getComputedStyle(press).textDecorationLine).toContain('underline')
    })

    it('⛔ the meta row does not overflow at the app’s minimum width, and the clock survives', async () => {
      // ⚠️ **`--app-min-w` is 1180.** The longest of the two sentences plus the heading, the
      // author line and the clock all share one 22px row; a press that pushed the clock out would
      // be this dispatch taking a fact off the row to add a control to it.
      const m = await mount(
        ConversationPane,
        paneProps({ record: record(NAMED), held: ['sess_other'] }),
        { width: 1180, height: 808 },
      )
      await openWorkReports(m)
      const press = m.q('work-report-where')
      const meta = press.closest('.msg-meta') as HTMLElement
      expect(meta.scrollWidth).toBeLessThanOrEqual(meta.clientWidth + 1)
      const box = press.getBoundingClientRect()
      const row = meta.getBoundingClientRect()
      expect(box.right).toBeLessThanOrEqual(row.right)
      // ⚑ **The clock keeps its slot at the far right** — `.time` is `margin-left: auto`, so the
      // press has to sit BEFORE it rather than push it out of the row.
      //
      // ⚠️ **Its box is measured for POSITION and not for width, and that is stated because it
      // reads like a weak assertion.** This directory's `record()` folds events with no `at`, so
      // every clock in every fixture here renders empty — a `visible()` check would be asserting a
      // property of the harness. What is load-bearing is the ORDER, and that is what is read.
      const clock = meta.querySelector('.time') as HTMLElement
      expect(clock).not.toBeNull()
      expect(clock.getBoundingClientRect().left).toBeGreaterThanOrEqual(box.right)
      expect(clock.getBoundingClientRect().right).toBeLessThanOrEqual(row.right + 1)
    })

    it('⚑ …and the SAME row draws nothing when this window already holds the conversation', async () => {
      // ⛔ **The control is present either way** — and ⚑ **since D-017b so are its words**: the
      // fork `taking-over.ts` owned is one press now, held or not. This is the paired positive for
      // the negative below it: a render that drew no press at all would pass *"no press"*.
      const m = await mount(
        ConversationPane,
        paneProps({ record: record(NAMED), held: ['sess_worker'] }),
        { width: 1200, height: 808 },
      )
      await openWorkReports(m)
      expect(m.q('work-report-where').textContent?.trim()).toBe('Open the conversation')
    })

    it('⛔ a pane handed no held set draws no press, and the row is otherwise whole', async () => {
      const m = await pane(NAMED)
      expect(m.all('work-report-where')).toHaveLength(0)
      expect(m.all('work-report')).toHaveLength(1)
      expect(visible(m.q('work-report-outcome'))).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §7 · 510 · the SECOND press on the same 22px line
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · 510 · the document press, beside the conversation one', () => {
    /** ⚑ A resource id as `keepResource` mints one — `res_<32 hex>` (D-016). */
    const RESOURCE = 'res_4c2f0e1a111142228333444455556666'

    /**
     * A reply that keeps a file also names its conversation: `workAnswered` writes both.
     * Measure both presses together on one report, rather than testing each in isolation.
     */
    const BOTH: TranscriptEvent[] = [
      { type: 'user_turn', text: 'give the worker something to do' },
      reported(
        `W1.3 · the migration was answered by sess_worker: done.\n\nIts resources: ${RESOURCE} (response.md). Read one with read_document.`,
        { ...report(), owner: 'sess_worker', resources: [RESOURCE] },
      ),
    ]

    it('🔴 it shares the meta row’s line and stays inside the 22px the heading sets', async () => {
      const m = await mount(
        ConversationPane,
        paneProps({
          record: record(BOTH),
          held: ['sess_other'],
          onReadResource: async () => ({ ok: false, reason: 'no-store' }),
        }),
        { width: 1200, height: 808 },
      )
      await openWorkReports(m)
      const press = m.q('work-report-document')
      expect(visible(press)).toBe(true)
      const heading = m.q('work-report-heading').getBoundingClientRect()
      const box = press.getBoundingClientRect()
      // ⚠️ **CENTRES and not tops**, which is what `align-items: center` actually guarantees —
      // `506`'s own correction, and the same two font sizes are in play here. Within half a
      // pixel, for §6's reason.
      expect(box.top + box.height / 2).toBeCloseTo(heading.top + heading.height / 2, 0)
      expect(box.height).toBeLessThanOrEqual(22)
      expect(getComputedStyle(press).textDecorationLine).toContain('underline')
    })

    it('⛔ TWO presses and the clock still fit at the app’s minimum width', async () => {
      // 🔴 **This is the assertion the dispatch could have failed on.** `--app-min-w` is 1180, and
      // `506` measured ONE press plus the heading, the author line and the clock on a single 22px
      // row. ⚠️ Its own comment named the cost of a second: *"a press that pushed the clock out
      // would be this dispatch taking a fact off the row to add a control to it."*
      const m = await mount(
        ConversationPane,
        paneProps({
          record: record(BOTH),
          held: ['sess_other'],
          onReadResource: async () => ({ ok: false, reason: 'no-store' }),
        }),
        { width: 1180, height: 808 },
      )
      await openWorkReports(m)
      const where = m.q('work-report-where')
      const document = m.q('work-report-document')
      const meta = document.closest('.msg-meta') as HTMLElement
      expect(meta.scrollWidth).toBeLessThanOrEqual(meta.clientWidth + 1)
      const row = meta.getBoundingClientRect()
      const clock = meta.querySelector('.time') as HTMLElement
      expect(clock).not.toBeNull()
      // ⚑ **Both landmarks present before anything is compared.** `506 M13` survived its first
      // verification because an ordering assertion sliced on a string the mutation deleted, and
      // `-1 < positive` read as *the order is right*.
      for (const [what, box] of [
        ['where', where.getBoundingClientRect()],
        ['document', document.getBoundingClientRect()],
      ] as const) {
        expect(box.width, what).toBeGreaterThan(0)
        expect(box.right, what).toBeLessThanOrEqual(row.right)
      }
      // ⛔ The order on the line: the conversation, then the document, then the clock at the far
      // right — `.time` is `margin-left: auto`, so a press that pushed it out would fail here.
      expect(where.getBoundingClientRect().right).toBeLessThanOrEqual(
        document.getBoundingClientRect().left,
      )
      expect(clock.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        document.getBoundingClientRect().right,
      )
      expect(clock.getBoundingClientRect().right).toBeLessThanOrEqual(row.right + 1)
    })

    /** ⚑ The same row with the ONE fact removed — the control for the two tests above. */
    const NO_DOCUMENT: TranscriptEvent[] = [
      { type: 'user_turn', text: 'give the worker something to do' },
      reported('W1.3 · the migration was answered by sess_worker: done.', {
        ...report(),
        owner: 'sess_worker',
      }),
    ]

    it('⚑ …and the row draws no document press when the report names none', async () => {
      // ⛔ The paired positive for the two above: same pane, same reader, one fact removed.
      const m = await mount(
        ConversationPane,
        paneProps({
          record: record(NO_DOCUMENT),
          held: ['sess_other'],
          onReadResource: async () => ({ ok: false, reason: 'no-store' }),
        }),
        { width: 1180, height: 808 },
      )
      await openWorkReports(m)
      expect(m.all('work-report-document')).toHaveLength(0)
      expect(visible(m.q('work-report-where'))).toBe(true)
    })

    it('🔴 a document opened in one conversation does not float over the next', async () => {
      // ⛔ **`067`'s defect, on the sixth panel.** This pane is reused across conversations with no
      // `key`, so a read that lands AFTER the person has switched would draw one conversation's
      // document over another's. ⚠️ Two independent guards answer it — the id is captured before
      // the `await`, and `documentFor` compares it to what is on screen — and this test drives the
      // race that needs both: the read is held open, the conversation is switched under it, and
      // only then does it resolve.
      let release!: (result: ResourceReading) => void
      const held = new Promise<ResourceReading>((resolve) => {
        release = resolve
      })
      const first = record(BOTH)
      const second = createSessionRecord('sess_2')
      second.meta = { ...META, sessionId: 'sess_2' }
      second.phase = 'open'
      const showing = shallowRef(first)
      const Wrapper = defineComponent({
        setup: () => () =>
          h(
            ConversationPane as never,
            paneProps({
              record: showing.value,
              held: ['sess_other'],
              onReadResource: () => held,
            }),
          ),
      })
      const m = mount(Wrapper, {}, { width: 1200, height: 808 })
      await openWorkReports(m)
      m.q('work-report-document').click()
      // ⚑ **The premise, asserted**: the read really is in flight and the panel is not up yet.
      expect(m.all('canonical-document-viewer')).toHaveLength(0)

      showing.value = second
      await nextTick()
      release({
        ok: true,
        form: 'markdown',
        resourceId: RESOURCE,
        name: 'response.md',
        text: '# the answer\n',
        bytes: 14,
      })
      await held
      await nextTick()
      // ⛔ The document belonged to the conversation that asked for it, and that conversation is
      // no longer on screen.
      expect(m.all('canonical-document-viewer')).toHaveLength(0)
    })
  })
})

/** ⚠️ Kept so an unused import cannot make the fixture above quietly stop being a fixture. */
expect(NOW).toBeGreaterThan(0)
