/** Once per start, when the data is open and checked and the app is up. */
export const READY_LINE = 'BroCrew is ready: its data is open and checked.'

/** Once, when a recovery copy is verified and its manifest written, before any migration. */
export const CHECKPOINT_LINE = 'BroCrew completed its recovery copy.'

/** Whenever a start stops. The reason follows on the next line, and the process exits non-zero. */
export const FAIL_LINE = 'BroCrew did not start.'

/** The reason after {@link FAIL_LINE} when the app was closed while its start-up check ran. */
export const CLOSED_WHILE_CHECKING = 'BroCrew was closed while it was checking its data.'

export const OPENED_NORMALLY_LINE = 'BroCrew opened its data normally.'

/** The other way: the start ended without opening the data for work. Once, after the reason line. */
export const OPENED_FOR_RECOVERY_LINE =
  'BroCrew opened only its recovery window: its data is not opened for work.'
