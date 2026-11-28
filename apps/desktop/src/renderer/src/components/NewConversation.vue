<script lang="ts">
import type { LaunchRefusal } from '../../../shared/runtime-ipc'

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
 * ⚑ Exported and pure for `shouldRestoreDraft`'s reason (`lib/drafts.ts`): a watcher is not
 * reachable from a node test, and a seventh word added to main's table must be answered here, not
 * guessed.
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
import type { HandedPath } from '../../../shared/attachment-contracts'
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import type {
  CapabilityStatus,
  CreateSessionInput,
  Provider,
  ProviderProgram,
} from '../../../shared/runtime-ipc'
import { A_STANDING_WARNS, DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { sessionFacets } from '../lib/agent-state'
import type { ConversationRowView } from '../lib/conversation-row'
import type { LaunchChoices } from '../lib/launch-choices'
// 🔴 **UI-012 · the one model picker, and the lists it reads** — see `lib/model-lists.ts`.
import { theFormSends, type PickedModel } from '../lib/model-lists'
import { useModelLists } from '../composables/useModelLists'
import { CHANGEABLE_LIVE_IN } from '../lib/front-door-words'
import { joiningTheBox, shouldRestoreDraft } from '../lib/drafts'
import type { SendBlock } from '../lib/composer-notice'
import { createSignInGesture } from '../lib/sign-in-gesture'
import { signInFact } from '../composables/useProfileSignIn'
import { useClientApi, useClientProviders } from '../client-provider/injection'
import { useProviderNames } from '../composables/useProviderNames'
import type { SendIntent } from '../lib/session-store'
import PromptComposer from './PromptComposer.vue'
import SessionHeader from './SessionHeader.vue'
import SignInPanel from './SignInPanel.vue'
import LaunchRefusalBox from './LaunchRefusalBox.vue'
import ModelPicker from './ModelPicker.vue'
import ConversationRow from './ConversationRow.vue'
import { conversationTitle, type ListedConversation } from '../lib/conversation-list'
import type { NewConversationEmits, NewConversationProps } from '../lib/new-conversation-props'
import { agentStateWords } from '../../../shared/agent-state'

/** The unknown conversation uses the same header facts as a live one. */
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
 * 5. **Choose the folder.** A front-door conversation runs in its profile's own home
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
const props = withDefaults(defineProps<NewConversationProps>(), {
  approvalDefaultChosen: undefined,
  providerReadiness: null,
})

const emit = defineEmits<NewConversationEmits>()

const profileId = computed(() => props.team?.profileId ?? DEFAULT_PROFILE_ID)
const who = computed(() => props.team?.name ?? 'BroBot')
const desktop = useClientApi().desktop
const folder = ref<string | null>(null)
const folderRefusal = ref<string | null>(null)

async function chooseFolder(): Promise<void> {
  const chosen = await desktop?.chooseCwd()
  if (chosen == null) return
  folderRefusal.value = chosen.refusal ?? null
  if (chosen.refusal === undefined) folder.value = chosen.path
}

function useAgentHome(): void {
  folder.value = null
  folderRefusal.value = null
}

const foldTitle = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const recentConversations = computed(() => {
  const words = [...new Set(foldTitle(props.draft).match(/[\p{L}\p{N}]+/gu) ?? [])]
  return (props.recent ?? [])
    .filter((row) => row.identity === profileId.value)
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

function recentRow(row: ListedConversation): ConversationRowView {
  return {
    id: row.sessionId,
    facets: null,
    plateLabel: row.label,
    head: 'plain',
    title: conversationTitle(row.label, row.named),
    status: {
      profile: row.label,
      provider: providers.value.find((provider) => provider === row.provider) ?? null,
      word: agentStateWords(row.state),
      activityAt: row.updatedAt,
      elsewhere: row.inAnotherWindow ? 'Open in another window' : null,
    },
  }
}

const stillAsking = (asked: { readonly provider: Provider; readonly profileId: string }): boolean =>
  asked.provider === props.defaultProvider && asked.profileId === profileId.value

/**
 * This surface's own sign-in gestures. Their busy phase and notice are the launcher's alone, never
 * the title bar's or an agent card's; what a check or a sign-in learns goes into the profile's shared
 * sign-in fact too, so those surfaces agree with it.
 *
 * ⚠️ **A minutes-long sign-in is stamped with the pair it started for** (`running`): the provider
 * can move under it (`NewAgent` is an overlay, so `default` can be created on another provider while
 * this stays mounted), so an answer is drawn only while {@link stillAsking}, and Cancel names the
 * pair that is running rather than the one on screen. ⚑ The stamp is a plain object, never a
 * reactive one: a proxy cannot cross the bridge, and a cancel that sent one did nothing.
 */
const signInClient = useClientProviders()
const providerName = useProviderNames(signInClient)
const signInHere = createSignInGesture({
  pair: () => ({ provider: props.defaultProvider, profileId: profileId.value }),
  bridge: () => signInClient,
  fact: (pair) => signInFact(pair, signInClient),
  words: {
    signedIn: (pair) => `Signed in to ${providerName(pair.provider) ?? 'this provider'}.`,
    unchanged: 'Both sign-ins expired. Sign in again.',
  },
  stillAsking,
  checkWhileBusy: 'drop',
  // ⛔ **Announced whether it succeeded or not** (257 §2): from here we cannot tell whether a
  // credential landed — a flow can fail after writing one, and a timeout reports no outcome at all.
  settled: (phase, asked) => {
    if (phase !== 'checking') emit('auth-changed', asked.profileId)
  },
})

/**
 * ⛔ **A settled credential answer is about a PROVIDER, so it goes when the provider does** (423).
 *
 * {@link stillAsking} stops a late answer landing in the wrong slot; this clears the one that
 * already landed. ⚠️ Without it a person who created `default` on Claude would read Codex's
 * sign-in state under a sentence naming Claude — 086 in the direction that reassures.
 */
watch([() => props.defaultProvider, profileId], () => {
  // ⛔ **NOT while a gesture is in flight, and that is not a detail.** `SignInPanel` renders at
  // all only when there is an answer to draw, and the CANCEL for a pending browser flow lives
  // inside it — so clearing here would take the only way to stop a running sign-in off the
  // screen. ⚑ The stale answer is already refused by {@link stillAsking}; what is left for this
  // to do is drop a SETTLED answer, and the gesture drops the other one when it finishes.
  if (signInHere.busy !== 'idle') return
  signInHere.auth = null
  signInHere.notice = null
})

/** Whether the foot's blocking group has anything in it — see {@link blockingGroupShows}. */
const blockingShowing = computed(() =>
  blockingGroupShows({ error: props.error, authState: signInHere.auth }),
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
 * `shouldRestoreDraft` (`lib/drafts.ts`) exists for the same reason. A failed reopen of a
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
    if (signInHere.busy !== 'idle') return
    if (signInHere.auth?.state === 'unknown') {
      signInHere.auth = null
      return
    }
    if (signInHere.auth !== null && signInHere.auth.state !== 'usable') void checkAuth(true)
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
 * 🔴 **725 · whether the LATEST failure from here said why** (`716` F-1) — set by the watch above on
 * every one. ⚑ An automatic check that answers *could not check* while it is `true` draws nothing
 * and clears what was up (review): under a refusal that already said why, that box is `710` F-7's
 * second one. ⚑ Every other answer is drawn — it is the provider's, about the credential, whichever
 * failure asked it. ⛔ A person's own *Check again* is drawn whatever it answers.
 */
let lastSaidWhy = false

async function checkAuth(automatic = false): Promise<void> {
  await signInHere.check((said) =>
    automatic && lastSaidWhy && said.state === 'unknown' ? null : said,
  )
}

/**
 * Re-copy the machine credential. ⚠️ The outcome is reported honestly INCLUDING `unchanged`: a
 * button that says "copied" over identical bytes teaches the user that it does nothing.
 */
async function reprovisionAuth(): Promise<void> {
  await signInHere.copyMachineSignIn()
  // Re-ask rather than assume the copy fixed it. It may not have: if the machine credential is the
  // same expired one, the copy is a no-op and the honest thing is to keep saying so.
  await checkAuth()
}

/**
 * Sign this profile in. The promise stays pending for as long as the browser flow takes, which is
 * why the busy phase drives a Cancel button beside it rather than a spinner alone.
 */
async function signIn(): Promise<void> {
  await signInHere.signIn()
}

/** A cancel that could not be delivered says so, or the sign-in it did not stop looks cancelled. */
async function cancelSignIn(): Promise<void> {
  await signInHere.cancel()
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
  const starts = props.team
    ? null
    : (lists.value.choices(props.defaultProvider)?.defaultModel ?? null)
  return starts === null ? null : { provider: props.defaultProvider, ...starts }
})

/**
 * ⚑ **The face's words when nothing names a model** — still asking, the read itself failed, or the
 * list answered and names none; the panel says why in the provider's own words (`model-field.ts`).
 */
const shownEmpty = computed(() =>
  props.team
    ? `Default: ${providerName(props.defaultProvider) ?? 'this provider'}`
    : 'Choose a model',
)

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
  if (!props.team) void nextTick(() => composer.value?.focus())
})

/**
 * ⛔ **Everything this door asks the host for, and it is three fields** (417, HO-022 §2).
 *
 * ⚑ **Written as OMISSIONS wherever the screen has no opinion**, which is the rule `292 §3` set
 * for `reasoningEffort` and this dispatch applies to the rest of them: an absent field is what the
 * whole stack reads as *"leave the default alone"*, and a value sent from a control nobody was
 * shown is the defect that rule exists for.
 *
 * - **`cwd` is omitted**, so the host resolves it — the profile's own home (`scratch-cwd.ts`).
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
const sends = computed(() => {
  const supplied = props.team ? null : lists.value.choices(props.defaultProvider)
  return modelMatchesProvider.value
    ? theFormSends(props.choices, supplied)
    : (supplied?.defaultModelToSend ?? null)
})

const firstApproval = ref<'ask' | 'auto' | null>(null)
const needsApproval = computed(
  () =>
    !props.team && (props.approvalDefaultChosen === false || props.defaultApprovalMode === null),
)
const launchMode = computed(
  () => firstApproval.value ?? (needsApproval.value ? null : (props.defaultApprovalMode ?? 'ask')),
)
const canChooseProvider = computed(
  () => props.providerReadiness === null || props.providerReadiness[props.defaultProvider] === true,
)
const providerChecks = computed(() =>
  providers.value.map((provider) => ({
    provider,
    check: lists.value.readiness(provider, props.team?.profileId),
  })),
)
const providerProblems = computed(() =>
  providerChecks.value.flatMap(({ provider, check }) =>
    check.state === 'settled' && check.reason !== null ? [{ provider, reason: check.reason }] : [],
  ),
)
const checkingProviders = computed(
  () =>
    props.providerReadiness !== null &&
    providerChecks.value.some(
      ({ provider, check }) =>
        props.providerReadiness?.[provider] == null && check.state === 'pending',
    ),
)
const providerFailure = computed(() => {
  if (props.providerReadiness === null || props.providerReadiness[props.defaultProvider] === true)
    return null
  const check = lists.value.readiness(props.defaultProvider, props.team?.profileId)
  return check.state === 'settled' ? check.reason : null
})
const headerProvider = computed(() =>
  props.providerReadiness === null
    ? (providerName(props.defaultProvider) ?? 'this provider')
    : canChooseProvider.value
      ? `${providerName(props.defaultProvider) ?? 'this provider'} · Ready`
      : undefined,
)
const approvalBlocked = computed(
  () =>
    providerFailure.value ??
    (props.providerReadiness?.[props.defaultProvider] === false
      ? `${providerName(props.defaultProvider) ?? 'this provider'} isn't set up. Set it up in Settings → Providers.`
      : props.providerReadiness !== null && props.providerReadiness[props.defaultProvider] !== true
        ? `${providerName(props.defaultProvider) ?? 'this provider'} · Checking…`
        : (!props.team && props.defaultApprovalMode === null) || launchMode.value === null
          ? 'Choose Ask or Auto before sending.'
          : null),
)
const launchBlocked = computed<SendBlock[]>(() =>
  approvalBlocked.value === null ? [] : [{ words: approvalBlocked.value }],
)

const recentHeadingId = useId()

const settings = computed<CreateSessionInput & { profileId: string }>(() => ({
  provider: props.defaultProvider,
  profileId: profileId.value,
  approvalMode: launchMode.value ?? 'ask',
  ...(folder.value === null ? {} : { cwd: folder.value }),
  ...(sends.value === null ? {} : { model: sends.value.model }),
  ...(sends.value?.effort == null ? {} : { reasoningEffort: sends.value.effort }),
}))

/**
 * ⛔ **The words the launch was tried with**, kept only long enough to hand them back (015/019).
 */
let lastTried = ''
/** ⛔ **And the paths that were attached to them** (217, 292 §2) — see the watcher below. */
let lastTriedPaths: HandedPath[] = []
let cancelled = false

function cancel(): void {
  cancelled = true
  emit('cancel')
}

async function startWith(
  text: string,
  _intent: SendIntent = 'now',
  attachments: HandedPath[] = [],
): Promise<void> {
  if (approvalBlocked.value !== null || props.busy) return
  if (props.submit) {
    launchedFromHere.value = true
    await props.submit(settings.value, text, attachments)
    return
  }
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
      shouldRestoreDraft({ busy, wasBusy, error: props.error, lastTried }) ||
      (settled && cancelled && lastTried !== '')
    ) {
      emit('update:draft', joiningTheBox(props.draft, lastTried))
    }
    // ⛔ **The paths are handed back on their OWN condition** (found in review). Nested inside
    // `shouldRestoreDraft` they inherited its `lastTried !== ''` clause — so the one send shape
    // where the paths ARE the whole message, which `216` deliberately allows and this dispatch
    // tests, was the one shape whose attachment was silently dropped. ⚑ The attachment book merges
    // what comes back with what is staged, so it needs no text clause.
    if (settled && (props.error !== null || cancelled) && lastTriedPaths.length > 0) {
      props.handing.stage(lastTriedPaths)
    }
    // Consumed either way once the attempt has settled: a message is handed back at most once,
    // and never by a LATER attempt that happens to fail.
    if (settled) {
      lastTried = ''
      lastTriedPaths = []
      cancelled = false
    }
  },
)
</script>

<template>
  <section
    class="conversation-pane bb-conversation-ground"
    data-cy="new-conversation-surface"
    data-chat-theme="light"
  >
    <SessionHeader
      v-if="!props.team"
      :session="null"
      :status="null"
      :default-provider="headerProvider"
      :facets="LAUNCHER_FACETS"
      :starting="props.busy"
    />

    <div class="empty-stage" :class="{ 'team-stage': props.team }">
      <div class="front-door">
        <div class="launcher" data-cy="launcher-column">
          <div v-if="!props.team" class="es-head">
            <div class="empty-mark">
              <svg class="icon"><use href="#i-bot" /></svg>
            </div>
            <h2 class="bb-title">What should we work through?</h2>
          </div>

          <div v-if="props.team" class="launcher-folder">
            <span v-if="folder" :title="folder" data-cy="start-as-agent-folder">{{ folder }}</span>
            <span v-else data-cy="start-as-agent-no-folder">Agent home</span>
            <button
              type="button"
              class="bb-button"
              data-cy="start-as-agent-choose-folder"
              @click="chooseFolder"
            >
              Choose folder…
            </button>
            <button
              v-if="folder"
              type="button"
              class="bb-button"
              data-cy="start-as-agent-use-home"
              @click="useAgentHome"
            >
              Use agent home
            </button>
          </div>
          <p v-if="folderRefusal" class="note" data-cy="start-as-agent-folder-refused">
            {{ folderRefusal }}
          </p>

          <div
            v-if="canChooseProvider && programNotice"
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

          <div
            v-if="canChooseProvider && blockingShowing"
            class="blockers"
            data-cy="launch-blocked"
          >
            <LaunchRefusalBox
              v-if="props.error"
              :data-cy="props.team ? 'start-as-agent-refused' : undefined"
              :error="props.error"
              :text-cy="props.team ? 'start-as-agent-error' : 'command-error'"
            />
            <SignInPanel
              :provider="props.defaultProvider"
              :display-name="providerName(props.defaultProvider)"
              :state="signInHere.auth"
              :sign-in="signInCapability"
              :reprovision="reprovisionCapability"
              :busy="signInHere.busy"
              :notice="signInHere.notice"
              offer-providers
              @open-providers="emit('open-providers')"
              @check="checkAuth()"
              @reprovision="reprovisionAuth"
              @sign-in="signIn"
              @cancel-sign-in="cancelSignIn"
            />
          </div>

          <div v-if="!canChooseProvider" class="provider-setup-needed" role="status">
            <p
              v-for="problem in providerProblems"
              :key="problem.provider"
              class="note"
              data-cy="provider-readiness-failure"
            >
              {{ providerName(problem.provider) ?? 'This provider' }} isn't signed in.
            </p>
            <p v-if="checkingProviders" class="note">Checking providers…</p>
            <template v-else>
              <p v-if="providerProblems.length === 0" class="note">
                Set up a provider to start a conversation.
              </p>
              <button
                type="button"
                class="bb-button bb-button--primary"
                data-cy="new-provider-setup"
                @click="emit('open-providers')"
              >
                Set up a provider
              </button>
            </template>
          </div>
          <template v-else>
            <PromptComposer
              ref="composer"
              :state="props.busy ? 'starting' : 'idle'"
              :who="who"
              :placeholder="`What would you like ${who} to do?`"
              :draft="props.draft"
              :handing="props.handing"
              :can-attach="true"
              :blocked="launchBlocked"
              :submit="props.submit ? startWith : undefined"
              @send="startWith"
              @interrupt="cancel"
              @update:draft="(text) => emit('update:draft', text)"
            />
            <div class="said">
              <div class="choices" data-cy="launcher-choices">
                <div class="choice">
                  <span class="lbl">model</span>
                  <ModelPicker
                    :providers="providers"
                    :profile-id="props.team?.profileId"
                    :readiness="props.providerReadiness"
                    :programs="props.programs"
                    :set-up="(provider) => emit('open-providers', provider)"
                    :shown="shownPick"
                    :fixed="Boolean(props.team && props.busy)"
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
                <div v-if="!props.team" class="first-approval-buttons">
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
          </template>
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
              <ConversationRow :row="recentRow(row)" />
              <span v-if="matches > 0" class="bb-chip bb-chip--accent">Title match</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped src="./NewConversation.css"></style>
