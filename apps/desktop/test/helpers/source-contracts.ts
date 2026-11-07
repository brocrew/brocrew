import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

export function sourceOf(root: string, file: string): string {
  return readFileSync(join(root, file), 'utf8')
}

export function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Keep spacing between code when removing comments from an absence check. */
export function spacedCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/** Find the named declaration before checking anything inside its body. */
export function bodyOf(source: string, signature: string, closes = '\n  }'): string {
  const from = source.indexOf(signature)
  if (from === -1) throw new Error(`no such declaration: ${signature}`)
  const to = source.indexOf(closes, from)
  if (to === -1) throw new Error(`unterminated declaration: ${signature}`)
  return source.slice(from, to)
}

export function expectTypeImports(
  source: string,
  allowedValues: readonly string[] = [],
  file?: string,
): void {
  for (const match of source.matchAll(/^import .*$/gm)) {
    const line = match[0]
    expect(
      line.startsWith('import type ') || allowedValues.includes(line),
      file === undefined ? line : `${file}: ${line}`,
    ).toBe(true)
  }
}

const RETIRED_DEADLINES = {
  'worker-question': [
    'askBoundMs',
    'escalationWindowMs',
    'proposalBoundMs',
    'positiveWindow',
  ],
  'quiet-work': [
    'watchForEscalation',
    'armEscalationLook',
    'writeWhatIsDue',
    'escalationWindowMs',
    'work_quiet',
  ],
  'answer-windows': ['positiveWindow', 'escalationWindowMs', 'proposalBoundMs'],
  'three-waits': ['proposalBoundMs', 'escalationWindowMs'],
} as const

/** The canonical dependency owner must exist and keep each retired deadline absent. */
export function expectNoDeadlineDeps(
  mainRoot: string,
  rule: keyof typeof RETIRED_DEADLINES,
): void {
  const source = sourceOf(join(mainRoot, 'runtime'), 'host-dependencies.ts')
  const code =
    rule === 'worker-question' || rule === 'three-waits' ? spacedCode(source) : codeOnly(source)
  expect(code).toContain('export interface RuntimeHostDeps {')
  for (const gone of RETIRED_DEADLINES[rule]) {
    if (rule === 'three-waits') expect(code).not.toContain(gone)
    else expect(code, gone).not.toContain(gone)
  }
}
