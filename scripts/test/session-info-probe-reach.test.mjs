import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **The cheap half of `session-info-probe.mjs`, decided where `ci` can reach it.**
 *
 * ## ⛔ Why a probe needs a test at all
 *
 * `session-info-probe.mjs` cannot run in `ci`: it launches Electron, spends a real Codex turn and
 * writes screenshots for a reader — evidence for a reader rather than a gate for a tree, a ruling
 * this file does not reopen. ⚠️ **But a live-only rig is dark by default** — 310 put an unreadable
 * hook into `smoke:ui` step 31, the step threw before its first assertion, and `pnpm run ci` stayed
 * green for two days because nothing in the tree read that file as text. The repair was not *"run
 * it more often"*; it was to move what can be decided without a window to where it is decided every
 * time. This is that move for the Info-panel probe.
 *
 * ## ⚑ What it is allowed to claim
 *
 * Nothing about whether the panel renders — only that the probe still **carries its isolation and
 * its refusals**. Those are the properties a rewrite silently drops: a hardcoded port, a userData
 * that is not a temporary one, an Electron spawn that inherits `ELECTRON_RUN_AS_NODE`, a teardown
 * that stops owning what it started, a marker check demoted to a `console.log`, a screenshot size
 * that drifts away from its own filename.
 *
 * ## ⚑ …and since 417, one fact about the APP as well
 *
 * The probe no longer plants the value it asks the model for: the new-conversation screen has no
 * folder field, the session runs in the app's own workspace, and the marker it looks for is
 * `WORKSPACE_CANARY` — read out of `workspace.ts` at run time rather than copied. That derivation
 * is live-only: a declaration the regex stops matching throws inside a run nobody does daily. ⛔
 * So the shape it depends on is pinned HERE, where it is decided every time — {@link WORKSPACE}
 * is read for that one purpose and for nothing else.
 *
 * ## ⚠️ It reads CODE, not prose
 *
 * A source census that reads the whole file answers questions out of the comments — a docblock
 * quoting the call it retired has already turned a `not.toContain` red in this repository. So the
 * comment lines are stripped first, {@link CODE} is what every negative below is asserted over,
 * and the stripper itself is checked in both directions before anything leans on it.
 */

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = join(SCRIPTS, 'session-info-probe.mjs')
const SOURCE = readFileSync(PROBE, 'utf8')

/** The app module the probe reads its marker out of — the other half of one coupling. */
const WORKSPACE = readFileSync(
  join(SCRIPTS, '..', 'apps/desktop/src/main/runtime/workspace.ts'),
  'utf8',
)

/** Every line that is not a comment line — see the docblock's last paragraph. */
const CODE_LINES = SOURCE.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
const CODE = CODE_LINES.join('\n')

/**
 * The text between two anchors.
 *
 * ⛔ **Sliced to the NEXT anchor rather than by a fixed width**, because a fixed-width slice after
 * a match borrows whatever the neighbouring case happens to say and then asserts about it.
 */
function between(from, to) {
  const start = SOURCE.indexOf(from)
  expect(start, `the probe no longer contains the anchor ${from}`).toBeGreaterThan(-1)
  const end = SOURCE.indexOf(to, start + from.length)
  expect(end, `the probe no longer contains the anchor ${to}`).toBeGreaterThan(-1)
  return SOURCE.slice(start, end)
}

describe('the file this census reads, and the stripper it reads it through', () => {
  it('is the probe, and it is not a stub', () => {
    // ⛔ The address, not the answer. Every negative below is satisfied by an empty file and by a
    // path typo, so the first claim has to be that there is something here to be read.
    expect(SOURCE).toContain('#!/usr/bin/env node')
    expect(SOURCE.length).toBeGreaterThan(10_000)
  })

  it('drops the comments and keeps the code — both directions, or it proves nothing', () => {
    // The positive: a line of real code survives.
    expect(CODE).toContain('const port = await freePort()')
    // The negative, and its pair: this sentence IS in the file, and it is NOT in what the negatives
    // below are asserted over. Without the first half the stripper could be deleting everything.
    expect(SOURCE).toContain('the group never existed')
    expect(CODE).not.toContain('the group never existed')
  })
})

describe('🔒 the port is one the probe opened itself', () => {
  it('takes a free port and hands that port to Electron', () => {
    expect(CODE).toContain('function freePort()')
    expect(CODE).toContain('const port = await freePort()')
    expect(CODE).toContain('--remote-debugging-port=${String(port)}')
  })

  it('names :9444 only where it is REFUSING it, and the check can tell the difference', () => {
    // ⚠️ The predicate is self-tested first. `[].every(…)` is `true`, so a census whose search shape
    // can never match anything reports a clean file — and a planted line is the cheapest way to
    // show it can match.
    const everyNineIsARefusal = (lines) =>
      lines
        .filter((line) => line.includes('9444'))
        .every((line) => /the default userData are the PM/.test(line))
    expect(everyNineIsARefusal(['const port = 9444'])).toBe(false)
    expect(
      everyNineIsARefusal([
        "`this process did not start — :9444 and the default userData are the PM's.`,",
      ]),
    ).toBe(true)

    // The digits ARE in the file — so the assertion that follows is about placement, not absence.
    expect(SOURCE).toContain('9444')
    expect(everyNineIsARefusal(CODE_LINES)).toBe(true)
  })
})

describe('🔒 the userData is a temporary directory the probe made', () => {
  it('mkdtemps it and passes it as --user-data-dir', () => {
    expect(CODE).toContain("const userDataDir = mkdtempSync(join(tmpdir(), 'b2-info-'))")
    expect(CODE).toContain('--user-data-dir=${userDataDir}')
    expect(CODE).toContain("import { tmpdir } from 'node:os'")
  })

  it('never reaches for a real one', () => {
    // The paired positive is the assertion above: the probe DOES name a userData directory, and the
    // one it names comes from `tmpdir()`. These are the two spellings of the PM's own.
    expect(CODE).not.toContain('homedir()')
    expect(CODE).not.toContain('Application Support')
    expect(CODE).not.toContain("app.getPath('userData')")
  })

  it('makes exactly ONE temporary tree, and removes it whichever way the run ends', () => {
    // ⚠️ In `stop()`, which both the failure path and the success path call — not at the foot of
    // `main()`, where a throw would step over it.
    const teardown = between('const stop = () => {', '  let cdp = null')
    expect(teardown).toContain('tearDownAndRemove({ lifecycle, directory: userDataDir })')
    // ⛔ **This used to assert a SECOND `rmSync`, for a scratch project directory the probe
    // planted an `AGENTS.md` in** (417 deleted the folder field that consumed it). The claim is
    // not dropped, it is re-pointed at what replaced it: there is one `mkdtemp`, the workspace the
    // session runs in is INSIDE it, and no identifier for a second directory survives anywhere —
    // which is what the several `rmSync(projectDir, …)` on the failure routes were for.
    expect(CODE.match(/mkdtempSync\(/g)).toHaveLength(1)
    expect(CODE).not.toContain('projectDir')
  })
})

describe('🔒 the Electron spawn', () => {
  /** ⚠️ Scoped to the spawn call, so a neighbouring line cannot satisfy these for it. */
  const spawnCall = () => between('const child = spawn(', '  child.stdout.on(')

  it('unsets ELECTRON_RUN_AS_NODE on the very call that launches the app', () => {
    const call = spawnCall()
    expect(call).toContain('ELECTRON_RUN_AS_NODE: undefined')
    expect(call).toContain('--user-data-dir=${userDataDir}')
    expect(call).toContain('detached: true')
  })

  it('does not hand the app this shell’s environment unchanged', () => {
    // The export is live in the PM's shell, so `env: process.env` is not a hypothetical: it boots
    // the binary as plain Node, which dies without ever opening the debugging port.
    expect(spawnCall()).not.toContain('env: process.env')
    expect(spawnCall()).toContain('env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }')
  })
})

describe('🔒 the app it drives is the app it started', () => {
  it('takes the owned-process lifecycle and the owned teardown from the repo', () => {
    expect(CODE).toContain("import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'")
    expect(CODE).toContain(
      "import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'",
    )
    expect(CODE).toContain('createOwnedProcessLifecycle({')
    expect(CODE).toContain('discoverDescendants: descendantsOf')
    expect(CODE).toContain('lifecycle.refreshDescendants()')
  })

  it('asserts the listening pid is one it owns, and REFUSES rather than logging', () => {
    const check = between('const owned = new Set(', '// ── the one door')
    expect(check).toContain('const listeners = listenersOn(port)')
    expect(check).toContain('!listeners.pids.every((pid) => owned.has(pid))')
    // Two refusals: one for a listener that is not ours, one for a question that could not be put.
    expect(check.match(/throw new Error\(/g)).toHaveLength(2)
    expect(check).toContain('if (!listeners.asked)')
    expect(check).not.toContain('console.log')
  })

  it('keeps lsof’s three answers apart, so "could not ask" is never read as "nobody"', () => {
    const lsof = between('function listenersOn(port) {', '/** One CDP connection')
    expect(lsof).toContain('if (error?.status === 1) return { asked: true, pids: [] }')
    expect(lsof).toContain('return { asked: false, pids: [], why:')
  })

  it('fails loudly when it cannot reap what it launched', () => {
    const foot = between('const outcome = stop()\n  if (!outcome.complete)', 'main().catch(')
    expect(foot).toContain('throw new Error(')
    expect(foot).toContain('A leaked Electron')
  })
})

describe('⛔ the instruction marker, and the refusal that makes the screenshot honest', () => {
  /**
   * ⚑ **The value is DERIVED, and this is the pair of claims that keeps that honest** (417).
   *
   * The probe used to plant `AGENTSMD-<tag>` in a file of its own, which was a value no model
   * could invent because no model had ever seen it. It now uses the app's `WORKSPACE_CANARY`,
   * which is the same property held by someone else: *"a token no model would produce
   * unprompted."* What has to be asserted is therefore not that a token exists but that the probe
   * **reads** it — and refuses rather than defaults when it cannot.
   */
  it('uses a probe-owned project file rather than the retired generated file', () => {
    expect(CODE).toContain("const CANARY = 'BROBOT-PROBE-PROJECT-98A7'")
    expect(CODE).toContain('writeFileSync(workspaceFile, `# Probe project instructions')
    expect(CODE).toContain('Instruction marker: ${CANARY}')
    expect(CODE).not.toContain("constantFrom('WORKSPACE_CANARY')")
    expect(SOURCE).not.toContain('BROBOT-WORKSPACE-CANARY')
    expect(WORKSPACE).toMatch(/export const WORKSPACE_DIRNAME = '[^']+'/)
    expect(WORKSPACE).toMatch(/export const CODEX_INSTRUCTIONS_FILE = '[^']+'/)
    const reader = between('function constantFrom(name) {', 'const CANARY =')
    expect(reader).toContain('if (!found) {')
    expect(reader).toContain('throw new Error(')
  })

  it('asks for the marker WITHOUT naming it, which is what makes a reply proof of a read', () => {
    const prompt = between('const PROMPT =', '/**')
    // The row, named — this is the half that makes the request answerable at all.
    expect(prompt).toMatch(/instruction marker/i)
    // ⛔ …and the value, never. Neither spelled out nor interpolated: a prompt carrying the canary
    // is answered by a model that read nothing, and the refusal below then passes on every run.
    // This is the property the docblock above `PROMPT` records, asserted rather than trusted.
    expect(prompt).not.toContain('CANARY')
    expect(prompt).not.toContain('${')
  })

  it('chooses NOTHING on the screen, so the session is the app’s own two defaults', () => {
    // ⛔ 417 deleted `provider-select` and `cwd-input` from the launcher, and this used to assert
    // that the planted directory was the one the session started in. The equivalent claim now is
    // a count: exactly one field is filled, and it is the message. The provider comes from
    // `RuntimeScreen.DEFAULT_PROVIDER` and the cwd from `resolveSessionCwd`'s blank branch — a
    // coupling the probe must not be able to lose silently by naming either of them again.
    expect(CODE).toContain("SET_VALUE('prompt-input', PROMPT)")
    expect(CODE.match(/cdp\.evaluate\(SET_VALUE\(/g)).toHaveLength(1)
    expect(CODE).not.toContain('provider-select')
    expect(CODE).not.toContain('cwd-input')
  })

  it('throws when the reply does not carry the marker, and does not merely say so', () => {
    const guard = between('if (!turn.text.includes(CANARY)) {', '// ── the panel')
    expect(guard).toContain('throw new Error(')
    expect(guard).toContain('never reached the model')
    // ⚠️ The paired negative: a `console.log` here would leave the probe taking the picture anyway,
    // which is the exact failure this guard exists to prevent.
    expect(guard).not.toContain('console.log')
    // And the same for a provider that refused to start at all — reported, never waited out.
    expect(CODE).toContain('if (turn.refused) {')
    expect(between('if (turn.refused) {', 'if (!turn.text.includes(CANARY))')).toContain(
      'throw new Error(',
    )
  })

  it('reads the panel through its own hook and prints it', () => {
    expect(CODE).toContain("document.querySelector('[data-cy=session-info]')")
    expect(CODE).toContain('const text = el.innerText')
    expect(CODE).toContain('console.log(panel.text)')
    expect(CODE).toContain('String(panel.chars)')
  })
})

describe('📸 the two sizes, and the filenames that must not be able to lie about them', () => {
  /** The shot table alone — sliced to the closing bracket, not to a guessed number of lines. */
  const table = () => between('const SHOTS = [', '\n]')

  it('is exactly 1440x1000 and 1200x808', () => {
    expect(table()).toContain("{ name: '1440x1000', width: 1440, height: 1000 }")
    expect(table()).toContain("{ name: '1200x808', width: 1200, height: 808 }")
    // The negative: two entries and no third one quietly riding along.
    expect(table().match(/width:/g)).toHaveLength(2)
    expect(table().match(/name:/g)).toHaveLength(2)
  })

  it('files each shot under the size it was actually rendered at', () => {
    expect(CODE).toContain('session-info-${LABEL}-${name}.png')
    // ⛔ The name and the numbers are two independent facts about one shot, so the probe checks
    // them against each other rather than trusting them to have been kept in step.
    expect(CODE).toContain('if (name !== `${String(width)}x${String(height)}`) {')
    expect(
      between('if (name !== `${String(width)}x${String(height)}`) {', 'written.push('),
    ).toContain('throw new Error(')
  })

  it('emulates the viewport at deviceScaleFactor 2 rather than resizing the window', () => {
    expect(CODE).toContain('Emulation.setDeviceMetricsOverride')
    expect(CODE).toContain('deviceScaleFactor: 2')
    expect(CODE).toContain('Emulation.clearDeviceMetricsOverride')
  })

  it('settles the layout and re-checks the panel BETWEEN the override and the capture', () => {
    // ⚠️ Ordering, not presence. A check that ran before the override — or after the PNG was
    // written — would be measuring a layout nobody photographed.
    const window = between('setDeviceMetricsOverride', 'Page.captureScreenshot')
    expect(window).toContain('setTimeout(resolve, LAYOUT_MS)')
    expect(window).toContain('if (verify) await verify(width, height)')
    expect(CODE).toContain('const LAYOUT_MS = 400')
    expect(CODE).toContain('async (w, h) => await assertPanelOnScreen(cdp, w, h)')
  })

  it('refuses a shot of a drawer that is not on the glass', () => {
    const guard = between('async function assertPanelOnScreen(', 'async function main()')
    expect(guard).toContain('if (!seen.present || !seen.onScreen) {')
    expect(guard).toContain('throw new Error(')
    // The reading behind `onScreen` is a laid-out box inside the viewport, not mere existence —
    // which is the only difference between a photograph of the panel and one of an empty pane.
    expect(CODE).toContain('const rect = el.getBoundingClientRect()')
    expect(CODE).toContain('rect.top < window.innerHeight')
  })
})

describe('the refusals a caller meets before anything is launched', () => {
  it('refuses an unbuilt tree and a missing --shot', () => {
    const preamble = between('async function main() {', 'const userDataDir =')
    expect(preamble).toContain('if (!existsSync(ENTRY)) {')
    expect(preamble).toContain('if (!SHOT_DIR) {')
    expect(preamble.match(/throw new Error\(/g).length).toBeGreaterThanOrEqual(3)
  })

  it('refuses a --label that is not a filename component', () => {
    // A label reaches `join(SHOT_DIR, …)`, so `../x` would write outside the directory the caller
    // named. The default is the harmless one.
    expect(CODE).toContain("const LABEL = arg('--label') ?? 'now'")
    expect(CODE).toContain('if (!/^[A-Za-z0-9._-]+$/.test(LABEL)) {')
  })
})
