import type { HandedPath } from '../../../shared/attachment-contracts'
import type {
  CreateSessionInput,
  LaunchRefusal,
  Provider,
  ProviderCapabilityMap,
  ProviderProgram,
} from '../../../shared/runtime-ipc'
import type { ListedConversation } from './conversation-list'
import type { DraftHanding } from './drafts'
import type { LaunchChoices } from './launch-choices'
import type { ModelLists } from './model-lists'

/** What `NewConversation` is given (moved out of `NewConversation.vue` unchanged). */
export interface NewConversationProps {
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

  /** What is typed on THIS surface and not yet sent (019) — its own slot, no session id yet. */
  draft: string
  submit?: (input: CreateSessionInput, text: string, attachments: HandedPath[]) => Promise<void>
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
  /** Readiness and provider are supplied by core for this launch, never chosen by this view. */
  providerReadiness?: Readonly<Partial<Record<Provider, boolean | null>>> | null
  defaultProvider: Provider
  /** Null means the person's approval default has not been read; it must not display as Ask. */
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
}

/** What `NewConversation` raises (moved out of `NewConversation.vue` unchanged). */
export interface NewConversationEmits {
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
}
