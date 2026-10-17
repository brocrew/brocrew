import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type HookInput,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  describeHits,
  describeScan,
  pathsNaming,
  type Hit,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { claudeKeychainTokenProvider, claudeProjectDirName } from '../src/index'
import { SessionCrons } from '../src/claude/session-crons'
import type { ScheduledWorkEvent } from '../src/events'
import { buildChildEnv } from '../src/internal/child-env'
import { runEvidence, runScratch } from './run-paths'

/**
 * 253 · ⛔ **A promise nothing watches — the live capture.**
 *
 * `pnpm run probe:scheduled-work` compares the verbatim `Stop` hook’s `session_crons` payload
 * with the committed {@link SessionCrons} publication. A recurring promise must remain
 * visible after the tool call, including its session-only lifetime.
 *
 * ## ⛔ The rows, and two of them exist to refute something
 *
 * | row | what it settles |
 * |---|---|
 * | `cron` | a model reaches `CronCreate` unaided; the `Stop` hook carries the job; ⚑ a FIRE produces a second `Stop` with the SAME level, so the change-gate must publish once |
 * | `control · no cron` | ⛔ **the positive control** — the same launch, the same hooks, a turn that schedules nothing. `session_crons: []` here is what makes the row above readable as a fact rather than as an instrument that only ever fills in |
 * | `subagent` | ⚠️ `SubagentStopHookInput` carries the identical field and would narrow the blind window inside a long turn. Whether it reports the SESSION's set is a measurement, not a reading — `226` |
 * | `resumed` | 🔴 **the one that can falsify the design.** BroBot publishes `jobs: []` at `system/init` on the reasoning that crons die with the process. If a resumed session came back holding one, that emit would be erasing a live job |
 *
 * ⚠️ **One home and one cwd for all four rows, deliberately, against `250`'s own "one home per row"
 * rule.** The resumed row IS the cron row's session; it cannot be resumed from anywhere else. That
 * makes the control STRONGER rather than weaker: it schedules nothing while sharing a home with a
 * session that scheduled something, so `[]` is evidence that the level is per-process.
 *
 * 🔒 Throwaway `CLAUDE_CONFIG_DIR` and cwd under this run's scratch; the run FAILS if anything it
 * owns turns up in a personal home (`176`). No `Bash`, no filesystem tool, no `:9444`.
 */

/** The cron's own prompt. Short, harmless, and unmistakable in a transcript. */
const TICK = 'SCHED_253 tick'

/** How long to keep listening after the turn ends, so a `* * * * *` boundary is certain to pass. */
const OBSERVE_AFTER_TURN_MS = 100_000

/** A whole row's budget, so one wedged turn cannot eat the file's timeout and hide the others. */
const ROW_BUDGET_MS = 200_000

const CHEAP = 'claude-haiku-4-5-20251001'

/** Everything this probe will let a turn run. Nothing here touches the filesystem or the network. */
const ALLOWED = new Set(['CronCreate', 'CronDelete', 'CronList', 'Task', 'ToolSearch'])

/** What the model is asked to schedule. Named tools, because the question is whether it reaches them. */
const ASK_CRON =
  `Use the CronCreate tool to schedule a RECURRING job that runs every minute ` +
  `with the prompt "${TICK}". Then reply with the word SCHEDULED and nothing else.`
const ASK_NOTHING = 'Reply with the word READY and nothing else. Do not call any tool.'
const ASK_CRON_THEN_AGENT =
  `First use the CronCreate tool to schedule a RECURRING job that runs every minute ` +
  `with the prompt "${TICK}". Then use the Task tool to ask a general-purpose agent to reply ` +
  `with the word OK. Then reply with the word DONE.`
const ASK_RESUMED = 'Reply with the word BACK and nothing else. Do not call any tool.'

/** One hook callback firing, kept whole — the dispatch asks for the payload verbatim. */
interface HookHit {
  readonly atMs: number
  readonly event: string
  /** ⛔ The `session_crons` value as it arrived, `undefined` included. `null` = the hook has none. */
  readonly crons: unknown
  /** `UserPromptSubmit` only: who the provider says authored the prompt, and what it said. */
  readonly source?: unknown
  readonly prompt?: string
  /** Present only when the hook fired from inside a sub-agent — `BaseHookInput.agent_id`. */
  readonly agentId?: string
}

interface Frame {
  readonly atMs: number
  readonly type: string
  readonly subtype?: string
}

interface Row {
  readonly label: string
  readonly tools: readonly string[]
  readonly toolNames: readonly string[]
  readonly hooks: readonly HookHit[]
  readonly frames: readonly Frame[]
  /** ⛔ Every `system/init` on THIS stream — a fire produces a second one, which is the finding. */
  readonly inits: readonly { atMs: number; sessionId: string }[]
  readonly sessionId: string
  readonly turnEndedAtMs: number | null
  /** What BroBot publishes, from the COMMITTED {@link SessionCrons}, wired as the adapter wires it. */
  readonly published: readonly { atMs: number; event: ScheduledWorkEvent }[]
  readonly error: string | null
}

/**
 * The launch shape this app really uses, restated from `ClaudeRuntime` because it is private —
 * ⚠️ **including the hooks, which are the entire subject here.**
 *
 * Use `tools: ['preset:default','Grep','Glob']`, measured to deliver 34 tools. Whether a
 * model can reach `CronCreate` is meaningful only in the app’s actual vocabulary, rather than
 * the SDK default.
 */
function optionsFor(
  home: string,
  cwd: string,
  token: string,
  onHook: (hit: Omit<HookHit, 'atMs'>) => void,
  resume?: string,
): Options {
  const record = (input: HookInput): void => {
    const base = input as unknown as Record<string, unknown>
    onHook({
      event: input.hook_event_name,
      crons: base['session_crons'],
      ...(input.hook_event_name === 'UserPromptSubmit'
        ? { source: base['source'] ?? null, prompt: String(base['prompt'] ?? '') }
        : {}),
      ...(typeof base['agent_id'] === 'string' ? { agentId: base['agent_id'] } : {}),
    })
  }
  const watch = async (input: HookInput): Promise<{ continue: true }> => {
    record(input)
    return { continue: true }
  }
  return {
    model: CHEAP,
    cwd,
    tools: ['preset:default', 'Grep', 'Glob'],
    ...(resume ? { resume } : {}),
    // ⛔ **Allowed, not auto-approved.** `allowedTools` would bypass the callback (the SDK warns
    // `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`); this is the same door a real session goes through.
    canUseTool: (name: string, input: Record<string, unknown>) =>
      Promise.resolve(
        // ⚠️ `ToolSearch` is on the list because of what the FIRST run measured: the model reached
        // for it before `Task`, was refused, and settled for `TaskCreate` — the todo tool. `Task` is
        // DEFERRED in this vocabulary, so denying the lookup is denying the tool, and the sub-agent
        // row would have read as *"the model declined to delegate"* when it had been blocked.
        ALLOWED.has(name)
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: '253 probe: only the cron and agent tools' },
      ),
    // ⚠️ **All three, and `UserPromptSubmit` is here because a run that never opens a channel cannot
    // report that the channel is silent** — `250`'s own §1 correction, which is the reason its first
    // three runs got the answer wrong.
    hooks: {
      Stop: [{ hooks: [watch] }],
      SubagentStop: [{ hooks: [watch] }],
      UserPromptSubmit: [{ hooks: [watch] }],
    },
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
  }
}

/** One user message and then silence — a second turn would be a second bill and a second variable. */
function saysOnce(text: string): () => AsyncGenerator<SDKUserMessage> {
  return async function* () {
    yield {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
    } as unknown as SDKUserMessage
    await new Promise<void>(() => {})
  }
}

async function capture(
  label: string,
  prompt: string,
  home: string,
  cwd: string,
  token: string,
  observeAfterTurnMs: number,
  resume?: string,
): Promise<Row> {
  const started = Date.now()
  const hooks: HookHit[] = []
  const frames: Frame[] = []
  const toolNames: string[] = []
  let tools: string[] = []
  let sessionId = ''
  let turnEndedAtMs: number | null = null
  let error: string | null = null
  // ⛔ **The COMMITTED reader, wired the way the adapter wires it — one per SESSION.** `247`'s probe
  // got this wrong first: it minted a fresh correlator per frame, which could never have observed
  // its own fix. Here the whole point is that a second identical `Stop` publishes NOTHING, and one
  // instance is the only way to see that.
  const crons = new SessionCrons()
  const inits: { atMs: number; sessionId: string }[] = []
  const published: { atMs: number; event: ScheduledWorkEvent }[] = []
  const note = (raw: unknown, source: string): void => {
    const event = crons.observe(raw, source)
    if (event) published.push({ atMs: Date.now() - started, event })
  }
  const probe = query({
    prompt: saysOnce(prompt)(),
    options: optionsFor(
      home,
      cwd,
      token,
      (hit) => {
        hooks.push({ atMs: Date.now() - started, ...hit })
        // Only the main thread's `Stop` reaches the adapter — see `scheduleReaderHooks`.
        if (hit.event === 'Stop') note(hit.crons, 'hook/Stop')
      },
      resume,
    ),
  })
  // A manual iterator raced against a clock: a session waiting for a cron to fire says nothing for
  // a minute, and a `for await` would sit on `next()` until the file timeout (247's own defect).
  const stream = (probe as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]()
  const deadline = (ms: number): Promise<'quiet'> =>
    new Promise((resolve) => setTimeout(() => resolve('quiet'), ms).unref())
  try {
    for (;;) {
      const elapsed = Date.now() - started
      const budget =
        turnEndedAtMs === null
          ? ROW_BUDGET_MS - elapsed
          : Math.min(ROW_BUDGET_MS - elapsed, turnEndedAtMs + observeAfterTurnMs - elapsed)
      if (budget <= 0) break
      const next = await Promise.race([stream.next(), deadline(budget)])
      if (next === 'quiet' || next.done) break
      const message = next.value
      const atMs = Date.now() - started
      const subtype = (message as { subtype?: unknown }).subtype
      frames.push({
        atMs,
        type: message.type,
        ...(typeof subtype === 'string' ? { subtype } : {}),
      })
      if (message.type === 'system' && message.subtype === 'init') {
        // ⛔ **And the adapter does NOTHING here, which is the finding this row produced.** 253's
        // first draft emptied the level at `init`; this probe's first run showed a SECOND `init`
        // arriving on the same stream when the cron fired, so that emit blanked a live job for the
        // whole fired turn. The instrument has to be wired the way the thing it measures is (247),
        // and the thing it measures now has one input: the `Stop` hook.
        tools = tools.length > 0 ? tools : [...message.tools]
        sessionId = sessionId || message.session_id
        inits.push({ atMs, sessionId: message.session_id })
      }
      if (message.type === 'assistant' && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          const b = block as { type?: unknown; name?: unknown }
          if (b.type === 'tool_use' && typeof b.name === 'string') toolNames.push(b.name)
        }
      }
      if (message.type === 'result' && turnEndedAtMs === null) turnEndedAtMs = atMs
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    try {
      probe.close()
    } catch {
      /* a probe that cannot close cleanly is still a probe */
    }
  }
  return {
    label,
    tools,
    toolNames,
    hooks,
    frames,
    inits,
    sessionId,
    turnEndedAtMs,
    published,
    error,
  }
}

/** Every `Stop`-hook sighting, printed whole — the dispatch asks for the payload verbatim. */
function hookLines(row: Row): string[] {
  return row.hooks.map((hit) => {
    const who = hit.agentId ? ` agent_id=${hit.agentId}` : ''
    const src = hit.event === 'UserPromptSubmit' ? ` source=${JSON.stringify(hit.source)}` : ''
    const text =
      hit.prompt === undefined ? '' : ` prompt=${JSON.stringify(hit.prompt.slice(0, 80))}`
    return (
      `${String(hit.atMs).padStart(6)} ms · ${hit.event}${who}${src}${text}` +
      ` session_crons=${JSON.stringify(hit.crons)}`
    )
  })
}

/** What BroBot publishes, read out of the committed reader rather than restated. */
function publishedLines(row: Row): string[] {
  return row.published.map(({ atMs, event }) => {
    const level = event.jobs === undefined ? 'no level' : `${event.jobs.length} scheduled`
    const when = event.jobs?.map((job) => `${job.id}@${job.schedule ?? '?'}`).join(', ')
    const dropped = event.dropped ? ` · dropped=${event.dropped}` : ''
    return `${String(atMs).padStart(6)} ms · scheduled_work ${level}${when ? ` · ${when}` : ''}${dropped} · ${event.source}`
  })
}

/** The `Stop` sightings only — the channel the adapter actually reads. */
function stops(row: Row): readonly HookHit[] {
  return row.hooks.filter((hit) => hit.event === 'Stop')
}

it('253 · what a session promises to do later, and what BroBot now publishes — probe', async () => {
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const dir = runScratch('scheduled-work')
  rmSync(dir, { recursive: true, force: true })
  const home = join(dir, 'home')
  const cwd = join(dir, 'cwd')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  let rows: Row[]
  let markers: Marker[]
  let isolatedHits: Hit[]
  try {
    // ⛔ **Row 1 first and alone**, because rows 2–4 all read against what it created.
    const cron = await capture(
      'cron · asked',
      ASK_CRON,
      home,
      cwd,
      token as string,
      OBSERVE_AFTER_TURN_MS,
    )
    rows = [
      cron,
      // ⛔ The positive control. Same launch, same hooks, nothing scheduled.
      await capture('control · no cron', ASK_NOTHING, home, cwd, token as string, 5_000),
      // ⚠️ Does `SubagentStop` report the SESSION's set? A measurement, not a reading.
      await capture('subagent', ASK_CRON_THEN_AGENT, home, cwd, token as string, 5_000),
      // 🔴 The falsifier: does a cron survive into a resumed session?
      await capture(
        'resumed',
        ASK_RESUMED,
        home,
        cwd,
        token as string,
        5_000,
        cron.sessionId || undefined,
      ),
    ]
    markers = [
      ...rows
        .map((r) => r.sessionId)
        .filter(Boolean)
        .map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id })),
      { label: 'our cwd', value: claudeProjectDirName(realpathSync(cwd)) },
    ]
    isolatedHits = pathsNaming(home, markers).hits
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const report: string[] = ['=== 253 · a promise nothing watches ===', '']
  for (const row of rows) {
    report.push(
      `── ${row.label} ──`,
      `  error            : ${row.error ?? 'none'}`,
      `  session          : ${row.sessionId || '(none)'}`,
      `  tools            : ${row.tools.length}` +
        ` (CronCreate:${row.tools.includes('CronCreate')}` +
        ` CronDelete:${row.tools.includes('CronDelete')}` +
        ` CronList:${row.tools.includes('CronList')}` +
        ` ScheduleWakeup:${row.tools.includes('ScheduleWakeup')} Task:${row.tools.includes('Task')})`,
      `  tools called     : ${row.toolNames.join(', ') || 'none'}`,
      `  turn ended at    : ${row.turnEndedAtMs ?? 'never'} ms`,
      `  observed to      : ${row.frames[row.frames.length - 1]?.atMs ?? 0} ms`,
      // ⛔ The frame 253's first draft acted on. A SECOND one on the same stream is the whole
      // reason there is no `init` arm — and the same-`session_id` is what proves it is one process.
      `  system/init      : ${row.inits.map((i) => `${i.atMs}ms:${i.sessionId.slice(0, 8)}`).join(', ')}`,
      `  ⛔ hook payloads, verbatim:`,
      ...hookLines(row).map((line) => `    ${line}`),
      `  ⚑ what BroBot publishes:`,
      ...(publishedLines(row).length > 0
        ? publishedLines(row).map((line) => `    ${line}`)
        : ['    (nothing)']),
      '',
    )
  }

  const cron = rows[0] as Row
  const control = rows[1] as Row
  const subagent = rows[2] as Row
  const resumed = rows[3] as Row
  const subagentStops = subagent.hooks.filter((h) => h.event === 'SubagentStop')
  // 🔴 **EXACT equality, and `includes` was a real defect in this line.** The row's OWN prompt
  // contains `"SCHED_253 tick"` — it is the text being asked for — so a substring match reported
  // *"the fire arrived: YES"* on a run where nothing had fired yet. ⚠️ The time bound is the second
  // half: only a submission AFTER the turn ended can be a wake-up.
  const fires = cron.hooks.filter(
    (h) =>
      h.event === 'UserPromptSubmit' &&
      h.prompt === TICK &&
      h.atMs > (cron.turnEndedAtMs ?? Infinity),
  )
  const survived =
    Array.isArray(stops(resumed)[0]?.crons) && (stops(resumed)[0]?.crons as unknown[]).length > 0
  report.push(
    '── verdict ──',
    `  CronCreate reached unaided        : ${cron.toolNames.includes('CronCreate') ? 'YES' : 'no'}`,
    `  Stop hook stated the level        : ${stops(cron).length} time(s)`,
    `  the fire arrived                  : ${fires.length > 0 ? 'YES' : 'no'}` +
      // ⛔ Printed WITHOUT a `??` fallback, because `null` IS the finding — the one typed label a
      // fire could carry is unset for this account, which is why there is no `fired` field.
      `  (source=${fires.length > 0 ? JSON.stringify(fires[0]?.source) : 'n/a'})`,
    `  🔴 system/init frames, cron row   : ${cron.inits.length}` +
      `  (a FIRE re-announces init on the same stream)`,
    `  control's level                   : ${JSON.stringify(stops(control)[0]?.crons ?? 'no Stop')}`,
    `  SubagentStop sightings            : ${subagentStops.length}` +
      `  crons=${JSON.stringify(subagentStops.map((h) => h.crons))}`,
    `  🔴 a cron SURVIVED a resume       : ${survived ? 'YES' : 'no'}` +
      `  (the receipt says it dies with the process)`,
    `  …and FIRED in the resumed session : ${
      resumed.hooks.some((h) => h.event === 'UserPromptSubmit' && h.prompt === TICK) ? 'YES' : 'no'
    }`,
    `  events BroBot published, cron row : ${cron.published.length}`,
    '',
  )
  const text = report.join('\n')
  console.log(text)
  writeFileSync(runEvidence('253-scheduled-work.txt'), `${text}\n`)

  // ---- the instrument, before anything it reports ----
  for (const row of rows) {
    expect(row.error ?? 'none', `${row.label} launched`).toBe('none')
    expect(row.tools.length, `${row.label} reported its vocabulary`).toBeGreaterThan(0)
    expect(stops(row).length, `${row.label} ended a turn and the Stop hook fired`).toBeGreaterThan(
      0,
    )
  }

  // Assert every cron tool positively: the scheduled-job case requires the model to reach
  // each without help. An absence assertion over a name never present would prove nothing.
  expect(cron.tools, 'CronCreate is in the vocabulary this app launches with').toContain(
    'CronCreate',
  )
  expect(cron.tools, 'and the cancel the MODEL can call, since the host has none').toContain(
    'CronDelete',
  )
  expect(cron.tools, 'and the list').toContain('CronList')
  expect(cron.tools, 'and the one-shot wakeup, which lands in the same set').toContain(
    'ScheduleWakeup',
  )
  expect(cron.toolNames, '⛔ a model reaches CronCreate unaided').toContain('CronCreate')

  // ---- ⛔ the positive control, before the fact it makes readable ----
  //
  // ⚠️ `226`'s rule: absence in a capture is not absence. Without this row, a `session_crons` that
  // was always `[]` and a `session_crons` that never arrives would look identical.
  expect(
    stops(control)[0]?.crons,
    'the control ended a turn and the SAME field arrived, saying nothing is scheduled',
  ).toEqual([])
  expect(
    control.published.map((p) => p.event.jobs?.length),
    'so BroBot publishes exactly one empty level for it, and the PROVIDER is the one that said it',
  ).toEqual([0])
  expect(control.published[0]?.event.source, 'stated on the hook, not reasoned at init').toBe(
    'hook/Stop',
  )

  // ---- the fact ----
  const stated = stops(cron)[0]?.crons as Record<string, unknown>[] | undefined
  expect(Array.isArray(stated) ? stated.length : 0, 'the Stop hook carried the job').toBe(1)
  // ⚠️ `toContain` rather than equality on the prompt: what the model passes to `CronCreate` is the
  // model's wording, and `250`'s rule is that a probe may not hard-fail on a provider-owned choice.
  expect(String(stated?.[0]?.['prompt'] ?? ''), 'carrying the prompt it will submit').toContain(
    TICK,
  )
  expect(stated?.[0]?.['recurring'], 'and whether it repeats').toBe(true)
  expect(typeof stated?.[0]?.id, 'and it is identified').toBe('string')
  expect(typeof stated?.[0]?.schedule, 'and it says when').toBe('string')

  // ⛔ **What BroBot publishes, out of the committed reader.** ONE event: the job. Not a second for
  // the identical `Stop` after the fire — the change gate — and nothing at either `init`, which is
  // the correction this row forced.
  expect(
    cron.published.map((p) => p.event.jobs?.length),
    'the job, once, across a turn end AND a scheduled fire',
  ).toEqual([1])
  const level = cron.published[0]?.event
  expect(level?.source, 'and it is attributed to the channel it came from').toBe('hook/Stop')
  expect(level?.jobs?.[0]?.recurring, 'carrying what the provider said, unaltered').toBe(true)
  expect(
    level?.jobs?.[0]?.prompt ?? '',
    'including the prompt, to be SHOWN and never compared',
  ).toContain(TICK)
  expect(level?.jobs?.[0]?.id, 'and the id it was given').toBe(stated?.[0]?.id)

  // ---- 🔴 the falsifier, and it fired ----
  //
  // ⛔ **This row took 253's first design down, and the assertion is now the other way round.** That
  // draft emitted `jobs: []` at `system/init` on the reasoning `CronCreate`'s own receipt gives —
  // *"session-only (not written to disk, dies when Claude exits)"*. A resumed session reports the
  // SAME job back, so the emit was erasing a live one. ⚑ If a future pin really does drop crons on
  // resume, this line goes red and the design can be revisited with evidence rather than with a
  // receipt.
  expect(
    stops(resumed)[0]?.crons,
    '🔴 a resumed session STILL HOLDS its cron — the receipt does not mean what it reads like',
  ).toHaveLength(1)
  expect(
    resumed.published.map((p) => p.event.jobs?.length),
    'and BroBot says so, once, with nothing blanked in between',
  ).toEqual([1])
  // ⛔ **And it is RE-ARMED, not merely remembered.** Measured: the resumed process received the
  // cron's own prompt on `UserPromptSubmit` before its own turn had begun. Conditional because a
  // fire landing inside a short row is timing, not a contract.
  const resumedFires = resumed.hooks.filter(
    (h) => h.event === 'UserPromptSubmit' && h.prompt === TICK,
  )
  if (resumedFires.length > 0) {
    expect(
      resumedFires[0]?.source ?? null,
      'the resumed session actually FIRED the job, and the fire is unlabelled there too',
    ).toBeNull()
  }

  // ⛔ **The EXTRA `system/init`s, which are the other half of the same correction.** One process,
  // one `query()`, one `session_id` — every fire re-announces `init`, because the fire re-opens the
  // conversation from the CLI's point of view. ⚠️ `247` empties `background_work.running` on that
  // frame; a session holding a detached command AND a cron therefore loses its running-work
  // registry the moment the cron fires. Reported in 253's response; it is `247`/`248`'s event.
  //
  // ⚠️ **Bounded by the fires rather than counted, and the first draft of this line was `toBe(2)`** —
  // over-fitted to a run where the cron fired once. The next run fired twice inside the same window
  // and took the file red on a claim that was never about the number. The claim is the RELATIONSHIP:
  // one announcement at launch, and never more than one more per fire.
  expect(
    new Set(cron.inits.map((i) => i.sessionId)).size,
    'every init on this stream names one session, so it is one process and not a relaunch',
  ).toBe(1)
  if (fires.length > 0) {
    expect(
      cron.inits.length,
      'a scheduled fire re-announces init on the SAME stream',
    ).toBeGreaterThan(1)
    expect(
      cron.inits.length,
      '…and the extra announcements are the fires, not something else',
    ).toBeLessThanOrEqual(1 + fires.length)
  }

  // ---- ⛔ the fire, and why nothing is published for it ----
  //
  // ⚠️ **Conditional, because whether a fire lands inside the window is the provider's business** —
  // the model chooses the expression, and `250`'s rule is that a probe may not hard-fail on a
  // provider-owned decision. What IS asserted is the thing the design rests on: when a fire does
  // arrive, the one typed label that could identify it is not set. `sdk.d.ts` says why —
  // *"currently only set for Anthropic-internal sessions while the field is trialed; external
  // payloads omit it"* — and `250` measured the same thing.
  if (fires.length > 0) {
    expect(
      fires[0]?.source ?? null,
      '⛔ a scheduled fire arrives UNLABELLED, so a `fired` event could only be a correlation',
    ).toBeNull()
    expect(
      cron.published.length,
      '…and BroBot publishes nothing for it: the level did not change',
    ).toBe(1)
  } else {
    console.log('\n⚠️ no fire inside the window on this run — that claim is UNREACHED, not refuted')
  }

  // ---- ⚠️ reported, not asserted: what the capture says about the second reader ----
  //
  // `scheduleReaderHooks` installs `Stop` alone. `SubagentStopHookInput` carries the identical field
  // and would narrow the window in which a job created mid-turn is invisible — but whether it states
  // the SESSION's set is the provider's business, and a row that depends on a model choosing to
  // delegate cannot be a foundation (`250`'s rule, after its probe hard-failed on a provider-owned
  // decision). What this row does is put the answer in the evidence file either way.
  console.log(
    `\n── SubagentStop ──\n  sightings: ${subagentStops.length}` +
      `\n  crons    : ${JSON.stringify(subagentStops.map((h) => h.crons))}` +
      `\n  ⚠️ ${
        subagentStops.length === 0
          ? 'the model did not delegate on this run — the claim is UNREACHED, not refuted'
          : 'compare against the Stop payload above before installing a second reader'
      }`,
  )

  // ---- 🔒 isolation (176): positive first, then the negative it makes meaningful ----
  console.log(`\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}`)
  expect(
    new Set(isolatedHits.filter((h) => h.label.startsWith('session')).map((h) => h.label)).size,
    'every session this run created is named inside the isolated home',
  ).toBe(new Set(rows.map((r) => r.sessionId).filter(Boolean)).size)
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 900_000)
