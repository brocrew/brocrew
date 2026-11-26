import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { claudeProjectDirName, claudeTranscriptPath } from '@brobot2/runtime/claude'
import { type SessionRef } from '@brobot2/runtime'
import { readChildFile, MAX_CHILD_WORK_BYTES, type ChildWorkPart } from '../../child-work-file'
import { realPathOf, type ReadRefusal, type TextFile } from '../../read-text-file'
import { importClaudeTranscript } from './import-transcript'
import type { ProviderChildWorkRequest } from '../transcript-policy'
import type { ChildWorkResult } from '../../../shared/runtime-ipc'
import { errorFactsForEvent } from '../error-diagnostic'
import { completeTranscriptLines } from '../complete-transcript-lines'
/** Bound sidecar reads so an unexpectedly large file cannot stall the window. */
const MAX_SIDECAR_BYTES = 64 * 1024

export interface ChildWorkLocation {
  path: string
  runId: string | null
}

export interface ChildWorkFile extends TextFile {
  name: string
  runId: string | null
}

export function childWorkRoot(providerHome: string, parent: SessionRef): string {
  const transcript = claudeTranscriptPath(parent.sessionId, parent.cwd, providerHome)
  const folder =
    transcript !== null
      ? dirname(transcript)
      : join(providerHome, 'projects', claudeProjectDirName(parent.cwd))
  return join(folder, parent.sessionId)
}

function isPlainId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function subdirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function locateAgentFile(root: string, agentId: string): ChildWorkLocation | null {
  const subagents = join(root, 'subagents')
  const file = `agent-${agentId}.jsonl`
  const flat = join(subagents, file)
  if (existsSync(flat)) return { path: flat, runId: null }
  const runs = join(subagents, 'workflows')
  for (const runId of subdirectories(runs)) {
    const candidate = join(runs, runId, file)
    if (existsSync(candidate)) return { path: candidate, runId }
  }
  return null
}

export function locateChildWork(
  root: string,
  agentId: string,
  part: ChildWorkPart,
): ChildWorkLocation | null {
  if (!isPlainId(agentId)) return null
  const agent = locateAgentFile(root, agentId)
  if (agent === null || part === 'transcript') return agent
  const runId = agent.runId
  if (runId === null) return null
  if (part === 'journal') {
    const journal = join(root, 'subagents', 'workflows', runId, 'journal.jsonl')
    return existsSync(journal) ? { path: journal, runId } : null
  }
  const scripts = join(root, 'workflows', 'scripts')
  const suffix = `-${runId}.js`
  try {
    const name = readdirSync(scripts).find((entry) => entry.endsWith(suffix))
    return name === undefined ? null : { path: join(scripts, name), runId }
  } catch {
    return null
  }
}

export interface ChildSidecar {
  title?: string
  parentToolCallId?: string
}

export function claudeSidecarPath(transcriptPath: string): string | null {
  if (!transcriptPath.endsWith('.jsonl')) return null
  return `${transcriptPath.slice(0, -'.jsonl'.length)}.meta.json`
}

export function parseClaudeSidecar(text: string): ChildSidecar {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const record = parsed as Record<string, unknown>
  const title = record['description']
  const parentToolCallId = record['toolUseId']
  return {
    ...(typeof title === 'string' && title ? { title } : {}),
    ...(typeof parentToolCallId === 'string' && parentToolCallId ? { parentToolCallId } : {}),
  }
}

export function countThinkingBlocks(lines: string[]): number {
  let count = 0
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const content = (record as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if ((block as { type?: unknown })?.type === 'thinking') count++
    }
  }
  return count
}

export function readChildWork(
  root: string,
  agentId: string,
  part: ChildWorkPart,
  max = MAX_CHILD_WORK_BYTES,
): ChildWorkFile | ReadRefusal {
  const found = locateChildWork(root, agentId, part)
  if (found === null) return 'gone'
  const read = readChildFile(found.path, max)
  if (typeof read === 'string') return read
  return {
    name: basename(read.path),
    runId: found.runId,
    text: read.text,
    truncated: read.truncated,
    bytes: read.bytes,
  }
}

function sidecarText(transcriptPath: string | undefined): string {
  if (transcriptPath === undefined) return ''
  const real = realPathOf(transcriptPath)
  if (!real.ok) return ''
  const sidecar = claudeSidecarPath(real.path)
  if (sidecar === null) return ''
  const read = readChildFile(sidecar, MAX_SIDECAR_BYTES)
  return typeof read === 'string' ? '' : read.text
}

export function readChild(request: ProviderChildWorkRequest): ChildWorkResult {
  const found = { agents: request.agents, taskId: request.taskId }
  const root = childWorkRoot(request.home(), request.ref)
  let located: { id: string; at: ChildWorkLocation } | undefined
  for (const id of found.agents) {
    const at = locateChildWork(root, id, request.part)
    if (at !== null) {
      located = { id, at }
      break
    }
  }
  const agentId = located?.id ?? found.agents[0]!
  const read = readChildWork(root, agentId, request.part)
  if (typeof read === 'string') return { ok: false, reason: read }
  const { taskId } = found
  if (request.part !== 'transcript') return { ok: true, part: request.part, taskId, ...read }
  const lines = completeTranscriptLines(read.text, read.truncated)
  const parsed = importClaudeTranscript(lines, request.updatedAt)
  const sidecar = parseClaudeSidecar(sidecarText(located?.at?.path))
  return {
    ok: true,
    part: 'transcript',
    taskId,
    ...read,
    ...(sidecar.title === undefined ? {} : { title: sidecar.title }),
    ...(sidecar.parentToolCallId === undefined
      ? {}
      : { parentToolCallId: sidecar.parentToolCallId }),
    entries: parsed.entries.map((entry) => entry.event),
    errorFacts: parsed.entries.map((entry) => errorFactsForEvent(entry.event)),
    unreadable: parsed.unreadable,
    thinkingBlocks: countThinkingBlocks(lines),
  }
}
