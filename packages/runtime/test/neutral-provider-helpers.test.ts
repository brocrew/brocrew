import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function importsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  return source.statements.flatMap((node) =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
      ? [node.moduleSpecifier.text]
      : [],
  )
}

describe('neutral provider helpers', () => {
  it('lets Claude read MCP forms without importing the Codex adapter', () => {
    expect(
      importsOf('claude/claude-runtime.ts').filter((path) => path.includes('/codex/')),
    ).toEqual([])
  })

  it('keeps managed plugin contracts independent of generated Codex protocol types', () => {
    expect(importsOf('managed-plugin-mcp.ts').filter((path) => path.includes('/codex/'))).toEqual(
      [],
    )
  })
})

it('preserves the old Codex form exports as the same functions and constants', async () => {
  const neutral = await import('../src/mcp-elicitation')
  const codex = await import('../src/codex/external-mcp')
  expect(codex.codexElicitation).toBe(neutral.mcpElicitation)
  for (const name of [
    'elicitationContent',
    'elicitationQuestions',
    'elicitationWords',
    'opensALink',
    'serverAsks',
    'SKIPPED',
    'BOOLEAN_CHOICES',
    'MAX_ELICITATION_URL',
  ] as const) {
    expect(codex[name]).toBe(neutral[name])
  }
})

it('preserves the image allow-list and settings bound across compatibility exports', async () => {
  const neutral = await import('../src/image-media-type')
  const images = await import('../src/codex/generated-image')
  const settings = await import('../src/settings-limits')
  const rules = await import('../src/claude/persisted-rules')
  expect(images.IMAGE_MEDIA_TYPES).toBe(neutral.IMAGE_MEDIA_TYPES)
  expect(images.imageMediaType).toBe(neutral.imageMediaType)
  expect(rules.MAX_SETTINGS_BYTES).toBe(settings.MAX_SETTINGS_BYTES)
  expect(neutral.imageMediaType('sample.PNG')).toBe('image/png')
  expect(neutral.imageMediaType('sample.svg')).toBeNull()
})

it('keeps the shared helpers outside adapter, SDK and composition imports', () => {
  for (const file of [
    'mcp-elicitation.ts',
    'json-value.ts',
    'image-media-type.ts',
    'settings-limits.ts',
  ]) {
    expect(
      importsOf(file).filter((path) => /(?:claude|codex|sdk|index)(?:\/|$)/i.test(path)),
    ).toEqual([])
  }
})
