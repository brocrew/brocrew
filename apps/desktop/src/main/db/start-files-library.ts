import { withWorkerMemory } from '../worker-memory'
import startWorker from '../files-library.worker?nodeWorker'
import { FilesLibraryLifetime } from './files-library-reader'

export function startFilesLibrary(file: string): FilesLibraryLifetime {
  return new FilesLibraryLifetime(() =>
    withWorkerMemory('files-library', () =>
      startWorker({
        workerData: { file },
      }),
    ),
  )
}
