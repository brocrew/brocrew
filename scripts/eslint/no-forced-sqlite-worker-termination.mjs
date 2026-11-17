// A worker ended inside a better-sqlite3 call aborts the whole app, so code that owns a SQLite
// worker asks it to stop and awaits its exit instead of calling Node's Worker#terminate.
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      join: 'Ask the SQLite worker to stop and await its exit instead of terminating it.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices
    if (!services.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('The SQLite worker lifetime rule requires the configured TypeScript project.')
    }
    const checker = services.program.getTypeChecker()
    const isWorkerTerminate = (node) => {
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node))
      return type.getCallSignatures().some((signature) => {
        const declaration = signature.getDeclaration()
        return (
          declaration?.name?.getText() === 'terminate' &&
          declaration.parent?.name?.getText() === 'Worker' &&
          /(?:^|[\\/])worker_threads\.d\.ts$/.test(declaration.getSourceFile().fileName)
        )
      })
    }
    return {
      // Check the function type, not the receiver spelling or argument count.
      CallExpression(node) {
        if (isWorkerTerminate(node.callee)) context.report({ node, messageId: 'join' })
      },
      // Also catches saving/binding the method before calling it elsewhere.
      MemberExpression(node) {
        if (node.parent.type === 'CallExpression' && node.parent.callee === node) return
        if (isWorkerTerminate(node)) context.report({ node, messageId: 'join' })
      },
    }
  },
}
