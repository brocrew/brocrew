import { randomUUID } from 'node:crypto'

// Prefixed, app-generated text IDs (002: no UUID DB defaults).
// Used by Slice-2 inserts; defined here alongside the schema they key.
export const newProviderSessionId = (): string => `sess_${randomUUID()}`
export const newEventId = (): string => `evt_${randomUUID()}`
export const newTurnId = (): string => `turn_${randomUUID()}`
/**
 * 🔴 **D-016 · a piece of work's row id** — `work.id`, the root's and every given piece's.
 *
 * ⛔ **Its own prefix, and not `task_`**: a ledger written before D-016 holds `task_…` ids in
 * rows no reader keys a piece by, and a new prefix is what keeps those rows inert rather than
 * matching a piece by accident. ⚑ Minted by the main process; no caller may supply one.
 */
export const newWorkId = (): string => `work_${randomUUID()}`

/**
 * 🔴 **D-016 · a kept resource's row id** — `work_resource.id`, the name `read_document` takes.
 *
 * ⛔ **Generated, not derived**: two resources may hold the same bytes under one name, and each is
 * its own row — the file on disk is what they share (`<sha256>/<name>`).
 *
 * ⚑ **Thirty-two hex digits, with the UUID's hyphens taken out**: a person reads this id inside a
 * sentence, where the window draws it as a press (`the-documents-a-reply-names.ts`). A hyphen is a
 * place a browser may break a line and a press is one unbreakable box, so an id with hyphens would
 * wrap one way as text and another way as a press.
 */
export const newResourceId = (): string => `res_${randomUUID().replaceAll('-', '')}`

/**
 * 🔴 **A question THIS APP raised, and the only request id here a provider did not mint** (437,
 * criterion 29) — see {@link QuestionAskedEvent.requestId}.
 *
 * ## ⛔ Why it needs a prefix of its own
 *
 * ⚠️ **Every other id a `request_routed` row carries came off a provider**, and neither provider's
 * numbering is drawn from anything durable — `RuntimeHost.answerQuestion` takes the LAST match for
 * exactly that reason, because a resumed conversation is a new provider session and one ledger can
 * hold the same id twice. ⛔ **A question this app raised must not be able to collide with one of
 * those**, in either direction: a provider id that happened to equal ours would resolve a tool call
 * nobody answered, and ours equalling a provider's would send an answer to the wrong waiter.
 *
 * ⛔ **The prefix is NOT the dispatch, and nothing may make it one.**
 * `RuntimeHost.answerQuestion` asks whether it is HOLDING the id, never whether it looks like one —
 * so a provider free to mint `req_…` tomorrow cannot route its answers into this app's branch.
 * ⚑ This string is a name; the map is the test.
 */
export const newAskedQuestionId = (): string => `req_${randomUUID()}`

/**
 * `iprop_<uuid>` — one ask an agent made against an identity's own instructions (582).
 *
 * ⚑ **Its own prefix**, for {@link newAskedQuestionId}'s reason: an instruction ask is looked up by
 * `askId` across every ledger, and one prefix over two populations is how a door comes to answer
 * about the wrong row. `a-column-name-is-a-claim`, applied to an id.
 */
export const newInstructionAskId = (): string => `iprop_${randomUUID()}`

/** `msreq_<uuid>`: one request an agent made for the person to register an MCP server. */
export const newMcpServerRequestId = (): string => `msreq_${randomUUID()}`
