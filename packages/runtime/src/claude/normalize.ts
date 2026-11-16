import { splitQualified } from '@brobot2/shared/tool-naming'
import { CLAUDE_TOOL_NAMING } from './tool-naming'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  SystemSubtype,
  NonContentMessageType,
  StreamEventType,
  BlockDeltaType,
} from './message-types'
import {
  MAX_USAGE_WINDOWS,
  wrapUnknown,
  type BackgroundWorkEvent,
  type RuntimeEvent,
  type TurnLimit,
  type UnknownCategory,
} from '../events'
import type { SessionRef } from '../session-ref'
import { assistantErrorWords, isCredentialFailure } from './assistant-error'
import { AnnouncedCli, isTheClisNotice, recognisedRefusal } from './provider-refusal'
import { BackgroundTasks } from './background-tasks'
import { backgroundOutcome, MAX_BACKGROUND_WORK } from '../background-work'
import { boundCommands, type ProviderCommand } from '../provider-commands'
import { CLAUDE_COMMAND_PREFIX } from './command-prefix'
import { takeAssistantNotice } from './assistant-notice'
import {
  summarizeToolInput,
  summarizeToolResult,
  textParts,
  truncateToolSummary as truncate,
} from './tool-summary'

import { FileEdits } from './file-edits'
import { summaryEvents } from './summary-events'
import { ClaudeMemoryStore } from './memory-store'
import { SubAgentTasks } from './sub-agent-tasks'
import { ToolAnswers } from '../tool-answer'
import type { ClaudeMessageReceipts } from './message-receipts'
import { WorkflowTasks } from './workflow-tasks'
import type { ClaudeFinalAnswers } from './final-answers'
import {
  MAX_WORKFLOW_AGENTS,
  MAX_WORKFLOW_DESCRIPTION,
  workflowAgentState,
  type WorkflowAgent,
  type WorkflowPhase,
} from '../workflow-run'

export { TOOL_SUMMARY_MAX } from './tool-summary'

export function normalizeMessage(
  message: SDKMessage,
  tasks: SubAgentTasks = new SubAgentTasks(),
  edits: FileEdits = new FileEdits(),
  runs: WorkflowTasks = new WorkflowTasks(),
  background: BackgroundTasks = new BackgroundTasks(),
  memory: ClaudeMemoryStore = new ClaudeMemoryStore(),
  answers: ToolAnswers = new ToolAnswers(),
  announced: AnnouncedCli = new AnnouncedCli(),
  receipts?: ClaudeMessageReceipts,
  finalAnswers?: ClaudeFinalAnswers,
): RuntimeEvent[] {
  const finalAnswer = finalAnswers?.observe(message)
  memory.noteInit(message)
  announced.noteInit(message)
  switch (message.type) {
    case 'assistant': {
      const events: RuntimeEvent[] = []
      const content = message.message.content
      const parent = subAgentParent(message)
      const final =
        message.message.stop_reason === 'end_turn' &&
        message.error === undefined &&
        message.aborted !== true &&
        (typeof content === 'string' || !content.some((block) => block.type === 'tool_use'))
      const credential = typeof message.error === 'string' && isCredentialFailure(message.error)
      let run = ''
      const messageId = finalAnswers?.messageId(message)
      const flushText = (): void => {
        if (run)
          events.push({
            type: 'assistant_message',
            text: run,
            ...(final ? { phase: 'final' as const } : {}),
            ...(messageId === undefined ? {} : { messageId }),
            ...(parent ? { parentToolCallId: parent } : {}),
          })
        run = ''
      }
      if (typeof content === 'string') {
        run = content
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block['type'] === 'text' && typeof block['text'] === 'string') {
            run += block['text']
          } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
            flushText()
            const name = typeof block['name'] === 'string' ? block['name'] : 'tool'
            receipts?.called(block['id'], name, message.parent_tool_use_id)
            const memoryPath = memory.target(block['input'])
            const displayName = splitQualified(CLAUDE_TOOL_NAMING, name)?.tool
            events.push({
              type: 'tool_call',
              id: block['id'],
              name,
              ...(displayName === undefined ? {} : { displayName }),
              summary: summarizeToolInput(name, block['input']),
              ...(memoryPath === null ? {} : { memoryPath }),
              ...(parent ? { parentToolCallId: parent } : {}),
            })
            edits.called(block['id'], name, block['input'])
          }
        }
      }
      flushText()
      const theClisNotice = isTheClisNotice(message)
      if (typeof message.error === 'string' || theClisNotice) {
        const notice = theClisNotice ? takeAssistantNotice(events) : ''
        const said = notice.trim() ? notice : assistantErrorWords(message.error ?? 'unknown')
        if (credential) {
          events.push({ type: 'error', message: said, fatal: true, cause: 'auth_stale' })
        } else {
          const refusal = notice.trim() ? recognisedRefusal(notice, announced) : null
          events.push({
            type: 'error',
            message: said,
            fatal: false,
            ...(refusal === null ? {} : { refusal }),
            ...(message.error === 'billing_error' ? { billingRefused: true as const } : {}),
          })
        }
      }
      return finalAnswer == null ? events : [...events, finalAnswer]
    }

    case 'stream_event': {
      const event: unknown = message.event
      if (!isRecord(event) || typeof event['type'] !== 'string') {
        return [wrapUnknown('claude', message, 'unrecognized', 'malformed stream frame')]
      }
      if (event['type'] === 'ping') return [aPassingFragment(message, 'lifecycle', 'ping')]
      const eventType = event['type'] as StreamEventType
      if (!hasRequiredStreamFields(eventType, event))
        return [wrapUnknown('claude', message, 'unrecognized', `${eventType} (incomplete)`)]
      if (eventType !== 'content_block_delta') {
        return [
          ...contextReading(message, eventType, event),
          ...(finalAnswer == null ? [] : [finalAnswer]),
          aPassingFragment(message, streamEventCategory(eventType), eventType),
        ]
      }
      const delta = event['delta']
      if (!isRecord(delta) || typeof delta['type'] !== 'string') {
        return [wrapUnknown('claude', message, 'unrecognized', 'content_block_delta (malformed)')]
      }
      const deltaType = delta['type'] as BlockDeltaType
      if (deltaType === 'text_delta') {
        const text = delta['text']
        if (typeof text !== 'string')
          return [wrapUnknown('claude', message, 'unrecognized', 'text_delta (malformed)')]
        return text ? [{ type: 'assistant_delta', text }] : []
      }
      const thinkingInWords =
        deltaType === 'thinking_delta' &&
        typeof delta['thinking'] === 'string' &&
        delta['thinking'] !== ''
      return [
        ...compactingActivity(message, deltaType),
        thinkingInWords
          ? wrapUnknown('claude', message, blockDeltaCategory(deltaType), deltaType)
          : aPassingFragment(message, blockDeltaCategory(deltaType), deltaType),
      ]
    }

    case 'user': {
      const events: RuntimeEvent[] = []
      const content = message.message.content
      const parent = subAgentParent(message)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
            const ok = block['is_error'] !== true
            const detachedAs = background.detachedAs(block['tool_use_id'])
            const parts = textParts(block['content'])
            answers.write(block['tool_use_id'], parts)
            const soleResult =
              content.filter((part) => isRecord(part) && part['type'] === 'tool_result').length ===
              1
            const machineReply = block['content']
            const textOnly =
              Array.isArray(machineReply) &&
              machineReply.every((part: unknown) => isRecord(part) && part['type'] === 'text')
            const messageAct = receipts?.settled(
              block['tool_use_id'],
              message.parent_tool_use_id,
              ok && soleResult && textOnly,
              message.tool_use_result,
              parts,
            )
            events.push({
              type: 'tool_result',
              id: block['tool_use_id'],
              summary: summarizeToolResult(block['content']),
              ok,
              ...(messageAct === undefined ? {} : { messageAct }),
              ...(parent ? { parentToolCallId: parent } : {}),
              ...(detachedAs ? { backgrounded: true, backgroundId: detachedAs } : {}),
            })
            const edit = edits.settled(block['tool_use_id'], ok)
            if (edit)
              events.push({ type: 'file_change', changes: [edit.change], source: edit.tool })
          }
        }
      }
      return events
    }

    case 'system': {
      const summary = summaryEvents(message)
      if (summary !== null) return summary
      if (message.subtype === 'init') {
        if (!background.processRestarted()) return []
        return [{ type: 'background_work', running: [], source: message.subtype }]
      }
      if (message.subtype === 'api_retry') {
        return [{ type: 'error', message: apiRetryMessage(message), fatal: false }]
      }
      if (message.subtype === 'session_writes_lost') {
        const lost = message.lost
          .map((part) => (part === 'transcript' ? 'conversation history' : 'global settings'))
          .join(' and ')
        const reason =
          message.error_code === 'EDQUOT' ? 'the disk quota was used up' : 'the disk was full'
        return [
          {
            type: 'error',
            message:
              `Claude Code couldn't save ${lost} because ${reason}.` +
              (message.lost.includes('transcript')
                ? ' Resuming affected conversations may miss part of their history.'
                : ''),
            fatal: false,
          },
          wrapUnknown('claude', message, 'lifecycle', message.subtype),
        ]
      }
      if (message.subtype === 'model_refusal_no_fallback') {
        return [{ type: 'error', message: refusalNotice(message), fatal: false }]
      }
      if (message.subtype === 'informational' && informationalLevel(message) === 'warning') {
        return [{ type: 'error', message: informationalWarning(message), fatal: false }]
      }
      if (message.subtype === 'thinking_tokens') {
        const tokens = readNumber(message, 'estimated_tokens')
        return [
          {
            type: 'thinking',
            phase: 'delta',
            redacted: true,
            ...(tokens !== undefined ? { tokens } : {}),
          },
          { type: 'activity', phase: 'thinking' },
        ]
      }
      const status = readString(message, 'status')
      if (message.subtype === 'status' && status === 'requesting') {
        return [{ type: 'activity', phase: 'waiting' }]
      }
      if (message.subtype === 'status' && status === 'compacting' && !subAgentParent(message)) {
        return [{ type: 'activity', phase: 'compacting' }]
      }
      if (message.subtype === 'compact_boundary') {
        const meta = readField(message, 'compact_metadata')
        const before = readNumber(meta, 'pre_tokens')
        const after = readNumber(meta, 'post_tokens')
        const trigger = readString(meta, 'trigger')
        const parent = subAgentParent(message)
        return [
          {
            type: 'compaction',
            ...(parent ? { parentToolCallId: parent } : {}),
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
            ...(trigger === 'manual' || trigger === 'auto' ? { trigger } : {}),
            source: message.subtype,
          },
          ...(after !== undefined && !subAgentParent(message)
            ? [
                {
                  type: 'context_reading' as const,
                  reading: { kind: 'tokens' as const, used: after },
                  source: message.subtype,
                },
              ]
            : []),
        ]
      }
      if ((message as { readonly subtype: string }).subtype === 'vcs_state_changed') {
        return [wrapUnknown('claude', message, 'lifecycle', aRepositoryChange(message))]
      }
      const background_ = [
        ...backgroundWorkEvents(message, background),
        ...providerCommandsEvents(message),
      ]
      const ran = workflowRunEvent(message, runs)
      if (ran) return [...background_, ran]
      const dispatched = subAgentEvent(message, tasks)
      if (dispatched) return [...background_, dispatched]
      const category = systemCategory(message.subtype)
      return [...background_, wrapUnknown('claude', message, category, message.subtype)]
    }

    case 'result':
      return []

    case 'rate_limit_event': {
      const usage = rateLimitUsage(message)
      const withTheReading = (said: RuntimeEvent[]): RuntimeEvent[] =>
        usage === null ? said : [...said, usage]
      const throttle = rateLimitThrottle(message)
      if (throttle) return withTheReading([{ type: 'error', message: throttle, fatal: false }])
      const cleared = rateLimitCleared(message)
      if (cleared) return withTheReading([cleared])
      return withTheReading([
        wrapUnknown('claude', message, messageTypeCategory(message.type), message.type),
      ])
    }

    default:
      break
  }
  if ((message as { readonly type: string }).type === 'command_lifecycle') {
    return [wrapUnknown('claude', message, 'lifecycle', 'command_lifecycle')]
  }
  return [
    wrapUnknown(
      'claude',
      message,
      messageTypeCategory(message.type as NonContentMessageType),
      message.type,
    ),
  ]
}

function aPassingFragment(
  message: SDKMessage,
  category: UnknownCategory,
  label: string,
): RuntimeEvent {
  const fragment = wrapUnknown('claude', message, category, label)
  return fragment.type === 'unknown' && category !== 'unrecognized'
    ? { ...fragment, passing: true }
    : fragment
}

function subAgentParent(message: SDKMessage): string {
  return readString(message, 'parent_tool_use_id')
}

function providerCommandsEvents(message: Extract<SDKMessage, { type: 'system' }>): RuntimeEvent[] {
  if (message.subtype !== 'commands_changed') return []
  const raw = readField(message, 'commands')
  if (!Array.isArray(raw)) return []
  const { commands, dropped } = boundCommands(raw.map(readCommand))
  return [
    {
      type: 'provider_commands',
      commands,
      prefix: CLAUDE_COMMAND_PREFIX,
      ...(dropped > 0 ? { dropped } : {}),
      source: message.subtype,
    },
  ]
}

export function readCommand(row: unknown): ProviderCommand {
  const aliases = readField(row, 'aliases')
  return {
    name: readString(row, 'name'),
    ...(readString(row, 'description') ? { description: readString(row, 'description') } : {}),
    ...(readString(row, 'argumentHint') ? { argumentHint: readString(row, 'argumentHint') } : {}),
    ...(Array.isArray(aliases)
      ? { aliases: aliases.filter((alias): alias is string => typeof alias === 'string') }
      : {}),
  }
}

function backgroundWorkEvents(
  message: Extract<SDKMessage, { type: 'system' }>,
  background: BackgroundTasks,
): RuntimeEvent[] {
  const subtype = message.subtype
  if (subtype === 'background_tasks_changed') {
    const raw = readField(message, 'tasks')
    if (!Array.isArray(raw)) return []
    const all = raw.filter(isRecord).map((task) => ({
      id: readString(task, 'task_id'),
      kind: readString(task, 'task_type'),
      description: truncate(readString(task, 'description')),
    }))
    const named = all.filter((task) => task.id !== '')
    const dropped = raw.length - Math.min(named.length, MAX_BACKGROUND_WORK)
    background.replace(named, dropped)
    return [
      {
        type: 'background_work',
        running: background.snapshot(),
        ...(dropped > 0 ? { dropped } : {}),
        source: subtype,
      },
    ]
  }
  const taskId = readString(message, 'task_id')
  if (!taskId) return []
  const toolUseId = readString(message, 'tool_use_id')
  if (toolUseId) background.bind(taskId, toolUseId)

  if (subtype === 'task_started') {
    if (!background.has(taskId)) return []
    return [
      {
        type: 'background_work',
        running: background.snapshot(),
        ...(background.dropped() > 0 ? { dropped: background.dropped() } : {}),
        source: subtype,
      },
    ]
  }

  if (subtype === 'task_updated') {
    const patch = readField(message, 'patch')
    const status = readString(patch, 'status')
    const flag = isRecord(patch) ? patch['is_backgrounded'] : undefined
    const ended = background.update(taskId, {
      ...(status ? { status } : {}),
      ...(typeof flag === 'boolean' ? { isBackgrounded: flag } : {}),
    })
    if (!ended || !background.wasBackground(taskId)) return []
    return [
      {
        type: 'background_work',
        ended: endingOf(message, taskId, status, background),
        source: subtype,
      },
    ]
  }

  if (subtype === 'task_notification') {
    const status = readString(message, 'status')
    if (!background.wasBackground(taskId)) return []
    background.finish(taskId)
    return [
      {
        type: 'background_work',
        ended: endingOf(message, taskId, status, background),
        source: subtype,
      },
    ]
  }
  return []
}

function endingOf(
  message: Extract<SDKMessage, { type: 'system' }>,
  taskId: string,
  status: string,
  background: BackgroundTasks,
): NonNullable<BackgroundWorkEvent['ended']> {
  const toolCallId = background.toolFor(taskId)
  const summary = truncate(readString(message, 'summary'))
  const outputFile = readString(message, 'output_file')
  return {
    id: taskId,
    ...(toolCallId ? { toolCallId } : {}),
    outcome: backgroundOutcome(status),
    ...(summary ? { summary } : {}),
    ...(outputFile ? { outputFile } : {}),
  }
}

function subAgentEvent(
  message: Extract<SDKMessage, { type: 'system' }>,
  tasks: SubAgentTasks,
): RuntimeEvent | null {
  const subtype = message.subtype
  if (
    subtype !== 'task_started' &&
    subtype !== 'task_progress' &&
    subtype !== 'task_updated' &&
    subtype !== 'task_notification'
  ) {
    return null
  }
  const agentId = readString(message, 'task_id')
  if (!agentId) return null
  const parentToolCallId = readString(message, 'tool_use_id')
  const kind = readString(message, 'subagent_type')
  if (!admitsSubAgent(subtype, agentId, kind, message, tasks)) return null
  const usage = subAgentUsage(readField(message, 'usage'))
  const common = {
    agentId,
    idKind: 'task' as const,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(kind ? { kind } : {}),
    ...(usage ? { usage } : {}),
  }

  if (subtype === 'task_started') {
    const title = readString(message, 'description')
    return { type: 'sub_agent', phase: 'started', ...common, ...(title ? { title } : {}) }
  }

  if (subtype === 'task_progress') {
    const lastTool = readString(message, 'last_tool_name')
    return { type: 'sub_agent', phase: 'progress', ...common, ...(lastTool ? { lastTool } : {}) }
  }

  const status =
    subtype === 'task_updated'
      ? readString(readField(message, 'patch'), 'status')
      : readString(message, 'status')
  const outcome = subAgentOutcome(status)
  if (subtype === 'task_updated' && !outcome) return null
  const summary = readString(message, 'summary')
  return {
    type: 'sub_agent',
    phase: 'ended',
    ...common,
    ...(outcome ? { outcome } : {}),
    ...(summary ? { summary } : {}),
  }
}

function workflowRunEvent(
  message: Extract<SDKMessage, { type: 'system' }>,
  runs: WorkflowTasks,
): RuntimeEvent | null {
  const subtype = message.subtype
  if (
    subtype !== 'task_started' &&
    subtype !== 'task_progress' &&
    subtype !== 'task_updated' &&
    subtype !== 'task_notification'
  ) {
    return null
  }
  const taskId = readString(message, 'task_id')
  if (!taskId) return null

  const roster = readField(message, 'workflow_progress')
  if (!admitsWorkflow(subtype, taskId, message, Array.isArray(roster), runs)) return null

  runs.anchor(taskId, readString(message, 'tool_use_id'))
  const toolUseId = runs.anchorOf(taskId)
  const usage = subAgentUsage(readField(message, 'usage'))
  const parsed = Array.isArray(roster) ? readWorkflowProgress(roster) : null
  const description = truncate(
    subtype === 'task_progress'
      ? readString(message, 'summary')
      : readString(message, 'description') || readString(message, 'summary'),
    MAX_WORKFLOW_DESCRIPTION - 1,
  )
  const common = {
    type: 'workflow_run' as const,
    taskId,
    ...(toolUseId ? { toolUseId } : {}),
    ...(description ? { description } : {}),
    ...(parsed?.phases ? { phases: parsed.phases } : {}),
    ...(parsed?.agents ? { agents: parsed.agents } : {}),
    ...(parsed?.dropped ? { droppedAgents: parsed.dropped } : {}),
    ...(usage ? { usage } : {}),
    source: subtype,
  }

  if (subtype === 'task_started') {
    const name = truncate(readString(message, 'workflow_name'))
    return { ...common, ...(name ? { name } : {}) }
  }

  if (subtype === 'task_progress') return common

  const status =
    subtype === 'task_updated'
      ? readString(readField(message, 'patch'), 'status')
      : readString(message, 'status')
  const outcome = workflowOutcome(status)
  if (subtype === 'task_updated' && !outcome) return null
  const outputFile = readString(message, 'output_file')
  return {
    ...common,
    outcome: outcome ?? 'unknown',
    ...(outputFile ? { outputFile } : {}),
  }
}

function workflowOutcome(status: string): 'completed' | 'failed' | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  return undefined
}

function admitsWorkflow(
  subtype: 'task_started' | 'task_progress' | 'task_updated' | 'task_notification',
  taskId: string,
  message: Extract<SDKMessage, { type: 'system' }>,
  carriesRoster: boolean,
  runs: WorkflowTasks,
): boolean {
  if (subtype === 'task_started') {
    return runs.start(
      taskId,
      readString(message, 'task_type'),
      readString(message, 'subagent_type'),
      readField(message, 'skip_transcript') === true,
    )
  }
  if (runs.knows(taskId)) return true
  return subtype === 'task_progress' && runs.join(taskId, carriesRoster)
}

function readWorkflowProgress(entries: readonly unknown[]): {
  phases?: WorkflowPhase[]
  agents?: WorkflowAgent[]
  dropped: number
} {
  const phases: WorkflowPhase[] = []
  const agents: WorkflowAgent[] = []
  let dropped = 0
  for (const entry of entries) {
    const kind = readString(entry, 'type')
    if (kind === 'workflow_phase') {
      const index = readNumber(entry, 'index')
      const title = readString(entry, 'title')
      if (index === undefined || !Number.isInteger(index) || index < 0) continue
      phases.push({ index, title: truncate(title) })
      continue
    }
    if (kind !== 'workflow_agent') continue
    const agentId = readString(entry, 'agentId')
    const phaseIndex = readNumber(entry, 'phaseIndex')
    if (!agentId || phaseIndex === undefined || !Number.isInteger(phaseIndex) || phaseIndex < 0)
      continue
    if (agents.length >= MAX_WORKFLOW_AGENTS) {
      dropped += 1
      continue
    }
    const model = truncate(readString(entry, 'model'))
    const lastTool = truncate(readString(entry, 'lastToolName'))
    const lastToolSummary = truncate(readString(entry, 'lastToolSummary'))
    const attempt = readNumber(entry, 'attempt')
    const queuedAt = readNumber(entry, 'queuedAt')
    const startedAt = readNumber(entry, 'startedAt')
    const tokens = readNumber(entry, 'tokens')
    const toolCalls = readNumber(entry, 'toolCalls')
    const durationMs = readNumber(entry, 'durationMs')
    agents.push({
      agentId,
      label: truncate(readString(entry, 'label') || agentId),
      phaseIndex,
      state: workflowAgentState(readString(entry, 'state')),
      ...(model ? { model } : {}),
      ...(queuedAt !== undefined ? { queuedAt } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(attempt !== undefined && Number.isInteger(attempt) && attempt > 0 ? { attempt } : {}),
      ...(lastTool ? { lastTool } : {}),
      ...(lastToolSummary ? { lastToolSummary } : {}),
      ...(tokens !== undefined && tokens >= 0 ? { tokens } : {}),
      ...(toolCalls !== undefined && toolCalls >= 0 ? { toolCalls } : {}),
      ...(durationMs !== undefined && durationMs >= 0 ? { durationMs } : {}),
    })
  }
  return {
    ...(phases.length > 0 ? { phases } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    dropped,
  }
}

function admitsSubAgent(
  subtype: 'task_started' | 'task_progress' | 'task_updated' | 'task_notification',
  agentId: string,
  kind: string,
  message: Extract<SDKMessage, { type: 'system' }>,
  tasks: SubAgentTasks,
): boolean {
  if (subtype === 'task_started') {
    const skipTranscript = readField(message, 'skip_transcript') === true
    return tasks.start(agentId, kind, readString(message, 'task_type'), skipTranscript)
  }
  if (tasks.knows(agentId)) return true
  return subtype === 'task_progress' && tasks.join(agentId, kind)
}

function subAgentOutcome(status: string): 'completed' | 'failed' | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  return undefined
}

function subAgentUsage(
  raw: unknown,
): { tokens?: number; toolCalls?: number; ms?: number } | undefined {
  const tokens = readNumber(raw, 'total_tokens')
  const toolCalls = readNumber(raw, 'tool_uses')
  const ms = readNumber(raw, 'duration_ms')
  if (tokens === undefined && toolCalls === undefined && ms === undefined) return undefined
  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(ms !== undefined ? { ms } : {}),
  }
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function informationalLevel(message: Extract<SDKMessage, { type: 'system' }>): string {
  const level = (message as unknown as { level?: unknown }).level
  return typeof level === 'string' ? level : ''
}

function informationalWarning(message: Extract<SDKMessage, { type: 'system' }>): string {
  const content = (message as unknown as { content?: unknown }).content
  const words = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : ''
  return words
    ? `claude warned: ${truncate(words)}`
    : 'claude raised a warning without saying what it was'
}

const A_REPOSITORY_CHANGE: ReadonlyMap<string, { readonly did: string; readonly to: string }> =
  new Map([
    ['commit', { did: 'committed', to: ' on ' }],
    ['push', { did: 'pushed', to: ' ' }],
    ['merge', { did: 'merged', to: ' into ' }],
    ['rebase', { did: 'rebased', to: ' ' }],
  ])

function aRepositoryChange(message: Extract<SDKMessage, { type: 'system' }>): string {
  const kind = readString(message, 'kind').replace(/\s+/g, ' ').trim()
  if (!kind) return 'vcs_state_changed'
  const branch = readString(message, 'branch').replace(/\s+/g, ' ').trim()
  const { did, to } = A_REPOSITORY_CHANGE.get(kind) ?? { did: truncate(kind), to: ' on ' }
  return `vcs_state_changed (${did}${branch ? `${to}${truncate(branch)}` : ''})`
}

function apiRetryMessage(message: Extract<SDKMessage, { type: 'system' }>): string {
  const m = message as unknown as {
    attempt?: number
    max_retries?: number
    retry_delay_ms?: number
    error_status?: number | null
    error?: string
  }
  const parts = [
    typeof m.attempt === 'number' && typeof m.max_retries === 'number'
      ? `attempt ${m.attempt}/${m.max_retries}`
      : '',
    typeof m.retry_delay_ms === 'number'
      ? `retrying in ${Math.round(m.retry_delay_ms / 100) / 10}s`
      : '',
    typeof m.error_status === 'number' ? `HTTP ${m.error_status}` : '',
  ].filter(Boolean)
  const why = typeof m.error === 'string' ? assistantErrorWords(m.error) : 'claude hit an API error'
  return `${why}; retrying${parts.length ? ` (${parts.join(', ')})` : ''}`
}

function refusalNotice(message: Extract<SDKMessage, { type: 'system' }>): string {
  const category = readString(message, 'api_refusal_category')
  const detail = readString(message, 'api_refusal_explanation') || readString(message, 'content')
  const head =
    `claude declined to answer${category ? ` (${category})` : ''}` +
    ` — no fallback model was tried, so this turn produced nothing`
  return detail ? `${head}: ${truncate(detail)}` : `${head}.`
}

function rateLimitThrottle(message: SDKMessage): string | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  const status = info['status']
  if (status !== 'rejected' && status !== 'allowed_warning') return null
  const kind = typeof info['rateLimitType'] === 'string' ? ` (${info['rateLimitType']})` : ''
  const resetsAt = typeof info['resetsAt'] === 'number' ? info['resetsAt'] : null
  const resets = resetsAt ? `; resets ${new Date(resetsAt * 1000).toISOString()}` : ''
  const utilization = info['utilization']
  const used =
    typeof utilization === 'number' && Number.isFinite(utilization) && utilization >= 0
      ? ` — ${String(Math.round(utilization * 100))}% used`
      : ''
  return status === 'rejected'
    ? `claude is rate-limited${kind} — the turn may stall until it resets${resets}`
    : `claude is approaching its rate limit${kind}${used}${resets}`
}

function rateLimitCleared(message: SDKMessage): RuntimeEvent | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  if (info['status'] !== 'allowed') return null
  return {
    type: 'provider_limit_clear',
    window: typeof info['rateLimitType'] === 'string' ? info['rateLimitType'] : '',
    source: 'rate_limit_event',
  }
}

function rateLimitUsage(message: SDKMessage): RuntimeEvent | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  const unified = info['unifiedWindows']
  const windows: [string, Record<string, unknown>][] = isRecord(unified)
    ? Object.entries(unified).flatMap(([window, value]) =>
        isRecord(value) ? [[window, value] as [string, Record<string, unknown>]] : [],
      )
    : typeof info['rateLimitType'] === 'string'
      ? [[info['rateLimitType'], info]]
      : []
  const readings = windows
    .slice(0, MAX_USAGE_WINDOWS)
    .map(([window, value]) => {
      const utilization = value['utilization']
      const resetsAt = value['resetsAt']
      return {
        window: window.slice(0, 120),
        usedPercent:
          typeof utilization === 'number' && utilization >= 0
            ? Math.round(utilization * 1000) / 10
            : null,
        resetsAt: typeof resetsAt === 'number' && resetsAt >= 0 ? resetsAt * 1000 : null,
      }
    })
    .filter((reading) => reading.usedPercent !== null || reading.resetsAt !== null)
  return readings.length === 0 ? null : { type: 'provider_usage', readings }
}

function messageTypeCategory(type: NonContentMessageType): UnknownCategory {
  switch (type) {
    case 'tool_progress':
    case 'tool_use_summary':
      return 'activity'
    case 'rate_limit_event':
    case 'auth_status':
    case 'conversation_reset':
      return 'lifecycle'
    case 'prompt_suggestion':
      return 'echo'
    default:
      return assertMessageTypeExhaustive(type)
  }
}

function assertMessageTypeExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

function hasRequiredStreamFields(type: StreamEventType, event: Record<string, unknown>): boolean {
  const hasIndex = typeof event['index'] === 'number'
  switch (type) {
    case 'message_start':
      return isRecord(event['message'])
    case 'message_delta':
      return isRecord(event['delta'])
    case 'message_stop':
      return true
    case 'content_block_start':
      return hasIndex && isRecord(event['content_block'])
    case 'content_block_delta':
      return hasIndex && isRecord(event['delta'])
    case 'content_block_stop':
      return hasIndex
    default:
      return assertStreamFieldsExhaustive(type)
  }
}

function assertStreamFieldsExhaustive(type: never): boolean {
  void type
  return false
}

function streamEventCategory(
  type: Exclude<StreamEventType, 'content_block_delta'>,
): UnknownCategory {
  switch (type) {
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    case 'content_block_start':
    case 'content_block_stop':
      return 'lifecycle'
    default:
      return assertStreamEventExhaustive(type)
  }
}

function assertStreamEventExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

function contextReading(
  message: SDKMessage,
  eventType: StreamEventType,
  event: Record<string, unknown>,
): RuntimeEvent[] {
  if (subAgentParent(message)) return []
  const usage =
    eventType === 'message_start'
      ? readField(readField(event, 'message'), 'usage')
      : eventType === 'message_delta'
        ? readField(event, 'usage')
        : undefined
  if (!isRecord(usage)) return []
  const input = [
    readNumber(usage, 'input_tokens'),
    readNumber(usage, 'cache_creation_input_tokens'),
    readNumber(usage, 'cache_read_input_tokens'),
  ]
  if (!input.some((part) => part !== undefined)) return []
  const used = [...input, readNumber(usage, 'output_tokens')].reduce<number>(
    (sum, part) => sum + (part ?? 0),
    0,
  )
  return [{ type: 'context_reading', reading: { kind: 'tokens', used }, source: eventType }]
}

function blockDeltaCategory(type: Exclude<BlockDeltaType, 'text_delta'>): UnknownCategory {
  switch (type) {
    case 'thinking_delta':
      return 'reasoning'
    case 'input_json_delta':
    case 'citations_delta':
      return 'activity'
    case 'signature_delta':
    case 'compaction_delta':
      return 'lifecycle'
    default:
      return assertBlockDeltaExhaustive(type)
  }
}

function compactingActivity(
  message: SDKMessage,
  type: Exclude<BlockDeltaType, 'text_delta'>,
): RuntimeEvent[] {
  if (subAgentParent(message)) return []
  return type === 'compaction_delta' ? [{ type: 'activity', phase: 'compacting' }] : []
}

function assertBlockDeltaExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

function systemCategory(
  subtype: Exclude<SystemSubtype, 'init' | 'compact_boundary' | 'session_writes_lost'>,
): UnknownCategory {
  switch (subtype) {
    case 'thinking_tokens':
      return 'reasoning'
    case 'session_state_changed':
    case 'worker_shutting_down':
    case 'files_persisted':
    case 'commands_changed':
    case 'background_tasks_changed':
    case 'plugin_install':
    case 'api_retry':
      return 'lifecycle'
    case 'status':
    case 'task_started':
    case 'task_updated':
    case 'task_progress':
    case 'task_notification':
    case 'hook_started':
    case 'hook_progress':
    case 'hook_response':
    case 'control_request_progress':
    case 'local_command_output':
    case 'memory_recall':
    case 'elicitation_complete':
    case 'notification':
    case 'permission_denied':
    case 'mirror_error':
    case 'model_refusal_fallback':
    case 'model_refusal_no_fallback':
    case 'informational':
      return 'activity'
    default:
      return assertSubtypeExhaustive(subtype)
  }
}

function assertSubtypeExhaustive(subtype: never): UnknownCategory {
  void subtype
  return 'unrecognized'
}

export function claudeSessionRef(
  message: SDKMessage,
  cwd: string,
  rotation: number,
): SessionRef | null {
  if (message.type === 'system' && message.subtype === 'init') {
    return { provider: 'claude', sessionId: message.session_id, cwd: message.cwd || cwd, rotation }
  }
  return null
}

export function claudeConversationReset(message: SDKMessage): { readonly from: string } | null {
  if (message.type !== 'conversation_reset') return null
  return { from: readString(message, 'session_id') }
}

export function refAfterReset(current: SessionRef | null, next: string): SessionRef | null {
  if (current === null) return null
  if (!next || next === current.sessionId) return null
  return { ...current, sessionId: next }
}

export class ClaudeLimitWatch {
  private rejected: TurnLimit | null = null
  private replyHitALimit = false

  observe(message: SDKMessage): void {
    if (message.type === 'assistant') {
      if (message.error === 'rate_limit') this.replyHitALimit = true
      return
    }
    if (message.type !== 'rate_limit_event') return
    const info = (message as unknown as { rate_limit_info?: unknown }).rate_limit_info
    const status = readString(info, 'status')
    if (status === 'allowed') this.rejected = null
    if (status !== 'rejected') return
    const window = readString(info, 'rateLimitType')
    const resetsAt = readNumber(info, 'resetsAt')
    this.rejected =
      window === ''
        ? null
        : {
            provider: 'claude',
            window,
            ...(resetsAt === undefined ? {} : { resetsAt: resetsAt * 1000 }),
            ...(readString(info, 'errorCode') === 'credits_required'
              ? { creditsRequired: true as const }
              : {}),
          }
  }

  turnEnded(outcome: 'completed' | 'failed' | 'interrupted', now: number): TurnLimit | undefined {
    const hit = this.replyHitALimit
    this.replyHitALimit = false
    if (!hit || outcome !== 'failed' || this.rejected === null) return undefined
    const { resetsAt } = this.rejected
    if (resetsAt !== undefined && resetsAt <= now) return undefined
    return this.rejected
  }
}

export class ClaudeBillingWatch {
  private replyRefusedBilling = false

  observe(message: SDKMessage): void {
    if (
      message.type === 'assistant' &&
      message.error === 'billing_error' &&
      message.parent_tool_use_id === null
    ) {
      this.replyRefusedBilling = true
    }
  }

  turnEnded(outcome: 'completed' | 'failed' | 'interrupted'): boolean {
    const refused = this.replyRefusedBilling
    this.replyRefusedBilling = false
    return refused && outcome === 'failed'
  }
}

const STOPPED: ReadonlySet<string> = new Set(['aborted_streaming', 'aborted_tools'])

export function claudeResultOutcome(
  message: SDKMessage,
): { outcome: 'completed' | 'failed' | 'interrupted'; message?: string } | null {
  if (message.type !== 'result') return null
  if (STOPPED.has(readString(message, 'terminal_reason'))) return { outcome: 'interrupted' }
  if (message.subtype === 'success') {
    if (message.is_error !== true) return { outcome: 'completed' }
    const said = readString(message, 'result')
    return said ? { outcome: 'failed', message: `turn failed: ${said}` } : { outcome: 'failed' }
  }
  const errors = readField(message, 'errors')
  const details = [
    readString(message, 'result'),
    ...(Array.isArray(errors)
      ? errors.filter((error): error is string => typeof error === 'string')
      : []),
  ].filter((detail) => detail.trim() !== '')
  const detail = details.join('\n') || message.subtype
  return { outcome: 'failed', message: `turn failed: ${detail}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

function readNumber(value: unknown, key: string): number | undefined {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}
