import type { TranscriptEvent } from '../../../shared/conversation-events'

/** ⚑ **F009 · the most of an agent's conversations its record lists**, newest activity first. */
const CONVERSATIONS_ON_A_RECORD = 10

/** ⚑ **F009 · the most of an agent's pieces its record lists**, the newest given first. */
const PIECES_ON_A_RECORD = 10

/** ⚑ **F009 · the most of the files an agent made its record lists**, newest first. */
const FILES_ON_A_RECORD = 5

/** ⚑ **F009 · the most of its standing rules' first line an agent's record quotes.** */
const RULES_BEGIN_CHARS = 200

/** Why the file of which agents are services is not changed: another app may be running on it. */
const NOT_THE_ONLY_APP = 'Not changed: the app may be open twice.'

/** A start refused: the agent is a service, whose one conversation no other start may replace. */
const NOT_STARTED_A_SERVICE = 'Not started: it’s a service.'

/** Why a service is not told of a change to a queued piece, after "‹it› could not be told. ". */
const QUEUED_NEVER_TOLD = 'The piece was queued and had not reached it, so nothing was sent.'

/** Rows in a service's ledger after which it may be free for its next piece. */
const MAY_FREE_A_SERVICE: ReadonlySet<TranscriptEvent['type']> = new Set([
  'status',
  'turn',
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_closed',
  'message_unqueued',
  'background_work',
  'scheduled_work',
])

/** A delete refused because which agents are services can't be read. */
const A_SERVICE_IT_MAY_BE =
  'This may be a service’s conversation, and which agents are services can’t be read, so ' +
  'nothing was deleted.'

/** A service's conversation whose delete could not be noted first, so nothing was deleted. */
const A_SERVICE_IT_STAYS = 'Not deleted: the services list could not be saved.'

/** An agent not removed: which agents are services can't be read. Why goes to the log. */
const NOT_REMOVED_UNREADABLE = 'Not removed: services list unreadable.'

/** An agent not removed: another app may be running on this data. */
const NOT_REMOVED_OPEN_TWICE = 'Not removed: the app may be open twice.'

/** An agent not removed: its entry could not be marked before the removal. */
const NOT_REMOVED_NOT_SAVED = 'Not removed: services list not saved.'

export {
  A_SERVICE_IT_MAY_BE,
  A_SERVICE_IT_STAYS,
  CONVERSATIONS_ON_A_RECORD,
  FILES_ON_A_RECORD,
  MAY_FREE_A_SERVICE,
  NOT_REMOVED_NOT_SAVED,
  NOT_REMOVED_OPEN_TWICE,
  NOT_REMOVED_UNREADABLE,
  NOT_STARTED_A_SERVICE,
  NOT_THE_ONLY_APP,
  PIECES_ON_A_RECORD,
  QUEUED_NEVER_TOLD,
  RULES_BEGIN_CHARS,
}
