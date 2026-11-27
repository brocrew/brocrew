import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join, resolve } from 'node:path'
import { credentialSeen } from '../upgrade-path.mjs'
import {
  anthropicEvents,
  conversationOf,
  dailyCron,
  jobIdIn,
  namesTheJob,
  toolResultText,
  claudeKeySeen,
  offersTool,
  oneShotCron,
  sseOf,
  toolResultsIn,
  userTextsIn,
} from '../scripted-claude.mjs'
import { os, FIXTURE_KEY, stamp, summary, running, claudeDueAt, crashJobAt } from './settings.mjs'

const modelSeen = []
const model = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const id = `resp_upgrade_path_${String(modelSeen.length + 1)}`
    const auth = credentialSeen(request.headers.authorization, FIXTURE_KEY)
    modelSeen.push({
      at: stamp(),
      stage: running?.stage ?? null,
      method: request.method,
      url: request.url,
      id,
      auth,
    })
    if (request.method !== 'POST') return response.writeHead(404).end()
    if (auth !== 'expected') {
      response.writeHead(401, { 'content-type': 'application/json' })
      return response.end(
        JSON.stringify({
          error: {
            message: 'This local model answers only the upgrade-path fixture key.',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }),
      )
    }
    const send = (kind, payload) =>
      response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    send('response.created', { response: { id } })
    send('response.output_item.done', {
      output_index: 0,
      item: {
        type: 'message',
        id: `msg_${id}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: `${answerText(id)} café ☕ 日本語 ✓`,
            annotations: [],
          },
        ],
      },
    })
    send('response.completed', {
      response: {
        id,
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      },
    })
    response.end()
  })
})
await new Promise((done) => model.listen(0, '127.0.0.1', done))
const modelPort = model.address().port
function answerText(id) {
  return `Fictional answer ${id.replace(/^resp_upgrade_path_/, '')} of the upgrade path:`
}

const claudePort = /^\d+$/.test(process.env.UPGRADE_PATH_CLAUDE_PORT ?? '')
  ? Number(process.env.UPGRADE_PATH_CLAUDE_PORT)
  : null
const CLAUDE_FIRST_TEXT = 'Fictional Claude conversation: schedule three jobs and cancel one'
const CLAUDE_SEARCH_ID = 'toolu_upgrade_path_search'
const CLAUDE_JOBS = {
  repeating: {
    call: 'toolu_upgrade_path_repeating',
    prompt: 'A fictional repeating job of the upgrade path',
  },
  oneShot: { call: 'toolu_upgrade_path_cron', prompt: 'A fictional job of the upgrade path' },
  cancelled: {
    call: 'toolu_upgrade_path_to_cancel',
    prompt: 'A fictional job the upgrade path cancels',
  },
}
const CLAUDE_CANCEL_ID = 'toolu_upgrade_path_cancel'
const claudeOneShotAt = new Date(Date.now() + 3 * 60 * 60 * 1000)
const claudeRepeatsAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
const claudeCancelledAt = new Date(Date.now() + 5 * 60 * 60 * 1000)
const claudeSeen = []

/** One one-shot job: find CronCreate first if it is deferred, then make the job once. */
function oneShotJobReply(body, answered, at, call, prompt) {
  if (
    !answered.has(CLAUDE_SEARCH_ID) &&
    !answered.has(call) &&
    !offersTool(body, 'CronCreate') &&
    offersTool(body, 'ToolSearch')
  ) {
    return {
      kind: 'tool_use',
      id: CLAUDE_SEARCH_ID,
      name: 'ToolSearch',
      input: { query: 'select:CronCreate', max_results: 1 },
    }
  }
  if (answered.has(call)) return null
  return {
    kind: 'tool_use',
    id: call,
    name: 'CronCreate',
    input: { cron: oneShotCron(at), prompt, recurring: false },
  }
}

function claudeReply(body, id) {
  if ((body?.tools ?? []).length === 0) return { kind: 'text', text: 'Fictional.' }
  const answered = toolResultsIn(body)
  for (const [at, first, call, prompt] of [
    [claudeDueAt, DUE_FIRST_TEXT, DUE_JOB_CALL, DUE_JOB_PROMPT],
    [crashJobAt, CRASH_FIRST_TEXT, CRASH_JOB_CALL, CRASH_JOB_PROMPT],
  ]) {
    if (at === null || !userTextsIn(body).some((one) => one.includes(first))) continue
    const reply = oneShotJobReply(body, answered, at, call, prompt)
    if (reply !== null) return reply
  }
  if (userTextsIn(body).some((one) => one.includes(CLAUDE_FIRST_TEXT))) {
    if (
      !answered.has(CLAUDE_SEARCH_ID) &&
      !answered.has(CLAUDE_JOBS.repeating.call) &&
      !(offersTool(body, 'CronCreate') && offersTool(body, 'CronDelete')) &&
      offersTool(body, 'ToolSearch')
    ) {
      return {
        kind: 'tool_use',
        id: CLAUDE_SEARCH_ID,
        name: 'ToolSearch',
        input: { query: 'select:CronCreate,CronDelete', max_results: 2 },
      }
    }
    const making = [
      [CLAUDE_JOBS.repeating, dailyCron(claudeRepeatsAt), true],
      [CLAUDE_JOBS.oneShot, oneShotCron(claudeOneShotAt), false],
      [CLAUDE_JOBS.cancelled, oneShotCron(claudeCancelledAt), false],
    ]
    for (const [job, cron, recurring] of making) {
      if (answered.has(job.call)) continue
      return {
        kind: 'tool_use',
        id: job.call,
        name: 'CronCreate',
        input: { cron, prompt: job.prompt, recurring },
      }
    }
    if (!answered.has(CLAUDE_CANCEL_ID)) {
      return {
        kind: 'tool_use',
        id: CLAUDE_CANCEL_ID,
        name: 'CronDelete',
        input: {
          id: jobIdIn(toolResultText(body, CLAUDE_JOBS.cancelled.call)) ?? 'no-id-was-answered',
        },
      }
    }
  }
  return { kind: 'text', text: claudeAnswerText(id) }
}

const DUE_FIRST_TEXT = 'Fictional Claude conversation: schedule a job for a few minutes from now'
const DUE_JOB_PROMPT = 'A fictional job that comes due while the app is closed'
const DUE_JOB_CALL = 'toolu_upgrade_path_due_job'

const CRASH_FIRST_TEXT =
  'Fictional Claude conversation: schedule a job that comes due while it is stopped'
const CRASH_JOB_PROMPT = 'A fictional job that comes due while its conversation is stopped'
const CRASH_JOB_CALL = 'toolu_upgrade_path_crash_job'
const DUE_WHILE_STOPPED = 'was due while this conversation was stopped'
const holdTheCrashJobIn = new Set()
const heldClaudeAnswers = []
const tellsOfTheCrashJob = (body) =>
  userTextsIn(body).some((one) => one.includes(CRASH_JOB_PROMPT) && one.includes(DUE_WHILE_STOPPED))

const TIME_NOT_KNOWN_WORDS = 'runs at a time this app cannot tell'

const CLAUDE_FIRSTS = {
  claude: CLAUDE_FIRST_TEXT,
  due: DUE_FIRST_TEXT,
  crash: CRASH_FIRST_TEXT,
}

const CLAUDE_JOB_PROMPTS = {
  claude: Object.values(CLAUDE_JOBS).map((job) => job.prompt),
  due: [DUE_JOB_PROMPT],
  crash: [CRASH_JOB_PROMPT],
}
const JOB_PROMPTS = Object.values(CLAUDE_JOB_PROMPTS).flat()

const CLAUDE_ROUTE =
  os === 'windows'
    ? 'through the run’s own proxy, under a certificate authority the run made'
    : 'sent there by the runner’s managed settings'

function claudeAnswerText(id) {
  return `Fictional Claude answer ${id.replace(/^msg_upgrade_path_/, '')} of the upgrade path.`
}

function answerClaude(request, response) {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const path = request.url ?? ''
    if (!path.startsWith('/v1/messages')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }))
    }
    if (path.startsWith('/v1/messages/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ input_tokens: 11 }))
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      body = null
    }
    const id = `msg_upgrade_path_${String(claudeSeen.length + 1)}`
    const auth = claudeKeySeen(request.headers)
    const reply = auth === 'expected' ? claudeReply(body, id) : null
    const texts = userTextsIn(body)
    claudeSeen.push({
      at: stamp(),
      stage: running?.stage ?? null,
      method: request.method,
      url: path,
      id,
      auth,
      of: conversationOf(texts, CLAUDE_FIRSTS, CLAUDE_JOB_PROMPTS),
      tools: (body?.tools ?? []).map((tool) => tool?.name).filter(Boolean),
      answered: [...toolResultsIn(body)],
      notices: texts
        .filter((one) => JOB_PROMPTS.some((prompt) => namesTheJob(one, prompt)))
        .map((one) => one.slice(0, 2000)),
      reply: reply === null ? null : { kind: reply.kind, name: reply.name, input: reply.input },
      crashJob: tellsOfTheCrashJob(body),
    })
    if (reply !== null && holdTheCrashJobIn.has(running?.stage) && tellsOfTheCrashJob(body)) {
      heldClaudeAnswers.push(response)
      return
    }
    if (reply === null) {
      response.writeHead(401, { 'content-type': 'application/json' })
      return response.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'This local model answers only the upgrade-path fixture key.',
          },
        }),
      )
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.end(sseOf(anthropicEvents(String(body?.model ?? 'claude-upgrade-path'), reply, id)))
  })
}
const claudeModel = createServer(answerClaude)
if (claudePort !== null) {
  await new Promise((done, fail) => {
    claudeModel.once('error', fail)
    claudeModel.listen(claudePort, '127.0.0.1', done)
  })
}

const tlsFolder =
  (process.env.UPGRADE_PATH_TLS_DIR ?? '') === '' ? null : resolve(process.env.UPGRADE_PATH_TLS_DIR)
const tunnels = []
summary.claudeTunnels = tunnels
let claudeProxyPort = null
if (claudePort !== null && tlsFolder !== null) {
  const anthropicStandIn = createHttpsServer(
    {
      key: readFileSync(join(tlsFolder, 'api.key')),
      cert: readFileSync(join(tlsFolder, 'api.pem')),
    },
    answerClaude,
  )
  const proxy = createServer((request, response) => {
    tunnels.push({ at: stamp(), stage: running?.stage ?? null, to: request.url, allowed: false })
    response.writeHead(403).end()
  })
  proxy.on('connect', (request, socket, head) => {
    socket.on('error', () => {})
    const allowed = request.url === 'api.anthropic.com:443'
    tunnels.push({ at: stamp(), stage: running?.stage ?? null, to: request.url, allowed })
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) socket.unshift(head)
    anthropicStandIn.emit('connection', socket)
  })
  await new Promise((done, fail) => {
    proxy.once('error', fail)
    proxy.listen(0, '127.0.0.1', done)
  })
  claudeProxyPort = proxy.address().port
}

const claudeRouteEnv = () =>
  claudeProxyPort === null
    ? {}
    : {
        HTTPS_PROXY: `http://127.0.0.1:${String(claudeProxyPort)}`,
        NO_PROXY: '127.0.0.1,localhost',
        NODE_EXTRA_CA_CERTS: join(tlsFolder, 'ca.pem'),
      }

export {
  modelSeen,
  model,
  modelPort,
  answerText,
  claudePort,
  CLAUDE_FIRST_TEXT,
  CLAUDE_JOBS,
  CLAUDE_CANCEL_ID,
  claudeOneShotAt,
  claudeSeen,
  DUE_FIRST_TEXT,
  DUE_JOB_PROMPT,
  DUE_JOB_CALL,
  CRASH_FIRST_TEXT,
  CRASH_JOB_CALL,
  DUE_WHILE_STOPPED,
  holdTheCrashJobIn,
  TIME_NOT_KNOWN_WORDS,
  CLAUDE_ROUTE,
  claudeAnswerText,
  claudeRouteEnv,
}
