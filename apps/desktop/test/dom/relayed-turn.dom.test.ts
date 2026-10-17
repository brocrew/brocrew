import { expandAgentCards } from './harness'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import {
  channelGap,
  contrast,
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  record,
  unmountAll,
  visible,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * App-added words must not appear as words the person typed.
 *
 * ## ⛔ Why this is a DOM file
 *
 * ⚠️ **The claim is *"a turn the app delivered must never render under You"*, and *never* is a
 * claim about paint.** SSR has no cascade and no layout: a row that was drawn identically to the
 * person's bubble and differed only in a `data-cy` would pass a rendered-string assertion and
 * fail the only reader who matters. ⛔ `390` shipped an invisible control that only a screenshot
 * caught, and this brief asks for a photograph for that reason.
 *
 * ⚑ **The three app-delivered entries are mounted TOGETHER, with a real person's bubble beside
 * them**, because every assertion here is a comparison and a comparison measured on two separate
 * renders measures two renders.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * A turn another conversation wrote — `message_agent`, or a child's routed question.
 *
 * Relayed rows name the relaying conversation’s identity. Use different identities for the
 * downward work hand-off and upward worker question so a shared constant cannot falsely
 * satisfy both hops.
 */
const relayed = (text: string, from: string): TranscriptEvent => ({
  type: 'user_turn',
  text,
  attribution: 'app_authored',
  relayedFrom: `sess_${from}`,
  relayedFromProfile: from,
})

/**
 * ⛔ **The four rows a person can meet in one column**, in the order the product produces them:
 * a person's own words, work another agent handed over, that agent's child's question coming
 * back, and the go-ahead. ⚑ Two of these were the SAME pixels before this dispatch.
 */
const THE_COLUMN: TranscriptEvent[] = [
  { type: 'user_turn', text: 'take this project and run it' },
  relayed('Deliver the migration, then report back with the file you wrote.', 'project-manager'),
  relayed(
    'sess_worker is waiting on an answer before it can go on. Answer it with answer_question, ' +
      'quoting req_7.\n\nWhich branch should this land on?',
    'worker',
  ),
  { type: 'user_turn', text: 'Go ahead with this plan.', attribution: 'app_authored' },
]

async function pane(events: TranscriptEvent[], width = 1200, height = 808): Promise<Mounted> {
  await page.viewport(width, height)
  return expandAgentCards(
    mount(ConversationPane, paneProps({ record: record(events) }), { width, height }),
  )
}

describe('413 · a relayed turn, on a real screen', () => {
  beforeAll(() => {
    expect(ORIGINAL.width).toBeGreaterThan(0)
  })

  afterEach(async () => {
    unmountAll()
    await page.viewport(ORIGINAL.width, ORIGINAL.height)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the row, beside the bubble it used to be
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · four rows in one column', () => {
    it('🔴 the relayed rows are on screen and NEITHER of them says “You”', async () => {
      const m = await pane(THE_COLUMN)
      const rows = m.all('relayed')
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(visible(row)).toBe(true)
      // ⛔ **Asserted on the HEADING, not on the row.** `406` learned this one the hard way: an
      // assertion that the row does not contain *"You"* was satisfied by a `.why` line saying
      // *"You did not write it"*, and a body that legitimately contains the word would satisfy
      // it the other way round.
      //
      // 🔴 **545 · re-aimed, not stripped** (standing rule 26). ⛔ It read CODE — a DOM heading —
      // and the FACT moved rather than its spelling: this equality pinned `RELAYED_SENDER`, a
      // constant `HO-054` §3 ruled *"a lie about a project manager"*. ⚑ **What it pins now is
      // stronger than what it pinned before**: the two rows say two DIFFERENT names, so a build
      // that went back to one constant fails here even if that constant were spelled correctly for
      // one of them — which is the trap a single-relayer fixture cannot set.
      const headings = rows.map((row) =>
        row.querySelector('[data-cy="relayed-sender"]')?.textContent?.trim(),
      )
      expect(headings).toEqual(['project-manager', 'worker'])
      // ⚑ **The positive control, in the same mount**: a turn the person really typed is still a
      // user bubble saying *You*. A fix that marked everything would pass every negative above.
      const mine = m.all('user-message')
      expect(mine).toHaveLength(1)
      expect(mine[0]?.textContent).toContain('take this project')
      const mineHeading = (mine[0] as HTMLElement).closest('article')?.querySelector('strong')
      expect(mineHeading?.textContent?.trim()).toBe('You')
    })

    it('⛔ the relayed row does NOT say “sent for you” — the falsehood `406` refused to ship', async () => {
      // 🔴 **`406`'s own note**: *"Marking it without building its entry would render a child's
      // question under the go-ahead's authorship line (`sent for you`), which is false."*
      // ⚠️ Both entries are in this one mount, so *they differ* is a statement about the
      // treatment rather than about two renders.
      const m = await pane(THE_COLUMN)
      const goAhead = m.q('continuation-mark')
      expect(goAhead.textContent?.trim()).toBe('sent for you')
      const marks = m.all('relayed-mark')
      expect(marks).toHaveLength(2)
      for (const mark of marks) {
        expect(mark.textContent?.trim()).toBe('from another conversation')
        expect(mark.textContent).not.toContain('for you')
      }
    })

    it('a relayed card fills its message lane and the person keeps their own frame', async () => {
      // Agent cards share the lane's left edge and width; the person's avatar remains distinct.
      const m = await pane(THE_COLUMN)
      const row = m.all('relayed')[0] as HTMLElement
      expect(row.querySelector('.msg-avatar'), 'the relayed row still draws an avatar').toBeNull()
      const card = row.querySelector('[data-cy="outside-card"]') as HTMLElement
      expect(getComputedStyle(card).borderTopStyle).toBe('solid')
      expect(getComputedStyle(card).borderTopWidth).toBe('1px')
      // ⛔ **And the person's is not a card and keeps its solid user avatar**, measured in the same
      // page rather than remembered.
      const mine = (m.all('user-message')[0] as HTMLElement).closest('article') as HTMLElement
      expect(getComputedStyle(mine).borderTopStyle).toBe('none')
      const theirs = mine.querySelector('.msg-avatar') as HTMLElement
      expect(getComputedStyle(theirs).borderTopStyle).not.toBe('dashed')
      expect(mine.querySelector('.msg-avatar use')?.getAttribute('href')).toBe('#i-user')
      for (const relay of m.all('relayed')) {
        const frame = relay.querySelector('[data-cy="outside-card"]') as HTMLElement
        const lane = frame.parentElement as HTMLElement
        const rect = frame.getBoundingClientRect()
        const laneRect = lane.getBoundingClientRect()
        expect(rect.left).toBeCloseTo(laneRect.left, 1)
        expect(rect.width).toBeCloseTo(laneRect.width, 1)
      }
      expect(mine.getBoundingClientRect().left).toBeCloseTo(card.getBoundingClientRect().left, 1)
    })

    it('⛔ the body is EXACTLY what went to the provider, and the mark is not inside it', async () => {
      // ⚠️ **001's rule.** A mark rendered into the body would put words into `textContent` that
      // nobody sent, which is the defect this dispatch is about arriving from the other end.
      const m = await pane(THE_COLUMN)
      const body = m.all('relayed-message')[0] as HTMLElement
      expect(body.textContent).toBe(
        'Deliver the migration, then report back with the file you wrote.',
      )
      expect(body.textContent).not.toContain('another conversation')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the paired negative — a MARK, never a re-hue, and never the attention channel
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the grammar, kept', () => {
    it('🔴 no painted surface of the mark is any colour in the `--waiting` ramp', async () => {
      // ⛔ **`406`'s rule, still standing: amber means frozen, waiting for a human.** A task
      // arriving is neither — nothing is blocked on the reader, and `401`/`403` own that channel.
      // ⚠️ **Read INSIDE the scope that redeclares the tokens** — `ConversationPane` carries
      // `data-chat-theme="light"`, where `--waiting` is a near-black, so a read off
      // `documentElement` would be answering about the dark chrome.
      const m = await pane(THE_COLUMN)
      const mark = m.all('relayed-mark')[0] as HTMLElement
      const scope = getComputedStyle(mark)
      const amber = ['--waiting', '--waiting-bg', '--waiting-pill-border', '--waiting-text-label']
        .map((token) => parseColor(scope.getPropertyValue(token).trim()))
        .filter((colour): colour is Rgba => colour !== null)
      expect(amber, 'no amber token resolved in this scope').toHaveLength(4)
      expect(scope.getPropertyValue('--waiting').trim()).not.toBe(
        getComputedStyle(document.documentElement).getPropertyValue('--waiting').trim(),
      )
      const ink = parseColor(scope.color) ?? [0, 0, 0, 1]
      for (const one of amber) {
        expect(
          channelGap(ink, one),
          `the mark's ink is ${String(ink)} and the amber ramp holds ${String(one)}`,
        ).toBeGreaterThan(8)
      }
    })

    it('⛔ the card is WASHED, never tinted — no colour of the amber ramp, and barely off the page', async () => {
      // ⛔ **Re-aimed by `658`** (standing rule 26). This asserted the row's ground EQUALS the
      // person's, and `658` made that false on purpose: the row is a card on `--wash-1`. ⚠️ It
      // passed anyway, because `data-cy="relayed"` falls through to `OutsideCard`'s LANE, which
      // paints nothing — the assertion was reading the wrapper, not the card. ⚑ What the old claim
      // protected is still true and is measured on the CARD: the surface is neutral — not the
      // attention channel — and discreet.
      const m = await pane(THE_COLUMN)
      const card = (m.all('relayed')[0] as HTMLElement).querySelector(
        '[data-cy="outside-card"]',
      ) as HTMLElement
      const scope = getComputedStyle(card)
      const amber = ['--waiting', '--waiting-bg', '--waiting-pill-border', '--waiting-text-label']
        .map((token) => parseColor(scope.getPropertyValue(token).trim()))
        .filter((colour): colour is Rgba => colour !== null)
      expect(amber).toHaveLength(4)
      const ground = paintedBackground(card)
      for (const one of amber) expect(channelGap(ground, one)).toBeGreaterThan(8)
      const mine = (m.all('user-message')[0] as HTMLElement).closest('article') as HTMLElement
      // ⚑ discreet: a wash, not a second page colour
      expect(channelGap(ground, paintedBackground(mine))).toBeLessThan(24)
    })

    it('⛔ it introduces no live region and no alert role — v2.5.1 removed six and they stay gone', async () => {
      const m = await pane(THE_COLUMN)
      const row = m.all('relayed')[0] as HTMLElement
      expect(row.querySelectorAll('[role="alert"]')).toHaveLength(0)
      expect(row.querySelectorAll('[aria-live]')).toHaveLength(0)
    })

    it('⚠️ the words are still readable — the mark is quiet, the body is not', async () => {
      // ⚑ **A quiet mark must not make the MESSAGE quiet.** The whole reason the row exists is
      // that a person reads these words and acts on them.
      const m = await pane(THE_COLUMN)
      const body = m.all('relayed-message')[0] as HTMLElement
      const ink = parseColor(getComputedStyle(body).color) ?? [0, 0, 0, 1]
      expect(contrast(ink, paintedBackground(body))).toBeGreaterThan(4.5)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the HELD row, and the two buttons that were on it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a task waiting behind a running turn', () => {
    const HELD: TranscriptEvent[] = [
      {
        type: 'message_queued',
        messageId: 'msg_person',
        kind: 'work',
        text: 'and this is what the person typed while it was busy',
      },
      {
        type: 'message_queued',
        messageId: 'msg_relayed',
        kind: 'work',
        text: 'Task 002: write the second migration.',
        relayedFrom: 'sess_project-manager',
        relayedFromProfile: 'project-manager',
      },
    ]

    it('🔴 the held task names its relayer and the held draft says You — in one mount', async () => {
      // 🔴 **545 · re-aimed** for §1's stated reason, and with the same subject: the held row and
      // the person's row in ONE mount, saying different things about who wrote them. ⛔ The held
      // row and the TURN it becomes must give the same answer, which is why both ends ask
      // `relayed-turn.ts`'s one naming function rather than spelling a heading each.
      const m = await pane(HELD)
      const headings = m.all('queued-sender').map((el) => el.textContent?.trim())
      expect(headings).toEqual(['You', 'project-manager'])
      const marks = m.all('queued-about')
      expect(marks).toHaveLength(1)
      expect(marks[0]?.textContent?.trim()).toBe('from another conversation')
    })

    it('⛔ NEITHER control is offered on the relayed row, and BOTH are on the person’s', async () => {
      // 🔴 **The pair `406` closed for a report, and this is the half that reaches every task.**
      // ⛔ *Cancel it* would destroy a task `message_agent` has already told the assigning agent
      // was accepted; *Put it back in the composer* loads another MODEL's words into the person's
      // draft to be sent under their name.
      // ⚠️ **Asserted as a pair in ONE mount**, so *"the buttons are gone"* cannot be satisfied by
      // a pane that drew no buttons at all.
      const m = await pane(HELD)
      const rows = m.all('queued-entry')
      expect(rows).toHaveLength(2)
      const theirs = rows[1] as HTMLElement
      const mine = rows[0] as HTMLElement
      expect(mine.querySelectorAll('[data-cy="cancel-queued"]')).toHaveLength(1)
      expect(visible(mine.querySelector('[data-cy="cancel-queued"]') as Element)).toBe(true)
      expect(theirs.querySelectorAll('[data-cy="cancel-queued"]')).toHaveLength(0)
      expect(theirs.querySelectorAll('[data-cy="restore-queued"]')).toHaveLength(0)
      expect(theirs.querySelectorAll('button')).toHaveLength(0)
    })

    it('⚠️ …and the words are still shown, so nothing is hidden by taking the buttons away', async () => {
      const m = await pane(HELD)
      const body = m.all('queued-message')[1] as HTMLElement
      expect(body.textContent).toBe('Task 002: write the second migration.')
      expect(visible(body)).toBe(true)
    })
  })
})
