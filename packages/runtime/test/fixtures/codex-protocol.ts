import type { Thread } from '../../src/codex/protocol/v2/Thread'
import type { ThreadStartedNotification } from '../../src/codex/protocol/v2/ThreadStartedNotification'
import type { ThreadStartResponse } from '../../src/codex/protocol/v2/ThreadStartResponse'
import type { Turn } from '../../src/codex/protocol/v2/Turn'
import type { TurnCompletedNotification } from '../../src/codex/protocol/v2/TurnCompletedNotification'
import type { TurnStartResponse } from '../../src/codex/protocol/v2/TurnStartResponse'
import type { TurnStartedNotification } from '../../src/codex/protocol/v2/TurnStartedNotification'

/**
 * Typed fixture builders for the `codex app-server` protocol (053, fixing 044 P2 #3).
 *
 * The fakes used to return hand-written partials — `{ turn: { id } }` for a `TurnStartResponse`
 * that actually requires a full `Turn` — while the tests called them faithful. A double that lies
 * about the wire weakens exactly the regression it is supposed to prove: the P1-C turn-correlation
 * proof (037) rested on a response shape the provider never sends.
 *
 * Every builder here is `satisfies`-checked against the **generated** type, so:
 *  - a fixture can never drift into a partial by accident, and
 *  - a change in the vendored protocol (`pnpm run protocol:check`) becomes a **compile error**
 *    in the fixtures rather than a silently-wrong test.
 *
 * Deliberately-malformed shapes live here too, but **explicitly named** (`malformed*`) and cast at
 * the boundary — so an unmarked fixture is always valid by construction, and a broken one is
 * impossible to mistake for a real one.
 */

/** A full, protocol-valid `Turn`. `id` is what turn correlation binds to (037). */
export function turn(id: string, overrides: Partial<Turn> = {}): Turn {
  return {
    id,
    items: [],
    itemsView: 'full',
    status: 'inProgress',
    error: null,
    startedAt: 1_700_000_000,
    completedAt: null,
    durationMs: null,
    ...overrides,
  } satisfies Turn
}

/** A completed turn, as `turn/completed` reports it. */
export function completedTurn(id: string, overrides: Partial<Turn> = {}): Turn {
  return turn(id, {
    status: 'completed',
    completedAt: 1_700_000_001,
    durationMs: 1000,
    ...overrides,
  })
}

/** A failed turn carrying the `TurnError` the normalizer reads. */
export function failedTurn(id: string, message = 'boom'): Turn {
  return turn(id, {
    status: 'failed',
    completedAt: 1_700_000_001,
    error: { message, codexErrorInfo: null, additionalDetails: null, misalignment: null },
  })
}

/**
 * The AUTHORITATIVE `turn/start` response — a full `Turn`, which is what makes the P1-C
 * correlation regression meaningful: the adapter binds from this response, so it must be the
 * shape the provider really sends.
 */
export function turnStartResponse(id: string, overrides: Partial<Turn> = {}): TurnStartResponse {
  return { turn: turn(id, overrides) } satisfies TurnStartResponse
}

/** `turn/started` — carries the same full `Turn`. */
export function turnStartedNotification(threadId: string, id: string): TurnStartedNotification {
  return { threadId, turn: turn(id) } satisfies TurnStartedNotification
}

/** `turn/completed` — the terminal notification the session machine reads. */
export function turnCompletedNotification(
  threadId: string,
  turnValue: Turn,
): TurnCompletedNotification {
  return { threadId, turn: turnValue } satisfies TurnCompletedNotification
}

/** `thread/started` — carries a full `Thread`. */
export function threadStartedNotification(id: string, cwd = '/tmp/x'): ThreadStartedNotification {
  return { thread: thread(id, cwd) } satisfies ThreadStartedNotification
}

/** A full, protocol-valid `Thread` for the handshake response. */
export function thread(id: string, cwd: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    extra: null,
    sessionId: `sess_${id}`,
    forkedFromId: null,
    parentThreadId: null,
    name: null,
    preview: '',
    ephemeral: false,
    environments: null,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'paginated',
    modelProvider: 'openai',
    model: null,
    reasoningEffort: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    recencyAt: null,
    status: { type: 'idle' },
    cwd,
    path: null,
    gitInfo: null,
    cliVersion: '0.160.0',
    originator: null,
    source: 'appServer',
    threadSource: null,
    turns: [],
    agentNickname: null,
    agentRole: null,
    canAcceptDirectInput: true,
    daybreakEnabled: null,
    ...overrides,
  } satisfies Thread
}

/**
 * A `thread/start` | `thread/resume` response with the PROMPTING approval profile the adapter
 * requires (013): reviewer `user`, policy `on-request`, sandbox `workspaceWrite` (`736`, R96 —
 * `readOnly` until then). Anything else must
 * fail the handshake, so these three are what the profile tests vary.
 */
export function threadStartResponse(
  id = 'th_1',
  cwd = '/tmp/x',
  overrides: Partial<ThreadStartResponse> = {},
): ThreadStartResponse {
  return {
    thread: thread(id, cwd),
    model: 'gpt-5',
    modelProvider: 'openai',
    serviceTier: null,
    disabledPluginIds: [],
    cwd,
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    // ⚑ 736 · R96 — what bundled 0.146.0 echoed for `sandbox: 'workspace-write'` (measured,
    // `probe:codex-mcp-tool-approval`'s `preset` arm), the `ask` profile since `736`.
    sandbox: {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    activePermissionProfile: null,
    reasoningEffort: null,
    multiAgentMode: 'explicitRequestOnly',
    ...overrides,
  } satisfies ThreadStartResponse
}

// --- deliberately-malformed fixtures: named, so they can never be mistaken for real ones ---

/** A `turn/start` result with NO turn id — a provider protocol error the adapter must fail on (037). */
export const malformedTurnStartResponse = {} as unknown as TurnStartResponse

/** A handshake response with no `thread` at all — must never yield a session ref (011). */
export const malformedThreadStartResponse = {} as unknown as ThreadStartResponse

/** A handshake whose `thread` omits the REQUIRED `cwd` — resume must prove cwd, not echo it (011). */
export function threadStartResponseWithoutCwd(id: string): ThreadStartResponse {
  const response = threadStartResponse(id)
  const threadWithoutCwd: Record<string, unknown> = { ...response.thread }
  delete threadWithoutCwd['cwd']
  return { ...response, thread: threadWithoutCwd } as unknown as ThreadStartResponse
}

/** A handshake whose `thread` carries an EMPTY id — the schema must reject it (011). */
export function threadStartResponseWithEmptyId(cwd = '/tmp/x'): ThreadStartResponse {
  return threadStartResponse('', cwd)
}
