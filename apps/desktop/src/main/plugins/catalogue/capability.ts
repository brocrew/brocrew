import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  digest,
  immutableFile,
  privateChild,
  publishPrivateDirectory,
  sourceBytes,
  verifyImmutableFile,
} from '../node-host-files'
import { PluginSupervisorError } from '../supervisor/protocol'

/** One distinct person-control capability across app copies. Atomic publish, no live-root default.
 * No descriptor opens the SQLite fence; authentication material never becomes renderer data.
 */
export async function pluginPersonCapability(root: string): Promise<string> {
  const folder = await privateChild(root, 'capabilities')
  const read = async (directory: string) => {
    const bytes = await sourceBytes(join(directory, 'person'), 64)
    if (!/^[a-f0-9]{64}$/.test(bytes.toString('utf8')))
      throw new PluginSupervisorError('unavailable')
    await verifyImmutableFile(join(directory, 'person'), bytes)
    return bytes.toString('utf8')
  }
  const kept = await publishPrivateDirectory(
    folder,
    digest(Buffer.from('brocrew-person-control-v1')),
    async (stage) => {
      await immutableFile(join(stage, 'person'), Buffer.from(randomBytes(32).toString('hex')))
    },
    async (directory) => {
      await read(directory)
    },
  )
  return read(kept)
}
