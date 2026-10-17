import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'

/**
 * ⚑ **649 · How a census reads a probe that `pnpm run ci` never runs.**
 *
 * ⛔ **Prose is not code.** A census that reads a probe's raw text is answered by its comments:
 * measured on the two probe censuses as `495` wrote them, commenting out a teardown line —
 * `// await transport.close()` — left both GREEN, because the dead line still held the words they
 * asked for. ⚑ Block comments, whole-line comments and trailing comments are all removed; a `:` in
 * front of the slashes is a URL (`http://127.0.0.1`) and is left alone.
 */
export const codeOnly = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** ⚑ Layout is not code either: whitespace, and a comma before a closer, are all a reformat moves. */
export const squash = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/,\s*([)\]}])/g, '$1')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .trim()

/** A probe under `packages/runtime/smoke/`, comments removed. */
export const probeSource = (file: string): string =>
  codeOnly(readFileSync(new URL(`../../smoke/${file}`, import.meta.url), 'utf8'))

/**
 * 🔴 **The whole probe, as code, in one value.** ⛔ Named pins leave GAPS — measured by `649`'s own
 * review: a statement inserted between two pinned regions, an `answered` shadowed inside the
 * reader, a guarded `it()`, the budget constant multiplied after the pinned prefix, the
 * experiment's inputs moved together with its oracle. ⚑ This closes every one: any edit to the
 * code moves it, and an edit to a comment or to layout does not.
 *
 * ⚠️ **Its own edge:** `squash` turns a line break into a space, so a break inserted after a bare
 * `return` or `throw` — which JavaScript reads as the end of the statement — does not move it.
 */
export const fingerprint = (source: string): string =>
  createHash('sha256').update(squash(source)).digest('hex')

/**
 * ⛔ **Named pins over one probe's squashed code**, so a failure says WHICH property moved.
 * `occurrences` must come back exactly 1 for a pinned block: an edit makes it 0 and a second copy
 * makes it 2. `region` slices from a UNIQUE opening anchor to the next closing one, so a failure
 * prints the diff.
 *
 * ⚠️ **What they do not catch, and `fingerprint` does:** a verbatim copy kept under a dead branch
 * BESIDE an edited original still counts 1 (a `region` pin is immune — its anchor would appear
 * twice), and nothing between two pins is read at all.
 */
export function pinsOver(source: string): {
  occurrences: (text: string) => number
  region: (from: string, to: string) => string
} {
  const code = squash(source)
  return {
    occurrences: (text) => code.split(squash(text)).length - 1,
    region: (from, to) => {
      const start = code.indexOf(squash(from))
      expect(start, `anchor ${from}`).toBeGreaterThan(-1)
      expect(code.indexOf(squash(from), start + 1), `a second ${from}`).toBe(-1)
      const end = code.indexOf(squash(to), start + 1)
      expect(end, `anchor ${to}`).toBeGreaterThan(start)
      return code.slice(start, end).trim()
    },
  }
}
