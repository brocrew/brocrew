import {
  libraryUnavailable,
  type FilesLibraryRequest,
  type FilesLibraryResult,
} from '../../shared/files-library'
import {
  graphUnavailable,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
} from '../../shared/team-profile-graph'
import type { FilesLibraryWindows } from '../db/files-library-windows'
import type { TeamProfileGraphWindows } from '../db/team-profile-graph-windows'

type FilesWindow = { readonly ownerId: string; readonly alive: boolean }
type GraphWindow = { readonly ownerId: string; readonly aPersonIsBehindIt: boolean }
type FilesRead = {
  readonly libraries: FilesLibraryWindows | undefined
  readonly revision: () => string | null | undefined
  readonly closed: () => boolean
  readonly givers: (conversation: string) => readonly string[]
}
type GraphRead = {
  readonly graphs: TeamProfileGraphWindows | undefined
  readonly revision: () => string | null | undefined
  readonly closed: () => boolean
}

export async function filesLibraryForWindow(
  request: FilesLibraryRequest,
  sink: FilesWindow,
  read: FilesRead,
): Promise<FilesLibraryResult> {
  const libraries = read.libraries
  if (libraries === undefined || read.closed() || !sink.alive) return libraryUnavailable('closed')
  const admission = libraries.admit(sink.ownerId)
  const givers =
    request.operation === 'query' && request.query.scope.type === 'conversationWork'
      ? read.givers(request.query.scope.id)
      : undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!libraries.isCurrent(sink.ownerId, admission)) return libraryUnavailable('cancelled')
    const before = read.revision()
    if (before === null || before === undefined) return libraryUnavailable('changed')
    const result = await libraries.read(sink.ownerId, request, before, givers)
    if (read.closed() || !sink.alive) return libraryUnavailable('closed')
    if (!libraries.isCurrent(sink.ownerId, admission)) return libraryUnavailable('cancelled')
    if (result.type === 'unavailable' && result.cause === 'cancelled') return result
    const after = read.revision()
    if (before === after) return result
    if (request.operation !== 'query' && request.operation !== 'tasks') {
      return result.type === 'files' || result.type === 'provenance'
        ? { ...result, stale: true }
        : result
    }
  }
  return libraryUnavailable('changed')
}

export async function teamProfileGraphForWindow(
  request: TeamProfileGraphRequest,
  sink: GraphWindow,
  read: GraphRead,
): Promise<TeamProfileGraphResult> {
  const graphs = read.graphs
  if (!graphs || read.closed() || !sink.aPersonIsBehindIt) return graphUnavailable('closed')
  if (request.operation === 'release') {
    await graphs.closeWindow(sink.ownerId)
    return { type: 'released' }
  }
  const admission = graphs.admit(sink.ownerId)
  const before = read.revision()
  if (before === null || before === undefined) return graphUnavailable('changed')
  const result = await graphs.read(sink.ownerId, request, before)
  if (read.closed()) return graphUnavailable('closed')
  if (!graphs.isCurrent(sink.ownerId, admission)) return graphUnavailable('cancelled')
  const after = read.revision()
  return before !== after &&
    (result.type === 'snapshot' || result.type === 'nodes' || result.type === 'edges')
    ? { ...result, stale: true }
    : result
}

export async function closeTeamProfileGraphWindow(
  owner: string,
  graphs: TeamProfileGraphWindows | undefined,
): Promise<void> {
  await graphs?.closeWindow(owner)
}

export async function closeFilesLibraryWindow(
  owner: string,
  libraries: FilesLibraryWindows | undefined,
): Promise<void> {
  await libraries?.closeWindow(owner)
}
