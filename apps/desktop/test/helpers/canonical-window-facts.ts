import { expect } from 'vitest'

/** Independent engines have independent opaque reuse handles, but identical canonical facts. */
export function canonicalWindowFacts(value: unknown) {
  expect(value).toEqual(expect.objectContaining({kind:'routes',cacheToken:expect.any(String)}))
  const {cacheToken, ...facts} = value as Record<string, unknown>
  expect(cacheToken).toEqual(expect.any(String))
  return facts
}
