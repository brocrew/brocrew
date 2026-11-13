# Code health

One gate, four checks. Clone findings use native jscpd5.4.2 fingerprint multiplicity against an explicit source reference; the other three checks use committed debt baselines.

| Check | Comparison |
|---|---|
| jscpd | Candidate config in scripts/code-health/jscpd.json, native --baseline-from-ref fullSHA; every native isNew record counts |
| depcruise | Rule + from/to file; each native circular edge, against baseline/depcruise.json |
| knip | Issue type + file + symbol, against baseline/knip.json |
| size | Code file over1000lines and its allowed count, against baseline/size.json |

Install the usual workspace/plugin dependencies and npm ci --prefix scripts/code-health. Run `node scripts/code-health/gate.mjs --clone-base <full40hexSHA>`. Use the piece's proven landed MAIN base, not a formatter parent or an arbitrary current checkout. The exact source objects must be available locally. Missing reference/report/markers, mismatched native counts or failed tools are execution errors, exit2. Valid new findings are exit1; no new findings is exit0.

Clone comparison uses unchanged candidate configuration at both snapshots. Full native JSON and SARIF, exact argv/version/reference/config identities and status receipts are retained under the output directory. Candidate native output directory must be fresh; existing output is not reused or deleted. Clone summaries count NEW records; a separate full historical base census/resolved count is not exported, so those table columns say n/a. The old committed clone file-pair debt remains byte-identical and no longer decides clone findings. Two new records with the same fingerprint still count as2. Additional copies inside an already known pair can fail. New duplication cannot be offset by unrelated deletions.

Native report boundaries/partner rotation can still flag spans whose source already existed; they remain findings to deduplicate. Zero native NEW does not prove global semantic no-growth. Formatting crossing minLines10 changes native eligibility; there is no universal formatting-invariance claim. No import/comment filter or custom clone engine is applied.

The other baseline checks retain existing behavior: a missing key is new; giants may shrink but cannot exceed their baselined size. A listed finding can return until its baseline is updated. `node scripts/code-health/gate.mjs --update` skips clones and rewrites only depcruise/knip/size baselines; it leaves clone debt data unchanged. Review those baseline diffs in an ordinary PR. --update cannot admit clone findings. If no-circular gains pathNot/dependencyTypesNot exceptions, apply the same filter to cycle keys.

## CI references and reports

PR: event.pull_request.base.sha. Push: nonzero event.before. Manual: required fullSHA clone_base input. A first push with no valid before fails explicitly rather than guessing a reference. PR candidate checkout may be the synthetic merge commit; both candidate and base are recorded.

Weekly Sunday06:00UTC: capture one run time, subtract604800seconds, anchor MAIN at the scheduled event's exact SHA, then select `git rev-list -1 --before="$cutoff" "$main_anchor"`. Record cutoff, MAIN anchor, selected SHA/tree and ancestry check. No qualifying commit is an explicit missing-reference error; there is no HEAD/parent fallback. Full checkout history supplies ordinary event objects; missing objects still fail. No implicit fetch repair is attempted.

Each hosted run retains report.md, reference.txt and native output under the code-health artifact for90days. The weekly run measures native change over the selected seven-day reference, while the other checks still compare committed debt. Reviewers must keep those units distinct.

## Plugin execution boundary

Two dependency-cruiser rules keep plugin host code (`apps/desktop/src/main/plugins/`) and the
plugin service (`apps/desktop/resources/plugin-host/`) away from the runtime barrel
(`packages/runtime/src/index.ts`) and the Claude Agent SDK / Codex SDK, directly or through any
chain of executable imports. These rules run with `tsPreCompilationDeps: false` in
`depcruise-plugin.mjs`, so erased type dependencies do not create runtime paths. The ordinary
scan in `depcruise.cjs` still includes type dependencies for the other module and cycle checks.
Both scans use dependency-cruiser's native rules and feed `baseline/depcruise.json`; new
violations fail the gate.
