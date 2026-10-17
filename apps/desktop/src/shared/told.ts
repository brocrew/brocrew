import type { DigestRegister } from './digest'

/**
 * 🔴 **What an agent was told, as LAYERS — and what this app does not hold of them** (442,
 * HO-024 §4 criterion 24).
 *
 * > **24** — *An agent's instructions are legible to him: what it was told, composed, as sent —
 * > and what a running session was given at its launch, kept with that session.*
 *
 * ## ⛔ One register vocabulary, shared with the digest, never forked
 *
 * `438` built {@link DigestRegister} for exactly this problem one surface over, and `442`'s brief
 * rules that instructions do not get a second spelling of it: *"Use it. Do not invent a second
 * register vocabulary for instructions."* ⚑ So a layer's register is imported, the renderer's
 * `REGISTER_WORDS` labels it, and a member added there is a compile error here.
 *
 * ## ⛔ Three constructors, and each one makes a wrong layer unrepresentable
 *
 * The digest's discipline, applied to a different subject:
 *
 *  - {@link observedLayer} — this app **read the bytes** and can show them. It takes the text as a
 *    required argument, and fixes `saidBy` to `null`: an observation has no author.
 *  - {@link claimedLayer} — **something else says** this reached the model. It takes a speaker in
 *    its signature, and takes **no text**, because we hold none.
 *  - {@link opaqueLayer} — the layer is **there and this app holds nothing of it**. It takes no
 *    text and no paths at all, so *"an opaque layer with bytes in it"* is not a value that can be
 *    constructed.
 *
 * 🔴 **There is no generic constructor**, so a layer with no register cannot be built — and the
 * renderer withholds and COUNTS any register it does not recognise rather than drawing it, which
 * is `438`'s fail-closed rule inherited whole.
 *
 * ## 🔴 What this module is NOT, and the sentence is the deliverable
 *
 * ⛔ **`430` measured the hole and it is not closed by anything here**: *"provider-discovered
 * content is paths only, the final composed string is not persisted, and a resume rereads current
 * files"*. ⚑ `442` §2.3 prices the durable snapshot and forbids building it, so this module
 * describes **one launch's composition as it stands now** and says so in as many words — see
 * {@link TOLD_IS_THE_LAST_LAUNCH}.
 *
 * ⚠️ **The re-read is a RULING, not a defect** (`158` §2, stated in `instructions.ts`'s own
 * docblock): a profile is an identity a person edits, and a snapshot would mean editing your
 * memory did nothing until the next conversation. ⛔ **What is missing is not the snapshot — it is
 * the SENTENCE**, and a surface that draws today's composition beside yesterday's turns without
 * one is the confident-wrong case criterion 18 exists to prevent.
 */

/**
 * ⛔ **The closed vocabulary of layers, in the order the model meets them.**
 *
 * ⚑ **Order is the whole point of a layer list.** A reader who cannot tell which text came first
 * cannot tell which text an instruction overrode — and both providers place this app's
 * contribution AFTER their own, which is the one ordering fact a person needs and the one this
 * app can state from its own source.
 *
 * ⚠️ **Provider-neutral by construction.** `317` forbids this surface's renderer from naming a
 * provider in user-visible text and has a source scan that fails if it does, so every member here
 * is spelled as *the provider* — which is also what the layer IS: the same two facts hold on both
 * engines and neither name adds anything true.
 */
export const TOLD_LAYER_KINDS = [
  /**
   * 🔴 **The provider's own instructions, underneath everything this app added — and this app
   * holds none of them.**
   *
   * ⛔ **Measured from the adapters rather than assumed**, and `what-an-agent-was-told.test.ts`
   * §5 is a census that goes red if either stops being true:
   *  - one adapter sends `systemPrompt: { type: 'preset', preset: 'claude_code', append: … }` —
   *    a preset it names and never reads (`claude-runtime.ts`);
   *  - the other sends `developerInstructions` and **never** `baseInstructions`, which
   *    *"would replace the agent's base prompt"* (`codex-runtime.ts`).
   *
   * ⚑ So on both engines the app's text is ADDITIVE and the base is a layer it has never held a
   * byte of. ⛔ **Named rather than omitted** (`442` §2.1): omitted, the panel reads as *"this is
   * everything the model was told"*, which is the strongest false claim this surface could make.
   *
   * ⚠️ **555 · what those two bullets establish is where this app PUTS its text, not where the
   * text ends up.** ⛔ `HO-023` §7's *propagates verbatim by construction … a safety property* is
   * WITHDRAWN and `HO-062` §2 replaces it — **the layer carries BEHAVIOUR; safety lives in the
   * rails** — and on one engine the placement has a measured limit: a `collaborationMode` update
   * takes precedence over the developer layer (`552`; `collaborationModeFor` in
   * `packages/runtime/src/codex/codex-runtime.ts`). ⚑ **This member's own sentence survives it
   * unchanged**, because it is about the layer THIS app never held a byte of, and that is true
   * whichever way the layers above it settle.
   */
  'provider-base',
  /**
   * 🔴 **What BroBot composed and appended, as sent** — the criterion's own words.
   *
   * ⛔ **The COMPOSED string, not the files it was made of.** The per-file rows have been on this
   * panel since `158`; what was never on any surface is the framing the app wraps them in — a
   * preamble telling the model these instructions OVERRIDE its defaults, and one
   * `Contents of <path> (<scope>):` header per block. Those bytes went to the model and nothing
   * showed them, so *"composed, as sent"* was the half of criterion 24 that was not met by a
   * surface that already existed.
   */
  'app-composed',
  /**
   * The agent's own memory store — written by the agent, loaded by the provider.
   *
   * ⚠️ **A layer of its own and never part of {@link 'app-composed'}**, which is `165`'s ruling
   * and `SessionInstructions.agentMemory`'s whole reason: BroBot appends none of it. Its reach is
   * the provider's statement, per file, which is why this layer is CLAIMED and not observed even
   * though the app has read the bytes.
   */
  'agent-store',
  /**
   * Files the provider reported loading by itself — **paths, and no content**.
   *
   * ⛔ **`430`'s measurement, drawn as what it is**: *"provider-discovered content is paths
   * only"*. ⚠️ `442` §2.1: *"A path is not content, and a surface that shows a path where content
   * belongs must say which it is showing."*
   */
  'provider-discovered',
  /**
   * The verbs this app published to the conversation — part of what it was told, in the prompt as
   * tool definitions the PROVIDER composes.
   *
   * ⚠️ **The count is DERIVED from the conversation's own reported toolset, never typed**
   * (`a-title-that-names-a-count-the-assertion-never-checks`; `442` §3.3 asks for it by name). ⛔
   * A conversation that has not reported one yet gets an {@link opaqueLayer} — *not* a zero, which
   * would be a claim that it was handed nothing.
   */
  'published-tools',
] as const

export type ToldLayerKind = (typeof TOLD_LAYER_KINDS)[number]

/**
 * One layer of one launch's composition.
 *
 * ⚠️ **Build it with {@link observedLayer}, {@link claimedLayer} or {@link opaqueLayer}** — there
 * is no fourth way, and that is what keeps `register` from ever being a default.
 */
export interface ToldLayer {
  /** Stable across re-derivations of the same launch — the key a list renders on. */
  readonly id: string
  readonly kind: ToldLayerKind
  /** How this app knows. See {@link DigestRegister}. */
  readonly register: DigestRegister
  /** The layer's name, as a person reads it. */
  readonly title: string
  /** One sentence: what this layer is, and what this app holds of it. */
  readonly says: string
  /**
   * ⛔ **The bytes, and only where this app really has them** — `null` on every claimed and every
   * opaque layer, by construction rather than by discipline.
   */
  readonly text: string | null
  /** Paths this layer names, when naming them is all this app can do. Empty otherwise. */
  readonly paths: readonly string[]
  /**
   * How many things this layer covers, when a count is a fact — files, verbs.
   *
   * ⛔ **`null` is *nobody has said*, and is never rendered as zero.** Zero is a claim that the
   * layer is empty; null is a claim about this app.
   */
  readonly count: number | null
  /** Who said it, on a claimed layer. `null` on observed and opaque ones. */
  readonly saidBy: string | null
}

/**
 * ⛔ **A layer this app read the bytes of.** `saidBy` is fixed to `null`: an observation has no
 * author, because the engine is not a speaker (`438`'s `observedLine`, same rule).
 */
export function observedLayer(
  id: string,
  kind: ToldLayerKind,
  title: string,
  says: string,
  text: string,
  count: number | null = null,
): ToldLayer {
  return { id, kind, register: 'observed', title, says, text, paths: [], count, saidBy: null }
}

/**
 * ⛔ **A layer something else says reached the model.** The speaker is a REQUIRED argument — a
 * claim with no author is a rumour — and there is no `text` parameter, because a claimed layer is
 * precisely one whose bytes this app does not hold.
 */
export function claimedLayer(
  id: string,
  kind: ToldLayerKind,
  title: string,
  says: string,
  saidBy: string,
  paths: readonly string[] = [],
  count: number | null = null,
): ToldLayer {
  return { id, kind, register: 'claimed', title, says, text: null, paths, count, saidBy }
}

/**
 * ⛔ **A layer that is there and of which this app holds nothing.** It takes no text and no paths,
 * so an opaque layer carrying content is not a value this module can produce.
 *
 * ⚠️ **Drawn, never omitted** (`442` §2.1). `438` gave `unknown` no LINE constructor because a
 * digest's unknowns are carried by a gap with a count; here the unknown IS the layer, and leaving
 * it out is the omission HO-024 §5.3 forbids — the panel would read as a complete account of the
 * prompt while missing the largest part of it.
 */
export function opaqueLayer(
  id: string,
  kind: ToldLayerKind,
  title: string,
  says: string,
  /**
   * ⚑ **A count is compatible with opacity, and `438` is the precedent rather than an excuse.**
   * `DigestGap` carries the `unknown` register AND a count — *"a COUNT of the rows it is unable to
   * speak for"* — because how big a hole is is itself a fact. ⛔ Text and paths are not: those
   * would be content, and an opaque layer is defined by this app having none.
   */
  count: number | null = null,
): ToldLayer {
  return {
    id,
    kind,
    register: 'unknown',
    title,
    says,
    text: null,
    paths: [],
    count,
    saidBy: null,
  }
}

/**
 * 🔴 **The sentence `442` §2.2 calls the deliverable of this dispatch even if nothing else
 * lands.**
 *
 * ⛔ **Measured, and every clause of it is from the source** — see
 * `what-an-agent-was-told.test.ts` §1:
 *  - `RuntimeHostDeps.readInstructions` is called from exactly two places in `runtime-host.ts`,
 *    one on create and one on resume, and the composition root implements the seam by publishing
 *    the profile bundle and then reading every candidate off disk **at that moment**;
 *  - `instructions.ts` states it as a ruling rather than a leak: *"Called on every start AND every
 *    resume, deliberately — the LIVE PROFILE semantic 158 §2 ruled"*;
 *  - `StartOptions.systemHint`: *"Nothing about it is persisted, and that is the design rather
 *    than a leftover."*
 *
 * ⚠️ **So it says what is true instead of what would be reassuring.** A surface claiming to show
 * *what this session was given* would be the confident-wrong case — criterion 15's shape, and
 * worse than a gap because it looks correct.
 */
export const TOLD_IS_THE_LAST_LAUNCH =
  'Composed at this conversation’s most recent launch, from the files as they were then. ' +
  'The files are read again at every launch and no earlier composition is kept, so this is ' +
  'what this identity is told now — not a record of what earlier turns were given.'

/**
 * 🔴 **The sentence that keeps this surface from going silent about memory** (`536`).
 *
 * ⛔ **`442` drew the same distinction one layer over and stopped there.**
 * `ToldView.appendedNothing` in `renderer/src/lib/told.ts` already reasons it out in full — *"a
 * layer list describes layers that EXIST. Drawing an empty one would be inventing a layer;
 * omitting the fact would leave a reader to wonder whether the surface forgot"* — and then the
 * agent's own store, which is the other layer that can be absent, got the omission and not the
 * sentence.
 *
 * ⚠️ **It was never taken away, and that is the finding `536` §0 owes.** `671484ab` (165) drew the
 * store the day it existed and every line of it is still drawn at `fca3f3c9`; what has never
 * existed is a word for the state a fresh identity is in. ⛔ **Most identities are in it most of
 * the time**, so the common case was the silent one.
 *
 * ## ⛔ What it may not say, and each clause was cut for a reason
 *
 *  - ⛔ **Not *"the agent has written nothing"*.** An unreadable index and a dangling link both
 *    produce an empty `agentMemory` (`314` §3), and on those the agent had written plenty. This
 *    app can speak for its own read and for nothing else — which is the observed/claimed split
 *    this whole module is built on.
 *  - ⛔ **Not *"nothing reached the model"*.** `314` §3 measured the opposite: the provider
 *    `stat`s and reads that store itself, so a file BroBot could not read may be in the prompt
 *    anyway. The refusal rows say which file and why; this sentence says what this app holds.
 *  - ⛔ **No provider is named**, which `317` forbids on this surface and
 *    `what-an-agent-was-told.test.ts` §5 enforces with a scan.
 *
 * ⚑ **And it teaches the word**, because a person who has never seen the rows has no way to know
 * which memory this surface means. ⚠️ **This app says *memory* of four different families of
 * thing** (`536` §3): the agent's own store; the `profile memory` and `project memory` files
 * BroBot reads and appends; the loaded / written / recalled rows the transcript draws where they
 * happen; and compaction, which `HO-050` §1.3 ruled is not memory at all. ⛔ **Only the first can
 * go missing from this surface without a word**, so this sentence names the store and nothing
 * else — four headings would be a worse answer than the one he asked for.
 */
export const TOLD_REMEMBERS_NOTHING =
  'No memory of this agent’s own is shown here — BroCrew read none from its store. That store is ' +
  'the agent’s: it writes the files and the provider loads them, and when there are any they are ' +
  'listed below with the rest of what it was told.'

/**
 * ⛔ **The second sentence, drawn only where this conversation really has an earlier life.**
 *
 * ⚑ **Derived from `SessionRecord.liveFrom`**, whose own contract says it in these words: *"null
 * means this session was never reopened and there is no previous life to leave behind"*. ⚠️ So
 * this is not a hedge about what might have happened — it is drawn when the app knows it did, and
 * withheld when the app knows it did not.
 */
export const TOLD_HAS_AN_EARLIER_LIFE =
  'This conversation has been opened before. What it was told then was composed from the files ' +
  'as they were at that launch, and this app kept none of it.'
