import {
  // ⚑ **D-042 · R1 — a provider's own default, by name**, where no list need be read to know it.
  theDefaultByName,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  agentName,
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
  type AgentProviderSet,
} from '../../shared/runtime-ipc'
import type { ModelCatalogue, ModelList } from '../../shared/model-choice-contracts'
import { foldProfileName } from '../db/identity'
import type { SessionStore } from '../db/session-store'
import { theProviderOfAnAgent, type ItsProvider } from '../../shared/agent-roster'
import {
  STAND_IN_PROFILE,
  aChoiceIsInForce,
  judgeAgainstTheList,
  refuseModelChoice,
  theEffortLadder,
  theEffortWhenNoneIsNamed,
  theEffortsOf,
  theList,
  theListedRow,
  theListsSpelling,
} from '../../shared/model-choice'
import type {
  AgentModelChoice,
  ModelAndEffort,
  ModelChoiceSaved,
  SelectedModel,
} from '../../shared/model-choice-contracts'
import {
  judgeAnAgentsChoice,
  type ListsAsLastRead,
  type ModelRefusal,
  type TheListAsked,
} from './model-rails'
import { SessionUnavailable } from './session-unavailable'

/** One provider's catalogue in one profile's home — the cache key {@link RuntimeHost.providerModels} keeps. */
function modelProbeKey(provider: Provider, profileId: string): string {
  return `${provider}:${profileId}`
}

/**
 * **How many `provider:profileId` catalogues are remembered at once** (257 §2).
 *
 * ⛔ A bound rather than a policy: the entries are settled promises holding a short array, so the
 * memory is nothing — what this refuses is the shape, *"one promise that is never invalidated"*
 * quietly becoming *"N promises that are never invalidated"*. Sixteen is eight profiles across both
 * providers, which is more than a person has open in one app run; past it the oldest is dropped and
 * the next visit pays for one more short-lived child. Nothing here starts a probe on its own.
 */
const MAX_MODEL_PROBES = 16

/** The existing model choices and the one per-host catalogue cache. */
export class ModelCatalogues {
  /**
   * The model probes this app run has made, keyed `provider:profileId` (058, re-keyed by 257 §2) —
   * the PROMISE, so concurrent askers share one child.
   *
   * 🔴 **It used to be a single app-wide promise, probed in `DEFAULT_PROFILE_ID`'s home and shown to
   * every profile** (`256` H2/§2 H1). Account identity is per profile and a model list is *what this
   * login may run*, so a second profile's launcher was presenting the default profile's catalogue.
   * ⚠️ `256` confirmed the code path and did NOT provoke a wrong menu — that needs two accounts with
   * different model access, which it did not have — so this is a correctness fix, not the repair of
   * an observed wrong catalogue.
   *
   * ⚑ **Still no timer and still no background refresh.** An entry is created only when somebody asks
   * about that profile, and an ANSWER is dropped only on the one event that can change it — see
   * {@link forgetModels}. ⚑ **689 · a FAILURE is dropped by the next ask too** — see
   * {@link modelsAskedAgainIfTheyFailed}. What is new is a BOUND: {@link MAX_MODEL_PROBES}, because "one promise that
   * is never invalidated" becoming "N promises that are never invalidated" is a leak with a nicer
   * name. Scrolling a profile picker spawns nothing; only asking does.
   */
  private readonly modelProbes = new Map<string, Promise<ModelCatalogue>>()
  /**
   * ⚑ **689 · the probes in {@link modelProbes} that have SETTLED** — so *a failure already cached*
   * can be told from one another ask is still waiting on (see {@link modelsAskedAgainIfTheyFailed}).
   * ⚠️ Weak, so an evicted or forgotten promise is not kept alive by being remembered here.
   */
  private readonly settledModelProbes = new WeakSet<Promise<ModelCatalogue>>()
  /** What each settled probe answered, for {@link theListsAsLastRead}, which cannot wait for one. */
  private readonly modelsAnswered = new WeakMap<Promise<ModelCatalogue>, ModelCatalogue>()

  constructor(
    private readonly store: Pick<
      SessionStore,
      | 'agentIdentities'
      | 'modelChoiceOf'
      | 'setAgentProvider'
      | 'aPersonPicked'
      | 'capabilitiesOf'
      | 'setModelChoice'
      | 'lastPicked'
      | 'addHandAddedModel'
      | 'deleteHandAddedModel'
      | 'handAddedModels'
      | 'providerOf'
      | 'startedOnOf'
    >,
    private readonly profiles: (provider?: Provider) => string[],
    private readonly askProviderForModels: (
      provider: Provider,
      profileId: string,
    ) => Promise<ModelCatalogue>,
    private readonly isClosing: () => boolean,
    private readonly theProviderOfConversation: (conversation: string) => Provider | null,
    private readonly now: () => number,
    private readonly agentsMoved: () => void,
    private readonly errorMessage: (error: unknown) => string,
  ) {}

  /**
   * 🔴 **Say which provider this identity's NEXT conversation starts on** (433, HO-024 §2.1/§2.2),
   * or hand it back to the app's fallback with `null`.
   *
   * ## ⛔ The name, which two rulings and one census all have a claim on
   *
   * ⚑ **`setAgentProvider` is HO-024 §2.2's own word for this verb**, and `433` relay 1 uses it
   * again, so the code and the rulings name one thing. ⛔ **Not `setProvider`**: `417` shipped the
   * sentence a person reads — *"the provider you cannot change once a conversation has started"* —
   * and `a-front-door-that-asks-nothing.test.ts` §1 greps all of `src/main` for
   * `setProvider|changeProvider|switchProvider|swapProvider` to keep it true. A verb by one of
   * those names would take that census red **for a reason it does not mean** (`423` F5.1 found the
   * trap), and — the sharper half — it would be NAMED for the thing it must not do.
   *
   * ⚠️ **`Agent` here means the IDENTITY, as it does in {@link createAgent} and `agentIdentities`
   * beside it — and NOT what `list_agents` means by the word.** On a toolset an *agent* is a live
   * conversation; on this wire it is the durable thing a conversation runs as. ⛔ The collision is
   * named rather than left for a reader: this verb takes a profile slug, it has no session
   * parameter, and there is no toolset it appears on.
   *
   * ## ⚠️ Nothing running moves, and nothing recorded moves either
   *
   * A conversation takes its provider at launch (`417`) and the column is read there (`427`); no
   * `UPDATE provider_session` anywhere in this app sets it. ⛔ **That is the restored ruling rather
   * than a limitation** — HO-024 §2.1 reverts HO-023 §3 to HO-022 §3 precisely so *the same
   * identity on Codex in one project and Claude in another* is expressible, and a write here that
   * reached a live session would delete that case.
   *
   * 🔴 **And the app SAYS so rather than leaving it to be discovered** (HO-025, through `433` relay
   * 1): *"changing it means a new conversation, and the app should SAY that rather than offer a
   * control that silently relaunches."* ⚑ The sentence is `providerTakesEffectNextTime` in
   * `renderer/src/lib/front-door-words.ts`, it is rendered beside the control, and
   * `a-provider-a-person-can-change.test.ts` §4 is what stops it drifting away from this method.
   *
   * ⚠️ **It was written here as `{@link PROVIDER_TAKES_EFFECT_NEXT_TIME}` until `470`, and no such
   * symbol has ever existed** — it is a function, not a constant, and a dispatch grepping for the
   * name this docblock used would have found nothing and concluded the sentence was unwritten.
   * ⛔ A `@link` across the main/renderer boundary cannot be resolved by the compiler either way,
   * which is why it is now a path a reader can open.
   *
   * ⚑ **Read back rather than echoed**, which is {@link setCapabilities}' shape and 339's rule: the
   * store's own fold decides what the column now says, so a word this app cannot read comes back as
   * *nobody has said* instead of as the thing that was asked for.
   *
   * ⛔ **`null` when there was no row** — the store's refusal to create one, turned into the wire's
   * *there is nothing here to configure*. Criterion 12, through the second configuration door.
   */
  setAgentProvider(profileSlug: string, provider: Provider | null): AgentProviderSet | null {
    // 🔴 **682 · `R31b` — a person's two doors never leave a contradiction.** ⚑ The store clears a
    // model choice for another provider IN THE SAME TRANSACTION as the write (`setAgentProviderTx`);
    // this reads the choice either side of it so the answer can SAY what was taken back. ⚠️ Both
    // reads and the write are synchronous, so nothing can land between them.
    const before = this.store.modelChoiceOf(profileSlug)
    if (!this.store.setAgentProvider(profileSlug, provider)) return null
    const cleared = before !== null && this.store.modelChoiceOf(profileSlug) === null
    // ⚑ **682 · announced on `agents`** (`677`'s inbox 10), as the model door is: a second window
    // would otherwise draw the old provider — and, now, a choice that no longer exists.
    this.agentsMoved()
    const folded = foldProfileName(profileSlug)
    const identity = this.store.agentIdentities().find(({ slug }) => slug === folded)
    if (identity === undefined) return null
    return {
      ...identity,
      modelChoiceCleared: cleared
        ? { provider: before.provider, model: before.model, effort: before.effort }
        : null,
    }
  }

  /**
   * 🔴 **Set this identity's DEFAULT model and effort — what its new conversations start on — or
   * clear it with `null`** (677; D-042 · R2).
   *
   * ## ⛔ The order, and why each question is where it is
   *
   *  1. **Existence first** — `capabilitiesOf`, criterion 12's reader. ⛔ Asked before the provider
   *     is, because a probe is a LAUNCH (`070`): a typo must not cost a provider child.
   *  2. **A clear is not validated** — there is nothing to check a default of nothing against, and a
   *     person must be able to take one back while the provider cannot be reached.
   *  2b. 🔴 **682 · the identity's OWN provider** — `not-its-provider` (`R31b`): a default is always
   *     for the provider the identity runs on, and one with no provider of its own takes either.
   *  3. **The list** ({@link theListFor}) — the provider's own rows and the person's own — asked in
   *     the identity's home, or {@link STAND_IN_PROFILE}'s for an identity with no folder. ⚑ An
   *     effort left `null` is the model's own default effort, named here
   *     ({@link theEffortWhenNoneIsNamed} — `effort-not-offered` where nothing names one it offers).
   *  4. **The write**, read back rather than echoed — and ⚑ **R2 · it is the person's last pick on
   *     that provider too**.
   *
   * ⚠️ **Announced on `agents`**, as `setAgentProvider` and `setCapabilities` are: a second window
   * showing this sheet would otherwise go on drawing a default its new conversations no longer start
   * on. ⛔ **A conversation already open keeps its own** (`whatAModelChoiceReaches` says so).
   */
  async setAgentModelAndEffort(
    profileSlug: string,
    choice: AgentModelChoice | null,
  ): Promise<ModelChoiceSaved> {
    const said = { profileId: profileSlug }
    if (this.store.capabilitiesOf(profileSlug) === null) {
      return refuseModelChoice('no-such-agent', said)
    }
    if (choice === null) {
      if (!this.store.setModelChoice(profileSlug, null)) {
        return refuseModelChoice('no-such-agent', said)
      }
      this.agentsMoved()
      return { ok: true, choice: null }
    }
    const about = {
      ...said,
      provider: choice.provider,
      model: choice.model,
      ...(choice.effort === null ? {} : { effort: choice.effort }),
    }
    // 🔴 **682 · `R31b` — a default is always for the identity's own provider.**
    const itsProvider = this.itsProvider(profileSlug).provider
    if (!aChoiceIsInForce(choice, itsProvider)) {
      return refuseModelChoice('not-its-provider', {
        ...about,
        ...(itsProvider === null ? {} : { itsProvider }),
        // 🔴 **707 · R41** — the identity by the roster's name, never its slug in quotes.
        named: agentName(profileSlug, this.store.agentIdentities()),
      })
    }
    const list = await this.theListFor(choice.provider, profileSlug)
    const row = theListedRow(list.rows, choice.model)
    // ⚠️ **A model a person added, while the provider's list could not be read, offers efforts
    // nobody knows** — not *"none"* — so it is the list's absence that is said, as the agents' seam
    // says it (`model-rails.ts`), and no effortless default is saved.
    if (row === undefined || (list.notAsked !== null && row.addedBy === 'a-person')) {
      return list.notAsked === null
        ? refuseModelChoice('model-not-offered', about)
        : refuseModelChoice('models-unavailable', {
            ...about,
            ...(list.notAsked.reason === 'refused' ? { why: list.notAsked.detail } : {}),
          })
    }
    // ⚑ A blank effort is the model's own default — ⛔ refused where nothing names one it offers.
    const effort = choice.effort ?? theEffortWhenNoneIsNamed(row, list.rows)
    // ⚑ Saved as the list spells the model, however it was named.
    const pair =
      effort === undefined ? null : { model: theListsSpelling(row, choice.model), effort }
    if (pair === null || judgeAgainstTheList(list.rows, pair) !== null) {
      return refuseModelChoice('effort-not-offered', { ...about, offered: theEffortsOf(row) })
    }
    // 🔴 **`R31b` asked AGAIN, in the write's own synchronous stretch** (review, round one). ⛔ The
    // list above is an `await`, and a person moving this identity's provider during it would
    // otherwise leave exactly the contradiction the two doors must never leave.
    const itsProviderNow = this.itsProvider(profileSlug).provider
    if (!aChoiceIsInForce(choice, itsProviderNow)) {
      return refuseModelChoice('not-its-provider', {
        ...about,
        ...(itsProviderNow === null ? {} : { itsProvider: itsProviderNow }),
        named: agentName(profileSlug, this.store.agentIdentities()),
      })
    }
    if (!this.store.setModelChoice(profileSlug, { provider: choice.provider, ...pair })) {
      return refuseModelChoice('no-such-agent', said)
    }
    this.store.aPersonPicked(choice.provider, pair, this.now())
    this.agentsMoved()
    return { ok: true, choice: this.store.modelChoiceOf(profileSlug) }
  }

  /** ⚑ **The default {@link setAgentModelAndEffort} wrote, or `null`** (677) — the sheet's read. */
  agentModelAndEffort(profileSlug: string): AgentModelChoice | null {
    return this.store.modelChoiceOf(profileSlug)
  }

  /**
   * 🔴 **D-042 · R3 — the ONE list a person picks from**, for one provider and one agent
   * ({@link ModelList}): the provider's rows (with what an alias points at, each model's efforts and
   * the provider's default) and the person's own, the last pick, and what a new conversation of this
   * agent starts on when nothing is named — R1's order.
   *
   * ⚑ Asked as {@link providerModels} asks: an agent with no folder in {@link STAND_IN_PROFILE}'s
   * home, a failure already cached asked once more, and nothing creates a folder.
   */
  async modelList(provider: Provider, profileId: string = DEFAULT_PROFILE_ID): Promise<ModelList> {
    const list = await this.theListFor(provider, profileId)
    return {
      provider,
      notAsked: list.notAsked,
      standIn: list.standIn,
      models: list.rows,
      lastPicked: this.store.lastPicked(provider),
      startsOn:
        this.theSelectedPairIfNamed(provider, profileId) ??
        this.theProvidersDefaultIn(list, provider),
    }
  }

  /**
   * 🔴 **D-042 · R3 — a person adds a model to a provider's list by hand**, answering the hand-added
   * models after it. ⛔ **Never checked** (R3: no test call, nothing spent): a provider that refuses
   * it says so in its own words at the call that names it (D-039). ⚑ Announced on `agents`.
   */
  addHandAddedModel(provider: Provider, model: string): readonly string[] {
    const added = this.store.addHandAddedModel(provider, model.trim(), this.now())
    this.agentsMoved()
    return added
  }

  /**
   * ⚑ **D-042 · R2 — a person picked this pair on this provider**, at a door only the window reaches
   * (a new conversation they started naming a model). ⚑ Announced on `agents`.
   *
   * ⛔ **Only a pair the list holds** — {@link aPersonPickedItFor}'s rule, for its reason: the box
   * takes anything, and a model it took that the list does not hold is that conversation's alone —
   * never what every later start naming nothing runs. ⚑ Asked of the list the launch's own home
   * reads, memoized; ⚠️ never rejects — a pick not recorded is a later start resolving otherwise,
   * and the conversation it was made for has started either way.
   */
  async aPersonPicked(provider: Provider, profileId: string, pair: ModelAndEffort): Promise<void> {
    try {
      const list = await this.theListFor(provider, profileId)
      const row = theListedRow(list.rows, pair.model)
      if (
        list.notAsked !== null ||
        row === undefined ||
        judgeAgainstTheList(list.rows, pair) !== null
      ) {
        return
      }
      // ⚑ Kept as the list spells the model, however it was typed.
      this.store.aPersonPicked(
        provider,
        { ...pair, model: theListsSpelling(row, pair.model) },
        this.now(),
      )
      this.agentsMoved()
    } catch (error) {
      console.warn(`the last pick on ${provider} was not recorded: ${this.errorMessage(error)}`)
    }
  }

  /**
   * ⚑ **D-042 · R3 — a person takes a model they added off the list.** ⚠️ A provider's own model is
   * never stored, so it cannot be deleted: it comes back at the provider's next answer.
   */
  deleteHandAddedModel(provider: Provider, model: string): readonly string[] {
    const left = this.store.deleteHandAddedModel(provider, model, this.now())
    this.agentsMoved()
    return left
  }

  /**
   * 🔴 **D-042 · R4 — the default `create_agent` names for the agent it makes, judged by the one seam**
   * (`model-rails.ts`: the list, then the model's efforts), against the list in
   * {@link STAND_IN_PROFILE}'s home — the new agent has no folder to ask in. ⚑ For the provider it
   * names, else the provider whose list alone holds the model, else the caller's own: a default
   * holds its provider (`R31a`).
   */
  async judgeTheDefaultItNames(
    me: string,
    named: Provider | null,
    asked: { readonly model?: string; readonly effort?: string },
  ): Promise<
    | { readonly ok: true; readonly chosen: AgentModelChoice }
    | { readonly ok: false; readonly refusal: ModelRefusal }
  > {
    const provider =
      named ??
      (asked.model === undefined ? null : await this.theProviderWhoseListAloneHolds(asked.model)) ??
      this.theProviderOfConversation(me)
    // ⛔ **Unreachable while a tool call is made**: the caller is mid-call, so it runs.
    if (provider === null) throw new Error(`create_agent: ${me} runs on no provider`)
    const list = await this.theListFor(provider, STAND_IN_PROFILE)
    const verdict = judgeAnAgentsChoice(asked, provider, list, null, 'create')
    return verdict.ok ? { ok: true, chosen: { provider, ...verdict.chosen } } : verdict
  }

  /**
   * 🔴 **682 · an AGENT that has never run — an identity row, and no folder under any spelling** —
   * whose list is asked in {@link STAND_IN_PROFILE}'s home. ⚑ Folded both ways, the model door's own
   * comparison, so an identity whose folder was made in another case has run. With a provider,
   * only that provider's homes count.
   */
  private hasNeverRun(profileSlug: string, provider?: Provider): boolean {
    if (this.store.capabilitiesOf(profileSlug) === null) return false
    const folded = foldProfileName(profileSlug)
    return !this.profiles(provider).some((named) => foldProfileName(named) === folded)
  }

  /**
   * ⚑ **One provider's list in one home, with a FAILURE already cached asked once more** — the model
   * door's rule (`677`'s review), which `682` gave a launch and `689` gives
   * {@link providerModels} (`685` H1). ⚑ **One rule for every door that asks.**
   *
   * ⛔ **Why at all**: {@link probeModelsFor} memoizes the promise for the life of the app, failures
   * included, and only a sign-in forgets it — so one network blip left an agent's menus reading
   * *"could not be asked"*, and refused every later Save, until a restart. ⚑ Every caller is a
   * person's gesture or a launch that is paying for children anyway: a Save, a press on *Choose…*,
   * a window asking what a profile can run. ⚠️ **Not the memo**: `probeModelsFor` stays the one
   * cache, and a success stays a value — asking again costs a child only while it keeps failing.
   *
   * ⚠️ **Only a failure that was ALREADY cached** (`677`'s review, round two): one this ask just
   * produced is fresh, and asking again at once would spend a second child — up to twice the probe's
   * bound — on an answer a moment old. ⚑ **689 · *already* means SETTLED when this ask looked**
   * (`689`'s review): a probe another ask started and is still waiting on is fresh too, so two asks
   * in one tick share its answer rather than spending a child each.
   *
   * ⛔ **And ONE re-ask for every caller that met the same failure** (`689`'s review): each forgets
   * only the promise it awaited, so a second caller finding a newer probe in its place joins that
   * one — instead of deleting a probe still running and starting another child.
   *
   * 🔴 **Never during a quit** (`689`'s review): asking again runs `prepareProviderHome` before the
   * launch registry can refuse the child, and a quit hands back what it has (070, from 068 finding 7).
   */
  private async modelsAskedAgainIfTheyFailed(
    provider: Provider,
    folder: string,
  ): Promise<ModelCatalogue> {
    const key = modelProbeKey(provider, folder)
    const cached = this.modelProbes.get(key)
    const stale = cached !== undefined && this.settledModelProbes.has(cached)
    const catalogue = await this.probeModelsFor(provider, folder)
    if (catalogue.ok || !stale || this.isClosing()) return catalogue
    if (this.modelProbes.get(key) === cached) this.forgetModels(provider, folder)
    return this.probeModelsFor(provider, folder)
  }

  /**
   * 🔴 **D-042 · R3 — one provider's list in the home of a profile a launch prepared**: the provider's rows, then
   * the models a person added by hand ({@link theList}). ⚑ Asked through
   * {@link modelsAskedAgainIfTheyFailed}, the one memo every door shares, so a launch after a window
   * read costs no second child.
   */
  private async theListIn(provider: Provider, profileId: string): Promise<TheListAsked> {
    const catalogue = await this.modelsAskedAgainIfTheyFailed(provider, profileId)
    return this.theListOf(provider, catalogue)
  }

  /**
   * ⚑ **D-042 · R3 — one provider's list for an agent, asked as the window asks it**
   * ({@link providerModels}: an agent with no folder is answered in {@link STAND_IN_PROFILE}'s home,
   * and nothing creates a folder). ⚠️ During a quit with nothing cached, the provider's rows are
   * missing for `closing`, and a person's own models still list.
   *
   * ⚠️ **Asked under the folder's OWN spelling**, the key its list was memoized under (`187`: a
   * directory keeps the case it was made with; an identity's slug is folded, and a give names an
   * agent as it likes). ⛔ Asked under any other, {@link providerModels}' exact test answers
   * `no-profile` for an agent that has a folder — every door here would call that an outage.
   */
  async theListFor(
    provider: Provider,
    profileId: string,
  ): Promise<TheListAsked & { readonly standIn: string | null }> {
    const folded = foldProfileName(profileId)
    const own = this.profiles().find((named) => foldProfileName(named) === folded) ?? profileId
    const catalogue = await this.providerModels(own, provider).catch((): ModelCatalogue => ({
      ok: false,
      reason: 'closing',
    }))
    return {
      ...this.theListOf(provider, catalogue),
      standIn: catalogue.ok ? (catalogue.standIn ?? null) : null,
    }
  }

  /**
   * Each provider's list as this app last read it — in {@link STAND_IN_PROFILE}'s home, where an agent
   * nothing has run is judged, else in the home asked most recently that answered — with the models a
   * person added ({@link theListOf}, the list a give's refusal names). A provider whose list this
   * app has not read is left out. It asks no provider: a launch names what is known.
   */
  theListsAsLastRead(): ListsAsLastRead {
    const answered = (probe: Promise<ModelCatalogue> | undefined): ModelCatalogue | undefined => {
      const catalogue = probe === undefined ? undefined : this.modelsAnswered.get(probe)
      return catalogue?.ok === true ? catalogue : undefined
    }
    const lists: ListsAsLastRead = {}
    for (const provider of Object.keys(PROVIDER_NAME) as Provider[]) {
      const itsHomes = modelProbeKey(provider, '')
      const read =
        answered(this.modelProbes.get(modelProbeKey(provider, STAND_IN_PROFILE))) ??
        [...this.modelProbes]
          .filter(([key]) => key.startsWith(itsHomes))
          .map(([, probe]) => answered(probe))
          .filter((one) => one !== undefined)
          .at(-1)
      if (read !== undefined) lists[provider] = this.theListOf(provider, read).rows
    }
    return lists
  }

  /** ⚑ **D-042 · a catalogue and a person's own models, as one list.** */
  private theListOf(provider: Provider, catalogue: ModelCatalogue): TheListAsked {
    return {
      rows: theList(catalogue.ok ? catalogue.models : [], this.store.handAddedModels(provider)),
      notAsked: catalogue.ok ? null : catalogue,
    }
  }

  /**
   * 🔴 **D-042 · R1 — the pair a conversation starts on when nothing named one for it, where no
   * list need be asked**: its agent's default (in force, and for this provider), else the last pair
   * a person picked on this provider, else the provider's own default where it has one by name
   * (Claude's). ⚑ `null` is *read the provider's list* — Codex's default is a row of it.
   *
   * ⚑ **Synchronous**, so a give can ask it inside its stretch (D-016 · R2).
   */
  theSelectedPairIfNamed(provider: Provider, profileSlug: string | null): SelectedModel | null {
    const itsDefault = profileSlug === null ? null : this.store.modelChoiceOf(profileSlug)
    if (
      profileSlug !== null &&
      itsDefault !== null &&
      itsDefault.provider === provider &&
      aChoiceIsInForce(itsDefault, this.itsProvider(profileSlug).provider)
    ) {
      return { model: itsDefault.model, effort: itsDefault.effort, from: 'its-default' }
    }
    const lastPicked = this.store.lastPicked(provider)
    if (lastPicked !== null) return { ...lastPicked, from: 'the-last-pick' }
    const byName = theDefaultByName(provider)
    return byName === null ? null : { ...byName, from: 'the-providers-default' }
  }

  /**
   * ⚑ **D-042 · R1 — the provider's own default, BY NAME** — Claude's without asking, else the row
   * its list marks `isDefault`, at that row's own default effort ({@link theEffortWhenNoneIsNamed}).
   * ⚑ **A row that names none of its efforts its default is completed by `carried`** — the effort
   * its caller already holds (one named alone, or the one a conversation runs at) — where the row
   * offers it. ⛔ `null` when the list was not given, marks none, or marks a row that offers efforts
   * and nothing names one of them: never an unnamed default.
   */
  theProvidersDefaultIn(
    list: TheListAsked,
    provider: Provider,
    carried?: string,
  ): SelectedModel | null {
    const byName = theDefaultByName(provider)
    if (byName !== null) return { ...byName, from: 'the-providers-default' }
    const row = list.rows.find((one) => one.isDefault === true && one.addedBy === 'the-provider')
    const itsOwn = theEffortWhenNoneIsNamed(row, list.rows)
    const effort =
      itsOwn === undefined && carried !== undefined && theEffortsOf(row).includes(carried)
        ? carried
        : itsOwn
    return row === undefined || effort === undefined
      ? null
      : { model: row.id, effort, from: 'the-providers-default' }
  }

  /**
   * ⚑ **D-042 · R1 — the effort a model named without one runs at**: a row of the PROVIDER's runs
   * at its own default, else at the provider's default row's where it offers that one
   * ({@link theEffortWhenNoneIsNamed}) — `null` only for a row that offers none. A model a person
   * added, or one the list does not hold, runs at its row's default where the list gave it one,
   * else at the provider's default effort. ⛔ **`undefined` when nothing can name it** — a
   * provider's row that offers efforts, none of them named its default, or a list that could not be
   * read or names no default effort — which is never *"it offers none"*: a caller says so rather
   * than send an absence.
   */
  theEffortOfAModelNamedAlone(
    list: TheListAsked,
    provider: Provider,
    model: string,
  ): string | null | undefined {
    const row = theListedRow(list.rows, model)
    const itsDefault = theEffortWhenNoneIsNamed(row, list.rows)
    if (row?.addedBy === 'the-provider') return itsDefault
    return itsDefault ?? this.theProvidersDefaultIn(list, provider)?.effort ?? undefined
  }

  /**
   * 🔴 **D-042 · R1 — every call names its model and effort: the one resolution every launch asks**
   * (a person's start, a give's start, a wake, a replacement), in the ruling's order — what was
   * NAMED for this conversation; else its agent's default; else the last pair a person picked on
   * this provider; else the provider's own default, BY NAME.
   *
   * ⚑ **Asked after the launch's home is prepared**, so a list it needs is read in that home — the
   * one the conversation runs under. ⚠️ A list is read only when a model is named without an
   * effort, an effort is named without a model, or the provider's default is a row of its list
   * (Codex).
   *
   * ⛔ **Throws `nothing-names-a-model`** when nothing can name one — only when the provider's list
   * could not be read, or names no default model and effort, and nothing else names a model (D-042
   * F2) — ⚑ or, for a model named alone, nothing names its effort
   * ({@link theEffortOfAModelNamedAlone}): never an unnamed default.
   *
   * ⚠️ **An effort named ALONE** — a row from before D-042 holding one beside no model — **is kept
   * only where the model it lands on offers it**, else that pair's own effort stands: the pair
   * stays one the list holds, as {@link theSettingNamed} keeps it. ⚑ It also completes the
   * provider's default row that names no effort of its own, where that row offers it
   * ({@link theProvidersDefaultIn}). ⚑ A list that could not be read judges nothing, and the named
   * effort stays.
   */
  async theSelectedModel(
    provider: Provider,
    /** The identity whose default is asked — `null` for a conversation no identity holds. */
    profileSlug: string | null,
    /** ⚑ The profile whose home the launch prepared, where a list it needs is asked. */
    askIn: string,
    named: { readonly model?: string; readonly effort?: string },
  ): Promise<SelectedModel> {
    const unnamed = (list: TheListAsked, model: string | null): SessionUnavailable => {
      const why =
        list.notAsked === null
          ? null
          : list.notAsked.reason === 'refused'
            ? list.notAsked.detail
            : list.notAsked.reason
      return new SessionUnavailable(
        'nothing-names-a-model',
        model === null
          ? `${provider}: no model is named, and its list names no default model and effort (${why ?? 'answered'})`
          : `${provider}: ${model} is named without an effort, and its list names none (${why ?? 'answered'})`,
        { listUnread: { provider, why, model } },
      )
    }
    if (named.model !== undefined) {
      if (named.effort !== undefined) {
        return { model: named.model, effort: named.effort, from: 'named' }
      }
      const list = await this.theListIn(provider, askIn)
      const effort = this.theEffortOfAModelNamedAlone(list, provider, named.model)
      if (effort === undefined) throw unnamed(list, named.model)
      return { model: named.model, effort, from: 'named' }
    }
    let selected = this.theSelectedPairIfNamed(provider, profileSlug)
    if (selected === null) {
      const list = await this.theListIn(provider, askIn)
      selected = this.theProvidersDefaultIn(list, provider, named.effort)
      if (selected === null) throw unnamed(list, null)
    }
    if (named.effort === undefined) return selected
    const list = await this.theListIn(provider, askIn)
    const row = theListedRow(list.rows, selected.model)
    const offered = row === undefined ? theEffortLadder(list.rows) : theEffortsOf(row)
    const judged = list.notAsked === null || offered.length > 0
    return !judged || offered.includes(named.effort)
      ? { ...selected, effort: named.effort }
      : selected
  }

  /**
   * 🔴 **What ONE provider will run today for ONE profile** (058, re-scoped by 257 §2, one provider
   * since `689`/`685` H2) — asked of the provider, cached per `provider:profileId`; an answer for
   * the app's life, a failure until the next ask ({@link modelsAskedAgainIfTheyFailed}).
   *
   * ⛔ **Why it asks one provider and never both.** The one list a person picks from
   * ({@link modelList}, through {@link theListFor}), and every read of it a choice is judged by,
   * must not probe the other: a probe is `prepareProviderHome` first, so a Claude agent would get a
   * Codex home in its folder — on Codex, a copy of the machine credential — for a list nothing
   * draws. ⚑ **D-049 · no window asks it directly**: the window asks the list door.
   *
   * ⚠️ **Unlike {@link capabilities} this is not free.** Each ask costs a short-lived provider child
   * process (Claude ~1.4 s, Codex ~0.6 s, measured) — no turn, no tokens, but a real spawn. The
   * PROMISE is cached rather than its value: two surfaces asking in the same moment share one probe
   * instead of racing two.
   *
   * ⚠️ **A provider that cannot answer yields a REASON, never a throw and never `[]`** — no login, no
   * binary, a rejected call all mean "we do not know", and the person keeps the free-text field.
   * ⛔ **The reason CROSSES** (310): see {@link ModelCatalogue}; *"this profile does not exist yet"*,
   * *"Codex refused"* and *"the app is closing"* are known here and nowhere else.
   *
   * ⛔ **The probe runs in the SAME per-profile home a session would launch in, because a model list
   * is what THIS login may run** (`256` H1: every non-default profile was once shown the default
   * profile's catalogue). ⚠️ The free-text model field stays: it is why a stale or missing menu is
   * survivable at all, and the reason this cache can be allowed no timer.
   */
  providerModels(profileId: string, provider: Provider): Promise<ModelCatalogue> {
    // ⚠️ **Refused once a quit has started, and only when nothing is cached** (070, from 068
    // finding 7). A probe answered earlier is a value, not a process, and handing it back during a
    // shutdown costs nothing. Starting a NEW one does: a give, a Save or an agent's tool asking for
    // a list as the person hits ⌘Q is exactly the shape 068 described.
    //
    // A rejection rather than a catalogue, deliberately — and ⚠️ **its ORIGINAL argument expired
    // with 310**: {@link ModelCatalogue} can say *"we did not ask, because the app is closing"* in
    // as many words. It stays for 070/068 finding 7: the guard exists to stop a provider child being
    // spawned during a quit, and a value here would still have to be produced without spawning one.
    // ⚑ No window reaches it during a quit: its list door is refused at `DURING_A_QUIT`.
    //
    // 🔴 **689 · FIRST, and it hands back what is cached AS IT IS** (`689`'s review). ⛔ It used to
    // sit after the stand-in question below, which READS THE DATABASE — so a read still asking
    // after the connection closed was told the connection was closed. ⚑ Asked of the profile's OWN home only: a never-run agent's
    // stand-in list is refused during a quit rather than decided from a store that may be gone, and
    // a failure is handed back rather than asked again ({@link modelsAskedAgainIfTheyFailed}).
    if (this.isClosing()) {
      const answered = this.modelProbes.get(modelProbeKey(provider, profileId))
      return (
        answered ??
        Promise.reject(
          new Error('BroCrew is shutting down, so the providers were not asked for their models'),
        )
      )
    }
    // 🔴 **682 · an AGENT that has never run is answered from {@link STAND_IN_PROFILE}'s home** (`R31d`),
    // and its list says so (`standIn`). ⚑ Its own folder would be created by asking in it, which the
    // guard below exists to prevent; the stand-in's is the product's own, which this read already
    // asks in for BroBot's launcher. ⛔ **A name with no identity row still answers `no-profile`** —
    // somebody typing a new profile's name is not an agent that exists.
    const standIn = this.hasNeverRun(profileId, provider) ? STAND_IN_PROFILE : null
    const askIn = standIn ?? profileId
    // 🔴 **A profile that does not exist yet is not probed, and this guard is what makes taking a
    // `profileId` safe at all** (257 §2, holding 190 H2 / 197 §2's rule). `prepareProviderHome` —
    // the first thing a probe does — CREATES the home, and for Codex copies the machine credential
    // into it. So without this line, merely rendering a launcher for a name somebody was still
    // typing would bring a profile into existence and provision a credential for it: exactly the
    // *"asking a question wrote a credential to disk"* defect `098`'s review found on the auth path,
    // reintroduced through the menu. `createProviderAuthOps` puts the same rule on its own door.
    //
    // Return `no-profile` explicitly while keeping the launcher's free-text field. A profile created by launch cannot yet supply a catalogue; that differs from a provider refusing to list models.
    if (!this.profiles().includes(askIn)) {
      return Promise.resolve({ ok: false, reason: 'no-profile' })
    }
    // ⚑ **689 · a failure already cached is asked once more** (`685` H1) — the Save door's rule;
    // see {@link modelsAskedAgainIfTheyFailed}.
    return this.modelsAskedAgainIfTheyFailed(provider, askIn).then((one) =>
      standIn !== null && one.ok ? { ...one, standIn } : one,
    )
  }

  /**
   * **Forget what a provider said about one profile's models** (257 §2) — a no-op when nothing was
   * asked, which is the ordinary case.
   *
   * ⛔ This is the whole invalidation story for an ANSWER, and it is deliberately not a schedule. A
   * sign-in, a cancelled sign-in or a re-copied credential is the one moment the catalogue for that
   * home can change under a running app; every other moment it cannot, and re-asking would be a
   * spawn nobody requested. The next ask pays for one short-lived child; nothing pays in the meantime.
   *
   * ⚑ **689 · a FAILURE is forgotten by the next ask too** — see
   * {@link modelsAskedAgainIfTheyFailed}. ⛔ Still not a schedule: it costs a child only when
   * somebody asks and the last answer was a failure.
   */
  forgetModels(provider: Provider, profileId: string): void {
    this.modelProbes.delete(modelProbeKey(provider, profileId))
  }

  /**
   * One provider's catalogue in one profile's home, memoized — the PROMISE, so two surfaces asking
   * in the same tick share one child rather than racing two.
   */
  private probeModelsFor(provider: Provider, profileId: string): Promise<ModelCatalogue> {
    const key = modelProbeKey(provider, profileId)
    const known = this.modelProbes.get(key)
    if (known) return known
    const probe = this.askProviderForModels(provider, profileId)
    // ⚑ **689** — see {@link settledModelProbes}. Both arms, so a rejection is not left unhandled.
    const settled = (): void => {
      this.settledModelProbes.add(probe)
    }
    void probe.then(settled, settled)
    void probe.then(
      (catalogue) => this.modelsAnswered.set(probe, catalogue),
      () => undefined,
    )
    // ⛔ **The bound, and what it costs when it bites** (257 §2). Oldest-first, by insertion order —
    // an evicted entry is a settled promise, so dropping it cancels nothing and loses no process;
    // the only cost is that a profile revisited after {@link MAX_MODEL_PROBES} others is asked again.
    // A person who has opened seventeen profiles in one app run has paid one extra 1.4 s spawn.
    if (this.modelProbes.size >= MAX_MODEL_PROBES) {
      const oldest = this.modelProbes.keys().next().value
      if (oldest !== undefined) this.modelProbes.delete(oldest)
    }
    this.modelProbes.set(key, probe)
    return probe
  }

  /**
   * The provider whose list alone holds this model — its own rows, an alias's target, or one a person
   * added — else `null`: neither list holds it, or both do. ⚑ Asked only where nothing names an
   * agent's provider yet or a give names a model without a provider. ⛔ In
   * {@link STAND_IN_PROFILE}'s home, as a new agent's default is judged: an agent's own home is
   * prepared only for the provider it runs on.
   */
  async theProviderWhoseListAloneHolds(model: string): Promise<Provider | null> {
    const providers = Object.keys(PROVIDER_NAME) as Provider[]
    const lists = await Promise.all(
      providers.map((provider) => this.theListFor(provider, STAND_IN_PROFILE)),
    )
    const holders = providers.filter(
      (_, at) => theListedRow(lists[at]?.rows ?? [], model) !== undefined,
    )
    return holders.length === 1 ? (holders[0] ?? null) : null
  }

  /**
   * The provider an agent runs on, and what says so — {@link theProviderOfAnAgent}, the one rule the
   * window reads too, over the provider saved for it and its started conversations.
   */
  itsProvider(profileSlug: string): ItsProvider {
    return theProviderOfAnAgent(
      this.store.providerOf(profileSlug),
      this.store.startedOnOf(profileSlug),
    )
  }

  forgetProviderModels(provider: Provider): void {
    for (const key of this.modelProbes.keys()) {
      if (key.startsWith(`${provider}:`)) this.modelProbes.delete(key)
    }
  }
}
