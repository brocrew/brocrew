import { pathToFileURL } from 'node:url'

/**
 * A scripted Claude model for the upgrade lane, on loopback: what it answers, in the Messages API's
 * streaming shape, and the managed settings that point an installed Claude Code at it.
 *
 * A packaged BroBot hands Claude Code no `ANTHROPIC_*` variable of its own environment and loads
 * none of its settings files, but Claude Code applies its machine-wide managed settings in every
 * case, `env` block included (Anthropic's Agent SDK reference and managed-settings page). On a
 * runner that is the one place the lane can name its own model to every BroBot it starts.
 */

/** The fictional Anthropic key the lane saves in BroBot: the only key this model answers. */
export const CLAUDE_FIXTURE_KEY = 'sk-ant-upgrade-path-fictional-not-a-real-key'

/** The Claude Code the lane installs: the version whose scheduling shapes were measured. */
export const CLAUDE_CODE_VERSION = '2.1.287'

/** Where Claude Code reads machine-wide managed settings on each system the lane runs on. */
export const MANAGED_SETTINGS_PATH = {
  mac: '/Library/Application Support/ClaudeCode/managed-settings.json',
  windows: 'C:\\Program Files\\ClaudeCode\\managed-settings.json',
}

/**
 * The managed settings that send every Claude Code on the runner to the model on `port`, and
 * keep it from reaching anything else on its own.
 */
export function managedSettingsFor(port) {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`not a port: ${String(port)}`)
  }
  return {
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(port)}`,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
    },
  }
}

/** Which key a request to the model carried: the fixture, another one, or none. */
export function claudeKeySeen(headers, key = CLAUDE_FIXTURE_KEY) {
  const given = headers?.['x-api-key'] ?? null
  const bearer = /^Bearer (.+)$/.exec(String(headers?.authorization ?? ''))?.[1] ?? null
  const seen = given ?? bearer
  if (seen === null || seen === '') return 'none'
  return seen === key ? 'expected' : 'other'
}

/** The `tool_use` ids a request already carries an answer for, wherever in it they sit. */
export function toolResultsIn(body) {
  const answered = new Set()
  for (const message of body?.messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        answered.add(block.tool_use_id)
      }
    }
  }
  return answered
}

/** The notice BroBot says to a conversation about the jobs it will not start it for. */
export const JOB_NOTICE = 'a-scheduled-job-that-will-not-run'

/**
 * What a conversation's ledger holds of that notice, from the database's `events` rows: the
 * words held for its next start (`message_queued`), the words said at a start (`user_turn`), and,
 * for each level the app wrote itself, why it starts no conversation for each job it lists.
 */
export function jobNoticesIn(events, sessionId) {
  const own = (events ?? [])
    .filter((row) => row?.session_id === sessionId)
    .sort((one, other) => Number(one.ordinal) - Number(other.ordinal))
    .map((row) => {
      let payload = null
      try {
        payload = JSON.parse(String(row.payload))
      } catch {
        // An unreadable payload carries nothing this reads.
      }
      return { type: row.type, raw: String(row.payload ?? ''), payload }
    })
  const carrying = own.filter((one) => one.raw.includes(`"${JOB_NOTICE}"`))
  const textOf = (one) => (typeof one.payload?.text === 'string' ? one.payload.text : null)
  const appLevels = own.filter(
    (one) =>
      one.type === 'scheduled_work' &&
      one.payload?.source === 'app/receipts' &&
      Array.isArray(one.payload?.jobs),
  )
  return {
    queued: carrying.filter((one) => one.type === 'message_queued').map(textOf),
    said: carrying.filter((one) => one.type === 'user_turn').map(textOf),
    appLevels: appLevels.map((one) => one.payload.jobs.map((job) => job?.notStarted ?? null)),
    // The newest level the app wrote itself: each job it lists, and why it is not started for.
    appJobs: (appLevels.at(-1)?.payload.jobs ?? []).map((job) => ({
      id: job?.id ?? null,
      notStarted: job?.notStarted ?? null,
      // The minute the app plans for the job, where it knows one.
      nominalAt: typeof job?.nominalAt === 'number' ? job.nominalAt : null,
    })),
  }
}

/**
 * The receipts of scheduling calls a conversation's ledger holds: which tool call, which tool,
 * the id of the job its result names, the id it was asked about, where it was asked one, and
 * whether the app stamped it with the calendar it was read under (builds with the scheduling
 * switch do; earlier ones don't, and then a job's time can't be known from its receipt).
 */
export function receiptsIn(events, sessionId) {
  return (events ?? [])
    .filter((row) => row?.session_id === sessionId && row?.type === 'scheduled_work')
    .flatMap((row) => {
      let receipt
      try {
        receipt = JSON.parse(String(row.payload))?.receipt
      } catch {
        return []
      }
      if (receipt === undefined || receipt === null) return []
      return [
        {
          toolUseId: receipt.toolUseId ?? null,
          tool: receipt.tool ?? null,
          job: receipt.result?.id ?? null,
          asked: receipt.input?.id ?? null,
          stamped: receipt.stamp !== undefined && receipt.stamp !== null,
        },
      ]
    })
}

/**
 * Whether a beta stamps the receipts of the jobs it makes: `stamped` when every one of them is,
 * `unstamped` when none is, `mixed` otherwise, and `none` with no job made to tell by.
 */
export function stampingOf(receipts) {
  const made = (receipts ?? []).filter((one) => one?.tool === 'CronCreate')
  if (made.length === 0) return 'none'
  const stamped = made.filter((one) => one.stamped === true).length
  if (stamped === made.length) return 'stamped'
  return stamped === 0 ? 'unstamped' : 'mixed'
}

/**
 * Which of the lane's conversations a request is of, by the first words each was asked: the key
 * in `firsts` whose words a person's side of the request holds, or `null` for none or several.
 */
export function conversationOf(texts, firsts) {
  const of = Object.entries(firsts ?? {}).filter(([, first]) =>
    (texts ?? []).some((text) => String(text).includes(first)),
  )
  return of.length === 1 ? of[0][0] : null
}

/** Whether a text names a job the way the app's words about jobs do: its prompt, in quotes. */
export function namesTheJob(text, prompt) {
  return String(text ?? '').includes(`“${prompt}”`)
}

/**
 * What one conversation's start for its jobs left in one stage: how often the app logged the
 * start, the requests of that conversation the model was sent with words naming every one of its
 * jobs, whether the app said the start waits for its saved Claude key, and any timed retry.
 *
 * `outcome` keeps the three states apart: `told` (its words reached the model), `refused` (it
 * waits for the key), `pending` (neither yet: a start still owed, waiting its turn), and `both`,
 * which no start can be.
 */
export function startEvidence({ requests, log, stage, conversation, of, prompts }) {
  const lines = String(log ?? '').split('\n')
  const started = lines.filter((line) =>
    line.includes(`starting ${conversation} for its scheduled jobs`),
  ).length
  const refused = lines.some((line) =>
    line.includes(
      `${conversation}'s start for its scheduled jobs waits until its saved claude key is saved again or removed`,
    ),
  )
  const retried = lines.filter((line) =>
    line.includes(`could not start ${conversation} for its scheduled jobs, and tries again in`),
  )
  const told = (requests ?? [])
    .filter(
      (one) =>
        one?.stage === stage &&
        one.auth === 'expected' &&
        one.of === of &&
        (one.notices ?? []).some((text) =>
          (prompts ?? []).every((prompt) => namesTheJob(text, prompt)),
        ),
    )
    .map((one) => one.id)
  const outcome = told.length > 0 ? (refused ? 'both' : 'told') : refused ? 'refused' : 'pending'
  return { conversation, started, told, refused, retried, outcome }
}

/** The epoch milliseconds of the local minute `at` falls in. */
export function minuteOf(at) {
  const minute = new Date(at)
  minute.setSeconds(0, 0)
  return minute.getTime()
}

/** A tool result's text, as the request carries it: a string, or its text blocks joined. */
export function toolResultText(body, toolUseId) {
  for (const message of body?.messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'tool_result' || block.tool_use_id !== toolUseId) continue
      if (typeof block.content === 'string') return block.content
      if (Array.isArray(block.content)) {
        return block.content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text)
          .join('\n')
      }
      return ''
    }
  }
  return null
}

/** The id of a job a scheduling call's result names: Claude Code's eight hex digits. */
export function jobIdIn(text) {
  return /\b([0-9a-f]{8})\b/.exec(String(text ?? ''))?.[1] ?? null
}

/** A daily cron for the local minute of `at`. */
export function dailyCron(at) {
  return `${String(at.getMinutes())} ${String(at.getHours())} * * *`
}

/** Every text a person's side of the conversation holds, in order. */
export function userTextsIn(body) {
  const texts = []
  for (const message of body?.messages ?? []) {
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') texts.push(message.content)
    else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      }
    }
  }
  return texts
}

/** Whether a request offers the model the named tool. */
export function offersTool(body, name) {
  return (body?.tools ?? []).some((tool) => tool?.name === name)
}

/** A one-shot cron for the local minute of `at`: minute, hour, day of month, month, any weekday. */
export function oneShotCron(at) {
  return `${String(at.getMinutes())} ${String(at.getHours())} ${String(at.getDate())} ${String(at.getMonth() + 1)} *`
}

const USAGE = {
  input_tokens: 11,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

/**
 * The stream of events one answer is made of: `{kind: 'text', text}` ends the turn, and
 * `{kind: 'tool_use', id, name, input}` asks Claude Code to run one of its tools.
 */
export function anthropicEvents(model, reply, messageId) {
  const start = {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE,
    },
  }
  const block =
    reply.kind === 'text'
      ? [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: reply.text },
          },
        ]
      : [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: reply.id, name: reply.name, input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.input) },
          },
        ]
  return [
    start,
    ...block,
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: reply.kind === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ]
}

/** Events as a server-sent-events body. */
export function sseOf(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

// Run as a program by the lane's workflow: `version` prints the Claude Code version to install,
// `managed-settings <port>` the managed settings that send it to the model on that port.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [what, port] = process.argv.slice(2)
  if (what === 'version') process.stdout.write(`${CLAUDE_CODE_VERSION}\n`)
  else if (what === 'managed-settings') {
    process.stdout.write(`${JSON.stringify(managedSettingsFor(Number(port)), null, 2)}\n`)
  } else {
    process.stderr.write('usage: scripted-claude.mjs version | managed-settings <port>\n')
    process.exitCode = 2
  }
}
