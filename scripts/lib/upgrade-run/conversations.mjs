import { spawnSync } from 'node:child_process'
import { sleep, until } from '../update-rehearsal-app.mjs'
import { readDatabase } from '../upgrade-database.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { turnOutcome } from '../upgrade-path.mjs'
import { CLAUDE_FIXTURE_KEY, JOB_NOTICE, jobNoticesIn, startEvidence } from '../scripted-claude.mjs'
import {
  os,
  evidence,
  FIXTURE_KEY,
  data,
  summary,
  check,
  must,
  running,
  crashJobAt,
  setCrashJobAt,
  setInstalled,
} from './settings.mjs'
import { windowsProcesses, alive } from './system.mjs'
import {
  modelSeen,
  answerText,
  claudePort,
  CLAUDE_JOBS,
  CLAUDE_CANCEL_ID,
  claudeSeen,
  CRASH_FIRST_TEXT,
  CRASH_JOB_CALL,
  holdTheCrashJobIn,
  CLAUDE_ROUTE,
  claudeAnswerText,
} from './models.mjs'
import { launch, bridge, onScreen, quit, stop } from './app.mjs'
import { readState, answersWhile } from './state.mjs'

async function turn(sessionId, text, { resume, seenBy = modelSeen, answerOf = answerText }) {
  const asked = seenBy.length
  const began = Date.now()
  const id = JSON.stringify(sessionId)
  const sent = (async () => {
    let step = resume ? 'start' : 'send'
    try {
      if (resume) {
        await running.cdp.evaluate(
          `await window.api.runtime.resume({ sessionId: ${id} }); return true`,
          180_000,
        )
        step = 'send'
      }
      await running.cdp.evaluate(
        `await window.api.runtime.send({ sessionId: ${id}, text: ${JSON.stringify(text)} }); return true`,
        180_000,
      )
      return { refused: null, refusedAt: null, refusedAfterMs: null }
    } catch (error) {
      return { refused: error.message, refusedAt: step, refusedAfterMs: Date.now() - began }
    }
  })()
  const probes = resume ? await answersWhile(sent) : null
  const outcome = await sent
  const answer =
    outcome.refused !== null
      ? null
      : await until(
          async () => {
            for (const seen of seenBy.slice(asked)) {
              if (seen.method !== 'POST' || seen.auth !== 'expected') continue
              const recorded = await running.cdp.evaluate(
                `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${id} })).includes(${JSON.stringify(answerOf(seen.id))})`,
              )
              if (recorded) return seen.id
            }
            return null
          },
          180_000,
          2_000,
        )
  return { answer, ...outcome, requests: seenBy.slice(asked), probes }
}

const saveTheKey = (provider, key) =>
  running.cdp.evaluate(
    `return await window.api.runtime.setApiKey({ provider: ${JSON.stringify(provider)}, key: ${JSON.stringify(key)} }).then((one) => ({ set: one?.set, inUse: one?.inUse, refused: one?.refused ?? null })).catch((e) => ({ threw: String(e) }))`,
    240_000,
  )
const savedCleanly = (saved) =>
  saved?.set === true && saved.refused === null && saved.threw === undefined

function scheduleAttemptsOf(conversation) {
  try {
    const state = readState(data, readDatabase(data).tables)
    return JSON.parse(state['schedule-attempts.json']?.toString('utf8') ?? '{}').conversations?.[
      conversation
    ]
  } catch (error) {
    return { unread: String(error) }
  }
}

const historyTail = (sessionId) =>
  running.cdp
    .evaluate(
      `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} })).slice(-6000)`,
    )
    .catch((error) => `not read: ${String(error)}`)

const claudeTurn = (sessionId, text, { resume }) =>
  turn(sessionId, text, { resume, seenBy: claudeSeen, answerOf: claudeAnswerText })

const claudeRanEveryCall = (requests) =>
  [...Object.values(CLAUDE_JOBS).map((job) => job.call), CLAUDE_CANCEL_ID].every((call) =>
    requests.some((one) => one.answered.includes(call)),
  )

async function crash(stage) {
  const { pid } = running
  if (os === 'windows') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    process.kill(pid, 'SIGKILL')
  }
  const ended = await until(
    () => (!alive(pid) && (os !== 'windows' || windowsProcesses().length === 0) ? true : null),
    60_000,
  )
  check(Boolean(ended), `${stage}: the app was ended at once, its whole tree, as a crash ends it`, {
    pid,
  })
  await stop()
}

const loggedBy = (stage) =>
  [`${stage}.log`, `${stage}.stdout.log`]
    .map((name) => join(evidence, name))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
const linesOf = (stage, words) =>
  loggedBy(stage)
    .split('\n')
    .filter((line) => line.includes(words))

function jobWordsIn(sessionId) {
  let tables
  try {
    ;({ tables } = readDatabase(data))
  } catch (error) {
    return { unread: String(error) }
  }
  const own = (tables.events ?? [])
    .filter((row) => row.session_id === sessionId)
    .map((row) => ({ type: row.type, payload: String(row.payload ?? '') }))
    .filter((row) => row.payload.includes(JOB_NOTICE))
  return {
    held: own.filter((row) => row.type === 'message_queued').length,
    said: own.filter((row) => row.type === 'user_turn').length,
    ended: own
      .filter((row) => row.type === 'message_unqueued')
      .map((row) => JSON.parse(row.payload).reason ?? null),
  }
}

async function aCrashMidStart(into) {
  await launch('candidate-crash-made', 9343)
  await bridge('the crash, the job made')
  const created = await running.cdp.evaluate(
    "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
    240_000,
  )
  must(
    typeof created?.sessionId === 'string',
    'the candidate started a second Claude conversation',
    {
      created,
    },
  )
  const sessionId = created.sessionId
  into.sessionId = sessionId
  setCrashJobAt(new Date(Math.ceil((Date.now() + 90_000) / 60_000) * 60_000))
  into.jobAt = crashJobAt.toISOString()
  const made = await claudeTurn(sessionId, CRASH_FIRST_TEXT, { resume: false })
  must(
    made.answer !== null && made.requests.some((one) => one.answered.includes(CRASH_JOB_CALL)),
    'the candidate’s Claude Code made the one-shot, and the turn was answered',
    { refused: made.refused, requests: made.requests },
  )
  await running.cdp.evaluate(
    `return await window.api.runtime.close({ sessionId: ${JSON.stringify(sessionId)} })`,
  )
  await quit('the crash: the job made, the app closed')

  await until(() => (Date.now() > crashJobAt.getTime() + 70_000 ? true : null), 300_000, 5_000)
  holdTheCrashJobIn.add('candidate-crash-told')
  await launch('candidate-crash-told', 9344)
  await bridge('the crash, the start that tells it')
  const asked = await until(
    () => claudeSeen.some((one) => one.stage === 'candidate-crash-told' && one.crashJob) || null,
    120_000,
  )
  check(
    asked === true,
    'a launch after the one-shot’s minute started its conversation by itself, to say it was due while it was stopped',
    claudeSeen.filter((one) => one.stage === 'candidate-crash-told'),
  )
  into.atTheCrash = jobWordsIn(sessionId)
  await crash('the crash, mid-turn')

  await launch('candidate-after-the-mid-start-crash', 9348)
  await bridge('after the crash')
  await sleep(45_000)
  const again = claudeSeen.filter(
    (one) => one.stage === 'candidate-after-the-mid-start-crash' && one.crashJob,
  )
  check(
    again.length === 0,
    'after the crash, the next launch made no second start for the job, and did not say its words again',
    again,
  )
  await quit('after the crash')
  const words = jobWordsIn(sessionId)
  into.afterTheCrash = words
  check(
    words.held === 1 && words.said === 1 && !words.ended.includes('abandoned'),
    'its words were held once and said once, and nothing ended them as not sent',
    words,
  )
  into.startLines = {
    told: linesOf('candidate-crash-told', `starting ${sessionId} for its scheduled jobs`).length,
    after: linesOf(
      'candidate-after-the-mid-start-crash',
      `starting ${sessionId} for its scheduled jobs`,
    ).length,
  }
  check(
    into.startLines.told === 1 && into.startLines.after === 0,
    'the app’s logs say it started the conversation for its job once, before the crash, and not after it',
    into.startLines,
  )
}

const NEW_KEY_TEXT = 'A fictional Claude conversation, started after a key was saved again'

const AFTER_THE_KEY_TEXT = 'A fictional turn after the key was saved again'

async function theKeySavedAgain(into, conversations, claude) {
  const { claudeConversation, claudeDueConversation } = claude
  await launch('candidate-new-key', 9347)
  await bridge('the key saved again')
  into.codexSaved = await saveTheKey('codex', FIXTURE_KEY)
  check(
    savedCleanly(into.codexSaved),
    'the key saved again: the candidate saved the fictional Codex key, and was not refused',
    into.codexSaved,
  )
  into.codex = []
  for (const sessionId of conversations) {
    const carried = await turn(sessionId, AFTER_THE_KEY_TEXT, { resume: true })
    const judged = turnOutcome(carried, null)
    into.codex.push({ sessionId, ...judged, ...carried })
    check(
      judged.outcome === 'answered',
      `the key saved again: the candidate carried on conversation ${sessionId}, answered on the key`,
      { ...judged, ...carried },
    )
  }
  if (claudePort !== null) {
    into.claudeSaved = await saveTheKey('claude', CLAUDE_FIXTURE_KEY)
    check(
      savedCleanly(into.claudeSaved),
      'the key saved again: the candidate saved the fictional Anthropic key, and was not refused',
      into.claudeSaved,
    )
    const owed =
      claude.stamped && claudeDueConversation !== null ? claudeDueConversation : claudeConversation
    if (owed !== null) await theOwedStartOnTheKey(into, owed, claude)
    if (owed !== null && !claude.keyWasSealed) {
      const started = linesOf('candidate-new-key', `starting ${owed} for its scheduled jobs`)
      check(
        started.length === 0,
        'saving the readable key again made no second start for the delivered notice',
        { started },
      )
    }
    if (claudeConversation !== null) {
      const carried = await claudeTurn(claudeConversation, AFTER_THE_KEY_TEXT, {
        resume: !claude.keyWasSealed || owed !== claudeConversation,
      })
      into.claude = { sessionId: claudeConversation, ...carried }
      if (carried.answer === null) into.claude.history = await historyTail(claudeConversation)
      check(
        turnOutcome(carried, null).outcome === 'answered',
        `the key saved again: the candidate’s Claude Code reached the scripted model, ${CLAUDE_ROUTE}, and carried the beta’s Claude conversation on`,
        { refused: carried.refused, requests: carried.requests },
      )
    }
    const created = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(
        typeof created?.sessionId === 'string',
        'the key saved again: the candidate started a new Claude conversation',
        { created },
      )
    ) {
      const made = await claudeTurn(created.sessionId, NEW_KEY_TEXT, { resume: false })
      into.newClaude = { sessionId: created.sessionId, ...made }
      if (made.answer === null) into.newClaude.history = await historyTail(created.sessionId)
      check(
        made.answer !== null && made.requests.some((one) => one.auth === 'expected'),
        `the key saved again: the new Claude conversation reached the scripted model, ${CLAUDE_ROUTE}, and the turn was answered`,
        { refused: made.refused, requests: made.requests },
      )
    }
  }
  await quit('the key saved again')
}

async function theOwedStartOnTheKey(into, owed, { stamped, jobIds, keyWasSealed }) {
  const noticesNow = () => {
    try {
      return jobNoticesIn(readDatabase(data).tables.events, owed)
    } catch {
      return null
    }
  }
  const said = await until(
    () => ((noticesNow()?.said.length ?? 0) > 0 ? true : null),
    180_000,
    2_000,
  )
  const answered = await until(
    async () => {
      for (const seen of claudeSeen) {
        if (
          seen.stage !== (keyWasSealed ? 'candidate-new-key' : 'candidate-first') ||
          seen.method !== 'POST'
        )
          continue
        if (seen.auth !== 'expected' || seen.notices.length === 0) continue
        const recorded = await running.cdp.evaluate(
          `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(owed)} })).includes(${JSON.stringify(claudeAnswerText(seen.id))})`,
        )
        if (recorded) return seen
      }
      return null
    },
    180_000,
    2_000,
  )
  const notices = noticesNow()
  into.owed = { conversation: owed, notices, toldIn: answered?.id ?? null }
  check(
    said === true &&
      notices?.queued.length === 1 &&
      notices.said.length === 1 &&
      notices.said[0] === notices.queued[0] &&
      answered !== null &&
      answered.notices.some((text) => text.includes(notices.said[0].slice(0, 200))),
    keyWasSealed
      ? 'the key saved again: the start the app owed was made by itself, said its held words once, and the model was sent them and answered'
      : 'the readable key: the start owed was made at first open, said its held words once, and the model was sent them and answered',
    into.owed,
  )
  if (stamped || notices === null) return
  const listed = new Map(notices.appJobs.map((job) => [job.id, job.notStarted]))
  check(
    listed.size === 2 &&
      listed.get(jobIds.repeating) === 'time-not-known' &&
      listed.get(jobIds.oneShot) === 'time-not-known' &&
      !listed.has(jobIds.cancelled),
    'once its one start was made, the candidate lists the beta’s repeating job and its one-shot as jobs whose time it cannot know, not started again, and not the job the beta cancelled',
    { listed: notices.appJobs, ids: jobIds },
  )
  const words = notices.said[0] ?? ''
  check(
    words.includes(CLAUDE_JOBS.repeating.prompt) &&
      words.includes(CLAUDE_JOBS.oneShot.prompt) &&
      !words.includes(CLAUDE_JOBS.cancelled.prompt),
    'its words name the repeating job and the one-shot, and not the job the beta cancelled',
    { words },
  )
  into.owed.attempts = scheduleAttemptsOf(owed)
  check(
    Object.values(into.owed.attempts?.notStartedSaid ?? {}).includes('time-not-known'),
    'the candidate’s record of what it did says it told the conversation it cannot know that job’s time',
    into.owed.attempts,
  )
}

const FIRST_OPEN_STARTS_MS = 180_000
const COPY_FINISH_MS = 120_000

function theStartAndTheKey(conversation, called, atFirstOpen) {
  const logs = ['candidate-first', 'candidate-second'].map((stage) => loggedBy(stage)).join('\n')
  const { started, refused, retried } = startEvidence({ log: logs, conversation })
  const seen = {
    conversation,
    atFirstOpen: atFirstOpen?.outcome ?? null,
    started,
    refused,
    retried,
  }
  summary.claude.keyWait[conversation] = seen
  if (atFirstOpen?.outcome === 'told') {
    check(
      started === 1 && !refused && retried.length === 0,
      `made on the saved key at the first open, the candidate’s start for ${called} waited for no key, and nothing was tried again on a timer`,
      seen,
    )
  } else if (atFirstOpen?.outcome === 'refused') {
    check(
      refused && retried.length === 0,
      `refused because its saved key could not be read, the candidate’s start for ${called} waited for the key to be saved again, with no timed retry reading the key`,
      seen,
    )
  } else {
    check(
      false,
      `the candidate’s start for ${called} was neither made nor refused at the first open, so how it treats the saved key can’t be judged`,
      seen,
    )
  }
}

async function startHiddenProgram(program, workspace, stage, port, options = {}) {
  const { budget = 180_000, launchProgram = launch, windowWithin } = options
  setInstalled(program.exe, program.program)
  await launchProgram(stage, port, { workspace, hidden: true, windowWithin })
  await bridge(stage, budget)
  await onScreen(stage, true)
  return running
}

export {
  turn,
  saveTheKey,
  savedCleanly,
  scheduleAttemptsOf,
  historyTail,
  claudeTurn,
  claudeRanEveryCall,
  crash,
  loggedBy,
  linesOf,
  jobWordsIn,
  aCrashMidStart,
  theKeySavedAgain,
  theOwedStartOnTheKey,
  FIRST_OPEN_STARTS_MS,
  COPY_FINISH_MS,
  theStartAndTheKey,
  startHiddenProgram,
}
