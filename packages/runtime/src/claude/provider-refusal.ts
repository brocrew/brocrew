import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderRefusal } from '../events'

/**
 * Whose words an assistant message holds when the CLI, not a model, wrote it. The CLI writes its own
 * notices (a version floor, an unknown model id, an output-limit cut) into assistant-shaped frames,
 * and they must not speak in the agent's voice. The marker is `message.model === '<synthetic>'` with
 * all-zero usage; `test/fixtures/claude-model-floor-refusal.json` holds example frames.
 *
 * A notice is the marker plus either an `error` word or the snake-case `is_api_error_message` flag
 * newer CLI builds put on the frame (neither is declared in the SDK types; the archived record uses
 * camel-case `isApiErrorMessage`). Some notices carry the flag and no `error` (a tool call the model
 * could not form twice, a raw model error, a model-policy refusal). The marker alone is not enough:
 * `/context` and `/usage` replies are `<synthetic>` too and are what the person asked for.
 *
 * The marker is used, never "one text block and nothing else": a reply cut at its output limit arrives
 * as two frames, the model's partial text with its real model and no error word, then the CLI's
 * `max_output_tokens` notice. A shape rule would take the partial reply for a notice.
 */
export const THE_CLIS_OWN_MODEL = '<synthetic>'

/** Whether this assistant frame was written by the CLI rather than by a model (see above). */
function isTheClisOwnMessage(message: SDKMessage): boolean {
  if (message.type !== 'assistant') return false
  const inner: unknown = message.message
  if (inner === null || typeof inner !== 'object') return false
  return (inner as { model?: unknown }).model === THE_CLIS_OWN_MODEL
}

/**
 * Whether this frame is the CLI's notice: its own message, marked as an error by a word or by the
 * `is_api_error_message` flag. A `<synthetic>` frame with neither (a `/context` reply) is the CLI
 * answering the person, and stays where it is.
 */
export function isTheClisNotice(message: SDKMessage): boolean {
  if (!isTheClisOwnMessage(message) || message.type !== 'assistant') return false
  if (typeof message.error === 'string') return true
  return (message as unknown as Record<string, unknown>)['is_api_error_message'] === true
}

/**
 * What the CLI announced in the turn's `system/init`: the version this app spawned and the model the
 * turn asked for. Held per session because the init arrives frames before the refusal that needs it.
 * `model` follows the conversation (after `setModel` the next init names the new model). A replay
 * with no init leaves both `null`, and no refusal is recognised.
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
 * The floor the provider named, read out of its own sentence ("…does not support this model; version
 * 2.1.280 or newer is required."). Anchored on the clause that carries the number, so rewording the
 * advice after it cannot move what is read.
 */
const MODEL_FLOOR = /does not support this model; version (\d+(?:\.\d+)+) or newer is required/

/**
 * The output limit the CLI names when it cuts a reply ("API Error: Claude's response exceeded the
 * 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS
 * environment variable."). Its advice cannot be taken here: this app spawns the process with an
 * allow-listed environment, so a reader must not be handed it as what to do.
 */
const OUTPUT_LIMIT = /response exceeded the (\d+) output token maximum/

/**
 * The structured refusal for a notice, or `null` when this adapter does not recognise it; `null`
 * means the surface shows the provider's own sentence, never guessed advice.
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
