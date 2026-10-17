import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SubAgentEntry from '../../src/renderer/src/components/SubAgentEntry.vue'
import type { SubAgentCard } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

/**
 * **248 §2 · the same defect one level down — a SUB-AGENT's own detached command.**
 *
 * ⛔ `248` §5's probe measured a dispatched agent running a `Bash` of its own, and nothing stops that
 * child asking for `run_in_background`. The row it lands on is a `SubAgentToolRow` rather than a
 * `ToolItem` — a different component, a different index, the same lie — so leaving it out would have
 * moved the defect somewhere harder to see rather than ending it.
 *
 * ⚠️ **In the DOM project because the card's body is COLLAPSED by default and SSR cannot click.**
 * `SubAgentEntry` renders its head server-side and nothing else — deliberately, since *"a sub-agent
 * emits a heartbeat every few seconds for minutes"* — so an SSR assertion about a row inside it
 * would be an assertion about `<!---->`.
 */

afterEach(unmountAll)

function card(background?: { id?: string; outcome?: 'stopped' }): SubAgentCard {
  return {
    agentId: 'aae1d6bfc8bbb6ad1',
    kind: 'general-purpose',
    title: 'run the timer',
    running: true,
    body: [
      {
        kind: 'tool',
        callId: 'toolu_child',
        name: 'Bash',
        summary: 'node -e "setTimeout(…, 30000)"',
        result: { summary: 'Command running in background with ID: b-child', ok: true },
        ...(background === undefined ? {} : { background }),
      },
    ],
  }
}

/** The card, opened — the head is a disclosure button and the rows are behind it. */
async function opened(one: SubAgentCard): Promise<ReturnType<typeof mount>> {
  const m = mount(SubAgentEntry, { card: one }, { width: 900 })
  m.q('subagent-head').click()
  await nextTick()
  return m
}

describe("a child's detached command says so on its own row", () => {
  it('⛔ the row carries the word, out of the ONE table the parent row reads', async () => {
    const m = await opened(card({ id: 'b-child' }))
    // Positive first: the body really opened, so the assertion below is about a row on screen.
    expect(m.q('subagent-rows')).toBeTruthy()
    const word = m.q('subagent-tool-background-toolu_child')
    expect(word.textContent).toContain('still running')
    // ⚠️ `data-ok` is deliberately UNCHANGED. It reports the RECEIPT, which for a backgrounded
    // command really was `ok` — 247's ruling. The word is the second fact beside it, not a
    // correction of the first.
    expect(word.closest('li')?.dataset.ok).toBe('true')
  })

  it('⛔ …and it becomes the ending when one arrives', async () => {
    const m = await opened(card({ id: 'b-child', outcome: 'stopped' }))
    expect(m.q('subagent-tool-background-toolu_child').textContent).toContain('stopped')
  })

  it('⚠️ an ordinary child row says nothing extra — the paired negative', async () => {
    const m = await opened(card())
    // The paired positive: the row itself rendered, so the absence below is about the word.
    expect(m.q('subagent-rows').textContent).toContain('Bash')
    expect(document.querySelector('[data-cy="subagent-tool-background-toolu_child"]')).toBeNull()
  })
})
