/**
 * The lines a start prints, each on a line of its own and written at once to stderr. Something
 * watching the process (a script that starts the app and waits) matches them exactly, so their
 * text never changes.
 */

/** Once per start, when the data is open and checked and the app is up. */
export const READY_LINE = 'BroCrew is ready: its data is open and checked.'

/** Once, when a recovery copy is verified and its manifest written, before any migration. */
export const CHECKPOINT_LINE = 'BroCrew made a checked recovery copy before changing its data.'

/** Whenever a start stops. The reason follows on the next line, and the process exits non-zero. */
export const FAIL_LINE = 'BroCrew did not start.'

/** The reason after {@link FAIL_LINE} when the app was closed while its start-up check ran. */
export const CLOSED_WHILE_CHECKING = 'BroCrew was closed while it was checking its data.'

/**
 * A hidden launch says which way its start went, so something watching it can tell an ordinary
 * open of the data from a start that never opened it for work. Once, when the database is open and
 * every migration has run.
 */
export const OPENED_NORMALLY_LINE = 'BroCrew opened its data normally.'

/** The other way: the start ended without opening the data for work. Once, after the reason line. */
export const OPENED_FOR_RECOVERY_LINE =
  'BroCrew opened only its recovery window: its data is not opened for work.'
