import { globSync } from 'node:fs'

/**
 * Read smoke deadline adoption and budgets from TypeScript source; `ci` does not run providers.
 * `adoptionOf` requires one top-level `probeRunDeadline`, every registered test wrapped in
 * `deadline.within` with its `testTimeoutMs`, and no extra hook or top-level await.
 * Top-level synchronous work such as spawning on import is outside this shape check.
 *
 * `budgetOf` evaluates declarations using the real helper. `waitsCountedWhereMade` recomputes
 * tabled waits at call sites, refusing unknown loop multiplicities, callbacks, timers,
 * unreferenced wait functions and shadowed bounds instead of counting them as zero.
 * The scan checks increasing capped counters without proving that they bound the loop;
 * provider calls without their own bounds are covered only by the outer run deadline.
 */

/** The helper's module, however an adopter reaches it. */
export const HELPER_MODULE = /(^|\/)probe-run-deadline(\.ts)?$/

/** Vitest's registrars: the two that register a test, and the six hooks that run beside one. */
const TEST_REGISTRARS = new Set(['it', 'test'])
const HOOK_REGISTRARS = new Set([
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'aroundAll',
  'aroundEach',
])

/**
 * Every file a smoke config runs, derived from its OWN `include` globs — so a new smoke directory
 * joins the census by being run, and a file the config stops running leaves it the same way.
 */
export function smokeFilesIn(root, include) {
  return [...new Set(include.flatMap((pattern) => globSync(pattern, { cwd: root })))].sort()
}

function parse(ts, source, file) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function visit(ts, node, each) {
  each(node)
  ts.forEachChild(node, (child) => visit(ts, child, each))
}

function lineOf(file, node) {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
}

/** `probeRunDeadline(…)` declarations at the top level, as `[name, call]`. */
function deadlinesIn(ts, file) {
  const found = []
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer
      if (
        ts.isIdentifier(declaration.name) &&
        call !== undefined &&
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'probeRunDeadline'
      ) {
        found.push([declaration.name.text, call])
      }
    }
  }
  return found
}

/**
 * ⛔ **The local names vitest's registrars were imported as** — `import { test as live }` makes
 * `live(…)` a test, and a census that knew only the word `it` would never see it. `namespaces` are
 * `import * as v from 'vitest'`, whose `v.it(…)` is one too.
 */
function registrarsIn(ts, file) {
  const tests = new Set()
  const hooks = new Map()
  const namespaces = new Set()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'vitest') continue
    const bindings = statement.importClause?.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (TEST_REGISTRARS.has(imported)) tests.add(element.name.text)
      if (HOOK_REGISTRARS.has(imported)) hooks.set(element.name.text, imported)
    }
  }
  return { tests, hooks, namespaces }
}

/** The registrar a call goes through, as `{ kind, spelled }`, or null for any other call. */
function registrarOf(ts, call, registrars) {
  let callee = call.expression
  // `it.skip(…)`, `it.each(rows)(…)`: walk down to what the chain is rooted at.
  let root = callee
  while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) root = root.expression
  const spelled = callee.getText()
  if (ts.isIdentifier(root)) {
    if (registrars.tests.has(root.text)) return { kind: 'test', spelled, bare: root === callee }
    if (registrars.hooks.has(root.text)) return { kind: 'hook', spelled, bare: root === callee }
    if (registrars.namespaces.has(root.text)) {
      // `v.it(…)` — the member right after the namespace is the registrar.
      while (ts.isPropertyAccessExpression(callee) && callee.expression !== root) {
        callee = callee.expression
      }
      const member = ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
      if (TEST_REGISTRARS.has(member)) return { kind: 'test', spelled, bare: false }
      if (HOOK_REGISTRARS.has(member)) return { kind: 'hook', spelled, bare: false }
    }
  }
  return null
}

function carriesTheDeadlinesTimeout(ts, call, deadline) {
  const timeout = call.arguments[2]
  return (
    timeout !== undefined &&
    ts.isPropertyAccessExpression(timeout) &&
    ts.isIdentifier(timeout.expression) &&
    timeout.expression.text === deadline &&
    timeout.name.text === 'testTimeoutMs'
  )
}

/**
 * ⛔ **Is this file on the helper, in the template's shape?** Returns `{ onHelper, why, deadline,
 * tests }`, where `why` names every way it is not — empty exactly when `onHelper` is true.
 */
export function adoptionOf(ts, source, name = 'smoke.ts') {
  const file = parse(ts, source, name)
  const why = []

  const imported = new Set()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!HELPER_MODULE.test(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imported.add(element.name.text)
    }
  }
  if (!imported.has('probeRunDeadline')) why.push('it does not import probeRunDeadline')

  const deadlines = deadlinesIn(ts, file)
  if (deadlines.length !== 1) {
    why.push(`it builds ${deadlines.length} top-level probeRunDeadline(…) deadlines, not one`)
  }
  const deadline = deadlines[0]?.[0] ?? null
  const registrars = registrarsIn(ts, file)

  let tests = 0
  visit(ts, file, (node) => {
    // ⛔ Work at the top level runs at import, outside every test and every deadline.
    if (
      (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) &&
      !hasFunctionAncestor(ts, node)
    ) {
      why.push(`line ${lineOf(file, node)}: a top-level await runs outside the deadline`)
    }
    if (!ts.isCallExpression(node)) return
    const registrar = registrarOf(ts, node, registrars)
    if (registrar === null) return
    const line = lineOf(file, node)
    if (registrar.kind === 'hook') {
      why.push(`line ${line}: ${registrar.spelled}(…) runs work outside the deadline`)
      return
    }
    tests += 1
    const [, body] = node.arguments
    const bodyIsWithin =
      body !== undefined &&
      ts.isArrowFunction(body) &&
      body.parameters.length === 0 &&
      ts.isCallExpression(body.body) &&
      ts.isPropertyAccessExpression(body.body.expression) &&
      ts.isIdentifier(body.body.expression.expression) &&
      body.body.expression.expression.text === deadline &&
      body.body.expression.name.text === 'within'
    if (
      !registrar.bare ||
      node.arguments.length !== 3 ||
      !bodyIsWithin ||
      !carriesTheDeadlinesTimeout(ts, node, deadline)
    ) {
      why.push(
        `line ${line}: ${registrar.spelled}(…) is not \`() => ${deadline ?? 'deadline'}.within(…)\` ` +
          `carrying \`${deadline ?? 'deadline'}.testTimeoutMs\``,
      )
    }
  })
  if (tests === 0) why.push('it registers no test')

  return { onHelper: why.length === 0, why, deadline, tests }
}

function hasFunctionAncestor(ts, node) {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) return true
  }
  return false
}

/** Every top-level variable and function declaration, by the name it binds. */
function topLevelDeclarations(ts, file) {
  const declared = new Map()
  const imported = new Map()
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declared.set(declaration.name.text, statement)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declared.set(statement.name.text, statement)
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.name !== undefined) imported.set(clause.name.text, statement)
      const bindings = clause?.namedBindings
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) imported.set(element.name.text, statement)
      } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imported.set(bindings.name.text, statement)
      }
    }
  }
  return { declared, imported }
}

/**
 * Evaluate `expressions` — source text — over the top-level declarations they reach, and nothing
 * else. ⛔ **A derivation that reaches an import is refused by name**, except the helper's own
 * `runBudgetMs`, which is passed in: a budget that depends on what a module DOES at run time is not
 * one this census can state, and saying so is the answer.
 */
function evaluateOver(ts, file, expressions, { runBudgetMs, env }) {
  const { declared, imported } = topLevelDeclarations(ts, file)
  const needed = new Set()
  const reach = (node) => {
    visit(ts, node, (inner) => {
      if (!ts.isIdentifier(inner)) return
      const name = inner.text
      if (declared.has(name) && !needed.has(declared.get(name))) {
        needed.add(declared.get(name))
        reach(declared.get(name))
      } else if (imported.has(name) && name !== 'runBudgetMs') {
        // ⚠️ A type-only use (`: SessionHandle`) is not a reach — only a value is.
        const parent = inner.parent
        if (ts.isTypeReferenceNode(parent) || ts.isImportSpecifier(parent)) return
        if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return
        throw new Error(`the budget derivation reaches \`${name}\`, which is imported`)
      }
    })
  }
  const probes = expressions.map((text) =>
    ts.createSourceFile('expression.ts', `(${text})`, ts.ScriptTarget.Latest, true),
  )
  for (const probe of probes) reach(probe)
  const statements = file.statements
    .filter((statement) => needed.has(statement))
    .map((statement) => statement.getText(file).replace(/^export\s+/, ''))
  const program = [
    ...statements,
    `return [${expressions.map((text) => `(${text})`).join(', ')}]`,
  ].join('\n')
  const { outputText } = ts.transpileModule(`function __derive() {\n${program}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  // ⚑ **A sandbox, and `globalThis` is inside it too**: `process` holds `env` and nothing else, so a
  // derivation that reads an environment override is evaluated at its DEFAULT — what an
  // unconfigured run would spend — and cannot reach the tester's own shell through the global object.
  const sandbox = { env }
  const globals = { process: sandbox }
  const run = new Function(
    'runBudgetMs',
    'process',
    'globalThis',
    'global',
    `${outputText}\nreturn __derive()`,
  )
  return run(runBudgetMs, sandbox, globals, globals)
}

/**
 * ⛔ **What this file's deadline IS**: `{ probe, budgetMs, teardownMs, testTimeoutMs }`, evaluated
 * from the arguments of its one `probeRunDeadline(…)` call and handed to the REAL helper — so every
 * figure is the helper's own answer, and a change to how it sizes `testTimeoutMs` reaches here.
 */
export function budgetOf(ts, source, helper, { name = 'smoke.ts', env = {} } = {}) {
  const file = parse(ts, source, name)
  const deadlines = deadlinesIn(ts, file)
  if (deadlines.length !== 1) {
    throw new Error(`${name} builds ${deadlines.length} top-level deadlines, not one`)
  }
  const [, call] = deadlines[0]
  if (call.arguments.length !== 3) {
    throw new Error(`${name}'s probeRunDeadline(…) takes ${call.arguments.length} arguments, not 3`)
  }
  const [probe, budgetMs, teardownMs] = evaluateOver(
    ts,
    file,
    call.arguments.map((argument) => argument.getText(file)),
    { runBudgetMs: helper.runBudgetMs, env },
  )
  const built = helper.probeRunDeadline(probe, budgetMs, teardownMs)
  return { probe, budgetMs: built.budgetMs, teardownMs, testTimeoutMs: built.testTimeoutMs }
}

/**
 * ⛔ **Which bound fires first for this file — its deadline, or vitest's** (`655` G2).
 *
 * ⚠️ **The config's `testTimeout` is not a ceiling on an adopter**: a timeout passed to `it()` replaces
 * it for that test. So the bound vitest applies is the helper's own `testTimeoutMs` when EVERY test
 * the file registers carries it, and the config's otherwise — and the deadline fires first only if
 * that bound lies past the deadline AND its teardown. ⚑ `fires: 'vitest'` is the G2 defect: a hang
 * reported as a bare vitest timeout that names no step and frees the awaiter, not the child.
 */
export function boundThatFiresFirst(ts, source, helper, configTimeoutMs, name = 'smoke.ts') {
  const file = parse(ts, source, name)
  const deadline = deadlinesIn(ts, file)[0]?.[0] ?? null
  const registrars = registrarsIn(ts, file)
  let every = true
  visit(ts, file, (node) => {
    if (!ts.isCallExpression(node)) return
    const registrar = registrarOf(ts, node, registrars)
    if (registrar === null) return
    if (registrar.kind === 'hook' || !carriesTheDeadlinesTimeout(ts, node, deadline)) every = false
  })
  const budget = budgetOf(ts, source, helper, { name })
  const vitestMs = every ? budget.testTimeoutMs : configTimeoutMs
  const deadlineMs = budget.budgetMs + budget.teardownMs
  return { fires: vitestMs > deadlineMs ? 'the deadline' : 'vitest', vitestMs, deadlineMs }
}

/** The value of one top-level expression — a constant, a table — over this file's declarations. */
export function valueIn(ts, source, expression, helper, { name = 'smoke.ts', env = {} } = {}) {
  const file = parse(ts, source, name)
  return evaluateOver(ts, file, [expression], { runBudgetMs: helper.runBudgetMs, env })[0]
}

/** The name a function-like node is known by — a declaration's, or the const it is assigned to. */
function nameOfFunction(ts, node) {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text
  }
  return null
}

/** Is this a loop that runs until something inside it BREAKS or THROWS — `for (;;)`, `while (true)`? */
function isForever(ts, node) {
  if (ts.isForStatement(node)) return node.condition === undefined
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return node.expression.kind === ts.SyntaxKind.TrueKeyword
  }
  return false
}

/** Every name a binding introduces — `x`, and each name inside `{ a, b: [c] }`. */
function bindingNames(ts, name) {
  if (ts.isIdentifier(name)) return [name.text]
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isOmittedExpression(element) ? [] : bindingNames(ts, element.name),
    )
  }
  return []
}

/**
 * ⛔ **A clocked poll, by the AST and not by its text** (the `669` review): a loop whose condition
 * compares `Date.now()` against a name DECLARED as `Date.now() + bound` — that `+ bound` is charged
 * where it is made, so the loop's own sleeps are its poll and cost nothing more. ⚠️ A `Date.now()` in
 * a comment, a log line or a `Date.now() - start < X` is not this shape, and its sleeps throw.
 */
function isClockedPoll(ts, loop, declared) {
  const condition = ts.isForStatement(loop) ? loop.condition : loop.expression
  if (condition === undefined || !ts.isBinaryExpression(condition)) return false
  const kinds = [
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
  ]
  if (!kinds.includes(condition.operatorToken.kind)) return false
  const sides = [condition.left, condition.right]
  const now = sides.find((side) => side.getText() === 'Date.now()')
  const other = sides.find((side) => side !== now)
  if (now === undefined || other === undefined || !ts.isIdentifier(other)) return false
  const initializer = declared.get(other.text)
  return (
    initializer !== undefined &&
    ts.isBinaryExpression(initializer) &&
    initializer.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    initializer.left.getText() === 'Date.now()'
  )
}

/**
 * `new Promise((r) => setTimeout(r, ms))` — a sleep, block-bodied or not. ⚠️ Any other `setTimeout`
 * is a sleep of a shape this cannot read, unless it is a RACE's timer — see {@link isARaceTimer}.
 */
function isASleep(ts, call) {
  const [resolveArgument] = call.arguments
  let executor = call.parent
  if (ts.isExpressionStatement(executor) && ts.isBlock(executor.parent)) {
    const block = executor.parent
    if (block.statements.length !== 1) return false
    executor = block.parent
  }
  return (
    resolveArgument !== undefined &&
    ts.isIdentifier(resolveArgument) &&
    ts.isArrowFunction(executor) &&
    executor.parameters.length >= 1 &&
    executor.parameters[0].name.getText() === resolveArgument.text &&
    ts.isNewExpression(executor.parent) &&
    executor.parent.expression.getText() === 'Promise'
  )
}

/**
 * The three functions whose timers bound a RACE this census charges BY NAME — `opened(…)` as a
 * session's `OPEN_MS + TEARDOWN_MS`, `acknowledged(…)` as `INTERRUPT_ACK_MS`, and `settledWithin`
 * as the teardown inside that session's `TEARDOWN_MS`.
 */
const RACE_OWNERS = new Set(['opened', 'acknowledged', 'settledWithin'])

/**
 * A timer that bounds a RACE — `opened`'s, `acknowledged`'s, a teardown's `settledWithin` — is the
 * bound on some other wait, charged where that wait is made. ⚑ Recognised by sitting inside an
 * element of `Promise.race([…])` IN one of {@link RACE_OWNERS}. ⛔ A raced timer anywhere else is
 * charged nothing by name, so it is read as the sleep it is, or refused (the `669` review's third
 * round: a `Promise.race` in a step added 300 s the table never saw).
 */
function isARaceTimer(ts, call) {
  let raced = false
  for (let at = call.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
    if (
      ts.isArrayLiteralExpression(at) &&
      ts.isCallExpression(at.parent) &&
      at.parent.expression.getText() === 'Promise.race'
    ) {
      raced = true
    }
    if (ts.isFunctionLike(at) && nameOfFunction(ts, at) !== null) {
      return raced && RACE_OWNERS.has(nameOfFunction(ts, at))
    }
  }
  return false
}

/**
 * ⛔ **A bound is read at the TOP LEVEL, so a local of the same name would be charged the top-level
 * value while the code waits on its own.** Every identifier in `expression` must resolve there —
 * through parameters, `const`/`let`/`var`, destructuring, loop and catch bindings — or this throws.
 */
function assertNotShadowed(ts, file, expression) {
  visit(ts, expression, (identifier) => {
    if (!ts.isIdentifier(identifier)) return
    if (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier) {
      return
    }
    const name = identifier.text
    const binds = (declarations) =>
      declarations.some((declaration) => bindingNames(ts, declaration.name).includes(name))
    for (
      let scope = identifier.parent;
      scope !== undefined && scope !== file;
      scope = scope.parent
    ) {
      const declares =
        (ts.isFunctionLike(scope) && binds(scope.parameters)) ||
        ((ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope)) &&
          scope.statements.some(
            (statement) =>
              (ts.isVariableStatement(statement) &&
                binds(statement.declarationList.declarations)) ||
              (ts.isFunctionDeclaration(statement) && statement.name?.text === name),
          )) ||
        ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
          scope.initializer !== undefined &&
          ts.isVariableDeclarationList(scope.initializer) &&
          binds(scope.initializer.declarations)) ||
        (ts.isCatchClause(scope) &&
          scope.variableDeclaration !== undefined &&
          bindingNames(ts, scope.variableDeclaration.name).includes(name))
      if (declares) {
        throw new Error(
          `line ${lineOf(file, identifier)}: the bound \`${name}\` is shadowed by a local, so the ` +
            'value this census charges is not the one the code waits on',
        )
      }
    }
  })
}

/** Array methods whose callback runs an unknown number of times. */
const ITERATING_METHODS = new Set([
  'map',
  'forEach',
  'flatMap',
  'filter',
  'reduce',
  'some',
  'every',
])

/**
 * 🔴 **A live smoke's worst case, counted where each wait is MADE** — the other half of a budget
 * written as a table, so the two can be compared and a wait added without its row fails.
 *
 * What it counts:
 *
 *  - every `waitFor(pred, bound, …)` — its `bound`;
 *  - every `opened(…)` — one session: `OPEN_MS + TEARDOWN_MS` — and every `acknowledged(…)` —
 *    `INTERRUPT_ACK_MS` — read from the file's own constants;
 *  - every `Date.now() + bound` — a clocked poll's deadline;
 *  - every sleep, `new Promise((r) => setTimeout(r, bound))` — its bound — unless it is inside the
 *    `waitFor` primitive (charged at each call) or a clocked poll ({@link isClockedPoll}), and even
 *    when it is raced against something else outside {@link RACE_OWNERS}.
 *
 * ⚑ **How MANY times, by the call graph** (the `669` review): a wait runs as often as the code
 * around it. Inside a forever-loop that stops itself at the cap it is `cap + 1` times — and one that
 * does not THROWS; inside a named function it is the SUM,
 * over every place that references that function, of how often THAT place runs — up the whole chain,
 * whichever function the caller is written in. ⛔ A wait inside any other loop, inside a callback
 * handed to an iterating array method, or inside a waiting function nothing references THROWS: none
 * has a count this can read, and 0 would be a wait charged nothing.
 */
export function waitsCountedWhereMade(ts, source, helper, { name = 'smoke.ts', capName }) {
  const file = parse(ts, source, name)
  const value = (text) =>
    evaluateOver(ts, file, [text], { runBudgetMs: helper.runBudgetMs, env: {} })[0]
  const cap = value(capName)
  const perCall = {
    opened: value('OPEN_MS') + value('TEARDOWN_MS'),
    acknowledged: source.includes('INTERRUPT_ACK_MS') ? value('INTERRUPT_ACK_MS') : null,
  }

  // ⛔ Timers from `node:timers` or `node:timers/promises` are a shape this does not read — an
  // aliased `setTimeout` is one it would never see.
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      /^(?:node:)?timers(?:\/promises)?$/.test(statement.moduleSpecifier.text)
    ) {
      throw new Error(
        `line ${lineOf(file, statement)}: \`${statement.moduleSpecifier.text}\` timers cannot be counted`,
      )
    }
  }

  const functions = new Map()
  const declared = new Map()
  visit(ts, file, (node) => {
    if (ts.isFunctionLike(node)) {
      const named = nameOfFunction(ts, node)
      if (named !== null) functions.set(named, node)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declared.set(node.name.text, node.initializer)
    }
  })
  const referencesTo = new Map()
  visit(ts, file, (node) => {
    if (!ts.isIdentifier(node) || !functions.has(node.text)) return
    const parent = node.parent
    const declaring =
      (ts.isFunctionDeclaration(parent) && parent.name === node) ||
      (ts.isVariableDeclaration(parent) && parent.name === node) ||
      ts.isTypeQueryNode(parent)
    if (declaring) return
    referencesTo.set(node.text, [...(referencesTo.get(node.text) ?? []), node])
  })

  const weights = new Map()
  const inProgress = new Set()
  /** How many times `fn`'s body runs. */
  const weightOfFunction = (fn, at) => {
    if (weights.has(fn)) return weights.get(fn)
    if (inProgress.has(fn))
      throw new Error(`line ${lineOf(file, at)}: a recursive wait cannot be counted`)
    inProgress.add(fn)
    let weight
    const named = nameOfFunction(ts, fn)
    if (named !== null) {
      const references = referencesTo.get(named) ?? []
      if (references.length === 0) {
        throw new Error(
          `line ${lineOf(file, at)}: \`${named}\` waits and nothing references it — uncountable`,
        )
      }
      weight = references.reduce((sum, reference) => sum + weightOfPlace(reference), 0)
    } else {
      const call = fn.parent
      if (
        ts.isCallExpression(call) &&
        call.arguments.includes(fn) &&
        ts.isPropertyAccessExpression(call.expression) &&
        ITERATING_METHODS.has(call.expression.name.text)
      ) {
        throw new Error(
          `line ${lineOf(file, at)}: a wait inside a \`.${call.expression.name.text}\` callback ` +
            'runs an unknown number of times — uncountable',
        )
      }
      // An anonymous function — a step's callback, an IIFE — runs once per time its place does.
      weight = weightOfPlace(fn)
    }
    inProgress.delete(fn)
    weights.set(fn, weight)
    return weight
  }
  /** How many times the code at `node` runs: its loops, then its function's weight. */
  const weightOfPlace = (node) => {
    let factor = 1
    for (let at = node.parent; at !== undefined; at = at.parent) {
      if (ts.isFunctionLike(at)) return factor * weightOfFunction(at, node)
      if (isForever(ts, at)) {
        // ⛔ `cap + 1` is a claim only a loop that stops itself at the cap makes true.
        if (!isCappedLoop(ts, file, at, capName)) {
          throw new Error(
            `line ${lineOf(file, node)}: a wait inside a forever-loop that does not stop itself at ` +
              `\`${capName}\` runs an unknown number of times — uncountable`,
          )
        }
        factor *= cap + 1
      } else if (ts.isIterationStatement(at, false)) {
        throw new Error(
          `line ${lineOf(file, node)}: a wait inside a loop that is neither an approval loop nor a ` +
            'clocked poll runs an unknown number of times — uncountable',
        )
      }
    }
    return factor
  }

  const counted = []
  visit(ts, file, (node) => {
    // ⛔ A timer reached any other way — `globalThis.setTimeout`, a `setInterval` — is refused
    // rather than charged nothing (the `669` review's third round).
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ['setTimeout', 'setInterval'].includes(node.expression.name.text)) ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'setInterval'))
    ) {
      throw new Error(
        `line ${lineOf(file, node)}: a timer reached through \`${node.expression.getText(file)}\` ` +
          '— this census reads a bare `setTimeout` and nothing else',
      )
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const called = node.expression.text
      const line = lineOf(file, node)
      if (called === 'waitFor') {
        const bound = node.arguments[1]
        if (bound === undefined) throw new Error(`line ${line}: waitFor(…) with no bound`)
        assertNotShadowed(ts, file, bound)
        counted.push({
          line,
          what: 'waitFor',
          ms: value(bound.getText(file)) * weightOfPlace(node),
        })
      } else if (called === 'opened') {
        counted.push({ line, what: 'opened', ms: perCall.opened * weightOfPlace(node) })
      } else if (called === 'acknowledged') {
        if (perCall.acknowledged === null) throw new Error(`line ${line}: no INTERRUPT_ACK_MS`)
        counted.push({ line, what: 'acknowledged', ms: perCall.acknowledged * weightOfPlace(node) })
      } else if (called === 'setTimeout') {
        if (isARaceTimer(ts, node)) return
        if (!isASleep(ts, node)) {
          throw new Error(
            `line ${line}: a timer this census cannot classify — neither a sleep nor a race`,
          )
        }
        let promise = node.parent
        while (!ts.isNewExpression(promise)) promise = promise.parent
        // ⚑ Inside the `waitFor` primitive: its bound is charged at each call.
        for (let at = promise.parent; at !== undefined; at = at.parent) {
          if (ts.isFunctionLike(at)) {
            if (nameOfFunction(ts, at) === 'waitFor') return
            break
          }
        }
        for (let at = promise.parent; at !== undefined; at = at.parent) {
          if (ts.isFunctionLike(at)) break
          if (ts.isIterationStatement(at, false) && isClockedPoll(ts, at, declared)) return
        }
        const pause = node.arguments[1]
        if (pause === undefined) throw new Error(`line ${line}: a sleep with no duration`)
        assertNotShadowed(ts, file, pause)
        counted.push({
          line,
          what: 'pause',
          ms: value(pause.getText(file)) * weightOfPlace(promise),
        })
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      node.left.getText(file) === 'Date.now()'
    ) {
      assertNotShadowed(ts, file, node.right)
      counted.push({
        line: lineOf(file, node),
        what: 'loop deadline',
        ms: value(node.right.getText(file)) * weightOfPlace(node),
      })
    }
  })
  return { total: counted.reduce((sum, one) => sum + one.ms, 0), counted }
}

/**
 * ⛔ **Every forever-loop that waits and does NOT stop itself at `capName`** — by line. The count
 * above charges such a loop `cap + 1` waits, and that charge is a claim this holds: an
 * `if (… capName …)` whose branch THROWS, over a counter the loop INCREASES. ⚠️ Both halves — a cap
 * compared against a counter nothing increments is an `if` that can never fire.
 */
export function uncappedForeverLoops(ts, source, { name = 'smoke.ts', capName }) {
  const file = parse(ts, source, name)
  const uncapped = []
  visit(ts, file, (node) => {
    if (!isForever(ts, node)) return
    // ⚠️ ANY `await` is a wait here — a helper that waits, a sleep, an `opened(…)` — not only a
    // direct `waitFor(…)`: the count charges every one of them `cap + 1` (the `669` review's third
    // round).
    let waits = false
    visit(ts, node.statement, (inner) => {
      if (ts.isAwaitExpression(inner)) waits = true
    })
    if (waits && !isCappedLoop(ts, file, node, capName)) uncapped.push(lineOf(file, node))
  })
  return uncapped
}

/**
 * Does this forever-loop stop itself at `capName` — an `if (… capName …)` whose branch THROWS, over
 * a counter the loop INCREASES?
 */
function isCappedLoop(ts, file, loop, capName) {
  const capWord = new RegExp(`\\b${capName}\\b`)
  const counters = new Set()
  const increased = new Set()
  visit(ts, loop.statement, (inner) => {
    if (ts.isIfStatement(inner) && capWord.test(inner.expression.getText(file))) {
      let throws = false
      visit(ts, inner.thenStatement, (branch) => {
        if (ts.isThrowStatement(branch)) throws = true
      })
      if (throws) {
        visit(ts, inner.expression, (word) => {
          if (ts.isIdentifier(word) && word.text !== capName) counters.add(word.text)
        })
      }
    }
    if (
      (ts.isPostfixUnaryExpression(inner) || ts.isPrefixUnaryExpression(inner)) &&
      inner.operator === ts.SyntaxKind.PlusPlusToken &&
      ts.isIdentifier(inner.operand)
    ) {
      increased.add(inner.operand.text)
    }
    if (
      ts.isBinaryExpression(inner) &&
      inner.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(inner.left)
    ) {
      increased.add(inner.left.text)
    }
  })
  return [...counters].some((counter) => increased.has(counter))
}

/**
 * ⛔ **Every session a live smoke opens BARE** — a runtime's `.start(…)` or `.resume(…)` that is not
 * the launch handed to `opened(…)`, or that is and does not pass it the launch's `signal` — so it is
 * waited on with no bound, or aborted by nothing. By line.
 */
export function bareOpens(ts, source, name = 'smoke.ts') {
  const file = parse(ts, source, name)
  const bare = []
  visit(ts, file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    if (!['start', 'resume'].includes(node.expression.name.text)) return
    if (!/untime/.test(node.expression.expression.getText(file))) return
    // ⚑ The launch is the function handed to `opened(…)`, and its first parameter is the signal.
    let launch = null
    for (let at = node.parent; at !== undefined; at = at.parent) {
      if (
        ts.isCallExpression(at) &&
        ts.isIdentifier(at.expression) &&
        at.expression.text === 'opened'
      ) {
        break
      }
      if (
        (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
        ts.isCallExpression(at.parent) &&
        ts.isIdentifier(at.parent.expression) &&
        at.parent.expression.text === 'opened'
      ) {
        launch = at
      }
    }
    const insideOpened = launch !== null
    const parameter = launch?.parameters[0]?.name
    const signal = parameter !== undefined && ts.isIdentifier(parameter) ? parameter.text : null
    // ⛔ FORWARDED, not merely spelled: `{ signal }` or `{ signal: <the parameter> }` — a key named
    // `signal` holding anything else is an abort nothing reaches (the `669` review's third round).
    let passesSignal = false
    for (const argument of node.arguments) {
      if (signal !== null && ts.isIdentifier(argument) && argument.text === signal) {
        passesSignal = true
      }
      visit(ts, argument, (inner) => {
        if (
          signal !== null &&
          ((ts.isShorthandPropertyAssignment(inner) &&
            inner.name.text === 'signal' &&
            signal === 'signal') ||
            (ts.isPropertyAssignment(inner) &&
              inner.name.getText(file) === 'signal' &&
              ts.isIdentifier(inner.initializer) &&
              inner.initializer.text === signal))
        ) {
          passesSignal = true
        }
      })
    }
    if (!insideOpened || !passesSignal) bare.push(lineOf(file, node))
  })
  return bare
}

/** The function-like body an `opened(…)` call sits in. */
function bodyAround(ts, node) {
  let body = node.parent
  while (!ts.isFunctionLike(body)) body = body.parent
  return body
}

/**
 * The block an `opened(…)` call's SECTION is: the nearest enclosing block that is not a `try`'s own —
 * a step's body, a section's `{ … }`, an `else`.
 */
function sectionAround(ts, node) {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) return at
    if (!ts.isBlock(at)) continue
    if (ts.isTryStatement(at.parent) && at.parent.tryBlock === at) continue
    return at
  }
  return node.getSourceFile()
}

/**
 * ⛔ **Every session opened without a refusal right before it** — by line. ⚑ "Right before" means
 * since the previous session event in the same function — its start, another `opened(…)`, a
 * `.send(…)`, a `waitFor(…)` or a `closeOpen()` — so a function that opens a SECOND session (a resume
 * after a plant) owes it a refusal of its own, not the first one's (the `669` review). ⚠️ And INSIDE
 * its own section ({@link sectionAround}): a previous section's verdict refusal cannot stand in for
 * this one's, since the synchronous work between them spends the clock too (the third round).
 */
export function unguardedOpens(ts, source, name = 'smoke.ts') {
  const file = parse(ts, source, name)
  const missing = []
  visit(ts, file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    if (node.expression.text !== 'opened') return
    const body = bodyAround(ts, node)
    const at = node.getStart(file)
    let since = sectionAround(ts, node).getStart(file)
    const refusals = []
    visit(ts, body, (inner) => {
      if (!ts.isCallExpression(inner) || inner.getStart(file) >= at) return
      const text = inner.expression.getText(file)
      // ⚑ Time passes at every one of these, so a refusal before one is stale after it.
      const isEvent =
        (ts.isIdentifier(inner.expression) &&
          ['opened', 'waitFor'].includes(inner.expression.text)) ||
        (ts.isPropertyAccessExpression(inner.expression) &&
          ['closeOpen', 'send'].includes(inner.expression.name.text))
      if (isEvent && inner.getEnd() <= at) since = Math.max(since, inner.getEnd())
      if (text === 'deadline.refuse') refusals.push(inner.getStart(file))
    })
    if (!refusals.some((refusal) => refusal > since)) missing.push(lineOf(file, node))
  })
  return missing
}

/**
 * ⛔ **Every session opened and then USED without refusing past the deadline in between** — by line.
 * The template refuses at start and again after each bind; for a live smoke the bind is the session
 * opening, and one that resolves after the run has expired must not be sent a prompt. ⚑ "Used" is a
 * `.send(…)`, a `waitFor(…)`, or a call to a PARAMETER of the enclosing function — the shape of
 * `step(line, fn)`, where the session is handed to `fn` and prompted there (the `669` review).
 */
export function unrefusedOpens(ts, source, name = 'smoke.ts') {
  const file = parse(ts, source, name)
  const missing = []
  // ⚑ A helper that prompts — one whose own body sends or waits (`driveTurn`, `runWrite`) — uses the
  // session it is HANDED, so a call passing the handle to one is a use too (the third round).
  const prompting = new Set()
  visit(ts, file, (node) => {
    if (!ts.isFunctionLike(node) || nameOfFunction(ts, node) === null || node.body === undefined) {
      return
    }
    visit(ts, node.body, (inner) => {
      if (!ts.isCallExpression(inner)) return
      const callee = inner.expression
      if (
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'send') ||
        (ts.isIdentifier(callee) && callee.text === 'waitFor')
      ) {
        prompting.add(nameOfFunction(ts, node))
      }
    })
  })
  visit(ts, file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    if (node.expression.text !== 'opened') return
    const body = bodyAround(ts, node)
    const parameters = new Set(
      body.parameters.flatMap((parameter) => bindingNames(ts, parameter.name)),
    )
    const bound = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent
    const handle =
      ts.isVariableDeclaration(bound) && ts.isIdentifier(bound.name)
        ? bound.name.text
        : ts.isBinaryExpression(bound) &&
            bound.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(bound.left)
          ? bound.left.text
          : null
    const after = node.getEnd()
    let firstUse = null
    const refusals = []
    visit(ts, body, (inner) => {
      if (!ts.isCallExpression(inner) || inner.getStart(file) < after) return
      if (bodyAround(ts, inner) !== body) return
      const callee = inner.expression
      if (callee.getText(file) === 'deadline.refuse') refusals.push(inner.getStart(file))
      const handedToAPrompter =
        handle !== null &&
        ts.isIdentifier(callee) &&
        prompting.has(callee.text) &&
        inner.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === handle)
      const used =
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'send') ||
        (ts.isIdentifier(callee) && (callee.text === 'waitFor' || parameters.has(callee.text))) ||
        handedToAPrompter
      if (used && (firstUse === null || inner.getStart(file) < firstUse))
        firstUse = inner.getStart(file)
    })
    if (firstUse === null) return
    if (!refusals.some((refusal) => refusal < firstUse)) missing.push(lineOf(file, node))
  })
  return missing
}
