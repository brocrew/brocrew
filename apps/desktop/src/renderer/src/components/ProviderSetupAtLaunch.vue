<script setup lang="ts">
import { onMounted, ref, shallowRef, watchEffect } from 'vue'
import type {
  ApiKeyStatus,
  Provider,
  ProviderCapabilityMap,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { useProfileSignIn, type ProfileSignIn } from '../composables/useProfileSignIn'
import { readProviderSetup, type ProviderSetupSays } from '../lib/provider-setup'
import { isReady, type SetupFacts } from '../lib/provider-setup-steps'
import { keyCantBeRead, unreadableKeySays } from '../lib/saved-key'
import { readableError } from '../lib/session-record'

defineProps<{ capabilities: ProviderCapabilityMap | null }>()

const emit = defineEmits<{
  openProviders: []
  startConversation: []
}>()

const providers = Object.keys(PROVIDER_NAME) as Provider[]

const versions = shallowRef<Readonly<Record<Provider, ProviderVersion>> | null>(null)
const setup = shallowRef<Readonly<Partial<Record<Provider, ProviderSetupSays>>> | null>(null)
const setupRead = ref(false)
const keys = shallowRef<Partial<Record<Provider, ApiKeyStatus>>>({})
const keysRead = ref(false)
const signIns = Object.fromEntries(
  providers.map((provider) => [provider, useProfileSignIn(provider, DEFAULT_PROFILE_ID)]),
) as Record<Provider, ProfileSignIn>

let decided = false

async function readVersions(): Promise<void> {
  try {
    versions.value = await window.api.runtime.providerVersions()
  } catch (error) {
    const reason = readableError(error)
    versions.value = Object.fromEntries(
      providers.map((provider) => [provider, { version: null, reason }]),
    ) as Record<Provider, ProviderVersion>
  }
}

async function readKeys(): Promise<void> {
  const read: Partial<Record<Provider, ApiKeyStatus>> = {}
  await Promise.all(
    providers.map(async (provider) => {
      try {
        read[provider] = await window.api.runtime.apiKeyStatus({ provider })
      } catch {
        // No key fact: nothing is said about a key.
      }
    }),
  )
  keys.value = read
  keysRead.value = true
}

function factsOf(provider: Provider): SetupFacts {
  const key = keys.value[provider]
  return {
    version: versions.value?.[provider] ?? null,
    setup: setup.value === null ? undefined : setup.value[provider],
    auth: signIns[provider].auth,
    keyRefused: key?.set === true && key.refusedForBilling !== undefined,
    keyUnreadable:
      key !== undefined && keyCantBeRead(key)
        ? unreadableKeySays(
            key,
            PROVIDER_NAME[provider],
            (signIns[provider].auth as { loginBehindTheKey?: boolean } | null)
              ?.loginBehindTheKey === true,
          )
        : null,
  }
}

watchEffect(() => {
  if (decided) return
  if (versions.value === null || !setupRead.value || !keysRead.value) return
  if (providers.some((provider) => signIns[provider].auth?.state === 'unknown')) return
  const ready = providers.map((provider) => isReady(factsOf(provider)))
  if (ready.some((one) => one === null)) return
  decided = true
  if (ready.every((one) => one === false)) emit('openProviders')
})

onMounted(() => {
  void readVersions()
  void readProviderSetup().then((said) => {
    setup.value = said
    setupRead.value = true
  })
  void readKeys()
  for (const provider of providers) void signIns[provider].check()
})
</script>

<template><span hidden aria-hidden="true" /></template>
