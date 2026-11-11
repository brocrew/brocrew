import { describe, expect, it } from 'vitest'
import snapshot from './fixtures/providers.json'
import {
  PROVIDER_DESCRIPTORS,
  SUPPORTED_PROVIDERS,
  providerDescriptor,
  providerRecord,
} from '../src/providers'
import type { ProviderConnectionCapabilities } from '../src/provider-connections'
import { providerSchema } from '../src/provider-schema'

describe('the declared providers', () => {
  it('preserves the current provider facts and capabilities', () => {
    expect(PROVIDER_DESCRIPTORS).toEqual(snapshot)
    for (const descriptor of PROVIDER_DESCRIPTORS) {
      const connections: ProviderConnectionCapabilities = descriptor.connections
      expect(connections).toEqual(snapshot.find((row) => row.id === descriptor.id)?.connections)
    }
  })

  it('derives ids and boundary validation in declaration order', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(['claude', 'codex'])
    expect(providerSchema.options).toEqual(PROVIDER_DESCRIPTORS.map((item) => item.id))
    for (const id of SUPPORTED_PROVIDERS) {
      expect(providerSchema.parse(id)).toBe(id)
      expect(providerDescriptor(id).id).toBe(id)
      expect(Object.isFrozen(providerDescriptor(id).capabilities)).toBe(true)
    }
    expect(providerSchema.safeParse('probe').success).toBe(false)
  })

  it('creates a fresh value for each provider', () => {
    const rows = providerRecord((): string[] => [])
    rows.claude.push('one')
    expect(rows.codex).toEqual([])
    expect(Object.keys(rows)).toEqual(SUPPORTED_PROVIDERS)
  })
})
