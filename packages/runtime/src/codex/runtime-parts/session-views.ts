import { readCodexSkill, codexErrorIsAUsageLimit } from '../normalize'
import { boundCommands } from '../../provider-commands'
import { CODEX_COMMAND_PREFIX } from '../command-prefix'

import { isRecord, readField, readString, readOptionalString } from './wire-values'

import { resolveGeneratedImage } from '../generated-image'
import type { AgentToolset } from '../../agent-tools'

import type { RuntimeEvent } from '../../events'

import { StartFailed } from '../../runtime'

import { sessionRefSchema, type SessionRef } from '../../session-ref'

import { CHILD_STATE_UNKNOWN, childStatusOf, type ChildThreadState } from '../../child-conversation'

import { CODEX_PROTOCOL_VERSION, codexVersionFromUserAgent } from '../protocol-version'

import { CODEX_TOOLS_DESCRIPTION } from '../agent-tools'
import { boundInventory, parametersOf } from '../../tool-inventory'
import { CODEX_TOOL_NAMING } from '../tool-naming'

// Codex does not report a provider-confirmed dynamic-tool inventory; keep published unknown.
// Resumed threads retain their original declaration even when the current build's description differs.
export function toolInventoryFor(
  source: string,
  agentTools: AgentToolset | undefined,
): RuntimeEvent {
  const bounded = boundInventory({
    naming: CODEX_TOOL_NAMING,
    declared:
      agentTools === undefined
        ? null
        : {
            server: agentTools.server,
            ...(agentTools.tools.length === 0 ? {} : { instructions: CODEX_TOOLS_DESCRIPTION }),
            tools: agentTools.tools.map((one) => ({
              name: one.name,
              description: one.description,
              parameters: parametersOf(one.input),
            })),
          },
    published: null,
  })
  return {
    type: 'tool_inventory',
    naming: bounded.naming,
    declared: bounded.declared,
    published: bounded.published,
    ...(bounded.dropped > 0 ? { dropped: bounded.dropped } : {}),
    source,
  }
}

export function validateCodexProtocolVersion(response: unknown): void {
  const reported = codexVersionFromUserAgent(readString(response, 'userAgent'))
  if (reported === CODEX_PROTOCOL_VERSION) return
  throw new StartFailed(
    `Codex CLI ${reported ?? '(version not reported)'} ≠ vendored protocol ${CODEX_PROTOCOL_VERSION} — ` +
      'regenerate the types (pnpm run protocol:generate) or pin the CLI to the vendored version',
  )
}

// A resume must prove both id and cwd in the response; only a start may use its known launch cwd.
export function validatedThreadRef(
  response: unknown,
  opening: 'started' | 'resumed',
  provider: 'codex',
  cwd: string,
  rotation: number,
  targetRef: SessionRef | null,
): SessionRef {
  const thread = isRecord(response) ? response['thread'] : undefined
  const responseCwd = readString(thread, 'cwd')
  const candidate = {
    provider: provider,
    sessionId: readString(thread, 'id'),
    cwd: opening === 'started' ? responseCwd || cwd : responseCwd,
    rotation: rotation,
  }
  const parsed = sessionRefSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new StartFailed(
      `codex ${opening} returned an invalid thread ref (empty/missing id or cwd)`,
    )
  }
  if (opening === 'resumed' && targetRef) {
    if (candidate.sessionId !== targetRef.sessionId || candidate.cwd !== targetRef.cwd) {
      throw new StartFailed(
        `codex resume mismatch: expected ${targetRef.sessionId}@${targetRef.cwd}, ` +
          `got ${candidate.sessionId}@${candidate.cwd}`,
      )
    }
  }
  return parsed.data
}

// A missing thread is unknown, not idle. Keep nullable acceptance and missing turn counts distinguishable.
export function childStateFrom(response: unknown): ChildThreadState {
  const thread = readField(response, 'thread')
  if (!isRecord(thread)) return CHILD_STATE_UNKNOWN
  const accepts = readField(thread, 'canAcceptDirectInput')
  const turns = readField(thread, 'turns')
  return {
    status: childStatusOf(readString(readField(thread, 'status'), 'type')),
    acceptsInput: typeof accepts === 'boolean' ? accepts : null,
    nickname: readOptionalString(thread, 'agentNickname') ?? null,
    turns: Array.isArray(turns) ? turns.length : null,
  }
}

// Resolve once before persistence, then rebuild the event so a rejected raw provider path cannot survive.
export function resolvedImage(
  event: RuntimeEvent,
  providerHome: string,
  sessionId: string | undefined,
): RuntimeEvent {
  if (event.type !== 'image') return event
  const threadId = sessionId
  const path = threadId
    ? resolveGeneratedImage({
        codexHome: providerHome,
        threadId,
        imageId: event.imageId,
        ...(event.path ? { savedPath: event.path } : {}),
      })
    : null
  return {
    type: 'image',
    imageId: event.imageId,
    ...(path ? { path } : {}),
    ...(event.prompt ? { prompt: event.prompt } : {}),
  }
}

// A key's quota refusal is billing failure; a ChatGPT plan wall is a different remedy.
export function withKeyErrorDetail(
  event: RuntimeEvent,
  method: string,
  params: unknown,
  launchedOnAKey: boolean,
): RuntimeEvent {
  if (event.type !== 'error' || !launchedOnAKey) return event
  if (event.cause === 'auth') return { ...event, onAKey: true }
  if (method === 'error' && codexErrorIsAUsageLimit(params)) {
    return { ...event, billingRefused: true, onAKey: true }
  }
  return event
}

export function providerCommandsFrom(response: unknown, why: string): RuntimeEvent {
  const rows = Array.isArray(readField(response, 'data'))
    ? (readField(response, 'data') as unknown[])
    : []
  const sent = rows.flatMap((entry) => {
    const skills = readField(entry, 'skills')
    return Array.isArray(skills) ? skills : []
  })
  const { commands, dropped } = boundCommands(
    sent.filter((skill) => readField(skill, 'enabled') !== false).map(readCodexSkill),
  )
  return {
    type: 'provider_commands',
    commands,
    prefix: CODEX_COMMAND_PREFIX,
    ...(dropped > 0 ? { dropped } : {}),
    source: why,
  }
}

import type { PlanStep } from '../../events'

export function restatedPlan(
  event: RuntimeEvent,
  savedSteps: readonly PlanStep[],
): { event: RuntimeEvent; savedSteps?: PlanStep[] } {
  if (event.type !== 'plan_update') return { event }
  // A frame saying nothing must not erase the remembered checklist.
  if (event.steps.length === 0 && event.body === undefined && !event.note) return { event }
  if (event.steps.length > 0 || event.body === undefined) {
    return { event, savedSteps: event.steps.map((step) => ({ ...step })) }
  }
  if (savedSteps.length === 0) return { event }
  return { event: { ...event, steps: savedSteps.map((step) => ({ ...step })) } }
}

import type { CodexTransport } from '../codex-transport'
import type { ThreadReadParams } from '../protocol/v2/ThreadReadParams'
import type { TurnStartParams } from '../protocol/v2/TurnStartParams'
import { withDeadline } from '../../internal/bounded'
import { CHILD_READ_TIMEOUT_MS, CHILD_INPUT_TIMEOUT_MS } from './turn-state'

export function readChildThread(
  transport: CodexTransport,
  childId: string,
): Promise<unknown> {
  return withDeadline(
    Promise.resolve(
      transport.request('thread/read', { threadId: childId } satisfies ThreadReadParams),
    ),
    CHILD_READ_TIMEOUT_MS,
    'codex thread/read',
  )
}

export function sendChildInput(
  transport: CodexTransport,
  childId: string,
  text: string,
): Promise<unknown> {
  return withDeadline(
    Promise.resolve(
      transport.request('turn/start', {
        threadId: childId,
        input: [{ type: 'text', text, text_elements: [] }],
      } as TurnStartParams),
    ),
    CHILD_INPUT_TIMEOUT_MS,
    'codex turn/start (child)',
  )
}
