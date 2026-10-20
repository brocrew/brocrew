import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const SKILL_TREE_NAMES = ['skills', 'skills-off']
export function skillTreeStateDigest(bytes) {
  const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  if (value.format !== 'brocrew-skill-tree-v1' || !Array.isArray(value.entries))
    throw new Error('Invalid skill tree snapshot')
  return {
    bytes: value.entries.reduce((sum, one) => sum + one.bytes, 0),
    sha256: createHash('sha256')
      .update('brocrew-skill-tree-v1\0')
      .update(JSON.stringify(value.entries))
      .digest('hex'),
  }
}

/** Upgrade receipts include every supporting file and executable bit, without retaining bodies. */
export function readStateEntry(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error('A state entry is a link')
  if (!SKILL_TREE_NAMES.includes(basename(path))) return readFileSync(path)
  const entries = []
  const walk = (folder, relative = '') => {
    for (const name of readdirSync(folder).sort()) {
      const child = join(folder, name)
      const part = relative ? `${relative}/${name}` : name
      const state = lstatSync(child)
      if (state.isSymbolicLink()) throw new Error('A skill entry is a link')
      if (state.isDirectory()) {
        entries.push({ path: part, directory: true, bytes: 0, executable: false, sha256: '' })
        walk(child, part)
      } else if (state.isFile()) {
        entries.push({
          path: part,
          directory: false,
          bytes: state.size,
          executable: !!(state.mode & 0o100),
          sha256: createHash('sha256').update(readFileSync(child)).digest('hex'),
        })
      } else throw new Error('A skill entry is not a file or folder')
    }
  }
  if (!stat.isDirectory()) throw new Error('A skill tree is not a folder')
  walk(path)
  return Buffer.from(JSON.stringify({ format: 'brocrew-skill-tree-v1', entries }))
}
