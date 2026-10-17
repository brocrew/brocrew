import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as helper from '../../packages/runtime/smoke/probe-run-deadline.ts'
import smokeConfig from '../../vitest.smoke.config.ts'
import { typescriptAt } from '../lib/page-ipc-census.mjs'
import {
  adoptionOf,
  bareOpens,
  boundThatFiresFirst,
  budgetOf,
  smokeFilesIn,
  uncappedForeverLoops,
  unguardedOpens,
  unrefusedOpens,
  valueIn,
  waitsCountedWhereMade,
} from '../lib/smoke-deadline-census.mjs'
import { SMOKES_NOT_ON_THE_HELPER } from '../lib/smoke-deadline-debt.mjs'

/**
 * ⛔ **669 · every smoke file is on `probe-run-deadline.ts` or named as not, and each adopter's budget
 * is measured against the bound vitest actually applies** (`655` G1 and G2).
 *
 * `pnpm run ci` never runs a smoke, so this is where the rule lives. ⚑ Everything is derived: the
 * files from `vitest.smoke.config.ts`'s own `include`, each budget from its file's own declarations,
 * and a live smoke's waits from the call sites that make them — see `scripts/lib/smoke-deadline-census.mjs`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ts = typescriptAt(root)
const read = (file) => readFileSync(join(root, file), 'utf8')
const files = smokeFilesIn(root, smokeConfig.test.include).map((file) => file.replaceAll('\\', '/'))
const adopters = files.filter((file) => adoptionOf(ts, read(file), file).onHelper)

/** A planted adopter in the template's shape — the positive control every census below needs. */
const ADOPTER = `
import { it } from 'vitest'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
const WAIT_MS = 1_000
const TEARDOWN_MS = 6_000
const WAITS = [WAIT_MS, WAIT_MS, TEARDOWN_MS]
const deadline = probeRunDeadline('planted', runBudgetMs(WAITS), TEARDOWN_MS)
async function one(): Promise<void> {}
async function two(): Promise<void> {}
it('one', () => deadline.within('one', one), deadline.testTimeoutMs)
it('two', () => deadline.within('two', two), deadline.testTimeoutMs)
`

describe('669 · G1 — every smoke file is on the helper, or NAMED as not', () => {
  it('⚑ the config’s own globs find the smoke files, in both trees', () => {
    expect(smokeConfig.test.include).toEqual([
      'packages/*/smoke/**/*.smoke.ts',
      'apps/*/smoke/**/*.smoke.ts',
    ])
    expect(files).toContain('packages/runtime/smoke/claude-live.smoke.ts')
    expect(files).toContain('apps/desktop/smoke/lifecycle-stage.smoke.ts')
  })

  it('⛔ each is exactly ONE of: on the helper, or named in SMOKES_NOT_ON_THE_HELPER', () => {
    const named = new Set(SMOKES_NOT_ON_THE_HELPER)
    for (const file of files) {
      const on = adopters.includes(file)
      expect(
        on !== named.has(file),
        `${file} is ${on ? 'on the helper AND named' : 'neither'}`,
      ).toBe(true)
    }
    // ⚠️ A name that no longer runs is a claim about nothing — remove it with its file.
    for (const name of named) expect(files, `${name} is named but is not a smoke`).toContain(name)
    expect(named.size, 'a name listed twice').toBe(SMOKES_NOT_ON_THE_HELPER.length)
  })

  it('⚑ forty-six are on it — the thirteen before `684`, `684`’s reader-brevity probe, `680`’s two, `695`’s three, `697`’s one, `704`’s one, `706`’s one, `708`’s two, `709`’s two, `715`’s two, `721`’s one, `722`’s one, `723`’s one, `728`’s one, `740`’s one, `741`’s two, the login-token reach probe, the Codex plan-tool probe, the provider-burst probe, the providers’ snapshots, the usage-windows probe, the two work-folder probes, the installed Claude Code probe, the scheduling receipts probe, the which-account probe and the probe of a refused Codex turn sent again', () => {
    expect(adopters).toEqual([
      'apps/desktop/smoke/provider-snapshots.smoke.ts',
      'apps/desktop/smoke/what-reaches-a-person-is-short.smoke.ts',
      'apps/desktop/smoke/which-account-claude-says.smoke.ts',
      'packages/runtime/smoke/claude-command-as-typed-probe.smoke.ts',
      'packages/runtime/smoke/claude-installed-probe.smoke.ts',
      'packages/runtime/smoke/claude-launch-id-probe.smoke.ts',
      'packages/runtime/smoke/claude-limit-notice-probe.smoke.ts',
      'packages/runtime/smoke/claude-live.smoke.ts',
      'packages/runtime/smoke/claude-origin-wire-probe.smoke.ts',
      'packages/runtime/smoke/claude-plan-resume-probe.smoke.ts',
      'packages/runtime/smoke/claude-provider-burst-probe.smoke.ts',
      'packages/runtime/smoke/claude-resume-after-cd-probe.smoke.ts',
      'packages/runtime/smoke/claude-resume-model-probe.smoke.ts',
      'packages/runtime/smoke/claude-scan-after-cd-probe.smoke.ts',
      'packages/runtime/smoke/claude-scheduling-receipts-probe.smoke.ts',
      'packages/runtime/smoke/claude-stopped-word-probe.smoke.ts',
      'packages/runtime/smoke/claude-tool-answer-probe.smoke.ts',
      'packages/runtime/smoke/claude-usage-windows-probe.smoke.ts',
      'packages/runtime/smoke/claude-work-folders-probe.smoke.ts',
      'packages/runtime/smoke/codex-a-refused-turn-sent-again-probe.smoke.ts',
      'packages/runtime/smoke/codex-approval-reason-probe.smoke.ts',
      'packages/runtime/smoke/codex-cancel-interrupt-probe.smoke.ts',
      'packages/runtime/smoke/codex-command-always-probe.smoke.ts',
      'packages/runtime/smoke/codex-command-as-typed-probe.smoke.ts',
      'packages/runtime/smoke/codex-dynamic-tools-probe.smoke.ts',
      'packages/runtime/smoke/codex-early-interrupt-probe.smoke.ts',
      'packages/runtime/smoke/codex-exec-permission-approval.smoke.ts',
      'packages/runtime/smoke/codex-external-mcp-probe.smoke.ts',
      'packages/runtime/smoke/codex-live.smoke.ts',
      'packages/runtime/smoke/codex-lost-thread-probe.smoke.ts',
      'packages/runtime/smoke/codex-mcp-tool-approval-probe.smoke.ts',
      'packages/runtime/smoke/codex-plan-resume-probe.smoke.ts',
      'packages/runtime/smoke/codex-plan-tool-probe.smoke.ts',
      'packages/runtime/smoke/codex-reopen-grant-probe.smoke.ts',
      'packages/runtime/smoke/codex-request-id-probe.smoke.ts',
      'packages/runtime/smoke/codex-resume-after-cd-probe.smoke.ts',
      'packages/runtime/smoke/codex-resume-model-probe.smoke.ts',
      'packages/runtime/smoke/codex-tool-answer-probe.smoke.ts',
      'packages/runtime/smoke/codex-work-folders-probe.smoke.ts',
      'packages/runtime/smoke/interruption-construction.smoke.ts',
      'packages/runtime/smoke/main-thread-block-probe.smoke.ts',
      'packages/runtime/smoke/model-floor-refusal-probe.smoke.ts',
      'packages/runtime/smoke/per-task-stop-probe.smoke.ts',
      'packages/runtime/smoke/permission-markers-probe.smoke.ts',
      'packages/runtime/smoke/token-reach-probe.smoke.ts',
      'packages/runtime/smoke/tool-calls-as-the-cli-probe.smoke.ts',
    ])
  })

  it('⚑ the debt, stated as numbers: forty-eight of ninety-four are not on it yet', () => {
    // ⚠️ Lower the first number when a file is converted; raising it is a decision, not a drift.
    // ⚑ `675` added a probe born on the helper, `677` two more, `679` one, `684` one, `680` two,
    // `695` three, `697` one (`672`'s reopen-grant instrument, landed), `704` one (the early
    // interrupt), `706` one (Codex's lost thread), `708` two (`R42`'s command probes, Claude and
    // Codex), `709` two (`704`'s approval-reason capture, landed, and Claude's stopped-turn word) and
    // `715` two (`R64`'s resume-after-`cd` probes, Claude and Codex), `721` one (`R77`'s scan after a
    // `cd`), `722` one (`R79`'s launch-id probe) and `723` one (`R80`'s MCP tool-approval probe, through
    // the product's runtime) and `728` one (`R93`'s CLI-versus-product probe on Claude), and `740` one
    // (`R99`'s Codex command *always*, through the product), and `741` two (`R99`'s plan-resume probes,
    // Claude and Codex), so the total moved and the debt did not — counted on the merged tree, not
    // added up from either branch. ⚑ D-016 deleted two files that were not on it (the two project
    // smokes), so the debt and the total each fell by two. The login-token reach probe was born on
    // the helper, so the total moved and the debt did not. So was the Codex plan-tool probe
    // (provider follow-ups 1), and the provider-burst probe (F080), and the providers' snapshots,
    // and the usage-windows probe, and the two work-folder probes, and the installed Claude Code
    // probe, and the scheduling receipts probe, and the which-account probe, and the probe of a
    // refused Codex turn sent again. The archive sweep's smoke was on it, and went with the sweep, so
    // the total fell by one and the debt did not.
    expect(SMOKES_NOT_ON_THE_HELPER).toHaveLength(48)
    expect(files).toHaveLength(94)
  })

  it('🔴 the classifier, on planted sources — two tests, and the SECOND is the one that is caught', () => {
    expect(adoptionOf(ts, ADOPTER)).toMatchObject({
      onHelper: true,
      deadline: 'deadline',
      tests: 2,
    })
    // ⛔ A bounded test beside an unbounded one — the shape a census that read the first `it()`
    // would pass (rule 12: plant TWO).
    const second = adoptionOf(ts, `${ADOPTER}\nit('three', async () => {})\n`)
    expect(second.onHelper).toBe(false)
    expect(second.why.join('\n')).toMatch(/line 13: it\(…\) is not/)
    // Each other way off the template, one fact at a time.
    const noTimeout = ADOPTER.replace(
      "it('two', () => deadline.within('two', two), deadline.testTimeoutMs)",
      "it('two', () => deadline.within('two', two))",
    )
    expect(adoptionOf(ts, noTimeout).onHelper).toBe(false)
    const notWithin = ADOPTER.replace(
      "it('two', () => deadline.within('two', two), deadline.testTimeoutMs)",
      "it('two', two, deadline.testTimeoutMs)",
    )
    expect(adoptionOf(ts, notWithin).onHelper).toBe(false)
    const skipped = ADOPTER.replace("it('two',", "it.skip('two',")
    expect(adoptionOf(ts, skipped).why.join('\n')).toMatch(/it\.skip\(…\)/)
    const notImported = ADOPTER.replace('probeRunDeadline, runBudgetMs', 'runBudgetMs')
    expect(adoptionOf(ts, notImported).why).toContain('it does not import probeRunDeadline')
    const twoDeadlines = `${ADOPTER}\nconst other = probeRunDeadline('x', 1, 1)\n`
    expect(adoptionOf(ts, twoDeadlines).onHelper).toBe(false)
    expect(adoptionOf(ts, "import { it } from 'vitest'\n").why).toContain('it registers no test')
  })

  it('🔴 work registered under another NAME, in a hook, or at the top level is outside the deadline', () => {
    // ⛔ `test` imported as something else is still a test — the name is not the registrar.
    const aliased = ADOPTER.replace(
      "import { it } from 'vitest'",
      "import { it, test as live } from 'vitest'",
    ).concat("live('extra', async () => {})\n")
    expect(adoptionOf(ts, aliased).why.join('\n')).toMatch(/live\(…\) is not/)
    // ⛔ …and so is a namespace's.
    const namespaced = ADOPTER.replace(
      "import { it } from 'vitest'",
      "import { it } from 'vitest'\nimport * as v from 'vitest'",
    ).concat("v.test('extra', async () => {})\n")
    expect(adoptionOf(ts, namespaced).why.join('\n')).toMatch(/v\.test\(…\) is not/)
    // ⛔ A hook runs beside the tests and outside every deadline, under whatever name it came in.
    const hooked = ADOPTER.replace(
      "import { it } from 'vitest'",
      "import { it, afterAll as later } from 'vitest'",
    ).concat('later(async () => {})\n')
    expect(adoptionOf(ts, hooked).why.join('\n')).toMatch(/later\(…\) runs work outside/)
    // ⛔ Top-level `await` runs at import.
    const atImport = ADOPTER.concat('await one()\n')
    expect(adoptionOf(ts, atImport).why.join('\n')).toMatch(/top-level await/)
    // ⛔ vitest 4's around-hooks run beside the tests too.
    const around = ADOPTER.replace(
      "import { it } from 'vitest'",
      "import { it, aroundAll } from 'vitest'",
    ).concat('aroundAll(async (runSuite) => { await runSuite() })\n')
    expect(adoptionOf(ts, around).why.join('\n')).toMatch(/aroundAll\(…\) runs work outside/)
    // ⚑ The control: an alias used the template's way is on the helper.
    const aliasedRight = ADOPTER.replaceAll("it('", "live('").replace(
      "import { it } from 'vitest'",
      "import { it as live } from 'vitest'",
    )
    expect(adoptionOf(ts, aliasedRight).onHelper).toBe(true)
  })
})

describe('669 · G2 — each adopter’s budget, against the bound vitest actually applies', () => {
  const configTimeoutMs = smokeConfig.test.testTimeout

  it('⚑ the config’s ceiling is the one `655` measured: twenty minutes', () => {
    expect(configTimeoutMs).toBe(1_200_000)
  })

  it('⛔ for every adopter the DEADLINE fires first — never vitest', () => {
    for (const file of adopters) {
      const source = read(file)
      const budget = budgetOf(ts, source, helper, { name: file })
      expect(budget.budgetMs, file).toBeGreaterThan(0)
      expect(boundThatFiresFirst(ts, source, helper, configTimeoutMs, file), file).toEqual({
        fires: 'the deadline',
        vitestMs: budget.testTimeoutMs,
        deadlineMs: budget.budgetMs + budget.teardownMs,
      })
    }
  })

  it('⚠️ twelve derive a budget ABOVE the config’s twenty minutes — bounded only by their own timeout', () => {
    // ⚑ Stated, so the next reader knows which files would be cut off by vitest's generic timeout
    // if their `it()` ever stopped carrying `deadline.testTimeoutMs` — the G2 defect, one edit away.
    const above = adopters.filter(
      (file) => budgetOf(ts, read(file), helper, { name: file }).budgetMs > configTimeoutMs,
    )
    expect(above).toEqual([
      // Six launches with a turn (the resume's two among them) and a model list, each turn's
      // launch counting its start, send, turn, close and its child's exit, derived; its own
      // `testTimeoutMs` fires.
      'packages/runtime/smoke/claude-installed-probe.smoke.ts',
      'packages/runtime/smoke/claude-live.smoke.ts',
      // ⚑ **F080** — five arms, two lives each of four bounded waits, derived; its own
      // `testTimeoutMs` fires.
      'packages/runtime/smoke/claude-provider-burst-probe.smoke.ts',
      // ⚑ **709** — four arms, each counting its start AND its send against 60 s, derived.
      'packages/runtime/smoke/claude-stopped-word-probe.smoke.ts',
      // ⚑ **709** — three arms and eleven turns, two 30 s waits per turn, derived.
      'packages/runtime/smoke/codex-approval-reason-probe.smoke.ts',
      // ⚑ **713** — nine arms of seven bounded waits each (two new compaction arms and the product's
      // own `compact()`), derived; its own `testTimeoutMs` fires. Measured run: under a minute.
      'packages/runtime/smoke/codex-command-as-typed-probe.smoke.ts',
      'packages/runtime/smoke/codex-external-mcp-probe.smoke.ts',
      'packages/runtime/smoke/codex-live.smoke.ts',
      // ⚑ **723** — ten arms and thirteen turns, two 30 s waits per turn, derived; its own
      // `testTimeoutMs` fires. Measured run: about ten seconds. ⚑ **728** — thirteen arms and
      // sixteen turns now; measured run, about twenty-five seconds.
      'packages/runtime/smoke/codex-mcp-tool-approval-probe.smoke.ts',
      // ⚑ **677** — seven steps of four bounded waits each, derived; its own `testTimeoutMs` fires.
      'packages/runtime/smoke/codex-resume-model-probe.smoke.ts',
      // ⚑ Six arms (the login, the key, and the key's Windows route, each fresh and resumed) of five
      // bounded waits each, and the Codex arm, derived; its own `testTimeoutMs` fires.
      'packages/runtime/smoke/token-reach-probe.smoke.ts',
      // ⚑ **728** — twenty scenarios, two arms each, a turn and a teardown bound per arm, derived; its
      // own `testTimeoutMs` fires. Measured run: about three minutes.
      'packages/runtime/smoke/tool-calls-as-the-cli-probe.smoke.ts',
    ])
  })

  it('🔴 the comparison, on planted sources — the same budget, one fact over', () => {
    // ⛔ Above the ceiling WITHOUT its own timeout: vitest fires first, which is exactly G2.
    const aboveNoTimeout = `
      import { it } from 'vitest'
      import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
      const deadline = probeRunDeadline('planted', runBudgetMs([1_000_000]), 6_000)
      it('one', () => deadline.within('one', async () => {}))
    `
    expect(boundThatFiresFirst(ts, aboveNoTimeout, helper, configTimeoutMs)).toEqual({
      fires: 'vitest',
      vitestMs: configTimeoutMs,
      deadlineMs: 1_506_000,
    })
    // ⚑ …and the same file carrying the helper's timeout: the deadline fires first again.
    const aboveWithTimeout = aboveNoTimeout.replace(
      'async () => {}))',
      'async () => {}), deadline.testTimeoutMs)',
    )
    expect(boundThatFiresFirst(ts, aboveWithTimeout, helper, configTimeoutMs).fires).toBe(
      'the deadline',
    )
    // ⚑ And BELOW the ceiling with no timeout of its own, the config's twenty minutes are enough.
    const belowNoTimeout = aboveNoTimeout.replace('[1_000_000]', '[1_000]')
    expect(boundThatFiresFirst(ts, belowNoTimeout, helper, configTimeoutMs).fires).toBe(
      'the deadline',
    )
  })

  it('🔴 the evaluator reads the file’s own derivation, and refuses one it cannot state', () => {
    expect(budgetOf(ts, ADOPTER, helper)).toEqual({
      probe: 'planted',
      budgetMs: helper.runBudgetMs([1_000, 1_000, 6_000]),
      teardownMs: 6_000,
      testTimeoutMs:
        helper.runBudgetMs([1_000, 1_000, 6_000]) + 6_000 + helper.TEST_TIMEOUT_MARGIN_MS,
    })
    // ⛔ A budget that depends on what an import DOES at run time is not one this can state.
    const reachesAnImport = ADOPTER.replace(
      "import { it } from 'vitest'",
      "import { it } from 'vitest'\nimport { measured } from './somewhere'",
    ).replace('const WAIT_MS = 1_000', 'const WAIT_MS = measured()')
    expect(() => budgetOf(ts, reachesAnImport, helper)).toThrow(/reaches `measured`/)
    // ⚑ An environment override is read at its DEFAULT, unless the census is handed one.
    const fromEnv = ADOPTER.replace(
      'const WAIT_MS = 1_000',
      "const WAIT_MS = Number(process.env['PLANTED_MS'] ?? 1_000)",
    )
    expect(budgetOf(ts, fromEnv, helper).budgetMs).toBe(budgetOf(ts, ADOPTER, helper).budgetMs)
    expect(budgetOf(ts, fromEnv, helper, { env: { PLANTED_MS: '2000' } }).budgetMs).toBe(
      helper.runBudgetMs([2_000, 2_000, 6_000]),
    )
    // ⛔ …and the global object is inside the sandbox too, so the tester's shell cannot leak in.
    const throughTheGlobal = ADOPTER.replace(
      'const WAIT_MS = 1_000',
      "const WAIT_MS = globalThis.process.env['PATH'] === undefined ? 1_000 : 2_000",
    )
    expect(process.env['PATH']).toBeDefined()
    expect(budgetOf(ts, throughTheGlobal, helper).budgetMs).toBe(
      budgetOf(ts, ADOPTER, helper).budgetMs,
    )
    // ⚑ `testTimeoutMs` is the REAL helper's answer, not a formula re-typed here.
    const built = helper.probeRunDeadline('x', budgetOf(ts, ADOPTER, helper).budgetMs, 6_000)
    expect(budgetOf(ts, ADOPTER, helper).testTimeoutMs).toBe(built.testTimeoutMs)
  })
})

describe('669 · the two live smokes count their waits where they make them', () => {
  const LIVE = [
    ['packages/runtime/smoke/claude-live.smoke.ts', 'Claude'],
    ['packages/runtime/smoke/codex-live.smoke.ts', 'Codex'],
  ]

  it.each(LIVE)(
    '⛔ %s — the table its budget is built from is the sum of its call sites',
    (file) => {
      const source = read(file)
      const counted = waitsCountedWhereMade(ts, source, helper, {
        name: file,
        capName: 'MAX_APPROVALS_PER_TURN',
      })
      const table = valueIn(ts, source, 'SERIAL_WAITS_MS', helper, { name: file })
      expect(counted.total).toBe(table.reduce((sum, ms) => sum + ms, 0))
      expect(budgetOf(ts, source, helper, { name: file }).budgetMs).toBe(
        helper.runBudgetMs([counted.total]),
      )
      // ⛔ Every approval loop stops itself — the `cap + 1` the count charges is a fact, not a hope.
      expect(
        uncappedForeverLoops(ts, source, { name: file, capName: 'MAX_APPROVALS_PER_TURN' }),
      ).toEqual([])
    },
  )

  it.each(LIVE)(
    '⛔ %s — every session is opened bounded, owned first, and refused past the deadline',
    (file) => {
      const source = read(file)
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const opens = []
      const rethrows = []
      const walk = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          if (node.expression.text === 'opened') opens.push(node)
        }
        // ⚑ A catch that records a line, or keeps the error as the step's answer (`threw = e`).
        const kept = /\brecord\(|\bthrew = e\b/
        if (ts.isCatchClause(node) && kept.test(node.block.getText(sourceFile))) {
          rethrows.push(node.block.statements[0]?.getText(sourceFile) ?? '')
        }
        ts.forEachChild(node, walk)
      }
      walk(sourceFile)
      expect(opens.length, 'no session is opened through `opened`').toBeGreaterThan(5)
      for (const open of opens) {
        let body = open.parent
        while (!ts.isFunctionLike(body)) body = body.parent
        const text = body.getText(sourceFile)
        const at = open.getStart(sourceFile) - body.getStart(sourceFile)
        const line = sourceFile.getLineAndCharacterOfPosition(open.getStart(sourceFile)).line + 1
        expect(text.slice(0, at), `line ${line}: nothing owns this session first`).toMatch(
          /deadline\.own\(|ownSessions\(\)/,
        )
      }
      // ⚑ The deadline is the RUN's answer: every catch that records a line rethrows it first.
      expect(rethrows.length).toBeGreaterThanOrEqual(5)
      for (const first of rethrows) {
        expect(first).toBe('if (e instanceof ProbeRunDeadlineExpired) throw e')
      }
      // ⛔ Nothing opens a session bare — every start and resume is the launch handed to `opened` —
      // and nothing is sent a prompt without a refusal after it opened (the template's second one).
      expect(bareOpens(ts, source, file)).toEqual([])
      expect(unguardedOpens(ts, source, file)).toEqual([])
      expect(unrefusedOpens(ts, source, file)).toEqual([])
    },
  )

  it.each(LIVE)(
    '⛔ %s — a teardown WAITS for a launch it aborted, and an isolation verdict is refused past the deadline',
    (file) => {
      const source = read(file)
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      const squashed = code.replace(/\s+/g, ' ')
      // ⚑ `opened` registers its launch and aborts it when it gives up.
      expect(squashed).toContain(
        'const opening = launch(controller.signal) OPENINGS.set(controller, opening)',
      )
      expect(squashed).toMatch(/timer = setTimeout\(\(\) => \{ controller\.abort\(\)/)
      // ⚑ The owner's teardown is single-flight, aborts every launch, and waits for each — bounded.
      expect(squashed).toContain('(closing ??= (async () => {')
      expect(squashed).toContain(
        'for (const launch of launches.splice(0)) { launch.abort() const opening = OPENINGS.get(launch) if (opening !== undefined) { await settledWithin( opening.then((late) => late.close()), TEARDOWN_MS, ) } }',
      )
      // ⛔ A deadline's abort makes a resume throw `ResumeError`: every verdict that reads one is
      // refused past the deadline first.
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const verdicts = []
      const walk = (node) => {
        if (
          ts.isExpressionStatement(node) &&
          ts.isCallExpression(node.expression) &&
          node.expression.expression.getText(sourceFile) === 'record' &&
          /ResumeError/.test(node.expression.arguments[1]?.getText(sourceFile) ?? '')
        ) {
          const block = node.parent
          const before = block.statements[block.statements.indexOf(node) - 1]
          verdicts.push(before?.getText(sourceFile) ?? '')
        }
        ts.forEachChild(node, walk)
      }
      walk(sourceFile)
      expect(verdicts).toHaveLength(2)
      for (const before of verdicts) expect(before).toMatch(/^deadline\.refuse\(/)
    },
  )

  it('⚑ each file’s teardown figure is the one its runtime’s close is bounded by', () => {
    const value = (file, expression) => valueIn(ts, read(file), expression, helper, { name: file })
    const claudeRuntime = 'packages/runtime/src/claude/claude-runtime.ts'
    const codexRuntime = 'packages/runtime/src/codex/codex-runtime.ts'
    const codexTransport = 'packages/runtime/src/codex/codex-transport.ts'
    expect(value('packages/runtime/smoke/claude-live.smoke.ts', 'TEARDOWN_MS')).toBe(
      value(claudeRuntime, 'CLOSE_INTERRUPT_TIMEOUT_MS') +
        value(claudeRuntime, 'CLOSE_EXIT_RECEIPT_TIMEOUT_MS'),
    )
    expect(value('packages/runtime/smoke/codex-live.smoke.ts', 'TEARDOWN_MS')).toBe(
      value(codexRuntime, 'CLOSE_FLUSH_TIMEOUT_MS') +
        value(codexRuntime, 'CLOSE_INTERRUPT_TIMEOUT_MS') +
        value(codexTransport, 'DEFAULTS.exitGraceMs') +
        2 * value(codexTransport, 'DEFAULTS.killGraceMs'),
    )
  })

  it('🔴 the count, on planted sources — a wait added without its row is caught', () => {
    const planted = `
      const MAX_APPROVALS_PER_TURN = 2
      const WAIT_MS = 100
      const OPEN_MS = 10
      const TEARDOWN_MS = 1
      const PAUSE_MS = 7
      const SERIAL_WAITS_MS = [
        ...Array.from({ length: 2 * (MAX_APPROVALS_PER_TURN + 1) + 1 }, () => WAIT_MS),
        PAUSE_MS,
        40,
        ...Array.from({ length: 3 }, () => OPEN_MS + TEARDOWN_MS),
      ]
      async function waitFor(pred, timeoutMs, label) {
        const start = Date.now()
        while (!pred()) {
          if (Date.now() - start > timeoutMs) throw new Error('late')
          await new Promise((r) => setTimeout(r, 5))
        }
      }
      async function run() {
        async function step() {
          await opened('x', (signal) => runtime.start({ signal }), owned.launch())
        }
        async function drive() {
          let n = 0
          for (;;) {
            await waitFor(() => true, WAIT_MS, 'loop')
            if (n >= MAX_APPROVALS_PER_TURN) throw new Error('capped')
            n += 1
          }
        }
        await step()
        await step()
        await drive()
        await drive()
        await waitFor(() => true, WAIT_MS, 'plain')
        await new Promise((r) => setTimeout(r, PAUSE_MS))
        const until = Date.now() + 40
        while (Date.now() < until) await new Promise((r) => setTimeout(r, 5))
        await opened('y', (signal) => runtime.start({ signal }), owned.launch())
      }
      it('planted', () => deadline.within('planted', run), deadline.testTimeoutMs)
    `
    const count = (source) =>
      waitsCountedWhereMade(ts, source, helper, { capName: 'MAX_APPROVALS_PER_TURN' }).total
    const table = (source) =>
      valueIn(ts, source, 'SERIAL_WAITS_MS', helper).reduce((sum, ms) => sum + ms, 0)
    const uncapped = (source) =>
      uncappedForeverLoops(ts, source, { capName: 'MAX_APPROVALS_PER_TURN' })
    // ⚑ The positive control: the table and the count agree on the planted file.
    expect(count(planted)).toBe(table(planted))
    expect(count(planted)).toBe(2 * 3 * 100 + 100 + 7 + 40 + 3 * 11)
    expect(uncapped(planted)).toEqual([])
    // ⛔ One more plain wait, no row: the two disagree.
    const extraWait = planted.replace(
      "await waitFor(() => true, WAIT_MS, 'plain')",
      "await waitFor(() => true, WAIT_MS, 'plain')\n        await waitFor(() => true, WAIT_MS, 'again')",
    )
    expect(count(extraWait)).toBe(table(extraWait) + 100)
    // ⛔ A third call to the looping helper, no row: the loop is charged three times now.
    const thirdDrive = planted.replace('await drive()\n', 'await drive()\n        await drive()\n')
    expect(count(thirdDrive)).toBe(table(thirdDrive) + 3 * 100)
    // ⛔ A waiting ARROW helper and a TOP-LEVEL helper are charged per call too — the shapes the
    // first version of this count saw once however often they ran.
    const arrowHelper = planted
      .replace(
        '        async function step() {',
        "        const settle = async () => { await waitFor(() => true, WAIT_MS, 'arrow') }\n        async function step() {",
      )
      .replace(
        '        await step()\n        await step()',
        '        await step()\n        await step()\n        await settle()\n        await settle()',
      )
    expect(count(arrowHelper)).toBe(table(arrowHelper) + 2 * 100)
    const topLevel = planted
      .replace(
        '      async function run() {',
        "      async function turnEnds() { await waitFor(() => true, WAIT_MS, 'top') }\n      async function run() {",
      )
      .replace(
        "        await opened('y'",
        "        await turnEnds()\n        await turnEnds()\n        await turnEnds()\n        await opened('y'",
      )
    expect(count(topLevel)).toBe(table(topLevel) + 3 * 100)
    // ⛔ A loop that no longer stops itself is named by line — by losing its throw, or by a counter
    // nothing increases, or by being a `while (true)` with neither.
    expect(
      uncapped(planted.replace("if (n >= MAX_APPROVALS_PER_TURN) throw new Error('capped')", '')),
    ).toHaveLength(1)
    expect(uncapped(planted.replace('            n += 1\n', ''))).toHaveLength(1)
    expect(
      uncapped(planted.replace('for (;;) {', 'while (true) {').replace('            n += 1\n', '')),
    ).toHaveLength(1)
    // ⛔ …and what the count cannot charge, it refuses to charge as zero.
    const shadowed = planted.replace(
      "        await waitFor(() => true, WAIT_MS, 'plain')",
      "        { const WAIT_MS = 900; await waitFor(() => true, WAIT_MS, 'plain') }",
    )
    expect(() => count(shadowed)).toThrow(/`WAIT_MS` is shadowed/)
    const untimedLoop = planted.replace(
      "        await waitFor(() => true, WAIT_MS, 'plain')",
      "        await waitFor(() => true, WAIT_MS, 'plain')\n        for (const one of [1, 2]) await new Promise((r) => setTimeout(r, PAUSE_MS))",
    )
    expect(() => count(untimedLoop)).toThrow(/neither an approval loop nor a clocked poll/)
    const unreferenced = planted.replace(
      '      async function run() {',
      "      async function nobodyCalls() { await waitFor(() => true, WAIT_MS, 'x') }\n      async function run() {",
    )
    expect(() => count(unreferenced)).toThrow(/`nobodyCalls` waits and nothing references it/)
  })

  it('🔴 round 2 · how often a wait runs is read from the CALL GRAPH, and a shape it cannot read throws', () => {
    const count = (source) =>
      waitsCountedWhereMade(ts, source, helper, { capName: 'MAX_APPROVALS_PER_TURN' }).total
    const plant = (body, extra = '') => `
      const MAX_APPROVALS_PER_TURN = 2
      const WAIT_MS = 100
      const PAUSE_MS = 7
      const OPEN_MS = 10
      const TEARDOWN_MS = 1
      async function waitFor(pred, timeoutMs, label) {
        const start = Date.now()
        while (!pred()) {
          if (Date.now() - start > timeoutMs) throw new Error('late')
          await new Promise((r) => setTimeout(r, 5))
        }
      }
      ${extra}
      async function run() {
        ${body}
      }
      it('planted', () => deadline.within('planted', run), deadline.testTimeoutMs)
    `
    const settle = "async function settle() { await waitFor(() => true, WAIT_MS, 's') }"
    // ⛔ A top-level helper called from INSIDE another named function runs as often as that one does.
    expect(
      count(
        plant(
          'async function step() {\n          await settle()\n        }\n        await step()\n        await step()',
          settle,
        ),
      ),
    ).toBe(2 * 100)
    // ⛔ A waiting call inside a bounded loop, or inside a `.map` callback, has no count to read.
    expect(() => count(plant('for (const one of [1, 2]) await settle()', settle))).toThrow(
      /neither an approval loop nor a clocked poll/,
    )
    expect(() =>
      count(
        plant(
          "await Promise.all([1, 2].map(async () => { await waitFor(() => true, WAIT_MS, 'm') }))",
        ),
      ),
    ).toThrow(/`\.map` callback/)
    // ⛔ A `Date.now()` in a comment, or a clock read as `Date.now() - start`, is not a clocked poll.
    expect(() =>
      count(
        plant(
          'for (const one of [1, 2]) {\n          // until Date.now() passes\n          await new Promise((r) => setTimeout(r, PAUSE_MS))\n        }',
        ),
      ),
    ).toThrow(/neither an approval loop nor a clocked poll/)
    expect(() =>
      count(
        plant(
          'const start = Date.now()\n        while (Date.now() - start < WAIT_MS) await new Promise((r) => setTimeout(r, PAUSE_MS))',
        ),
      ),
    ).toThrow(/neither an approval loop nor a clocked poll/)
    // ⛔ A sleep of another shape, and a `timers/promises` sleep, are refused rather than charged 0.
    expect(() =>
      count(
        plant(
          'await new Promise((r) => {\n          const t = setTimeout(r, PAUSE_MS)\n          t.unref?.()\n        })',
        ),
      ),
    ).toThrow(/cannot classify/)
    expect(() =>
      count(
        `import { setTimeout as sleep } from 'node:timers/promises'\n${plant('await sleep(1)')}`,
      ),
    ).toThrow(/timers\/promises/)
    // ⛔ A bound shadowed through DESTRUCTURING is still shadowed.
    expect(() =>
      count(
        plant(
          "async function drive({ WAIT_MS }) { await waitFor(() => true, WAIT_MS, 'd') }\n        await drive({ WAIT_MS: 900 })",
        ),
      ),
    ).toThrow(/`WAIT_MS` is shadowed/)
  })

  it('🔴 a bare open, and a prompt sent to a session nothing refused after it opened, are named', () => {
    const opens = `
      async function run() {
        const owned = ownSessions()
        deadline.refuse('starting')
        const a = await opened('a', (signal) => runtime.start({ signal }), owned.launch())
        deadline.refuse('a is open')
        await a.send('hello')
        const b = await opened('b', (signal) => runtime2.resume(ref, { signal }), owned.launch())
        await b.send('hello again')
        const c = await new CodexRuntime(factory(), health).resume(ref, {})
      }
    `
    // ⚑ The control is `a`: refused after it opened, before it was spoken to.
    expect(unrefusedOpens(ts, opens)).toEqual([8])
    // ⛔ `c` is bare; and `b` is inside `opened` but a launch that drops the signal is bare too.
    expect(bareOpens(ts, opens)).toEqual([10])
    expect(
      bareOpens(ts, opens.replace('runtime2.resume(ref, { signal })', 'runtime2.resume(ref, {})')),
    ).toEqual([8, 10])
    // ⛔ `b` also has no refusal of its OWN before it opened — `a`'s is not `b`'s.
    expect(unguardedOpens(ts, opens)).toEqual([8])
    // ⛔ The step shape: the session is handed to a parameter and prompted THERE.
    const stepShape = `
      async function step(line, fn) {
        deadline.refuse('starting')
        const owned = ownSessions()
        const handle = await opened(line, (signal) => runtime.start({ signal }), owned.launch())
        const { pass } = await fn(handle)
      }
    `
    expect(unrefusedOpens(ts, stepShape)).toEqual([5])
    expect(
      unrefusedOpens(
        ts,
        stepShape.replace(
          '        const { pass }',
          "        deadline.refuse('open')\n        const { pass }",
        ),
      ),
    ).toEqual([])
  })
})

describe('669 · round 3 — the census refuses what it cannot charge, and asks each section for its own refusal', () => {
  const plant = (body, extra = '') => `
    const MAX_APPROVALS_PER_TURN = 2
    const WAIT_MS = 100
    const PAUSE_MS = 7
    const OPEN_MS = 10
    const TEARDOWN_MS = 1
    async function waitFor(pred, timeoutMs, label) {
      const start = Date.now()
      while (!pred()) {
        if (Date.now() - start > timeoutMs) throw new Error('late')
        await new Promise((r) => setTimeout(r, 5))
      }
    }
    ${body.includes('settle()') ? "async function settle() { await waitFor(() => true, WAIT_MS, 's') }" : ''}
    ${extra}
    async function run() {
      ${body}
    }
    it('planted', () => deadline.within('planted', run), deadline.testTimeoutMs)
  `
  const count = (source) =>
    waitsCountedWhereMade(ts, source, helper, { capName: 'MAX_APPROVALS_PER_TURN' }).total
  const uncapped = (source) =>
    uncappedForeverLoops(ts, source, { capName: 'MAX_APPROVALS_PER_TURN' })

  it('⛔ a forever-loop that waits through a HELPER or a SLEEP must stop itself too', () => {
    const capped =
      "let n = 0\n      for (;;) {\n        await settle()\n        if (n >= MAX_APPROVALS_PER_TURN) throw new Error('capped')\n        n += 1\n      }"
    // ⚑ The control: capped, it is charged `cap + 1` settles and named by nothing.
    expect(count(plant(capped))).toBe(3 * 100)
    expect(uncapped(plant(capped))).toEqual([])
    const throughAHelper = capped.replace(
      "        if (n >= MAX_APPROVALS_PER_TURN) throw new Error('capped')\n",
      '',
    )
    expect(uncapped(plant(throughAHelper))).toHaveLength(1)
    expect(() => count(plant(throughAHelper))).toThrow(/does not stop itself/)
    const throughASleep =
      'for (;;) {\n        await new Promise((r) => setTimeout(r, PAUSE_MS))\n      }'
    expect(uncapped(plant(throughASleep))).toHaveLength(1)
    expect(() => count(plant(throughASleep))).toThrow(/does not stop itself/)
  })

  it('⛔ a raced timer outside `opened`, `acknowledged` and `settledWithin` is charged, or refused', () => {
    const quiet = plant('await settle()')
    expect(count(quiet)).toBe(100)
    // ⛔ A sleep raced against a send, in a step: read as the sleep it is.
    const raced = plant(
      "await settle()\n      await Promise.race([h.send('x'), new Promise((r) => setTimeout(r, PAUSE_MS))])",
    )
    expect(count(raced)).toBe(100 + 7)
    // ⛔ …and a raced REJECT of any other shape is a timer this cannot classify.
    const rejecting = plant(
      "await Promise.race([h.send('x'), new Promise((_, reject) => { setTimeout(() => reject(new Error('late')), PAUSE_MS) })])",
    )
    expect(() => count(rejecting)).toThrow(/cannot classify/)
    // ⚑ The control: the same race INSIDE `opened` is `opened`'s bound, charged by name.
    const owned = plant(
      "await opened('x', (signal) => runtime.start({ signal }), owned.launch())",
      "async function opened(what, launch, controller) {\n      return await Promise.race([launch(controller.signal), new Promise((_, reject) => { setTimeout(() => reject(new Error('late')), OPEN_MS) })])\n    }",
    )
    expect(count(owned)).toBe(10 + 1)
  })

  it('⛔ a timer reached through a property, `setInterval`, or `node:timers` is refused', () => {
    expect(() =>
      count(plant('await new Promise((r) => globalThis.setTimeout(r, PAUSE_MS))')),
    ).toThrow(/reached through `globalThis\.setTimeout`/)
    expect(() => count(plant('setInterval(() => {}, PAUSE_MS)'))).toThrow(/reached through/)
    expect(() =>
      count(`import { setTimeout as delay } from 'node:timers'\n${plant('await settle()')}`),
    ).toThrow(/`node:timers` timers cannot be counted/)
    expect(count(plant('await new Promise((r) => setTimeout(r, PAUSE_MS))'))).toBe(7)
  })

  it('⛔ a launch must FORWARD its signal — a key spelled `signal` holding anything else is bare', () => {
    const opens = (launch) => `
      async function run() {
        deadline.refuse('starting')
        const owned = ownSessions()
        const a = await opened('a', ${launch}, owned.launch())
      }
    `
    expect(bareOpens(ts, opens('(signal) => runtime.start({ cwd, signal })'))).toEqual([])
    expect(bareOpens(ts, opens('(stop) => runtime.start({ cwd, signal: stop })'))).toEqual([])
    expect(bareOpens(ts, opens('(signal) => runtime.start({ cwd, signal: undefined })'))).toEqual([
      5,
    ])
    expect(
      bareOpens(
        ts,
        opens('(signal) => runtime.start({ cwd, signal: new AbortController().signal })'),
      ),
    ).toEqual([5])
  })

  it('⛔ each section refuses for itself — and a handle handed to a PROMPTING helper is a use', () => {
    const sections = `
      async function driveTurn(h, prompt) {
        await h.send(prompt)
      }
      async function run() {
        {
          deadline.refuse('starting one')
          const owned = ownSessions()
          try {
            const one = await opened('one', (signal) => runtime.start({ signal }), owned.launch())
            deadline.refuse('one is open')
            await owned.closeOpen()
          } finally {
            await owned.close()
          }
          deadline.refuse('recording one')
        }
        {
          const owned = ownSessions()
          try {
            const two = await opened('two', (signal) => runtime.start({ signal }), owned.launch())
            await driveTurn(two, 'hello')
          } finally {
            await owned.close()
          }
        }
      }
    `
    // ⛔ Section two has no refusal of its own: one's verdict refusal does not stand in for it, and
    // the session it hands to \`driveTurn\` is prompted without one after it opened.
    expect(unguardedOpens(ts, sections)).toEqual([21])
    expect(unrefusedOpens(ts, sections)).toEqual([21])
    // ⚑ The control: section two refusing for itself, before it opens and after.
    const refused = sections
      .replace(
        '        {\n          const owned = ownSessions()',
        "        {\n          deadline.refuse('starting two')\n          const owned = ownSessions()",
      )
      .replace(
        "            await driveTurn(two, 'hello')",
        "            deadline.refuse('two is open')\n            await driveTurn(two, 'hello')",
      )
    expect(refused).not.toBe(sections)
    expect(unguardedOpens(ts, refused)).toEqual([])
    expect(unrefusedOpens(ts, refused)).toEqual([])
  })
})
