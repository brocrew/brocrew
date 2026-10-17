import type { ProviderRefusal } from '@brobot2/runtime'

/**
 * ⛔ **The sentence inside a machine envelope, and the turn's own ending told once** (246 §1).
 *
 * ## What 244 read
 *
 * The Exploration Agent entered an unsupported Codex model and sent one plain prompt. Four things
 * arrived, in this order, and every one of them was drawn:
 *
 * 1. `warning: Model metadata for \`…\` not found. Defaulting to fallback metadata; …`
 * 2. `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The '…' model
 *    is not supported when using Codex with a ChatGPT account."}}`
 * 3. `turn failed: ` **followed by that same 177-character envelope again**
 * 4. `turn failed`
 *
 * > *"The app knew exactly what happened, but made the user read the same machine error twice
 * > before stating the ending."*
 *
 * ⚑ **Measured on the wire by step 73, not inferred**: the envelope above is the real one, and the
 * `message` inside it is a whole English sentence naming the model and the account type. 246 §1 said
 * so before it was measured — *"a 400's `message` field is usually a real sentence; the envelope
 * around it is not"* — and the wire agrees.
 *
 * ## Two facts, and neither is the other
 *
 * ⛔ **The fallback-model warning is NOT collapsed** (177 §2's rule, and 246 §4 restates it). It
 * arrives before the request, from a different part of the provider, and it fires for models that
 * work — a fine-tune with no published metadata gets it and then answers normally. Folding it into
 * the failure would delete a disclosure on every turn where there is no failure to fold it into.
 *
 * ⛔ **What IS one fact told twice is (2) and (3).** Both carry the provider's `error.message`; the
 * second is the session machine restating the turn's terminal reason, which the `turn` event is
 * about to state again in a word. So this module answers two questions for the fold:
 *
 *  - {@link providerErrorSentence} — what a person reads instead of the envelope. 085's split: the
 *    diagnostic goes to the ledger and the Events tab (`describe-event.ts` prints `event.message`
 *    verbatim, `status` and `type` included), and the person gets the sentence.
 *  - {@link turnFailureDetail} — whether an `error` event IS the turn's own ending, so the fold can
 *    decline to say it a second time when the turn has already said it.
 *
 * ⚠️ **Renderer-side, deliberately.** 246 §4: *"the durable record was right; this is about what is
 * rendered."* Every event above stays in the ledger exactly as it arrived, and `packages/runtime`
 * — where all three `turn failed: ` producers live — belongs to another dispatch (243).
 *
 * ## ⚠️ What dropping the prefix costs, said out loud
 *
 * The cause and the receipt are now two events' worth of rendering rather than one, and there is a
 * one-event window between them: a ledger cut exactly there — the app died between the `error` and
 * the `turn`, or a transcript window begins on the second — shows a reader the cause sentence
 * without the word *failed* beside it. Before this it would have shown `turn failed: <envelope>`.
 *
 * ⚑ **Accepted, because the ending is not only in the transcript.** `end_reason` is a column: the
 * rail and the Sessions page both name it (`ending.ts`, 222), which is the whole point of that
 * dispatch. Trading one rare cut for the duplicate 244 read on every failure is the right way round.
 */

/**
 * The bare terminal message `SessionMachine.completeTurn` emits when the provider named no reason
 * at all, and the prefix it puts in front of one when it did.
 *
 * ⛔ **Three places build this string and none of them is here**: `codex/normalize.ts`
 * (`turn failed: ${turnErrorText(turn)}`), `claude/normalize.ts` (`turn failed: ${detail}`) and
 * `internal/session-machine.ts` (`errorMessage ?? 'turn failed'`). They are in `packages/runtime`,
 * which this dispatch may not edit, so the constant is restated here and
 * `apps/desktop/test/provider-error.test.ts` pins it against what those two normalizers ACTUALLY
 * return — a real call, not a copy of the literal. A drift there fails a test here rather than
 * silently turning the fold below into a no-op.
 */
export const TURN_FAILED = 'turn failed'
const TURN_FAILED_PREFIX = `${TURN_FAILED}: `

/**
 * How deep an envelope may be unwrapped, and how many times.
 *
 * ⚠️ **Bounded because the input is a string off the wire** (052/069's standing rule). A provider
 * that nested `error` a thousand deep, or whose `message` was its own envelope, must cost a constant
 * amount of work here — this runs on the renderer's fold path, once per error event.
 */
const MAX_DEPTH = 4

/**
 * The longest message this will try to PARSE, in UTF-16 code units.
 *
 * ⚠️ **Nothing bounds an error message on the way in.** `boundStoredEvent` bounds questions and
 * attachment paths; the adapters' `truncate` is for `unknown` payloads. So a provider could hand the
 * fold a megabyte, and `JSON.parse` on it is work this function must not do once per error event.
 * ⚑ 64k characters is 370× the 177-character envelope this module was written for — an envelope
 * worth opening has a sentence in it, and a message this size is a dump, which is returned
 * unchanged exactly as prose is. It is not a new bound on what the transcript HOLDS: the notice
 * already renders the whole string either way.
 */
const MAX_ENVELOPE_CHARS = 64 * 1024

/**
 * The sentence a person should read for a provider diagnostic — the `message` inside a JSON
 * envelope, or the text itself when it is already a sentence.
 *
 * ⛔ **Anything that is not a JSON object is returned untouched.** Most provider errors are already
 * words (`claude is rate-limited`, the fallback-model warning, an SDK's own prose), and rewriting
 * those would be the invention 086 forbids. The only thing this removes is an envelope a person
 * cannot read: the notice row draws at most three lines of a provider's words (clamped since `672`,
 * the whole on the title — `NoticeItem.providersWords`), so a 177-char JSON object would spend
 * them on braces and keys.
 *
 * ⚠️ **The DEEPEST `message` along the `error` chain wins.** `{"message":"Request failed","error":
 * {"message":"The '…' model is not supported"}}` has two, and the outer one is the transport's
 * summary while the inner one is what actually happened. Taking the outer would replace an envelope
 * with a shrug.
 *
 * ⚠️ **Whitespace-only is treated as absent**, so a payload carrying `"message": "   "` degrades to
 * the envelope rather than to an empty notice — the same `.trim()`-on-the-test rule
 * `claude/normalize.ts` applies to a fatal notice.
 */
export function providerErrorSentence(message: string): string {
  let text = message
  for (let unwrapped = 0; unwrapped < MAX_DEPTH; unwrapped += 1) {
    const inner = sentenceInEnvelope(text)
    if (inner === null) return text
    text = inner
  }
  return text
}

/** The deepest non-empty `message` along an envelope's `error` chain, or null if there is none. */
function sentenceInEnvelope(message: string): string | null {
  const text = message.trim()
  // Cheap and exact: `JSON.parse` on ordinary prose is a thrown exception per error event, and an
  // envelope is an OBJECT — a bare string or number that happens to be valid JSON is not one.
  if (!text.startsWith('{') || text.length > MAX_ENVELOPE_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  let said: string | null = null
  let node: unknown = parsed
  for (let depth = 0; depth < MAX_DEPTH && isRecord(node); depth += 1) {
    const nested: unknown = node['message']
    if (typeof nested === 'string' && nested.trim() !== '') said = nested.trim()
    node = node['error']
  }
  return said
}

/**
 * The reason inside the turn's OWN terminal message, or null when this error is not that.
 *
 * Returns `''` for the bare `turn failed` — a real state (`completeTurn` with no reason from the
 * provider), and one where the message says strictly nothing the `turn` event does not.
 *
 * ⚠️ **Recognized by its shape, which is the honest cost of not editing the producers.** A provider
 * whose own diagnostic began `turn failed: ` would be folded into the ending here. That is a
 * misattribution rather than a loss — the text still reaches the reader, on the line that states the
 * ending — and it has never been observed on either wire.
 */
export function turnFailureDetail(message: string): string | null {
  if (message === TURN_FAILED) return ''
  if (message.startsWith(TURN_FAILED_PREFIX)) return message.slice(TURN_FAILED_PREFIX.length)
  return null
}

/**
 * 🔴 **680 · a refusal the adapter RECOGNISED, as a line a person can act on** (PM ruling R28c).
 *
 * A model-version refusal can be resolved by updating the installed Claude Code or choosing
 * a supported model. Do not repeat advice about an unrelated desktop app as this app's remedy.
 *
 * ⚠️ **Every value is the wire's**: the model and the version this app runs are what the CLI announced
 * in that turn's own `system/init`, and the floor is the one the provider's sentence names — none of
 * them is a constant here. The provider's whole sentence stays on the event's `message` for the
 * ledger and the Events tab (085's split). ⛔ **An exhaustive switch**, so a second kind of refusal
 * is a build failure here rather than a blank notice.
 */
export function refusalSentence(refusal: ProviderRefusal): string {
  switch (refusal.is) {
    case 'model-needs-a-newer-cli':
      return (
        `${refusal.model} needs Claude Code ${refusal.needs} or newer, and this app runs Claude ` +
        `Code ${refusal.runs}. Update Claude Code, or choose another model for this conversation.`
      )
    case 'reply-cut-at-its-output-limit':
      // ⚑ The CLI's own words tell the reader to set `CLAUDE_CODE_MAX_OUTPUT_TOKENS` — a variable of
      // a child this app spawns with an allow-listed environment. What is true, and all of it.
      return `The reply was cut off at its output limit of ${refusal.limit} tokens.`
  }
}

/**
 * ⛔ **A stored or imported row is read as a member, never trusted** (680's review) — the same rule
 * `transcript.ts` applies to every replayed field. A ledger or a `.brobot` bundle from a later build
 * can carry a kind this build does not know, and a hand-edited one can carry anything; either is
 * `null` here, and the reader is shown the provider's own sentence instead (R28b).
 */
export function knownRefusal(value: unknown): ProviderRefusal | null {
  if (!isRecord(value)) return null
  const text = (key: string): boolean => typeof value[key] === 'string'
  if (value['is'] === 'model-needs-a-newer-cli' && text('model') && text('needs') && text('runs'))
    return {
      is: 'model-needs-a-newer-cli',
      model: value['model'] as string,
      needs: value['needs'] as string,
      runs: value['runs'] as string,
    }
  if (value['is'] === 'reply-cut-at-its-output-limit' && text('limit'))
    return { is: 'reply-cut-at-its-output-limit', limit: value['limit'] as string }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
