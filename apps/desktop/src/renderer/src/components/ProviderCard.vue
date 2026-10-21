<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { PROVIDER_PARTS, type ProviderPart } from '../lib/provider-parts'
import type {
  ApiKeyStatus,
  AuthState,
  CapabilityStatus,
  Provider,
  ProviderCapabilityMap,
  ProviderResources,
  ProviderUsageReading,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import {
  A_STANDING_IN_A_WORD,
  A_STANDING_WARNS,
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
} from '../../../shared/runtime-ipc'
import type { ProviderCondition } from '../../../shared/provider-limit'
import {
  limitsDisplayLabel,
  limitsDisplayWords,
  type LimitsDisplayState,
} from '../lib/limits-display'
import { localFormat } from '../../../shared/local-time'
import { theListedRow } from '../../../shared/model-choice'
import { fullTime } from '../lib/clock'
import { modelField } from '../lib/model-field'
import { inTheListsSpelling, theFormStartsOn, type ModelLists } from '../lib/model-lists'
import { readableError } from '../lib/session-record'
import {
  atItsLimitSays,
  readingSays,
  readingStatus,
  readingTitle,
  timeGone,
  usageSays,
  usageTitle,
} from '../lib/usage-limit'
import { useModelLists } from '../composables/useModelLists'
import type { ProviderSetupSays } from '../lib/provider-setup'
import { keyCantBeRead as theKeyCantBeRead, unreadableKeySays } from '../lib/saved-key'
import { useKeyAsked } from '../composables/useKeyAsked'
import { isReady } from '../lib/provider-setup-steps'
import ProviderMark from './ProviderMark.vue'
import SignInPanel from './SignInPanel.vue'

/**
 * # W4.10 · one provider on the Providers screen
 *
 * ⚑ One provider, for BroBot's own profile — the one a new conversation runs on: whether it is
 * ready and on which login, its API key, its program's version, its usage, what its agents use right
 * now, and its models. ⚑ W4.26 · the screen reads the provider-wide facts (version, usage, what is
 * running, the change notices) and hands them down; the card reads the login and the key itself.
 *
 * 🔒 **The key field**: the key is in the field until it is sent, and the field is cleared as it is
 * sent. Nothing answers with the key, and nothing here logs it.
 *
 * ⛔ **No provider is named here**: every name is `PROVIDER_NAME`'s (`provider-neutrality.test.ts`).
 */
const props = withDefaults(
  defineProps<{
    setupRequested?: boolean
    provider: Provider
    capabilities: ProviderCapabilityMap | null
    /** This provider's usage warning, or `null` when it has sent none. */
    limit: ProviderCondition | null
    /** `null`: the warnings have not been read yet; `false`: the last read did not answer. */
    limitsRead: boolean | null
    limitsDisplay?: LimitsDisplayState
    clock: number
    /**
     * The program's version, `null` before the read lands. `program` says which one runs, from
     * where — one a person installed, or the copy BroBot carries — and how it stands against the
     * tested versions where a range applies.
     */
    version: ProviderVersion | null
    /** The newest reading per window — `null` before the read lands; `[]` is *no reading yet*. */
    readings: readonly ProviderUsageReading[] | null
    /** What its agents use right now — `null` before the first sample. */
    resources: ProviderResources | null
    /** ⚑ The screen stopped sampling: the window is not in front. */
    resourcesPaused: boolean
    /** Why the last sample failed, or `null`. */
    resourcesError: string | null
    /** ⚑ Moves when the provider says its login changed — the card asks again. */
    loginMoved: number
    /** Injectable for tests; the window's one holder otherwise. */
    lists?: ModelLists
    /**
     * How its tool is installed and signed in here: `null` when there is nothing to set up outside
     * BroBot, absent while main does not report it.
     */
    setup?: ProviderSetupSays | null
    /** Reads the program and its version again; resolves once it answered. */
    readVersions?: () => Promise<void>
    /** Which parts are open; a part not named is open. */
    open?: Readonly<Partial<Record<ProviderPart, boolean>>>
  }>(),
  { lists: undefined, setup: undefined, readVersions: undefined, open: undefined },
)

const markKind = computed(() => props.capabilities?.[props.provider]?.mark?.kind ?? null)

const emit = defineEmits<{
  /** A person pressed a part's heading: fold it, or open it. */
  toggle: [part: ProviderPart]
  /** A folded part has something wrong to say, so it asks to be opened. */
  reveal: [part: ProviderPart]
  /** A sign-in or a copy settled for this profile: what the window holds about it is old. */
  authChanged: [profileId: string]
  /** A person pressed Check again: the program and its version are read again with the login. */
  checkedAgain: []
  /** Setup reached Ready and the person chose to start a conversation. */
  startConversation: []
}>()

const name = computed(() => PROVIDER_NAME[props.provider])

const partIds = useId()
const isOpen = (part: ProviderPart): boolean => props.open?.[part] ?? true
const lists = computed(() => props.lists ?? useModelLists())

const PENDING: CapabilityStatus = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
}
/**
 * ⚑ **A saved key outranks a sign-in** — while one is saved, a sign-in or a copy is refused by the
 * host, so the panel offers neither and says why (an offer that could only refuse is not one).
 */
function whileAKeyIsSaved(status: CapabilityStatus): CapabilityStatus {
  if (status.state !== 'available' || keyStatus.value?.set !== true) return status
  return {
    state: 'absent',
    reason: `${
      keyStatus.value.inUse
        ? `An API key is saved for ${name.value}, and it is what ${name.value} runs on.`
        : `An API key is saved for ${name.value}.`
    }${loginBehindTheKey.value ? ' Remove it under “API key” below to use a sign-in instead.' : ''}`,
    checkedAgainst: 'the saved API key',
  }
}
const signIn = computed(() =>
  whileAKeyIsSaved(props.capabilities?.[props.provider]?.signIn ?? PENDING),
)
const reprovision = computed(() =>
  whileAKeyIsSaved(props.capabilities?.[props.provider]?.reprovisionAuth ?? PENDING),
)

/* ------------------------------------------------------------------ status */

const auth = ref<AuthState | null>(null)
const authBusy = ref<'idle' | 'checking' | 'copying' | 'signing-in'>('idle')
const authNotice = ref<string | null>(null)
/** Whether the notice above warns or refuses, rather than saying how a gesture is going. */
const authNoticeWarns = ref(false)

/** The notice a login gesture answers with, and whether it warns. */
function noticeSays(text: string | null, warns: boolean): void {
  authNotice.value = text
  authNoticeWarns.value = warns
}
/** ⚑ A check asked while a gesture was out — run once it settles, so no notice is lost. */
let checkAgain = false

/** ⛔ A plain literal each time — a reactive proxy cannot cross the bridge (361). */
const asked = (): { provider: Provider; profileId: string } => ({
  provider: props.provider,
  profileId: DEFAULT_PROFILE_ID,
})

async function withGesture(
  phase: 'checking' | 'copying' | 'signing-in',
  run: () => Promise<void>,
): Promise<void> {
  if (authBusy.value !== 'idle') return
  authBusy.value = phase
  try {
    await run()
  } finally {
    authBusy.value = 'idle'
    if (phase !== 'checking') emit('authChanged', DEFAULT_PROFILE_ID)
    // ⚑ A login notice that landed during the gesture — the host says it before its answer arrives.
    if (checkAgain) {
      checkAgain = false
      void check()
    }
  }
}

/** A person's Check again: the login, and the program and its version with it. */
async function aPersonChecksAgain(): Promise<void> {
  if (props.readVersions === undefined) {
    emit('checkedAgain')
    await check()
  } else {
    await Promise.all([props.readVersions(), check()])
  }
}

async function check(): Promise<void> {
  if (authBusy.value !== 'idle') {
    checkAgain = true
    return
  }
  await withGesture('checking', async () => {
    try {
      auth.value = await window.api.runtime.checkProviderAuth(asked())
    } catch (error) {
      auth.value = { state: 'unknown', reason: readableError(error) }
    }
  })
}

async function copyMachineSignIn(): Promise<void> {
  await withGesture('copying', async () => {
    noticeSays(null, false)
    try {
      const outcome = await window.api.runtime.reprovisionProviderAuth(asked())
      noticeSays(
        outcome === 'replaced'
          ? 'Copied your machine sign-in into this profile.'
          : 'Your machine sign-in is identical to the one already here, so nothing changed — it is expired on both.',
        outcome !== 'replaced',
      )
    } catch (error) {
      noticeSays(readableError(error), true)
    }
  })
  // ⚑ No check here: a copy that landed is a login notice, which asks again (`loginMoved`).
}

async function signInHere(): Promise<void> {
  await withGesture('signing-in', async () => {
    noticeSays('Finish signing in in your browser, then come back.', false)
    try {
      const result = await window.api.runtime.signInProvider(asked())
      auth.value = result.state
      noticeSays(
        result.success
          ? 'Signed in. This profile now has its own sign-in.'
          : (result.detail ?? 'The sign-in did not complete.'),
        !result.success,
      )
    } catch (error) {
      noticeSays(readableError(error), true)
    }
  })
}

async function cancelSignIn(): Promise<void> {
  noticeSays(null, false)
  try {
    await window.api.runtime.cancelProviderSignIn(asked())
  } catch (error) {
    noticeSays(readableError(error), true)
  }
}

/** ⚑ The plan in the provider's own word, as a person writes it: `max` → *Max*. */
const plan = computed(() => {
  const said = auth.value?.state === 'usable' ? auth.value.plan : undefined
  return said === undefined || said === '' ? null : `${said[0]!.toUpperCase()}${said.slice(1)}`
})

const dayFormat = localFormat({ day: 'numeric', month: 'long', year: 'numeric' })

/**
 * What a usable login runs on, with an expiry only where the provider gives one. BroBot runs on the
 * person's own login and keeps none of its own, so the line never says BroBot signed anyone in.
 */
const loginSays = computed<string | null>(() => {
  const state = auth.value
  if (state?.state !== 'usable') return null
  // A saved key this computer can't read starts nothing, so the card says only how to recover.
  if (keyCantBeRead.value) return null
  if (state.login === 'api-key') return `Runs on the saved API key.`
  const facts = [state.account, plan.value === null ? null : `${plan.value} plan`].filter(Boolean)
  const of = facts.length === 0 ? '' : ` (${facts.join(', ')})`
  const until = state.expiresAt === null ? '' : `, until ${dayFormat(state.expiresAt)}`
  return `Runs on your ${props.setup?.tool ?? name.value} login${of}${until}.`
})

const standing = computed<{ words: string; tone: 'ready' | 'not-ready' | 'unknown' }>(() => {
  // No program on this computer: a login beside it starts nothing.
  if (props.version?.program?.standing === 'missing')
    return { words: 'Not ready', tone: 'not-ready' }
  const state = auth.value
  if (state === null) return { words: 'Checking…', tone: 'unknown' }
  // A saved key outranks the sign-in, and one this computer can't read starts nothing.
  if (keyCantBeRead.value) return { words: 'Not ready', tone: 'not-ready' }
  // ⚑ W4.63 · signed in, but at its usage limit: "Ready" beside "At its limit" would contradict it.
  if (state.state === 'usable') {
    // Running on a key whose account can't pay: every turn on it fails.
    if (state.login === 'api-key' && keyRefusedSays.value !== null) {
      return { words: 'Not ready', tone: 'not-ready' }
    }
    return atItsLimit.value === null
      ? { words: 'Ready', tone: 'ready' }
      : { words: 'Signed in', tone: 'ready' }
  }
  if (state.state === 'unknown') return { words: 'Couldn’t check', tone: 'unknown' }
  return { words: 'Not ready', tone: 'not-ready' }
})

/* ------------------------------------------------------------------ API key */

const keyStatus = ref<ApiKeyStatus | null>(null)
/** A key is saved and this computer can't read it; one not yet read is not that. */
const keyCantBeRead = computed(() => theKeyCantBeRead(keyStatus.value))
const keyDraft = ref('')
const keyBusy = ref(false)
const keySaid = ref<{ text: string; tone: 'note' | 'warn' } | null>(null)
const keyEditing = ref(false)

async function readKey(): Promise<void> {
  try {
    keyStatus.value = await window.api.runtime.apiKeyStatus({ provider: props.provider })
  } catch (error) {
    keySaid.value = { text: readableError(error), tone: 'warn' }
  }
}

/**
 * 🔒 **The key leaves the field as it is sent** — the field is cleared before the call, and nothing
 * else keeps it. ⚑ A refusal says why in the host's words; the person pastes it again.
 * ⚑ No check here: a saved key is a login notice, which asks again (`loginMoved`).
 */
async function saveKey(): Promise<void> {
  if (keyBusy.value) return
  const key = keyDraft.value.trim()
  keyDraft.value = ''
  if (key === '') return
  keyBusy.value = true
  keySaid.value = null
  try {
    const changed = await window.api.runtime.setApiKey({ provider: props.provider, key })
    keyStatus.value = changed
    if (changed.refused !== undefined) {
      keySaid.value = { text: `The key wasn’t saved. ${changed.refused}`, tone: 'warn' }
    } else {
      keyEditing.value = false
      keySaid.value = {
        text: changed.notice ?? `Key saved. ${name.value}’s new conversations start on it.`,
        tone: 'note',
      }
    }
  } catch (error) {
    keySaid.value = { text: readableError(error), tone: 'warn' }
  } finally {
    keyBusy.value = false
  }
}

async function removeKey(): Promise<void> {
  if (keyBusy.value) return
  keyBusy.value = true
  keySaid.value = null
  try {
    const changed = await window.api.runtime.removeApiKey({ provider: props.provider })
    keyStatus.value = changed
    keySaid.value = {
      text:
        changed.notice ??
        `Key removed. ${name.value}’s new conversations start on its sign-in again.`,
      tone: 'note',
    }
  } catch (error) {
    keySaid.value = { text: readableError(error), tone: 'warn' }
  } finally {
    keyBusy.value = false
  }
}

/**
 * Whether a login sits behind the saved key, so removing the key leaves something to run on. Main
 * says `false` where there is none (a computer whose tool was never signed in); absent means it
 * does not say, and the usual words hold.
 */
const loginBehindTheKey = computed(() => {
  const state = auth.value as { loginBehindTheKey?: boolean } | null
  return state?.loginBehindTheKey !== false
})

const keyInUseSays = computed(() => {
  const status = keyStatus.value
  if (status === null) return ''
  if (status.readState === 'not-checked')
    return 'Saved. BroCrew will read the key when a conversation starts or you check it works.'
  if (status.unreadableReason === undefined && status.inUse) {
    return loginBehindTheKey.value
      ? `It outranks the sign-in: ${name.value}’s new conversations start on the key.`
      : `${name.value}’s conversations start on this key.`
  }
  return unreadableKeySays(status, name.value, loginBehindTheKey.value)
})

/** What pressing the check sends, said under it before it is pressed. */
const checkSpends = computed(() =>
  keyStatus.value?.aCheckSpendsAToken === true
    ? `Checking sends ${name.value} one short message, which costs a tiny amount.`
    : `Checking only asks ${name.value} for its model list, which costs nothing.`,
)

/**
 * What a start sends when the provider renews an expired login with a short message. Said only
 * while no key is saved, since a saved key is what a start runs on then.
 */
const renewalSends = computed(() =>
  props.capabilities?.[props.provider]?.loginRenewalMessage?.state === 'available' &&
  keyStatus.value !== null &&
  !keyStatus.value.set
    ? `When this login has expired, starting a conversation renews it by sending ${name.value} one short message.`
    : null,
)

/** ⚑ One real request to the provider — a few seconds, so the button says it is checking. */
const keyChecking = ref(false)
async function checkKey(): Promise<void> {
  if (keyBusy.value) return
  keyBusy.value = true
  keyChecking.value = true
  keySaid.value = null
  try {
    const said = await window.api.runtime.checkApiKey({ provider: props.provider })
    keySaid.value = said.ok
      ? {
          text:
            said.answeredARequest === true
              ? `The key works, and its account can pay: ${name.value} answered a one-token request on it.`
              : `The key works: ${name.value} answered.`,
          tone: 'note',
        }
      : { text: said.reason, tone: 'warn' }
  } catch (error) {
    keySaid.value = { text: readableError(error), tone: 'warn' }
  } finally {
    keyBusy.value = false
    keyChecking.value = false
    await readKey()
  }
}

/**
 * The saved key's account can't pay, said where the key is, with the ways out: credit for that
 * account, another key, or the login, where removing the key leaves one this provider runs on.
 * `null` while nothing has been refused.
 */
const keyRefusedSays = computed<string | null>(() => {
  const refused = keyStatus.value?.set === true ? keyStatus.value.refusedForBilling : undefined
  if (refused === undefined) return null
  const login = refused.aLoginRunsWithoutIt ? ', or remove it to run on the sign-in' : ''
  return (
    `A request on this key was refused at ${fullTime(refused.at)}: the account the key belongs ` +
    `to can’t pay for it. Add credit to that account, or replace the key${login}. This clears once ` +
    `a turn or a check on the key works.`
  )
})

function cancelKeyEdit(): void {
  keyDraft.value = ''
  keyEditing.value = false
}

/* ------------------------------------------------------------------ models */

const held = computed(() => lists.value.held(props.provider))
const list = computed(() => (held.value?.state === 'answered' ? held.value.list : null))

const listSays = computed(() => {
  const now = held.value
  if (now === null || now.state === 'asking') {
    return { message: `Reading ${name.value}’s models…`, tone: 'note' as const, remedy: null }
  }
  const catalogue =
    now.state === 'unread'
      ? { ok: false as const, reason: 'refused' as const, detail: now.why }
      : now.list.notAsked
  if (catalogue === null) return null
  return modelField({
    catalogue,
    profileExists: true,
    provider: name.value,
    signIn: signIn.value,
    reprovision: reprovision.value,
  })
})

const startsOn = computed(() => {
  const pair = theFormStartsOn(list.value)
  if (pair === null) return `${name.value}’s own default`
  const model = inTheListsSpelling(list.value, pair.model)
  return pair.effort === null ? model : `${model} · ${pair.effort}`
})
/**
 * ⚑ Why it is that pair, and how to change it. ⛔ Read-only by design: a new conversation starts on
 * the last pair a person picked, and there is no app-wide default to set here.
 */
const startsOnWhy = computed(() =>
  list.value?.lastPicked != null
    ? 'the last one you picked. Pick another on the new-conversation form to change it.'
    : 'until you pick another on the new-conversation form.',
)

const adding = ref(false)
const addName = ref('')
const modelBusy = ref(false)
const modelSaid = ref<string | null>(null)

async function addModel(): Promise<void> {
  const id = addName.value.trim()
  if (id === '' || modelBusy.value) return
  // A new operation's answer is news even when its words repeat the last one's.
  modelSaid.value = null
  if (list.value !== null && theListedRow(list.value.models, id) !== undefined) {
    modelSaid.value = `“${id}” is already in ${name.value}’s list.`
    return
  }
  modelBusy.value = true
  modelSaid.value = await lists.value.add(props.provider, id).finally(() => {
    modelBusy.value = false
  })
  if (modelSaid.value === null) {
    adding.value = false
    addName.value = ''
  }
}

async function removeModel(id: string): Promise<void> {
  if (modelBusy.value) return
  modelSaid.value = null
  modelBusy.value = true
  modelSaid.value = await lists.value.remove(props.provider, id).finally(() => {
    modelBusy.value = false
  })
}

function readModelsAgain(): void {
  void lists.value.read(props.provider)
}

/* ------------------------------------------------------------------ usage */

const usage = computed<{ text: string; title: string | null; tone: 'note' | 'warn' }>(() => {
  if (props.limitsDisplay !== undefined) {
    const display = props.limitsDisplay
    const reading = display.reading
    return {
      text:
        props.limit !== null && reading !== null
          ? limitsDisplayWords.condition(
              usageSays(props.limit, reading.evaluatedAt),
              reading.evaluatedAt,
            )
          : limitsDisplayLabel(display),
      title: reading === null ? null : limitsDisplayWords.lastReading(reading.evaluatedAt),
      tone: props.limit === null ? 'note' : 'warn',
    }
  }
  if (props.limit !== null) {
    return {
      text: usageSays(props.limit, props.clock),
      title: usageTitle(props.limit),
      tone: 'warn',
    }
  }
  if (props.limitsRead === null) return { text: 'Not read yet.', title: null, tone: 'note' }
  if (props.limitsRead === false) {
    return {
      text: 'BroCrew couldn’t read usage warnings just now. It tries again when something changes.',
      title: null,
      tone: 'warn',
    }
  }
  return { text: `No usage warning from ${name.value}.`, title: null, tone: 'note' }
})

// A dated display keeps the condition's words at the time its evidence was evaluated.
const atItsLimit = computed(() => {
  if (props.limit === null) return null
  const reading = props.limitsDisplay?.reading
  const words = atItsLimitSays(props.limit, reading?.evaluatedAt ?? props.clock)
  return words === null || reading === undefined || reading === null
    ? words
    : limitsDisplayWords.condition(words, reading.evaluatedAt)
})

/** ⚑ Each window's newest reading, in words — `null` before the read lands. */
const readingLines = computed(() =>
  props.readings === null
    ? null
    : props.readings.map((reading) => {
        const time = timeGone(reading, props.clock)
        return {
          key: reading.window,
          text: readingSays(reading, props.clock),
          status: readingStatus(reading, props.clock),
          title: readingTitle(reading, props.clock),
          time,
          paceTitle:
            time === null || reading.usedPercent === null
              ? ''
              : `${String(Math.round(reading.usedPercent))}% used; ${String(Math.round(time.fraction * 100))}% of the window’s time gone.`,
        }
      }),
)

/** ⚑ Bytes as a person reads them: MB under a gigabyte, else GB to a tenth. */
function memoryWords(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

/** ⚑ *"2 agents running · 1.2 GB memory · 34% CPU"* — one line, or why it can't be said. */
const resourcesSays = computed<{ text: string; tone: 'note' | 'warn' }>(() => {
  const now = props.resources
  if (now === null) {
    if (props.resourcesPaused) return { text: 'Shown while BroCrew is in front.', tone: 'note' }
    return props.resourcesError === null
      ? { text: 'Reading…', tone: 'note' }
      : { text: props.resourcesError, tone: 'warn' }
  }
  if (props.resourcesError !== null) {
    return { text: `Couldn’t measure just now: ${props.resourcesError}`, tone: 'warn' }
  }
  if (now.running === 0) return { text: 'No agents running.', tone: 'note' }
  const count = `${now.running} ${now.running === 1 ? 'agent' : 'agents'} running`
  if (now.rssBytes === null) return { text: `${count}. ${now.reason}`, tone: 'note' }
  return {
    text: `${count} · ${memoryWords(now.rssBytes)} memory · ${Math.round(now.cpuPercent)}% CPU`,
    tone: 'note',
  }
})
const resourcesTitle = computed(() =>
  props.resources === null
    ? undefined
    : `Measured ${fullTime(props.resources.at)}. 100% CPU is one full core.`,
)

/* ------------------------------------------------------------------ setup */

const settingUp = ref(false)
const setupKey = ref(false)
const setupExternal = ref(false)
const setupCopySays = ref<string | null>(null)
const setupStep = ref<1 | 2 | 3>(1)
const setupChecking = ref(false)
const setupBusy = computed(() => setupChecking.value || keyBusy.value || authBusy.value !== 'idle')
const canSetUpSignIn = computed(
  () =>
    keyStatus.value?.set === false &&
    (signIn.value.state === 'available' ||
      (props.capabilities?.[props.provider]?.signIn.state === 'absent' && Boolean(props.setup))),
)
function beginSetup(): void {
  setupStep.value = 1
  setupKey.value = false
  setupExternal.value = false
  setupCopySays.value = null
  settingUp.value = true
}
watch(
  () => props.setupRequested,
  (requested) => {
    if (!requested) return
    beginSetup()
    void nextTick(() =>
      document
        .querySelector<HTMLElement>(
          `[data-cy="provider-card"][data-provider="${props.provider}"] [data-cy="provider-inline-setup"] button`,
        )
        ?.focus(),
    )
  },
  { immediate: true },
)
function useSetupKey(): void {
  setupKey.value = true
  setupExternal.value = false
}
async function setupSignIn(): Promise<void> {
  if (setupBusy.value || !canSetUpSignIn.value) return
  setupKey.value = false
  if (signIn.value.state === 'available') await signInHere()
  else setupExternal.value = true
}
async function copySetupCommand(): Promise<void> {
  if (!props.setup) return
  try {
    await navigator.clipboard.writeText(props.setup.signInCommand)
    setupCopySays.value = 'Copied.'
  } catch {
    setupCopySays.value = 'Could not copy. Select the command and copy it yourself.'
  }
}
function closeSetup(): void {
  if (setupBusy.value) return
  keyDraft.value = ''
  settingUp.value = false
}
async function checkSetup(): Promise<void> {
  if (setupBusy.value) return
  setupChecking.value = true
  setupStep.value = 2
  try {
    if (setupKey.value && keyDraft.value.trim()) {
      await saveKey()
      if (keySaid.value?.tone === 'warn') return
    }
    if (keyStatus.value?.set) {
      await checkKey()
      if (keySaid.value?.tone === 'warn') return
    }
    await aPersonChecksAgain()
    await readKey()
    if (
      isReady({
        version: props.version,
        setup: props.setup,
        auth: auth.value,
        keyRefused: keyRefusedSays.value !== null,
        keyUnreadable: keyCantBeRead.value ? keyInUseSays.value : null,
      }) === true
    )
      setupStep.value = 3
    else
      noticeSays(
        auth.value?.state === 'usable'
          ? 'The provider program is not ready. Check its version below.'
          : 'Not connected yet. Sign in or check your API key, then try again.',
        true,
      )
  } finally {
    setupChecking.value = false
  }
}
const keyPart = ref<HTMLElement | null>(null)

/** The key lives on this card: close setup and put focus in its part. */
function toTheKeyField(): void {
  if (!isOpen('key')) emit('reveal', 'key')
  // After the dialog layer has given focus back to what opened it.
  void nextTick(() =>
    setTimeout(() => {
      keyPart.value?.scrollIntoView({ block: 'center' })
      keyPart.value?.querySelector<HTMLElement>('.part-body :is(input, button)')?.focus()
    }, 0),
  )
}

/** The setup window at launch asked for this provider's key field: go to it once it is drawn. */
const keyAsked = useKeyAsked()
watch(
  [keyAsked, () => keyStatus.value !== null],
  ([asked, read]) => {
    if (asked !== props.provider || !read) return
    keyAsked.value = null
    toTheKeyField()
  },
  { immediate: true },
)

/** ⚑ The provider said its login moved (a key, a sign-in, a copy): ask again. */
watch(
  () => props.loginMoved,
  () => {
    void check()
    void readKey()
  },
)

onMounted(() => {
  void check()
  void readKey()
  void lists.value.read(props.provider, undefined, { once: true })
})

/* ------------------------------------------------------------------ folding */

/**
 * What each part has to say that a person must not miss, or `null`. A part whose words change to
 * something new opens itself, though it was folded: a refusal that answers an operation after its
 * part was folded, a warning that arrives while it is folded, or one already there when the screen
 * is shown. Words a person has already seen stay folded if they fold the part again.
 *
 * - Login: a login that is not usable, and a sign-in, copy or cancel that failed or changed nothing.
 *   A notice that says how a gesture is going, or that it landed, opens nothing.
 * - API key: a refused save, a warning a key operation answers with, and a saved key not in use.
 * - Version: a program standing that warns, or one that could not be read.
 * - Usage: a usage warning (a provider at or near its limit, or warnings that could not be read).
 *   A window whose usage runs ahead of its time is a steady pace note and opens nothing.
 * - Running now: a sample that could not be measured.
 * - Models: a refused add or removal, a model already in the list, and a list that warns.
 *
 * Outside the parts, the card's top always shows: the at-limit line and the limits reading.
 */
const whatEachPartSays = computed<Record<ProviderPart, string | null>>(() => {
  const loginSays = [
    auth.value !== null && auth.value.state !== 'usable' && auth.value.state !== 'absent'
      ? auth.value.state
      : null,
    authNoticeWarns.value ? authNotice.value : null,
  ].filter((said): said is string => said !== null)
  const key = keyStatus.value
  const version = props.version
  return {
    login: loginSays.length === 0 ? null : loginSays.join(' · '),
    key:
      keyRefusedSays.value ??
      (keySaid.value?.tone === 'warn' ? keySaid.value.text : null) ??
      (key?.set === true && !key.inUse && key.readState !== 'not-checked'
        ? keyInUseSays.value
        : null),
    version:
      version === null
        ? null
        : version.program
          ? A_STANDING_WARNS[version.program.standing]
            ? version.program.said
            : null
          : version.version === null
            ? version.reason
            : null,
    usage: usage.value.tone === 'warn' ? usage.value.text : null,
    resources: resourcesSays.value.tone === 'warn' ? resourcesSays.value.text : null,
    models: modelSaid.value ?? (listSays.value?.tone === 'warn' ? listSays.value.message : null),
  }
})

watch(
  whatEachPartSays,
  (now, before) => {
    for (const part of PROVIDER_PARTS) {
      const said = now[part]
      if (said !== null && said !== before?.[part] && !isOpen(part)) emit('reveal', part)
    }
  },
  { immediate: true },
)
</script>

<template>
  <article
    class="card"
    data-cy="provider-card"
    :data-provider="props.provider"
    :style="{ '--card-rows': PROVIDER_PARTS.length + 1 }"
  >
    <!-- The card's first row: everything above its sections, however much of it there is. -->
    <div class="card-top">
      <header class="card-head">
        <span
          v-if="markKind"
          class="provider-logo"
          :class="{ 'provider-logo--blossom': markKind === 'blossom' }"
          aria-hidden="true"
        >
          <ProviderMark :provider="props.provider" :kind="markKind" />
        </span>
        <h2>{{ name }}</h2>
        <span class="standing" :class="standing.tone" data-cy="provider-standing">
          <svg v-if="standing.tone === 'ready'" class="icon" aria-hidden="true">
            <use href="#i-check" />
          </svg>
          <svg v-else-if="standing.tone === 'not-ready'" class="icon" aria-hidden="true">
            <use href="#i-alert" />
          </svg>
          {{ standing.words }}
        </span>
        <button
          type="button"
          class="provider-menu"
          disabled
          :aria-label="`${name} options unavailable`"
          title="Provider options are not available yet"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-more" /></svg>
        </button>
      </header>
      <p v-if="standing.tone !== 'ready'" class="line">
        {{
          props.version?.program?.from === 'carried'
            ? `${name} is included.`
            : `Set up ${props.setup?.tool ?? name}.`
        }}
        Sign in or use an API key.
      </p>
      <p
        v-if="atItsLimit"
        class="at-limit"
        role="status"
        :title="props.limit ? usageTitle(props.limit) : undefined"
        data-cy="provider-at-limit"
      >
        <svg class="icon" aria-hidden="true"><use href="#i-clock" /></svg>
        {{ atItsLimit }}
      </p>
      <div class="setup-entry">
        <button
          type="button"
          class="bb-button"
          :class="{ 'bb-button--primary': standing.tone !== 'ready' }"
          data-cy="provider-set-up"
          @click="beginSetup"
        >
          Set up {{ name }}
        </button>
      </div>

      <p v-if="limitsDisplay" data-cy="provider-limits-reading">
        {{ limitsDisplayLabel(limitsDisplay) }}
        <span v-if="limitsDisplay.reading && limitsDisplay.status !== 'ready'">
          · {{ limitsDisplayWords.lastReading(limitsDisplay.reading.evaluatedAt) }}
        </span>
      </p>
    </div>

    <section v-if="settingUp" class="part inline-setup" data-cy="provider-inline-setup">
      <div class="setup-heading">
        <h3>Set up {{ name }}</h3>
        <button
          type="button"
          class="bb-button bb-button--quiet"
          :disabled="setupBusy"
          @click="closeSetup"
        >
          Cancel
        </button>
      </div>
      <ol class="setup-steps" aria-label="Setup steps">
        <li :aria-current="setupStep === 1 ? 'step' : undefined">1 · Connect</li>
        <li :aria-current="setupStep === 2 ? 'step' : undefined">2 · Check</li>
        <li :aria-current="setupStep === 3 ? 'step' : undefined">3 · Done</li>
      </ol>
      <template v-if="setupStep !== 3">
        <p class="line">Sign in or use an API key.</p>
        <div class="actions">
          <button
            type="button"
            class="bb-button"
            data-cy="setup-sign-in"
            :disabled="setupBusy || !canSetUpSignIn"
            :title="!canSetUpSignIn && signIn.state !== 'available' ? signIn.reason : undefined"
            @click="setupSignIn"
          >
            Sign in
          </button>
          <button
            type="button"
            class="bb-button"
            data-cy="setup-use-key"
            :disabled="setupBusy"
            @click="useSetupKey"
          >
            Use an API key
          </button>
          <button
            v-if="authBusy === 'signing-in'"
            type="button"
            class="bb-button"
            @click="cancelSignIn"
          >
            Cancel sign-in
          </button>
        </div>
        <div v-if="setupExternal && props.setup" class="setup-command">
          <p class="line">
            Run this command in {{ props.setup.shell }}. Follow its sign-in, then come back here.
          </p>
          <code data-cy="setup-command">{{ props.setup.signInCommand }}</code>
          <button type="button" class="bb-button" data-cy="setup-copy" @click="copySetupCommand">
            Copy command
          </button>
          <p v-if="setupCopySays" class="line quiet" role="status">{{ setupCopySays }}</p>
        </div>
        <label v-if="setupKey" class="setup-key"
          >API key<input
            v-model="keyDraft"
            class="bb-input"
            type="password"
            autocomplete="off"
            :disabled="setupBusy"
            :placeholder="`Paste your ${name} API key`"
            data-cy="setup-key-input"
        /></label>
        <p v-if="setupKey || keyStatus?.set" class="line quiet">{{ checkSpends }}</p>
        <p v-if="signIn.state !== 'available' && !setupKey && !props.setup" class="line quiet">
          {{ signIn.reason }}
        </p>
        <p v-if="props.version?.program?.standing === 'missing'" class="line warn">
          {{ props.version.program.said
          }}<a
            v-if="props.setup?.install"
            :href="props.setup.install.docs"
            target="_blank"
            rel="noopener"
            >Install {{ name }}</a
          >
        </p>
        <div class="actions">
          <button
            type="button"
            class="bb-button bb-button--primary"
            data-cy="setup-check"
            :disabled="
              setupBusy ||
              !(setupExternal || auth?.state === 'usable' || keyStatus?.set || keyDraft.trim())
            "
            @click="checkSetup"
          >
            {{ setupChecking ? 'Checking…' : 'Check' }}
          </button>
        </div>
      </template>
      <template v-else
        ><p class="line" data-cy="setup-ready">{{ name }} is ready.</p>
        <button
          type="button"
          class="bb-button bb-button--primary"
          data-cy="setup-done"
          @click="closeSetup"
        >
          Done
        </button></template
      >
      <p v-if="authNotice" class="line" :class="{ warn: authNoticeWarns }" role="status">
        {{ authNotice }}
      </p>
      <p v-if="keySaid" class="line" :class="{ warn: keySaid.tone === 'warn' }" role="status">
        {{ keySaid.text }}
      </p>
    </section>

    <section v-if="!settingUp" class="part" data-cy="provider-status" :data-open="isOpen('login')">
      <h3>
        <button
          type="button"
          class="fold"
          :aria-expanded="isOpen('login')"
          :aria-controls="`${partIds}-login`"
          @click="emit('toggle', 'login')"
        >
          <svg class="icon section-icon" aria-hidden="true"><use href="#i-user" /></svg>Login<svg
            class="icon chevron"
            :class="{ folded: !isOpen('login') }"
            aria-hidden="true"
          >
            <use href="#i-chevron" />
          </svg>
        </button>
      </h3>
      <div v-show="isOpen('login')" :id="`${partIds}-login`" class="part-body">
        <template v-if="auth?.state === 'usable'">
          <p v-if="loginSays !== null" class="line" data-cy="provider-account">{{ loginSays }}</p>
          <div class="actions">
            <button type="button" :disabled="authBusy !== 'idle'" @click="aPersonChecksAgain()">
              <svg class="icon" aria-hidden="true"><use href="#i-refresh" /></svg>
              {{ authBusy === 'checking' ? 'Checking…' : 'Check again' }}
            </button>
            <button
              v-if="auth.login !== 'api-key'"
              type="button"
              disabled
              title="Sign out is not available yet"
            >
              Sign out
            </button>
          </div>
        </template>
        <p v-else-if="auth === null" class="line quiet">Asking {{ name }}…</p>
        <template v-else>
          <SignInPanel
            :state="auth"
            :sign-in="signIn"
            :reprovision="reprovision"
            :busy="authBusy"
            :notice="authNotice"
            @check="aPersonChecksAgain()"
            @reprovision="copyMachineSignIn"
            @sign-in="signInHere"
            @cancel-sign-in="cancelSignIn"
          />
          <p v-if="keyStatus !== null && !keyStatus.set" class="line" data-cy="provider-key-prompt">
            Or add an API key below.
          </p>
        </template>
        <p
          v-if="auth?.state === 'usable' && authNotice"
          class="line quiet"
          data-cy="provider-auth-notice"
        >
          {{ authNotice }}
        </p>
        <p v-if="renewalSends !== null" class="line quiet" data-cy="provider-login-renewal">
          {{ renewalSends }}
        </p>
      </div>
    </section>

    <section
      v-if="!settingUp"
      ref="keyPart"
      class="part"
      data-cy="provider-key"
      :data-open="isOpen('key')"
    >
      <h3>
        <button
          type="button"
          class="fold"
          :aria-expanded="isOpen('key')"
          :aria-controls="`${partIds}-key`"
          @click="emit('toggle', 'key')"
        >
          <svg class="icon section-icon" aria-hidden="true"><use href="#i-lock" /></svg>API key<svg
            class="icon chevron"
            :class="{ folded: !isOpen('key') }"
            aria-hidden="true"
          >
            <use href="#i-chevron" />
          </svg>
        </button>
      </h3>
      <div v-show="isOpen('key')" :id="`${partIds}-key`" class="part-body">
        <p v-if="keyStatus === null" class="line quiet">Reading…</p>
        <template v-else-if="keyStatus.set && !keyEditing">
          <p class="line" data-cy="provider-key-set">
            A key is set{{
              keyStatus.setAt === null ? '' : `, since ${fullTime(keyStatus.setAt)}`
            }}.
          </p>
          <p
            class="line"
            :class="{ warn: !keyStatus.inUse && keyStatus.readState !== 'not-checked' }"
            data-cy="provider-key-in-use"
          >
            {{ keyInUseSays }}
          </p>
          <div
            class="key-remedy"
            :class="{ 'bb-notice bb-notice--waiting': keyRefusedSays !== null }"
          >
            <p v-if="keyRefusedSays !== null" class="line warn" data-cy="provider-key-refused">
              {{ keyRefusedSays }}
            </p>
            <div class="actions">
              <button
                type="button"
                data-cy="provider-key-check"
                :disabled="keyBusy"
                @click="checkKey"
              >
                {{ keyChecking ? 'Checking…' : 'Check it works' }}
              </button>
              <button
                type="button"
                data-cy="provider-key-replace"
                :disabled="keyBusy"
                @click="keyEditing = true"
              >
                Replace
              </button>
              <button
                type="button"
                class="danger"
                data-cy="provider-key-remove"
                :disabled="keyBusy"
                @click="removeKey"
              >
                Remove
              </button>
            </div>
            <p class="line quiet" data-cy="provider-key-check-sends">{{ checkSpends }}</p>
          </div>
        </template>
        <template v-else>
          <p v-if="!keyEditing" class="line quiet" data-cy="provider-key-none">
            No key saved. A saved key outranks the sign-in.
          </p>
          <form class="key-form" @submit.prevent="saveKey">
            <input
              v-model="keyDraft"
              type="password"
              autocomplete="new-password"
              :disabled="keyBusy"
              spellcheck="false"
              data-cy="provider-key-input"
              :aria-label="`${name} API key`"
              :placeholder="`Paste your ${name} API key`"
            />
            <button type="submit" :disabled="keyBusy || keyDraft.trim() === ''">
              {{ keyBusy ? 'Saving…' : 'Save key' }}
            </button>
            <button v-if="keyEditing" type="button" @click="cancelKeyEdit">Cancel</button>
          </form>
        </template>
        <p
          v-if="keySaid"
          class="line"
          :class="{ warn: keySaid.tone === 'warn' }"
          data-cy="provider-key-said"
          role="status"
        >
          {{ keySaid.text }}
        </p>
      </div>
    </section>

    <section class="part" data-cy="provider-version" :data-open="isOpen('version')">
      <div class="program-heading">
        <h3>
          <button
            type="button"
            class="fold"
            :aria-expanded="isOpen('version')"
            :aria-controls="`${partIds}-version`"
            @click="emit('toggle', 'version')"
          >
            <svg class="icon section-icon" aria-hidden="true"><use href="#i-folder" /></svg
            >Version<svg
              class="icon chevron"
              :class="{ folded: !isOpen('version') }"
              aria-hidden="true"
            >
              <use href="#i-chevron" />
            </svg>
          </button>
        </h3>
        <span
          v-if="props.version?.program"
          class="bb-chip bb-chip--pill"
          :class="
            A_STANDING_WARNS[props.version.program.standing]
              ? 'bb-chip--waiting'
              : 'bb-chip--success'
          "
        >
          {{ A_STANDING_IN_A_WORD[props.version.program.standing] }}
        </span>
      </div>
      <div v-show="isOpen('version')" :id="`${partIds}-version`" class="part-body">
        <p v-if="props.version === null" class="line quiet">Reading…</p>
        <template v-else-if="props.version.program">
          <dl
            v-if="props.version.program.version || props.version.program.from"
            class="program-facts"
          >
            <div v-if="props.version.program.version">
              <dt>Version</dt>
              <dd>{{ props.version.program.version }}</dd>
            </div>
            <div v-if="props.version.program.from">
              <dt>From</dt>
              <dd>
                {{
                  {
                    given: 'Given to this launch',
                    'development-checkout': 'Development checkout',
                    'native-installer': 'Anthropic’s installer',
                    homebrew: 'Homebrew',
                    winget: 'WinGet',
                    npm: 'npm',
                    path: 'PATH',
                    carried: 'Comes with BroCrew',
                  }[props.version.program.from]
                }}
              </dd>
            </div>
          </dl>
          <details v-if="props.version.program.path" class="program-location">
            <summary :title="props.version.program.path">
              Location <code>{{ props.version.program.path }}</code>
            </summary>
            <div class="program-full-path">
              <span>Full path</span>
              <code>{{ props.version.program.path }}</code>
            </div>
          </details>
          <p v-if="props.version.program.tested" class="line quiet program-range">
            Tested with {{ props.version.program.tested.oldest }}–{{
              props.version.program.tested.newest
            }}
          </p>
          <div
            class="bb-notice program-next"
            :class="{ 'bb-notice--waiting': A_STANDING_WARNS[props.version.program.standing] }"
          >
            <p
              class="line"
              :class="{ warn: A_STANDING_WARNS[props.version.program.standing] }"
              data-cy="provider-version-said"
              :data-standing="props.version.program.standing"
            >
              {{ props.version.program.said }}
            </p>
            <!-- An update a person made, seen to land: said until the next one. -->
            <p
              v-if="props.version.program.updatedFrom !== null && props.version.program.version"
              class="line"
              data-cy="provider-version-updated"
              role="status"
            >
              Updated to {{ props.version.program.version }}, from
              {{ props.version.program.updatedFrom }}.
            </p>
            <a
              v-if="props.version.program.help"
              class="bb-button"
              :class="{ 'bb-button--primary': props.version.program.standing === 'missing' }"
              :href="props.version.program.help.url"
              target="_blank"
              rel="noopener"
              data-cy="provider-version-help"
            >
              {{ props.version.program.help.label }}
            </a>
          </div>
          <!-- The other copies on this computer, which a launch does not run: why updating one of
             them can change nothing here. -->
          <details v-if="props.version.program.others.length > 0" data-cy="provider-version-others">
            <summary>
              {{ props.version.program.others.length }} other
              {{ props.version.program.others.length === 1 ? 'copy' : 'copies' }} found
            </summary>
            <ul class="others">
              <li
                v-for="copy in props.version.program.others"
                :key="copy.path"
                class="line quiet"
                data-cy="provider-version-other"
              >
                {{ copy.said }}
              </li>
            </ul>
          </details>
        </template>
        <p
          v-else-if="props.version.version === null"
          class="line warn"
          data-cy="provider-version-said"
        >
          {{ props.version.reason }}
        </p>
      </div>
    </section>

    <section class="part" data-cy="provider-usage" :data-open="isOpen('usage')">
      <h3>
        <button
          type="button"
          class="fold"
          :aria-expanded="isOpen('usage')"
          :aria-controls="`${partIds}-usage`"
          @click="emit('toggle', 'usage')"
        >
          <svg class="icon section-icon" aria-hidden="true"><use href="#i-activity" /></svg
          >Usage<svg class="icon chevron" :class="{ folded: !isOpen('usage') }" aria-hidden="true">
            <use href="#i-chevron" />
          </svg>
        </button>
      </h3>
      <div v-show="isOpen('usage')" :id="`${partIds}-usage`" class="part-body">
        <!-- The warnings' own read: said only when it adds something to the readings below. -->
        <p
          v-if="props.limitsRead !== null || props.limit !== null || !readingLines?.length"
          class="line"
          :class="{ warn: usage.tone === 'warn' }"
          :title="usage.title ?? undefined"
          data-cy="provider-usage-says"
        >
          {{ usage.text }}
        </p>
        <p v-if="readingLines === null" class="line quiet">Reading…</p>
        <p
          v-else-if="readingLines.length === 0"
          class="line quiet usage-empty"
          data-cy="provider-usage-none"
        >
          No reading yet. {{ name }} sends one with its next turn.
        </p>
        <div v-else class="usage-windows">
          <div v-for="(line, index) in readingLines" :key="line.key" class="usage-window">
            <svg class="icon" aria-hidden="true"><use href="#i-clock" /></svg>
            <p class="line" :title="line.title" data-cy="provider-usage-reading">
              {{ line.text }}
              <span v-if="line.status" class="quiet" data-cy="provider-usage-unconfirmed">
                {{ line.status }}
              </span>
            </p>
            <meter
              v-if="props.readings?.[index]?.usedPercent != null"
              min="0"
              max="100"
              :value="props.readings[index]!.usedPercent!"
              :aria-label="line.status ? `${line.text} ${line.status}` : line.text"
              :class="{
                historical:
                  props.readings[index]!.unconfirmed === true ||
                  (props.readings[index]!.resetsAt !== null &&
                    props.readings[index]!.resetsAt! <= props.clock),
                ahead: line.time?.ahead,
              }"
            />
            <span v-else class="empty-meter" aria-hidden="true"></span>
            <template v-if="line.time">
              <meter
                class="time-meter"
                min="0"
                max="1"
                :value="line.time.fraction"
                :aria-label="
                  line.status
                    ? `Time gone in this window · ${line.status}`
                    : 'Time gone in this window'
                "
                :aria-valuetext="line.time.words"
                data-cy="provider-usage-time"
              />
              <p class="time-label" data-cy="provider-usage-time-words">{{ line.time.words }}</p>
              <p
                v-if="line.time.ahead"
                class="pace-warning"
                :title="line.paceTitle"
                data-cy="provider-usage-ahead"
              >
                Usage ahead of time
              </p>
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- Show this provider's running-agent count, memory and CPU on one line. -->
    <section class="part" data-cy="provider-resources" :data-open="isOpen('resources')">
      <h3>
        <button
          type="button"
          class="fold"
          :aria-expanded="isOpen('resources')"
          :aria-controls="`${partIds}-resources`"
          @click="emit('toggle', 'resources')"
        >
          <svg class="icon section-icon" aria-hidden="true"><use href="#i-spark" /></svg>Running
          now<svg class="icon chevron" :class="{ folded: !isOpen('resources') }" aria-hidden="true">
            <use href="#i-chevron" />
          </svg>
        </button>
      </h3>
      <div v-show="isOpen('resources')" :id="`${partIds}-resources`" class="part-body">
        <p
          class="line"
          :class="{ warn: resourcesSays.tone === 'warn' }"
          :title="resourcesTitle"
          data-cy="provider-resources-says"
        >
          {{ resourcesSays.text }}
          <span v-if="props.resourcesPaused && props.resources !== null" class="quiet">
            · paused while BroCrew isn’t in front</span
          >
        </p>
      </div>
    </section>

    <section class="part" data-cy="provider-models" :data-open="isOpen('models')">
      <h3>
        <button
          type="button"
          class="fold"
          :aria-expanded="isOpen('models')"
          :aria-controls="`${partIds}-models`"
          @click="emit('toggle', 'models')"
        >
          <svg class="icon section-icon" aria-hidden="true"><use href="#i-list" /></svg>Models<svg
            class="icon chevron"
            :class="{ folded: !isOpen('models') }"
            aria-hidden="true"
          >
            <use href="#i-chevron" />
          </svg>
        </button>
      </h3>
      <div v-show="isOpen('models')" :id="`${partIds}-models`" class="part-body">
        <p v-if="list" class="line starts-on" data-cy="provider-starts-on">
          <svg class="icon" aria-hidden="true"><use href="#i-spark" /></svg>
          New conversations start on <strong>{{ startsOn }}</strong>
          <span class="quiet"> — {{ startsOnWhy }}</span>
        </p>
        <p
          v-if="listSays?.message"
          class="line"
          :class="{ warn: listSays.tone === 'warn' }"
          data-cy="provider-models-said"
          :title="'detail' in listSays ? listSays.detail : undefined"
        >
          {{ listSays.message }}
          <strong v-if="listSays.remedy">{{ listSays.remedy }}</strong>
          <button
            v-if="held?.state === 'unread' || list?.notAsked"
            type="button"
            class="link"
            @click="readModelsAgain"
          >
            Try again
          </button>
        </p>
        <ul v-if="list && list.models.length > 0" class="models" data-cy="provider-model-rows">
          <li
            v-for="row in list.models"
            :key="row.id"
            class="model"
            data-cy="provider-model-row"
            :data-model="row.id"
            :title="row.description ?? row.id"
          >
            <span class="model-name">{{ row.label }}</span>
            <span v-if="row.resolvesTo" class="tag">→ {{ row.resolvesTo }}</span>
            <span v-if="row.isDefault" class="tag">default</span>
            <span v-if="row.addedBy === 'a-person'" class="tag">added by you</span>
            <button
              v-if="row.addedBy === 'a-person'"
              class="delete"
              type="button"
              data-cy="provider-model-delete"
              :aria-label="`Delete ${row.id} from your ${name} models`"
              :disabled="modelBusy"
              @click="removeModel(row.id)"
            >
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </li>
        </ul>
        <form v-if="adding" class="key-form" @submit.prevent="addModel">
          <input
            v-model="addName"
            type="text"
            spellcheck="false"
            data-cy="provider-model-add-name"
            :placeholder="`its id, exactly as ${name} names it`"
          />
          <button type="submit" :disabled="modelBusy || addName.trim() === ''">Add</button>
          <button type="button" @click="adding = false">Cancel</button>
        </form>
        <button
          v-else
          type="button"
          class="link"
          data-cy="provider-model-add-open"
          @click="adding = true"
        >
          + Add a {{ name }} model…
        </button>
        <p v-if="modelSaid" class="line warn" role="status">{{ modelSaid }}</p>
      </div>
    </section>
  </article>
</template>

<style scoped>
.inline-setup {
  grid-row: span 2;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.setup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}
.setup-steps {
  display: flex;
  gap: var(--space-8);
  padding: 0;
  margin: 0;
  list-style: none;
  font-size: var(--type-small);
  color: var(--muted);
}
.setup-steps [aria-current] {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.setup-command {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}
.setup-command code {
  overflow-wrap: anywhere;
}
.setup-key {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  font-size: var(--type-small);
}

/* One row per part, shared with the other providers' cards through the screen's grid, so the same
   part starts at the same height in every card. Alone, the rows are its own. */
.card {
  display: grid;
  min-width: 0;
  grid-row: span var(--card-rows);
  grid-template-rows: subgrid;
  align-content: start;
  padding: var(--space-10);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-4);
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
  color: var(--text);
}
.provider-logo--blossom {
  border-color: var(--line);
  background: var(--paper-bg);
}
.card-head h2 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-title);
  font-weight: var(--fw-bold);
}
.standing {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-2);
  white-space: nowrap;
}
.standing.ready {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}
.standing.not-ready {
  background: var(--waiting-bg);
  border-color: var(--waiting-card-border);
  color: var(--waiting);
}
.standing .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.provider-menu {
  display: grid;
  place-items: center;
  margin-left: auto;
  padding: 0;
  width: var(--control-icon);
  height: var(--control-icon);
  flex: none;
  background: var(--accent-fill);
  border-color: var(--accent-border-weak);
  color: var(--accent-text);
}
.at-limit {
  display: flex;
  align-items: center;
  margin: 0 0 var(--space-4);
  color: var(--waiting);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
}
.setup-entry {
  display: flex;
  margin-bottom: var(--space-4);
}
.at-limit .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
}
.part {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-7) 0 var(--space-7) var(--space-16);
  gap: var(--space-3);
}
.part + .part {
  border-top: var(--border-width) solid var(--line);
}
.part:last-child {
  padding-bottom: 0;
}
.part h3 {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  line-height: var(--leading-normal);
}
/* The heading itself, unstyled: its icon, its word and the chevron, pressable. */
.fold {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  gap: var(--space-2);
}
/* Down while open, right while folded. */
.chevron {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
  transform: rotate(90deg);
}
.chevron.folded {
  transform: none;
}
/* The content lays out as the part's own children, folded or not. */
.part-body {
  display: contents;
}
.section-icon {
  position: absolute;
  left: 0;
  top: var(--space-7);
  width: var(--icon);
  height: var(--icon);
}
.line {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}
.quiet {
  color: var(--muted);
}
.warn {
  color: var(--waiting);
}
.actions,
.key-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.key-form input {
  min-width: 0;
  min-height: var(--control-h);
  box-sizing: border-box;
  flex: 1 1 14rem;
  padding: var(--space-3) var(--space-6);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--paper-bg);
  color: var(--text);
  font: inherit;
  font-size: var(--type-small);
}
.actions button,
.key-form button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h);
  padding: var(--space-3) var(--space-6);
  font-size: var(--type-small);
  gap: var(--space-3);
  border-color: var(--accent-border-weak);
  background: var(--accent-fill-weak);
  color: var(--accent-text);
}
.actions .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.actions button.danger {
  color: var(--danger);
}
.link {
  align-self: flex-start;
  padding: var(--space-3) 0 0;
  border: none;
  background: none;
  color: var(--accent-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-small);
  text-decoration: none;
}
/* The other copies of a program, one line each, under their count. */
details[data-cy='provider-version-others'] > summary {
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-small);
}
.others {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: var(--space-2) 0 0;
  gap: var(--space-2);
  list-style: none;
}
.models {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}
.model {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  padding: var(--space-3) var(--space-6);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-sm);
  background: var(--paper-bar);
  color: var(--text-soft);
  font-size: var(--type-small);
  gap: var(--space-2) var(--space-5);
}
.model-name {
  color: var(--text);
  overflow-wrap: anywhere;
  font-weight: var(--fw-medium);
}
.tag {
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}
.delete {
  display: grid;
  place-items: center;
  padding: var(--space-2);
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.delete .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.starts-on {
  position: relative;
  padding: var(--space-5) var(--space-6) var(--space-5) var(--space-20);
  margin: var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--accent-fill);
  color: var(--accent-text);
}
.starts-on > .icon {
  position: absolute;
  left: var(--space-6);
  top: var(--space-6);
  width: var(--icon);
  height: var(--icon);
}
.starts-on .quiet {
  display: block;
  margin-top: var(--space-1);
}
.usage-empty {
  padding: var(--space-6);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-sm);
  background: var(--accent-fill-weak);
}

.usage-windows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
}
.usage-window {
  position: relative;
  min-width: 0;
  padding: var(--space-5) var(--space-6) var(--space-5) var(--space-20);
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-sm);
  background: var(--accent-fill-weak);
}
.usage-window > .icon {
  position: absolute;
  left: var(--space-5);
  top: var(--space-6);
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--muted);
}
.usage-window .line {
  font-size: var(--type-caption);
}
meter,
.empty-meter {
  display: block;
  width: 100%;
  height: var(--meter-h);
  margin-top: var(--space-3);
  border: none;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--accent-fill-strong);
}
meter::-webkit-meter-bar {
  border: none;
  background: var(--accent-fill-strong);
  border-radius: var(--radius-pill);
}
meter::-webkit-meter-optimum-value {
  background: var(--accent);
  border-radius: var(--radius-pill);
}
meter.historical::-webkit-meter-optimum-value {
  background: var(--muted);
}
meter.ahead::-webkit-meter-optimum-value {
  background: var(--waiting);
}
meter.time-meter {
  height: var(--space-2);
  margin-top: var(--space-2);
  background: var(--line);
}
meter.time-meter::-webkit-meter-bar {
  background: var(--line);
}
meter.time-meter::-webkit-meter-optimum-value {
  background: var(--muted);
}
.time-label,
.pace-warning {
  margin: var(--space-2) 0 0;
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}
.time-label {
  color: var(--muted);
}
.pace-warning {
  color: var(--waiting);
}
.program-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.program-heading .bb-chip {
  white-space: normal;
}
.program-facts {
  display: grid;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}
.program-facts > div {
  display: grid;
  grid-template-columns: var(--space-32) minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-5);
}
.program-facts dt,
.program-full-path > span {
  color: var(--muted);
  font-size: var(--type-caption);
}
.program-facts dd {
  margin: 0;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
  overflow-wrap: anywhere;
}
.program-location {
  min-width: 0;
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--text-soft);
  font-size: var(--type-small);
}
.program-location summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.program-location code {
  display: block;
  margin-top: var(--space-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  user-select: text;
}
.program-location summary code {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.program-full-path {
  padding-top: var(--space-5);
  margin-top: var(--space-5);
  border-top: var(--border-width) solid var(--line);
}
.program-range {
  font-size: var(--type-caption);
}
.program-next,
.key-remedy {
  display: grid;
  gap: var(--space-5);
}
.program-next .bb-button {
  justify-self: start;
  max-width: 100%;
  white-space: normal;
  text-align: left;
}
</style>
