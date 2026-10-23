import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS } from '@brobot2/shared'
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
    if (
      ts.isPropertyAssignment(one) &&
      ts.isIdentifier(one.name) &&
      ['claude', 'codex'].includes(one.name.text)
    )
      found.push(one.name.text)
    if (ts.isImportSpecifier(one) && !one.isTypeOnly && /claude|codex/i.test(one.name.text)) {
      const declaration = one.parent.parent
      if (ts.isImportClause(declaration) && !declaration.isTypeOnly) found.push(one.name.text)
    }
    ts.forEachChild(one, visit)
  }
  visit(node)
  return found
}

describe('provider knowledge policies have one owner', () => {
  it.each([
    'runtime/instructions.ts',
    'runtime/what-this-agent-was-given.ts',
    'runtime/agent-memory.ts',
    'runtime/memory-notes.ts',
    'runtime/profile-bundle.ts',
    'skills/skill-view.ts',
    'skills/selected-skill-view.ts',
    'skills/prepare-built-in-skills.ts',
    'skills/built-in-catalogue.ts',
    'skills/shared-library.ts',
    'kept-rules.ts',
    'delete-workspace.ts',
    'protected-places.ts',
    'provider-snapshots.ts',
  ])('keeps provider selection and native implementation imports out of %s', (file) => {
    expect(selectionsIn(sourceOf(file))).toEqual([])
  })

  it('keeps provider knowledge policy out of the host methods that consume it', () => {
    const source = sourceOf('runtime/runtime-host.ts')
    const names = new Set([
      'theLeadsItsThreadHolds',
      'theLeadAReopenOwes',
      'whatThisAppAddsAtItsEnd',
      'keptRules',
      'whatALaunchGave',
      'whatThisAgentWasGiven',
      'started',
    ])
    const inspected: string[] = []
    const found: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && names.has(node.name.getText(source))) {
        inspected.push(node.name.getText(source))
        found.push(...selectionsIn(source, node))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(inspected.sort()).toEqual([...names].sort())
    expect(found).toEqual([])
  })

  it('shares the exact stateless knowledge policies without doing launch work', () => {
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
      for (const member of ['instructions', 'memory', 'skills', 'keptRules', 'snapshot']) {
        const policy: unknown = Reflect.get(registry.providerDefinitions[provider], member)
        expect(policy, `${provider}.${member}`).toBeTypeOf('object')
        expect(Reflect.get(modules[provider], member)).toBe(policy)
      }
    }
    expect(unread).not.toHaveBeenCalled()
  })
})
