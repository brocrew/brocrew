import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import * as registry from '../src/main/providers'

describe('provider transcript and discovery policies have one owner', () => {
  it('shares the exact stateless policy objects with bound modules without doing launch work', () => {
    const definitions = Reflect.get(registry, 'providerDefinitions') as
      Readonly<Record<Provider, { transcripts: object; discovery: object }>> | undefined
    expect(definitions).toBeDefined()
    if (definitions === undefined) throw new Error('Provider definitions are absent')
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
        claude: { runtime: { program: unread }, home: {}, auth: {} },
        codex: { runtime: { command: unread }, home: {}, auth: { command: unread } },
      },
    )
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(definitions[provider].transcripts).toBeTypeOf('object')
      expect(definitions[provider].discovery).toBeTypeOf('object')
      expect(Reflect.get(modules[provider], 'transcripts')).toBe(definitions[provider].transcripts)
      expect(Reflect.get(modules[provider], 'discovery')).toBe(definitions[provider].discovery)
    }
    expect(unread).not.toHaveBeenCalled()
  })
})
