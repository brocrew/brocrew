<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AuthState,
  CapabilityStatus,
  Provider,
  ProviderCapabilities,
  ProviderProgram,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { ProviderSetupSays } from '../lib/provider-setup'
import {
  afterNext,
  couldNotCheck,
  firstToDo,
  hasAProgramToInstall,
  setupSteps,
  stepBefore,
  STEP_WORD,
  type SetupFacts,
  type SetupState,
} from '../lib/provider-setup-steps'
import { readableError } from '../lib/session-record'
import SignInPanel from './SignInPanel.vue'
import ProviderMark from './ProviderMark.vue'
import ProviderInstall from './ProviderInstall.vue'
import ProviderSetupProgress from './ProviderSetupProgress.vue'
import { useProviderSetup } from '../composables/useProviderSetup'
import { useModelLists } from '../composables/useModelLists'
import { modelsAfterConnection } from '../lib/models-after-connection'

/**
 * One provider's setup, a step at a time: install, version, sign-in, ready — or only sign-in and
 * ready for a program this app carries. Next reads the facts again through `recheck` and moves on
 * only when the step's own fact passes. Supported setup commands run through the main bridge.
 */
const props = withDefaults(
  defineProps<{
    provider: Provider
    markKind?: ProviderCapabilities['mark']['kind'] | null
    version: ProviderVersion | null
    setup: ProviderSetupSays | null | undefined
    auth: AuthState | null
    keyRefused: boolean
    /** The app's sentence for a saved key this computer can't read, or null when it can. */
    keyUnreadable?: string | null
    signIn: CapabilityStatus
    reprovision: CapabilityStatus
    busy: 'idle' | 'checking' | 'copying' | 'signing-in'
    notice: string | null
    /** Reads the program and the sign-in again; resolves once both answered. */
    recheck: () => Promise<void>
    /** Another provider that is not ready, offered from Ready. */
    other?: Provider | null
  }>(),
  { other: null, markKind: null },
)

const emit = defineEmits<{
  close: []
  start: []
  'sign-in': []
  'cancel-sign-in': []
  reprovision: []
  'open-key': []
  'set-up-other': []
}>()

const name = computed(() => PROVIDER_NAME[props.provider])
const tool = computed(() => props.setup?.tool ?? name.value)
const nativeSetup = useProviderSetup(
  () => props.provider,
  async (operation) => {
    const lists = useModelLists()
    if (operation === 'signIn') lists.forget(DEFAULT_PROFILE_ID)
    await props.recheck()
    if (!alive) return
    shown.value = firstToDo(facts.value)
    focusHeading()
    if (operation === 'signIn' && props.auth?.state === 'usable')
      await modelsAfterConnection(lists, props.provider, modelsStop.signal)
  },
)
const modelsStop = new AbortController()
const nativeSignIn = computed(
  () => nativeSetup.state.value?.available === true && nativeSetup.state.value.supported.signIn,
)
const installMissing = computed(
  () =>
    shown.value?.step === 'install' &&
    shown.value.kind === 'missing' &&
    props.setup?.install != null,
)

const facts = computed<SetupFacts>(() => ({
  version: props.version,
  setup: props.setup,
  auth: props.auth,
  keyRefused: props.keyRefused,
  keyUnreadable: props.keyUnreadable ?? null,
}))
const steps = computed(() => setupSteps(facts.value))

/** The step on screen. It changes only on Next or Back, never on a fact moving underneath. */
const shown = ref<SetupState | null>(firstToDo(facts.value))
watch(facts, (now) => {
  if (shown.value !== null) return
  shown.value = firstToDo(now)
  if (shown.value !== null) focusHeading()
})

const checking = ref(false)
const feedback = ref('')
const copied = ref(false)
const heading = ref<HTMLElement | null>(null)
const installer = ref<InstanceType<typeof ProviderInstall> | null>(null)
let alive = true

/** The computer's platform as main says it, else as the browser does. */
const platform = computed(
  () => props.setup?.platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform),
)
/** Where the commands are pasted: the shell main typed them for, else the platform's own. */
const terminal = computed(() =>
  props.setup !== null && props.setup !== undefined
    ? props.setup.shell
    : /mac/i.test(platform.value)
      ? 'Terminal'
      : /win/i.test(platform.value)
        ? 'PowerShell'
        : 'a terminal',
)
const openTerminal = computed(() =>
  /mac/i.test(platform.value)
    ? 'Open Spotlight (⌘ Space), type Terminal, then press Enter.'
    : /win/i.test(platform.value)
      ? 'Open Start, type PowerShell, then open Windows PowerShell.'
      : '',
)

/** Signing in happens in the app where the provider offers it, else with its command. */
const signsInHere = computed(
  () =>
    nativeSignIn.value ||
    props.signIn.state === 'available' ||
    props.reprovision.state === 'available',
)
const program = computed(() => props.version?.program ?? null)

interface StepView {
  title: string
  says: string
  command: string | null
  hint: string
  link: { label: string; url: string } | null
  action: 'open-key' | null
  /** The step can also be passed by saving an API key: offer the way to its field. */
  keyInstead: boolean
  next: boolean
}

/** The host's own sentence for a fact it could not read, then what to do. */
function tryAgain(reason: string): string {
  return reason === '' ? 'Choose Next to try again.' : `${reason} Choose Next to try again.`
}

const view = computed<StepView | null>(() => {
  const state = shown.value
  if (state === null) return null
  const unsigned = {
    command: null,
    hint: '',
    link: null,
    action: null,
    keyInstead: false,
    next: true,
  } as const
  const help = program.value?.help ?? null
  switch (state.step) {
    case 'install':
      if (state.kind === 'cannot-check') {
        return {
          ...unsigned,
          title: `Could not check for ${tool.value}`,
          says: tryAgain(props.version?.version === null ? props.version.reason : ''),
        }
      }
      if (state.kind === 'found') {
        return {
          ...unsigned,
          title: `${tool.value} is installed`,
          says: 'BroCrew found it on this computer. Choose Next to go on.',
        }
      }
      return props.setup?.install
        ? {
            ...unsigned,
            title: `Install ${tool.value}`,
            says: `Copy this command. Paste it into ${terminal.value} and press Enter.`,
            command: props.setup.install.command,
            hint: openTerminal.value,
            link: { label: 'Installation help', url: props.setup.install.docs },
          }
        : {
            ...unsigned,
            title: `Install ${tool.value}`,
            says: `Install ${tool.value} on this computer, then choose Next.`,
            link: help,
          }
    case 'version':
      if (state.kind === 'passed') {
        return {
          ...unsigned,
          title: 'Version check passed',
          says: `${tool.value} meets the version BroCrew needs.`,
        }
      }
      if (state.kind === 'unreadable') {
        return {
          ...unsigned,
          title: `BroCrew could not read the version of ${tool.value}`,
          says: 'It is installed but did not say its version. Choose Next to check again.',
          link: help,
        }
      }
      return program.value?.update
        ? {
            ...unsigned,
            title: `Update ${tool.value}`,
            says: `This version is older than the versions BroCrew was tested with. Copy this command, paste it into ${terminal.value} and press Enter, then choose Next.`,
            command: program.value.update.command,
            hint: openTerminal.value,
            link: help,
          }
        : {
            ...unsigned,
            title: `Update ${tool.value}`,
            says: 'This version is older than the versions BroCrew was tested with. Update it, then choose Next.',
            link: help,
          }
    case 'sign-in':
      switch (state.kind) {
        case 'key-refused':
          return {
            ...unsigned,
            title: 'The saved key needs attention',
            says: 'A request on the saved key was refused: its account can’t pay. Add credit, or replace the key in Providers.',
            action: 'open-key',
            next: false,
          }
        case 'key-unreadable':
          return {
            ...unsigned,
            title: 'The saved key needs attention',
            says: props.keyUnreadable ?? '',
            action: 'open-key',
            next: false,
          }
        case 'cannot-check':
          return {
            ...unsigned,
            title: 'BroCrew could not check the sign-in',
            says: tryAgain(
              props.auth !== null && props.auth.state !== 'usable' ? props.auth.reason : '',
            ),
          }
        case 'signed-in':
          return {
            ...unsigned,
            title: 'Signed in',
            says:
              props.auth?.state === 'usable' && props.auth.login === 'api-key'
                ? 'It runs on the saved API key. Choose Next to go on.'
                : 'The sign-in is usable. Choose Next to go on.',
          }
        default: {
          // The sign-in is the tool's own, so the title names the tool and not the provider.
          const title = state.kind === 'expired' ? 'Sign in again' : `Sign in to ${tool.value}`
          const plain = { ...unsigned, keyInstead: true }
          if (signsInHere.value) {
            return {
              ...plain,
              title,
              says: 'Sign in below and follow your browser. Then choose Next.',
            }
          }
          return props.setup
            ? {
                ...plain,
                title,
                says: [
                  `Run this command in ${terminal.value}. Follow its sign-in, then come back here.`,
                  props.setup.signInInstructions,
                ]
                  .filter(Boolean)
                  .join(' '),
                command: props.setup.signInCommand,
                hint: openTerminal.value,
              }
            : { ...plain, title, says: `Sign in to ${tool.value}, then choose Next.` }
        }
      }
    case 'ready':
      return {
        ...unsigned,
        title: `${name.value} is ready`,
        says: 'You can start a conversation.',
      }
  }
  return null
})

const atStep = computed(() => (shown.value === null ? -1 : steps.value.indexOf(shown.value.step)))

/** The plan only where the provider reports one. */
const plan = computed(() => {
  const said = props.auth?.state === 'usable' ? props.auth.plan : undefined
  return said === undefined || said === '' ? null : `${said[0]!.toUpperCase()}${said.slice(1)}`
})

const FROM_WORD: Readonly<Record<NonNullable<ProviderProgram['from']>, string>> = {
  given: 'Given to this launch',
  'development-checkout': 'Development checkout',
  'native-installer': 'Anthropic’s installer',
  homebrew: 'Homebrew',
  winget: 'WinGet',
  npm: 'npm',
  path: 'PATH',
  carried: 'Comes with BroCrew',
}

/** What stays on screen when Next found the fact unchanged. */
function stillSays(state: SetupState): string {
  if (couldNotCheck(state)) return 'Could not check just now. Try Next again.'
  switch (state.step) {
    case 'install':
      return `${tool.value} is still missing. Finish the installation, then choose Next again.`
    case 'version':
      return state.kind === 'unreadable'
        ? 'BroCrew still can’t read the version. Choose Next to try again.'
        : 'The version has not changed. Finish the update, then choose Next again.'
    default:
      return 'No usable sign-in yet. Finish signing in, then choose Next again.'
  }
}

function focusHeading(): void {
  void nextTick(() => {
    if (installMissing.value) installer.value?.focus()
    else heading.value?.focus()
  })
}

async function next(): Promise<void> {
  const before = shown.value
  if (before === null || checking.value || nativeSetup.busy.value) return
  if (before.step === 'ready') {
    emit('start')
    return
  }
  checking.value = true
  feedback.value = 'Checking this computer…'
  copied.value = false
  try {
    await props.recheck()
  } catch (error) {
    if (!alive) return
    checking.value = false
    feedback.value = `Could not check just now. ${readableError(error)}`
    return
  }
  // A close while checking drops the answer.
  if (!alive) return
  await nextTick()
  const { state, advanced } = afterNext(before, facts.value)
  shown.value = state
  checking.value = false
  feedback.value = advanced ? `✓ ${STEP_WORD[before.step]} checked.` : stillSays(state)
  if (state.step !== before.step) focusHeading()
}

function back(): void {
  const state = shown.value
  if (state === null || checking.value || nativeSetup.busy.value) return
  const before = stepBefore(state, facts.value)
  if (before === null) return
  shown.value = before
  feedback.value = ''
  copied.value = false
  focusHeading()
}

async function copy(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    copied.value = true
    feedback.value = 'Command copied.'
  } catch {
    copied.value = false
    feedback.value = 'Could not copy. Select the command and copy it yourself.'
  }
}

onMounted(() => {
  // After the dialog layer has placed its own first focus.
  setTimeout(focusHeading, 0)
})
onBeforeUnmount(() => {
  alive = false
  modelsStop.abort()
})
</script>

<template>
  <section
    class="setup-dialog"
    aria-labelledby="setup-title"
    :aria-busy="checking || nativeSetup.busy.value"
    data-cy="provider-setup-dialog"
    :data-provider="props.provider"
    :data-step="shown?.step ?? 'checking'"
    :data-kind="shown?.kind ?? 'checking'"
  >
    <header class="setup-head">
      <div class="head-row">
        <h2 id="setup-title">Set up {{ name }}</h2>
        <button
          type="button"
          class="bb-button bb-button--icon"
          aria-label="Close setup"
          data-cy="setup-close"
          @click="emit('close')"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
        </button>
      </div>
      <ol v-if="!installMissing" class="stepper" aria-label="Setup progress" data-cy="setup-steps">
        <li
          v-for="(step, index) in steps"
          :key="step"
          :aria-current="index === atStep ? 'step' : undefined"
          :class="{ done: index < atStep }"
          data-cy="setup-step"
        >
          <svg v-if="index < atStep" class="icon" aria-hidden="true">
            <use href="#i-check" /></svg
          ><span v-else aria-hidden="true">{{ index + 1 }}</span>
          {{ STEP_WORD[step] }}
          <span v-if="index < atStep" class="only-for-a-reader">, done</span>
        </li>
      </ol>
    </header>

    <div class="setup-body">
      <ProviderInstall
        ref="installer"
        v-if="installMissing"
        :tool="tool"
        :busy="nativeSetup.busy.value"
        :progress="nativeSetup.state.value?.progress ?? ''"
        :error="nativeSetup.error.value"
        :details="nativeSetup.state.value?.details ?? null"
        :docs="props.setup?.install?.docs ?? ''"
        @install="nativeSetup.install()"
        @cancel="nativeSetup.cancel()"
      />
      <template v-else-if="view === null || shown === null">
        <h3 ref="heading" class="step-title" tabindex="-1" data-cy="setup-title">
          Checking this computer…
        </h3>
      </template>
      <template v-else>
        <span
          v-if="shown.step === 'ready' || view.command || props.markKind"
          class="step-icon"
          :class="{
            'step-icon--blossom':
              props.markKind === 'blossom' && shown.step !== 'ready' && !view.command,
          }"
          aria-hidden="true"
        >
          <svg v-if="shown.step === 'ready'" class="icon"><use href="#i-check" /></svg>
          <svg v-else-if="view.command" class="icon"><use href="#i-terminal" /></svg>
          <ProviderMark v-else :provider="props.provider" :kind="props.markKind" size="setup" />
        </span>
        <div class="step-words">
          <p class="eyebrow" data-cy="setup-eyebrow">
            {{ shown.step === 'ready' ? 'Ready to go' : `Step ${atStep + 1} of ${steps.length}` }}
          </p>
          <h3 ref="heading" class="step-title" tabindex="-1" data-cy="setup-title">
            {{ view.title }}
          </h3>
          <p class="says" data-cy="setup-says">{{ view.says }}</p>
        </div>

        <p v-if="view.hint" class="hint" data-cy="setup-hint">{{ view.hint }}</p>

        <div v-if="view.command" class="command" data-cy="setup-command-box">
          <code data-cy="setup-command">{{ view.command }}</code>
          <button
            type="button"
            class="bb-button"
            aria-label="Copy command"
            data-cy="setup-copy"
            @click="copy(view.command ?? '')"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <div v-if="shown.step === 'sign-in' && nativeSignIn" class="native-sign-in">
          <div class="actions">
            <button
              type="button"
              class="bb-button bb-button--primary"
              data-cy="native-sign-in"
              :disabled="nativeSetup.busy.value || props.busy !== 'idle'"
              @click="nativeSetup.signIn()"
            >
              Sign in
            </button>
            <button
              v-if="nativeSetup.busy.value"
              type="button"
              class="bb-button"
              @click="nativeSetup.cancel()"
            >
              Cancel sign-in
            </button>
          </div>
          <ProviderSetupProgress
            :progress="nativeSetup.state.value?.progress ?? ''"
            :auth-url="nativeSetup.state.value?.authUrl ?? null"
            :error="nativeSetup.error.value"
          />
        </div>
        <SignInPanel
          :provider="props.provider"
          v-else-if="shown.step === 'sign-in' && signsInHere && props.auth !== null"
          :state="props.auth"
          :sign-in="props.signIn"
          :reprovision="props.reprovision"
          :busy="props.busy"
          :notice="props.notice"
          @check="next()"
          @reprovision="emit('reprovision')"
          @sign-in="emit('sign-in')"
          @cancel-sign-in="emit('cancel-sign-in')"
        />

        <div v-if="view.keyInstead" class="actions">
          <button type="button" class="bb-button" data-cy="setup-use-key" @click="emit('open-key')">
            Use an API key instead
          </button>
        </div>

        <div v-if="view.action === 'open-key'" class="actions">
          <button
            type="button"
            class="bb-button bb-button--primary"
            data-cy="setup-open-key"
            @click="emit('open-key')"
          >
            Open API key
          </button>
        </div>

        <template v-if="shown.step === 'ready'">
          <ul class="checks" data-cy="setup-ready-checks">
            <li>
              <svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>
              {{ hasAProgramToInstall(facts) ? `${tool} found` : 'Comes with BroCrew' }}
            </li>
            <li>
              <svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>
              {{ shown.kind === 'api-key' ? 'Runs on the saved API key' : 'Usable sign-in' }}
            </li>
          </ul>
          <div v-if="props.other" class="actions">
            <button
              type="button"
              class="bb-button"
              data-cy="setup-other"
              @click="emit('set-up-other')"
            >
              Set up {{ PROVIDER_NAME[props.other] }} too
            </button>
          </div>
        </template>

        <a
          v-if="view.link && !view.command"
          class="bb-button help"
          :href="view.link.url"
          target="_blank"
          rel="noopener"
          data-cy="setup-help"
          >{{ view.link.label }}</a
        >

        <p class="feedback" role="status" aria-live="polite" data-cy="setup-feedback">
          {{ feedback }}
        </p>

        <details
          v-if="program || plan || (view.link && view.command)"
          class="details"
          data-cy="setup-details"
        >
          <summary>Details</summary>
          <div class="details-body">
            <a
              v-if="view.link && view.command"
              :href="view.link.url"
              target="_blank"
              rel="noopener"
              data-cy="setup-help"
              >{{ view.link.label }}</a
            >
            <template v-if="program">
              <p v-if="program.version">Version: {{ program.version }}</p>
              <p v-if="program.tested">
                Tested with {{ program.tested.oldest }}–{{ program.tested.newest }}. A newer version
                passes too.
              </p>
              <p v-if="program.from">From: {{ FROM_WORD[program.from] }}</p>
              <p v-if="program.path">
                Runs from <code>{{ program.path }}</code>
              </p>
              <p v-for="copyOf in program.others" :key="copyOf.path" class="quiet">
                {{ copyOf.said }}
              </p>
            </template>
            <p v-if="shown.step === 'ready'">Plan: {{ plan ?? 'not reported' }}</p>
          </div>
        </details>
      </template>
    </div>

    <footer v-if="!installMissing" class="setup-foot">
      <button
        v-if="atStep > 0"
        type="button"
        class="bb-button"
        :disabled="checking || nativeSetup.busy.value"
        data-cy="setup-back"
        @click="back"
      >
        Back
      </button>
      <span v-else></span>
      <div class="foot-end">
        <p v-if="shown && shown.step !== 'ready' && view?.next" class="next-note">
          Next checks this computer again.
        </p>
        <p v-else-if="shown?.step === 'ready' && props.other" class="next-note">
          The other provider can wait.
        </p>
        <button
          v-if="shown && view?.next"
          type="button"
          class="bb-button bb-button--primary"
          :disabled="checking || nativeSetup.busy.value"
          data-cy="setup-next"
          @click="next"
        >
          {{
            checking
              ? 'Checking…'
              : shown.step === 'ready'
                ? 'Start a conversation'
                : 'Next · check again'
          }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.setup-dialog {
  display: flex;
  width: min(650px, calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}
.setup-head {
  padding: var(--space-10) var(--space-14);
  border-bottom: var(--border-width) solid var(--line);
}
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}
.setup-head h2 {
  margin: 0;
  font-size: var(--type-heading);
  font-weight: var(--fw-bold);
}
.icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.stepper {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-8) 0 0;
  padding: 0;
  gap: var(--space-4);
  list-style: none;
  font-size: var(--type-caption);
}
.stepper li {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-xs);
  color: var(--muted);
  gap: var(--space-2);
}
.stepper li[aria-current='step'] {
  background: var(--accent-fill);
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.setup-body {
  display: grid;
  min-height: 0;
  padding: var(--space-14);
  overflow: auto;
  gap: var(--space-10);
}
.step-icon {
  display: grid;
  width: var(--space-24);
  height: var(--space-24);
  place-items: center;
  border-radius: var(--radius-card);
  background: var(--accent-fill);
  color: var(--accent-text);
}
.step-icon--blossom {
  background: var(--paper-bg);
}
.step-icon .icon {
  width: var(--icon-lg);
  height: var(--icon-lg);
}
.step-words {
  display: grid;
  gap: var(--space-4);
}
.eyebrow,
.says,
.hint,
.feedback,
.next-note {
  margin: 0;
}
.eyebrow {
  color: var(--muted);
  font-size: var(--type-caption);
}
.step-title {
  margin: 0;
  color: var(--text);
  font-size: var(--type-title);
  font-weight: var(--fw-bold);
  line-height: var(--leading-snug);
}
.step-title:focus {
  outline: none;
}
.says {
  color: var(--text);
  font-size: var(--type-body);
  line-height: var(--leading-relaxed);
}
.hint {
  color: var(--text-soft);
  font-size: var(--type-small);
}
.command {
  display: flex;
  align-items: center;
  padding: var(--space-7);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius);
  background: var(--code-bg);
  gap: var(--space-6);
}
.command code {
  min-width: 0;
  flex: 1;
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
  user-select: text;
}
.command .bb-button {
  flex: none;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.help {
  justify-self: start;
}
.checks {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-5);
  list-style: none;
}
.checks li {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}
.checks .icon {
  color: var(--success);
}
.feedback {
  color: var(--text-soft);
  font-size: var(--type-small);
}
.feedback:empty {
  display: none;
}
.details {
  font-size: var(--type-small);
}
.details summary {
  padding: var(--space-3) 0;
  color: var(--accent-text);
  cursor: pointer;
}
.details-body {
  display: grid;
  margin-top: var(--space-4);
  gap: var(--space-4);
}
.details-body p {
  margin: 0;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}
.details-body code {
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}
.details-body a {
  color: var(--accent-link);
}
.quiet {
  color: var(--muted);
}
.setup-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-10) var(--space-14);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-6);
}
.foot-end {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.next-note {
  color: var(--muted);
  font-size: var(--type-caption);
}
.only-for-a-reader {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
