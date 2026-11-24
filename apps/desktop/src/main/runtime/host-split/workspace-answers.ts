type KeptAnswers = Map<string, { readonly at: number; readonly value: unknown }>

interface WorkspaceAnswerReads {
  readonly checkCommitted: () => void
  readonly overtaken: () => boolean
  readonly personsVersion: () => number
  readonly listingVersion: () => number
}

export class WorkspaceAnswers {
  /** What each conversation waits on, and the forest, each kept at the listing's version. */
  private readonly listingAnswersKept: KeptAnswers = new Map()
  private readonly personsKept: KeptAnswers = new Map()

  constructor(private readonly reads: WorkspaceAnswerReads) {}

  get listingAnswerEntries(): number {
    return this.listingAnswersKept.size
  }

  forAPerson<T>(name: string, compose: () => T, complete?: (value: T) => boolean): T {
    return this.keptUntilItMoves(
      this.personsKept,
      this.reads.personsVersion,
      name,
      compose,
      complete,
    )
  }

  atTheListing<T>(name: string, compose: () => T, complete?: (value: T) => boolean): T {
    return this.keptUntilItMoves(
      this.listingAnswersKept,
      this.reads.listingVersion,
      name,
      compose,
      complete,
    )
  }

  /**
   * `compose`'s answer, kept in `kept` at the version it was composed at and reused until that
   * version moves. Another connection's commit is checked for first. An answer that skipped rows it
   * could not read, or a composition that moved the version, is not kept.
   */
  private keptUntilItMoves<T>(
    kept: KeptAnswers,
    version: () => number,
    name: string,
    compose: () => T,
    complete: (value: T) => boolean = everyRowWasRead,
  ): T {
    this.reads.checkCommitted()
    if (this.reads.overtaken()) return compose()
    const one = kept.get(name)
    if (one !== undefined && one.at === version()) return one.value as T
    const at = version()
    const value = compose()
    if (version() === at && complete(value)) kept.set(name, { at, value })
    else kept.delete(name)
    return value
  }
}

/** Whether an answer read every row it walked: a walk that counted rows unread or skipped none. */
export function everyRowWasRead(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  const walk = value as { rowsUnread?: unknown; ledgersSkipped?: unknown }
  return (
    (typeof walk.rowsUnread !== 'number' || walk.rowsUnread === 0) &&
    (typeof walk.ledgersSkipped !== 'number' || walk.ledgersSkipped === 0)
  )
}
