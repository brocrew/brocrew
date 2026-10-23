import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import * as registry from '../src/main/providers'

const root = new URL('../src/main/', import.meta.url)
const sourceOf = (name: string): ts.SourceFile => {
  const path = fileURLToPath(new URL(name, root))
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}
function selectionsIn(source: ts.SourceFile, node: ts.Node = source): string[] {
  const found: string[] = []
  const visit = (one: ts.Node): void => {
    if (ts.isCallExpression(one) && one.expression.getText(source) === 'providerValue')
      found.push('providerValue')
    if (ts.isStringLiteralLike(one) && ['claude', 'codex'].includes(one.text)) found.push(one.text)
    if (ts.isImportSpecifier(one) && !one.isTypeOnly && /claude|codex/i.test(one.name.text)) {
      const declaration = one.parent.parent
      if (ts.isImportClause(declaration) && !declaration.isTypeOnly) found.push(one.name.text)
    }
    ts.forEachChild(one, visit)
  }
  visit(node)
  return found
}

describe('provider transcript and discovery policies have one owner', () => {
  it.each([
    'adopt/discover-sessions.ts',
    'adopt/user-homes.ts',
    'archive/derive-ledger.ts',
    'archive/export-session.ts',
    'archive/native-file.ts',
    'archive/session-reader.ts',
    'archive/turn-as-sent.ts',
    'child-work.ts',
    'conversation-files.ts',
    'transcript-retention-files.ts',
    'runtime/schedule-evidence.ts',
  ])('keeps provider selection and native implementation imports out of %s', (file) => {
    expect(selectionsIn(sourceOf(file))).toEqual([])
  })

  it('keeps native file policy out of the host methods that consume it', () => {
    const source = sourceOf('runtime/runtime-host.ts')
    const methods = new Set([
      'recordWhatTheOlderOnesRan',
      'deleteVerdict',
      'imageResolver',
      'childWorkRead',
      'recordWhatItReportsRunning',
      'readTurnAsSent',
      'listLibrary',
    ])
    const inspected: string[] = []
    const found: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node)) {
        const name = node.name.getText(source)
        if (methods.has(name)) {
          inspected.push(name)
          found.push(...selectionsIn(source, node))
        }
        if (/^read(?:Claude|Codex)Child$/.test(name)) found.push(name)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(inspected.sort()).toEqual([...methods].sort())
    expect(found).toEqual([])
  })

  it('shares the exact stateless policy objects with bound modules without doing launch work', () => {
    const definitions = Reflect.get(registry, 'providerDefinitions') as
      Readonly<Record<Provider, { transcripts: object; discovery: object }>> | undefined
    expect(definitions).toBeDefined()
    if (definitions === undefined) throw new Error('Provider definitions are absent')
    const unread = vi.fn((): never => {
      throw new Error('No launch work during binding')
    })
    const modules = registry.createProviderModules(
      () => ({
        managedRoot: '/fictional/homes',
        defaultProfile: 'fern',
        homeOf: unread,
        profiles: unread,
        assertMayOpen: unread,
      }),
      {
        claude: { runtime: { program: unread }, home: {}, auth: {} },
        codex: { runtime: { command: unread }, home: {}, auth: { command: unread } },
      },
    )
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(definitions[provider].transcripts).toBeTypeOf('object')
      expect(definitions[provider].discovery).toBeTypeOf('object')
      expect(Reflect.get(modules[provider], 'transcripts')).toBe(definitions[provider].transcripts)
      expect(Reflect.get(modules[provider], 'discovery')).toBe(definitions[provider].discovery)
    }
    expect(unread).not.toHaveBeenCalled()
  })
})
