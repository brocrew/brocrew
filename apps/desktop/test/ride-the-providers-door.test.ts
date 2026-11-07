import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { capabilitiesFor } from '@brobot2/runtime'
import { providerDescriptor } from '@brobot2/shared'

const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')

describe('461 · ride the provider’s door', () => {
  const strip = (text: string): string =>
    text.replace(
      /\/\*\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      (match, keep: string | undefined) => keep ?? '',
    )
  const mainSource = (file: string): string =>
    strip(readFileSync(join(mainRoot, 'runtime', file), 'utf8'))

  describe('§2 · an approved plan settles nothing', () => {
    it('⛔ the plan-phase recorder is reached from four places and writes the plan phase only', () => {
      const host_ = mainSource('runtime-host.ts')
      expect(host_.match(/recordPlanPhase\(/g) ?? [], 'a fifth plan-phase call site').toHaveLength(
        4,
      )
      const recorder = host_.slice(
        host_.indexOf('private recordPlanPhase('),
        host_.indexOf('private recordPlanPhase(') + 700,
      )
      expect(recorder).toContain('startPlanMode')
      expect(recorder).toContain('endPlanMode')
      for (const forbidden of ['proposal', 'Proposal', 'createProject', 'bringItIntoExistence']) {
        expect(recorder, `recordPlanPhase reaches ${forbidden}`).not.toContain(forbidden)
      }
    })
  })

  describe('§4 · no surface restates a capability the descriptor owns', () => {
    const ipcSource = (): string => readFileSync(join(here, '../src/shared/runtime-ipc.ts'), 'utf8')

    it('the launch flag and both provider declarations bind to the adapters’ plan mappings', () => {
      const text = ipcSource()
      const planFlag = (source: string) => {
        const parsed = ts.createSourceFile('runtime-ipc.ts', source, ts.ScriptTarget.Latest, true)
        const inputs = parsed.statements.filter(
          (node): node is ts.InterfaceDeclaration =>
            ts.isInterfaceDeclaration(node) && node.name.text === 'CreateSessionInput',
        )
        expect(inputs).toHaveLength(1)
        const flags = inputs[0]!.members.filter(
          (node): node is ts.PropertySignature =>
            ts.isPropertySignature(node) && node.name.getText(parsed) === 'planMode',
        )
        expect(flags).toHaveLength(1)
        return flags[0]!
      }
      expect(planFlag(text).questionToken).toBeDefined()
      expect(planFlag(text).type?.kind).toBe(ts.SyntaxKind.BooleanKeyword)
      const wrongType = text.replace('planMode?: boolean', 'planMode?: string')
      expect(wrongType).not.toBe(text)
      expect(planFlag(wrongType).type?.kind).toBe(ts.SyntaxKind.StringKeyword)
      for (const provider of ['claude', 'codex'] as const) {
        expect(capabilitiesFor(provider)).toBe(providerDescriptor(provider).capabilities)
        expect(capabilitiesFor(provider).planMode.state).toBe('available')
      }
      const runtime = join(here, '../../../packages/runtime/src')
      const mapping = (file: string, name: string): string => {
        const source = readFileSync(join(runtime, file), 'utf8')
        const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
        const functions = parsed.statements.filter(
          (node): node is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(node) && node.name?.text === name,
        )
        expect(functions).toHaveLength(1)
        expect(functions[0]!.body).toBeDefined()
        return functions[0]!.body!.getText(parsed)
      }
      expect(mapping('claude/claude-runtime.ts', 'permissionModeFor')).toContain(
        "return planMode ? 'plan' : 'default'",
      )
      expect(mapping('codex/codex-runtime.ts', 'planPhaseOf')).toContain(
        "options.planModeEnded === true ? 'left' : 'planning'",
      )
      expect(mapping('codex/codex-runtime.ts', 'collaborationModeFor')).toContain(
        "mode: phase === 'planning' ? 'plan' : 'default'",
      )
    })

    it('⚠️ no file outside the capability descriptors calls Codex plan mode unwired', () => {
      const text = ipcSource()
      expect(text).not.toMatch(/Codex[^.]{0,80}no plan mode/i)
      expect(text).not.toMatch(/adapter still ignores/i)
    })
  })
})
