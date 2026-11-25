/**
 * An agent's words on a card a person must act on, split into the first sentence, which leads the
 * card in bold, and the rest, drawn under it. Agents are asked to lead with the ask, so the first
 * sentence is the one thing to do.
 *
 * The words stay whole when splitting them would break their Markdown: a first line that is a
 * heading, a list, a quote or code, or a sentence that ends inside bold, code or a link.
 */
export interface CardLead {
  readonly lead: string
  readonly rest: string
}

/** The longest first sentence that still leads; a longer one stays in the words. */
const LONGEST_LEAD = 200

export function cardLead(text: string): CardLead {
  const words = text.trim()
  const firstLine = words.split('\n', 1)[0] ?? ''
  if (/^(#|[-*+] |\d+[.)] |>|```|\|)/.test(firstLine)) return { lead: '', rest: words }
  const sentence = /^(.+?[.?!:])(?=\s|$)/.exec(firstLine)?.[1] ?? firstLine
  if (sentence.length > LONGEST_LEAD || !balanced(sentence)) return { lead: '', rest: words }
  return { lead: sentence, rest: words.slice(sentence.length).trim() }
}

/**
 * Whether a piece of Markdown closes every bold and code span it opens, and holds nothing that can
 * start a link or an escape: a link, or an escaped character, may run past the sentence's end.
 */
function balanced(markdown: string): boolean {
  const pairs = (mark: RegExp): number => (markdown.match(mark) ?? []).length
  return (
    pairs(/\*\*/g) % 2 === 0 &&
    pairs(/`/g) % 2 === 0 &&
    pairs(/__/g) % 2 === 0 &&
    !/[[\]<\\]/.test(markdown)
  )
}
