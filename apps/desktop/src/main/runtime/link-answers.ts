import { agentStateWords, type AgentState } from '../../shared/agent-state'
import type { LinkResolution } from '../../shared/link-resolution'
import type { LimitsWriterStamp } from '../db/fresh-limits-snapshot'
import { sameWindowWriter } from '../db/window-routing-reads'
import type { WindowWriterStamp } from '../db/window-writer-stamp'

export const LINK_ANSWER_LIMIT = 512

export interface ReadLinkAnswer {
  readonly answer: LinkResolution
  readonly state?: AgentState
  readonly cacheable?: boolean
}

type Stamp = { window: WindowWriterStamp; content: LimitsWriterStamp }
type Kept = ReadLinkAnswer & { capturedAt: number }

function sameStamp(before: Stamp | null, after: Stamp | null): boolean {
  return (
    before !== null &&
    after !== null &&
    sameWindowWriter(before.window, after.window) &&
    before.content.writer === after.content.writer &&
    before.content.totalChanges === after.content.totalChanges &&
    before.content.dataVersion === after.content.dataVersion &&
    Number.isFinite(before.content.at) &&
    Number.isFinite(after.content.at) &&
    before.content.at <= after.content.at
  )
}

function copy(answer: LinkResolution): LinkResolution {
  return { ...answer, opens: answer.opens === null ? null : { ...answer.opens } }
}

/** Retains target answers only while both routing and content writers are unchanged. */
export class LinkAnswers {
  private readonly answers = new Map<string, Kept>()
  private stamp: Stamp | null = null
  private epoch = 0

  constructor(
    private readonly window: () => WindowWriterStamp | null,
    private readonly content: () => LimitsWriterStamp | null,
    private readonly now: () => number,
  ) {}

  invalidate(): void {
    this.answers.clear()
    this.stamp = null
    this.epoch++
  }

  private sample(): Stamp | null {
    try {
      const window = this.window()
      const content = this.content()
      return window === null || content === null ? null : { window, content }
    } catch {
      return null
    }
  }

  read(target: string, read: () => ReadLinkAnswer): LinkResolution {
    const before = this.sample()
    if (!sameStamp(this.stamp, before)) this.invalidate()
    this.stamp = before
    const kept = this.answers.get(target)
    const now = this.now()
    if (
      kept !== undefined &&
      Number.isFinite(now) &&
      now >= kept.capturedAt &&
      !(kept.state?.is === 'scheduled' && kept.state.dueAt !== null && now >= kept.state.dueAt)
    ) {
      this.answers.delete(target)
      this.answers.set(target, kept)
      return copy({
        ...kept.answer,
        status: kept.state === undefined ? kept.answer.status : agentStateWords(kept.state),
      })
    }
    this.answers.delete(target)
    const epoch = this.epoch
    const current = read()
    const after = this.sample()
    if (
      epoch === this.epoch &&
      sameStamp(before, after) &&
      current.cacheable !== false &&
      Number.isFinite(now)
    ) {
      this.stamp = after
      this.answers.set(target, { ...current, capturedAt: now, answer: copy(current.answer) })
      if (this.answers.size > LINK_ANSWER_LIMIT)
        this.answers.delete(this.answers.keys().next().value!)
    } else {
      this.invalidate()
    }
    return copy(current.answer)
  }
}
