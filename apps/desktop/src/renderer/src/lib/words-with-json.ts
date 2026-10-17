import { asPrettyJson } from './tool-answer'

/**
 * # ⚑ Words that carry JSON, read two ways
 *
 * Detect JSON embedded in prose so a card can offer readable formatting alongside the original raw words.
 *
 * ⛔ **A message's words are its author's, and nothing about their shape is promised** — the JSON in
 * that note is there because a model pasted it. ⚑ **So this FINDS, and never guesses**: a stretch
 * that parses as a whole JSON object or array is drawn indented in the Readable view, everything
 * else exactly as written, and the Raw view is always the words as they were sent (`001`'s rule for
 * a message's `textContent`, kept by the view that promises it).
 */

/** ⚑ One run of the words — as written, or a JSON value found in them and drawn indented. */
export type WordsPart =
  | { readonly kind: 'words'; readonly text: string }
  | { readonly kind: 'json'; readonly text: string; readonly pretty: string }

/**
 * ⚠️ **The shortest stretch worth drawing as a block.** Prose carries brackets — *"see [1]"*,
 * *"{name}"* — and a three-character array drawn as a block would break a sentence to say nothing.
 */
export const SHORTEST_JSON_DRAWN = 30

/** ⚠️ Bounds on the scan, so a pathological text costs a bounded amount: words past it stay words. */
const LONGEST_WORDS_READ = 100_000
const MOST_STARTS_TRIED = 200

/**
 * ⚑ **The words, split into what was written and the JSON found in them** — or `null` when there is
 * no JSON worth drawing, and the card then offers no second view.
 *
 * ⚑ A candidate starts at a `{` or `[`, ends at its matching close (brackets inside a string do not
 * count), and must parse — `asPrettyJson`, the tool-answer viewer's own formatter — as an object or
 * an array at least {@link SHORTEST_JSON_DRAWN} long. ⛔ One that does not stays words, so a cut or
 * hand-edited value is drawn as it was written rather than as a guess.
 */
export function jsonInWords(text: string): readonly WordsPart[] | null {
  if (text.length > LONGEST_WORDS_READ) return null
  const parts: WordsPart[] = []
  let written = 0
  let at = 0
  let tried = 0
  while (at < text.length && tried < MOST_STARTS_TRIED) {
    const open = firstOpening(text, at)
    if (open < 0) break
    tried += 1
    const close = matchingClose(text, open)
    const candidate = close < 0 ? null : text.slice(open, close + 1)
    const pretty =
      candidate === null || candidate.length < SHORTEST_JSON_DRAWN ? null : asPrettyJson(candidate)
    if (candidate === null || pretty === null) {
      at = open + 1
      continue
    }
    if (open > written) parts.push({ kind: 'words', text: text.slice(written, open) })
    parts.push({ kind: 'json', text: candidate, pretty })
    written = close + 1
    at = written
  }
  if (!parts.some((part) => part.kind === 'json')) return null
  if (written < text.length) parts.push({ kind: 'words', text: text.slice(written) })
  return parts
}

function firstOpening(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{' || char === '[') return i
  }
  return -1
}

/** ⚑ The index of the bracket that closes the one at `open`, or `-1` — strings and escapes skipped. */
function matchingClose(text: string, open: number): number {
  const stack: string[] = []
  let inString = false
  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (char === '\\') i += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}
