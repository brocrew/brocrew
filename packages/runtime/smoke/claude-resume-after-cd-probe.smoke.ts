import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  startLoopback,
  until,
  type LoopbackRuntime,
  type ScriptedReply,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **715 · R64 — does a later `system/init` report where the MODEL `cd`'d to?**
 *
 * ## ⛔ Why
 *
 * A resumed Claude session can run `cd …/brobot-workspace/findings && ls`, then fail its next
 * turn because a later init names the changed cwd. `validateInitRef` must distinguish that
 * update from an initial resume mismatch. This probe measures both provider facts through the
 * product’s `ClaudeRuntime`, at $0.
 *
 * ## ⚑ The instrument — `695`'s loopback rig
 *
 * `loopback-claude.ts`: the SDK's bundled CLI, an owned `listen(0)` Messages endpoint, a managed
 * home provisioned by the product's own `provisionProviderHome` under this run's scratch, and the
 * literal token `probe-only`. The scripted model answers a turn carrying {@link MOVE} with one
 * `Bash` call — `cd sub && pwd` — and everything else with `ok`. ⚑ `approvalMode: 'auto'`, so the
 * call runs without a card; the product's own guard still sees it.
 *
 * ## 🔴 The arms — one rig per track (one home, one cwd), and on it TWO sessions
 *
 * | arm | how it opens | turns | the question |
 * |---|---|---|---|
 * | **fresh-cd** | `start` (the first session) | `cd sub`, plain | is there an init per turn, and does turn 2's name `sub`? |
 * | **resumed-plain** | `resume` it | plain, plain | ⚑ the control: a resume nobody moved survives both inits |
 * | **resumed-cd** | `resume` it | `cd sub`, plain | does a resumed session survive the later init after changing cwd? |
 * | **resumed-clear** | `resume` it | `/clear`, plain | a `/clear` BEFORE the first init — what does that init name? |
 * | **fresh-clear** | `start` (a second session) | plain, `/clear`, plain | after a `/clear`, which id does a later init name, beside `conversation_reset`'s? |
 * | **resumed-after-clear** | `resume` the ref the adapter holds after it (`199`'s: the reset's id; `721` · R75's: the later init's) | plain | does that ref reopen? |
 * | **resumed-at-the-later-init** | `resume` the id the later init named | plain | …and does that one? |
 *
 * ⚑ **Two tracks**: the SDK this repo pins, and — only when `BROBOT_PROBE_SDK_0_3_218` names that
 * SDK's `sdk.mjs` — 0.3.218 (CLI 2.1.218), for `fresh-cd`, `fresh-clear` and the two resumes after
 * it: *when did it start?*
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script, so nothing measured is about a
 * model: it is what the CLI REPORTS in its own init frames after its own Bash tool ran.
 *
 * ## ⚑ Measured
 *
 * See the 715 response; each run writes `715-claude-resume-after-cd/<arm>.json`.
 *
 * Run: `pnpm run probe:claude-resume-after-cd`. Not part of `pnpm run ci`.
 */

/** The words that make the scripted model `cd` into {@link SUB}. */
const MOVE = '715 · move into the subfolder'
const SUB = 'sub'
/** The prefix of every `Bash` call the script makes — how an answer is told to be one of ours. */
const TOOL_ID = 'toolu_715_'

/**
 * ⚑ `reopens` names WHICH ref a resume is handed: the first session's (`the-session`), the ref the
 * adapter holds after `fresh-clear` (`the-reset`, `199`'s), or the id that session's LATER init
 * named (`the-later-init`).
 */
const ARMS = {
  'fresh-cd': { opens: 'start', turns: [MOVE, '715 · after the move'] },
  'resumed-plain': {
    opens: 'resume',
    reopens: 'the-session',
    turns: ['715 · plain one', '715 · plain two'],
  },
  'resumed-cd': { opens: 'resume', reopens: 'the-session', turns: [MOVE, '715 · after the move'] },
  'resumed-clear': {
    opens: 'resume',
    reopens: 'the-session',
    turns: ['/clear', '715 · after the clear'],
  },
  // ⚑ A SECOND session, so the first one's resumes above are not disturbed: what id does a later
  // init carry after a `/clear`, beside the id `conversation_reset` named — and which of the two
  // reopens?
  'fresh-clear': {
    opens: 'start',
    turns: ['715 · before the clear', '/clear', '715 · after the clear'],
  },
  'resumed-after-clear': {
    opens: 'resume',
    reopens: 'the-reset',
    turns: ['715 · reopened at the reset'],
  },
  'resumed-at-the-later-init': {
    opens: 'resume',
    reopens: 'the-later-init',
    turns: ['715 · reopened at the later init'],
  },
} as const satisfies Record<
  string,
  {
    opens: 'start' | 'resume'
    reopens?: 'the-session' | 'the-reset' | 'the-later-init'
    turns: readonly string[]
  }
>
type ArmName = keyof typeof ARMS

/** ⚑ One SDK back, only the arms that answer *when did it start* — see the header. */
const PIN_ARMS = [
  'fresh-cd',
  'fresh-clear',
  'resumed-after-clear',
  'resumed-at-the-later-init',
] as const satisfies readonly ArmName[]

/** ⚑ Measured at 1–2 s a turn against the loopback; the bound is for a CLI that never answers. */
const TURN_MS = 30_000
const TEARDOWN_MS = 10_000
/** Every wait the run can make in turn: each arm's turns and its close, on both tracks. */
const WAITS = [...Object.keys(ARMS), ...PIN_ARMS].flatMap((label) => [
  ...ARMS[label as ArmName].turns.map(() => TURN_MS),
  TEARDOWN_MS,
])

const deadline = probeRunDeadline(
  '715 claude resume-after-cd probe',
  runBudgetMs(WAITS),
  TEARDOWN_MS,
)

/**
 * ⚑ **Does this request still owe a move?** — every {@link MOVE} the conversation has asked for,
 * against every `Bash` call of ours it has already answered.
 *
 * ⚠️ **Counted over the WHOLE request, never read off the last message's shape** — measured on this
 * probe's own first runs, three ways: the CLI carries an earlier `tool_result` in the same user
 * message as the next turn's words; it appends a `<system-reminder>` block after a `tool_result`;
 * and on a resumed session the `tool_result` lands AHEAD of the words it answers. Each shape rule
 * read one of those wrongly, and the last sent `Bash` in a loop until the turn's bound.
 */
function owesAMove(request: SeenRequest): { asked: string; owes: boolean } {
  const body = request.body as { messages?: { role?: string; content?: unknown }[] } | null
  let moves = 0
  let answered = 0
  let asked = ''
  for (const message of body?.messages ?? []) {
    if (message.role !== 'user') continue
    const blocks =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? (message.content as { type?: string; text?: string; tool_use_id?: string }[])
          : []
    for (const block of blocks) {
      if (block.type === 'text') {
        moves += (block.text ?? '').split(MOVE).length - 1
        asked = block.text ?? ''
      }
      if (block.type === 'tool_result' && (block.tool_use_id ?? '').startsWith(TOOL_ID)) {
        answered += 1
      }
    }
  }
  return { asked, owes: moves > answered }
}

/** Every answer the scripted model gave, in order — what each request looked like, and the reply. */
const decisions: { asked: string; owes: boolean; replied: ScriptedReply['kind'] }[] = []

function script(request: SeenRequest): ScriptedReply {
  const { asked, owes } = owesAMove(request)
  const reply: ScriptedReply = owes
    ? {
        kind: 'tool_use',
        id: `${TOOL_ID}${decisions.length}`,
        name: 'Bash',
        input: { command: `cd ${SUB} && pwd`, description: '715 move' },
      }
    : { kind: 'text', text: 'ok' }
  decisions.push({ asked: asked.slice(-160), owes, replied: reply.kind })
  return reply
}

interface InitSeen {
  readonly turn: number
  readonly sessionId: string
  readonly cwd: string
}

interface Arm {
  readonly label: ArmName
  readonly track: Track
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  /** Every `system/init` this arm's CLI sent, with the turn it arrived in (1-based). */
  readonly inits: InitSeen[]
  /** What the Bash tool printed for `pwd`, as the CLI handed it back. */
  readonly pwd: string[]
  readonly launchCwd: string
  readonly refBefore: SessionRef | null
  readonly refAfter: SessionRef | null
  readonly fatal: string[]
  readonly turnsEnded: string[]
  readonly failure: string | null
  /** ⚑ Rule 40 — the port each of THIS arm's model-bound requests arrived on. */
  readonly requests: (number | null)[]
  /** The session ids the provider home holds a transcript for, after the arm. */
  readonly transcripts: string[]
  /** Why the adapter refused to reopen the ref this arm was handed, or null. */
  readonly resumeRefused: string | null
  /** What the scripted model was asked during this arm, and what it answered. */
  readonly decisions: typeof decisions
  /** The arm's SDK frames, reduced to their type, subtype and identity fields. */
  readonly frames: Record<string, unknown>[]
}

type Track = 'current' | 'pin-0.3.218'

/** One session's worth of state per track — what each later arm reopens. */
interface TrackState {
  readonly rig: LoopbackRuntime
  readonly loopback: Awaited<ReturnType<typeof startLoopback>>
  readonly refs: Partial<Record<'the-session' | 'the-reset' | 'the-later-init', SessionRef>>
}

const captured: Arm[] = []
/** The arms whose every check above held — a root is deleted only when all of them did. */
const held = new Set<string>()
const tracks: Partial<Record<Track, TrackState>> = {}

/** Every `<id>.jsonl` under the home's `projects/` — the transcripts a resume can find. */
function transcriptsIn(providerHome: string): string[] {
  const projects = join(providerHome, 'projects')
  if (!existsSync(projects)) return []
  return readdirSync(projects).flatMap((folder) =>
    readdirSync(join(projects, folder)).flatMap((file) =>
      file.endsWith('.jsonl') ? [file.slice(0, -'.jsonl'.length)] : [],
    ),
  )
}

function initsOf(frames: readonly SDKMessage[]): { sessionId: string; cwd: string }[] {
  return frames.flatMap((frame) => {
    const f = frame as { type?: string; subtype?: string; session_id?: string; cwd?: string }
    return f.type === 'system' && f.subtype === 'init'
      ? [{ sessionId: f.session_id ?? '', cwd: f.cwd ?? '' }]
      : []
  })
}

function pwdOf(frames: readonly SDKMessage[]): string[] {
  return frames.flatMap((frame) => {
    const f = frame as {
      type?: string
      message?: { content?: { type?: string; content?: unknown }[] }
    }
    if (f.type !== 'user') return []
    return (f.message?.content ?? []).flatMap((block) =>
      block.type === 'tool_result' ? [JSON.stringify(block.content)] : [],
    )
  })
}

async function drive(label: ArmName, track: Track, state: TrackState): Promise<Arm> {
  const { rig, loopback } = state
  const plan: {
    opens: 'start' | 'resume'
    reopens?: keyof TrackState['refs']
    turns: readonly string[]
  } = ARMS[label]
  const { opens, turns } = plan
  let handle: SessionHandle | null = null
  // ⛔ An expired deadline tears down the CLI child AND the loopback — no later arm will run.
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  const inits: InitSeen[] = []
  let failure: string | null = null
  let refBefore: SessionRef | null = null
  let resumeRefused: string | null = null
  const framesBefore = rig.recorded.frames.length
  const decisionsBefore = decisions.length
  const requestsBefore = loopback.requests.length
  // ⚑ Rule 40, per ARM (715's review): read off THIS launch's options, never an earlier arm's.
  rig.recorded.configuredPort = null
  try {
    const context = {
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'auto' as const,
    }
    const reopening = plan.reopens === undefined ? undefined : state.refs[plan.reopens]
    if (opens === 'resume') {
      if (reopening === undefined) throw new Error(`NOT PERFORMED — no ${plan.reopens} to resume`)
      refBefore = reopening
    }
    let opened: SessionHandle | null = null
    try {
      opened =
        opens === 'start'
          ? await rig.runtime.start({ cwd: rig.cwd, ...context })
          : await rig.runtime.resume(reopening!, context)
    } catch (error) {
      // ⚑ A resume the adapter REFUSED is a finding about the ref it was handed, not a probe that
      // could not run — recorded apart from `failure`, and no turn is sent.
      if (opens === 'start') throw error
      resumeRefused = error instanceof Error ? error.message : String(error)
    }
    handle = opened
    const live = opened
    if (live !== null) {
      void (async () => {
        for await (const event of live.events()) events.push(event)
      })()
    }
    for (const [index, words] of live === null ? [] : turns.entries()) {
      const ended = events.filter((one) => one.type === 'turn').length
      const seen = rig.recorded.frames.length
      await live!.send(words)
      await until(
        () =>
          events.filter((one) => one.type === 'turn').length > ended ||
          events.some((one) => one.type === 'error' && one.fatal),
        TURN_MS,
        `turn ${index + 1} to end`,
      )
      for (const one of initsOf(rig.recorded.frames.slice(seen)))
        inits.push({ turn: index + 1, ...one })
      if (events.some((one) => one.type === 'error' && one.fatal)) break
    }
    if (opens === 'start' && live !== null && live.ref !== null) {
      // ⚑ The first start is THE session; a later one (`fresh-clear`) leaves the ref the adapter
      // holds after its reset (`199`: the reset's id — no transcript; `721` · R75: the init after
      // it), and beside it the id its last init named.
      if (state.refs['the-session'] === undefined) state.refs['the-session'] = live.ref
      else {
        state.refs['the-reset'] = live.ref
        const last = inits.at(-1)
        if (last !== undefined)
          state.refs['the-later-init'] = { ...live.ref, sessionId: last.sessionId }
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    const refAfter = handle?.ref ?? null
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    release()
    const frames = rig.recorded.frames.slice(framesBefore)
    const arm: Arm = {
      label,
      track,
      transcripts: transcriptsIn(rig.providerHome),
      cli: announcedVersion(frames),
      listenedOn: loopback.port,
      configuredPort: rig.recorded.configuredPort,
      inits,
      pwd: pwdOf(frames),
      launchCwd: rig.cwd,
      refBefore,
      refAfter,
      fatal: events.flatMap((one) => (one.type === 'error' && one.fatal ? [one.message] : [])),
      turnsEnded: events.flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
      failure,
      requests: loopback.requests.slice(requestsBefore).map((one) => one.localPort ?? null),
      resumeRefused,
      decisions: decisions.slice(decisionsBefore),
      frames: frames.map((frame) => {
        const f = frame as Record<string, unknown>
        return Object.fromEntries(
          ['type', 'subtype', 'session_id', 'cwd', 'new_conversation_id', 'is_error', 'result']
            .filter((key) => f[key] !== undefined)
            .map((key) => [key, f[key]]),
        )
      }),
    }
    captured.push(arm)
    const evidence = runEvidence('715-claude-resume-after-cd')
    mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, `${track}.${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  }
  return captured.at(-1)!
}

async function sdkAt0_3_218(): Promise<typeof query | null> {
  const entry = process.env['BROBOT_PROBE_SDK_0_3_218']
  if (entry === undefined || entry === '') return null
  return ((await import(entry)) as { query: typeof query }).query
}

async function theTrack(track: Track): Promise<TrackState> {
  const held = tracks[track]
  if (held !== undefined) return held
  let sdkQuery: typeof query | undefined
  if (track === 'pin-0.3.218') {
    const older = await sdkAt0_3_218()
    if (older === null) throw new Error('NOT PERFORMED — no 0.3.218 SDK entry')
    sdkQuery = older
  }
  const loopback = await startLoopback(script)
  const rig = await loopbackRuntime({
    scratch: runScratch('claude-resume-after-cd'),
    label: track,
    port: loopback.port,
    maxRetries: 0,
    ...(sdkQuery === undefined ? {} : { sdkQuery }),
  })
  mkdirSync(join(rig.cwd, SUB), { recursive: true })
  const state: TrackState = { rig, loopback, refs: {} }
  tracks[track] = state
  return state
}

const PINNED = (process.env['BROBOT_PROBE_SDK_0_3_218'] ?? '') !== ''
const RUNS: { track: Track; label: ArmName }[] = [
  ...(Object.keys(ARMS) as ArmName[]).map((label) => ({ track: 'current' as const, label })),
  ...PIN_ARMS.map((label) => ({ track: 'pin-0.3.218' as const, label })),
]

// ⚑ The pinned arms are REGISTERED only when their SDK is named — never a green `it` that ran nothing.
for (const { track, label } of RUNS.filter((run) => run.track === 'current' || PINNED)) {
  it(
    `715 · ${track} · ${label}`,
    () =>
      deadline.within(`arm ${track} · ${label}`, async () => {
        deadline.refuse(`starting arm ${track} · ${label}`)
        const arm = await drive(label, track, await theTrack(track))
        // ⚑ A refused resume launched nothing, so there is no child to hold to rule 40 — the refusal
        // is the arm's finding, in the table.
        if (arm.resumeRefused !== null) {
          held.add(`${track} · ${label}`)
          return
        }
        // ⚑ Rule 40, per arm — the child was configured with the port this process listened on,
        // every request this arm made arrived on it, and an arm whose turn a MODEL answered made one.
        // ⚠️ `resumed-clear` may make none: its `/clear` is the CLI's own, and the barrier ends it.
        expect(arm.configuredPort).toBe(arm.listenedOn)
        expect(arm.requests.every((port) => port === arm.listenedOn)).toBe(true)
        if (arm.turnsEnded.includes('completed')) {
          expect(
            arm.requests.length,
            'a turn completed without reaching this loopback',
          ).toBeGreaterThan(0)
        }
        expect(arm.cli).not.toBeNull()
        // ⚑ The measurement is REPORTED — a fatal error is a finding here, never a probe failure;
        // only a probe that could not run is.
        expect(arm.failure, 'NOT PERFORMED').toBeNull()
        held.add(`${track} · ${label}`)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '715 · the table',
  () =>
    deadline.within('the table', async () => {
      try {
        const table = captured.map((arm) => {
          const scrub = (text: string): string => text.replaceAll(arm.launchCwd, '<launch>')
          return {
            track: arm.track,
            arm: arm.label,
            cli: arm.cli,
            inits: arm.inits.map((one) => ({
              turn: one.turn,
              sessionId: one.sessionId,
              cwd: scrub(one.cwd),
            })),
            pwd: arm.pwd.map(scrub),
            resets: arm.frames.flatMap((one) =>
              one['type'] === 'conversation_reset' ? [one['new_conversation_id']] : [],
            ),
            refBefore: arm.refBefore?.sessionId ?? null,
            refAfter: arm.refAfter?.sessionId ?? null,
            refAfterCwd: arm.refAfter === null ? null : scrub(arm.refAfter.cwd),
            transcripts: arm.transcripts,
            resumeRefused: arm.resumeRefused === null ? null : scrub(arm.resumeRefused),
            fatal: arm.fatal.map(scrub),
            turnsEnded: arm.turnsEnded,
          }
        })
        writeFileSync(
          runEvidence('715-claude-resume-after-cd.json'),
          `${JSON.stringify(table, null, 2)}\n`,
        )
        console.log('[715 · table]', JSON.stringify(table, null, 2))
        expect(captured.filter((one) => one.track === 'current').map((one) => one.label)).toEqual(
          Object.keys(ARMS),
        )
      } finally {
        for (const state of Object.values(tracks)) {
          await state.loopback.close()
          // ⚠️ Only a run whose every arm held deletes its roots; a failing one leaves them (`649` F6).
          if (captured.length > 0 && held.size === captured.length) {
            rmSync(state.rig.root, { recursive: true, force: true })
          }
        }
      }
    }),
  deadline.testTimeoutMs,
)
