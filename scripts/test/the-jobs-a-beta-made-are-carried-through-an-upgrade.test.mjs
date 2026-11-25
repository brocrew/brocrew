import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_CODE_VERSION,
  CLAUDE_FIXTURE_KEY,
  JOB_NOTICE,
  MANAGED_SETTINGS_PATH,
  conversationOf,
  dailyCron,
  jobIdIn,
  jobNoticesIn,
  minuteOf,
  namesTheJob,
  receiptsIn,
  stampingOf,
  startEvidence,
  toolResultText,
  anthropicEvents,
  claudeKeySeen,
  managedSettingsFor,
  offersTool,
  oneShotCron,
  sseOf,
  toolResultsIn,
  userTextsIn,
} from '../lib/scripted-claude.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('the scripted Claude model the runner’s Claude Code is sent to', () => {
  it('is named to Claude Code in its managed settings, on loopback, and nothing else is reached', () => {
    expect(managedSettingsFor(9360)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9360',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
      },
    })
    expect(() => managedSettingsFor(Number.NaN)).toThrow()
    expect(MANAGED_SETTINGS_PATH.mac).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    )
    expect(MANAGED_SETTINGS_PATH.windows).toBe(
      'C:\\Program Files\\ClaudeCode\\managed-settings.json',
    )
    const workflow = readFileSync(join(ROOT, '.github/workflows/upgrade-path.yml'), 'utf8')
    expect(workflow).toContain('node scripts/lib/scripted-claude.mjs version')
    expect(CLAUDE_CODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('answers only the fixture key, by either header Claude Code may send it in', () => {
    expect(claudeKeySeen({ 'x-api-key': CLAUDE_FIXTURE_KEY })).toBe('expected')
    expect(claudeKeySeen({ authorization: `Bearer ${CLAUDE_FIXTURE_KEY}` })).toBe('expected')
    expect(claudeKeySeen({ 'x-api-key': 'sk-ant-another' })).toBe('other')
    expect(claudeKeySeen({})).toBe('none')
  })

  it('reads what a request already answered and what a person asked, wherever it sits', () => {
    const body = {
      tools: [{ name: 'CronCreate' }],
      messages: [
        { role: 'user', content: 'first words' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_a' }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' },
            { type: 'text', text: 'next words' },
          ],
        },
      ],
    }
    expect([...toolResultsIn(body)]).toEqual(['toolu_a'])
    expect(userTextsIn(body)).toEqual(['first words', 'next words'])
    expect(offersTool(body, 'CronCreate')).toBe(true)
    expect(offersTool(body, 'CronDelete')).toBe(false)
    expect([...toolResultsIn(null)]).toEqual([])
  })

  it('schedules a one-shot for a local minute, as CronCreate takes it', () => {
    expect(oneShotCron(new Date(2026, 9, 8, 17, 31))).toBe('31 17 8 10 *')
  })

  it('streams an answer or a tool call in the Messages API’s event order', () => {
    const text = anthropicEvents('m', { kind: 'text', text: 'hi' }, 'msg_1').map((one) => one.type)
    expect(text).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    const call = anthropicEvents(
      'm',
      { kind: 'tool_use', id: 'toolu_x', name: 'CronCreate', input: { cron: '1 2 3 4 *' } },
      'msg_2',
    )
    expect(call.at(-2).delta.stop_reason).toBe('tool_use')
    expect(call[2].delta.partial_json).toBe('{"cron":"1 2 3 4 *"}')
    expect(sseOf(call.slice(0, 1))).toMatch(/^event: message_start\ndata: \{.*\}\n\n$/)
  })
})

describe('what a conversation’s ledger holds of the words about its jobs', () => {
  const row = (ordinal, type, payload, session = 'sess_c') => ({
    session_id: session,
    ordinal,
    type,
    payload: JSON.stringify(payload),
  })
  const words = 'Your job at an unknown time runs at a time this app cannot tell, so …'

  it('reads the words held and said, and why each job of the app’s own level is not started', () => {
    const events = [
      row(3, 'user_turn', { text: words, authorship: { appNotice: JOB_NOTICE } }),
      row(1, 'scheduled_work', { source: 'hook/PostToolUse', receipt: {} }),
      row(2, 'message_queued', { text: words, authorship: { appNotice: JOB_NOTICE } }),
      row(4, 'scheduled_work', {
        source: 'app/receipts',
        jobs: [{ id: 'a', notStarted: 'time-not-known' }, { id: 'b' }],
      }),
      row(5, 'user_turn', { text: 'A person’s own words' }),
      row(
        1,
        'message_queued',
        { text: words, authorship: { appNotice: JOB_NOTICE } },
        'sess_other',
      ),
    ]
    expect(jobNoticesIn(events, 'sess_c')).toEqual({
      queued: [words],
      said: [words],
      appLevels: [['time-not-known', null]],
      appJobs: [
        { id: 'a', notStarted: 'time-not-known', nominalAt: null },
        { id: 'b', notStarted: null, nominalAt: null },
      ],
    })
  })

  it('counts a second start’s words as a second, so a double start cannot pass as one', () => {
    const told = { text: words, authorship: { appNotice: JOB_NOTICE } }
    const events = [
      row(1, 'message_queued', told),
      row(2, 'user_turn', told),
      row(3, 'user_turn', told),
    ]
    expect(jobNoticesIn(events, 'sess_c').said).toHaveLength(2)
  })

  it('reads nothing from a conversation it was not asked about, or from no rows', () => {
    expect(jobNoticesIn(undefined, 'sess_c')).toEqual({
      queued: [],
      said: [],
      appLevels: [],
      appJobs: [],
    })
  })
})

describe('the jobs a conversation made, as the beta recorded their scheduling calls', () => {
  const receipt = (ordinal, receipt, session = 'sess_c') => ({
    session_id: session,
    ordinal,
    type: 'scheduled_work',
    payload: JSON.stringify({ type: 'scheduled_work', receipt, source: 'hook/PostToolUse' }),
  })

  it('reads each call, the job its result names and the job it was asked about', () => {
    const events = [
      receipt(1, {
        toolUseId: 'toolu_a',
        tool: 'CronCreate',
        input: { cron: '1 2 * * *', recurring: true },
        result: { id: '3c5840ec', recurring: true, durable: false },
      }),
      receipt(2, {
        toolUseId: 'toolu_b',
        tool: 'CronDelete',
        input: { id: '3c5840ec' },
        result: { id: '3c5840ec' },
      }),
      receipt(3, { toolUseId: 'toolu_c', tool: 'CronDelete', input: { id: 'feedf00d' } }),
      { session_id: 'sess_c', ordinal: 4, type: 'scheduled_work', payload: '{"jobs":[]}' },
      receipt(
        5,
        { toolUseId: 'toolu_d', tool: 'CronCreate', result: { id: 'aaaaaaaa' } },
        'sess_other',
      ),
    ]
    expect(receiptsIn(events, 'sess_c')).toEqual([
      { toolUseId: 'toolu_a', action: 'create', job: '3c5840ec', asked: null, stamped: false },
      {
        toolUseId: 'toolu_b',
        action: 'cancel',
        job: '3c5840ec',
        asked: '3c5840ec',
        stamped: false,
      },
      { toolUseId: 'toolu_c', action: 'cancel', job: null, asked: 'feedf00d', stamped: false },
    ])
  })

  it('reads a beta that names what each call did the same as one that stored the tool', () => {
    const events = [
      receipt(1, { toolUseId: 'toolu_a', action: 'create', result: { id: '3c5840ec' } }),
      receipt(2, { toolUseId: 'toolu_b', action: 'cancel', input: { id: '3c5840ec' } }),
      receipt(3, { toolUseId: 'toolu_c', action: 'list', result: { jobs: [] } }),
    ]
    expect(receiptsIn(events, 'sess_c').map((one) => [one.toolUseId, one.action])).toEqual([
      ['toolu_a', 'create'],
      ['toolu_b', 'cancel'],
      ['toolu_c', 'list'],
    ])
  })

  it('reads a receipt that has an action field by it alone, as the app does', () => {
    const events = [
      receipt(1, { toolUseId: 'toolu_a', action: 'list', tool: 'CronCreate' }),
      receipt(2, { toolUseId: 'toolu_b', action: null, tool: 'CronCreate', result: { id: 'j' } }),
      receipt(3, { toolUseId: 'toolu_c', tool: 'constructor' }),
      receipt(4, { toolUseId: 'toolu_d', tool: ['CronCreate'], result: { id: 'k' } }),
      receipt(5, { toolUseId: 'toolu_e', tool: { toString: null } }),
    ]
    const read = receiptsIn(events, 'sess_c')
    expect(read.map((one) => [one.toolUseId, one.action])).toEqual([
      ['toolu_a', 'list'],
      ['toolu_b', null],
      ['toolu_c', null],
      ['toolu_d', null],
      ['toolu_e', null],
    ])
    expect(stampingOf(read)).toBe('none')
  })

  it('finds the id a call answered in its result, however the request carries it', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'Scheduled job 3c5840ec.' },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_b',
              content: [{ type: 'text', text: '{"id":"6a314a86"}' }],
            },
          ],
        },
      ],
    }
    expect(jobIdIn(toolResultText(body, 'toolu_a'))).toBe('3c5840ec')
    expect(jobIdIn(toolResultText(body, 'toolu_b'))).toBe('6a314a86')
    expect(toolResultText(body, 'toolu_c')).toBeNull()
    expect(jobIdIn('no id here')).toBeNull()
  })

  it('repeats a job daily at a local minute, as CronCreate takes it', () => {
    expect(dailyCron(new Date(2026, 9, 8, 17, 31))).toBe('31 17 * * *')
  })
})

describe('a beta that stamps the receipts of the jobs it makes, and one that does not', () => {
  const made = (stamp) => ({
    session_id: 'sess_c',
    ordinal: 1,
    type: 'scheduled_work',
    payload: JSON.stringify({
      type: 'scheduled_work',
      receipt: {
        toolUseId: 'toolu_a',
        tool: 'CronCreate',
        result: { id: 'aaaaaaaa' },
        ...(stamp === undefined ? {} : { stamp }),
      },
    }),
  })

  it('reads the stamp a build with the scheduling switch writes, and none from an earlier one', () => {
    const stamp = { calendar: 'Europe/Paris', version: '2026a' }
    expect(receiptsIn([made(stamp)], 'sess_c')[0]?.stamped).toBe(true)
    expect(receiptsIn([made(undefined)], 'sess_c')[0]?.stamped).toBe(false)
    expect(receiptsIn([made(null)], 'sess_c')[0]?.stamped).toBe(false)
  })

  it('tells the two kinds of beta apart by the jobs they made, and says when it cannot', () => {
    const one = (action, stamped) => ({ toolUseId: 't', action, job: 'j', asked: null, stamped })
    expect(stampingOf([one('create', true), one('create', true)])).toBe('stamped')
    expect(stampingOf([one('create', false), one('cancel', false)])).toBe('unstamped')
    expect(stampingOf([one('create', true), one('cancel', false)])).toBe('stamped')
    expect(stampingOf([one('create', true), one('create', false)])).toBe('mixed')
    expect(stampingOf([])).toBe('none')
  })

  it('places a moment in its minute', () => {
    expect(minuteOf(new Date(2026, 9, 9, 22, 41, 37, 500))).toBe(
      new Date(2026, 9, 9, 22, 41).getTime(),
    )
  })
})

describe('each start the candidate owes, told apart from the others', () => {
  const FIRST = 'Fictional Claude conversation: schedule three jobs and cancel one'
  const DUE = 'Fictional Claude conversation: schedule a job for a few minutes from now'
  const firsts = { claude: FIRST, due: DUE }
  const firstJobs = [
    'A fictional repeating job of the upgrade path',
    'A fictional job of the upgrade path',
  ]
  const dueJobs = ['A fictional job that comes due while the app is closed']
  const firstWords =
    'Your scheduled jobs (“A fictional repeating job of the upgrade path”) and (“A fictional job of the upgrade path”) run at times this app cannot tell, so once this conversation stops this app will not start it for those jobs.'
  const dueWords =
    'Your scheduled job (“A fictional job that comes due while the app is closed”) runs at a time this app cannot tell, so once this conversation stops this app will not start it for that job.'
  const dueStoppedWords =
    'Your scheduled job for 02:59 AM (“A fictional job that comes due while the app is closed”) was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.'
  const request = (id, of, notices, extra = {}) => ({
    id,
    stage: 'candidate-first',
    auth: 'expected',
    of,
    notices,
    ...extra,
  })
  const started = (conversation) => `runtime host: starting ${conversation} for its scheduled jobs`
  const waits = (conversation) =>
    `runtime host: ${conversation}'s start for its scheduled jobs waits until its saved claude key is saved again or removed: the key could not be read`
  const retried = (conversation) =>
    `runtime host could not start ${conversation} for its scheduled jobs, and tries again in 60000ms: refused`
  const evidence = (requests, log, conversation, of, prompts) =>
    startEvidence({ requests, log, stage: 'candidate-first', conversation, of, prompts })

  it('knows a request’s conversation by the first words it was asked, and says when it cannot', () => {
    expect(conversationOf(['Notice', FIRST], firsts)).toBe('claude')
    expect(conversationOf([DUE, 'more'], firsts)).toBe('due')
    expect(conversationOf(['A title request'], firsts)).toBeNull()
    expect(conversationOf([FIRST, DUE], firsts)).toBeNull()
  })

  it('attributes a uniquely named job when first words are missing or retained for several conversations', () => {
    const jobs = { claude: firstJobs, due: dueJobs }
    for (const texts of [[dueStoppedWords], [FIRST, DUE, dueStoppedWords]]) {
      const of = conversationOf(texts, firsts, jobs)
      expect(of).toBe('due')
      expect(
        evidence(
          [request('due-notice', of, [dueStoppedWords])],
          started('sess_due'),
          'sess_due',
          'due',
          dueJobs,
        ),
      ).toMatchObject({ started: 1, told: ['due-notice'], outcome: 'told' })
    }
  })

  it('keeps conflicting first words and ambiguous job ownership unattributed', () => {
    const jobs = { claude: firstJobs, due: dueJobs }
    expect(conversationOf([FIRST, dueWords], firsts, jobs)).toBeNull()
    expect(conversationOf([DUE, firstWords], firsts, jobs)).toBeNull()
    expect(conversationOf([firstWords, dueWords], firsts, jobs)).toBeNull()
    expect(conversationOf([dueWords], firsts, { claude: dueJobs, due: dueJobs })).toBeNull()
    expect(conversationOf(['An unrelated title'], firsts, jobs)).toBeNull()
    expect(conversationOf([dueJobs[0]], firsts, jobs)).toBeNull()
  })

  it('does not use a uniquely attributed notice from the second open, wrong key or wrong conversation', () => {
    const jobs = { claude: firstJobs, due: dueJobs }
    const of = conversationOf([dueWords], firsts, jobs)
    const requests = [
      request('second-open', of, [dueWords], { stage: 'candidate-second' }),
      request('wrong-key', of, [dueWords], { auth: 'other' }),
      request('wrong-conversation', conversationOf([firstWords], firsts, jobs), [firstWords]),
      request('ambiguous', conversationOf([firstWords, dueWords], firsts, jobs), [dueWords]),
    ]
    expect(evidence(requests, started('sess_due'), 'sess_due', 'due', dueJobs)).toMatchObject({
      started: 1,
      told: [],
      outcome: 'pending',
    })
  })

  it('retains duplicate starts and ledger notices so they cannot satisfy the once-only checks', () => {
    const of = conversationOf([dueStoppedWords], firsts, { due: dueJobs })
    const twice = evidence(
      [request('due-notice', of, [dueStoppedWords])],
      [started('sess_due'), started('sess_due')].join('\n'),
      'sess_due',
      'due',
      dueJobs,
    )
    expect(twice).toMatchObject({ started: 2, outcome: 'told' })
    const row = (ordinal, type) => ({
      session_id: 'sess_due',
      ordinal,
      type,
      payload: JSON.stringify({ text: dueStoppedWords, authorship: { appNotice: JOB_NOTICE } }),
    })
    const once = [row(1, 'message_queued'), row(2, 'user_turn')]
    expect(jobNoticesIn(once, 'sess_due')).toMatchObject({
      queued: [dueStoppedWords],
      said: [dueStoppedWords],
    })
    const duplicated = jobNoticesIn(
      [...once, row(3, 'message_queued'), row(4, 'user_turn')],
      'sess_due',
    )
    expect(duplicated.queued).toHaveLength(2)
    expect(duplicated.said).toHaveLength(2)
  })

  it('reads a job as named only where its prompt stands in quotes, as the app’s words put it', () => {
    expect(namesTheJob(firstWords, firstJobs[1])).toBe(true)
    expect(namesTheJob('A fictional job of the upgrade path, unquoted', firstJobs[1])).toBe(false)
    expect(namesTheJob(firstWords, dueJobs[0])).toBe(false)
  })

  it('counts each conversation’s words as told to it alone, whichever start goes first', () => {
    const log = [started('sess_due'), started('sess_first')].join('\n')
    for (const requests of [
      [request('m1', 'due', [dueWords]), request('m2', 'claude', [firstWords])],
      [request('m1', 'claude', [firstWords]), request('m2', 'due', [dueWords])],
    ]) {
      const first = evidence(requests, log, 'sess_first', 'claude', firstJobs)
      const due = evidence(requests, log, 'sess_due', 'due', dueJobs)
      expect(first).toMatchObject({ outcome: 'told', started: 1, refused: false, retried: [] })
      expect(due).toMatchObject({ outcome: 'told', started: 1, refused: false, retried: [] })
      expect(first.told).toHaveLength(1)
      expect(due.told).toHaveLength(1)
      expect(first.told).not.toEqual(due.told)
    }
  })

  it('does not take one conversation’s words for another’s: the second start, still owed, is pending', () => {
    const requests = [request('m1', 'due', [dueWords])]
    const log = started('sess_due')
    expect(evidence(requests, log, 'sess_due', 'due', dueJobs).outcome).toBe('told')
    const first = evidence(requests, log, 'sess_first', 'claude', firstJobs)
    expect(first).toMatchObject({ outcome: 'pending', started: 0, told: [], refused: false })
  })

  it('does not count words that name only some of a conversation’s jobs, or reach it from elsewhere', () => {
    const some =
      'Your scheduled job (“A fictional job of the upgrade path”) runs at a time this app cannot tell.'
    const requests = [
      request('m1', 'claude', [some]),
      request('m2', 'claude', [firstWords], { stage: 'candidate-second' }),
      request('m3', 'claude', [firstWords], { auth: 'other' }),
      request('m4', null, [firstWords]),
    ]
    expect(evidence(requests, '', 'sess_first', 'claude', firstJobs).outcome).toBe('pending')
  })

  it('reads a start that waits for its unreadable key as refused, and a timed retry as one', () => {
    const refused = evidence(
      [],
      [started('sess_first'), waits('sess_first')].join('\n'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(refused).toMatchObject({ outcome: 'refused', started: 1, refused: true, retried: [] })
    const next = evidence([], waits('sess_due'), 'sess_due', 'due', dueJobs)
    expect(next).toMatchObject({ outcome: 'refused', started: 0, refused: true, retried: [] })
    const again = evidence(
      [],
      [started('sess_first'), retried('sess_first'), waits('sess_first')].join('\n'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(again.outcome).toBe('refused')
    expect(again.retried).toHaveLength(1)
    expect(evidence([], waits('sess_due'), 'sess_first', 'claude', firstJobs).outcome).toBe(
      'pending',
    )
  })

  it('reads words told and a wait for the key together as a start that cannot be', () => {
    const both = evidence(
      [request('m1', 'claude', [firstWords])],
      waits('sess_first'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(both.outcome).toBe('both')
  })
})
