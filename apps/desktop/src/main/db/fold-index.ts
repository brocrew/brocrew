/**
 * 🔴 **The event types the ledger folds read — `events_fold_idx`'s predicate, and the term every
 * statement that reads through it repeats** (F071).
 *
 * ⛔ **Why the folds have an index of their own**: the person's look reads four folds every five
 * seconds — the routed requests, the pieces, the questions raised and the stall receipts — and each
 * of their statements filtered `type` over `events_session_ordinal_uq`, so SQLite read every row of
 * a ledger to test its type. A 64,000-event ledger was walked about ten times a look, and the main
 * process burst every five seconds by what the database held, not by what was happening.
 *
 * ⚑ **One list, read three ways**: `schema.ts` builds the index's predicate from it, so the
 * migration that creates the index says these words in this order; and `session-store.ts` writes
 * {@link FOLD_TERM} into each statement that names the index, and checks each statement's own types
 * against {@link FOLD_EVENT_TYPES} as the store is built. ⛔ SQLite uses a partial index only for a
 * WHERE that implies the index's, word for word, so a list that differs from the index's stops the
 * store from starting — and a type a fold starts to read is added here and in a migration that
 * drops and creates the index.
 *
 * ⚠️ **Imports nothing**: `drizzle-kit` loads `schema.ts`, and so this file, to generate a migration.
 */
export const FOLD_EVENT_TYPES: readonly string[] = [
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'work_taken_back',
  'work_closed',
  'request_escalated',
  'question_withdrawn',
  'question_recipient_ended',
  'question_ended_with_its_piece',
  'question_asked',
  'launched',
  'status',
  'work_given',
  'work_replied',
  'work_retitled',
  'work_status_set',
  'work_rebriefed',
  'message_unqueued',
  'reopened',
  'reply_undelivered',
  'message_queued',
  'replaced_by',
  'work_restarted',
  'user_turn',
  'turn',
  'work_interrupted',
  'background_work',
  'scheduled_work',
  'user_input_request',
  'work_stall_told',
]

/** ⚑ {@link FOLD_EVENT_TYPES} as an SQL list: `'request_routed', 'user_decision', …`. */
export const FOLD_TYPE_LIST = FOLD_EVENT_TYPES.map((type) => `'${type}'`).join(', ')

/**
 * ⚑ **The term a statement repeats so its WHERE implies the index's** — one string, so every reader
 * spells it the same way, and its source shows the statement's own type list as its only one.
 */
export const FOLD_TERM = `type IN (${FOLD_TYPE_LIST})`
