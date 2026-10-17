import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  readSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime'

const ROOT_MARKER = '.brocrew-worker-output'
const ROOT_CONTENT = 'BroCrew parallel piece output folders\n'
const PIECE_MARKER = '.brocrew-piece'
export const WORKER_OUTPUT_DIRNAME = 'worker-output'
export const WORKER_OUTPUT_FAILURE =
  'No work was given because its output folder could not be made.'

function directory(path: string): boolean {
  const stat = lstatSync(path)
  return stat.isDirectory() && !stat.isSymbolicLink()
}

/** Writes a marker as a new file: nothing already at its name, a link included, is written through. */
function writeMarker(path: string, text: string): void {
  const fd = createFreshFile(path)
  try {
    writeFileSync(fd, text)
  } finally {
    closeSync(fd)
  }
}

function markerMatches(path: string, wanted: string): boolean {
  let fd: number | undefined
  try {
    fd = openNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size !== Buffer.byteLength(wanted)) return false
    const bytes = Buffer.alloc(stat.size + 1)
    const read = readSync(fd, bytes, 0, bytes.length, 0)
    return read === stat.size && bytes.subarray(0, read).toString('utf8') === wanted
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Only the app's marked root is reused. Existing piece directories are never overwritten.
 * Creates still use paths: a process with write access to the app's data can swap an ancestor
 * between the checks and a create, as with provider-home provisioning. The checks do not exclude it.
 */
export function makeWorkerPieceFolder(userData: string, piece: string): string {
  if (!/^work_[a-z0-9-]{36}$/u.test(piece)) throw new Error(WORKER_OUTPUT_FAILURE)
  const root = join(userData, WORKER_OUTPUT_DIRNAME)
  let madeRoot = false
  try {
    if (!directory(userData)) throw new Error(WORKER_OUTPUT_FAILURE)
    try {
      mkdirSync(root, { mode: 0o700 })
      madeRoot = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!directory(root)) throw new Error(WORKER_OUTPUT_FAILURE)
    if (madeRoot) writeMarker(join(root, ROOT_MARKER), ROOT_CONTENT)
    if (!markerMatches(join(root, ROOT_MARKER), ROOT_CONTENT))
      throw new Error(WORKER_OUTPUT_FAILURE)
    const output = join(root, piece)
    mkdirSync(output, { mode: 0o700 })
    if (!directory(root) || !directory(output)) throw new Error(WORKER_OUTPUT_FAILURE)
    writeMarker(join(output, PIECE_MARKER), `${piece}\n`)
    return output
  } catch {
    // Failed paths are kept: a pathname cleanup could remove a directory another writer substituted.
    throw new Error(WORKER_OUTPUT_FAILURE)
  }
}
