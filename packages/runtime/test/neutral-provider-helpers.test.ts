import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function importsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  return source.statements.flatMap((node) =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
      ? [node.moduleSpecifier.text]
      : [],
  )
}

describe('neutral provider helpers', () => {
  it('lets Claude read MCP forms without importing the Codex adapter', () => {
    expect(importsOf('claude/claude-runtime.ts').filter((path) => path.includes('/codex/'))).toEqual([])
  })

  it('keeps managed plugin contracts independent of generated Codex protocol types', () => {
    expect(importsOf('managed-plugin-mcp.ts').filter((path) => path.includes('/codex/'))).toEqual([])
  })
})
