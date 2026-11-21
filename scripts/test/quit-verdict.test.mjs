import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LAST_RESORT_SAID, QUIT_VERDICTS, quitHeadline, quitVerdict } from '../lib/quit-verdict.mjs'

/**
 * The verdict of `quit:check`'s tick, including the force-stop branch. `quit:check` renders a clause
 * at the end of its tick line when the output includes 'is being stopped now'; nothing else feeds
 * the app's own words through that branch, and the stopped arm needs a machine under load.
 *
 * The fixture is not typed here: the sentence is rebuilt from
 * `apps/desktop/src/main/last-resort-exit.ts` (the shipped closer's program) and fed to the shipped
 * detector, which carries its own independent spelling. Two derivations meeting is the measurement;
 * if the product rewords what it prints, this goes red instead of going quiet in a gate nobody reads.
 *
 * This file does not claim the app is healthy or re-measure the hang (bare Electron 43.2.0 hangs in
 * 5 of 6 loaded quits). Both cells are green and the gate group asserts no refusal can follow the
 * verdict, since a gate that reddened under load would be the same instrument lying the other way.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')

const GATE = readFileSync(join(HERE, '../app-closes-check.mjs'), 'utf8')
const LIB = readFileSync(join(HERE, '../lib/quit-verdict.mjs'), 'utf8')
const CLOSER = readFileSync(join(REPO, 'apps/desktop/src/main/last-resort-exit.ts'), 'utf8')

/** Comments out, so a census reads the code and not the argument beside it. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

/**
 * What the shipped closer prints, rebuilt from its own source.
 *
 * `closerProgram` is a `node -e` program, so the sentence sits in a `console.error` inside a
 * template literal: two string literals joined by a real `+`, with one `${String(withinMs)}` hole.
 * This undoes exactly those two spellings; the first test asserts the reconstruction succeeded
 * before it is used, since a regex that matched nothing would plant an empty string.
 */
const whatTheCloserPrints = (withinMs) => {
  // One, and the count is the assertion: a second `console.error` in that module would make this
  // reconstruct whichever came first, planting some other sentence the product also prints.
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

/* ══════════════ the plant: one sentence apart, two verdicts ═══════════════════════════════ */

describe('§1 · a force-stop planted on the path the gate walks', () => {
  it('⛔ the closer’s sentence is reconstructed, not typed — and the detector matches it', () => {
    const said = whatTheCloserPrints(2_000)
    // The reconstruction is proved before it is trusted: a half-undone template would still contain a
    // backtick or an unfilled hole, and an empty match would make every assertion below true by asking
    // nothing.
    expect(said.startsWith('BroCrew asked Electron to exit 2000ms ago and is still running;')).toBe(
      true,
    )
    expect(said).not.toContain('`')
    expect(said).not.toContain('${')
    // The two spellings meet here and nowhere else: the gate cannot import the app and the app cannot
    // import the gate, so this join keeps them honest.
    expect(said).toContain(LAST_RESORT_SAID)
  })

  it('🔴 the same run, one sentence apart, earns two different verdicts — both in one sample', () => {
    const clean = `${APP_SAID}\n`
    const stopped = `${APP_SAID}\n${whatTheCloserPrints(2_000)}\n`
    // The only difference between the two inputs is the sentence the product prints when it stops
    // Electron. The report, the four steps and the graceful door are present and identical in both.
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
    // The property as a number: `quit:check ` is eleven characters and the twelfth is the mark.
    expect(firstDifference(exited.head, forced.head)).toBe(11)

    // The control, and the shape this replaces: the two lines were byte-identical for the whole of the
    // shorter one and differed only where it ran out, so telling them apart meant reading the tail.
    const before = 'quit:check ✔ closed in 341ms (budget 5000ms) · window gone 350ms · gate silent'
    const beforeStopped = `${before} · ⚠️ Electron did not exit on its own; the last resort stopped it`
    expect(firstDifference(before, beforeStopped)).toBe([...before].length)
    expect(firstDifference(before, beforeStopped)).toBeGreaterThan(70)
  })

  it('⚠️ an app that said nothing reads as exited, and the GATE is what refuses that', () => {
    // Wrong-but-safe on purpose: a detector that announced a force-stop because its own read came back
    // empty would be an instrument reporting itself as the product. The honest guard is the gate's
    // shutdown-report assertion, which is red rather than green, and the gate group pins that it runs
    // first.
    expect(quitVerdict('')).toBe('exited')
    expect(quitVerdict(undefined)).toBe('exited')
    expect(quitVerdict(null)).toBe('exited')
    // ⚑ The paired positive: the same function does see the sentence when it is there.
    expect(quitVerdict(whatTheCloserPrints(2_000))).toBe('stopped')
  })
})

/* ══════════════ the vocabulary is closed, and its cells are distinct ══════════════════════ */

describe('§2 · two cells and nothing else', () => {
  it('⛔ exactly two members, every part present, every part distinct', () => {
    expect(Object.keys(QUIT_VERDICTS).sort()).toEqual(['exited', 'stopped'])
    const cells = Object.values(QUIT_VERDICTS)
    // A set needs a distinctness check: two cells that agreed on the mark, or on the word, would satisfy
    // every "the verdict is named" assertion while carrying no information.
    expect(new Set(cells.map((cell) => cell.mark)).size).toBe(2)
    expect(new Set(cells.map((cell) => cell.word)).size).toBe(2)
    expect(new Set(cells.map((cell) => cell.because)).size).toBe(2)
    for (const cell of cells) {
      for (const part of [cell.mark, cell.word, cell.because]) {
        expect(typeof part === 'string' && part !== '').toBe(true)
      }
    }
    // ...and neither reason is a substring of the other, so a `grep` for one cannot match both.
    expect(QUIT_VERDICTS.stopped.because).not.toContain(QUIT_VERDICTS.exited.because)
    expect(QUIT_VERDICTS.exited.because).not.toContain(QUIT_VERDICTS.stopped.because)
  })

  it('🔴 the phrase every brief already greps for matches the stopped cell and ONLY it', () => {
    // Dispatch briefs tell their agent to grep `quit:check`'s line for this phrase; this assertion
    // keeps that promise true rather than hoped for.
    expect(QUIT_VERDICTS.stopped.because).toContain('did not exit on its own')
    expect(QUIT_VERDICTS.exited.because).not.toContain('did not exit on its own')
    // ...and the tick still means what every reader greps `quit:check ✔` for.
    expect(QUIT_VERDICTS.exited.mark).toBe('✔')
    expect(QUIT_VERDICTS.stopped.mark).not.toBe('✔')
  })

  it('⚑ the cells are frozen, so nothing can edit a verdict at run time', () => {
    expect(Object.isFrozen(QUIT_VERDICTS)).toBe(true)
    expect(Object.isFrozen(QUIT_VERDICTS.exited)).toBe(true)
    expect(Object.isFrozen(QUIT_VERDICTS.stopped)).toBe(true)
  })
})

/* ══════════════ the gate reaches it, and cannot go red on it ══════════════════════════════ */

describe('§3 · what the gate does with the verdict', () => {
  it('⛔ imports it AND calls it, with the app’s own output — an import is not a call', () => {
    expect(GATE).toContain("import { quitHeadline } from './lib/quit-verdict.mjs'")
    expect(GATE.split('quitHeadline({').length - 1).toBe(1)
    // The app's words, by name: a call handed a constant would pass every assertion above and report
    // `exited` on every run.
    expect(GATE).toMatch(/quitHeadline\(\{\n\s+output,\n/)
  })

  it('🔴 the verdict is the last thing that happens, so no word here can redden a run', () => {
    const at = GATE.indexOf('quitHeadline({')
    const tail = GATE.indexOf('main().catch(')
    expect(at).toBeGreaterThan(0)
    expect(tail).toBeGreaterThan(at)
    const after = GATE.slice(at, tail)
    // Failing the run when the bound does its job would put the flakiness back, this time on the fix.
    // Nothing may refuse, throw or exit once the cell is known.
    expect(after).not.toContain('await fail(')
    expect(after).not.toContain('throw new Error(')
    expect(after).not.toContain('process.exit')
    // The non-vacuity control: there really are refusals in this file, and they are above.
    expect(GATE.slice(0, at).split('await fail(').length - 1).toBeGreaterThan(10)
  })

  it('🔴 …and it is computed only after the app has been proved to have spoken', () => {
    // `exited` is an absence, and an absence is only evidence once the presence was possible. The gate
    // goes red when the shutdown report is missing; that check must precede the verdict, or a lost
    // report would read as a clean exit.
    const spoke = GATE.indexOf('said NOTHING about where the time went')
    const door = GATE.indexOf("reached Electron's will-quit")
    const at = GATE.indexOf('quitHeadline({')
    expect(spoke).toBeGreaterThan(0)
    expect(door).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(spoke)
    expect(at).toBeGreaterThan(door)
  })

  it('⛔ the gate no longer spells a verdict of its own', () => {
    // Prose stripped first: the docblock quotes both lines, and quoting them is the documentation this
    // rule exists to keep.
    expect(code(GATE)).not.toContain('quit:check')
    // …with the control that the stripper did not simply empty the file.
    expect(code(GATE)).toContain('quitHeadline({')
    // And the token is built from the vocabulary rather than typed, in the one file that may.
    expect(code(LIB)).not.toContain('quit:check ✔')
    expect(code(LIB)).toContain('`quit:check ${cell.mark} ${cell.word} in ${closedIn} `')
  })
})

/* ══════════════ every reader of the token, derived and pinned ════════════════════════════ */

/**
 * A verdict token that moved must not leave a reader behind.
 *
 * Derived and pinned: the sweep does the covering, and the exact-equality assertion makes a file
 * joining or leaving the set a red somebody acknowledges in a diff. It walks the whole tree, so no
 * directory roster needs extending. The one reader a repository cannot assert is the PM's dispatch
 * briefs in the vault, which tell every agent to read this gate's line.
 *
 * `git grep`, not a `readFileSync` walk: reading every file in JavaScript measured 3.4 s idle and
 * timed out at the 5 s the `scripts` project allows on a busy machine; git scans the tree in under
 * a second. `--untracked`, because `git grep` and `git ls-files` default to committed files and
 * would be blind to files being added.
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
    // `git grep` exits 1 when it matches nothing, an ordinary answer arriving as an error. Any other
    // status is a broken instrument and must not read as an empty census.
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
      'scripts/app-closes-check.mjs',
      'scripts/lib/quit-verdict.mjs',
      'scripts/test/quit-verdict.test.mjs',
    ])
    // Both halves plant more than one: a sweep that could only return a single file, or silently
    // answered for one of the two tokens, would pin the same list by accident the day a second reader
    // arrived.
    expect(tick.length).toBeGreaterThan(1)
    expect(stopped.length).toBeGreaterThan(1)
    // A generous bound: the `scripts` project allows 5 s a test and a sweep measures under a second, but
    // a census that goes red because the machine was busy would be the failure this file guards against.
  }, 30_000)

  it('⚑ the controls: the instrument CAN name more, and naming the gate is not spelling a verdict', () => {
    // Without this the pin above is satisfied by an instrument that answers four files to everything.
    // `quit:check` alone names the chain, the gates and the prose.
    const named = spelling('quit:check')
    expect(named.length).toBeGreaterThan(1)
    expect(named).toContain('package.json')
    // ...and the discriminating negative: those files name the gate and spell no verdict.
    expect(spelling('quit:check ✔')).not.toContain('package.json')
    // ...and a needle nothing carries comes back empty rather than throwing, which decides whether an
    // exit code of 1 reads as "nobody" or as "the census did not run".
    // Assembled rather than spelled, because a needle written here is a needle this file carries: the
    // sweep would find its own source and the arm would never be exercised.
    expect(spelling(`quit:check ${String.fromCodePoint(0x1f41f)}`)).toEqual([])
  }, 30_000)
})
