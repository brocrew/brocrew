import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import rootConfig from '../../vitest.config.ts'
import gateOnlyConfig from '../../vitest.gate-only.config.ts'
import desktopConfig from '../../apps/desktop/vitest.config.ts'
import domConfig from '../../apps/desktop/vitest.dom.config.ts'
import probeConfig from '../../apps/desktop/vitest.probe.config.ts'
import smokeConfig from '../../vitest.smoke.config.ts'

/**
 * # ⛔ 706 · the tests that run `clean-base` run ONLY inside `pnpm run ci` (PM ruling, `702` F-1)
 *
 * ⚑ **Standing rule §6**: *"Never run `clean-base`, not even `--dry-run`"* — and *"`pnpm run ci` IS
 * PERMITTED, whole."* ⛔ **Measured before `706`**: two tests spawn `node scripts/clean-base.mjs`, and
 * a seat's ordinary run reached both — `apps/desktop/test/a-clean-base-leaves-no-profiles.test.ts`
 * under `--project desktop` (`698`, `703`, and `702`'s own pre-check), `scripts/test/clean-base.test.mjs`
 * under `--project scripts` and a bare `vitest run`. ⚑ They live in `gate-only/` now, reached only
 * by `vitest.gate-only.config.ts`, which `gate-only:check` runs and `ci` runs that.
 *
 * 🔴 **Both halves, and each derived rather than listed** (rule 27.1 — a guard scoped by where things
 * live today expires silently):
 *  1. **Nothing a seat's ordinary run reaches STARTS the script** — every directory every project in
 *     `vitest.config.ts`, `vitest.smoke.config.ts` and `apps/desktop/vitest.probe.config.ts` collects
 *     from is walked, and no file there starts it in a spelling this census knows (below).
 *  2. **The gate still runs them** — the gate-only config's own globs (and excludes) match exactly the
 *     files that do, and `ci` runs it. ⛔ Removing a test from the gate is not how a seat stops running it.
 *
 * ⚠️ **What "starts it" means here, and what it cannot see** (the `706` review, two rounds): a quoted
 * PATH to the script — `'<script>'`, `'scripts/<script>'`, `` `${SCRIPTS}/<script>` ``; the package
 * script as an argument, `['clean-base', …]`; or a process call (`execSync`, `spawnSync`, …) whose own
 * arguments name the script or `pnpm … clean-base`; or a COMMAND LINE that does, in any string — kept
 * in a variable, with flags before the name, under `npm` or `yarn`; or a shell or Python file in a
 * walked tree that runs it. ⛔ **Out of its reach, and not claimed**: a name assembled from pieces at
 * run time; a helper outside the walked trees that a test calls to do the starting; a file of any
 * other kind; and a line of code that happens to begin with `*` (read as prose). The script's name is
 * spelled in pieces here for the first reason, so this file never holds what it hunts for.
 *
 * ⚑ **717 · R45 · two shapes are NOT a start, and only these two** ({@link withoutWhatStartsNothing}):
 * a NAMED import of the library `scripts/lib/<script>` in a file that names none of the acts, and the
 * script's path inside a bare `readFileSync(`'s own arguments — its source, read as text. ⚠️ R45 moved
 * `clean-base`'s tests that never spawn it back into `scripts/test/`, and those two shapes are what
 * they hold. Every other way of naming the library or the script is still a start. ⛔ **Out of its
 * reach since then, and not claimed**: source that is read and then EVALUATED (`node -e` with the
 * text), and a planner pointed at a real directory — a plan is a READ of that directory, and this
 * census is about starts; standing rule §6, not this file, is what forbids reading his userData.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const NAME = ['clean', 'base'].join('-')
const SCRIPT = [NAME, 'mjs'].join('.')
/**
 * ⚑ **A string that IS a path to the script** — `'<script>'`, `'scripts/<script>'`,
 * `'../lib/<script>'`, `` `${SCRIPTS}/<script>` `` — and not a sentence that mentions it
 * (`brobot-liveness`'s planted `ps` line, *"node scripts/<script> --dir /tmp/ud"*, is data about a
 * process, not a start of one).
 */
const A_PATH_TO_IT = new RegExp(`['"\`](?:[\\w./\${}-]*/)?${SCRIPT.replace('.', '\\.')}['"\`]`)
/**
 * ⚑ **The package script as an ARGUMENT** — `'<name>'` or `"<name>"`, alone in its quotes, as
 * `['<name>', '--dir', d]` or `['run', '<name>']` hand it to `pnpm`. ⚠️ Not a backquoted one: prose in
 * a regex literal (`verify-row.test.mjs`) writes the name in backquotes and starts nothing.
 */
const THE_PACKAGE_SCRIPT = new RegExp(`['"]${NAME}['"]`)
/**
 * ⚑ **A COMMAND LINE that starts it, wherever it is written** (the `706` review, rounds two to four)
 * — a string holding `node … <script>`, or a package manager (`pnpm`, `npm`, `npx`, `yarn`, flags
 * allowed) running `<name>`, anywhere in it: `'node scripts/<script> --dir x'` kept in a variable,
 * `'pnpm -w <name>'`, `'npm run <name>'`, `'cd /x && pnpm <name>'`, `'NODE_ENV=t node scripts/<script>'`,
 * a zx `` $`…` ``. ⚠️ **The one exemption is by NAME, not by
 * guess**: a `command:` field is a row of a process table (`brobot-liveness` plants them), which is
 * data about a process, not a start of one.
 */
const A_COMMAND_LINE = new RegExp(
  `(?<!command:\\s*)['"\`][^'"\`\\n]*?(?<![\\w./-])(?:node\\b[^'"\`\\n]*${SCRIPT.replace('.', '\\.')}|(?:p?npm|npx|yarn)\\b[^'"\`\\n]*\\b${NAME}\\b)`,
)
/**
 * ⚑ **A process call HANDED it in its own arguments** — `execSync(`, `spawnSync(`, a promisified
 * `execAsync(`, `child_process.fork(` — read from its `(` to the `)` that closes it, never past.
 * ⚠️ A method call on something else (`/re/.exec(`, `db.exec(`) is not a process call.
 */
const A_PROCESS_CALL =
  /(?:(?<![\w$.])\w*(?:[Ee]xec|[Ss]pawn|fork)\w*|\b(?:child_process|childProcess|cp)\.\w+)\s*\(/g
const NAMES_IT = new RegExp(`${SCRIPT.replace('.', '\\.')}|\\b(?:p?npm|yarn)\\b[^)]*?\\b${NAME}\\b`)
/** The bound on one call's arguments — a start is written in the call, not a page later. */
const ARGUMENTS_READ = 400

/** The text from `open` (just past a `(`) to the `)` that closes it, bounded. */
function argumentsFrom(text, open) {
  let depth = 1
  let at = open
  while (at < text.length && at < open + ARGUMENTS_READ) {
    const one = text[at]
    if (one === '(') depth += 1
    if (one === ')') depth -= 1
    if (depth === 0) break
    at += 1
  }
  return text.slice(open, at)
}

/**
 * ⚑ **Code, never prose — and read LINE BY LINE** (`346`; the `706` review, round two). ⛔ A block
 * regex opens a "comment" at a `/*` inside a STRING — a glob such as `'src/*.ts'` — and swallows the
 * code after it up to the next comment close anywhere in the file (`no-byte-authority.test.ts` found
 * the same latch in its own stripper). ⚑ A line that STARTS the way a comment does (`//`, `/*`, `*`)
 * is prose; every other line is code, whatever it holds.
 */
function code(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

/** ⚑ A shell or Python file a test could run: its lines that are not `#` comments, read as commands. */
const A_SHELL_START = new RegExp(
  `(?:^|[\\s;&|(\`'"])(?:node\\b[^\\n]*${SCRIPT.replace('.', '\\.')}|(?:p?npm|npx|yarn)\\b[^\\n]*\\b${NAME}\\b)`,
  'm',
)

/**
 * ⚑ **717 · R45 · the LIBRARY is not the script — but it holds ACTS, and so does what it removes
 * with.** `scripts/lib/<script>` holds the planners and the manifest's constants, and importing it
 * runs nothing (its top level only declares). ⛔ It also EXPORTS what removes a checked plan, and it
 * removes with `safe-remove.mjs`' own exports — so a test that holds the planner and ANY of those acts
 * can run the reset in-process without spawning anything (`717`'s review, round 1: `checkPlan` from
 * the library and `removeChecked` from `safe-remove.mjs`, over `defaultUserData()`). ⚑ So the acts are
 * derived from BOTH sources, and a file that names one of them anywhere in its code keeps every import
 * of the library a start.
 */
const LIBRARY_PATH = new RegExp(`(?:^|/)lib/${SCRIPT.replace('.', '\\.')}$`)
const LIBRARY_SOURCE = readFileSync(join(ROOT, 'scripts', 'lib', SCRIPT), 'utf8')
const REMOVER_SOURCE = readFileSync(join(ROOT, 'scripts', 'lib', 'safe-remove.mjs'), 'utf8')
/** A REMOVAL, by the calls that make one — `safe-remove.mjs`' own, and node's. */
const A_REMOVAL = /\b(?:removeChecked|rmdirSync|rmSync|unlinkSync|rmdir|unlink|rm)\s*\(/

/**
 * ⚑ **Every function a module exports that removes something — directly, or by calling one of its
 * own functions that does** (transitive, to a fixed point). ⚠️ Read off top-level `function`
 * declarations, which is the library's only form; an exported arrow is out of its reach.
 */
function actsOf(source) {
  const bodies = new Map()
  const exported = new Set()
  for (const match of source.matchAll(/^(export )?(?:async )?function (\w+)\s*\(/gm)) {
    const end = source.indexOf('\n}', match.index)
    const body = source.slice(match.index, end === -1 ? undefined : end)
    bodies.set(match[2], body.slice(body.indexOf('\n')))
    if (match[1]) exported.add(match[2])
  }
  const acts = new Set()
  for (let grew = true; grew;) {
    grew = false
    for (const [name, body] of bodies) {
      if (acts.has(name)) continue
      const callsAnAct = [...acts].some((act) => new RegExp(`\\b${act}\\s*\\(`).test(body))
      if (A_REMOVAL.test(body) || callsAnAct) {
        acts.add(name)
        grew = true
      }
    }
  }
  return [...acts].filter((name) => exported.has(name)).sort()
}
const ACTS = [...new Set([...actsOf(LIBRARY_SOURCE), ...actsOf(REMOVER_SOURCE)])].sort()

/** Every function the library exports — its planners and checks as well as its acts. */
const LIBRARY_FUNCTIONS = [
  ...LIBRARY_SOURCE.matchAll(/^export (?:async )?function (\w+)\s*\(/gm),
].map((one) => one[1])

const A_NAMED_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2/g
const A_BARE_READ = /(?<![\w$.])readFileSync\s*\(/g
/** ⚑ The ONE argument list the moved half reads the script with: its name joined to a directory, as utf8. */
const THE_READ_SHAPE = new RegExp(
  `^\\s*join\\(\\s*\\w+\\s*,\\s*['"]${SCRIPT.replace('.', '\\.')}['"]\\s*\\)\\s*(?:,\\s*['"]utf-?8['"]\\s*)?$`,
)
/** …and `readFileSync` is node's: named in an import from `node:fs`, and never defined or aliased here. */
const readsWithNode = (read) =>
  /\bimport\s*\{[^}]*\breadFileSync\b[^}]*\}\s*from\s*['"](?:node:)?fs['"]/.test(read) &&
  !/\bfunction\s+readFileSync\b|\breadFileSync\s*=(?!=)|\bas\s+readFileSync\b/.test(read)

/**
 * ⚑ **The code with the two shapes that start nothing taken out** (717 · R45), so every check below
 * reads what is left:
 *  1. `import { … } from '<…>/lib/<script>'` — dropped only when the FILE names none of {@link ACTS}
 *     anywhere in its code, as a word (in the braces, aliased, quoted, or imported from
 *     `safe-remove.mjs` beside it — round 1), and does not both name one of the library's functions
 *     and remove something itself (a planner's verdicts handed to node's own `rmSync` is the reset
 *     too — round 2). A namespace or default import, a dynamic `import()` and a re-export are not
 *     this shape, and stay.
 *  2. a bare `readFileSync(`'s own arguments — dropped only when they are {@link THE_READ_SHAPE},
 *     `join(<dir>, '<script>')` and an encoding, and the file's `readFileSync` is node's (imported
 *     from `node:fs`, never defined or aliased there). ⚠️ The exemption is by exact shape, never by
 *     guess: round 2 carried the path out of a looser one through a call and through a local
 *     function of that name.
 */
function withoutWhatStartsNothing(read) {
  const namesAnAct = ACTS.some((act) => new RegExp(`\\b${act}\\b`).test(read))
  const plansAndRemoves =
    LIBRARY_FUNCTIONS.some((one) => new RegExp(`\\b${one}\\b`).test(read)) && A_REMOVAL.test(read)
  const imports = read.replace(A_NAMED_IMPORT, (whole, _names, _quote, from) =>
    LIBRARY_PATH.test(from) && !namesAnAct && !plansAndRemoves ? '' : whole,
  )
  if (!readsWithNode(imports)) return imports
  let out = ''
  let from = 0
  for (const call of imports.matchAll(A_BARE_READ)) {
    if (call.index < from) continue
    const open = call.index + call[0].length
    const args = argumentsFrom(imports, open)
    out += imports.slice(from, open)
    from = open + args.length
    if (!THE_READ_SHAPE.test(args)) out += args
  }
  return out + imports.slice(from)
}

const startsIt = (text, file = 'x.mjs') => {
  if (/\.(?:sh|bash|zsh|py)$/.test(file)) {
    const lines = text
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
    // ⚑ …and a quoted path or the package script as an ARGUMENT, which is how Python's
    // `subprocess.run(["node", "scripts/<script>"])` writes it.
    return A_SHELL_START.test(lines) || A_PATH_TO_IT.test(lines) || THE_PACKAGE_SCRIPT.test(lines)
  }
  const read = withoutWhatStartsNothing(code(text))
  if (A_PATH_TO_IT.test(read) || THE_PACKAGE_SCRIPT.test(read) || A_COMMAND_LINE.test(read)) {
    return true
  }
  for (const call of read.matchAll(A_PROCESS_CALL)) {
    if (NAMES_IT.test(argumentsFrom(read, call.index + call[0].length))) return true
  }
  return false
}

/** Every file below `dir`, repo-relative — the whole tree a project's globs are rooted in. */
function filesBelow(dir) {
  const out = []
  const walk = (relative) => {
    for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const next = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (/\.(?:[cm]?[jt]s|tsx|vue|sh|bash|zsh|py)$/.test(entry.name)) out.push(next)
    }
  }
  walk(dir)
  return out
}

/**
 * ⚑ **Every project `vitest.config.ts` runs, as `{ root, include }`** — read off the config itself.
 * ⛔ A string entry this file does not know is REFUSED, so a new project cannot join the default run
 * without this census learning where it collects from.
 */
function ordinaryProjects() {
  const known = {
    './apps/desktop': { root: 'apps/desktop', config: desktopConfig },
    './apps/desktop/vitest.dom.config.ts': { root: 'apps/desktop', config: domConfig },
  }
  return rootConfig.test.projects.map((entry) => {
    if (typeof entry === 'string') {
      const found = known[entry]
      if (found === undefined) throw new Error(`a project this census does not know: ${entry}`)
      return { name: found.config.test.name, root: found.root, include: found.config.test.include }
    }
    return {
      name: entry.test.name,
      root: entry.test.root.replace(/^\.\//, ''),
      include: entry.test.include,
    }
  })
}

/** The directory a glob is rooted in — its path up to the first segment that holds a wildcard. */
const baseOf = (glob) => {
  const parts = []
  for (const part of glob.split('/')) {
    if (/[*?[{]/.test(part)) break
    parts.push(part)
  }
  return parts.join('/')
}

/**
 * The trees a glob collects from, under `root` — its static prefix, with a directory segment that is a
 * lone `*` (`packages/*\/smoke/…`) expanded to every directory there, and stopped at the first other
 * wildcard. ⚑ How the smoke config's two globs become the trees they are.
 */
function treesOf(root, glob) {
  let prefixes = [root]
  for (const part of glob.split('/')) {
    if (part === '*') {
      prefixes = prefixes.flatMap((prefix) =>
        existsSync(join(ROOT, prefix))
          ? readdirSync(join(ROOT, prefix), { withFileTypes: true })
              .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
              .map((entry) => `${prefix}/${entry.name}`)
          : [],
      )
      continue
    }
    if (/[*?[{]/.test(part)) break
    prefixes = prefixes.map((prefix) => `${prefix}/${part}`)
  }
  return prefixes.filter((tree) => existsSync(join(ROOT, tree)))
}

/** Every run a seat makes outside the gate: the default projects, the smokes and the probes. */
function otherRuns() {
  return [
    { name: 'smoke', root: '.', include: smokeConfig.test.include },
    {
      name: probeConfig.test.name,
      root: 'apps/desktop',
      include: probeConfig.test.include,
    },
  ]
}

describe('706 · `clean-base` runs only inside the gate', () => {
  const projects = ordinaryProjects()

  it('⚑ the default run is the five projects, each collecting from a `test/` tree', () => {
    expect(projects.map((one) => one.name).sort()).toEqual([
      'desktop',
      'dom',
      'runtime',
      'scripts',
      'shared',
    ])
    for (const one of projects) {
      for (const glob of one.include) {
        // ⛔ A glob rooted anywhere else could reach `gate-only/` — or a tree this census does not walk.
        expect(baseOf(glob), `${one.name}: ${glob}`).toMatch(/^test(?:\/|$)/)
      }
    }
  })

  it('🔴 no file any of them — or a smoke, or a probe — collects from starts the script', () => {
    const walked = new Set()
    for (const one of [...projects, ...otherRuns()]) {
      for (const glob of one.include) {
        for (const tree of treesOf(one.root === '.' ? '' : one.root, glob)) {
          walked.add(tree.replace(/^\//, ''))
        }
      }
    }
    const files = [...new Set([...walked].flatMap(filesBelow))]
    // ⚑ The walk is real: it read the trees the default run, the smokes and the probes collect from.
    expect(files.length, [...walked].join(', ')).toBeGreaterThan(500)
    expect(files).toContain('scripts/test/brobot-liveness.test.mjs')
    expect(files).toContain('packages/runtime/smoke/codex-live.smoke.ts')
    expect(files).toContain('apps/desktop/smoke/lifecycle-stage.smoke.ts')
    const starting = files.filter((file) => startsIt(readFileSync(join(ROOT, file), 'utf8'), file))
    expect(starting, 'a run a seat makes outside the gate starts clean-base').toEqual([])
  })

  it('⚑ the gate still runs them: its config’s own globs match exactly the files that start the script', () => {
    // ⚠️ **Matched, not listed** (the `706` review): a directory walk would pass an include that drifted
    // to `*.spec.ts` or grew an `exclude`, while vitest collected nothing from it and stayed green.
    const gated = gateOnlyConfig.test.projects.flatMap((entry) => {
      const root = entry.test.root.replace(/^\.\//, '')
      const excluded = entry.test.exclude ?? []
      return entry.test.include.flatMap((glob) =>
        treesOf(root, glob)
          .flatMap(filesBelow)
          .filter((file) => {
            const inRoot = file.slice(root.length + 1)
            return matchesGlob(inRoot, glob) && !excluded.some((out) => matchesGlob(inRoot, out))
          }),
      )
    })
    expect(gated.sort()).toEqual([
      'apps/desktop/gate-only/a-clean-base-leaves-no-profiles.test.ts',
      'scripts/gate-only/clean-base.test.mjs',
    ])
    // ⚑ The positive control on the REAL subjects: the pattern the census hunts with finds both.
    for (const file of gated) {
      expect(startsIt(readFileSync(join(ROOT, file), 'utf8'), file), file).toBe(true)
    }
    // ⛔ …and neither tree is one a default project collects from.
    for (const file of gated) expect(file).toMatch(/^(?:apps\/desktop|scripts)\/gate-only\//)
  })

  it('⚑ `ci` runs the gate-only config, and nothing else runs it', () => {
    expect(pkg.scripts['gate-only:check']).toBe('vitest run --config vitest.gate-only.config.ts')
    const steps = pkg.scripts.ci.split(' && ')
    expect(steps).toContain('pnpm run gate-only:check')
    expect(steps).toContain('pnpm run test')
    // ⚑ The ordinary run is the default config's, which cannot reach it — every project but `dom`,
    // then the DOM project in groups (W4.114), and neither names another config.
    expect(pkg.scripts.test).toBe("vitest run --project '!dom' && pnpm run test:dom")
    expect(pkg.scripts['test:dom']).toBe('node scripts/test-dom-in-groups.mjs')
    const others = Object.entries(pkg.scripts).filter(
      ([name, command]) => name !== 'gate-only:check' && /vitest\.gate-only\.config/.test(command),
    )
    expect(others).toEqual([])
  })

  it('🔴 the census on planted sources — a start is caught, a sentence is not, and the SECOND start in a file is', () => {
    const join_ = `const CLI = join(REPO, 'scripts', '${SCRIPT}')`
    const spawned = `execFileSync('node', ['scripts/${SCRIPT}', '--dir', dir])`
    const imported = `import { planCleanBase } from '../lib/${SCRIPT}'`
    const templated = 'const CLI = `${SCRIPTS}/' + SCRIPT + '`'
    const byPackage = `execFileSync('pnpm', ['${NAME}', '--dir', dir])`
    const byRun = `spawnSync("pnpm", ["run", "${NAME}", "--dry-run"])`
    const prose = `expect(out).toMatch(/runs \`${NAME}\`, which/)`
    const shellTemplate = 'execSync(`node scripts/' + SCRIPT + ' --dir ${dir}`)'
    const shellPnpm = `execSync('pnpm ${NAME} --dry-run')`
    const shellMinusC = `spawnSync('sh', ['-c', 'pnpm run ${NAME}'])`
    const aGlobFirst = `const files = globSync('src/*.ts')\nconst CLI = join(REPO, 'scripts', '${SCRIPT}')\n/** a later docblock */`
    const psLine = `{ pid: 403, ppid: 402, command: 'node scripts/${SCRIPT} --dir /tmp/ud' }`
    const comment = `// const CLI = join(REPO, 'scripts', '${SCRIPT}')`
    const block = `/**\n * const CLI = join(REPO, 'scripts', '${SCRIPT}')\n */`
    expect(startsIt(join_)).toBe(true)
    expect(startsIt(spawned)).toBe(true)
    // ⚑ **717 · R45 · reversed by the ruling**: the library's planner, imported by NAME, runs nothing
    // (the tests below say which imports of it still start it).
    expect(startsIt(imported)).toBe(false)
    expect(startsIt(templated)).toBe(true)
    expect(startsIt(byPackage)).toBe(true)
    expect(startsIt(byRun)).toBe(true)
    expect(startsIt(prose)).toBe(false)
    expect(startsIt(shellTemplate)).toBe(true)
    expect(startsIt(shellPnpm)).toBe(true)
    expect(startsIt(shellMinusC)).toBe(true)
    // ⚠️ **A `/*` inside a string opens nothing** — the start after it is still read.
    expect(startsIt(aGlobFirst)).toBe(true)
    // ⚑ Round three's spellings: a command kept in a variable, flags before the name, `npm`, a
    // promisified exec, zx, and a shell script — each a start…
    expect(startsIt(`const CMD = 'node scripts/${SCRIPT} --dir x'\nexecSync(CMD)`)).toBe(true)
    expect(startsIt(`execSync('pnpm -w ${NAME}')`)).toBe(true)
    expect(startsIt(`execSync("pnpm --silent run ${NAME}")`)).toBe(true)
    expect(startsIt(`const out = await execAsync('npm run ${NAME} -- --dry-run')`)).toBe(true)
    expect(startsIt('await $`pnpm ' + NAME + ' --dir ${d}`')).toBe(true)
    expect(
      startsIt(`#!/bin/sh\nset -e\nnode scripts/${SCRIPT} --dir "$1"\n`, 'fixtures/run.sh'),
    ).toBe(true)
    // …and what is not: a process table's `command:` row, even right after an unrelated call, and a
    // shell comment.
    expect(startsIt(`const ok = /x/.exec(line)\n${psLine}`)).toBe(false)
    expect(startsIt(`execSync('ps -A')\n${psLine}`)).toBe(false)
    expect(startsIt(`# node scripts/${SCRIPT}\necho hi\n`, 'fixtures/run.sh')).toBe(false)
    // ⚑ Round four's: node flags in a shell script, a Python argv list, and command lines that do
    // not begin with the runner.
    expect(startsIt(`#!/bin/sh\nnode --no-warnings scripts/${SCRIPT} --dir "$1"\n`, 'x.sh')).toBe(
      true,
    )
    expect(startsIt(`subprocess.run(["node", "scripts/${SCRIPT}", "--dir", d])\n`, 'x.py')).toBe(
      true,
    )
    expect(startsIt(`const C = 'cd /x && pnpm ${NAME}'\nexecSync(C)`)).toBe(true)
    expect(startsIt(`const C = 'NODE_ENV=test node scripts/${SCRIPT} --dir x'`)).toBe(true)
    expect(startsIt(`const C = 'npx pnpm ${NAME}'`)).toBe(true)
    expect(startsIt(psLine)).toBe(false)
    expect(startsIt(comment)).toBe(false)
    expect(startsIt(block)).toBe(false)
    // ⚠️ Rule 12 — plant TWO: a prose mention first, the start second.
    expect(startsIt(`${comment}\n${psLine}\n${join_}`)).toBe(true)
  })

  it('🔴 717 · R45 · the library by NAME is not a start — an act, a namespace, a dynamic import or a re-export of it is', () => {
    const lib = `'../lib/${SCRIPT}'`
    expect(startsIt(`import { planCleanBase, MANIFEST } from ${lib}`)).toBe(false)
    expect(startsIt(`import {\n  planCleanBase,\n  REPORT_ORDER,\n} from ${lib}`)).toBe(false)
    expect(startsIt(`import { CODEX_AUTH } from '../../lib/${SCRIPT}'`)).toBe(false)
    // ⛔ …and each way of reaching an ACT still is.
    expect(startsIt(`import { planCleanBase, applyChecked } from ${lib}`)).toBe(true)
    expect(startsIt(`import { removeEmptyRoot as tidy } from ${lib}`)).toBe(true)
    expect(startsIt(`import * as lib from ${lib}`)).toBe(true)
    expect(startsIt(`import lib from ${lib}`)).toBe(true)
    expect(startsIt(`const lib = await import(${lib})`)).toBe(true)
    expect(startsIt(`export { applyChecked } from ${lib}`)).toBe(true)
    // ⛔ The SCRIPT is not the library: importing the CLI by name runs it.
    expect(startsIt(`import { main } from '../${SCRIPT}'`)).toBe(true)
    // 🔴 **717's review, round 1** — each of these read as starting nothing under a per-name test.
    // The reset, in-process, with the library's planner and `safe-remove.mjs`' removal over his
    // default userData — no act imported from the library at all:
    const inProcess = [
      `import { planCleanBase, checkPlan } from ${lib}`,
      "import { trustedAnchor, removeChecked } from '../lib/safe-remove.mjs'",
      "import { defaultUserData } from '../lib/user-data.mjs'",
      'const a = trustedAnchor(defaultUserData())',
      'for (const { verdict } of checkPlan(a, planCleanBase(a).actions).checked) {',
      '  removeChecked(verdict.path, verdict.stat, { apply: true })',
      '}',
    ].join('\n')
    expect(startsIt(inProcess)).toBe(true)
    // 🔴 …round 2: the same reset with node's own `rmSync` over the checker's verdicts — no act named.
    const withNodes = [
      `import { planCleanBase, checkPlan } from ${lib}`,
      "import { trustedAnchor } from '../lib/safe-remove.mjs'",
      "import { rmSync } from 'node:fs'",
      "const a = trustedAnchor('/x')",
      'for (const { verdict } of checkPlan(a, planCleanBase(a).actions).checked) rmSync(verdict.path)',
    ].join('\n')
    expect(startsIt(withNodes)).toBe(true)
    // ⚑ …and one fact over: the planner WITHOUT a removal is the moved half's shape, and exempt.
    expect(startsIt(withNodes.replace(' rmSync(verdict.path)', ' seen.push(verdict.path)'))).toBe(
      false,
    )
    // …an act hidden from a token test by a comment, or by quotes:
    expect(startsIt(`import { applyChecked /* x */, planCleanBase } from ${lib}`)).toBe(true)
    expect(startsIt(`import { 'applyChecked' as go } from ${lib}`)).toBe(true)
    // ⚠️ Rule 12 — plant TWO: the exempt import first, a start second.
    expect(
      startsIt(`import { planCleanBase } from ${lib}\nexecFileSync('node', ['scripts/${SCRIPT}'])`),
    ).toBe(true)
  })

  it('🔴 717 · R45 · the script READ as text is not a start — the same path anywhere else is', () => {
    const read = `import { readFileSync } from 'node:fs'\nconst SOURCE = readFileSync(join(SCRIPTS, '${SCRIPT}'), 'utf8')`
    expect(startsIt(read)).toBe(false)
    // ⛔ The path kept in a variable is what a spawn takes, so it stays a start even when it is read.
    expect(
      startsIt(`const CLI = join(SCRIPTS, '${SCRIPT}')\nconst SOURCE = readFileSync(CLI, 'utf8')`),
    ).toBe(true)
    // ⚠️ The exemption is by exact shape: not a bare `readFileSync(`, or a read that runs something.
    expect(startsIt(`const S = fs.readFileSync(join(SCRIPTS, '${SCRIPT}'))`)).toBe(true)
    expect(startsIt(`readFileSync(execSync('node scripts/${SCRIPT}'))`)).toBe(true)
    expect(startsIt(`readFileSync(await import('../${SCRIPT}'))`)).toBe(true)
    // 🔴 717's review, round 2: the path carried out of the read through a CALL, the name
    // `readFileSync` defined locally, a `Worker` inside the read — and node's read, never imported.
    expect(
      startsIt(
        `${read}\nreadFileSync(Object.assign(box, { cli: join(SCRIPTS, '${SCRIPT}') }).cli, 'utf8')\nexecFileSync('node', [box.cli])`,
      ),
    ).toBe(true)
    expect(
      startsIt(
        `function readFileSync(p) { return execFileSync('node', [p]) }\nreadFileSync(join(SCRIPTS, '${SCRIPT}'), 'utf8')`,
      ),
    ).toBe(true)
    expect(startsIt(`${read}\nreadFileSync(new Worker(join(SCRIPTS, '${SCRIPT}')))`)).toBe(true)
    // …and a METHOD of that name on something else, beside node's own import: it can do anything.
    expect(
      startsIt(
        `${read}\nconst runner = { readFileSync: (p) => execFileSync('node', [p]) }\nrunner.readFileSync(join(SCRIPTS, '${SCRIPT}'), 'utf8')`,
      ),
    ).toBe(true)
    expect(startsIt(`const SOURCE = readFileSync(join(SCRIPTS, '${SCRIPT}'), 'utf8')`)).toBe(true)
    // 🔴 717's review, round 1: an assignment inside the read carries the path out to a later spawn.
    expect(
      startsIt(
        `readFileSync((CLI = join(SCRIPTS, '${SCRIPT}')), 'utf8')\nexecFileSync('node', [CLI, '--dry-run'])`,
      ),
    ).toBe(true)
    // ⚠️ Rule 12 — plant TWO: the read first, a start second.
    expect(startsIt(`${read}\nexecFileSync('node', [join(SCRIPTS, '${SCRIPT}')])`)).toBe(true)
  })

  it('⚑ 717 · the acts are DERIVED from the library, and the derivation is transitive', () => {
    // ⚑ The real subjects: the library's two exports that remove what a checked plan names, and
    // `safe-remove.mjs`' one, which the library removes with.
    expect(ACTS).toEqual(['applyChecked', 'removeChecked', 'removeEmptyRoot'])
    // ⚑ A planted module: `c` removes nothing itself, but calls `b`, which calls `a`, which does.
    const planted = [
      'export function a(x) {\n  rmdirSync(x)\n}',
      'function b(x) {\n  a(x)\n}',
      'export function c(x) {\n  b(x)\n}',
      'export function d() {\n  return 1\n}',
      'function e(x) {\n  rmSync(x)\n}',
    ].join('\n')
    expect(actsOf(`${planted}\n`)).toEqual(['a', 'c'])
  })

  it('⚑ 717 · the moved half holds both exempt shapes, and read without them it IS a start', () => {
    const file = 'scripts/test/clean-base-without-running-it.test.mjs'
    const moved = readFileSync(join(ROOT, file), 'utf8')
    // ⚑ Standing rule 3: measured where the two readings DIVERGE — the raw code names the script…
    expect(A_PATH_TO_IT.test(code(moved)), 'the moved half no longer names the script at all').toBe(
      true,
    )
    // …and the census, with the two shapes taken out, does not call it a start.
    expect(startsIt(moved, file)).toBe(false)
  })
})
