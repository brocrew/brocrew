<script setup lang="ts">
import { readProviderSetup } from '../lib/provider-setup'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from 'vue'
import type {
  Provider,
  ProviderCapabilityMap,
  ProviderResources,
  ProviderUsageReading,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { ProviderLimitsView } from '../lib/persons-queue'
import type { ModelLists } from '../lib/model-lists'
import { readableError } from '../lib/session-record'
import { useMinuteClock } from '../composables/useMinuteClock'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { OPEN_AT_FIRST, PROVIDER_PARTS, partKey, type ProviderPart } from '../lib/provider-parts'
import ProviderCard from './ProviderCard.vue'
import KeptRules from './KeptRules.vue'

/**
 * # W4.10 · the Providers screen — one card per provider
 *
 * Show each provider's status and sign-in controls. Reach this screen from the rail,
 * palette, Settings and a sign-in problem on the new-conversation form.
 *
 * ⛔ **Providers are iterated, never named** (`provider-neutrality.test.ts`).
 *
 * ## ⚑ W4.26 · the provider-wide facts, read here once for both cards
 *
 * - **Versions**: on mount, on a person's Check again, and on a return to the window — so a program
 *   updated in a terminal shows. The host keeps each answer while the same file answers.
 * - **Usage**: on mount, and again on a `usage` notice — no timer.
 * - **What is running**: `providerResources()` is read-driven, so this screen asks every
 *   {@link SAMPLE_MS} — ⛔ **only while it is mounted, the window is in front and the page is
 *   visible**. A sample is asked only after the last one answered, so two never overlap. Nothing runs
 *   when nobody is looking: the CPU fix this follows must not be undone by a screen left open.
 * - **Notices**: `onProvidersChanged` while mounted, unsubscribed on unmount.
 */
const props = withDefaults(
  defineProps<{
    capabilities: ProviderCapabilityMap | null
    /** The usage warnings — the queue's own view of the walls; `null` before the first look. */
    warnings: ProviderLimitsView | null
    clock: number
    lists?: ModelLists
    embedded?: boolean
  }>(),
  { lists: undefined, embedded: false },
)

const emit = defineEmits<{
  authChanged: [profileId: string]
  /** ⚑ W4.63 · a provider's usage moved: the walls (and so *at its limit*) are worth reading now. */
  usageMoved: []
  /** A provider's setup reached Ready and the person chose to start a conversation. */
  startConversation: []
}>()

const providers = Object.keys(PROVIDER_NAME) as Provider[]

/**
 * Which parts of the cards are open, one state per part for every card, so a fold keeps them level.
 * Remembered on this computer.
 */
const openParts = Object.fromEntries(
  PROVIDER_PARTS.map((part) => [part, usePersistentToggle(partKey(part), OPEN_AT_FIRST[part])]),
) as Record<ProviderPart, Ref<boolean>>
const open = computed(() =>
  Object.fromEntries(PROVIDER_PARTS.map((part) => [part, openParts[part].value])),
)

/* ------------------------------------------------------------------ provider-wide facts */

const versions = shallowRef<Readonly<Record<Provider, ProviderVersion>> | null>(null)
const usage = shallowRef<Readonly<Record<Provider, readonly ProviderUsageReading[]>> | null>(null)
const resources = shallowRef<Readonly<Record<Provider, ProviderResources>> | null>(null)
const resourcesError = ref<string | null>(null)
/** ⚑ Per provider, moved on each `login` notice — the card asks its login and key again. */
const loginMoved = ref<Partial<Record<Provider, number>>>({})

/** How each tool is installed and signed in here; `null` while main reports none. */
const setup = shallowRef<Awaited<ReturnType<typeof readProviderSetup>>>(null)

/** Which read is the newest, so an older one that answers late never draws over it. */
let versionsAsked = 0

/**
 * The programs as this computer has them now: their versions, and the setup facts main words from
 * the same lookup, such as the sign-in command with the program's full path. Both are read again
 * whenever the versions are, so a program installed from the setup steps is named by its path.
 */
async function readVersions(): Promise<void> {
  const mine = ++versionsAsked
  void readProviderSetup().then((said) => {
    // A read that failed keeps the facts already in hand.
    if (said !== null && mine === versionsAsked) setup.value = said
  })
  let read: Readonly<Record<Provider, ProviderVersion>>
  try {
    read = await window.api.runtime.providerVersions()
  } catch (error) {
    const reason = readableError(error)
    read = Object.fromEntries(
      providers.map((provider) => [provider, { version: null, reason }]),
    ) as Record<Provider, ProviderVersion>
  }
  if (mine === versionsAsked) versions.value = read
}

async function readUsage(): Promise<void> {
  try {
    usage.value = await window.api.runtime.providerUsage()
  } catch {
    // ⚑ The last good answer stays; a refused read is asked again at the next notice.
  }
}

/** ⚑ How often what is running is sampled while a person is looking (the host lists at most this often). */
const SAMPLE_MS = 5_000

let timer: ReturnType<typeof setTimeout> | null = null
let sampling = false
let mounted = false
/** ⚑ Whether a person can see this screen: mounted, the window in front, the page visible. */
const looking = ref(false)
/** ⚑ Whether a person has seen it since it mounted, so a return to it is told from the first look. */
let seenBefore = false

function canSee(): boolean {
  return mounted && document.visibilityState === 'visible' && document.hasFocus()
}

async function sample(): Promise<void> {
  if (sampling) return
  sampling = true
  try {
    resources.value = await window.api.runtime.providerResources()
    resourcesError.value = null
  } catch (error) {
    resourcesError.value = readableError(error)
  } finally {
    sampling = false
  }
  // ⛔ The next one only after this one answered, and only while someone is still looking.
  if (looking.value && timer === null) timer = setTimeout(tick, SAMPLE_MS)
}

function tick(): void {
  timer = null
  if (looking.value) void sample()
}

/** ⚑ Start or stop sampling as the window comes to the front or leaves it. */
function lookAgain(): void {
  const now = canSee()
  if (now === looking.value) return
  looking.value = now
  if (now) {
    void sample()
    // ⚑ Back at the window after updating a program in a terminal: its version is read again.
    if (seenBefore) void readVersions()
    seenBefore = true
  } else if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

let stopListening: (() => void) | null = null

onMounted(() => {
  mounted = true
  void readVersions()
  void readUsage()
  stopListening = window.api.runtime.onProvidersChanged((message) => {
    if (message.what === 'usage') {
      void readUsage()
      emit('usageMoved')
    } else
      loginMoved.value = {
        ...loginMoved.value,
        [message.provider]: (loginMoved.value[message.provider] ?? 0) + 1,
      }
  })
  document.addEventListener('visibilitychange', lookAgain)
  window.addEventListener('focus', lookAgain)
  window.addEventListener('blur', lookAgain)
  lookAgain()
})

onBeforeUnmount(() => {
  mounted = false
  stopListening?.()
  document.removeEventListener('visibilitychange', lookAgain)
  window.removeEventListener('focus', lookAgain)
  window.removeEventListener('blur', lookAgain)
  looking.value = false
  if (timer !== null) clearTimeout(timer)
  timer = null
})

/** The window's clock ticks only while something waits; a reset said as "in 2 h" must still move. */
const minute = useMinuteClock()
const now = computed(() => Math.max(props.clock, minute.value))

const limitsRead = computed(() => (props.warnings === null ? null : !props.warnings.unread))

function limitOf(provider: Provider) {
  return props.warnings?.walls.find((wall) => wall.provider === provider) ?? null
}
</script>

<template>
  <!-- ⚑ Light paper, like every body surface inside `<main>`. -->
  <section class="providers-surface" data-cy="providers-screen" data-chat-theme="light">
    <div class="page">
      <header class="page-head">
        <span v-if="!embedded" class="page-icon" aria-hidden="true"
          ><svg class="icon"><use href="#i-sliders" /></svg
        ></span>
        <h1 v-if="!embedded">Providers</h1>
        <p>
          Whether each one is ready to run your agents, and on which login. New conversations run on
          what you see here.
        </p>
        <!-- ⚑ A3 · a fact of every workspace (A2): saved API keys live in its own database. Sign-ins
             are expected to be per workspace too, but not yet confirmed, so not said. -->
        <p class="per-workspace" data-cy="providers-per-workspace">
          API keys you save here are kept in this workspace only: another workspace asks for its
          own.
        </p>
      </header>

      <div class="cards">
        <ProviderCard
          v-for="provider in providers"
          :key="provider"
          :provider="provider"
          :capabilities="props.capabilities"
          :limit="limitOf(provider)"
          :limits-read="limitsRead"
          :limits-display="props.warnings?.display"
          :clock="now"
          :version="versions?.[provider] ?? null"
          :setup="setup === null ? undefined : setup[provider]"
          :readings="usage === null ? null : (usage[provider] ?? [])"
          :resources="resources?.[provider] ?? null"
          :resources-paused="!looking"
          :resources-error="resourcesError"
          :login-moved="loginMoved[provider] ?? 0"
          :lists="props.lists"
          :open="open"
          @toggle="(part) => (openParts[part].value = !openParts[part].value)"
          @reveal="(part) => (openParts[part].value = true)"
          @auth-changed="(profileId) => emit('authChanged', profileId)"
          :read-versions="readVersions"
          @checked-again="readVersions"
          @start-conversation="emit('startConversation')"
        />
      </div>

      <KeptRules :providers="providers" />
    </div>
  </section>
</template>

<style scoped>
.providers-surface {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.providers-surface > * {
  image-rendering: auto;
}
.page {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-8) var(--space-24);
  overflow-y: auto;
  gap: var(--space-10);
}
/* Never shrunk below its words when the page is taller than the window. */
.page-head {
  position: relative;
  flex: none;
  padding-left: calc(var(--space-28) + var(--space-12));
  min-height: var(--space-28);
}
.page-icon,
.debug-icon {
  position: absolute;
  display: grid;
  place-items: center;
  width: var(--space-28);
  height: var(--space-28);
  left: 0;
  top: 0;
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-card);
  background: var(--accent-fill);
  color: var(--accent);
}
.page-icon .icon {
  width: var(--icon-display);
  height: var(--icon-display);
}
.page-head h1 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-display);
  font-weight: var(--fw-bold);
}
.page-head p {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-body);
  line-height: var(--leading-relaxed);
}
.page-head .per-workspace {
  color: var(--text-soft);
}
/* Each card spans the rows of this grid as its own (a subgrid), one row per part, so a part starts
   at the same height in both cards whatever the other parts hold. */
.cards {
  display: grid;
  flex: none;
  align-items: stretch;
  column-gap: var(--space-10);
  row-gap: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.debug {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-7) var(--space-8) var(--space-7) calc(var(--space-24) + var(--space-16));
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  gap: var(--space-3);
}
.debug-icon {
  top: var(--space-6);
  left: var(--space-6);
  width: var(--space-24);
  height: var(--space-24);
}
.debug h2 {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}
.switch {
  display: flex;
  align-items: center;
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-small);
  gap: var(--space-5);
  line-height: var(--leading-relaxed);
}
.switch input {
  flex: none;
  accent-color: var(--accent);
}
</style>
