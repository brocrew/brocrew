import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const main = new URL('../src/main/', import.meta.url)
const sourceOf = (name: string, root = main): ts.SourceFile => {
  const path = fileURLToPath(new URL(name, root))
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

function selectionsIn(source: ts.SourceFile): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'providerValue')
      found.push('providerValue')
    if (ts.isStringLiteralLike(node) && ['claude', 'codex'].includes(node.text))
      found.push(node.text)
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertyAccessExpression(node)) &&
      ts.isIdentifier(node.name) &&
      ['claude', 'codex'].includes(node.name.text)
    )
      found.push(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function nativeImportsIn(source: ts.SourceFile): string[] {
  const found: string[] = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text
      if (/claude|codex/i.test(name)) found.push(name)
    }
  }
  return found
}

describe('provider authentication has one owner', () => {
  it('keeps native model and billing check rules out of the key vault', () => {
    const source = sourceOf('runtime/api-keys.ts')
    const nativeRules: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteralLike(node) &&
        /api\.anthropic\.com|haiku|credit balance|billing_error/.test(node.text)
      )
        nativeRules.push(node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(nativeRules).toEqual([])
  })

  it.each(['runtime/claude-program.ts', 'runtime/codex-binary.ts', 'runtime/provider-versions.ts'])(
    'keeps only compatibility exports in %s',
    (file) => {
      const implementations = sourceOf(file)
        .statements.filter(
          (statement) => !ts.isExportDeclaration(statement) && !ts.isImportDeclaration(statement),
        )
        .map((statement) => ts.SyntaxKind[statement.kind])
      expect(implementations).toEqual([])
    },
  )

  it.each([
    'runtime/runtime-host.ts',
    'runtime/api-keys.ts',
    'runtime/provider-versions.ts',
    'provider-accounts-file.ts',
    'runtime/process-listing.ts',
    'runtime/reply-rails.ts',
    'sign-in-changes.ts',
    'db/limits-read-engine.ts',
  ])('keeps provider selection out of %s', (file) => {
    expect(selectionsIn(sourceOf(file))).toEqual([])
  })

  it.each([
    'runtime/runtime-host.ts',
    'runtime/api-keys.ts',
    'runtime/launch-refusal.ts',
    'runtime/agent-tools.ts',
    'providers/module.ts',
  ])('keeps native authentication and program types out of %s', (file) => {
    expect(nativeImportsIn(sourceOf(file))).toEqual([])
  })

  it('keeps the runtime handle independent of a native copy format', () => {
    const runtime = new URL('../../../packages/runtime/src/', import.meta.url)
    expect(nativeImportsIn(sourceOf('runtime.ts', runtime))).toEqual([])
  })
})
