import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

function writableOpens(source: string): number {
  const tree = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true)
  const stores = new Set(['GlobalPluginState'])
  for (const statement of tree.statements)
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
          if ((item.propertyName ?? item.name).text === 'GlobalPluginState')
            stores.add(item.name.text)
    }
  let count = 0
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      stores.has(node.expression.expression.text) &&
      ['open', 'create'].includes(node.expression.name.text)
    )
      count++
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return count
}
it('counts writable state constructors through named import aliases and excludes fresh observers', () => {
  expect(
    writableOpens(
      "import { GlobalPluginState as State } from './state/store'; State.open(root); State.create(root); State.observe(root)",
    ),
  ).toBe(2)
  expect(
    writableOpens(
      'GlobalPluginState.observe(root); GlobalPluginState.installedDescriptor(root, id)',
    ),
  ).toBe(0)
})
it('only the supervisor bootstrap opens writable global plugin state in production', () => {
  const root = fileURLToPath(new URL('../src/main', import.meta.url))
  const writers: Array<{ path: string; calls: number }> = []
  function walk(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) {
        const calls = writableOpens(readFileSync(path, 'utf8'))
        if (calls) writers.push({ path: relative(root, path).replaceAll('\\', '/'), calls })
      }
    }
  }
  walk(root)
  expect(writers).toEqual([{ path: 'plugins/lifecycle/bootstrap.ts', calls: 1 }])
})
