# Code health

One gate, four checks, each against its own committed baseline in `scripts/code-health/baseline/`:

| Check     | Tool and config                                     | Finding identity                     |
| --------- | --------------------------------------------------- | ------------------------------------ |
| jscpd     | jscpd 5.4.2, `scripts/code-health/jscpd.json`       | format + the two files, sorted       |
| depcruise | dependency-cruiser 17.3.8, `depcruise.cjs`          | rule + from file + to file; a cycle is keyed by each edge depcruise marks circular |
| knip      | Knip 6.44.1, `knip.json`                            | issue type + file + symbol           |
| size      | the runner: code files over 1000 lines              | file, with its baselined line count  |

Run it with `node scripts/code-health/gate.mjs` after `npm ci --prefix scripts/code-health`
(and the usual `pnpm install` plus `npm ci` in each plugin). Exit 0 means no new findings, 1 means
at least one new finding, and 2 means a tool failed or produced no readable report. An execution
error prints the tool's own stderr and is never counted as a finding.

## What fails

A finding whose identity is not in the baseline. Line numbers and content never take part, so
editing code that already carries listed debt passes. Examples that fail: a new clone between two
files that had none, a new import that closes a cycle or crosses a boundary in `depcruise.cjs`, a
new unused export, a file growing past 1000 lines. The files already over the limit are listed in
`baseline/size.json` at their current size: they may shrink, never grow. When one of them has to
change, keep the change net-zero, or move code out into a new or smaller file.

Some limits are deliberate:

- A second clone between a file pair that already has one is not new; it shows in the totals.
- A listed finding that disappears and comes back passes again until the baseline is updated.
- A listed giant that shrinks may grow back to its baselined size until `--update` is run.
- Moving or renaming a file that carries listed debt shows that debt as new. Run the update below in
  the same PR.

If `no-circular` gains an exception such as `pathNot` or `dependencyTypesNot`, apply the same
filter to the cycle keys in `depcruiseKeys`.

## Updating the baseline

`node scripts/code-health/gate.mjs --update` rewrites the four baseline files from the current tree.
Commit the result in an ordinary PR; the baseline diff is what review reads. Do it when you fix debt
(the run lists it as resolved) or move a file with listed debt.

## Weekly report

`.github/workflows/code-health.yml` runs on pushes to `main` and `gate/prepare-*`, on pull requests and every Sunday at
06:00 UTC on a hosted Linux runner. Each run writes `report.md` (baseline, current, new and resolved
counts per check, plus the tools' own totals) to the run summary and keeps it with the native tool
output in the `code-health` artifact. The Sunday run is the weekly trend report. On Monday the
duplication, module-boundary and dead-code reviewers read it; the code reviewer covers for them.

## Plugin execution boundary

Two dependency-cruiser rules keep plugin host code (`apps/desktop/src/main/plugins/`) and the
plugin service (`apps/desktop/resources/plugin-host/`) away from the runtime barrel
(`packages/runtime/src/index.ts`) and the Claude Agent SDK / Codex SDK, directly or through any
chain of imports. They are ordinary depcruise rules, so existing violations sit in
`baseline/depcruise.json` and new ones fail the gate.
