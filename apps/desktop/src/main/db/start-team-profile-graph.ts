import startWorker from '../team-profile-graph.worker?nodeWorker'
import { TeamProfileGraphLifetime } from './team-profile-graph-reader'
export function startTeamProfileGraph(
  file: string,
  admission: () => number = () => 0,
  failure: () => void = () => {},
): TeamProfileGraphLifetime {
  return new TeamProfileGraphLifetime(
    () =>
      startWorker({
        workerData: { file },
      }),
    () => performance.now(),
    undefined,
    admission,
    failure,
  )
}
