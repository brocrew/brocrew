import ts from 'typescript'

export function returnsItsWindowSink(source: string): boolean {
  const file = ts.createSourceFile('window.ts', source, ts.ScriptTarget.Latest, true)
  const factories: ts.PropertyAssignment[] = []
  const find = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'sinkFor'
    )
      factories.push(node)
    node.forEachChild(find)
  }
  find(file)
  if (factories.length !== 1) return false
  const factory = factories[0]!.initializer
  if (!ts.isArrowFunction(factory) || !ts.isBlock(factory.body)) return false
  if (factory.parameters.length !== 1 || factory.parameters[0]!.name.getText(file) !== 'event')
    return false
  const body = factory.body
  const first = body.statements[0]
  if (!first || !ts.isVariableStatement(first)) return false
  if (!(first.declarationList.flags & ts.NodeFlags.Const)) return false
  if (first.declarationList.declarations.length !== 1) return false
  const declaration = first.declarationList.declarations[0]!
  const call = declaration.initializer
  if (declaration.name.getText(file) !== 'sink' || !call || !ts.isCallExpression(call)) return false
  if (call.expression.getText(file) !== 'webContentsSink') return false
  if (
    call.arguments.length !== 2 ||
    call.arguments[0]!.getText(file) !== 'event.sender' ||
    call.arguments[1]!.getText(file) !== 'mainThreadWork'
  )
    return false
  const returns: ts.ReturnStatement[] = []
  const inspect = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node)) returns.push(node)
    node.forEachChild(inspect)
  }
  inspect(body)
  return (
    returns.length === 1 &&
    body.statements.at(-1) === returns[0] &&
    returns[0]!.expression?.getText(file) === 'sink'
  )
}
