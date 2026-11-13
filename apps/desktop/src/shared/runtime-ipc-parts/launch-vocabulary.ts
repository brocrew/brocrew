/**
 * 🔴 **716 · `710` F-7 — WHY a start was refused, in a closed word the launcher can act on.**
 *
 * ⚑ **The finding** (`710` F-7): after a start the machine ran short for, the launcher showed TWO
 * boxes — the refusal's sentence, and its own automatic sign-in check's *"Could not check this
 * profile’s sign-in"* — one fact said twice, because nothing but the sentence reached the window.
 * ⛔ **And nothing but the sentence CAN reach it on a rejection** (measured in `716`'s map, Electron
 * 43): `ipcMain.handle` sends a rejected command as a string, and `contextBridge` copies an `Error`'s
 * message and drops every other property. ⚑ So the reason travels as an ANSWER, when the caller asks
 * for one ({@link RefusedLaunch}), and a caller that does not ask is rejected as it always was.
 *
 * | word | what refused the start | the sign-in check |
 * |---|---|---|
 * | `sign-in` | the profile's sign-in (`AuthUnavailableError`) | ⚑ the remedy — its buttons are how a person fixes it |
 * | `program` | the provider's program is missing or cannot run (R51, R66, R67) | says nothing the refusal did not |
 * | `folder` | a folder BroBot2 must make or write was refused by the disk (R66) | says nothing the refusal did not |
 * | `machine` | the machine ran short of files, processes or memory (R52) | says nothing the refusal did not |
 * | `cancelled` | a person stopped it before it opened | — nothing went wrong |
 * | `launch` | the start itself was refused or ended: its provider refused it (D-039, in its own words) or could not be started (D-039), its Codex settings could not be used, it took too long, the app was shutting down, the window went away, … | says nothing the refusal did not |
 *
 * ⚠️ **A failure main does not recognise has no word, and is still REJECTED** — the launcher's
 * check is then the only diagnosis there is. What the frontend draws for each word is the
 * frontend's; this table says only what refused the start.
 */
export const LAUNCH_REFUSALS = [
  'sign-in',
  'program',
  'folder',
  'machine',
  'cancelled',
  'launch',
] as const

export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number]

/**
 * ⚑ **D-017b · WHAT stopped such a message** — a closed word, so the window can act on it.
 * ⚑ **Every refusal the HOST makes is an answer**, never a rejection: `contextBridge` carries only a
 * rejection's message (`716`'s {@link RefusedLaunch}). ⛔ **The wire's own refusals still REJECT**,
 * before the host is asked — a malformed command and the quit's door — so the window puts the words
 * back on a rejection too.
 *
 * | word | what refused it | what was started |
 * |---|---|---|
 * | `already-starting` | the message before it is still on its way in | nothing more |
 * | `held-elsewhere` | another window has the conversation open | nothing |
 * | `before-the-start` | the message itself — an attachment that moved since it was attached (or, from a caller in main, no words and nothing attached) | nothing |
 * | `the-start` | the start — {@link FirstMessageNotSent.launch} says why, in `716`'s words | nothing that is still running |
 * | `after-the-start` | a refusal only the started conversation could make (a listed command carrying attachments, `R42`; a provider that failed the send) | a provider — stopped again, or, when another message had reached it first, a running conversation that gave it work was told the start, or stopping it failed, still running and handed over ({@link FirstMessageNotSent.running}); nothing, for one it found already running and attached or took — that one is handed over running |
 *
 * ⚑ **In every row the words did not go**, and the window puts them back.
 */
export const FIRST_MESSAGE_REFUSALS = [
  'already-starting',
  'held-elsewhere',
  'before-the-start',
  'the-start',
  'after-the-start',
] as const

export type FirstMessageRefusal = (typeof FIRST_MESSAGE_REFUSALS)[number]
