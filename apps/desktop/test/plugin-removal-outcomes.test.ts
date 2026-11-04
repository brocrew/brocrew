import { expect, it } from 'vitest'
import { pluginRemovalOutcome, pluginRemovalNotice } from '../src/shared/plugin-settings'

it('reports manifest-owned private data and cleanup facts without inferring account logout', () => {
  const kept = { data: 'kept', cleanup: 'completed' } as const
  expect(pluginRemovalOutcome(kept)).toEqual(kept)
  expect(pluginRemovalNotice('Fictional pebbles', kept)).toBe(
    "Fictional pebbles's local data was kept.",
  )
  const warning = { data: 'deleted', cleanup: 'unconfirmed' } as const
  expect(pluginRemovalOutcome(warning)).toEqual(warning)
  expect(pluginRemovalNotice('Fictional pebbles', warning)).toBe(
    "Fictional pebbles's local data was deleted. Plugin cleanup was not confirmed.",
  )
  expect(pluginRemovalOutcome({ data: 'kept', cleanup: 'not-requested' })).toEqual({
    data: 'kept',
    cleanup: 'not-requested',
  })
})
it('keeps the legacy removal reader while refusing conflicting or invented cleanup facts', () => {
  expect(pluginRemovalOutcome({ data: 'deleted', logout: 'confirmed' })).toEqual({
    data: 'deleted',
    logout: 'confirmed',
  })
  for (const value of [
    { data: 'kept', logout: 'confirmed' },
    { data: 'deleted', cleanup: 'completed', logout: 'confirmed' },
    { data: 'kept', cleanup: 'replayed' },
    { data: 'deleted' },
  ])
    expect(pluginRemovalOutcome(value)).toBeNull()
})
