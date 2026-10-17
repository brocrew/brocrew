import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ⚑ **738 · R96's re-aim, held in `ci`** (`736` F-2). `ask` on Codex is the Codex CLI's default
 * preset — `workspace-write` + `on-request` — so a write inside the conversation's own folder, or a
 * temporary folder, runs with NO card. ⛔ Every live step whose subject is Codex ASKING about a write
 * therefore aims it outside both; before `738` four `ui-live-smoke` steps and three Codex
 * smokes/probes did not, and each went red — or, worse, green — about a working app.
 *
 * ⚠️ **What this can and cannot say.** These are pins of each step's SOURCE: that its target is built
 * outside the folder. Whether Codex then asks is a live fact, measured by `738`'s batch (§3.1d is
 * the pair, both sides on one session); `unasked-roots.test.mjs` holds the helper that decides
 * *outside*. ⛔ A step that moves its target back inside turns this red before a batch has to.
 *
 * ⚑ **Scoped by what the steps are ABOUT, not a list of lines** (standing rule 27.1) wherever the
 * source allows: every `apply_patch` the reopen-grant probe scripts, and every write `smoke:codex`'s
 * approval steps make, is derived from the file rather than named here.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(REPO, path), 'utf8')

/** The source of one `ui-live-smoke` step: from its title to the next step's `step(` call. */
function uiStep(source, title) {
  const at = source.indexOf(title)
  expect(at, `step "${title}" is not in ui-live-smoke.mjs`).toBeGreaterThan(-1)
  const next = source.indexOf('await step(', at + title.length)
  return source.slice(at, next === -1 ? undefined : next)
}

describe('738 · a Codex card step writes OUTSIDE the folder (R96)', () => {
  const ui = read('scripts/ui-live-smoke.mjs')

  it('⚑ the UI smoke’s helper refuses a folder `ask` writes unasked, by the shared census of it', () => {
    const at = ui.indexOf('function outsideWhatAskWrites(cwd, name) {')
    expect(at).toBeGreaterThan(-1)
    const body = ui.slice(at, ui.indexOf('\n}\n', at))
    expect(body).toContain('const unasked = writableUnasked(dir, cwd)')
    expect(body).toMatch(/if \(unasked !== null\) \{\s*throw new Error\(/)
    expect(ui).toContain("import { writableUnasked } from './lib/unasked-roots.mjs'")
  })

  it('⛔ step 18 — both writes outside, or its “no card on the next turn” holds under either mode', () => {
    const body = uiStep(ui, "'18 yolo, flipped mid-conversation")
    expect(body).toContain("const outside = outsideWhatAskWrites(cwd, 'yolo-outside')")
    expect(body).toContain("const first = join(outside, 'ask.txt')")
    expect(body).toContain("const second = join(outside, 'auto.txt')")
  })

  it('⛔ step 51 — the card nobody answers is raised by a write outside the folder', () => {
    const body = uiStep(ui, "'51 a question that outlived its turn")
    expect(body).toContain(
      "const cardTarget = join(outsideWhatAskWrites(cardCwd, 'expired-card-outside'), 'expire.txt')",
    )
    expect(body).toContain('`Create a file at the absolute path ${cardTarget} containing exactly `')
    expect(body).not.toContain("join(cardCwd, 'expire.txt')")
  })

  it('⛔ step 53 — each arm’s write is outside its folder, on both providers alike', () => {
    const body = uiStep(ui, "'53 a turn frozen on a card can be stopped")
    expect(body).toContain(
      "const target = join(outsideWhatAskWrites(cwd, `stop-094-${provider}-outside`), 'stop.txt')",
    )
    expect(body).toContain('`Create a file at the absolute path ${target} containing exactly OK `')
    expect(body).not.toContain("join(cwd, 'stop.txt')")
  })

  it('⛔ step 82 — a CODEX row’s file is outside the children’s folder, and is checked there', () => {
    expect(ui).toContain(
      "const matrixOutside = outsideWhatAskWrites(matrixCwd, 'permission-matrix-outside')",
    )
    expect(ui).toContain(
      "const targetRootFor = (provider) => (provider === 'codex' ? matrixOutside : matrixCwd)",
    )
    expect(ui).toContain('const caseDir = join(targetRootFor(provider), `${provider}-${outcome}`)')
    // ⚑ both reads of a row's request hold its paths to the root its file was aimed at
    const flat = ui.replace(/\s+/g, ' ')
    const calls = flat.split('requestSafelyNamesOnlyActionScope(').length - 1
    const ownedRoots = [
      ...flat.matchAll(
        /requestSafelyNamesOnlyActionScope\( ?(?:next\.)?request, matrixCwd, path, ([\w.]+(?:\(\w+\))?),? ?\)/g,
      ),
    ].map((match) => match[1])
    expect(calls).toBe(2) // ⚑ derived: every call there is, none of them the definition
    expect(ownedRoots).toEqual(['targetRootFor(provider)', 'targetRootFor(provider)'])
  })

  it('⛔ smoke:codex — every write an approval step makes is outside, but §3.1d’s one control', () => {
    const codex = read('packages/runtime/smoke/codex-live.smoke.ts')
    expect(codex).toContain("const outside = runScratch('codex-smoke-outside')")
    expect(codex).toMatch(
      /const unaskedRoot = writableUnasked\(outside, scratch\)\s*if \(unaskedRoot !== null\) \{\s*throw/,
    )
    // ⚑ derived: every file a step names by `join(<root>, '<name>.txt')`
    const targets = [...codex.matchAll(/const (\w+) = join\((scratch|outside), '([^']+\.txt)'\)/g)]
    const inside = targets.filter((match) => match[2] === 'scratch').map((match) => match[3])
    expect(inside).toEqual(['r96-inside.txt'])
    expect(targets.length).toBeGreaterThanOrEqual(11) // ⚠️ the positive control: the read finds them
    // ⚑ §3.1d, the pair: the inside write raises no card and lands; the outside one is asked
    expect(codex).toContain(
      'r1.approvals === 0 && existsSync(inside) && r2.approvals >= 1 && !existsSync(beyond)',
    )
    expect(codex).toContain("const yoloPath = join(outside, 'yolo.txt')")
  })

  it('⛔ probe:codex-approval-reason — `sandbox-denied` touches the arm’s outside folder', () => {
    const probe = read('packages/runtime/smoke/codex-approval-reason-probe.smoke.ts')
    expect(probe).toMatch(
      /if \(turn === 'sandbox-denied'\) \{\s*return \{\s*action: \{ kind: 'exec', args: \{ cmd: `\/usr\/bin\/touch \$\{join\(outside, `\$\{turn\}\.txt`\)\}` \} \},/,
    )
  })

  it('⛔ probe:codex-reopen-grant — every scripted patch is outside the arm’s cwd', () => {
    const probe = read('packages/runtime/smoke/codex-reopen-grant-probe.smoke.ts')
    // ⚑ derived: every file a scripted `apply_patch` adds or updates
    const patched = [...probe.matchAll(/patch(?:Add|Update)\(join\((\w+), '([^']+)'\)/g)]
    expect(patched.length).toBe(6)
    expect(patched.map((match) => match[1])).toEqual(Array(6).fill('outside'))
    expect(probe).toContain("writeFileSync(join(outside, 'p697.txt'), 'one\\n')")
    expect(probe).toContain("'p697.txt': read(outside, 'p697.txt')")
  })

  it('⛔ probe:codex-reopen-grant — a card that offers Codex’s kept rule says `always` (R95), in literals', () => {
    const probe = read('packages/runtime/smoke/codex-reopen-grant-probe.smoke.ts').replace(
      /\s+/g,
      ' ',
    )
    // ⚑ `738` measured all 19 of the run's command cards offering *Always allow*, where `697` and
    // `704` measured `once`; the probe holds both groups to it in literal values, never derived
    // from the same rule `persistenceOf` applies
    expect(probe).toContain(
      "expect(proposed.map((card) => card.persistence)).toEqual(proposed.map(() => 'always'))",
    )
    expect(probe).toContain(
      "expect(sweepCards.map((card) => card.persistence)).toEqual(sweepCards.map(() => 'always'))",
    )
    expect(probe).toContain('expect(sweepCards).toHaveLength(ARMS.sweep.turns.length)')
  })
})
