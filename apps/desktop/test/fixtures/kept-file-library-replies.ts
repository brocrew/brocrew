import type { KeptFile } from '../../src/shared/runtime-ipc'
import {
  libraryUnavailable,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryKeep,
} from '../../src/shared/files-library'

/** An exact fictional keep population, for legacy Graph/card-to-library component checks. */
export function keptFileLibraryReplies(files: () => readonly KeptFile[]) {
  let matching: LibraryKeep[] = []
  let current: Extract<FilesLibraryResult, { type: 'files' }> | null = null
  const stamp = {
    snapshot: 'fictional-kept-population',
    readAt: 1,
    stale: false,
    metrics: { rows: 1, bytes: 1, cacheBytes: 1, elapsedMs: 1 },
  }
  return async (request: FilesLibraryRequest): Promise<FilesLibraryResult> => {
    if (request.operation === 'release') return { type: 'released' }
    if (request.operation === 'provenance' && current !== null) {
      const keeps = files()
        .filter((file) => file.sha256 === request.sha256)
        .map((file) => ({
          ...file,
          breadcrumb: file.label,
          clipped: false,
        }))
      return {
        type: 'provenance',
        ...stamp,
        sha256: request.sha256,
        keeps: keeps.map((file) => ({
          file,
          matching: matching.some((one) => one.resourceId === file.resourceId),
        })),
        total: keeps.length,
        matching: matching.filter((file) => file.sha256 === request.sha256).length,
        next: null,
      }
    }
    if (request.operation !== 'query') return libraryUnavailable('worker')
    const scope = request.query.scope
    matching = files()
      .filter(
        (file) => scope.type === 'workspace' || (scope.type === 'task' && file.piece === scope.id),
      )
      .map((file) => ({ ...file, breadcrumb: file.label, clipped: false }))
    const hashes = [...new Set(matching.map((file) => file.sha256))]
    const grouped = hashes.map((hash) => {
      const same = matching
        .filter((file) => file.sha256 === hash)
        .sort((a, b) => b.keptAt - a.keptAt || b.resourceId.localeCompare(a.resourceId))
      return { file: same[0]!, matchingKeeps: same.length }
    })
    const images = new Set(
      matching.filter((file) => file.form === 'image').map((file) => file.sha256),
    ).size
    const inputs = new Set(
      matching.filter((file) => file.role === 'input').map((file) => file.sha256),
    ).size
    const made = new Set(matching.filter((file) => file.role === 'made').map((file) => file.sha256))
      .size
    current = {
      type: 'files',
      ...stamp,
      files: grouped,
      totalFiles: grouped.length,
      totalKeeps: matching.length,
      scopeKeeps: matching.length,
      next: null,
      facets: {
        kinds: { all: hashes.length, images, documents: hashes.length - images },
        roles: { all: hashes.length, input: inputs, made },
      },
    }
    return current
  }
}
