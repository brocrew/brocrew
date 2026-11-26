import type { PromptUpdateBaseline } from './human-answer-contracts'
import type { InstructionSpan } from './whose-text'
import type { InjectedInstructionKind } from './injected-instruction-kind'

export type { InjectedInstructionKind } from './injected-instruction-kind'

/**
 * One block of text **this app appended to the model's system prompt**.
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
   * 🔴 **When THIS APP read the file whose bytes are in {@link text}** (`HO-084` §3 as narrowed by
   * `HO-087` §1) — epoch milliseconds, this machine's wall clock.
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
   * semantic — and it says the price out loud: *"a file changed mid-conversation does not take
   * effect until the next launch."* ⚠️ **That cost is real and otherwise invisible.** A person who
   * edits an instruction file while a conversation is running has no way to see that the running
   * conversation is still on the older text; {@link TOLD_IS_THE_LAST_LAUNCH} says *"from the files
   * as they were then"* and cannot say when *then* was. ⚑ This is that number, per file, so the
   * comparison a person actually makes — *my edit, against this read* — is one they can make.
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
   * BroBot code ran; this app reads them only so they can be shown. ⛔ **A read time on one of those
   * would date OUR display read and read as the provider's**, which breaks the provenance rule with
   * a number. 🔴 **That surface has its own read-time** — *"when this app looked"*, as
   * {@link MemoryLoadedEvent.lookedAt} — ⚠️ **on the launch ROW, not on these items**, which is what
   * keeps the asymmetry above meaning what it says.
   *
   * ⚠️ **Optional because the type is shared with that list and because an older host sends the key
   * missing** (`agentMemory`'s rule too). ⛔ **What keeps it from going quietly absent on an
   * appended row is not the type** — it is `when-we-read-it-not-when-it-changed.test.ts` §1, which
   * asserts the split over a real launch with several kinds on the chain and with the memory store
   * beside it.
   *
   * ## ⛔ It is NOT in the prompt, and that was a decision
   *
   * 🔴 **Nothing appended to the model carries it.** {@link SessionInstructions.composed} is a
   * function of the files' paths, kinds and bytes and of NO CLOCK, and must stay one: a stamp in
   * `blockHeader` would spend per-file bytes out of {@link INSTRUCTION_TOTAL_CAP} on provenance no
   * rail reads, and would make the appended text differ on every launch of a tree nobody touched. ⚑
   * §3 of that same test pins it — two reads of one tree, identical `composed`, different `readAt`.
   * ⚠️ The clause would cost 27 B per file: +27 B on a default-cwd launch, +108 B on a four-kind
   * chain and +189 B on a seven-file one.
   */
  readAt?: number
  /**
   * 🔴 **Where {@link path} really led, when it did not lead where this app derived.**
   *
   * ⚑ **The agent's memory carries it**: the PROVIDER loads it and follows links with `stat` before
   * BroBot is asked anything, so refusing it would remove the row from this panel and nothing from
   * the model's prompt. 🔴 **Every file BroBot APPENDS carries it too** (R93): the walk follows
   * links as the CLI does, and a file followed somewhere else says where.
   *
   * ⚠️ **So it is followed, and the redirection is stated.** Undefined is the ordinary case and
   * renders nothing; a value means the text above came from this path, and the user is the only one
   * who can decide whether that is a surprise.
   */
  link?: string
  /**
   * 🔴 **Whether this text is in the prompt, or only on disk.**
   *
   * ⛔ **Only the `agent-memory*` kinds carry it**, and the asymmetry is the meaning: every other
   * item on this list is text BroBot appended, so "did the model get it" has one answer and the
   * field would be noise. A memory STORE does not — Codex injects exactly one of its files
   * (`memory_summary.md`) and leaves the rest for the four `memories__*` tools to fetch if the
   * model decides to.
   *
   * ⚠️ **`'on-request'` is a statement about AVAILABILITY, never about what the model has read.** A
   * panel that renders a file the agent has never opened as something it knows is worse than one
   * that shows nothing. Undefined on every other kind, and the renderer draws nothing for it.
   */
  reach?: 'prompt' | 'on-request'
  /**
   * 🔴 **Which part of this file is whose** (`HO-073` §4) — half-open ranges into {@link text}, in
   * order, tiling it exactly.
   *
   * ⛔ **Only ever on `profile-instructions`, and the asymmetry is the whole reason the field
   * exists.** Every other item on this list has one author for the whole file; the compiled bundle
   * is `factory + configured` in one file (`HO-009` §2), so a sheet that groups by WHOSE has to be
   * able to split it — otherwise *"all three read as one undifferentiated wall."*
   *
   * ⚠️ **Absent rather than guessed.** The composer publishes these with the text it composed; a
   * reader that finds the file on disk changed under it attaches none, and the renderer draws the
   * row whole and says it could not tell — failing closed rather than falling back onto the most
   * reassuring answer. ⛔ An older host sends the key MISSING, so the renderer normalises rather
   * than trusting the type (`agentMemory`'s rule too).
   */
  sections?: readonly InstructionSpan[]
}

/**
 * A file on the chain this app **did not send**, and why.
 *
 * ⚑ Reported rather than skipped in silence: an absence with a reason is the only version of it a
 * person can act on. ⚑ A link is followed (R93), so `symlink` is a chain of links that loops.
 */
export interface RefusedInstruction {
  path: string
  /**
   * What was wrong: `symlink` (a loop of links), `not-a-regular-file`, `too-large`, `not-utf8`,
   * `unreadable` — or `over-budget`, `dangling-link`, or `same-file` (a second name for a file
   * already sent). A link that lands in the person's own instructions is followed, as the CLI
   * follows it.
   *
   * ⛔ **`over-budget` is the one that is not the reader's.** The file was perfectly readable; the
   * total cap ran out before it. Without this row a chain that hit the cap would be
   * indistinguishable from a chain that did not have the file — the silence ruled out for a source
   * declined for any other reason.
   *
   * ⛔ **`dangling-link` is the other one**, and it is not a refusal either: nothing declined to
   * read anything, the far end of a link is simply not there. It exists because the provider's
   * `stat` and this app's both answer ENOENT for a broken link, and `absent` is silent — so without
   * it a profile whose memory index pointed into `/tmp` would lose its memory at the next reboot
   * and this panel would say nothing at all. See `brokenMemoryLink` in the main process.
   */
  reason: string
  /**
   * 🔴 **Where a `dangling-link` pointed** — the one thing `realpath` cannot tell you about a broken
   * link, and the only thing worth printing about one. ⚑ Also where a `same-file` link LANDED.
   *
   * ⚠️ Undefined for every other reason, and the renderer draws nothing when it is absent.
   */
  link?: string
}

/**
 * 🔴 **Which layer an instruction file belongs to.**
 *
 * ⛔ **`profile` and `project` answer different questions and a panel that blurs them lies.** The
 * profile layer says *who this agent is* and lives in the app-owned provider home; the project
 * layer says *what applies in this worktree* and lives on the cwd chain. A session whose only
 * instruction file is the project's `AGENTS.md` must not see it presented as though the selected
 * profile owned it — *"it must never be presented as proof that the selected profile owns it"*.
 *
 * ⚠️ **`unknown` is a real answer and must stay one.** The provider reports a bare path; a file
 * outside both this session's home and its cwd chain is neither layer, and guessing would be worse
 * than saying so.
 */
export type InstructionScope = 'profile' | 'project' | 'unknown'

/**
 * One file the PROVIDER reported loading on its own, and which layer this session's own home and
 * cwd put it in.
 *
 * ⛔ **The scope is decided in MAIN, never in the renderer** (*"The renderer must not derive scope
 * from path strings"*). Main is the only side that knows this session's provider home and the
 * project chain it was launched on; a renderer comparing prefixes would be re-deriving a fact it
 * was never given, and would go quietly wrong the first time either moved.
 */
export interface ProviderInstruction {
  /** The file, absolute, exactly as the provider named it and in the provider's own order. */
  path: string
  /** Which layer this session's home and cwd put that path in. */
  scope: InstructionScope
}

/** App-owned text captured when a provider prompt starts. Later launches reference its row. */
export type KeptPromptStart =
  | {
      readonly systemHint?: string
      readonly firstTurnLead?: string
      readonly model: string | null
      readonly updates?: PromptUpdateBaseline
      readonly injected?: readonly InjectedInstruction[]
    }
  | { readonly from: number }

/**
 * **Everything that shaped this session's instructions, and who chose each part.**
 *
 * The split is the honesty. {@link injected} is text *this app* read and appended; {@link provider}
 * is the list the *provider* says it loaded by itself and which this app never saw the contents of
 * — Codex reports its own `AGENTS.md` chain, and BroBot holds none of its text. Presenting the two
 * as one list would claim we chose files we did not.
 */
export interface SessionInstructions {
  /**
   * The FILES this app appended. Empty when it appended none — and then none is rendered. ⚑ This
   * conversation's own text can be appended with no file at all (D-024 · R1):
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
   * 🔴 **The agent's own memory, which BroBot does NOT inject.**
   *
   * ⛔ **A separate field rather than more entries in {@link injected}, because it is a different
   * claim.** Every item in that list is text this app read and appended; these the PROVIDER loads,
   * from a directory it derives, and BroBot reads the same files only so the user can see them.
   * Putting them in the list would have made the list's own doc false and would have implied we
   * chose to send them.
   *
   * ⚠️ **And the agent WRITES these**, which nothing else here does. A file the user wrote, a file
   * the app generated and a file the agent maintains are three provenances, and a reader who cannot
   * tell which is which will eventually edit the wrong one.
   *
   * ## ⚑ A LIST, because a memory store is several files
   *
   * ⛔ Codex's memory store is several files with two different reaches — a summary the provider
   * injects, a handbook, and the ad-hoc notes a person asked for. A single slot could hold one of
   * them, and a `null` would read as *"this provider has no memory"* for a provider that has one.
   *
   * ⚠️ **Ordered the way the model meets them**: what is in the prompt first, then what the agent
   * would have to go and fetch. {@link InjectedInstruction.reach} is which is which, and the panel
   * must not flatten the two into one word.
   *
   * ⚠️ **And it is filled from a DIRECTORY for both providers**: reading Claude's store as one file
   * would bring a profile's `MEMORY.md` to the panel without the memories it indexes.
   *
   * **Empty when the agent has not written anything yet**: nothing is rendered where nothing
   * exists. ⚠️ A `SessionInstructions` from before this field, or from before it was a list, has
   * `undefined` or an object here; the renderer normalises rather than trusting the type, because
   * the type is a claim about new values only.
   *
   * ## 🔴 It is THIS CONVERSATION's copy, and there is a live read beside it
   *
   * ⛔ **Taken at this conversation's launch and never refreshed while it runs** — the live-profile
   * semantic re-reads on every LAUNCH, and a launch is a start or a resume. ⚑ That is the right
   * shape for a field whose sentence is *what this conversation was given*: `EXT-015` §2's fourth
   * row is the ruling — *"it is a record; never; it is this conversation's"*.
   *
   * ⚠️ **It is not the ONLY reading.** `AgentMemoryReading` in `shared/agent-memory.ts` answers the
   * other question — *what does this agent have in its store NOW* — with no conversation open. An
   * agent can write a note DURING a run, which this list cannot contain, so a popup opened in that
   * very conversation would show a store missing the entry a person came to remove (`EXT-015`
   * §6.1).
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
   * ⚑ **Each row also carries the layer it belongs to.** ⛔ **That is not a second source and not a
   * fetch** — it is this session's own `providerHome` and `cwd` applied to a path the provider
   * already gave us, decided in main where both are known. See {@link ProviderInstruction} and
   * `instructionScope` in the main process.
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
   * 🔴 **Whether this session's provider reports a memory READ, so the panel may point at one.**
   *
   * ⛔ **A flag rather than a provider check.** Only one provider publishes a citation for a memory
   * recall, so a panel that pointed unconditionally would be promising, to the OTHER provider's
   * user, a row that will never appear.
   *
   * ⚠️ **Decided in main, where the provider is already known**, and never re-derived in the
   * renderer — which may not name a provider in a user-visible string at all, and has a source scan
   * that fails if it does.
   *
   * ⛔ **`false` is not "we do not know".** Claude's CLI preloads the memory index into its own
   * system prompt, with no tool and no citation. So `false` is a measured fact about a provider,
   * and the panel says less rather than saying something it cannot support.
   */
  recallsReported: boolean
  /**
   * 🔴 **Whether this session's provider reports a memory WRITE in the conversation.**
   *
   * Claude reports memory writes as ordinary tool calls on the wire. This flag lets the panel point to those transcript rows, which have memory labels when store paths are reported.
   *
   * ⚠️ **A SECOND boolean rather than a widened one.** Reads and writes are two independent
   * measurements about one store: this app has measured a provider that reports the read and not
   * the write, and one that reports the write and not the read. One field with three meanings could
   * not be a fact; two fields can each be one.
   *
   * ⛔ **`false` on Codex is measured, not unknown.** Across fifteen config arms of a real `0.146.0`
   * child the app-server publishes no item at all for a memory write — which is why
   * `MemoryNoteEntry` exists and says *"seen on disk … not reported as a tool call"*. A disk
   * observation is not the conversation showing the write, and a panel that said it was would be
   * overstating.
   *
   * ⚠️ **`false` on a host with no reader means "say nothing"**, exactly as its neighbour's does.
   *
   * Do not depend on the memory label for this flag. Labels require `memory_paths`, which a future provider may omit; the write itself remains visible as an ordinary `Write` row.
   */
  writesReported: boolean
  /**
   * 🔴 **The exact text appended to the model's system prompt, composed** (HO-024 §4 criterion 24:
   * *"what it was told, composed, as sent"*).
   *
   * ⛔ **The COMPOSITION, not the parts — and the parts were never the whole of it.** Every
   * {@link injected} row carries the bytes of one file; what none of them carries is the framing
   * this app wraps around them before sending: a preamble telling the model these instructions
   * OVERRIDE its default behaviour, and one `Contents of <path> (<scope>):` header per block. ⚠️
   * Those bytes go to the model on every launch, and a panel without them would leave criterion
   * 24's first half unmet.
   *
   * ⚑ **The SAME value that was sent, not a second composition.** `readSessionInstructions`
   * composes once and the composition root hands that same string to the adapter as
   * `StartOptions.systemHint` — so the string on screen and the string HANDED OVER cannot disagree,
   * which is the rule `blockHeader` already states about the byte budget. ⚑ **On Codex the host
   * hands it over in front of the first message of each life** (D-024 · R1;
   * `SessionLaunchRead.firstTurnLead`), the same string.
   *
   * ⛔ **The hand-off is the last step this app can see**, so this is the string handed over, not
   * *"the string in the prompt"*. ⚠️ `HO-062` §2 rules that **the layer carries BEHAVIOUR, and
   * safety lives in the rails** (`HO-023` §7's *"propagates verbatim by construction… a safety
   * property"* is withdrawn). ⚑ A by-construction argument ending at the adapter is still worth
   * having; the word *prompt* would reach one step further than anything measured it.
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
   * 🔴 **And the limit runs the OTHER WAY TOO.** ⛔ *We do not replace theirs* is one direction;
   * *ours stays in force* is the other, and on Codex it is bounded: a `collaborationMode` update
   * takes precedence over `developerInstructions`, so a layer sent there stops applying from the
   * first mode switch onwards (see `collaborationModeFor`,
   * `packages/runtime/src/codex/codex-runtime.ts`). ⚑ **Latent, not live** — this app sends that
   * provider no hint at all: its one text rides the first message of each life (D-024 · R1), which
   * no mode switch reaches. ⚠️ HO-062 §1 rules out measuring the limit; it is written here so the
   * next person to populate that field meets it before the bug.
   */
  composed: string | null
}
