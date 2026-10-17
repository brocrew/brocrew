import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ **A gate outside the chain is a gate that rots** — the rule, once, derived (306).
 *
 * ## Why this file exists rather than a third copy of the same assertion
 *
 * ⚠️ `301` built `pnpm run fixture:check` — the instrument that proves a placeholder surface follows
 * a CHANGED fixture, HO-002 §5 acceptance #6 — and left it out of `ci`, because `241 M11`,
 * `271 M26` and `271 M27` between them pinned `build && window:check && quit:check"` as one
 * contiguous string and `301` was forbidden to touch another dispatch's table. ⛔ **So the
 * instrument written because a mechanism nobody exercised turned out to be broken was itself not
 * exercised by anything.**
 *
 * `306` put it in the chain and re-anchored the two rows. This file is the part that stops it
 * happening a fourth time: **`241 M10`, `271 M26` and `271 M27` all broke on the same spot** — each
 * anchored on text ending at the `ci` value's closing quote, which is the one place a new gate is
 * ever appended — and each time the repair was to re-state, per instrument, that it is in the chain.
 *
 * ⚑ **So the rule is stated once here and DERIVED**, over whatever gates `package.json` declares
 * today. A fourth instrument added tomorrow is covered without anybody remembering to add a test.
 *
 * ⚑ **D-016 deleted `fixture:check` and `scripts/fixture-follow-check.mjs`**: the demo seed it
 * followed into Home is gone, and so are Home and the project card it read. The instrument's own
 * "cannot quietly ask for less" block went with it; the rule below still derives every gate left.
 *
 * ## ⚠️ What this does NOT replace
 *
 * ⛔ **`one-app.test.ts` keeps its two per-instrument tests, and they overlap this one on purpose.**
 * They are the recorded killers of `241 M10`/`M11` and `271 M26`/`M27`, and a row's evidence was
 * taken against the assertions as they stood (`142`); each also pins constants inside its own
 * instrument that no general rule can know about. ⚠️ The two `toContain('pnpm run window:check')`
 * lines there really are this rule said a second time — named rather than left for a reader to
 * discover, since `169` §1 is that one rule in two places drifts.
 *
 * ⛔ **And the opt-out below is deliberately weak.** A gate may leave the chain by SAYING SO in its
 * own source, which means a mutation that removes `quit:check` from `ci` *and* writes the opt-out
 * sentence into the check survives this file. That is the honest bound: the rule catches drift and
 * tidying, not a deliberate, reviewable removal — which is what an opt-out is for.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')

const read = (relative: string): string => readFileSync(join(REPO, relative), 'utf8')

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const CI = pkg.scripts.ci ?? ''

/**
 * ⛔ **620 · the globs `pnpm` itself is configured with**, so a fourth workspace directory is in
 * this roster the day it exists and not the day somebody remembers.
 *
 * ⚠️ **The `packages:` block and nothing else** — `pnpm-workspace.yaml` also carries
 * `onlyBuiltDependencies`, whose entries are package NAMES rather than paths, and a scan of every
 * `- ` line in the file would read three of those as workspace directories.
 */
const WORKSPACE_GLOBS: string[] = (
  /^packages:\n((?:[ \t]+-.*\n)+)/m.exec(read('pnpm-workspace.yaml'))?.[1] ?? ''
)
  .split('\n')
  .map((line) => /^\s*-\s*'?([^'\s]+)'?/.exec(line)?.[1] ?? '')
  .filter((glob) => glob !== '')

/** The directories one glob names, as repo-relative paths that hold a manifest. */
const under = (glob: string): string[] => {
  if (basename(glob) !== '*') return existsSync(join(REPO, glob, 'package.json')) ? [glob] : []
  const base = dirname(glob)
  return readdirSync(join(REPO, base), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${base}/${entry.name}`)
    .filter((dir) => existsSync(join(REPO, dir, 'package.json')))
}

interface Manifest {
  /** The package name `pnpm --filter` addresses it by. */
  readonly name: string
  /** Repo-relative, `''` for the root manifest. */
  readonly dir: string
  readonly scripts: Record<string, string>
}

const manifestAt = (dir: string): Manifest => {
  const raw = JSON.parse(read(dir === '' ? 'package.json' : `${dir}/package.json`)) as {
    name?: string
    scripts?: Record<string, string>
  }
  return { name: raw.name ?? dir, dir, scripts: raw.scripts ?? {} }
}

const MANIFESTS: Manifest[] = [manifestAt(''), ...WORKSPACE_GLOBS.flatMap(under).map(manifestAt)]
const ROOT: Manifest = MANIFESTS[0] ?? manifestAt('')
const BY_NAME = new Map(MANIFESTS.map((manifest) => [manifest.name, manifest]))

/** One script a command delegates to: in the same package, in every package, or in a named one. */
interface Call {
  readonly scope: 'same' | 'all' | string
  readonly script: string
}

/**
 * ⚑ **Every delegation a script command can make**, read out of the command string.
 *
 * ⛔ **Three shapes and not one**, because the chain reaches `db:check` through the second of them:
 * `pnpm run X` stays in the manifest it was declared in, `pnpm -r X` fans out to all of them, and
 * `pnpm --filter <name> X` crosses into a package. ⚠️ A closure that knew only the first would call
 * `@brobot2/desktop`'s own `db:check` unreached while `ci` runs it on every gate.
 */
const callsIn = (command: string): Call[] => [
  ...[...command.matchAll(/pnpm\s+--filter[= ]\s*(\S+)\s+(?:run\s+)?([\w:.-]+)/g)].map((one) => ({
    scope: one[1] ?? '',
    script: one[2] ?? '',
  })),
  ...[...command.matchAll(/pnpm\s+(?:-r|--recursive)\s+(?:run\s+)?([\w:.-]+)/g)].map((one) => ({
    scope: 'all' as const,
    script: one[1] ?? '',
  })),
  ...[...command.matchAll(/(?:pnpm\s+run(?:-script)?|node\s+--run)\s+([\w:.-]+)/g)].map((one) => ({
    scope: 'same' as const,
    script: one[1] ?? '',
  })),
]

const targetsOf = (from: Manifest, call: Call): Manifest[] => {
  if (call.scope === 'same') return [from]
  if (call.scope === 'all') return MANIFESTS
  const named = BY_NAME.get(call.scope)
  return named === undefined ? [] : [named]
}

/**
 * 🔴 **Every `<package>:<script>` the `ci` chain reaches, however many delegations deep.**
 *
 * ⛔ **`CI.includes('pnpm run <name>')` was the old question and it can only ever answer about the
 * root manifest's own scripts.** ⚑ This one follows the chain instead, so a gate is covered when
 * `ci` REACHES it rather than when `ci` happens to spell it.
 */
const REACHED: ReadonlySet<string> = (() => {
  const seen = new Set<string>()
  const walk = (manifest: Manifest, script: string): void => {
    const key = `${manifest.name}:${script}`
    if (seen.has(key)) return
    const command = manifest.scripts[script]
    if (command === undefined) return
    seen.add(key)
    for (const call of callsIn(command)) {
      for (const target of targetsOf(manifest, call)) walk(target, call.script)
    }
  }
  walk(ROOT, 'ci')
  return seen
})()

/**
 * The sentence a gate writes in its own source to leave the chain on purpose.
 *
 * ⚠️ **In the instrument, not in a list here.** An allowlist in the test is a decision a reader of
 * the script never sees; `scripts/check-protocol.mjs` carries this line with its reason beside it
 * (*"it runs a live codex binary, which only exists on a darwin-arm64 install"*), which is where
 * somebody asking "why is this not in `ci`?" is actually looking.
 */
const SAYS_WHY_NOT = 'NOT part of `pnpm run ci`'

/**
 * What makes a script the BUILT app's instrument: it launches what `pnpm run build` produced.
 *
 * ⚑ This is `241 M11`'s defect stated for every gate at once — *"it runs BEFORE `build`, so it
 * launches whatever the last run left on disk"* — rather than per instrument, three times.
 */
const READS_THE_BUNDLE = 'out/main/index.js'

interface Gate {
  readonly manifest: Manifest
  readonly name: string
  readonly command: string
  /**
   * The file the command runs, repo-relative — `''` when the gate runs a THIRD-PARTY binary and
   * there is no source of ours to read.
   */
  readonly script: string
  /** `<package>:<script>` — what {@link REACHED} is keyed on. */
  readonly key: string
}

/**
 * 🔴 **620 · every declared gate, scoped by WHAT IT IS rather than by where its code sits.**
 *
 * ## ⛔ What this used to say, and what it cost
 *
 * ⚠️ It read the ROOT manifest's scripts, kept the `*:check` ones, and then **dropped every gate
 * whose command did not name a file under `scripts/`** — `.filter((gate) => gate.script !== '')`.
 * ⛔ **Two of the eight gates this repository declares were invisible to it**: `format:check`
 * (`prettier --check .`) and, in `apps/desktop`'s own manifest, `db:check` (`drizzle-kit check`).
 *
 * 🔴 **And `db:check` was the one gate that was actually outside the chain.** It has never been in
 * `pnpm run ci`; the rule written to catch exactly that (*"a gate outside the chain is a gate that
 * rots"*, 306) could not see it, so it went on passing while the thing it exists to prevent was
 * sitting in the tree. ⚠️ **It was found because a person remembered to look** — `618`'s journal,
 * by the PM, 2026-09-21 — **and a check that depends on somebody remembering is not a check.**
 *
 * ⛔ **This is `a-guard-scoped-by-where-things-live-today-expires-silently` (`HO-070` §2, standing
 * rule 27.1) for the fourth time in this project**, after `SideRail.vue` (449), `project-roster.ts`
 * (472) and `team-roster.ts` (568). ⚑ Its closing instruction is why this WIDENS rather than
 * adding `db:check` to a list: *"WIDEN it, do not patch the one file."*
 *
 * ## ⚑ So the roster is now two derivations, both from files the tooling itself reads
 *
 * ⚠️ **The MANIFESTS come from `pnpm-workspace.yaml`** and not from a list of directories here, and
 * **coverage comes from {@link REACHED}** and not from `CI.includes('pnpm run <name>')` — because a
 * gate in a package manifest is never spelled in the root chain and the old question could only
 * ever have answered *no* about it.
 *
 * ## ⚠️ And the opt-out narrows, deliberately
 *
 * ⛔ **A gate may still leave the chain by SAYING SO in its own source** — but a gate with no source
 * of ours has nowhere to say it, so it must be reached. ⚑ That is not a new burden: it applies to
 * exactly the two gates above, both of which `ci` now runs.
 */
const GATES: Gate[] = MANIFESTS.flatMap((manifest) =>
  Object.entries(manifest.scripts)
    .filter(([name]) => name.endsWith(':check'))
    .map(([name, command]) => ({
      manifest,
      name,
      command,
      script: /(?:^|\s)(scripts\/[\w./-]+\.(?:mjs|js|py))(?:\s|$)/.exec(command)?.[1] ?? '',
      key: `${manifest.name}:${name}`,
    })),
)

/** How a gate is named in a failure message: bare at the root, package-qualified anywhere else. */
const where = (gate: Gate): string =>
  gate.manifest.dir === '' ? gate.name : `${gate.manifest.name}'s ${gate.name}`

describe('every gate a person can run is a gate ci runs (306)', () => {
  it('⛔ …or its own source says why it is not', () => {
    const orphaned = GATES.filter(
      (gate) =>
        !REACHED.has(gate.key) && !(gate.script !== '' && read(gate.script).includes(SAYS_WHY_NOT)),
    ).map((gate) => `${where(gate)} (${gate.script === '' ? gate.command : gate.script})`)
    expect(
      orphaned,
      `these gates exist, pass when run by hand, and guard nothing — "a correct policy that ` +
        `nothing calls leaves the defect exactly where it was". Add "pnpm run <name>" to the ci ` +
        `chain, or write "${SAYS_WHY_NOT}" into the script with the reason beside it. ` +
        `⛔ A gate whose command is a third-party binary has no source of ours to write that ` +
        `sentence into, so it has no opt-out and must be in the chain.`,
    ).toEqual([])
  })

  it('🔴 an instrument that reads the built bundle runs AFTER the build (241 M11, once)', () => {
    const build = CI.indexOf('pnpm run build')
    expect(build, 'the ci chain no longer builds').toBeGreaterThan(-1)
    const tooEarly = GATES.filter((gate) => {
      if (!CI.includes(`pnpm run ${gate.name}`)) return false
      // ⚑ **620 · a gate with no source of ours cannot read the bundle**, and asking for one would
      // throw rather than answer.
      if (gate.script === '') return false
      if (!read(gate.script).includes(READS_THE_BUNDLE)) return false
      return CI.indexOf(`pnpm run ${gate.name}`) < build
    }).map((gate) => where(gate))
    expect(
      tooEarly,
      'a gate that launches the built app before `build` produces it reports a green about ' +
        'whatever the previous run left on disk.',
    ).toEqual([])
  })

  it('⚑ and the roster is real — the two rules above are about something (193)', () => {
    // Without this, a `GATES` that derived to `[]` would pass both assertions above over nothing.
    const names = GATES.map((gate) => gate.name)
    expect(names).toEqual(expect.arrayContaining(['window:check', 'quit:check', 'mutations:check']))
    // The two launchers, positively: each is in the chain AND reads the bundle, so both rules
    // ran a real comparison rather than skipping every candidate. ⚑ Three until D-016 deleted
    // `fixture:check` with the demo seed.
    for (const name of ['window:check', 'quit:check']) {
      const gate = GATES.find((candidate) => candidate.name === name)
      expect(gate, `${name} is no longer a declared gate`).toBeDefined()
      expect(CI).toContain(`pnpm run ${name}`)
      expect(read(gate?.script ?? ''), `${name} no longer launches the built app`).toContain(
        READS_THE_BUNDLE,
      )
    }
    // …and the opt-out branch is exercised by a real gate, not only by its absence.
    const optedOut = GATES.filter((gate) => !REACHED.has(gate.key))
    expect(optedOut.map((gate) => gate.name)).toContain('protocol:check')
    for (const gate of optedOut) expect(read(gate.script)).toContain(SAYS_WHY_NOT)
    // ⛔ **And the NEGATIVE half, which is the one that keeps the opt-out from widening.** Every
    // assertion above passes if `SAYS_WHY_NOT` is weakened to something common — `'ci'` occurs in
    // most files here — and then any gate at all could drop out of the chain silently. So the
    // sentence is measured against a script that must NOT satisfy it: `census.py` is a gate, is in
    // the chain, and says nothing about leaving it.
    expect(
      read('scripts/mutations/census.py').includes(SAYS_WHY_NOT),
      'the opt-out sentence now matches a script that never claimed it — it has stopped ' +
        'discriminating, and any gate could leave the chain by saying nothing in particular.',
    ).toBe(false)
  })

  /**
   * 🔴 **620 · the roster reaches PAST the two places the old one could not look.**
   *
   * ⛔ **Without this the widening is untested**, and every assertion above passes over exactly the
   * six gates the narrow shape already saw — `a-positive-assertion-must-differ-from-the-default`
   * at the level of a derivation rather than a value.
   *
   * ⚑ **Two plants and not one** (standing rule 12), because the old shape was blind in two
   * independent ways and closing one leaves the other: it read ONE manifest, and it kept only gates
   * whose command named a file under `scripts/`.
   */
  it('🔴 …and it sees a gate with no source of ours, and a gate in another manifest', () => {
    // ⚑ **PLANT 1 · a gate whose command is a third-party binary.** `format:check` is
    // `prettier --check .`; the old `.filter((gate) => gate.script !== '')` dropped it.
    const binaries = GATES.filter((gate) => gate.script === '')
    expect(
      binaries.map((gate) => gate.key),
      'every gate now names a file under scripts/ — the roster can no longer tell us whether it ' +
        'would still see one that does not, which is half of what 620 widened',
    ).not.toEqual([])
    for (const gate of binaries) expect(REACHED.has(gate.key), `${where(gate)}`).toBe(true)

    // ⚑ **PLANT 2 · a gate declared somewhere other than the root manifest**, reached only through
    // a delegation. ⛔ This is the one the old shape never loaded at all.
    const delegated = GATES.filter((gate) => gate.manifest.dir !== '')
    expect(
      delegated.map((gate) => gate.key),
      'no package manifest declares a gate any more — the transitive closure is unexercised',
    ).toContain('@brobot2/desktop:db:check')
    for (const gate of delegated) {
      expect(REACHED.has(gate.key), `${where(gate)} is declared and nothing in ci reaches it`).toBe(
        true,
      )
      // ⛔ **And the chain never spells what it RUNS**, which is why `CI.includes` had to go: the
      // root script reaching this gate is a `--filter` delegation, so the old question was keyed on
      // a bare name that two manifests can both declare and could not tell them apart.
      expect(
        CI,
        `${where(gate)} is spelled in the chain, so this is no longer the delegated case`,
      ).not.toContain(gate.command)
    }
    expect(callsIn(pkg.scripts['db:check'] ?? '')).toEqual([
      { scope: '@brobot2/desktop', script: 'db:check' },
    ])

    // ⚑ **The closure is a real walk, not a set of the strings `ci` happens to contain.**
    // `@brobot2/desktop:typecheck` is reached through `pnpm -r typecheck`, two hops from `ci`.
    expect(REACHED.has('brobot2:ci')).toBe(true)
    expect(REACHED.has('@brobot2/desktop:typecheck')).toBe(true)
    // …and it is not simply everything: a script nothing in the chain calls is absent.
    expect(REACHED.has('brobot2:clean-base')).toBe(false)
    expect(REACHED.has('@brobot2/desktop:package')).toBe(false)

    // ⛔ **The manifests are the workspace's own**, so the roster cannot quietly shrink to one file.
    expect(MANIFESTS.length).toBeGreaterThan(3)
    expect(MANIFESTS.map((manifest) => manifest.name)).toContain('@brobot2/desktop')
    expect(WORKSPACE_GLOBS).toEqual(['apps/*', 'packages/*'])
  })

  /**
   * ⛔ **620 · `db:check` by name, because it is the row this dispatch exists for** — the general
   * rule above would stay green if it left the chain and some other gate took its place in the
   * roster.
   *
   * ⚠️ **What it guards is NOT what ordered it.** `drizzle-kit check` reads `meta/*_snapshot.json`
   * and never opens `meta/_journal.json`: measured on this tree, a journal whose last entry is
   * stamped at or below its predecessor leaves it printing *Everything's fine* and exiting `0`,
   * while `test/a-stamp-that-skips.test.ts` goes red in three places. 🔴 **The journal was already
   * guarded; the SNAPSHOT CHAIN was guarded by nothing** — and a `prevId` collision, which is what
   * two branches generating from one base leave behind (`532`/`533`), exits `1`.
   */
  it('⛔ …and `db:check` in particular is reached, from a manifest the root chain never names', () => {
    expect(pkg.scripts['db:check']).toBe('pnpm --filter @brobot2/desktop db:check')
    expect(CI).toContain('pnpm run db:check')
    // 🔴 **Before `test`**, so a two-second consistency check fails ahead of a two-minute suite.
    expect(CI.indexOf('pnpm run db:check')).toBeLessThan(CI.indexOf('pnpm run test'))
    expect(REACHED.has('brobot2:db:check')).toBe(true)
    expect(REACHED.has('@brobot2/desktop:db:check')).toBe(true)
    // ⚑ …and the thing it actually runs, so a delegation to a renamed script goes red here.
    const desktop = BY_NAME.get('@brobot2/desktop')
    expect(desktop?.scripts['db:check']).toBe('drizzle-kit check')
  })
})
