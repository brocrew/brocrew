"""728 · Tool and MCP calls behave as the CLI does — PM ruling R93 (with R92).

⚑ *"A tool call or an MCP call (external servers, elicitation forms, tool approvals) reaches the
provider and is decided exactly as that provider's own CLI or desktop app decides it: in `ask`, the
person sees what the CLI would show them; in `auto`, what the CLI would let through goes through.
BroBot never declines, narrows, rewrites or adds an ask on its own account, and removes the ones it
has."*

## 🔴 A · Codex — a server's own zero-field form is shown, as the Codex CLI shows it (M1-M7)

⚑ Measured, the Codex CLI's own terminal UI (bundled 0.146.0): the server's words with *Allow*, *Deny*
and *Cancel*; Allow sent `{action:"accept",content:{}}`. ⛔ `142` §2 declined it with no card. ⚑ And a
server's form NOBODY answered (a Stop, a close) is told `cancel`, never MCP's *"the user declined"*.

## 🔴 B · Whose request it is — a server's own, marked, on both providers, and said (M8-M15)

⚑ R93's kept half: saying truly WHO is asking and WHAT a press does. A server's form is marked
`mcpServerAsks` on its card; the question channel refuses it BY NAME, above the permission branch;
and the lines under its Allow and Deny name the SERVER (its Cancel keeps `730`'s R81 words). ⚠️ `723`
F-2's residual (a server's form wearing Codex's approval marker during a call Codex ran unasked) is
measured and still open: `728` tried Codex's own tool list and withdrew it, because the list re-asks
the server that forges the frame.

## 🔴 C · Claude — a server's form reaches the person (M16-M24)

⚑ `probe:tool-calls-as-the-cli`: the CLI handed its host a one-field form and a zero-field form; with
no `onElicitation` the SDK declined both unseen. ⚑ Its Cancel stops nothing — the request names no
call, so no turn can be said to be its (`728`'s review).

## 🔴 D · Claude — the CLI's own engine decides what to ask, and the narrow grant is its rule (M25-M34)

⚑ `probe:tool-calls-as-the-cli`: with this app's hook out, the CLI asked everywhere it did but `ls`,
`echo` and `git status`; in plan mode — also as the MODEL enters it from a session that may skip
permissions (`enter-plan-*-auto`) — it asks before a `Write`, an `rm` and an MCP tool, and runs `wc -l`;
its skip-permissions asks nothing outside plan mode (`auto-*`). Its plan-mode ask carries no "don't
ask again" of its own, an ordinary ask does (`plan-bash-rm`). A scratch probe of `728` measured the
rule spelling that covers one file (`Edit(//…)`, `Read(//…)`).

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9` | ⚑ **`run_suite`** — `packages/runtime/test/codex-runtime.test.ts` |
| `M1`, `M3`, `M4`, `M6` | ⚑ **`run_suite`** — `a-press-that-stops-nothing-says-so.test.ts` |
| `M10`, `M11`, `M16`-`M24` | ⚑ **`run_suite`** — `a-servers-form-reaches-the-person.test.ts` |
| `M12`, `M13` | ⚑ **`run_suite`** — `the-question-channel.test.ts` |
| `M14` | ⚑ **`run_suite`** — `when-codex-asks-to-run-an-mcp-tool.render.test.ts` |
| `M15` | ⚑ **`run_suite`** (DOM) — `what-a-card-says-a-press-does.dom.test.ts` |
| `M25`-`M33` | ⚑ **`run_suite`** — `the-cli-decides-what-to-ask.test.ts` |
| `M26` | ⚑ **`run_suite`** — `claude-runtime.test.ts` |
| `M34` | ⚑ **`run_suite`** — `conversation-chrome.render.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the live probes** — `probe:tool-calls-as-the-cli` and `probe:codex-mcp-tool-approval`
(loopback, $0) are not in `ci`; their runs are in `728`'s response. ⛔ **No row on the plan floor, the memory carve-out or the memory bound**:
R93 removed them, and the rows that guarded them are retired by name in this commit's census. ⛔ **No row
on the rails while planning**: `728` first stood them aside, and withdrew that in review — the rails
stay the whole gate for this app's own verbs in every mode, and `486 M4`'s mutation is now the code.
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CLAUDECAPS = "packages/runtime/src/claude/capabilities.ts"
CHANNEL = "packages/runtime/src/question-channel.ts"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"

RT = "codex-runtime.test.ts"
PRESS = "a-press-that-stops-nothing-says-so.test.ts"
FORM = "a-servers-form-reaches-the-person.test.ts"
HOOK = "the-cli-decides-what-to-ask.test.ts"
CHROME = "conversation-chrome.render.test.ts"
QCHAN = "the-question-channel.test.ts"
CRT = "claude-runtime.test.ts"
CODEXMCP = "when-codex-asks-to-run-an-mcp-tool.render.test.ts"
PRESSDOM = "what-a-card-says-a-press-does.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        f"M1 · 🔴 **a server's zero-field form is declined in silence again** · `142` §2's gate, which R93 removed (`main`) — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    const askable = elicitation.mode === 'form' && toolApproval === null && !confirmsAServersForm\n", "    if (confirmsAServersForm) {\n      this.respondToProvider(id, safeRefusal({ kind: 'elicitation' }))\n      return\n    }\n    const askable = elicitation.mode === 'form' && toolApproval === null && !confirmsAServersForm\n"),
        ],
    ),
    (
        f"M2 · ⛔ **a form WITH fields is drawn as the server's yes/no card** · its fields never asked, and Allow sends no answer — killed by `{RT}`",
        [
            (CODEX, "    const confirmsAServersForm =\n      toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length === 0\n", "    const confirmsAServersForm =\n      toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length >= 0\n"),
        ],
    ),
    (
        f"M3 · 🔴 **the server's card offers no way to allow** · the CLI's *Allow* withheld — killed by `{RT}` and `{PRESS}`",
        [
            # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 added a shown link (I opened it); the mutation is the same, the server's card offers no way to allow
            (CODEX, "        : confirmsAServersForm || showsALink\n          ? ['allow']\n          : [],\n", "        : [],\n"),
        ],
    ),
    (
        f"M4 · 🔴 **Allow on it runs nothing** · the flag the answer reads is never set, so Allow goes back as `decline` — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "      if (confirmsAServersForm) claimed.confirmsAServersForm = true\n", ""),
        ],
    ),
    (
        f"M5 · ⚠️ **its card says it has no way to allow** · the word for why, on a card that has one — killed by `{RT}`",
        [
            # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 added a shown link; the mutation is the same, the word for why on a card that has a way to allow
            (CODEX, "                ...(confirmsAServersForm || showsALink\n                  ? {}\n                  : { noPositiveBecause: 'could-not-represent-the-answers' as const }),\n", "                noPositiveBecause: 'could-not-represent-the-answers' as const,\n"),
        ],
    ),
    (
        f"M6 · 🔴 **Allow is read only for Codex's own card** · a server's form is told `decline` for an Allow — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "  if ((approval !== undefined || confirmsAServersForm) && decision.outcome === 'allow') {\n", "  if (approval !== undefined && decision.outcome === 'allow') {\n"),
        ],
    ),
    (
        f"M7 · ⛔ **a server's form NOBODY answered is told `decline`** · MCP's word for a person's explicit no, sent by a Stop or a close — killed by `{RT}`",
        [
            (CODEX, "    const nobodysAnswer =\n      toolApproval === null\n        ? { action: 'cancel', content: null, _meta: null }\n        : safeRefusal({ kind: 'elicitation' })\n", "    const nobodysAnswer = safeRefusal({ kind: 'elicitation' })\n"),
        ],
    ),
    (
        f"M8 · 🔴 **a Codex server's QUESTION card stops saying it is the server's** · and can travel to a parent agent as the model's own question — killed by `{RT}`",
        [
            # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds mcpServerAsks with serverAsks() (it may carry the url); the mutation is the same
            (CODEX, "            questions: elicitationQuestions(elicitation),\n            // ⚑ 728 · the SERVER asks, not the agent — see {@link RuntimeEvent} `mcpServerAsks`.\n            mcpServerAsks: serverAsks(elicitation),\n", "            questions: elicitationQuestions(elicitation),\n"),
        ],
    ),
    (
        f"M9 · 🔴 **a Codex server's zero-field card stops saying it is the server's** — killed by `{RT}`",
        [
            # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds mcpServerAsks with serverAsks(); the mutation is the same
            (CODEX, "              // ⚑ 728 · the SERVER asks, not the agent — never on Codex's own approval card.\n              mcpServerAsks: serverAsks(elicitation),\n", ""),
        ],
    ),
    (
        f"M10 · 🔴 **a Claude server's QUESTION card stops saying it is the server's** — killed by `{FORM}`",
        [
            # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds mcpServerAsks with serverAsks(); the mutation is the same
            (CLAUDE, "        questions,\n        mcpServerAsks: serverAsks(elicitation),\n", "        questions,\n"),
        ],
    ),
    (
        f"M11 · 🔴 **a Claude server's zero-field card stops saying it is the server's** — killed by `{FORM}`",
        [
            # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds mcpServerAsks with serverAsks(); the mutation is the same
            (CLAUDE, "      // ⚑ The SERVER asks, not the agent — see {@link RuntimeEvent} `mcpServerAsks`.\n      mcpServerAsks: serverAsks(elicitation),\n", ""),
        ],
    ),
    (
        f"M12 · ⛔ **the question channel stops naming a server's request** · it is refused only as an unknown shape, with no word for whose it is — killed by `{QCHAN}`",
        [
            (CHANNEL, "  if (Object.hasOwn(asked, 'mcpServerAsks') && asked['mcpServerAsks'] !== undefined) {\n    return { travels: false, id, because: 'a-server-asks-the-person' }\n  }\n", ""),
        ],
    ),
    (
        f"M13 · ⛔ **the channel asks the permission branch first** · a server's zero-field card or url visit is recorded as the agent's approval — killed by `{QCHAN}`",
        [
            (CHANNEL, "  if (Object.hasOwn(asked, 'mcpServerAsks') && asked['mcpServerAsks'] !== undefined) {\n    return { travels: false, id, because: 'a-server-asks-the-person' }\n  }\n  if (event.type === 'permission_request') {\n    return { travels: false, id, because: 'a-permission-decision' }\n  }\n", "  if (event.type === 'permission_request') {\n    return { travels: false, id, because: 'a-permission-decision' }\n  }\n  if (Object.hasOwn(asked, 'mcpServerAsks') && asked['mcpServerAsks'] !== undefined) {\n    return { travels: false, id, because: 'a-server-asks-the-person' }\n  }\n"),
        ],
    ),
    (
        f"M14 · 🔴 **a server's card speaks of the agent again** · *\"the agent is refused this one thing\"* under a Deny that tells the SERVER no — killed by `{CODEXMCP}`",
        [
            (OFFER, "  if (decision.server !== undefined) {\n", "  if (false) {\n"),
        ],
    ),
    (
        f"M15 · ⚠️ **a server's form says the agent gets its answers** · the SERVER does — killed by `{PRESSDOM}`",
        [
            (OFFER, "        : `${server.name} gets the answers you filled in here`,\n", "        : ANSWER_SENDS_THE_FORM,\n"),
        ],
    ),
    (
        f"M16 · 🔴 **the SDK declines every form again** · no `onElicitation` on the query (`main`) — killed by `{FORM}`",
        [
            (CLAUDE, "    options.onElicitation = (request, o) => handle.handleElicitation(request, o.signal, o.requestId)\n", ""),
        ],
    ),
    (
        f"M17 · ⛔ **a form with fields is a yes/no card** · its fields never asked — killed by `{FORM}`",
        [
            (CLAUDE, "    if (elicitation.mode === 'form' && elicitation.fields.length > 0) {\n", "    if (false) {\n"),
        ],
    ),
    (
        f"M18 · ⛔ **an answer the server's own types reject goes back anyway** · a word for a number — killed by `{FORM}`",
        [
            (CLAUDE, "      if (built !== null && 'refusal' in built) {\n", "      if (false) {\n"),
        ],
    ),
    (
        f"M19 · 🔴 **Allow on a zero-field form runs nothing** — killed by `{FORM}`",
        [
            # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 answers a url request's I opened it in the same branch; the mutation is the same, Allow runs nothing
            (CLAUDE, "    if (decision.outcome === 'allow') {\n      return showsALink ? { action: 'accept' } : { action: 'accept', content: {} }\n    }\n", ""),
        ],
    ),
    (
        f"M20 · ⚠️ **the card stops saying its Cancel stops nothing** · the request names no call, so no turn is its (`728`'s review) — killed by `{FORM}`",
        [
            (CLAUDE, "      cancelStopsNothing: true,\n", ""),
        ],
    ),
    (
        f"M21 · ⛔ **a form a Stop settled is told `decline`** · MCP's word for a person's explicit no — killed by `{FORM}`",
        [
            (CLAUDE, "    this.machine.endWait()\n    if (settled) return { action: 'cancel' }\n", "    this.machine.endWait()\n    if (settled) return { action: 'decline' }\n"),
        ],
    ),
    (
        f"M22 · ⛔ **a url form is offered Allow** · a visit nobody made — killed by `{FORM}`",
        [
            # Offer the URL action for a link the card withheld. It must not claim a visit nobody
            # could make; the withheld-link arm kills the mutation.
            (CLAUDE, "    const offer = publishedOffer(elicitation.mode === 'form' || showsALink ? ['allow'] : [])\n", "    const offer = publishedOffer(['allow'])\n"),
        ],
    ),
    (
        f"M23 · ⚠️ **the card stops saying who is asking** · the server's words, with no admission before them — killed by `{FORM}`",
        [
            (CLAUDE, "    `${elicitation.serverName} is asking you something. Claude names the server and not the ` +\n    `call, so BroCrew cannot tell you which of this server\\u2019s tools you are answering for.`\n", "    `${elicitation.serverName} is asking you something.`\n"),
        ],
    ),
    (
        f"M24 · ⚠️ **the note stops saying the form reaches you** · and that the CLI asks whatever the server says (rule 5, by name) — killed by `{FORM}`",
        [
            # ⚑ **736 · corrected in place** — the note now also names a grant or a kept rule; the row
            # still drops both claims it guards.
            (CLAUDECAPS, "whatever the server says about the tool — unless you allowed that tool for the conversation or kept a rule that allows it — and a form the server sends reaches you to answer.", "and each of its tool calls asks you the same way every other consequential action does."),
        ],
    ),
    (
        f"M25 · 🔴 **the forced ask is back** · every call this hook does not answer is asked about by this app (`013`, `main`) — killed by `{HOOK}`",
        [
            (CLAUDE, "            // through runs.\n            return { continue: true }\n", "            // through runs.\n            return askFor('questions')\n"),
        ],
    ),
    (
        f"M26 · 🔴 **`auto` answers the CLI's plan-mode ask** · a planning conversation writes what the CLI would ask a person about (measured, `enter-plan-write-auto`) — killed by `{HOOK}` and `{CRT}`",
        [
            (CLAUDE, "    if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {\n", "    if (isAutoApprove({ approvalMode: this.approvals.effective })) {\n"),
        ],
    ),
    (
        f"M27 · 🔴 **a plan the MODEL starts in `auto` is not recorded** · `auto` goes on answering the plan mode's asks (measured, `enter-plan-write-auto`; `728`'s review) — killed by `{HOOK}`",
        [
            (CLAUDE, "        if (gesture !== undefined) this.plan.settle(gesture)\n", ""),
        ],
    ),
    (
        f"M28 · ⛔ **the CLI's plan-mode ask is offered a conversation grant** · one its check never consults — killed by `{HOOK}`",
        [
            # ⚑ **always allow that recurs · re-anchored in place, not retired** — the condition spread over three lines when this app's own tools joined it; the plant still drops the planning half, so the CLI's plan-mode ask is offered a conversation grant
            (CLAUDE, "        (this.planning && !offersAStandingRule(options)) ||\n", ""),
        ],
    ),
    (
        f"M29 · 🔴 **an ORDINARY ask while planning loses its grant** · the CLI offered its own \"don't ask again\" (measured, `plan-bash-rm`) and BroBot withholds it — killed by `{HOOK}`",
        [
            # ⚑ **always allow that recurs · re-anchored in place, not retired** — the condition spread over three lines when this app's own tools joined it; the plant still withholds the grant from every ask while planning, an ordinary one included
            (CLAUDE, "        (this.planning && !offersAStandingRule(options)) ||\n", "        this.planning ||\n"),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R94 (PM): *"BroBot installs the rule the provider's CLI itself suggests for that ask … never a narrower one of BroBot's own."* `728`'s per-file rule (`fileGrantRules`) this row mutated is gone; the grant is the CLI's own suggestion, held to the session (table `736` M1–M4).
    (
        f"M30 · 🔴 **the grant is spelled with ONE slash** · measured: the CLI does not honour it, so the same file is asked again — killed by `{HOOK}`",
        [
            (CLAUDE, "      rules: paths.map((path) => ({ toolName: family, ruleContent: `/${path}` })),\n", "      rules: paths.map((path) => ({ toolName: family, ruleContent: path })),\n"),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R94 (PM): *"BroBot installs the rule the provider's CLI itself suggests for that ask … never a narrower one of BroBot's own."* `728`'s per-file rule (`fileGrantRules`) this row mutated is gone; the grant is the CLI's own suggestion, held to the session (table `736` M1–M4).
    (
        f"M31 · 🔴 **a write grant is spelled `Write`** · measured: not honoured — killed by `{HOOK}`",
        [
            (CLAUDE, "  const family = toolName === 'Read' || toolName === 'NotebookRead' ? 'Read' : 'Edit'\n", "  const family = toolName\n"),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R94 (PM): *"BroBot installs the rule the provider's CLI itself suggests for that ask … never a narrower one of BroBot's own."* `728`'s per-file rule (`fileGrantRules`) this row mutated is gone; the grant is the CLI's own suggestion, held to the session (table `736` M1–M4).
    (
        f"M32 · ⛔ **a path the CLI reads as a PATTERN is granted** · `*.txt` covers every text file, not the one the card named — killed by `{HOOK}`",
        [
            (CLAUDE, "  if (paths.some((path) => !path.startsWith('/') || /[*?[\\]\\\\!#\\n]/.test(path))) return null\n", "  if (paths.some((path) => !path.startsWith('/'))) return null\n"),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R94 (PM): *"BroBot installs the rule the provider's CLI itself suggests for that ask … never a narrower one of BroBot's own."* `728`'s per-file rule (`fileGrantRules`) this row mutated is gone; the grant is the CLI's own suggestion, held to the session (table `736` M1–M4).
    (
        f"M33 · ⛔ **the offer ignores it** · the narrow grant drawn for a path it cannot spell, and taken — killed by `{HOOK}`",
        [
            (CLAUDE, "  const decisions = claudeDecisionsFor(fullyDisclosed, grantsWithheld || unspellable)\n", "  const decisions = claudeDecisionsFor(fullyDisclosed, grantsWithheld)\n"),
        ],
    ),
    (
        f"M34 · ⚠️ **the plan note promises a floor again** · *\"brobot2 refuses every tool that would change anything\"* — killed by `{CHROME}`",
        [
            (CLAUDECAPS, "      'While it is planning, Claude’s own plan mode governs what it does: it asks you before it ' +\n      'changes your files, runs a command it cannot tell is harmless, or uses a server’s tool, even ' +\n      'in a conversation that does not otherwise ask you first.',\n", "      'While it is planning it may read, and brobot2 refuses every tool that would change anything.',\n"),
        ],
    ),
]
