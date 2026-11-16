import { afterEach, beforeEach } from 'vitest'
import { computed, nextTick } from 'vue'
import { compatibilityConnectionId, providerRecord, type Provider } from '@brobot2/shared'
import type { RunningConversation } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { providerConnectionFixtures, providersBridge } from '../../look/fixtures/providers'
import { unmountAll } from './harness'
import { createModelLists } from '../lib/provider-launch-fixture'
import type { ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { providePlaceNavigator } from '../../src/renderer/src/composables/usePlaceNavigator'

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

export function providerCardReadingProps(readings: readonly ProviderUsageReading[] | null) {
  return {
    readings,
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    loginMoved: 0,
    lists: createModelLists(() => ({
      modelList: window.api.runtime.modelList,
      addHandAddedModel: window.api.runtime.addHandAddedModel,
      deleteHandAddedModel: window.api.runtime.deleteHandAddedModel,
    })),
  }
}

export function provideIdlePlaceNavigator(): void {
  providePlaceNavigator({
    backTo: computed(() => null),
    forwardTo: computed(() => null),
    back: () => {},
    forward: () => {},
  })
}

/** Fictional sign-in connections with one running agent on each. */
export function runningSignInFixtures(): RunningConversation[] {
  return providerConnectionFixtures()
    .filter((row) => row.authMethod === 'sign-in')
    .map((row) => ({
      sessionId: `fictional-${row.id}`,
      provider: row.provider,
      connectionId: row.id,
      state: { is: 'idle' as const },
    }))
}

/** These fictional readings belong to the fixture's compatibility sign-ins. */
export function attributedUsageFixtures(
  readings: Readonly<Record<Provider, readonly ProviderUsageReading[]>>,
): Record<Provider, ProviderUsageReading[]> {
  return providerRecord((provider) =>
    readings[provider].map((reading) => ({
      ...reading,
      connectionId: compatibilityConnectionId(provider, 'sign-in'),
    })),
  )
}
