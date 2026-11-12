import { command } from './runtime-command'
import type {
  ForestScope,
  ForestReading,
  ForestListed,
  ForestNodesPage,
} from '../shared/the-whole-forest'

export const forestBridge = {
  /** One forest reading (see `ForestReading`); the scope's literal is written here, field by field. */
  forestReading: (scope: ForestScope): Promise<ForestReading> =>
    command({
      kind: 'forestReading',
      scope:
        scope.is === 'the-workspace'
          ? { is: 'the-workspace', window: scope.window }
          : { is: 'the-tree-of', conversation: scope.conversation },
    }),
  /** A later page of a forest reading's nodes (see `ForestNodesPage`). */
  forestNodes: (
    reading: ForestListed,
    conversations: readonly string[],
  ): Promise<ForestNodesPage> =>
    command({
      kind: 'forestNodes',
      drawn: [...reading.members.admitted, ...reading.context, ...reading.behind],
      conversations: [...conversations],
    }),
}
