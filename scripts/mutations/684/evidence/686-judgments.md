# 686 — Tone and clarity judgments

## Method fixed before the 686 live run

One manual review by the prompt agent, using the same question and criteria for every archived
reply. No model judge, additional model calls, or keyword score. Warmth is a subjective reading;
the reasons below make it reviewable. Word counts are descriptive, never the pass condition.

1. **Answer first:** the first substantive sentence answers whether the workshop can proceed.
2. **Current state and action:** distinguish what is ready from what remains to do; make the
   remote link, Wednesday monitor test, access arrangement and Tuesday catering deadline
   actionable. Use supplied owners where known; do not invent commitments or completed work.
3. **Warm and human without filler:** an approachable, natural answer in plain language with
   useful actions; no greetings, apologies, flattery, bureaucratic phrasing or unnecessary recap.
   A plain “Yes” can be warm enough; effusiveness is not required.

For each dimension: **pass** means all listed conditions hold; **partial** means a useful answer
with a specific omission, ambiguity or extra recap; **fail** means the core condition is absent.
An overall person pass needs all three passes. The agent control is judged separately for
complete facts and actionable handover: human brevity/tone does not apply to that reader.

The baseline and earlier candidates remain visible. This small sample can show observed
behavior, not reliable obedience or a causal improvement in warmth.

## Per-reply judgments

The unedited replies and token readings are in [live-results.json](live-results.json). Names
below identify its run label and role. “Partial” in the last column identifies excess recap;
these replies are approachable and contain no greeting, apology or flattery. The same standard
is applied before and after: replaying the supplied booking time and headcounts adds detail
beyond the brief reason “the room is large enough.”

| Run / person role                 | Answer first                                   | Current state and action                                                                                               | Warm and human without filler                                                                         |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| before / BroBot                   | Pass — opens “Yes, the workshop can go ahead.” | Pass — names Mina/Arun, access and catering steps; states the room is reserved.                                        | Partial — natural and helpful; closing paragraph repeats time and both headcounts.                    |
| before / project manager          | Pass — opens “Yes, the plan works.”            | Pass — ready room/monitor followed by outstanding actions and deadlines.                                               | Partial — plain voice; a full block restates booking, attendance and equipment before actions.        |
| before / worker                   | Pass — immediate go-ahead.                     | Pass — link, test, access and catering all actionable; no invented completion.                                         | Partial — human, direct instructions; final capacity/headcount bullet is recap.                       |
| candidate-1 / BroBot              | Pass — immediate go-ahead.                     | Pass — all four actions, names and deadlines, with a brief feasibility reason.                                         | Pass — approachable wording; the short capacity/monitor reason avoids repeating the supplied numbers. |
| candidate-1 / project manager     | Pass — immediate go-ahead.                     | Pass — all four actions and applicable owners/deadlines.                                                               | Partial — natural language; closing sentence repeats three supplied attendance/capacity numbers.      |
| candidate-1 / worker              | Pass — immediate go-ahead.                     | Pass — monitor alternative and all four actions are clear.                                                             | Partial — direct voice; starts the list by repeating time and three headcounts.                       |
| after / BroBot (pre-686)          | Pass — immediate go-ahead.                     | Pass — ready access route, room and monitor distinguished from link/test/catering work.                                | Partial — natural voice; opening recaps time, attendance, capacity, access and equipment.             |
| after / project manager (pre-686) | Pass — immediate go-ahead.                     | Partial — actions are clear, but “12 attendees … plus 2 remote” introduces ambiguity absent from the supplied wording. | Partial — approachable list; repeats time and attendance numbers at the end.                          |
| after / worker (pre-686)          | Pass — immediate go-ahead.                     | Pass — monitor alternative and all four actions clear.                                                                 | Partial — direct, human voice; opening repeats booking time and room capacity.                        |
| 686-after / BroBot                | Pass — immediate go-ahead.                     | Pass — Mina sends link/invitation, Arun tests Wednesday, access and Tuesday catering steps explicit.                   | Partial — plain, approachable voice without prefatory filler; still repeats time and both headcounts. |
| 686-after / project manager       | Pass — immediate go-ahead.                     | Pass — reserved room and working monitor stated; remaining actions and owners clear.                                   | Partial — natural “manageable” explanation, but opening repeats time, capacity and attendance.        |
| 686-after / worker                | Pass — immediate go-ahead.                     | Pass — monitor alternative and link/test/access/catering actions clear.                                                | Partial — helpful direct language; opening repeats time and both headcounts.                          |

**Observed outcome:** the 686 replies pass answer-first and status/action. Warmth is acceptable
in the ordinary-language sense, including in the baseline; there is no clear measured warmth
improvement. The combined warm/lean/no-filler criterion is partial because recap persists.
No reply claims to have sent an invitation, tested equipment or placed an order. Word reductions
alone do not pass 686. No further samples were taken to obtain a preferred result.

## Agent control, unchanged criterion

All four controls are directly addressed agent handovers, not `reply_to_parent` tool calls.
They retain the plan and useful next actions and show no abrupt truncation. Complete factual
preservation is **partial**, so this control does not prove that arbitrary long handovers survive.

| Run             | Review of the supplied facts                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before          | Thursday, booking time, capacity/attendance, remote attendees, broken projector, Mina/invitation, Arun/Wednesday, access ramp and catering deadline retained. “Monitor works” is not stated explicitly.                    |
| candidate-1     | All supplied facts retained, including the working monitor and Mina owning the invitation. Added concluding feasibility recap; detail is permitted for this reader.                                                        |
| after (pre-686) | Schedule, attendance and all actions retained; “works” weakens to “should work.” Mina's ownership is implied by assigning her the invitation.                                                                              |
| 686-after       | Booking time, capacity/attendance, remote attendees, projector, named actions, ramp and catering retained. Thursday is omitted; “works” weakens to “should work”; invitation ownership and unsent-link state are implicit. |

The 686 control is 67 words versus the baseline's 66. That count proves neither completeness
nor a length cap; the missing/changed facts above are the relevant limitation.
