import ts from 'typescript'
import { parse as parseSfc } from 'vue/compiler-sfc'

/**
 * # 🔴 Every string a person can read, whichever quote the formatter chose (542, from `536` F3)
 *
 * ## ⛔ The finding this file exists for
 *
 * > **`what-an-agent-was-told.test.ts` §5 built its copy census from `/'([^'\n]{20,})'/g`.** Any
 * > string containing a straight `'` is double-quoted by prettier and is invisible to it — so
 * > `"the agent's own memory"` would pass a scan whose whole job is to catch a provider name in
 * > user-visible copy. ⚑ **Every sentence on that surface uses a typographic `’` and therefore
 * > stays single-quoted: the guard was enforced by a formatting convention, not by the guard.**
 *
 * ⚠️ **Widening the regex to `["']` is the repair that looks like a one-character fix and is not.**
 * Measured at `542` against the three files that census reads: a widened `/["']…{20,}["']/` finds
 * **one** provider hit, and it is `SessionInstructions.vue`'s line comment *"It said \"loaded by
 * Claude itself\" until 317"* — **the very string `536` F3 cites as the evidence**. ⛔ So the
 * one-character fix turns the census red on the sentence that reported the defect
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 *
 * ⛔ **Both halves, and they pull against each other**, which is why this is a parser and not a
 * regex: *a copy guard sees every user-visible string regardless of quote character, and it sees no
 * prose regardless of how much prose quotes the thing it guards against.*
 *
 * ## ⚑ What it reads
 *
 * | file | what counts as copy |
 * |---|---|
 * | `.ts` | every string literal and every template-literal chunk, from the TypeScript AST |
 * | `.vue` | the same over `<script>`/`<script setup>`, plus the template's TEXT nodes, every static attribute outside {@link MACHINE_ATTRIBUTES}, and the literals inside its bound expressions |
 *
 * ⚑ **A parser rather than a strip.** Comments never enter an AST, so prose is excluded by
 * construction rather than by a regex that has to be re-derived per file type — the arm
 * `a-source-census-must-strip-prose-before-it-asserts` says goes missing when a strip helper is
 * copied between suites. It also settles the two cases a regex gets wrong in opposite directions: a
 * `'` inside a double-quoted string is not a delimiter, and a `"` inside a comment is not copy.
 *
 * ⚑ **Template literals are copy on this surface and the measurement is in the response** (542
 * §3.3): `renderer/src/lib/told.ts` builds a layer's size as `` `${String(bytes)} B` `` and
 * `` `${(bytes / 1024).toFixed(1)} KB` ``, and `SessionInstructions.vue` builds
 * `` `not read: ${reason}` `` — user-visible sentences the single-quote census never saw, before
 * any question of which quote prettier chose.
 *
 * ## ⛔ Attributes are read by EXCLUSION, and that is a measurement rather than a taste
 *
 * ⚠️ **The first draft of this file used an allow-list of platform a11y attributes — `title`,
 * `aria-label`, `alt`, `placeholder` — and review found it blind on the guarded file itself.**
 * `SessionInstructions.vue:463` draws `<DocumentBody … filename="as sent" />`, and `DocumentBody`
 * renders `filename` as a visible label. 🔴 **`filename` is a component PROP, not an HTML
 * attribute**, so no list of platform names could ever have contained it.
 *
 * ⛔ **Swept across all 92 renderer components before choosing:** the static attributes carrying
 * copy are `title`, `aria-label`, `placeholder` — **and `filename`, `what`, `label`, `who`, none of
 * which is an HTML attribute at all.** ⚑ So the default is *read it*: an attribute nobody has
 * classified is checked rather than skipped, which is the fail-closed direction for a guard.
 *
 * ## ⛔ What it does NOT read, said out loud so a green run is not read as more than it is
 *
 *  - **{@link MACHINE_ATTRIBUTES} and every `data-*`.** 🔴 **This IS a hole and the first draft of
 *    this docblock wrongly said it was not.** `provider-neutrality.test.ts` refuses a value that
 *    *is* `claude` or `codex` — `data-cy="codex"` is caught — but **not one that merely contains
 *    the name**: `data-cy="codex-row"` and `class="codex-badge"` are refused by neither census.
 *    ⚠️ Measured at `542`; the hole is narrowed to these names and is not closed.
 *  - **`<style>` blocks.** A `content:` declaration can put text on the page. Measured: the three
 *    guarded files declare none.
 *  - **Custom SFC blocks** (`<i18n>`, `<docs>`). There are none under `apps/`.
 *  - **Bound expressions are read as CODE, not filtered by attribute name** — `:data-cy="…"`
 *    contributes its chunks like any other literal. An expression is indistinguishable from
 *    script, and the over-read costs nothing a census would act on.
 *  - **Anything assembled rather than written** — `'cl' + 'aude'`, a computed key, text arriving
 *    from main. This is a guard against DRIFT, the same bound `provider-neutrality.test.ts` states.
 *    ⚠️ **And the seam is real, not hypothetical**: `TOLD_REMEMBERS_NOTHING` is three literals `+`
 *    together, so this reader returns it in chunks. ⛔ **The `+` is hand-written and prettier never
 *    introduces or moves one** — measured at `542` with `prettier --stdin-filepath`, which leaves a
 *    mid-word split exactly where an author put it. **So there is no formatter guarantee that a
 *    seam falls between words**, and a name straddling one is past this reader.
 *
 * ⚑ **The policy lives at the call site, never here.** This module answers *what can a person
 * read*; which words are refused is the census's question, so extracting the reader does not export
 * a rule (`extracting-a-shared-guard-exports-its-policy`).
 */

/** Where a visible string came from — the axis `536` F3 found the old census blind to. */
export type CopyOrigin = 'single' | 'double' | 'template' | 'text' | 'attribute'

/** One string a person can read, and the shape it was written in. */
export interface VisibleString {
  readonly text: string
  readonly origin: CopyOrigin
}

/**
 * Static attributes nobody reads — the EXCLUSION, so an unclassified name defaults to being copy.
 *
 * ⚠️ Derived from a sweep of all 92 renderer components at `542`, not from the HTML spec: these are
 * the names whose values are identifiers, selectors, URLs or SVG geometry. ⛔ Compared
 * lower-cased, because Vue's parser preserves the author's spelling and HTML does not care —
 * `TITLE="…"` draws a tooltip.
 */
export const MACHINE_ATTRIBUTES: readonly string[] = [
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'class',
  'd',
  'for',
  'href',
  'id',
  'name',
  'ref',
  'src',
  'srcset',
  'style',
  'to',
  'viewbox',
]

/** Whether one static attribute's value is something a person could read. */
function readable(name: string): boolean {
  const lower = name.toLowerCase()
  return !lower.startsWith('data-') && !MACHINE_ATTRIBUTES.includes(lower)
}

/**
 * Vue's template-AST tags, named rather than spelled at the branch.
 *
 * ⛔ **`vue/compiler-sfc` exports the parser and not the enum**, so these are written down. They are
 * not taken on trust: a planted fixture in the census asserts that a text node, an HTML comment, an
 * interpolation and an attribute each land where these names say — so a renumbering in Vue turns
 * those red rather than turning this reader quietly empty (standing rule 27).
 */
const TEMPLATE_TEXT = 2
const TEMPLATE_COMMENT = 3
const TEMPLATE_INTERPOLATION = 5
const PROP_ATTRIBUTE = 6

/** The template-AST shape this reader relies on, and nothing more. */
interface TemplateNode {
  readonly type: number
  readonly content?: string | { readonly content?: string }
  readonly children?: readonly unknown[]
  readonly props?: readonly TemplateProp[]
}

interface TemplateProp {
  readonly type: number
  readonly name?: string
  readonly value?: { readonly content?: string } | undefined
  readonly exp?: { readonly content?: string } | null | undefined
}

/**
 * ⛔ **The shapes that are code wearing a string's clothes.**
 *
 * A module specifier, a string literal TYPE and a template-literal TYPE are all read by the
 * compiler and seen by nobody — `from './codex-runtime'` and `` type T = `claude-${string}` ``
 * would otherwise make a copy guard fire on an import graph and a union. ⚠️ **The dynamic forms are
 * here because review found them missing**: only the static `import … from` was excluded at first,
 * so `await import('./codex-runtime')` counted as a sentence.
 */
function isCode(node: ts.StringLiteral | ts.TemplateLiteralLikeNode): boolean {
  const parent = node.parent as ts.Node | undefined
  if (!parent) return false
  if (ts.isLiteralTypeNode(parent)) return true
  if (ts.isTemplateLiteralTypeNode(parent) || ts.isTemplateLiteralTypeSpan(parent)) return true
  if (ts.isExternalModuleReference(parent)) return true
  if (ts.isImportTypeNode(parent)) return true
  if (ts.isModuleDeclaration(parent)) return true
  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  )
    return true
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true
  }
  return false
}

/** The quote prettier chose, which is the whole axis `536` F3 is about. */
function quoteOf(raw: string): CopyOrigin {
  if (raw.startsWith('"')) return 'double'
  if (raw.startsWith('`')) return 'template'
  return 'single'
}

/** Every literal in a TypeScript source, comments excluded by construction. */
function fromScript(source: string, filename: string, out: VisibleString[]): void {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      if (!isCode(node)) out.push({ text: node.text, origin: quoteOf(node.getText(file)) })
    } else if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text !== '' && !isCode(node)) out.push({ text: node.text, origin: 'template' })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
}

/** Every string a person can read in one template node and its children. */
function fromTemplate(node: TemplateNode, filename: string, out: VisibleString[]): void {
  if (node.type === TEMPLATE_COMMENT) return
  if (node.type === TEMPLATE_TEXT) {
    const text = typeof node.content === 'string' ? node.content.trim() : ''
    if (text !== '') out.push({ text, origin: 'text' })
    return
  }
  if (node.type === TEMPLATE_INTERPOLATION) {
    const expression = typeof node.content === 'object' ? (node.content?.content ?? '') : ''
    if (expression !== '') fromScript(`(${expression})`, filename, out)
    return
  }
  for (const prop of node.props ?? []) {
    if (prop.type === PROP_ATTRIBUTE) {
      const value = prop.value?.content
      if (value !== undefined && readable(prop.name ?? ''))
        out.push({ text: value, origin: 'attribute' })
      continue
    }
    const expression = prop.exp?.content
    if (expression !== undefined && expression !== '') fromScript(`(${expression})`, filename, out)
  }
  for (const child of node.children ?? []) fromTemplate(child as TemplateNode, filename, out)
}

/**
 * Every string a person can read in one source file.
 *
 * ⛔ **It throws rather than returning nothing when the template is not there to read** — an
 * instrument that can go quiet without saying so is not an instrument (standing rule 27), and an
 * empty list is what every assertion built on this would rather have. ⚠️ **Two ways that happens,
 * and review found the second**: the SFC parser reports errors, or it reports none and hands back
 * no AST at all, which is what `<template src="./x.html">` does.
 */
export function visibleCopy(filename: string, source: string): VisibleString[] {
  const out: VisibleString[] = []
  if (!filename.endsWith('.vue')) {
    fromScript(source, filename, out)
    return out
  }
  const { descriptor, errors } = parseSfc(source, { filename })
  if (errors.length > 0) throw new Error(`${filename}: ${errors.map(String).join('; ')}`)
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) fromScript(block.content, `${filename}.ts`, out)
  }
  const template = descriptor.template as { ast?: TemplateNode } | null | undefined
  if (template && !template.ast)
    throw new Error(`${filename}: a <template> this reader cannot see — an out-of-file src=`)
  if (template?.ast) fromTemplate(template.ast, `${filename}.ts`, out)
  return out
}
