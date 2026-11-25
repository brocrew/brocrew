export const CLOSE_FLUSH_TIMEOUT_MS = 2000
export const CLOSE_INTERRUPT_TIMEOUT_MS = 2000

export const COMMANDS_END_WITHIN_MS = 1000

export const RATE_LIMIT_READ = 'account/rateLimits/read'

/**
 * How long Codex may take to start a compaction it has already accepted.
 *
 * A total limit with a reason: what is awaited is the `turn/started` notification, not a response,
 * so there is no request to wait on and no process exit to see while the app-server is alive. Without
 * a limit a compaction that is accepted and never started leaves the turn "starting" for ever. The
 * start is one local step, and a slow PC makes it take seconds, not a quarter of a minute more;
 * when this expires the compaction stays recorded as outstanding, so no second one is asked for.
 */
export const COMPACTION_START_TIMEOUT_MS = 15_000

export const A_COMPACTION_IS_STILL_OUTSTANDING =
  'Codex accepted the last compaction but has not started it, and it may still run — BroCrew will ' +
  'not ask for another until it does, or until your next message has finished. Nothing has been sent.'

// A local turn binds from its turn/start response; compaction alone binds from turn/started.
export interface CodexTurn {
  readonly localId: number
  providerTurnId: string | null
  interruptPending: boolean
  // Keep the ask latched: an accepted turn may reject an interrupt until turn/started retries it.
  interruptAsked: boolean
  // Commands belong to this turn only; movedOn distinguishes detached work from work still awaited.
  readonly commands: Map<string, { movedOn: boolean }>
  endsAll: boolean
  // Serialize command-ending passes so their output precedes the turn ending.
  commandsEnding: Promise<void>
  // Compaction answers with no id. Never bind an old turn id or overlap an outstanding compaction.
  bindsAtItsStart?: true
}

import { isRecord, readString, readOptionalString } from './wire-values'
import { SUB_AGENT_USES, TOOL_USES } from './notification-scope'
import { type ProviderTurnFailure } from '../../events'

export function noteTurnMovedOn(method: string, params: unknown, turn: CodexTurn | null): void {
  if (method !== 'item/started' || turn === null) return
  const item = isRecord(params) ? params['item'] : undefined
  const type = readString(item, 'type')
  const toASubAgent = type === 'subAgentActivity' && SUB_AGENT_USES.has(readString(item, 'kind'))
  if (!TOOL_USES.has(type) && !toASubAgent) return
  for (const command of turn.commands.values()) command.movedOn = true
}

export function newCodexTurn(localId: number): CodexTurn {
  return {
    localId,
    providerTurnId: null,
    interruptPending: false,
    interruptAsked: false,
    commands: new Map(),
    endsAll: false,
    commandsEnding: Promise.resolve(),
  }
}

function observedTurnFailure(error: unknown, code?: string): ProviderTurnFailure | undefined {
  const message = readOptionalString(error, 'message')
  if (message === undefined || code === 'unauthorized' || code === 'usageLimitExceeded') {
    return undefined
  }
  return code === undefined ? { message } : { message, code }
}

export { observedTurnFailure }
