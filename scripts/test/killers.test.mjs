import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// These runner contracts use POSIX Bash, process signals and verify_row's signal mask.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const KILLERS = join(REPO, 'scripts/mutations/lib/killers.py')
const VERIFY_ROW = join(REPO, 'scripts/mutations/verify_row.py')

/**
 * # ⚑ W4.36 · a row's killers, read once for the runner and `verify_row.py` alike
 *
 * `lib/killers.py` reads the `killed by \`file.test.ts\`` a label names, resolves each to one test
 * file, and groups them by the Vitest project each runs under. ⛔ A row it cannot read falls back,
 * with its reason — it is never measured by fewer tests. `commands` is the dry run: what a row would
 * run, with nothing applied and nothing run. `remaining` names the rows no batch has measured.
 */

const KILLER = 'apps/desktop/test/a-thing-that-notices.test.ts'
const DOM = 'apps/desktop/test/dom/a-thing-on-screen.dom.test.ts'
const RUNTIME = 'packages/runtime/test/another.test.ts'

function aRepo(rows, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-killers-'))
  for (const name of [
    KILLER,
    DOM,
    RUNTIME,
    'scripts/gate-only/a-gate.test.mjs',
    ...Object.keys(extra),
  ]) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), extra[name] ?? 'it\n')
  }
  mkdirSync(join(root, 'scripts/mutations/999'), { recursive: true })
  writeFileSync(
    join(root, 'scripts/mutations/999/mutations.py'),
    `MUTATIONS = [\n${rows.map((label) => `    (${JSON.stringify(label)}, "target.txt", "a", "b"),`).join('\n')}\n]\n`,
  )
  writeFileSync(join(root, 'target.txt'), 'a')
  return root
}

const killers = (...args) => execFileSync('python3', [KILLERS, ...args], { encoding: 'utf8' })

describeOnPosix('killers.py plan', () => {
  it('🔴 one group per project, in the runner’s order, and every unreadable row falls back with its reason', () => {
    const root = aRepo([
      'M1 · killed by `a-thing-that-notices.test.ts` and killed by `another.test.ts`',
      'M2 · killed by `a-thing-on-screen.dom.test.ts`, then killed by `a-thing-that-notices.test.ts`',
      'M3 · nobody named a killer',
      'M4 · killed by `no-such.test.ts`',
      'M5 · killed by `a-gate.test.mjs`',
      `M6 · killed by \`${KILLER}\``,
      'M7 · killed by `a-thing-that-notices.test.ts`, `another.test.ts` and `a-thing-on-screen.dom.test.ts`',
    ])
    try {
      const lines = killers('plan', join(root, 'scripts/mutations/999/mutations.py'), root)
        .trim()
        .split('\n')
        .map((line) => line.split('\t'))
      expect(lines[0]).toEqual(['0', 'killers', `runtime ${RUNTIME}`, `desktop ${KILLER}`])
      expect(lines[1]).toEqual(['1', 'killers', `desktop ${KILLER}`, `dom ${DOM}`])
      expect(lines[2]).toEqual(['2', 'fallback', 'its label names no killer'])
      expect(lines[3]).toEqual([
        '3',
        'fallback',
        'the killer `no-such.test.ts` names 0 test files: []',
      ])
      expect(lines[4][1]).toBe('fallback')
      expect(lines[4][2]).toContain('permits only inside `pnpm run ci`')
      // A killer named by its path resolves to itself.
      expect(lines[5]).toEqual(['5', 'killers', `desktop ${KILLER}`])
      // ⚑ A list after one `killed by` names every file in it (125 labels do).
      expect(lines[6]).toEqual([
        '6',
        'killers',
        `runtime ${RUNTIME}`,
        `desktop ${KILLER}`,
        `dom ${DOM}`,
      ])
      // Selected indices only, in the order asked.
      expect(
        killers('plan', join(root, 'scripts/mutations/999/mutations.py'), root, '2', '0')
          .trim()
          .split('\n')
          .map((line) => line.split('\t')[0]),
      ).toEqual(['2', '0'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ a name that matches two files is not guessed at: the row falls back', () => {
    const root = aRepo(['M1 · killed by `twice.test.ts`'], {
      'apps/desktop/test/twice.test.ts': 'it\n',
      'packages/runtime/test/twice.test.ts': 'it\n',
    })
    try {
      const [line] = killers('plan', join(root, 'scripts/mutations/999/mutations.py'), root)
        .trim()
        .split('\n')
      expect(line).toMatch(/^0\tfallback\tthe killer `twice\.test\.ts` names 2 test files/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describeOnPosix('killers.py commands — the dry run', () => {
  it('🔴 prints what each row would run, gently, and applies and runs nothing', () => {
    const root = aRepo([
      'M1 · killed by `a-thing-that-notices.test.ts`',
      'M2 · nobody named a killer',
    ])
    try {
      const out = killers('commands', '999', 'M1', 'M2', '--root', root)
      expect(out).toContain('M1 (index 0) · edits target.txt\n  row scope: its killers only\n')
      expect(out).toContain(
        `env -u ELECTRON_RUN_AS_NODE VITEST_MAX_WORKERS="\${VITEST_MAX_WORKERS:-2}" nice -n 15 node_modules/.bin/vitest run --project=desktop --reporter=default --reporter=json --outputFile.json=<report> ${KILLER}`,
      )
      expect(out).toContain(
        'M2 (index 1) · edits target.txt\n  row scope: FALLBACK — its label names no killer',
      )
      expect(out.match(/under the mutation: .*--project=(\w+)/g)?.length).toBe(1 + 5)
      // Nothing was applied.
      expect(readFileSync(join(root, 'target.txt'), 'utf8')).toBe('a')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describeOnPosix('killers.py remaining — where the next batch starts', () => {
  it('🔴 a row counts as measured only when its record followed its header in a batch log', () => {
    const root = aRepo(['M1 · one', 'M2 · two', 'M3 · three', 'M4 · four'])
    const table = join(root, 'scripts/mutations/999')
    try {
      expect(killers('remaining', '999', '--root', root).trim()).toBe('0 1 2 3')
      // A finished batch, kept by the next one as `.interrupted`…
      writeFileSync(
        join(table, 'mutations.txt.partial.interrupted'),
        'M0  CONTROL\n    killers: G1 GREEN 0 of 1 in 1 files\n\nM1 · one\n    killers: G1 RED 1 of 1 in 1 files\n\n',
      )
      // …and one stopped mid-row: M3's header has no record, and M2 did not apply.
      writeFileSync(
        join(table, 'mutations.txt.partial'),
        'M2 · two\n    !! DID NOT APPLY — this mutation proves nothing\n\nM3 · three\n',
      )
      expect(killers('remaining', '999', '--root', root).trim()).toBe('1 2 3')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describeOnPosix('verify_row.py reads the same convention, as gently', () => {
  it('⚑ its killer regex and homes are the module’s, and it runs Vitest at low priority with at most two workers', () => {
    const program =
      `import sys; sys.dont_write_bytecode=True; sys.path.insert(0, ${JSON.stringify(join(REPO, 'scripts/mutations'))}); ` +
      `import verify_row, killers; print(verify_row.KILLER is killers.KILLER, verify_row.GATE_ONLY_HOMES == killers.GATE_ONLY_HOMES)`
    expect(
      execFileSync('python3', ['-W', 'ignore', '-c', program], { encoding: 'utf8' }).trim(),
    ).toBe('True True')
    const source = readFileSync(VERIFY_ROW, 'utf8')
    expect(source).toContain(
      '"nice",\n                    "-n",\n                    str(NICENESS),',
    )
    expect(source).toContain('env.setdefault("VITEST_MAX_WORKERS", str(DEFAULT_MAX_WORKERS))')
  })
})
