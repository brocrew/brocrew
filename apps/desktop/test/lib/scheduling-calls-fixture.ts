import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RuntimeEvent } from '@brobot2/runtime'
import { SchedulingCalls } from '../../../../packages/runtime/src/claude/scheduling-calls'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import {
  aConversationsScope,
  scheduleEvidenceOf,
  type ScheduleEvidenceRow,
} from '../../src/main/runtime/schedule-evidence'
import { planReceiptSchedule } from '../../src/shared/schedule-receipts'
import type { CalendarSource } from '../../src/shared/schedule-wake'

type ScheduledWorkEvent = Extract<RuntimeEvent, { type: 'scheduled_work' }>

/**
 * Scheduling calls as Claude Code's adapter reads them at its tool hooks, and the ledger they are
 * stored in, for tests that must not depend on what the adapter calls a receipt's fields.
 */

/** The event the adapter publishes for one call: about to run at `calledAt`, answered at `answeredAt`. */
export function throughClaudesHooks(
  tool: string,
  toolUseId: string,
  input: unknown,
  response: unknown,
  calledAt: number,
  answeredAt: number = calledAt,
): ScheduledWorkEvent {
  let now = calledAt
  const calls = new SchedulingCalls({ wall: () => now, mono: () => now })
  const hook = { session_id: 's1', tool_name: tool, tool_input: input, tool_use_id: toolUseId }
  calls.called({ ...hook, hook_event_name: 'PreToolUse' })
  now = answeredAt
  const event = calls.answered({
    ...hook,
    hook_event_name: 'PostToolUse',
    tool_response: response,
  })
  if (event?.receipt === undefined) throw new Error(`${tool} gave a receipt`)
  return event
}

/** A job made, as a provider double's `simulateScheduledWork` takes it. */
export function aJobMade(
  job: { readonly id: string; readonly schedule: string; readonly recurring: boolean },
  toolUseId: string,
  calledAt: number,
  answeredAt: number = calledAt + 2,
): { jobs: undefined; receipt: NonNullable<ScheduledWorkEvent['receipt']> } {
  const { receipt } = throughClaudesHooks(
    'CronCreate',
    toolUseId,
    { cron: job.schedule, recurring: job.recurring },
    { id: job.id, recurring: job.recurring },
    calledAt,
    answeredAt,
  )
  return { jobs: undefined, receipt: receipt! }
}

/** A job cancelled; `answered` is the id its result names, or none. */
export function aJobCancelled(
  asked: string,
  answered: string | null,
  toolUseId: string,
  calledAt: number,
  answeredAt: number = calledAt + 2,
): { jobs: undefined; receipt: NonNullable<ScheduledWorkEvent['receipt']> } {
  const { receipt } = throughClaudesHooks(
    'CronDelete',
    toolUseId,
    { id: asked },
    answered === null ? {} : { id: answered },
    calledAt,
    answeredAt,
  )
  return { jobs: undefined, receipt: receipt! }
}

/** A conversation's schedule planned from its ledger rows, on one clock era, at `now`. */
export function plannedFrom(
  conversation: string,
  rows: readonly ScheduleEvidenceRow[],
  now: number,
  calendar: CalendarSource,
) {
  const ledger = scheduleEvidenceOf(conversation, rows, () => 'wall-1', calendar)
  return planReceiptSchedule(ledger, aConversationsScope(conversation), {
    now,
    wakeLeadMs: 30_000,
    calendar,
    clockEra: 'wall-1',
    clockContinuous: true,
    noticeDelivery: { acceptedIds: [], mailbox: [] },
  })
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations')

/**
 * A store with one Claude conversation, whose ledger `run` writes rows into directly, as earlier
 * builds and this one stored them; all in one transaction.
 */
export function withAScheduleLedger(
  conversation: string,
  run: (put: (type: string, payload: object, at: number) => void, store: SessionStore) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'brobot-schedule-ledger-'))
  const db = openDatabase(':memory:')
  try {
    applyMigrations(db, migrations)
    const store = createSessionStore(db, () => 1)
    store.create({
      id: conversation,
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'a',
    })
    const insert = db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    )
    let next = 0
    const put = (type: string, payload: object, at: number) => {
      next += 1
      insert.run(`fixture-${String(next)}`, conversation, next, type, JSON.stringify(payload), at)
    }
    db.transaction(() => run(put, store))()
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
