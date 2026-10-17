import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderRefusal } from '../events'

/**
 * 🔴 **Whose words an assistant message holds when the CLI, not a model, wrote it** (680, PM ruling
 * R28a).
 *
 * The CLI can write its own refusal into an assistant-shaped frame. Distinguish every synthetic notice from model-authored text instead of diverting only `authentication_failed`; a version-floor notice must not speak in the agent's voice.
 *
 * ## ⚑ The marker, measured on the SDK frame itself (680 §1)
 *
 * | frame | `error` | `message.model` | `is_api_error_message` | `usage` |
 * |---|---|---|---|---|
 * | the version floor, CLI 2.1.218 | `unknown` | ⚑ `<synthetic>` | — (absent at 0.3.218) | all zeroes |
 * | an id no server serves, CLI 2.1.218 | `model_not_found` | ⚑ `<synthetic>` | — | all zeroes |
 * | the same id, CLI 2.1.281 | `model_not_found` | ⚑ `<synthetic>` | ⚑ `true` | all zeroes |
 * | the same session moved to a model it can run | — | `claude-opus-5` | — | real |
 *
 * `test/fixtures/claude-model-floor-refusal.json` holds every one of those frames. ⚠️ The camel-case
 * `isApiErrorMessage` 110 found is on the ARCHIVED record; the SDK frame carries the snake-case
 * `is_api_error_message` from 0.3.281 on, and neither is declared in `sdk.d.ts`.
 *
 * ⚠️ **Not every notice carries an error word**: a tool call the model could not form twice, a raw
 * model error and a model-policy refusal are written with `<synthetic>` and `is_api_error_message`
 * and NO `error`. So a notice is the marker PLUS either an error word or that flag — never the
 * marker alone, because `/context` and `/usage` replies are `<synthetic>` too and they are what the
 * person asked for.
 *
 * ⛔ **Moved by the marker, never by "one text block and nothing else".** A reply cut at its output
 * limit arrives as TWO frames: the model's partial text, one text block with its REAL model and no
 * error word, and then the CLI's own `max_output_tokens` notice, `<synthetic>`. The shape rule
 * would take the partial reply for a notice; the marker keeps it the model's.
 */
export const THE_CLIS_OWN_MODEL = '<synthetic>'

/** Whether this assistant frame was written by the CLI rather than by a model (see above). */
export function isTheClisOwnMessage(message: SDKMessage): boolean {
  if (message.type !== 'assistant') return false
  const inner: unknown = message.message
  if (inner === null || typeof inner !== 'object') return false
  return (inner as { model?: unknown }).model === THE_CLIS_OWN_MODEL
}

/**
 * ⚑ **Whether this frame is the CLI's NOTICE** — its own message, marked as an error by a word or
 * by the flag 0.3.281 puts on the frame. A `<synthetic>` frame with neither (a `/context` reply) is
 * the CLI answering the person, and stays where it is.
 */
export function isTheClisNotice(message: SDKMessage): boolean {
  if (!isTheClisOwnMessage(message) || message.type !== 'assistant') return false
  if (typeof message.error === 'string') return true
  return (message as unknown as Record<string, unknown>)['is_api_error_message'] === true
}

/**
 * ⚑ **What the CLI announced about itself in the turn's own `system/init`** — the version this app
 * spawned and the model the turn asked for. Held per session, like `ClaudeMemoryStore`'s root,
 * because the init arrives frames before the refusal that needs it.
 *
 * ⚠️ `model` follows the conversation: after `setModel`, the next turn's init names the new model
 * (measured, 680 §1). A replay with no init leaves both `null`, and no refusal is recognised.
 */
export class AnnouncedCli {
  version: string | null = null
  model: string | null = null

  noteInit(message: SDKMessage): void {
    if (message.type !== 'system' || message.subtype !== 'init') return
    const init = message as unknown as Record<string, unknown>
    const version = init['claude_code_version']
    const model = init['model']
    this.version = typeof version === 'string' && version !== '' ? version : null
    this.model = typeof model === 'string' && model !== '' ? model : null
  }
}

/**
 * The floor the provider named, read out of its own sentence: *"…does not support this model;
 * version 2.1.280 or newer is required."* ⚠️ Anchored on the clause that carries the number, so a
 * rewording of the advice after it cannot move what is read.
 */
const MODEL_FLOOR = /does not support this model; version (\d+(?:\.\d+)+) or newer is required/

/**
 * The output limit the CLI names when it cuts a reply: *"API Error: Claude's response exceeded the
 * 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS
 * environment variable."* ⛔ Its advice is an environment variable of a process this app spawns with
 * an allow-listed environment, so it cannot be taken here — which is what R28c says a reader must
 * not be handed as what to do.
 */
const OUTPUT_LIMIT = /response exceeded the (\d+) output token maximum/

/**
 * 🔴 **R28c's values, or `null` when this is not a refusal this adapter recognises.** `null` means
 * the surface shows the provider's own sentence (R28b) — never guessed advice.
 */
export function recognisedRefusal(notice: string, announced: AnnouncedCli): ProviderRefusal | null {
  const limit = OUTPUT_LIMIT.exec(notice)
  if (limit !== null) return { is: 'reply-cut-at-its-output-limit', limit: limit[1]! }
  const floor = MODEL_FLOOR.exec(notice)
  if (floor === null || announced.version === null || announced.model === null) return null
  return {
    is: 'model-needs-a-newer-cli',
    model: announced.model,
    needs: floor[1]!,
    runs: announced.version,
  }
}
