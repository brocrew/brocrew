import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COULD_NOT_BE_OPENED, refusedToOpen } from '../src/renderer/src/lib/taking-over'

/**
 * # 🔴 UI-007 · a conversation that could not be opened always says so in words
 *
 * ⚑ **The landing agent's note while landing D-017b** (`668 M27`): when the one door refuses to
 * open a conversation, the window says the host's reason. ⛔ An EMPTY reason was kept (`??`), so the
 * notice said nothing at all — `668`'s `closedPress` fell back to the plain sentence, and D-017b's
 * replacement did not. The host never sends an empty reason today, so it is pinned here, on the
 * words and on the screen's one door.
 *
 * ⛔ **Every negative here is paired with the same call one fact over**: a reason with words beside
 * one without.
 */

const REFUSED = 'There is no record of this conversation here.'

describe('UI-007 · a refused open is said in words', () => {
  it('🔴 no reason, an empty one or one of blanks says the plain sentence — a reason with words is said as it is', () => {
    expect(COULD_NOT_BE_OPENED).toBe('That conversation could not be opened.')
    for (const said of [null, '', '   ', '\n'])
      expect(refusedToOpen(said), JSON.stringify(said)).toBe(COULD_NOT_BE_OPENED)
    // ⛔ The pair: the host's own words are never replaced.
    expect(refusedToOpen(REFUSED)).toBe(REFUSED)
    expect(refusedToOpen(`  ${REFUSED}\n`)).toBe(REFUSED)
  })

  it('🔴 the screen’s one door says the refusal through it — and never its raw reason', () => {
    // ⚠️ `RuntimeScreen` is mounted by no test, so its door is read where it is written.
    const screen = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
      'utf8',
    )
    const from = screen.indexOf('async function openConversation(')
    expect(from, 'the door moved — this reads nothing').toBeGreaterThan(-1)
    const door = screen.slice(from, screen.indexOf('\n}\n', from))
    expect(door).toContain('say(refusedToOpen(store.lookError.value))')
    expect(door).not.toMatch(/say\(store\.lookError\.value/)
  })
})
