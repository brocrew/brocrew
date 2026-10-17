import ts from 'typescript'
import { parse as parseSfc } from 'vue/compiler-sfc'

/**
 * # 🔴 Every comment a person WRITING this app can read, as spans (555)
 *
 * ## ⛔ Why this is the counterpart of `visible-copy.ts` and not a use of it
 *
 * ⚑ **`visible-copy.ts` answers *what can a person USING the app read*, and it excludes prose by
 * construction** — comments never enter an AST. ⚠️ **This module answers the opposite question**,
 * because `555`'s subject IS the prose: a Product Owner withdrew `HO-023` §7 and its sentence is
 * still load-bearing in docblocks, and a census that stripped comments would be blind to every
 * instance of the thing it exists to find.
 *
 * ⛔ **Both readers are needed and neither is the other's negation.** A claim can be written in a
 * docblock (this module), in a string an agent reads (factory text), and in a string a person
 * reads (`visible-copy.ts`) — three corpora, and `a-negative-is-only-as-strong-as-the-search-shape`
 * says a census that reads one of them has measured one of them.
 *
 * ## 🔴 Why a parser rather than the inverse of `code()`
 *
 * ⚠️ **`what-an-agent-was-told.test.ts`' `code()` strips prose with two regexes.** Inverting it —
 * *keep* what those match — inherits the failure that does not matter when you are deleting and
 * does when you are collecting: ⛔ **a `/*` inside a STRING becomes a comment.** This repo writes
 * such strings (a docblock's own example, a regex in a template literal,
 * `a-regex-inside-a-template-literal-loses-its-escapes`), and a collector that swallowed one would
 * report a census hit on a line no human wrote as prose.
 *
 * ⚑ **The parser cannot make that mistake**, because it has already decided what is a string. Every
 * comment in a TypeScript file is LEADING TRIVIA of exactly one token — including the ones at the
 * end of a file, which lead `EndOfFileToken` — so walking the tokens and asking
 * {@link ts.getLeadingCommentRanges} at each `getFullStart()` reaches all of them, once.
 *
 * ## ⛔ SPANS, and that is the whole point of the shape
 *
 * 🔴 **A census addressed to a FILE is satisfied by any line anywhere in it.** `550` F3 measured
 * that from the other side — a second function in the same shape gave a file-scoped assertion a
 * second satisfier and a mutation row went dark
 * (`a-second-function-in-the-same-shape-disarms-a-file-scoped-census`;
 * `a-file-level-contains-cannot-tell-sibling-declarations-apart` is the same failure on a sibling
 * axis). ⚠️ **555 needs the distinction that costs the most if it is lost**: a docblock that
 * ASSERTS a withdrawn claim and a docblock that RECORDS its withdrawal contain the same words.
 * ⛔ Only a span-level reader can tell them apart, and telling them apart is the dispatch.
 *
 * ## ⚠️ What it does NOT read, said out loud so a green run is not read as more than it is
 *
 *  - **`.vue` `<template>` interpolations and `<style>` blocks.** An HTML comment in the template
 *    IS read; a `/* *\/` inside a bound expression is not — Vue hands the expression over as a
 *    string and this module does not re-parse it. Measured: no guarded file has one.
 *  - **Markdown, Python and shell.** `docs/**`, `scripts/mutations/<n>/mutations.py` and the gate
 *    scripts carry prose too, and a caller that needs them reads them as text — there is no AST to
 *    be exact with, so this module does not pretend to one.
 *  - **JSDoc STRUCTURE.** A span is the comment's text. Which tag a sentence sits under is the
 *    census's question, and putting it here would export a policy
 *    (`extracting-a-shared-guard-exports-its-policy`).
 */

/** How the comment was written — the axis a census that cares about docblocks needs. */
export type ProseKind = 'block' | 'line' | 'html'

/** One comment, with enough to cite it in a finding. */
export interface ProseSpan {
  /** Exactly the path the caller passed in, so a finding can be quoted back. */
  readonly file: string
  /** 1-indexed, the line the comment STARTS on — in the `.vue` file, not in its `<script>`. */
  readonly line: number
  /** The comment's own bytes, delimiters included. */
  readonly text: string
  readonly kind: ProseKind
}

/**
 * 🔴 **One span's words, with its own wrapping taken out — and a census that skips this measures
 * almost nothing.**
 *
 * ⛔ **Measured at `555`, and it is why the first draft of that census was green on a tree that
 * plainly carried the sentence.** `instructions.ts` shipped *"that is a safety property rather than
 * an omission"* — but at 100 columns the comment wraps, so the bytes are
 * `a safety` + newline + ` * ` + `property`, and `/safety propert/` does not match them. ⚠️ **Every
 * phrase longer than one word is one reflow away from invisible**, and prettier reflows a docblock
 * whenever a word above it changes length.
 *
 * ⚑ **So the delimiters, the per-line `*` and a per-line markdown `>` go, and every run of
 * whitespace becomes one space.** ⛔ **The blockquote marker is the same finding a second time**:
 * this repository quotes its rulings in `> ` blocks, so *"Safety lives in the rails"* is stored as
 * `Safety lives in the` + newline + ` * > ` + `rails` — and a census looking for the ruling it
 * exists to enforce could not see the ruling. ⚠️ **It is per-line DECORATION the author did not put
 * inside the sentence**, exactly like the `*`, and it is stripped for exactly that reason and no
 * other: a `>` anywhere but at the start of a line is left alone.
 *
 * ⛔ The result is deliberately NOT positional — a caller that needs a line number uses
 * {@link ProseSpan.line}, which is the span's, not the match's. A census wants to know whether a
 * span says a thing; where inside it the words fell is the formatter's business.
 */
export function proseText(span: ProseSpan): string {
  return span.text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .replace(/^\/\//gm, '')
    .replace(/^[ \t]*\*/gm, '')
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Vue template-AST comment nodes, named rather than spelled at the branch — see `visible-copy.ts`. */
const TEMPLATE_COMMENT = 3

/** The template-AST shape this reader relies on, and nothing more. */
interface TemplateNode {
  readonly type: number
  readonly loc?: { readonly start?: { readonly line?: number } }
  readonly content?: string | { readonly content?: string }
  readonly children?: readonly unknown[]
}

/**
 * 🔴 **A RUN of `//` lines is ONE comment, and folding them is not a nicety** (`555`).
 *
 * ⛔ **`ts.getLeadingCommentRanges` returns one range per `//` line.** So the four-line note in
 * `claude-runtime.ts` that ends *"…strip the tool/permission instructions the 001 approval profile
 * depends on"* arrives as four spans, and no sentence in it is longer than the span it lands in.
 * ⚠️ **Measured at `555`**: the census that this reader exists for found nothing in any `//` comment
 * in the repository until this fold was added, and reported a clean tree.
 *
 * ⚑ **Consecutive lines only.** A blank line, a statement, or a `/* *\/` block between two `//`
 * lines ends the run — which is how a person reads them, and it keeps a span from swallowing a
 * whole function's worth of unrelated remarks. ⛔ Block comments never merge: they already carry
 * their own whole thought, and joining two would produce a span neither author wrote.
 */
function coalesce(spans: readonly ProseSpan[]): ProseSpan[] {
  const out: ProseSpan[] = []
  for (const span of spans) {
    const last = out[out.length - 1]
    const runs =
      last !== undefined &&
      last.kind === 'line' &&
      span.kind === 'line' &&
      last.file === span.file &&
      span.line === last.line + last.text.split('\n').length
    if (!runs) {
      out.push(span)
      continue
    }
    out[out.length - 1] = { ...last, text: `${last.text}\n${span.text}` }
  }
  return out
}

/**
 * Every comment in one TypeScript source, by walking the tokens.
 *
 * ⛔ **Deduplicated on position**, because a range can be reached twice: a token's leading trivia
 * and its parent's are the same bytes when the parent starts at the child.
 *
 * ⚠️ **Collected in POSITION order and not in visit order**, which {@link coalesce} depends on: the
 * walk reaches a parent's trivia before a child's, but a `//` run inside a function body is reached
 * from several tokens, and unsorted it would fold the wrong lines together.
 */
function fromScript(
  source: string,
  filename: string,
  lineOffset: number,
  out: ProseSpan[],
  seen: Set<number>,
): void {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: { pos: number; span: ProseSpan }[] = []
  const take = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push({
        pos: range.pos,
        span: {
          file: filename,
          line: file.getLineAndCharacterOfPosition(range.pos).line + 1 + lineOffset,
          text: source.slice(range.pos, range.end),
          kind: range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? 'block' : 'line',
        },
      })
    }
  }
  const visit = (node: ts.Node): void => {
    take(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  // ⚑ **The last comments in a file lead the EOF token and no other**, and this repo ends several
  // files with one. ⛔ **`ts.forEachChild` on a `SourceFile` visits `endOfFileToken` after the
  // statements**, so the walk above already reaches them — measured at `555`, after an explicit
  // `take(file.endOfFileToken)` here proved to be a line no mutation could kill
  // (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚠️ The §0 assertion that a trailing
  // comment is found stays: it pins the BEHAVIOUR, which is the compiler's and not ours.
  found.sort((a, b) => a.pos - b.pos)
  for (const span of coalesce(found.map((one) => one.span))) out.push(span)
}

/** Every HTML comment in one template node and its children. */
function fromTemplate(node: TemplateNode, filename: string, out: ProseSpan[]): void {
  if (node.type === TEMPLATE_COMMENT) {
    const text = typeof node.content === 'string' ? node.content : ''
    out.push({ file: filename, line: node.loc?.start?.line ?? 0, text, kind: 'html' })
    return
  }
  for (const child of node.children ?? []) fromTemplate(child as TemplateNode, filename, out)
}

/**
 * Every comment in one source file, in the order they appear.
 *
 * ⛔ **It throws rather than returning nothing when a `.vue` template is not there to read** —
 * standing rule 27, and the same two failures `visible-copy.ts` names: the SFC parser reports
 * errors, or it reports none and hands back no AST at all (`<template src="./x.html">`).
 * ⚠️ **An instrument that can go quiet without saying so is not an instrument**, and a census
 * built on an empty list is the quietest possible green.
 */
export function proseSpans(filename: string, source: string): ProseSpan[] {
  const out: ProseSpan[] = []
  if (!filename.endsWith('.vue')) {
    fromScript(source, filename, 0, out, new Set())
    return out
  }
  const { descriptor, errors } = parseSfc(source, { filename })
  if (errors.length > 0) throw new Error(`${filename}: ${errors.map(String).join('; ')}`)
  const seen = new Set<number>()
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    // ⚑ **`loc.start.line` is where the block's CONTENT begins**, so a comment on the block's first
    // line is at that line and not one past it — hence `- 1` against a 1-indexed local line.
    if (block) fromScript(block.content, filename, block.loc.start.line - 1, out, seen)
  }
  const template = descriptor.template as { ast?: TemplateNode } | null | undefined
  if (template && !template.ast)
    throw new Error(`${filename}: a <template> this reader cannot see — an out-of-file src=`)
  if (template?.ast) fromTemplate(template.ast, filename, out)
  return out
}
