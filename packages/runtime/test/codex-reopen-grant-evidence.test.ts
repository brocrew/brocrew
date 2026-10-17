import { describe, expect, it } from 'vitest'
import {
  cardsThatOverpromise,
  reopenVerdict,
  sweepVerdict,
  type CardSeen,
} from '../smoke/reopen-grant-evidence'

/**
 * # ⚑ 697 · `probe:codex-reopen-grant`'s verdict, held to planted turns
 *
 * ⛔ The live probe is not in `pnpm run ci`, so the part of it that DECIDES is pinned here — a rig
 * whose reading drifted would print a confident answer from turns it misread
 * (`pin-a-live-only-instrument-from-a-cheap-gate`). Each verdict beside the one fact that moves it.
 */

const card = (turn: string, kind: string, over: Partial<CardSeen> = {}): CardSeen => ({
  turn,
  kind,
  availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
  persistence: 'session',
  amendments: 0,
  // ⚑ The grant turn's card is answered with the grant, and the product took it.
  answer: { outcome: turn === 'r2' ? 'allow_for_session' : 'deny', accepted: true },
  ...over,
})
const TURNS = { grant: 'r2', control: 'r2b', reopened: 'r4' }

describe('697 · the reopen verdict', () => {
  it('⚑ forgotten — the in-server control asked nothing, and the reopened turn asked (672: 3 of 3)', () => {
    expect(reopenVerdict([card('r2', 'file'), card('r4', 'file')], TURNS)).toEqual({
      verdict: 'forgotten',
    })
  })

  it('⚑ survived — the same, with the reopened turn silent: the one fact that moves the verdict', () => {
    expect(reopenVerdict([card('r2', 'file')], TURNS)).toEqual({ verdict: 'survived' })
  })

  it('⛔ not performed — the in-server control ASKED, so the grant never held to begin with', () => {
    const verdict = reopenVerdict(
      [card('r2', 'file'), card('r2b', 'file'), card('r4', 'file')],
      TURNS,
    )
    expect(verdict.verdict).toBe('not-performed')
  })

  it('⛔ not performed — the grant turn offered no session grant, or raised no card at all', () => {
    const noOffer = card('r2', 'file', { availableDecisions: ['allow', 'deny', 'cancel'] })
    expect(reopenVerdict([noOffer, card('r4', 'file')], TURNS).verdict).toBe('not-performed')
    expect(reopenVerdict([card('r4', 'file')], TURNS).verdict).toBe('not-performed')
    // ⚑ A COMMAND card in the grant turn is not the grant this verdict reads.
    expect(reopenVerdict([card('r2', 'command'), card('r4', 'file')], TURNS).verdict).toBe(
      'not-performed',
    )
  })

  it('⛔ not performed — the grant was offered but not TAKEN, where it would otherwise read as survived', () => {
    const refused = card('r2', 'file', {
      answer: { outcome: 'allow_for_session', accepted: false },
    })
    expect(reopenVerdict([refused], TURNS).verdict).toBe('not-performed')
    const unsettled = card('r2', 'file', {
      answer: { outcome: 'allow_for_session', accepted: null },
    })
    expect(reopenVerdict([unsettled], TURNS).verdict).toBe('not-performed')
    // ⚑ The control: the same card, taken, is `survived` — the one fact that moved it.
    expect(reopenVerdict([card('r2', 'file')], TURNS)).toEqual({ verdict: 'survived' })
  })
})

describe('697 · 672 F1, live — a card that promises more than its buttons', () => {
  it('🔴 a one-shot command card that says `session` is caught — main’s shape, with its amendment', () => {
    const mains = card('c1', 'command', {
      availableDecisions: ['allow', 'deny', 'cancel'],
      persistence: 'session',
      amendments: 1,
    })
    expect(cardsThatOverpromise([mains])).toEqual([mains])
  })

  it('⚑ controls: the same card saying `once`, and a session card saying `session`, are clean', () => {
    const once = card('c1', 'command', {
      availableDecisions: ['allow', 'deny', 'cancel'],
      persistence: 'once',
      amendments: 1,
    })
    expect(cardsThatOverpromise([once, card('r2', 'file')])).toEqual([])
    // ⛔ …and the other direction: a session button on a card that says `once` is caught too.
    const under = card('r2', 'file', { persistence: 'once' })
    expect(cardsThatOverpromise([under])).toEqual([under])
  })
})

describe('704 · the command sweep — is a Codex command card ever offered the session grant?', () => {
  // ⚑ Planted shapes, named as the probe names them; the verdict reads names, never commands.
  const SHAPES = ['s-simple', 's-and', 'd-heredoc']
  const WITH_THE_GRANT = ['allow', 'allow_for_session', 'deny', 'cancel'] as const
  /**
   * ⛔ A command card as `672` measured one on every shape — a one-shot Allow, a proposed amendment,
   * `once`. ⚠️ `card()`'s default offers the session grant and says `session`, so BOTH are
   * overridden here; a plant that kept either would be the `offered` case in every test below.
   */
  const measured = (turn: string, over: Partial<CardSeen> = {}): CardSeen =>
    card(turn, 'command', {
      availableDecisions: ['allow', 'deny', 'cancel'],
      persistence: 'once',
      amendments: 1,
      ...over,
    })
  const everyShapeCarded = (): CardSeen[] => SHAPES.map((shape) => measured(shape))

  it('⚑ never offered — every swept shape raised a command card and none offered it (672: 14 of 14)', () => {
    expect(sweepVerdict(everyShapeCarded(), SHAPES)).toEqual({ verdict: 'never-offered' })
  })

  it('🔴 offered — ONE shape’s command card gains the session button, and exactly that shape is named', () => {
    const cards = everyShapeCarded().map((one) =>
      one.turn === 's-and' ? measured('s-and', { availableDecisions: [...WITH_THE_GRANT] }) : one,
    )
    expect(sweepVerdict(cards, SHAPES)).toEqual({ verdict: 'offered', shapes: ['s-and'] })
  })

  it('⛔ not performed — ONE shape raised no command card, so the sentence was not measured on it', () => {
    const cards = everyShapeCarded().filter((one) => one.turn !== 's-and')
    expect(sweepVerdict(cards, SHAPES)).toEqual({
      verdict: 'not-performed',
      because: 'no command card on s-and',
    })
  })

  it('⚑ offered is decided before not-performed — the offered plant, with another shape silent', () => {
    const cards = everyShapeCarded()
      .filter((one) => one.turn !== 'd-heredoc')
      .map((one) =>
        one.turn === 's-and' ? measured('s-and', { availableDecisions: [...WITH_THE_GRANT] }) : one,
      )
    expect(sweepVerdict(cards, SHAPES)).toEqual({ verdict: 'offered', shapes: ['s-and'] })
  })

  it('⛔ a FILE card offering the grant on a swept turn is not a command card — still never offered', () => {
    // ⚑ `card()`'s default file card offers `allow_for_session`: the kind filter is what reads past it.
    const cards = [...everyShapeCarded(), card('s-and', 'file')]
    expect(sweepVerdict(cards, SHAPES)).toEqual({ verdict: 'never-offered' })
  })

  it('⛔ a command card offering the grant on ANOTHER arm’s turn is not a shape — still never offered', () => {
    const cards = [...everyShapeCarded(), card('c1', 'command')]
    expect(card('c1', 'command').availableDecisions).toContain('allow_for_session')
    expect(sweepVerdict(cards, SHAPES)).toEqual({ verdict: 'never-offered' })
  })

  it('⛔ not performed — no shape was swept at all: an unenumerated sweep is not a success', () => {
    expect(sweepVerdict(everyShapeCarded(), [])).toEqual({
      verdict: 'not-performed',
      because: 'no shape was swept',
    })
  })
})
