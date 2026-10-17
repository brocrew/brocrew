import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultUserData, pastedImagesRoot } from '../lib/user-data.mjs'
import {
  fallbacksUnder,
  fixture,
  mustNameScratch,
  removeFixtures,
} from './fixtures/a-planted-user-data.mjs'

/**
 * # ⛔ 717 · R46 · no test starts `clean-base` without a `--dir` naming scratch
 *
 * ⚑ **The PM's ruling, pasted:** *"No test starts `clean-base` without a `--dir` naming scratch. The
 * `run(['--wipe-everything'])` call gets a scratch `--dir`, or a scratch `HOME` for that ONE call
 * only. ⛔ Never a scratch `HOME` for the whole file: `forbiddenRoots` derives `~/.claude` and
 * `~/.codex` from `HOME`."*
 *
 * ⚑ **The rail is {@link mustNameScratch}**, asked FIRST by the one helper through which
 * `scripts/gate-only/clean-base.test.mjs` starts `clean-base` (`run`), and — since `722`
 * (`717` F-6) — the two through which `apps/desktop/gate-only/a-clean-base-leaves-no-profiles.test.ts`
 * starts `clean-base` (`cleanBase`, `cleanBaseRefuses`), on directories the fixture module's
 * `fixture()` made rather than a `mkdtemp` of its own. ⛔ This file runs NOTHING — it measures the
 * guard's refusals here, each beside the same call one fact over (standing rule 3); holds the guard's
 * idea of where a call falls back to equal to the scripts' own derivation; and reads those files as
 * TEXT to hold that every process they start goes through the guard ({@link unguardedByAny} where a
 * file has more than one helper).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

// Windows junctions exercise directory redirection without requiring a symlink privilege.
const directoryLink = (target, path) =>
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')

afterEach(removeFixtures)

/** Lines that start the way a comment does are prose; the rest is code (the `346` rule). */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')

/**
 * A process call — `execFileSync(`, `spawnSync(`, `fork(`, and any call on `child_process` / `cp` —
 * never a method on something else (`/re/.exec(`). The R45 census's own spelling of it.
 */
const A_PROCESS_CALL =
  /(?:(?<![\w$.])\w*(?:[Ee]xec|[Ss]pawn|fork)\w*|\b(?:child_process|childProcess|cp)\.\w+)\s*\(/g
/** `node:child_process`' starters, as a VALUE — an alias, or one handed on — rather than a call. */
const A_LAUNCHER_HANDED_ON =
  /[=:,([]\s*(?:execFileSync|execSync|spawnSync|execFile|spawn|fork)\b(?!\s*\()/
/**
 * ⚑ **The ONE way a guarded file may take `node:child_process`**: a plain named import, no `as` —
 * so every starter it holds goes by its own name, which {@link A_PROCESS_CALL} reads. ⛔ Round 2
 * started the script through an aliased, a namespace, a default and a destructured dynamic import,
 * each unread; any mention of the module that is not this shape is reported instead.
 */
const THE_IMPORT = /import\s*\{[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/g
const ANOTHER_WAY_IN = /child_process|childProcess/

/** The text from just past a `(` to the `)` that closes it. */
function argumentsFrom(text, open) {
  let depth = 1
  let at = open
  for (; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1
    if (text[at] === ')') depth -= 1
    if (depth === 0) break
  }
  return text.slice(open, at)
}

/**
 * ⚑ **Every process `text` starts that the guard does not stand in front of** — `717`'s review,
 * round 1, found a census that only looked at calls naming the script's VARIABLE blind to a start
 * spelled with a path, through `cp.`, through an alias, or behind a guard a `try` swallows. ⛔ So
 * every process call is a candidate. It passes when it sits inside `function <helper>(` whose FIRST
 * statement is `mustNameScratch(` (never wrapped, never after the start), or when its arguments are
 * one this file allows by exact shape (`allow`). A starter handed on as a value is reported too.
 */
function unguardedStarts(text, { helper, allow = [] }) {
  const out = []
  for (const shape of code(text).match(THE_IMPORT) ?? []) {
    if (/\sas\s/.test(shape)) out.push(shape.replace(/\s+/g, ' '))
  }
  const read = code(text).replace(THE_IMPORT, '')
  for (const line of read.split('\n')) {
    if (ANOTHER_WAY_IN.test(line) && !A_PROCESS_CALL.test(line)) out.push(line.trim())
    A_PROCESS_CALL.lastIndex = 0
  }
  const opens = read.indexOf(`function ${helper}(`)
  const closes = opens === -1 ? -1 : read.indexOf('\n}\n', opens)
  const asksFirst =
    opens !== -1 &&
    new RegExp(`^function ${helper}\\([^)]*\\) \\{\\n {2}mustNameScratch\\(`).test(
      read.slice(opens),
    )
  for (const call of read.matchAll(A_PROCESS_CALL)) {
    const args = argumentsFrom(read, call.index + call[0].length)
    if (allow.some((shape) => shape.test(args))) continue
    const inside = opens !== -1 && call.index > opens && call.index < closes
    if (!(inside && asksFirst)) out.push(`${call[0]}${args})`)
  }
  for (const line of read.split('\n')) {
    if (A_LAUNCHER_HANDED_ON.test(line)) out.push(line.trim())
  }
  return out
}

/**
 * ⚑ **722 · a file that starts the script through more than ONE helper** — the desktop gate-only
 * test has two, `cleanBase` and `cleanBaseRefuses` (`717` F-6). ⚑ Each helper is asked of
 * {@link unguardedStarts} alone, and what EVERY one of them reports is unguarded: a start one helper
 * covers is reported only by the others, and a start no helper covers — or a way round the guard that
 * is not a start at all — by every one. ⚠️ Matched by TEXT, so two guarded starts spelled alike in two
 * helpers read as unguarded: red, never a silent pass.
 */
function unguardedByAny(text, helpers) {
  const each = helpers.map((helper) => unguardedStarts(text, { helper }))
  return each[0].filter((one) => each.every((list) => list.includes(one)))
}

/** How many process calls `text` makes at all — the census's positive control. */
const calls = (text) => [...code(text).matchAll(A_PROCESS_CALL)].length

/**
 * ⚑ §4b's sleeper — a `node -e setTimeout` whose argv names a userData, so the script sees a process
 * holding it. It starts neither script, and it is the one other process that file starts.
 */
const THE_SLEEPER =
  /^'sh', \[\s*'-c',\s*`nohup node -e 'setTimeout\(\(\)=>\{\},\d+\)' \$\{JSON\.stringify\(realSpelling\)\} >\/dev\/null 2>&1 & echo \$!`,?\s*\]$/

describe('717 · R46 · `mustNameScratch` — refused before anything is spawned', () => {
  it('⛔ the call R46 names — no `--dir`, his own HOME — is refused; with a scratch HOME it is not', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is the Mac's app data derived from HOME alone (`~/Library/Application Support`); off the Mac `XDG_CONFIG_HOME` wins, and CI sets it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    expect(() => mustNameScratch(['--wipe-everything'])).toThrow(
      /falls back to a directory derived from HOME/,
    )
    expect(() => mustNameScratch(['--wipe-everything'], { env: { HOME: homedir() } })).toThrow(
      /falls back to a directory derived from HOME/,
    )
    // ⚑ One fact over: a scratch HOME for that ONE call.
    expect(() => mustNameScratch(['--wipe-everything'], { env: { HOME: fixture() } })).not.toThrow()
  })

  it('⛔ …and every other way to fall back to HOME: a `--dir` with no value', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is the Mac's app data derived from HOME alone (`~/Library/Application Support`); off the Mac `XDG_CONFIG_HOME` wins, and CI sets it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const scratch = fixture()
    expect(() => mustNameScratch(['--dir'])).toThrow(/derived from HOME/)
    expect(() => mustNameScratch(['--dir'], { env: { HOME: scratch } })).not.toThrow()
    // ⚠️ A scratch `--dir` and then a dangling one still falls back.
    expect(() => mustNameScratch(['--dir', join(scratch, 'x'), '--dir'])).toThrow(
      /derived from HOME/,
    )
  })

  it('⛔ a `--dir` must be a fixture this module made — not his home, a prefix, a traversal, or a root', () => {
    const scratch = fixture()
    for (const dir of [
      homedir(),
      '/tmp/x',
      `${scratch}-not-it`,
      '/tmp/b351-cb-nobody-made-this',
      `${scratch}/../..${homedir()}`,
      // ⚠️ A fixture ROOT: `clean-base` also sweeps `<dir>-pasted-images`, and a root's lies beside it,
      // outside every fixture — which is the check that refuses it.
      scratch,
      realpathSync(scratch),
    ]) {
      expect(() => mustNameScratch(['--dir', dir]), dir).toThrow(/not a fixture this file made/)
    }
    // ⚠️ Two directories, one of them not scratch — refused, whichever the script would take.
    expect(() => mustNameScratch(['--dir', join(scratch, 'a'), '--dir', homedir()])).toThrow(
      /not a fixture/,
    )
    // ⚑ One fact over — the same shapes one level down.
    expect(() => mustNameScratch(['--dir', join(scratch, 'ud')])).not.toThrow()
    expect(
      () => mustNameScratch(['--dir', join(realpathSync(scratch), 'ud')]),
      'the resolved spelling',
    ).not.toThrow()
  })

  it('⛔ `--dir=` is refused — the guard reads one spelling, and a call it did not read is not started', () => {
    // ⚠️ The guard reads `--dir <path>` and nothing else, so a `--dir=<path>` would be judged as a
    // call naming no directory at all. ⚑ Refused by name instead, whatever the path.
    const scratch = fixture()
    expect(() => mustNameScratch([`--dir=${join(scratch, 'ud')}`])).toThrow(
      /does not read `--dir=`/,
    )
    expect(() => mustNameScratch([`--dir=${homedir()}`])).toThrow(/does not read `--dir=`/)
    // ⚑ One fact over: the spelling the guard reads.
    expect(() => mustNameScratch(['--dir', join(scratch, 'ud')])).not.toThrow()
  })

  it('⛔ a `--dir` that LEADS out of its fixture is not scratch — a link inside one pointing elsewhere', () => {
    // ⚠️ The link points at a directory this test makes and this module did NOT — never at his home:
    // nothing real sits behind a link a cleanup could follow.
    const elsewhere = mkdtempSync(join(tmpdir(), 'b717-elsewhere-'))
    try {
      const scratch = fixture()
      directoryLink(elsewhere, join(scratch, 'out'))
      expect(() => mustNameScratch(['--dir', join(scratch, 'out')])).toThrow(/not a fixture/)
      // …and where the rest of the path does not exist yet, through the part that does.
      expect(() => mustNameScratch(['--dir', join(scratch, 'out', 'not-yet')])).toThrow(
        /not a fixture/,
      )
      expect(() =>
        mustNameScratch(['--wipe-everything'], { env: { HOME: join(scratch, 'out') } }),
      ).toThrow(/derived from HOME/)
      // …and a `--dir` below a fixture whose `<dir>-pasted-images` sibling — which `clean-base` also
      // sweeps — leads out of it.
      directoryLink(elsewhere, join(scratch, 'ud-pasted-images'))
      expect(() => mustNameScratch(['--dir', join(scratch, 'ud')])).toThrow(/not a fixture/)
      // ⚑ One fact over: a link that stays inside its fixture is scratch.
      mkdirSync(join(scratch, 'real'))
      directoryLink(join(scratch, 'real'), join(scratch, 'alias'))
      expect(() => mustNameScratch(['--dir', join(scratch, 'alias')])).not.toThrow()
      expect(() => mustNameScratch(['--dir', join(scratch, 'alias', 'ud')])).not.toThrow()
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('⛔ a scratch HOME whose `Library` LEADS out of it is not a scratch fallback', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is `~/Library`, which only the Mac derives app data under.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    // 🔴 717's review, round 1: the check followed links on HOME itself, and the scripts fall back to
    // `HOME/Library/Application Support/…` — which a link under a scratch HOME can send anywhere.
    const elsewhere = mkdtempSync(join(tmpdir(), 'b717-elsewhere-'))
    try {
      const home = fixture()
      directoryLink(elsewhere, join(home, 'Library'))
      expect(() => mustNameScratch(['--wipe-everything'], { env: { HOME: home } })).toThrow(
        /derived from HOME/,
      )
      // ⚑ One fact over: the same HOME with a real `Library` in it.
      const plain = fixture()
      mkdirSync(join(plain, 'Library'))
      expect(() => mustNameScratch(['--wipe-everything'], { env: { HOME: plain } })).not.toThrow()
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('⛔ a HOME that is not absolute is refused — what it derives lies under no fixture', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is the Mac's app data derived from HOME alone (`~/Library/Application Support`); off the Mac `XDG_CONFIG_HOME` wins, and CI sets it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const scratch = fixture()
    expect(() =>
      mustNameScratch(['--help'], { env: { HOME: 'b351-cb-home' }, cwd: scratch }),
    ).toThrow(/derived from HOME/)
    expect(() =>
      mustNameScratch(['--help'], { env: { HOME: scratch }, cwd: scratch }),
    ).not.toThrow()
  })

  it('⚑ a relative `--dir` is read against the call’s own cwd, as the script would read it', () => {
    const scratch = fixture()
    expect(() => mustNameScratch(['--dir', '--clear'], { cwd: scratch })).not.toThrow()
    expect(() => mustNameScratch(['--dir', '--clear'], { cwd: ROOT })).toThrow(/not a fixture/)
  })

  it('⛔ …and against the PHYSICAL cwd: a `..` under a cwd that links out climbs from where it leads', () => {
    // 🔴 717's review, round 2: `resolve(cwd, '../ud')` cancels the `..` against the link's NAME; the
    // child's cwd is the link's target, and the script removes where THAT climbs to.
    const elsewhere = mkdtempSync(join(tmpdir(), 'b717-elsewhere-'))
    try {
      mkdirSync(join(elsewhere, 'in'))
      const scratch = fixture()
      directoryLink(join(elsewhere, 'in'), join(scratch, 'out'))
      expect(() => mustNameScratch(['--dir', '../ud'], { cwd: join(scratch, 'out') })).toThrow(
        /not a fixture/,
      )
      // ⚑ One fact over: a linked cwd that stays inside its fixture.
      mkdirSync(join(scratch, 'real', 'deeper'), { recursive: true })
      directoryLink(join(scratch, 'real', 'deeper'), join(scratch, 'alias'))
      expect(() =>
        mustNameScratch(['--dir', '../ud'], { cwd: join(scratch, 'alias') }),
      ).not.toThrow()
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('⛔ a `--dir` that LINKS to a fixture root is refused — `clean-base` sweeps the sibling of where it leads', () => {
    const scratch = fixture()
    directoryLink(scratch, join(scratch, 'self'))
    expect(() => mustNameScratch(['--dir', join(scratch, 'self')])).toThrow(/not a fixture/)
    // ⚑ One fact over: a link to a directory one level down.
    mkdirSync(join(scratch, 'ud'))
    directoryLink(join(scratch, 'ud'), join(scratch, 'to-ud'))
    expect(() => mustNameScratch(['--dir', join(scratch, 'to-ud')])).not.toThrow()
  })

  it('⛔ a scratch `--dir` never needs a scratch HOME — the real one stays, and so do its forbidden roots', () => {
    // ⚑ The ruling's second sentence, as behaviour: nothing here asks for, or implies, a HOME.
    expect(() => mustNameScratch(['--dir', join(fixture(), 'ud')], { env: {} })).not.toThrow()
  })
})

describe('717 · R46 · where a call falls back to — the guard’s idea of it is the scripts’ own', () => {
  it('⚑ under a scratch HOME, `fallbacksUnder` names exactly what `lib/user-data.mjs` derives', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is the Mac's app data derived from HOME alone (`~/Library/Application Support`); off the Mac `XDG_CONFIG_HOME` wins, and CI sets it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    // ⚑ The scripts' derivation reads THIS process's `HOME` (`os.homedir()`), so it is asked with
    // `HOME` pointed at a fixture for the length of one expression — in-process, nothing started.
    // ⛔ This replaces a dry run of `clean-base` with no `--dir` (`717`'s review, round 1): a second
    // start the ruling's "that ONE call only" does not allow.
    const home = fixture()
    const theirs = (() => {
      const before = process.env.HOME
      process.env.HOME = home
      try {
        return [defaultUserData()]
      } finally {
        process.env.HOME = before
      }
    })()
    expect(theirs[0].startsWith(`${home}${sep}`), 'the derivation did not follow HOME').toBe(true)
    expect(fallbacksUnder({ ...process.env, HOME: home })).toEqual(
      theirs.flatMap((one) => [one, pastedImagesRoot(one)]),
    )
  })

  it('⚑ …and off the Mac it follows `XDG_CONFIG_HOME` / `APPDATA`, as `userDataFor` does', () => {
    const home = '/h'
    expect(fallbacksUnder({ HOME: home, XDG_CONFIG_HOME: '/x' }, 'linux')[0]).toBe(
      join('/x', '@brobot2', 'desktop'),
    )
    expect(fallbacksUnder({ HOME: home }, 'linux')[0]).toBe(
      join('/h', '.config', '@brobot2', 'desktop'),
    )
    expect(fallbacksUnder({ HOME: home, APPDATA: '/a' }, 'win32')[0]).toBe(
      join('/a', '@brobot2', 'desktop'),
    )
    expect(fallbacksUnder({ HOME: home, XDG_CONFIG_HOME: '/x' }, 'darwin')[0]).toBe(
      join('/h', 'Library', 'Application Support', '@brobot2', 'desktop'),
    )
  })
})

describe('717 · R46 · every process a guarded file starts goes through the guard', () => {
  const cleanBase = readFileSync(join(ROOT, 'scripts/gate-only/clean-base.test.mjs'), 'utf8')
  const desktop = readFileSync(
    join(ROOT, 'apps/desktop/gate-only/a-clean-base-leaves-no-profiles.test.ts'),
    'utf8',
  )

  it('⛔ `clean-base.test.mjs` starts processes in TWO places — `run`, guarded first, and §4b’s sleeper', () => {
    expect(calls(cleanBase), 'the census found no process call — it is not reading').toBe(2)
    expect(unguardedStarts(cleanBase, { helper: 'run', allow: [THE_SLEEPER] })).toEqual([])
  })

  it('⛔ …and the desktop gate-only test in TWO — `cleanBase` and `cleanBaseRefuses`, each guarded first (722)', () => {
    expect(calls(desktop), 'the census found no process call — it is not reading').toBe(2)
    expect(unguardedByAny(desktop, ['cleanBase', 'cleanBaseRefuses'])).toEqual([])
    // ⚑ …each names `--dir` first, with a variable, so neither falls back to a directory from HOME…
    const read = code(desktop)
    const all = [...read.matchAll(A_PROCESS_CALL)].map((call) =>
      argumentsFrom(read, call.index + call[0].length),
    )
    for (const args of all) expect(args).toMatch(/^process\.execPath, \[CLI, '--dir', \w+, /)
    // ⚠️ …and each guard is asked about the argv its own start is handed — `CLI` aside, the same list.
    const argvOf = (args) => /^process\.execPath, \[CLI, ([^\]]*)\]/.exec(args)?.[1]
    const asked = [...read.matchAll(/\bmustNameScratch\(\[([^\]]*)\]\)/g)].map((one) => one[1])
    expect(asked, 'a guard asked about a different call').toEqual(all.map(argvOf))
  })

  it('🔴 722 · the census on a planted file with TWO helpers — each covers its own start, and only its own', () => {
    const two = [
      'function cleanBase(dir, ...flags) {',
      "  mustNameScratch(['--dir', dir, ...flags])",
      "  execFileSync(process.execPath, [CLI, '--dir', dir, ...flags])",
      '}',
      '',
      'function cleanBaseRefuses(target, ...flags) {',
      "  mustNameScratch(['--dir', target, ...flags])",
      '  try {',
      "    execFileSync(process.execPath, [CLI, '--dir', target, ...flags])",
      '  } catch {}',
      '}',
      '',
    ].join('\n')
    const check = (text) => unguardedByAny(text, ['cleanBase', 'cleanBaseRefuses'])
    expect(check(two)).toEqual([])
    // ⚑ One fact over, each way: either helper stops asking, or a start stands outside both.
    const unasked = (argv) => check(two.replace(`  mustNameScratch(${argv})\n`, ''))
    expect(unasked("['--dir', dir, ...flags]")).toHaveLength(1)
    expect(unasked("['--dir', target, ...flags]")).toHaveLength(1)
    expect(check(`${two}\nexecFileSync(process.execPath, [CLI, '--dir', x])\n`)).toHaveLength(1)
    // ⚠️ …and a helper left off the list covers nothing: the start inside it is reported.
    expect(unguardedByAny(two, ['cleanBase'])).toHaveLength(1)
  })

  it('🔴 the census on planted files — each way round the guard the review found, and the one it allows', () => {
    const guarded = [
      'function run(args, env = {}) {',
      '  mustNameScratch(args, { env })',
      "  return execFileSync('node', [CLI, ...args])",
      '}',
      '',
    ].join('\n')
    const check = (text) => unguardedStarts(text, { helper: 'run', allow: [THE_SLEEPER] })
    expect(check(guarded)).toEqual([])
    // A second start outside the helper — by its variable, by a path, through `cp.`, or an alias.
    for (const second of [
      "execFileSync('node', [CLI, '--wipe-everything'])",
      "execFileSync('node', [join(SCRIPTS, 'x.mjs'), '--wipe-everything'])",
      "cp.execFileSync('node', [CLI, '--wipe-everything'])",
    ]) {
      expect(check(`${guarded}\nconst out = ${second}\n`), second).toHaveLength(1)
    }
    expect(check(`${guarded}\nconst go = execFileSync\n`)).toHaveLength(1)
    // 🔴 …round 2: the module taken any other way than one plain named import.
    for (const other of [
      "import { execFileSync as go } from 'node:child_process'\ngo('node', [CLI])",
      "import * as proc from 'node:child_process'\nproc.execFileSync('node', [CLI])",
      "import child from 'node:child_process'\nchild.execFileSync('node', [CLI])",
      "const { execFileSync: go } = await import('node:child_process')\ngo('node', [CLI])",
    ]) {
      expect(check(`${guarded}\n${other}\n`).length, other).toBeGreaterThan(0)
    }
    // A helper that stopped asking, asked too late, asked inside a `try`, or asked in a comment.
    expect(check(guarded.replace('  mustNameScratch(args, { env })\n', ''))).toHaveLength(1)
    expect(
      check(
        guarded
          .replace('  mustNameScratch(args, { env })\n', '')
          .replace(
            "  return execFileSync('node', [CLI, ...args])\n",
            "  const out = execFileSync('node', [CLI, ...args])\n  mustNameScratch(args, { env })\n  return out\n",
          ),
      ),
    ).toHaveLength(1)
    expect(
      check(
        guarded.replace(
          '  mustNameScratch(args, { env })',
          '  try { mustNameScratch(args, { env }) } catch {}',
        ),
      ),
    ).toHaveLength(1)
    expect(check(guarded.replace('  mustNameScratch(', '  // mustNameScratch('))).toHaveLength(1)
    // ⚑ …and the one other process the file starts, by its exact shape — and nothing like it.
    const sleeper =
      "spawnSync('sh', [\n  '-c',\n  `nohup node -e 'setTimeout(()=>{},6000)' ${JSON.stringify(realSpelling)} >/dev/null 2>&1 & echo $!`,\n])"
    expect(check(`${guarded}\nconst s = ${sleeper}\n`)).toEqual([])
    // 🔴 round 2: …and a start appended inside the sleeper's own shell string is not the sleeper.
    const withATail = sleeper.replace('& echo $!', '& node ${CLI} --wipe-everything; echo $!')
    expect(check(`${guarded}\nconst s = ${withATail}\n`)).toHaveLength(1)
    expect(
      check(`${guarded}\nconst s = spawnSync('sh', ['-c', 'node scripts/x.mjs'])\n`),
    ).toHaveLength(1)
  })
})
