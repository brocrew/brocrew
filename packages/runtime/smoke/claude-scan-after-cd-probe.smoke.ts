import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  startLoopback,
  until,
  type Loopback,
  type LoopbackRuntime,
  type ScriptedReply,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * # 🔴 721 · R77 — does the permission scan resolve a path from where the command will run?
 *
 * ⚑ **The ruling** (`715` F-6): *"If a relative path can reach a protected root from the folder the
 * model `cd`'d into, and the scan resolves it from the launch folder, that is a hole: the scan must
 * resolve from the CLI's current working folder … Measure first: a planted protected root, reached
 * by `../..` from a moved folder. If the scan already catches it, report that with the measurement
 * and change nothing."*
 *
 * ⚑ **`726` · R92 withdrew R77 and removed the scan.** The probe stays as the live measurement of
 * that removal: it still hands the adapter the planted root (untyped — the field is gone), which
 * the adapter refused under until `726` and reads nowhere since.
 *
 * ⚑ **The rig is the product's own `ClaudeRuntime` over the bundled CLI, against a loopback model**
 * (`loopback-claude.ts`, `$0`, no credential). The model is scripted: per arm, a list of tool calls,
 * then `done`. ⚑ `approvalMode: 'auto'`, so until `726` the ONLY thing of this app's between a tool
 * call and the disk was the scan this measures (it ran above the mode check).
 *
 * ## ⚑ The layout — production's shape, planted
 *
 * ```
 * <root>/userdata/                      ← the root protected until `726` (the app's own data)
 * <root>/userdata/brobot-workspace/     ← the launch cwd, the session's own until `726`
 * <root>/userdata/brobot-workspace/findings/   ← where the model `cd`s
 * <root>/userdata/provider-homes/planted/planted.txt   ← a marker, NEVER a credential
 * ```
 *
 * | arm | the model does | what it measures |
 * |---|---|---|
 * | **A · moved grep** | `cd findings`, then `Grep {path: '../../provider-homes'}` | the CLI resolves from `findings` (→ the protected root); does the scan? |
 * | **B · unmoved grep** (control) | the same `Grep`, no `cd` | the same string from the launch folder names somewhere else |
 * | **C · the root, named** (control) | `Grep {path: '../provider-homes'}`, no `cd` | the boundary itself refuses |
 * | **D · moved read** | `cd findings`, then `Read {file_path: '../../provider-homes/planted/planted.txt'}` | `Read`'s `file_path`, which the second door is handed absolute |
 * | **E · moved glob** | `cd findings`, then `Glob {path: '../../provider-homes'}` | Glob's `path`, like Grep's |
 * | **F · an ancestor** | `Grep {path: '../..'}`, no `cd` | a directory that CONTAINS the root — not R77's question, measured beside it |
 * | **G · a `~/` path** | `Grep {path: '~/<this run's scratch>/userdata/provider-homes'}`, no `cd` | does the CLI expand `~` where the scan reads a relative name? (`721`'s review; the path names only this probe's own scratch under the real home) |
 * | **H · a leading space** | `Grep {path: ' ../provider-homes'}`, no `cd` | does the CLI trim what the scan resolves verbatim? (`721`'s review) |
 * | **I · moved up into the root** | `cd ..` (the launch folder's parent IS the protected root), then `Grep {path: 'provider-homes'}` | does the CLI let the shell LEAVE the launch folder — the hook's `cwd` for the next call says — and is a search from there refused? (`721`'s second review) |
 *
 * ⚑ **Which door refused** is read off the doors themselves, never off the told text: the product's
 * hook is wrapped by an observer that records what it was handed and what it answered (its answer
 * unchanged), and the rig records every `canUseTool` ask by tool-use id.
 *
 * ⚠️ **Read off the CLI's own tool result, by the planted file's PATH** — never by the marker text:
 * the pattern the model sends is written into the session transcript, so a grep over a folder
 * holding a transcript would match its own pattern. The pattern is a regex whose own text does not
 * match (`PLANT[E]D`).
 *
 * ⛔ **Every wait is bounded** (standing rule 13), and the run too (`probe-run-deadline.ts`).
 *
 * Run: `pnpm run probe:claude-scan-after-cd`. Not part of `pnpm run ci`.
 */

const MARKER = 'BROBOT721-PLANTED-MARKER'
/** ⚠️ Matches {@link MARKER}; its own text does not, so a transcript holding it is no match. */
const PATTERN = 'BROBOT721-PLANT[E]D-MARKER'
const PLANTED = join('provider-homes', 'planted', 'planted.txt')
/** The prefix of every tool call the script makes — how an answer is told to be one of ours. */
const TOOL_ID = 'toolu_721_'

const MOVE = { name: 'Bash', input: { command: 'cd findings && pwd', description: '721 move' } }
/** ⚑ Arm I's move: OUT of the launch folder, into the protected root itself (`721`'s second review). */
const MOVE_UP = { name: 'Bash', input: { command: 'cd .. && pwd', description: '721 move up' } }

/**
 * ⚑ **What the product's `PreToolUse` hook was HANDED, per tool-use id** — recorded by wrapping the
 * hook (never changing its answer), so a refusal's door and the path it judged are read, not inferred.
 */
const hookSaw = new Map<
  string,
  { readonly cwd: unknown; readonly input: unknown; decision?: string }
>()

/** ⚑ G's path, built when the rig exists: `~/` then the protected root, relative to the real home. */
let tildePath = '~/(the rig is not built yet)'

const ARMS = {
  'A-moved-grep': {
    moves: true,
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: '../../provider-homes', output_mode: 'files_with_matches' },
    },
  },
  'B-unmoved-grep': {
    moves: false,
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: '../../provider-homes', output_mode: 'files_with_matches' },
    },
  },
  'C-the-root-named': {
    moves: false,
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: '../provider-homes', output_mode: 'files_with_matches' },
    },
  },
  'D-moved-read': {
    moves: true,
    probe: { name: 'Read', input: { file_path: '../../provider-homes/planted/planted.txt' } },
  },
  'E-moved-glob': {
    moves: true,
    probe: { name: 'Glob', input: { pattern: '**/planted.txt', path: '../../provider-homes' } },
  },
  'F-an-ancestor': {
    moves: false,
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: '../..', output_mode: 'files_with_matches' },
    },
  },
  'G-a-tilde-path': {
    moves: false,
    probe: {
      name: 'Grep',
      get input() {
        return { pattern: PATTERN, path: tildePath, output_mode: 'files_with_matches' }
      },
    },
  },
  'H-a-leading-space': {
    moves: false,
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: ' ../provider-homes', output_mode: 'files_with_matches' },
    },
  },
  'I-moved-up-into-the-root': {
    moves: true,
    move: MOVE_UP,
    movedTo: '..',
    probe: {
      name: 'Grep',
      input: { pattern: PATTERN, path: 'provider-homes', output_mode: 'files_with_matches' },
    },
  },
} as const
type ArmName = keyof typeof ARMS

/** ⚑ Measured at 1–3 s a turn against the loopback; the bound is for a CLI that never answers. */
const TURN_MS = 45_000
const TEARDOWN_MS = 10_000
const deadline = probeRunDeadline(
  '721 claude scan-after-cd probe',
  runBudgetMs(Object.keys(ARMS).flatMap(() => [TURN_MS, TEARDOWN_MS])),
  TEARDOWN_MS,
)

let current: ArmName = 'A-moved-grep'

/** The text of every `tool_result` of ours in a request, in order. */
function ourResults(request: SeenRequest): string[] {
  const body = request.body as { messages?: { role?: string; content?: unknown }[] } | null
  const out: string[] = []
  for (const message of body?.messages ?? []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as {
      type?: string
      tool_use_id?: string
      content?: unknown
    }[]) {
      if (block.type !== 'tool_result' || !(block.tool_use_id ?? '').startsWith(TOOL_ID)) continue
      out.push(typeof block.content === 'string' ? block.content : JSON.stringify(block.content))
    }
  }
  return out
}

/** ⚑ The scripted model: this arm's calls in order, counted by the answers already in the request. */
function script(request: SeenRequest): ScriptedReply {
  const arm = ARMS[current]
  const steps = arm.moves ? ['move' in arm ? arm.move : MOVE, arm.probe] : [arm.probe]
  const answered = ourResults(request).length
  const step = steps[answered]
  if (step === undefined) return { kind: 'text', text: '721 done' }
  return {
    kind: 'tool_use',
    id: `${TOOL_ID}${current}_${String(answered)}`,
    name: step.name,
    input: { ...step.input },
  }
}

interface Arm {
  readonly label: ArmName
  readonly cli: string | null
  /** What the `cd` answered — the premise of a moved arm. */
  readonly pwd: string | null
  /** What the CLI told the model the probe call returned. */
  readonly told: string | null
  /** ⚑ The verdict: the planted file reached, the scan's own refusal, or neither. */
  readonly outcome: 'reached' | 'refused' | 'not-reached' | 'NOT PERFORMED'
  /**
   * ⚑ For a refusal, which door said it — read off the doors themselves: the hook's own answer
   * (`deny`) and whether `canUseTool` was asked for the call at all.
   */
  readonly door: 'hook' | 'second door' | null
  /** ⚑ What the hook was handed for the probe call, and what it answered — or null: never ran. */
  readonly hookSaw: { readonly cwd: unknown; readonly input: unknown; decision?: string } | null
  /** ⚑ Whether the second door (`canUseTool`) was asked about the probe call. */
  readonly secondDoorAsked: boolean
  /**
   * ⚑ **`726` · what the CLI itself SUGGESTED when it asked** — the `suggestions` it handed
   * `canUseTool` for the probe call. With BroBot's own outside-folder ask gone (R92), an *"approve
   * for session"* on the CLI's card is scoped by these, so they are measured rather than assumed.
   */
  readonly suggestions: unknown
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
}

const captured: Arm[] = []

async function drive(
  label: ArmName,
  loopback: Loopback,
  rig: LoopbackRuntime,
  userdata: string,
  cwd: string,
): Promise<Arm> {
  current = label
  const before = loopback.requests.length
  rig.recorded.configuredPort = null
  const events: RuntimeEvent[] = []
  let handle: SessionHandle | null = null
  let failure: string | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
  })
  try {
    handle = await rig.runtime.start({
      cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'auto',
      // ⚑ **As the app handed it until `726`** — untyped, because R92 removed the field from the
      // contract: before `726` the adapter read it and refused under it (the RED side), and since
      // `726` nothing reads it at all, which is what this probe now measures.
      ...({ protectedRoots: [userdata] } as Record<string, unknown>),
    })
    const live = handle
    void (async () => {
      for await (const event of live.events()) events.push(event)
    })()
    await live.send('721 · run the scripted calls')
    await until(
      () => events.some((event) => event.type === 'turn'),
      TURN_MS,
      `arm ${label}'s turn to end`,
    )
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    release()
  }
  const mine = loopback.requests.slice(before)
  const results = mine.length === 0 ? [] : ourResults(mine[mine.length - 1] as SeenRequest)
  const moves = ARMS[label].moves
  const pwd = moves ? (results[0] ?? null) : null
  const told = results[moves ? 1 : 0] ?? null
  const probeId = `${TOOL_ID}${label}_${String(moves ? 1 : 0)}`
  const theAsk = rig.recorded.asks.find((one) => one.options['toolUseID'] === probeId)
  const asked = theAsk !== undefined
  // ⚑ Refused by the HOOK is read off its own answer; by the second door, off the call having been
  // asked and one of the scan's own sentences coming back (`721`'s second review: never the text
  // alone, and not only the "belongs to" sentence).
  const hookDenied = hookSaw.get(probeId)?.decision === 'deny'
  const theScansSentence =
    told !== null &&
    (told.includes('belongs to BroBot2 itself') || told.includes('could not be resolved'))
  const outcome: Arm['outcome'] =
    told === null
      ? 'NOT PERFORMED'
      : // ⚠️ The refusal FIRST: it quotes the path it refused, so a path match alone would call a
        // refusal a reach (this probe's own first run, arm D).
        hookDenied || (asked && theScansSentence)
        ? 'refused'
        : told.includes(PLANTED) || told.includes(MARKER)
          ? 'reached'
          : 'not-reached'
  return {
    label,
    cli: announcedVersion(rig.recorded.frames),
    pwd,
    told,
    outcome,
    door: outcome !== 'refused' ? null : hookDenied ? 'hook' : 'second door',
    hookSaw: hookSaw.get(probeId) ?? null,
    secondDoorAsked: asked,
    suggestions: theAsk?.options['suggestions'] ?? null,
    failure,
    listenedOn: loopback.port,
    configuredPort: rig.recorded.configuredPort,
  }
}

let rigState: { loopback: Loopback; rig: LoopbackRuntime; userdata: string; cwd: string } | null =
  null

async function theRig(): Promise<{
  loopback: Loopback
  rig: LoopbackRuntime
  userdata: string
  cwd: string
}> {
  if (rigState !== null) return rigState
  const loopback = await startLoopback(script)
  const rig = await loopbackRuntime({
    scratch: runScratch('claude-scan-after-cd'),
    label: 'scan',
    port: loopback.port,
    maxRetries: 0,
    // ⚑ An observer only: the product's own hook runs, with its own answer, on every call.
    rewrite: (options) => {
      const matcher = options.hooks?.PreToolUse?.[0]
      const theHook = matcher?.hooks[0]
      if (matcher === undefined || theHook === undefined) {
        throw new Error('NOT PERFORMED — the product installed no PreToolUse guard')
      }
      matcher.hooks[0] = async (input, toolUseId, context) => {
        const answer = await theHook(input, toolUseId, context)
        if (input.hook_event_name === 'PreToolUse') {
          const said = answer as {
            continue?: boolean
            hookSpecificOutput?: { permissionDecision?: string }
          }
          hookSaw.set(input.tool_use_id, {
            cwd: input.cwd,
            input: JSON.parse(JSON.stringify(input.tool_input)) as unknown,
            decision:
              said.hookSpecificOutput?.permissionDecision ??
              (said.continue === true ? 'continue' : 'other'),
          })
        }
        return answer
      }
    },
  })
  const userdata = join(rig.root, 'userdata')
  const cwd = join(userdata, 'brobot-workspace')
  mkdirSync(join(cwd, 'findings'), { recursive: true })
  mkdirSync(join(userdata, 'provider-homes', 'planted'), { recursive: true })
  writeFileSync(join(userdata, PLANTED), `${MARKER}\n`)
  // ⚑ G names ONLY this run's own scratch through `~` — never anything else of the real home.
  const home = homedir()
  const underHome = relative(home, join(userdata, 'provider-homes'))
  if (underHome.startsWith('..')) throw new Error('NOT PERFORMED — the scratch is not under $HOME')
  tildePath = `~/${underHome}`
  rigState = { loopback, rig, userdata, cwd }
  return rigState
}

for (const label of Object.keys(ARMS) as ArmName[]) {
  it(
    `721 · ${label}`,
    () =>
      deadline.within(`arm ${label}`, async () => {
        deadline.refuse(`starting arm ${label}`)
        const { loopback, rig, userdata, cwd } = await theRig()
        const arm = await drive(label, loopback, rig, userdata, cwd)
        captured.push(arm)
        // ⚑ Rule 40 — the child was configured with the port this process listened on.
        expect(arm.configuredPort).toBe(arm.listenedOn)
        expect(arm.failure, 'NOT PERFORMED').toBeNull()
        expect(arm.outcome, 'NOT PERFORMED — the probe call was never answered').not.toBe(
          'NOT PERFORMED',
        )
        // ⚑ A moved arm's PREMISE, read off the child: its `cd` really moved the shell — the first
        // line of what `pwd` printed IS the moved folder (a refusal or a shell error quoting the
        // command would contain "findings" too: 721's review).
        if (ARMS[label].moves) {
          const theArm = ARMS[label]
          const moved = resolve(cwd, 'movedTo' in theArm ? theArm.movedTo : 'findings')
          expect([moved, realpathSync(moved)]).toContain((arm.pwd ?? '').split('\n')[0]?.trim())
        }
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '721 · the table',
  () =>
    deadline.within('the table', async () => {
      try {
        const scrub = (text: string | null): string | null =>
          text === null || rigState === null ? text : text.replaceAll(rigState.rig.root, '<root>')
        const table = captured.map((arm) => ({
          arm: arm.label,
          cli: arm.cli,
          pwd: scrub(arm.pwd),
          outcome: arm.outcome,
          door: arm.door,
          secondDoorAsked: arm.secondDoorAsked,
          suggestions:
            rigState === null
              ? arm.suggestions
              : (JSON.parse(
                  JSON.stringify(arm.suggestions ?? null).replaceAll(rigState.rig.root, '<root>'),
                ) as unknown),
          hookSaw:
            arm.hookSaw === null || rigState === null
              ? null
              : (JSON.parse(
                  JSON.stringify(arm.hookSaw).replaceAll(rigState.rig.root, '<root>'),
                ) as unknown),
          told: scrub(arm.told)?.slice(0, 400) ?? null,
        }))
        writeFileSync(
          runEvidence('721-claude-scan-after-cd.json'),
          `${JSON.stringify(table, null, 2)}\n`,
        )
        console.log('[721 · table]', JSON.stringify(table, null, 2))
        expect(captured.map((one) => one.label)).toEqual(Object.keys(ARMS))
      } finally {
        if (rigState !== null) {
          await rigState.loopback.close()
          // ⚠️ Only a run whose every arm was answered deletes its root; a failing one leaves it.
          if (captured.every((one) => one.outcome !== 'NOT PERFORMED' && one.failure === null)) {
            rmSync(rigState.rig.root, { recursive: true, force: true })
          }
        }
      }
    }),
  deadline.testTimeoutMs,
)
