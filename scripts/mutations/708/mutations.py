"""708 · A command goes as typed.

⚑ **Ordered by** the PM — `704` H-1 (ruled `R42`) and H-7.

## 🔴 A · `R42` — a person's command goes to the provider exactly as typed (M1-M15, M21-M26)

⚑ Measured by `probe:claude-command-as-typed` against the bundled CLI 2.1.281: a framed `/clear` or
`/compact` is handed to a model as words and runs nothing; the same command bare RUNS
(`conversation_reset`; `compact_boundary`), and the person's `origin` stamp changes no frame. The
host now decides it in `handToProvider`, from the `from` the door derived and the list the
provider published or answered with; the gate every turn passes refuses a command that carries
attachments.

## ⚑ B · the Claude adapter answers the ask, and publishes what it answered (M16)

## ⚑ C · the probe's verdict, pinned from `ci` (M17-M19)

## ⚑ D · `704` H-7 — a run somebody is reading is never pruned (M20, M22)

## ⛔ What this table cannot reach

 * ⚠️ **The live probes** (`probe:claude-command-as-typed`, `probe:codex-command-as-typed`) — not in
   `ci`; the Claude probe's reading is (section C), and both runs' tables are in `708`'s response.
 * ⚠️ **`smoke:ui` steps 62 and 70** — a live path, run hidden for `708`; their reading logic is
   `704`'s (`turn-query.mjs`, table 704 F).
 * ⚠️ **Three lines no mutation here can make visible, named rather than left to look guarded**
   (708's review): the ask's `??=` (the double's pushed level equals its answer, so `=` behaves the
   same), `DEFAULT_COMMAND_LIST_WAIT_MS`'s value (every test injects its own wait), and the `from`
   handed to the gate at `runSendInterrupting` and `runFlush` (the handover refuses the same message
   one step later, so a `null` there changes no outcome — defence in depth, stated).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RULE = "apps/desktop/src/main/runtime/a-command-goes-as-typed.ts"
PREFIXES = "packages/runtime/src/provider-commands.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
EVIDENCE = "packages/runtime/smoke/command-as-typed-evidence.ts"
SMOKE_RUN = "scripts/lib/smoke-run.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the host decides `R42` ──────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the handover never sends a command bare** — a person's `/compact` goes framed "
        "again, which is `704` §4's defect — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "    if (command !== null) {\n      // ⛔ **Never with its attachment block**", "    if (command !== null && false) {\n      // ⛔ **Never with its attachment block**")],
    ),
    (
        "M2 · ⛔ **any sender's command goes bare** — an agent could clear or compact another "
        "conversation by messaging it `/clear` — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  if (from === null || from.who !== 'a-person') return null\n", "  if (from === null) return null\n")],
    ),
    (
        "M3 · ⛔ **a `$` list is read as a `/` list** — a Codex skill's name typed with a slash "
        "would go bare — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  if (heard.prefix !== THE_SLASH) return null\n", "")],
    ),
    (
        "M4 · ⚑ **aliases are not commands** — `/cost`, which the CLI resolves to `/usage`, goes "
        "framed — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "(command) => command.name === name || (command.aliases ?? []).includes(name),", "(command) => command.name === name,")],
    ),
    (
        "M5 · ⛔ **anything after a slash is shaped like a command** — with no list, or a list cut "
        "short, a path such as `/Users/me/notes.md` goes bare — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  const shaped = LOOKS_LIKE_A_COMMAND.test(named.base)\n", "  const shaped = true\n")],
    ),
    (
        # ⚑ **713 · label corrected in place** (standing rule 27): a person's `/compact` on Codex runs
        # Codex's compaction since `R59`, ahead of the prefix — so the example is `/review`, as §5 is.
        "M6 · ⛔ **with no list, the provider's prefix is ignored** — a person's `/review` on Codex "
        "would go bare were Codex ever asked and silent — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "    return prefix === THE_SLASH && shaped ? { word, listed: false } : null\n", "    return shaped ? { word, listed: false } : null\n")],
    ),
    (
        "M7 · ⚑ **the first word is not trimmed** — `  /compact`, which the CLI runs, goes framed — "
        "killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  const trimmed = text.trim()\n", "  const trimmed = text\n")],
    ),
    (
        "M8 · ⚑ **Codex is asked for a `/` list it cannot have** — the cheap half stops checking the "
        "provider's prefix — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "    prefix === THE_SLASH &&\n    theCommandItNames(text) !== null\n", "    theCommandItNames(text) !== null\n")],
    ),
    (
        "M9 · ⚑ **a held list is ignored and the provider is asked anyway** — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "    if (session.commands !== null) return Promise.resolve(session.commands)\n", "")],
    ),
    (
        "M10 · ⚑ **a published list is not held** — a person's first command asks although the "
        "provider already said — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "      session.commands = {\n        commands: event.commands,", "      void {\n        commands: event.commands,")],
    ),
    (
        "M11 · 🔴 **the ask is unbounded** — a provider that never answers holds the person's send "
        "forever (standing rule 13) — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "    return withDeadline(\n      session.askingForCommands,\n      this.commandListWaitMs,\n      'the provider’s command list',\n    ).then(", "    return session.askingForCommands.then(")],
    ),
    (
        "M12 · 🔴 **the gate lets a command carry attachments** — the queue accepts it and "
        "interrupt-and-send stops the running turn for it — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "    if (command !== null && content.attached > 0) {\n      throw new ACommandTakesNoAttachments(command.word, command.listed)\n    }\n", "")],
    ),
    (
        "M13 · 🔴 **the handover sends a command with its block dropped** — a list that moved "
        "between the gate and the handover loses the person's files without a word — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "      if (handed.length > 0) throw new ACommandTakesNoAttachments(command.word, command.listed)\n", "")],
    ),
    (
        "M14 · ⛔ **a held command with attachments is retried forever** — it waits at every "
        "boundary with nobody told — killed by `a-command-goes-as-typed.test.ts` (708)",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The catch arm in runFlush still ends a held command that meets
        # ACommandTakesNoAttachments, but D-027 changed its guard from `this.holdsQueued(session,
        # queued)` to `command !== undefined` (the first of `still`; a command always goes alone).
        # The rule survives; the plant switches the arm off, so the message stays held and is
        # retried at every boundary. Killed by `a-command-goes-as-typed.test.ts`.
        [
            (HOST, '      if (error instanceof ACommandTakesNoAttachments && command !== undefined) {\n', '      if (false) {\n'),
        ],
    ),
    (
        # ⚑ **713 · label corrected in place** (standing rule 27): the example word is `/review` now —
        # a person's `/compact` on Codex takes `R59`'s door before any prefix is read.
        "M15 · ⛔ **Codex's prefix is `/`** — a person's `/review` on Codex goes bare, where Codex "
        "has no such command — killed by `a-command-goes-as-typed.test.ts` "
        "and `claude-provider-commands-ask.test.ts` (708)",
        [(PREFIXES, "  codex: CODEX_COMMAND_PREFIX,\n", "  codex: CLAUDE_COMMAND_PREFIX,\n")],
    ),
    # ── B · the Claude adapter's ask ───────────────────────────────────────────────────────
    (
        "M16 · ⚑ **the answer to an ask is not published** — the host decides on a list the "
        "palette is never told — killed by `claude-provider-commands-ask.test.ts` (708)",
        [(CLAUDE, "    this.emit({\n      type: 'provider_commands',\n      commands,\n      prefix: CLAUDE_COMMAND_PREFIX,\n      ...(dropped > 0 ? { dropped } : {}),\n      source: 'supportedCommands',\n    })\n", "")],
    ),
    # ── C · the probe's verdict ────────────────────────────────────────────────────────────
    (
        "M17 · ⛔ **a command frame alone is a run** — an arm whose words ALSO reached a model reads "
        "as `ran-it` — killed by `command-as-typed-evidence.test.ts` (708)",
        [(EVIDENCE, "  if (ran && !arm.wordsReachedAModel) return 'ran-it'\n", "  if (ran) return 'ran-it'\n")],
    ),
    (
        "M18 · ⛔ **a turn that never ended is read** — a stalled arm can pass — killed by "
        "`command-as-typed-evidence.test.ts` (708)",
        [(EVIDENCE, "  if (!arm.secondEnded) return 'not-performed'\n", "")],
    ),
    (
        "M19 · ⚑ **the stamp is judged on the words alone** — a stamp that changed what the CLI "
        "emitted would read as moving nothing — killed by `command-as-typed-evidence.test.ts` (708)",
        [(EVIDENCE, "    stamped.wordsReachedAModel === unstamped.wordsReachedAModel &&\n    JSON.stringify(stamped.framesAfterFirst) === JSON.stringify(unstamped.framesAfterFirst)\n", "    stamped.wordsReachedAModel === unstamped.wordsReachedAModel\n")],
    ),
    # ── D · `704` H-7 ──────────────────────────────────────────────────────────────────────
    (
        "M20 · 🔴 **a kept run is pruned** — the evidence a dispatch is tracing goes with the next "
        "five runs, which is `704` H-7 — killed by `smoke-run.test.mjs` (708)",
        [(SMOKE_RUN, "  const runs = every.filter((name) => !existsSync(join(evidenceRoot, name, KEPT_MARK)))\n", "  const runs = every\n")],
    ),
    # ── A, continued · what `708`'s review added ──────────────────────────────────────────────
    (
        "M21 · ⛔ **the cheap half forgets who is asking** — the host asks a provider for its list "
        "on every agent's `/word` — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "    from.who === 'a-person' &&\n    prefix === THE_SLASH &&\n", "    prefix === THE_SLASH &&\n")],
    ),
    (
        "M22 · ⚑ **a kept run counts against `keep`** — reading an old run costs a newer one its "
        "evidence — killed by `smoke-run.test.mjs` (708)",
        [(SMOKE_RUN, "  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) {\n", "  for (const name of every.slice(0, Math.max(0, every.length - keep)).filter((one) => runs.includes(one))) {\n")],
    ),
    (
        "M23 · 🔴 **an MCP prompt's ` (MCP)` is not joined back on** — `/srv:review (MCP) …`, which "
        "the CLI runs, goes framed whenever the list is known — killed by "
        "`a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  return { name: mcp ? `${base} ${MCP_MARK}` : base, base, sub }\n", "  return { name: base, base, sub }\n")],
    ),
    (
        "M24 · ⚑ **a list cut short vouches for what it dropped** — a command past the bound goes "
        "framed — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  return (heard.dropped ?? 0) > 0 && shaped ? { word, listed: false } : null\n", "  return null\n")],
    ),
    (
        "M25 · ⚑ **every command asks again, even while an ask is pending** — sends at once each "
        "start their own — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "    session.askingForCommands ??= this.askForTheCommands(session)\n", "    session.askingForCommands = this.askForTheCommands(session)\n")],
    ),
    (
        "M26 · ⚑ **a listed command is called a guess** — the refusal says `/compact` only reads "
        "as one — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  if (published) return { word, listed: true }\n", "  if (published) return { word, listed: false }\n")],
    ),
    # ── A, continued · what `708`'s second review added ───────────────────────────────────────
    (
        "M27 · 🔴 **a failed ask is never forgotten** — a provider slow to start is judged by shape "
        "for the rest of its life — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(HOST, "          session.askingForCommands = null\n", "")],
    ),
    (
        "M28 · ⚑ **the CLI's plugin retry is not mirrored** — `/myplugin review …`, which the CLI "
        "runs as `myplugin:review`, goes framed — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "  if (named.sub !== null && on(`${named.base}:${named.sub}`)) return { word, listed: true }\n", "")],
    ),
    (
        "M29 · ⛔ **the refusal says no list came, when one did** — a list cut short reads as a "
        "list never had — killed by `a-command-goes-as-typed.test.ts` (708)",
        [(RULE, "command list could not confirm it)`", "command list could not be had)`")],
    ),
]
