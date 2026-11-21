import { computed, ref, watch, type ComputedRef } from 'vue'
import { DEFAULT_CONVERSATION_PROVIDER } from '@brobot2/shared'
import { useProfileSignIn, type ProfileSignIn } from './useProfileSignIn'
import { useClientApi } from '../client-provider/injection'
import { useProviderNames } from './useProviderNames'
import { useProviderSetup } from './useProviderSetup'
import { profileItRunsAs, type SessionRecord } from '../lib/session-record'
import { reopeningHeldBy, reopeningSays } from '../lib/reopening'

/**
 * A conversation's sign-in as `ConversationPane` shows it: whether the machine sign-in moved on,
 * the profile it runs as, renewing it, and what the Reopen bar says (S01, moved out of
 * `ConversationPane.vue` unchanged).
 */
export function useConversationSignIn(
  props: { readonly record: SessionRecord },
  transcript: ComputedRef<SessionRecord['transcript']>,
  control: ComputedRef<SessionRecord['control']>,
  emit: (event: 'reopenSignIn') => void,
) {
  /**
   * The machine Claude sign-in has moved on without this conversation (147).
   *
   * ⚠️ **Read from `meta.liveness`, and NOT folded flat onto `meta` like its neighbours.** The fold in
   * `acceptLiveness` exists for disclosures with a same-named reader already on `meta` — approval,
   * plan, settings, queued all have one — and its whole purpose is to stop there being two answers.
   * This has exactly one reader, so flattening it would create the second copy that pattern exists to
   * prevent rather than removing one.
   *
   * `=== true` rather than `?? false`: the field is absent on every liveness message published before
   * the session was described, and absent must read as "nothing has moved" rather than as unknown.
   */
  const signInSuperseded = computed(() => props.record.meta?.liveness.signInSuperseded === true)
  /** Probe only for each on-screen refusal; renew this profile here, or null if it runs as nobody. */
  const signInClient = useClientApi()
  const providerName = useProviderNames(signInClient)
  const profileSignIn = computed<ProfileSignIn | null>(() => {
    const meta = props.record.meta
    const profileId = profileItRunsAs(meta)
    return meta && profileId !== null
      ? useProfileSignIn(meta.provider, profileId, signInClient)
      : null
  })
  const signInRefused = computed(() => {
    for (let index = transcript.value.items.length - 1; index >= 0; index--) {
      const item = transcript.value.items[index]
      if (item?.kind === 'user') return null
      if (item?.kind === 'notice' && item.signIn?.state === 'refused') return item.id
    }
    return null
  })
  const signInTarget = ref<string | null>(null)
  const signInRenewedFor = ref<string | null>(null)
  const signInSetup = useProviderSetup(
    () => props.record.meta?.provider ?? DEFAULT_CONVERSATION_PROVIDER,
    async (operation) => {
      if (operation !== 'signIn' || signInTarget.value !== props.record.sessionId) return
      const sessionId = props.record.sessionId
      await profileSignIn.value?.check()
      if (sessionId === props.record.sessionId && profileSignIn.value?.auth?.state === 'usable') {
        signInRenewedFor.value = sessionId
        emit('reopenSignIn')
      }
    },
  )
  async function signInAgain(): Promise<void> {
    signInRenewedFor.value = null
    signInTarget.value = props.record.sessionId
    await signInSetup.signIn()
  }
  watch(
    () => [profileSignIn.value, props.record.error, signInRefused.value] as const,
    ([signIn, error, refused], before) => {
      if (refused !== before?.[2]) signInRenewedFor.value = null
      if (signIn === null || (error === null && !refused)) return
      if (signIn.auth === null || error !== before?.[1] || refused !== before?.[2])
        void signIn.check()
    },
    { immediate: true },
  )
  const PENDING_CAPABILITY = {
    state: 'absent',
    reason: 'Still asking this provider what it can do.',
    checkedAgainst: 'the capability fetch has not returned yet',
  } as const
  const signInNeeded = computed(() => {
    const state = profileSignIn.value?.auth?.state
    return state === 'stale' || state === 'absent'
  })

  /**
   * **What the Reopen button would destroy if it were live right now** (149, from 148 M3).
   *
   * 🔴 **The RULE moved to `lib/reopening.ts` at `470` and nothing about it changed** — see
   * {@link reopeningHeldBy} for the whole of 149's reasoning, which is where it now lives. ⛔ It moved
   * because HO-028 §3 put a second reopen offer on the grant sheet, and a second surface deciding
   * *is this conversation holding work* from its own copy of the rule is `099`/`064`.
   *
   * ⚠️ **It still reads {@link control} and not {@link transcript}**, which is the distinction this
   * component owns: the panel a reader is scrolled away from is not what a press would destroy.
   */
  const signInHeldBy = computed<'question' | 'turn' | null>(() => reopeningHeldBy(control.value))

  /**
   * …and `busy` on top, the same double-click guard {@link canGoAhead} uses, for the same reason —
   * inside a command's bound (739, `A_COMMAND_IS_WAITED_ON_MS`).
   */
  const canReopenSignIn = computed(() => signInHeldBy.value === null && !props.record.busy)

  /**
   * The second line of the bar: what reopening costs, or what it is waiting for (149).
   *
   * 🔴 **The three sentences moved to {@link REOPENING_SAYS} at `470`**, with 149's measurement of
   * what a close-then-resume keeps and loses carried across in the docblock over them. ⛔ **Two of
   * them had to lose their DEIXIS**: they opened *"Answer the question ABOVE first"* and *"THIS
   * conversation is still working"*, which are true of a bar bolted to one conversation and false of
   * a row in a list of them. ⚑ Both open on `It` now — named by the note directly above this line
   * here, and by the row it sits in on the grant sheet.
   *
   * ⚠️ **One of the two needed more than a deictic swap, and `470 · relay 1` is where that was
   * measured.** The turn sentence is *"This"* → *"It"* and nothing else; the question sentence could
   * not be, because dropping *"above"* leaves *"Answer the question first"* naming no question — so
   * it gained a clause that names one: *"It has a question waiting. Answer that first…"*. ⛔ This
   * paragraph said *one word each* until the sweep read the two literals side by side.
   */
  // ⚑ **678 · one sentence for every conversation again** — R26: a reopen keeps the draft of the
  // selected conversation and of every other, so the bar and the grant sheet read the same words.
  const signInBarCost = computed(() => reopeningSays(signInHeldBy.value))
  /** The provider whose sign-in the bar is about, by its name, or plain words for none recorded. */
  const signInOf = computed(() => {
    const name = props.record.meta && providerName(props.record.meta.provider)
    return name ? `the ${name} sign-in` : 'the sign-in'
  })

  return {
    signInSuperseded,
    signInClient,
    providerName,
    profileSignIn,
    signInRefused,
    signInTarget,
    signInRenewedFor,
    signInSetup,
    signInAgain,
    PENDING_CAPABILITY,
    signInNeeded,
    canReopenSignIn,
    signInBarCost,
    signInOf,
  }
}
