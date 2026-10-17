<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watchEffect } from 'vue'
import type {
  ApiKeyStatus,
  CapabilityStatus,
  Provider,
  ProviderCapabilityMap,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { useProfileSignIn, type ProfileSignIn } from '../composables/useProfileSignIn'
import { useKeyAsked } from '../composables/useKeyAsked'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { readProviderSetup, type ProviderSetupSays } from '../lib/provider-setup'
import { isReady, type SetupFacts } from '../lib/provider-setup-steps'
import { keyCantBeRead, unreadableKeySays } from '../lib/saved-key'
import { readableError } from '../lib/session-record'
import OverlayHost from './OverlayHost.vue'
import ProviderSetupWizard from './ProviderSetupWizard.vue'

/**
 * Setup at launch: once the facts are read, the first provider that isn't ready opens its setup —
 * a program missing or warning, no usable sign-in, or a refused key. Nothing opens when every
 * provider is ready. Closing it is remembered, so it opens by itself only until then; the
 * Providers screen's Set up opens it again any time.
 */
const props = defineProps<{ capabilities: ProviderCapabilityMap | null }>()

const emit = defineEmits<{
  openProviders: []
  startConversation: []
}>()

const providers = Object.keys(PROVIDER_NAME) as Provider[]
const dismissed = usePersistentToggle('brobot2.providerSetupDismissed', false)

const versions = shallowRef<Readonly<Record<Provider, ProviderVersion>> | null>(null)
const setup = shallowRef<Readonly<Partial<Record<Provider, ProviderSetupSays>>> | null>(null)
const setupRead = ref(false)
const keys = shallowRef<Partial<Record<Provider, ApiKeyStatus>>>({})
const keysRead = ref(false)
const signIns = Object.fromEntries(
  providers.map((provider) => [provider, useProfileSignIn(provider, DEFAULT_PROFILE_ID)]),
) as Record<Provider, ProfileSignIn>

const open = ref<Provider | null>(null)
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
              ?.loginBehindTheKey !== false,
          )
        : null,
  }
}

const PENDING: CapabilityStatus = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
}

/** While a key is saved the host refuses a sign-in or a copy, so neither is offered. */
function capability(provider: Provider, which: 'signIn' | 'reprovisionAuth'): CapabilityStatus {
  const status = props.capabilities?.[provider]?.[which] ?? PENDING
  if (status.state !== 'available' || keys.value[provider]?.set !== true) return status
  return {
    state: 'absent',
    reason: `An API key is saved for ${PROVIDER_NAME[provider]}. Remove it in Providers to use a sign-in instead.`,
    checkedAgainst: 'the saved API key',
  }
}

watchEffect(() => {
  if (decided || dismissed.value) return
  if (versions.value === null || !setupRead.value || !keysRead.value) return
  const ready = providers.map((provider) => isReady(factsOf(provider)))
  if (ready.some((one) => one === null)) return
  decided = true
  open.value = providers.find((_, at) => ready[at] === false) ?? null
})

const other = computed(() => {
  const now = open.value
  const waiting = providers.find(
    (provider) => provider !== now && isReady(factsOf(provider)) === false,
  )
  return waiting ?? null
})

async function recheck(provider: Provider): Promise<void> {
  await Promise.all([readVersions(), signIns[provider].check(), readKeys()])
}

/** Which provider's key field the Providers page should take the person to. */
const keyAsked = useKeyAsked()

function close(): void {
  open.value = null
  dismissed.value = true
}

onMounted(() => {
  if (dismissed.value) return
  void readVersions()
  void readProviderSetup().then((said) => {
    setup.value = said
    setupRead.value = true
  })
  void readKeys()
  for (const provider of providers) void signIns[provider].check()
})
</script>

<template>
  <OverlayHost v-if="open" :label="`Set up ${PROVIDER_NAME[open]}`" @close="close">
    <ProviderSetupWizard
      :key="open"
      :provider="open"
      :mark-kind="props.capabilities?.[open]?.mark?.kind ?? null"
      :version="factsOf(open).version"
      :setup="factsOf(open).setup"
      :auth="signIns[open].auth"
      :key-refused="factsOf(open).keyRefused"
      :key-unreadable="factsOf(open).keyUnreadable"
      :sign-in="capability(open, 'signIn')"
      :reprovision="capability(open, 'reprovisionAuth')"
      :busy="signIns[open].busy"
      :notice="signIns[open].notice"
      :recheck="() => recheck(open!)"
      :other="other"
      @close="close"
      @start="
        () => {
          close()
          emit('startConversation')
        }
      "
      @sign-in="signIns[open!].signIn()"
      @cancel-sign-in="signIns[open!].cancel()"
      @reprovision="signIns[open!].copyMachineSignIn()"
      @open-key="
        () => {
          keyAsked = open
          close()
          emit('openProviders')
        }
      "
      @set-up-other="open = other"
    />
  </OverlayHost>
</template>
