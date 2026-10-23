import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../src/main', import.meta.url))
const registry = join(root, 'providers/index.ts')
const definitions = join(root, 'providers/definitions.ts')
const knowledge = join(root, 'providers/knowledge-definitions.ts')
const compatibility = join(root, 'providers/compat.ts')
const composition = join(root, 'index.ts')
const nameOf = (file: string): string => relative(root, file).split(sep).join('/')
const filesIn = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    return entry.isDirectory() ? filesIn(path) : /\.(ts|mjs)$/.test(entry.name) ? [path] : []
  })
const files = filesIn(root)
const imports = new Map<string, readonly string[]>()

/** Follow local value imports, re-exports and literal dynamic imports; never load their code. */
function valueImports(file: string): readonly string[] {
  const known = imports.get(file)
  if (known !== undefined) return known
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      if (
        !clause?.isTypeOnly &&
        (clause === undefined ||
          clause.name !== undefined ||
          bindings === undefined ||
          !ts.isNamedImports(bindings) ||
          bindings.elements.some((one) => !one.isTypeOnly))
      )
        specifiers.add(node.moduleSpecifier.text)
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      (node.exportClause === undefined ||
        !ts.isNamedExports(node.exportClause) ||
        node.exportClause.elements.some((one) => !one.isTypeOnly))
    )
      specifiers.add(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === 'require') &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    )
      specifiers.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const resolved = [...specifiers].flatMap((specifier) => {
    if (!specifier.startsWith('.')) return []
    const path = resolve(dirname(file), specifier)
    const found = [path, `${path}.ts`, path.replace(/\.js$/, '.ts'), join(path, 'index.ts')].find(
      (candidate) => candidate.startsWith(`${root}${sep}`) && files.includes(candidate),
    )
    return found === undefined ? [] : [found]
  })
  imports.set(file, resolved)
  return resolved
}

describe('provider modules stay behind the main-process registry', () => {
  it('does not import the facade, host or registry back into provider modules', () => {
    const forbidden = new Set([
      registry,
      definitions,
      knowledge,
      join(root, 'runtime/provider-homes.ts'),
      join(root, 'runtime/runtime-host.ts'),
    ])
    const violations = files
      .filter((file) => nameOf(file).startsWith('providers/'))
      .flatMap((file) =>
        valueImports(file)
          .filter(
            (target) =>
              forbidden.has(target) &&
              !(file === registry && (target === definitions || target === knowledge)),
          )
          .map((target) => `${nameOf(file)} -> ${nameOf(target)}`),
      )
    expect(violations).toEqual([])
  })

  it('routes neutral value imports of provider implementations through the registry', () => {
    const mayCompose = new Set([
      registry,
      definitions,
      knowledge,
      compatibility,
      composition,
      join(root, 'providers/workspace-layout.mjs'),
    ])
    const implementationOf = (file: string): string | undefined =>
      /^providers\/(claude|codex)\//.exec(nameOf(file))?.[1]
    const violations = files
      .filter((file) => !mayCompose.has(file))
      .flatMap((file) =>
        valueImports(file)
          .filter((target) => {
            const provider = implementationOf(target)
            return provider !== undefined && provider !== implementationOf(file)
          })
          .map((target) => `${nameOf(file)} -> ${nameOf(target)}`),
      )
    expect(violations).toEqual([])
  })

  it('keeps the registry out of every worker value-import closure', () => {
    const reaches = (file: string, seen = new Set<string>()): boolean => {
      if (file === registry || file === definitions || file === knowledge) return true
      if (seen.has(file)) return false
      seen.add(file)
      return valueImports(file).some((next) => reaches(next, seen))
    }
    expect(
      files.filter((file) => file.endsWith('.worker.ts') && reaches(file)).map(nameOf),
    ).toEqual([])
    // A missing registry is the base before extraction, not a reason to skip the worker scan.
    if (existsSync(registry)) expect(valueImports(registry)).not.toContain(composition)
  })

  it('keeps stateless definitions independent of runtime construction and home compatibility', () => {
    expect(existsSync(definitions)).toBe(true)
    const heavy = new Set([
      registry,
      compatibility,
      join(root, 'runtime/provider-homes.ts'),
      join(root, 'providers/claude/index.ts'),
      join(root, 'providers/codex/index.ts'),
      join(root, 'providers/instruction-io.ts'),
      join(root, 'providers/instruction-composition.ts'),
      join(root, 'providers/memory-policy.ts'),
      join(root, 'providers/knowledge-definitions.ts'),
      join(root, 'runtime/instructions.ts'),
      join(root, 'runtime/agent-memory.ts'),
      join(root, 'skills/prepare-built-in-skills.ts'),
      ...files.filter((file) =>
        /^providers\/(claude|codex)\/(instructions|memory|skills|given|kept-rules|snapshot)(\.ts|\/)/.test(
          nameOf(file),
        ),
      ),
    ])
    const seen = new Set<string>()
    const reached: string[] = []
    const visit = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      if (heavy.has(file)) reached.push(nameOf(file))
      for (const next of valueImports(file)) visit(next)
    }
    if (existsSync(definitions)) visit(definitions)
    expect(reached).toEqual([])
  })

  it('keeps the home facade as the only legacy compatibility consumer', () => {
    expect(
      files
        .filter(
          (file) =>
            file !== join(root, 'runtime/provider-homes.ts') &&
            valueImports(file).includes(compatibility),
        )
        .map(nameOf),
    ).toEqual([])
  })
})
