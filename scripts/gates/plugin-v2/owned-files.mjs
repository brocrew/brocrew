import fs from 'node:fs'
import path from 'node:path'

// This exact function is also embedded in the two gate bundles: it may use only fs and path.
/** Read one of the gate's own files, bounded in size so a runaway write fails plainly. */
export function readOwnedFile(file, maximum, expectedRoot = null) {
  if (expectedRoot && path.relative(expectedRoot.path, path.resolve(file)).startsWith('..'))
    throw new Error(`${file} is outside ${expectedRoot.path}`)
  const bytes = fs.readFileSync(file)
  if (bytes.length > maximum) throw new Error(`${file} is larger than ${maximum} bytes`)
  return bytes
}
/** The gate root that later reads must stay inside. */
export function rootWitness(root) {
  if (!fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`)
  return { path: root }
}
