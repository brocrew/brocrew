import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import AssistantMessage from '../../src/renderer/src/components/AssistantMessage.vue'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import AppNoticeEntry from '../../src/renderer/src/components/AppNoticeEntry.vue'
import ContinuationEntry from '../../src/renderer/src/components/ContinuationEntry.vue'
import RelayedEntry from '../../src/renderer/src/components/RelayedEntry.vue'
import { mount, unmountAll } from './harness'

/**
 * The conversation's own text reads at 15 px with a 1.6 line height (24 px), and this says so in
 * pixels rather than by the token's name: a test that only checked `var(--text-reading)` in a
 * `<style>` block would stay green if the token's value drifted, so `getComputedStyle` in the real
 * cascade is what states what a reader receives.
 *
 * It also pins the commit's second claim — that a heading is sized FROM the paragraph it sits
 * over rather than from a fixed token, so it can never render smaller than that paragraph, and
 * that inline code scales with the surrounding text rather than sitting at an absolute size.
 *
 * ⚠️ **Six components, not nine.** `OutgoingEntry`, `WorkReportEntry` and `ProjectWorkspace` are
 * in the same commit and read the same tokens, but none of them is mountable with the minimal
 * fixture shape this file copies from `attach-path.dom.test.ts` and
 * `a-place-a-reply-can-take-you.dom.test.ts` without building a larger fixture than a reading-size
 * regression warrants; the six mounted here already cover the token (M66) and the ladder (M67–M69)
 * at their full blast radius.
 */

afterEach(unmountAll)

const AT = 1_700_000_000_000

describe("the conversation's own reading size (2760914e)", () => {
  it("AssistantMessage's replies read at 15px with a 24px line height (--text-reading / --leading-reading)", () => {
    const m = mount(
      AssistantMessage,
      {
        item: { kind: 'assistant', id: 'a1', text: 'hello', streaming: false, at: AT },
        who: 'Claude',
      },
      { width: 900 },
    )
    const style = getComputedStyle(m.q('assistant-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it("UserMessage's bubble reads at 15px with a 24px line height", () => {
    const m = mount(
      UserMessage,
      { item: { kind: 'user', id: 'u1', text: 'hi', at: AT } },
      { width: 900 },
    )
    const style = getComputedStyle(m.q('user-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it("QueuedMessage's waiting text reads at 15px with a 24px line height", () => {
    const m = mount(
      QueuedMessage,
      { item: { kind: 'queued', id: 'q1', text: 'when you get a moment', at: AT, outcome: null } },
      { width: 900 },
    )
    const style = getComputedStyle(m.q('queued-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it("AppNoticeEntry's notice text reads at 15px with a 24px line height", () => {
    const m = mount(
      AppNoticeEntry,
      {
        item: {
          kind: 'appNotice',
          id: 'n1',
          text: 'A person approved the plan.',
          notice: 'a-decision-a-person-made',
          at: AT,
        },
      },
      { width: 900 },
    )
    const style = getComputedStyle(m.q('app-notice-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it("ContinuationEntry's sent-for-you text reads at 15px with a 24px line height", () => {
    const m = mount(
      ContinuationEntry,
      { item: { kind: 'continuation', id: 'c1', text: 'carry on', at: AT } },
      { width: 900 },
    )
    const style = getComputedStyle(m.q('continuation-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it("RelayedEntry's relayed text reads at 15px with a 24px line height", async () => {
    const m = mount(
      RelayedEntry,
      {
        item: { kind: 'relayed', id: 'r1', text: 'from another conversation', at: AT },
        ownAgent: null,
      },
      { width: 900 },
    )
    await expandAgentCards(m)
    const style = getComputedStyle(m.q('relayed-message'))
    expect(style.fontSize).toBe('15px')
    expect(style.lineHeight).toBe('24px')
  })

  it('a heading in a reply is never smaller than the paragraph it introduces, and inline code scales with the text around it', () => {
    const m = mount(
      AssistantMessage,
      {
        item: {
          kind: 'assistant',
          id: 'a1',
          streaming: false,
          at: AT,
          text: '# One\n\n## Two\n\n### Three\n\n#### Four\n\nBody text with `inline code` in it.',
        },
        who: 'Claude',
      },
      { width: 900 },
    )
    const root = m.q('assistant-markdown')

    const p = root.querySelector('p')
    const h1 = root.querySelector('h1')
    const h2 = root.querySelector('h2')
    const h3 = root.querySelector('h3')
    const h4 = root.querySelector('h4')
    const code = root.querySelector('code')
    // Presence first — a size comparison over an element that was never found passes vacuously.
    expect(p, 'no <p> in the rendered markdown').not.toBeNull()
    expect(h1, 'no <h1> in the rendered markdown').not.toBeNull()
    expect(h2, 'no <h2> in the rendered markdown').not.toBeNull()
    expect(h3, 'no <h3> in the rendered markdown').not.toBeNull()
    expect(h4, 'no <h4> in the rendered markdown').not.toBeNull()
    expect(code, 'no <code> in the rendered markdown').not.toBeNull()

    const size = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)
    const pSize = size(p!)
    const h1Size = size(h1!)
    const h2Size = size(h2!)
    const h3Size = size(h3!)
    const h4Size = size(h4!)
    const codeSize = size(code!)

    // The reading-size paragraph this ladder is built on top of.
    expect(pSize).toBe(15)

    // The ladder still descends.
    expect(h1Size).toBeGreaterThan(h2Size)
    expect(h2Size).toBeGreaterThan(h3Size)
    expect(h3Size).toBeGreaterThan(h4Size)

    // h4 is 1em — exactly its paragraph's size, never smaller.
    expect(h4Size).toBe(pSize)
    // Every heading is at least as large as the paragraph it sits over.
    expect(h1Size).toBeGreaterThanOrEqual(pSize)
    expect(h2Size).toBeGreaterThanOrEqual(pSize)
    expect(h3Size).toBeGreaterThanOrEqual(pSize)

    // Inline code is proportional to the surrounding text, not a fixed absolute size.
    expect(codeSize).toBeLessThan(pSize)
    expect(codeSize).toBeCloseTo(pSize * 0.88, 1)
  })
})
