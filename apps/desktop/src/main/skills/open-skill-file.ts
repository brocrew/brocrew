import { open } from 'node:fs/promises'
import { nodeFs, type RecoveryFs, type RecoveryFileHandle } from '../recovery/files'

/** Obtain actual write access without comparing filesystem identities. */
export async function openWritableSkillFile(
  _userData: string,
  path: string,
  fs: RecoveryFs,
  osOpen: typeof open = open,
): Promise<RecoveryFileHandle> {
  try {
    return fs === nodeFs ? await osOpen(path, 'r+') : await fs.open(path, 'r+')
  } catch (cause) {
    throw new Error(`${path}: ${String(cause)}`, { cause })
  }
}
