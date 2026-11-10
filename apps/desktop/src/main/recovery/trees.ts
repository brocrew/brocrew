import { basename, dirname, join } from 'node:path'
import { ordinarySkillTree } from '../skills/ordinary-tree'
import { SKILL_TREES } from '../skills/shared-paths'
import { contentAt, nodeFs, pathExists, syncFolder, type Content, type RecoveryFs } from './files'

/** The journal hashes registered trees as single entries and moves them by directory rename. */
export async function stateContentAt(path: string, fs: RecoveryFs = nodeFs): Promise<Content> {
  if (!SKILL_TREES.includes(basename(path))) return contentAt(path, fs)
  if (!(await pathExists(path, fs))) return { kind: 'absent' }
  return { kind: 'file', sha256: (await ordinarySkillTree(path, fs)).sha256 }
}

export async function copySkillTree(from: string, to: string, fs: RecoveryFs = nodeFs) {
  const tree = await ordinarySkillTree(from, fs, to)
  for (const entry of tree.entries.filter((one) => one.directory).reverse())
    await syncFolder(join(to, ...entry.path.split('/')), fs)
  await syncFolder(to, fs)
  await syncFolder(dirname(to), fs)
  return tree
}
