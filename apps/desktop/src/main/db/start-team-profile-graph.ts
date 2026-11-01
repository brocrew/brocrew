import startWorker from '../team-profile-graph.worker?nodeWorker'
import { TeamProfileGraphLifetime } from './team-profile-graph-reader'
export function startTeamProfileGraph(
  file: string,
  executionFile: string,
  admission: () => number = () => 0,
  failure: () => void = () => {},
): TeamProfileGraphLifetime {
  return new TeamProfileGraphLifetime(
    () =>
      startWorker({
        workerData: { file, executionFile },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      }),
    () => performance.now(),
    undefined,
    admission,
    failure,
  )
}
