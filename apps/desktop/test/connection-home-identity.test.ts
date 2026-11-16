import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveProviderHome,
  listProviderHomes,
  HOME_FOLDER,
  providerHomesRoot,
} from '../src/main/connections/homes'

let userData: string
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'fictional-connection-homes-'))
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

it('keeps the legacy local home unchanged when no connection is supplied', () => {
  expect(deriveProviderHome(userData, { profileId: 'fern', provider: 'codex' })).toBe(
    join(providerHomesRoot(userData), HOME_FOLDER, 'fern', 'codex'),
  )
})

it('two connection ids on the same profile and provider name different stable homes', () => {
  const a = { profileId: 'fern', provider: 'codex' as const, connectionId: 'fictional-server-a' }
  const b = { ...a, connectionId: 'fictional-server-b' }
  expect(deriveProviderHome(userData, a)).not.toBe(deriveProviderHome(userData, b))
  expect(deriveProviderHome(userData, { ...a })).toBe(deriveProviderHome(userData, a))
})

it('opaque connection ids differing in case do not collapse on the Mac filesystem', () => {
  const a = { profileId: 'fern', provider: 'claude' as const, connectionId: 'Fictional-server' }
  const b = { ...a, connectionId: 'fictional-server' }
  const first = deriveProviderHome(userData, a)
  const second = deriveProviderHome(userData, b)
  expect(first.toLowerCase()).not.toBe(second.toLowerCase())
  mkdirSync(first, { recursive: true })
  mkdirSync(second, { recursive: true })
  writeFileSync(join(first, 'state.txt'), 'first')
  writeFileSync(join(second, 'state.txt'), 'second')
  expect(readFileSync(join(first, 'state.txt'), 'utf8')).toBe('first')
  expect(readFileSync(join(second, 'state.txt'), 'utf8')).toBe('second')
})

it('home discovery carries the actual connection identity rather than assigning the default', () => {
  const a = { profileId: 'fern', provider: 'codex' as const, connectionId: 'fictional-server-a' }
  const b = { ...a, connectionId: 'fictional-server-b' }
  const first = deriveProviderHome(userData, a)
  const second = deriveProviderHome(userData, b)
  expect(first).not.toBe(second)
  mkdirSync(first, { recursive: true })
  mkdirSync(second, { recursive: true })
  expect(listProviderHomes(userData)).toEqual(
    expect.arrayContaining([
      { ...a, path: first },
      { ...b, path: second },
    ]),
  )
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: both built-in modes keep the original native home without moving state`, () => {
    const old = deriveProviderHome(userData, { profileId: 'fern', provider })
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'state.txt'), 'existing fictional state')
    for (const method of ['sign-in', 'api-key'] as const) {
      const identity = { profileId: 'fern', provider, connectionId: `${provider}:${method}` }
      const home = deriveProviderHome(userData, identity)
      expect(home).toBe(old)
      expect(readFileSync(join(home, 'state.txt'), 'utf8')).toBe('existing fictional state')
    }
    expect(listProviderHomes(userData)).toEqual([{ profileId: 'fern', provider, path: old }])
  })
}

it('home enumeration ignores malformed connection folders and unknown providers', () => {
  const profile = join(providerHomesRoot(userData), HOME_FOLDER, 'fern')
  const old = deriveProviderHome(userData, { profileId: 'fern', provider: 'codex' })
  mkdirSync(old, { recursive: true })
  for (const encoded of ['zz', 'a', 'ff', Buffer.from('codex:sign-in').toString('hex')]) {
    mkdirSync(join(profile, 'connections', encoded, 'codex'), { recursive: true })
  }
  mkdirSync(
    join(
      profile,
      'connections',
      Buffer.from('fictional-server').toString('hex'),
      'unknown-provider',
    ),
    { recursive: true },
  )
  mkdirSync(join(profile, 'unknown-provider'), { recursive: true })
  expect(listProviderHomes(userData)).toEqual([{ profileId: 'fern', provider: 'codex', path: old }])
})
