import type { WebContents } from 'electron'

/**
 * 🔴 **What a WINDOW's caller identity looks like — the encoder and the decoder, in one file**
 * (413).
 *
 * ## ⛔ Its own module because both halves have to be here, and only one of them used to be
 *
 * ⚠️ **`agent-tools.ts` already holds this pattern for the other kind of caller**:
 * {@link agentCallerId} mints `agent:<session>` and `sessionSpeakingAs` decodes it, and its own
 * docblock states the reason — *"it lives beside the encoder so the two spellings cannot drift
 * apart, which is the only reason a prefix scheme is safe to depend on."* ⛔ **The window half had
 * an encoder in `ipc.ts` and no decoder at all**, so the first thing that needed to ask *"is a
 * window asking"* would have had to write `webContents:` a second time, in a file that cannot
 * import `ipc.ts` — `ipc.ts` imports {@link RuntimeHost}, so the arrow only goes one way.
 *
 * ## 🔴 What needs the decoder, and why the question is not `sessionSpeakingAs(by) === null`
 *
 * ⛔ **413 · a turn is the PERSON's only when a person demonstrably typed it.** The three kinds of
 * caller this host has are a window, an agent and {@link THE_APP_ITSELF}, and the authorship of a
 * turn is decided from which one sent it. ⚠️ **Asking *"not the app and not an agent"* would put
 * every caller that does not exist yet on the person's side of that line** — and
 * `THE_APP_ITSELF`'s own docblock names the next one: *"tomorrow the MCP tool a PM would spawn
 * agents through … gets its own prefix from whatever registers it."* ⚑ A POSITIVE test for a
 * window is what makes the default the app's, which is the whole of `413` §3.
 */

/**
 * ⛔ **The one spelling of a window's owner-id prefix.**
 *
 * ⚠️ **Not a bare string at either end.** `sinkOwnerId` used to interpolate it and nothing decoded
 * it; a second literal anywhere is how a prefix scheme quietly stops matching itself.
 */
export const WINDOW_CALLER_PREFIX = 'webContents:'

/** The stable owner id for a renderer surface — sessions are torn down by it. */
export function sinkOwnerId(contents: Pick<WebContents, 'id'>): string {
  return `${WINDOW_CALLER_PREFIX}${contents.id}`
}

/**
 * ⛔ **Is this owner id a window on somebody's screen?** — the exact inverse of
 * {@link sinkOwnerId}, and `false` for every other kind of caller.
 *
 * ⚠️ **A decoder, not a permission**, which is `sessionSpeakingAs`'s own caveat one prefix over.
 * It answers *"who is this"*; what that entitles is the caller's question, and the only thing
 * reading it today is authorship.
 *
 * ⛔ **The suffix is required to be non-empty**, for {@link sessionSpeakingAs}'s reason: a bare
 * `webContents:` names no window, and admitting it would let the empty string be a person.
 */
export function aWindowIsAsking(ownerId: string): boolean {
  return ownerId.startsWith(WINDOW_CALLER_PREFIX) && ownerId.length > WINDOW_CALLER_PREFIX.length
}
