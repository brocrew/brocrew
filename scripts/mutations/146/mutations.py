#!/usr/bin/env python3
"""
146 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — 143's M3 silently applied nothing because of two stray spaces, and a mutation that
did not apply is a green that means nothing.

`suite` selects which vitest project the runner uses: `node` (runtime + desktop) or `dom`.
"""

import sys
from pathlib import Path

PERM = "packages/runtime/src/permission.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
DB = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"
CARD = "apps/desktop/src/renderer/src/components/UserInputCard.vue"

# (name, suite, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · a card the provider is still waiting on -----------------------------------------
    (
        "M1 · [anchor corrected in place by 473: `noteAnswer` now reads `!ok` as *not settled* — a bridge call that never reached the host leaves the card LIVE — so the line wraps and gains a leading disjunct. The mutation is unchanged: `ack.stillOpen` → `false`, and a refusal the host said was still pending settles the card anyway] every refusal settles the card again (THE §1 DEFECT)",
        "node",
        [
            (
                STORE,
                "      !ok || (ack?.outcome === 'refused' && ack.stillOpen) ? markAnswerRefused : markRequestFailed",
                "      !ok || (ack?.outcome === 'refused' && false) ? markAnswerRefused : markRequestFailed",
            )
        ],
    ),
    (
        "M2 · the host stops saying the request survived",
        "node",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The rule survives:
        # refusalOf's not-usable/not-kept branch (a refused answer whose card is still live) still
        # returns stillOpen: true at runtime-host.ts:17506-17514, unchanged since before this
        # commit. The old anchor became ambiguous (count 2) only because D-017 added a second,
        # unrelated stillOpen:true return in the brand-new aPersonAnswersAQuestionThisAppAsked
        # (missing-answer-parts branch); widening the anchor to the not-usable/not-kept block
        # restores uniqueness.
        [
            (HOST, "    if (refusal === 'not-usable' || refusal === 'not-kept') {\n      return {\n        outcome: 'refused',\n        reason:\n          refusal === 'not-kept'\n            ? '“always” could not be kept, so nothing was sent — this request is still waiting'\n            : 'that answer cannot be sent: every question needs one that says something',\n        stillOpen: true,\n      }\n    }", "    if (refusal === 'not-usable' || refusal === 'not-kept') {\n      return {\n        outcome: 'refused',\n        reason:\n          refusal === 'not-kept'\n            ? '“always” could not be kept, so nothing was sent — this request is still waiting'\n            : 'that answer cannot be sent: every question needs one that says something',\n        stillOpen: false,\n      }\n    }"),
        ],
    ),
    (
        "M3 · markAnswerRefused writes a note instead",
        "node",
        [
            (
                TRANSCRIPT,
                "  if (item?.kind === 'permission' || item?.kind === 'userInput') item.refused = message",
                "  if (item?.kind === 'permission' || item?.kind === 'userInput') item.note = message",
            )
        ],
    ),
    (
        "M4 · the sentence is never drawn on a live card",
        "dom",
        [
            (
                CARD,
                '<p v-if="!settled && item.refused" class="refused" data-cy="user-input-refused">',
                '<p v-if="false && item.refused" class="refused" data-cy="user-input-refused">',
            )
        ],
    ),
    (
        "M5 · a refusal writes nothing at all",
        "node",
        [(STORE, "    if (ok && ack?.outcome !== 'refused') return", "    if (ok) return")],
    ),
    (
        "M6 · [anchor corrected in place by 473, with M1 and for M1's reason] a settling refusal stops settling (the paired positive)",
        "node",
        [
            (
                STORE,
                "      !ok || (ack?.outcome === 'refused' && ack.stillOpen) ? markAnswerRefused : markRequestFailed",
                "      !ok || ack?.outcome === 'refused' ? markAnswerRefused : markRequestFailed",
            )
        ],
    ),
    # ---- §2 · provider-controlled keys --------------------------------------------------------
    (
        "M7 · `in` instead of Object.hasOwn (the constructor crash)",
        "node",
        [
            (
                PERM,
                "    const value = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined",
                "    const value = question.id in answers ? answers[question.id] : undefined",
            )
        ],
    ),
    (
        "M8 · a non-string member reaches .trim() again",
        "node",
        [
            (
                PERM,
                "      (member) => typeof member === 'string' && member.trim() !== '',",
                "      (member) => member.trim() !== '',",
            )
        ],
    ),
    (
        "M9 · the IPC answer map goes back to z.record",
        "node",
        [
            (
                PERM,
                "    answers: answerMapSchema,",
                "    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),",
            )
        ],
    ),
    (
        "M10 · the IPC answer map keeps Object.prototype",
        "node",
        [
            (
                PERM,
                "  const answers: Record<string, string | string[]> = Object.create(null)\n  for (const key of Object.keys(value)) {",
                "  const answers: Record<string, string | string[]> = {}\n  for (const key of Object.keys(value)) {",
            )
        ],
    ),
    (
        "M11 · Claude's answers dictionary goes back to {}",
        "node",
        [(CLAUDE, "      const answers: Record<string, string> = Object.create(null)", "      const answers: Record<string, string> = {}")],
    ),
    (
        "M12 · Codex's response payload goes back to {}",
        "node",
        [
            (
                CODEX,
                "  const answers: Record<string, { answers: string[] }> = Object.create(null)",
                "  const answers: Record<string, { answers: string[] }> = {}",
            )
        ],
    ),
    (
        "M13 · the card's draft goes back to a plain object",
        "dom",
        [
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 468, not retired.** `RequestDraft` gained
            # `answered` — the half of `sent` that nothing takes back — so the card's own fallback
            # literal is five lines rather than one. ⛔ Same label, same defect, same kill: the
            # `Map` becomes a plain object and `__proto__` stops being a key it can hold.
            (
                CARD,
                "  answers: new Map(),\n  sent: false,",
                "  answers: {} as never,\n  sent: false,",
            ),
            (CARD, "  const value = draft.value.answers.get(question.id)", "  const value = (draft.value.answers as never as Record<string, string | string[]>)[question.id]"),
            (CARD, "    draft.value.answers.set(question.id, label)", "    ;(draft.value.answers as never as Record<string, string | string[]>)[question.id] = label"),
            (
                CARD,
                "  draft.value.answers.set(question.id, [\n    ...question.options.map((option) => option.label).filter((l) => next.has(l)),\n    ...other,\n  ])",
                "  ;(draft.value.answers as never as Record<string, string | string[]>)[question.id] = [\n    ...question.options.map((option) => option.label).filter((l) => next.has(l)),\n    ...other,\n  ]",
            ),
            (CARD, "    draft.value.answers.set(question.id, text)", "    ;(draft.value.answers as never as Record<string, string | string[]>)[question.id] = text"),
            (
                CARD,
                "  draft.value.answers.set(question.id, text.trim() === '' ? labels : [...labels, text])",
                "  ;(draft.value.answers as never as Record<string, string | string[]>)[question.id] =\n    text.trim() === '' ? labels : [...labels, text]",
            ),
        ],
    ),
    (
        "M14 · the card's answer payload keeps Object.prototype",
        "dom",
        [(CARD, "  const payload: Record<string, string | string[]> = Object.create(null)", "  const payload: Record<string, string | string[]> = {}")],
    ),
    # ---- §3 · two questions that cannot be told apart -----------------------------------------
    (
        "M15 · duplicateAnswerKey never finds one",
        "node",
        [(PERM, "    if (seen.has(key)) return key", "    if (false) return key")],
    ),
    (
        "M16 · Claude publishes duplicate prompt text again",
        "node",
        [(CLAUDE, "    if (toolName === 'AskUserQuestion' && duplicate !== null) {", "    if (false && duplicate !== null) {")],
    ),
    (
        "M17 · Codex publishes duplicate ids again",
        "node",
        [(CODEX, "    if (!isPermission && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {", "    if (false) {")],
    ),
    # ---- §4.1 · replay parses -----------------------------------------------------------------
    (
        "M18 · replay casts again (143's shape)",
        "node",
        [
            (
                PERM,
                "  return z.array(userInputQuestionSchema).parse(questions)",
                "  return questions as readonly UserInputQuestion[]",
            )
        ],
    ),
    (
        "M19 · boundStoredEvent stops parsing user_input_request",
        "node",
        [
            (
                DB,
                "    return { ...event, questions: [...storedQuestionsParsed(event.questions)] }",
                "    return event",
            )
        ],
    ),
    # ---- §4.2 / §5.1 · one membership rule ----------------------------------------------------
    (
        "M20 · membership goes back to trim-equivalence",
        "node",
        [
            (
                PERM,
                "  return question.options.some((option) => option.label === value)",
                "  return question.options.some((option) => option.label.trim() === value.trim())",
            )
        ],
    ),
    (
        "M21 · the card trims what it sends again",
        "dom",
        [
            (
                CARD,
                "    const picked = chosen(question)\n    payload[question.id] = question.multiSelect ? picked : (picked[0] ?? '')",
                "    const picked = chosen(question)\n      .map((value) => value.trim())\n      .filter((value) => value !== '')\n    payload[question.id] = question.multiSelect ? picked : (picked[0] ?? '')",
            )
        ],
    ),
    # ---- §4.3 · the Codex description branch --------------------------------------------------
    (
        "M22 · Codex drops non-empty option descriptions (145 MEDIUM 3's green)",
        "node",
        [
            (
                CODEX,
                "                  ...(readString(o, 'description') === ''\n                    ? {}\n                    : { description: readString(o, 'description') }),",
                "",
            )
        ],
    ),
    (
        "M23 · Claude drops non-empty option descriptions",
        "node",
        [
            (
                CLAUDE,
                "                  ...(typeof o['description'] === 'string' && o['description'] !== ''\n                    ? { description: o['description'] }\n                    : {}),",
                "",
            )
        ],
    ),
    # ---- §5.3 · the two narrow false-greens ---------------------------------------------------
    (
        "M24 · CSS hides only the SECOND described row",
        "dom",
        [
            (
                CARD,
                ".choice .describe {\n  display: block;",
                ".input-choices.described .choice:nth-child(2) .describe {\n  visibility: hidden;\n}\n\n.choice .describe {\n  display: block;",
            )
        ],
    ),
    (
        "M25 · CSS hides only the SECRET field",
        "dom",
        [
            (
                CARD,
                ".input-field input {\n  width: 100%;",
                ".input-field input[type='password'] {\n  visibility: hidden;\n}\n\n.input-field input {\n  width: 100%;",
            )
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
