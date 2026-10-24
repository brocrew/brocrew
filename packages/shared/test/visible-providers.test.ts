import { describe, expect, it } from 'vitest'
import * as shared from '../src/providers'
import type { ProviderDescriptor } from '../src/providers'

// The assertion stays RED on the base without turning a missing export into an import failure.
const visible = () => {
  const read = (
    shared as unknown as {
      visibleProviderDescriptors?: (
        debug: boolean,
        all?: readonly ProviderDescriptor[],
      ) => readonly ProviderDescriptor[]
    }
  ).visibleProviderDescriptors
  expect(read).toBeTypeOf('function')
  if (!read) throw new Error('visibility reader missing')
  return read
}
const fictional = (id: string, debugOnly = false): ProviderDescriptor => ({
  ...shared.PROVIDER_DESCRIPTORS[0],
  id,
  displayName: id,
  debugOnly,
})

describe('visible provider descriptors keep declaration order with experiments last', () => {
  it('uses the registry by default', () => {
    expect(visible()(false)).toEqual(shared.PROVIDER_DESCRIPTORS.filter((item) => !item.debugOnly))
  })
  it('hides debug-only entries and does not mutate the supplied registry', () => {
    const all = [fictional('lumen', true), fictional('cedar'), fictional('finch')]
    expect(visible()(false, all).map((item) => item.id)).toEqual(['cedar', 'finch'])
    expect(all.map((item) => item.id)).toEqual(['lumen', 'cedar', 'finch'])
  })
  it('keeps both groups stable when debug mode is on', () => {
    const all = [
      fictional('lumen', true),
      fictional('cedar'),
      fictional('wren', true),
      fictional('finch'),
    ]
    expect(visible()(true, all).map((item) => item.id)).toEqual(['cedar', 'finch', 'lumen', 'wren'])
  })
})
