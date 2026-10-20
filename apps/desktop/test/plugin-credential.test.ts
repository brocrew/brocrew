import { expect, it } from 'vitest'
import { createPrivatePluginPort } from '../src/main/plugins/managed-transport'
import { noPrivateCredential } from './fixtures/plugin-provider-fixture'

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

it.each(['"', '\\'])('the fixture detects decoded strings and keys containing %s', (suffix) => {
  const secret = 'fictional-'.repeat(4) + suffix + '-fern'.repeat(6)
  for (const value of [{ nested: [{ text: secret }] }, { [secret]: true }])
    expect(() => noPrivateCredential(value, secret)).toThrow('Private plugin credential escaped')
  expect(() => noPrivateCredential({ text: 'Fictional fern' }, secret)).not.toThrow()
})
