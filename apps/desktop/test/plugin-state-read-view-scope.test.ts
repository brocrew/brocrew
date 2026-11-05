import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

function pinnedAfterAwait(source: string): string[] {
  const tree = ts.createSourceFile('fictional.ts', source, ts.ScriptTarget.Latest, true)
  const bad: string[] = []
  function bodyOf(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    )
      return node.body
    return undefined
  }
  function visit(node: ts.Node) {
    const body = bodyOf(node)
    if (body) {
      const reads = new Map<string, number>()
      const awaits: number[] = []
      function own(part: ts.Node) {
        if (part !== node && ts.isFunctionLike(part)) return
        if (ts.isAwaitExpression(part)) awaits.push(part.getStart(tree))
        if (
          ts.isVariableDeclaration(part) &&
          ts.isIdentifier(part.name) &&
          part.initializer &&
          ts.isCallExpression(part.initializer) &&
          ts.isPropertyAccessExpression(part.initializer.expression) &&
          part.initializer.expression.name.text === 'readView'
        )
          reads.set(part.name.text, part.end)
        ts.forEachChild(part, own)
      }
      own(node)
      for (const [name, start] of reads) {
        const boundary = awaits.find((position) => position > start)
        if (boundary === undefined) continue
        function refs(part: ts.Node) {
          if (ts.isIdentifier(part) && part.text === name && part.getStart(tree) > boundary!)
            bad.push(name)
          ts.forEachChild(part, refs)
        }
        refs(body)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return bad
}
it('detects a read view reused after an await, including a late callback capture', () => {
  expect(
    pinnedAfterAwait(
      'async function bad(){const view=state.readView();await io();return view.getEnabled(w,p)}',
    ),
  ).toEqual(['view'])
  expect(
    pinnedAfterAwait(
      'async function bad(){const view=state.readView();await io();return ()=>view.getEnabled(w,p)}',
    ),
  ).toEqual(['view'])
  expect(
    pinnedAfterAwait(
      'async function good(){const expected=state.readView().getEnabled(w,p).revision;await io();return state.readView().getEnabled(w,p).revision===expected}',
    ),
  ).toEqual([])
})
it('reacquires the committed read view after awaited controller work', () => {
  const source = readFileSync(
    new URL('../src/main/plugins/lifecycle/controller.ts', import.meta.url),
    'utf8',
  )
  expect(pinnedAfterAwait(source)).toEqual([])
})
