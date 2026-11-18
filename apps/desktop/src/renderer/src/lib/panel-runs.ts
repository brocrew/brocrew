import { cardHomes, type TranscriptState, type WorkflowRunCard } from './transcript'
import { backgroundState, BACKGROUND_WORD } from './background-work'
import { durationWords, toolTook } from './tool-outcome'
import type { ScheduledRow } from '../../../shared/agent-state-contracts'

export type RunGroup = 'Agents' | 'Commands' | 'Workflows' | 'Jobs & monitors' | 'Background'
export type RunTarget = { kind: 'agent' | 'workflow'; id: string; label: string }
export type OpenPanelRun = (target: RunTarget) => Promise<boolean>
export interface PanelRun {
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
      label: card.title || card.kind || 'Sub-agent',
      detail: card.lastTool ?? '',
      group: 'Agents',
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
      order: items.get(itemId)?.order ?? 0,
      itemId,
      ...(background ? { stopId: background.id } : {}),
      target: { kind: 'agent', id: card.agentId, label: card.title || card.kind || 'Sub-agent' },
    })
  }
  for (const [itemId, { item, order }] of items) {
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
        detail: run.description ?? '',
        group: 'Workflows',
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
        order,
        itemId,
        workflow: run,
        time: run.usage?.ms === undefined ? undefined : durationWords(run.usage.ms),
        ...(background ? { stopId: background.id } : {}),
        target: { kind: 'workflow', id: run.taskId, label: run.name || 'Workflow' },
      })
    } else if (
      item.background &&
      (item.background.outcome !== undefined || item.background.unfinished)
    ) {
      const work = item.background
      if ((work.id !== undefined && claimed.has(work.id)) || live.some((row) => row.id === work.id || row.toolCallId === item.callId)) continue
      rows.push({
        key: `background:${item.callId}`,
        label: item.summary || item.name,
        detail: work.summary ?? '',
        group: item.name === 'Bash' ? 'Commands' : 'Background',
        status: BACKGROUND_WORD[backgroundState(work)],
        active: false,
        failed: work.outcome === 'failed',
        time: toolTook(item, item.at) ?? undefined,
        icon: '#i-terminal',
        order,
        itemId,
      })
    }
  }
  for (const work of live) {
    if (claimed.has(work.id)) continue
    const group: RunGroup = work.kind === 'monitor' || work.kind === 'job' ? 'Jobs & monitors' : work.kind === 'local_bash' || work.kind === 'shell' ? 'Commands' : work.kind === 'local_agent' || work.kind === 'remote_agent' || work.kind === 'subagent' ? 'Agents' : work.kind === 'workflow' ? 'Workflows' : 'Background'
    rows.push({
      key: `background:${work.id}`,
      label: work.command?.text || work.description || work.id,
      detail: work.command?.name || '',
      group,
      status: 'Running',
      active: true,
      failed: false,
      icon: '#i-terminal',
      order: rows.length,
      stopId: work.id,
    })
  }
  return {
    active: rows.filter((row) => row.active),
    past: rows.filter((row) => !row.active).sort((a, b) => b.order - a.order),
    coming: state.schedule.jobs,
  }
}
