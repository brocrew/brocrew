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

The same dependency-cruiser graph also feeds a count-only rule for tracked code under
`apps/desktop/src/main/plugins/` (host) and `apps/desktop/resources/plugin-host/` (service).
Explicit type-only barrel imports are allowed. Value imports of `@brobot2/runtime` are counted
once per source module; executable helper paths to `packages/runtime/src/index.ts` or the
Claude Agent SDK / Codex SDK are counted once per root and resolved forbidden target.
Full type reach is diagnostic and stays available to the existing module checks.

`baseline/plugin-policy.json` holds only integer ceilings per rule and host/service role.
Measured counts must equal these ceilings, and each ceiling must be no greater than the ordinary
Git comparison target's ceiling. Equal-count replacements pass. A decrease requires lowering
its ceiling in the same change; a stale ceiling, rise or ceiling increase fails. `--update` never
writes plugin ceilings. The four original baselines keep their existing comparison semantics.

Use `--target <revision>` or `CODE_HEALTH_TARGET` to select the comparison target; local default
is `HEAD^`. Hosted pushes use their before revision, pull requests their base, and scheduled runs
the current revision. History is checked out so the target file can be read. A missing or unreadable
target policy is an error. For the first introduction only, the operator explicitly dispatches Code
health with target `a42dd460f37a702905ee71fdd8ca61ed78c5e5e0` and `plugin_bootstrap=true`
(or passes `--target` and `--bootstrap-plugin-policy` locally on the remote lane). This uses the
reviewed base's two host / zero service counts per row; it is never an automatic missing-file fallback.
The two failure-helper value imports are retargeted to the same neutral `runtime/plugin-failure`
leaf, bringing candidate ceilings to zero. A bootstrap result qualifies only that actual run.

The report retains `plugin-policy.json` counts, shortest witnesses, full-graph diagnostics, selected
root coverage, unresolved execution edges, SDK endpoint gaps and computed-loader locations.
External endpoints remain in the native graph; `doNotFollow` prevents scanning SDK bodies.
A literal SDK import omitted by resolution still counts and reports a coverage error. Missing roots
and unresolved executable edges cannot produce a clean result. Unknown computed imports remain
an explicit static-analysis limit; this is not a proof of arbitrary runtime loader behavior or of
third-party helper neutrality. The neutral failure leaf is import-free; provider-home uses Node builtins.

This slice implements rule 1 only. Brand dispatch, content/packaging/copy-policy detection and
additional provider SDK inventories require separately measured and assigned work; no inactive
policy is represented as a measured zero. Generic dispatch and PDF/navigation/decorative vocabulary
are not banned by this import boundary. Focused tests use the pinned native scanner to plant the
actual failure-helper value import, observe policy exit 1, restore exit 0, and repeat for a helper
reaching an SDK without the runtime barrel. They do not recreate the production crash or qualify a
built app. CI, Windows and the packaged plugin-service smoke remain separate execution evidence.
