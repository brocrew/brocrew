<script lang="ts">
import type { LaunchRefusal } from '../../../shared/runtime-ipc'

/**
 * Whether a launch attempt that just ended should hand the message back (015, re-keyed by 019).
 *
 * Exported and pure because it is the whole of a rule that is otherwise invisible: it fires on a
 * falling edge, only on failure, and only when there was something to give back. A watcher is not
 * reachable from a node/SSR test, so the decision lives here where it can be pinned — the same
 * seam the composer's send decision uses.
 */
export function shouldRestoreDraft(input: {
  busy: boolean
  wasBusy: boolean
  error: string | null
  lastTried: string
  /** What is in the box right now. Handing text back must never overwrite newer text. */
  current: string
}): boolean {
  return (
    input.wasBusy &&
    !input.busy &&
    input.error !== null &&
    input.lastTried !== '' &&
    // Never over the top of what is being typed NOW. This clause was written because the launch
    // flag and the launch error were both SHARED with reopening a conversation, and this surface
    // stays mounted through one — 100 gave the error its own ref and 102 made `busy` per gesture,
    // so that particular door is closed; the rule stands on its own merit either way, and a
    // hand-back that overwrote live typing would be 019's bug whatever opened it.
    input.current === ''
  )
}

/**
 * 🔴 **725 · `716` F-1 — whether the automatic sign-in check could say anything the refusal did not.**
 *
 * ⚑ **Main's own table, read as it is written** (`LAUNCH_REFUSALS`, `runtime-ipc.ts`): for a
 * `sign-in` refusal the check is *"the remedy — its buttons are how a person fixes it"*; for
 * `program`, `folder`, `machine` and `launch` it *"says nothing the refusal did not"*; a `cancelled`
 * start never reaches here (the store swallows it as a Cancel). ⚠️ **And a refusal with NO word is
 * the case the check exists for** — *"the launcher's check is then the only diagnosis there is"* —
 * so `null` and absent both run it.
 *
 * ⛔ **`710` F-7 is the defect**: after a start the machine ran short for, the launcher drew TWO
 * boxes — the refusal's sentence, and *"Could not check this profile’s sign-in"* with the same
 * shortage as its reason. One fact, said twice.
 *
 * ⚑ Exported and pure for {@link shouldRestoreDraft}'s reason: a watcher is not reachable from a
 * node test, and a seventh word added to main's table must be answered here, not guessed.
 */
export function theCheckCanSayMore(refusedAs: LaunchRefusal | null | undefined): boolean {
  return refusedAs == null || refusedAs === 'sign-in'
}

/**
 * Whether the blocking group at the foot of the column has anything to show (101 §7, 103 review).
 *
 * ⚠️ **Exported and pure for the same reason `shouldRestoreDraft` is: the answer is invisible from
 * the outside, and the obvious version of it is wrong.** The group holds two things — the launch
 * error, and `SignInPanel` — and the panel renders NOTHING when the credential is fine. Gating the
 * wrapper on `authState` being truthy therefore opened an empty flex box with a margin above the
 * composer the moment a check came back `usable`: 24px of unexplained gap, found by three
 * independent review angles.
 *
 * So it asks the question the panel asks itself. Duplicating that predicate is the lesser evil —
 * the alternative is asking a different question and hoping the answers agree — and this comment is
 * the pointer that has to move if `SignInPanel.visible` ever changes.
 */
export function blockingGroupShows(input: {
  error: string | null
  /** `null` when nobody has asked; `usable` when the answer was "you are fine". */
  authState: { state: string } | null
}): boolean {
  return input.error !== null || (input.authState !== null && input.authState.state !== 'usable')
}
</script>

<script setup lang="ts">
import { defaultModel } from '../lib/provider-models'
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import type {
  AuthState,
  CapabilityStatus,
  CreateSessionInput,
  HandedPath,
  Provider,
  ProviderCapabilityMap,
  ProviderProgram,
} from '../../../shared/runtime-ipc'
import { A_STANDING_WARNS, DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { sessionFacets } from '../lib/agent-state'
import { fullTime } from '../lib/clock'
import type { LaunchChoices } from '../lib/launch-choices'
// 🔴 **UI-012 · the one model picker, and the lists it reads** — see `lib/model-lists.ts`.
import { theFormSends, type ModelLists, type PickedModel } from '../lib/model-lists'
import { useModelLists } from '../composables/useModelLists'
import { CHANGEABLE_LIVE_IN } from '../lib/front-door-words'
import type { DraftHanding } from '../lib/drafts'
import { readableError } from '../lib/session-record'
import type { SendIntent } from '../lib/session-store'
import PromptComposer from './PromptComposer.vue'
import SessionHeader from './SessionHeader.vue'
import SignInPanel from './SignInPanel.vue'
import ModelPicker from './ModelPicker.vue'
import { conversationTitle, type ListedConversation } from '../lib/conversation-list'
import { agentStateWords } from '../../../shared/agent-state'

/**
 * The launcher's plate: faceless — nothing is known about a conversation that does not exist (082).
 *
 * Built by the same function every live conversation goes through rather than written out as two
 * literals, so the one surface whose answer is known in advance still gets it from the one place
 * that decides — and changes with it.
 */
const LAUNCHER_FACETS = sessionFacets({
  phase: null,
  status: null,
  activity: null,
  streaming: false,
  liveness: null,
})

/**
 * A thread that has not started yet — and the whole of what it asks for is the message.
 *
 * ## 🔴 The three pickers are gone (417, HO-022 §2)
 *
 * > *"Opening a new conversation opens a conversation with BroBot. That is all."*
 *
 * ⛔ **No profile picker, no project picker, no folder picker.** `167` put a profile picker here
 * and its reasoning was right for the app it shipped into; the PO has since ruled that the front
 * door is not one identity among several — *"it is the front door"* — and that every other session
 * starts from the roster (⚑ D-016: projects are gone). ⚑ **BroBot has no human name**, so the
 * new-profile name box went with the menu that offered it.
 *
 * ⛔ **And no approvals, plan or ultracode control** — those are `DEFAULTS` in the ruling,
 * *"changeable afterwards where every other setting lives"*.
 *
 * ## 🔴 …and THREE of the deleted controls came back at `435` (HO-025 §5)
 *
 * ⛔ **The PO reversed half of his own ruling and reaffirmed the other half in the same breath:**
 * *"What `asks nothing` meant was: do not make configuring a session the price of starting a
 * conversation. It did not mean the choices should be unavailable… The front door asks nothing and
 * OFFERS EVERYTHING."* ⚑ **Provider, model and reasoning effort are drawn again**, in
 * `launcher-choices`, in the faint register the notes use — and the five above stay deleted.
 *
 * ⚑ **What survives of *asks nothing* is a property of the PAYLOAD**: `model` and `reasoningEffort`
 * are written as OMISSIONS, so an untouched door puts exactly `{provider, profileId, approvalMode}`
 * on the wire, which is what `417` shipped, byte for byte. See {@link settings}.
 *
 * ⚠️ **`providerIsFixed` is unchanged and got MORE true**: HO-025 §4 rules that the provider is the
 * one setting that does NOT stay changeable, *"and the app should SAY that rather than offer a
 * control that silently relaunches"* — which is the sentence directly beneath the control.
 *
 * ## ⚠️ What that COSTS, recorded here because the surface is where it is spent
 *
 * 🔴 **FIVE capabilities leave with the three controls, and none of them has another door.**
 * `417 §2` measured the app for a second one and found none: the renderer has exactly one
 * `createSession` call, reached from this component alone.
 *
 * 1. ⚑ **ANSWERED at `423`.** *"Start a conversation as any identity but BroBot"* — the *New
 *    conversation…* press on an agent's own sheet, reached from the Team page (`StartAsAgent.vue`).
 * 2. ⚑ **ANSWERED at `423`.** *"Bring an identity into being at all"* — the `+ New profile…` row
 *    was the only person-operated way an `agent_identity` row was ever created — is now the Team
 *    page's `New agent` and `NewAgent.vue`, on `419`'s `createAgent` (`423` put it in the rail's
 *    AGENTS section and `EXT-008` §4.4 moved that section to a page at `570`). ⛔ **The loss is recorded rather
 *    than deleted**: it is what the door cost, and the gesture that answers it is not on this
 *    screen, which is the ruling.
 * 3. ⚑ **ANSWERED at `435`.** *"Choose the provider"* — `423` moved the answer without moving it
 *    here, leaving `RuntimeScreen.DEFAULT_PROVIDER` reachable in exactly one state (before a first
 *    conversation, through the create door `423` added); HO-025 §5 ruled that *"a person who has to open a
 *    settings surface to pick a provider — or cannot, because the column has one writer — is worse
 *    off than before"*. **`provider-select` came back**, and what a person picks is the FIRST term
 *    of `providerForALaunch`. ⚑ **UI-012 (R-3) folded it into the one model picker**: it lists both
 *    providers' models, so picking a Codex model IS choosing Codex. ⛔ **The loss is recorded rather
 *    than deleted**, because what it cost for two dispatches is the argument for what it costs to
 *    take a choice away.
 * 4. ⚑ **GONE with projects at D-016.** *"Choose the project"* has no subject any more.
 * 5. **Choose the folder.** A front-door conversation runs in the app's own workspace
 *    (`resolveSessionCwd`'s blank branch); ⚑ since D-016 the agent's *New conversation…* sheet is
 *    where a person chooses a folder.
 *
 * ⚑ And `ultracode` went with the fold — the one launch setting with no live control at all.
 *
 * ⛔ **`417` wrote here: *do not answer any of this by putting a menu back*, and it was right for
 * the ruling it had.** ⚑ **HO-025 §5 is the PO answering three of them by putting menus back** —
 * which is the difference between a dispatch working around a gap and a dispatch being told the
 * gap was the defect. The rest are recorded above.
 *
 * ## ONE start path (013)
 *
 * Typing into the composer and sending — the button, or ⌘/Ctrl-Enter (015) — is the only way a
 * conversation begins. The first version of this surface had two paths, a composer and a
 * form-submit inside a disclosure, and only the form captured the provider select, so picking
 * Claude and typing started Codex. There is one door, and now there is nothing on it to miss.
 */
const props = withDefaults(
  defineProps<{
    busy: boolean
    error: string | null
    recent?: readonly ListedConversation[] | null
    /**
     * 🔴 **725 · `716` F-1 — the word main refused this surface's last start with**
     * (`store.launchRefusal`), or `null`/absent where it gave none — see {@link theCheckCanSayMore}.
     * ⚑ Optional, and absent runs the check exactly as before: a mount that hands no word is a mount
     * that knows only the sentence.
     */
    refusedAs?: LaunchRefusal | null
    debug: boolean
    /** What is typed on THIS surface and not yet sent (019) — its own slot, no session id yet. */
    draft: string
    /**
     * ⛔ **The FIRST message's attachment transaction** (217, 292 §2) — owned by the caller and keyed
     * `NEW_CONVERSATION`, exactly as {@link draft} is, for the same `019` reason: this surface is
     * torn down whenever a conversation opens over it, so anything it owned itself would not survive
     * leaving and coming back. ⚑ It rides in the draft book's own `paths` shelf, which `keepOnly`
     * already prunes with the words — so there is no second lifetime to get wrong.
     *
     * ⚠️ **A LIST was not enough, and this surface is where that is easiest to see** (`288` H2). It
     * is unmounted for as long as any conversation is on screen, so a screenshot pasted here and
     * answered after you opened a thread reached nothing at all. ⛔ **Required**: the failure mode of
     * a missing one is silence, and the typechecker is the only reader this repository has for
     * `RuntimeScreen`'s bindings.
     */
    handing: DraftHanding
    /**
     * 🔴 **What this conversation will run on, and cannot stop running on** (417, 423).
     *
     * ⚠️ **It stopped being a default the moment the select went**, and at `423` it stopped being a
     * constant. Its source is now `RuntimeScreen.frontDoorProvider` — *BroBot's identity's provider,
     * or `DEFAULT_PROVIDER` when that identity has not said* — which is `admitGive`'s resolution
     * order with the giver term removed, because a launch has no parent. ⛔ **The name stays
     * `defaultProvider` because that is what it is to THIS surface**: a value it did not choose,
     * cannot move, and must say out loud.
     *
     * 🔴 **This screen CAN move it since `435`, and only before the conversation starts** (HO-025 §4).
     * ⚑ Since UI-012 the model picker writes the asked term that `providerForALaunch` ranks first —
     * a model is a provider's — so this prop is still the resolved answer: see {@link startOn}.
     * ⛔ **Once the conversation is open
     * nothing anywhere can move it**, as `417 §3` measured, which is why it is SAID rather than merely
     * obeyed: see {@link providerIsFixed}. ⚑ The sentence, the control and the payload below read this
     * one prop, so the screen cannot name a provider the launch did not use.
     */
    providerReadiness?: Readonly<Partial<Record<Provider, boolean | null>>> | null
    defaultProvider: Provider
    /**
     * 🔴 **The mode this conversation will begin in, because a person set it once** (500,
     * HO-036 §3.1) — *"a person sets their approval mode once, and every conversation they start
     * begins there."*
     *
     * ⛔ **`null` is *nobody has answered yet* and it is not `ask`** — `086`'s rule, on the one
     * control where the wrong default is dangerous in both directions. It arrives null until
     * `agentStore.load()` answers, which is the SAME window {@link defaultProvider} has and which
     * `RuntimeScreen.frontDoorProvider`'s docblock rules open on purpose. ⚑ **The launch still sends
     * `'ask'` in that window** — see {@link settings} — and the control SAYS the row has not been
     * read rather than drawing a state nobody has established.
     *
     * ⚑ **Resolved by the screen and passed in, exactly as {@link defaultProvider} is**, so the
     * sentence this surface shows and the value the launch sends are one value and cannot come
     * apart. ⛔ **That placement is also the safety property**: the default is spent HERE, above the
     * IPC boundary, so nothing below it — and therefore no spawn — can read it.
     */
    defaultApprovalMode: 'ask' | 'auto' | null
    approvalDefaultChosen?: boolean
    /**
     * What each provider can do, declared by its adapter (039) — the only thing this surface is
     * allowed to consult when deciding what it may say.
     *
     * `null` while the fetch is in flight, and it means **say nothing**: a sentence shown on a guess
     * and then withdrawn is worse than one that arrives a moment late.
     */
    capabilities: ProviderCapabilityMap | null
    /**
     * The program each provider runs on this computer, as the screen above read it
     * (`providerVersions`). The form speaks only when the one it starts on is missing, unreadable or
     * older than the versions tested ({@link A_STANDING_WARNS}); absent says nothing.
     */
    programs?: Readonly<Partial<Record<Provider, ProviderProgram>>> | null
    /**
     * 🔴 **UI-012 · the window's model lists** — injectable for tests; the window's one holder
     * otherwise (`useModelLists`). ⚑ BroBot's two lists are already being read by the screen above
     * (`RuntimeScreen.shownProfiles`), so the picker's face costs no provider child.
     */
    lists?: ModelLists
    /**
     * 🔴 **The three answers a person may have given before pressing send** (435, HO-025 §4/§5) —
     * owned by the screen above, because this one is torn down when a conversation opens over it.
     *
     * ⛔ **See {@link LaunchChoices} for why it is not a `ref` in here**: `210` typed a prompt, chose
     * Claude, looked at another conversation and came back to the prompt under Codex. ⚑ Every one of
     * these may be unanswered, and an unanswered one is what makes this door's launch byte-identical
     * to the one `417` shipped.
     */
    choices: LaunchChoices
  }>(),
  { approvalDefaultChosen: undefined, providerReadiness: null },
)

const emit = defineEmits<{
  /**
   * Start BroBot's session with this first message.
   *
   * ⛔ **And with the paths handed to it** (217). `013` makes the launcher's prompt the FIRST
   * message, so a conversation that cannot carry a file here cannot BEGIN with one — a person has
   * to start a thread about nothing and attach on the second turn. ⚑ Carried on the event, exactly
   * as `PromptComposer`'s own `send` carries them: a separate channel is what dropped every
   * attachment in `216`'s review, and this hop is one more place it could happen.
   */
  start: [input: CreateSessionInput, firstMessage: string, attachments: HandedPath[]]
  /** Stop waiting for the launch in flight (102). Only reachable while `busy`. */
  cancel: []
  toggleDebug: []
  'update:draft': [text: string]
  /**
   * ⛔ **A credential gesture for this profile has SETTLED** (257 §2) — sign in, or re-copy.
   *
   * The host drops that home's memoized model catalogue when one of these finishes, because it is
   * the one moment the answer can change under a running app. ⚠️ **Nothing would ever ask again
   * without this event**: the screen above remembers which profiles it has asked about, so a host
   * that quietly forgot and a screen that never re-asked would leave the pre-sign-in menu on the
   * page for the rest of the app run — the invalidation working perfectly and reaching nobody.
   *
   * ⚑ Not raised for a CHECK: asking whether a profile is signed in cannot change what it may run.
   */
  'auth-changed': [profileId: string]
  /** ⚑ W4.10 · a person asked for the Providers screen from a sign-in problem here. */
  'open-providers': [provider?: Provider]
  /**
   * ⛔ **A person answered one of the three** (435) — the whole object, not a patch.
   *
   * ⚠️ **Whole, because the holder is one `ref` and a patch would make two shapes of the same
   * fact.** The surface below rebuilds it from {@link props.choices} on every change, so what the
   * screen writes is always what this screen was last showing.
   */
  'update:choices': [choices: LaunchChoices]
  /**
   * 🔴 **A person set the mode every conversation they start begins in** (500) — the WHOLE value,
   * not a toggle, so the press and the state it asks for are one fact.
   *
   * ⛔ **It is not `update:choices`' fifth field, and that is the whole point.** {@link LaunchChoices}
   * is *"in memory, for this run of the app… nothing writes it to disk"*; this one is written to
   * `app_policy` and outlives every launch. ⚠️ A persistent setting carried in the per-launch
   * carrier would be the category error this surface is most able to cause: three controls beside
   * it mean *this conversation*, and this one means *every conversation*.
   */
  open: [sessionId: string]
  setApprovalDefault: [mode: 'ask' | 'auto']
}>()

/*
 * ⛔ **The one identity this door opens is `DEFAULT_PROFILE_ID`, used directly** (417, HO-022 §2)
 * — *"A new conversation is always BroBot."*
 *
 * ⚠️ **A constant and not a ref, which is the whole of the change.** While this was a `ref` fed by
 * a `<select>`, every question below — which home to check, which sign-in to cancel, whether the
 * answer that just arrived still describes the screen — had two possible answers and needed a
 * stamp to tell them apart. There is one answer now, so the stamp is gone with the menu that made
 * it necessary; see {@link withAuthGesture}.
 *
 * ⚑ **The imported constant rather than a local alias for it**, so the census that pins this
 * surface to one identity is pinning the shared name every other reader uses rather than a
 * spelling this file invented.
 */

// --- the credential this profile runs on (098) ---

/**
 * The last thing the provider said about the selected profile's sign-in, or `null` for "nobody has
 * asked". ⚠️ `null` and `usable` are both silent and they are not the same fact — the panel renders
 * `unknown` precisely so that "we could not ask" is never shown as "you are fine".
 */
const foldTitle = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const recentConversations = computed(() => {
  const words = [...new Set(foldTitle(props.draft).match(/[\p{L}\p{N}]+/gu) ?? [])]
  return (props.recent ?? [])
    .filter((row) => row.identity === DEFAULT_PROFILE_ID)
    .map((row) => ({
      row,
      matches: words.filter((word) =>
        foldTitle(conversationTitle(row.label, row.named)).includes(word),
      ).length,
    }))
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        b.row.updatedAt - a.row.updatedAt ||
        a.row.sessionId.localeCompare(b.row.sessionId),
    )
    .slice(0, 6)
})

const authState = ref<AuthState | null>(null)
const authBusy = ref<'idle' | 'checking' | 'copying' | 'signing-in'>('idle')
const authNotice = ref<string | null>(null)
/**
 * 🔴 **The stamp — removed at `417`, put back at `423`, and the reason is the whole story.**
 *
 * `167` had it because *"every one of these calls is asynchronous and the provider select is right
 * there. A sign-in can stay pending for minutes, and without this stamp its answer would land in
 * the shared `authState` long after the user had switched to the other provider."* ⛔ **`417`
 * deleted it on a stated premise**: *"`props.defaultProvider` and `DEFAULT_PROFILE_ID` are both
 * fixed for the life of this surface, so every answer describes the only question it could have
 * been asked."*
 *
 * ⚠️ **`423` falsified the premise and owes the guard.** The prop's source is now
 * `RuntimeScreen.frontDoorProvider`, *BroBot's identity's provider or the app frame's constant* —
 * and `NewAgent` is an OVERLAY, a sibling of `<main>`, so a person can create `default` with a
 * provider while this surface stays mounted behind the sheet. `AgentStore.create` awaits its
 * re-read, so the prop moves under a pending gesture. ⛔ **`DEFAULT_PROFILE_ID` is still fixed**;
 * only the provider can move, and that is what this holds.
 *
 * ⚑ **A plain `let`, not a `ref`, and that is `361` §1's defect kept fixed.** The old stamp WAS a
 * `ref`, so `cancelProviderSignIn` was handed a Vue reactive `Proxy` and every cancel of a running
 * sign-in threw at the bridge. Nothing renders this, so it needs no reactivity — and every wire
 * call below builds a fresh literal from its fields rather than sending this object.
 */
let askedFor: { readonly provider: Provider; readonly profileId: string } | null = null

/**
 * ⛔ **Whether the answer that just landed still describes the screen** (423, and `167`'s rule).
 *
 * ⚠️ **The PROVIDER only.** A gesture is keyed `provider:profileId` in the host and the profile
 * cannot move here, so a stale answer is always a stale provider — and a guard that also compared
 * a constant would be `a-comparison-tested-where-both-sides-agree`.
 */
const stillAsking = (asked: { readonly provider: Provider }): boolean =>
  asked.provider === props.defaultProvider

/**
 * ⛔ **A settled credential answer is about a PROVIDER, so it goes when the provider does** (423).
 *
 * {@link stillAsking} stops a late answer landing in the wrong slot; this clears the one that
 * already landed. ⚠️ Without it a person who created `default` on Claude would read Codex's
 * sign-in state under a sentence naming Claude — 086 in the direction that reassures.
 */
watch(
  () => props.defaultProvider,
  () => {
    // ⛔ **NOT while a gesture is in flight, and that is not a detail.** `SignInPanel` renders at
    // all only when `authState` is non-null, and the CANCEL for a pending browser flow lives
    // inside it — so clearing here would take the only way to stop a running sign-in off the
    // screen. ⚑ The stale answer is already refused by {@link stillAsking}; what is left for this
    // to do is drop a SETTLED answer, and {@link withAuthGesture} drops the other one when the
    // gesture it belonged to finishes.
    if (authBusy.value !== 'idle') return
    authState.value = null
    authNotice.value = null
  },
)

/** Whether the foot's blocking group has anything in it — see {@link blockingGroupShows}. */
const blockingShowing = computed(() =>
  blockingGroupShows({ error: props.error, authState: authState.value }),
)

/**
 * The program this conversation would start on, when its standing warns ({@link A_STANDING_WARNS}):
 * missing, unreadable or older than tested — never newer, which says nothing is wrong. Not a blocker:
 * a launch still runs where the program is, and where it is not, the launch's own refusal says so in
 * the blocking group.
 */
const programNotice = computed<ProviderProgram | null>(() => {
  const program = props.programs?.[props.defaultProvider]
  return program === undefined || !A_STANDING_WARNS[program.standing] ? null : program
})

/**
 * Whether this provider can be signed into inside the profile, and whether the machine credential
 * can be copied into it — indexed by `props.defaultProvider` rather than tested against a name:
 * this surface asks what the provider SUPPORTS and never names one, which is what
 * `provider-neutrality.test.ts` keeps true. `absent` while the capability fetch is in flight, so
 * nothing is offered on a guess.
 */
const pendingCapability: CapabilityStatus = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
}
const signInCapability = computed<CapabilityStatus>(
  () => props.capabilities?.[props.defaultProvider]?.signIn ?? pendingCapability,
)
const reprovisionCapability = computed<CapabilityStatus>(
  () => props.capabilities?.[props.defaultProvider]?.reprovisionAuth ?? pendingCapability,
)

/**
 * Ask, on a falling edge into failure — never on mount, and never off the error TEXT.
 *
 * Asking is a real cost (a short-lived provider process), so it is spent only where the answer can
 * matter: a launch that just failed — ⚑ **and, since `725`, only one whose refusal did not already
 * say why** (`716` F-1, {@link theCheckCanSayMore}): off main's closed WORD, never its sentence.
 * ⚠️ After one that did, the check runs only to ask again about an *expired* / *not signed in*
 * already up, and an automatic *could not check* is not drawn (see the watch).
 *
 * And it is spent on the provider rather than on `props.error`, because reading that string is
 * exactly the coupling 085 removed — an adapter rewording its diagnostic must never change what
 * this surface believes about a credential.
 *
 * ⚠️ **`busy`/`error` WERE shared with reopening a recorded conversation** (098 review finding 7) —
 * `shouldRestoreDraft` at the top of this file exists for the same reason. A failed reopen of a
 * conversation on the OTHER provider would otherwise make this probe the launcher's selected one and
 * accuse it of a credential problem it does not have. ⚠️ **The stamp that used to make the answer
 * belong to a provider is gone** (417) — there is one provider here now — so this guard is the
 * whole of it: it stops the question being asked in the first place, and a reopen failure costs no
 * provider process at all.
 *
 * Both halves of that sharing are gone now — 100 gave the reopen its own error ref, 102 made `busy`
 * per gesture — and this stays anyway. It is cheap, it is the belt to those two braces, and the
 * cost of it being wrong is a provider process spawned to accuse the wrong credential.
 */
watch(
  () => [props.busy, props.error] as const,
  ([busy, error], previous) => {
    const wasBusy = previous?.[0] ?? false
    if (!(wasBusy && !busy && error !== null)) return
    if (!launchedFromHere.value) return
    // 🔴 **725 · `716` F-1 — not where the refusal already said why** ({@link theCheckCanSayMore}).
    lastSaidWhy = !theCheckCanSayMore(props.refusedAs)
    if (!lastSaidWhy) {
      void checkAuth(true)
      return
    }
    // ⚑ **And what an earlier check left up** (review, two rounds), only while no gesture is in
    // flight — a check still running lands through {@link checkAuth}'s own rule instead:
    //  - *could not check* goes, unasked: under this sentence it is `710` F-7's second box;
    //  - *expired* / *not signed in* is ASKED AGAIN, as `main` did after every failure: for Codex
    //    the refusal proves nothing (its expiry is asked only once its child is up, which a shortage
    //    at the spawn never reached); for Claude, whose sign-in is asked before any child, a refusal
    //    past the spawn means it passed — either way the provider's own answer keeps or clears it;
    //  - *usable* draws nothing, so nothing is asked (review, round three).
    if (authBusy.value !== 'idle') return
    if (authState.value?.state === 'unknown') {
      authState.value = null
      return
    }
    if (authState.value !== null && authState.value.state !== 'usable') void checkAuth(true)
  },
)

/**
 * Whether the launch that is settling is the one THIS surface started.
 *
 * Set when the composer sends and cleared as soon as the attempt ends, so a reopen driven from the
 * rail — which shares the same two store refs — never looks like a launcher failure.
 */
const launchedFromHere = ref(false)
watch(
  () => props.busy,
  (busy) => {
    if (!busy) launchedFromHere.value = false
  },
)

/**
 * Run a credential gesture.
 *
 * 🔴 **The stamp is back, and only half of it** (423). `417` removed it because *"this surface has
 * one provider and one profile, both constants, so `stillCurrent` could only ever return `true`
 * and a guard no input can fail is not carrying a rule"* — which was exactly right then and is
 * false now: {@link askedFor} says why. ⛔ **The profile half stays gone**, because
 * `DEFAULT_PROFILE_ID` really is a constant here and a comparison where both sides always agree
 * measures nothing. ⚠️ **What survives unchanged is the `authBusy` gate**, which is what actually
 * stops two gestures overlapping.
 *
 * ⚠️ **The fail-closed clause went the same way.** It refused a gesture for a profile still being
 * typed, because *"every one of these gestures resolves a home and PROVISIONS it to answer"* and a
 * question must not create a profile as a side effect (167 §1.2, 257 §2). There is no name being
 * typed here now; the only profile this surface can name is one the app seeds itself.
 */
async function withAuthGesture(
  phase: 'checking' | 'copying' | 'signing-in',
  run: (asked: { provider: Provider; profileId: string }) => Promise<void>,
): Promise<void> {
  if (authBusy.value !== 'idle') return
  const asked = { provider: props.defaultProvider, profileId: DEFAULT_PROFILE_ID }
  askedFor = asked
  authBusy.value = phase
  try {
    await run(asked)
  } finally {
    // Cleared either way: the flag must not stick after the gesture it belonged to has finished.
    authBusy.value = 'idle'
    askedFor = null
    // ⛔ **And if the provider moved while this ran, what is on screen is about the old one.** The
    // watch above deliberately does not fire during a gesture — it would take the Cancel away from
    // a running sign-in — so this is where that clear happens instead, once the panel is no longer
    // the only way to stop anything.
    if (!stillAsking(asked)) {
      authState.value = null
      authNotice.value = null
    }
    // ⛔ **Announced whether it succeeded or not** (257 §2), for the reason the host invalidates
    // unconditionally: from here we cannot tell whether a credential landed — a flow can fail after
    // writing one, and a timeout reports no outcome at all. The cost of being wrong is one
    // short-lived provider child; the cost of the other direction is a menu describing an account
    // this profile no longer uses.
    if (phase !== 'checking') emit('auth-changed', asked.profileId)
  }
}

/**
 * 🔴 **725 · whether the LATEST failure from here said why** (`716` F-1) — set by the watch above on
 * every one. ⚑ An automatic check that answers *could not check* while it is `true` draws nothing
 * and clears what was up (review): under a refusal that already said why, that box is `710` F-7's
 * second one. ⚑ Every other answer is drawn — it is the provider's, about the credential, whichever
 * failure asked it. ⛔ A person's own *Check again* is drawn whatever it answers.
 */
let lastSaidWhy = false

async function checkAuth(automatic = false): Promise<void> {
  const drawn = (said: AuthState): AuthState | null =>
    automatic && lastSaidWhy && said.state === 'unknown' ? null : said
  await withAuthGesture('checking', async (asked) => {
    try {
      const said = await window.api.runtime.checkProviderAuth(asked)
      if (stillAsking(asked)) authState.value = drawn(said)
    } catch (error) {
      if (stillAsking(asked)) {
        authState.value = drawn({ state: 'unknown', reason: readableError(error) })
      }
    }
  })
}

/**
 * Re-copy the machine credential. ⚠️ The outcome is reported honestly INCLUDING `unchanged`: a
 * button that says "copied" over identical bytes teaches the user that it does nothing.
 */
async function reprovisionAuth(): Promise<void> {
  await withAuthGesture('copying', async (asked) => {
    authNotice.value = null
    try {
      const outcome = await window.api.runtime.reprovisionProviderAuth(asked)
      if (stillAsking(asked)) {
        authNotice.value =
          outcome === 'replaced'
            ? 'Copied your machine sign-in into this profile.'
            : 'Your machine sign-in is identical to the one already here, so nothing changed — it is expired on both.'
      }
    } catch (error) {
      if (stillAsking(asked)) authNotice.value = readableError(error)
    }
  })
  // Re-ask rather than assume the copy fixed it. It may not have: if the machine credential is the
  // same expired one, the copy is a no-op and the honest thing is to keep saying so.
  await checkAuth()
}

/**
 * Sign this profile in. The promise stays pending for as long as the browser flow takes, which is
 * why `authBusy` drives a Cancel button beside it rather than a spinner alone.
 */
async function signIn(): Promise<void> {
  await withAuthGesture('signing-in', async (asked) => {
    authNotice.value = 'Finish signing in in your browser, then come back.'
    try {
      const result = await window.api.runtime.signInProvider(asked)
      if (stillAsking(asked)) {
        authState.value = result.state
        authNotice.value = result.success
          ? 'Signed in. This profile now has its own sign-in.'
          : (result.detail ?? 'The sign-in did not complete.')
      }
    } catch (error) {
      if (stillAsking(asked)) authNotice.value = readableError(error)
    }
  })
}

async function cancelSignIn(): Promise<void> {
  // 🔴 **A plain object literal, and that is the defect `361` was dispatched to find** (361 §1).
  // This used to read a `ref` holding the in-flight stamp, so `authFor.value` was a Vue reactive
  // `Proxy` — and `ipcRenderer.invoke` structured-clones its payload and refuses a proxy by name.
  // ⛔ **Every cancel of a sign-in that was actually running threw at the bridge and the button did
  // nothing.** ⚑ The stamp is back at `423` (see {@link askedFor}) and the fix is kept: it is a
  // plain `let`, and the literal below is rebuilt from its FIELDS rather than being the object
  // itself, so nothing reactive can ever reach the wire through this call again.
  //
  // ⛔ **It cancels the pair that is RUNNING, not the pair on screen** — the host keys a sign-in
  // `provider:profileId`, and after `423` those two can differ: the provider can move while a
  // browser flow is pending, and a cancel naming the new one would miss the key and leave the old
  // flow running under a button that reported it stopped.
  const running = askedFor ?? { provider: props.defaultProvider, profileId: DEFAULT_PROFILE_ID }
  try {
    await window.api.runtime.cancelProviderSignIn({
      provider: running.provider,
      profileId: running.profileId,
    })
  } catch (error) {
    // ⚠️ **Where the other four gestures put their failures.** This was the one gesture in the panel
    // whose rejection had nowhere to land: it became an unhandled rejection, so the wire's refusal
    // above was invisible for as long as it existed. A cancel that could not be delivered has to
    // say so, or the sign-in it did not stop goes on looking cancelled.
    authNotice.value = readableError(error)
  }
}

/* ------------------------------------------------------------------ the three choices (435) */

/**
 * 🔴 **The front door asks nothing and OFFERS EVERYTHING** (HO-025 §5).
 *
 * ⛔ **This is not a revert of `417`.** That dispatch deleted a 2,998-line screen which made a
 * person answer four questions before typing a word, and the PO reaffirmed the judgement in the
 * same ruling that corrected it: *"What `asks nothing` meant was: do not make configuring a session
 * the price of starting a conversation. It did not mean the choices should be unavailable, and a
 * person who has to open a settings surface to pick a provider — or cannot, because the column has
 * one writer — is worse off than before."*
 *
 * ⚑ **Three controls come back and five do not.** Provider, model and reasoning effort are the
 * three HO-025 §4 names. ⛔ The profile picker does not (a new conversation is BroBot), nor the
 * project picker (⚑ D-016: there are no projects), nor the folder (`424` gave BroBot its own
 * workspace), nor the approvals checkbox (HO-025 §4 does not name
 * it and `417 §1.6` measured the safety property getting STRONGER without it), nor `ultracode`
 * (still no mid-session door, still `417 §10.2`'s finding). ⚑ **UI-012 made the three ONE
 * control** — the model picker (`09` §1), whose list names the provider and holds the effort.
 *
 * ## ⛔ *Out of the path*, as four things a test holds
 *
 * A phrase in a ruling is how `417` was read one way and implemented another, so `435`'s brief
 * turns this one into assertions and they are pinned in
 * `a-front-door-that-offers-everything.dom.test.ts`:
 *
 *  1. **the composer is first** — the caret lands in it on mount ({@link focusComposer}), and
 *     nothing below is required before send;
 *  2. **a person can send without touching a control** — the defaults apply, and the payload of an
 *     untouched door is byte-identical to `417`'s ({@link settings});
 *  3. **the choices are reachable from THIS screen** — not from a settings surface a person has to
 *     know about;
 *  4. **and they do not move the composer** — there is nothing to open, and anything these controls
 *     do (a menu filling, a sentence arriving, a long refusal wrapping) happens inside
 *     `.empty-stage`, which is `flex: 1` with its own scrollbar. ⚠️ **The test measures the
 *     composer's box and not the rule**, with a planted control that proves the measurement can see
 *     movement when there is some.
 */

/**
 * ⛔ **Both providers, from the TABLE rather than typed** — `169 §2`'s rule, and the idiom
 * `NewAgent.vue` already uses for the other surface where a person names one. A literal `'codex'`
 * here would be a provider decision in the renderer, which `provider-neutrality.test.ts` allows in
 * two places and this is not one.
 */
const providers = computed<Provider[]>(() => Object.keys(PROVIDER_NAME) as Provider[])

/**
 * Hand one answer up to the screen that holds them — see {@link LaunchChoices} for why it holds them.
 *
 * ⚠️ **Rebuilt from the prop every time**, so what the screen stores is what this surface was last
 * showing. A local copy kept in step with a watcher would be the second place a choice could live.
 */
function choose(patch: Partial<LaunchChoices>): void {
  emit('update:choices', { ...props.choices, ...patch })
}

/** ⚑ **The window's model lists** — see {@link props.lists}. */
const lists = computed(() => props.lists ?? useModelLists())

/**
 * ⚑ **BroBot's list on the provider this conversation will start on**, once it has answered.
 */
const heldList = computed(() => {
  const held = lists.value.held(props.defaultProvider)
  return held?.state === 'answered' ? held.list : null
})

/**
 * 🔴 **UI-012 · R-1 — what the picker's face shows: the person's pick, else the last pick** (`09`
 * §8: *"last one picked"*), else what the host would start BroBot on — shown by name, like any
 * choice. ⚑ `null` while nothing names one; the face then says why in {@link shownEmpty}.
 */
const modelMatchesProvider = computed(
  () => props.choices.provider === null || props.choices.provider === props.defaultProvider,
)

const shownPick = computed<PickedModel | null>(() => {
  const model = props.choices.model.trim()
  if (model !== '' && modelMatchesProvider.value) {
    return {
      provider: props.defaultProvider,
      model,
      effort: props.choices.reasoningEffort === '' ? null : props.choices.reasoningEffort,
    }
  }
  const starts = defaultModel(heldList.value)
  return starts === null ? null : { provider: props.defaultProvider, ...starts }
})

/**
 * ⚑ **The face's words when nothing names a model** — still asking, the read itself failed, or the
 * list answered and names none; the panel says why in the provider's own words (`model-field.ts`).
 */
const shownEmpty = computed(() => 'Choose a model')

/**
 * ⚑ **Take, on the form: the pick is held by the screen above** ({@link LaunchChoices}) — and a
 * Codex model moves `providerForALaunch`'s first term, which is how the provider is chosen here
 * now (R-3). ⛔ Nothing is sent: the launch carries it.
 */
function startOn(pick: PickedModel): Promise<string | null> {
  choose({ provider: pick.provider, model: pick.model, reasoningEffort: pick.effort ?? '' })
  return Promise.resolve(null)
}

const startsOnSays = `This conversation starts on it. You can change it later in ${CHANGEABLE_LIVE_IN}.`

/**
 * 🔴 **The caret starts in the composer** (HO-025 §5: *"Defaults applied, composer focused"*).
 *
 * ⛔ **Property 1 of `435 §2`, and it is the half of *asks nothing* that survives intact.** Three
 * controls sit below; none of them is in the way, and the proof a person gets on mount is that the
 * thing already focused is the box they type into.
 *
 * ⚠️ **`nextTick`, because the composer is a child and its `<textarea>` is not in the document
 * until Vue has flushed** — `CommandPalette.vue` wraps its own focus call the same way and for the
 * same reason. ⚑ The handle is `PromptComposer`'s own `focus()` expose rather than a
 * `querySelector` on a hook, so a rename of the hook cannot silently stop this working.
 */
const composer = ref<{ focus(): void } | null>(null)
onMounted(() => {
  void nextTick(() => composer.value?.focus())
})

/**
 * ⛔ **Everything this door asks the host for, and it is three fields** (417, HO-022 §2).
 *
 * ⚑ **Written as OMISSIONS wherever the screen has no opinion**, which is the rule `292 §3` set
 * for `reasoningEffort` and this dispatch applies to the rest of them: an absent field is what the
 * whole stack reads as *"leave the default alone"*, and a value sent from a control nobody was
 * shown is the defect that rule exists for.
 *
 * - **`cwd` is omitted**, so the host resolves it — `brobot-workspace` (`scratch-cwd.ts`). ⚑ HO-022:
 *   *"BroBot has his workspace."*
 * - 🔴 **`approvalMode` is sent, explicitly, and it is the mode the PERSON set** (500,
 *   HO-036 §3.1). The host would resolve an absent field to `'ask'`, and saying it is still worth
 *   more than omitting it — a test can hold what this surface SENT without having to know a host
 *   rule it cannot see — but what it says has changed.
 *
 *   ⛔ **The clause that used to be here was *the assertion that no front-door conversation can
 *   begin unattended*, and HO-036 §3.1 withdrew it.** `417 §1.6` measured that safety property
 *   getting stronger when the checkbox left, and it was right about the checkbox; what the PO has
 *   since ruled is that a person may make this choice ONCE and have it hold. ⚑ So the property that
 *   survives is the weaker, still-true one: **the front door asks nothing, and begins in the mode
 *   the person already chose — disclosed before they type.** ⚠️ **It is still not a per-launch
 *   control**: pressing it changes every conversation started after it, which is what
 *   {@link LAUNCH_APPROVAL_BOUND} says out loud.
 *
 *   ⛔ **`?? 'ask'` and never `?? 'auto'`.** `null` is *the row has not been read*, and the value a
 *   launch must send in that window is the one that keeps somebody being asked.
 * - 🔴 **`model` and `reasoningEffort` are sent ONLY when a person asked for one** (435) — see
 *   below. **`planMode` and `ultracode` stay absent**: HO-025 §4 names three settings and neither of
 *   those is one, `ultracode` still has no mid-session door at all (`417 §10.2`), and plan mode has
 *   a live control on the agent card that says what it does.
 *
 * ## 🔴 **Three fields when nobody chooses, and that is the assertion** (435, HO-025 §5)
 *
 * ⛔ **An untouched front door puts exactly what `417` put on the wire.** *Asks nothing* survives as
 * a property of the PAYLOAD: `model` and `reasoningEffort` are written as OMISSIONS, which is
 * `292 §3`'s rule and what the whole stack reads as *leave the default alone*. ⚠️ **A value sent
 * from a control nobody touched is the defect that rule exists for** — and the empty string is a
 * legal `ReasoningEffort` (the type is `string`), so *we did not ask* could not be expressed by
 * sending one.
 *
 * 🔴 **UI-012 · R-1 — and an untouched form names the LAST pick where the host would start on
 * another** (`09` §8) — see `theFormSends`. ⚑ With no last pick, or one the host starts on anyway,
 * the three fields stand.
 */
const sends = computed(() =>
  modelMatchesProvider.value
    ? theFormSends(props.choices, heldList.value)
    : defaultModel(heldList.value),
)

const firstApproval = ref<'ask' | 'auto' | null>(null)
const needsApproval = computed(
  () => props.approvalDefaultChosen === false || props.defaultApprovalMode === null,
)
const launchMode = computed(
  () => firstApproval.value ?? (needsApproval.value ? null : props.defaultApprovalMode),
)
const approvalBlocked = computed(() =>
  props.providerReadiness?.[props.defaultProvider] === false
    ? `${PROVIDER_NAME[props.defaultProvider]} isn't set up. Set it up in Settings → Providers.`
    : props.providerReadiness !== null && props.providerReadiness[props.defaultProvider] !== true
      ? `${PROVIDER_NAME[props.defaultProvider]} · Checking…`
      : props.defaultApprovalMode === null || launchMode.value === null
        ? 'Choose Ask or Auto before sending.'
        : null,
)

const recentHeadingId = useId()

const settings = computed<CreateSessionInput>(() => ({
  provider: props.defaultProvider,
  profileId: DEFAULT_PROFILE_ID,
  approvalMode: launchMode.value ?? 'ask',
  ...(sends.value === null ? {} : { model: sends.value.model }),
  ...(sends.value?.effort == null ? {} : { reasoningEffort: sends.value.effort }),
}))

/**
 * ⛔ **The words the launch was tried with**, kept only long enough to hand them back (015/019).
 */
let lastTried = ''
/** ⛔ **And the paths that were attached to them** (217, 292 §2) — see the watcher below. */
let lastTriedPaths: HandedPath[] = []

function startWith(
  text: string,
  _intent: SendIntent = 'now',
  attachments: HandedPath[] = [],
): void {
  if (approvalBlocked.value !== null || props.busy) return
  lastTried = text
  lastTriedPaths = attachments
  // 098: mark this failure as OURS to interpret — see `launchedFromHere` above for why it is kept
  // now that `busy` and `error` both belong to this surface alone.
  launchedFromHere.value = true
  // ⚠️ **The intent is DISCARDED here on purpose, and it is the one argument that should be.**
  // `sendIntentFor` can only answer anything but `'now'` while the composer is `busy`, and this
  // surface only ever hands it `starting` or `idle` — there is no turn to interrupt or queue behind
  // on a session that has not started one. Named rather than ignored, because `@send="startWith"`
  // silently dropping arguments two and three is exactly how the attachments were lost.
  //
  // ⛔ **The profile floor that used to stand here is gone with the name box** (417). It read
  // *"the one thing worse than refusing a launch is running it as BroBot under words written for
  // somebody else"* — and every launch from this surface is now BroBot's, by construction.
  emit('start', settings.value, text, attachments)
}

// The composer clears the moment it sends, but a launch can FAIL — a cwd typo, a missing binary
// — and with a multi-line field that clear costs paragraphs, the exact loss 015 exists to
// prevent. So when the launch attempt ends (busy falls) with an error up, the message comes back
// to be fixed and re-sent, not retyped.
//
// It comes back to THIS surface's own draft slot (019), which is where it was typed — the point
// of keying drafts is that a restore can never put text into a conversation that did not write it.
watch(
  () => props.busy,
  (busy, wasBusy) => {
    const settled = wasBusy && !busy
    if (
      shouldRestoreDraft({ busy, wasBusy, error: props.error, lastTried, current: props.draft })
    ) {
      emit('update:draft', lastTried)
    }
    // ⛔ **The paths are handed back on their OWN condition** (found in review). Nested inside
    // `shouldRestoreDraft` they inherited its `lastTried !== ''` clause — so the one send shape
    // where the paths ARE the whole message, which `216` deliberately allows and this dispatch
    // tests, was the one shape whose attachment was silently dropped. ⚑ The text clause exists to
    // avoid overwriting newer typing; the attachment book guards itself the same way, so it does
    // not need the same gate.
    if (settled && props.error !== null && lastTriedPaths.length > 0) {
      props.handing.stage(lastTriedPaths)
    }
    // Consumed either way once the attempt has settled: a message is handed back at most once,
    // and never by a LATER attempt that happens to fail.
    if (settled) {
      lastTried = ''
      lastTriedPaths = []
    }
  },
)
</script>

<template>
  <section class="conversation-pane" data-cy="new-conversation-surface" data-chat-theme="light">
    <SessionHeader
      :session="null"
      :status="null"
      :debug="props.debug"
      :default-provider="props.defaultProvider"
      :facets="LAUNCHER_FACETS"
      :starting="props.busy"
      @toggle-debug="emit('toggleDebug')"
    />

    <div class="empty-stage">
      <div class="front-door">
        <div class="launcher" data-cy="launcher-column">
          <div class="es-head">
            <div class="empty-mark">
              <svg class="icon"><use href="#i-bot" /></svg>
            </div>
            <h2 class="bb-title">What should we work through?</h2>
          </div>

          <div
            v-if="programNotice"
            class="program-notice"
            data-cy="launch-program"
            :data-standing="programNotice.standing"
            :role="programNotice.standing === 'missing' ? 'alert' : 'status'"
          >
            <p class="p-body">{{ programNotice.said }}</p>
            <a
              v-if="programNotice.help"
              class="p-help"
              :href="programNotice.help.url"
              target="_blank"
              rel="noopener"
            >
              {{ programNotice.help.label }}
            </a>
          </div>

          <div v-if="blockingShowing" class="blockers" data-cy="launch-blocked">
            <div v-if="props.error" class="blocker" role="alert">
              <p class="b-head">
                <svg class="icon"><use href="#i-alert" /></svg>The launch didn’t start
              </p>
              <p class="b-body" data-cy="command-error">{{ props.error }}</p>
            </div>
            <SignInPanel
              :state="authState"
              :sign-in="signInCapability"
              :reprovision="reprovisionCapability"
              :busy="authBusy"
              :notice="authNotice"
              offer-providers
              @open-providers="emit('open-providers')"
              @check="checkAuth()"
              @reprovision="reprovisionAuth"
              @sign-in="signIn"
              @cancel-sign-in="cancelSignIn"
            />
          </div>

          <PromptComposer
            ref="composer"
            :state="props.busy ? 'starting' : 'idle'"
            who="BroBot"
            placeholder="Tell BroBot what this conversation is about…"
            :draft="props.draft"
            :handing="props.handing"
            :can-attach="true"
            :blocked="approvalBlocked"
            @send="startWith"
            @interrupt="emit('cancel')"
            @update:draft="(text) => emit('update:draft', text)"
          />
          <div class="said">
            <div class="choices" data-cy="launcher-choices">
              <div class="choice">
                <span class="lbl">model</span>
                <ModelPicker
                  :providers="providers"
                  :readiness="props.providerReadiness"
                  :set-up="(provider) => emit('open-providers', provider)"
                  :shown="shownPick"
                  :empty="shownEmpty"
                  take-words="Start on this"
                  :take="startOn"
                  :reaches="() => startsOnSays"
                  :capabilities="props.capabilities"
                  :lists="lists"
                />
              </div>
            </div>

            <div class="setting" data-cy="first-approval-choice">
              <p class="governs">
                {{ needsApproval ? 'CHOOSE HOW THIS AGENT WORKS' : 'HOW THIS AGENT WORKS' }}
              </p>
              <div class="first-approval-buttons">
                <button
                  v-for="mode in ['ask', 'auto'] as const"
                  :key="mode"
                  type="button"
                  class="bb-button"
                  :class="{ 'bb-button--primary': launchMode === mode }"
                  :data-cy="`choose-${mode}`"
                  :aria-pressed="launchMode === mode"
                  :disabled="props.busy"
                  @click="firstApproval = mode"
                >
                  {{ mode === 'ask' ? 'Ask' : 'Auto' }}
                </button>
              </div>
              <p v-if="launchMode" class="note" data-cy="first-approval-description">
                {{
                  launchMode === 'ask'
                    ? 'Asks when an action needs permission.'
                    : 'Runs without asking. Use it only where you trust the agent with your files.'
                }}
              </p>
            </div>
          </div>
        </div>
        <section
          class="recent-conversations"
          :aria-labelledby="recentHeadingId"
          data-cy="recent-conversations"
        >
          <h2 :id="recentHeadingId" class="bb-heading">Pick up a conversation</h2>

          <p v-if="props.recent == null" class="recent-empty bb-card" data-cy="recent-loading">
            Reading recent conversations…
          </p>
          <p
            v-else-if="recentConversations.length === 0"
            class="recent-empty bb-card"
            data-cy="recent-empty"
          >
            No conversations yet.
          </p>
          <div v-else class="recent-grid">
            <button
              v-for="{ row, matches } in recentConversations"
              :key="row.sessionId"
              class="recent-card bb-card"
              type="button"
              :data-cy="`recent-conversation-${row.sessionId}`"
              :aria-label="`Open ${conversationTitle(row.label, row.named)}. ${row.label}. ${agentStateWords(row.state)}${row.inAnotherWindow ? ' · open in another window' : ''}`"
              @click="emit('open', row.sessionId)"
            >
              <strong>{{ conversationTitle(row.label, row.named) }}</strong>
              <span class="recent-meta"
                ><span>{{ row.label }}</span
                ><time :datetime="new Date(row.updatedAt).toISOString()">{{
                  fullTime(row.updatedAt)
                }}</time></span
              >
              <span class="recent-state"
                >{{ agentStateWords(row.state)
                }}<span v-if="row.inAnotherWindow"> · open in another window</span></span
              >
              <span v-if="matches > 0" class="bb-chip bb-chip--accent">Title match</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.first-approval-buttons {
  display: flex;
  gap: var(--space-4);
}
.conversation-pane {
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

.conversation-pane > * {
  image-rendering: auto;
}

.empty-stage {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: var(--space-12) var(--space-12) var(--space-10);
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.launcher {
  width: 100%;
  min-width: 0;
}

.es-head {
  text-align: center;
}

.empty-mark {
  display: grid;
  width: 46px;
  height: 46px;
  margin: 0 auto var(--space-7);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-card);
  background: var(--brand-mark-bg);
  color: var(--accent-text);
  place-items: center;
}

.empty-mark .icon {
  width: 20px;
  height: 20px;
}

h2 {
  margin: 0;
  color: var(--text);

  letter-spacing: var(--tracking-tight);
}

.es-head > p {
  max-width: 420px;
  margin: var(--space-4) auto 0;
  color: var(--muted);
  font-size: var(--type-body);
  line-height: var(--leading-relaxed);
}

.said {
  margin-top: var(--space-11);
  padding-top: var(--space-9);
  border-top: var(--border-width) solid var(--line);
  text-align: left;
}

.choices {
  display: flex;
  margin-top: var(--space-7);
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-6);
}

.choice {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.note {
  display: flex;
  margin: var(--space-4) 0 0;
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: var(--leading-normal);
  white-space: pre-line;
}

.note::before {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  margin-top: 5px;
  border-radius: var(--radius-pill);
  content: '';
}

.note.advice {
  color: var(--muted);
}

.note.advice::before {
  background: var(--faint);
}

.note.warn {
  color: var(--text-soft);
}

.note.warn::before {
  background: var(--waiting);
}

.why {
  display: flex;
  width: fit-content;
  padding: 0;
  border: 0;
  margin-top: var(--space-4);
  align-items: center;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: var(--leading-normal);
  text-align: left;
}

.why:hover {
  color: var(--text-soft);
}

.why.consequence .chev {
  color: var(--waiting);
}

.chev {
  width: 9px;
  height: 9px;
  flex: none;
  transition: transform var(--dur-fast) var(--ease-out);
}

.chev.down {
  transform: rotate(90deg);
}

.why + .note {
  margin-top: var(--space-3);
}

.setting {
  margin-top: var(--space-8);
}

.governs {
  margin: 0 0 var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  line-height: var(--leading-normal);
  text-transform: uppercase;
}

.glance {
  color: var(--text-soft);
}

.why.consequence .glance {
  color: var(--waiting);
}

.approval {
  display: flex;
  width: 100%;
  align-items: flex-start;
  padding: var(--space-6);
  background: var(--panel);
  color: var(--muted);
  cursor: pointer;
  flex-direction: column;
  font: inherit;
  font-size: var(--type-caption);
  gap: var(--space-2);
  line-height: var(--leading-normal);
  text-align: left;
}

.approval:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--wash-5);
  color: var(--text-soft);
}

.approval strong {
  color: var(--text);
  font-weight: var(--fw-semibold);
}

.approval.auto {
  border-color: var(--waiting-pill-border);
  background: var(--waiting-bg);
}

.approval.auto strong {
  color: var(--waiting);
}

.approval.unread {
  border-color: var(--line);
  border-style: dashed;
  background: none;
  color: var(--faint);
  cursor: default;
}

.approval.unread strong {
  color: var(--faint);
  font-weight: inherit;
}

/* ------------------------------------------- the program this conversation would start on */

.program-notice {
  margin-top: var(--space-7);
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  text-align: left;
}

.program-notice .p-body {
  margin: 0;
  color: var(--waiting);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.program-notice .p-help {
  display: inline-block;
  margin-top: var(--space-2);
  color: var(--accent-text);
  font-size: var(--type-caption);
  text-decoration: none;
}

.blockers {
  display: flex;
  margin-top: var(--space-7);
  flex-direction: column;
  gap: var(--space-5);
}

.blocker {
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  text-align: left;
}

.blocker .b-head {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--danger-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
}

.blocker .b-head .icon {
  width: 13px;
  height: 13px;
  color: var(--danger);
}

.blocker .b-body {
  margin: var(--space-2) 0 0;
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.front-door {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 1fr);
  align-items: start;
  width: min(1100px, 100%);
  gap: var(--space-12);
}
.empty-stage {
  container-type: inline-size;
}
.launcher :deep(.composer-wrap) {
  padding: var(--space-8) 0;
  border-top: 0;
  background: transparent;
}
.recent-conversations {
  min-width: 0;
}
.recent-intro,
.recent-empty {
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.recent-intro {
  margin: var(--space-4) 0 var(--space-8);
}
.recent-grid {
  display: grid;
  gap: var(--space-5);
}
.recent-card {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  overflow-wrap: anywhere;
}
.recent-card:hover {
  border-color: var(--accent-border);
  background: var(--accent-fill);
}
.recent-card strong {
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
}
.recent-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
}
.recent-state {
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}
@container (max-width: 760px) {
  .front-door {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
