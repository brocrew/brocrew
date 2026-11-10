import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import * as registry from '../src/main/providers'

describe('provider knowledge policies have one owner', () => {
  it('shares the exact stateless knowledge policies without doing launch work', () => {
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
    const knowledge = Reflect.get(registry, 'providerKnowledge') as
      Record<Provider, object> | undefined
    expect(knowledge).toBeDefined()
    if (knowledge === undefined) throw new Error('Provider knowledge policies are absent')
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const member of ['instructions', 'memory', 'skills', 'keptRules', 'snapshot']) {
        const policy: unknown = Reflect.get(knowledge[provider], member)
        expect(policy, `${provider}.${member}`).toBeTypeOf('object')
        expect(Reflect.get(modules[provider], member)).toBe(policy)
      }
    }
    expect(unread).not.toHaveBeenCalled()
  })
})
