import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const PROVIDERS = new Set(['claude', 'codex'])
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
])

function providerLiteral(node) {
  return ts.isStringLiteralLike(node) && PROVIDERS.has(node.text.toLowerCase())
}

function providerCollection(node) {
  return (
    providerLiteral(node) ||
    (ts.isArrayLiteralExpression(node) && node.elements.some(providerLiteral)) ||
    (ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Set' &&
      node.arguments?.some(providerCollection) === true)
  )
}

/**
 * Count direct executable provider decisions, excluding comments, types and display text.
 * Names assembled at runtime or compared through aliases are outside this literal census.
 */
export function countProviderBranches(source) {
  const tree = ts.createSourceFile('provider-source.ts', source, ts.ScriptTarget.Latest, true)
  let count = 0
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      COMPARISONS.has(node.operatorToken.kind) &&
      (providerLiteral(node.left) || providerLiteral(node.right))
    ) {
      count += 1
    } else if (ts.isCaseClause(node) && providerLiteral(node.expression)) {
      count += 1
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['has', 'includes', 'startsWith', 'endsWith', 'indexOf'].includes(
        node.expression.name.text,
      ) &&
      (providerCollection(node.expression.expression) || node.arguments.some(providerLiteral))
    ) {
      count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return count
}

/** Provider implementations are excluded; the host and neutral runtime share the gate. */
export function scanProviderBranches(root) {
  const counts = {}
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = join(directory, entry.name)
      const file = relative(root, absolute).split(sep).join('/')
      if (
        /^packages\/runtime\/src\/(claude|codex)(\/|$)/.test(file) ||
        /^apps\/desktop\/src\/main\/providers\/(claude|codex)(\/|$)/.test(file)
      ) {
        continue
      }
      if (entry.isDirectory()) {
        walk(absolute)
      } else if (entry.name.endsWith('.ts')) {
        const count = countProviderBranches(readFileSync(absolute, 'utf8'))
        if (count > 0) counts[file] = count
      }
    }
  }
  for (const directory of ['apps/desktop/src/main', 'packages/runtime/src']) {
    walk(join(root, directory))
  }
  return counts
}

/** An unused permit cannot move to another file. */
export function findRatchetIncreases(baseline, current) {
  return Object.entries(current)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(([file, count]) => ({ file, allowed: baseline[file] ?? 0, actual: count }))
    .sort((a, b) => a.file.localeCompare(b.file))
}
