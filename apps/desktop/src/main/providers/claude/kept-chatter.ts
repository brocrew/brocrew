import { isRecord, type KeptChatterTable, type RepeatingWarning } from '../kept-chatter-shape'

/** The "command completed" marker that was decided on; every other state stays. */
const commandCompleted = (raw: unknown): boolean =>
  isRecord(raw) && raw['type'] === 'command_lifecycle' && raw['state'] === 'completed'

/** A compaction that finished; any other residual system status stays. */
const compactionFinished = (raw: unknown): boolean =>
  isRecord(raw) &&
  raw['type'] === 'system' &&
  raw['subtype'] === 'status' &&
  raw['compact_result'] === 'success' &&
  (raw['status'] ?? null) === null

export const CLAUDE_KEPT_CHATTER: KeptChatterTable = {
  command_lifecycle: { category: 'lifecycle', newest: 0, routine: commandCompleted },
  status: { category: 'activity', newest: 0, routine: compactionFinished },
  tool_progress: { category: 'activity', newest: 1 },
  background_tasks_changed: { category: 'lifecycle', newest: 1 },
  commands_changed: { category: 'lifecycle', newest: 1 },
}

/** The wording the runtime's Claude adapter writes for a rate-limit warning. */
export const CLAUDE_REPEATING_WARNINGS: readonly RepeatingWarning[] = [
  {
    kind: 'usage close',
    said: (message) => message.startsWith('claude is approaching its rate limit'),
  },
]
