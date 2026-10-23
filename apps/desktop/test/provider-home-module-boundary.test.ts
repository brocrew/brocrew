import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('../src/main/runtime/provider-homes.ts', import.meta.url))
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)

describe('the shared home facade has no provider implementation', () => {
  it('keeps provider-specific construction fields out of the neutral module contract', () => {
    const path = fileURLToPath(new URL('../src/main/providers/module.ts', import.meta.url))
    const contract = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const fields: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertySignature(node) || ts.isMethodSignature(node)) &&
        /^(claude|codex)/i.test(node.name.getText(contract))
      )
        fields.push(node.name.getText(contract))
      ts.forEachChild(node, visit)
    }
    visit(contract)
    expect(fields).toEqual([])
  })

  it('does not select or spell a provider', () => {
    const names: string[] = []
    const selectors: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && ['claude', 'codex'].includes(node.text))
        names.push(node.text)
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'providerValue')
        selectors.push(node.expression.getText(source))
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(names).toEqual([])
    expect(selectors).toEqual([])
  })

  it('imports only shared home provisioning from the runtime', () => {
    const implementations: string[] = []
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== '@brobot2/runtime'
      )
        continue
      const bindings = statement.importClause?.namedBindings
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue
      for (const binding of bindings.elements) {
        if (binding.isTypeOnly || statement.importClause?.isTypeOnly) continue
        const name = (binding.propertyName ?? binding.name).text
        if (name !== 'provisionProviderHome') implementations.push(name)
      }
    }
    expect(implementations).toEqual([])
  })
})
