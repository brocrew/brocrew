import { parentPort } from 'node:worker_threads'
import { projectLocalSettingsFile } from '@brobot2/runtime'

/**
 * Finds the Claude local settings file of each folder it is sent, off the main thread: finding one
 * runs git, which must never make the window wait. Answers `[folder, file]` pairs, in the order sent.
 */
parentPort?.on('message', (folders: readonly string[]) => {
  parentPort?.postMessage(folders.map((folder) => [folder, projectLocalSettingsFile(folder)]))
})
