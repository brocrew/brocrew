import { cardHomes, type TranscriptState, type WorkflowRunCard } from './transcript'
import { backgroundState, BACKGROUND_WORD } from './background-work'
import type { ScheduledRow } from '../../../shared/agent-state-contracts'

export type RunGroup = 'Agents' | 'Commands' | 'Workflows' | 'Jobs & monitors'
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
    const background = live.find((row) => row.id === card.agentId)
    if (background) claimed.add(background.id)
    const active = card.running || background !== undefined
    rows.push({
      key, label: card.title || card.kind || 'Sub-agent', detail: card.lastTool ?? '',
      group: 'Agents', status: active ? 'Running' : card.outcome === 'completed' ? 'Done' : card.outcome === 'failed' ? 'Failed' : card.outcome === 'interrupted' ? 'Stopped' : 'Ended',
      active, failed: !active && card.outcome === 'failed', icon: '#i-bot',
      order: items.get(itemId)?.order ?? 0, itemId,
      ...(background ? { stopId: background.id } : {}),
      target: { kind: 'agent', id: card.agentId, label: card.title || card.kind || 'Sub-agent' },
    })
  }
  for (const [itemId, { item, order }] of items) {
    if (item.kind !== 'tool') continue
    if (item.workflow) {
      const run = item.workflow
      const background = live.find((row) => row.id === run.taskId || row.toolCallId === item.callId)
      if (background) claimed.add(background.id)
      const active = run.running || background !== undefined
      rows.push({ key: `workflow:${run.taskId}`, label: run.name || 'Workflow', detail: run.description ?? '',
        group: 'Workflows', status: active ? 'Running' : run.outcome === 'completed' ? 'Done' : run.outcome === 'failed' ? 'Failed' : 'Ended',
        active, failed: !active && run.outcome === 'failed', icon: '#i-bot', order, itemId, workflow: run,
        ...(background ? { stopId: background.id } : {}), target: { kind: 'workflow', id: run.taskId, label: run.name || 'Workflow' },
      })
    } else if (item.background && (item.background.outcome !== undefined || item.background.unfinished)) {
      const work = item.background
      if (live.some((row) => row.id === work.id || row.toolCallId === item.callId)) continue
      rows.push({ key: `background:${item.callId}`, label: item.summary || item.name, detail: work.summary ?? '',
        group: 'Commands', status: BACKGROUND_WORD[backgroundState(work)], active: false,
        failed: work.outcome === 'failed', icon: '#i-terminal', order, itemId,
      })
    }
  }
  for (const work of live) {
    if (claimed.has(work.id)) continue
    const monitor = work.kind === 'monitor'
    const job = work.kind === 'job'
    rows.push({ key: `background:${work.id}`, label: work.command?.text || work.description || work.id,
      detail: work.command?.name || work.kind || 'Background', group: monitor || job ? 'Jobs & monitors' : 'Commands',
      status: 'Running', active: true, failed: false, icon: '#i-terminal', order: rows.length, stopId: work.id,
    })
  }
  return {
    active: rows.filter((row) => row.active),
    past: rows.filter((row) => !row.active).sort((a, b) => b.order - a.order),
    coming: state.schedule.jobs,
  }
}
