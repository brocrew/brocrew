import {
  pluginInstructionParagraphs,
  PLUGINS_HEADING,
  type PluginInstructionEntry,
} from '../plugins/instructions'
import { type ConversationAtLaunch, type ProfileCapabilities } from '../../shared/capabilities'
import { providerValue, BUILD_IS_DEV, BUILD_IS_UNRECORDED } from '@brobot2/shared'
// ⚑ **583 · the axis the instructions sheet is grouped on** — see {@link profileBundleSpans}.
import type { InstructionSpan, WhoseText } from '../../shared/whose-text'
// ⚑ **D-024 · R1 — a profile's other conversations, said as every other agent-facing line says a
// piece and a time.**
import { MAX_INSTANT } from '../../shared/clock'
import { localFields } from '../../shared/local-time'
import { PRODUCT_NAME } from '../../shared/product-name'
import { DEFAULT_PROFILE_ID } from '../../shared/runtime-ipc'
import type { Provider } from '@brobot2/shared'
import { agentPreamble, type PromptIdentity } from './agent-preamble'
import { savedMethodsParagraphs, type SavedMethodsReading } from '../saved-methods'

/**
 * 🔴 **The text a child is actually told** (377, HO-009 §7) — the canonical source: the profile's
 * own half compiled into both dialects by {@link composeProfileBundle}, and what is true of one
 * conversation composed for that conversation alone by {@link thisConversationSpans} (D-024 · R1).
 *
 * ## ⛔ Three layers, and the boundary between them is the whole design
 *
 * HO-009 §2 separates instruction layers **by who may write**, and this file owns two of the four:
 *
 *  - **factory** — the text below. Versioned with the release, editable by nobody.
 *  - **configured** — the person's own text. ⚑ **This file owns the SEAM**
 *    ({@link InstructionContext.configured}); **582 built the FEEDERS**, which is
 *    `identity_instruction`, `RuntimeHost.instructAgent` and the sheet's editor. ⛔ **The wiring
 *    change HO-009 §8 predicted was one line in `RuntimeHost.instructionContext`**, which is what
 *    building the seam early bought. ⚠️ Absent still renders nothing at all — a person who has
 *    written no rules has no heading, which is not the same as an empty one.
 *  - **dynamic** — {@link dynamicLayer}, rendered from the database at every launch. ⚑ **D-024 · R1
 *    — never into the profile's file**: one profile runs several conversations, so this layer is
 *    composed per conversation and sent with that launch alone ({@link thisConversationSpans}).
 *
 * The fourth, **learned**, is the provider's own memory and is never rendered here (HO-009 §2).
 *
 * ## 🔴 Standing rule 8, which is why the factory half is so short
 *
 * > ⛔ **Factory text INSTRUCTS. It does not DESCRIBE.** Where an agent must know a fact about the
 * > system, that fact comes from the dynamic layer, rendered from data — never asserted as prose.
 *
 * ⚑ **HO-015 §2 names why this is worth more than the eight fixes it came from:** *"You may message
 * any agent in any project"* was true when it was written, false when `374` landed `can_message`,
 * and would go false again the first time somebody narrows a grant. **A sentence that describes a
 * capability drifts every time the capability changes; a sentence rendered from the capability
 * cannot.** The launch text resolves the approved words from the same permission values the
 * rails read. The grant sheet retains its own descriptors and help.
 *
 * ## 🔴 555 · WHAT THIS LAYER GUARANTEES, WHAT IT COSTS WHEN IT IS DROPPED, AND WHEN TO MEASURE
 *
 * ⛔ **`HO-023` §7 is WITHDRAWN.** It read: *"The factory layer propagates verbatim by construction
 * because the app renders it — that is now a safety property, not a convenience."*
 *
 * > ⚑ **`HO-062` §2, replacing it: *The factory layer carries BEHAVIOUR. Safety lives in the
 * > rails.***
 *
 * ⚠️ **Everything that must not be circumvented is enforced at a chokepoint in code** — depth, the
 * approval mode, who may give work, who may interrupt, who may end — and none of it is prose,
 * so no provider mode transition reaches any of it. ⛔ **The guarantee this layer really has is
 * about the HAND-OFF and no further**: one composition, handed to one adapter, written into the
 * provider's own additive field. 🔴 **The limit, on one provider, is stated where the hand-off is**
 * — `StartOptions.systemHint` in `packages/runtime/src/runtime.ts`, and `collaborationModeFor` in
 * the Codex adapter, which measured it.
 *
 * ### ⛔ What a dropped clause costs — verified at `555`, and every row is weaker than HO-062 wrote it
 *
 * ⚑ **The PO's argument is that each loss fails LOUDLY into a mechanism we built, which is a better
 * answer than *we checked and it is fine*.** ⚠️ **It holds, and each row has a limit that was not in
 * the table.** None of the three is silent; none of the three is as loud as stated.
 *
 * | dropped | the mechanism that notices | ⚠️ and the limit on its loudness |
 * |---|---|---|
 * | *you have a parent* | the piece folds to `stalled` from the `turn` row this app already writes, and its giver is pushed `UNDRIVEN_SENTENCES.turn_ended` beside a durable `work_stall_told` | ⛔ **the FOLD is unconditional; the TELLING is not.** `tellIfNobodyHasYet` returns unless that giver is LIVE in this host, and otherwise owes the notice at its next registration — HO-018 §2.2 removed the timeout, so a giver never relaunched is never told. ⚠️ And a conversation's own root is never a folded piece (D-016 · R1): the loudness is agent-to-agent only. 🔴 **609 · the TELLING is now gated a second time**: a holder that is waiting on an answer, on a person or on a worker composes to a `TaskWait`, which carries no cause, so `stalledWithACause` refuses the notice — the fold still writes `stalled` and the push no longer follows it unconditionally. |
 * | *name the piece* | `reply_to_parent` refuses `no-piece-by-that-name` — `permanence: 'permanent'`, `retryable: false` — and `noteRefusal` writes a durable `tool_refused` | ⛔ **the row lands in the CALLER's ledger and in nobody else's**, which `a-refusal-you-can-see.test.ts` asserts as a ruling — so the GIVER learns nothing from it and its loudness is the stall push above, a different mechanism. ⚠️ And an OMITTED piece never reaches our vocabulary on one engine: the MCP SDK rejects the call before the handler runs, so there is no rail and no row. |
 * | its capability facts | it attempts something and a rail refuses it BY NAME, with the grant named and `retryable: false` | ⛔ **loud only on the ATTEMPT branch.** An agent that lost those facts and therefore does NOT attempt produces no rail, no row and no line — and for a dropped instruction that branch is at least as likely as the other. ⚠️ The DISCOVERY readers meet no rail either: `list_agents` answers `outcome: 'ok'` with *"no agents you can see"*. |
 *
 * ### ⚑ HO-062 §3 · the trigger, so this is a deferral and not a shrug
 *
 * > ⛔ **Measure it when an agent starts behaving as though it never read its instructions on
 * > Codex** — not replying, not quoting a task id, not knowing it has a parent — **and doing so
 * > AFTER A MODE TRANSITION rather than from the start.**
 *
 * ⚠️ **Until then: do not measure it and do not build the re-assert** (HO-062 §1). ⛔ The question
 * *does every provider mode preserve our string byte-for-byte* was being asked on behalf of a
 * requirement that does not exist — the security block that looked like it needed one is tooling
 * discipline for the PM's own dispatches, and this app renders none of it to any agent.
 *
 * ## ⛔ What deliberately is NOT here, and the dispatch that owes each
 *
 * See {@link NOT_IN_THE_FACTORY_TEXT}. ⚑ **HO-017 §3's hold has been lifted by `393`**: *"the
 * `reply_to_parent` sentence in the worker text does not ship before S2 supplies the tool and a real
 * task id"* — S2 supplied both, in the commit that added the sentence. ⚠️ `370` §1.1's reason for
 * the hold was that the published inventory was five tools with no reply verb and no task id
 * anywhere, so a finishing clause would have instructed an agent to call something that does not
 * exist — **the model-flakiness failure HO-009 §1 exists to remove, manufactured by us.** ⛔ Four
 * clauses are out and every one is a RULING rather than a queue; that list says which and why.
 *
 * ## 🔴 497 · and the newest test any of this has to pass, because BroBot is GENERIC
 *
 * > ⛔ **If a sentence in factory text would be FALSE for a vacation-planning agent, it does not
 * > belong in factory text.**
 *
 * ⚑ **HO-035.** *"Agents never merge"* and *"PROD is read-only"* were withdrawn as product
 * invariants by the person who set them — **rules from his own working discipline, read as
 * properties of the product.** ⛔ The sentence that carried them is gone from {@link CORE_TEXT}
 * and both words are in {@link NOT_IN_THE_FACTORY_TEXT}. ⚠️ **A person's durable rule is not
 * homeless**: HO-009 §2.2 makes *relayed from user* its own authorization, so it is TOLD and lives
 * in the configured or learned layers. **There was nothing to build.**
 */
export const FACTORY_TEXT_VERSION = 1

/**
 * 🔴 **497 · what a bump would change, measured, because the answer is *nothing*.**
 *
 * ⛔ **This constant has exactly one reader — {@link bundleHeader} — and nothing compares it.**
 * `BUNDLE_MARKER`, the prefix `profile-bundle.ts`'s ownership check compares an existing leaf
 * against, stops before the
 * version; the leaf is rewritten at every launch on both paths (create and resume); no migration,
 * cache, or republish decision reads it. ⚑ **So removing a rule owes no bump**, and neither does
 * adding one: the number is provenance a person reads in the file, not a version anything branches
 * on. ⚠️ `scripts/mutations/377/mutations.py` records the same fact from the other side — *"no row
 * deleting `bundleHeader`'s version number… a row nothing can kill is not carrying its rule."*
 *
 * 🔴 **That is not a defect and it is the reason the marker works.** A version inside the prefix is
 * what would make a leaf written by an older build unrecognisable and therefore REFUSED as
 * somebody else's — the direction HO-016 calls the failure mode. ⛔ **Anyone reaching for a bump to
 * mean something has to give it a reader first.**
 */

/**
 * 🔴 **The provenance line every published leaf begins with, and the whole of what makes a leaf
 * OURS** (377, from `362`'s decision).
 *
 * ⛔ **Ownership is a precondition, not a comment.** `362`: *"if an unknown override already exists,
 * refuse with an actionable conflict… never silently merge or overwrite an unmanaged override"*, and
 * HO-016's own words for why — *"Someone put that file there on purpose; the app disagreeing with
 * them silently is the failure mode."* The publisher compares the first bytes of an existing file
 * against this and refuses everything else.
 *
 * ⚠️ **A marker and not a database record**, because the question is asked about a file on a disk
 * this app does not own — a home restored from a backup, copied between machines, or written by a
 * different build of this app. ⛔ A provenance table would answer *"we do not have a row"* for every
 * one of those and refuse a file that is plainly ours.
 *
 * ⚑ **It carries the version**, so the day the layout changes a leaf written by an older build is
 * still recognisably ours and is still replaced — which is the case a bare marker would get wrong in
 * the opposite direction.
 */
export const BUNDLE_MARKER = '<!-- brobot2:profile-instructions'

/**
 * 🔴 **What the configured layer's section is called, and the ONE place the words live** (582).
 *
 * ⛔ **Two readers and they must not drift:** {@link composeProfileBundle} writes the heading, and
 * {@link bundleHeader} names it in the line that tells whoever opens this file where a durable rule
 * goes. ⚠️ A marker pointing at a heading that had been renamed would be `HO-073` §3.1's defect
 * with the door moved rather than missing, which is the harder version to notice.
 */
export const YOUR_OWN_INSTRUCTIONS_HEADING = 'Your own instructions'

/**
 * The exact first line of a leaf this app wrote at this version.
 *
 * ## 🔴 582 · the second clause stopped being false, and it was corrected rather than kept
 *
 * ⛔ **`HO-073` §3.1:** *"There is no editor for the profile's own instructions… So the app names a
 * door that does not exist, in every agent's prompt."* ⚑ **The door exists now** — an identity's
 * sheet, writing `identity_instruction` — so the sentence is true for the first time.
 *
 * ⚠️ **It was still re-worded, and standing rule 8.1 is why.** *"The profile's own instructions"*
 * named nothing a reader could find: `profile` was this app's word for a BINDING from `369`, the
 * rules live on the IDENTITY, and the section they are rendered into has a name. ⛔ So the line now
 * names {@link YOUR_OWN_INSTRUCTIONS_HEADING}, which is the heading this same function's output
 * carries a few lines down — rendered from the thing rather than asserted about it.
 */
export function bundleHeader(hasOwnInstructions: boolean): string {
  // 🔴 **583 · the second clause was true of one state and false of the other, and the default
  // install is the false one.** ⛔ `582` corrected `HO-073` §3.1's missing door and left the line
  // pointing at a section this function's own output does not contain until somebody writes a
  // rule — `composeProfileBundle` pushes it only when `configured !== ''`, and
  // `the-text-a-child-is-actually-told.test.ts` pins that absence. ⚠️ **A door pointed at an empty
  // wall is `HO-073` §3.1 with the failure moved rather than removed**, and standing rule 8.2 is
  // the general case: a sentence about the system that is wrong makes a reader disbelieve the
  // part that is right.
  //
  // ⚑ **So the clause is RENDERED from whether the section is there**, which is the same
  // discipline the heading itself follows (`YOUR_OWN_INSTRUCTIONS_HEADING`, one place, two
  // readers) — an arm each, and neither arm can go stale while the other is exercised.
  const where = hasOwnInstructions
    ? `which this app has written into the "${YOUR_OWN_INSTRUCTIONS_HEADING}" section below`
    : `which this app writes into a "${YOUR_OWN_INSTRUCTIONS_HEADING}" section here as soon as there are any`
  return `${BUNDLE_MARKER} v${FACTORY_TEXT_VERSION} — generated by BroCrew at every launch. Edits here are replaced at the next launch; durable rules go in this agent's own instructions, ${where}. -->`
}

/**
 * ⛔ **Every clause this text may not contain, and the reason each one is still out** — named, so a
 * census can assert none of them is in the compiled bundle.
 *
 * ⚠️ **A list of WORDS rather than a list of sentences**, because the thing to keep out is the
 * mechanism, not one phrasing of it. `370`'s tables give the sentences; these are what any wording
 * of them would have to contain.
 *
 * ## 🔴 It was `WAITS_FOR_S2`, and S2 has landed — so the name was a schedule that had passed
 *
 * ⛔ **`393` shipped `reply_to_parent` and `list_tasks`, and HO-017 §3's hold lifted with them**:
 * *"the `reply_to_parent` sentence in the worker text does not ship before S2 supplies the tool and
 * a real task id."* ⚑ So three members left this list and the sentence went into the worker text in
 * the same commit — which is what the hold said to do. PE-003 now gives the conditional rule to
 * every agent. The list was renamed rather than kept
 * under a name that would read as *"still waiting"* to the next person who opens it.
 *
 * ⚠️ **None of these is waiting for a dispatch. Every one is a ruling.**
 *
 * ## 🔴 497 · two of them are words a PRODUCT OWNER withdrew, not clauses a dispatch held back
 *
 * ⛔ **`merge` and `production` are here because the sentence they spelled was REMOVED, and a
 * deletion is undone by the next person who finds the sentence sensible.** HO-035 withdrew *"Agents
 * never merge"* and *"PROD is read-only"* as product invariants: they were one person's working
 * discipline, read as properties of the product. ⚑ **A member of this list cannot be undone
 * quietly** — `the-text-a-child-is-actually-told.test.ts` §2 asserts every member is absent from
 * every bundle, so re-adding the sentence is a red test rather than a diff nobody reads.
 *
 * ⚠️ **Some members would be legitimate in ANOTHER layer and some are wrong wherever they appear.**
 * A `summary limit` and a `recorded as a failure` are wrong anywhere; *"never merge"* is a perfectly
 * good rule for a person to give their own agents, and HO-035 says exactly where it goes when they
 * do — *told*, so it belongs to the configured or learned layers. ⚑ **498 · `supervising` is in the
 * second group too, and for a sharper reason**: a person who really is watching may say so to their
 * own agents, and only they can know it. ⛔ **So the census below is asked of the FACTORY half.**
 * The bundles it walks carry no configured text; a person whose own
 * instructions say *never merge* is not in breach of anything and must not be caught by this.
 */
export const NOT_IN_THE_FACTORY_TEXT = [
  /**
   * ⛔ **The bound is a NUMBER, and a number in a template is a number that drifts** (`380`'s
   * lesson on `MAX_DOCUMENT_BYTES`, and HO-006 §4.4's *"the agent never guesses a byte threshold"*).
   *
   * ⚑ **The tool's own refusal names it, from the constant**, so an agent that exceeds it is told
   * the limit and the length it sent at the moment it matters. ⚠️ Writing it here would put the
   * value in two places and make the instruction wrong the day the constant moves — the class of
   * error HO-015 §2 named, arriving as a digit instead of as a claim.
   */
  'summary limit',
  /**
   * 🔴 **S3's ruling, and `393` deliberately did not make it.** A turn that ends with a piece still
   * open derives to `stalled` for `turn_ended`, a fact about the ledger and not a verdict: the app
   * can see that nothing was said and cannot see whether that was a failure.
   *
   * ⛔ **A sentence telling an agent its silence *"is recorded as a failure"* would therefore be
   * false** — the exact shape of the eight sentences HO-015 §2 withdrew, written from a design
   * rather than from the build.
   */
  'recorded as a failure',
  /**
   * 🔴 **HO-035 · withdrawn as a product invariant by the person who set it** (497). *"'Agents never
   * merge' and 'PROD is read-only'… I misread them as properties of the product."*
   *
   * ⛔ **The word rather than the sentence, because a paraphrase of a withdrawn rule is still the
   * rule.** *Never land a branch*, *propose a change and let a person integrate it*, *no PR merge*
   * — every one of them has to reach for this word or say nothing.
   *
   * ⚠️ **It is not that the sentence was false; it is that it was somebody's.** `364` measured that
   * nothing enforced it and the text said so, honestly — that repair was right and it was not
   * enough. ⛔ **A rule only one person's projects have does not belong in the layer every agent of
   * every project reads**, and the test the PO gives for it is *would this be false for a
   * vacation-planning agent*.
   */
  'merge',
  /**
   * 🔴 **The other half of HO-035, and it is out for the same reason and not for a weaker one**
   * (497).
   *
   * ⛔ **`364`'s measurement under it SURVIVES the withdrawal and is written down elsewhere** —
   * *"a conversation can be pointed at a real repository today"* — because that was never about
   * merging or about deployment. ⚠️ It is about where an agent can be pointed, it is still true, and
   * `docs/development.md` ("Where an agent can reach") is where it is kept. ⚑ **Removing the rule and the
   * measurement together would have deleted the only written record of a real reachability**, which
   * is the one way this sweep could have made the product less safe rather than more honest.
   */
  'production',
  /**
   * 🔴 **498 · the word the SECOND factory text asserted a watcher in, and it was false on arrival
   * for one of the two approval modes.**
   *
   * ⛔ **`workspace.ts` shipped *"A person is supervising this session and answers the approval
   * prompts"*** — unhedged, in a file written into the cwd of every conversation that names no
   * folder. ⚠️ {@link CORE_TEXT} says only WHO answers an approval, never that a request is
   * raised or that anybody is there: *in the automatic mode a request may not be raised at all*.
   * Automatic approval mode may run without a person watching or an approval being raised.
   *
   * ⚑ **It is a member and not just a deletion for `086`'s reason.** An agent told a person is
   * watching may act MORE freely than one told the truth, so this is the falsehood in an
   * instruction text whose price is paid in actions. 🔴 **The word alone is not the class**, which
   * is why {@link NO_TEXT_PROMISES_A_WATCHER} exists beside this list: *"somebody is watching"* has
   * no single word it must reach for, and a member can only pin the spelling that shipped.
   */
  'supervising',
  /**
   * Reject factory text that forbids agents from writing outside app-created folders. Agents can use other folders, so this phrase must not reintroduce that restriction through a paraphrase.
   */
  'belongs to somebody else',
] as const

/**
 * 🔴 **498 · no text this app writes may tell an agent that somebody is attending it** — the CLASS
 * behind {@link NOT_IN_THE_FACTORY_TEXT}'s `supervising`, as patterns rather than as words.
 *
 * ⛔ **Standing rule 8 with teeth.** *"Where an agent must know a fact about the system, that fact
 * comes from the dynamic layer, rendered from data — never asserted as prose."* Whether a person is
 * there, whether a request is raised at all, and who answers it are all facts about **this launch**
 * — `auto` and `ask` differ on every one of them — so no template may promise any of them.
 *
 * ⚠️ **A word list cannot hold this one and that is why the shape differs.** `merge` is the word any
 * wording of *"never merge"* must reach for; *"a person is supervising"*, *"somebody is watching"*,
 * *"a human will approve this"* and *"you are not running unattended"* share no such word. ⛔ So the
 * members are PATTERNS, each keyed by the claim it refuses, and the test that walks them plants a
 * sentence that trips every one — a negative is only as strong as its search shape.
 *
 * ## ⚑ What it deliberately does NOT refuse
 *
 * ⛔ **Naming a person as the only party who MAY do something is not a claim that one is there.**
 * *"When this app asks a person to approve a command or a file change, only a person can answer
 * it"* is enforced (`mayAnswerAsAHuman` refuses every non-person sink) and is conditional on the
 * app asking; *"so that a person can grant you one"* names who holds an act. ⚠️ **Both survive
 * every pattern below, and the test asserts they do** — a census that also deleted the true
 * sentences would be the over-correction, not the repair.
 */
export const NO_TEXT_PROMISES_A_WATCHER: Readonly<Record<string, RegExp>> = {
  /** ⛔ The word `workspace.ts` shipped, in every form of it. */
  'is supervising (498)': /\bsupervis(e|es|ed|ing|ion|or|ory)\b/i,
  /** ⚠️ The nearest synonyms, as a state somebody is asserted to be in rather than as a verb. */
  'is watching': /\b(watching|monitoring|observing|overseeing)\b/i,
  /**
   * ⛔ Somebody asserted to be THERE. ⚑ Narrow on purpose: the predicate has to be present tense
   * and the subject a person, so *"a person can grant you one"* is untouched.
   */
  'somebody is present':
    /\b(a|the|some)\s+(person|human|operator|user|somebody|someone)\b[^.]{0,40}\b(is|are|will be)\b[^.]{0,20}\b(there|here|present|available|nearby|online|watching|at the keyboard|standing by)\b/i,
  /** ⛔ Somebody asserted to be ANSWERING — the second half of the withdrawn sentence. */
  'somebody answers the prompts':
    /\b(answers?|answering|will answer|approves?|will approve|responds? to)\b[^.]{0,40}\b(approval|permission)s?\b/i,
  /**
   * ⚠️ The claim in its negative spelling, which is how it comes back. *"You are not running
   * unattended"* promises exactly what *"a person is supervising"* promises.
   */
  'attended or not': /\b(unattended|unsupervised|attended|babysat)\b/i,
  /** ⛔ The idiom, which none of the patterns above would catch on its own. */
  'at the keyboard': /\bat the keyboard\b/i,
}

/**
 * The core every agent gets, whatever its profile or provider: one paragraph per item, said as
 * written. The app is named by {@link PRODUCT_NAME}, so a rename leaves no stale name here.
 */
const CORE_TEXT = [
  `${PRODUCT_NAME} is a desktop app where a person works with Claude and Codex agents. Work is ` +
    'a tree of pieces handled through its tools. The person sees every conversation and can ' +
    'talk to any agent. Each profile shares one memory and home across its conversations; ' +
    "another profile's memory is not yours.",
  'Understand the requested outcome, which may be an answer, draft, plan, action or continuing ' +
    'help. State how to check it; give the next agent enough context. Keep continuing help on ' +
    'one piece until agreed end or stop; start coaching with a small exercise, track the ' +
    'response and adapt. A required answer has no safe default, or a wrong guess would waste ' +
    'the work. Start independent work with stated assumptions; silence never supplies facts or ' +
    'permission.',
  'Keep the judgement and hand off separable, noisy work when the saved time or expertise ' +
    'justifies coordination. A specialist may keep work that is small, tightly connected, ' +
    'covered by an exact installed procedure, or cheaper to do than hand off. Prefer visible ' +
    `${PRODUCT_NAME} agents to provider sub-agents, whose work cannot be revisited here. The ` +
    'owner integrates delegated parts and remains responsible for the whole result. Choose a ' +
    'supported model and offered effort at each handoff; use economical capability for routine ' +
    'work and stronger reasoning when the stakes or complexity warrant it. Respect locked ' +
    'choices.',
  'Use ask_question for decisions or observations; request_action for actions the person must ' +
    'take. Offer a safe default for a decision, never invent an observation. Do not repeat the ' +
    "tracked request in chat. Relay a child's question about work you gave unchanged when only " +
    'the person can answer; reply on its original id. Answer named questions yourself, asking ' +
    'separately if needed.',
  'Address the actual reader. Lead with the answer or needed decision in warm, plain words ' +
    "matching the person's language and register. Keep recaps useful. Keep greetings and " +
    'apologies brief; acknowledge fitting jokes. End with the answer or needed question; no ' +
    'offers or filler. Record routine progress; send only useful milestones or changes that ' +
    'affect the next step. Do not routinely poll active agents. Before one completion message, ' +
    'check required answers, helper results and what was verified; say what remains unchecked. ' +
    'Incomplete work is not done.',
  "Follow the person's scope and stops, and tell your giver. Only the person approves; use " +
    'wishes attributed by your giver or BroBot unless contradicted. ' +
    'Follow current permissions, tool contracts and refusals. Use the assigned folder; create ' +
    'one only for saved work. Follow local conventions; explain conflicts. Keep finished files ' +
    'on the piece so agents can find them. Read your saved methods as scoped, fallible guidance ' +
    'and open only relevant ones. Save tested lessons and person-set conventions when permitted; ' +
    'separate task facts. Use relevant skills; report missing guidance and continue ' +
    'permitted work.',
] as const

/** What a service gets after the core, and no other agent: it serves many callers in turn. */
const SERVICE_TEXT = [
  'You serve many callers through one conversation, one task at a time, in order. Keep one ' +
    'setup for the shared browser, device or account. Verify and update useful setup notes when ' +
    'memory writes are allowed.',
  "Keep each caller's piece, inputs and result separate. Return a brief result to its caller " +
    "with evidence on that piece. Remember reusable setup without mixing callers' work. Leave " +
    'the shared thing tidy for the next task.',
] as const

/** What BroBot gets after the core, and no other agent: it talks with the person. */
const COORDINATOR_TEXT = [
  'Keep your context for the person; route substantive work to one reusable, expertise-named ' +
    'owner, never numbered profiles. You may answer a small question from knowledge or one ' +
    'lookup. A file-changing script or command, however small, needs an owner and independent ' +
    'checker testing copies before the person runs it; read-only explanations may stay in chat.',
  '1. Check related work, files and profiles first. Link exact duplicates to existing pieces; ' +
    'otherwise use take_on_work with a checkable done condition. Continue here, reusing its ' +
    'owner, helpers and project; offer move_to only when asked.\n' +
    '2. Identify facts that materially change the result. Ask only when no safe default exists ' +
    "or a wrong guess would waste work; start independent preparation. Use the person's " +
    'language unless audience or costly rework raises doubt.\n' +
    '3. For saved work, reuse the assigned folder; otherwise create <your working ' +
    'folder>/projects/<short-name>/, replacing placeholders, with a one-line owner README. Give ' +
    'its absolute path.\n' +
    '4. Dispatch the whole outcome with a checkable done condition and inputs. The owner ' +
    'integrates focused parts.\n' +
    '5. After dispatch, name the owner, say the person can contact them, and give material ' +
    "defaults and a link to the saved work's absolute path. End your turn; do not duplicate or " +
    'poll. Check reported stalls. Before completion, message only for needed action, a changed ' +
    'plan or a significant delay.\n' +
    "6. Review the owner's result against the brief; return gaps. For material risk, request " +
    'independent review or make one bounded check. Complete after required answers and results ' +
    'arrive; confirm a new project plainly.',
] as const

// Permissions are a launch snapshot; tools still check current rules.
const GRANTS_AS_THEY_STOOD = `As of this launch, for ${PRODUCT_NAME}'s agent tools (the tools always check the current rules):`

// No permission is invented for an unknown profile.
const NO_IDENTITY_SO_NO_GRANTS =
  "The app cannot identify this conversation's profile, so it cannot list its permissions. Read each tool's response."

// Every profile's memory and saved methods are its own to write.
export const MAY_SAVE_MEMORY = "You may save lessons to your profile's memory and saved methods."

// A conversation with no profile runs in another profile's home, so it saves nothing there.
export const MAY_NOT_SAVE_MEMORY =
  'Do not save memory or saved methods: this app cannot tell which profile this conversation belongs to.'

// The app-wide switch is disclosed independently of profile permissions.
const SPAWNING_IS_OFF =
  '- This app currently blocks creating agents and starting new agent conversations. Giving work to an existing conversation still depends on your permissions.'

// Resolve the approved permission sentences from the launch facts.
function capabilityLines(allowed: ProfileCapabilities, at: ConversationAtLaunch): string[] {
  const lines = [
    allowed.canMessage === 'any'
      ? '- You may message any conversation.'
      : '- You may not send messages to other conversations.',
    allowed.canAssignWork === 'any'
      ? '- You may give work to any agent, through your own conversation with it.'
      : '- You may not give work to other agents.',
    allowed.canCreateAgents === 'any'
      ? '- You may create agents and give them their initial rules.'
      : '- You may not create agents.',
    {
      none: "- You may not change or propose other agents' standing rules.",
      propose:
        "- You may propose other agents' standing rules; the person must approve before they are saved.",
      relay:
        "- You may propose rules for approval, or save a person's rule for another agent when they gave it in this conversation.",
    }[allowed.canWriteRules],
  ]
  const remaining = allowed.maxDepth - at.depth
  if (allowed.canAssignWork === 'any' && remaining <= 1) {
    lines.push(
      remaining > 0
        ? "- You may give work one level below this conversation; the helper's own limit decides what it may give."
        : '- You have reached your delegation limit and cannot give work from this conversation.',
    )
  }
  return lines
}

/**
 * 🔴 **Everything the dynamic layer is rendered FROM** — every field typed, and every absence a real
 * value rather than a missing one.
 *
 * ⛔ **`370` §1's ruling on each token is in the field it became.** `{name}` is absent because
 * HO-015 §1.4 ruled it out — *"BroBot will learn his name in the first conversation"*.
 * `{profile_instructions}` is {@link configured}, the `configured` layer's seam, and not a brace in
 * a template — `582` is what feeds it.
 */
export interface InstructionContext {
  /**
   * The identity this conversation runs as, folded — what the grant sheet lists it under — or
   * `null` when this app cannot name one.
   *
   * ⛔ **`null` is reachable and must not be folded to the default**, found reviewing this diff. An
   * ADOPTED row carries no profile id (see {@link SessionStore.find}); such a session is REOPENED in
   * the default profile's home, and `reopenSession` folds it that way for the directory — but the
   * SLOT keeps the null, so `374`'s rails and `341`'s treat it as an identity they cannot name.
   * ⚠️ Printing *"you are running as <the default slug>"* would therefore say it is BroBot while every
   * gate in the app says it is nobody, which is `086` in the direction that reassures.
   * ⛔ **620 · that slug was spelled `default` here and `592` renamed it** — ⚑ which turns the
   * sentence's own point inside out, because `default` is now nobody's name at all.
   */
  readonly profileSlug: string | null
  readonly displayName?: string | null
  /** The profile's saved methods as this launch read them; no section when not given. */
  readonly savedMethods?: SavedMethodsReading
  /** The real controller's current catalogue; null/absent means no Plugins section. */
  readonly plugins?: readonly PluginInstructionEntry[] | null
  /** Where this conversation is working — the RESOLVED cwd. */
  readonly cwd: string
  /**
   * 🔴 **The conversation that started this one, as a sentence names it, or `null` for one a person
   * started** (`370` §3.1) — ⚑ **D-016 · commit 7 · R3**: its agent's name and the piece it owns
   * (`RuntimeHost.nameByItsWork`), `Ada (the owner of W1 · Bakery website)`.
   *
   * ⛔ **It replaced the parent's full `sess_<uuid>`**: an agent is named by the piece it owns, and
   * that piece's label is what every door that takes an agent takes (R1) — a slug names a reusable
   * profile rather than one conversation, and a display name alone is non-unique.
   */
  readonly startedBy: string | null
  /**
   * 🔴 **How deep this conversation sits — HO-005 §2 Q3, and the number the rail will spend**
   * (544).
   *
   * ⛔ **A conversation a person created is `0`**, which is the ruling's own counting and not this
   * file's reading of it. ⚑ `RuntimeHost.instructionContext` computes it as the length of the chain
   * above it — `ancestorsOf(<its parent>).length + 1` — and `give_work`'s rail counts the same
   * depth on `work` (D-016): the two agree because only a conversation's parent gives it work, and
   * work a person gave — a root, or a piece taken on for them (commit 6) — counts as 0 wherever it
   * hangs, so every piece it holds sits at its chain's depth.
   *
   * ⚠️ **Not nullable, and the state that would have wanted a `null` is already answered one
   * section down.** An adopted row carries no profile, so {@link InstructionContext.capabilities}
   * is `null` for it and no grant line is drawn at all — see {@link NO_IDENTITY_SO_NO_GRANTS}.
   * ⛔ A conversation this app CAN place always has an answer here, and a bound the reader has to
   * position itself within is the one thing this field exists to stop shipping.
   */
  readonly depth: number
  /**
   * The resolved grants — exactly what the rails read.
   *
   * 🔴 **`null` means this app cannot NAME the identity, and no longer means *the row is not
   * written yet*** (485). ⛔ {@link RuntimeHost.instructionContext} used to pass the store's `null`
   * straight through on a first launch, so the one conversation that most needs its grants — a
   * fresh install's first — was told nothing about them and branched as though it held none. ⚠️
   * Before that launch writes its row, the one default set answers, which is what the new row will
   * say; see that method.
   */
  readonly capabilities: ProfileCapabilities | null
  /**
   * 🔴 **Whether this app will start a new conversation at all, for anybody** (485) —
   * `app_policy.spawning_enabled`, read at launch.
   *
   * ⛔ **Not a grant, and it is on this object rather than inside `capabilities` for that reason.**
   * It is one row for the whole app; a grant is a column on an identity. ⚑ It is here because a
   * grant it makes inert is a sentence this app cannot keep — see {@link SPAWNING_IS_OFF}, which is
   * the only thing that reads it.
   */
  readonly spawningEnabled: boolean
  /** It is a service's profile while services are on: it gets the service text after the core. */
  readonly isAService?: true
  /**
   * 🔴 **D-016 · the conversation's own root — the work a person gave it** (plan §3.10): its label,
   * or `'not-yet-numbered'` on a first launch — the root is written with the conversation's row,
   * after these instructions — or `null` for a conversation another one started, which owns none.
   *
   * ⚑ It is what the one conditional line about naming the root is rendered from, so the line is
   * said only to a conversation that has a root, with its label when it has one.
   */
  readonly root: string | 'not-yet-numbered' | null
  /**
   * ⚑ **The configured layer's seam** — the person's own text.
   *
   * ⛔ **Fed by `RuntimeHost.instructionContext` from `SessionStore.configuredLayerFor`** (582),
   * which reads the newest version of this identity's own instructions. ⚠️ Absent renders nothing
   * at all, not an empty heading — and *this identity has no rules* and *its newest version is
   * blank* both arrive here as `null`, because `configuredLayerOf` decides that once rather than
   * leaving a `trim()` in two files.
   */
  readonly configured?: string | null
  /** Other conversations of this profile, named and dated as of this launch. */
  readonly others: OtherConversations
  /** Build metadata retained for callers; it is not printed in this block. */
  readonly build?: TheBuildRunning | null
}

/** ⚑ **F006** — {@link InstructionContext.build}: the window's build chip, in one record. */
export interface TheBuildRunning {
  /** The short id: a commit's first seven characters, `dev`, or `unknown`. */
  readonly id: string
  /** The full commit, `''` when none describes the build. */
  readonly commit: string
  /** Whether the tree it was built from had uncommitted changes. */
  readonly dirty: boolean
  /** How many database migrations have been applied, or `null` when that could not be read. */
  readonly schema: number | null
}

/**
 * ⚑ **F006 · which build is running, said to an agent as the window's title bar says it** — the
 * chip's id, schema and uncommitted mark, and its hover's commit, or why there is no commit. ⚠️ A
 * development build hot-reloads its window only: its main process runs what it started with.
 */
export function theBuildRunningSaid(build: TheBuildRunning): string {
  const schema = build.schema === null ? '' : ` Its database schema is ${String(build.schema)}.`
  if (build.id === BUILD_IS_DEV) {
    return `- This app is a development build (\`${BUILD_IS_DEV}\`), run from a working tree, so no commit describes it; its main process runs the code as it was when the app started.${schema}`
  }
  if (build.commit === '' || build.id === BUILD_IS_UNRECORDED) {
    return `- This app's build did not record a commit (\`${build.id}\`).${schema}`
  }
  const tree = build.dirty
    ? ' with uncommitted changes, so what runs is not exactly that commit'
    : ''
  return `- This app is build \`${build.id}\`, built from commit \`${build.commit}\`${tree}.${schema}`
}

/**
 * 🔴 **D-024 · R1 — the most OTHER conversations of a profile one launch lists**, newest activity
 * first. ⚑ A profile runs a handful at once (two Alis on 2026-09-30, a few BroBots), and one line
 * each is ~250 characters: five is ~1.3 KB on every request of the conversation, the ceiling worth
 * paying. ⛔ The rest are counted, never dropped in silence.
 */
export const OTHER_CONVERSATIONS_SHOWN = 5

export interface OtherConversation {
  readonly label: string
  readonly title: string
  readonly lastActiveAt: number | null
}

export interface OtherConversations {
  readonly shown: readonly OtherConversation[]
  readonly more: number
}

function anotherConversationLine(other: OtherConversation): string {
  const named = `  - ${other.label} · ${other.title || 'Untitled conversation'}`
  const at = other.lastActiveAt
  if (at === null || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) {
    return `${named} — last activity unknown.`
  }
  const wall = localFields(at)
  if (!Number.isFinite(wall.year) || wall.year < 0 || wall.year > 9999)
    return `${named} — last activity unknown.`
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${String(wall.year).padStart(4, '0')}-${pad(wall.month + 1)}-${pad(wall.date)}`
  const time = `${pad(wall.hours)}:${pad(wall.minutes)}`
  const civil = new Date(0)
  civil.setUTCFullYear(wall.year, wall.month, wall.date)
  civil.setUTCHours(wall.hours, wall.minutes, wall.seconds, 0)
  const offset = (civil.getTime() - Math.floor(at / 1000) * 1000) / 1000
  const absolute = Math.abs(offset)
  const seconds = absolute % 60
  const zone =
    offset === 0
      ? 'UTC'
      : `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(absolute / 3600))}:${pad(Math.floor(absolute / 60) % 60)}${seconds === 0 ? '' : `:${pad(seconds)}`}`
  return `${named} — last active ${date} at ${time} ${zone}.`
}

/**
 * 🔴 **What is true of THIS conversation, rendered from data at every launch.**
 *
 * ⛔ **Every sentence here is derived; not one is written into a template.** That is standing rule 8
 * in the one place it is hardest to keep, because these are exactly the facts a draft would rather
 * assert.
 */
function dynamicLayer(context: InstructionContext): string[] {
  const lines: string[] = [
    `- Your working directory is \`${context.cwd}\`.`,
    '- This folder persists: files you leave here are still here in later conversations.',
    '- Ask when something is destructive or ambiguous.',
  ]
  if (context.startedBy !== null) {
    // 🔴 **PROVENANCE, never delegation** (`370` §3.1, HO-015 §3) — *"which is durable and true,
    // rather than delegation, which is neither."*
    //
    // ⛔ **And the second sentence is `373`, which made `370`'s own cold-resume wording stale.**
    // `370` recommended *"No agent command delegation is restored on this resume; no agent
    // currently commands this session"*, and HO-015 §4 refused to ship it — *"I do not want to ship
    // it, because it describes a defect as though it were the design."* `373` then fixed the defect:
    // `resumeSession` re-derives `commandedBy` from the provenance row, so the parent commands its
    // child across a restart. ⚠️ **There is therefore no cold-resume variant of this paragraph at
    // all** — the sentence is the same on both paths because the fact now is.
    //
    // ⚑ **D-016 · commit 7 · R3 — named by the piece it owns**, never by its id: the label is the
    // address every door that takes an agent takes. ⚠️ Fixed at this launch — the direction line
    // names a sender by the piece it owns when it writes, which can be a newer one
    // (`turn-origin.ts`).
    lines.push(
      `- This conversation was started by ${context.startedBy}. That conversation can send you ` +
        'messages, and can still do so after this app has been restarted.',
    )
  }
  // 🔴 **D-016 · the one conditional fact about the root** (plan §3.10): a conversation a person
  // started owns a root, and it is the conversation that names it — after what the person asked for.
  // ⚑ `update_work` infers the piece when this conversation holds only its root, so the line needs
  // no label to be followed on a first launch.
  if (context.root !== null) {
    lines.push(
      context.root === 'not-yet-numbered'
        ? "- Your conversation has its own work. Use list_tasks for its label. If untitled, name it with update_work after the person's request."
        : `- Your conversation's work is ${context.root}. If untitled, name it with update_work after the person's request.`,
    )
  }
  // Omit the list when this profile has no other conversation to point to.
  if (context.others.shown.length > 0) {
    lines.push(
      '- Other conversations of this profile, as of this launch. Point the person to the right conversation:',
      ...context.others.shown.map(anotherConversationLine),
    )
    if (context.others.more > 0) {
      lines.push(`  - and ${String(context.others.more)} more.`)
    }
  }
  return lines
}

/**
 * 🔴 **One section of the bundle, and WHOSE it is** (583, `HO-073` §4).
 *
 * ⛔ **The layer is assigned where the section is BUILT, never parsed back out of the text.**
 * `composeProfileBundle` has always known which of `HO-009` §2's layers each `push` belonged to —
 * its own numbered comments say so — and threw that away by flattening to strings. ⚠️ **A
 * renderer splitting the compiled file on `## ` headings would be a second derivation of a fact
 * this function already holds**, and the two would come apart the first time a heading moved. ⛔
 * It could not even be written: `YOUR_OWN_INSTRUCTIONS_HEADING` lives in the main process and
 * `tsconfig.web.json` admits only `src/renderer/**` and `src/shared/**`, so the renderer's copy
 * would be a retyped literal.
 */
interface BundleSection {
  readonly whose: WhoseText
  /**
   * The `## …` line, or `null` for the file's own head — the marker and `# Your instructions`,
   * which name the file rather than say anything to the model.
   */
  readonly heading: string | null
  /** The paragraphs under it, joined by a blank line. Never empty. */
  readonly blocks: readonly string[]
}

/** What separates one section of the bundle from the next. */
const SECTION_SEPARATOR = '\n\n'

/** The core and BroBot's addition, when a text pack gives them in place of the shipped ones. */
export interface FactoryTextGiven {
  readonly core: readonly string[]
  readonly coordinator: readonly string[]
  /** What a service gets after the core; absent, the shipped text. */
  readonly service?: readonly string[]
}

/** Profile identity, shared rules and the person's configured instructions. */
export type ProfileBundleContext = Pick<InstructionContext, 'configured' | 'isAService'> &
  Partial<PromptIdentity> & { readonly factoryText?: FactoryTextGiven }

/**
 * 🔴 **The profile's file for one launch as its SECTIONS: `factory + configured`, each carrying
 * whose it is** (HO-009 §2, 583).
 *
 * The factory section uses one set of situation-based rules for every agent. The configured section
 * follows the person's text. ⚑ **D-024 · R1 — the dynamic sections are
 * {@link thisConversationSections}**, composed for one conversation and never written here.
 */
function bundleSections(context: ProfileBundleContext, provider: Provider): BundleSection[] {
  const configured = context.configured?.trim() ?? ''
  const sections: BundleSection[] = [
    // ⚑ **The file's own head.** ⛔ `factory` rather than a fourth thing: the marker and the title
    // are generated by this release and nobody may edit them, which is the whole of the test.
    {
      whose: 'factory',
      heading: null,
      blocks: [
        bundleHeader(configured !== ''),
        ...(providerValue(provider, { claude: false, codex: true })
          ? [
              agentPreamble({
                profileSlug: context.profileSlug ?? null,
                displayName: context.displayName,
              }),
            ]
          : []),
        '# Your instructions',
      ],
    },
  ]

  // 1 · FACTORY — the core for every agent, and BroBot's addition after it.
  const factory = context.factoryText ?? { core: CORE_TEXT, coordinator: COORDINATOR_TEXT }
  sections.push({
    whose: 'factory',
    heading: '## How you work',
    blocks: [
      ...factory.core,
      ...(context.profileSlug === DEFAULT_PROFILE_ID ? factory.coordinator : []),
      ...(context.isAService === true ? (factory.service ?? SERVICE_TEXT) : []),
    ],
  })

  // 2 · CONFIGURED — the person's own text, fed since `582`. ⛔ Nothing at all when they have
  // written none, and an empty heading is worse than no heading (086 in the other direction).
  // ⚑ **The heading is {@link YOUR_OWN_INSTRUCTIONS_HEADING}**, so the marker line at the top of
  // this file's own output can name the place a person's rules go without the two drifting apart.
  if (configured !== '') {
    sections.push({
      whose: 'configured',
      heading: `## ${YOUR_OWN_INSTRUCTIONS_HEADING}`,
      blocks: [configured],
    })
  }
  return sections
}

/**
 * 🔴 **D-039 · the tools' own instructions, for a provider whose catalogue cannot hold them** — the
 * toolset's server name and its `instructions`, as `toolsToldInTextFor` gives them.
 */
export interface ToolsToldInText {
  readonly server: string
  readonly instructions: string
}

/**
 * 🔴 **D-024 · R1 — what is true of THIS conversation, and what it has been granted, as SECTIONS**
 * (HO-009 §2's dynamic layer).
 *
 * ⛔ **Its own composition, sent with this conversation's launch and written into no file.** The
 * profile's file is one per profile and every launch of the profile rewrites it, so a conversation
 * that read its facts from there could read a sibling's. ⚑ The grants are here and not in the file
 * because one of them is said for this conversation's depth.
 *
 * 🔴 **D-039 · and, first, how to use the tools — when `tools` is given**: on Codex, whose catalogue
 * is one namespace with a capped description, so the instructions Claude is handed with its
 * catalogue reach a Codex model only here — in front of the first message of every life, and again
 * after a compaction or a turn its provider never began (`HostedSession.firstTurnLead`).
 * ⚑ `factory`: versioned with the release and editable by nobody. ⛔ Never for Claude, which would
 * read them twice.
 */
function thisConversationSections(
  context: InstructionContext,
  tools?: ToolsToldInText,
): BundleSection[] {
  const sections: BundleSection[] = []
  if (tools !== undefined) {
    sections.push({
      whose: 'factory',
      heading: `## The ${tools.server} tools`,
      blocks: [tools.instructions],
    })
  }
  // 3 · DYNAMIC — what is true of this conversation, and what it has been granted.
  sections.push({
    whose: 'dynamic',
    heading: '## This conversation',
    blocks: [dynamicLayer(context).join('\n')],
  })
  // 🔴 **The heading is UNCONDITIONAL now** (485). ⛔ The question *what am I allowed to do* has an
  // answer in every state, and omitting the section was the one state that answered it with
  // nothing — see {@link NO_IDENTITY_SO_NO_GRANTS}.
  const granted: string[] = [
    context.capabilities === null ? NO_IDENTITY_SO_NO_GRANTS : GRANTS_AS_THEY_STOOD,
  ]
  if (context.capabilities !== null) {
    granted.push(capabilityLines(context.capabilities, { depth: context.depth }).join('\n'))
  }
  // ⛔ **Inside the section and after the lines, because it is the bound on them** — and in the
  // no-identity branch too, since a switch that is off is off for a conversation this app cannot
  // place as much as for one it can.
  if (!context.spawningEnabled) granted.push(SPAWNING_IS_OFF)
  granted.push(context.capabilities === null ? MAY_NOT_SAVE_MEMORY : MAY_SAVE_MEMORY)
  sections.push({ whose: 'dynamic', heading: '## What you may do', blocks: granted })
  // The index is composed here from the fields of its well-formed lines, never sent as written.
  if (context.savedMethods !== undefined) {
    sections.push({
      whose: 'dynamic',
      heading: `## ${SAVED_METHODS_HEADING}`,
      blocks: savedMethodsParagraphs(context.savedMethods),
    })
  }
  if (context.plugins != null) {
    sections.push({
      whose: 'dynamic',
      heading: `## ${PLUGINS_HEADING}`,
      blocks: pluginInstructionParagraphs(context.plugins),
    })
  }
  return sections
}

/** The heading the profile's saved methods are given under, on both providers. */
export const SAVED_METHODS_HEADING = 'Saved methods'

/** One section as it appears in the file: its heading, then its paragraphs. */
function renderSection(section: BundleSection): string {
  const parts = section.heading === null ? section.blocks : [section.heading, ...section.blocks]
  return parts.join(SECTION_SEPARATOR)
}

/**
 * 🔴 **A composition — the profile's file, or this conversation's own text — and where each of its
 * layers sits inside it** (583; two compositions since D-024 · R1, one walk).
 *
 * ⛔ **One walk produces both**, which is `composeSystemHint`'s own rule (`blockHeader` is *"ONE
 * string that both the emitter and the accountant call"*) applied to a different pair: a span list
 * computed by a second pass over the text would be a second reading of the same headings, and the
 * emitted file and the map of it could then disagree about where a section starts.
 *
 * ⚑ **The separators and the trailing newline are INSIDE the spans**, each carried by the section
 * it follows — so the spans tile the string with no gaps, and `slice`ing them all and joining
 * returns the file. ⚠️ That is the invariant `the-text-a-child-is-actually-told.test.ts` asserts,
 * and it is what makes a section nobody gave a layer to impossible rather than invisible.
 */
function spansOf(sections: readonly BundleSection[]): {
  readonly text: string
  readonly spans: readonly InstructionSpan[]
} {
  const spans: InstructionSpan[] = []
  let text = ''
  sections.forEach((section, index) => {
    const start = text.length
    const last = index === sections.length - 1
    text += `${renderSection(section)}${last ? '\n' : SECTION_SEPARATOR}`
    spans.push({
      whose: section.whose,
      // ⚑ **Without the `## `**, because this is the word a person reads on the sheet and the
      // markdown is the file's business. ⛔ Sliced rather than re-derived from the source string.
      heading: section.heading === null ? null : section.heading.replace(/^#+ /, ''),
      start,
      end: text.length,
    })
  })
  return { text, spans }
}

/** ⚑ **The profile's file and where each of its layers sits** — {@link spansOf} its sections. */
export function profileBundleSpans(
  context: ProfileBundleContext,
  provider: Provider = 'claude',
): {
  readonly text: string
  readonly spans: readonly InstructionSpan[]
} {
  return spansOf(bundleSections(context, provider))
}

/**
 * 🔴 **D-024 · R1 — this conversation's own text and where each of its sections sits** —
 * {@link spansOf} {@link thisConversationSections}. ⚑ The reader composes it after the files, under
 * a header of its own, on both providers — Claude's system prompt carries it, and on Codex it rides
 * the first message of each life (`SessionLaunchRead.firstTurnLead`). ⚑ **D-039** — with the tools'
 * instructions first when `tools` is given: `toolsToldInTextFor`, which gives them on Codex alone.
 */
export function thisConversationSpans(
  context: InstructionContext,
  tools?: ToolsToldInText,
): {
  readonly text: string
  readonly spans: readonly InstructionSpan[]
} {
  return spansOf(thisConversationSections(context, tools))
}

/**
 * 🔴 **The profile's file for one launch: `factory + configured`, from one source into one string**
 * (HO-009 §2).
 *
 * ⛔ **One compiler, two publishers.** `362` §1.4 measured that the two providers need the same text
 * by different routes — Codex reads a durable leaf natively, Claude receives an app-read snapshot
 * through its preset — so the DIALECT is the publisher's problem and the TEXT is this function's.
 * ⚠️ A per-provider branch here is what would make one provider's agent a different agent, which is
 * exactly the *"instructions are shared across providers; memory is not"* seam HO-009 §6 draws.
 *
 * ⚑ **Guaranteed non-empty by the header**, which is what Codex's `AGENTS.override.md` requires:
 * `362` §2 measured that an EMPTY profile-global override does not shadow `AGENTS.md` — it falls
 * through — so a bundle that could compile to nothing would silently stop being the file the
 * provider reads.
 *
 * ⚠️ **583 · the text is now a projection of {@link profileBundleSpans}** rather than its own walk.
 * ⛔ A caller that needs the layers takes the spans; a caller that needs the file takes this — and
 * there is no second composition for the two to disagree about. ⚑ **D-024 · R1 — what is true of
 * one conversation is not in it**: that is {@link thisConversationSpans}, sent with its launch.
 */
export function composeProfileBundle(
  context: ProfileBundleContext,
  provider: Provider = 'claude',
): string {
  return profileBundleSpans(context, provider).text
}
