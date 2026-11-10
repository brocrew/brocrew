import type { InstructionSpan } from './whose-text'
import type { InjectedInstructionKind } from './injected-instruction-kind'

export type { InjectedInstructionKind } from './injected-instruction-kind'

/**
 * One block of text **this app appended to the model's system prompt** (158).
 *
 * Expose each supplied instruction's source and text separately so the UI can show exactly what custom context reaches the agent.
 *
 * ⚠️ **`text` is what actually went to the model**, after any truncation, not what is on disk now.
 * The pair with {@link truncated} is the point: a file that was cut short must not read as a file
 * that was short.
 */
export interface InjectedInstruction {
  kind: InjectedInstructionKind
  /** The file it was read from, absolute — where it came from, so the claim is checkable. */
  path: string
  /** The exact text appended, verbatim. */
  text: string
  /** How many bytes of it were appended. */
  bytes: number
  /** True when the byte cap cut the file short — the model got this much and no more. */
  truncated: boolean
  /**
   * 🔴 **When THIS APP read the file whose bytes are in {@link text}** (599, `HO-084` §3 as
   * narrowed by `HO-087` §1) — epoch milliseconds, this machine's wall clock.
   *
   * > ⚑ **The ruling:** *"Whatever BroBot itself appends says WHEN it was read, and is RE-READ on
   * > resume rather than replayed."*
   *
   * ## ⛔ It is a time of OUR READ. It is not a time of the FILE.
   *
   * ⛔ **Not `mtime` and not `atime`.** Every other field on this row is a property of the file, so
   * a time sitting among them is read as one unless it says otherwise: this number is the moment
   * `readSessionInstructions` asked the filesystem for these bytes, and it would be the same number
   * for a file nobody has touched since 2001. `when-we-read-it-not-when-it-changed.test.ts` plants
   * one file stamped decades in the past and one stamped decades in the future in a single launch
   * and pins both rows to the launch's own window.
   *
   * ## ⚑ What it BUYS, which is one documented cost made visible
   *
   * ⛔ **`readSessionInstructions` runs on every start AND every resume** — the live-profile
   * semantic `158` §2 ruled — and it says the price out loud: *"a file changed mid-conversation
   * does not take effect until the next launch."* ⚠️ **That cost is real and was invisible.** A
   * person who edits an instruction file while a conversation is running has no way to see that
   * the running conversation is still on the older text; {@link TOLD_IS_THE_LAST_LAUNCH} says
   * *"from the files as they were then"* and has never been able to say when *then* was. ⚑ This
   * is that number, per file, so the comparison a person actually makes — *my edit, against this
   * read* — is one they can make.
   *
   * ## ⚠️ Stamped on the ASK, and the direction of its error is the reason
   *
   * ⛔ **Taken immediately BEFORE the read, never after it** (`stamp-a-measurement-when-you-ask-not-when-it-answers`).
   * The true read happens somewhere inside `[ask, answer]`, so one of the two ends has to be
   * chosen and each is wrong in a different direction. ⚑ **The early stamp can only make an edge
   * edit look LATER than the read** — *your change is not in this conversation* — which is the
   * answer that sends somebody to relaunch. 🔴 **The late stamp would make an edit that landed
   * mid-read look EARLIER than it** — *your change is in* — about text the model never got, which
   * is the confident-wrong direction criterion 18 exists to prevent.
   *
   * ## 🔴 PER FILE, and a launch-level number would be wrong in that same direction
   *
   * ⛔ **This reader does real I/O between files**, so a file written between two of its reads
   * genuinely lands in one and not the other — which is exactly what {@link WorkspaceReading.readAt}
   * can say is impossible of its own counts and this cannot. ⚠️ **One number for the launch would
   * therefore have to be the first read's or the last's**, and the last's would date the earliest
   * file later than it was really read: the same lie as the late stamp, one level up.
   *
   * ## ⛔ On the rows this app APPENDED, and on no others
   *
   * ⚠️ **Absent on every {@link SessionInstructions.agentMemory} row**, and the asymmetry is the
   * meaning rather than an omission — the shape {@link reach}, {@link link} and {@link sections}
   * already have. Those files the PROVIDER loaded, at a moment of its own choosing, before any
   * BroBot code ran; this app reads them only so they can be shown. ⛔ **A read time on one of
   * those would date OUR display read and read as the provider's**, which is `086`'s provenance
   * rule broken by a number. 🔴 **`HO-087` §2 queued that surface's own read-time separately, and
   * it landed:** `601` wrote the different sentence (*"when this app looked"*) and `604` supplied
   * the number as {@link MemoryLoadedEvent.lookedAt} — ⚠️ **on the launch ROW, not on these items**,
   * which is what keeps the asymmetry above meaning what it says.
   *
   * ⚠️ **Optional because the type is shared with that list and because an older host sends the
   * key missing** (`317`'s rule, and `agentMemory`'s). ⛔ **What keeps it from going quietly
   * absent on an appended row is not the type** — it is
   * `when-we-read-it-not-when-it-changed.test.ts` §1, which asserts the split over a real launch
   * with several kinds on the chain and with the memory store beside it.
   *
   * ## ⛔ It is NOT in the prompt, and that was a decision
   *
   * 🔴 **Nothing appended to the model carries it.** {@link SessionInstructions.composed} is a
   * function of the files' paths, kinds and bytes and of NO CLOCK, and must stay one: a stamp in
   * `blockHeader` would spend per-file bytes out of {@link INSTRUCTION_TOTAL_CAP} on provenance no
   * rail reads, and would make the appended text differ on every launch of a tree nobody touched.
   * ⚑ §3 of that same test pins it — two reads of one tree, identical `composed`, different
   * `readAt`. ⚠️ **Measured, because `594` asked for it**: the clause costs 27 B per file, which is
   * +27 B on the default-cwd launch `594` measured (2.2% of the 1,216 B it saved), +108 B on a
   * four-kind chain and +189 B on a seven-file one.
   */
  readAt?: number
  /**
   * 🔴 **Where {@link path} really led, when it did not lead where this app derived** (170 §2).
   *
   * ⚑ **The agent's memory has carried this since 170 §2**: the PROVIDER loads it and follows links
   * with `stat` before BroBot is asked anything, so refusing it removed the row from this panel and
   * nothing from the model's prompt. 🔴 **Since `733` every file BroBot APPENDS carries it too.**
   * Until then a redirected appended file was refused outright, and the reason was the credential it
   * might lead to; R93 removed that reason, the walk follows links as the CLI does, and a file
   * followed somewhere else says where.
   *
   * ⚠️ **So it is followed, and the redirection is stated.** Undefined is the ordinary case and
   * renders nothing; a value means the text above came from this path, and the user is the only one
   * who can decide whether that is a surprise.
   */
  link?: string
  /**
   * 🔴 **Whether this text is in the prompt, or only on disk** (317 §2.2).
   *
   * ⛔ **Only the `agent-memory*` kinds carry it** (two at 317, three at 322), and the asymmetry is
   * the meaning: every other item on this list is text BroBot appended, so "did the model get it"
   * has one answer and the field would be noise. A memory STORE does not — 312 measured Codex injecting exactly one of
   * its files (`memory_summary.md`) and leaving the rest for the four `memories__*` tools to fetch
   * if the model decides to.
   *
   * ⚠️ **`'on-request'` is a statement about AVAILABILITY, never about what the model has read.**
   * 009's rule and 305's defect: a panel that renders a file the agent has never opened as
   * something it knows is worse than one that shows nothing. Undefined on every other kind, and the
   * renderer draws nothing for it.
   */
  reach?: 'prompt' | 'on-request'
  /**
   * 🔴 **Which part of this file is whose** (583, `HO-073` §4) — half-open ranges into
   * {@link text}, in order, tiling it exactly.
   *
   * ⛔ **Only ever on `profile-instructions`, and the asymmetry is the whole reason the field
   * exists.** Every other item on this list has one author for the whole file; the compiled
   * bundle is `factory + configured` in one file (`HO-009` §2), so a sheet that groups
   * by WHOSE has to be able to split it — and `HO-073` §4's finding is that it currently cannot:
   * *"All three currently read as one undifferentiated wall."*
   *
   * ⚠️ **Absent rather than guessed.** The composer publishes these with the text it composed;
   * a reader that finds the file on disk changed under it attaches none, and the renderer draws
   * the row whole and says it could not tell — which is `438`'s fail-closed rule rather than a
   * fallback onto the most reassuring answer. ⛔ An older host sends the key MISSING, so the
   * renderer normalises rather than trusting the type (`317`'s rule, and `agentMemory`'s).
   */
  sections?: readonly InstructionSpan[]
}

/**
 * A file on the chain this app **did not send**, and why (158).
 *
 * ⚑ Reported rather than skipped in silence: an absence with a reason is the only version of it a
 * person can act on (086, in the other direction). 🔴 It used to open with *"a `CLAUDE.md` that is
 * a symlink is the exact shape of the attack the reader exists to refuse"* — a link to a credential,
 * planted in the cwd. `733` removed that refusal (R93): a link is followed now, and `symlink` is a
 * chain of links that loops.
 */
export interface RefusedInstruction {
  path: string
  /**
   * What was wrong: `symlink` (since `733`, a loop of links), `not-a-regular-file`, `too-large`,
   * `not-utf8`, `unreadable` — or `over-budget`, `dangling-link`, or, since `733`, `same-file` (a
   * second name for a file already sent). (`733`'s `personal-home` — a link that landed in the
   * person's own instructions — went in `736`: the CLI follows such a link, measured.)
   *
   * ⛔ **`over-budget` is the one that is not the reader's** (187 §2, from 168 M2). The file was
   * perfectly readable; the total cap ran out before it. It produced no row at all until 187, which
   * made a chain that hit the cap indistinguishable from a chain that did not have the file — the
   * exact silence 170 ruled out for a source declined for any other reason.
   *
   * ⛔ **`dangling-link` is the other one** (314 §3), and it is not a refusal either: nothing
   * declined to read anything, the far end of a link is simply not there. It exists because the
   * provider's `stat` and this app's both answer ENOENT for a broken link, and `absent` is silent —
   * so a profile whose memory index pointed into `/tmp` lost its memory at the next reboot and this
   * panel said nothing at all. See `brokenMemoryLink` in the main process.
   */
  reason: string
  /**
   * 🔴 **Where a `dangling-link` pointed** (314 §3) — the one thing `realpath` cannot tell you about
   * a broken link, and the only thing worth printing about one. ⚑ Since `733`, also where a
   * `same-file` link LANDED.
   *
   * ⚠️ Undefined for every other reason, and the renderer draws nothing when it is absent.
   */
  link?: string
}

/**
 * 🔴 **Which layer an instruction file belongs to** (356 §3, from 357's verdict).
 *
 * ⛔ **`profile` and `project` answer different questions and a panel that blurs them lies.** The
 * profile layer says *who this agent is* and lives in the app-owned provider home; the project
 * layer says *what applies in this worktree* and lives on the cwd chain. 357 measured a session
 * whose only instruction file was the project's `AGENTS.md` and found the panel presenting it as
 * though the selected profile owned it — *"it must never be presented as proof that the selected
 * profile owns it"*.
 *
 * ⚠️ **`unknown` is a real answer and must stay one.** The provider reports a bare path; a file
 * outside both this session's home and its cwd chain is neither layer, and guessing would be worse
 * than saying so. 357 §4: *"preserving `unknown` rather than guessing"*.
 */
export type InstructionScope = 'profile' | 'project' | 'unknown'

/**
 * One file the PROVIDER reported loading on its own, and which layer this session's own home and
 * cwd put it in (356).
 *
 * ⛔ **The scope is decided in MAIN, never in the renderer** (357 §4: *"The renderer must not derive
 * scope from path strings"*). Main is the only side that knows this session's provider home and the
 * project chain it was launched on; a renderer comparing prefixes would be re-deriving a fact it was
 * never given, and would go quietly wrong the first time either moved.
 */
export interface ProviderInstruction {
  /** The file, absolute, exactly as the provider named it and in the provider's own order. */
  path: string
  /** Which layer this session's home and cwd put that path in. */
  scope: InstructionScope
}

/**
 * **Everything that shaped this session's instructions, and who chose each part** (158).
 *
 * The split is the honesty. {@link injected} is text *this app* read and appended; {@link provider}
 * is the list the *provider* says it loaded by itself and which this app never saw the contents of
 * — Codex reports its own `AGENTS.md` chain, and 156 measured that BroBot retained none of it.
 * Presenting the two as one list would claim we chose files we did not.
 */
export interface SessionInstructions {
  /**
   * The FILES this app appended. Empty when it appended none — and then none is rendered. ⚑ Since
   * D-024 · R1 this conversation's own text can be appended with no file at all:
   * {@link thisConversation}.
   */
  injected: InjectedInstruction[]
  /**
   * 🔴 **D-024 · R1 — what is true of THIS conversation, as this launch composed it**: its text and
   * the sections of it, each with whose it is — composed after every file, under a header of its
   * own, on both providers ({@link composed} holds it as sent): in Claude's system prompt, and in
   * front of the first message of each life on Codex.
   *
   * ⛔ **Never a file.** One profile runs several conversations and its instruction file is one per
   * profile, rewritten by each of their launches; this is composed per conversation and rides that
   * launch alone.
   *
   * ⚠️ **Optional for `memoryLoaded`'s reason**: a reading built by no launch — a host with no
   * reader, a test that is not about it — has none, and a host one build behind sends the key
   * MISSING, so the renderer normalises rather than trusting the type.
   */
  thisConversation?: { readonly text: string; readonly spans: readonly InstructionSpan[] }
  /**
   * 🔴 **The agent's own memory, which BroBot does NOT inject** (165).
   *
   * ⛔ **A separate field rather than more entries in {@link injected}, because it is a different
   * claim.** Every item in that list is text this app read and appended; these the PROVIDER loads,
   * from a directory it derives, and BroBot reads the same files only so the user can see them.
   * Putting them in the list would have made the list's own doc false and would have implied we
   * chose to send them.
   *
   * ⚠️ **And the agent WRITES these**, which nothing else here does. A file the user wrote, a file
   * the app generated and a file the agent maintains are three provenances, and 086 is about
   * exactly this: a reader who cannot tell which is which will eventually edit the wrong one.
   *
   * ## ⚑ A LIST since 317, and the shape change is the fix rather than a tidy-up
   *
   * ⛔ It was `InjectedInstruction | null`, which was the right shape for exactly as long as memory
   * meant Claude's one `MEMORY.md`. **314 switched Codex's memory on**, and 312 measured that store
   * as several files with two different reaches — a summary the provider injects, a handbook, and
   * the ad-hoc notes a person asked for. A single slot could hold one of them, so a `null` here
   * would have gone on meaning *"this provider has no memory"* for the provider that now does.
   *
   * ⚠️ **Ordered the way the model meets them**: what is in the prompt first, then what the agent
   * would have to go and fetch. {@link InjectedInstruction.reach} is which is which, and the panel
   * must not flatten the two into one word.
   *
   * ⚠️ **And it is filled from a DIRECTORY for both providers since 322**, which is the correction
   * 317 left half-made: it read Codex's store as several files and went on reading Claude's as one,
   * so a real profile's `MEMORY.md` reached the panel and the two memories it indexes did not.
   *
   * **Empty when the agent has not written anything yet** — 158's rule, unchanged: nothing is
   * rendered where nothing exists. ⚠️ A `SessionInstructions` from before this field, or from
   * before it was a list, has `undefined` or an object here; the renderer normalises rather than
   * trusting the type, because the type is a claim about new values only.
   *
   * ## 🔴 625 · it is THIS CONVERSATION's copy, and there is now a live read beside it
   *
   * ⛔ **Taken at this conversation's launch and never refreshed while it runs** — `158` §2's
   * live-profile semantic re-reads on every LAUNCH, and a launch is a start or a resume. ⚑ That is
   * unchanged and it is the right shape for a field whose sentence is *what this conversation was
   * given*: `EXT-015` §2's fourth row is the ruling — *"it is a record; never; it is this
   * conversation's"*.
   *
   * ⚠️ **What changed is that it is no longer the ONLY reading.** `AgentMemoryReading` in
   * `shared/agent-memory.ts` answers the other question — *what does this agent have in its store
   * NOW* — with no conversation open, and it is the one `EXT-015` §6.1's acceptance test needs:
   * BroBot wrote its false note DURING a run, so this list cannot contain it and the popup opened
   * in that very conversation would show a store missing the entry a person came to remove.
   *
   * ⛔ **So the sentence above about EMPTY is true of this field and is NOT the whole answer.** An
   * agent that has never run on a provider, one that has run and written nothing, and a store this
   * app could not read all produce `[]` here — three facts, one shape. ⚑ `MEMORY_STORE_STATE` is
   * where they are told apart, on the live reading, and a surface that needs the difference asks
   * that door rather than widening this one. 🔴 **Two reads, two moments, both correct** — `HO-070`
   * §3's rule, and the same arrangement {@link MemoryLoadedEvent.lookedAt} has with
   * {@link InjectedInstruction.readAt}.
   */
  agentMemory: InjectedInstruction[]
  /**
   * Files the PROVIDER reported loading on its own — its list, by path, with no text.
   *
   * ⚠️ **Paths only, deliberately.** We did not read these; the provider did, at a moment of its
   * choosing. Showing bytes we fetched separately would present our read as its read.
   *
   * ⚑ **Each row now carries the layer it belongs to as well** (356 §3). ⛔ **That is not a second
   * source and not a fetch** — it is this session's own `providerHome` and `cwd` applied to a path
   * the provider already gave us, decided in main where both are known. See
   * {@link ProviderInstruction} and `instructionScope` in the main process.
   *
   * ⚠️ **The bytes are still not here, and `readInstructionSource` is deliberately a SEPARATE
   * gesture** ({@link RuntimeBridge.readInstructionSource}) — reading one on request is a read this
   * app makes NOW, at the user's ask, and is a different claim from what the provider loaded at
   * launch. The panel must say so where it draws it.
   */
  provider: ProviderInstruction[]
  /** Candidates refused by the reader, each with its reason. Empty when nothing was refused. */
  refused: RefusedInstruction[]
  /**
   * Where the walk stopped and why, in one sentence — so the list above can be read as complete
   * rather than as "everything we happened to find".
   */
  note: string
  /**
   * 🔴 **Whether this session's provider reports a memory READ, so the panel may point at one**
   * (319 §2.1).
   *
   * ⛔ **A flag rather than a provider check, and that is `308`'s remedy rather than a style
   * preference.** 318 shipped a line under the memory rows saying *"Nothing here says which of these
   * the agent has actually looked up"*; 319 made that half-false by putting the recall in the
   * conversation — but only for the provider that publishes a citation. A panel that pointed
   * unconditionally would be promising, to the OTHER provider's user, a row that will never appear:
   * `308`'s defect, on the surface `308` was dispatched to clean.
   *
   * ⚠️ **Decided in main, where the provider is already known**, and never re-derived in the
   * renderer — which since 317 may not name a provider in a user-visible string at all, and has a
   * source scan that fails if it does.
   *
   * ⛔ **`false` is not "we do not know".** 318 measured Claude's side too: its CLI preloads the
   * memory index into its own system prompt, with no tool and no citation. So `false` is a measured
   * fact about a provider, and the panel says less rather than saying something it cannot support.
   */
  recallsReported: boolean
  /**
   * 🔴 **Whether this session's provider reports a memory WRITE in the conversation** (330 §4).
   *
   * Claude reports memory writes as ordinary tool calls on the wire. This flag lets the panel point to those transcript rows, which have memory labels when store paths are reported.
   *
   * ⚠️ **A SECOND boolean rather than a widened one, and `310` is the reason.** Reads and writes are
   * two independent measurements about one store: this app has now measured a provider that reports
   * the read and not the write, and one that reports the write and not the read. One field with
   * three meanings is the defect `310` was dispatched for; two fields can each be a fact.
   *
   * ⛔ **`false` on Codex is measured, not unknown.** 316 enumerated fifteen config arms of a real
   * `0.146.0` child and found the app-server publishes no item at all for a memory write — which is
   * why `MemoryNoteEntry` exists and says *"seen on disk … not reported as a tool call"*. A disk
   * observation is not the conversation showing the write, and a panel that said it was would be
   * overstating in the direction 009 forbids.
   *
   * ⚠️ **`false` on a host with no reader means "say nothing"**, exactly as its neighbour's does.
   *
   * Do not depend on the memory label for this flag. Labels require `memory_paths`, which a future provider may omit; the write itself remains visible as an ordinary `Write` row.
   */
  writesReported: boolean
  /**
   * 🔴 **The exact text appended to the model's system prompt, composed** (442, HO-024 §4
   * criterion 24: *"what it was told, composed, as sent"*).
   *
   * ⛔ **The COMPOSITION, not the parts — and the parts were never the whole of it.** Every
   * {@link injected} row carries the bytes of one file; what none of them carries is the framing
   * this app wraps around them before sending: a preamble telling the model these instructions
   * OVERRIDE its default behaviour, and one `Contents of <path> (<scope>):` header per block. ⚠️
   * Those bytes go to the model on every launch and reached **no surface at all** until 442, which
   * is why criterion 24's first half was unmet by a panel that had existed since 158.
   *
   * ⚑ **The SAME value that was sent, not a second composition.** `readSessionInstructions`
   * composes once and the composition root hands that same string to the adapter as
   * `StartOptions.systemHint` — so the string on screen and the string HANDED OVER cannot
   * disagree, which is the rule `blockHeader` already states about the byte budget. ⚑ **On Codex
   * since D-024 · R1 the host hands it over in front of the first message of each life**
   * (`SessionLaunchRead.firstTurnLead`), the same string.
   *
   * ⛔ **555 · that clause said *"the string in the prompt"*, and the hand-off is the last step
   * this app can see.** ⚠️ `HO-023` §7 — *"the factory layer propagates verbatim by construction
   * because the app renders it… a safety property"* — is WITHDRAWN, and `HO-062` §2 replaces it:
   * **the layer carries BEHAVIOUR, and safety lives in the rails.** ⚑ A by-construction argument
   * ending at the adapter is still worth having; it is the word *prompt* that reached one step
   * further than anything measured it.
   *
   * ⛔ **`null` is *this app appended nothing*, and it is a POSITIVE fact rather than a gap.**
   * A reading from a host with no instruction reader is `null`: {@link injected} is empty, no
   * {@link thisConversation} was composed, and nothing composed of nothing is nothing. ⚑ **D-024 ·
   * R1 — on the provider that reads its own instruction files it is this conversation's own text
   * alone**, under its header: BroBot injects none of the files there.
   *
   * ⚠️ **It is not what the PROVIDER's prompt contains.** Both adapters place this text
   * ADDITIVELY — appended to a named preset on one, in front of a first message on the other —
   * and neither replaces the base instructions this app has never held a byte of. See
   * `TOLD_LAYER_KINDS` in `shared/told.ts`, which draws that layer rather than omitting it.
   *
   * 🔴 **555 · and the limit runs the OTHER WAY TOO, which this paragraph did not say.** ⛔ *We do
   * not replace theirs* is one direction; *ours stays in force* is the other, and on Codex it is
   * bounded: a `collaborationMode` update takes precedence over `developerInstructions`, so a
   * layer sent there stops applying from the first mode switch onwards (`552`; measured in
   * `collaborationModeFor`, `packages/runtime/src/codex/codex-runtime.ts`). ⚑ **Latent, not
   * live** — this app sends that provider no hint at all: since D-024 · R1 its one text rides the
   * first message of each life, which no mode switch reaches. ⚠️ HO-062 §1 rules out measuring the
   * limit; it is written here so the next person to populate that field meets it before the bug.
   */
  composed: string | null
}
