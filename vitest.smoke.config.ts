import { defineConfig } from 'vitest/config'

// Live smoke tests — NOT part of `pnpm run ci`. They require the machine's
// existing `claude` login and hit the real provider. Run explicitly:
//   pnpm run smoke:claude
export default defineConfig({
  test: {
    // Include `apps/*` for archive-sweep measurement harnesses that read local files without providers or tokens. They can read the person's large real corpus, so keep them outside ordinary `pnpm run ci`.
    include: ['packages/*/smoke/**/*.smoke.ts', 'apps/*/smoke/**/*.smoke.ts'],
    // ⛔ **One run id and one lock for every probe under this config** (196 H4). `188` gave the UI
    // and resume smokes a directory per run; the twenty files here still wrote to fixed roots they
    // wiped on the way in, so two invocations deleted each other's live trees. This is the one
    // place that runs before any of them — see `scripts/lib/smoke-globalsetup.mjs`.
    globalSetup: ['./scripts/lib/smoke-globalsetup.mjs'],
    environment: 'node',
    // ⚑ The ceiling for a smoke NOT on `packages/runtime/smoke/probe-run-deadline.ts` (669): it must
    // comfortably exceed (steps that can independently hang) × the smoke's per-wait bound, so a hung
    // provider yields CLEAN per-line FAILs instead of one generic vitest timeout that hides WHICH step
    // hung (042). ⚠️ A smoke ON the helper passes its own `deadline.testTimeoutMs` to `it()`, which
    // replaces this for that test — the live Claude and Codex smokes' derived budgets are hours, far
    // past twenty minutes. `scripts/test/smoke-deadlines.test.mjs` names which files are on it, and
    // checks for each that its own deadline, not this, is the bound that fires first.
    // Vitest hides `console` from a PASSING file. A smoke whose whole purpose is to report numbers
    // must print them whether or not it passes (046).
    disableConsoleIntercept: true,
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // Vitest 4 removed `poolOptions`; its entries are top-level now (043, closing 036 P3-2).
    // One fork, no parallelism: the smokes drive real provider processes and must not interleave.
    maxForks: 1,
    minForks: 1,
    fileParallelism: false,
  },
})
