"""605 · The card that cannot name its call — each row is THE DEFECT, put back verbatim (131).

⛔ **Where this came from.** `HO-042` §3 refused to build an approval card for Codex's external MCP
servers: *"a card that cannot name its subject cannot meet criterion 20 … That is not a weaker
card. It is a worse one."* ⚑ **The PO withdrew it** (`HO-090` §1): *"A card that says plainly this
is a tool call and we cannot yet tell you which is HONEST. It is not a card naming the wrong
subject. My ruling conflated two different things: naming something falsely, and admitting we do
not know."*

## 🔴 What the dispatch changed, in two sentences

⛔ **Codex's `externalMcpServers` entry moved from `unwired` to `available`**, because
`probe:codex-external-mcp` measured the reach end to end against the bundled 0.146.0 binary: a
server declared through `ThreadStartParams.config` registers, its tool answers, and the
model-bound turn carries it as `mcp__<server>__<tool>` — while the control that offered nothing
registered nothing.

⚑ **And `mcpServer/elicitation/request` became a card.** The frame carries `serverName` and a
`turnId` measured `null`, so the card names the SERVER, says BroBot cannot tell which call it
belongs to, and draws the server's own form as the questions BroBot already knows how to ask.

## ⚠️ The two hazards this table exists for

⛔ **A card that says MORE than the frame does** — a tool name, a call, or a claim that this app
checked what the server was about. `M1`-`M4` are that family.

⛔ **A card that says LESS than the person needs** — an admission demoted to a trailer (`593`'s
footnote cost, `414`'s attribution rule), a form answered in strings where the server asked for
types, or a request declined in silence. `M5`-`M9` are that family.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M5`, `M12` | ⚑ `apps/desktop/test/dom/the-card-that-cannot-name-its-call.dom.test.ts` |
| `M6`-`M11`, `M13` | ⚑ `packages/runtime/test/codex-runtime.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the `mcp_servers` KEY spelling.** A row that renamed it to `mcpServers` would be
caught by `probe:codex-external-mcp` and by nothing in `pnpm run ci` — and a mutation no gate can
see is a phantom survivor, not a measurement
(`a-mutation-that-changes-nothing-reports-as-a-survivor`, arriving through coverage rather than
through a no-op).

⛔ **No row that deletes the guard at `runtime-host.ts:307`.** `516 M9` owned that line and `605`
re-anchored it: with every shipped provider `available`, DELETING the guard changes nothing any
test can see, so the row now measures its POLARITY instead. One line, one owner.

⛔ **No row on `HO-042` §2's registration rail.** It is unchanged, it is not this dispatch's, and
`516`/`524` guard it already.
"""

CODEX = "packages/runtime/src/codex/external-mcp.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
CARD = "apps/desktop/src/renderer/src/components/UserInputCard.vue"

MUTATIONS = [
    # ── the card says more than the frame does ────────────────────────────────────────────────
    (
        "M1 · ⛔ THE WITHDRAWN RULING'S OWN FEAR, built · the card names a TOOL CALL it cannot "
        "identify — `HO-090` §3.2's *never names a call, never guesses one*, said as its opposite",
        [
            (
                CODEX,
                "    `${elicitation.serverName} is asking you something. Codex names the server and not the ` +",
                "    `${elicitation.serverName} is asking you about a tool call. Codex names the server and not the ` +",
            )
        ],
    ),
    (
        "M2 · 🔴 the admission is DELETED · the card names the server and stops, so a person reads "
        "a request they believe BroBot understood — the whole of `HO-090` §1.2",
        [
            (
                CODEX,
                "    `${elicitation.serverName} is asking you something. Codex names the server and not the ` +\n"
                "    `call, so BroCrew cannot tell you which of this server\\u2019s tools you are answering for.`",
                "    `${elicitation.serverName} is asking you something.`",
            )
        ],
    ),
    (
        "M3 · ⛔ the admission becomes a VERIFICATION · *BroBot has checked* in place of *BroBot "
        "cannot tell you* — a claim about an act this app never performs, which is the class "
        "`HO-018` and standing rule 8.3 are both about",
        [
            (
                CODEX,
                "    `call, so BroCrew cannot tell you which of this server\\u2019s tools you are answering for.`",
                "    `call, so BroCrew has checked which of this server\\u2019s tools you are answering for.`",
            )
        ],
    ),
    (
        "M4 · 🔴 the admission becomes a FOOTNOTE · the server's words come first and this app's "
        "own sentence trails them — `414`: *an attribution that follows the words it attributes is "
        "a footnote*, and `593` measured what a footnote costs on a desktop app",
        [
            (
                CODEX,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 moved the server's words into elicitationWords (they now include its link); the mutation is the same, the server's words above the admission
                "  return `${admission}${elicitationWords(elicitation)}`",
                "  return `${elicitationWords(elicitation).trimStart()}\\n\\n${admission}`",
            )
        ],
    ),
    # ── the form, and the types it is answered in ─────────────────────────────────────────────
    (
        "M5 · ⛔ a BOOLEAN is asked as a text box · `enumChoices` finds no list on one, and an "
        "empty list is the FREE-FORM case downstream — so a person types whatever they like into "
        "a field the server declared as true-or-false",
        [
            (
                CODEX,
                "      field.schema['type'] === 'boolean'\n"
                "        ? BOOLEAN_CHOICES.map((label) => ({ label, value: label }))\n"
                "        : enumChoices(field.schema)",
                "      enumChoices(field.schema)",
            )
        ],
    ),
    (
        "M6 · 🔴 the boolean goes back as the LABEL · `\"Yes\"` where the server's own schema says "
        "`boolean` — a value it rejects, sent after this app told the person their answer had gone",
        [
            (
                CODEX,
                "      content[field.key] = chosen[0] === BOOLEAN_CHOICES[0]",
                "      content[field.key] = chosen[0] ?? ''",
            )
        ],
    ),
    (
        "M7 · ⛔ a number that will not parse becomes `NaN` · the one conversion that can fail on a "
        "well-formed answer stops failing, and `141`'s HIGH 1 arrives on a third surface: the card "
        "is spent, the host records Answered, and the server got nonsense",
        [
            (
                CODEX,
                "      if (!Number.isFinite(parsed)) {\n"
                "        return { refusal: `${field.key} takes a number and \"${chosen[0]}\" is not one` }\n"
                "      }\n",
                "",
            )
        ],
    ),
    (
        "M8 · 🔴 a titled choice sends its TITLE · `oneOf` carries `{const, title}` — the title is "
        "written for a person and the const is what the server parses, so answering with the "
        "title answers a different question than the one that was asked",
        [
            (
                CODEX,
                "      choices?.find((choice) => choice.label === label)?.value ?? label",
                "      label",
            )
        ],
    ),
    # ── the requests this app cannot present, and the ones that are not ours ──────────────────
    (
        "M9 · ⛔ a mode this app cannot present is declined in SILENCE · no card, so the person "
        "never learns their own server asked them something — `HO-018`'s discipline inverted, and "
        "the defect `487`'s `could-not-represent-the-answers` exists to avoid",
        [
            (
                RUNTIME,
                "    const askable = elicitation.mode === 'form'",
                "    if (elicitation.mode !== 'form') {\n"
                "      this.respondToProvider(id, safeRefusal({ kind: 'elicitation' }))\n"
                "      return\n"
                "    }\n"
                "    const askable = elicitation.mode === 'form'",
            )
        ],
    ),
    (
        "M10 · 🔴 the THREAD check is dropped from the elicitation's scope rule · `060` P1's "
        "confused deputy, re-opened on the one request kind whose rule `605` narrowed — a foreign "
        "thread's server raises an actionable card in somebody else's conversation",
        [
            (
                # ⚠️ **ANCHOR CORRECTED inside this dispatch**, after the review added a
                # malformed-`turnId` guard between the thread check and the line this anchor used
                # as its neighbour. ⛔ The SUBJECT is unchanged — the row still deletes the thread
                # check — and the row was re-verified RED by hand after the correction.
                # ⚑ Still a PAIR and not the bare line: the same check appears in
                # `serverRequestScopeProblem` too, and that one is not this row's.
                RUNTIME,
                "    if (threadId !== ref.sessionId) return `foreign thread ${threadId}`\n"
                "    // ⛔ **ABSENT is `null`",
                "    // ⛔ **ABSENT is `null`",
            )
        ],
    ),
    (
        "M11 · ⛔ a granted server is declared on `thread/start` and NOT on the resume · the "
        "app-server remembers a `dynamicTools` declaration and does not remember a config "
        "overlay, so a reopened conversation loses the servers while its own sheet still shows "
        "the grant",
        [
            (
                RUNTIME,
                # ⚑ **736 · corrected in place, not retired** — the declaration gained the kept
                # *Always allow*s (R95), `codexExternalMcpConfig(externalMcp, kept)`; the row still
                # drops it from the RESUME.
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 sends the overlay (servers and the planning switch) through threadConfigOverlay; the mutation is the same, a resume declares none
                # ⚑ W4.189 · re-anchored in place: the overlay carries the work folders too.
                "  params.config = threadConfigOverlay(externalMcp, kept, workRoots)\n  return params\n}\n\n/**\n * What the SERVER said",
                "  return params\n}\n\n/**\n * What the SERVER said",
            )
        ],
    ),
    (
        # ⚑ **`M12` exists because the PHOTOGRAPH found the defect and no assertion did** (rule
        # 17.2). ⛔ The prompt carries a blank line between this app's admission and the server's
        # own words; HTML collapsed it, the two ran together into one paragraph, and the
        # admission `HO-090` §1.2 asks for *visibly* was inside the middle of it.
        "M12 · ⛔ the provider's own paragraph break is COLLAPSED · the admission and the server's "
        "words run together into one wall, which is `HO-090` §1.2 defeated by a whitespace rule "
        "rather than by a sentence",
        [
            (
                CARD,
                "  white-space: pre-line;\n}",
                "}",
            )
        ],
    ),
    (
        # ⛔ **`M13` exists because the diff review found the defect and the test did not.** The
        # test for that card counted responses and never read one, so a frame in the wrong shape
        # passed — `a-positive-assertion-must-differ-from-the-default`, arriving as an assertion
        # that asked the wrong question.
        "M13 · 🔴 an elicitation is answered with a `decision` · every other door on "
        "`respondPermission` answers that way and this one must not — the MCP server receives a "
        "frame it cannot parse, after BroBot has recorded the person's answer as taken",
        [
            (
                RUNTIME,
                # ⚑ **723 · re-anchored in place, not retired** — 723 (R80) moved the elicitation's own wire shape into `elicitationAnswer`; the row still answers an elicitation with a `decision`
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) added a server's zero-field form to `elicitationAnswer`'s arguments; the row still answers an elicitation with a `decision`
                # ⚑ **736 · corrected in place, not retired** — the non-elicitation arm gained R95's
                # offered amendment (`allow_always`); the row still answers an elicitation with a `decision`
                # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 gave elicitationAnswer a fourth argument, so the call spans lines; the mutation is the same, an elicitation answered with a decision
                "      state.kind.kind === 'elicitation'\n        ? elicitationAnswer(\n",
                "      false\n        ? elicitationAnswer(\n",
            )
        ],
    ),
]