<script setup lang="ts">
import { readProviderSetup } from '../lib/provider-setup'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import type {
  Provider,
  ProviderCapabilityMap,
  ProviderResources,
  ProviderUsageReading,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../../shared/runtime-ipc'
import type { ProviderDescriptor } from '@brobot2/shared'
import { useVisibleProviders } from '../composables/useVisibleProviders'
import { useKeyAsked } from '../composables/useKeyAsked'
import { aDialogIsOpen } from '../lib/a-dialog-is-open'
import { useModelLists } from '../composables/useModelLists'
import { createProviderAccess } from '../lib/provider-access'
import { providerStanding, providerRowDetail } from '../lib/provider-row'
import { atItsLimitSays } from '../lib/usage-limit'
import { limitsDisplayWords } from '../lib/limits-display'
import type { ProviderLimitsView } from '../lib/persons-queue'
import type { ModelLists } from '../lib/model-lists'
import { readableError } from '../lib/session-record'
import { useMinuteClock } from '../composables/useMinuteClock'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { OPEN_AT_FIRST, PROVIDER_PARTS, partKey, type ProviderPart } from '../lib/provider-parts'
import ProviderCard from './ProviderCard.vue'
import KeptRules from './KeptRules.vue'
import ProviderMark from './ProviderMark.vue'
import ProviderOptions from './ProviderOptions.vue'
import OverlayHost from './OverlayHost.vue'

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
    /** Registry injection for preview and provider-extension controls. */
    descriptors?: readonly ProviderDescriptor[]
    capabilities: ProviderCapabilityMap | null
    /** The usage warnings — the queue's own view of the walls; `null` before the first look. */
    warnings: ProviderLimitsView | null
    clock: number
    lists?: ModelLists
    embedded?: boolean
    setupProvider?: Provider | null
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

const descriptors = useVisibleProviders(() => props.descriptors)
const providers = computed(() => descriptors.value.map((descriptor) => descriptor.id as Provider))
const accesses = new Map<Provider, ReturnType<typeof createProviderAccess>>()
const modelLists = computed(() => props.lists ?? useModelLists())
function accessFor(provider: Provider) {
  let access = accesses.get(provider)
  if (!access) {
    access = createProviderAccess(
      () => provider,
      () => emit('authChanged', DEFAULT_PROFILE_ID),
      () => window.api.runtime,
    )
    accesses.set(provider, access)
  }
  return access
}
function readAccess(provider: Provider): void {
  const access = accessFor(provider)
  void access.check()
  void access.readKey()
}
function readVisibleAccess(): void {
  for (const provider of providers.value) {
    readAccess(provider)
    void modelLists.value.read(provider, undefined, { once: true })
  }
}
const selected = ref<Provider | null>(null)
const surface = ref<HTMLElement | null>(null)
const drawerFrame = shallowRef<{
  top: number
  right: number
  width: number
  height: number
} | null>(null)
let frameObserver: ResizeObserver | null = null
function measureDrawer(): void {
  const box = surface.value?.getBoundingClientRect()
  if (!box || box.width <= 0 || box.height <= 0) return
  drawerFrame.value = {
    top: box.top,
    right: window.innerWidth - box.right,
    width: box.width,
    height: box.height,
  }
}
const drawerStyle = computed(() => {
  const frame = drawerFrame.value
  return frame === null
    ? undefined
    : {
        top: `${frame.top}px`,
        right: `${frame.right}px`,
        height: `${frame.height}px`,
        width: `min(${frame.width}px, clamp(var(--drawer-w-min), ${frame.width * 0.52}px, var(--drawer-w-max)))`,
      }
})
const selectedDescriptor = computed(
  () => descriptors.value.find((item) => item.id === selected.value) ?? null,
)
const providerCard = ref<InstanceType<typeof ProviderCard> | null>(null)
function openProvider(provider: Provider, event?: MouseEvent): void {
  if (event?.currentTarget instanceof HTMLElement) event.currentTarget.focus()
  measureDrawer()
  selected.value = provider
}
function closeProvider(): void {
  const provider = selected.value
  selected.value = null
  void nextTick(() => {
    if (aDialogIsOpen()) return
    const rows = surface.value?.querySelectorAll<HTMLButtonElement>('[data-cy="provider-row"]')
    Array.from(rows ?? [])
      .find((row) => row.dataset.provider === provider)
      ?.focus()
  })
}
watch(providers, () => {
  if (selected.value !== null && !providers.value.includes(selected.value)) selected.value = null
  if (mounted) readVisibleAccess()
})
watch(
  () => props.setupProvider,
  (provider) => {
    if (provider && providers.value.includes(provider)) selected.value = provider
  },
  { immediate: true },
)
const keyAsked = useKeyAsked()
watch(
  keyAsked,
  (provider) => {
    if (provider && providers.value.includes(provider)) selected.value = provider
  },
  { immediate: true },
)

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
      providers.value.map((provider) => [provider, { version: null, reason }]),
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
  measureDrawer()
  if (surface.value) {
    frameObserver = new ResizeObserver(measureDrawer)
    frameObserver.observe(surface.value)
  }
  window.addEventListener('resize', measureDrawer)
  void readVersions()
  void readUsage()
  readVisibleAccess()
  stopListening = window.api.runtime.onProvidersChanged((message) => {
    if (message.what === 'usage') {
      void readUsage()
      emit('usageMoved')
    } else {
      if (providers.value.includes(message.provider)) readAccess(message.provider)
      loginMoved.value = {
        ...loginMoved.value,
        [message.provider]: (loginMoved.value[message.provider] ?? 0) + 1,
      }
    }
  })
  document.addEventListener('visibilitychange', lookAgain)
  window.addEventListener('focus', lookAgain)
  window.addEventListener('blur', lookAgain)
  lookAgain()
})

onBeforeUnmount(() => {
  mounted = false
  frameObserver?.disconnect()
  window.removeEventListener('resize', measureDrawer)
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
function rowFacts(provider: Provider) {
  const condition = limitOf(provider)
  const reading = props.warnings?.display?.reading
  const atLimit =
    condition === null ? null : atItsLimitSays(condition, reading?.evaluatedAt ?? now.value)
  return {
    auth: accessFor(provider).auth.value,
    key: accessFor(provider).keyStatus.value,
    version: versions.value?.[provider] ?? null,
    atItsLimit:
      atLimit === null || !reading
        ? atLimit
        : limitsDisplayWords.condition(atLimit, reading.evaluatedAt),
  }
}
const standingOf = (provider: Provider) => providerStanding(rowFacts(provider))
const detailOf = (provider: Provider) =>
  providerRowDetail(rowFacts(provider), usage.value?.[provider] ?? null, now.value)
const configured = (provider: Provider) =>
  ['ready', 'at-limit'].includes(standingOf(provider)?.tone ?? '')
const markOf = (descriptor: ProviderDescriptor) =>
  props.capabilities?.[descriptor.id as Provider]?.mark?.kind ?? descriptor.capabilities.mark.kind
const runningOf = (provider: Provider) => {
  if (resourcesError.value !== null) return "Couldn't measure running agents"
  const count = resources.value?.[provider]?.running
  return count === undefined
    ? 'Reading running agents…'
    : `${count} ${count === 1 ? 'agent' : 'agents'} running`
}
</script>

<template>
  <!-- ⚑ Light paper, like every body surface inside `<main>`. -->
  <section
    ref="surface"
    class="providers-surface"
    data-cy="providers-screen"
    data-chat-theme="light"
  >
    <div class="page">
      <header class="page-head">
        <span v-if="!embedded" class="page-icon" aria-hidden="true"
          ><svg class="icon"><use href="#i-sliders" /></svg
        ></span>
        <h1 v-if="!embedded">Providers</h1>
        <p>
          Connect an AI service to start a conversation. Check your account and connection below.
        </p>
        <!-- ⚑ A3 · a fact of every workspace (A2): saved API keys live in its own database. Sign-ins
             are expected to be per workspace too, but not yet confirmed, so not said. -->
        <p class="per-workspace" data-cy="providers-per-workspace">
          API keys you save here are kept in this workspace only: another workspace asks for its
          own.
        </p>
      </header>

      <div class="provider-list">
        <button
          v-for="descriptor in descriptors"
          :key="descriptor.id"
          type="button"
          class="provider-row"
          data-cy="provider-row"
          :data-provider="descriptor.id"
          :aria-label="`${descriptor.displayName} provider`"
          :aria-expanded="selected === descriptor.id"
          aria-haspopup="dialog"
          @click="openProvider(descriptor.id as Provider, $event)"
        >
          <span class="provider-logo" :class="{ blossom: markOf(descriptor) === 'blossom' }">
            <ProviderMark
              :provider="descriptor.id"
              :name="descriptor.displayName"
              :kind="markOf(descriptor)"
            />
          </span>
          <span class="provider-copy">
            <span class="provider-row-heading"
              ><strong>{{ descriptor.displayName }}</strong
              ><span class="running"
                ><svg class="icon" aria-hidden="true"><use href="#i-bot" /></svg
                >{{ runningOf(descriptor.id as Provider) }}</span
              ></span
            >
            <span class="provider-detail">{{ detailOf(descriptor.id as Provider) }}</span>
          </span>
          <span
            v-if="standingOf(descriptor.id as Provider)"
            class="standing"
            :class="standingOf(descriptor.id as Provider)!.tone"
            data-cy="provider-standing"
            >{{ standingOf(descriptor.id as Provider)!.words }}</span
          >
          <svg class="icon row-chevron" aria-hidden="true"><use href="#i-chevron" /></svg>
        </button>
      </div>
    </div>
    <OverlayHost
      v-if="selectedDescriptor && selected && drawerFrame"
      :label="`${selectedDescriptor.displayName} provider`"
      @close="closeProvider"
    >
      <section class="provider-drawer" :style="drawerStyle" data-cy="provider-drawer">
        <header class="drawer-head">
          <span class="provider-logo" :class="{ blossom: markOf(selectedDescriptor) === 'blossom' }"
            ><ProviderMark
              :provider="selected"
              :name="selectedDescriptor.displayName"
              :kind="markOf(selectedDescriptor)"
          /></span>
          <h2>{{ selectedDescriptor.displayName }}</h2>
          <span
            v-if="standingOf(selected)"
            class="standing"
            data-cy="provider-standing"
            :class="standingOf(selected)!.tone"
            >{{ standingOf(selected)!.words }}</span
          >
          <ProviderOptions
            v-if="configured(selected)"
            :name="selectedDescriptor.displayName"
            @setup="providerCard?.beginSetup()"
          />
          <button
            type="button"
            class="drawer-close"
            :aria-label="`Close ${selectedDescriptor.displayName}`"
            @click="closeProvider"
          >
            <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
          </button>
        </header>
        <div class="drawer-body">
          <ProviderCard
            :key="selected"
            :provider="selected!"
            ref="providerCard"
            frameless
            :display-name="selectedDescriptor.displayName"
            :access="accessFor(selected!)"
            :setup-requested="
              props.setupProvider === selected || standingOf(selected!)?.tone === 'not-ready'
            "
            :capabilities="props.capabilities"
            :limit="limitOf(selected!)"
            :limits-read="limitsRead"
            :limits-display="props.warnings?.display"
            :clock="now"
            :version="versions?.[selected!] ?? null"
            :setup="setup === null ? undefined : setup[selected!]"
            :readings="usage === null ? null : (usage[selected!] ?? [])"
            :resources="resources?.[selected!] ?? null"
            :resources-paused="!looking"
            :resources-error="resourcesError"
            :login-moved="loginMoved[selected!] ?? 0"
            :lists="props.lists"
            :open="open"
            @toggle="(part) => (openParts[part].value = !openParts[part].value)"
            @reveal="(part) => (openParts[part].value = true)"
            @auth-changed="(profileId) => emit('authChanged', profileId)"
            :read-versions="readVersions"
            @checked-again="readVersions"
            @start-conversation="emit('startConversation')"
          />
          <KeptRules :providers="[selected]" />
        </div>
      </section>
    </OverlayHost>
  </section>
</template>

<style scoped>
.providers-surface {
  position: relative;
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
.provider-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.provider-row {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  min-width: 0;
  width: 100%;
  padding: var(--space-8) var(--space-10);
  text-align: left;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-card);
}
.provider-row[aria-expanded='true'] {
  border-color: var(--accent-border);
}
.provider-logo {
  display: grid;
  place-items: center;
  width: var(--space-28);
  height: var(--space-28);
  flex: none;
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-card);
  background: var(--accent-fill);
}
.provider-logo.blossom {
  border-color: var(--line);
  background: var(--paper-bg);
}
.provider-logo :deep(.provider-mark__claude) {
  background: var(--accent-text);
  color: var(--accent-fill);
}
.provider-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
}
.provider-row-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3) var(--space-8);
}
.provider-row-heading strong {
  font-size: var(--type-body);
}
.running {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--type-caption);
  color: var(--text-soft);
}
.running .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.provider-detail {
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}
.row-chevron {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--muted);
  flex: none;
}
.standing {
  flex: none;
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: var(--type-small);
  white-space: nowrap;
}
.standing.ready {
  color: var(--success-text);
  border-color: var(--success-border);
  background: var(--success-bg);
}
.standing.not-ready,
.standing.at-limit {
  color: var(--waiting);
  border-color: var(--waiting-card-border);
  background: var(--waiting-bg);
}
.provider-drawer {
  position: absolute;
  width: min(100%, clamp(var(--drawer-w-min), 52%, var(--drawer-w-max)));
  height: 100%;
  margin-left: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: var(--border-width) solid var(--line-strong);
  background: var(--drawer-solid, var(--panel));
  box-shadow: var(--shadow);
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-10);
  border-bottom: var(--border-width) solid var(--line);
  flex: none;
}
.drawer-head h2 {
  margin: 0;
  font-size: var(--type-title);
}
.drawer-close {
  display: grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  padding: 0;
  flex: none;
  margin-left: auto;
}
.drawer-head .provider-options + .drawer-close {
  margin-left: 0;
}
.drawer-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  padding: var(--space-10);
  overflow-y: auto;
  min-height: 0;
  flex: 1;
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
