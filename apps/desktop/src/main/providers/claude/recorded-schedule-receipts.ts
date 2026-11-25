import type { ScheduleReceipt } from '@brobot2/runtime'

/**
 * Scheduling receipts as this app's ledger holds them. Builds before the receipt named its action
 * stored the tool that made the call instead, under `tool`. This map is kept apart from the
 * adapter's live one, because a stored row keeps the name it was written with whatever the tool is
 * called later.
 */

/** The provider of the scheduling receipts this build reads. */
export const recordedScheduleReceiptProvider = 'claude'

/** Each tool an older row names, and the action its call was. */
const ACTION_OF_A_STORED_TOOL = {
  CronCreate: 'create',
  CronDelete: 'cancel',
  CronList: 'list',
  ScheduleWakeup: 'wakeup',
} as const satisfies Record<string, ScheduleReceipt['action']>

/** The stored tools whose receipts made or cancelled a job, as a JSON list for the ledger query. */
export const storedToolsThatMakeOrCancel = JSON.stringify(
  Object.entries(ACTION_OF_A_STORED_TOOL)
    .filter(([, action]) => action === 'create' || action === 'cancel')
    .map(([tool]) => tool),
)

/**
 * A stored receipt as this build reads it. A row that names its action is read as it is, even if
 * it also names a tool; an older row's tool is read as its action; anything else is no receipt.
 */
export function recordedScheduleReceipt(
  stored: Readonly<Record<string, unknown>>,
): ScheduleReceipt | undefined {
  if (Object.hasOwn(stored, 'action')) return stored as unknown as ScheduleReceipt
  const tool = stored['tool']
  if (typeof tool !== 'string' || !Object.hasOwn(ACTION_OF_A_STORED_TOOL, tool)) return undefined
  const read: Record<string, unknown> = {
    ...stored,
    action: ACTION_OF_A_STORED_TOOL[tool as keyof typeof ACTION_OF_A_STORED_TOOL],
  }
  delete read['tool']
  return read as unknown as ScheduleReceipt
}
