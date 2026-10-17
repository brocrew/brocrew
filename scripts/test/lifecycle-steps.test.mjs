import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIFECYCLE_BUDGET_MS,
  LIFECYCLE_STEPS,
  LIFECYCLE_STEP_IDS,
  STEP_MS,
  lifecycleTable,
} from '../lib/lifecycle-steps.mjs'

/**
 * ⛔ **402 §3.3 · the runner reports from the OUTCOME, and this is where that is decidable.**
 *
 * ⚠️ **A live runner cannot test its own report**: the one thing that must be true — *a partial run
 * cannot print a success line* — is only observable on a run that was cut short, and cutting one
 * short costs a provider's worth of tokens. ⚑ So the report is a pure function of a journal, and
 * every shape a real run can hand it is constructed here.
 *
 * ⛔ **The census at the bottom is the half that keeps the two files honest.** The roster lives in
 * the runner and the observations live in the stage; two lists of the same strings are two things
 * that can disagree, and the disagreement would be invisible — a roster row nothing ever writes
 * reads as `NOT REACHED` on every run, forever, and looks like a model's fault.
 */
describe('lifecycleTable (402 §3.3)', () => {
  const allPassed = LIFECYCLE_STEP_IDS.map((step) => ({ step, verdict: 'PASS', what: 'x' }))

  it('⛔ a partial run cannot print a success line — the claim §3.3 makes by name', () => {
    // A run that died after three rows. Every row it DID reach passed.
    const partial = allPassed.slice(0, 3)
    const table = lifecycleTable(partial)
    expect(table.complete, 'three passing rows read as a performed lifecycle').toBe(false)
    expect(table.passed).toBe(3)
    expect(table.notReached).toBe(LIFECYCLE_STEP_IDS.length - 3)
    // ⚑ …and the paired positive, which is the only input that may print it.
    expect(lifecycleTable(allPassed).complete).toBe(true)
  })

  it('⛔ every step it could not perform is NAMED, never omitted', () => {
    const table = lifecycleTable(allPassed.slice(0, 1))
    expect(table.rows).toHaveLength(LIFECYCLE_STEP_IDS.length)
    for (const id of LIFECYCLE_STEP_IDS) {
      expect(
        table.rows.map((row) => row.id),
        `${id} fell out of the table`,
      ).toContain(id)
    }
    // The absence is spelled as an absence rather than as a verdict a run earned.
    expect(table.rows.at(-1)?.what).toMatch(/no observation was recorded/)
  })

  it('⛔ NOT PERFORMED and FAIL are counted apart, and neither counts toward complete', () => {
    for (const verdict of ['FAIL', 'NOT PERFORMED', 'NOT REACHED']) {
      const one = allPassed.map((row, index) => (index === 4 ? { ...row, verdict } : row))
      const table = lifecycleTable(one)
      expect(table.complete, `${verdict} read as complete`).toBe(false)
    }
    const mixed = lifecycleTable(
      allPassed.map((row, index) =>
        index === 2
          ? { ...row, verdict: 'FAIL' }
          : index === 3
            ? { ...row, verdict: 'NOT PERFORMED' }
            : row,
      ),
    )
    expect(mixed.failed).toBe(1)
    expect(mixed.notPerformed).toBe(1)
    expect(mixed.notReached).toBe(0)
  })

  it('🔴 the LAST observation of a step wins — a row may be corrected, never appended twice', () => {
    // The real shape: phase `a` writes a row, is killed, and phase `b` writes about the same
    // subject. An append-only journal has both; the table must not show two.
    const twice = [
      { step: LIFECYCLE_STEP_IDS[0], verdict: 'NOT PERFORMED', what: 'first look' },
      { step: LIFECYCLE_STEP_IDS[0], verdict: 'PASS', what: 'second look' },
    ]
    const table = lifecycleTable(twice)
    expect(table.rows.filter((row) => row.id === LIFECYCLE_STEP_IDS[0])).toHaveLength(1)
    expect(table.rows[0].verdict).toBe('PASS')
    expect(table.rows[0].what).toBe('second look')
  })

  it('⛔ an observation the diagram does not name is PRINTED, not dropped', () => {
    // `the stage itself` and `the kill never arrived` are both of this shape: they exist to carry a
    // failure the roster has no row for, and a table that silently dropped them would turn the
    // sharpest reds in the instrument into blank space.
    const table = lifecycleTable([
      ...allPassed,
      { step: 'the kill never arrived', verdict: 'FAIL', what: 'y' },
    ])
    expect(table.extra.map((row) => row.id)).toEqual(['the kill never arrived'])
    expect(table.complete, 'an unnamed FAIL was not counted against the run').toBe(false)
    expect(table.failed).toBe(1)
  })

  it('an empty journal is a run that proved nothing, and says so on every row', () => {
    const table = lifecycleTable([])
    expect(table.complete).toBe(false)
    expect(table.passed).toBe(0)
    expect(table.notReached).toBe(LIFECYCLE_STEP_IDS.length)
  })
})

describe('the roster and the observations are one list (402 §3)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const stage = readFileSync(
    join(here, '../../apps/desktop/smoke/lifecycle-stage.smoke.ts'),
    'utf8',
  )
  const runner = readFileSync(join(here, '../lifecycle-runner.mjs'), 'utf8')

  /**
   * Every string literal handed to `note(` as its first argument, in either file.
   *
   * ⛔ **Read from the CALL SITE and not from a table of names** — the defect this is here for is a
   * roster row that no call ever writes, and a census that read a second list would be blind to it
   * in exactly the same way the roster is.
   */
  const noted = (source) =>
    [...source.matchAll(/\bnote\(\s*\n?\s*'([^']+)'/g)].map((match) => match[1])

  it('⛔ every roster row is written by SOMETHING, and its owner is the file that writes it', () => {
    const fromStage = new Set(noted(stage))
    const fromRunner = new Set(noted(runner))
    // ⚠️ Two positive controls, so a regex that matched nothing would fail here rather than pass
    // this test by finding no violations. `319`'s rule: a census with no control is a census that
    // cannot tell "clean" from "blind".
    expect(fromStage.size, 'the stage census found no note() calls at all').toBeGreaterThan(10)
    expect(fromRunner.size, 'the runner census found no note() calls at all').toBeGreaterThan(0)

    for (const step of LIFECYCLE_STEPS) {
      const written = step.owner === 'runner' ? fromRunner : fromStage
      expect(written.has(step.id), `${step.owner} never writes "${step.id}"`).toBe(true)
    }
  })

  it('⛔ …and the runner owns exactly the row a killed process could not report', () => {
    // 🔴 **The whole reason `owner` exists.** A stage that reported its own kill would be reporting
    // an intention: the row is written before the signal, and the process that would correct it is
    // the one that dies. Exactly one row may be the runner's, and this is which.
    const runnerRows = LIFECYCLE_STEPS.filter((step) => step.owner === 'runner')
    expect(runnerRows.map((step) => step.id)).toEqual([
      '12 the app is killed while that work is open',
    ])
    expect(new Set(noted(stage)).has(runnerRows[0].id), 'the stage also claims the kill row').toBe(
      false,
    )
  })

  /**
   * 🔴 **410 §5 · the budget is two files and a typo in it is invisible until minute twenty.**
   *
   * ⛔ **The runner OWNS the table and the stage SPENDS it, by name, through one env var.** That is
   * the right shape — a second copy in the stage would be a budget a reader could not check against
   * the run that obeyed it — ⚠️ **but a name is a string, and `bound('workerSpwan')` compiles.** The
   * stage refuses at that call rather than defaulting, which is correct and is also a LIVE-ONLY
   * guard: it fires eight minutes into a provider run, having already spent them.
   *
   * ⚑ So the two ends are held together here, where it costs nothing.
   */
  it('⛔ every bound the stage spends is a bound the runner states', () => {
    const asked = [...stage.matchAll(/\bbound\('([a-zA-Z]+)'\)/g)].map((match) => match[1])
    // Two positive controls — `319`'s rule. A regex that matched nothing would otherwise pass this
    // by finding no violations, and the count is the second half: the stage spends more than a
    // couple of these, so a pattern that found one would be as wrong as one that found none.
    expect(asked.length, 'the bound census found no call sites at all').toBeGreaterThan(10)
    expect(new Set(asked).size, 'the bound census found only one distinct bound').toBeGreaterThan(8)
    for (const name of new Set(asked)) {
      expect(
        Object.keys(STEP_MS),
        `the stage spends \`${name}\`, which the runner never states`,
      ).toContain(name)
    }
  })

  it('⛔ …and every bound the runner states is spent by something', () => {
    // 🔴 **The other direction, and it is the one that rots quietly.** A key nothing asks for is a
    // number in the stated budget that no step can consume — so the total a reader is promised is
    // larger than the total the run can possibly spend, and the promise stops being a bound.
    const spent = new Set([...stage.matchAll(/\bbound\('([a-zA-Z]+)'\)/g)].map((match) => match[1]))
    for (const name of Object.keys(STEP_MS)) {
      expect(spent.has(name), `the runner states \`${name}\`, which nothing spends`).toBe(true)
    }
  })

  it('⛔ the stated budget is the SUM of what phase a can spend, and nothing rounder', () => {
    // ⚠️ **A total written as a number is a number that stops tracking the table.** `402`'s runner
    // held fifty minutes on one wait while the stage's own waits summed to seventy-one; the figure
    // and the instrument had never been the same thing. ⛔ This asserts they are one derivation.
    const { phaseA, phaseB, margin } = LIFECYCLE_BUDGET_MS
    const everyBound = Object.values(STEP_MS).reduce((sum, ms) => sum + ms, 0)
    // 🔴 **EVERY bound is in the sum since `445`, and the subtraction that used to be here is the
    // change.** ⛔ It read `everyBound - STEP_MS.questionCodex`, because the question step had a
    // provider-specific twin and a run spent one or the other. ⚑ `437` published `ask_parent`, so
    // the step is one step on both providers and the table states one number for it — and a
    // subtraction left in place would be a key nothing spends, which the test above this one
    // exists to catch from the other side.
    expect(phaseA + phaseB).toBe(everyBound)
    expect(margin).toBeGreaterThan(0)
  })

  it('⛔ the diagram note HO-018 amended is performed nowhere', () => {
    // ⚠️ **`399` §5's readings are of a tree that no longer exists**, and the two words that carried
    // the amended behaviour are the ones to keep out: nothing in this instrument may fail a task on
    // a timeout, and nothing may treat a restart as terminal. `400` retired both.
    for (const [file, source] of [
      ['the stage', stage],
      ['the runner', runner],
    ]) {
      expect(source, `${file} still names a retired task state`).not.toMatch(/'abandoned'|'silent'/)
    }
    // ⚑ The paired positive: the words that REPLACED them are both here, on the rows that assert
    // the amendment.
    expect(stage).toContain("'app_restarted'")
    expect(stage).toContain('work_restarted')
  })
})

/**
 * 🔴 **669 · R17 — the lifecycle stage measures the product as it ships, and never rebuilds an old
 * one.**
 *
 * ⛔ A fresh install ships `brobot` alone and every agent holds one default set of grants (D-014), so
 * a stage that granted a tier anything, brought the worker into being by a handshake, or asked
 * BroBot to give work to a name nobody created would describe a product that does not exist. ⚑ Each check
 * below fails on such a story. {@link r17Findings} is run on planted copies of it — a person's grant,
 * the worker's handshake, the old brief — and of the review's defects — a late read, a misplaced
 * 1c — so its NEGATIVE checks are shown able to fire (rule 12). ⚠️ Its presence checks match one
 * line of code each: they prove the verdict's clause exists, not that it is reached, which is what
 * the rows' own evidence strings are for.
 */
describe('669 · R17 — the lifecycle stage performs the product as it ships', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const stage = readFileSync(
    join(here, '../../apps/desktop/smoke/lifecycle-stage.smoke.ts'),
    'utf8',
  )
  const codeOf = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  /** Every way the stage could slide back into a story the product no longer tells, by name. */
  const r17Findings = (source) => {
    const code = codeOf(source)
    const found = []
    if (/\bsetCapabilities\(/.test(code)) found.push('it grants a capability through the store')
    if (/profileId: WORKER_PROFILE_ID/.test(code))
      found.push('it opens a conversation as the worker')
    if (/running as `' \+ (?:PROJECT_MANAGER|WORKER)_PROFILE_ID/.test(code)) {
      found.push('a brief asks to give work to a name nobody created')
    }
    if (!/isDeepStrictEqual\(held, DEFAULT_CAPABILITIES\)/.test(code))
      found.push('row 1 does not read BroBot against the one default set')
    if (
      !/isDeepStrictEqual\(pmCreatedBy, \{\s*by: 'an-agent',\s*agent: DEFAULT_PROFILE_ID,?\s*\}\)/.test(
        code,
      )
    ) {
      found.push('row 2 does not require BroBot to have created what it started')
    }
    if (
      !/isDeepStrictEqual\(workerCreatedBy, \{ by: 'an-agent', agent: PROJECT_MANAGER_PROFILE_ID \}\)/.test(
        code,
      )
    ) {
      found.push('row 4 does not require the project manager to have created what it started')
    }
    if (
      !/isDeepStrictEqual\(createdBy, \{ by: 'an-agent', agent: WORKER_PROFILE_ID \}\)/.test(code)
    ) {
      found.push('row 6 does not require the worker to have created what it started')
    }
    if (!/isDeepStrictEqual\(rows\[at\]\?\.capabilities, DEFAULT_CAPABILITIES\)/.test(code)) {
      found.push('row 1c does not read each tier against the one default set')
    }
    if (!/subAgents: subAgentToolsOf\(slug\)/.test(code)) {
      found.push('row 1c does not read the CLI sub-agents each launch published')
    }
    if (!/if \(rows\.some\(\(row\) => row === null\)\) \{\s*noteChoice\(\s*'1c/.test(code)) {
      found.push('row 1c scores a tier the run never created as FAIL')
    }
    // ⚠️ Where, not how many: each call sits right before the park on its path (the third round).
    if (
      (code.match(/\bnoteTheTiers\(\)/g) ?? []).length !== 2 ||
      !/noteTheTiers\(\)\s*return await parkForTheKill\('no project manager to work through'\)/.test(
        code,
      ) ||
      !/noteTheTiers\(\)\s*if \(explorer === null\) return await parkForTheKill\('no worker to be mid-turn'\)/.test(
        code,
      )
    ) {
      found.push('row 1c is not written on both paths past row 2')
    }
    // ⛔ 1b's only window: after BroBot's first conversation, before any model has had a turn.
    const read = code.indexOf('const shippedIdentities = store.agentIdentities()')
    const firstClose = code.indexOf('await host.close(firstBroBot.sessionId, person)')
    const firstTurn = code.indexOf('await host.send(brobot.sessionId, personsBrief(), person)')
    if (!(firstClose > -1 && read > firstClose && firstTurn > read)) {
      found.push('row 1b reads the identities after a model has had a turn')
    }
    // ⛔ …and every other fact it reports is read in the same window (the third round).
    const pmRead = code.indexOf(
      'const projectManagerShipped = store.capabilitiesOf(PROJECT_MANAGER_PROFILE_ID) !== null',
    )
    if (
      !(pmRead > firstClose && firstTurn > pmRead) ||
      (code.match(/store\.capabilitiesOf\(PROJECT_MANAGER_PROFILE_ID\)/g) ?? []).length !== 1
    ) {
      found.push('row 1b reads the project manager’s row after a model has had a turn')
    }
    return found
  }

  it('⛔ the stage grants nothing, starts only what a tier created, and reads the one default set', () => {
    expect(r17Findings(stage)).toEqual([])
    // ⚑ The two briefs name what to CREATE and what it is — and no tool (347's rule). ⚑ D-016: the
    // verbs a brief could name instead are the two that bring an agent into being.
    expect(stage).toContain("'1. Bring one new agent into existence, called `' +")
    const start = stage.indexOf('function personsBrief(')
    expect(start, 'function personsBrief(').toBeGreaterThan(-1)
    const briefs = codeOf(stage.slice(start, stage.indexOf('\n}\n', start)))
    expect(briefs).toContain('Bring one new agent into existence')
    expect(briefs).not.toMatch(/\b(?:create_agent|give_work)\b/)
  })

  it('🔴 the planted old story is caught — twice over (rule 12)', () => {
    // ⛔ A person's tier-2 grant, the shape the stage had before R17.
    const personGrants = stage.replace(
      'const shippedIdentities = store.agentIdentities()',
      "store.setCapabilities(PROJECT_MANAGER_PROFILE_ID, { canCreateAgents: 'any' })\n" +
        '    const shippedIdentities = store.agentIdentities()',
    )
    expect(r17Findings(personGrants)).toEqual(['it grants a capability through the store'])
    // ⛔ The old brief, asking BroBot to give work to a project manager nobody created.
    const oldBrief = stage.replace(
      "'1. Bring one new agent into existence, called `' +\n      PROJECT_MANAGER_PROFILE_ID +\n" +
        "      '`, as a project manager, and give it this ticket as a piece of work whose brief is',",
      "'1. Put one agent to work on this, running as `' + PROJECT_MANAGER_PROFILE_ID + '`.',",
    )
    expect(oldBrief).not.toBe(stage)
    expect(r17Findings(oldBrief)).toEqual(['a brief asks to give work to a name nobody created'])
    // ⛔ The worker brought into being by a handshake, as the old row 1 did.
    const handshake = stage.replace(
      'const shippedIdentities = store.agentIdentities()',
      'await host.createSession({ provider: PROVIDER, profileId: WORKER_PROFILE_ID, cwd: work }, person)\n' +
        '    const shippedIdentities = store.agentIdentities()',
    )
    expect(handshake).not.toBe(stage)
    expect(r17Findings(handshake)).toEqual(['it opens a conversation as the worker'])
    // ⛔ 1b read after the ticket's first turn — where any agent could have minted an identity.
    const lateRead = stage
      .replace('    const shippedIdentities = store.agentIdentities().map((one) => one.slug)\n', '')
      .replace(
        '    await host.send(brobot.sessionId, personsBrief(), person)\n',
        '    await host.send(brobot.sessionId, personsBrief(), person)\n' +
          '    const shippedIdentities = store.agentIdentities().map((one) => one.slug)\n',
      )
    expect(lateRead).not.toBe(stage)
    expect(r17Findings(lateRead)).toEqual([
      'row 1b reads the identities after a model has had a turn',
    ])
    // ⛔ The project manager's row read in the verdict again — a second read of it.
    const latePmRead = stage.replace(
      '&& !projectManagerShipped',
      '&& store.capabilitiesOf(PROJECT_MANAGER_PROFILE_ID) === null',
    )
    expect(latePmRead).not.toBe(stage)
    expect(r17Findings(latePmRead)).toEqual([
      'row 1b reads the project manager’s row after a model has had a turn',
    ])
    // ⛔ Row 4's 1c moved below the worker's park — two calls still, and one path without it.
    const misplaced = stage.replace(
      "    noteTheTiers()\n    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')",
      "    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')\n    noteTheTiers()",
    )
    expect(misplaced).not.toBe(stage)
    expect(r17Findings(misplaced)).toEqual(['row 1c is not written on both paths past row 2'])
  })
})
