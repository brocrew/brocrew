"""542 · A copy guard that can only see half the strings.

⛔ **`536` F3, verbatim:** *"`what-an-agent-was-told.test.ts` §5 builds its copy census from
`/'([^'\n]{20,})'/g`. Any string containing a straight `'` is double-quoted by prettier and is
invisible to it… Every sentence on this surface uses a typographic `’` and therefore stays
single-quoted: the guard is enforced by a formatting convention, not by the guard."*

## ⚑ Why these rows are on a TEST HELPER and that is the right place

🔴 **The subject of this dispatch is an instrument, not a product behaviour.** Nothing under
`src/` changed: the three guarded files named no provider before `542` and name none after.
⛔ **What was defective was the thing that says so** — and a census nobody has made fail is a
census nobody has measured (standing rule 20's closure). ⚑ So every row below breaks the READER
and expects a planted fixture to notice.

## ⚠️ The two halves, which pull against each other

 1. **See every quote style.** M1 is the shipped blindness put back.
 2. **See no prose.** M2 is the half that makes a one-character `["']` widening wrong: the same
    three files carry more provider prose than provider code, and `told.ts`' own docblock quotes
    `codex-runtime.ts` by name.

## ⚠️ Five of these sixteen rows exist because review found the branch missing

⛔ **M5, M7, M8, M9, M10 and M16 all guard code the first draft did not have.** The first
reader used an ALLOW-LIST of platform a11y attribute names, and `SessionInstructions.vue:463`
hands `filename="as sent"` to a component that draws it — a Vue PROP, which no list of HTML
names could contain. ⚑ **The list was inverted to an exclusion**, and the rows moved with it.

## ⛔ What this table does NOT cover

 1. **The three guarded files themselves.** They are unedited; `provider-neutrality.test.ts` owns
    the rule that no renderer file may DECIDE on a provider name, and no row here touches it.
 2. **A string assembled rather than written** — `'cl' + 'aude'`, a computed key. The reader says
    so in its own docblock and `provider-neutrality.test.ts` states the same bound; a row that
    removed a defence nothing claims to have would measure nothing.
 3. **`<style>` blocks and non-readable static attributes.** Declared blind spots, not defences —
    see `visible-copy.ts`' "what it does NOT read".
"""

READER = "apps/desktop/test/lib/visible-copy.ts"
DOM_CENSUS = "apps/desktop/test/every-dom-suite-takes-one-entrypoint.test.ts"

MUTATIONS = [
    # ---- half one: see every quote style ---------------------------------------------------------
    (
        "M1 · 🔴 THE SHIPPED BLINDNESS, PUT BACK · only single-quoted literals are copy, so a "
        "sentence prettier double-quoted because it contains a straight `'` is invisible again. "
        "⛔ This is exactly `536` F3, and the guard goes back to being enforced by punctuation",
        [
            (
                READER,
                "      if (!isCode(node)) out.push({ text: node.text, origin: quoteOf(node.getText(file)) })\n",
                "      if (!isCode(node) && node.getText(file).startsWith(\"'\"))\n"
                "        out.push({ text: node.text, origin: quoteOf(node.getText(file)) })\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE OTHER HALF · the template's TEXT and COMMENT tags are swapped, so prose is read "
        "as copy and copy is skipped. ⚑ This is the mutation the written-down enum invites, and the "
        "reason its docblock says the fixtures rather than Vue are what hold it",
        [
            (
                READER,
                "const TEMPLATE_TEXT = 2\nconst TEMPLATE_COMMENT = 3\n",
                "const TEMPLATE_TEXT = 3\nconst TEMPLATE_COMMENT = 2\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ template literals stop being copy, which is the §3.3 answer removed: the byte "
        "labels and `not read: …` are built with backticks and a person reads all three",
        [
            (
                READER,
                "    } else if (\n"
                "      ts.isNoSubstitutionTemplateLiteral(node) ||\n"
                "      ts.isTemplateHead(node) ||\n"
                "      ts.isTemplateMiddle(node) ||\n"
                "      ts.isTemplateTail(node)\n"
                "    ) {\n",
                "    } else if (false) {\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the empty-chunk guard is inverted, so every backtick chunk EXCEPT the copy is "
        "emitted. ⚑ A row on the boundary rather than on the branch: `` `${n} B` `` has an empty "
        "head and a real tail, and only one of the two is a sentence",
        [
            (
                READER,
                "      if (node.text !== '' && !isCode(node)) out.push(",
                "      if (node.text === '' && !isCode(node)) out.push(",
            )
        ],
    ),
    # ---- the .vue half ---------------------------------------------------------------------------
    (
        "M5 · 🔴 a static attribute stops being copy, so `filename=\"as sent\"` — a component PROP "
        "the panel really draws — leaves the census. ⛔ This is the hole review found in the first "
        "draft, which used an allow-list of platform a11y names that no prop could ever be in",
        [
            (
                READER,
                "      if (value !== undefined && readable(prop.name ?? ''))\n",
                "      if (false)\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ …and the same branch widened past its exclusions: EVERY static attribute becomes "
        "copy, so `class` and `data-cy` are asserted as sentences. ⛔ A guard that fires on machine "
        "strings is one people learn to silence — `import-codex.test.ts`'s safety scan learned it "
        "the same way, flagging `workspace.ts` for a comment (`provider-neutrality.test.ts:77`)",
        [
            (
                READER,
                "  return !lower.startsWith('data-') && !MACHINE_ATTRIBUTES.includes(lower)\n",
                "  return true\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the attribute name is compared with the author's own casing, so a shouted "
        "`TITLE=\"…\"` — which HTML renders as a tooltip and Vue hands back verbatim — stops being "
        "copy, and a shouted `DATA-CY` starts being it. ⚑ One `.toLowerCase()`, both directions",
        [(READER, "  const lower = name.toLowerCase()\n", "  const lower = name\n")],
    ),
    (
        "M8 · ⚠️ a DYNAMIC import's specifier becomes copy again, so `await import('./codex-runtime')` "
        "is read as a sentence a person sees. ⛔ Review found this arm missing from the first draft: "
        "only the static form was excluded, and the over-read direction accuses an import graph",
        [
            (
                READER,
                "    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true\n",
                "    if (false) return true\n",
            )
        ],
    ),
    (
        "M9 · ⛔ a template-literal TYPE becomes copy, so ``type T = `claude-${string}` `` is read "
        "as a sentence. ⚑ `TemplateHead` is shared by a value template and a type template and only "
        "the plain literal type was excluded at first — the same arm, one syntax over",
        [
            (
                READER,
                "  if (ts.isTemplateLiteralTypeNode(parent) || ts.isTemplateLiteralTypeSpan(parent)) return true\n",
                "  if (false) return true\n",
            )
        ],
    ),
    (
        "M10 · 🔴 a `.vue` whose template is not in the file goes QUIET instead of throwing: "
        "`<template src=\"./x.html\">` parses with NO errors and NO ast, so the reader would return "
        "the script's copy and report a surface it never read. ⛔ Standing rule 27, second way",
        [
            (
                READER,
                "  if (template && !template.ast)\n",
                "  if (false)\n",
            )
        ],
    ),
    (
        "M11 · ⛔ an unparseable `.vue` comes back as NO COPY instead of throwing, so a surface this "
        "reader could not read is reported as a surface that names no provider. ⚑ Standing rule 27: "
        "an instrument that can go quiet without saying so is not an instrument",
        [
            (
                READER,
                "  if (errors.length > 0) throw new Error(`${filename}: ${errors.map(String).join('; ')}`)\n",
                "  if (errors.length > 0) return out\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ a module specifier becomes copy, so `from './codex-runtime'` is read as a sentence "
        "a person sees. ⛔ The over-read direction: a census that accuses an import graph is a "
        "census whose next red nobody believes",
        [
            (
                READER,
                "    parent.moduleSpecifier === node\n  )\n    return true\n",
                "    parent.moduleSpecifier !== node\n  )\n    return true\n",
            )
        ],
    ),
    # ---- F4 · the entrypoint census --------------------------------------------------------------
    (
        "M13 · 🔴 the retired module is refused only when named EXACTLY, so `@vitest/browser/context` "
        "— the one spelling this dispatch removed — walks past. ⛔ The subpath is the whole finding",
        [
            (
                DOM_CENSUS,
                "  specifier === RETIRED || specifier.startsWith(`${RETIRED}/`)\n",
                "  specifier === RETIRED\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the walk narrows to the SUITES, so the harness and the setup file that arms the "
        "wire stop being read. ⚑ Standing rule 20: a category defined by the file that broke leaves "
        "the shared helpers — where an import spreads FROM — unguarded, and the floor still passes",
        [
            (
                DOM_CENSUS,
                "      if (!entry.name.endsWith('.ts')) continue\n",
                "      if (!entry.name.endsWith('.dom.test.ts')) continue\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ a re-export stops being a way in, so `export { page } from '@vitest/browser/context'` "
        "carries the retired module into the tree unseen. ⚑ `a-census-that-asks-for-the-import-must-"
        "ask-for-the-call` with the axis moved to the other half of the same statement",
        [
            (
                DOM_CENSUS,
                "      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&\n",
                "      ts.isImportDeclaration(node) &&\n",
            )
        ],
    ),
    (
        "M16 · ⛔ …and neither is a DYNAMIC one: `await import('@vitest/browser/context')` and "
        "`require(…)` walk past. ⚑ Review measured both missing from the first draft of this census, "
        "which is why its 'what it does NOT cover' paragraph names the VARIABLE form only",
        [
            (
                DOM_CENSUS,
                "      if (dynamic && first && ts.isStringLiteral(first)) found.push(first.text)\n",
                "      if (false && first && ts.isStringLiteral(first)) found.push(first.text)\n",
            )
        ],
    ),
]
