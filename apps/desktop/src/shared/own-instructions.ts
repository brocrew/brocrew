/**
 * 🔴 **The `configured` layer — the one layer of `HO-009` §2 a PERSON OWNS** (582, `HO-063` gap 4).
 *
 * ⚠️ **618 · *owns* and no longer *writes***, because `HO-078` §4 gave the layer a writer that is
 * not a person: an agent creating another writes its first version, and after that the text is the
 * person's (`HO-078` §1.1). ⛔ **What did not change is whose layer it is** — every other layer of
 * `HO-009` §2 is composed by this app at launch, and this is the one a person edits, reverts and
 * takes away. ⚑ {@link WHO_WROTE_IT} is where the four authorities are argued.
 *
 * ## ⛔ What was here before this file, measured rather than recalled
 *
 * ⚑ **`InstructionContext.configured` has existed since `377` and NOTHING has ever supplied it.**
 * A grep of `apps/`, `packages/` and `scripts/` for the field finds `factory-text.ts` declaring it,
 * `composeProfileBundle` rendering it, and TESTS passing it — no production call site at all. ⛔ So
 * the `## Your own instructions` heading is reachable only from a test, which is `HO-073` §2's
 * sentence stated as a fact about this repository:
 *
 * Supply the profile's configured instructions so text the person wrote reaches future launches.
 *
 * ## ⚑ It is a fact about an IDENTITY, and that is `369`'s ruling rather than this file's choice
 *
 * ⛔ **`369` moved every capability column off the profile row and onto `agent_identity`**, because
 * *"a grant is a fact about an identity and this row is only a placement"* — and at D-016 the
 * profile table went altogether. ⚠️ A rule a person
 * writes is the same kind of fact, and `HO-075` §2 says so from the other end:
 *
 * An identity's standing rules follow it into any folder; folder conventions apply to whoever works there.
 *
 * ⛔ **So this is NOT a workspace file and must never be rendered as one.** `WORKSPACE_INSTRUCTIONS`
 * is about the directory; this is about the agent. `HO-050` §1's test tells them apart: close the
 * conversation and change the directory, and you learn which is which.
 *
 * ## 🔴 Versioned and revertable is the SHAPE, not a flag
 *
 * ⚠️ **`HO-009` §1.2 is the reason, and it is about safety rather than convenience:** *"instruction
 * drift — a worker quietly rewriting its own rules because one task went badly — and it is
 * unrecoverable because nothing records what the rule used to be."*
 *
 * ⛔ **So nothing here ever replaces text.** A save appends a version; a revert appends a version
 * carrying an older one's text and says which ({@link OwnInstructionsVersion.broughtBack}). ⚑ *What
 * the rule used to be* is therefore not a feature that could be forgotten — it is the only thing
 * this layer can store.
 *
 * ⛔ **And a revert is not a re-grant** (standing rule 11, and `HO-016` §2 behind it). It restores
 * TEXT and touches no capability, no role, no provider and no name. ⚠️ Reverting past a version a
 * person wrote to remove a rule puts that rule back — which is a person's own act, visible as its
 * own version, and named as such on the surface that offers it.
 *
 * ## ⚠️ It is a pure vocabulary and a pure fold, like `tasks.ts`
 *
 * ⛔ **Every import here is a TYPE.** This module cannot reach a database, a host, a clock or a
 * filesystem, so *"the reading is a function of its arguments"* is checked by the compiler rather
 * than by a test that has to remember to drop something.
 */
import type { ActedBy } from './who-did-it'
// ⚑ **A type-only edge back to the union's own module** — `tasks.ts`' arrangement with that file
// exactly. ⛔ It is a TYPE and never a value: the cycle exists only in the checker and is erased at
// build time, and this module must stay reachable from a renderer without pulling `runtime-ipc.ts`
// in as a value.
import type { InstructionProposedEvent, InstructionSettledEvent } from './runtime-ipc'

/**
 * ⛔ **The longest rule set a person may save, in characters.**
 *
 * ## ⚑ Derived, because a bound in a template is a number that drifts
 *
 * ⚠️ **This text rides into every launch of the identity it belongs to**, inside a bundle that
 * `HO-073` §1 measured at **3.5 KB**. ⛔ So the question is not *how much prose might somebody
 * write* but *how much of a provider's context may one person's standing rules take before the work
 * has room*. ⚑ 16,000 characters is roughly 4,000 tokens — about 2% of a 200k window — and about
 * four times the whole bundle it joins.
 *
 * 🔴 **And it is deliberately large**, because `HO-073` §2.2 says what this layer is FOR: *"this
 * is how his operating model stops being a thing he pastes into every dispatch and becomes a thing
 * the product renders."* ⛔ A bound that refused an operating model would have shipped the seam fed
 * with something nobody wanted to put in it.
 *
 * ⚠️ **Characters and not bytes**: a person counting what they typed counts characters, and a byte
 * bound refuses a shorter text for containing accented words.
 */
export const OWN_INSTRUCTIONS_CHARS = 16_000

/**
 * 🔴 **Who put one version there — a CLOSED vocabulary, because `HO-009` §2.2 closed it.**
 *
 * ⛔ **The three `HO-009` §2.2 named, and they are a ruling rather than a shape this file chose:**
 *
 *  - ⚑ **`a-person`** — *"The person edits the configured layer directly, at any time."*
 *  - ⚑ **`an-agents-proposal`** — *"An agent proposes. A proposal is a card; approval writes it."*
 *  - ⚑ **`relayed-from-user`** — *"One exception: BroBot relaying a rule the person gave it needs no
 *    second approval — provenance* relayed from user *IS the authorization."*
 *
 * ## 🔴 618 · a FOURTH, and it is RULED rather than a widening this file took
 *
 * ⚑ **`HO-094` §1 is the authority and it is the PO's own words:** *"Instructions written by the
 * agent that created an identity, at the moment it created it, are recorded as exactly that. Not a
 * person's. Not a proposal. Not a relay."* ⛔ **The PO priced the member himself** — *"`WROTE_IT_MEANS`
 * is exhaustive and every reader pays for it; that is the cost of the record being true, and it is
 * the right cost."* ⚠️ **The NAME and the SENTENCE are `618`'s**, and the reading below is how they
 * were chosen rather than a restatement of the ruling.
 *
 * ⚠️ **This block read *"Three, and there is no fourth"* until `618`, and the sentence beneath it
 * read *"nothing in this app can produce a version without a person either writing it or approving
 * it, except the relay."*** ⛔ **`HO-078` §4 ruled that `create_agent` takes the new identity's own
 * instructions** — *"what it is for, the operating model it works under, whatever scoping the
 * creator can give it"* — **so there is a second act that writes a version with no person in it,
 * and both sentences had to move.** ⚑ They are corrected here rather than deleted, because a number
 * can survive the death of its derivation and so can a count.
 *
 * ⛔ **It is a word of its own because none of the three above is TRUE of it**, which is
 * `workspace-reading.ts`' rule — *a walk needs a word of its own when no existing word's sentence
 * is TRUE of it* — asked of {@link WROTE_IT_MEANS}' three sentences one at a time:
 *
 *  - ⛔ ***"you wrote this"*** — **false.** An agent wrote it; the person may never have seen it.
 *  - ⛔ ***"an agent proposed this and you approved it"*** — **false, and it is the trap.** `HO-078`
 *    §1.1 is that an agent wanting to CHANGE this text proposes; the first version is a direct
 *    write and nobody decided anything. ⚠️ Recording it as a proposal ENDED `approved` would be a
 *    claim about an act that never happened, which is criterion 18 in one word.
 *  - ⛔ ***"an agent wrote this, saying you had given it the rule — this app did not check that"***
 *    — **false, and false in the direction that invents evidence.** A creator makes no claim about
 *    the person at all, so this sentence would put words in the agent's mouth as well as the
 *    person's.
 *
 * ⚑ **`its-creator` is a claim, like a column name** (standing rule 25), and it is one this app
 * can keep: the word is written at exactly one place — the identity's own creation — and
 * `identity_instruction_creator_is_first_ck` refuses it on any version but the first, so *the
 * creator wrote it* cannot come to mean *an agent wrote it later*.
 *
 * Direct agent changes now have their own origin as well. The host fixes their authority;
 * historical relay rows remain readable as the claims originally recorded.
 *
 * ⛔ **The word that still does NOT exist is the one `HO-009` §1.2 refuses by name**: an agent
 * writing its OWN rules from experience. ⚠️ **Every version this app can produce is a person's
 * keystroke, a person's approval, an agent's claim that a person said it, or the one line a
 * creator wrote before the agent it was making had ever run**, or a direct agent change.
 * Each origin remains distinguishable in history.
 */
export const WHO_WROTE_IT = [
  'a-person',
  'an-agents-proposal',
  'relayed-from-user',
  'its-creator',
  'an-agent-direct',
] as const

/** One of {@link WHO_WROTE_IT}. */
export type WhoWroteIt = (typeof WHO_WROTE_IT)[number]

/**
 * ⛔ **What each provenance MEANS, rendered from the word rather than written beside it** (standing
 * rule 8).
 *
 * ⚠️ **Every sentence is about how the version GOT here and about nothing else.** ⛔ None of them
 * says the text is right, that a person agrees with it, or that it is in force — *in force* is
 * {@link whatIsInForce}'s answer and it is about position, not provenance. ⚑ The compiler will not
 * let this table go short.
 */
export const WROTE_IT_MEANS: Readonly<Record<WhoWroteIt, string>> = {
  'a-person': 'you wrote this',
  'an-agents-proposal': 'an agent proposed this and you approved it',
  'an-agent-direct': 'An agent changed this',
  'relayed-from-user':
    'an agent wrote this, saying you had given it the rule — this app did not check that',
  // 🔴 **618 · it says WHO, WHEN and what was NOT done** (`HO-078` §4). ⛔ The last clause is the
  // one a person needs and the other three sentences have an answer for: *you wrote this*, *you
  // approved it*, *an agent says you said it* — and this arm is the only one where the honest
  // answer is *nobody asked you*. ⚠️ **It is about how the version got here and not about the
  // text**: it does not say the rules are wrong, unwanted, or still in force.
  'its-creator':
    'the agent that created this one wrote this as it created it, before this agent had ever run — nobody asked you',
}

export interface RulesAuthor {
  readonly profile: string
  readonly name: string
}

/** Names the content author without confusing them with a proposal's approver. */
export function rulesChangeLabel(
  version: Pick<OwnInstructionsVersion, 'whoWroteIt' | 'author'>,
): string {
  if (version.whoWroteIt === 'a-person') return 'You changed this'
  if (version.whoWroteIt === 'an-agent-direct') {
    return `${version.author?.name.trim() || 'An agent'} changed this`
  }
  return WROTE_IT_MEANS[version.whoWroteIt]
}

export interface InstructionUnread {
  readonly seenThrough: number
  readonly newestDirectVersion: number
  readonly unread: boolean
}

/**
 * 🔴 **One saved version of one identity's own instructions.**
 *
 * ⛔ **Nothing here is editable.** A version is what was saved at a moment; the way to change the
 * rules is to save another one. ⚠️ That is what makes {@link OwnInstructions.versions} an audit
 * trail rather than a cache of the current value.
 */
export interface OwnInstructionsVersion {
  /** The content author at creation time, separate from an approving person's act. */
  readonly author?: RulesAuthor
  /**
   * ⚑ **1-based and monotone per identity** — the number a person reads and a revert names.
   *
   * ⛔ **Never reissued.** Versions are appended and never deleted, so `max + 1` cannot hand out a
   * number that has been used — which is the `a-max-over-survivors-reissues-a-burned-number` shape
   * arriving on a table where the premise that defeats it is enforced by the table itself. ⚠️ The
   * derived row id (`ins:<slug>:<version>`) is what makes that a database fact rather than a
   * promise: a reissue is a primary-key violation.
   */
  readonly version: number
  /**
   * ⛔ **The rules, verbatim. An EMPTY string is a real version and means *there are none*.**
   *
   * ⚠️ **Empty is not the same as {@link OwnInstructions.versions} being empty**, and the difference
   * is the whole reason clearing appends rather than deletes: *nobody has ever written rules for
   * this agent* and *somebody wrote some and then took them away* are different facts, and only the
   * second has a date and an author.
   */
  readonly text: string
  /** One of {@link WHO_WROTE_IT}. */
  readonly whoWroteIt: WhoWroteIt
  /**
   * ⚑ **Who this app believes performed the act** — {@link ActedBy}, the same value every other
   * settled act in this app records.
   *
   * ⛔ **Not derivable from {@link whoWroteIt}** (`477`'s finding): one provenance word can stand
   * over more than one actor, and a person approving an agent's proposal is a different actor from
   * the agent that proposed it.
   */
  readonly by: ActedBy
  /**
   * The conversation that asked for this, or `null` when a person wrote it directly.
   *
   * ⚑ **618 · *asked for* and no longer *proposed or relayed***, because `its-creator` is a third
   * way a conversation gets named here — the one the `create_agent` call was made in (`HO-078` §4).
   * ⛔ The FIELD did not move: it is the conversation this app holds responsible for the version,
   * and {@link OwnInstructionsVersion.whoWroteIt} is what says which kind of act it was.
   *
   * ⛔ **A session id and never a slug** — `370` §3.1's rule: the full `sess_<uuid>` is the runtime's
   * canonical conversation identifier, where a slug names a reusable profile and a display name is
   * nullable and non-unique.
   */
  readonly conversation: string | null
  /**
   * ⚠️ **What the agent said when it proposed or relayed this — a CLAIM, and labelled.**
   *
   * ⛔ **Nothing in this app checked a word of it**. `null` for a version a person wrote, because a person writing their own rules is
   * not making a case to anybody.
   *
   * ⚑ **618 · `null` for `its-creator` too, and for a DIFFERENT reason than the person's** — the
   * person has nobody to make a case to, and a creator has nobody to make one to YET. ⛔ **There is
   * no `why` argument on `create_agent` and adding one was refused**: the text IS the act, and a
   * second free-shaped optional beside the name is exactly what `445` measured a model filling with
   * something else (`role: 'DEV-75297'`).
   */
  readonly said: string | null
  /**
   * 🔴 **The version this one brought back, or `null` when it is new text.**
   *
   * ⛔ **A revert APPENDS.** Restoring version 2 as version 7 leaves 3–6 exactly where they were, so
   * the reverting is itself revertable and `HO-009` §1.2's *"nothing records what the rule used to
   * be"* stays impossible. ⚠️ It is a fact about this row and not a second kind of row: a reverted
   * version renders into the bundle like any other.
   */
  readonly broughtBack: number | null
  /** When it was saved, epoch ms. */
  readonly writtenAt: number
}

/**
 * 🔴 **Everything one identity has ever been told by its person, newest first.**
 *
 * ⛔ **The whole history and not a current value plus a log**, because two fields would be two
 * answers to *what is in force* and the launch reads one of them. ⚑ {@link whatIsInForce} is the
 * single derivation, and `composeProfileBundle` is handed its output.
 */
export interface OwnInstructions {
  /** The identity these belong to — its folded slug. */
  readonly identity: string
  /**
   * ⛔ **Newest first, and never empty-as-a-lie**: an identity nobody has written rules for has
   * `[]`, which {@link whatIsInForce} answers `null` for. ⚠️ An identity whose rules were CLEARED
   * has one or more versions and the newest carries `''` — see {@link OwnInstructionsVersion.text}.
   */
  readonly versions: readonly OwnInstructionsVersion[]
}

/**
 * ⛔ **The version a launch would render, or `null` when nobody has written one.**
 *
 * ⚑ **The ONE derivation of *what is in force*, so a surface and a launch cannot disagree about
 * it.** ⚠️ It reads position and never provenance: the newest version wins whoever wrote it, which
 * is what makes a person's save able to overwrite an agent's relay and the reverse.
 */
export function whatIsInForce(held: OwnInstructions): OwnInstructionsVersion | null {
  let newest: OwnInstructionsVersion | null = null
  for (const one of held.versions) {
    if (newest === null || one.version > newest.version) newest = one
  }
  return newest
}

/**
 * 🔴 **What `InstructionContext.configured` is fed — the seam, closed.**
 *
 * ⛔ **Blank text answers `null` rather than `''`**, and that is not tidiness: `composeProfileBundle`
 * already trims and omits the heading for an empty string, and answering `null` here means the ONE
 * place that decides *is there a configured layer at this launch* is this function rather than a
 * `trim()` in two files. ⚑ A cleared rule set therefore renders no heading, exactly as an identity
 * that never had one does — which is right, because the bundle is what the agent reads and an empty
 * heading tells it nothing it can act on.
 *
 * ⚠️ **The HISTORY is still there and the surface still shows it.** *Nothing is rendered* and
 * *nothing was ever written* differ on the sheet and deliberately not in the bundle.
 */
export function configuredLayerOf(held: OwnInstructions): string | null {
  const inForce = whatIsInForce(held)
  if (inForce === null) return null
  const text = inForce.text.trim()
  return text === '' ? null : text
}

/**
 * ⚑ **F009 · how a set of standing rules begins, as an agent's record quotes it** — the first line
 * that holds a word, without the marks markdown opens a line with (a heading's `#`, a quote's `>`, a
 * list's `-` or `1.`) — else, for rules with no word in them, their first line that is not blank —
 * cut at `cap` characters on a word with `…` where the rest was left out, never inside a character.
 * `null` only when there are no rules. ⛔ The rules' own words, never a summary of them: what the line
 * says the agent is for is the rules' claim, quoted.
 */
export function howTheRulesBegin(rules: string | null, cap: number): string | null {
  if (rules === null) return null
  const lines = rules
    .split('\n')
    .map((raw) => raw.replace(/^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+|>)*/u, '').trim())
  const line =
    lines.find((one) => /[\p{L}\p{N}]/u.test(one)) ?? lines.find((one) => one !== '') ?? null
  if (line === null) return null
  const characters = Array.from(line)
  if (characters.length <= cap) return line
  const cut = characters.slice(0, cap).join('')
  const atAWord = cut.lastIndexOf(' ')
  return `${(atAWord > cut.length / 2 ? cut.slice(0, atAWord) : cut).trimEnd()}…`
}

/**
 * ⛔ **What an agent may ask for against this layer — a closed vocabulary, because the two arms are
 * ruled and there is no third.**
 *
 * ⚑ **`propose`** puts it in front of a person and writes nothing (`HO-009` §2.2).
 * ⚑ **`relay`** writes immediately and claims the person already said it — the ONE exception, and
 * the reason {@link WHO_WROTE_IT} has a word for it.
 */
export const INSTRUCTION_ASKS = ['propose', 'relay'] as const

/** One of {@link INSTRUCTION_ASKS}. */
export type InstructionAsk = (typeof INSTRUCTION_ASKS)[number]

/**
 * 🔴 **How an instruction proposal stopped waiting.**
 *
 * ⛔ **`approved` is the only word that writes a version**, and it is reachable only from a person —
 * see `RuntimeHost.decideInstruction`, which stands behind the `requireToAnswer` rail. ⚑ `superseded` is this app's own word for *the person wrote their own
 * version while this was waiting*, and it exists so a proposal nobody answered does not sit in
 * front of them describing a world that moved.
 */
export const INSTRUCTION_ENDINGS = ['approved', 'refused', 'superseded', 'withdrawn'] as const

/** One of {@link INSTRUCTION_ENDINGS}. */
export type InstructionEnding = (typeof INSTRUCTION_ENDINGS)[number]

/**
 * ⛔ **What each ending MEANS, rendered from the word** (standing rule 8) — and every sentence is
 * about what happened to the PROPOSAL rather than about what the rules now say.
 */
export const ENDING_MEANS: Readonly<Record<InstructionEnding, string>> = {
  approved: 'you approved it, and it is now a version',
  refused: 'you refused it, and nothing was written',
  superseded: 'you saved your own version while this was waiting, so it was taken down',
  withdrawn: 'the conversation that proposed it stopped before anybody decided',
}

/**
 * 🔴 **582's ledger pair lives in `runtime-ipc.ts`, with every other arm of `TranscriptEvent`** —
 * {@link InstructionProposedEvent} and {@link InstructionSettledEvent}.
 *
 * ⛔ **That split is not a preference**: `scripts/test/event-vocabulary.test.mjs` reads the union's
 * arms and looks each one's `export interface` up IN THAT FILE. ⚑ An arm declared
 * elsewhere makes that guard throw by name — which it did, on the first run after this dispatch
 * tried to keep them here, and is the right direction for a guard scoped by a path to fail in.
 */

/** One ask nobody has answered, with the ordinal its row sits at. */
export interface InstructionAskWaiting {
  readonly asked: InstructionProposedEvent
  /** The conversation the ask was made in — the ledger this row belongs to. */
  readonly conversation: string
  /** When it was asked, epoch ms. */
  readonly at: number
}

/**
 * 🔴 **Which asks are still in front of a person — a pure fold over the two rows above.**
 *
 * ⛔ **`open` means *nothing has ended it in the ledger*, and not *somebody is still waiting***, which
 * is `deriveRoutedRequests`' own caveat and it applies here for its reason. ⚑ Nothing settles an
 * ask on its own: it stays in front of a person until they decide it or save their own rules.
 *
 * ⚠️ **Ordered oldest first**, because the surface draws them in the order a person was asked.
 */
export function waitingOnAPerson(
  rows: readonly {
    readonly conversation: string
    readonly at: number
    readonly event: InstructionProposedEvent | InstructionSettledEvent
  }[],
): readonly InstructionAskWaiting[] {
  const open = new Map<string, InstructionAskWaiting>()
  const ended = new Set<string>()
  for (const row of rows) {
    if (row.event.type === 'instruction_settled') {
      ended.add(row.event.askId)
      continue
    }
    open.set(row.event.askId, {
      asked: row.event,
      conversation: row.conversation,
      at: row.at,
    })
  }
  return [...open.values()].filter((one) => !ended.has(one.asked.askId)).sort((a, b) => a.at - b.at)
}

/**
 * ⛔ **The sentence every surface that offers this editor owes, and the ONE place it is written.**
 *
 * ## 🔴 Standing rule 8.2 is the whole of why it is worded like this
 *
 * ⚠️ **`HO-070` §3:** *"A sentence describing WHEN a fact is read is itself a fact about the system
 * — and getting it wrong is worse than getting the FACT wrong, because it makes an agent disbelieve
 * data that is correct."* ⛔ `574` measured the cost: BroBot stopped retrying a rail that would have
 * admitted it, because our own prose told it its facts were a snapshot.
 *
 * ⚑ **So this sentence scopes its claim to itself and says what the other surface does.** The
 * bundle is composed once per launch (`RuntimeHost.instructionContext`, before the first event is
 * pumped), so a rule saved now genuinely does not reach a conversation already running — and
 * `HO-009` §2.2 says to say so: *"A rule that must apply to a live agent now is also a message.
 * Both, or the person will believe a rule is in force that is not."*
 */
export const TAKES_EFFECT_AT_THE_NEXT_LAUNCH =
  'Saved rules are composed into an agent’s instructions when a conversation starts, so they reach ' +
  'the next conversation this agent runs and not one that is already running. To change what a ' +
  'running agent is doing now, send it a message as well.'

/** What the editor says when an identity has no versions at all. */
export const NOBODY_HAS_WRITTEN_ONE =
  'Nothing here yet. Anything you write becomes part of this agent’s instructions at its next ' +
  'conversation, and stays there until you change it.'

/**
 * 🔴 **One version, as a writer states it** — everything the store cannot derive for itself.
 *
 * ⛔ **`version` is NOT here.** It is allocated inside the transaction that writes the row, because
 * a number a caller chose is a number two callers can choose — see
 * `SessionStore.writeOwnInstructions`.
 */
export interface OwnInstructionsWrite {
  readonly author?: RulesAuthor
  /** When supplied, both comparisons are made in the version allocation transaction. */
  readonly expectedVersion?: number
  readonly currentText?: string
  /** The identity the rules are about. Folded by the store, as every other slug argument is. */
  readonly profileSlug: string
  /** ⛔ **Verbatim, and `''` is *take them away*.** Bounded by {@link OWN_INSTRUCTIONS_CHARS}. */
  readonly text: string
  /** One of {@link WHO_WROTE_IT}. */
  readonly whoWroteIt: WhoWroteIt
  /** Who this app believes performed the act, at the moment it was performed. */
  readonly by: ActedBy
  /**
   * The conversation that asked, or `null` for a person's own save.
   *
   * ⛔ **`identity_instruction_person_said_nothing_ck` refuses a non-null here beside
   * `a-person`**, so the two provenance fields cannot come apart in the database rather than in a
   * rule a writer has to keep.
   */
  readonly conversation: string | null
  /** What the agent said, or `null`. A CLAIM, and the same check refuses one for a person. */
  readonly said: string | null
  /** The version this one brings back, or `null`. ⚠️ Must be earlier — the schema CHECKs it. */
  readonly broughtBack: number | null
}

/**
 * 🔴 **One moment's answer to *what has this agent been told by its person, and what is anybody
 * asking***  (582) — the whole payload of one read.
 *
 * ⛔ **Both halves in ONE reading, because they are drawn beside each other.** A surface that read
 * the history and the waiting asks in two calls could show an ask against a version that had
 * already been superseded between them, and a person would be approving text on top of a world
 * that moved — which is `567`'s *two counts and one moment* arriving on a sheet.
 */
export interface AgentInstructionsReading {
  /** Every version, newest first. ⚑ `versions: []` is *nobody has ever written any*. */
  readonly own: OwnInstructions
  /**
   * ⚠️ **Every ask nobody has answered, oldest first** — and `[]` is the ordinary case.
   *
   * ⛔ **It is *nothing has ended it in the ledger* and not *somebody is still waiting***, which is
   * {@link waitingOnAPerson}'s own caveat carried onto the wire rather than lost at it.
   */
  readonly waiting: readonly InstructionAskWaiting[]
  /** ⛔ **When this reading was taken** — `567`'s rule: a reading carries the moment it was taken. */
  readonly readAt: number
}

/** ⛔ **Is this a member of the vocabulary, asked of a value that has crossed the LEDGER?** */
export function isInstructionEnding(said: unknown): said is InstructionEnding {
  return typeof said === 'string' && (INSTRUCTION_ENDINGS as readonly string[]).includes(said)
}

/**
 * ⚑ **An ending off a replayed ledger, said as itself when this build has no sentence for it** —
 * `whoDidItSays`' shape exactly, and for its reason: `TranscriptEvent` is `JSON.parse`d and cast
 * with no schema between the database and a fold, so a row written by a build whose vocabulary has
 * moved reaches a reader as a word it does not know. ⛔ Printing `undefined` beside a person's own
 * rules would be the confident sentence criterion 18 exists to prevent.
 */
export function endingMeans(said: string): string {
  return isInstructionEnding(said) ? ENDING_MEANS[said] : said
}
