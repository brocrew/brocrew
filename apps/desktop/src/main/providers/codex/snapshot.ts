import macSource from '../../provider-snapshots/codex.json?raw'
import linuxSource from '../../provider-snapshots/linux/codex.json?raw'
import { createSnapshotPolicy } from '../snapshot-policy'

export const snapshot = createSnapshotPolicy(
  () => linuxSource,
  () => macSource,
)
