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
