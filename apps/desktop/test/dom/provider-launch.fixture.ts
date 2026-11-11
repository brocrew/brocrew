import { afterEach, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { providersBridge } from '../../look/fixtures/providers'
import { unmountAll } from './harness'

export function providerLaunchFixture(): void {
  beforeEach(() => providersBridge())
  afterEach(() => {
    unmountAll()
    Reflect.deleteProperty(window, 'api')
  })
}

export async function settleProviderLaunch(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
