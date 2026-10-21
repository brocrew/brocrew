<script setup lang="ts">
import { computed } from 'vue'
import {
  PROVIDER_NAME,
  type Provider,
  type AuthState,
  type CapabilityStatus,
} from '../../../shared/runtime-ipc'
// ⛔ **The labels are shared rather than written here** (310). 310's model field points a person at
// one of these two gestures when a catalogue probe is refused, and it must do so in the button's own
// words — see `credential-words.ts` for why a second phrasing would be a second gesture.
import { COPY_MACHINE_SIGN_IN, SIGN_IN_HERE } from '../lib/credential-words'

/**
 * What to do about a profile whose provider sign-in will not run a turn (098).
 *
 * ## Why this is a panel and not a sentence
 *
 * A provider token error explains the mechanism but does not offer recovery. Show the two available sign-in actions and explain how they differ before another message is spent.
 *
 * ⚠️ **The difference is the whole point of the copy here.** Re-copying the machine sign-in works and
 * will break again — the copy and the machine credential share one rotating refresh token, so
 * whichever refreshes first kills the other. Signing in *here* gives this profile its own token pair
 * and ends it. A UI that offered both as equivalent "fix it" buttons would be lying by omission, so
 * the fast one says out loud that it is temporary.
 *
 * ## Provider-neutral, like everything else on a surface (039)
 *
 * There is no `provider === …` anywhere in this file. Whether signing in is possible is asked of
 * {@link signIn}, the capability the adapters declare — Codex says `available`, Claude says `absent`
 * with the reason *"Claude sessions use your machine login directly"*, and this renders whichever it
 * is given. That is also why the absent branch shows the provider's REASON rather than copy of its
 * own: a reason that goes stale is then fixed in one place.
 *
 * 🔒 **No credential is rendered here, and none is available to be.** {@link AuthState} carries an
 * account identity at most (an email, a plan) — never a token, a refresh token or a key. See
 * `auth-state.ts` for why that line is drawn where it is.
 */

const props = defineProps<{
  provider: Provider
  /** The credential's standing, or `null` before anyone has asked. */
  state: AuthState | null
  /** Whether this provider can be signed into inside the profile — asked, never inferred (039). */
  signIn: CapabilityStatus
  /**
   * Whether the machine credential can be copied into this profile — a SEPARATE capability from
   * {@link signIn} (098 review finding 15).
   *
   * ⚠️ It used to be assumed rather than asked, and the copy button rendered for every provider. The
   * host refuses that gesture outright for Claude — there is no profile credential to copy into — so
   * a Claude user with an expired machine login was offered a button that could only ever throw.
   */
  reprovision: CapabilityStatus
  /** Which gesture is in flight, so the buttons disable and the right one says what it is doing. */
  busy: 'idle' | 'checking' | 'copying' | 'signing-in'
  /** The outcome of the last gesture, in the words of whoever produced it. Never a credential. */
  notice: string | null
  /** ⚑ W4.10 · offer the Providers screen, where a key can be added — off where this IS that screen. */
  offerProviders?: boolean
}>()

const emit = defineEmits<{
  check: []
  reprovision: []
  'sign-in': []
  'cancel-sign-in': []
  'open-providers': []
}>()

/**
 * Whether there is anything to show at all.
 *
 * ⚠️ `unknown` renders — it is "we could not ask", which is a different thing from "you are fine"
 * and the user is entitled to see the difference and press Check again. Only a genuinely usable
 * credential, and a credential nobody has asked about yet, are silent.
 */
const visible = computed(() => props.state !== null && props.state.state !== 'usable')

/** The heading, per state. Written for the person, not for the mechanism. */
const heading = computed(() => {
  switch (props.state?.state) {
    case 'stale':
      return `Sign in again to use ${PROVIDER_NAME[props.provider]} with this agent`
    case 'absent':
      return `Sign in to use ${PROVIDER_NAME[props.provider]} with this agent`
    case 'unknown':
      return `Couldn't check this agent's ${PROVIDER_NAME[props.provider]} sign-in`
    default:
      return ''
  }
})

/** The provider's own reason, which is the only copy of it. */
const reason = computed(() =>
  props.state && props.state.state !== 'usable' ? props.state.reason : '',
)

const canSignIn = computed(() => props.signIn.state === 'available')
const canReprovision = computed(() => props.reprovision.state === 'available')
/**
 * ⚠️ Only `absent` carries a required reason on a `CapabilityStatus`; `unwired` carries one too, and
 * `available` carries an optional note. Reading them apart rather than with a cast keeps a future
 * fourth state from silently rendering as blank.
 */
const signInNote = computed(() =>
  props.signIn.state === 'available' ? (props.signIn.note ?? '') : props.signIn.reason,
)
const reprovisionNote = computed(() =>
  props.reprovision.state === 'available'
    ? (props.reprovision.note ?? '')
    : props.reprovision.reason,
)
/**
 * The sentence about the two remedies, shown ONLY when both are on offer.
 *
 * ⚠️ It is about a *choice*, so on a provider with only one of them it would be describing a
 * decision the user is not being asked to make — and on Claude, where neither applies, it would be
 * describing a mechanism that does not exist here at all.
 */
const explainsTheChoice = computed(() => canSignIn.value && canReprovision.value)
const idle = computed(() => props.busy === 'idle')
</script>

<template>
  <section v-if="visible" class="sign-in-panel" data-cy="sign-in-panel" role="alert">
    <h3 class="sign-in-heading" data-cy="sign-in-heading">{{ heading }}</h3>
    <p class="sign-in-reason" data-cy="sign-in-reason">{{ reason }}</p>

    <div class="sign-in-actions">
      <!-- The default offer, and the order says so: it is FIRST and it is the primary button,
           because it is the one that does not recur. The measurement behind that ruling is in
           `codex-login.ts`. -->
      <button
        v-if="canSignIn"
        type="button"
        class="sign-in-primary"
        data-cy="sign-in-start"
        :disabled="!idle"
        @click="emit('sign-in')"
      >
        {{ busy === 'signing-in' ? 'Waiting for your browser…' : SIGN_IN_HERE }}
      </button>
      <button
        v-if="busy === 'signing-in'"
        type="button"
        class="sign-in-secondary"
        data-cy="sign-in-cancel"
        @click="emit('cancel-sign-in')"
      >
        Cancel
      </button>
      <button
        v-if="canReprovision"
        type="button"
        class="sign-in-secondary"
        data-cy="sign-in-reprovision"
        :disabled="!idle"
        @click="emit('reprovision')"
      >
        {{ busy === 'copying' ? 'Copying…' : COPY_MACHINE_SIGN_IN }}
      </button>
      <button
        type="button"
        class="sign-in-secondary"
        data-cy="sign-in-check"
        :disabled="!idle"
        @click="emit('check')"
      >
        {{ busy === 'checking' ? 'Checking…' : 'Check again' }}
      </button>
      <button
        v-if="props.offerProviders"
        type="button"
        class="sign-in-secondary"
        data-cy="sign-in-open-providers"
        @click="emit('open-providers')"
      >
        Open Providers
      </button>
    </div>

    <!-- ⚠️ **The sentence this feature exists to say.** A copy is not a fix, it is a postponement,
         and a user who is not told that will be back here in a fortnight wondering why. It is shown
         beside the button rather than after pressing it, because it should change which button they
         press. -->
    <p v-if="explainsTheChoice" class="sign-in-caveat" data-cy="sign-in-caveat">
      Sign in here to keep this agent's login separate. Copying your computer's existing login is
      quicker, but either login may stop working when the other refreshes.
    </p>
    <!-- ⚠️ When a remedy is NOT on offer, the provider's own reason takes its place. The renderer
         owns no copy of its own for this, so a reason that goes stale is fixed in one place — and
         the two are shown separately because they are two different facts (098 review). -->
    <p v-if="!canSignIn" class="sign-in-caveat" data-cy="sign-in-unavailable">{{ signInNote }}</p>
    <p v-if="!canReprovision" class="sign-in-caveat" data-cy="sign-in-no-copy">
      {{ reprovisionNote }}
    </p>

    <p v-if="notice" class="sign-in-notice" data-cy="sign-in-notice">{{ notice }}</p>
  </section>
</template>

<style scoped>
.sign-in-panel {
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  border: var(--border-width) solid var(--waiting-card-border);
  border-radius: var(--radius-sm);
  background: var(--waiting-bg);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sign-in-heading {
  margin: 0;
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.sign-in-reason,
.sign-in-caveat,
.sign-in-notice {
  margin: 0;
  font-size: var(--type-caption);
  line-height: 1.45;
}

.sign-in-caveat {
  opacity: 0.8;
}

.sign-in-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sign-in-primary,
.sign-in-secondary {
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-xs);
  font: inherit;
  font-size: var(--type-caption);
  cursor: pointer;
}

.sign-in-primary {
  border: var(--border-width) solid var(--accent-border);
  background: var(--accent-fill);
  color: var(--accent-text);
}

.sign-in-secondary {
  border: var(--border-width) solid var(--line-strong);
  background: transparent;
  color: inherit;
}

.sign-in-primary:disabled,
.sign-in-secondary:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
