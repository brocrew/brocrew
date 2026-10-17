import { ref, type Ref } from 'vue'
import type { AgentInstructionsReading } from '../../../shared/own-instructions'
import type {
  AgentIdentities,
  AgentIdentity,
  AnswerAck,
  NewAgent,
  Provider,
  RuntimeBridge,
} from '../../../shared/runtime-ipc'
import { agentName } from '../../../shared/runtime-ipc'
import type { AgentModelChoice } from '../../../shared/model-choice'
import type { CapabilityGrant } from '../../../shared/capabilities'
import type { ExternalMcpServerReach } from '../../../shared/external-mcp'
// ⚑ **558 · a VALUE import, and it costs nothing here.** ⛔ The 135 kB rule is about the workspace
// package `@brobot2/shared`, whose `contracts.ts` pulls zod; `apps/desktop/src/shared` is inside the
// app and `runtime-ipc.ts` is already this renderer's most-imported module.
import { HOLDING_SAYS, type ItsProvider, type StartedOn } from '../../../shared/agent-roster'
import { readableError } from './session-record'
import { WHERE_AGENTS_ARE_CREATED } from './where-agents-are-created'

/**
 * **The agent identities, over the real bridge** (355, HO-008 §3 · P0b) — GLOBAL since 369.
 *
 * ⛔ **These are ROWS and not the launcher's profile names.** `RuntimeBridge.profiles()` answers a
 * `readdir` of `provider-homes/`; a folder is there for anything anyone ever typed into the
 * launcher, including a launch that was refused before it registered. An identity EXISTS when the
 * database says so — which is what `give_work`'s `no-such-profile` rail and `setCapabilities`
 * both key on — so a grant surface built off the folders would offer grants the door refuses.
 * {@link AgentIdentities.foldersWithoutARow} is the difference, reported rather than repaired.
 *
 * ⚑ **A module with no Vue component around it**, so a test drives it with a fake bridge instead of
 * mounting a surface to reach it.
 */
export interface AgentStore {
  /** What the last read said, or null. See {@link AgentStore.loaded} for what null cannot say. */
  readonly identities: Ref<AgentIdentities | null>
  /**
   * ⛔ **Whether an answer has arrived at all** (086, and 339's rule one store over). Null is three
   * facts until this splits them: not asked, asked and empty, asked and refused.
   */
  readonly loaded: Ref<boolean>
  /** Why the last read failed, or null — including *"a person is not asking"*, which is a real one. */
  readonly loadError: Ref<string | null>
  /**
   * Read the list. Safe to call again; the last answer wins.
   *
   * ⚠️ **No project, since 369** — an identity is global, so a list of identities is.
   */
  load(): Promise<void>
  /**
   * Write one identity's capabilities.
   *
   * ⛔ **Answers the REFUSAL SENTENCE, or null when it saved**: a boolean throws the sentence away, and for this door the sentence is either *this
   * identity has no row* (criterion 12) or the main process's own words about who may ask.
   */
  save(
    profileId: string,
    grant: CapabilityGrant,
    /**
     * 🔴 **516 · the COMPLETE set of RESTRICTED servers this identity is granted** (`507` §5, narrowed by
     * 524).
     *
     * ⛔ **Required, and it travels with the grant so the two commit in ONE transaction.** The sheet
     * has one Save button; two commands behind one press can half-succeed, and the surface would
     * then have to draw a state that is neither saved nor unsaved.
     *
     * ⚠️ **Not a field on {@link CapabilityGrant}.** Every member of that record is one column on
     * one row; this is a set of rows in another table — `507` §5's *"a related capability grant with
     * a different relational shape"*.
     */
    externalMcpServerIds: readonly string[],
  ): Promise<string | null>
  /**
   * 🔴 **Register one external MCP server, globally** (516, HO-040 §4.2).
   *
   * ⛔ **Answers the refusal SENTENCE, or null when it wrote** — {@link AgentStore.create}'s rule,
   * and like that one there is no null arm for success: every refusal this door can meet is an
   * exception carrying words somebody wrote for a person.
   *
   * ⚠️ **It can take seconds.** The door asks the server what it offers before it writes, which is
   * the refusal rail — so a caller must show that something is in flight.
   */
  registerExternalMcp(said: {
    name: string
    url: string
    /**
     * ⚑ **524 · who the server is for** (`HO-048` §1) — carried, never defaulted here. The DEFAULT
     * belongs on the form, where a person can see it and move it.
     */
    reach: ExternalMcpServerReach
  }): Promise<string | null>
  /**
   * 🔴 **Remove one registered server, and every grant naming it** (516).
   *
   * ⛔ **Answers the refusal sentence, or null.** A row that was already gone is not a refusal —
   * the person asked for a state that already holds — so it answers null too, and the re-read is
   * what makes the list agree with the database either way.
   */
  removeExternalMcp(serverId: string): Promise<string | null>
  /**
   * 🔴 **Say which provider this identity's NEXT conversation starts on** (433), or `null` to hand
   * it back to the app's fallback.
   *
   * ⛔ **Its own method and deliberately not a field on {@link AgentStore.save}'s grant.** Provider
   * is not a capability — no rail reads it, `419` §3 — and folding it into `CapabilityGrant` would
   * make one writer answer two questions. ⚠️ **It is also its own GESTURE**, which matters on a
   * sheet with a Save button: a Save that sent two commands could half-succeed, and the sheet would
   * have to report a state that is neither saved nor unsaved.
   *
   * ⚑ **Answers the refusal SENTENCE when it did not write** — {@link AgentStore.save}'s rule, as
   * `{ ok: false, reason }`.
   *
   * 🔴 **`696` · and when it wrote, what the SAME act cleared** (`682`'s `R31b`): moving an identity
   * to another provider clears a model choice for the old one in the one transaction, and the door's
   * answer carries it as `modelChoiceCleared` — `null` when nothing was cleared. ⚑ `{ ok: true,
   * cleared }` is that field, handed on, so the sheet says what the press took (HO-029 §3: after the
   * write, from the door's own answer). ⚠️ It was `Promise<string | null>` until `696`, which
   * dropped the answer on the floor.
   */
  chooseProviderFor(
    profileId: string,
    provider: Provider | null,
  ): Promise<
    | { readonly ok: true; readonly cleared: AgentModelChoice | null }
    | { readonly ok: false; readonly reason: string }
  >
  /**
   * 🔴 **Correct what an identity is called** (558, `HO-063` gap 2). `null` to say nobody has named
   * it. Answers the refusal SENTENCE, or null when it wrote.
   *
   * ⛔ **Its own method and deliberately not a field on {@link AgentStore.save}'s grant**, for
   * {@link AgentStore.chooseProviderFor}'s reason one method up: a name is not a capability, no
   * rail reads it, and a Save that sent two commands could half-succeed.
   */
  renameTo(profileId: string, displayName: string | null): Promise<string | null>
  /**
   * 🔴 **Read one identity's own instructions, and every ask waiting against them** (582,
   * `HO-063` gap 4). `null` when the read was refused, with the sentence in
   * {@link AgentStore.loadError}'s shape — see the implementation.
   *
   * ⛔ **Not held in this store's state**, which is where it differs from every other read here:
   * the list of identities is what every surface draws, and one identity's rule HISTORY is what one
   * sheet draws while it is open. ⚑ Caching it would mean deciding when it goes stale, and the
   * answer would be *whenever anybody writes a version anywhere*.
   */
  instructionsFor(profileId: string): Promise<AgentInstructionsReading | null>
  /**
   * 🔴 **Append one version of an identity's own instructions** (582) — a person's own save.
   * Answers the refusal SENTENCE, or null when it wrote.
   *
   * ⛔ **Its own method and deliberately not a field on {@link AgentStore.save}'s grant**, for
   * {@link AgentStore.renameTo}'s reason one method up: rules are not a capability, no rail reads
   * them, and a Save that sent two commands could half-succeed.
   *
   * ⚠️ **`broughtBack` is what makes a revert a first-class act** and it is a claim about TEXT
   * alone: standing rule 11 — a revert restores rules and never re-grants anything.
   */
  instruct(profileId: string, text: string, broughtBack?: number): Promise<string | null>
  /**
   * 🔴 **Approve or refuse one ask an agent made against an identity's instructions** (582).
   * Answers the refusal SENTENCE, or null when it was taken.
   *
   * ⛔ **The refusal arrives as DATA rather than as an exception** — `AnswerAck` — so the sentence
   * comes off the ack and is not composed here.
   */
  decideInstruction(askId: string, approve: boolean): Promise<string | null>
  /**
   * Approve or refuse one agent's request to register an MCP server. Answers the host's answer: a
   * press it took or refused, with its sentence. A call that failed is a refusal that leaves the
   * request open, since nothing is known to have been decided.
   */
  decideMcpServerRequest(requestId: string, approve: boolean): Promise<AnswerAck>
  /**
   * 🔴 **685 · this identity's default model and effort** (`677`'s read; D-042 · R2) — `{ held }`,
   * where `held: null` is *it has none*; or `null` when the read itself failed.
   *
   * ⛔ **Wrapped, because `null` is already an answer here** — the door's own *nobody chose* — and a
   * read that failed has not learned that (086). ⚑ Not held in this store's state, for
   * {@link AgentStore.instructionsFor}'s reason: one sheet draws it while it is open.
   */
  modelChoiceFor(profileId: string): Promise<{ readonly held: AgentModelChoice | null } | null>
  /**
   * 🔴 **685 · save a choice, or clear it with `null`** — `setAgentModelAndEffort`, whose refusal
   * is DATA with a sentence written for the person (`ModelChoiceSaved`).
   *
   * ⚑ **`{ ok: true, held }` is the choice READ BACK**, the door's own answer. ⛔ **`{ ok: false }`
   * carries the door's `reason` verbatim** — or, for a call that threw, `readableError`'s sentence.
   * ⚠️ **No `load()`**: the choice is not on {@link AgentIdentity}, so nothing this store holds is
   * wrong after it, and the door announces `agents` for every other window.
   */
  chooseModelFor(
    profileId: string,
    choice: AgentModelChoice | null,
  ): Promise<
    | { readonly ok: true; readonly held: AgentModelChoice | null }
    | { readonly ok: false; readonly reason: string }
  >
  /**
   * 🔴 **Remove an identity nothing runs** (558, `HO-063` gap 1). Answers the refusal SENTENCE, or
   * null when the row went.
   *
   * ⛔ **The sentence is composed HERE, out of `HOLDING_SAYS`**, because the door answers a payload
   * rather than throwing: five things can hold an identity and a person pressing a control is owed
   * which. ⚑ Every other refusal in this store arrives as an exception and already carries words;
   * this is the one that arrives as data, and `485`'s rule is that the words come from the table
   * rather than from here.
   */
  remove(profileId: string): Promise<string | null>
  /**
   * 🔴 **Bring an identity into existence** (423, HO-023 §3) — the renderer half of `419`'s
   * `createAgent`, which shipped a wire, a preload member and no caller.
   *
   * ⛔ **Answers the refusal SENTENCE, or null when it wrote** — {@link AgentStore.save}'s rule. ⚠️ **There is no null arm here and that is the door's own shape**:
   * `RuntimeHost.createAgent` THROWS on a taken name rather than resolving to null, because *"there
   * is no useful `there was no such identity to create`"* — so every refusal this can meet is an
   * exception, and all five of them carry a sentence somebody wrote for a person.
   */
  create(said: NewAgent): Promise<string | null>
  /**
   * Throw the global switch. Answers the refusal sentence, or null.
   *
   * ⚠️ **No project**, and that is the switch rather than an omission: `app_policy` is ONE row,
   * app-wide, and a per-project argument here would imply a per-project answer that does not exist.
   */
  setSpawning(enabled: boolean): Promise<string | null>
  /** Turn services on or off in this workspace. Answers the refusal sentence, or null. */
  setServices(on: boolean): Promise<string | null>
  /**
   * 🔴 **Set the mode a person's next conversation begins in** (500, HO-036 §3.1). Answers the
   * refusal sentence, or null.
   *
   * ⚠️ **No profile and no project, for {@link AgentStore.setSpawning}'s reason one method up** —
   * `app_policy` is ONE row, so an argument naming an identity here would imply a per-identity
   * answer that does not exist. ⛔ It is a person's preference, not an identity's capability.
   */
  setApprovalDefault(mode: 'ask' | 'auto'): Promise<string | null>
}

/** One identity out of the last read, by folded slug, or null. */
export function identityIn(list: AgentIdentities | null, slug: string): AgentIdentity | null {
  return list?.identities.find((identity) => identity.slug === slug) ?? null
}

/**
 * The agents no other agent can start until a person chooses their provider — their conversations
 * ran on both, and none is saved — out of the last read: a person's to settle.
 */
export function providersNotChosenIn(
  list: AgentIdentities | null,
): readonly { readonly slug: string; readonly startedOn: StartedOn }[] {
  return (list?.use ?? []).flatMap((use) =>
    use.runsOn.from === 'its-conversations-differ'
      ? [{ slug: use.slug, startedOn: use.runsOn.startedOn }]
      : [],
  )
}

/** The provider one agent runs on, and what says so, out of the last read; null while unread. */
export function runsOnIn(list: AgentIdentities | null, slug: string): ItsProvider | null {
  return list?.use.find((use) => use.slug === slug)?.runsOn ?? null
}

/**
 * 🔴 **Which provider a LAUNCH as this identity runs on** (423, HO-023 §3) — the identity's
 * own answer ({@link runsOnIn}), or the app frame's constant when nothing names one yet.
 *
 * ⛔ **`admitGive`'s order with the GIVER term removed, and that removal is the whole difference
 * between a give's start and a launch.** `spawn-rails.ts` resolves
 * `inForce?.provider ?? itsProvider ?? giving.provider` — *a person's choice in force, then what the
 * target identity chose, then the giver's*. A launch is the root of its own chain and has no giver,
 * so the last term becomes the app frame's constant. ⚠️ **682 · the give side has a first term this
 * one must NOT have**: a person's model choice in force holds an AGENT-started launch (`R31a`), and
 * a launch a person starts never reads it (`R25` §1.4).
 *
 * ⚠️ **This paragraph said TWO terms were gone until `435`**, on the premise that *"the door asks
 * nothing"* — which HO-025 §5 reversed. The door names a provider again, so only the parent term is
 * missing and the order below has three.
 *
 * ⚠️ **A function rather than three characters at the call site**, so the order is one derivation
 * with one docblock and a test can drive it without mounting a screen — `identityIn` above is here
 * for the same reason. ⛔ **It is NOT shared with `spawn-rails.ts`**: that expression is the anchor
 * of two live mutation rows (`419 M17`, `419 M18`) and folding it into this would retire both to
 * buy a deduplication neither door asked for. The two orders agree because they are argued to, and
 * `423`'s tests assert the agreement rather than a shared symbol.
 *
 * ## 🔴 **The asked term came back at `435`, and it is the FIRST one** (HO-025 §4/§5)
 *
 * ⛔ **`417` removed the front door's provider control and `HO-025 §5` reversed that half of the
 * ruling**: *"asks nothing" meant do not make configuring a session the price of starting a
 * conversation. It did not mean the choices should be unavailable.* ⚑ So a person can name a
 * provider again — and the question *which provider will this conversation start on* still has to
 * have exactly **one** derivation.
 *
 * ⚠️ **A fourth parameter rather than a `??` at the call site, and that is the whole point.**
 * `435`'s brief: *"A second spelling of `asked ?? identity ?? fallback` is the drift this repo keeps
 * paying for."* The order now lives here in full, spelled once, and the surface that asks passes
 * what it was asked — it does not re-rank anything.
 *
 * ⛔ **Optional, defaulting to *nobody asked*, so it is opt-in at the call site.** `providerForAgent`
 * — the placed door — passes nothing and resolves exactly as it did before this dispatch; a widening
 * that every caller inherits is the shape `an-entitlement-widening-must-be-opt-in-at-the-call-site`
 * is about, and this one is not that.
 *
 * @param list the last roster read, or null while nobody has asked
 * @param slug the identity the launch will run as, folded
 * @param fallback what to answer when that identity has said nothing — or when nobody has asked
 * @param asked what the PERSON chose on the surface that will launch, or null when they did not
 */
export function providerForALaunch(
  list: AgentIdentities | null,
  slug: string,
  fallback: Provider,
  asked: Provider | null = null,
): Provider {
  return asked ?? runsOnIn(list, slug)?.provider ?? fallback
}

/** `held`, saying services are on or off as the host read them back. */
function withServices(held: AgentIdentities, on: boolean): AgentIdentities {
  if (on) return { ...held, servicesOn: true }
  return Object.fromEntries(
    Object.entries(held).filter(([key]) => key !== 'servicesOn'),
  ) as unknown as AgentIdentities
}

export function createAgentStore(bridge: RuntimeBridge): AgentStore {
  const identities = ref<AgentIdentities | null>(null)
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  /**
   * 🔴 **What a person is shown when a door refused — through {@link readableError}** (423).
   *
   * ⛔ **It was `error.message` raw, and that is a library talking.** `ipcMain.handle` rejections
   * arrive wrapped: `Error invoking remote method 'runtime:command': Error: <the sentence>`. So
   * every refusal this store has ever surfaced — `setCapabilities`' *"who may ask"*, the switch's,
   * and now `419`'s *"There is already an agent called worker."* — reached the screen with nine
   * words of Electron in front of it. ⚠️ **No test could see it**: a fake bridge rejects with a
   * plain `Error`, so the wrapper only exists in the shipped app, which is `249 M20`'s finding on
   * another surface arriving here by a different road.
   *
   * ⚑ `session-record.ts` owns the strip and two modules already call it — `CommandPalette.vue`
   * (`249 M20`) and `session-store.ts` in two places (`090`). This is another caller, not a second
   * copy; ⛔ **five renderer sites still do not go through it** and `423`'s response names them.
   */
  const sentence = (error: unknown): string => readableError(error)

  /**
   * ⚠️ **A named function rather than a method on the object below**, because `save` calls it: a
   * `this.load(...)` would break the moment a caller destructured the store, which is a shape a
   * composable invites.
   */
  const load = async (): Promise<void> => {
    try {
      identities.value = await bridge.agentIdentities()
      loadError.value = null
    } catch (error) {
      // ⛔ **The list is left ALONE on a failure, not cleared** (086, and 339's identical rule). A
      // read that could not be made has not learned that there are no identities.
      loadError.value = sentence(error)
    } finally {
      // ⚠️ In `finally`, so a failed read still counts as ASKED — otherwise a surface waiting on
      // `loaded` waits for ever on the one path where something has gone wrong.
      loaded.value = true
    }
  }

  return {
    identities,
    loaded,
    loadError,
    load,

    async save(profileId, grant, externalMcpServerIds) {
      try {
        // ⛔ **The array is rebuilt HERE rather than forwarded** (363's two questions). The caller is
        // a Vue component and the ids come off a `reactive`, so handing its array to the preload
        // would put a `Proxy` on the wire — `355`'s defect, which a handed-over field re-opens.
        // ⚑ A fresh array of strings is a thing `structuredClone` can carry.
        const saved = await bridge.setCapabilities({
          profileId,
          grant,
          externalMcpServerIds: [...externalMcpServerIds],
        })
        // ⚠️ **Null is criterion 12 and it is not an error to be swallowed.** The store refuses to
        // CREATE a row, so a null means the identity this sheet is about has stopped existing —
        // which a person has to be told, in those words.
        if (saved === null) {
          return `There is no agent identity called ${profileId}, so there is nothing to configure. Create it ${WHERE_AGENTS_ARE_CREATED}, or one appears once a conversation has run as it.`
        }
        // ⛔ **Patched FIRST, then re-read** (review). The write succeeded, so the row this store
        // holds is now wrong until something replaces it — and a re-read that fails would have left
        // the rail drawing the pre-save grant under a save that reported success. The patch is what
        // the database just said; the re-read is for everything else the list carries (the switch,
        // the other identities, a name that may itself have changed).
        const held = identities.value
        if (held !== null) {
          identities.value = {
            ...held,
            identities: held.identities.map((one) => (one.slug === saved.slug ? saved : one)),
          }
        }
        await load()
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async chooseProviderFor(profileId, provider) {
      try {
        const saved = await bridge.setAgentProvider({ profileId, provider })
        // ⚠️ **Null is criterion 12**, and it is `save`'s sentence one door over — the store refuses
        // to CREATE a row, so a null means the identity this sheet is about has stopped existing.
        if (saved === null) {
          return {
            ok: false,
            reason: `There is no agent identity called ${profileId}, so there is nothing to configure. Create it ${WHERE_AGENTS_ARE_CREATED}, or one appears once a conversation has run as it.`,
          }
        }
        // ⛔ **Patched first, then re-read** — {@link AgentStore.save}'s shape and for its reason: the
        // write landed, so the row this store holds is wrong until something replaces it, and a
        // re-read that failed would leave the sheet drawing the old provider under a success.
        const held = identities.value
        if (held !== null) {
          identities.value = {
            ...held,
            identities: held.identities.map((one) => (one.slug === saved.slug ? saved : one)),
          }
        }
        await load()
        // 🔴 **`696` · the door's own field** — what THIS write cleared, and not a re-read of the
        // choice, which another window could have moved since.
        return { ok: true, cleared: saved.modelChoiceCleared }
      } catch (error) {
        return { ok: false, reason: sentence(error) }
      }
    },

    async renameTo(profileId, displayName) {
      try {
        const saved = await bridge.setAgentDisplayName({ profileId, displayName })
        // ⚠️ **Null is criterion 12**, and it is `chooseProviderFor`'s sentence one method up: the
        // store refuses to CREATE a row, so a null means the identity this is about has stopped
        // existing.
        if (saved === null) {
          return `There is no agent identity called ${profileId}, so there is nothing to rename.`
        }
        // ⛔ **Patched first, then re-read** — `chooseProviderFor`'s shape and for its reason: the
        // write landed, so the row this store holds is wrong until something replaces it, and a
        // re-read that failed would leave every surface drawing the old name under a success.
        // ⚑ **The row and not the order**: `ORDER BY slug` does not move when a display name does,
        // which is what makes patching in place honest here and dishonest for a creation.
        const held = identities.value
        if (held !== null) {
          identities.value = {
            ...held,
            identities: held.identities.map((one) => (one.slug === saved.slug ? saved : one)),
          }
        }
        await load()
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async instructionsFor(profileId) {
      try {
        return await bridge.agentInstructions({ profileId })
      } catch {
        // ⛔ **`null` and not a throw**, which is `session-store.ts`' own shape for a read: a sheet
        // that cannot read a history draws *this app could not answer* rather than breaking the
        // surface the person opened it from. ⚠️ The sentence is not carried because there is
        // nothing a person can do with it here that re-opening does not do better.
        return null
      }
    },

    async instruct(profileId, text, broughtBack) {
      try {
        const saved = await bridge.instructAgent({ profileId, text, broughtBack })
        // ⚠️ **Null is criterion 12**, and it is `renameTo`'s sentence one method down: the store
        // refuses to CREATE a row, so a null means the identity this is about has stopped existing.
        if (saved === null) {
          return `There is no agent identity called ${profileId}, so nothing was saved.`
        }
        // ⛔ **No patch of `identities` here, which is where this parts company with `renameTo`.**
        // ⚑ Rules are not on {@link AgentIdentity} — they are their own read — so there is nothing
        // in this store's state that the write has made wrong, and a `load()` would re-fetch every
        // identity to change nothing.
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async decideInstruction(askId, approve) {
      try {
        const ack = await bridge.decideInstruction({ askId, approve })
        // ⛔ **The refusal is DATA on this door**, so the sentence is the main process's own words
        // and is not composed here — `485`'s rule, and the same shape `remove` takes below.
        return ack.outcome === 'taken' ? null : ack.reason
      } catch (error) {
        return sentence(error)
      }
    },

    async decideMcpServerRequest(requestId, approve) {
      try {
        return await bridge.decideMcpServerRequest({ requestId, approve })
      } catch (error) {
        return { outcome: 'refused', reason: sentence(error), stillOpen: true }
      }
    },

    async modelChoiceFor(profileId) {
      try {
        return { held: await bridge.agentModelAndEffort({ profileId }) }
      } catch {
        return null
      }
    },

    async chooseModelFor(profileId, choice) {
      try {
        // ⛔ **Four primitives, built HERE** (363's two questions): the caller's draft comes off
        // `ref`s, and a clear is the three `null`s the door reads as one.
        const saved = await bridge.setAgentModelAndEffort({
          profileId,
          provider: choice?.provider ?? null,
          model: choice?.model ?? null,
          effort: choice?.effort ?? null,
        })
        return saved.ok ? { ok: true, held: saved.choice } : { ok: false, reason: saved.reason }
      } catch (error) {
        return { ok: false, reason: sentence(error) }
      }
    },

    async remove(profileId) {
      // 🔴 **712 · R41 (`707` GAP-5) — the agent NAMED, and named BEFORE the removal.** ⛔ Both
      // sentences below printed the slug. ⚠️ Read now: after the re-read the row is gone, and after a
      // re-read that failed the roster is the stale one anyway. ⚑ The *no such agent* sentence keeps
      // the slug — there is no row to name, and the slug is what was asked for.
      const called = agentName(profileId, identities.value?.identities ?? null)
      try {
        const went = await bridge.removeAgent({ profileId })
        if (!went.ok) {
          // ⛔ **`HOLDING_SAYS` and never a sentence typed here** (485's rule): the words a roster
          // draws to disable a control and the words this refusal carries are one table, so they
          // cannot come apart the day a fifth reason is added.
          if (went.rail === 'no-such-agent') {
            return `There is no agent identity called ${profileId}, so there is nothing to remove.`
          }
          return `${called} cannot be removed yet: ${went.held
            .map((why) => HOLDING_SAYS[why])
            .join('; ')}.`
        }
        // ⛔ **Re-read, never patched** — `create`'s rule read backwards. A removal takes a row out
        // of a list the database orders, so a store that spliced one row would make itself a
        // second authority on that list.
        //
        // 🔴 **And the re-read's failure is SAID rather than handed back raw** (found in review).
        // ⛔ `load` swallows its own error by design (086), so `return loadError.value` would hand
        // a caller a sentence indistinguishable from the two refusals above it — and the row is
        // GONE. ⚠️ A person would be told the removal failed, press again, and be told there is no
        // such agent. ⚑ Every sibling that re-reads composes this sentence; this is the same one.
        await load()
        if (loadError.value !== null) {
          return `${called} was removed, but this window could not re-read the list: ${loadError.value}`
        }
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async create(said) {
      try {
        // ⛔ **The literal is rebuilt HERE rather than forwarded** (363's two questions, and
        // `the-bridge-that-clones-nothing`'s whole subject). The caller is a Vue component and its
        // three fields come off `ref`s; handing the object it assembled to the preload would put a
        // value this store did not build on the wire, and the three named fields are exactly what
        // makes the preload's own `{ kind, ...input }` `plain-by-construction`.
        const created = await bridge.createAgent({
          slug: said.slug,
          displayName: said.displayName,
          provider: said.provider,
          ...(said.asAService === true ? { asAService: true as const } : {}),
        })
        // ⛔ **Re-read, never pushed — and NOT patched-then-re-read like `save` above.** That
        // one patches because it knows which row changed and holds the row the database just
        // returned; this one is an INSERT into a list the database orders (`ORDER BY slug`), so
        // appending the answer would make this store a second authority on where the row goes.
        // ⚠️ **Awaited AND its outcome read**, so a sheet that closes on success closes over a
        // roster that already has the identity in it — the rail, the capability sheet and the
        // front door's provider all read this one ref.
        //
        // ⛔ **`load` swallows its own failure by design** (086's rule two methods up: a read that
        // could not be made has not learned there are no identities), so `await load()` alone
        // would have reported success over a list that is now stale — the row written, the rail
        // unchanged, the sheet closed and nothing said. ⚑ `save` avoids this by patching the row
        // it already holds first; a creation has nowhere to patch, because the order is the
        // database's. So the re-read's own error is the answer.
        await load()
        if (loadError.value !== null) {
          // ⚑ **712 · R41 — the new agent NAMED, off the row main wrote**: a blank name box is not
          // a nameless agent — main gives it a name from the pool (`nameForANewIdentity`) — so the
          // name is the answer's, never the box's, and the slug only where main stored none.
          return `${agentName(created.slug, [created])} was created, but this window could not re-read the list: ${loadError.value}`
        }
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async registerExternalMcp(said) {
      try {
        // ⛔ **The literal is rebuilt here rather than forwarded** — {@link AgentStore.create}'s rule
        // one method down, for its reason: the caller is a Vue component and its two fields come off
        // `ref`s.
        await bridge.registerExternalMcpServer({
          name: said.name,
          url: said.url,
          reach: said.reach,
        })
        // ⛔ **Re-read, never pushed** — `create`'s shape, and for its reason: the registry is
        // ordered by the DATABASE (`ORDER BY registered_at, name`), so appending the answer would
        // make this store a second authority on where the row goes. ⚠️ **And `load` swallows its own
        // failure by design**, so its outcome is read rather than assumed: a registration reported
        // as successful over a list that did not refresh is a row written, a rail unchanged and
        // nothing said.
        await load()
        if (loadError.value !== null) {
          return `${said.name} was registered, but this window could not re-read the list: ${loadError.value}`
        }
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async removeExternalMcp(serverId) {
      try {
        await bridge.removeExternalMcpServer({ serverId })
        // ⚠️ **`false` — *it was already gone* — is NOT reported as a refusal.** A person pressing
        // Remove on a row another window has already removed has asked for a state that already
        // holds, and the re-read below is what makes the list say so.
        await load()
        if (loadError.value !== null) {
          return `The server was removed, but this window could not re-read the list: ${loadError.value}`
        }
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async setServices(on) {
      try {
        const now = await bridge.setServicesOn({ on })
        // What the services list now says, read back, not what was asked for.
        const held = identities.value
        if (held !== null) identities.value = withServices(held, now.servicesOn)
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async setSpawning(enabled) {
      try {
        const now = await bridge.setSpawningEnabled({ enabled })
        // ⛔ **What the DATABASE now says, not what was asked for.** `spawnPolicy` answers `false`
        // for a store that cannot read the row — *"a kill switch whose broken state is on is not a
        // kill switch"* — so echoing the request would draw a switch that is on and is not.
        const held = identities.value
        if (held !== null) identities.value = { ...held, spawningEnabled: now.spawningEnabled }
        return null
      } catch (error) {
        return sentence(error)
      }
    },

    async setApprovalDefault(mode) {
      try {
        const now = await bridge.setDefaultApprovalMode({ mode })
        // ⛔ **What the DATABASE now says**, for the reason the method above gives and one that is
        // sharper here: `defaultApprovalMode` answers `'ask'` for a row it could not write, so
        // echoing the request would leave a control reading *yolo* over a database that will hand
        // the next launch an `ask`. ⚠️ The direction of the lie is the dangerous one.
        const held = identities.value
        if (held !== null) {
          identities.value = { ...held, defaultApprovalMode: now.defaultApprovalMode }
        }
        return null
      } catch (error) {
        return sentence(error)
      }
    },
  }
}
