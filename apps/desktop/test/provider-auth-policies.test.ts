import { describe, expect, it, vi } from 'vitest'
import { CodexRefusedItsSignInError } from '@brobot2/runtime'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import * as registry from '../src/main/providers'

type Account = { readonly email: string; readonly organization?: string }
type HandleFacts = {
  account?: () => Account | null | undefined
  signInTag?: () => string | null
}
type Identity =
  | { readonly kind: 'account'; readonly account: Account }
  | { readonly kind: 'tag'; readonly tag: string; readonly launchOnly?: true }
  | null
  | undefined
type Notice = {
  readonly type: string
  readonly provider?: Provider
  readonly category?: string
  readonly label?: string
  readonly degradedFrom?: string
  readonly passing?: boolean
  readonly source?: unknown
  readonly running?: unknown
  readonly ended?: unknown
  readonly dropped?: unknown
}
interface Policy {
  readonly identity: {
    launch(handle: HandleFacts): Identity
    limit(handle: HandleFacts): Identity
  }
  readonly copy: {
    readonly carriesAcceptedAfterAccountChange: boolean
    same(one: unknown, other: unknown): boolean
    refused(error: unknown): unknown | null
  }
  readonly protocol: {
    refusedGive(event: Notice): boolean
    reopenedGive(event: Notice): boolean
  }
}
function policies(): Readonly<Record<Provider, Policy>> {
  const found = Reflect.get(registry, 'providerAuthPolicies') as
    Readonly<Record<Provider, Policy>> | undefined
  expect(found, 'the provider authentication policy projection').toBeDefined()
  if (found === undefined) throw new Error('Provider authentication policies are absent')
  return found
}

describe('provider authentication policy facts', () => {
  it('shares the exact policies with bound modules without reading a program, home or key', () => {
    const unread = vi.fn((): never => {
      throw new Error('No launch work during binding')
    })
    const modules = registry.createProviderModules(
      () => ({
        managedRoot: '/fictional/homes',
        defaultProfile: 'fern',
        homeOf: unread,
        profiles: unread,
        assertMayOpen: unread,
      }),
      {
        claude: { runtime: { program: unread }, home: {}, auth: { key: unread } },
        codex: { runtime: { command: unread }, home: {}, auth: { command: unread } },
      },
    )
    const definitions = policies()
    for (const provider of SUPPORTED_PROVIDERS)
      expect(Reflect.get(modules[provider], 'authPolicy')).toBe(definitions[provider])
    expect(unread).not.toHaveBeenCalled()
  })

  it('keeps a pending account distinct from a missing account and returns unsalted facts', () => {
    const own = policies().claude.identity
    const account = { email: 'fern@example.invalid', organization: 'fictional-org' }
    const tag = vi.fn(() => 'fictional-launch')
    expect(own.launch({ account: () => undefined, signInTag: tag })).toBeUndefined()
    expect(own.limit({ account: () => undefined, signInTag: tag })).toBeNull()
    expect(tag).not.toHaveBeenCalled()
    expect(own.launch({ account: () => account, signInTag: tag })).toEqual({
      kind: 'account',
      account,
    })
    expect(own.limit({ account: () => account, signInTag: tag })).toEqual({
      kind: 'account',
      account,
    })
    expect(tag).not.toHaveBeenCalled()
    expect(own.launch({ account: () => null, signInTag: tag })).toEqual({
      kind: 'tag',
      tag: 'fictional-launch',
      launchOnly: true,
    })
    expect(own.launch({ signInTag: tag })).toEqual({
      kind: 'tag',
      tag: 'fictional-launch',
      launchOnly: true,
    })
    expect(own.limit({ account: () => null, signInTag: tag })).toBeNull()
    expect(own.launch({})).toBeNull()
  })

  it('reads only the launched tag for Codex, including on the nonwaiting limit path', () => {
    const account = vi.fn((): never => {
      throw new Error('The tag policy must not ask for account facts')
    })
    for (const read of [policies().codex.identity.launch, policies().codex.identity.limit]) {
      expect(read({ account, signInTag: () => 'fictional-tag' })).toEqual({
        kind: 'tag',
        tag: 'fictional-tag',
      })
      expect(read({ account })).toBeNull()
    }
    expect(account).not.toHaveBeenCalled()
  })

  it('compares opaque copies without treating a missing copy as equal', () => {
    const copy = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n }
    const own = policies().codex.copy
    expect(own.carriesAcceptedAfterAccountChange).toBe(true)
    expect(policies().claude.copy.carriesAcceptedAfterAccountChange).toBe(false)
    expect(own.same(copy, { ...copy })).toBe(true)
    for (const field of ['dev', 'ino', 'size', 'mtimeNs'] as const)
      expect(own.same(copy, { ...copy, [field]: copy[field] + 1n }), field).toBe(false)
    expect(own.same(null, null)).toBe(false)
    expect(own.same(copy, null)).toBe(false)
    expect(own.same(undefined, copy)).toBe(false)
    expect(own.refused(new Error('fictional failure'))).toBeNull()
    expect(own.refused(new CodexRefusedItsSignInError('fictional refusal', copy))).toBe(copy)
    expect(policies().claude.copy.same(copy, copy)).toBe(false)
    expect(
      policies().claude.copy.refused(new CodexRefusedItsSignInError('fictional', copy)),
    ).toBeNull()
  })

  it('recognizes only the existing native housekeeping notices', () => {
    const refused = [
      'thread/status/changed',
      'mcpServer/startupStatus/updated',
      'account/rateLimits/read',
    ]
    const reopened = [
      ...refused,
      'remoteControl/status/changed',
      'account/updated',
      'skills/changed',
      'thread/goal/cleared',
    ]
    const own = policies().codex.protocol
    for (const label of reopened) {
      const event = { type: 'unknown', provider: 'codex' as const, category: 'lifecycle', label }
      expect(own.refusedGive(event), label).toBe(refused.includes(label))
      expect(own.reopenedGive(event), label).toBe(true)
      expect(policies().claude.protocol.refusedGive(event)).toBe(false)
      expect(policies().claude.protocol.reopenedGive(event)).toBe(false)
      for (const changed of [
        { ...event, label: 'future/notice' },
        { ...event, provider: 'claude' as const },
        { ...event, type: 'error' },
        { ...event, category: 'other' },
        { ...event, passing: true },
        { ...event, degradedFrom: 'fictional' },
      ]) {
        expect(own.refusedGive(changed)).toBe(false)
        expect(own.reopenedGive(changed)).toBe(false)
      }
    }
    const echo = {
      type: 'unknown',
      provider: 'codex' as const,
      category: 'echo',
      label: 'userMessage',
    }
    expect(own.refusedGive(echo)).toBe(true)
    expect(own.reopenedGive(echo)).toBe(false)
    expect(own.refusedGive({ ...echo, passing: true })).toBe(false)
    expect(own.refusedGive({ ...echo, degradedFrom: 'fictional' })).toBe(false)
    expect(own.refusedGive({ ...echo, label: 'futureMessage' })).toBe(false)
  })

  it('rejects opaque evidence that is not a native copy', () => {
    const copy = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n }
    const same = policies().codex.copy.same
    for (const foreign of [
      42,
      'fictional',
      {},
      { dev: 1n, ino: 2n },
      { ...copy, size: 3 },
      { ...copy, mtimeNs: '4' },
    ]) {
      expect(same(foreign, foreign)).toBe(false)
      expect(same(copy, foreign)).toBe(false)
    }
  })

  it('owns the complete empty terminal-list startup notice', () => {
    const own = policies().codex.protocol
    const empty = {
      type: 'background_work',
      source: 'thread/backgroundTerminals/list',
      running: [],
    }
    expect(own.reopenedGive(empty)).toBe(true)
    expect(own.reopenedGive({ ...empty, dropped: 0 })).toBe(true)
    expect(own.refusedGive(empty)).toBe(false)
    expect(policies().claude.protocol.reopenedGive(empty)).toBe(false)
    for (const changed of [
      { ...empty, type: 'unknown' },
      { ...empty, source: 'future/notice' },
      { ...empty, running: undefined },
      { ...empty, running: [{}] },
      { ...empty, ended: {} },
      { ...empty, dropped: 1 },
      { ...empty, provider: 'codex' as const },
      { ...empty, label: undefined },
    ])
      expect(own.reopenedGive(changed)).toBe(false)
  })
})


describe('provider-owned setup and renewal facts', () => {
  it('keeps the current setup and renewed-login sentence in its provider', () => {
    const claude = registry.providerAuthPolicies.claude
    const codex = registry.providerAuthPolicies.codex
    const setup = Reflect.get(claude, 'setup') as ((platform: NodeJS.Platform, program: () => string | null) => unknown) | undefined
    expect(setup).toBeTypeOf('function')
    expect(setup?.('win32', () => 'C:\\Fictional\\claude.exe')).toMatchObject({
      tool: 'Claude Code', shell: 'PowerShell', signInCommand: "& 'C:\\Fictional\\claude.exe'",
    })
    expect(Reflect.get(codex, 'setup')?.('darwin', () => { throw new Error('Codex has no installed setup program') })).toBeNull()
    expect(Reflect.get(claude, 'renewedNotice')).toBe('BroCrew renewed your Claude Code login by running `claude` once.')
    expect(Reflect.get(codex, 'renewedNotice')).toBeNull()
  })
})
