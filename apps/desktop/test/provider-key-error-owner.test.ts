import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const main = new URL('../src/main/', import.meta.url)

describe('provider key error ownership', () => {
  it.each(['claude', 'codex'])(
    '%s can report an unreadable key without loading the key vault',
    (provider) => {
      const file = `providers/${provider}/index.ts`
      const source = ts.createSourceFile(
        file,
        readFileSync(new URL(file, main), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      const vaultImports = source.statements.flatMap((node) =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.endsWith('/runtime/api-keys')
          ? [node.moduleSpecifier.text]
          : [],
      )
      expect(vaultImports).toEqual([])
    },
  )
})

it('keeps the vault error export identical to the shared error constructor', async () => {
  const neutral = await import('../src/main/providers/api-key-error')
  const vault = await import('../src/main/runtime/api-keys')
  expect(vault.ApiKeyUnreadableError).toBe(neutral.ApiKeyUnreadableError)
  const error = new neutral.ApiKeyUnreadableError('claude')
  expect(error).toBeInstanceOf(vault.ApiKeyUnreadableError)
  expect(error.name).toBe('ApiKeyUnreadableError')
  expect(error.provider).toBe('claude')
  expect(error.message).toBe('Saved key can’t be read, save it again in Settings.')
})
