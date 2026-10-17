"""684: the intended reader scopes brevity; no numeric output ceiling is introduced.

Each row removes an obligation whose named assertion runs across every role/provider.
The historical universal rule passes the old forbidden-text guard, so M1 distinguishes
the new requirement from those existing guards. Targeted observations live in evidence.md;
they are not a canonical whole-project mutation-table run.
"""

TEXT = "apps/desktop/src/main/runtime/factory-text.ts"
HAND_BACK = "apps/desktop/resources/built-in-skills/hand-back/SKILL.md"
READER = (
    "  'Address each message to its intended reader. Use the stated recipient and the incoming ' +\n"
    "    'message’s sender attribution; do not infer the reader from your role or from who started ' +\n"
    "    'this conversation.',"
)
PERSON = (
    # The voice-sentence anchor changed; preserve the mutation and its NOT VERIFIED status.
    # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
    # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v14 texts moved the anchor; original defect, ID and killer retained.
    # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
    "Lead with the answer or needed decision in warm, plain words ' +\n    \"matching the person's language and register. "
)
MUTATIONS = [
    (
        "M1 · restore the old universal whole-answer rule; old forbidden-text guards still pass",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — PE-009 (4c598c4b) reworded the reader rule and inserted a new agent-note rule
        # between it and the person rule, so the contiguous old block no longer matches. The defect
        # is unchanged: restore the old universal 'give the whole answer' line in place of the whole
        # reader/note/person/agent/unknown-reader block, which the old forbidden-text guards still
        # pass. The new old text is that block as it now stands, matching once. Killed by
        # `what-reaches-a-person-is-short.test.ts`.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — the v6 core replaced "How you work" and "Rules", and its reader sentence now says a reply goes to the person and the sender line names whose words came in, not who reads (W6, 2026-10-12); the same mutation, applied to the core's sentence as it now reads. NOT VERIFIED
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
            (TEXT, "  'Address the actual reader. ", "  'Give the whole answer. Never truncate it, and never guess at a limit you were not told. "),
        ],
    ),
    ("M2 · remove the instruction for a person", [(TEXT, PERSON, "' +\n    \"")]),
    ("M3 · remove complete detail for an agent",
        # ⚑ **W4.481 · re-homed onto the skill that carries the rule, not retired** — the v6 core leaves the whole-detail rule to the hand-back skill, where three sentences carry it: write the full findings to a file, put all necessary detail in the kept file, and never cut it short. The plant takes all three, so the defect is the whole rule, as it was. NOT VERIFIED. Killed by `built-in-skills-rules.test.ts`.
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v14 texts moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
            (HAND_BACK, "The owner keeps project records and integrates corrections. For a file-based result, keep the full detail and relevant evidence in supported files on the piece; a path mentioned only in chat is not a kept file. ", ""),
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
            (HAND_BACK, "For a file-free result, put enough in the reply or checkpoint to satisfy the request; do not manufacture a document.", ""),
        ]),
    # ⛔ **RETIRED BY RULING (W4.643, the v21 consolidation):** hand-back's sentence for an unclear recipient was removed
    # from the shipped text on purpose, and no v21 sentence carries it. Its anchor is left
    # stale, so the census records it retired (`anchor-absent`).
    ("M4 · remove the unknown-reader fallback",
        # ⚑ **W4.481 · re-homed onto the skill that carries the rule, not retired** — the v6 core leaves this rule to the hand-back skill, so the plant takes the unclear-recipient sentence there. NOT VERIFIED. Killed by `built-in-skills-rules.test.ts`.
        [(HAND_BACK, "If the recipient is unclear, preserve the full detail and keep the reply short.", "")]),
    ("M5 · remove the instruction to use the current recipient rather than launch provenance",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — PE-009 (4c598c4b) rewrote the reader rule's wording ('Address each message to
        # the reader who will receive it. Use the stated recipient to direct outgoing words; ...'),
        # so the old READER text no longer exists. The rule survives (use the stated recipient,
        # never launch provenance), so removing the reworded rule is the same defect. The test's
        # CLAUSES.recipient, .sender and .noRoleGuess were re-aimed to the new words in the same
        # commit. Killed by `what-reaches-a-person-is-short.test.ts`.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — the v6 core replaced "How you work" and "Rules", and its reader sentence now says a reply goes to the person and the sender line names whose words came in, not who reads (W6, 2026-10-12); the same mutation, applied to the core's sentence as it now reads. NOT VERIFIED
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
            (TEXT, "  'Address the actual reader. ", "  '"),
        ],
    ),
    ("M6 · 686 removes warmth but leaves brevity intact", [(TEXT,
        # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
        # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
        # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
        "decision in warm, plain words ' +\n    \"matching", "decision ' +\n    \"matching")]),
    # ⛔ **RETIRED BY RULING (W4.643, the v21 consolidation):** the core's clause naming what is happening and what the person must do was removed
    # from the shipped text on purpose, and no v21 sentence carries it. Its anchor is left
    # stale, so the census records it retired (`anchor-absent`).
    ("M7 · 686 removes current status and the person's next action", [(TEXT,
        # The voice-sentence anchor changed; preserve the mutation and its NOT VERIFIED status.
        # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
        "what is happening and what they need to do. ", "")]),
    ("M8 · 686 removes the instruction against warmth as padding", [(TEXT,
        # The voice-sentence anchor changed; preserve the mutation and its NOT VERIFIED status.
        # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
        # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v14 texts moved the anchor; original defect, ID and killer retained.
        # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
        # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
        "Keep greetings and \" +\n    'apologies brief; ", "\" +\n    '")]),
    (
        "M9 · the core loses its recap sentence: a person is no longer told what to recap (what was "
        "understood before a big task, or the context on their return), and nothing else the core "
        "says carries it · killed by `what-reaches-a-person-is-short.test.ts`",
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v14 texts moved the anchor and dropped the recap examples; original defect, ID and killer retained.
            (
                TEXT,
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
                "Keep recaps useful. ",
                "",
            )
        ],
    ),
]
