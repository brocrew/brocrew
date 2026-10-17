import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { replyUnkeptFileReason } from '../src/main/runtime/reply-rails'

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
function nodeImports(source: string): string[] {
  const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const see = (node: ts.Node): void => {
    const value =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          ? node.arguments[0]
          : undefined
    if (
      value !== undefined &&
      ts.isStringLiteral(value) &&
      (value.text.startsWith('node:') || builtins.has(value.text))
    )
      found.push(value.text)
    ts.forEachChild(node, see)
  }
  see(file)
  return found
}

describe('reply file guidance can load in the window', () => {
  it('the shared reply rails import no Node modules', () => {
    const source = readFileSync(
      new URL('../src/main/runtime/reply-rails.ts', import.meta.url),
      'utf8',
    )
    expect(nodeImports(source)).toEqual([])
  })

  it('the browser-boundary control catches static, re-exported and dynamic Node imports', () => {
    for (const source of [
      'import { extname } from "node:path"',
      'export * from "fs"',
      'const x = import("node:path")',
      'const x = require("path")',
    ])
      expect(() => expect(nodeImports(source)).toEqual([])).toThrow()
  })

  it.each([
    ['/folder.with.dot/run.ZSH', 'a .zsh file'],
    ['/folder.zsh/plain', 'a file of an unrecognised kind'],
    ['/folder.zsh/.zsh', 'a file of an unrecognised kind'],
    ['/folder/.script.zsh', 'a .zsh file'],
    ['/folder/notes.ts', 'a .ts file'],
    ['/folder/file.PRIVATE_EXTENSION', 'a file of an unrecognised kind'],
    ['/folder/report.', 'a file of an unrecognised kind'],
    [undefined, 'a file of an unrecognised kind'],
    [42, 'a file of an unrecognised kind'],
  ])('only the final file segment determines the fixed kind: %s', (path, kind) => {
    const reason = replyUnkeptFileReason(path)
    expect(reason).toContain(`This app does not keep ${kind}.`)
    expect(reason).not.toContain('PRIVATE_EXTENSION')
    expect(reason).not.toContain('/folder')
  })
})
