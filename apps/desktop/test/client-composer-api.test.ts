import { expect, it, vi } from 'vitest'
import type { ClientComposerApi } from '../src/shared/client-composer-api'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('retains the composer receiver, original promises, refusal and rejection without eager transport reads', async () => {
  const failure = new Error('Fictional picker failed')
  const rejected = Promise.reject<never>(failure)
  const refused = Promise.resolve({ refusal: 'Fictional clipboard is empty' })
  const composer: ClientComposerApi = {
    chooseAttachment() {
      expect(this).toBe(composer)
      return rejected
    },
    pathForDroppedFile() {
      expect(this).toBe(composer)
      return '/fictional/fern.txt'
    },
    handDroppedPaths: async () => [],
    pasteImage() {
      expect(this).toBe(composer)
      return refused
    },
  }
  const resolve = vi.fn(() => composer)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider transport read expected')
    },
    () => undefined,
    undefined,
    undefined,
    resolve,
  )
  expect(resolve).not.toHaveBeenCalled()
  expect(api.composer).toBe(composer)
  const picking = api.composer?.chooseAttachment()
  expect(picking).toBe(rejected)
  await expect(picking).rejects.toBe(failure)
  expect(api.composer?.pasteImage()).toBe(refused)
  await expect(refused).resolves.toEqual({ refusal: 'Fictional clipboard is empty' })
})
