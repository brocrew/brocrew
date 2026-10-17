import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atLeast, declaredMinimum, engineProblem, nvmrcMajor } from '../engine-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/**
 * 🔴 **387 · the gate that let a runtime change through as if it were a code change.**
 *
 * ⛔ `owned-teardown.test.mjs` was red on `main` for three dispatches with its subject and its suite
 * byte-identical to the commit that shipped them. Nothing in the tree had moved; the `node` on the
 * `PATH` had. ⚠️ `package.json` said `>=24.0.0` and `.nvmrc` said `24` the whole time — **a
 * declaration nothing read.**
 */
describe('engine:check · the runtime the repo declares', () => {
  const manifest = (range) => JSON.stringify({ engines: { node: range } })

  it('⛔ refuses a runtime below the declared minimum, and says what to do about it', () => {
    const problem = engineProblem({
      running: '20.19.3',
      manifest: manifest('>=24.0.0'),
      nvmrc: '24\n',
    })
    expect(problem).toContain('node 20.19.3')
    expect(problem).toContain('>=24.0.0')
    // ⛔ **The reason, not just the rule.** A version gate that says only *"wrong version"* gets
    // worked around; this one names the call whose behaviour differs and the gates that go through
    // it, which is the whole of why the number is 24 rather than a preference.
    expect(problem).toContain('fs.rmSync is the JS rimraf on 20 and 22 and a C++ binding on 24')
    expect(problem).toContain('nvm use')
  })

  /**
   * ⚑ **The paired positive, and it has to differ from the default.** A check that returned a
   * complaint for every input would pass the test above; these are the two boundary readings that
   * must not complain.
   */
  it('⚑ …and accepts the declared minimum exactly, and anything above it', () => {
    expect(engineProblem({ running: '24.0.0', manifest: manifest('>=24.0.0'), nvmrc: '24' })).toBe(
      null,
    )
    expect(engineProblem({ running: '25.3.1', manifest: manifest('>=24.0.0'), nvmrc: '24' })).toBe(
      null,
    )
    // ⛔ …and the patch below it is still below it, so the comparison is on three numbers rather
    // than on the major alone.
    expect(
      engineProblem({ running: '24.0.0', manifest: manifest('>=24.0.1'), nvmrc: '24' }),
    ).toContain('node 24.0.0')
  })

  /**
   * ⛔ **A range it cannot read is a refusal, never a pass.** `325`'s `holdersOf` returned `[]` on
   * any failure and the caller read that as *"nothing holds the port"*; a version check that
   * answered *"fine"* to `^24 || ^25` would be the same defect one file over.
   */
  it('⛔ throws on a range shape it has not been taught rather than letting it through', () => {
    expect(() => declaredMinimum('^24.0.0')).toThrow(/understands ">=X.Y.Z" and nothing else/)
    expect(() => declaredMinimum('>=24')).toThrow(/understands ">=X.Y.Z"/)
    expect(declaredMinimum('>=24.0.0')).toEqual([24, 0, 0])
    // ⚠️ …and a manifest with no declaration at all is not this file's decision to make.
    expect(() => engineProblem({ running: '24.0.2', manifest: '{}', nvmrc: '24' })).toThrow(
      /declares no engines.node/,
    )
  })

  /**
   * 🔴 **The remedy is only a remedy if `.nvmrc` names a version `engines` accepts.** Two files
   * declare this runtime and they are free to drift apart; the message says *"use the `.nvmrc`"*,
   * so the check has to have looked.
   */
  it('⛔ says so when .nvmrc and engines.node disagree, whatever the running version is', () => {
    const problem = engineProblem({
      running: '24.0.2',
      manifest: manifest('>=24.0.0'),
      nvmrc: '20\n',
    })
    expect(problem).toContain('The two ')
    expect(problem).toContain('disagree')
    // ⛔ …and it is reported even though the RUNNING version is fine — a check that only looked
    // when it was already failing would find this the day it stopped being able to help.
    expect(problem).toContain('.nvmrc says "20"')
    expect(nvmrcMajor('lts/*')).toBe(null)
    expect(nvmrcMajor('v24.0.2')).toBe(24)
  })

  /**
   * ⛔ **It reads the declaration; it does not keep a copy of it** (standing rule 8, said about a
   * number instead of a sentence). ⚠️ The control is the second half: the verdict has to MOVE when
   * the manifest moves, or "no literal in the source" is satisfied by a file that ignores its input.
   */
  it('⚑ derives the minimum from package.json rather than restating it', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'engine-check.mjs'), 'utf8')
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/`[\s\S]*?`/g, '``')
    // ⛔ No `24` anywhere in the executable text: the day `engines` is raised, this file must not go
    // on enforcing the old number.
    expect(code).not.toMatch(/\b2[0-9]\b/)
    expect(code).toContain('JSON.parse(manifest).engines?.node')
    // ⚑ …and the same running version reads as fine under one declaration and as a refusal under
    // the next one, which is the only proof that the parse is load-bearing.
    expect(engineProblem({ running: '24.0.2', manifest: manifest('>=24.0.0'), nvmrc: '24' })).toBe(
      null,
    )
    expect(
      engineProblem({ running: '24.0.2', manifest: manifest('>=26.0.0'), nvmrc: '26' }),
    ).toContain('>=26.0.0')
  })

  it('atLeast compares major, then minor, then patch', () => {
    expect(atLeast([24, 0, 0], [24, 0, 0])).toBe(true)
    expect(atLeast([24, 0, 0], [23, 99, 99])).toBe(true)
    expect(atLeast([23, 99, 99], [24, 0, 0])).toBe(false)
    expect(atLeast([24, 1, 0], [24, 0, 9])).toBe(true)
    expect(atLeast([24, 0, 1], [24, 0, 2])).toBe(false)
  })

  /**
   * ⚑ **On the real files, with the real running version** — the two above are about the rule and
   * this is about the repo. ⛔ If it ever fails, the gate is being run on a runtime it does not
   * support and the answer is in the message, not in this test.
   */
  it('⛔ the repo as it stands satisfies its own declaration', () => {
    expect(engineProblem()).toBe(null)
  })

  /**
   * ⛔ **…and the gate actually runs it, first.** A check nothing invokes is a comment: `ci` is a
   * single `&&` chain, so the position is the whole of *"before anything else measures the wrong
   * function"*.
   */
  it('⛔ ci runs engine:check before every other step', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts
    expect(scripts['engine:check']).toBe('node scripts/engine-check.mjs')
    expect(scripts.ci.startsWith('pnpm run engine:check && ')).toBe(true)
  })
})
