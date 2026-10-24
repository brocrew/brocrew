import type { InjectedInstructionKind } from './runtime-ipc'
import type { ToldLayerKind } from './told'

/**
 * 🔴 **Whose a block of an agent's prompt is** (583, `HO-073` §4) — the axis the instructions
 * sheet is organised on, in the vocabulary the ruling that created the layers already uses.
 *
 * ## ⛔ The question this answers, and the one it replaces
 *
 * > ⚑ **`HO-073` §4: *"The sheet is organised by WHERE text came from. The question a person has
 * > is WHOSE it is."***
 *
 * ⚠️ **The old organisation is not wrong and is not removed.** `442`'s layer account says what
 * reached the model and what this app cannot see of it; `158`'s file list says which file each
 * block was read from. ⛔ **Neither of them answers *may I change this*, and that is the question
 * a person opens the sheet with.**
 *
 * ## ⚑ Derived from `HO-009` §2 and §3, not invented here
 *
 * ⛔ **`HO-009` §2 separates instruction layers BY WHO MAY WRITE** — which is the same axis
 * `HO-073` §4 asks for, two handovers earlier and already implemented:
 *
 * | `HO-009` | who may write | rendered? |
 * |---|---|---|
 * | **factory** | *"the app, versioned with the release — never editable, by anyone"* | yes |
 * | **configured** | *"the person, freely · agents by proposal"* | yes, since `582` |
 * | **dynamic** | *"the app, from the database"*, at every launch | yes |
 * | **learned** | *"the agent itself, freely"* | ⛔ **never by us** — the provider's own mechanism |
 *
 * ⚑ **And `HO-009` §3 names the fifth owner in as many words**, which `HO-073` §4's three-row
 * table leaves out because it is about the profile bundle: *"The cwd hierarchy — `CLAUDE.md` /
 * `AGENTS.md` in the working directory. **Belongs to the place, not the agent.**"* 🔴 *"An agent's
 * effective instructions are ours plus a place's, and we control only one half."*
 *
 * ⛔ **{@link 'the-place'} is therefore not *his*, however likely it is that he owns the
 * repository.** ⚠️ This app reads those files off a directory chain and observes nothing about who
 * wrote them — filing them under the person would be a claim it cannot make, and `357`'s rule
 * about a project file standing in for a profile layer is the same mistake one axis over.
 *
 * ## ⚠️ And the sixth is not an owner at all
 *
 * ⛔ **{@link 'not-held'} exists because `583` §3 forbids folding the absences into *ours*:** *"the
 * provider's own instructions — it has never held a byte of this layer. That is an honest absence
 * and it belongs in none of the three groups. Give it its own place rather than filing it under
 * ours."* ⚑ Its members are the two layers this app can name and not show, plus the files the
 * provider says it read for itself — **one group, one property: this app holds none of these
 * bytes.**
 *
 * 🔴 **`442` §2.1's rule is what makes the group mandatory rather than tidy**: omitted, everything
 * else on the sheet reads as a complete account of the prompt, which is the strongest false claim
 * this surface could make.
 */
export const WHOSE_TEXT = [
  'factory',
  'configured',
  'own-notes',
  'dynamic',
  'the-place',
  'learned',
  'not-held',
] as const

/** One of {@link WHOSE_TEXT}. */
export type WhoseText = (typeof WHOSE_TEXT)[number]

/**
 * ⛔ **A group's name and the one sentence that decides what belongs in it.**
 *
 * ⚠️ **{@link WhoseWords.says} is a MEMBERSHIP TEST, not a description.** A reader has to be able
 * to take a row and answer *is this one of those* from the sentence alone — which is what makes
 * `whose-text-is-this.test.ts` §2 able to plant a member in the wrong group and have a person
 * agree the test is right to go red.
 *
 * ⚑ **Second person throughout**, which is `HO-050` §1.1's *"the grouping is where the distinction
 * gets taught"* applied on a different axis: *you cannot edit this* teaches, *factory* does not.
 */
export interface WhoseWords {
  /** The group's name, as a person reads it — the tab's label. */
  readonly heading: string
  /**
   * 🔴 **The whole answer in one glance** — what a person sees without asking for more.
   *
   * Keep the always-visible explanation to one line and seventy characters, as `whose-text-is-this.test.ts` checks. Put the full {@link WhoseWords.says} explanation behind disclosure rather than repeating paragraphs under every heading.
   */
  readonly short: string
  /**
   * What makes a block belong here — the membership test, in full, behind one press.
   *
   * ⚠️ **It is a MEMBERSHIP TEST, not a description.** A reader has to be able to take a row and
   * answer *is this one of those* from this sentence alone — which is what makes
   * `whose-text-is-this.test.ts` §2 able to plant a member in the wrong group and have a person
   * agree the test is right to go red.
   *
   * ⚑ **Second person throughout**, which is `HO-050` §1.1's *"the grouping is where the
   * distinction gets taught"* applied on a different axis: *you cannot edit this* teaches,
   * *factory* does not.
   */
  readonly says: string
}

/**
 * ⛔ **Exhaustive by type**, so a seventh owner does not compile until it has a heading and a
 * membership sentence — `REGISTER_WORDS`' idiom, and the reason it is that idiom.
 */
export const WHOSE_WORDS: Readonly<Record<WhoseText, WhoseWords>> = {
  /**
   * The layer that ships with the app and that nobody here can edit. Its core is the same for
   * every agent, and BroBot's profile has a part of its own after it, so the sentence names that
   * one difference instead of claiming sameness outright: a reader told only "nobody can edit
   * this" would assume it. `a-sentence-the-product-can-be-held-to.test.ts` holds the words and the
   * fact behind them.
   */
  factory: {
    heading: 'BroCrew’s own',
    short: 'Ships with the app. Nobody here can edit it.',
    says:
      'Ships with the app: it changes when BroCrew updates, and nobody here can edit it. ' +
      'It is the same for every agent, except that BroBot’s has a part of its own.',
  },
  configured: {
    heading: 'yours',
    short: 'Standing rules set for this agent. Survives an update.',
    says: 'Standing rules saved for this agent. They survive an update, and you can edit or undo them.',
  },
  'own-notes': {
    heading: 'Own notes',
    short: 'Notes this agent keeps for itself. You can edit or undo them.',
    says:
      'Notes this agent keeps for itself. It reads them at every start, after its standing rules. ' +
      'You can edit or undo them.',
  },
  dynamic: {
    heading: 'this conversation’s',
    short: 'Read fresh when this conversation launched.',
    // 🔴 **583 §2 asks this one to carry two facts, and standing rule 8.2 is why.** ⛔ *"A
    // sentence describing WHEN a fact is read is itself a fact about the system — and getting it
    // wrong is worse than getting the fact wrong, because it makes an agent DISBELIEVE data that
    // is correct."* ⚠️ `574` measured the cost: BroBot read *"the grants were read when this
    // conversation started"*, concluded its TOOLS might be stale too, and stopped retrying a rail
    // that would have admitted it. ⚑ So the second clause is not optional decoration — it is the
    // half that stops the first one being read as a claim about the whole app.
    says:
      'Composed when this conversation launched, from the database and the files as they were ' +
      'then — true of this conversation and of no other. What the agent’s own tools read is not ' +
      'this: they answer from the record as it stands at the moment it calls them, so a grant ' +
      'changed since this launch is already in force even though these words are not.',
  },
  'the-place': {
    heading: 'the folder’s',
    short: 'In the working directory. BroCrew reads these, never writes them.',
    says:
      'Found on the path this conversation is working in. BroCrew reads these and sends them; it ' +
      'never writes them, and whoever owns that directory owns what is in them.',
  },
  learned: {
    heading: 'the agent’s own',
    short: 'The agent wrote these itself.',
    says:
      'The agent wrote these itself, as it worked. BroCrew sends some of them and the provider ' +
      'loads the rest; neither of us composed a word of it.',
  },
  // ⛔ **583 · both clauses of this group's first sentence were false somewhere** (found reviewing
  // this dispatch's own diff). ⚠️ *This app holds none of their text* is wrong on Codex, where the
  // provider reports the very leaf this app composed and published a moment earlier; and *nothing
  // below them is shown* is contradicted by the provider rows drawn directly under it, each with a
  // path, a scope and a door that reads the file now. ⚑ What is true of every member is what the
  // sheet is DOING: naming them rather than omitting them, and showing no text of theirs here.
  'not-held': {
    heading: 'not shown',
    short: 'Reached the model. This sheet is not showing the text.',
    says:
      'These reached the model and this sheet is not showing their text. They are named rather ' +
      'than left out, because a list of only what this app can show would read as a complete ' +
      'account of the prompt — and the largest part of it is here, with no size and no bytes.',
  },
}

/**
 * ⛔ **Where one block of a compiled file's text begins and ends, and whose it is** (583).
 *
 * ⚠️ **Offsets rather than a second copy of the bytes.** ⚑ A copy could disagree with the row's
 * own `text`; a half-open range into it cannot. 🔴 **And the spans of one file PARTITION it** —
 * every character is inside exactly one span, separators and trailing newline included — so a
 * section nobody gave an owner to cannot hide in a gap between two that were classified.
 *
 * ⛔ **Built where the text is composed and never parsed back out of it** — see
 * `profileBundleSpans` in `main/runtime/factory-text.ts`, and the reason it may not be done in the
 * renderer: the headings are main-process constants and `tsconfig.web.json` admits only
 * `src/renderer/**` and `src/shared/**`.
 */
export interface InstructionSpan {
  readonly whose: WhoseText
  /** The heading a person reads, without its markdown hashes — or `null` for a file's own head. */
  readonly heading: string | null
  /** Inclusive index into the text this span is of. */
  readonly start: number
  /** Exclusive index into the text this span is of. */
  readonly end: number
}

/**
 * 🔴 **The one kind whose row is not all one person's** — `profile-instructions`, the compiled
 * bundle, which is `factory + configured` in one file (`factory-text.ts`; the dynamic layer left it
 * at D-024 · R1 and is composed per conversation).
 *
 * ⛔ **So its row is grouped by its SECTIONS and never as a whole** — see
 * `InjectedInstruction.sections`, which the composer publishes alongside the text. ⚠️ **When those
 * sections are absent the row is not guessed at**: it is drawn on its own, saying the app could
 * not tell which part is whose, which is `438`'s fail-closed rule rather than a fallback onto the
 * most reassuring answer.
 */
export const BY_ITS_SECTIONS = 'by-its-sections'

/**
 * Either one owner for the whole file, or {@link BY_ITS_SECTIONS}.
 *
 * ⚑ **Not exported** — it is the value type of {@link WHOSE_FILE} eleven lines down and nothing
 * outside this module names it; a reader takes the owner from the map (found in review).
 */
type WhoseFile = WhoseText | typeof BY_ITS_SECTIONS

/**
 * ⛔ **Whose each file BroBot appended is** — exhaustive over {@link InjectedInstructionKind}, so
 * a ninth kind is a compile error here rather than a row that lands in no group and is silently
 * not drawn.
 *
 * ⚠️ **Derived from what the READER does with each path, not from its name.** ⛔ **And not from
 * `LABELS`, which is where an earlier draft of this sentence claimed to get it** (found reviewing
 * this dispatch's own diff): two of the eight labels — `profile memory` and `project memory` —
 * say nothing to a person about who wrote the file, so for those the owner comes from the code
 * that reads them and the label is short rather than corroborating.
 */
export const WHOSE_FILE: Readonly<Record<InjectedInstructionKind, WhoseFile>> = {
  // ⛔ **The compiled bundle — two owners in one file.** See {@link BY_ITS_SECTIONS}.
  'profile-instructions': BY_ITS_SECTIONS,
  // ⚑ `<providerHome>/CLAUDE.md`. **The AGENT writes this one** — `LABELS`' own note says it is
  // *"the file one line down and one directory over"* from the bundle, with the opposite owner.
  'profile-memory': 'learned',
  // ⚑ On the cwd chain, so it belongs to the place (`HO-009` §3).
  'project-memory': 'the-place',
  // ⚑ A repository's shared `AGENTS` file, read by BroBot for the engine that does not read it
  // itself (`377`, from `364` §2.3). ⛔ **Read, never written** — `HO-009` §3's hard rule.
  'repository-conventions': 'the-place',
  // ⚠️ **Ours even though it sits in a directory**, and that is the distinction `164` §3.2 paid
  // for: BroBot generates this file and overwrites it at every launch. It is checked into nothing.
  'workspace-instructions': 'factory',
  // ⛔ **The three rows whose author is the AGENT** (`165`, `317` §2.1, `322`).
  'agent-memory': 'learned',
  'agent-memory-note': 'learned',
  'agent-memory-topic': 'learned',
}

/**
 * ⛔ **Whose each layer of the account is** — exhaustive over {@link ToldLayerKind}.
 *
 * ⚠️ **A layer is a CLAIM about the prompt and a file is a block of it**, which `536` had to
 * establish before it could land a sentence — so the two maps are separate even where they name
 * the same bytes. ⛔ `app-composed` is the whole of what this app appended, as one string; it is
 * this app's own composition and belongs with the account rather than in an owner's group, which
 * is why it is the one layer {@link LAYER_STAYS_IN_THE_ACCOUNT} names.
 */
export const WHOSE_LAYER: Readonly<Record<ToldLayerKind, WhoseText | null>> = {
  // ⛔ *"It has never held a byte of this layer"* — `583` §3's first named absence.
  'provider-base': 'not-held',
  // ⚑ The composition itself. Not an owner's: it is the account, and its PARTS are what carry
  // owners — see {@link LAYER_STAYS_IN_THE_ACCOUNT}.
  'app-composed': null,
  'agent-store': 'learned',
  // ⚠️ Paths and no content (`430`) — this app holds no text for any of them.
  'provider-discovered': 'not-held',
  // ⛔ *"The 18 tool definitions — composed by the provider; the app holds none of that text"* —
  // `583` §3's second named absence.
  'published-tools': 'not-held',
}

/**
 * ⚑ **The layers that stay where `442` put them, above the groups**, because they are the account
 * of the prompt rather than a part of it.
 *
 * ⛔ **Derived from {@link WHOSE_LAYER} rather than typed**, so a layer given an owner leaves this
 * list in the same edit.
 */
export const LAYER_STAYS_IN_THE_ACCOUNT: readonly ToldLayerKind[] = (
  Object.keys(WHOSE_LAYER) as ToldLayerKind[]
).filter((kind) => WHOSE_LAYER[kind] === null)
