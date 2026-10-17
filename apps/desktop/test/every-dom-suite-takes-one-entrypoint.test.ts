import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * # ⛔ One entrypoint, and the 128th dom file cannot pick the other one (542, from `536` F4)
 *
 * ## 🔴 The finding
 *
 * > **`what-an-agent-was-told.dom.test.ts` still imports the deprecated `@vitest/browser/context`.
 * > The other 24 dom suites use `vitest/browser`.** ⛔ **It prints a DEPRECATED banner on EVERY
 * > `pnpm run ci` and it is the only file doing so.**
 *
 * ⚠️ **The quote is verbatim and one number in it is stale: `536` said 24, and it is 25.** Counted
 * at `542` against `571a90e7` — 26 files take `page`, of which this was the one offender. ⛔ The
 * correction is stated beside the quote rather than made inside it
 * (`a-corrected-anchor-keeps-a-verdict-it-never-earned`); *the only file doing so* was exact.
 *
 * ⚑ **Measured before the repair, not restated** — the runner's own words, from
 * `vitest run --project dom` on that one file at `542`:
 *
 * > ` DEPRECATED  …/what-an-agent-was-told.dom.test.ts tries to load a deprecated
 * > "@vitest/browser/context" module. This import will stop working in the next major version.
 * > Please, use "vitest/browser" instead.`
 *
 * ## ⚠️ Why a census and not just the one-line repair
 *
 * ⛔ **A line of noise on every gate costs more than a line.** ⚠️ **The brief cited `514` F1 for
 * this and `514` F1 is about something else** — it measured a caveat printed AFTER the verdict, and
 * its cost as *twelve response documents re-arguing a green*. 🔴 **Readers did not learn to skip
 * it; they kept stopping on it**, which is the opposite failure and at least as expensive. ⚑ The
 * correction is recorded here because a citation that names the wrong measurement is how a
 * characterisation hardens into a ruling (standing rule 19). **The reason this census exists needs
 * no borrowed evidence:** the import was reintroduced by a file written against an older example,
 * and nothing in the repository said which of the two spellings was live.
 *
 * 🔴 **Standing rule 20 — the category is defined by what a thing IS, not by which file broke.**
 * The class here is *a TypeScript file inside the DOM project's tree*: a suite, the harness, the
 * setup file that arms the wire, `drawn.ts`. Any of them can reach for the deprecated module, and
 * a census addressed only to `*.dom.test.ts` would be a rule with a hole exactly where the shared
 * helpers live.
 *
 * ## ⚑ The search shape (standing rule 4)
 *
 * ⛔ **Module specifiers off the TypeScript AST, never a grep.** Two reasons, both measured
 * elsewhere in this repo: a `from '…'` regex reads a specifier out of a string in ordinary code,
 * and `grep -rn` prints nothing at all for a file the tool decides is binary — which is how one
 * roster in this project came up short by a whole test file without any warning. A parse cannot be
 * fooled by either.
 *
 * ⚠️ **What it does NOT cover**: an `import()` or `require()` whose argument is a VARIABLE rather
 * than a literal, and a re-export through a package this tree does not own. ⛔ **The literal
 * dynamic forms ARE covered, and they were not in the first draft** — review measured
 * `await import('@vitest/browser/context')` and `require('@vitest/browser/context')` walking
 * straight past a reader that visited only `ImportDeclaration`. ⚑ Naming only the variable form
 * would have implied the literal one was read, which is the shape
 * `a-negative-is-only-as-strong-as-the-search-shape` names.
 */

/** ⚠️ Resolved from this module, not from the cwd — the node project runs from the repo root. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

const DOM = here('../test/dom')

/**
 * ⛔ **The module the runner has retired, and the one it asks for instead.**
 *
 * The whole package is named rather than just its `/context` subpath: `@vitest/browser` is a
 * PROVIDER for the runner this repo already has (`vitest.dom.config.ts` says so), and no file
 * inside the suite tree has business importing from it directly under any subpath.
 */
const RETIRED = '@vitest/browser'
const LIVE = 'vitest/browser'

/**
 * ⛔ **The predicate, named so a plant can be run through the SAME one the sweep runs.** A test
 * that filtered inline would leave its own rule unmeasured — the failure
 * `a-mutation-on-a-census-is-invisible-to-that-census` describes.
 */
const isRetired = (specifier: string): boolean =>
  specifier === RETIRED || specifier.startsWith(`${RETIRED}/`)

/** Every module specifier a file names statically, in source order. */
function specifiers(filename: string, source: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal
      if (ts.isStringLiteral(literal)) found.push(literal.text)
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
      found.push(node.expression.text)
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0]
      const dynamic =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      if (dynamic && first && ts.isStringLiteral(first)) found.push(first.text)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

/** Every `.ts` file in the DOM project's tree, repo-relative and POSIX-separated. */
function domFiles(): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      found.push({
        file: relative(DOM, child).split(sep).join('/'),
        source: readFileSync(child, 'utf8'),
      })
    }
  }
  walk(DOM)
  return found
}

describe('⛔ 542 · every file in the DOM project takes the live browser entrypoint', () => {
  it('⛔ nothing under `test/dom` imports the deprecated module', () => {
    const offenders = domFiles()
      .map(({ file, source }) => ({
        file,
        from: specifiers(file, source).filter(isRetired),
      }))
      .filter((one) => one.from.length > 0)
    expect(offenders).toEqual([])
  })

  /**
   * ⚑ **The positive half, on the same walk** — a roster that came back empty, or a parser that
   * found no specifiers, would satisfy the line above without reading anything
   * (`a-positive-assertion-must-differ-from-the-default`).
   */
  it('⚑ …and the walk really read the tree, and found the live entrypoint in use', () => {
    const files = domFiles()
    // ⛔ **A floor, not the count.** A number here would go red on the next suite added, which is
    // `a-bound-written-as-the-constant-cannot-pin-it` in the other direction: the assertion would
    // move with the tree instead of measuring it. 127 `.ts` files at `542`.
    expect(files.length).toBeGreaterThan(100)
    const takers = files.filter(({ file, source }) => specifiers(file, source).includes(LIVE))
    // ⚠️ **26 at `542`** — every suite that drives the page through `page`, and the one this
    // dispatch repaired. The floor is what stops this becoming a count nobody updates.
    expect(takers.length).toBeGreaterThan(20)
    expect(takers.map((one) => one.file)).toContain('what-an-agent-was-told.dom.test.ts')
    // ⛔ **The CATEGORY, pinned** (standing rule 20): the walk covers the DOM project's tree and
    // not only its suites. A narrowing to `*.dom.test.ts` would still clear the floor above and
    // would leave the shared helpers — the very files a bad import would spread from — unread.
    const roster = files.map((one) => one.file)
    expect(roster).toContain('harness.ts')
    expect(roster).toContain('setup/the-window-is-a-wire.ts')
    expect(roster.filter((one) => !one.endsWith('.dom.test.ts')).length).toBeGreaterThan(2)
  })

  /**
   * 🔴 **Planted and found with one derivation** — the predicate above is shown firing on the exact
   * line this dispatch removed, and staying silent on the line that replaced it. ⛔ Without this
   * the census could be satisfied by a reader that never matched anything
   * (`a-mutation-on-a-census-is-invisible-to-that-census`).
   */
  it('🔴 the reader finds the retired spelling, and clears the live one', () => {
    const retired = `import { page } from '${RETIRED}/context'\n`
    const live = `import { page } from '${LIVE}'\n`
    expect(specifiers('planted.ts', retired)).toEqual([`${RETIRED}/context`])
    expect(specifiers('planted.ts', live)).toEqual([LIVE])
    // ⚠️ **And the subpath the package ITSELF is, not only `/context`** — the next deprecation will
    // move the suffix and this census must not have to be widened again.
    expect(specifiers('planted.ts', `import x from '${RETIRED}'\n`)).toEqual([RETIRED])
    // ⛔ **A specifier written inside ordinary code is NOT an import**, which is the reason this
    // reads an AST rather than the text: a grep for the string would call this file an offender.
    expect(specifiers('planted.ts', `const doc = 'see ${RETIRED}/context for why'\n`)).toEqual([])
    // ⚑ **Four more ways a module comes in**, each the arm a reader written against
    // `ImportDeclaration` alone drops. ⛔ Review measured the last three missing from the first
    // draft of this file.
    for (const way of [
      `export { page } from '${RETIRED}/context'`,
      `const { page } = await import('${RETIRED}/context')`,
      `const { page } = require('${RETIRED}/context')`,
      `import page = require('${RETIRED}/context')`,
    ]) {
      expect(specifiers('planted.ts', `${way}\n`), way).toEqual([`${RETIRED}/context`])
    }
    // 🔴 **And the sweep's own predicate, run on the same plants** — both spellings of the retired
    // module are refused and the live one is not.
    expect([`${RETIRED}/context`, RETIRED, LIVE, 'vue'].filter(isRetired)).toEqual([
      `${RETIRED}/context`,
      RETIRED,
    ])
  })
})
