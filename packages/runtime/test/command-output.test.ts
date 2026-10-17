import { describe, expect, it } from 'vitest'
import { CommandTails, MAX_COMMAND_TAIL, MAX_COMMAND_TAILS } from '../src/command-output'

/**
 * The ring buffers live command output; `src/command-output.ts` records the measurements
 * behind its shape.
 *
 * ⛔ **The three rules here are all about FAILING TOWARD LESS**, which is `247`'s direction for this
 * whole family: a tail that shows less than the command printed and says so is honest; one that grows
 * without a ceiling is `052`'s blow-up, and one that starts in the middle without saying so is `092`'s
 * silent cap.
 */
describe('CommandTails — what one running command has printed (300)', () => {
  it('keeps what it is given, in order, per command', () => {
    const tails = new CommandTails()
    tails.write('a', 'tick-1\n')
    tails.write('a', 'tick-2\n')
    tails.write('b', 'other\n')
    expect(tails.read('a')).toEqual({ text: 'tick-1\ntick-2\n', dropped: 0, closed: false })
    // ⚠️ The paired positive for the negative below: two commands really are held apart.
    expect(tails.read('b')?.text).toBe('other\n')
  })

  it('⛔ answers `null` for a command it holds nothing for — never an empty tail', () => {
    const tails = new CommandTails()
    // ⚠️ **The distinction the card draws two different sentences from** (074): "we are not holding
    // it" and "it has printed nothing yet" are different facts, so an empty tail must be reachable
    // only by a command that really streamed.
    expect(tails.read('never-seen')).toBeNull()
    tails.write('a', 'x')
    expect(tails.read('a')?.text).toBe('x')
  })

  it('⛔ an empty delta is not a write — so it cannot mint an empty tail', () => {
    const tails = new CommandTails()
    tails.write('a', '')
    expect(
      tails.read('a'),
      'an empty delta minted a tail that says "it printed nothing"',
    ).toBeNull()
    // …and an empty id cannot either, which is the other half of the same guard.
    tails.write('', 'orphan')
    expect(tails.size).toBe(0)
  })

  it('🔴 keeps the LAST MAX_COMMAND_TAIL characters and COUNTS what it dropped (092)', () => {
    const tails = new CommandTails()
    tails.write('a', 'A'.repeat(MAX_COMMAND_TAIL))
    expect(tails.read('a')).toEqual({
      text: 'A'.repeat(MAX_COMMAND_TAIL),
      dropped: 0,
      closed: false,
    })
    tails.write('a', 'BBB')
    const held = tails.read('a')
    expect(held?.text.length, 'the ceiling is a ceiling').toBe(MAX_COMMAND_TAIL)
    expect(held?.text.endsWith('BBB'), 'the NEWEST end is what is kept').toBe(true)
    expect(held?.text.startsWith('AAA'), 'and the oldest is what went').toBe(true)
    expect(held?.dropped, 'the cut is counted, never silent').toBe(3)
    // ⚑ **It accumulates across writes** — a count that reset each time would understate by exactly
    // as much as the command kept printing, which is the failure `247` §3 calls worse than none.
    tails.write('a', 'CC')
    expect(tails.read('a')?.dropped).toBe(5)
  })

  it('🔴 slices by CODE POINT, so a cut never renders a lone surrogate', () => {
    const tails = new CommandTails()
    // ⚠️ **Astral characters at the boundary.** `String.prototype.slice` cuts UTF-16 units, so a
    // tail cut mid-pair would render `�` on the one surface whose job is showing what a command
    // really printed — `251` learned this on the registry row and the rule is the same here.
    tails.write('a', '😀'.repeat(MAX_COMMAND_TAIL))
    tails.write('a', 'x')
    const text = tails.read('a')?.text ?? ''
    expect([...text].length, 'the ceiling counts code points').toBe(MAX_COMMAND_TAIL)
    expect(text.includes('�'), 'a replacement character reached the tail').toBe(false)
    expect(text.endsWith('x')).toBe(true)
  })

  it('⛔ holds at most MAX_COMMAND_TAILS commands, evicting the least recently WRITTEN', () => {
    const tails = new CommandTails()
    for (let n = 0; n < MAX_COMMAND_TAILS; n += 1) tails.write(`c${n}`, 'x')
    expect(tails.size).toBe(MAX_COMMAND_TAILS)
    // ⚑ **The oldest is kept alive by WRITING to it**, which is the whole reason eviction is by
    // write rather than by read: the one command still producing must not be thrown away because
    // somebody opened an older card.
    tails.write('c0', 'y')
    tails.write('overflow', 'z')
    expect(tails.size).toBe(MAX_COMMAND_TAILS)
    expect(tails.read('c0')?.text, 'the still-producing command survived').toBe('xy')
    expect(tails.read('c1'), 'and the genuinely oldest one went').toBeNull()
    expect(tails.read('overflow')?.text).toBe('z')
  })

  it('⚑ `close` marks a tail finished, keeps its text, and mints nothing', () => {
    const tails = new CommandTails()
    tails.write('a', 'done\n')
    tails.close('a')
    expect(tails.read('a')).toEqual({ text: 'done\n', dropped: 0, closed: true })
    // ⛔ **An ending for a command that never streamed leaves nothing behind**, so `read` goes on
    // saying "we hold nothing" rather than inventing an empty tail that reads as "it printed
    // nothing" — the same two sentences the second test above keeps apart.
    tails.close('never-streamed')
    expect(tails.read('never-streamed')).toBeNull()
    expect(tails.size).toBe(1)
  })

  it('⚠️ a delta after a close REOPENS it — the provider is still producing', () => {
    const tails = new CommandTails()
    tails.write('a', 'one\n')
    tails.close('a')
    tails.write('a', 'two\n')
    // Nothing observed does this. Leaving `closed` latched would be a CLAIM — that the provider
    // cannot contradict its own ending — and this app does not make claims nothing can refute.
    expect(tails.read('a')).toEqual({ text: 'one\ntwo\n', dropped: 0, closed: false })
  })

  it('lets everything go on `clear`', () => {
    const tails = new CommandTails()
    tails.write('a', 'x')
    expect(tails.size).toBe(1)
    tails.clear()
    expect(tails.size).toBe(0)
    expect(tails.read('a')).toBeNull()
  })
})
