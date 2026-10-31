import startWorker from '../files-library.worker?nodeWorker'
import { FilesLibraryLifetime } from './files-library-reader'

export function startFilesLibrary(file: string): FilesLibraryLifetime {
  return new FilesLibraryLifetime(() =>
    startWorker({
      workerData: { file },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    }),
  )
}
