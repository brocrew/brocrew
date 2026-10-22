import { describe, expect, it } from 'vitest'
import snapshot from './fixtures/providers.json'
import {
  PROVIDER_DESCRIPTORS,
  SUPPORTED_PROVIDERS,
  providerDescriptor,
  providerRecord,
  providerSchema,
} from '../src/providers'

describe('the declared providers', () => {
  it('preserves the current provider facts and capabilities', () => {
    expect(PROVIDER_DESCRIPTORS).toEqual(snapshot)
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
