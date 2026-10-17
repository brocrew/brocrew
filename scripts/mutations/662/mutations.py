"""662 · Say whose words these are when they reach the model.

⛔ **Ordered from BroBot's own investigation of itself** (`DYNAMIC-WORKFLOW-FINDINGS.md`,
2026-09-23): the person asked for a dynamic workflow and nothing happened, because no turn this app
sends carries a provenance and the SDK fails closed on an unattributed one.

## 🔴 A · what the dispatch CHANGED

⚑ **The seam.** `SessionHandle.send(text, origin?)` takes a provider-neutral `TurnProvenance` —
`person` or `peer` — and an omitted one means what it always meant. ⚑ **Claude** maps it onto
`SDKMessageOrigin` (`human` / `peer`) on the pushed user message; **Codex** has no field for it at
the pinned 0.146.0 and drops it (`CODEX_CAPABILITIES.turnProvenance: absent`).

⚑ **The host.** `handToProvider` now performs the handover itself, and the frame
(`messageNamingItsSender`) and the stamp (`provenanceOf`, through `stampFor`) are read off the SAME
`from`. A person → `person`; any caller with an id → `peer`, whatever its words say; BroBot's own
sentences → nothing. The go-ahead passes `stampFor(null, [])`. ⚑ **From the review:** a person's
turn whose attached names contain a `"` gets no stamp, because the CLI's keyword matcher ends a
quoted region at any `"` and reads no escapes.

## ⛔ B · the rows this dispatch corrected elsewhere, and why none was retired

⚑ **Corrected in place and re-verified RED by hand**: `262 M35`, `262 M36`, `414 M8`, `414 M9`,
`414 M10`, `414 M12`, `414 M23`. ⚠️ Every one is the same shape. The three composing doors used to
wrap `this.handToProvider(…)` inside `session.handle.send(…)`, and now call it bare, so their
arguments sit one level shallower, and the go-ahead gained a second argument. No subject died.
⚠️ **But each row now does a little MORE than its label says**, and the review said so: `from`
drives the stamp as well as the frame, so `414 M8`, `M9`, `M12` and `M23` also change what the
provider is told. `262 M35` and `M36` hand over with no stamp, so this table's census reddens
beside their own killers. Each one's killer still goes red for its own rule, but a red is no
longer only that rule's.

## ⚠️ C · a row dropped before it was ever counted

⛔ **An omitted origin growing an `origin: undefined` key** was drafted, and it is an EQUIVALENT
mutant. The SDK writes each message with `JSON.stringify` (`sdk.mjs`, `Query.streamInput`), which
drops `undefined`, so the CLI receives the same bytes. The adapter test's `toStrictEqual` would
have gone red for a difference no provider can see. That strictness stays in the test and is not
counted as a row.

## ⚠️ D · what no row here can measure

⛔ **What the bundled CLI does with the stamp.** Read from the binary, not run: its stdin reader
keeps a host origin only when it is `human`, and the one strict reader of *human-typed* raises the
`ultracode` keyword attachment. ⚑ **No row can make that binary do otherwise**, so the table stops
at the SDK boundary, which is exactly where the capture tests read.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CODEX_CAPS = "packages/runtime/src/codex/capabilities.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the derivation ────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **an agent's message is stamped `human`** · the brief's own row: every caller that "
        "is not the app takes the person's arm, so an agent writing *ultracode* passes the one gate "
        "kept for a person's typing",
        [
            (
                ORIGIN,
                "  if (from.who === 'a-person') {\n    return attached.some(",
                "  if (from.who !== undefined) {\n    return attached.some(",
            )
        ],
    ),
    (
        "M2 · 🔴 **BroBot's own sentences are stamped as the person's** · a child's reply quoting "
        "*ultracode* inside the app's sentence reaches its parent as human-typed",
        [
            (
                ORIGIN,
                "  if (from === null) return undefined\n",
                "  if (from === null) return A_PERSON_TYPED_THIS\n",
            )
        ],
    ),
    (
        "M3 · ⛔ **the person's turn goes unattributed again** · the defect this dispatch was "
        "ordered for, put back: the keyword the person typed is refused by the SDK",
        [
            (
                ORIGIN,
                "    return attached.some((each) => each.path.includes('\"')) ? undefined : A_PERSON_TYPED_THIS\n",
                "    return undefined\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **an attached name that ends its own quotation keeps the person's stamp** · an agent "
        "names a file `notes\" ultracode \"x.md`, a person attaches it, and the keyword sits outside "
        "every quote of a turn stamped human (found by the review of this diff)",
        [
            (
                ORIGIN,
                "    return attached.some((each) => each.path.includes('\"')) ? undefined : A_PERSON_TYPED_THIS\n",
                "    return A_PERSON_TYPED_THIS\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **a peer loses its name** · the display name the SDK asks a host for is dropped, "
        "so the receiver has an id and nothing to read it as",
        [
            (
                ORIGIN,
                "    ...(from.profile === null ? {} : { name: nameOf(from.profile) }),\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⚠️ **a caller with no identity is handed a CATEGORY as its name** · *another agent* "
        "in a field that says *display name* reads as somebody's name",
        [
            (
                ORIGIN,
                "    ...(from.profile === null ? {} : { name: nameOf(from.profile) }),\n",
                "    ...(from.profile === null\n"
                "      ? { name: 'another agent' }\n"
                "      : { name: nameOf(from.profile) }),\n",
            )
        ],
    ),
    # ── B · the handover ──────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **the handover stops stamping** · every door still frames its words and none tells "
        "the provider who wrote them — the pre-`662` wire, reachable by deleting one argument",
        [
            (
                HOST,
                "    return session.handle.send(words, this.stampFor(from, handed))\n",
                "    return session.handle.send(words)\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **the stamp is read off a different value than the frame** · the frame still says "
        "*Sent by `sess_…`* while the provider is told a person typed it — the drift one `from` "
        "exists to make impossible",
        [
            (
                HOST,
                "    return session.handle.send(words, this.stampFor(from, handed))\n",
                "    return session.handle.send(words, this.stampFor(THE_PERSON_AT_A_WINDOW, handed))\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **the stamp is not told what the block quotes** · the handover passes no "
        "attachments, so a name that ends its own quotation is stamped human after all",
        [
            (
                HOST,
                "    return session.handle.send(words, this.stampFor(from, handed))\n",
                "    return session.handle.send(words, this.stampFor(from, []))\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **the go-ahead is stamped as the presser's** · a person pressed the button, but "
        "BroBot wrote the sentence, and `person` means typed",
        [
            (
                HOST,
                "      await session.handle.send(text, this.stampFor(null, []))\n",
                "      await session.handle.send(text, this.stampFor(this.originOf(by), []))\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ **a peer is named by its SLUG rather than the app's one naming function** · the "
        "stamp calls an identity one thing while the AGENTS rail and the parent's sentences call it "
        "another",
        [
            (
                HOST,
                "      (profile) => agentName(profile, this.deps.store.agentIdentities()),\n",
                "      (profile) => profile,\n",
            )
        ],
    ),
    # ── C · the adapters and the double ───────────────────────────────────────────────────────
    (
        "M12 · 🔴 **the Claude adapter drops the origin** · the host derives it, the seam carries "
        "it, and the SDK never sees it",
        [
            (
                CLAUDE,
                "      ...(stamped === undefined ? {} : { origin: stamped }),\n",
                "",
            )
        ],
    ),
    (
        "M13 · 🔴 **the Claude adapter turns a peer into a human** · the one line between an "
        "agent's words and the strict gate, flipped",
        [
            (
                CLAUDE,
                "        kind: 'peer',\n        from: origin.from,\n",
                "        kind: 'human',\n        from: origin.from,\n",
            )
        ],
    ),
    (
        "M14 · 🔴 **the Claude adapter defaults an OMITTED origin to human** · the dangerous default "
        "one layer down: every turn the host left unattributed — BroBot's notices, a child's reply "
        "quoting an agent — arrives human-typed",
        [
            (
                CLAUDE,
                "  if (origin === undefined) return undefined\n",
                "  if (origin === undefined) return { kind: 'human' }\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **a peer with no name is given an empty one** · the SDK leaves `name` absent when "
        "it cannot vouch for one, and this adapter must too",
        [
            (
                CLAUDE,
                "        ...(origin.name === undefined ? {} : { name: origin.name }),\n",
                "        name: origin.name ?? '',\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ **the Codex adapter invents a place for the stamp** · the capability table says "
        "the protocol has none, and the wire would then carry a field the app-server never declared",
        [
            # ⚑ **a turn that carries on after a repaired sign-in · re-anchored in place, not retired** —
            # `send` hands its words to `startATurn`, which a turn with no words shares, so the stamp is
            # threaded through both; the row's defect is unchanged.
            (
                CODEX,
                "  send(text: string): Promise<void> {\n"
                "    return this.startATurn(text)\n"
                "  }\n"
                "\n"
                "  /**\n"
                "   * A turn with no input: Codex keeps a refused turn's message in its thread, and a turn that adds\n"
                "   * nothing has the model answer it, once (measured: `codex-a-refused-turn-sent-again-probe`).\n"
                "   */\n"
                "  carryOn(): Promise<void> {\n"
                "    return this.startATurn(null)\n"
                "  }\n"
                "\n"
                "  /** A turn on this thread, handing the agent `text`, or nothing new at all. */\n"
                "  private async startATurn(text: string | null): Promise<void> {\n",
                "  send(text: string, origin?: unknown): Promise<void> {\n"
                "    return this.startATurn(text, origin)\n"
                "  }\n"
                "\n"
                "  /**\n"
                "   * A turn with no input: Codex keeps a refused turn's message in its thread, and a turn that adds\n"
                "   * nothing has the model answer it, once (measured: `codex-a-refused-turn-sent-again-probe`).\n"
                "   */\n"
                "  carryOn(): Promise<void> {\n"
                "    return this.startATurn(null)\n"
                "  }\n"
                "\n"
                "  /** A turn on this thread, handing the agent `text`, or nothing new at all. */\n"
                "  private async startATurn(text: string | null, origin?: unknown): Promise<void> {\n",
            ),
            (
                CODEX,
                "        'turn/start',\n        turnStartParams(\n          this._ref!.sessionId,\n          text,\n",
                "        'turn/start',\n        { origin, ...turnStartParams(\n          this._ref!.sessionId,\n          text,\n",
            ),
            (
                CODEX,
                "          askedModel,\n        ),\n      ),\n    ).then(",
                "          askedModel,\n        ) },\n      ),\n    ).then(",
            ),
        ],
    ),
    (
        "M17 · ⚠️ **the double records a stamp for a turn it REFUSED** · the host tests read "
        "`origins` as what the provider was handed, and a refused send would leave one behind",
        [
            (
                FAKE,
                "    if (turnId === null) throw this.machine.refusedTurn()\n"
                "    // ⚑ **662 · recorded only for a turn that was ACCEPTED**",
                "    this.origins.push(origin)\n"
                "    if (turnId === null) throw this.machine.refusedTurn()\n"
                "    // ⚑ **662 · recorded only for a turn that was ACCEPTED**",
            ),
            (
                FAKE,
                "    // `beginTurn` succeeds, so a refused send leaves no stamp behind to be mistaken for a sent one.\n"
                "    this.origins.push(origin)\n",
                "    // `beginTurn` succeeds, so a refused send leaves no stamp behind to be mistaken for a sent one.\n",
            ),
        ],
    ),
    # ── D · the disclosure ────────────────────────────────────────────────────────────────────
    (
        "M18 · ⚠️ **Codex claims a stamp it has nowhere to put** · the capability table says "
        "`available` for a provider whose `turn/start` carries no sender",
        [
            (
                CODEX_CAPS,
                "  turnProvenance: {\n    state: 'absent',\n",
                "  turnProvenance: {\n    state: 'available',\n",
            )
        ],
    ),
]
