"""738 · The final check.

⚑ **Ordered by** the person through the PM, 2026-09-25/26: every pending fix, then one restart, a tag and
the big change — and this, the live batch on the final `main` whose every red is attributed.

## 🔴 A · what decides *outside* — M1–M3

`scripts/lib/unasked-roots.mjs` answers the question R96's re-aim rests on: does Codex's `ask`
(`workspace-write` + `on-request`, `736`) write this path with no card? M1 compares by the path as
spelled (a target not written yet, `/tmp` vs `/private/tmp`); M2 forgets the temporary folders; M3
reads a sibling whose name starts with the folder's as inside it.

## 🔴 B · the UI smoke's Codex card steps aim outside — M4–M10

Steps 18, 51, 53 and 82 (`736` F-2): each row puts one write back where `ask` writes unasked, or
drops the refusal that keeps it out.

## 🔴 C · `smoke:codex` and the two probes — M11–M20

The same for §3.1c–3.4 and §3.12, the §3.1d pair, `sandbox-denied` and the reopen-grant patches;
M19 puts the R95 persistence the reopen-grant probe measured back to `once`; M20 leaves §3.1d's two
new waits out of the run's budget.

## 🔴 D · the other re-aims the batches found — M21–M43

M36–M39 are the self-review's (step 31's `make build`, step 82's model-bytes rule and Codex's echo, step 5's pane); M40–M43 the later batches' (step 47 as a worker — its batch-2 red was verified as PRODUCT, P-1, and the row pins only the placement; steps 4 and 5 by step 1's own id; step 6's baseline from the ledger).

Each step `738`'s batches found asserting the OLD behaviour of something a ruling changed (R93,
R94, R34b, `433`, `687`, `717` F-3), attributed by an investigator and an adversarial verifier from
that batch's own ledgers: each row puts one step back on its old premise.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on a step's LIVE half**: whether Codex then asks is measured by `738`'s batch, and no
table runs a live batch. ⚠️ Groups B and C are pins of the source, `224` M25's kind — they prove the
target is still built outside, not that a run reaches the card.
"""

HELPER = "scripts/lib/unasked-roots.mjs"
SMOKE = "scripts/ui-live-smoke.mjs"
CODEX = "packages/runtime/smoke/codex-live.smoke.ts"
REASON = "packages/runtime/smoke/codex-approval-reason-probe.smoke.ts"
GRANT = "packages/runtime/smoke/codex-reopen-grant-probe.smoke.ts"

ROOTS = "unasked-roots.test.mjs"
CENSUS = "a-codex-card-step-writes-outside-the-folder.test.mjs"
DEADLINES = "smoke-deadlines.test.mjs"

UIRULED = "a-live-step-follows-what-was-ruled.test.mjs"
CLAUDE = "packages/runtime/smoke/claude-live.smoke.ts"
RESUME = "scripts/resume-live-smoke.mjs"
PACKAGED = "scripts/packaged-smoke.mjs"

RESUME_LIVE_SMOKE = "scripts/resume-live-smoke.mjs"
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · what decides outside ───────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a target is compared by its spelling, not its real path** — `/tmp/x` reads as "
        f"outside `/private/tmp` — killed by `{ROOTS}` (738)",
        [(HELPER, "  const target = realOfNearest(path)\n", "  const target = resolve(path)\n")],
    ),
    (
        "M2 · ⚠️ **the temporary folders are forgotten** — a write `ask` makes unasked in `/tmp` "
        f"reads as one it asks about — killed by `{ROOTS}` (738)",
        [
            (
                HELPER,
                "export function writableUnasked(path, cwd, { temporary = [tmpdir(), '/tmp'] } = {}) {\n",
                "export function writableUnasked(path, cwd, { temporary = [] } = {}) {\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ **a sibling whose name starts with the folder's reads as inside it** — killed by "
        f"`{ROOTS}` (738)",
        [
            (
                HELPER,
                "    const rel = relative(realOfNearest(root), target)\n"
                "    if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) return root\n",
                "    if (target.startsWith(realOfNearest(root))) return root\n",
            )
        ],
    ),
    # ── B · the UI smoke's Codex card steps ────────────────────────────────────────────────────
    (
        "M4 · 🔴 **the UI smoke's helper stops refusing a folder `ask` writes unasked** — killed by "
        f"`{CENSUS}` (738)",
        [
            (
                SMOKE,
                "  if (unasked !== null) {\n"
                "    throw new Error(`${dir} is inside ${unasked}, which Codex's ask writes without a card (R96)`)\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M5 · 🔴 **step 18's first write goes back inside the folder** — its card never comes — "
        f"killed by `{CENSUS}` (738)",
        [(SMOKE, "      const first = join(outside, 'ask.txt')\n", "      const first = join(cwd, 'ask.txt')\n")],
    ),
    (
        "M6 · ⚠️ **step 18's unattended write goes back inside** — *no card on the next turn* then "
        f"holds under either mode — killed by `{CENSUS}` (738)",
        [(SMOKE, "      const second = join(outside, 'auto.txt')\n", "      const second = join(cwd, 'auto.txt')\n")],
    ),
    (
        "M7 · 🔴 **step 51's expiring card is raised by a write inside the folder** — killed by "
        f"`{CENSUS}` (738)",
        [
            (
                SMOKE,
                "      const cardTarget = join(outsideWhatAskWrites(cardCwd, 'expired-card-outside'), 'expire.txt')\n",
                "      const cardTarget = join(cardCwd, 'expire.txt')\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **step 53's stop target goes back into the arm's own folder** — killed by "
        f"`{CENSUS}` (738)",
        [
            (
                SMOKE,
                "      const target = join(outsideWhatAskWrites(cwd, `stop-094-${provider}-outside`), 'stop.txt')\n",
                "      const target = join(cwd, 'stop.txt')\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **step 82's CODEX rows write inside the children's folder again** — killed by "
        f"`{CENSUS}` (738)",
        [
            (
                SMOKE,
                "          const targetRootFor = (provider) => (provider === 'codex' ? matrixOutside : matrixCwd)\n",
                "          const targetRootFor = (provider) => matrixCwd\n",
            )
        ],
    ),
    (
        "M10 · ⚠️ **step 82 holds a Codex request's paths to the children's folder** — the row's own "
        f"outside file would then read as a different action — killed by `{CENSUS}` (738)",
        [
            (
                SMOKE,
                "              !requestSafelyNamesOnlyActionScope(request, matrixCwd, path, targetRootFor(provider))\n",
                "              !requestSafelyNamesOnlyActionScope(request, matrixCwd, path, matrixCwd)\n",
            )
        ],
    ),
    # ── C · smoke:codex and the two probes ─────────────────────────────────────────────────────
    (
        "M11 · 🔴 **`smoke:codex`'s outside folder IS its session folder** — every card step "
        f"writes where `ask` does not ask — killed by `{CENSUS}` (738)",
        [(CODEX, "  const outside = runScratch('codex-smoke-outside')\n", "  const outside = runScratch('codex-smoke')\n")],
    ),
    (
        "M12 · ⚠️ **the guard that refuses an unasked outside folder is dropped** — killed by "
        f"`{CENSUS}` (738)",
        [(CODEX, "  if (unaskedRoot !== null) {\n", "  if (unaskedRoot === '') {\n")],
    ),
    (
        "M13 · 🔴 **§3.2's first write goes back inside the folder** — killed by "
        f"`{CENSUS}` (738)",
        [(CODEX, "    const a1 = join(outside, 'a1.txt')\n", "    const a1 = join(scratch, 'a1.txt')\n")],
    ),
    (
        "M14 · 🔴 **§3.1d's pair stops asking that the inside write raised no card** — the R96 "
        f"boundary is then measured on one side only — killed by `{CENSUS}` (738)",
        [
            (
                CODEX,
                "      r1.approvals === 0 && existsSync(inside) && r2.approvals >= 1 && !existsSync(beyond)\n",
                "      existsSync(inside) && r2.approvals >= 1 && !existsSync(beyond)\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **§3.12's yolo write goes back inside** — *a write that prompts in ask* is false "
        f"of it — killed by `{CENSUS}` (738)",
        [(CODEX, "    const yoloPath = join(outside, 'yolo.txt')\n", "    const yoloPath = join(scratch, 'yolo.txt')\n")],
    ),
    (
        "M16 · 🔴 **`sandbox-denied` touches the cwd again** — the sandbox lets it, and the arm "
        f"measures nothing — killed by `{CENSUS}` (738)",
        [
            (
                REASON,
                "      action: { kind: 'exec', args: { cmd: `/usr/bin/touch ${join(outside, `${turn}.txt`)}` } },\n",
                "      action: { kind: 'exec', args: { cmd: `/usr/bin/touch ${join(cwd, `${turn}.txt`)}` } },\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **the reopen arm's session grant is asked about a file in its cwd** — `r2` raises "
        f"no card — killed by `{CENSUS}` (738)",
        [
            (
                GRANT,
                "          ['r2', { kind: 'patch', patch: patchAdd(join(outside, 'p697.txt')) }],\n",
                "          ['r2', { kind: 'patch', patch: patchAdd(join(cwd, 'p697.txt')) }],\n",
            )
        ],
    ),
    (
        "M18 · ⚠️ **the default arm's file is seeded in its cwd** — `d2`'s UPDATE then finds "
        f"nothing outside to change — killed by `{CENSUS}` (738)",
        [
            (
                GRANT,
                "        writeFileSync(join(outside, 'p697.txt'), 'one\\n') // so the UPDATE has something to change\n",
                "        writeFileSync(join(cwd, 'p697.txt'), 'one\\n') // so the UPDATE has something to change\n",
            )
        ],
    ),
    (
        "M19 · 🔴 **the sweep's cards are held to `once` again** — the value R95 retired, which "
        f"every live run now refutes — killed by `{CENSUS}` (738)",
        [
            (
                GRANT,
                "  expect(sweepCards.map((card) => card.persistence)).toEqual(sweepCards.map(() => 'always'))\n",
                "  expect(sweepCards.map((card) => card.persistence)).toEqual(sweepCards.map(() => 'once'))\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ **§3.1d's two approval loops are left out of the run's budget** — killed by "
        f"`{DEADLINES}` (738)",
        [(CODEX, "const APPROVAL_LOOPS = 6 + 1\n", "const APPROVAL_LOOPS = 4 + 1\n")],
    ),
    # ── D · the other re-aims the first batch found ─────────────────────────────────────────────
    (
        f"M21 · 🔴 **step 31 asks for `echo ALPHA` again** — read-only to the CLI, never asked since R93 "
        f"— killed by `{UIRULED}` (738)",
        [(SMOKE, "        prompt: 'Run exactly `touch alpha-058.txt` with Bash. Nothing else.',\n", "        prompt: 'Run exactly `echo ALPHA` with Bash. Nothing else.',\n")],
    ),
    (
        f"M22 · ⚠️ **step 31 forbids the CLI's own rule beside 058's again** — the shape R94 made "
        f"legitimate — killed by `{UIRULED}` (738)",
        [
            (
                SMOKE,
                "      if (!offer?.wide) throw new Error('an opaque Bash card was offered no session grant at all')\n",
                "      if (!offer?.wide) throw new Error('an opaque Bash card was offered no session grant at all')\n"
                "      if (offer.narrow) {\n"
                "        throw new Error('a Bash card offered the PATH-SCOPED grant, which discloses nothing here')\n"
                "      }\n",
            )
        ],
    ),
    (
        f"M23 · 🔴 **step 41's command is all `echo` again** — no card ever comes — killed by `{UIRULED}` (738)",
        [(SMOKE, "    const command = `echo \"${'padding '.repeat(30)}\" && touch ${MARKER}.txt`\n", "    const command = `echo \"${'padding '.repeat(30)}\" && echo ${MARKER}`\n")],
    ),
    (
        f"M24 · ⚠️ **step 41 stops asking for the command's HEAD** — a split command's `touch` alone "
        f"would pass as the whole — killed by `{UIRULED}` (738)",
        [(SMOKE, "    if (!card.text.includes(`echo \"${'padding '.repeat(30)}\"`)) {\n", "    if (false) {\n")],
    ),
    (
        f"M25 · 🔴 **step 19b counts the CLI's own plan file as a Write that should have asked** — "
        f"killed by `{UIRULED}` (738)",
        [(SMOKE, "${cliHome.length}) <> '${cliHome}'`,\n", "${cliHome.length}) <> ''`,\n")],
    ),
    (
        f"M26 · 🔴 **step 65 expects a linked CLAUDE.md to be refused again** — killed by `{UIRULED}` (738)",
        [
            (
                SMOKE,
                "      if (refused) {\n        throw new Error(`a linked CLAUDE.md is still refused, which 733 (R93) ended: \"${refused}\"`)\n",
                "      if (!refused) {\n        throw new Error(`a linked CLAUDE.md is still refused, which 733 (R93) ended: \"${refused}\"`)\n",
            )
        ],
    ),
    (
        f"M27 · ⚠️ **step 65 stops asking WHERE the followed link led** — killed by `{UIRULED}` (738)",
        [(SMOKE, "        !followed.link.includes(decoy) ||\n", "")],
    ),
    (
        f"M28 · 🔴 **step 51 runs as BroBot again** — its card is a delegation's, not the write's — "
        f"killed by `{UIRULED}` (738)",
        [(SMOKE, "        provider: 'codex',\n        profileId: await aWorkerIdentity(cdp),\n        cwd: cardCwd,\n", "        provider: 'codex',\n        cwd: cardCwd,\n")],
    ),
    (
        f"M29 · ⚠️ **step 53's arms run as BroBot again** — killed by `{UIRULED}` (738)",
        [(SMOKE, "        provider,\n        profileId: await aWorkerIdentity(cdp),\n        cwd,\n        ...(provider === 'claude' ? { model: CHEAP_CLAUDE } : {}),\n", "        provider,\n        cwd,\n        ...(provider === 'claude' ? { model: CHEAP_CLAUDE } : {}),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rewritten step-82 test
        # says the exact turn names that piece and carries no `says`, so a step that still expected
        # one would be asserting a message that no longer exists. The commit says "The live smokes
        # and lifecycle steps that used spawn_agent, kind 'work' or documents are rewritten." Its
        # anchor is left stale, so the census records it retired.
        f"M30 · 🔴 **step 82 expects a relayed turn without `says` again** — criterion 17 stops before "
        f"any row runs — killed by `{UIRULED}` (738)",
        [(SMOKE, "              says: expectedMessage.kind,\n", "")],
    ),
    (
        f"M31 · 🔴 **smoke:claude 3.1d wants BroBot's own card before a dispatch again** — killed by "
        f"`{UIRULED}` (738)",
        [(CLAUDE, "          dispatchCards.length === 0 &&\n", "          dispatchCards.length >= 1 &&\n")],
    ),
    (
        f"M32 · 🔴 **smoke:claude 3.2b's different tool is `echo` again** — killed by `{UIRULED}` (738)",
        [(CLAUDE, "      `Use the Bash tool to run exactly: chmod 644 ${a} — nothing else. Then stop.`,\n", "      'Use the Bash tool to run `echo SESSIONPROBE`. Then stop.',\n")],
    ),
    (
        f"M33 · 🔴 **smoke:resume 4 waits for the reopen list's row again** — R34b left it out — killed "
        f"by `{UIRULED}` (738)",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives, moved
        # to the one Conversations list. Live step 4 reads the list rows by
        # `[data-cy^=open-session-]`, and the plant makes it read the old `[data-cy=resumable-row]`.
        # The killer `a-live-step-follows-what-was-ruled.test.mjs` pins the selector in the script
        # source by `toContain`.
        [
            (RESUME_LIVE_SMOKE, "            const rows = [...document.querySelectorAll('[data-cy^=open-session-]')]\n", "            const rows = [...document.querySelectorAll('[data-cy=resumable-row]')]\n"),
        ],
    ),
    (
        f"M34 · ⚠️ **smoke:resume 5 presses a row the rail does not draw** — killed by `{UIRULED}` (738)",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. Step
        # 5 finds the conversation's row by its session id in the one list, and the plant makes that
        # lookup use the old resumable-row selector. The two-line anchor is the whole `const row =
        # …` expression, which occurs once.
        [
            (RESUME_LIVE_SMOKE, "        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]\n          .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})\n", "        const row = [...document.querySelectorAll('[data-cy=resumable-row]')]\n          .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})\n"),
        ],
    ),
    (
        f"M35 · 🔴 **smoke:packaged 5 sends on the seeded Claude again** — the missing Codex binary is "
        f"never asked for — killed by `{UIRULED}` (738)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) folded provider-select into the model picker; step 5 now picks Codex by adding a Codex model by hand (pickACodexModelByHand). Killer's census quotes the new call (a-live-step-follows-what-was-ruled.test.mjs:168).
        [(PACKAGED, "        await pickACodexModelByHand(brokenCdp)\n", "")],
    ),
    (
        f"M36 · 🔴 **step 31 stops asking whether `make build` ran** — a read-only substitute would pass "
        f"its 0 cards — killed by `{UIRULED}` (738)",
        [(SMOKE, "              \"AND json_extract(e.payload, '$.summary') LIKE '%make build%'\",\n", "              \"AND 1 = 1\",\n")],
    ),
    (
        f"M37 · 🔴 **step 82 stops reading the file's own diff before calling wrong bytes the model's** "
        f"— killed by `{UIRULED}` (738)",
        [(SMOKE, "                    change.diff.includes(`+${fileAfterFirstTurn.trimEnd()}`),\n", "                    true,\n")],
    ),
    (
        f"M38 · ⚠️ **smoke:resume 5 waits for a title the kept-open pane never draws** — killed by "
        f"`{UIRULED}` (738)",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. Step
        # 5 waits until the pressed row is the active one, read off
        # `[data-cy^=open-session-][data-active=true]`. The plant replaces that active-row read with
        # a bare title check, so the wait no longer says which conversation is open.
        [
            (RESUME_LIVE_SMOKE, "            `return document.querySelector('[data-cy^=open-session-][data-active=true]')?.dataset.sessionId ?? null`,\n", "            `return document.querySelector('[data-cy=conversation-title]') ? ${JSON.stringify(id)} : null`,\n"),
        ],
    ),
    (
        f"M39 · 🔴 **step 82 stops asking whether Codex was handed the sentence whole** — a relay that "
        f"altered it would be blamed on the model — killed by `{UIRULED}` (738)",
        [(SMOKE, "                    (part) => typeof part?.text === 'string' && part.text.includes(childWork),\n", "                    (part) => typeof part?.text === 'string',\n")],
    ),
    (
        f"M40 · 🔴 **step 47 runs as BroBot again** — a delegation card freezes the turn its queued "
        f"message waits behind, and 48 with it — killed by `{UIRULED}` (738)",
        [(SMOKE, "      provider: 'codex',\n      profileId: await aWorkerIdentity(cdp),\n      cwd: queueCwd,\n", "      provider: 'codex',\n      cwd: queueCwd,\n")],
    ),
    (
        f"M41 · ⚠️ **smoke:resume 4 takes the first kept-open row as step 1's** — the first life can "
        f"leave more than one — killed by `{UIRULED}` (738)",
        [(RESUME, "      const mine = rows.find((row) => row.id === firstSessionId)\n", "      const mine = rows[0]\n")],
    ),
    (
        f"M42 · 🔴 **smoke:resume 6 counts from no turns at all** — the replayed turns end its wait at "
        f"once, on the old reply — killed by `{UIRULED}` (738)",
        [(RESUME, "      const turnsBefore = ledgerTurnCount(firstSessionId)\n", "      const turnsBefore = 0\n")],
    ),
    (
        f"M43 · ⚠️ **smoke:resume 5 presses the first kept-open row** — after a delegation it can be "
        f"the child's — killed by `{UIRULED}` (738)",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. The
        # step must press the row of the conversation it recorded (`firstSessionId`), never the
        # first row in the list. The plant drops the id filter and takes `querySelector` of any
        # `open-session-` row.
        [
            (RESUME_LIVE_SMOKE, "        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]\n          .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})\n", "        const row = document.querySelector('[data-cy^=open-session-]')\n"),
        ],
    ),
]
