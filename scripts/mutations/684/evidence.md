# 684 + 686 — Reader, tone and clarity evidence

Measured 2026-09-24 from base `5c8dffabac10819f8910ad48d5e89f6b77a2556a`.

## Rendered text

[Before](evidence/rendered-before.md), [pre-686](evidence/rendered-after.md) and
[after 686](evidence/rendered-after-686.md) contain every
role × provider, rendered by `composeProfileBundle`, published by `publishProfileBundle`,
and read by `readSessionInstructions`. Claude's capture is its composed append; Codex's
is its published `AGENTS.override.md`, which the provider reads itself. These captures prove
the text produced, not obedience. The live model runs below are separate observations.
The captures use plain-text fences so formatting cannot rewrite the delivered Markdown;
all eighteen bodies match the original capture strings byte for byte after formatting.

## Live comparisons

Bundled Codex `0.146.0`, model `gpt-5.6-luna`, default effort, fresh home per arm, identical
question and grants. One person turn per role plus one worker agent handover per revision.
`what-reaches-a-person-is-short.smoke.ts` records all results; its passing status means the
measurements completed, not that the behavioral comparison passed.

| Reader / role            | Before words | First candidate | Pre-686 | After 686 |
| ------------------------ | -----------: | --------------: | ------: | --------: |
| Person / BroBot          |           69 |              57 |      65 |        64 |
| Person / project manager |           72 |              59 |      71 |        68 |
| Person / worker          |           63 |              69 |      65 |        66 |
| Agent / worker           |           66 |              98 |      74 |        67 |

All person replies lead with the answer in all four runs. The first candidate made the
worker longer through recap; the next rule explicitly discouraged unnecessary recap.
**686 supersedes word-count-only acceptance:** the final rule adds a warm, natural voice,
plain current status and the person's action, without greetings, apologies or filler.
[The fixed rubric and per-reply judgments](evidence/686-judgments.md) apply the same three
criteria to every archived person reply, including the earlier candidates. After 686,
answer-first and status/action pass; the combined warm/lean/no-filler criterion is partial
because recap persists. Warmth was also acceptable in the baseline; a warmth improvement
is not established. These single samples cannot establish reliable obedience. No further
retries were made to obtain a preferred result.

The final agent control preserves time, capacity, attendee count, remote attendance,
monitor alternative, named next actions, access route and catering deadline. It omits
Thursday and weakens “the monitor works” to “should work”; invitation ownership and the
unsent-link state are implicit. It shows no abrupt truncation, but **complete factual
preservation is partial**. The per-reply review retains this limitation for every control.
This is a directly addressed agent handover, not a `reply_to_parent` tool invocation or a
test of that tool's existing payload bound.

[All answers and usage](evidence/live-results.json) include both intermediate candidates.
Spend across sixteen completed turns: 244,624 input tokens (73,728 cached), 3,508 output
tokens (2,005 reasoning), 248,132 total tokens. The four 686 turns account for 61,389 input
(44,032 cached), 875 output (504 reasoning), 62,264 total. **USD billing is not reported by Codex's
token-usage notification; no currency cost is inferred.** An initial harness assertion
failed before any model launch because it incorrectly expected Codex's native instruction
file to appear in the app-side injected list. That assertion was corrected; it spent no tokens.

Each phase announced a 600,000 ms wait budget: per arm, 30s open, 10s send, 90s answer,
10s close, 10s drain. Actual successful phases took 43.32s, 42.13s, and 45.38s including
test startup; the 686 phase took 54.18s. These are provider waits, not CI performance limits.

The first full CI run exited 1 on the smoke deadline inventory: the probe had bounded
individual waits but had not adopted `probeRunDeadline`, and the smoke count still said
64 rather than 65. The probe now uses the shared total deadline with owned cleanup,
and the inventory includes it. The 600,000 ms budget is unchanged. The focused prompt
and deadline suites pass 112 tests; the repaired harness was also run in render-only
mode, with no additional model spend. The first twelve live answers predate this harness
repair; the 686 run used the repaired deadline helper.

The second CI on `c7352f96` was stopped during tests when 686 arrived, before any source edit.
It has no recorded final exit or lifecycle verdict and is not claimed as a gate. The combined
dispatch response records the gate on the amended commit.

The headless runtime adapters use owned scratch `userData/provider-homes`; there is no
Electron/CDP listener and no port. Authentication goes through the product's own
`provisionCodexAuth` path, as in `lifecycle-stage.smoke.ts`. No credential is inspected by
the harness. Scratch homes were removed; only rendered text, replies and token counts remain.
the person's app, userData, findings, and port 9444 were not used.

## Regression and mutation controls

The new regression suite failed against the original factory text: ten failures, one pass.
After repair, the new suite plus `the-text-a-child-is-actually-told.test.ts` pass 82 tests.
The original text passes the forbidden-phrase guard while missing every new behavioral
clause. Two forbidden phrases are planted together to check that the guard reports both.
Each new clause also has an individual deletion control.

[Original targeted results](targeted-results.json) were measured by applying each declarative row
alone, running those same two test files, and restoring the original bytes in `finally`.
Each replacement required exactly one source match. M0 and M-END both passed 82 tests.

| Row    | Failed tests | Observation                                      |
| ------ | -----------: | ------------------------------------------------ |
| 684 M1 |           11 | Old universal rule restored                      |
| 684 M2 |           11 | Person instruction removed                       |
| 684 M3 |           11 | Agent detail instruction removed                 |
| 684 M4 |           10 | Unknown-reader fallback removed                  |
| 684 M5 |           10 | Current-recipient instruction removed            |
| 377 M4 |           12 | Parent-reply instruction leaks into common rules |

377 M4's original anchor moved because the universal rule was replaced. The subject still
exists, so the anchor was repaired and re-verified; no retirement was requested.

These are **targeted observations**, not a canonical mutation-table run. No `mutations.txt`
claim is published. The generated `mutate.sh` supports a future whole-project table run.

686 updates the person-rule anchors and adds M6 (warmth), M7 (current state/action) and M8
(no filler), each removing one new obligation while leaving brevity intact. The named
regression clauses and their individual deletion controls cover all three. Results from
reapplying all eight rows and repaired 377 M4 are in [targeted-results-686.json](targeted-results-686.json).
M0 and M-END again passed 82 tests; M1/M2/M3 failed 11 each, M4/M5/M6/M7/M8 failed 10
each, and 377 M4 failed 12. All replacements matched once and all source bytes were restored.
