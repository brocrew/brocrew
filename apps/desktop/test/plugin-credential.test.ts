import { expect, it } from 'vitest'
import { createPrivatePluginPort } from '../src/main/plugins/managed-transport'

it.each([
  ['quote', 'a'.repeat(63) + '"'],
  ['backslash', 'a'.repeat(63) + '\\'],
  ['uppercase', 'A'.repeat(64)],
  ['non-hex', 'g'.repeat(64)],
  ['short', 'a'.repeat(63)],
  ['long', 'a'.repeat(65)],
  ['trailing newline', 'a'.repeat(64) + '\n'],
])('refuses a %s downstream credential before any connection', (_label, credential) => {
  expect(() => createPrivatePluginPort({ url: 'http://127.0.0.1:1/mcp', credential })).toThrow(
    'Plugin unavailable. Try again.',
  )
})
