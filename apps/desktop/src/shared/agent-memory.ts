/**
 * 🔴 **What an agent has written down, read WITHOUT a conversation — and what a person did to it**
 * (625, `EXT-015` §1 · §3).
 *
 * ## ⛔ Why this is not a field on `SessionInstructions`
 *
 * ⚠️ **`SessionInstructions.agentMemory` already exists and is not this.** That list is the
 * CONVERSATION's: `readSessionInstructions` takes it at launch, the conversation keeps it, and
 * `InjectedInstruction.readAt` is deliberately absent from those rows because the PROVIDER loaded
 * them. ⛔ **It answers *what was this conversation given when it opened*.** `EXT-015` §2's fourth
 * row is that same ruling from the other end — *"it is a record; never; it is this
 * conversation's"* — so it may not be re-pointed at a live store without becoming a different fact
 * under one name.
 *
 * 🔴 **This answers a different question: *what does this agent have in its store NOW*.** ⚑ Two
 * reads, two moments, both correct — which is `MemoryLoadedEvent.lookedAt`'s own arrangement with
 * `InjectedInstruction.readAt` one layer down, and `HO-070` §3's rule is why it is said out loud:
 * a sentence about WHEN a fact is read is itself a fact about the system.
 *
 * Read memory live for the popup. A conversation's launch snapshot cannot include notes written during its run, so using only that snapshot would hide entries the person wants to inspect or remove.
 *
 * ## ⚑ …and why it is its own COMMAND rather than a third field on `AgentInstructionsReading`
 *
 * ⛔ **`instructAgent` returns an `AgentInstructionsReading`.** Folding a memory store into that
 * type would make every rule a person saves walk the filesystem — a `realpath`, two directory
 * listings and one guarded read per file — for a payload nothing on that path is drawing. ⚠️ The
 * argument that keeps `own` and `waiting` in ONE reading does not transfer: those two interact (an
 * ask is against a version, and `567`'s *two counts and one moment* is what a split would produce),
 * and a memory entry is against neither.
 *
 * ## 🔒 What this module may NOT do
 *
 * ⛔ **It is a pure vocabulary and pure types, like `own-instructions.ts`.** Every import is a
 * TYPE, so *"the reading is a function of its arguments"* is checked by the compiler rather than by
 * a test that has to remember to drop something — and the filesystem reader and the guarded write
 * both live in `main/runtime/agent-memory.ts`, which is the only module in this feature that may
 * import `node:fs`.
 *
 * ⛔ **And nothing here interprets an entry.** `EXT-015` §5: *"Do not infer anything from the text
 * of a memory entry. Show it; do not interpret it."* ⚑ `D17` / `HO-088` §5.1 ruled against prose
 * detection and `HO-095` §3 is the chain that follows from concluding from words — so there is no
 * title, no summary and no classification on {@link AgentMemoryEntry}. A person reads the bytes.
 */
import type { Provider } from '@brobot2/shared'
import type { ActedBy } from './who-did-it'
// ⚑ **A type-only edge back to the wire's own module** — `own-instructions.ts`' arrangement with
// that file exactly, and for its reason. ⛔ It is a TYPE and never a value: the cycle exists only
// in the checker and is erased at build time, and this module must stay reachable from a renderer
// without pulling `runtime-ipc.ts` in as a value.
import type { InjectedInstruction, RefusedInstruction } from './runtime-ipc'

/**
 * 🔴 **What this app can say about one provider's memory store for one agent — a CLOSED
 * vocabulary, because a bare empty list is the thing this field exists to stop.**
 *
 * ⛔ **`EXT-015` §3.4 asked for *both providers*, and the brief that ordered this work asked for
 * the answer as a FIELD rather than as an absence.** ⚠️ The measurement behind the words: an agent
 * that has never run on a provider, an agent that has run and written nothing, and a store whose
 * files this app could not read all produce `entries: []` — three different facts, one shape.
 *
 * ⚑ **Each word has a sentence that is TRUE of it and false of the other three** — which is
 * `workspace-reading.ts`' rule for when a walk needs a word of its own, asked once per member:
 *
 *  - ⛔ **`no-home`** — this app has never provisioned a home for this agent under this provider.
 *    ⚠️ **It is the one a bare empty list was most wrong about**: nothing has been written because
 *    nothing has ever run, and *"this agent hasn't written anything down yet"* would be inviting a
 *    person to wait for a store that no conversation is going to fill.
 *  - ⛔ **`nothing-written`** — the home is there and the store is empty or absent. ⚑ This is the
 *    one `EXT-015` §3.5's single line is about.
 *  - ⛔ **`unreadable`** — the store exists, nothing came out of it, and this app has a REASON for
 *    each source it declined. ⚠️ The reasons are on {@link AgentMemoryStore.refused}; this word is
 *    what stops a wall of refusals rendering as *"nothing written"*.
 *  - ⛔ **`read`** — entries. ⚑ The only word under which {@link AgentMemoryStore.entries} may be
 *    non-empty, and the only one under which it may not be empty.
 *  - ⛔ **`past-the-last-page`** — a page asked past the end of a store that holds entries (its
 *    `total`): ⚑ only the paged read answers it, where *"nothing written"* would be untrue.
 *
 * 🔴 **A provider this app cannot read AT ALL has no word here, deliberately.** ⛔ Both members of
 * `Provider` are read — Claude since `165`, Codex since `317` — so a word for it would be a state
 * nothing can produce, and `a-line-no-mutation-can-kill-is-not-carrying-its-rule` is what that
 * costs. ⚑ **What forces the question for a THIRD provider is `MEMORY_STORE_IS`' exhaustiveness
 * and the reader table beside it**, not a word standing in the future.
 */
export const MEMORY_STORE_STATE = [
  'no-home',
  'nothing-written',
  'unreadable',
  'read',
  'past-the-last-page',
] as const

/** One of {@link MEMORY_STORE_STATE}. */
export type MemoryStoreState = (typeof MEMORY_STORE_STATE)[number]

/**
 * ⛔ **What each state MEANS, rendered from the word rather than written beside it** (standing
 * rule 8, and `WROTE_IT_MEANS`' own shape).
 *
 * ⚠️ **Every sentence is about THIS APP's reach and about nothing else.** ⛔ None of them says the
 * agent remembers nothing — a provider keeps state this app has never been able to see, and a
 * sentence claiming otherwise would be `305`'s defect said about an absence. ⚑ The compiler will
 * not let this table go short.
 */
export const MEMORY_STORE_IS: Readonly<Record<MemoryStoreState, string>> = {
  'no-home': 'this agent has never run on this provider, so there is no store to read',
  'nothing-written': 'this agent hasn’t written anything down yet',
  unreadable: 'this store is here and this app could not read it — the reasons are listed',
  read: 'what this agent has written down',
  'past-the-last-page': 'this page starts after the last entry this agent has written down',
}

/**
 * 🔴 **What a person did to one entry — a CLOSED vocabulary, and it is `EXT-015` §3.2's two
 * words.**
 *
 * ⛔ **`removed` and `corrected`, and they are different ACTS rather than one act with a value.**
 * ⚠️ Removing destroys something an agent wrote; correcting replaces it and leaves an entry
 * standing. ⚑ A single verb with a nullable text would make the act an inference from an absence,
 * which is `a-conditional-override-is-not-a-bound` arriving on a record a person will read years
 * later.
 *
 * ⚠️ **`corrected` is a claim about the ACT, not about the result** — the same care
 * {@link WROTE_IT_MEANS} takes: it says a person replaced the text, never that the new text is
 * right.
 */
export const MEMORY_AMENDMENT = ['removed', 'corrected', 'restored'] as const

/** Ordinary edits cannot request a restoration or supply its saved text. */
export const MEMORY_EDIT = ['removed', 'corrected'] as const
export type MemoryEditAct = (typeof MEMORY_EDIT)[number]

/** One of {@link MEMORY_AMENDMENT}. */
export type MemoryAmendmentAct = (typeof MEMORY_AMENDMENT)[number]

/**
 * ⛔ **What each amendment MEANS, rendered from the word** (standing rule 8).
 *
 * 🔴 **Every sentence names a PERSON, and that is `EXT-015` §3.3 in the vocabulary rather than in a
 * comment:** *"Never let a person's edit look like the agent's own."* ⚑ There is no arm for an
 * agent because no agent can reach this door — see {@link A_PERSON_DID_THIS}.
 */
export const AMENDMENT_MEANS: Readonly<Record<MemoryAmendmentAct, string>> = {
  removed: 'a person took this entry out of the agent’s memory',
  corrected: 'a person replaced what this entry said',
  restored: 'a person brought this back from its saved copy',
}

/**
 * 🔴 **Why there is no `whoWroteIt` on an amendment, said where a reader will look for one.**
 *
 * ⛔ **`identity_instruction` carries `WHO_WROTE_IT` because FOUR authorities can write a
 * version** — a person, an approval, a relay and a creator. ⚑ **Exactly one authority can amend a
 * memory store**: the verb lives on the window wire behind `requireAPerson` and on no toolset, and
 * `the-rails-before-anything-can-reach-them.test.ts` is what holds that.
 *
 * ⚠️ **So a vocabulary here would have one member**, and a closed set of one is a column that
 * cannot ever disagree with the door — `a-closed-vocabulary-guards-what-a-member-says` with nothing
 * to guard. ⛔ **What IS recorded is {@link MemoryAmendment.by}**, the same `ActedBy` every other
 * settled act in this app records, because *which* person and *which* caller is a fact
 * `wroteIt` was never able to answer (`477`).
 *
 * 🔴 **The day an agent may amend another agent's memory, this constant is the thing that goes
 * red** — it is asserted by name, so the vocabulary question arrives with the door rather than
 * after it.
 */
export const A_PERSON_DID_THIS =
  'Only a person can change an agent’s memory. No agent has a tool that reaches this.'

/**
 * ⛔ **What a person is told when an entry's bytes are NOT inside BroBot's own folders** — and the
 * reason this sentence exists at all.
 *
 * 🔴 **The READ follows a link and the WRITE must not, and the polarity is the whole argument.**
 * ⚑ `readMemoryStore` follows links under `170` §2's ruling: the provider read the target before
 * this app was asked anything, so refusing removed the row from the panel and removed nothing from
 * the prompt — *"no visibility and no protection, which is strictly worse than either."*
 * ⛔ **That argument does not transfer to a removal.** Following a link here would delete or
 * rewrite a file the provider's own read never caused us to touch, and `EXT-015` §5 is exactly
 * that: *"Only ever read or write inside BroBot's own folders."* ⚠️ **Refusing the READ buys
 * nothing. Refusing the WRITE buys everything.**
 *
 * ⚑ **So the entry is still SHOWN, with {@link InjectedInstruction.link} naming where it really
 * is, and the controls are not offered** — which is `HO-029` §3's rule read forwards: a surface
 * must not offer a gesture that cannot land.
 */
export const MEMORY_IS_SOMEWHERE_ELSE =
  'This entry’s file lives outside BroCrew’s own folders, so BroCrew will not change it here. The ' +
  'path it really leads to is shown beside it.'

/**
 * 🔴 **One entry in an agent's memory store** — an {@link InjectedInstruction} plus the one thing a
 * READ cannot answer and a person about to press a button needs.
 *
 * ⛔ **It EXTENDS rather than restates.** `kind`, `path`, `text`, `bytes`, `truncated`, `reach` and
 * `link` are the same fields the conversation's panel already draws, produced by the same
 * `readMemoryStore` — `169` §1's rule about one derivation, applied to a shape rather than to a
 * function. ⚠️ A parallel entry type would be a second answer to *what is in this store*, and the
 * first time the two disagreed the popup and the drawer would be showing one agent two memories.
 */
export interface AgentMemoryEntry extends InjectedInstruction {
  /**
   * ⛔ **Whether a person may remove or correct THIS entry** — `false` when its real path is
   * outside the managed provider-homes root.
   *
   * ⚑ **A boolean and not a union, because there is exactly ONE reason today and it is named**
   * ({@link MEMORY_IS_SOMEWHERE_ELSE}). ⚠️ `a-value-beside-a-word-or-a-union-of-arms` asks for the
   * union when the arms carry different values; this arm carries none, so the word would be a
   * second spelling of `false`.
   *
   * 🔴 **It is the READING's half of the rail, not the rail.** The refusal is enforced again in
   * `main/runtime/agent-memory.ts` on the write — *provenance alone is not enough* — and this field
   * exists so a person is not offered a control that will refuse.
   */
  readonly amendable: boolean
}

/**
 * 🔴 **One provider's memory store for one agent, at one moment.**
 *
 * ⚠️ **One of these per member of `Provider`, always** — never only the provider the identity is
 * configured for. ⛔ An agent whose provider was switched at `433` has a store under BOTH homes and
 * the older one still holds what it wrote; a reading scoped to the current provider would show a
 * person an empty popup for memory that is on their disk. ⚑ `AgentIdentity.provider` is also
 * NULLABLE — *nobody has said* — and a reading that had to pick one would have to invent an answer
 * for that case.
 */
export interface AgentMemoryStore {
  readonly provider: Provider
  /** ⛔ One of {@link MEMORY_STORE_STATE} — the field that replaces a bare empty list. */
  readonly state: MemoryStoreState
  /**
   * The store's directory when there is one to name, else `null`.
   *
   * ⚠️ **The path is the disclosure**, as it is on every other memory row in this app: it names
   * WHICH store, and it is pasteable.
   */
  readonly dir: string | null
  /** ⛔ **Empty on every state but `read`**, and non-empty on that one. */
  readonly entries: readonly AgentMemoryEntry[]
  /**
   * Every source that exists and was not readable, with its reason.
   *
   * ⚑ **Silence about a source is the defect** — `170` §2's ruling, carried onto this door
   * unchanged. ⚠️ Non-empty is what makes {@link state} `unreadable` when nothing else came back.
   */
  readonly refused: readonly RefusedInstruction[]
  /**
   * ⚑ **F093 · C8 b**: every file this store holds that a page could show (its fixed files that
   * exist, and every topic file or note), and where the next page starts — `null` after the last.
   * ⚑ `offset` and `limit` count topic files or notes only: the fixed files are on page one, so a
   * page's entries and {@link total} both count them, and entries shown of `total` add up — ⚠️ short
   * of it by any file that is empty, refused, or past a page's 256 KiB. ⚑ W4.177: on the unpaged
   * read too, which is page one as a launch reads it: ⚠️ that read leaves out a file past its budget
   * without naming it, and its `nextOffset` is past the first twenty all the same — page with the
   * paged read. ⚠️ Absent only on a store with no home.
   */
  readonly total?: number
  readonly nextOffset?: number | null
}

/**
 * 🔴 **One amendment a person made, as the record states it** (`EXT-015` §3.3).
 *
 * ⛔ **Written at the moment of the act and never derived afterwards.**
 * `a-derivation-cannot-answer-what-its-ledger-does-not-contain` is the reason and it is literal
 * here: after a removal the file is gone, so *what it said* exists nowhere else in the world. ⚑ A
 * record that carried only a path and a time would be able to say something was taken out and
 * never what.
 */
/** Recovery metadata is absent on legacy completed records; absence is never an observation. */
export interface MemoryObservation {
  readonly fingerprint: string | null
  readonly unreadable?: true
}
export type MemoryOutcome = 'pending' | 'done' | 'partial' | 'unchanged'
export interface MemorySettlement {
  readonly by: { readonly who: 'a-person' } | { readonly who: 'the-app-itself' }
  readonly at: number
}

export interface MemoryAmendment {
  /** `mem:<folded slug>:<seq>` — derived, so a reissued sequence is a primary-key violation. */
  readonly id: string
  /** ⚑ **1-based and monotone per identity** — the order a person reads these in. */
  readonly seq: number
  /** Which provider's store this entry was in. */
  readonly provider: Provider
  /**
   * ⛔ **The entry, by the absolute path this app derived for it** — never a path a caller sent.
   *
   * ⚠️ **It may name a file that no longer exists**, and that is the point of the row.
   */
  readonly entry: string
  /** One of {@link MEMORY_AMENDMENT}. */
  readonly act: MemoryAmendmentAct
  /** ⚑ **Who this app believes performed the act**, at the moment it was performed. */
  readonly by: ActedBy
  /**
   * ⛔ **What the entry said BEFORE**, verbatim — the whole reason this row is written rather than
   * derived.
   */
  /** Null explicitly records that no entry existed before a restoration. */
  readonly textBefore: string | null
  /** ⛔ **What it says now**, or `null` for a removal. The two cannot come apart — the schema CHECKs it. */
  readonly textAfter: string | null
  /** The deletion restored, or the restoration reversed; absent for ordinary old edits. */
  readonly sourceId?: string
  /** Pending records describe planned text; only an observation establishes the actual outcome. */
  readonly outcome?: MemoryOutcome
  readonly actual?: MemoryObservation
  readonly settlement?: MemorySettlement
  /** When the act was performed — epoch milliseconds, this machine's wall clock. */
  readonly at: number
}

/**
 * 🔴 **Why a person's change did not land** — a CLOSED vocabulary, because a refusal a surface
 * cannot name is a refusal a person cannot act on.
 *
 *  - ⛔ **`no-such-entry`** — nothing in the store this app derived RIGHT NOW has that path. ⚑ It
 *    covers *the agent removed it first* and *nobody ever derived this string* with one word,
 *    deliberately: from here they are the same fact, and a vocabulary that claimed to tell them
 *    apart would be claiming to know what used to be there.
 *  - ⛔ **`somewhere-else`** — the entry's real file is outside BroBot's own folders. ⚠️ This is
 *    the one the READ deliberately leaves reachable, and {@link AgentMemoryEntry.amendable} is the
 *    surface's own half of it.
 *  - ⛔ **`unreadable`** — this app could not read what is there, so it will not destroy it. 🔴 **A
 *    removal whose record cannot say what was removed is a removal this app must not perform**
 *    (`a-derivation-cannot-answer-what-its-ledger-does-not-contain`, enforced at the door rather
 *    than regretted at the reader).
 *  - ⛔ **`write-failed`** — the filesystem said no. ⚑ The store is unchanged and nothing was
 *    recorded.
 *  - **`not-recorded`** — the intent or its observation could not be recorded. An intent that
 *    was saved remains pending until checked. This refusal makes no promise that the file is
 *    unchanged, because failure may happen before or after the filesystem effect.
 */
export const AMENDMENT_REFUSED = [
  'no-such-entry',
  'somewhere-else',
  'unreadable',
  'write-failed',
  'not-recorded',
  'confirmation-required',
  'changed-or-unreadable',
  'source-changed',
  'pending',
  'closing',
  'interruption-needs-checking',
  'nothing-changed',
  'change-incomplete',
] as const

/** One of {@link AMENDMENT_REFUSED}. */
export type AmendmentRefused = (typeof AMENDMENT_REFUSED)[number]

/**
 * ⛔ **What each refusal MEANS, rendered from the word** (standing rule 8) — and every sentence
 * names what a person can do next, which is `425`'s rule that a refusal carries its remedy.
 */
export const REFUSAL_MEANS: Readonly<Record<AmendmentRefused, string>> = {
  'no-such-entry':
    'this entry is not in the store any more — the agent may have changed it. Look again.',
  'somewhere-else': MEMORY_IS_SOMEWHERE_ELSE,
  unreadable:
    'BroCrew could not read this entry, so it will not change it. The reason is listed beside it.',
  'write-failed': 'the file could not be written. Nothing changed and nothing was recorded.',
  'not-recorded': "BroCrew couldn't record this change. Look at the entry before trying again.",
  'confirmation-required': 'Confirm the change first.',
  'changed-or-unreadable': "This entry changed or couldn't be read. Look again before changing it.",
  'source-changed': "This change can't be undone any more. Look at the entry and its history.",
  pending: 'An earlier change needs checking first.',
  closing: 'BroCrew is closing. Try again after it reopens.',
  'interruption-needs-checking':
    "BroCrew couldn't finish checking an interrupted change. Look at the entry before trying again.",
  'nothing-changed': "The entry wasn't changed. Look again before trying.",
  'change-incomplete':
    "BroCrew couldn't confirm the change finished. Look at the entry and its history.",
}

/**
 * 🔴 **What one attempted amendment did — and the STORE either way** (625).
 *
 * ⛔ **A refusal answers a reading, not an error.** ⚑ `425`'s rule: a person who pressed a control
 * for an entry the agent had already rewritten is shown what is actually there, rather than an
 * alert about a world they cannot see. ⚠️ **Both arms carry the freshly taken reading**, so a
 * surface never has to decide whether to re-read.
 */
export type AgentMemoryAmended =
  | {
      readonly done: true
      /** ⛔ **The record**, as the store allocated it — never the one a caller assumed. */
      readonly amendment: MemoryAmendment
      readonly reading: AgentMemoryReading
    }
  | {
      readonly done: false
      readonly refused: AmendmentRefused
      readonly reading: AgentMemoryReading
    }

/**
 * 🔴 **What a person ASKED for** — the payload of one amendment, declared once.
 *
 * ⛔ **The wire, the host and the guarded writer all read THIS shape**, rather than three that
 * happen to agree. ⚑ `a-payload-census-must-read-call-sites-not-types` is the reason it is worth a
 * name: the census question *who BUILT this* has one answer when the type has one declaration.
 */
export interface MemoryAmendmentAsked {
  /** A hash of the full text the person saw, checked again before changing the entry. */
  readonly fingerprint: string
  readonly confirmed: boolean
  readonly profileId: string
  readonly provider: Provider
  /**
   * ⛔ **The entry as the READING named it** — an identifier, never an argument to `join`.
   *
   * ⚠️ **Nothing validates it as a path, because nothing treats it as one**: the main side
   * re-derives the store and looks this string up in what came back, so a value this app never
   * produced matches nothing. 🔴 That is the house ruling — *the renderer never supplies a path* —
   * enforced by making the string unusable rather than by checking it.
   */
  readonly entry: string
  /** One of {@link MEMORY_AMENDMENT}. */
  readonly act: MemoryEditAct
  /** ⛔ **The replacement for `corrected`**, and ignored for `removed`. */
  readonly text: string
}

/** A person reverses a recorded change, using only the saved text in its history. */
export interface MemoryUndoAsked {
  readonly profileId: string
  readonly sourceId: string
  readonly confirmed: boolean
}
export interface MemoryCheckAsked {
  readonly profileId: string
  readonly confirmed: boolean
}
export type MemoryChecked =
  | { readonly done: true; readonly reading: AgentMemoryReading }
  | {
      readonly done: false
      readonly refused: AmendmentRefused
      readonly reading: AgentMemoryReading
    }

/** Unknown internal failures never promise that the entry was unchanged. */
export function memoryChangeRefusal(reason: string | undefined): AmendmentRefused {
  return (AMENDMENT_REFUSED as readonly string[]).includes(reason ?? '')
    ? (reason as AmendmentRefused)
    : 'change-incomplete'
}

/**
 * 🔴 **One amendment, as a writer states it** — everything the store cannot derive for itself.
 *
 * ⛔ **`seq` is NOT here.** It is allocated inside the transaction that writes the row, because a
 * number a caller chose is a number two callers can choose — `OwnInstructionsWrite`' own note, and
 * the same primary key makes the race RAISE rather than overwrite.
 *
 * ⛔ **`id` is not here either, and neither is `at`.** The id is derived from the slug and the
 * sequence; the time is the store's own clock, so a caller cannot date its act.
 */
export interface MemoryAmendmentWrite {
  /** The identity whose memory was changed. Folded by the store, as every other slug argument is. */
  readonly profileSlug: string
  readonly provider: Provider
  /** ⛔ **The absolute path THIS APP derived** — see {@link MemoryAmendment.entry}. */
  readonly entry: string
  /** One of {@link MEMORY_AMENDMENT}. */
  readonly act: MemoryAmendmentAct
  /** Who this app believes performed the act, at the moment it was performed. */
  readonly by: ActedBy
  /** ⛔ **What was there, verbatim**, read inside the guarded walk that performed the act. */
  /** Null explicitly records that no entry existed before a restoration. */
  readonly textBefore: string | null
  /**
   * ⛔ **What is there now, or `null` for a removal.**
   *
   * ⚠️ **`identity_memory_amendment_after_matches_act_ck` refuses a mismatch**, so the act word and
   * this field cannot come apart in the database rather than in a rule a writer has to keep.
   */
  readonly textAfter: string | null
  /** The deletion restored, or the restoration reversed; absent for ordinary old edits. */
  readonly sourceId?: string
}

/**
 * 🔴 **One moment's answer to *what has this agent written down, and what has a person done about
 * it*** (625) — the whole payload of one read.
 *
 * ⛔ **Both halves in ONE reading, and here the argument that `AgentInstructionsReading` makes
 * really does apply.** A surface that read the stores and the amendments separately could show an
 * entry beside a record saying it had already been removed, which is `567`'s *two counts and one
 * moment* arriving on the one popup whose job is to let a person act on what they see.
 */
export interface AgentMemoryReading {
  readonly changing?: true
  readonly needsChecking?: true
  /** The identity this is about, folded. */
  readonly profileId: string
  /** ⚑ **One per member of `Provider`**, in a fixed order, whatever the identity is configured for. */
  readonly stores: readonly AgentMemoryStore[]
  /** ⛔ **Every amendment a person has made to this agent's memory, newest first.** `[]` is ordinary. */
  readonly amendments: readonly MemoryAmendment[]
  /**
   * ⛔ **When this reading was taken** — `567`'s rule: a reading carries the moment it was taken.
   *
   * 🔴 **Stamped on the ASK, above the first syscall** —
   * `stamp-a-measurement-when-you-ask-not-when-it-answers`, and `readClaudeAgentMemory`'s own
   * `lookedAt` one layer down. ⚠️ Everything this reading reports is from at-or-after this number,
   * which is the direction that can only under-claim.
   */
  readonly readAt: number
}

/**
 * ⛔ **Is this a member of the vocabulary, asked of a value that has crossed the DATABASE?**
 *
 * ⚑ `isInstructionEnding`'s shape and for its reason: a column read back by a build whose
 * vocabulary has moved reaches a reader as a word it does not know, and printing `undefined` beside
 * a person's own act would be the confident sentence criterion 18 exists to prevent.
 */
export function isMemoryAmendment(act: unknown): act is MemoryAmendmentAct {
  return typeof act === 'string' && (MEMORY_AMENDMENT as readonly string[]).includes(act)
}

/**
 * ⚑ **An act off a replayed row, said as itself when this build has no sentence for it** —
 * `endingMeans`' shape exactly.
 */
export function amendmentMeans(act: string): string {
  return isMemoryAmendment(act) ? AMENDMENT_MEANS[act] : act
}
