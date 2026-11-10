import { describe, expect, it } from 'vitest'
import { DRAWER_TABS, TAB_OF_THE_SETTINGS } from '../src/renderer/src/lib/drawer'
import { CHANGEABLE_LIVE_IN, providerIsFixed } from '../src/renderer/src/lib/front-door-words'
import { SUPPORTED_PROVIDERS } from '../../../packages/runtime/src'
import { providerName } from '../src/shared/runtime-ipc'

describe('"model and approvals you can change later, in the Agent tab" — the two live controls', () => {
  it('and the sentence names them together, once, for every provider', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const said = providerIsFixed(provider)
      expect(said).toContain(providerName(provider))
      expect(said, 'the wire id reached a sentence a person reads').not.toContain(provider)
      expect(said).toContain(CHANGEABLE_LIVE_IN)
      expect(said.split(CHANGEABLE_LIVE_IN)).toHaveLength(2)
    }
  })

  it('…and it names the tab by reading the strip, so a rename carries', () => {
    const tab = DRAWER_TABS.find((each) => each.id === TAB_OF_THE_SETTINGS)
    expect(tab, 'the settings tab is gone, so the sentence points at nothing').toBeDefined()
    expect(CHANGEABLE_LIVE_IN).toBe(`the ${tab?.label} tab`)
    expect(tab?.hint).toBe('Agent settings, current work and anything waiting for you.')
  })
})
