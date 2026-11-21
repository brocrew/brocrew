import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atLeast, declaredMinimum, engineProblem, nvmrcMajor } from '../engine-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/**
 * Guards against a runtime change slipping in as if it were a code change: `package.json` said
 * `>=24.0.0` and `.nvmrc` said `24`, but nothing read those declarations, so a different `node`
 * on the `PATH` turned gates red with the code unchanged.
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
    // The reason, not just the rule: a version gate that says only "wrong version" gets worked
    // around. This one names the call whose behaviour differs and the gates that go through it,
    // which is why the number is 24.
    expect(problem).toContain('fs.rmSync is the JS rimraf on 20 and 22 and a C++ binding on 24')
    expect(problem).toContain('nvm use')
  })

  /**
   * The paired positive, which has to differ from the default: a check that complained about every
   * input would pass the test above. These two boundary readings must not complain.
   */
  it('⚑ …and accepts the declared minimum exactly, and anything above it', () => {
    expect(engineProblem({ running: '24.0.0', manifest: manifest('>=24.0.0'), nvmrc: '24' })).toBe(
      null,
    )
    expect(engineProblem({ running: '25.3.1', manifest: manifest('>=24.0.0'), nvmrc: '24' })).toBe(
      null,
    )
    // The patch below the minimum is still below it, so the comparison is on three numbers rather
    // than on the major alone.
    expect(
      engineProblem({ running: '24.0.0', manifest: manifest('>=24.0.1'), nvmrc: '24' }),
    ).toContain('node 24.0.0')
  })

  /**
   * A range it cannot read is a refusal, never a pass: a check that answered "fine" to
   * `^24 || ^25` would be the same failure as a holder lookup returning `[]` on any error.
   */
  it('⛔ throws on a range shape it has not been taught rather than letting it through', () => {
    expect(() => declaredMinimum('^24.0.0')).toThrow(/understands ">=X.Y.Z" and nothing else/)
    expect(() => declaredMinimum('>=24')).toThrow(/understands ">=X.Y.Z"/)
    expect(declaredMinimum('>=24.0.0')).toEqual([24, 0, 0])
    // A manifest with no declaration at all is not this file's decision to make.
    expect(() => engineProblem({ running: '24.0.2', manifest: '{}', nvmrc: '24' })).toThrow(
      /declares no engines.node/,
    )
  })

  /**
   * The remedy is only a remedy if `.nvmrc` names a version `engines` accepts. Two files declare
   * this runtime and can drift apart; the message says "use the `.nvmrc`", so the check must look.
   */
  it('⛔ says so when .nvmrc and engines.node disagree, whatever the running version is', () => {
    const problem = engineProblem({
      running: '24.0.2',
      manifest: manifest('>=24.0.0'),
      nvmrc: '20\n',
    })
    expect(problem).toContain('The two ')
    expect(problem).toContain('disagree')
    // Reported even though the running version is fine: a check that only looked when it was already
    // failing would find this the day it stopped being able to help.
    expect(problem).toContain('.nvmrc says "20"')
    expect(nvmrcMajor('lts/*')).toBe(null)
    expect(nvmrcMajor('v24.0.2')).toBe(24)
  })

  /**
   * It reads the declaration and keeps no copy of it. The control is the second half: the verdict
   * must move when the manifest moves, or "no literal in the source" is satisfied by a file that
   * ignores its input.
   */
  it('⚑ derives the minimum from package.json rather than restating it', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'engine-check.mjs'), 'utf8')
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/`[\s\S]*?`/g, '``')
    // No `24` anywhere in the executable text: when `engines` is raised, this file must not go on
    // enforcing the old number.
    expect(code).not.toMatch(/\b2[0-9]\b/)
    expect(code).toContain('JSON.parse(manifest).engines?.node')
    // The same running version reads as fine under one declaration and as a refusal under the next,
    // which is the only proof that the parse is load-bearing.
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
   * On the real files, with the real running version: the tests above are about the rule, this one
   * about the repo. If it fails, the gate is running on an unsupported runtime and the answer is in
   * the message.
   */
  it('⛔ the repo as it stands satisfies its own declaration', () => {
    expect(engineProblem()).toBe(null)
  })

  /**
   * The gate actually runs it, first. A check nothing invokes is a comment, and `ci` is a single
   * `&&` chain, so position decides whether it runs before anything else measures.
   */
  it('⛔ ci runs engine:check before every other step', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts
    expect(scripts['engine:check']).toBe('node scripts/engine-check.mjs')
    expect(scripts.ci.startsWith('pnpm run engine:check && ')).toBe(true)
  })
})
