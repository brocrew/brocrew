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

it('keeps a plugin warning and its ordinary MCP result through removal and user notice', () => {
  const result = {
    content: [
      { type: 'text', text: 'Fictional remote disconnect is unconfirmed; remove its old link.' },
    ],
    structuredContent: {
      status: 'warning',
      message: 'Fictional remote cleanup warning',
      extra: [1, 2],
    },
  }
  const outcome = { data: 'deleted', cleanup: 'completed', result } as const
  expect(pluginRemovalOutcome(outcome)).toEqual(outcome)
  expect(pluginRemovalNotice('Fictional pebbles', outcome)).toContain(
    'Fictional remote disconnect is unconfirmed; remove its old link.',
  )
})
