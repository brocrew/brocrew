import { describe, expect, it } from 'vitest'
import * as links from '../src/shared/links'
import { moveReceiptOf } from '../src/shared/move-request'

const { agentLink, conversationLink, pieceLink } = links

describe('host-owned navigation links', () => {
  it('uses the exact stable target kinds and encodes their IDs', () => {
    expect(conversationLink('session one', 'Trip planning')).toBe(
      '[Trip planning](brocrew://conversation/session%20one)',
    )
    expect(agentLink('aid:travel-writing', 'Travel adviser')).toBe(
      '[Travel adviser](brocrew://agent/aid%3Atravel-writing)',
    )
    expect(pieceLink('piece/one', 'W2.1', 'Book the train')).toBe(
      '[W2.1 · Book the train](brocrew://piece/piece%2Fone)',
    )
  })

  it('encodes Markdown target punctuation for all three link kinds', () => {
    const id = "id!'()*"
    const encoded = 'id%21%27%28%29%2A'
    expect(conversationLink(id, 'Plan')).toBe(`[Plan](brocrew://conversation/${encoded})`)
    expect(agentLink(id, 'Planner')).toBe(`[Planner](brocrew://agent/${encoded})`)
    expect(pieceLink(id, 'W1', 'Plan')).toBe(`[W1 · Plan](brocrew://piece/${encoded})`)
  })

  it('exports the approved navigation description', () => {
    expect(links.NAVIGATION_LINKS_DESCRIPTION).toBe(
      'Use the returned navigation links; clicking them does not move work.',
    )
  })

  it('keeps the link on a receipt whose destination ID contains a closing parenthesis', () => {
    const destinationLink = conversationLink('session)', 'Plan')
    expect(destinationLink).toBe('[Plan](brocrew://conversation/session%29)')
    const receipt = {
      sessionId: 'session)',
      messageId: 'message',
      destinationLink,
      receiptLine: `Your request is now in ${destinationLink}.`,
    }
    expect(moveReceiptOf(receipt)).toEqual(receipt)
  })

  it('escapes label punctuation and backslashes before they can break the link', () => {
    const title = String.raw`Notes\] (draft) [link]`
    const escaped = String.raw`Notes\\\] (draft\) [link\]`
    expect(conversationLink('s', title)).toBe(`[${escaped}](brocrew://conversation/s)`)
    expect(agentLink('aid:a', title)).toBe(`[${escaped}](brocrew://agent/aid%3Aa)`)
    expect(pieceLink('p', 'W1', title)).toBe(`[W1 · ${escaped}](brocrew://piece/p)`)
  })

  it('cuts titles to 120 characters before escaping and preserves the piece label', () => {
    expect(conversationLink('s', `${']'.repeat(120)}ignored`)).toBe(
      `[${String.raw`\]`.repeat(120)}](brocrew://conversation/s)`,
    )
    expect(agentLink('aid:a', `${'n'.repeat(120)}ignored`)).toBe(
      `[${'n'.repeat(120)}](brocrew://agent/aid%3Aa)`,
    )
    expect(pieceLink('p', 'W1', 't'.repeat(120))).toBe(
      `[W1 · ${'t'.repeat(120)}](brocrew://piece/p)`,
    )
  })

  it('keeps whole Unicode characters when cutting the label', () => {
    expect(conversationLink('s', `${'🚆'.repeat(120)}ignored`)).toBe(
      `[${'🚆'.repeat(120)}](brocrew://conversation/s)`,
    )
    const boundary = `${'a'.repeat(119)}🚆`
    expect(conversationLink('s', `${boundary}ignored`)).toBe(
      `[${boundary}](brocrew://conversation/s)`,
    )
    expect(agentLink('a', `${boundary}ignored`)).toBe(`[${boundary}](brocrew://agent/a)`)
    expect(pieceLink('p', 'W1', `${boundary}ignored`)).toBe(`[W1 · ${boundary}](brocrew://piece/p)`)
  })

  it('keeps targets stable when their labels change', () => {
    expect(conversationLink('s', 'New title')).toBe('[New title](brocrew://conversation/s)')
    expect(agentLink('aid:a', 'New name')).toBe('[New name](brocrew://agent/aid%3Aa)')
    expect(pieceLink('p', 'W1.2', 'New title')).toBe('[W1.2 · New title](brocrew://piece/p)')
  })
})
