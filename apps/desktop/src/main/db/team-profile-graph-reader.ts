import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  teamProfileGraphRequest,
  teamProfileGraphResult,
  graphReadContext,
  graphUnavailable,
  type TeamProfileGraphReader,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
  type TeamProfileGraphReadContext,
} from '../../shared/team-profile-graph'
import { ReaderWorkerLifetime, type ReaderWorker } from './reader-worker-lifetime'

/** Reads the team and profile graph in a worker behind an admission check, reporting failures. */
export class TeamProfileGraphLifetime implements TeamProfileGraphReader {
  private readonly lifetime: ReaderWorkerLifetime<
    TeamProfileGraphRequest,
    TeamProfileGraphReadContext,
    TeamProfileGraphResult
  >

  constructor(
    start: () => ReaderWorker,
    now: () => number = () => performance.now(),
    deadlineMs: number = B.parentDeadlineMs,
    admission: () => number = () => 0,
    failure: () => void = () => {},
  ) {
    this.lifetime = new ReaderWorkerLifetime(start, now, deadlineMs, {
      bounds: B,
      unavailable: (cause, retryAfterMs) =>
        retryAfterMs === undefined
          ? graphUnavailable(cause)
          : graphUnavailable(cause, 'roster', 0, 0, retryAfterMs),
      accept: (result, request) => {
        const parsed = teamProfileGraphResult.safeParse(result)
        const expected = request.operation === 'release' ? 'released' : request.operation
        return parsed.success &&
          (parsed.data.type === 'unavailable' || parsed.data.type === expected)
          ? parsed.data
          : undefined
      },
      admission,
      failure,
      expired: () => graphUnavailable('expired'),
    })
  }

  read(
    input: TeamProfileGraphRequest,
    context: TeamProfileGraphReadContext,
  ): Promise<TeamProfileGraphResult> {
    const request = teamProfileGraphRequest.safeParse(input)
    const source = graphReadContext.safeParse(context)
    if (!request.success || !source.success) return Promise.resolve(graphUnavailable('worker'))
    return this.lifetime.read(request.data, source.data)
  }

  close(): Promise<void> {
    return this.lifetime.close()
  }
}
