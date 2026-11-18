import { it } from 'vitest'
import { checkClaudeTail } from '../../../packages/runtime/test/helpers/scripted-claude-tail'
import { stopCommandsInFolders } from '../src/main/command-cleanup'

it(
  'reaps a tail backgrounded by the real Claude Bash tool',
  () => checkClaudeTail(stopCommandsInFolders),
  60_000,
)
