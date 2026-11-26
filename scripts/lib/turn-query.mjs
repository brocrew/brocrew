/**
 * Read a specific turn's ending from the ledger with explicit conversation scope.
 * `ordinal` is unique only within a session and generation; choosing the highest interrupted
 * ordinal across the database can report another conversation's turn. Share this query so
 * its scoping can be checked without executing a live interrupt.
 */

/**
 * Session ids this app mints are `sess_<n>`; imported and adopted rows keep the same alphabet.
 *
 * The value is interpolated into SQL, because the smoke's `queryDatabase` runs `sqlite3` with a
 * statement rather than bound parameters. So the shape is checked and anything else is refused.
 */
export const SESSION_ID_SHAPE = /^[A-Za-z0-9_-]+$/

/**
 * What the ledger says about the most recent interrupted turn, of one session or of any.
 *
 * @param {string | null} sessionId — the app session to scope to. `null` asks the whole-database
 *   question, which is correct for the first step that interrupts anything.
 * @returns {string} one SQL statement.
 */
export function interruptedTurnQuery(sessionId = null) {
  if (sessionId !== null && !SESSION_ID_SHAPE.test(sessionId)) {
    throw new Error(
      `turn-query: refusing to build SQL for an id of an unexpected shape: ${JSON.stringify(sessionId)}`,
    )
  }
  const scope = sessionId === null ? '' : ` AND t.session_id = '${sessionId}'`
  return `
    SELECT t.end_reason, t.closed_at,
           (SELECT COUNT(*) FROM events e
             WHERE e.turn_id = t.id AND t.closed_at IS NOT NULL AND e.created_at > t.closed_at) AS late
      FROM turn t WHERE t.end_reason = 'interrupted'${scope} ORDER BY t.ordinal DESC LIMIT 1;`
}

/**
 * What the provider did with a turn the app interrupted, read from the rollout file (the app
 * keeps no copy).
 *
 * The `turn` row records the provider's own word, so this and {@link interruptedTurnQuery}'s row
 * are one fact read from two places, and this one, off Codex's own file, cannot be relabelled.
 * Except where the app ended the turn (a Close, `forceEnd`): that word is the app's, and the
 * `events` row (type `turn`) says so with `wordOf: 'this-app'` in its payload. The `turn` table
 * keeps only `end_reason`, so it cannot tell the two apart, and the provider's word for such a
 * turn is in no row.
 */

/** A Codex thread id, as `provider_session.external_ref` and the rollout's file name carry it. */
const CODEX_THREAD_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Which provider ran one app session, and the ref it resumes from.
 *
 * Interpolated into SQL like {@link interruptedTurnQuery}'s id, and refused the same way.
 *
 * @param {string} sessionId
 * @returns {string} one SQL statement.
 */
export function providerRefQuery(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_SHAPE.test(sessionId)) {
    throw new Error(
      `turn-query: refusing to build SQL for an id of an unexpected shape: ${JSON.stringify(sessionId)}`,
    )
  }
  return `SELECT provider, external_ref FROM provider_session WHERE id = '${sessionId}' LIMIT 1;`
}

/**
 * The Codex thread a `provider_session.external_ref` names, or null when it names none.
 *
 * Checked, not trusted: the id becomes part of a file name the smoke looks for, so anything
 * outside {@link CODEX_THREAD_SHAPE} is not a thread id, and neither is a ref that is not Codex's.
 *
 * @param {unknown} externalRef — the column as `sqlite3 -json` returns it: JSON text, or null.
 * @returns {string | null}
 */
export function codexThreadOf(externalRef) {
  let ref = externalRef
  if (typeof externalRef === 'string') {
    try {
      ref = JSON.parse(externalRef)
    } catch {
      return null
    }
  }
  const id = ref?.sessionId
  return ref?.provider === 'codex' && typeof id === 'string' && CODEX_THREAD_SHAPE.test(id)
    ? id
    : null
}

/**
 * Whether a file name is that thread's rollout: `rollout-<stamp>-<thread id>.jsonl`.
 *
 * The only files the smoke opens in a Codex home are the ones this accepts, so `auth.json`, a
 * copy of a real credential, is never read.
 */
export function isRolloutOf(name, threadId) {
  return (
    typeof threadId === 'string' &&
    CODEX_THREAD_SHAPE.test(threadId) &&
    name.startsWith('rollout-') &&
    name.endsWith(`-${threadId}.jsonl`)
  )
}

/**
 * How the turn that carried `prompt` ended, in the rollout's own words.
 *
 * Measured shapes: each turn opens with `event_msg` `task_started{turn_id}` and a
 * `turn_context{turn_id}`, records the person's words as `event_msg` `user_message{message}` (the
 * app's preamble first, the words last), and closes with either `event_msg` `task_complete{turn_id}`
 * or `event_msg` `turn_aborted{turn_id, reason}`.
 *
 * The turn is the one open when the person's message was recorded: the last `turn_id` named by a
 * `task_started` or `turn_context` before the first `user_message` whose text contains `prompt`.
 * A line that does not parse is skipped: the provider appends while this reads, and a
 * half-written last line is not yet a record.
 *
 * @param {string} text — the rollout file's contents.
 * @param {string} prompt — words only this turn's message carries.
 * @returns {{ turnId: string | null, aborted: string | null, completed: boolean, settled: boolean,
 *   seen: string[] }} `seen` is every `event_msg` type the file held, for a red to quote.
 */
export function rolloutTurnEnding(text, prompt) {
  let open = null
  let turnId = null
  let aborted = null
  let completed = false
  const seen = new Set()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const payload = row?.payload
    if (row?.type === 'turn_context' && typeof payload?.turn_id === 'string') open = payload.turn_id
    if (row?.type !== 'event_msg' || typeof payload?.type !== 'string') continue
    seen.add(payload.type)
    if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
      open = payload.turn_id
    } else if (payload.type === 'user_message') {
      if (
        turnId === null &&
        typeof payload.message === 'string' &&
        payload.message.includes(prompt)
      )
        turnId = open
    } else if (turnId !== null && payload.turn_id === turnId) {
      if (payload.type === 'turn_aborted')
        aborted = typeof payload.reason === 'string' ? payload.reason : 'no reason given'
      if (payload.type === 'task_complete') completed = true
    }
  }
  return { turnId, aborted, completed, settled: aborted !== null || completed, seen: [...seen] }
}

/**
 * What Codex itself wrote about its reasoning: every `response_item` of type `reasoning` in a
 * rollout, and how many carry a summary with words. A reasoning item with `summary: []` is Codex
 * summarising with nothing; words here that the app's ledger lacks mean the app lost them.
 * A line that does not parse is skipped, as in {@link rolloutTurnEnding}.
 *
 * @param {string} text — the rollout file's contents.
 * @returns {{ reasoning: number, worded: number }}
 */
export function rolloutReasoningSummary(text) {
  let reasoning = 0
  let worded = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row?.type !== 'response_item' || row.payload?.type !== 'reasoning') continue
    reasoning += 1
    const summary = Array.isArray(row.payload.summary) ? row.payload.summary : []
    if (summary.some((part) => typeof part?.text === 'string' && part.text.trim() !== '')) {
      worded += 1
    }
  }
  return { reasoning, worded }
}

/**
 * One workflow tree per run: `null` when every tree names its own run by task id, or what is
 * wrong as a sentence. It catches one run drawn twice, which a count of Workflow calls cannot.
 *
 * @param {string[]} runs — each tree's `data-task-id`, in document order (`''` when absent).
 * @returns {string | null}
 */
export function oneTreePerRun(runs) {
  if (runs.some((run) => run === '')) {
    return `a workflow tree names no run (task ids ${JSON.stringify(runs)})`
  }
  if (new Set(runs).size !== runs.length) {
    return `two trees draw ONE run (task ids ${JSON.stringify(runs)}) — the fold, not the provider`
  }
  return null
}

/**
 * The verdict on {@link rolloutTurnEnding}'s answer: `null` while the turn has not ended in
 * the file, `{ ok: true, turnId }` for a turn Codex itself aborted as interrupted and did not
 * complete, and `{ ok: false, why }` for everything else.
 *
 * `task_complete` outranks an abort in the same file: a turn the provider finished was not
 * interrupted, whatever the app's row says.
 */
export function providerInterruptVerdict(ending) {
  if (ending.turnId === null || !ending.settled) return null
  if (ending.completed) {
    return {
      ok: false,
      why:
        `Codex COMPLETED turn ${ending.turnId} (task_complete) after the app asked it to stop` +
        (ending.aborted !== null ? `, and also recorded turn_aborted (${ending.aborted})` : '') +
        ' — so the interrupt the app asked for was not honoured',
    }
  }
  if (ending.aborted !== 'interrupted') {
    return {
      ok: false,
      why: `Codex aborted turn ${ending.turnId} for "${ending.aborted}", not because it was interrupted`,
    }
  }
  return { ok: true, turnId: ending.turnId }
}

/**
 * A Claude session id (a UUID), checked rather than trusted for {@link isRolloutOf}'s reason:
 * it becomes a file name the smoke looks for.
 */
const CLAUDE_SESSION_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The Claude session a `provider_session.external_ref` names, or null when it names none;
 * {@link codexThreadOf}'s shape for the other provider.
 *
 * @param {unknown} externalRef — the column as `sqlite3 -json` returns it: JSON text, or null.
 * @returns {string | null}
 */
export function claudeSessionOf(externalRef) {
  let ref = externalRef
  if (typeof externalRef === 'string') {
    try {
      ref = JSON.parse(externalRef)
    } catch {
      return null
    }
  }
  const id = ref?.sessionId
  return ref?.provider === 'claude' && typeof id === 'string' && CLAUDE_SESSION_SHAPE.test(id)
    ? id
    : null
}

/** Is `name` the transcript file Claude keeps for `sessionId` — `<sessionId>.jsonl`, and only that? */
export function isClaudeTranscriptOf(name, sessionId) {
  return (
    typeof sessionId === 'string' &&
    CLAUDE_SESSION_SHAPE.test(sessionId) &&
    name === `${sessionId}.jsonl`
  )
}

/**
 * The prompts a Claude transcript recorded, in order: the text the CLI received.
 * `user` entries only; an entry carrying a `tool_result` part is a tool's result, not a prompt,
 * and an entry the CLI marks `isMeta` is skipped too.
 *
 * @param {string} jsonl — the transcript file's text.
 * @returns {string[]}
 */
export function promptsIn(jsonl) {
  return promptEntriesIn(jsonl).map((entry) => entry.text)
}

/**
 * {@link promptsIn}'s prompts, each with the working directory the CLI recorded beside it (the
 * transcript's `cwd` field, `null` where an entry carries none). The CLI records where its Bash
 * tool's `cd` left it, so the prompt after a move names the moved folder.
 *
 * @param {string} jsonl — the transcript file's text.
 * @returns {{ text: string, cwd: string | null }[]}
 */
export function promptEntriesIn(jsonl) {
  const prompts = []
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type !== 'user' || entry.isMeta === true) continue
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : null
    const content = entry.message?.content
    if (typeof content === 'string') {
      prompts.push({ text: content, cwd })
      continue
    }
    if (!Array.isArray(content) || content.some((part) => part?.type === 'tool_result')) continue
    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
    if (text !== '') prompts.push({ text, cwd })
  }
  return prompts
}

/**
 * How a slash command a person typed arrived at the CLI.
 *
 * A slash command is only a command at the start of a prompt. If the app wraps a person's
 * message in its authorship preamble, the CLI runs nothing and the model answers the words;
 * `wrapped` detects that regression.
 *
 * - `wrapped`: a prompt ends with the command after other text and carries no `<command-name>`
 *   markup of the CLI's own, so it was never a command;
 * - `command`: the CLI recorded it as a command (its `<command-name>` markup names it), or the
 *   prompt was the command and nothing else;
 * - `absent`: no prompt ends with it.
 *
 * @param {readonly string[]} prompts — {@link promptsIn}'s answer.
 * @param {string} command — e.g. `/compact`.
 * @returns {{ arrived: 'wrapped', text: string } | { arrived: 'command' } | { arrived: 'absent' }}
 */
export function howACommandArrived(prompts, command) {
  for (let at = prompts.length - 1; at >= 0; at -= 1) {
    const text = prompts[at].trim()
    if (text === command || text.includes(`<command-name>${command}</command-name>`)) {
      return { arrived: 'command' }
    }
    if (text.endsWith(command) && /\s$/.test(text.slice(0, -command.length))) {
      return { arrived: 'wrapped', text: prompts[at] }
    }
  }
  return { arrived: 'absent' }
}
