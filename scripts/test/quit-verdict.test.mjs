import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LAST_RESORT_SAID, QUIT_VERDICTS, quitHeadline, quitVerdict } from '../lib/quit-verdict.mjs'

/**
 * 🔴 **A tick that a force-stop also earns** (514, from `HO-038` §5.1 and `HO-040` §1).
 *
 * ## ⛔ The branch nothing in this repository had ever executed
 *
 * `quit:check` computed `output.includes('is being stopped now')` and rendered the true arm as a
 * clause appended to the END of its `✔` line. ⚠️ **`one-app.test.ts` asserted that the sentence
 * appeared in the gate's SOURCE**; nothing anywhere fed the app's own words through the branch and
 * looked at what came out. ⛔ **The stopped arm needs a machine under load, and a machine under
 * load is the one thing `pnpm run ci` cannot summon** — which is `smoke-verdicts.mjs`'s reason for
 * existing, one condition over, and why the verdict is now a module instead of a ternary.
 *
 * ## ⚑ What is planted, and where it comes from
 *
 * ⛔ **The fixture is not typed here.** The sentence is reconstructed from
 * `apps/desktop/src/main/last-resort-exit.ts` — the shipped closer's own program — and fed to the
 * shipped detector, which carries its own independent spelling. ⚠️ **Two derivations meeting is
 * the measurement**; one derivation would make this a test of its own fixture. If the product
 * rewords what it prints, §1 goes red here rather than going quiet in a gate nobody is reading.
 *
 * ## ⚠️ What this file does NOT claim
 *
 * ⛔ **It does not claim the app is healthy, and it does not re-measure the hang.** `294` owns that
 * — bare Electron 43.2.0 hangs in 5 of 6 loaded quits and the rate is a distribution, not a run.
 * ⚑ Both cells here are GREEN and §3 asserts that no refusal can follow the verdict, because a
 * gate that reddened under load would be the same instrument lying in the other direction.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')

const GATE = readFileSync(join(HERE, '../app-closes-check.mjs'), 'utf8')
const LIB = readFileSync(join(HERE, '../lib/quit-verdict.mjs'), 'utf8')
const CLOSER = readFileSync(join(REPO, 'apps/desktop/src/main/last-resort-exit.ts'), 'utf8')

/** Comments out, so a census reads the code and not the argument beside it. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

/**
 * ⛔ **What the shipped closer actually prints, rebuilt from its own source.**
 *
 * `closerProgram` is a program passed to `node -e`, so the sentence lives inside a `console.error`
 * inside a template literal: two string literals joined by a real `+` at the source level, with one
 * `${String(withinMs)}` hole. This undoes exactly those two spellings and nothing else — and §1
 * asserts the reconstruction succeeded before it is used, because a regex that matched nothing
 * would otherwise plant an empty string and prove the detector cannot see what is not there.
 */
const whatTheCloserPrints = (withinMs) => {
  // ⛔ **One, and the count is the assertion.** A second `console.error` in that module would make
  // this reconstruct whichever came first — a fixed slice running into the next region — and the
  // planted sentence would then be some other sentence the product also prints.
  const every = [...CLOSER.matchAll(/console\.error\("([\s\S]*?)"\);/g)]
  if (every.length !== 1) {
    throw new Error(`514: the closer has ${String(every.length)} console.error programs, not one`)
  }
  const [found] = every
  return found[1].replace(/` \+\n\s*`/g, '').replace('${String(withinMs)}', String(withinMs))
}

/** A quit as the app reports one, with the four steps, the door, and no last resort. */
const APP_SAID = [
  'BroCrew shut down in 118ms — stop archive work 0ms · close its sessions 1ms · ' +
    'drain its archive work 0ms · close its database 1ms',
  "BroCrew reached Electron's will-quit at +105ms",
  "BroCrew reached Electron's quit at +106ms",
].join('\n')

/** The index of the first code point at which two strings differ; the shorter length if neither. */
const firstDifference = (a, b) => {
  const left = [...a]
  const right = [...b]
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    if (left[at] !== right[at]) return at
  }
  return Math.min(left.length, right.length)
}

/* ══════════════ §1 · the plant: one sentence apart, two verdicts ═══════════════════════════ */

describe('§1 · a force-stop planted on the path the gate walks', () => {
  it('⛔ the closer’s sentence is reconstructed, not typed — and the detector matches it', () => {
    const said = whatTheCloserPrints(2_000)
    // ⚑ The reconstruction is proved BEFORE it is trusted (`a-fixture-must-not-depend-on…`): a
    // half-undone template would still contain a backtick or an unfilled hole, and an empty match
    // would make every assertion below true by asking nothing.
    expect(said.startsWith('BroCrew asked Electron to exit 2000ms ago and is still running;')).toBe(
      true,
    )
    expect(said).not.toContain('`')
    expect(said).not.toContain('${')
    // 🔴 **The two spellings meet here and nowhere else.** The gate cannot import the app and the
    // app cannot import the gate; this is the join that keeps them honest.
    expect(said).toContain(LAST_RESORT_SAID)
  })

  it('🔴 the same run, one sentence apart, earns two different verdicts — both in one sample', () => {
    const clean = `${APP_SAID}\n`
    const stopped = `${APP_SAID}\n${whatTheCloserPrints(2_000)}\n`
    // ⚠️ The ONLY difference between the two inputs is the sentence the product prints when it
    // stops Electron. Everything the gate asserts — the report, the four steps, the graceful door
    // — is present and identical in both.
    expect(stopped.replace(`${whatTheCloserPrints(2_000)}\n`, '')).toBe(clean)

    const exited = quitHeadline({ output: clean, closedIn: '341ms', budgetMs: 5_000 })
    const forced = quitHeadline({ output: stopped, closedIn: '2146ms', budgetMs: 5_000 })

    expect(exited.verdict).toBe('exited')
    expect(forced.verdict).toBe('stopped')
    expect(exited.head).toBe(
      'quit:check ✔ closed in 341ms (budget 5000ms) — Electron exited on its own',
    )
    expect(forced.head).toBe(
      'quit:check ⚠️ STOPPED in 2146ms (budget 5000ms) — Electron did not exit on its own; ' +
        'the last resort stopped it',
    )
  })

  it('⚑ …and they differ at the verdict token, which is the whole property', () => {
    const exited = quitHeadline({ output: `${APP_SAID}\n`, closedIn: '341ms', budgetMs: 5_000 })
    const forced = quitHeadline({
      output: `${APP_SAID}\n${whatTheCloserPrints(2_000)}\n`,
      closedIn: '341ms',
      budgetMs: 5_000,
    })
    // 🔴 **The dispatch's property as a number.** `quit:check ` is eleven characters; the twelfth
    // is the mark. A reader who has read twelve characters has the answer.
    expect(firstDifference(exited.head, forced.head)).toBe(11)

    // ⛔ **The control, and it is the shape this replaces.** Under 294's spelling the two lines were
    // byte-identical for the whole of the shorter one and differed only where it ran out — which is
    // what *"without reading the tail of the line"* was measuring the absence of.
    const before = 'quit:check ✔ closed in 341ms (budget 5000ms) · window gone 350ms · gate silent'
    const beforeStopped = `${before} · ⚠️ Electron did not exit on its own; the last resort stopped it`
    expect(firstDifference(before, beforeStopped)).toBe([...before].length)
    expect(firstDifference(before, beforeStopped)).toBeGreaterThan(70)
  })

  it('⚠️ an app that said nothing reads as exited, and the GATE is what refuses that', () => {
    // ⛔ Wrong-but-safe on purpose: a detector that announced a force-stop because its own read came
    // back empty would be 326 again — an instrument reporting itself as the product. The honest
    // guard is the gate's shutdown-report assertion, which is RED rather than green, and §3 pins
    // that it runs first.
    expect(quitVerdict('')).toBe('exited')
    expect(quitVerdict(undefined)).toBe('exited')
    expect(quitVerdict(null)).toBe('exited')
    // ⚑ The paired positive: the same function does see the sentence when it is there.
    expect(quitVerdict(whatTheCloserPrints(2_000))).toBe('stopped')
  })
})

/* ══════════════ §2 · the vocabulary is closed, and its cells are distinct ══════════════════ */

describe('§2 · two cells and nothing else', () => {
  it('⛔ exactly two members, every part present, every part distinct', () => {
    expect(Object.keys(QUIT_VERDICTS).sort()).toEqual(['exited', 'stopped'])
    const cells = Object.values(QUIT_VERDICTS)
    // ⚠️ **A set needs a distinctness check.** Two cells that agreed on the mark, or on the word,
    // would satisfy every "the verdict is named" assertion while carrying no information at all —
    // which is precisely the state this dispatch found.
    expect(new Set(cells.map((cell) => cell.mark)).size).toBe(2)
    expect(new Set(cells.map((cell) => cell.word)).size).toBe(2)
    expect(new Set(cells.map((cell) => cell.because)).size).toBe(2)
    for (const cell of cells) {
      for (const part of [cell.mark, cell.word, cell.because]) {
        expect(typeof part === 'string' && part !== '').toBe(true)
      }
    }
    // ⛔ …and neither reason is a substring of the other, so a `grep` for one cannot match both.
    expect(QUIT_VERDICTS.stopped.because).not.toContain(QUIT_VERDICTS.exited.because)
    expect(QUIT_VERDICTS.exited.because).not.toContain(QUIT_VERDICTS.stopped.because)
  })

  it('🔴 the phrase every brief already greps for matches the stopped cell and ONLY it', () => {
    // ⚑ Four dispatch briefs (`509`, `510`, `511`, `513`) tell their agent to grep `quit:check`'s
    // line for this phrase. That instruction does not go stale with this change — it becomes
    // redundant — and this assertion is what keeps the promise true rather than hoped for.
    expect(QUIT_VERDICTS.stopped.because).toContain('did not exit on its own')
    expect(QUIT_VERDICTS.exited.because).not.toContain('did not exit on its own')
    // ⚠️ …and the tick still means what every reader already greps `quit:check ✔` for.
    expect(QUIT_VERDICTS.exited.mark).toBe('✔')
    expect(QUIT_VERDICTS.stopped.mark).not.toBe('✔')
  })

  it('⚑ the cells are frozen, so nothing can edit a verdict at run time', () => {
    expect(Object.isFrozen(QUIT_VERDICTS)).toBe(true)
    expect(Object.isFrozen(QUIT_VERDICTS.exited)).toBe(true)
    expect(Object.isFrozen(QUIT_VERDICTS.stopped)).toBe(true)
  })
})

/* ══════════════ §3 · the gate reaches it, and cannot go red on it ═════════════════════════ */

describe('§3 · what the gate does with the verdict', () => {
  it('⛔ imports it AND calls it, with the app’s own output — an import is not a call', () => {
    expect(GATE).toContain("import { quitHeadline } from './lib/quit-verdict.mjs'")
    expect(GATE.split('quitHeadline({').length - 1).toBe(1)
    // 🔴 The app's words, by name. A call handed a constant would pass every assertion in §1 and
    // report `exited` on every run this gate will ever make.
    expect(GATE).toMatch(/quitHeadline\(\{\n\s+output,\n/)
  })

  it('🔴 the verdict is the last thing that happens, so no word here can redden a run', () => {
    const at = GATE.indexOf('quitHeadline({')
    const tail = GATE.indexOf('main().catch(')
    expect(at).toBeGreaterThan(0)
    expect(tail).toBeGreaterThan(at)
    const after = GATE.slice(at, tail)
    // ⛔ **294's ruling, as a gate rather than as a sentence.** *"Failing the run when the bound
    // does its job would put the flakiness straight back, this time on the fix."* Nothing may
    // refuse, throw or exit once the cell is known.
    expect(after).not.toContain('await fail(')
    expect(after).not.toContain('throw new Error(')
    expect(after).not.toContain('process.exit')
    // ⚑ **The non-vacuity control**: there really are refusals in this file, and they are above.
    expect(GATE.slice(0, at).split('await fail(').length - 1).toBeGreaterThan(10)
  })

  it('🔴 …and it is computed only after the app has been proved to have spoken', () => {
    // ⚠️ `exited` is an absence, and an absence is only evidence once the presence was possible.
    // The gate goes red when the shutdown report is missing; that check must precede the verdict,
    // or a lost report would read as a clean exit.
    const spoke = GATE.indexOf('said NOTHING about where the time went')
    const door = GATE.indexOf("reached Electron's will-quit")
    const at = GATE.indexOf('quitHeadline({')
    expect(spoke).toBeGreaterThan(0)
    expect(door).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(spoke)
    expect(at).toBeGreaterThan(door)
  })

  it('⛔ the gate no longer spells a verdict of its own', () => {
    // ⚑ Prose stripped first (`a-source-census-must-strip-prose-before-it-asserts`): the docblock
    // quotes both lines, and quoting them is the documentation this rule exists to keep.
    expect(code(GATE)).not.toContain('quit:check')
    // …with the control that the stripper did not simply empty the file.
    expect(code(GATE)).toContain('quitHeadline({')
    // 🔴 And the token is BUILT from the vocabulary rather than typed, in the one file that may.
    expect(code(LIB)).not.toContain('quit:check ✔')
    expect(code(LIB)).toContain('`quit:check ${cell.mark} ${cell.word} in ${closedIn} `')
  })
})

/* ══════════════ §4 · every reader of the token, derived and pinned ════════════════════════ */

/**
 * ⛔ **A verdict token that moved must not leave a reader behind** (514 §4.3).
 *
 * ⚑ **Derived AND pinned, which is not a contradiction** (`hook-reach.test.mjs`): the sweep does
 * the covering, and the exact-equality assertion makes a file joining or leaving the set a red
 * somebody has to acknowledge in a diff. ⚠️ **The whole tree**, so nothing is excluded by a
 * directory roster somebody has to remember to extend.
 *
 * 🔴 **The one reader this repository cannot assert is the one that matters most**, and it is named
 * here rather than left out: the PM's dispatch briefs, which live in the vault and tell every agent
 * to read this gate's line. ⛔ Nothing in a repository can go red for a sentence outside it — which
 * is why `514` owes a replacement sentence as well as a repair.
 *
 * ⛔ **`git grep`, and not a `readFileSync` walk, and the first draft was the walk.** Reading every
 * file of the tree in JavaScript measured 3.4 s idle and **timed out at the 5 s the `scripts`
 * project allows** on a machine merely busy — ⚑ **which is this dispatch's own subject, one level
 * up: an instrument that reports the load of the machine it runs on.** Git scans the same tree in
 * under a second.
 *
 * ⚠️ **`--untracked`, and the first draft did not have that either.** `git grep` and `git ls-files`
 * both default to what is COMMITTED, so this census was blind to the two files this dispatch was
 * adding while it was adding them — a census that cannot see the diff being written is a census
 * that ratifies it. ⛔ Found by the pin failing on its own new files.
 */
const sweep = (needle) => {
  try {
    return execFileSync('git', ['grep', '-l', '-z', '--untracked', '-F', '-e', needle], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\0')
      .filter((name) => name !== '')
      .sort()
  } catch (nothingMatched) {
    // ⚠️ **`git grep` exits 1 when it matches nothing**, which is an ORDINARY answer arriving as an
    // error. Any other status is a broken instrument and must not read as an empty census.
    if (nothingMatched.status !== 1) throw nothingMatched
    return []
  }
}

const swept = new Map()

/** One sweep per needle per run: `git grep` is cheap, but not free, and this file asks six times. */
const spelling = (needle) => {
  if (!swept.has(needle)) swept.set(needle, sweep(needle))
  return swept.get(needle)
}

describe('§4 · who spells a quit:check verdict', () => {
  it('⛔ these files and only these files spell one', () => {
    const tick = spelling('quit:check ✔')
    const stopped = spelling('quit:check ⚠️')
    expect([...new Set([...tick, ...stopped])].sort()).toEqual([
      'apps/desktop/test/one-app.test.ts',
      'scripts/app-closes-check.mjs',
      'scripts/lib/quit-verdict.mjs',
      // ⚑ **The mutation table is a reader too**, and the census found it rather than being told:
      // `514 M1` puts the tick back on the stopped cell and `M8` restores `294`'s whole line, so
      // both spell a verdict. A future table that anchors on one joins this list or goes red here.
      'scripts/mutations/514/mutations.py',
      'scripts/test/quit-verdict.test.mjs',
    ])
    // ⚑ **Both halves plant more than one** (standing rule 12): a sweep that could only ever
    // return a single file, or that silently answered for one of the two tokens, would pin the
    // very same list by accident on the day a second reader arrived.
    expect(tick.length).toBeGreaterThan(1)
    expect(stopped.length).toBeGreaterThan(1)
    // ⚠️ **A generous bound, deliberately.** The `scripts` project allows 5 s a test and a sweep of
    // this tree measures under a second — but a census that goes red because the machine was busy
    // is the instrument this whole dispatch is about, pointing the other way.
  }, 30_000)

  it('⚑ the controls: the instrument CAN name more, and naming the gate is not spelling a verdict', () => {
    // ⛔ Without this the pin above is satisfied by an instrument that answers four files to
    // everything. `quit:check` alone is in dozens: the chain, the gates, the tables, the prose.
    const named = spelling('quit:check')
    expect(named.length).toBeGreaterThan(20)
    expect(named).toContain('package.json')
    expect(named).toContain('scripts/mutations/271/mutations.py')
    // ⚠️ …and the discriminating negative: those files name the gate and spell no verdict.
    expect(spelling('quit:check ✔')).not.toContain('package.json')
    expect(spelling('quit:check ✔')).not.toContain('scripts/mutations/271/mutations.py')
    // ⛔ …and a needle nothing carries comes back EMPTY rather than throwing, which is the arm that
    // decides whether an exit code of 1 reads as "nobody" or as "the census did not run".
    // ⚠️ Assembled rather than spelled, because a needle written here is a needle this file
    // carries — the sweep would find its own source and the arm would never be exercised.
    expect(spelling(`quit:check ${String.fromCodePoint(0x1f41f)}`)).toEqual([])
  }, 30_000)
})
