import type { SessionInstructions } from '../../../shared/runtime-ipc'
import {
  claimedLayer,
  observedLayer,
  opaqueLayer,
  TOLD_HAS_AN_EARLIER_LIFE,
  TOLD_IS_THE_LAST_LAUNCH,
  TOLD_REMEMBERS_NOTHING,
  type ToldLayer,
} from '../../../shared/told'
import { REGISTER_WORDS } from './digest'
import type { ToolRegistry } from './transcript'

/**
 * 🔴 **What the panel draws of one launch's composition, and what it REFUSES to draw** (442,
 * HO-024 §4 criterion 24).
 *
 * ## ⛔ The same fail-closed rule the digest uses, inherited rather than re-argued
 *
 * ⚠️ `runtimeCommandSchema` validates COMMANDS on the way in; nothing validates RESULTS on the way
 * back — the preload casts — so a main process one build ahead can hand this a register that is
 * not in {@link REGISTER_WORDS}. ⛔ **That layer is WITHHELD and COUNTED, never drawn**, and
 * falling back to `observed` would put the most authoritative label on the one layer this app
 * could not classify (`an-unenumerated-state-counts-as-success`, with the stakes inverted).
 *
 * ## ⛔ This surface may not name a provider, and that is enforced elsewhere
 *
 * `317` forbids the renderer naming a provider in user-visible text and has a source scan that
 * fails if it does. ⚑ **Nothing here needs to**: every sentence is about *the provider*, which is
 * both the provider-neutral spelling and the more honest one — the layer exists on both engines
 * and the name adds nothing true.
 */

/**
 * ⛔ **What a layer list may claim about ORDER, and what it may not.**
 *
 * ⚑ **The one ordering fact this app can state from its own source** is that its own text is
 * ADDITIVE: one adapter appends to a named preset, the other sends the developer-message layer and
 * never `baseInstructions`. So the provider's own instructions are underneath everything BroBot
 * added. ⛔ **Where the provider placed the files it found for itself is NOT stated** — nothing in
 * this app observes that, and a list that implied an order it cannot support would be criterion
 * 18's confident-wrong case in the shape of a sort.
 *
 * ## ⚠️ 555 · the sentence still holds, and the reason it holds is narrower than it was
 *
 * ⛔ **`HO-023` §7 is WITHDRAWN** — *"the factory layer propagates verbatim by construction because
 * the app renders it — that is now a safety property, not a convenience"* — and `HO-062` §2
 * replaces it: **the layer carries BEHAVIOUR; safety lives in the rails.** ⚑ So the two-adapter
 * reading above is a statement about what this app SENDS, and `552` measured that on one engine a
 * `collaborationMode` update takes precedence over the developer layer, which bounds how long a
 * sent layer stays in force.
 *
 * 🔴 **{@link TOLD_ORDER_IS_WHAT_WE_KNOW} is not made false by that, and the reason is its first
 * clause.** It says *"Ordered by what this app can ESTABLISH"* and then names one thing it does
 * not observe. ⚠️ **The sentence was already scoped to this app's own source**, which is the only
 * place the ordering was ever derived from — so this is the rare case where a withdrawn ruling
 * leaves the copy standing. ⛔ **Do not hedge it further**: HO-062 §1 rules the possibility
 * undemonstrated, and a surface that hedged an undemonstrated loss would trade criterion 18's
 * confident-wrong case for its opposite.
 */
export const TOLD_ORDER_IS_WHAT_WE_KNOW =
  'Ordered by what this app can establish: the provider’s own instructions are underneath, and ' +
  'everything BroCrew added lands on top of them. Where the provider put the files it found for ' +
  'itself is not something this app observes.'

/** One launch's composition, as the panel draws it. */
export interface ToldView {
  readonly layers: readonly ToldLayer[]
  /** The standing sentence — see `TOLD_IS_THE_LAST_LAUNCH`. */
  readonly says: string
  /** How the order was decided — see {@link TOLD_ORDER_IS_WHAT_WE_KNOW}. */
  readonly order: string
  /**
   * ⛔ **Drawn only where this conversation really has an earlier life**, and `null` otherwise —
   * never a hedge about what might have happened. See `TOLD_HAS_AN_EARLIER_LIFE`.
   */
  readonly earlier: string | null
  /**
   * 🔴 **True when this app appended nothing to this conversation's prompt** — a POSITIVE fact,
   * and the reason there is no `app-composed` layer to draw.
   *
   * ⛔ **A layer list describes layers that EXIST.** Drawing an empty one would be inventing a
   * layer; omitting the fact would leave a reader to wonder whether the surface forgot. So the
   * absence is stated once, in the view, and the list stays a list of real layers.
   */
  readonly appendedNothing: boolean
  /**
   * ⚑ **D-024 · R1 — true when this app appended no FILE to this conversation's prompt** — which is
   * every conversation on the provider that reads its own files, even now that this conversation's
   * own text is sent to it. ⛔ The *yours* group asks this, not {@link appendedNothing}: its
   * sentence is about what of a person's text this sheet can see, and that text is in a file.
   */
  readonly appendedNoFile: boolean
  /**
   * 🔴 **The sentence when this app read nothing from the agent's own memory store**, and `null`
   * when it read something — `536`, and the field above is its precedent rather than its analogy.
   *
   * ⛔ **Identical reasoning, one layer over.** `appendedNothing` says a layer list describes
   * layers that EXIST, so an absent layer is stated once instead of drawn as an empty row. ⚠️ The
   * agent's store is the other layer that can be absent, and `442` gave it the omission and not
   * the sentence — so a fresh identity's sheet named four layers and said nothing about the fifth.
   *
   * ⚑ **A STRING rather than a boolean, and the difference is what a test can hold.** The
   * component renders `told.says` and `told.earlier` by interpolating them and renders
   * `appendedNothing`'s copy inline in its own template, where nothing outside that file can name
   * it. ⛔ **A sentence a test cannot name by its constant is a sentence that drifts** (standing
   * rule 5) — see {@link TOLD_REMEMBERS_NOTHING}, which is asserted by name.
   */
  readonly remembers: string | null
  /** Layers this surface refused to draw because it could not label them. Never swallowed. */
  readonly withheld: number
}

/**
 * ⛔ **The only place a {@link ToldLayer} becomes drawable**, and the check is a lookup in the
 * closed vocabulary rather than a comparison against a list somebody typed twice.
 */
export function canBeDrawn(layer: ToldLayer): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTER_WORDS, layer.register)
}

/**
 * ⛔ **The fail-closed filter and its COUNT, as one function** (438's rule, inherited).
 *
 * ⚑ **Exported so the withheld path can be measured directly.** {@link toldView} builds every
 * layer through the three constructors, so no test driving it can produce an unlabellable one —
 * and a count nothing can exercise is a count that can be zeroed without a single test noticing
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚠️ The state IS reachable in
 * production: results are cast on the way back over the wire, not validated.
 */
export function drawableLayers(built: readonly ToldLayer[]): {
  readonly layers: readonly ToldLayer[]
  readonly withheld: number
} {
  const layers = built.filter(canBeDrawn)
  return { layers, withheld: built.length - layers.length }
}

/**
 * ⚑ **The verbs this conversation reports it was handed, or `null` when nothing has said.**
 *
 * ⛔ **Derived, never typed** (`442` §3.3, `a-title-that-names-a-count-the-assertion-never-checks`).
 * The roster is `main/`'s `TOOL_NAMES` and it has grown twice this slice; a number spelled here
 * would be wrong the next time it does.
 *
 * ⚠️ **`dropped > 0` collapses the count to `null`**, which is `247` §3's rule applied rather than
 * softened: *"a registry that quietly undercounts is worse than none."* A frame that named more
 * rows than it carried cannot support a total, and a total that is quietly short is worse than
 * saying nobody has said.
 */
function verbsPublished(tools: ToolRegistry | null | undefined): number | null {
  if (!tools || tools.dropped > 0) return null
  const declared = tools.set?.declared
  return declared ? declared.tools.length : null
}

/**
 * The whole view for one live conversation.
 *
 * @param instructions what this session was launched with (`158`), as the host read it.
 * @param tools the conversation's own tool registry, for the derived verb count.
 * @param relaunched whether this conversation has an earlier life — `SessionRecord.liveFrom`,
 *   whose contract is *"null means this session was never reopened and there is no previous life
 *   to leave behind"*.
 */
export function toldView(
  instructions: SessionInstructions,
  tools: ToolRegistry | null | undefined,
  relaunched: boolean,
): ToldView {
  const built: ToldLayer[] = []
  /**
   * 🔴 **Normalised rather than trusted, for `agentMemory`'s reason and found the same way**
   * (317, and this dispatch's own diff review).
   *
   * ⛔ **A `SessionInstructions` that predates this field has the key MISSING**, and
   * `instructions.dom.test.ts` builds exactly that shape on purpose — *"this is the shape a stored
   * session or an older host really has, and no typed fixture can express it"*. ⚠️ `undefined !==
   * null` is TRUE, so an un-normalised check drew an `app-composed` layer whose text was
   * `undefined` and suppressed the *"BroBot appended nothing"* sentence at the same time: a phantom
   * layer and a missing absence, from one comparison.
   */
  const composed = typeof instructions.composed === 'string' ? instructions.composed : null

  // 1 · ⛔ **The provider's own, and this app holds none of it.** Always drawn: `442` §2.1 —
  // *"the provider-opaque layers named as opaque rather than omitted"*. Omitted, everything below
  // reads as a complete account of the prompt, which is the strongest false claim available here.
  built.push(
    opaqueLayer(
      'told:provider-base',
      'provider-base',
      'the provider’s own instructions',
      'Underneath everything this app added. It adds to the provider’s prompt and never replaces ' +
        'it, ' +
        'and it has never held a byte of this layer — so nothing here can show you what it says.',
    ),
  )

  // 2 · ⚑ **The agent's own store.** CLAIMED, and the reason is the claim the layer makes rather
  // than the bytes: BroBot read these files, but that the provider put them in front of the model
  // is the PROVIDER's statement, per file — `SessionInstructions.agentMemory` and `317` §2.2's
  // reach word. ⛔ The bytes are on the rows below; this row does not repeat them.
  //
  // 🔴 **And when there are none, the ABSENCE is stated instead** (`536`) — see
  // {@link ToldView.remembers}. ⛔ The guard below is not new and nothing here removes it: a layer
  // with no files is a layer that does not exist, and drawing it would be the phantom
  // `appendedNothing` was written to avoid. ⚠️ **What was missing is the other half of that same
  // rule**, which `442` wrote out for the composed layer and did not apply here.
  const memory = Array.isArray(instructions.agentMemory) ? instructions.agentMemory : []
  if (memory.length > 0) {
    built.push(
      claimedLayer(
        'told:agent-store',
        'agent-store',
        'the agent’s own memory',
        'Written by the agent and loaded by the provider — BroCrew appended none of it. Each row ' +
          'below says whether the provider put that file in the prompt or left it to be fetched.',
        'the provider',
        memory.map((item) => item.path),
        memory.length,
      ),
    )
  }

  // 3 · 🔴 **What BroBot composed and appended, as sent** — criterion 24's own words, and the one
  // layer of the prompt this app can show in full.
  //
  // 🔴 **D-024 · R1 — drawn on BOTH providers now, and still with no limit to inherit.** It was
  // Claude-only while the Codex arm injected nothing; that arm now composes this conversation's
  // own text, and the host sends it in front of the first message of each life — never through
  // `developerInstructions`, the field a `collaborationMode` update takes precedence over (`552`;
  // `StartOptions.systemHint` in `packages/runtime/src/runtime.ts`). ⚑ So *"This is what was
  // sent"* still needs no hedge. ⚑ The count is its blocks: each file, and this conversation's own
  // text.
  if (composed !== null) {
    const conversation =
      typeof instructions.thisConversation === 'object' && instructions.thisConversation !== null
    built.push(
      observedLayer(
        'told:app-composed',
        'app-composed',
        'what BroCrew appended',
        'The exact text this app added to the prompt, as one string, with a header naming where ' +
          'each block came from. This is what was sent, not a reassembly of the rows on the ' +
          'other tabs.',
        composed,
        instructions.injected.length + (conversation ? 1 : 0),
      ),
    )
  }

  // 4 · ⛔ **Paths, and no content** — `430`: *"provider-discovered content is paths only"*.
  if (instructions.provider.length > 0) {
    built.push(
      claimedLayer(
        'told:provider-discovered',
        'provider-discovered',
        'files the provider found for itself',
        'The provider reported loading these. This app did not fetch them to build the list and ' +
          'holds no text for them — what you have here are paths, not content.',
        'the provider',
        instructions.provider.map((item) => item.path),
        instructions.provider.length,
      ),
    )
  }

  // 5 · ⚠️ **The verbs, as a layer this app cannot show.** The names are BroBot's; the definitions
  // the model reads are composed by the provider from them, and this app holds none of those bytes
  // — so the layer is opaque and carries only a count, which is `438`'s gap shape.
  const verbs = verbsPublished(tools)
  built.push(
    opaqueLayer(
      'told:published-tools',
      'published-tools',
      'the verbs this conversation was handed',
      verbs === null
        ? 'This conversation has not reported which verbs it was handed. That is not the same as ' +
            'having been handed none.'
        : 'BroCrew published these to the conversation; their definitions were composed into the ' +
            'prompt by the provider, and this app holds none of that text. The Tools tab lists them.',
      verbs,
    ),
  )

  const drawable = drawableLayers(built)
  return {
    layers: drawable.layers,
    says: TOLD_IS_THE_LAST_LAUNCH,
    order: TOLD_ORDER_IS_WHAT_WE_KNOW,
    earlier: relaunched ? TOLD_HAS_AN_EARLIER_LIFE : null,
    appendedNothing: composed === null,
    appendedNoFile: instructions.injected.length === 0,
    // ⛔ **`length === 0`, and the same normalisation the layer used** — a host that predates the
    // field sends the key MISSING, and `instructions.dom.test.ts` builds exactly that shape. ⚠️ An
    // un-normalised read would make an ABSENT field mean *"nothing to say"* rather than *"nothing
    // read"*, which is the one state this sentence exists for.
    remembers: memory.length === 0 ? TOLD_REMEMBERS_NOTHING : null,
    withheld: drawable.withheld,
  }
}

/** `1,204 B` / `12.3 KB` — the size of what is on screen, said the way the rows below say it. */
export function layerBytes(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`
}
