import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from './node_modules/typescript/lib/typescript.js'

const ROOT = /^apps\/desktop\/(?:src\/main\/plugins\/|resources\/plugin-host\/)/
const EXTERNAL = /(^|\/)node_modules\//
const BARREL = 'packages/runtime/src/index.ts'
const SDKS = ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk']
const RULES = ['direct-value-barrel', 'runtime-barrel-reach', 'provider-sdk-reach']
const ROLES = ['host', 'service']

export const emptyCounts = () =>
  Object.fromEntries(RULES.map((rule) => [rule, { host: 0, service: 0 }]))

export function targetPluginCounts(root, target, bootstrap = false) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const revision = git(['rev-parse', '--verify', `${target}^{commit}`])
  if (bootstrap) {
    if (revision !== 'a42dd460f37a702905ee71fdd8ca61ed78c5e5e0')
      throw new Error('plugin policy: explicit bootstrap requires the reviewed a42 base')
    git(['merge-base', '--is-ancestor', revision, 'HEAD'])
    return Object.fromEntries(RULES.map((rule) => [rule, { host: 2, service: 0 }]))
  }
  return validateCounts(JSON.parse(git(['show', `${revision}:scripts/code-health/baseline/plugin-policy.json`])))
}

function validateCounts(counts) {
  if (!counts || Object.keys(counts).sort().join() !== [...RULES].sort().join())
    throw new Error('plugin policy: expected only the three rule1 count rows')
  for (const rule of RULES) {
    if (!counts[rule] || Object.keys(counts[rule]).sort().join() !== [...ROLES].sort().join())
      throw new Error(`plugin policy: expected host/service counts for ${rule}`)
    for (const role of ROLES)
      if (!Number.isSafeInteger(counts[rule][role]) || counts[rule][role] < 0)
        throw new Error(`plugin policy: invalid integer ${rule}/${role}`)
  }
  return counts
}

export function comparePluginCounts(actual, candidate, target) {
  for (const counts of [actual, candidate, target]) validateCounts(counts)
  const added = []
  for (const rule of RULES) {
    for (const role of ROLES) {
      const key = `${rule}/${role}`
      if (actual[rule][role] !== candidate[rule][role])
        added.push(`${key}: measured ${actual[rule][role]}, ceiling must equal it (got ${candidate[rule][role]})`)
      if (candidate[rule][role] > target[rule][role])
        added.push(`${key}: ceiling increased ${target[rule][role]} -> ${candidate[rule][role]}`)
    }
  }
  return { added, resolved: [] }
}

export function valueImports(text, file) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imports = []
  const computed = []
  const record = (node, expression) => {
    if (expression && ts.isStringLiteralLike(expression))
      imports.push({ module: expression.text, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
    else computed.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const names = clause?.namedBindings
      const erased = clause?.isTypeOnly ||
        (clause && !clause.name && names && ts.isNamedImports(names) &&
          names.elements.length > 0 && names.elements.every((one) => one.isTypeOnly))
      if (!erased) record(node, node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const erased = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((one) => one.isTypeOnly))
      if (!erased) record(node, node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      record(node, node.moduleReference.expression)
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      record(node, node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { imports, computed }
}

const executable = (edge) => !edge.preCompilationOnly &&
  !(edge.dependencyTypes ?? []).some((type) => type === 'type-only' || type === 'pre-compilation-only')
const sdkName = (target) => SDKS.find((name) =>
  target === name || target.includes(`/${name}/`) || target === `external:${name}`)
const kindOf = (target) => target === BARREL ? 'runtime-barrel-reach' :
  sdkName(target) ? 'provider-sdk-reach' : null

export function collectPluginPolicy(graph, selected, { root, readSource = (file) => fs.readFileSync(path.join(root, file), 'utf8') }) {
  const normalize = (file) => (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join('/').replaceAll('\\', '/')
  const modules = new Map(graph.modules.map((module) => [normalize(module.source), {
    ...module, dependencies: module.dependencies.map((edge) => ({ ...edge, resolved: normalize(edge.resolved) })),
  }]))
  const roots = selected.map(normalize).filter((file) => ROOT.test(file)).sort()
  const missing = roots.filter((file) => !modules.has(file))
  const sourceFacts = new Map()
  const facts = (file) => {
    if (!sourceFacts.has(file)) sourceFacts.set(file, valueImports(readSource(file), file))
    return sourceFacts.get(file)
  }
  const counts = emptyCounts()
  const fullCounts = emptyCounts()
  const witnesses = []
  const fullWitnesses = []
  const unresolved = new Map()
  const computed = new Map()
  const endpointGaps = new Map()
  for (const source of roots) {
    if (!modules.has(source)) continue
    const role = source.startsWith('apps/desktop/resources/plugin-host/') ? 'service' : 'host'
    const direct = facts(source).imports.filter((one) => one.module === '@brobot2/runtime')
    if (direct.length) {
      counts['direct-value-barrel'][role]++
      witnesses.push({ rule: 'direct-value-barrel', role, root: source, target: BARREL,
        path: [source, BARREL], lines: direct.map((one) => one.line) })
    }
    for (const full of [false, true]) {
      const seen = new Set()
      const queue = [[source, [source]]]
      for (let i = 0; i < queue.length; i++) {
        const [current, route] = queue[i]
        if (seen.has(current)) continue
        seen.add(current)
        const rule = kindOf(current)
        if (rule) {
          ;(full ? fullCounts : counts)[rule][role]++
          ;(full ? fullWitnesses : witnesses).push({ rule, role, root: source, target: current, path: route })
        }
        const module = modules.get(current)
        if (!module || EXTERNAL.test(current) || current.startsWith('external:')) continue
        const edges = module.dependencies.filter((edge) => full || executable(edge))
        if (!full) {
          for (const edge of edges)
            if (edge.couldNotResolve) unresolved.set(`${current}|${edge.module}`, { source: current, module: edge.module })
          if (!module.coreModule && /\.[cm]?[jt]sx?$/.test(current)) {
            const sourceInfo = facts(current)
            if (sourceInfo.computed.length) computed.set(current, sourceInfo.computed)
            for (const imported of sourceInfo.imports) {
              const sdk = SDKS.find((name) => imported.module === name || imported.module.startsWith(`${name}/`))
              if (!sdk) continue
              const native = module.dependencies.find((edge) => edge.module === imported.module && sdkName(edge.resolved))
              if (!native) {
                endpointGaps.set(`${current}|${imported.module}`, { source: current, ...imported })
                edges.push({ resolved: `external:${sdk}` })
              }
            }
          }
        }
        for (const edge of edges) queue.push([edge.resolved, [...route, edge.resolved]])
      }
    }
  }
  return {
    counts, fullCounts, witnesses, fullWitnesses,
    coverage: {
      roots: roots.length, host: roots.filter((file) => file.startsWith('apps/desktop/src/')).length,
      service: roots.filter((file) => file.startsWith('apps/desktop/resources/')).length,
      missing, unresolved: [...unresolved.values()], sdkEndpointGaps: [...endpointGaps.values()],
      computedLoaders: Object.fromEntries(computed),
      sdkEndpoints: [...modules.keys()].filter((file) => sdkName(file)),
    },
  }
}

export function policyCoverageErrors(result) {
  return [
    ...result.coverage.missing.map((file) => `plugin policy: missing selected root ${file}`),
    ...result.coverage.unresolved.map((edge) => `plugin policy: unresolved executable edge ${edge.source} -> ${edge.module}`),
    ...result.coverage.sdkEndpointGaps.map((edge) => `plugin policy: missing SDK endpoint ${edge.source} -> ${edge.module}`),
  ]
}
