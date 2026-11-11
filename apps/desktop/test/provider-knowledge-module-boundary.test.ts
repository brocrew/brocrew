import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import * as registry from '../src/main/providers'
import { unstartedProviderModules } from './helpers/unstarted-provider-modules'

describe('stateless provider policies have one owner', () => {
  it('bound modules share the exact knowledge, transcript and discovery policies without doing launch work', () => {
    const unread = vi.fn((): never => {
      throw new Error('No launch work during binding')
    })
    const modules = unstartedProviderModules(unread, '/fictional/homes')
    const knowledge = Reflect.get(registry, 'providerKnowledge') as
      Record<Provider, object> | undefined
    const definitions = Reflect.get(registry, 'providerDefinitions') as
      Readonly<Record<Provider, { transcripts: object; discovery: object }>> | undefined
    if (knowledge === undefined) throw new Error('Provider knowledge policies are absent')
    if (definitions === undefined) throw new Error('Provider definitions are absent')
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const member of ['instructions', 'memory', 'skills', 'keptRules', 'snapshot']) {
        const policy: unknown = Reflect.get(knowledge[provider], member)
        expect(policy, `${provider}.${member}`).toBeTypeOf('object')
        expect(Reflect.get(modules[provider], member)).toBe(policy)
      }
      for (const member of ['transcripts', 'discovery'] as const) {
        const policy = definitions[provider][member]
        expect(policy, `${provider}.${member}`).toBeTypeOf('object')
        expect(Reflect.get(modules[provider], member)).toBe(policy)
      }
    }
    expect(unread).not.toHaveBeenCalled()
  })
})
