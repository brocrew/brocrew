import {
  FILES_LIBRARY_BOUNDS as B,
  filesLibraryRequest,
  filesLibraryResult,
  libraryReadContext,
  libraryUnavailable,
  type FilesLibraryReader,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryReadContext,
} from '../../shared/files-library'
import { ReaderWorkerLifetime, type ReaderWorker } from './reader-worker-lifetime'

/** Reads the files library in a worker and accepts only the result each operation names. */
export class FilesLibraryLifetime implements FilesLibraryReader {
  private readonly lifetime: ReaderWorkerLifetime<
    FilesLibraryRequest,
    LibraryReadContext,
    FilesLibraryResult
  >

  constructor(
    start: () => ReaderWorker,
    now: () => number = Date.now,
    deadlineMs: number = B.parentDeadlineMs,
  ) {
    this.lifetime = new ReaderWorkerLifetime(start, now, deadlineMs, {
      bounds: B,
      unavailable: (cause, retryAfterMs) =>
        retryAfterMs === undefined
          ? libraryUnavailable(cause)
          : libraryUnavailable(cause, 0, 0, retryAfterMs),
      accept: (result, request) => {
        const parsed = filesLibraryResult.safeParse(result)
        const expected =
          request.operation === 'query' || request.operation === 'page'
            ? 'files'
            : request.operation === 'release'
              ? 'released'
              : request.operation
        return parsed.success &&
          (parsed.data.type === 'unavailable' || parsed.data.type === expected)
          ? parsed.data
          : undefined
      },
    })
  }

  read(input: FilesLibraryRequest, context: LibraryReadContext): Promise<FilesLibraryResult> {
    const request = filesLibraryRequest.safeParse(input)
    const source = libraryReadContext.safeParse(context)
    if (!request.success || !source.success) return Promise.resolve(libraryUnavailable('worker'))
    return this.lifetime.read(request.data, source.data)
  }

  close(): Promise<void> {
    return this.lifetime.close()
  }
}
