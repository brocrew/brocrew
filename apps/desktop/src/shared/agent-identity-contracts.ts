import type { Provider } from '@brobot2/shared'
import type { CapabilityOrigins, ProfileCapabilities } from './capabilities'

/**
 * 🔴 **Who brought one identity into being** (598, `HO-084` §1) — one of {@link IDENTITY_ORIGINS},
 * with the creator's folded slug on the one arm that has one.
 *
 * ⛔ **A discriminated union and not a pair**, because `agent` is meaningless on two of the three
 * arms: a *creator* beside `this-app` would be a field every reader has to remember is empty, and
 * `a-value-beside-a-word-or-a-union-of-arms` names that as the case a union answers.
 *
 * ⚠️ **It is DERIVED from one column.** `agent_identity.created_by` holds `a-person`, `this-app`,
 * or the creating identity's `aid:<slug>` row id — see `readIdentityCreator` in `db/identity.ts`,
 * which is the one place the encoding is known, and `db/identity.ts`'s own note for why `:` cannot
 * appear in a slug and therefore why the three shapes cannot collide.
 */
export type IdentityCreator =
  | { readonly by: 'a-person' }
  | { readonly by: 'this-app' }
  | { readonly by: 'an-agent'; readonly agent: string }

/**
 * 🔴 **One agent identity, as a person can see it** (355) — the row, and what it may do.
 *
 * ⛔ **A ROW, not a directory.** `RuntimeCommand`'s `profiles` verb lists folders under
 * `provider-homes/`, and a folder exists for anything that was ever launched — including a launch
 * refused before it registered. An identity EXISTS when the database says so, and that is the same
 * fact `give_work`'s `no-such-profile` rail refuses on. A surface built off folders would offer
 * grants the door answers `false` to.
 *
 * ⚠️ **This said *“which is after a conversation has actually run as it”* until 558, and `419`
 * had falsified it.** ⛔ `createAgentIdentity` writes a row and NOTHING ELSE — no home and no
 * conversation — so an identity that has never run is an ordinary member of this list, and the
 * sentence was describing the world before the creation door existed. 🔴 **It is the population
 * `HO-063` gap 1 is about**, which is why the correction is here rather than filed: a reader who
 * believed that sentence would have concluded the roster could not have the rows it is asked for.
 * ⚑ What each identity has actually done is {@link AgentIdentities.use}.
 *
 * ⚑ **Two readings of the same columns, and both are needed.** `capabilities` is RESOLVED —
 * exactly what the rails read, with nulls already replaced by the ruled defaults. `chosen` says
 * whether each column is NULL or holds something, which is the only way a sheet can tell *nobody
 * has chosen* from *somebody chose today's default* — and the only way its first Save can avoid
 * writing the second over the first.
 */
export interface AgentIdentity {
  /**
   * `aid:<folded slug>` — derived, and shown because it is the thing the rails key on.
   *
   * ⚠️ **It was `agp:<project>:<slug>` until 369.** The producer now selects from the global
   * `agent_identity` table, so a surface that parsed a project out of this string would be reading a
   * segment that is no longer there — nothing does, and this line is what says so.
   */
  readonly id: string
  /** The folded name. The identity's name, not a directory name (238). */
  readonly slug: string
  /**
   * A human name, or null — nobody has named this identity.
   *
   * ⚠️ **It said *"shape only — nothing writes it yet (204 §3)"* until `423`**, and that stopped
   * being true twice: `419` gave it two writers (`create_agent` and `createAgent`) and `423` put a
   * person behind the second one, with the control carrying {@link AGENT_DISPLAY_NAME_CHARS}
   * (221 §3).
   *
   * 🔴 **538 · there is a THIRD writer now and it is this app itself**, and **584 · it writes a
   * GENERATED name rather than a table's** — see `human-names.ts`. ⛔ Every identity this app brings
   * into being is handed a first name, drawn at random, that nothing in the roster already answers to,
   * without anybody being asked what to call it (`HO-078` §5: *"The app assigns. No decision, no
   * round trip."*). ⚠️ **An agent no longer supplies one at all** — `create_agent` advertises no
   * such field — **and a person still may**, at `NewAgent`, where a typed name beats the generator.
   *
   * ⛔ **Nothing draws `displayName ?? slug`**, and the line that said the rail did has been wrong
   * since `449`: every surface that names an identity asks {@link agentName}, which is
   * {@link profileLabel} PLUS this field — so the fallback is written once, there, and
   * `a-row-that-says-who-is-in-it.test.ts` §3 greps this file's own neighbours to keep it that way.
   *
   * 🔴 **558 · there IS a rename now, and it is a person's** — `setAgentDisplayName`, the second
   * statement that writes this column and the first that can correct one (`HO-063` gap 2).
   *
   * ⚠️ **This read *“There is no RENAME”* until 558**, and the sentence carried an argument: a
   * name written once was the name for the life of the install, which is why `538`'s seed refused a
   * name DERIVED FROM A SLUG rather than merely declining one. ⛔ **That argument is spent, and the
   * refusal it justified is NOT thereby reversed** — what a person is called by is still not a word
   * this app may invent from a path segment; it is only no longer permanent if it does. ⚑ **584's
   * generator obeys that refusal and is not an exception to it**: it reads no slug, no role and no
   * project, so the handle it hands out says nothing about what the agent IS.
   *
   * ⛔ **`HO-016` §2 is what keeps the two writers apart.** The app's are both `INSERT OR IGNORE`
   * and cannot touch a row that exists; the rename is reached only from the window wire, behind
   * `requireAPerson`. ⚑ So a seed can never land on top of a name a person chose.
   */
  readonly displayName: string | null
  readonly createdAt: number
  /**
   * 🔴 **Who brought this identity into being — or null, nobody recorded it** (598, `HO-084` §1).
   *
   * ⛔ **Written ONCE, at the `INSERT` that mints the row, and by nothing afterwards.** That is
   * `INSERT OR IGNORE`'s own guarantee one column over — see {@link AgentIdentity.displayName} for
   * why a seed can never land on a row that exists — and it is what makes this a fact about the
   * row's birth rather than a field a later writer could re-aim.
   *
   * ⚠️ **NULL is *nobody recorded it*** — every row written before `0041` carries it, and nothing
   * can mint another.
   *
   * ⛔ **It is not a capability and it is on this record rather than inside
   * {@link AgentIdentity.capabilities}**, for {@link AgentIdentity.provider}'s reason: every member
   * of `ProfileCapabilities` is a GRANT a rail reads to refuse an act, and this refuses nothing — it
   * is a fact about the row's birth.
   */
  readonly createdBy: IdentityCreator | null
  /** What the rails see. */
  readonly capabilities: ProfileCapabilities
  /** Per capability, whether this row has chosen. */
  readonly chosen: CapabilityOrigins
  /**
   * 🔴 **Which provider this identity's NEXT conversation runs on, or null — nobody has said** (419,
   * HO-023 §3).
   *
   * ⛔ **Not a capability, and it is on this record rather than inside
   * {@link AgentIdentity.capabilities} for that reason.** Every field in there is a GRANT — something
   * a rail reads to refuse an act — and this refuses nothing: it is a default the resolution order
   * consults when a caller named no provider. ⚠️ Folding it into the capability schema would have
   * put a non-grant in front of `CAPABILITY_FIELDS`' `satisfies`, and would have made a rail-shaped
   * reader of a preference.
   *
   * ⚑ **Null is *nobody has said* and is not `codex`.** The renderer's `DEFAULT_PROVIDER` is the
   * fallback for an identity that has not said; an identity that HAS said is a different fact, and a
   * surface that drew them the same way would be making a claim nobody made.
   */
  readonly provider: Provider | null
  /**
   * 🔴 **Which registered external MCP servers this identity was GRANTED** (516, HO-040 §4.2) — ids
   * into {@link AgentIdentities.externalMcpServers}.
   *
   * ⛔ **Granted, and since 524 that is no longer the same question as *may reach*.** `HO-048` §1
   * moved the default onto the server: a row whose `reach` is `'everyone'` is usable by every
   * identity and appears in NONE of these lists. ⚠️ **So a surface that drew this set as *what this
   * identity may use* would now under-report it** — `CapabilitiesSheet` draws the registry and
   * reads this only to decide which rows carry a tick-box.
   *
   * ⛔ **Not a capability, and it is on this record rather than inside
   * {@link AgentIdentity.capabilities} for {@link AgentIdentity.provider}'s reason plus one of its
   * own.** `507` §5: server ids *"are a related capability grant with a different relational
   * shape"* — every member of `ProfileCapabilities` is one column on one row, and this is a set of
   * rows in another table. ⚑ Putting it in front of `CAPABILITY_FIELDS`' `satisfies` would have made
   * `parseChoice`, the sheet's editor switch and the wire's `capabilityValueSchema` each grow an arm
   * for a shape none of them has.
   *
   * ⛔ **Presence IS the grant** (`HO-042` §6): a slug appears here or it does not, and there is no
   * *nobody has chosen* state — which is why this has no companion in {@link AgentIdentity.chosen}.
   *
   * ⚠️ **Empty is the normal answer** and stays so until a person registers a server and ticks a box.
   */
  readonly externalMcpServerIds: readonly string[]
}
