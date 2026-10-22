/**
 * 🔴 **The capability schema, in ONE place, as data** (355 §2, HO-008 §3).
 *
 * ## ⛔ Why this file exists, and why it is not a list of fields in a `.vue`
 *
 * HO-008 §3 made the enumeration the reason `P0b` could run beside `P1`–`P3`: *"Build it to
 * enumerate the capability schema rather than hardcode a field list. Then `can_interrupt` appears
 * when P3 lands **without a second pass**."* ⚑ A hardcoded list in the surface would make the next
 * dispatch a rework of this one, which is the definition of the wrong shape. ⚠️ `can_interrupt`
 * did arrive that way (374), and D-014 took it out again with `can_spawn`, `max_concurrent`,
 * `can_create_projects` and `can_staff`; D-016's schema dropped their columns.
 *
 * 🔴 **Before this file the schema lived in five places** and `341` is the dispatch that put them
 * there, each for a reason that was right on its own: the drizzle columns in `db/schema.ts`, the
 * resolved {@link ProfileCapabilities} shape, the ruled {@link DEFAULT_CAPABILITIES}, the
 * {@link CapabilityEdit} a writer may send, and four hand-written fold functions with the two
 * columns lists of the prepared SQL beside them. **Adding a fifth capability meant finding all of
 * them.** This file is the one place, and what remains outside it is named at the bottom.
 *
 * ## ⚑ What the enumeration is enforced BY, which is not a test
 *
 * {@link CAPABILITY_FIELDS} is checked against {@link ProfileCapabilities} **by the type checker**:
 *
 *  - `satisfies readonly AnyCapabilityField[]` makes each entry's `ruled` and `narrowest` have to be
 *    the type that field actually holds — a `maxDepth` whose default is `'6'` does not compile;
 *  - {@link KEYS_AGREE} is an assignment that only type-checks when the field list's keys are
 *    EXACTLY `keyof ProfileCapabilities`, in both directions.
 *
 * ⛔ **So a capability added to the interface and not to the list is a compile error, and one added
 * to the list and not to the interface is the same error.** A test could only have said so after
 * somebody ran it; this says so in the editor, and `pnpm run typecheck` is step 1 of `ci`.
 *
 * ## ⚠️ What this file deliberately does NOT own
 *
 * **The column has to exist**, and two things about that cannot be data here:
 *
 *  1. **the migration** that adds it — a file, with a number, that runs once; and
 *  2. **the drizzle declaration** in `db/schema.ts`, because drizzle's table is declarative and its
 *     types are derived from the literal properties.
 *
 * ⚑ Everything downstream of those two IS derived: the SELECT and the UPDATE (see
 * {@link CAPABILITY_COLUMNS}), the reader, the writer, the wire, the IPC schema, the sheet's
 * controls, and this dispatch's own tests.
 *
 * ⚠️ **What a fold costs, corrected by 374 because the sentence here was not quite true.** It said
 * *"a fold is needed only for a KIND that is new — a fifth field whose editor is one of the four
 * below needs none"*, and for `choice` as `341` implemented it that was false: `parseCanMessage`
 * spelled its three words in its own body, so a second `choice` field needed a second fold. ⛔ **374
 * made it true for one case and named the other**: `parseChoice` reads {@link
 * CapabilityField.vocabulary} off the descriptor, so a field whose value TYPE is one this app
 * already folds costs nothing — and a `choice` with a different value type is a compile error at
 * `parseChoice`'s return, which is the honest price rather than a claim that everything is free.
 */

/** Standing-rule authority is fixed; legacy grant values remain only for stored data. */
export const RULE_WRITING_POLICY =
  "You can read any agent's standing rules and propose a replacement; the person decides. A BroBot conversation the person started may also save one directly, but never its own. Each version keeps its author and reason, and the person can undo it."

/**
 * 🔴 **What one agent identity is allowed to do** (341 §1A, HO-005) — the capability schema,
 * RESOLVED: every field has a value, and a null column has been replaced by the ruled default.
 *
 * ⛔ **Resolved in the store rather than at each rail, because a default read in two places is two
 * defaults.** `SessionStore.capabilitiesOf` is the only reader of the nullable columns, and every
 * caller above it sees numbers and words. A rail that had to remember *"null means 6"* would be one
 * forgetting away from a widening nobody wrote.
 *
 * ⚑ **One default set, the same for every agent** (D-014). No code seeds a column for any identity,
 * so a new row is NULL throughout and follows {@link CapabilityField.ruled}; a value a person writes
 * is that identity's own override, and a person is the only writer.
 *
 * ⚠️ **It moved here from `main/db/session-store.ts` at 355** so a renderer may name it.
 */
export interface ProfileCapabilities {
  /**
   * The deepest a piece this identity gives may sit — work a person gave is depth 0: a
   * conversation's own work, its root, and a piece it took on for them (D-016 · commit 6).
   */
  readonly maxDepth: number
  /**
   * 🔴 **Which conversations this identity may SEND to, and so SEE** (374, HO-007 §2.1 P3).
   *
   * ⛔ At `none` a caller reaches nothing; `'any'` also admits a conversation its holder did not
   * start — see `message-rails.ts`'s `reachesWhatItDidNotStart`. ⚑ **A caller may SEE exactly what
   * it may SEND to** (`433`): `list_agents` and `get_agent_status` read this word too.
   *
   * ⚠️ **It does not decide giving work** — {@link canAssignWork} does — and interrupting reads no
   * grant at all: it reaches the conversations below the caller in the chain that created them.
   */
  readonly canMessage: MessagingReach
  /**
   * 🔴 **Whether this identity may give WORK** (553, HO-060 §2; `give_work` since D-016).
   *
   * > ⚑ **Anyone may ask anyone. Giving work is its own grant.**
   *
   * ⛔ **Its own gate and not {@link canMessage} read twice**: a give hands a piece of work over,
   * where a note or a follow-up consumes nothing. `give_work` asks it of the caller alone, before
   * its lookup, and the work goes to the giver's one conversation with that agent —
   * {@link ASSIGNMENT_REACH_ADMITS} says what each word admits, and `none` refuses every give.
   * ⚠️ A note, a follow-up and a question never reach this field.
   */
  readonly canAssignWork: MessagingReach
  /**
   * 🔴 **Whether this identity may bring ANOTHER identity into existence** (419, HO-020 §4).
   *
   * ⛔ **Creating is not starting**: any agent may start a conversation as any identity that
   * exists, and this decides only whether it may mint a new one — the name, and the standing rules
   * that new agent starts with. ⚑ A person may set it to `none` for one identity, and that
   * identity is then refused `create_agent` and the standing-agent proposal.
   *
   * ⛔ **A person is not gated by it at all.** HO-005: *"the human is unrestricted"*, and the verb a
   * window presses reaches `RuntimeHost.createAgent`, which reads no capability.
   */
  readonly canCreateAgents: CreationReach
  /**
   * 🔴 **Whether this identity may reach into ANOTHER identity's own instructions** (582,
   * `HO-009` §2.2) — see {@link RULE_WRITING} for the ladder and for why it is not a reach.
   *
   * ⛔ **Its own column, and deliberately not another grant read twice**: none of the others is
   * about what an agent is TOLD, and deriving a security answer from a column somebody set for a
   * different reason is how a widening reaches a door nobody widened it for.
   *
   * ## 🔴 The wide value is the widest thing an agent can hold in this app
   *
   * `relay` can write durable standing rules without approval based on an agent's claim that the person supplied them. This grant is intended for BroBot's relay of the person's rules; a wrong attribution changes future launches, so its provenance must remain explicit.
   *
   * ⚑ **This app's answer to the second half is the LAYER's shape rather than this grant's**: every
   * version is kept, attributed and revertable, so a relay a person did not mean is visible and
   * undoable. ⛔ The grant is what makes it rare; the append-only history is what makes it
   * recoverable.
   *
   * ⚠️ **And a person is not gated by it at all**, which is every grant on this record: the window
   * verb reaches `RuntimeHost.instructAgent` behind `requireAPerson` and reads no capability.
   */
  readonly canWriteRules: RuleWriting
}

/**
 * ⛔ **How far a messaging capability reaches, as a closed vocabulary** (374).
 *
 * ⚑ **`any` is every agent's ruled default** (HO-058 §1), and `'none'` is what makes a capability a
 * capability rather than a description. ⚠️ **The human is not a value here** — a person is not an
 * identity and never reaches these gates; see `message-rails.ts`.
 *
 * ⚠️ **D-016 · `same-project` went with projects.** A row that still holds it is a word outside
 * this vocabulary, and `parseChoice` folds it to the narrowest value, never to the default.
 *
 * ⚠️ **Shared by {@link ProfileCapabilities.canMessage} and {@link
 * ProfileCapabilities.canAssignWork}, and derived by neither.** They are separate columns, grants
 * and gates that happen to answer the same shape of question. A reader who takes one for the other
 * gets a compile error at neither; the test that stops it is a behaviour test, not this type.
 */
export const MESSAGING_REACH = ['none', 'any'] as const

/** One of {@link MESSAGING_REACH}. */
export type MessagingReach = (typeof MESSAGING_REACH)[number]

/**
 * 🔴 **What `list_profiles` counts, as a sentence a model may relay** (488; D-014).
 *
 * ⛔ **Any agent this app holds can be named to `give_work`**, so the listing is folded through
 * nothing and its count is the roster's. ⚑ It is said beside the number anyway (`448`): a count
 * that cannot say what it counted is read as a claim about something else. ⚠️ **It states the
 * roster, never the caller's grant**: a person can narrow `can_assign_work` to `none`, and a
 * sentence saying *you may* would then be false about the one reading it.
 */
export const EVERY_AGENT_THIS_APP_HOLDS =
  'This counts every agent this app holds; any of them can be named to give_work.'

/**
 * 🔴 **What `can_message` admits, said once, for every surface that publishes the word**
 * (449, corrected at 493).
 *
 * ⛔ **A model once read the bare vocabulary token as a rule and got the rule wrong**, so every
 * surface that publishes the grant — the sheet's help and the line `factory-text.ts` renders —
 * says what the word ADMITS, from this one table.
 *
 * ⚠️ **Verb-free, deliberately.** It names the SET and never the act: the field's own `label`
 * supplies the verb, so what the model is told a grant is called and what the person setting it
 * reads are one string.
 */
export const MESSAGING_REACH_ADMITS: Readonly<Record<MessagingReach, string>> = {
  // ⚑ **Not even its own children**: `admitReachAtAll` refuses `none` before it asks anything else.
  none: 'nothing at all — not even a conversation it started itself',
  any: 'any conversation, whoever started it',
}

/**
 * 🔴 **What `can_assign_work` admits — its own table over the same words** (553, HO-060 §2).
 *
 * > ⚑ **The ruling:** *Anyone may ask anyone. Giving work is its own grant.*
 *
 * ⛔ **Not {@link MESSAGING_REACH_ADMITS} reused, because sharing a vocabulary is not sharing a
 * gate** (`493`): `can_message` at `any` admits a conversation its holder did not start, and this
 * field at `any` gives work only to its holder's own conversation with each agent (D-016) — the
 * relationship is `give_work`'s lookup, and it is never dropped. ⚑ `a-reach-you-can-see.test.ts`
 * §4 maps each field to its table by name.
 *
 * ⚠️ **`none` refuses giving work to a conversation this identity started ITSELF**, and that is the
 * person's act: the app never re-grants what a person removed, whatever the receiver is.
 */
export const ASSIGNMENT_REACH_ADMITS: Readonly<Record<MessagingReach, string>> = {
  none: 'nothing at all — not even a conversation it started itself',
  any: 'any agent — the work goes to a conversation it has with that agent, started for it when needed',
}

/**
 * ⛔ **The vocabulary, spelled out for a person, WALKED rather than enumerated** (449).
 *
 * ⚑ **Any word added to {@link MESSAGING_REACH} joins this sentence**, with
 * nobody editing a help string — which is the difference between a sentence that describes a
 * capability and one rendered from it (standing rule 8). ⛔ A help that enumerated the words in prose
 * is the shape `370` paid eight false sentences for, and it is the shape that was in this file.
 */
function reachSentence(admits: Readonly<Record<MessagingReach, string>>): string {
  return `${MESSAGING_REACH.map((word) => `${word}: ${admits[word]}`).join('; ')}.`
}

/**
 * ⛔ **How far a CREATION capability reaches, as a closed vocabulary** (419, HO-020 §4).
 *
 * ⚠️ **Its words are {@link MESSAGING_REACH}'s, spelled identically**, so
 * a person meets one grammar down the capability sheet and a model meets one across the refusals.
 * ⛔ **They are not the same TYPE**, and that is deliberate: `parseChoice` in `session-store.ts`
 * checks each column against its own field's vocabulary, and a shared type would let a word out of
 * one vocabulary pass as a word of the other.
 */
export const CREATION_REACH = ['none', 'any'] as const

/** One of {@link CREATION_REACH}. */
export type CreationReach = (typeof CREATION_REACH)[number]

/**
 * ⛔ **How far an identity may reach into ANOTHER identity's own instructions, as a closed
 * vocabulary** (582, `HO-009` §2.2).
 *
 * 🔴 **A LADDER and not a reach, which is why it is neither {@link CREATION_REACH} nor
 * {@link MESSAGING_REACH} reused.** The other vocabularies narrow WHICH conversations a verb may
 * touch; this one narrows what HAPPENS when it is used, and the two wide values differ in whether a
 * person is asked at all:
 *
 *  - ⚑ **`none`** — this identity may not put a rule in front of anybody. **The ruled default and
 *    the narrowest**: an identity nobody has spoken about must not be able to reach into what
 *    another agent is told.
 *  - ⚑ **`propose`** — it may ASK. A person approves, and approval is the only thing that writes.
 *  - 🔴 **`relay`** — it may write immediately, claiming a person gave it the rule. `HO-009` §2.2's
 *    one exception: *"provenance* relayed from user *IS the authorization."*
 *
 * ⛔ **`relay` is not *propose, but louder*. It is the gate removed**, and the only thing standing
 * between it and instruction drift is that the identity holding it was chosen by a person — which
 * is why it is a grant a person sets on one identity and never a default.
 *
 * ⚑ **The ladder is asked by name**, through {@link mayProposeRules} and {@link mayRelayRules},
 * rather than compared inline: one field answers two questions, and
 * `widening-a-predicate-widens-every-question-its-field-answers` is what happens when each call
 * site spells its own comparison.
 */
export const RULE_WRITING = ['none', 'propose', 'relay'] as const

/** One of {@link RULE_WRITING}. */
export type RuleWriting = (typeof RULE_WRITING)[number]

/**
 * ⛔ **May this identity put a rule in front of a person?** — `propose` or `relay`.
 *
 * ⚑ **An identity that may write directly may obviously also ask**, which is what makes this a
 * ladder; stating it as a named predicate is what stops a call site spelling `!== 'none'` and
 * meaning something narrower.
 */
export function mayProposeRules(held: RuleWriting): boolean {
  return held !== 'none'
}

/**
 * 🔴 **May this identity write one WITHOUT a person approving it?** — `relay` alone.
 *
 * ⛔ **The narrow question, asked narrowly.** {@link mayProposeRules} is true for two of the three
 * words and this is true for one; a door that asked the wide question and then wrote directly would
 * be `HO-009` §2.2's gate removed by a comparison.
 */
export function mayRelayRules(held: RuleWriting): boolean {
  return held === 'relay'
}

/** Every capability's name, DERIVED from the field list rather than written twice. */
export type CapabilityKey = (typeof CAPABILITY_FIELDS)[number]['key']

/**
 * **How a person edits this field**, which is also how much of the surface a new field gets free.
 *
 * ⛔ **Each existing kind is a control that already exists.** A capability of an
 * existing kind costs one entry in {@link CAPABILITY_FIELDS} and nothing else; one of a NEW kind
 * costs a fold in the store and an arm in the sheet, and that is the honest price rather than a
 * claim that everything is free.
 */
export type CapabilityEditor =
  /** One whole count. `maxDepth`. */
  | 'count'
  /** One word from a closed vocabulary. Every other field. */
  | 'choice'

/**
 * 🔴 **Where the conversation being launched SITS, for the grants whose value alone does not say
 * what they mean to it** (544, HO-054 §1.2).
 *
 * ⛔ **A grant sheet and a launch bundle are asking two different questions.** *What has this
 * identity been granted* is answered by the value — that is what a person edits. *What may THIS
 * conversation do* is answered by the value **and** where the conversation stands, and only the
 * second is an instruction. ⚠️ {@link CapabilityField.says} is handed `null` for the first and one
 * of these for the second, so one sentence-writer answers both rather than a surface authoring
 * words of its own — which is `464`'s defect and the reason `says` lives on the field at all.
 *
 * ## ⚠️ `depth` is the only member, and the reason is NOT that the sentence cannot go stale
 *
 * ⛔ **The first draft of this paragraph said it was, and that was wrong.** A conversation's depth
 * is fixed when it is created and no re-parent path exists — but the sentence is a function of the
 * placement **and the grant**, and a person may narrow `max_depth` mid-conversation. ⚑ **So the
 * launch rendering is exactly as old as every other line in that section**, which is `460` F3 and
 * is unclosed: see {@link CapabilityField.whenItTakesEffect}, whose own note says *a live model's
 * picture of every grant in this list is as old as its conversation*. ⛔ **This repair did not
 * close that and does not claim to.**
 *
 * ⚑ **What `depth` being immutable does buy** is that its consequence needs only the placement,
 * which is settled before the first turn.
 */
export interface ConversationAtLaunch {
  /**
   * **How deep this conversation sits in the chain that created it** — HO-005 §2 Q3: *a
   * conversation a person creates is depth 0; one another conversation started is its parent's
   * depth + 1*.
   *
   * ⛔ **The depth `admitGive` counts for the pieces it holds** (D-016): the rail counts on `work`,
   * and the two agree because only a conversation's parent gives it work, and work a person gave —
   * a root, or a piece taken on for them (commit 6) — counts as 0 wherever it hangs — see
   * `RuntimeHost.instructionContext`, which reads it, and
   * `what-a-chain-is-told-about-its-own-depth.test.ts`, which measures the agreement in both
   * directions rather than trusting a shared string.
   */
  readonly depth: number
}

/** One capability, described. `K` keeps `ruled`/`narrowest` honest about the field they belong to. */
export interface CapabilityField<K extends keyof ProfileCapabilities> {
  readonly key: K
  /**
   * The column on `agent_identity` — the table a GRANT lives on since `369`, and the only table
   * that carries these columns. ⚑ `schema.ts` builds each column's CHECK from this entry, so the
   * database and the wire read one vocabulary.
   */
  readonly column: string
  readonly editor: CapabilityEditor
  /** What the sheet calls it. */
  readonly label: string
  /** One sentence under the control, in a person's words. */
  readonly help: string
  /**
   * 🔴 **How this grant's VALUE is said — declared ON the grant it describes** (485, HO-031 §2.3).
   *
   * ## ⛔ It was a second table, in another file, keyed by a spelling
   *
   * ⚠️ **`factory-text.ts` held `CAPABILITY_VALUES`, a `Record<CapabilityKey, (allowed:
   * ProfileCapabilities) => string>`**, and every line a model reads about what it may do came out
   * of it. ⛔ That is the shape `464` cost this project — a sentence ABOUT a grant living where the
   * grant cannot see it — and `470` closed the same class for
   * {@link CapabilityField.whenItTakesEffect} by making the sentence a FIELD of the entry it
   * describes. ⚑ This is that move for the value, which is the half an agent actually reads.
   *
   * 🔴 **It is handed this field's OWN value and nothing else**, which is the part a `Record` could
   * not express: a sentence that cannot reach a neighbour cannot be attached to the wrong grant.
   *
   * ⚑ **Required, not optional.** HO-008 §3's promise is that a new capability costs one entry in
   * {@link CAPABILITY_FIELDS}; an optional property would hand that gate back, and a grant with no
   * sentence would print as a label, a colon and nothing.
   */
  readonly says: (held: ProfileCapabilities[K], at: ConversationAtLaunch | null) => string
  /**
   * ⛔ **The ruled default: what a row that has chosen NOTHING gets.** In code and never in a
   * column (341, and 0016's argument about `project.cwd`) — changing one here changes every profile
   * that has not chosen, which is the whole reason they are not backfilled.
   */
  readonly ruled: ProfileCapabilities[K]
  /**
   * 🔴 **What a value we cannot READ falls to — never {@link ruled}** (341).
   *
   * A corrupt list, a hand-edited number, a word from outside a vocabulary: every one of them means
   * *we cannot read what this row says*, and the only safe reading of that is *this identity may do
   * nothing*. ⛔ Falling back to the default would let a typo WIDEN a profile.
   */
  readonly narrowest: ProfileCapabilities[K]
  /**
   * For `choice`, every word it may hold. Absent for every other editor.
   *
   * 🔴 **Typed to the FIELD's own value type since 374, and that is what makes the fold sound.** It
   * was `readonly string[]`, so `satisfies readonly AnyCapabilityField[]` checked nothing about it:
   * an unsupported word added to `canMessage` here would have compiled, been accepted by
   * `capabilityValueSchema` (which builds its `z.enum` from this list), written to the column, and
   * come back out of `parseChoice` cast to a type it is not a member of. ⛔ **The one place a
   * vocabulary can be wrong is now a compile error rather than a runtime assertion.**
   *
   * ⚠️ **`never` for a field whose value is not a word**, which is stricter than *optional*: a
   * `vocabulary` on `maxDepth` does not compile at all. ⛔ It also keeps the union narrow, so
   * `AnyCapabilityField['vocabulary']` is still a list of STRINGS and the sheet's `v-for` over it
   * needs no cast — the tightening cost the renderer nothing, which is the only reason it is safe
   * to make in a dispatch that claims the surface did not change.
   */
  readonly vocabulary?: ProfileCapabilities[K] extends string
    ? readonly ProfileCapabilities[K][]
    : never
  /**
   * 🔴 **When a change to this grant reaches a conversation, or `null`** (470, HO-028 §3).
   *
   * ⛔ **`null` is the ordinary answer and it is a claim, not an omission**: every rail reads the
   * durable row on the call it refuses, so an edit to such a grant is answered by the next thing
   * that asks and there is nothing more to say. ⚠️ A field declaring a sentence here is declaring
   * that something about it was **settled when the conversation started** and is not read again
   * while it runs.
   *
   * 🔴 **`null` is about what the app ENFORCES and never about what the model KNOWS.** Every grant
   * is rendered into the instruction bundle at launch (`factory-text.ts`) and `setCapabilities`
   * enqueues nothing, so a live model's picture of EVERY GRANT IN THIS LIST is as old as its
   * conversation — `460` F3, unclosed, and not what this field answers. ⚠️ **A count used to stand
   * where that clause does** and it was right on the day it was written, which is `458`'s rule: a
   * number in prose outlives the derivation that justified it. ⛔ A `null` here says a rail will read the new
   * value the next time it is asked; it does not say anybody will think to ask.
   *
   * ## ⚑ Why it is a required field and not an optional one
   *
   * HO-008 §3's promise is that a new capability costs one entry in {@link CAPABILITY_FIELDS}.
   * ⛔ **A capability whose grant is consulted at launch is a capability whose disclosure is
   * load-bearing** — `460` F2 is the measurement — and an OPTIONAL property is one the next author
   * never has to think about. ⚑ Required, so adding a grant is answering the question.
   *
   * ⚑ **Declared inside the field it is about**, so it cannot come to point at a neighbour —
   * `a-grant-that-waits-for-the-next-launch.test.ts` §1 holds the other half: this sentence names no
   * field's label at all, so there is no literal in it to go stale.
   */
  readonly whenItTakesEffect: string | null
}

/** Any one field, with its own key's types — the element type {@link CAPABILITY_FIELDS} satisfies. */
export type AnyCapabilityField = {
  [K in keyof ProfileCapabilities]: CapabilityField<K>
}[keyof ProfileCapabilities]

/**
 * 🔴 **What `maxDepth` says to a conversation the rail is about to refuse** (544).
 *
 * ⛔ **The conclusion first and no number at all.** The two sentences below are the whole of what
 * this app can promise about depth without reading another identity's row: whether `give_work`'s
 * depth rail will refuse the next piece THIS conversation gives. ⚑ There is nothing here to count
 * and nothing to project one level down, which is the misreading they exist to make impossible.
 *
 * ## ⛔ Two words in the refusing arm were chosen against a state, not for their sound
 *
 * ⚠️ **`may not give work deeper than this`, rather than *is as deep as this identity may go*.** The
 * grant bounds how deep a piece this identity GIVES may sit — `admitGive` reads the GIVER's row —
 * and a conversation can hold work DEEPER than its own identity's bound, because the giver that
 * placed it was reading a different row. ⛔ A conversation at depth 3 whose identity holds `0` is
 * not *as deep as that identity may go*; it is three steps past it, and a wording that said so
 * would say something false about it.
 *
 * ⚠️ **`any piece you give from here`, and nothing about other doors.** ⛔ Every conversation keeps
 * its provider's own sub-agents, which no rail of ours touches, so a conversation at the bound can
 * still delegate that way. ⚑ **This sentence is about this app's door and must not read as a claim
 * about every door a model has.**
 *
 * ⚠️ **They are not the rail's own bytes, deliberately, and the alternative was considered.**
 * {@link describeRail}'s `too-deep` sentence is a refusal — it names the depth the attempt WOULD
 * have sat at — so it cannot speak in the arm where nothing is refused, and a bundle that carried
 * it would be announcing a refusal that has not happened. ⛔ **So the agreement is asserted rather
 * than spelled**: `what-a-chain-is-told-about-its-own-depth.test.ts` puts each arm beside the
 * rail's actual answer for the same conversation, in both directions, which is a stronger property
 * than two surfaces sharing a literal (`a-mutation-on-a-census-is-invisible-to-that-census`).
 */
const CHAIN_ENDS_HERE =
  'reached — this identity may not give work deeper than this, so this app will refuse any ' +
  'piece you give from here'

/** The other arm. ⛔ It promises nothing but the absence of THIS refusal — see {@link CHAIN_ENDS_HERE}. */
const CHAIN_MAY_GO_ON = 'not reached — work you give from here is not too deep'

/**
 * 🔴 **The schema. Adding a capability is adding an entry here.**
 *
 * ⚑ **One default set for every agent** (D-014): any agent may give work, ask anyone, create an
 * agent, and give work six deep below the work a person gave, so `maxDepth`, `canMessage`,
 * `canAssignWork` and `canCreateAgents` default wider than their narrowest value. `canWriteRules`
 * defaults to the narrowest, because the wide word removes a person from a loop rather than
 * granting a reach. ⚑ A table of `ruled` and `narrowest` side by side is what makes that visible
 * for every field at once.
 */
export const CAPABILITY_FIELDS = [
  {
    key: 'maxDepth',
    column: 'max_depth',
    editor: 'count',
    label: 'Deepest chain',
    help: 'Work a person gives sits at depth 0: each conversation’s own work (its root, W1), and anything it takes on for them (W1.2). A piece given under it is depth 1 (W1.1, W1.2.1). This is the deepest a piece this agent gives may sit.',
    /**
     * 🔴 **The COUNT as an answer about the grant, the CONSEQUENCE as an answer about a
     * conversation** (544, HO-054 §1.2).
     *
     * ⛔ **The bound is counted from the work a person gave, and a bare number does not tell the
     * reader where that is** (`HO-054` §1.1). ⚑ So a conversation is told what the rail will
     * do to the NEXT piece it gives, which is all this app can promise without reading another
     * identity's row: `admitGive` reads the GIVER's `max_depth` on the give it refuses, so this
     * grant bounds how deep a piece this identity gives may sit and says nothing about what that
     * piece's owner may give in turn.
     *
     * ⚠️ **It is not injective, and that is the measurement rather than a weakening**: at one
     * depth every grant above it says the same thing, because the rail answers the same thing
     * (`the-text-a-child-is-actually-told.test.ts` §10).
     */
    says: (held, at) =>
      at === null ? String(held) : at.depth >= held ? CHAIN_ENDS_HERE : CHAIN_MAY_GO_ON,
    // ⚑ **D-014 · six levels below the work a person gives** (plan §4.1; D-016 · R2; commit 6).
    ruled: 6,
    narrowest: 0,
    whenItTakesEffect: null,
  },
  {
    key: 'canMessage',
    column: 'can_message',
    editor: 'choice',
    label: 'May message',
    /**
     * 🔴 **The help text carries its SECOND consequence since 433.**
     *
     * ⛔ **This field decides what an identity may SEE as well as what it may SEND to.** `433` §B
     * put `list_agents` and `get_agent_status` on the same question — *a caller may SEE exactly
     * what it may SEND to* — so a person moving this control is deciding what that identity can
     * enumerate and inspect. ⚠️ **A person choosing a grant has to be told the whole of what they
     * are choosing**, which is the shape `370` paid eight false sentences for.
     *
     * ⚑ **The last sentence is WALKED from {@link MESSAGING_REACH_ADMITS}** (449), so any new word
     * joins this help with nobody editing it.
     */
    help:
      'Which conversations this identity may send a message to — and, because an agent can see ' +
      'exactly what it may write to, which ones it can list and ask about. ' +
      reachSentence(MESSAGING_REACH_ADMITS),
    /**
     * 🔴 **449 · the WORD was the whole line, and a model read it and got the rule wrong.**
     *
     * ⚑ **{@link MESSAGING_REACH_ADMITS} and not a sentence typed here**, because this field's own
     * `help` says the same thing from the same table — one string, two readers, for the reason the
     * label is one string.
     */
    says: (held) => MESSAGING_REACH_ADMITS[held],
    /**
     * 🔴 **`any`** (HO-058 §1): *a message consumes nothing, destroys nothing, and transfers no
     * authority.*
     *
     * ⛔ **This default also decides what an identity may be told about** — `list_agents`,
     * `get_agent_status`, and the holder state `list_tasks` and `withdraw_task` read. ⚠️ Giving WORK is
     * {@link ProfileCapabilities.canAssignWork}'s, and a NULL column follows this value: a person
     * who pressed *Use the default* follows it, and one who narrowed keeps their word.
     */
    ruled: 'any',
    narrowest: 'none',
    vocabulary: [...MESSAGING_REACH],
    whenItTakesEffect: null,
  },
  {
    key: 'canAssignWork',
    column: 'can_assign_work',
    editor: 'choice',
    /**
     * ⚑ **It says ALSO, because the grant above it is the one a reader meets first**, and a label
     * standing on its own — *May give work to* — would read as a second, unrelated verb.
     * `capabilityLines` renders the two adjacent because this entry sits beside `canMessage`.
     */
    label: 'May also give work to',
    /**
     * ⚠️ **What the CONTROL does, and nothing about how the system works** (standing rule 8).
     *
     * ⛔ **Both halves are here because a person is choosing both.** The first says what narrowing
     * this does NOT touch — a question still goes anywhere `May message` reaches — because a help
     * that named only the work half would let a reader believe setting this to `none` silences the
     * identity. ⚠️ That belief is the one HO-060 §2.1 exists to refuse: a worker asking another
     * agent how it handled this last time opens nothing.
     *
     * ⚑ **The vocabulary is WALKED from {@link ASSIGNMENT_REACH_ADMITS}**, so a fourth word joins
     * this sentence with nobody editing a string.
     */
    help: `Whether this identity may give pieces of work (give_work) to conversations it has with each agent — a question takes nothing and is decided by the grant above. ${reachSentence(ASSIGNMENT_REACH_ADMITS)}`,
    // 🔴 **553 · its own table**: `can_message` at `any` reaches what its holder did not start, and
    // this word at `any` gives work only to its holder's own conversation with each agent.
    says: (held) => ASSIGNMENT_REACH_ADMITS[held],
    /**
     * 🔴 **D-014 · `any`** (plan §4.2) — so a giver gives work to its own conversation with an
     * agent, started for it the first time (D-016).
     *
     * ⛔ **The relationship is never dropped** ({@link ASSIGNMENT_REACH_ADMITS}): work flows down
     * through the conversations a giver started, so nothing but a person gives work to a
     * conversation a person started. ⚠️ `narrowest` and `ruled` DIFFER here, so `parseChoice`'s
     * narrow-on-unreadable direction is observable on this column.
     */
    ruled: 'any',
    narrowest: 'none',
    vocabulary: [...MESSAGING_REACH],
    whenItTakesEffect: null,
  },
  {
    key: 'canCreateAgents',
    column: 'can_create_agents',
    editor: 'choice',
    label: 'May add new agents',
    /**
     * ⚠️ **What the CONTROL does, and nothing about what the system is** — standing rule 8: a
     * sentence naming which tools exist goes stale every time the toolset moves.
     *
     * ⚑ **The BOUND is in the sentence, because it is the part that makes this safe**: creation
     * carries the new agent's standing rules, so an identity holding this may put durable
     * instruction text into the app without holding *May write rules for other agents* — and that
     * write happens on the creating call and can never happen again (`HO-078` §1.1;
     * `identity_instruction_creator_is_first_ck` is where it stops being a promise).
     */
    help: 'Whether this identity may bring a new agent into existence — a name, and the standing rules that new agent starts with. It does not start that agent, and it grants that agent nothing. It can write those rules only as it creates the agent and never again: after that they are yours, to change, to put an earlier version back, or to take away.',
    // ⚑ **A word, said the way the reach fields are said** (419). ⚠️ **It names no tool**, which
    // is standing rule 8: the verb is in the toolset the model is handed; the grant is what this
    // line is about.
    says: (held) => held,
    /**
     * 🔴 **D-014 · `any` — every agent may create an agent** (plan §4.2).
     *
     * ⛔ **A creation can never take over an identity**: `agent-name-taken` refuses a name that
     * exists, and a new identity is minted with no grants of its own. ⚑ A person may set one
     * identity to `none`, and `narrowest` is `none`, so an unreadable word refuses.
     */
    ruled: 'any',
    narrowest: 'none',
    vocabulary: [...CREATION_REACH],
    whenItTakesEffect: null,
  },
  {
    key: 'canWriteRules',
    column: 'can_write_rules',
    editor: 'choice',
    label: 'May write rules for other agents',
    /**
     * ⚑ **It says what each of the three words DOES, because a person choosing the third is
     * removing their own approval from a durable write** — standing rule 8 at the surface where the
     * stakes are highest. ⛔ It names no tool: a sentence saying *"use propose_agent_rules"* would
     * be a claim about which verbs exist, and `370`'s eight false sentences were every one of them
     * that shape.
     */
    help: 'Whether this agent may change what another agent is told to do. With propose, it can put a rule in front of you and you decide — nothing is written until you approve it. With relay, it writes the rule straight away, saying you had already given it: this app does not check that claim, so give it only to an agent you speak to yourself. Every version is kept either way, and you can put an earlier one back.',
    // ⚑ **A word, said the way the other `choice` fields are said** (582). ⛔ The line a model
    // reads is about the GRANT and not about what happens next: what a proposal DOES is
    // `ENDING_MEANS`' table, one module over, and a sentence here restating it would be the second
    // spelling this file refuses everywhere else.
    says: (held) => held,
    /**
     * 🔴 **`ruled` is the NARROWEST.** ⛔ **A rule reaches every future launch of the identity it is
     * written for**, so an identity nobody has spoken about must not be able to put one anywhere.
     * ⚑ `ruled` and `narrowest` coincide, so the fold's DIRECTION is measured on the fields where
     * the two differ.
     */
    ruled: 'none',
    narrowest: 'none',
    vocabulary: [...RULE_WRITING],
    /**
     * 🔴 **The one field that owes this sentence** (582) — *a capability whose grant is read at
     * LAUNCH is one whose disclosure is load-bearing* (`460` F2).
     *
     * ⛔ **"What you may do" renders one of three sentences from this column at every launch**:
     * whether the agent may save a person's rule, propose one, or neither. ⚠️ So a conversation
     * already running was told one of those and goes on believing it.
     *
     * ⚑ **The second clause is this grant's own**, and it is here rather than in the help because
     * it is about a CHANGE rather than about what the control does: narrowing stops the next ask
     * and never unwrites a version, because a saved rule is text a person owns rather than a right
     * the agent holds. ⛔ `HO-016` §2 read the other way round — the app never re-grants what a
     * person removed, and it never removes what a person kept either.
     */
    whenItTakesEffect:
      'A conversation reads this when it starts, so one already running keeps what it was told. Narrowing it stops new requests and never removes rules that are already saved — take those away on the agent they were written for.',
  },
] as const satisfies readonly AnyCapabilityField[]

/**
 * ⛔ **The keys agree, in BOTH directions, checked by the compiler** — see this file's header.
 *
 * ⚠️ **`[A] extends [B]` and not `A extends B`**: a bare conditional over a union distributes, and a
 * distributed check answers *"is every member of A in B"* for each member separately, which is true
 * for a field list that has lost one. The tuples stop the distribution, so this is set equality.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const KEYS_AGREE: Exactly<CapabilityKey, keyof ProfileCapabilities> = true

/**
 * ⛔ **The ruled defaults, DERIVED** — one object built from the field list.
 *
 * ⚠️ **The cast is over the SHAPE of `Object.fromEntries` and not over the values.**
 * `fromEntries` types its result as `Record<string, …>` no matter how precise its input is; every
 * value in it has already been checked against `ProfileCapabilities[K]` by the `satisfies` above,
 * and {@link KEYS_AGREE} has already checked that the set of keys is complete. There is nothing
 * left for the cast to be wrong about.
 *
 * ⚠️ **Frozen**, so a caller cannot move what every unconfigured profile may do by mutating it in
 * place; `as const` says so only to the compiler.
 */
export const DEFAULT_CAPABILITIES = Object.freeze(
  Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, field.ruled])),
) as unknown as ProfileCapabilities

/**
 * ⛔ **What a caller may change about one profile's capabilities.**
 *
 * **Three states, and 339's ruling is why they are three rather than two** (*"an absent key and an
 * explicit null are the same value to a `Partial`, and they are not the same intent"*):
 *
 *  - **absent** — this caller does not know about the field. Leave the column alone.
 *  - **`null`** — *use the default*. Write NULL, so the row goes back to having chosen nothing and
 *    follows {@link CapabilityField.ruled} if it ever changes.
 *  - **a value** — this identity has chosen.
 *
 * ⚑ **The `null` arm is 355's and it is what makes the surface reversible.** Without it a person
 * could set a capability and never un-set it, and the first save from a sheet that showed every
 * field would freeze today's defaults into the row — the exact backfill `0017` refused to do.
 */
export type CapabilityEdit = {
  readonly [K in keyof ProfileCapabilities]?: ProfileCapabilities[K] | null
}

/**
 * ⚑ **Whether a row has CHOSEN this capability** — and it is a fact about the COLUMN, not about the
 * value (086's rule, one table over).
 *
 * ⛔ **A field whose column is NULL and a field somebody set to exactly the default draw the same
 * number**, and they are not the same thing: the first follows {@link CapabilityField.ruled} if it
 * ever changes and the second does not. A sheet that could not tell them apart would make its own
 * first save a decision nobody took.
 *
 * ## ⚠️ The third state this deliberately does NOT have, and why
 *
 * A column can hold something that is not the right shape; the store folds it to
 * {@link CapabilityField.narrowest} and the rails then behave correctly with nobody told. **This
 * type cannot report that**, because *"is this text readable"* is a question only the parsing folds in
 * `session-store.ts` answer, and answering it a second time here is two spellings of one rule —
 * which this repo has already paid for once (`memory-bound.ts` and `confinement.ts` disagreed about
 * one string and 256 KiB went to disk with no card).
 *
 * 🔴 **So the blind spot is named rather than papered over**: a row whose `can_message` was mangled
 * reads `chosen`, and the sheet shows the narrowest value it folded to. The surface says so in
 * words next to the field. Closing it properly means the folds reporting what they narrowed, which
 * is a change to those parsing functions whose exact bodies `341`'s mutation table measures — its
 * own dispatch, and it is written up in this one's response.
 */
export type CapabilityOrigin =
  /** The column is NULL. This row has chosen nothing and follows the ruled default. */
  | 'default'
  /** The column holds something. What the rails do with it is {@link CapabilityField.narrowest}'s
   *  business — see the blind spot above. */
  | 'chosen'

/**
 * ⛔ **The columns, in field order, and the ONLY place a statement may learn them.**
 *
 * 341's `SELECT can_spawn, max_depth, max_concurrent, can_message` and its matching `UPDATE … SET`
 * were two hand-written lists that had to agree with each other, with the reader's row type, and
 * with the writer's argument order. ⚑ A new capability changes none of them — and a retired one
 * leaves them just as quietly: `can_spawn` and `max_concurrent` went with D-014, and their
 * columns with D-016's schema.
 */
export const CAPABILITY_COLUMNS: readonly string[] = CAPABILITY_FIELDS.map((field) => field.column)

/** One field by name, for callers that legitimately want a single one. */
export function capabilityField<K extends CapabilityKey>(
  key: K,
): Extract<AnyCapabilityField, { key: K }> {
  const found = CAPABILITY_FIELDS.find((field) => field.key === key)
  // ⚠️ Unreachable while `K` is `CapabilityKey`; thrown rather than `!` so a caller reaching it
  // through a cast gets a sentence instead of `undefined` two frames later.
  if (found === undefined) throw new Error(`no capability called ${key}`)
  return found as Extract<AnyCapabilityField, { key: K }>
}

/**
 * 🔴 **One grant's value, said by the field that owns it** (485) — see {@link CapabilityField.says}.
 *
 * ⛔ **The one cast in this file's value path, and it is here so it is nowhere else.** A walk over
 * {@link CAPABILITY_FIELDS} hands each member as {@link AnyCapabilityField}, a union whose `says`
 * members have DIFFERENT parameter types; under `strictFunctionTypes` TypeScript will not let a
 * union of functions be called, even though `field.says` and `allowed[field.key]` are the same key
 * by construction ({@link KEYS_AGREE}). ⚠️ `capabilityField` above carries the same cast for the
 * same reason, and `a-reach-you-can-see.test.ts` records it: *"`CAPABILITY_FIELDS` is a `const`
 * tuple whose members have DIFFERENT types."*
 *
 * ⚑ **What the cast cannot hide is the pairing**, because the value is read at `field.key` rather
 * than passed in: a caller cannot hand one field another field's value, which is the property the
 * `Record<CapabilityKey, (allowed: ProfileCapabilities) => string>` this replaced did not have.
 *
 * 🔴 **`at` is WHICH QUESTION is being asked, and it is required so a caller has to answer it**
 * (544). ⛔ `null` asks *what has this identity been granted* — the grant as a sheet would put it,
 * with no conversation in the question. ⚑ A {@link ConversationAtLaunch} asks *what may this
 * conversation do*,
 * which for {@link ProfileCapabilities.maxDepth} is a different sentence and for every other field
 * today is the same one. ⚠️ **Optional would have been the wrong shape**: a caller that forgot it
 * would silently get the grant-sheet answer in an instruction bundle, which is the defect this
 * repair exists to remove, arriving through a defaulted argument.
 */
export function grantSays(
  field: AnyCapabilityField,
  allowed: ProfileCapabilities,
  at: ConversationAtLaunch | null,
): string {
  const says = field.says as (
    held: ProfileCapabilities[CapabilityKey],
    at: ConversationAtLaunch | null,
  ) => string
  return says(allowed[field.key], at)
}

/**
 * 🔴 **One grant as a person and a model both read it: `label: value`** (530).
 *
 * ⛔ **The pairing of a grant's label with its value, spelled once**, so no surface writes the
 * shape a second time. {@link capabilityLines} builds the model's block out of it. ⚠️ **The bullet
 * is NOT here** — `- ` is the instruction bundle's own list marker.
 *
 * ⚑ **`at` is passed straight through to {@link grantSays}** — see its note.
 */
export function grantLine(
  field: AnyCapabilityField,
  allowed: ProfileCapabilities,
  at: ConversationAtLaunch | null,
): string {
  return `${field.label}: ${grantSays(field, allowed, at)}`
}

/**
 * 🔴 **Every field, always, each either a value or `null`** — what a person's SAVE sends.
 *
 * ⛔ **339's `.nullable()` ruling, applied to capabilities.** *"An absent key and an explicit null
 * are the same value to a `Partial`, and they are not the same intent."* A sheet that showed a
 * hand-picked subset and sent only the fields it happened to think had changed would be one bug away
 * from writing today's defaults into a row that had chosen nothing — the backfill `0017` refused to
 * do. So the
 * surface says what it means about **all** of them, every time, and `null` is a real answer: *use
 * the default*.
 *
 * ⚑ **Mapped over {@link ProfileCapabilities}, so P3's field appears here on its own.**
 */
export type CapabilityGrant = {
  readonly [K in keyof ProfileCapabilities]: ProfileCapabilities[K] | null
}

/** Where a row's own answer for each capability stands. See {@link CapabilityOrigin}. */
export type CapabilityOrigins = Readonly<Record<CapabilityKey, CapabilityOrigin>>

/**
 * ⚠️ **A bound on every whole-count capability, on the wire and on the surface** (355).
 *
 * ⛔ **Not a rule about what is sensible — a rule about what may cross the boundary**: a forged
 * command from a compromised renderer must not be able to hand the main process a number nobody
 * would type. ⛔ **It is not `max_depth`'s ruled value and must never be read as one** — that is
 * what a profile that has chosen nothing follows; this is the largest number the wire will carry
 * at all. A person raising a bound to 64 is making a decision; a payload asking for 2**31 is not.
 */
export const MAX_CAPABILITY_COUNT = 64

/**
 * 🔴 **What the door that starts an agent's conversation buys, and what it does not** (368, HO-012
 * §2).
 *
 * HO-012 §2: *"**'The interim rail buys consent, never containment'** is the honest description, and
 * it should be **in the disclosure itself**, not only in this correspondence. A person reading what a
 * mode does deserves **the limit of the protection along with its existence.**"* It is a constant
 * rather than markup for `171`/`168`'s reason: *"a rule can only be enforced on wording a test can
 * reach."*
 *
 * ## ⚑ Every clause, and the code it was read off
 *
 *  - 🔴 *"runs the way that agent does and can never be given more latitude in its approval mode"*
 *    — a conversation `give_work` starts runs in its giver's mode, and `spawn-rails.ts` refuses
 *    `wider-than-its-parent` when the new conversation would act past its folder with nobody asked
 *    where the giver keeps a card or a sandbox (HO-036: *inherit, never wider*; D-038). ⛔ **The
 *    ceiling is on the MODE and never on the grants**: any agent may give work to any identity, whose
 *    own grants may be wider than its giver's (D-014), so the sentence names the approval mode rather
 *    than saying *more* bare on a sheet of grants. ⚠️ It says *latitude* rather than *fewer prompts*
 *    because the ceiling is compared on reach past the folder — the card on Claude `ask`, the card
 *    and a sandbox on Codex `ask`, nothing in `auto` on either — and not on prompts (F050).
 *    ⏸ **Where it overstates, held for a ruling** (D-038 F-A, F-B): a Claude `ask` giver's Codex
 *    `ask` helper writes and runs commands in its folder, reads outside it and runs a server tool
 *    its server marks read-only, all with no card, which is more latitude, and is given; and since a
 *    child starts in its giver's mode, *the door refuses that* names a refusal no give meets today.
 *  - 🔴 *"nothing here bounds where a command it runs can reach"* — measured: on Claude nothing is
 *    sandboxed in either mode (`367`), and this app refuses no tool call because of WHERE a path it
 *    names is (`726` · R92); on Codex every preset reads a planted file outside the workspace
 *    (`366`).
 *  - *"what you approve is approved"* — HO-012's own words: nothing downstream of an allowed card
 *    re-reads the decision.
 *
 * ## ⚠️ What it deliberately does NOT say
 *
 *  1. ⛔ **That a spawned conversation cards its commands**: on Codex a permitted read denies
 *     nothing, so nothing escalates and nothing asks — writing it would claim a protection where none
 *     exists (`086`).
 *  2. ⚠️ **Anything about a conversation's LIFE** — it is about the door that starts one; a later
 *     `setApprovalMode` is recorded on the session's own header (`349`).
 *  3. ⛔ **Merging or production** — neither is a rule of this product (HO-035).
 *  4. ⚑ **No argument** — `approval-mode.ts`'s rule: no "unsafe", no scare quotes.
 *
 * ⚠️ **It renders on `CapabilitiesSheet.vue`, above the first grant control**, the one surface where
 * *"an agent created it"* is a certainty rather than an inference; nothing on the wire tells a
 * spawned session from a person's.
 */
// ⚠️ **The LAST line is byte-identical to the one `455` M16 anchors**, and the sentence is wrapped so
// that no forty contiguous characters of it sit in one literal — `consent-never-containment.test.ts`
// relies on that to tell a paste from the declaration.
export const SPAWN_RAIL_MEANS =
  'A conversation an agent starts runs the way that agent does and can never be given more ' +
  'latitude in its approval mode — the door refuses that. That buys the decision and not a ' +
  'boundary: nothing here ' +
  'bounds where a command it runs can reach, and what you approve is approved.'
