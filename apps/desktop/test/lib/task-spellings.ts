import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⚑ **The shapes a task number can be printed in** — one reader, two censuses (`705`).
 *
 * ⚠️ Moved here from `one-task-one-name.test.ts` (`672`) when `705` pointed the same reader at
 * `main/`, `shared/` and the packages (`a-task-is-task-n-where-a-person-reads-it.test.ts` §3): a
 * second copy of these four patterns would be free to drift from the first, and the two populations
 * are only comparable while one reader produces both.
 *
 * Each has a `#` or a noun in front of a value: a template literal's `#${…}` or `# ${…}`, a Vue
 * template's `#{{ … }}` or `# {{ … }}`, a literal ENDING in `#` concatenated with `+` (*"asked about
 * #" + n*, not only a lone `'#'`), and *Task* or *Work* written in front of either interpolation
 * rather than asked of `taskCalled`. ⚠️ **Widened by `672`'s review**, which planted seven shapes
 * the first four patterns missed.
 */
export const SPELLINGS = [
  /#\s*\$\{/,
  /#\s*\{\{/,
  /#['"`]\s*\+/,
  /\b(?:Task|Work|task|work) #?\s*(?:\$\{|\{\{)/,
]

/** ⛔ Prose out first — a docblock quoting the old row is not a row. */
export const code = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** ⚑ Each LINE once, whichever shapes it matches. */
export const spellingsIn = (source: string): string[] =>
  source
    .split('\n')
    .filter((line) => SPELLINGS.some((shape) => shape.test(line)))
    .map((line) => line.trim())

/** Every `.ts` and `.vue` file under a directory, recursively — the set the code defines. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : /\.(ts|vue)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  )
}
