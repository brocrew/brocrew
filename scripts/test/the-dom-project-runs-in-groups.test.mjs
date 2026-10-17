import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUPS, groupArgs, groupCount } from '../test-dom-in-groups.mjs'

/**
 * # ⛔ W4.114 · the DOM project runs in groups, each with a browser of its own
 *
 * One headless Chromium never gives back the shared memory a DOM test file drew (about 640 MB a file
 * on CI's runner). A shard's ~54 DOM files in one browser filled the runner's disk, and `main`'s CI
 * was red from 10-01 to 10-03. So the DOM project runs as `--shard=i/N` invocations in turn, and every
 * other project runs without it. This file holds the three places that say so to each other: the
 * runner script, `package.json`'s `test` and `test:dom`, and CI's two test jobs.
 */

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('scripts/test-dom-in-groups.mjs', () => {
  it('🔴 runs the DOM project once per group, every group a shard of the same count, in order', () => {
    expect(groupArgs(3)).toEqual([
      ['run', '--project', 'dom', '--shard=1/3'],
      ['run', '--project', 'dom', '--shard=2/3'],
      ['run', '--project', 'dom', '--shard=3/3'],
    ])
    // ⚑ What is passed through reaches every group, after its shard.
    expect(groupArgs(2, ['--reporter=dot']).map((args) => args.at(-1))).toEqual([
      '--reporter=dot',
      '--reporter=dot',
    ])
  })

  it('⚑ sixteen groups unless BROBOT_DOM_GROUPS says otherwise; a count that is not one is refused', () => {
    expect(DEFAULT_GROUPS).toBe(16)
    expect(groupCount({})).toBe(16)
    expect(groupCount({ BROBOT_DOM_GROUPS: '' })).toBe(16)
    expect(groupCount({ BROBOT_DOM_GROUPS: '4' })).toBe(4)
    for (const bad of ['0', '-2', '1.5', 'four', ' 3']) {
      expect(() => groupCount({ BROBOT_DOM_GROUPS: bad }), bad).toThrow('BROBOT_DOM_GROUPS')
    }
  })
})

describe('every test runs once, and the DOM project only in groups', () => {
  it('🔴 `pnpm run test` is every project but dom, then the DOM project in groups', () => {
    expect(pkg.scripts.test).toBe("vitest run --project '!dom' && pnpm run test:dom")
    expect(pkg.scripts['test:dom']).toBe('node scripts/test-dom-in-groups.mjs')
  })

  it('🔴 CI shards every project but dom, and runs the DOM project in its own job, in groups', () => {
    expect(workflow).toContain(
      "run: pnpm exec vitest run --project '!dom' --shard=${{ matrix.shard }}/${{ strategy.job-total }}",
    )
    expect(workflow).toMatch(/\n {2}dom:\n[\s\S]*?\n {8}run: pnpm run test:dom\n/)
    // ⛔ No step runs the whole default config in one go any more, and no shard reaches `dom`.
    expect(workflow).not.toContain('run: pnpm run test --shard')
    expect(workflow).not.toMatch(/vitest run(?![^\n]*--project '!dom')[^\n]*--shard/)
    // ⚑ The browser is installed where the DOM project runs, and only there.
    const jobs = workflow.split(/\n {2}(?=[a-z]+:\n)/)
    const dom = jobs.find((job) => job.startsWith('dom:')) ?? ''
    const shards = jobs.find((job) => job.startsWith('test:')) ?? ''
    expect(dom).toContain('playwright install --with-deps chromium')
    expect(shards).not.toContain('playwright install')
  })
})
