import { describe, expect, it } from 'vitest'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'

/**
 * ⛔ **The rule the summaries of what needs you share** (305 §1).
 *
 * The screen `304` reported did not have four wrong sentences on it; it had one `quiet` boolean
 * defined over one of the two populations the screen draws. So the thing worth pinning is not any
 * sentence — it is that no summary may claim emptiness while something real is waiting.
 *
 * ⚑ **D-016** deleted the demo seed, and with it Home and the seeded placeholder rows this file
 * used to weigh (`468`): the cases about a seeded row are gone, and what remains is the rule over
 * the populations that are still real — the live requests and what only the person may settle.
 *
 * ⚑ **`home-agrees.dom.test.ts` is the other half**, and it is the half that can see a surface. A
 * function that returned all of this correctly to nobody would pass every assertion here.
 */

/** Enough of a request to be counted. Nothing below reads a field. */
const request = (sessionId: string): AttentionRequest => ({ sessionId }) as AttentionRequest

const world = (live: number) => ({
  requests: Array.from({ length: live }, (_, index) => request(`sess_${index}`)),
})

describe('what the queue’s summaries may claim about what needs you', () => {
  it('⛔ is quiet when no WORK is waiting, and never while a request is', () => {
    expect(homeAttention(world(0)).quiet).toBe(true)
    // ⛔ …and the states that forbid it: one real request, and two.
    expect(homeAttention(world(1)).quiet).toBe(false)
    expect(homeAttention(world(2)).quiet).toBe(false)
  })

  it('✅ the genuinely empty screen gets every one of the calm sentences', () => {
    // ⚠️ **The paired positive.** Deleting the quiet copy would satisfy a test that only forbade
    // calm and leave a queue that can never report it — 067's rule, from the other side.
    const home = homeAttention(world(0))

    expect(home.total).toBe(0)
    expect(home.stat).toBe('All clear')
    expect(home.statTone).toBe('ok')
    expect(home.intro).toBe('Nothing here is blocked on an answer from you.')
  })

  it('⚠️ a live request restores the answerable invitation, and each half stays nameable', () => {
    const home = homeAttention(world(2))

    expect(home.total).toBe(2)
    expect(home.stat).toBe('2 items')
    // The intro invites an answer only when there is something here that CAN be answered.
    expect(home.intro).toBe('Answer here, or open the card for the full disclosure.')
    // ⛔ Both halves stay nameable. A blended total would let a surface draw a row only the person
    // may settle as an answerable one, which is HO-002 acceptance #7 in one field.
    expect(home.live).toBe(2)
    expect(home.onlyYou).toBe(0)
  })

  it('says one item singular, in every sentence that counts', () => {
    expect(homeAttention(world(1)).stat).toBe('1 item')
    // ⚠️ **And the singular still reaches a sentence that counts WORK**, which is what this case
    // is named for — a paired positive, so the stat is not the only one left.
    expect(homeAttention({ ...world(0), onlyYou: 1 }).intro).toContain('1 item below is')
  })
})
