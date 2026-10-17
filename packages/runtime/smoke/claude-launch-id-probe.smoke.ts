import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import { bounded } from './cancel-interrupt-reader'
import { launchIdVerdict, type LaunchArm, type LaunchSeen } from './claude-launch-id-evidence'
import {
  announcedVersion,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  startLoopback,
  until,
  type ScriptedReply,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **722 · R79 — does the bundled Claude CLI name a conversation by the id this app launched it
 * with, even when it is closed before `system/init` — and does the product then name it too?**
 *
 * ⚑ **Why it had to be measured** (the ruling: *"SDK 0.3.281's `options.sessionId` if it assigns the
 * id before the CLI runs; measure it"*). `717`'s step 10: the front door's conversation was closed
 * 29 ms after its send, before any init was read; its row kept no ref; the CLI still wrote its
 * transcript, 630 ms after the close was asked — and the next adoption scan listed it as a second
 * conversation. `722` makes `ClaudeRuntime.start` mint the id and pass it as `Options.sessionId`
 * (`--session-id`), and a close before init announce it when the CLI's transcript under it names a
 * working folder — carrying that recorded folder. This runs the pinned binaries to show it.
 *
 * | arm | the model | what is done |
 * |---|---|---|
 * | **finishes** | replies `ok` | the turn runs to its end |
 * | **closed-before-init** — the subject | holds the request; answers the reopen's turn | launched from a SYMLINKED folder; sent, then closed at once; then reopened by the ref the product announced, and one turn sent |
 * | **named-none** — the control | holds the request | the same, with `sessionId` taken out of the launch |
 * | **never-sent** | — | started and closed, nothing sent |
 *
 * 🔒 `loopback-claude.ts`'s recipe — no token, no spend, no personal provider state; ⛔ no Electron. *"This
 * captures what the provider put in its model-bound request, not a hosted model's obedience to the
 * text."* — the model is a script; what is measured is the CLI's naming and the product's announcing.
 * Run: `pnpm run probe:claude-launch-id`. Not part of `pnpm run ci`; its verdict logic is
 * (`packages/runtime/test/claude-launch-id-evidence.test.ts`).
 */

const WORDS: Readonly<Record<LaunchArm, string>> = {
  finishes: '722-launch-id finishes: say ok',
  'closed-before-init': '722-launch-id closed-before-init: hold',
  'named-none': '722-launch-id named-none: hold',
  'never-sent': '722-launch-id never-sent',
}

const ARMS = ['finishes', 'closed-before-init', 'named-none', 'never-sent'] as const

/** The subject's reopen: one turn under the announced ref, which the model answers. */
const REOPENED = '722-launch-id reopened: say ok'

/** ⚠️ Bounded, standing rule 13 — a stalled CLI is NOT PERFORMED, never waited on. */
const START_MS = 45_000
/** The finishing turn's own ending. */
const STEP_MS = 30_000
const TEARDOWN_MS = 15_000

/** Each arm's bounded waits, in the order it takes them — only the subject reopens. */
const WAITS: Readonly<Record<LaunchArm, readonly number[]>> = {
  finishes: [START_MS, START_MS, STEP_MS, TEARDOWN_MS],
  'closed-before-init': [START_MS, START_MS, TEARDOWN_MS, START_MS, START_MS, STEP_MS, TEARDOWN_MS],
  'named-none': [START_MS, START_MS, TEARDOWN_MS],
  'never-sent': [START_MS, TEARDOWN_MS],
}

const deadline = probeRunDeadline(
  '722 claude launch-id probe',
  runBudgetMs(ARMS.flatMap((arm) => WAITS[arm])),
  TEARDOWN_MS,
)

function reply(arm: LaunchArm): ScriptedReply {
  return arm === 'finishes' ? { kind: 'text', text: 'ok' } : { kind: 'hold' }
}

/** Whether a model-bound request carries `words` in ANY of its messages — the reopen's turn is not the first. */
function mentions(request: SeenRequest, words: string): boolean {
  return JSON.stringify((request.body as { messages?: unknown } | null)?.messages ?? []).includes(
    words,
  )
}

/**
 * The first working folder the CLI recorded in `<id>.jsonl`, wherever under `projects/` it filed it —
 * ⚠️ read HERE, off the file, never through the product's own reader: it is what the product's
 * announcement is checked against.
 */
function recordedCwdOf(providerHome: string, sessionId: string): string | null {
  const projects = join(providerHome, 'projects')
  if (!existsSync(projects)) return null
  for (const folder of readdirSync(projects)) {
    const path = join(projects, folder, `${sessionId}.jsonl`)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      try {
        const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd
        if (typeof cwd === 'string' && cwd !== '') return cwd
      } catch {
        // a line that is not a record
      }
    }
  }
  return null
}

/** Every `<id>.jsonl` under a Claude home's `projects/`, whatever folder name the CLI chose for it. */
function transcriptsIn(providerHome: string): string[] {
  const projects = join(providerHome, 'projects')
  if (!existsSync(projects)) return []
  return readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(join(projects, entry.name)))
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort()
}

interface Arm {
  readonly arm: LaunchArm
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  readonly failure: string | null
  readonly seen: LaunchSeen
  readonly stderr: string
}

const captured: Partial<Record<LaunchArm, Arm>> = {}

async function measure(arm: LaunchArm): Promise<Arm> {
  deadline.refuse(`arm ${arm}`)
  // ⚑ The reopen's request carries the held turn too, so it is routed by its OWN words first.
  const loopback = await startLoopback((request) =>
    mentions(request, REOPENED)
      ? { kind: 'text', text: 'ok' }
      : firstUserText(request).includes(WORDS[arm])
        ? reply(arm)
        : { kind: 'text', text: 'ok' },
  )
  let handle: SessionHandle | null = null
  let reopened: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    if (reopened !== null) await closeBounded(reopened, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  let failure: string | null = null
  let over = false
  let initBeforeClose: boolean | null = null
  let initId: string | null = null
  let transcripts: string[] = []
  let resumed: boolean | null = null
  let reopenEvents: RuntimeEvent[] = []
  let asked: string | null = null
  let cwdLaunched: string | null = null
  let cwdRecorded: string | null = null
  const inits = (): { session_id?: string }[] =>
    (rig?.recorded.frames ?? []).filter(
      (frame) =>
        (frame as { type?: string }).type === 'system' &&
        (frame as { subtype?: string }).subtype === 'init',
    ) as { session_id?: string }[]
  const announcement = (): Extract<RuntimeEvent, { type: 'session' }> | undefined =>
    events.find((one): one is Extract<RuntimeEvent, { type: 'session' }> => one.type === 'session')
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('claude-launch-id'),
      label: arm,
      port: loopback.port,
      // ⚑ The control, one fact apart: the same launch with no id of the product's own.
      ...(arm === 'named-none'
        ? {
            rewrite: (options: { sessionId?: string }) => {
              delete options.sessionId
            },
          }
        : {}),
    })
    // ⚑ The subject launches from a SYMLINK to the rig's folder: the CLI records the folder it
    // resolved, and the ref must carry that spelling for the reopen's init barrier to pass (the
    // `722` review). The plain folder is the same code path with the two spellings equal.
    if (arm === 'closed-before-init') {
      cwdLaunched = join(rig.root, 'linked-cwd')
      symlinkSync(rig.cwd, cwdLaunched)
    } else cwdLaunched = rig.cwd
    const starting = rig.runtime.start({
      cwd: cwdLaunched,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'ask',
    })
    // ⚠️ A start that answers after its bound is still closed — never a CLI left running.
    starting
      .then((late) => {
        handle = late
        if (over) void closeBounded(late, TEARDOWN_MS)
      })
      .catch(() => undefined)
    const started = await bounded('the CLI’s start', starting, START_MS)
    handle = started
    // ⚠️ Read NOW, off the launch's own options: the reopen below goes through the same factory, and
    // its options (a resume's, with no `sessionId`) replace these (722's first run read `null` here).
    asked = (rig.recorded.options as { sessionId?: string } | null)?.sessionId ?? null
    void (async () => {
      for await (const event of started.events()) events.push(event)
    })()
    if (arm === 'finishes') {
      await bounded('the turn’s send', started.send(WORDS[arm]), START_MS)
      await until(() => events.some((one) => one.type === 'turn'), STEP_MS, 'the turn’s end')
    } else if (arm !== 'never-sent') {
      await bounded('the turn’s send', started.send(WORDS[arm]), START_MS)
      // ⛔ The premise, read off the child at the moment of the close — never assumed.
      initBeforeClose = inits().length > 0
    }
    await closeBounded(started, TEARDOWN_MS)
    // ⛔ Read NOW, before any reopen adds its own frames: an init that landed while the interrupt
    // was acknowledged named the conversation by the ordinary path (the `722` review).
    initId = inits()[0]?.session_id ?? null
    transcripts = transcriptsIn(rig.providerHome)
    if (arm === 'closed-before-init' && asked !== null) {
      cwdRecorded = recordedCwdOf(rig.providerHome, asked)
    }
    // ⚑ The subject's last half: a reopen by the ref the product announced — the product's own
    // `resume` — and ONE TURN on it, so the CLI's `--resume` and the product's init barrier both run.
    // ⚠️ A handle alone proves only the preflight: `resume` returns before any init.
    const ref = announcement()?.ref
    if (arm === 'closed-before-init' && ref !== undefined) {
      const seen: RuntimeEvent[] = []
      reopenEvents = seen
      const reopening = rig.runtime.resume(ref, {
        providerHome: rig.providerHome,
        model: 'claude-haiku-4-5',
        approvalMode: 'ask',
      })
      // ⚠️ A reopen that answers after its bound is still closed, as the start is (the `722` review).
      reopening
        .then((late) => {
          reopened = late
          if (over) void closeBounded(late, TEARDOWN_MS)
        })
        .catch(() => undefined)
      try {
        const handle = await bounded('the reopen', reopening, START_MS)
        reopened = handle
        void (async () => {
          for await (const event of handle.events()) seen.push(event)
        })()
        await bounded('the reopen’s send', handle.send(REOPENED), START_MS)
        await until(
          () => seen.some((one) => one.type === 'turn' || (one.type === 'error' && one.fatal)),
          STEP_MS,
          'the reopen’s turn',
        )
        const under = seen.find(
          (one): one is Extract<RuntimeEvent, { type: 'session' }> =>
            one.type === 'session' && one.state === 'resumed',
        )?.ref
        resumed =
          under !== undefined &&
          under.sessionId === ref.sessionId &&
          under.cwd === ref.cwd &&
          seen.some((one) => one.type === 'turn' && one.state === 'completed') &&
          !seen.some((one) => one.type === 'error' && one.fatal)
      } catch (error) {
        // ⛔ A stall is NOT PERFORMED, never a refusal (rule 13; the `722` review): it goes to
        // `failure`, like every other bounded wait here, and never reads as the CLI having moved.
        if (error instanceof Error && error.message.startsWith('NOT PERFORMED')) throw error
        resumed = false
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    over = true
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    if (reopened !== null) await closeBounded(reopened, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const seen: LaunchSeen = {
    arm,
    asked,
    initId,
    initBeforeClose,
    transcripts,
    announced: announcement()?.ref.sessionId ?? null,
    announcedOn: announcement()?.state ?? null,
    resumed,
    cwdLaunched: arm === 'closed-before-init' ? cwdLaunched : null,
    cwdRecorded,
    cwdAnnounced: arm === 'closed-before-init' ? (announcement()?.ref.cwd ?? null) : null,
  }
  const measured: Arm = {
    arm,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    failure,
    seen,
    stderr: rig?.recorded.stderr ?? '',
  }
  captured[arm] = measured
  const evidence = runEvidence('claude-launch-id')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(
    join(evidence, `${arm}.json`),
    `${JSON.stringify({ ...measured, frames: rig?.recorded.frames ?? [], events, reopenEvents }, null, 1)}\n`,
  )
  // ⚠️ Only an arm that was measured deletes its root (`649` F6).
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  console.log(
    `[722 claude launch id · ${arm}]`,
    JSON.stringify({ cli: measured.cli, seen, failure }, null, 1),
  )
  return measured
}

for (const arm of ARMS) {
  it(
    `722 · ${arm}`,
    () =>
      deadline.within(`arm ${arm}`, async () => {
        const measured = await measure(arm)
        expect(measured.failure, measured.stderr).toBeNull()
        // ⚑ Rule 40: the child was configured with THIS port.
        expect(measured.configuredPort).toBe(measured.listenedOn)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '722 · R79 — a launch closed before init is named by the id it launched with, and only by that one',
  () =>
    deadline.within('the verdict', async () => {
      const arms = ARMS.map((arm) => captured[arm])
      expect(arms.every((one) => one !== undefined && one.failure === null)).toBe(true)
      const verdict = launchIdVerdict((arms as Arm[]).map((one) => one.seen))
      console.log('[722 claude launch id · verdict]', JSON.stringify(verdict))
      expect(verdict).toEqual({ verdict: 'names-its-own' })
    }),
  deadline.testTimeoutMs,
)
