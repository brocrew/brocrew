import { expect } from 'vitest'

const linkLine = /^\[(?:\\.|[^\]\\])*\]\(brocrew:\/\/(?:conversation|agent|piece)\/[^\s)]+\)$/

/** Separates the unchanged receipt from its appended, standalone navigation links. */
export function navigationReply(text: string): { prose: string; links: string[] } {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => linkLine.test(line))
  if (first < 0) return { prose: text, links: [] }
  const links = lines.slice(first)
  for (const line of links) expect(line).toMatch(linkLine)
  expect(new Set(links).size).toBe(links.length)
  return { prose: lines.slice(0, first).join('\n'), links }
}

/** IDs may occur in link destinations, but never in prose or a visible link label. */
export function expectIdsOnlyInLinkTargets(text: string, ids: readonly string[]): void {
  const visible = text.replace(
    /(\[(?:\\.|[^\]\\])*\])\(brocrew:\/\/(?:conversation|agent|piece)\/[^\s)]+\)/g,
    '$1',
  )
  for (const id of ids) {
    expect(visible).not.toContain(id)
    expect(visible).not.toContain(encodeURIComponent(id))
  }
}
