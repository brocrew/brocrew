import type { NativeRun } from '@brobot2/runtime'
import { backgroundState, BACKGROUND_WORD } from './background-work'
import { cardHomes, type TranscriptState, type WorkflowRunCard } from './transcript'
import { durationWords, toolTook, toolOutcome, TOOL_OUTCOME_WORD } from './tool-outcome'
import type { ScheduledRow } from '../../../shared/agent-state-contracts'

export type RunGroup =
  'Agents' | 'Commands' | 'Workflows' | 'Jobs & monitors' | 'Checklists' | 'Runs'
export type RunTarget = {
  kind: 'agent' | 'workflow' | 'tool' | 'background' | 'checklist'
  id: string
  label: string
}
export type OpenPanelRun = (target: RunTarget) => Promise<boolean>
export interface PanelRun {
  run?: Partial<NativeRun>
  key: string
  label: string
  detail: string
  group: RunGroup
  status: string
  active: boolean
  failed: boolean
  icon: string
  order: number
  time?: string
  itemId?: string
  stopId?: string
  target?: RunTarget
  workflow?: WorkflowRunCard
}
export interface PanelRuns {
  active: PanelRun[]
  past: PanelRun[]
  coming: ScheduledRow[]
}

/** Project only facts already held by this conversation's renderer. */
export function panelRuns(state: TranscriptState): PanelRuns {
  const rows: PanelRun[] = []
  const live = state.background.running
  const claimed = new Set<string>()
  const items = new Map(state.items.map((item, order) => [item.id, { item, order }]))
  for (const { card, itemId } of cardHomes(state)) {
    const key = `agent:${card.agentId}`
    if (rows.some((row) => row.key === key)) continue
    claimed.add(card.agentId)
    const background = live.find((row) => row.id === card.agentId)
    if (background) claimed.add(background.id)
    const active = card.running || background !== undefined
    rows.push({
      key,
      label: card.title || 'Sub-agent',
      run: card.run,
      detail: card.lastTool ?? '',
      group: 'Runs',
      status: active
        ? 'Running'
        : card.outcome === 'completed'
          ? 'Done'
          : card.outcome === 'failed'
            ? 'Failed'
            : card.outcome === 'interrupted'
              ? 'Stopped'
              : 'Ended',
      active,
      failed: !active && card.outcome === 'failed',
      icon: '#i-bot',
      time: card.usage?.ms === undefined ? undefined : durationWords(card.usage.ms),
      order: items.get(itemId)?.item.at ?? 0,
      itemId,
      ...(background ? { stopId: background.id } : {}),
      target: { kind: 'agent', id: card.agentId, label: card.title || 'Sub-agent' },
    })
  }
  for (const [itemId, { item, order }] of items) {
    if (
      item.kind === 'plan' &&
      item.steps.length &&
      item.steps.every((step) => step.status === 'done')
    ) {
      rows.push({
        key: `checklist:${itemId}`,
        label: 'Checklist',
        detail: item.note ?? '',
        group: 'Runs',
        run: item.run,
        status: 'Done',
        active: false,
        failed: false,
        icon: '#i-check',
        order: item.at ?? order,
        itemId,
        target: { kind: 'checklist', id: itemId, label: 'Checklist' },
      })
    }
    if (item.kind !== 'tool') continue
    if (item.workflow) {
      const run = item.workflow
      if (rows.some((row) => row.key === `workflow:${run.taskId}`)) continue
      claimed.add(run.taskId)
      const background = live.find((row) => row.id === run.taskId || row.toolCallId === item.callId)
      if (background) claimed.add(background.id)
      const active = run.running || background !== undefined
      rows.push({
        key: `workflow:${run.taskId}`,
        label: run.name || 'Workflow',
        run: run.run,
        detail: run.description ?? '',
        group: 'Runs',
        status: active
          ? 'Running'
          : run.outcome === 'completed'
            ? 'Done'
            : run.outcome === 'failed'
              ? 'Failed'
              : 'Ended',
        active,
        failed: !active && run.outcome === 'failed',
        icon: '#i-bot',
        order: item.at ?? order,
        itemId,
        workflow: run,
        time: run.usage?.ms === undefined ? undefined : durationWords(run.usage.ms),
        ...(background ? { stopId: background.id } : {}),
        target: { kind: 'workflow', id: run.taskId, label: run.name || 'Workflow' },
      })
    } else if (
      item.run?.kind === 'command' ||
      item.run?.kind === 'job' ||
      item.run?.kind === 'monitor' ||
      (item.background && (item.background.outcome !== undefined || item.background.unfinished))
    ) {
      const work = item.background
      const background = live.find((row) => row.id === work?.id || row.toolCallId === item.callId)
      if (work?.id !== undefined && claimed.has(work.id)) continue
      if (background) claimed.add(background.id)
      if (work?.id) claimed.add(work.id)
      const active =
        background !== undefined ||
        (!item.background && item.run !== undefined && item.result === null && !item.unfinished)
      rows.push({
        key: `background:${item.callId}`,
        label: item.summary || item.name,
        detail: work?.summary ?? '',
        run: { ...background?.run, ...item.run },
        group: 'Runs',
        status: active ? 'Running' : TOOL_OUTCOME_WORD[toolOutcome(item)],
        active,
        failed: !active && (work?.outcome === 'failed' || item.result?.ok === false),
        ...((background?.id ?? item.stopKey) === undefined
          ? {}
          : { stopId: background?.id ?? item.stopKey }),
        target: { kind: 'tool', id: item.callId, label: item.summary || item.name },
        time: toolTook(item, item.at) ?? undefined,
        icon: '#i-terminal',
        order: item.at ?? order,
        itemId,
      })
    }
  }
  for (const work of live) {
    if (claimed.has(work.id)) continue
    rows.push({
      key: `background:${work.id}`,
      label: work.command?.text || work.description || work.id,
      detail: work.command?.name || '',
      group: 'Runs',
      run: work.run,
      status: 'Running',
      active: true,
      failed: false,
      icon: '#i-terminal',
      order: rows.length,
      stopId: work.id,
      target: { kind: 'background', id: work.id, label: work.description || work.id },
    })
  }
  for (const work of state.background.history ?? []) {
    if (
      (work.outcome === undefined && !work.unfinished) ||
      claimed.has(work.id) ||
      live.some((one) => one.id === work.id)
    )
      continue
    rows.push({
      key: `background:${work.id}`,
      label: work.description || 'Run',
      detail: work.summary ?? '',
      group: 'Runs',
      run: work.run,
      status:
        work.outcome === undefined
          ? BACKGROUND_WORD[backgroundState(work)]
          : work.outcome === 'completed'
            ? 'Done'
            : work.outcome === 'failed'
              ? 'Failed'
              : work.outcome === 'stopped'
                ? 'Stopped'
                : 'Ended',
      active: false,
      failed: work.outcome === 'failed',
      icon: '#i-terminal',
      order: work.at ?? rows.length,
      target: { kind: 'background', id: work.id, label: work.description || 'Run' },
    })
  }
  for (const row of rows) {
    const kind = row.run?.kind
    row.group = kind === undefined ? 'Runs' : RUN_GROUP[kind]
    if (row.run?.input) row.label = row.run.input.split(/\r?\n/)[0]!
    row.detail = row.run?.result ?? row.run?.progress ?? row.detail
  }
  return {
    active: rows.filter((row) => row.active),
    past: rows.filter((row) => !row.active).sort((a, b) => b.order - a.order),
    coming: state.schedule.jobs,
  }
}

const RUN_GROUP: Record<NativeRun['kind'], RunGroup> = {
  agent: 'Agents',
  command: 'Commands',
  workflow: 'Workflows',
  job: 'Jobs & monitors',
  monitor: 'Jobs & monitors',
  checklist: 'Checklists',
}
