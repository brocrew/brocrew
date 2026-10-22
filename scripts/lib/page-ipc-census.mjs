/**
 * Type-check page-side bridge reads against the renderer's `window.api` declaration.
 * CDP page programs are template strings that the normal build never compiles. Cook them
 * as received by the page, replacing interpolations with untyped identifiers, and wrap
 * them in async functions for the TypeScript compiler.
 *
 * Report properties absent from every union arm, unsupported bridge input keys or values,
 * and impossible comparisons. Ignore missing standard-library DOM types and properties
 * available on at least one union arm. Unparseable page code refuses instead of disappearing.
 *
 * Limits: Node-side SQL rows are outside IPC types; whole values returned to Node, bridge
 * aliases stashed in untyped globals, and chains after an already-rejected access become
 * `any`. Only page-selected fields before those boundaries can be checked.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The placeholder every `${…}` becomes: one identifier, typed `any`, so interpolation never types. */
export const INTERPOLATION = '__interpolated'

// ⚑ **A type the LANGUAGE declares is the only one excluded** — a DOM read the page's `lib` cannot
// type (`Element.dataset`) is the page's business, not a stale IPC read. ⚠️ Everything else counts,
// `node_modules` included, and that is deliberate: `AppInfo` is `z.infer<…>`, so its fields'
// declarations live in zod's own types, and a filter on `apps/` or `packages/` went blind to it.
// The census's own file is excluded too: a page's own object literal is not the bridge.
const THE_LANGUAGE = /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]/
const MENTIONS_API = /\bwindow\.api\b/

/** The repo's own TypeScript — the one `pnpm run typecheck` uses — resolved from `root`. */
export function typescriptAt(root) {
  return createRequire(join(root, 'package.json'))('typescript')
}

/** Whether `body` parses as the inside of an `async` function — the shape `evaluate` runs it in. */
function parsesAsAPage(ts, body) {
  const { diagnostics } = ts.transpileModule(`async function page() {\n${body}\n}\n`, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  return (diagnostics ?? []).length === 0
}

/**
 * ⚑ **A call that runs its argument IN THE PAGE** — `cdp.evaluate`, `#evaluateRaw`, and
 * `app-closes-check.mjs`'s `evaluateInPage`: every executor in these smokes is named for it.
 */
const EXECUTOR = /^#?evaluate/

/** Whether `node` sits anywhere inside the arguments of a page executor ({@link EXECUTOR}). */
function isInsideAnEvaluate(ts, node) {
  for (let at = node; at.parent; at = at.parent) {
    const call = at.parent
    if (
      ts.isCallExpression(call) &&
      call.arguments.includes(at) &&
      EXECUTOR.test(
        ts.isPropertyAccessExpression(call.expression)
          ? call.expression.name.text
          : ts.isIdentifier(call.expression)
            ? call.expression.text
            : '',
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * ⚑ **Every page in one file** — cooked text, file, and the line it starts on.
 *
 * ⚑ **A candidate is any string or template that names `window.api`.** One that parses as a page
 * body is a page, and is type-checked. ⛔ **One that does not parse is REFUSED** (`unparsed`) when it
 * is a template or sits inside an `evaluate(` argument — page code the compiler cannot read is
 * page code this census cannot see. ⚠️ **A plain string that does not parse and is not handed to
 * `evaluate` is PROSE** — an error message naming the bridge — and is returned as such, never
 * checked. That is the one place it is blind: page code split across concatenated plain strings,
 * built OUTSIDE the arguments of a page executor.
 *
 * ⛔ A matched template is not descended into: a template nested in one of its `${…}` is Node-side
 * code that builds the page, never the page.
 */
export function pageTemplatesIn(ts, file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const pages = []
  const unparsed = []
  const prose = []
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const consider = (node, body, isTemplate) => {
    const found = { file, line: lineOf(node), body }
    if (parsesAsAPage(ts, body)) pages.push(found)
    else if (isTemplate || isInsideAnEvaluate(ts, node)) unparsed.push(found)
    else prose.push(found)
  }
  const visit = (node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const body = ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : node.head.text +
          node.templateSpans.map((span) => INTERPOLATION + span.literal.text).join('')
      if (MENTIONS_API.test(body)) {
        consider(node, body, true)
        return
      }
    } else if (ts.isStringLiteral(node) && MENTIONS_API.test(node.text)) {
      consider(node, node.text, false)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { pages, unparsed, prose }
}

/**
 * 🔴 **Type-check the pages and return the reads no declared arm has.**
 *
 * ⚑ One program for every page, so the cost is one compile (~9 s measured on 49 pages, 2026-09-23).
 * `syntactic` is returned rather than thrown so a caller can say WHICH page did not parse.
 */
export function staleIpcReads(ts, root, pages) {
  // ⚑ The page's own declaration of the bridge, as a ROOT file of the program, so its global
  // augmentation types `window.api` exactly as the renderer compiles it. ⛔ The census adds only an
  // index signature — a page's own globals (`window.__paste254`) are the page's business.
  const rendererWindow = join(root, 'apps/desktop/src/renderer/src/env.d.ts')
  const header =
    'declare global {\n' +
    '  interface Window {\n' +
    '    [name: string]: any\n' +
    '  }\n' +
    '}\n' +
    `declare const ${INTERPOLATION}: any\n`
  let virtual = header
  const offsets = []
  pages.forEach((page, index) => {
    const prefix = `export async function page${index}() {\n`
    offsets.push({ index, at: virtual.length + prefix.length })
    virtual += `${prefix}${page.body}\n}\n`
  })
  const name = join(root, 'scripts/__page-ipc-census__.ts').replaceAll('\\', '/')
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    // `env.d.ts` references `vite/client`, resolved from the renderer's own package.
    typeRoots: [join(root, 'apps/desktop/node_modules/@types'), join(root, 'node_modules/@types')],
  }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, ...rest) =>
    file.replaceAll('\\', '/') === name
      ? ts.createSourceFile(file, virtual, language, true, ts.ScriptKind.TS)
      : read(file, language, ...rest)
  const program = ts.createProgram([name, rendererWindow], options, host)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(name)
  const pageAt = (position) => {
    let found = null
    for (const offset of offsets) if (offset.at <= position) found = offset
    return found
  }
  const nodeAt = (position) => {
    let found = null
    const walk = (node) => {
      if (position >= node.getStart() && position < node.getEnd()) {
        found = node
        ts.forEachChild(node, walk)
      }
    }
    walk(source)
    return found
  }
  const declaredByUs = (type) =>
    [type, ...(type.isUnionOrIntersection() ? type.types : [])].some((one) =>
      [one.getSymbol(), one.aliasSymbol].some((symbol) =>
        (symbol?.declarations ?? []).some((declaration) => {
          const file = declaration.getSourceFile().fileName
          return file !== name && !THE_LANGUAGE.test(file)
        }),
      ),
    )
  const anArmHas = (type, property) =>
    (type.isUnion() ? type.types : [type]).some((one) => checker.getPropertyOfType(one, property))

  const findings = []
  const report = (diagnostic, read, type) => {
    const offset = pageAt(diagnostic.start)
    const page = pages[offset.index]
    const lineInPage = virtual.slice(offset.at, diagnostic.start).split('\n').length - 1
    findings.push({
      file: page.file,
      line: page.line + lineInPage,
      read,
      type: checker.typeToString(type),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    })
  }
  for (const diagnostic of program.getSemanticDiagnostics(source)) {
    const node = nodeAt(diagnostic.start)
    if (!node) continue
    // ⚑ **A read the type does not have** (2339, and 2551's *did you mean*) — off a property access
    // or out of a destructuring pattern.
    if ((diagnostic.code === 2339 || diagnostic.code === 2551) && ts.isIdentifier(node)) {
      let objectType = null
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
        objectType = checker.getTypeAtLocation(node.parent.expression)
      } else if (
        ts.isBindingElement(node.parent) &&
        ts.isObjectBindingPattern(node.parent.parent)
      ) {
        objectType = checker.getTypeAtLocation(node.parent.parent)
      }
      if (!objectType || !declaredByUs(objectType) || anArmHas(objectType, node.text)) continue
      report(
        diagnostic,
        ts.isPropertyAccessExpression(node.parent) ? node.parent.getText() : node.text,
        objectType,
      )
      continue
    }
    // ⚑ **A key or a value the bridge's INPUT does not take** (2353/2561 an unknown key, 2322 a value
    // outside the field's type) — an object literal the page hands the bridge. ⚠️ The wire schema
    // strips an unknown key silently, so a renamed input field launches on a default instead.
    if (
      (diagnostic.code === 2353 || diagnostic.code === 2561 || diagnostic.code === 2322) &&
      ts.isIdentifier(node) &&
      (ts.isPropertyAssignment(node.parent) || ts.isShorthandPropertyAssignment(node.parent)) &&
      node.parent.name === node &&
      ts.isObjectLiteralExpression(node.parent.parent)
    ) {
      const inputType = checker.getContextualType(node.parent.parent)
      if (!inputType || !declaredByUs(inputType)) continue
      report(diagnostic, node.parent.getText(), inputType)
      continue
    }
    // ⚑ **A comparison that can never be true** (2367) — a literal no longer in a field's union,
    // read off a value whose type the app declares (`ack.outcome === 'taken'`).
    if (diagnostic.code === 2367) {
      let comparison = node
      while (
        comparison &&
        !(ts.isBinaryExpression(comparison) && comparison.getStart() === diagnostic.start)
      ) {
        comparison = comparison.parent
      }
      if (!comparison) continue
      const side = [comparison.left, comparison.right].find(
        (one) =>
          ts.isPropertyAccessExpression(one) &&
          declaredByUs(checker.getTypeAtLocation(one.expression)),
      )
      if (!side) continue
      report(diagnostic, comparison.getText(), checker.getTypeAtLocation(side.expression))
    }
  }
  const syntactic = program.getSyntacticDiagnostics(source).map((diagnostic) => {
    const offset = pageAt(diagnostic.start)
    const page = offset ? pages[offset.index] : null
    return {
      file: page?.file ?? null,
      line: page?.line ?? null,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }
  })
  return { findings, syntactic }
}

/** ⚑ The whole census over files under `root`: pages, refused candidates, prose, findings. */
export function censusOf(root, files, extraPages = []) {
  const ts = typescriptAt(root)
  const pages = []
  const unparsed = []
  const prose = []
  for (const file of files) {
    const found = pageTemplatesIn(ts, file, readFileSync(join(root, file), 'utf8'))
    pages.push(...found.pages)
    unparsed.push(...found.unparsed)
    prose.push(...found.prose)
  }
  const all = [...pages, ...extraPages]
  return { pages: all, unparsed, prose, ...staleIpcReads(ts, root, all) }
}
