/**
 * Recompute each live-step unit's worst-case wait sum from its source, for comparison with
 * its outer budget. Follow lexical local helpers and class static methods. Charge `budget`,
 * unbudgeted `waitFor` bounds or defaults, sleeps, awaited race timers, synchronous child
 * timeouts, bound parameters at each call, and imported waits named in `charged`.
 *
 * Count every branch and multiply loops by their own literal counter bounds; `iterations`
 * supplies totals for externally bounded iterable loops. Refuse unknown multiplicities,
 * iterating callbacks, waits inside poll predicates, unevaluable bounds, anonymous callback
 * arguments, recursion, missing units and untimed children unless named in `untimedChildren`.
 *
 * Margin covers bounded CDP round trips and unresolved instance methods. `transparent`
 * functions expose argument waits while their outer race timer is not charged. Reads named
 * in `reads` are covered inside a poll but charged outside it. A poll can overrun by a final
 * interval plus one complete predicate call, including all its reads.
 */

const ITERATING_METHODS = new Set([
  'map',
  'forEach',
  'filter',
  'some',
  'every',
  'reduce',
  'flatMap',
])

const lineOf = (file, node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

function visit(ts, node, fn) {
  const walk = (at) => {
    fn(at)
    ts.forEachChild(at, walk)
  }
  walk(node)
}

/** The name a function is declared under — `function x`, `const x = () => …` — or null. */
function declaredName(ts, fn) {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name) &&
    fn.parent.initializer === fn
  ) {
    return fn.parent.name.text
  }
  return null
}

/** Every declaration of `name` visible from `from`, innermost scope first — lexical resolution. */
function resolve(ts, file, from, name) {
  for (let scope = from.parent; scope !== undefined; scope = scope.parent) {
    const statements =
      ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : null
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
          return { kind: 'parameter', node: parameter }
        }
      }
    }
    if (statements === null) continue
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return { kind: 'function', node: statement }
      }
      if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
        return { kind: 'class', node: statement }
      }
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
        const init = declaration.initializer
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          return { kind: 'function', node: init }
        }
        return { kind: 'value', node: declaration, scope }
      }
    }
  }
  return null
}

/**
 * The step-wait census over one smoke source.
 *
 * @param {typeof import('typescript')} ts
 * @param {string} source
 * @param {{
 *   name?: string,
 *   step: string,
 *   roots: string[],
 *   reads?: string[],
 *   skip?: string[],
 *   charged?: Record<string, number>,
 *   iterations?: Record<string, number>,
 * }} options — `step` is the constant the `step(…)` call names (omitted: the roots are searched in
 *   the whole file); `roots` the unit functions declared inside it (`'.'` is the step's own body);
 *   `skip` calls that run OTHER roots (`attemptUnit`); `iterations` the TOTAL number of times a
 *   `for (… of X)` body runs per run of its function, by `X` — a bound the caller derives and states,
 *   which replaces every loop factor outside it.
 * @returns {Record<string, { ms: number, waits: { line: number, what: string, ms: number }[] }>}
 */
export function stepWorstCase(
  ts,
  source,
  {
    name = 'smoke.mjs',
    step = null,
    roots,
    reads = [],
    skip = [],
    charged = {},
    iterations = {},
    transparent = [],
    untimedChildren = [],
  },
) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
  let stepCall = null
  if (step !== null)
    visit(ts, file, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'step' &&
        node.arguments[0]?.getText(file) === step
      ) {
        if (stepCall !== null) throw new Error(`\`step(${step}, …)\` is called twice`)
        stepCall = node
      }
    })
  if (step !== null && stepCall === null) throw new Error(`no \`step(${step}, …)\` in ${name}`)
  const stepBody = stepCall === null ? file : stepCall.arguments[1]

  /** A bound's value: a numeric literal, a `const` it names, or arithmetic over those. */
  const valueOf = (expression, at) => {
    if (ts.isNumericLiteral(expression)) return Number(expression.text.replaceAll('_', ''))
    if (ts.isParenthesizedExpression(expression)) return valueOf(expression.expression, at)
    if (ts.isBinaryExpression(expression)) {
      const left = valueOf(expression.left, at)
      const right = valueOf(expression.right, at)
      switch (expression.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return left + right
        case ts.SyntaxKind.MinusToken:
          return left - right
        case ts.SyntaxKind.AsteriskToken:
          return left * right
        default:
          break
      }
    }
    if (ts.isIdentifier(expression)) {
      const found = resolve(ts, file, at, expression.text)
      if (
        found?.kind === 'value' &&
        found.node.initializer !== undefined &&
        ts.isVariableDeclarationList(found.node.parent) &&
        found.node.parent.flags & ts.NodeFlags.Const
      ) {
        return valueOf(found.node.initializer, found.node)
      }
    }
    throw new Error(
      `line ${lineOf(file, expression)}: cannot evaluate the bound \`${expression.getText(file)}\``,
    )
  }

  /** `waitFor`'s own default bound, read from its declaration. */
  const waitForDefault = (at) => {
    const found = resolve(ts, file, at, 'waitFor')
    const parameter = found?.kind === 'function' ? found.node.parameters[2] : undefined
    if (parameter?.initializer === undefined) {
      throw new Error(`line ${lineOf(file, at)}: \`waitFor\` has no default bound to charge`)
    }
    return valueOf(parameter.initializer, parameter)
  }

  /** A `budget(…)` call, or a name bound to one — charged where the `budget` call is walked. */
  const isBudgeted = (expression, at) => {
    if (ts.isCallExpression(expression) && expression.expression.getText(file) === 'budget') {
      return true
    }
    if (!ts.isIdentifier(expression)) return false
    const found = resolve(ts, file, at, expression.text)
    const init = found?.kind === 'value' ? found.node.initializer : undefined
    return (
      init !== undefined && ts.isCallExpression(init) && init.expression.getText(file) === 'budget'
    )
  }

  /** The value a `budget(…)` call — or a name bound to one — asks for. */
  const budgetedValue = (expression, at) => {
    if (ts.isCallExpression(expression)) return valueOf(expression.arguments[0], at)
    const found = resolve(ts, file, at, expression.text)
    return valueOf(found.node.initializer.arguments[0], found.node)
  }

  /** The `timeout` a synchronous child is given — `execFileSync(…, { timeout })` — or undefined. */
  const syncTimeoutOf = (call) => {
    const options = call.arguments.find((argument) => ts.isObjectLiteralExpression(argument))
    return options?.properties.find(
      (property) =>
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
        property.name.getText(file) === 'timeout',
    )
  }

  /** A static method a call names through its class — `Cdp.attach(…)` — or null. */
  const staticMethodOf = (callee, at) => {
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null
    const found = resolve(ts, file, at, callee.expression.text)
    if (found?.kind !== 'class') return null
    return (
      found.node.members.find(
        (member) =>
          ts.isMethodDeclaration(member) &&
          member.name.getText(file) === callee.name.text &&
          member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      ) ?? null
    )
  }

  /** Is this `setTimeout` inside a `new Promise(…)` executor — the timer that ends a wait? */
  const settlesAnAwaitedPromise = (call, fn) => {
    for (let at = call.parent; at !== undefined && at !== fn.parent; at = at.parent) {
      if (
        ts.isFunctionLike(at) &&
        ts.isNewExpression(at.parent) &&
        at.parent.expression.getText(file) === 'Promise'
      ) {
        return true
      }
    }
    return false
  }

  const totals = new Map()
  const inProgress = new Set()

  /**
   * The worst case of one function's body: its own waits, and every helper it calls, weighted.
   * ⚑ A bound that is one of the function's own PARAMETERS is returned as a `param`, and charged at
   * each call site from the argument given there — or the parameter's default when none is.
   * ⚑ `inPoll`: the body runs inside a poll's predicate, where a named read is covered by the
   * poll's own bound and is not charged again.
   */
  const worstOf = (fn, inPoll = false) => {
    const key = `${fn.pos}:${fn.end}:${inPoll}`
    if (totals.has(key)) return totals.get(key)
    if (inProgress.has(key)) throw new Error(`line ${lineOf(file, fn)}: a recursive wait`)
    inProgress.add(key)
    const waits = []
    const params = []
    const charge = (node, what, ms) => {
      const factor = loopFactor(node, fn)
      if (ms > 0) waits.push({ line: lineOf(file, node), what, ms: ms * factor })
    }
    /** Charge one bound expression: a `budget` it names is charged where walked; a parameter, per call. */
    const chargeBound = (expression, node, what) => {
      if (isBudgeted(expression, node)) return
      if (ts.isIdentifier(expression)) {
        const found = resolve(ts, file, node, expression.text)
        if (found?.kind === 'parameter') {
          if (found.node.parent !== fn) {
            throw new Error(
              `line ${lineOf(file, node)}: the bound \`${expression.text}\` is an argument of a ` +
                'callback, whose caller this census cannot see — uncountable',
            )
          }
          params.push({
            index: fn.parameters.indexOf(found.node),
            name: expression.text,
            what,
            line: lineOf(file, node),
            factor: loopFactor(node, fn),
            fallback: found.node.initializer,
          })
          return
        }
      }
      charge(node, what, valueOf(expression, node))
    }
    /** Charge a call to a function whose worst case is `inner`, arguments included. */
    const chargeCall = (node, what, inner) => {
      if (inner.ms > 0) charge(node, what, inner.ms)
      for (const param of inner.params) {
        const argument = node.arguments[param.index]
        const label = `${what} → ${param.what} (${param.name})`
        const factor = param.factor
        if (argument === undefined) {
          if (param.fallback === undefined) {
            throw new Error(
              `line ${lineOf(file, node)}: \`${what}\` waits on \`${param.name}\`, which this call ` +
                'does not pass and has no default — uncountable',
            )
          }
          charge(node, `${label} default`, valueOf(param.fallback, param.fallback) * factor)
        } else if (isBudgeted(argument, node)) {
          // ⚑ Charged once where the `budget(…)` call is walked — and once more per extra time
          // the helper's own loop spends it (the review's finding).
          if (factor > 1)
            charge(node, `${label} × ${factor}`, budgetedValue(argument, node) * (factor - 1))
        } else {
          const before = waits.length
          chargeBound(argument, node, label)
          for (const added of waits.slice(before)) added.ms *= factor
          for (const added of params.slice(-1)) {
            if (added.line === lineOf(file, node) && added.what === label) added.factor *= factor
          }
        }
      }
    }
    const walk = (node) => {
      // ⚑ A helper DEFINED here runs where it is called, not where it is written.
      if (node !== fn && ts.isFunctionLike(node) && declaredName(ts, node) !== null) return
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const called = ts.isIdentifier(callee) ? callee.text : null
        if (called !== null && skip.includes(called)) return
        // ⚑ A read inside a poll is covered by the poll's bound; everywhere else it is charged.
        if (called !== null && inPoll && reads.includes(called)) return
        if (called !== null && transparent.includes(called)) {
          for (const argument of node.arguments) walk(argument)
          return
        }
        if (called === 'budget') {
          const [wanted] = node.arguments
          charge(node, 'budget', valueOf(wanted, node))
        } else if (called === 'waitFor') {
          const [, predicate, bound] = node.arguments
          if (predicate !== undefined && ts.isFunctionLike(predicate)) {
            const inside = worstOf(predicate, true)
            if (inside.ms > 0 || inside.params.length > 0) {
              throw new Error(
                `line ${lineOf(file, predicate)}: a wait inside a \`waitFor\` predicate runs an ` +
                  'unknown number of times — uncountable',
              )
            }
          }
          if (bound === undefined) charge(node, 'waitFor (its default)', waitForDefault(node))
          else chargeBound(bound, node, 'waitFor')
          // The predicate was measured above; a `budget(…)` in the bound is charged by walking it.
          if (bound !== undefined) walk(bound)
          return
        } else if (called === 'sleep') {
          chargeBound(node.arguments[0], node, 'sleep')
        } else if (called === 'setTimeout' && settlesAnAwaitedPromise(node, fn)) {
          // ⚑ A timer that settles a promise is that wait's bound — a race's `setTimeout(reject, ms)`.
          // ⚠️ One that settles nothing is a watchdog over some OTHER wait, and is not charged.
          chargeBound(node.arguments[1], node, 'setTimeout')
        } else if (called === 'execFileSync' || called === 'spawnSync') {
          // ⚑ A synchronous child waits for its whole `timeout`, and blocks the loop meanwhile.
          const timeout = syncTimeoutOf(node)
          if (timeout !== undefined) {
            chargeBound(
              ts.isShorthandPropertyAssignment(timeout) ? timeout.name : timeout.initializer,
              node,
              called,
            )
          } else {
            // ⛔ A synchronous child with no `timeout` is an unbounded wait: refused, unless its
            // caller names the program as one that returns at once, and says why beside it.
            const [program] = node.arguments
            const named =
              program !== undefined && ts.isStringLiteralLike(program) ? program.text : null
            if (named === null || !untimedChildren.includes(named)) {
              throw new Error(
                `line ${lineOf(file, node)}: an untimed \`${called}(${program?.getText(file) ?? ''}, …)\` ` +
                  'is an unbounded wait — uncountable',
              )
            }
          }
        } else if (called !== null && Object.hasOwn(charged, called)) {
          charge(node, called, charged[called])
        } else if (called !== null) {
          const found = resolve(ts, file, node, called)
          if (found?.kind === 'function') {
            if (found.node === fn) {
              throw new Error(
                `line ${lineOf(file, node)}: \`${called}\` calls itself — a recursive wait`,
              )
            }
            chargeCall(node, called, worstOf(found.node, inPoll))
          }
        } else {
          const method = staticMethodOf(callee, node)
          if (method !== null) chargeCall(node, callee.getText(file), worstOf(method, inPoll))
        }
        if (
          ts.isPropertyAccessExpression(callee) &&
          ITERATING_METHODS.has(callee.name.text) &&
          node.arguments.some((argument) => {
            if (!ts.isFunctionLike(argument)) return false
            const inner = worstOf(argument, inPoll)
            return inner.ms > 0 || inner.params.length > 0
          })
        ) {
          throw new Error(
            `line ${lineOf(file, node)}: a wait inside a \`.${callee.name.text}\` callback runs an ` +
              'unknown number of times — uncountable',
          )
        }
      }
      ts.forEachChild(node, walk)
    }
    ts.forEachChild(fn, walk)
    const result = { ms: waits.reduce((sum, one) => sum + one.ms, 0), waits, params }
    inProgress.delete(key)
    totals.set(key, result)
    return result
  }

  /** How many times `node` runs per run of `fn`: the literal bounds of the loops between them. */
  const loopFactor = (node, fn) => {
    let factor = 1
    for (let at = node.parent; at !== undefined && at !== fn; at = at.parent) {
      if (!ts.isIterationStatement(at, false)) continue
      // ⚑ A stated total for this loop's body replaces every factor outside it.
      if (ts.isForOfStatement(at) && Object.hasOwn(iterations, at.expression.getText(file))) {
        return factor * iterations[at.expression.getText(file)]
      }
      const bound = (() => {
        // ⚑ The bound on the loop's OWN counter — `for (let i = 0; … i < N …; i += 1)` — wherever it
        // sits in an `&&` chain; a `<` on anything else bounds nothing here (the review's finding).
        if (!ts.isForStatement(at) || at.condition === undefined) return null
        const declared =
          at.initializer !== undefined && ts.isVariableDeclarationList(at.initializer)
            ? at.initializer.declarations
            : []
        const counter =
          declared.length === 1 &&
          ts.isIdentifier(declared[0].name) &&
          declared[0].initializer !== undefined &&
          ts.isNumericLiteral(declared[0].initializer) &&
          Number(declared[0].initializer.text) === 0
            ? declared[0].name.text
            : null
        const terms = []
        const collect = (test) => {
          if (
            ts.isBinaryExpression(test) &&
            test.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ) {
            collect(test.left)
            collect(test.right)
          } else terms.push(test)
        }
        collect(at.condition)
        const own = terms.find(
          (test) =>
            ts.isBinaryExpression(test) &&
            test.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
            ts.isIdentifier(test.left) &&
            test.left.text === counter &&
            ts.isNumericLiteral(test.right),
        )
        return counter === null || own === undefined
          ? null
          : Number(own.right.text.replaceAll('_', ''))
      })()
      if (bound === null) {
        throw new Error(
          `line ${lineOf(file, node)}: a wait inside a loop with no literal bound runs an unknown ` +
            'number of times — uncountable',
        )
      }
      factor *= bound
    }
    return factor
  }

  const findRoot = (root) => {
    if (root === '.' && stepCall !== null) return stepBody
    let found = null
    visit(ts, stepBody, (node) => {
      if (ts.isFunctionLike(node) && declaredName(ts, node) === root) {
        if (found !== null) throw new Error(`\`${root}\` is declared twice inside step ${step}`)
        found = node
      }
    })
    if (found === null) throw new Error(`no unit function \`${root}\` inside step ${step}`)
    return found
  }

  return Object.fromEntries(
    roots.map((root) => {
      const result = worstOf(findRoot(root))
      if (result.params.length > 0) {
        throw new Error(
          `\`${root}\` waits on its own argument \`${result.params[0].name}\`, which no call ` +
            'this census reads ever passes — uncountable',
        )
      }
      return [root, result]
    }),
  )
}
