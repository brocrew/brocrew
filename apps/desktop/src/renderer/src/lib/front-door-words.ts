import { PROVIDER_NAME, providerName, type Provider } from '../../../shared/runtime-ipc'
import type { ItsProvider, StartedOn } from '../../../shared/agent-roster'
import { DRAWER_TABS, TAB_OF_THE_SETTINGS } from './drawer'

type ProviderNames = Readonly<Partial<Record<Provider, string>>>

export function providerNamesIn(lookup: (provider: Provider) => string | undefined): ProviderNames {
  return Object.fromEntries(
    (Object.keys(PROVIDER_NAME) as Provider[]).flatMap((provider) => {
      const name = lookup(provider)
      return name === undefined ? [] : [[provider, name]]
    }),
  )
}

const nameOf = (provider: Provider, names: ProviderNames | undefined): string =>
  names === undefined ? providerName(provider) : (names[provider] ?? 'the provider')

/**
 * # ⛔ The one decision the front door still makes for you (417 §3, HO-022 §2)
 *
 * ## Why there is a sentence here at all
 *
 * HO-022 §2 removed every control from the new-conversation screen on the grounds that
 * *"provider, model and approvals are defaults, **changeable afterwards** where every other
 * setting lives."* ⚑ **Two of those three are.** The agent card's model picker sends
 * `setSessionSetting{kind:'model'}` (UI-012) and its approval mode (`CardApproval.vue`) sends
 * `setApprovalMode`; both write the row and both survive a resume.
 *
 * 🔴 **The provider is not, and it is not close.** `417 §3` looked for a door and found none:
 * `provider` is the one required field of `CreateSessionInput`; **no arm of the wire union carries
 * both a provider and a `sessionId`** (seven arms carry a provider, and every one of them is about
 * a provider rather than about a conversation — `checkProviderAuth`, `listLibrary`, …); none of
 * the twelve `UPDATE provider_session` statements sets it; and on the live session both `provider`
 * and the `handle` it built are `readonly`. ⛔ **Changing it would not be a setter**:
 * `createRuntime` returns a different CLASS per provider, the provider home is
 * `…/<profile>/<provider>`, and `external_ref` holds the old provider's thread id, which is what a
 * resume reattaches by. It is an end-and-relaunch.
 *
 * ## ⛔ So the answer is not a picker put back
 *
 * The dispatch's own rule: *"If a default cannot be changed later, the front door is making a
 * decision silently and permanently on a person's behalf… the honest answer is not to re-add a
 * picker — it is to say so where the default is applied, in one sentence a person can act on."*
 * ⚠️ **`Nothing unwired implies a working state`**, and a default that looks provisional and is
 * permanent is exactly that shape.
 *
 * ## ⚠️ What makes this a sentence and not a comment
 *
 * Standing rule 5. Every clause below is pinned by `a-front-door-that-asks-nothing.dom.test.ts`
 * against the thing that makes it true, not against itself:
 *
 * - the provider NAME comes from the caller, through {@link providerName} — `151`'s rule, that a
 *   provider named in running prose is spelled the way a person reads it and never as the wire id;
 *   and the two providers must produce different text;
 * - *"cannot be changed"* is pinned by a source census over the main process — no
 *   `UPDATE provider_session SET provider`, no `setProvider`, `provider` in one command arm;
 * - *"model and approvals can"* is pinned by the two live controls existing **as controls a person
 *   can press** — the agent card's model and its approval mode's confirm, both offered only where
 *   the conversation's settings are not fixed, which is the one state where this clause is false.
 *
 * ⚠️ **It is a sentence about a conversation that has not started**, so *"later"* means while it is
 * running. An ended conversation can change neither, and neither can the person reading this.
 *
 * ⛔ **The day any of those stops holding, the test goes red and this sentence comes out** — which
 * is the whole difference between a rendered fact and a description of the system (standing rule
 * 8, applied to a person's screen rather than to a model's).
 */

/**
 * Where the two settings that ARE changeable live — **read off the tab strip, never typed here**.
 *
 * ⛔ **A sentence that names a surface owns a claim about that surface's name.** `DRAWER_TABS`
 * already holds the word a person reads on the tab whose agent card holds the model and the
 * approval mode; typing it here would be a second copy of a label, so renaming the tab renames
 * the sentence.
 */
const SETTINGS_TAB = DRAWER_TABS.find((tab) => tab.id === TAB_OF_THE_SETTINGS)
export const CHANGEABLE_LIVE_IN = SETTINGS_TAB ? `the ${SETTINGS_TAB.label} tab` : 'the drawer'

/**
 * What a new conversation will run on, and that it will not run on anything else.
 *
 * ⚠️ **One sentence and one clause per fact.** `031`'s rule is about how much a person reads, and
 * since `579` this is the ONLY always-on line the screen has: the credential note that used to sit
 * under it is behind a press now, and so is {@link LAUNCH_APPROVAL_BOUND} —
 * see {@link FOLDED_ON_THE_FRONT_DOOR} for which prose folded and which had to stay.
 */
export function providerIsFixed(provider: Provider, names?: ProviderNames): string {
  return (
    `This conversation will run on ${nameOf(provider, names)}. Its model and approvals you can ` +
    `change later, in ${CHANGEABLE_LIVE_IN} — the provider you cannot: it is fixed when the ` +
    `conversation starts.`
  )
}

/**
 * 🔴 **The same fact, said at the IDENTITY instead of at the front door** (433, HO-025 through
 * `433` relay 1).
 *
 * ⛔ **It exists because a control exists.** HO-025: *"changing it means a new conversation, and the
 * app should SAY that rather than offer a control that silently relaunches."* ⚑ `417` shipped the
 * front door's half of this and `427` measured it true; a person who can now CHANGE the default has
 * to be told what changing it does, at the moment they can do it.
 *
 * ⚠️ **Beside {@link providerIsFixed} rather than in the sheet**, on that sentence's own rule: two
 * sentences about one fact, one module, so a ruling that moves moves both. ⛔ **It says nothing
 * about which program suits which work** — HO-025 §4 is explicit that that is chosen per piece of
 * work, and a sentence that recommended anything would be this app holding an opinion it was told
 * not to hold.
 *
 * ⚑ **The provider NAME comes through {@link providerName}** — 151's rule, that a provider in
 * running prose is spelled the way a person reads it and never as the wire id.
 *
 * 🔴 **`696` · *you start*, where it said *started*** (`691` §8.3, found by its seam reviewer). ⛔ The
 * resolved provider is `providerForALaunch`'s — a launch a PERSON starts. **An agent-started launch
 * resolves differently**: a person's model choice in force holds its provider (`R31a`), and with no
 * choice it is the agent's own, then its giver's (`admitGive`'s order). ⚠️ So for an agent with no provider of its own holding a Claude choice, *"the next
 * conversation started as this identity will run on Codex"* (the screen's fallback) sat above
 * *"another agent that starts this one … runs it on Claude"* — and the second was true.
 * ⚑ Scoped to what it derives from; the model control below says the agent-started half, rendered
 * from the choice. A new-conversation door may override this default locally; this sheet reports
 * the identity's default rather than a choice made in that door.
 *
 * @param provider what a launch as this identity WOULD run on today, resolved by
 *   `providerForALaunch` — never the raw column, because *nobody has said* is not a thing to print.
 * @param aDoorAsks whether the start door offers a provider choice. Without this flag, the helper
 *   does not promise one.
 * @param isService whether gives keep the service's single conversation.
 */
export function providerTakesEffectNextTime(
  provider: Provider,
  aDoorAsks = false,
  isService = false,
  names?: ProviderNames,
): string {
  if (isService) {
    return (
      `A service keeps one conversation for new gives. It starts when the first give is accepted. ` +
      `Changing its default does not switch that conversation’s provider. ` +
      `Existing pieces and follow-ups stay with their holders.`
    )
  }
  return (
    `The default for a new conversation you start as this identity is ${nameOf(provider, names)}` +
    (aDoorAsks ? ', unless you choose another provider where you start it. ' : '. ') +
    `Changing this starts nothing and moves nothing: a conversation keeps the provider it began ` +
    `on. Once you choose a default here, new gives without a provider or model use that provider’s conversation, starting one if needed. ` +
    `Existing pieces and follow-ups stay with their holders.`
  )
}

/**
 * 🔴 **What a person is told about the mode every conversation they start begins in** (500,
 * HO-036 §3.1) — the state, what the press would do, and the bound that makes it a SETTING.
 *
 * ## ⛔ Why this is a derivation and not three strings in a template
 *
 * ⚑ **`434`'s register, and `487`'s device.** ⚠️ **`500`'s brief attributed the register to `487`
 * and the code says otherwise** — `whatThisAnswerDoes` is `434`, HO-024 criterion 20's third
 * clause, resting on `430`'s ruling: *"the Observer can explain deterministic immediate
 * routing/permission effects; it cannot promise what a model will subsequently do."* ⛔ What `487`
 * settled is the DEVICE — a `Record` over a closed set, so a new member cannot compile until
 * somebody writes its sentence — and the rule that every sentence ends with what a person can still
 * do. ⚑ Both are here: {@link SAYS} and {@link PRESSING_IT} are keyed by the mode, and
 * {@link LAUNCH_APPROVAL_BOUND} is the once-per-control clause `PERMISSION_EFFECTS` puts beside the
 * row rather than on each option.
 *
 * ## ⚠️ `null` is *nobody has answered yet*, and it is not `ask`
 *
 * ⛔ **`086`'s rule, on the one control where the wrong default is dangerous in both directions** —
 * `spawn-safety.ts` says it about the kill switch and it is the same shape here. A control drawn
 * *asking* before the read lands claims a person is being consulted when nobody knows; drawn
 * *yolo* it claims a consent nobody has given.
 *
 * ⚑ **The LAUNCH still resolves `'ask'` in that window, and the two are not in tension.** The value
 * a launch sends has to be one of two words and the safe one is `ask`; what a person READS has a
 * third state and says so. ⚠️ The window is real and is the same one `RuntimeScreen`'s
 * `frontDoorProvider` docblock rules open on purpose: *"closing it means making the launcher wait
 * on `agentStore.loaded`, which would make a rail read a precondition for starting a
 * conversation."*
 *
 * ## ⛔ What it does NOT say
 *
 * - **It does not say what `auto` REMOVES.** That is `367`'s disclosure — `YOLO_MEANS` plus the
 *   adapter's own per-provider note — rendered from the same bytes at every surface that offers the
 *   mode, and a paraphrase here would be the second copy `171 §3` lifted the constant to prevent.
 * - 🔴 **It does not mention spawned conversations, and that is a ruled hole rather than an
 *   oversight.** A child's mode is its parent's question and `HO-036` §2 is `499`'s; a sentence
 *   about descendants written here would be this surface claiming a rule it does not own.
 *
 *   ⛔ **`500` relay 1 says what goes in the hole and who owns the words.** The PM measured that
 *   `auto` is not one word — on Claude it stops the cards, on Codex it is *"no approvals AND no
 *   sandbox"* (`danger-full-access`) — so a person setting `auto` while a Claude parent is in front
 *   of them can get a Codex child at `danger-full-access`. The PO ruled **tell, do not clamp**, and
 *   ruled that *"since a default now exists, that place includes the default setting."*
 *
 *   Use a shared per-provider source for any descendant-mode disclosure beside {@link LAUNCH_APPROVAL_BOUND}, rather than paraphrasing the provider's reach here. Only a measured difference between modes warrants that additional claim.
 *   - Describe the selected mode without arguing with the person's choice.
 */
export type LaunchApproval = 'ask' | 'auto'

/**
 * 🔴 **What this control GOVERNS, on the control** (579, `EXT-010` §2.2).
 *
 * ## ⛔ Why the subject left the state sentence
 *
 * ⚠️ **The PO read the control as information**: *"`New conversations ask you first` is styled like
 * the disclosure bullets around it… It is the most consequential control on the screen and the one
 * that looks least pressable."* ⛔ **A sentence is not a switch.** `578` settled the grammar one
 * screen over — *state is TEXT and controls are BOXES* — and a box whose face is a full sentence in
 * the same ink as the paragraphs beside it is the half of that rule this screen was failing.
 *
 * 🔴 **And the scope had to survive the fold.** `EXT-010` §2.1 puts {@link LAUNCH_APPROVAL_BOUND}
 * behind a press, and that paragraph was carrying *"a setting, not a choice about one
 * conversation"* — ⛔ **so making the control louder while hiding its scope would have been the
 * worse defect**, in as many words: *"a control that looks like a per-conversation toggle but
 * changes every future conversation."* ⚑ **The scope is therefore a LABEL now, not a paragraph** —
 * always on screen, never behind a press, and read in the same glance as the state.
 *
 * ⚠️ **It travels INSIDE {@link LaunchApprovalView}** rather than standing as a constant a surface
 * may forget: a screen that renders {@link LaunchApprovalView.heading} without this word would say
 * *Asks you first* about nothing, which is the subject-less sentence this split could have created.
 */
export const LAUNCH_APPROVAL_GOVERNS = 'Every new conversation'

/**
 * ⛔ **What those conversations DO, per mode** — the state, in the present tense, about launches
 * rather than about this app's feelings.
 *
 * ⚑ **A `Record` over the closed pair**, so a third mode cannot reach a screen without a sentence.
 * HO-013 §2 has ruled there is no third mode; this is what makes that a compile error rather than a
 * memory.
 *
 * ⚠️ **The subject is {@link LAUNCH_APPROVAL_GOVERNS} and is no longer repeated here** (579). It
 * read `New conversations ask you first` / `New conversations do not ask` from `500` until
 * `EXT-010` §2.2; ⛔ **the words a person reads are the same two facts in the same order**, with the
 * subject said once, by the label, instead of once per state.
 */
const SAYS: Readonly<Record<LaunchApproval, string>> = {
  // ⚑ 736 · R96 — what the provider's own CLI asks by default, not *"first"* about everything: on
  // Codex an edit in the folder is not asked about on that preset (measured).
  ask: 'Asks what its provider’s own CLI asks',
  auto: 'Does not ask, except what a plan mode asks',
}

/**
 * ⛔ **What the PRESS does** — `482`'s shape: the immediate, deterministic effect, in the words of
 * the thing that happens, and never a promise about what an agent then chooses to do.
 *
 * ⚠️ **Keyed by the mode it would MOVE TO**, not by the mode it is in, so the sentence and the
 * value the press sends are read from one key.
 */
const PRESSING_IT: Readonly<Record<LaunchApproval, string>> = {
  // ⚑ 736 · R96 — the provider's own default, not *"anything consequential"* (a Codex edit in the
  // folder is not asked about on its default preset, measured).
  ask: 'Press to be asked again, as the provider’s own CLI asks by default.',
  auto: 'Press to stop being asked — new conversations will run commands and edit files unattended, except what a provider’s own plan mode asks while it plans.',
}

/**
 * ⛔ **The clause that makes this a setting rather than a choice about one conversation** — said
 * ONCE beside the control, which is `482`'s rule about the part that is not per-option.
 *
 * Explain that a default mode applies to every future conversation until changed, rather than being a one-conversation choice. Persisted automatic mode must not silently imply fresh consent each time.
 *
 * ⚠️ **It names where a conversation's OWN mode changes**, because the two are different acts and a
 * person who wants to change only this one should not have to press this.
 */
export const LAUNCH_APPROVAL_BOUND =
  `This is a setting, not a choice about one conversation: it applies to every conversation you ` +
  `start, until you change it back. A conversation already open keeps the mode it began in — that ` +
  `one changes in ${CHANGEABLE_LIVE_IN}.`

/** ⚠️ **What the control says while the app has not read the row yet** — `086`'s third state. */
export const LAUNCH_APPROVAL_UNREAD =
  'Not read yet — until it is, a conversation you start now will ask what its provider’s own CLI asks by default.'

/** ⛔ **Everything a person reads at the control**, so no surface composes a second version. */
export interface LaunchApprovalView {
  /** What the next launch would send, or `null` while nobody has answered. */
  readonly mode: LaunchApproval | null
  /**
   * 🔴 **What the control governs** — {@link LAUNCH_APPROVAL_GOVERNS}, carried here rather than
   * imported at the surface so a screen cannot render {@link heading} without its subject (579).
   */
  readonly governs: string
  /** The strong line: what those conversations do. */
  readonly heading: string
  /** What the next press would do, or `null` — there is nothing to promise about an unread row. */
  readonly press: string | null
  /** Which mode a press asks for, or `null`. */
  readonly next: LaunchApproval | null
}

/**
 * 🔴 **The one derivation of the control's words** — pure, so a test can ask it the same question a
 * screen does without mounting anything.
 *
 * ⚑ **`spawnSafetyView`'s shape, one subject over**, and deliberately so: this app has exactly two
 * app-wide settings now and a person should not have to learn two grammars for them.
 */
export function launchApprovalView(mode: LaunchApproval | null): LaunchApprovalView {
  // ⚑ **The label is on every arm, the unread one included** (579): *what this governs* is true
  // before the row has been read, and a state that dropped it would be the one frame where the
  // scope a person needs is the thing missing.
  if (mode === null) {
    return {
      mode: null,
      governs: LAUNCH_APPROVAL_GOVERNS,
      heading: LAUNCH_APPROVAL_UNREAD,
      press: null,
      next: null,
    }
  }
  const next: LaunchApproval = mode === 'auto' ? 'ask' : 'auto'
  return {
    mode,
    governs: LAUNCH_APPROVAL_GOVERNS,
    heading: SAYS[mode],
    press: PRESSING_IT[next],
    next,
  }
}

/**
 * # ⛔ What a `Record` here does NOT buy, said out loud (579 review)
 *
 * ⚑ **The type gives `toggle()` and `open` their closed key set** — a third fold cannot be
 * TOGGLED without a name. ⛔ **It does not tie a key to a control**, which is the half the
 * sentence above promises, and a claim with no instrument is a comment (standing rule 5).
 *
 * ⚠️ **`FOLDED_EXPLANATIONS` stood here and nothing imported it.** A derived roster that no
 * reader consumes is `a-line-no-mutation-can-kill-is-not-carrying-its-rule`: replace its body
 * with `[]` and the whole gate stays green. ⚑ **The reader it was missing is a census**, and it
 * lives where the other disclosure rules live —
 * `scripts/test/info-disclosure-reach.test.mjs` · *every key in the front door's fold table has an
 * opener that renders its word* — which walks this table's keys and requires
 * `data-cy="launcher-why-<key>"` plus `FOLDED_ON_THE_FRONT_DOOR.<key>` in the template for each.
 */

/**
 * What the provider control's empty choice means for one agent: nothing saved for it, and what its
 * conversations say instead ({@link ItsProvider}).
 */
export function noProviderSavedSays(runsOn: ItsProvider | null, names?: ProviderNames): string {
  if (runsOn?.from === 'its-conversations') {
    return `Not saved: its conversations ran on ${nameOf(runsOn.provider, names)}`
  }
  if (runsOn?.from === 'its-conversations-differ')
    return 'Not chosen: its conversations ran on both'
  return 'Not chosen yet'
}

export function agentProviderSays(runsOn: ItsProvider, names: ProviderNames): string {
  return runsOn.provider === null
    ? noProviderSavedSays(runsOn, names)
    : nameOf(runsOn.provider, names)
}

/** How many of an agent's conversations started on each provider: "Claude (2) and Codex (1)". */
function startedOnSaid(startedOn: StartedOn, names?: ProviderNames): string {
  return (Object.keys(startedOn) as Provider[])
    .filter((provider) => startedOn[provider] > 0)
    .map((provider) => `${nameOf(provider, names)} (${String(startedOn[provider])})`)
    .join(' and ')
}

/**
 * An agent whose conversations ran on both providers, with none saved: no agent can start a new
 * conversation with it until a person chooses, and this is where a person reads that. `name` is
 * the agent's, or null where the sentence stands on its own sheet.
 */
export function aProviderNotChosenSays(
  name: string | null,
  startedOn: StartedOn,
  names?: ProviderNames,
): string {
  const who = name ?? 'this agent'
  return (
    `Choose a provider for ${who}: its conversations ran on ${startedOnSaid(startedOn, names)}, so no ` +
    `agent can start a new conversation with it until a person chooses one on its sheet.`
  )
}
