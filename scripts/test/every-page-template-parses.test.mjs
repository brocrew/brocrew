import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { INTERPOLATION, typescriptAt } from '../lib/page-ipc-census.mjs'

/**
 * 🔴 **722 · every page a smoke sends parses — wrapped the way its executor runs it.**
 *
 * ⛔ **Step `78` was red in every full batch from `587` to `717`, and no response attributed it.**
 * Its READ template had `const collapsed = …` pasted INSIDE its `return { … }`, so the page threw
 * `SyntaxError: Unexpected identifier 'collapsed'` before one claim ran — in `680`, `695`, `697`,
 * `704` and `717`, each time a red that read like somebody else's product. ⚠️ **Page code is a
 * STRING to Node**: `node --check` parses the template and never what is in it, and `665`'s census
 * (`lib/page-ipc-census.mjs`) reads only the pages that name `window.api`. READ names none of it.
 *
 * ⚑ **So this parses every page, found from the CALL rather than from its text:**
 *
 *  1. **The channels** — every `Runtime.evaluate` a script sends (`expression`) and every
 *     `Page.addScriptToEvaluateOnNewDocument` (`source`), spelt `send('Runtime.evaluate', { … })` or
 *     `{ method: 'Runtime.evaluate', params: { … } }`.
 *  2. **The executors, DERIVED, never listed** — a function whose parameter reaches a channel, and
 *     the WRAPPER its template puts around that parameter: `(async () => { ${expression} })()` runs
 *     a body in an async function, `(() => { … })()` a plain one — seven scripts, where `await` is
 *     a SyntaxError (`055`, `427`) — and a bare parameter is a script. A function that hands its own
 *     parameter to an executor is one too (`evaluate` → `#evaluateRaw`). ⛔ **Compiled inside the
 *     executor's OWN template text**, its other holes cooked as below — never a padded stand-in:
 *     every real executor puts the page inline on one line, so a page whose last line ends in a `//`
 *     comment eats the wrapper's `})()` there (the `722` review).
 *  3. **The pages** — every argument an executor is handed, followed to its text: a literal, a
 *     `const` (`READ`), what a local or imported function returns (`CLICK('x')`,
 *     `ACTIVE_TAB_EXPRESSION`), both arms of a `?:`, and a parameter — to its callers, or through the
 *     function an anonymous callback is handed to (`assertTabFlow`'s `readActiveTab`).
 *
 * ⚑ **Each `${…}` is cooked the way the page receives it.** A hole Node fills from FIXED text — a
 * `const`, `paperFields('pane')` — is inlined, because that text is code the page parses: a stand-in
 * there sits in an object literal and reads as a false red. Any other hole — a value only the run
 * knows, `${JSON.stringify(id)}`, `${cy}` — becomes one identifier ({@link INTERPOLATION}), which
 * parses wherever a value can stand: inside a string, inside a regex, as an expression, as a key.
 *
 * ⛔ **Parsed by V8, not by TypeScript.** `vm.Script` compiles and runs nothing, and it is the engine
 * the page runs: an early error inside a lazily compiled function — `await` in a plain arrow, a regex
 * holding a raw newline (`093`'s step 46) — is still a SyntaxError here. TypeScript only FINDS pages.
 *
 * 🔴 **It cannot go quiet** (rule 27): an executor argument it cannot follow to text is `unresolved`
 * and fails, and every script that sends a channel must yield pages — through its executors' CALLS
 * when it has executors, never counting the executor's own template (the `722` review: that page
 * alone made a file whose every call was missed read as covered).
 *
 * ⚠️ **What it does not see:** a page a helper puts into its OWN template before handing it to an
 * executor (`readJson(body)` → `this.evaluate(`…${body}…`)`) — that hole is cooked as a value and
 * the helper's callers are not read; every parameter hole in a page template today is a value (the
 * `722` review, round 2); a page built inside ANOTHER program's text (`nav-order-probe`'s
 * `String.raw` main process calls `executeJavaScript` from inside a string); an executor defined in
 * one file and called in another (none today: each script owns its CDP class); every value a hole
 * can take — one stand-in per hole, the first fixed text or the identifier; and whether a page does
 * what its step claims. It proves a page can RUN, which is what step 78 could not.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ts = typescriptAt(root)

/** ⚑ The CDP methods that carry page code, and the field each carries it in. */
const CHANNELS = new Map([
  ['Runtime.evaluate', 'expression'],
  ['Page.addScriptToEvaluateOnNewDocument', 'source'],
])

/** ⚑ What an executor's template puts in front of its parameter — the page's wrapper. */
const WRAPPERS = [
  ['async', /\(async \(\) => \{\s*$/],
  ['plain', /\(\(\) => \{\s*$/],
]

/** ⚑ The shapes a wrapper is CLASSIFIED as — the page is still compiled inside its own template's text. */
const KNOWN_WRAPPERS = ['async', 'plain', 'script']

/**
 * ⚑ **Every page `files` send, every executor that sends one, and every argument it could not
 * follow.** `readText` is the seam the planted control goes through; the real census reads the tree.
 */
function pageCensus(files, readText = (file) => readFileSync(join(root, file), 'utf8')) {
  const sources = new Map()
  const load = (file) => {
    if (!sources.has(file)) {
      sources.set(
        file,
        ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
      )
    }
    return sources.get(file)
  }
  const lineOf = (node) => {
    const source = node.getSourceFile()
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  }
  const unwrap = (node) => {
    let at = node
    while (ts.isParenthesizedExpression(at) || ts.isAwaitExpression(at)) at = at.expression
    return at
  }
  const calleeName = (call) =>
    ts.isIdentifier(call.expression)
      ? call.expression.text
      : ts.isPropertyAccessExpression(call.expression)
        ? call.expression.name.text
        : null

  const calls = new Map()
  /** Every call in `source` to a function or a method called `name` — indexed once per file. */
  const callsNamed = (source, name) => {
    if (!calls.has(source)) {
      const index = new Map()
      const visit = (node) => {
        const called = ts.isCallExpression(node) ? calleeName(node) : null
        if (called !== null) {
          if (!index.has(called)) index.set(called, [])
          index.get(called).push(node)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      calls.set(source, index)
    }
    return calls.get(source).get(name) ?? []
  }

  /** `name` among `statements`: a `const`/`let`, a function, or a relative import, followed. */
  const declaredAmong = (statements, name, from) => {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        const one = statement.declarationList.declarations.find(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
        )
        if (one) return { kind: 'variable', node: one }
      } else if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return { kind: 'function', node: statement }
      } else if (
        ts.isImportDeclaration(statement) &&
        statement.moduleSpecifier.text.startsWith('.') &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        const one = statement.importClause.namedBindings.elements.find(
          (element) => element.name.text === name,
        )
        if (one) {
          const module = load(
            posix.join(posix.dirname(from.fileName), statement.moduleSpecifier.text),
          )
          return declaredAmong(module.statements, (one.propertyName ?? one.name).text, module)
        }
      }
    }
    return null
  }
  /** What `name` means where `at` reads it — the nearest parameter or declaration, walking out. */
  const declarationOf = (name, at) => {
    for (let node = at.parent; node; node = node.parent) {
      if (ts.isFunctionLike(node)) {
        const index = node.parameters.findIndex(
          (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
        )
        if (index >= 0) return { kind: 'parameter', fn: node, index }
      }
      if (node.statements) {
        const found = declaredAmong(node.statements, name, at.getSourceFile())
        if (found) return found
      }
    }
    return null
  }
  const functionOf = (found) => {
    if (found?.kind === 'function') return found.node
    const value = found?.kind === 'variable' ? found.node.initializer : undefined
    return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : null
  }
  /** A `const`'s value — never a `let`'s, which a later assignment can change. */
  const constantOf = (found) =>
    found?.kind === 'variable' && found.node.parent.flags & ts.NodeFlags.Const
      ? (found.node.initializer ?? null)
      : null
  const nameOf = (fn) =>
    fn.name && (ts.isIdentifier(fn.name) || ts.isPrivateIdentifier(fn.name))
      ? fn.name.text
      : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
        ? fn.parent.name.text
        : null
  /** What `fn` returns: its expression body, or every `return` outside a nested function. */
  const returnsOf = (fn) => {
    if (!fn.body) return []
    if (!ts.isBlock(fn.body)) return [fn.body]
    const found = []
    const visit = (node) => {
      if (ts.isFunctionLike(node)) return
      if (ts.isReturnStatement(node) && node.expression) found.push(node.expression)
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(fn.body, visit)
    return found
  }

  /**
   * ⚑ **The text a Node-side expression is FIXED to**, or `null` when only the run knows it. Follows
   * literals, `const`s, what a local or imported function returns, `?:` and `+` — never a parameter:
   * a parameter's text is its caller's, and {@link pagesFrom} goes to the caller for it.
   */
  const textsOf = (node, seen = new Set()) => {
    const at = unwrap(node)
    if (seen.has(at)) return null
    const next = new Set(seen).add(at)
    if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at)) return [at.text]
    if (ts.isTemplateExpression(at)) {
      return [
        at.templateSpans.reduce(
          (text, span) =>
            text + (textsOf(span.expression, next)?.[0] ?? INTERPOLATION) + span.literal.text,
          at.head.text,
        ),
      ]
    }
    if (ts.isConditionalExpression(at)) {
      const arms = [textsOf(at.whenTrue, next), textsOf(at.whenFalse, next)]
      return arms.every(Boolean) ? arms.flat() : null
    }
    if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const [left, right] = [textsOf(at.left, next), textsOf(at.right, next)]
      if (!left && !right) return null
      return (left ?? [INTERPOLATION]).flatMap((one) =>
        (right ?? [INTERPOLATION]).map((other) => one + other),
      )
    }
    if (ts.isIdentifier(at)) {
      const value = constantOf(declarationOf(at.text, at))
      return value ? textsOf(value, next) : null
    }
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression)) {
      const fn = functionOf(declarationOf(at.expression.text, at.expression))
      const each = fn ? returnsOf(fn).map((one) => textsOf(one, next)) : []
      return each.length > 0 && each.every(Boolean) ? each.flat() : null
    }
    return null
  }

  /** Every value a script hands a channel ({@link CHANNELS}), in either spelling. */
  const channelsIn = (source) => {
    const found = []
    const field = (object, name) =>
      object && ts.isObjectLiteralExpression(object)
        ? object.properties.find(
            (one) => one.name && ts.isIdentifier(one.name) && one.name.text === name,
          )
        : undefined
    const visit = (node) => {
      if (ts.isStringLiteral(node) && CHANNELS.has(node.text)) {
        const owner = node.parent
        const params =
          ts.isCallExpression(owner) && owner.arguments[0] === node
            ? owner.arguments[1]
            : ts.isPropertyAssignment(owner) && owner.initializer === node
              ? field(owner.parent, 'params')?.initializer
              : undefined
        const carried = field(params, CHANNELS.get(node.text))
        if (carried) {
          found.push(ts.isShorthandPropertyAssignment(carried) ? carried.name : carried.initializer)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  const executors = new Map()
  /**
   * ⚑ **One script's executors, DERIVED from its own channels** — name → `{ wrapper, index }`. The
   * wrapper is read off the template around the parameter, directly or through the function the
   * channel calls with it (`withPageDeadline(expression)`); ⚠️ a template around a parameter that
   * matches no known shape is `unknown`, which the census refuses rather than guesses.
   */
  const executorsOf = (source) => {
    if (executors.has(source)) return executors.get(source)
    const found = new Map()
    executors.set(source, found)
    /**
     * The shape around `name`'s hole, and the template's whole text around it — every other hole
     * cooked as {@link textsOf} cooks one — which is what the page is compiled inside.
     */
    const wrapperAround = (template, name) => {
      const cook = (span) => textsOf(span.expression)?.[0] ?? INTERPOLATION
      let before = template.head.text
      let prefix = template.head.text
      for (const [at, span] of template.templateSpans.entries()) {
        if (ts.isIdentifier(span.expression) && span.expression.text === name) {
          const suffix = template.templateSpans
            .slice(at + 1)
            .reduce((text, later) => text + cook(later) + later.literal.text, span.literal.text)
          return {
            wrapper: WRAPPERS.find(([, shape]) => shape.test(before))?.[0] ?? 'unknown',
            outer: [prefix, suffix],
          }
        }
        before = span.literal.text
        prefix += cook(span) + span.literal.text
      }
      return null
    }
    const mark = (argument, around) => {
      const parameter = declarationOf(argument.text, argument)
      const name = parameter?.kind === 'parameter' ? nameOf(parameter.fn) : null
      if (name !== null && around) found.set(name, { ...around, index: parameter.index })
    }
    for (const carried of channelsIn(source)) {
      const value = unwrap(carried)
      if (ts.isIdentifier(value)) mark(value, { wrapper: 'script', outer: ['', ''] })
      else if (ts.isTemplateExpression(value)) {
        for (const { expression } of value.templateSpans) {
          if (ts.isIdentifier(expression)) mark(expression, wrapperAround(value, expression.text))
        }
      } else if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
        const fn = functionOf(declarationOf(value.expression.text, value.expression))
        value.arguments.forEach((argument, index) => {
          const own = fn?.parameters[index]
          if (!ts.isIdentifier(argument) || !own || !ts.isIdentifier(own.name)) return
          const around = returnsOf(fn)
            .filter((one) => ts.isTemplateExpression(one))
            .map((one) => wrapperAround(one, own.name.text))
            .find(Boolean)
          mark(argument, around)
        })
      }
    }
    // ⚑ A function that hands its OWN parameter to an executor is one, with the same wrapper.
    for (let grew = true; grew;) {
      grew = false
      for (const [name, { wrapper, outer, index }] of [...found]) {
        for (const call of callsNamed(source, name)) {
          const handed = call.arguments[index] ? unwrap(call.arguments[index]) : null
          const parameter =
            handed && ts.isIdentifier(handed) ? declarationOf(handed.text, handed) : null
          const forwarder = parameter?.kind === 'parameter' ? nameOf(parameter.fn) : null
          if (forwarder === null || found.has(forwarder)) continue
          found.set(forwarder, { wrapper, outer, index: parameter.index })
          grew = true
        }
      }
    }
    return found
  }

  const unresolved = []
  const refuse = (node, why) =>
    unresolved.push({ file: node.getSourceFile().fileName, line: lineOf(node), why })

  /**
   * Every parameter a channel carries AS ITS PAGE, as `{ fn, at }` — the channel's whole value, or a
   * hole (a template's, or a `+` operand) whose text before it is a wrapper shape ({@link WRAPPERS}),
   * followed through `?:` and a `const`. ⚠️ A hole anywhere else is a VALUE (`String(accept)` in
   * `drop-hazard-probe.mjs`), cooked as one stand-in like every other.
   */
  const parametersIn = (node, seen = new Set()) => {
    const at = unwrap(node)
    if (seen.has(at)) return []
    const next = new Set(seen).add(at)
    const wrapped = (before) => WRAPPERS.some(([, shape]) => shape.test(before))
    const asPage = (one) => parametersIn(one, next)
    if (ts.isIdentifier(at)) {
      const found = declarationOf(at.text, at)
      if (found?.kind === 'parameter') return [{ fn: found.fn, at }]
      const value = constantOf(found)
      return value ? parametersIn(value, next) : []
    }
    if (ts.isConditionalExpression(at)) return [...asPage(at.whenTrue), ...asPage(at.whenFalse)]
    if (ts.isTemplateExpression(at)) {
      let before = at.head.text
      const found = []
      for (const span of at.templateSpans) {
        if (wrapped(before)) found.push(...asPage(span.expression))
        before = span.literal.text
      }
      return found
    }
    if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const operands = []
      const flatten = (one) => {
        const inner = unwrap(one)
        if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          flatten(inner.left)
          flatten(inner.right)
        } else operands.push(inner)
      }
      flatten(at)
      return operands.flatMap((one, index) =>
        index > 0 && wrapped(textsOf(operands[index - 1])?.[0] ?? '') ? asPage(one) : [],
      )
    }
    return []
  }

  /** Every page an executor's argument can carry, as `{ node, text }`. */
  const pagesFrom = (node, seen = new Set()) => {
    const at = unwrap(node)
    if (seen.has(at)) return []
    const next = new Set(seen).add(at)
    if (ts.isConditionalExpression(at)) {
      return [...pagesFrom(at.whenTrue, next), ...pagesFrom(at.whenFalse, next)]
    }
    if (ts.isIdentifier(at)) {
      const found = declarationOf(at.text, at)
      if (found?.kind === 'parameter') return pagesThrough(found, at, next)
      const value = constantOf(found)
      if (value) return pagesFrom(value, next)
    }
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression)) {
      const fn = functionOf(declarationOf(at.expression.text, at.expression))
      const returned = fn ? returnsOf(fn) : []
      if (returned.length > 0) return returned.flatMap((one) => pagesFrom(one, next))
    }
    const texts = textsOf(at)
    if (texts) return texts.map((text) => ({ node: at, text }))
    refuse(at, `cannot follow \`${at.getText().slice(0, 60)}\` to the text it sends`)
    return []
  }

  /**
   * ⚑ **A parameter's pages are what its callers hand it** — and none when it is an executor's OWN
   * parameter, because that executor's callers are each read as an executor call, where it is made.
   */
  const pagesThrough = ({ fn, index }, at, seen) => {
    const name = nameOf(fn)
    if (name !== null && executorsOf(fn.getSourceFile()).has(name)) return []
    let sites = []
    if (name !== null) sites = callsNamed(fn.getSourceFile(), name)
    else if (ts.isCallExpression(fn.parent) && ts.isIdentifier(fn.parent.expression)) {
      // ⚑ An anonymous callback handed to `g`: its pages are what `g` calls it with.
      const g = functionOf(declarationOf(fn.parent.expression.text, fn.parent.expression))
      const parameter = g?.parameters[fn.parent.arguments.indexOf(fn)]
      if (parameter && ts.isIdentifier(parameter.name)) {
        sites = callsNamed(g.getSourceFile(), parameter.name.text).filter(
          (call) => call.pos >= g.pos && call.end <= g.end,
        )
      }
    }
    const handed = sites
      .map((call) => call.arguments[index] ?? fn.parameters[index].initializer)
      .filter(Boolean)
    if (handed.length === 0) {
      refuse(at, `\`${at.text}\` is a parameter nothing hands text to`)
      return []
    }
    return handed.flatMap((one) => pagesFrom(one, seen))
  }

  const pages = new Map()
  const yielded = new Map()
  const sending = []
  const quiet = []
  for (const file of files) {
    const source = load(file)
    const channels = channelsIn(source)
    if (channels.length === 0) continue
    sending.push(file)
    const add = (found, wrapper, outer) => {
      for (const { node, text } of found) {
        const from = node.getSourceFile().fileName
        const key = `${from}:${node.pos}:${outer.join('\u0000')}:${text}`
        if (!pages.has(key)) {
          pages.set(key, { file: from, line: lineOf(node), wrapper, outer, text })
        }
      }
      return found.length
    }
    let throughCalls = 0
    const own = executorsOf(source)
    for (const [name, { wrapper, outer, index }] of own) {
      for (const call of callsNamed(source, name)) {
        if (call.arguments[index])
          throughCalls += add(pagesFrom(call.arguments[index]), wrapper, outer)
      }
    }
    let direct = 0
    for (const carried of channels) {
      // ⛔ **A channel a PARAMETER carries, where no derived executor owns it** (the `722` review,
      // round 2): its pages are its callers', and the census did not derive whose — a `const` that
      // wraps the parameter, a class-field arrow, a `+`. Refused, never counted as its own template.
      for (const { fn, at } of parametersIn(carried)) {
        const name = nameOf(fn)
        if (name === null || !own.has(name)) {
          refuse(
            at,
            `the page is a parameter of ${name ?? 'an unnamed function'}, which no derived executor is — its callers are unread`,
          )
        }
      }
      direct += add(pagesFrom(carried), 'script', ['', ''])
    }
    // ⛔ A file with executors yields through their CALLS; the channel's own template is not one.
    yielded.set(file, own.size > 0 ? throughCalls : direct)
    if (yielded.get(file) === 0) quiet.push(file)
  }
  return {
    pages: [...pages.values()],
    unresolved,
    sending,
    yielded,
    quiet,
    executors: new Map(sending.map((file) => [file, executorsOf(load(file))])),
  }
}

/**
 * ⛔ **Every page that does not compile the way its wrapper runs it** — in V8's own words, at the
 * file and line of the page's own text (a hole Node filled with several lines can shift the lines
 * below it; none does today).
 */
function refusedByV8(pages) {
  const refused = []
  for (const page of pages) {
    const where = { file: page.file, line: page.line, wrapper: page.wrapper }
    if (!KNOWN_WRAPPERS.includes(page.wrapper)) {
      refused.push({ ...where, error: `run by an executor whose wrapper is ${page.wrapper}` })
      continue
    }
    const [before, after] = page.outer
    try {
      new Script(before + page.text + after, { filename: 'page' })
    } catch (error) {
      const at = Number(/^page:(\d+)/.exec(String(error.stack))?.[1] ?? 1)
      const inBody = Math.max(1, at - before.split('\n').length + 1)
      // ⚠️ An error V8 places in the executor's text AFTER the page is the page's last line — never a
      // line of whatever follows it in the file (the `722` review, round 2).
      const pageLines = page.text.split('\n').length
      refused.push({
        ...where,
        line: page.line + Math.min(inBody, pageLines) - 1,
        error:
          inBody > pageLines ? `${error} (in the executor’s text after the page)` : String(error),
      })
    }
  }
  return refused
}

// ⚑ DERIVED, never listed: every script, and the library beside them. A new smoke joins by existing.
const files = ['scripts', 'scripts/lib'].flatMap((directory) =>
  readdirSync(join(root, directory))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `${directory}/${name}`),
)

/**
 * 🔴 **The planted control (rule 12)** — one script with both wrappers, read through the same census:
 * three holes a value fills (in a string, in a regex, as an expression) and one Node fills with
 * CODE, all of which must parse; step 78's shape handed over by name and `055`'s `await` in a plain
 * arrow, both of which must be caught at their own lines; and one argument nothing can follow, which
 * must be refused rather than skipped.
 */
const PLANT = [
  'class Cdp {',
  '  async evaluate(expression) {',
  "    return this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()` })",
  '  }',
  '}',
  'function readPlain(expression) {',
  "  return send('Runtime.evaluate', { expression: `(() => { ${expression} })()` })",
  '}',
  'const fields = (el) => `first: ${el}.id, second: ${el}.title,`',
  "await cdp.evaluate(`return document.querySelector('[data-cy=${hook}]') !== null`)",
  'await cdp.evaluate(`return /^row-${prefix}-[0-9]+$/.test(document.title)`)',
  'await cdp.evaluate(`return document.title === ${JSON.stringify(want)}`)',
  'await cdp.evaluate(`',
  '  const el = document.body',
  '  return {',
  "    ${fields('el')}",
  '    third: 3,',
  '  }`)',
  'const READ = `',
  '  return {',
  '    rows: 1,',
  '  const collapsed = 2',
  '    collapsed,',
  '  }`',
  'await cdp.evaluate(READ)',
  'readPlain(`const info = await window.api.getAppInfo()`)',
  'readPlain(`return document.title`)',
  'await cdp.evaluate(`return document.title // the last line`)',
  'await cdp.evaluate(elsewhere.read())',
]

/**
 * 🔴 **A file whose every executor call the census misses** (the `722` review's plant): it sends a
 * channel through an executor, and calls that executor only in shapes the census does not follow.
 */
const QUIET = [
  'class Cdp {',
  '  async evaluate(expression) {',
  "    return this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()` })",
  '  }',
  '}',
  'const READ = `return { a: 1, const b = 2 }`',
  'cdp["evaluate"](READ)',
  'cdp.evaluate.call(cdp, READ)',
]
const plantLine = (text) => PLANT.indexOf(text) + 1

/**
 * ⛔ **Three channels a PARAMETER carries, and no executor derived for any of them** (the `722`
 * review, round 2's plants): a `const` that wraps it, a class-field arrow, a `+`. Each hands the
 * broken READ to its caller; each must be REFUSED, never counted as covered by its own template.
 */
const CARRIED = [
  'function viaConst(expression) {',
  '  const wrapped = `(async () => { ${expression} })()`',
  "  return send('Runtime.evaluate', { expression: wrapped })",
  '}',
  'class Cdp {',
  "  evaluate = async (expression) => this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()` })",
  '}',
  'function viaPlus(expression) {',
  "  return send('Runtime.evaluate', { expression: '(async () => {' + expression + '})()' })",
  '}',
  'const READ = `return { a: 1, const b = 2 }`',
  'viaConst(READ)',
  'cdp.evaluate(READ)',
  'viaPlus(READ)',
]

let census
let refused
beforeAll(() => {
  census = pageCensus(files)
  refused = refusedByV8(census.pages)
}, 180_000)

describe('722 · every page a smoke sends parses, wrapped the way its executor runs it', () => {
  it('🔴 the planted control: three broken pages at their own lines, four holes that parse, one refusal', () => {
    const plant = pageCensus(['planted.mjs'], () => PLANT.join('\n'))
    expect(
      [...plant.executors.get('planted.mjs')].map(([name, { wrapper, index }]) => [
        name,
        { wrapper, index },
      ]),
    ).toEqual([
      ['evaluate', { wrapper: 'async', index: 0 }],
      ['readPlain', { wrapper: 'plain', index: 0 }],
    ])
    expect(refusedByV8(plant.pages)).toEqual([
      {
        file: 'planted.mjs',
        line: plantLine('  const collapsed = 2'),
        wrapper: 'async',
        error: "SyntaxError: Unexpected identifier 'collapsed'",
      },
      // ⚑ Inside the executor's own one-line template, the comment eats its `})()`.
      {
        file: 'planted.mjs',
        line: plantLine('await cdp.evaluate(`return document.title // the last line`)'),
        wrapper: 'async',
        error: 'SyntaxError: Unexpected end of input',
      },
      {
        file: 'planted.mjs',
        line: plantLine('readPlain(`const info = await window.api.getAppInfo()`)'),
        wrapper: 'plain',
        error: expect.stringMatching(/^SyntaxError: await is only valid in async functions/),
      },
    ])
    // ⚑ The hole Node fills with code is INLINED — a stand-in there would be a false red.
    expect(plant.pages.map(({ text }) => text).join('\n')).toContain(
      `first: ${INTERPOLATION}.id, second: ${INTERPOLATION}.title,`,
    )
    expect(plant.unresolved).toEqual([
      {
        file: 'planted.mjs',
        line: plantLine('await cdp.evaluate(elsewhere.read())'),
        why: 'cannot follow `elsewhere.read()` to the text it sends',
      },
    ])
  })

  it('⚑ the wrappers are read off the scripts themselves, and every one is a shape it knows', () => {
    for (const smoke of [
      'scripts/ui-live-smoke.mjs',
      'scripts/resume-live-smoke.mjs',
      'scripts/packaged-smoke.mjs',
    ]) {
      expect(census.executors.get(smoke)?.get('evaluate')?.wrapper, smoke).toBe('async')
    }
    const wrappers = [...census.executors.values()].flatMap((one) =>
      [...one.values()].map(({ wrapper }) => wrapper),
    )
    expect(wrappers.filter((wrapper) => !KNOWN_WRAPPERS.includes(wrapper))).toEqual([])
    // ⚠️ The plain wrapper is the one `await` breaks, and real probes still run it.
    expect(wrappers).toContain('plain')
  })

  it('⛔ covers every script that sends page code, and cannot go quiet on an argument', () => {
    expect(census.sending).toEqual(
      expect.arrayContaining([
        'scripts/ui-live-smoke.mjs',
        'scripts/resume-live-smoke.mjs',
        'scripts/packaged-smoke.mjs',
      ]),
    )
    for (const file of census.sending) {
      expect(census.yielded.get(file), file).toBeGreaterThan(0)
    }
    expect(census.quiet).toEqual([])
    expect(census.unresolved).toEqual([])
  })

  it('🔴 …and a channel a parameter carries, with no executor derived for it, is REFUSED', () => {
    const plant = pageCensus(['carried.mjs'], () => CARRIED.join('\n'))
    expect(plant.executors.get('carried.mjs').size).toBe(0)
    expect(plant.unresolved).toEqual([
      {
        file: 'carried.mjs',
        line: 2,
        why: 'the page is a parameter of viaConst, which no derived executor is — its callers are unread',
      },
      {
        file: 'carried.mjs',
        line: 6,
        why: 'the page is a parameter of an unnamed function, which no derived executor is — its callers are unread',
      },
      {
        file: 'carried.mjs',
        line: 9,
        why: 'the page is a parameter of viaPlus, which no derived executor is — its callers are unread',
      },
    ])
  })

  it('🔴 …and a file whose executor calls it cannot follow is QUIET, not covered by its own template', () => {
    const plant = pageCensus(['quiet.mjs'], () => QUIET.join('\n'))
    expect([...plant.executors.get('quiet.mjs').keys()]).toEqual(['evaluate'])
    expect(plant.yielded.get('quiet.mjs')).toBe(0)
    expect(plant.quiet).toEqual(['quiet.mjs'])
  })

  it('🔴 no page a smoke sends is a SyntaxError where it runs', () => {
    expect(refused).toEqual([])
  })
})
