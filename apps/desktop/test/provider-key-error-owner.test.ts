import { expect, it } from 'vitest'

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
