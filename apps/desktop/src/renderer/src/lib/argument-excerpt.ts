/**
 * # 🔴 658 · One argument of a call, read back out of the summary both adapters keep
 *
 * ⚠️ **Its own module because two readers need it and neither may import the other**: the fold
 * (`transcript.ts`) pairs a host row with its call by the id in the call's arguments, and the card
 * (`outgoing-card.ts`) draws a message's words from them. ⛔ `outgoing-card.ts` imports the fold's
 * types, so a value import the other way would be a cycle.
 */

/**
 * ⚠️ **One string argument, read back out of a call's bounded summary** — both adapters write
 * `JSON.stringify(arguments)` and cut it at 200 characters, Claude with a trailing `…` and Codex with
 * `… (200 of N characters)`.
 *
 * ⚑ **Two uses, and only on a call the fold already recognised as one of ours**: the card DRAWS a
 * message's words from it, and the fold PAIRS a host row with its call by comparing an opaque id
 * (`sess_…`, `task_…`) — and a give's or a take-on's title, the one prose their rows repeat as
 * sent. A whole summary is parsed; a cut one is read up to where it stops, escapes decoded, a
 * half-written escape
 * dropped, and `cut` says the value did not end. `null` when the key is not there at all — the card shows no body and the pairing says
 * *unknown*, rather than guessing.
 */
export function argumentExcerpt(
  summary: string,
  key: string,
): { readonly text: string; readonly cut: boolean } | null {
  try {
    const parsed: unknown = JSON.parse(summary)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[key]
      return typeof value === 'string' ? { text: value, cut: false } : null
    }
    return null
  } catch {
    // A cut summary — read on below.
  }
  const body = summary.replace(/ \(\d+ of \d+ characters\)$/, '').replace(/…$/, '')
  const opener = `${JSON.stringify(key)}:"`
  const start = body.indexOf(opener)
  if (start < 0) return null
  let text = ''
  let at = start + opener.length
  while (at < body.length) {
    const char = body[at] as string
    if (char === '"') return { text, cut: false }
    if (char !== '\\') {
      text += char
      at += 1
      continue
    }
    const escape = body[at + 1]
    if (escape === undefined) break
    if (escape === 'u') {
      const hex = body.slice(at + 2, at + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
      text += String.fromCharCode(parseInt(hex, 16))
      at += 6
      continue
    }
    text += ESCAPES[escape] ?? escape
    at += 2
  }
  return { text, cut: true }
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
}
