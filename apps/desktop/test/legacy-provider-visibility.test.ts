import { afterEach, expect, it, vi } from 'vitest'
import { PROVIDER_DESCRIPTORS, visibleProviderDescriptors } from '@brobot2/shared'
import { useVisibleProviders } from '../src/renderer/src/composables/useVisibleProviders'

afterEach(() => vi.unstubAllGlobals())

it.each([null, 'false', 'true', 'not-a-boolean'])(
  'preserves legacy stored visibility %s and descriptors',
  (stored) => {
    const getItem = vi.fn(() => stored)
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem, setItem })
    const descriptors = [
      ...PROVIDER_DESCRIPTORS,
      { ...PROVIDER_DESCRIPTORS[0]!, id: 'fictional', displayName: 'Fictional', debugOnly: true },
    ]
    expect(useVisibleProviders(() => descriptors).value).toEqual(
      visibleProviderDescriptors(stored === 'true', descriptors),
    )
    expect(getItem).toHaveBeenCalledWith('brobot2.debugMode')
    expect(setItem).not.toHaveBeenCalled()
  },
)
