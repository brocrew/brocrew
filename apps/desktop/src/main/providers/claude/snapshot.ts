import macSource from '../../provider-snapshots/claude-code.json?raw'
import linuxSource from '../../provider-snapshots/linux/claude-code.json?raw'
import { createSnapshotPolicy } from '../snapshot-policy'

export const snapshot = createSnapshotPolicy(
  () => linuxSource,
  () => macSource,
)
